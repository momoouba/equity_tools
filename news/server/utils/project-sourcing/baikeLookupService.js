'use strict';

/**
 * Stage 2b — 百度百科查词（融资 / 投前共用）
 * 自 2025-01-01 起有融资事件的企业查词一次，结果 fan-out 至该企业全部历史行。
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { normalizeCreditCode, strTrim } = require('../competitor-analysis/competitorMatchUtils');
const { normalizeCompanyName } = require('../listing/zhconvUtils');
const { companyDedupeKey } = require('./listedFinancingJoin');
const { resolvePythonBin, pythonArgs } = require('../../scripts/resolvePython');
const {
  DEFAULT_EVENT_SINCE,
  buildFinancingEventSinceClause,
  buildPreInvSinceClause,
} = require('./financingEventWindow');

const PY_BAIKE = path.join(__dirname, 'baidu_baike_fetch.py');
const PY_BAIKE_BROWSER = path.join(__dirname, 'baidu_baike_fetch_browser.py');
const BAIKE_LOOKUP_VERSION = 'baike_lookup_v1';
const MIN_INTRO_LEN = 20;

const PROTECTED_FINANCING_PROFILE = new Set(['listed_sync', 'bp', 'llm_web']);
const PROTECTED_PRE_INV_PROFILE = new Set(['bp', 'listed_sync', 'donor', 'llm_web']);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function executeWithDeadlockRetry(db, sql, params, retries = 15) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await db.execute(sql, params);
    } catch (err) {
      const retryable =
        err &&
        (err.code === 'ER_LOCK_DEADLOCK' ||
          err.code === 'ER_LOCK_WAIT_TIMEOUT' ||
          err.errno === 1205 ||
          err.errno === 1213);
      if (retryable && attempt < retries) {
        await sleep(Math.min(15000, 500 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  return null;
}

function isUsableIntro(text) {
  return strTrim(text).length >= MIN_INTRO_LEN;
}

function pickBaikeSearchName(row, fields = ['company_name', 'enterprise_full_name', 'project_abbreviation']) {
  for (const f of fields) {
    const s = strTrim(row[f]);
    if (s.length >= 2) return s;
  }
  return '';
}

function normalizeBaikePayload(raw, fallbackName) {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      has_lemma: false,
      lemma_status: 'error',
      miss_reason: 'fetch_error',
      baike_url: null,
      company_intro: null,
      product_intro: null,
      error: 'invalid_payload',
      company_name: fallbackName,
    };
  }
  const hasLemma = Boolean(raw.has_lemma);
  const lemmaStatus = strTrim(raw.lemma_status) || (hasLemma ? 'found' : 'not_found');
  const companyIntro = strTrim(raw.company_intro) || null;
  let productIntro = strTrim(raw.product_intro) || null;
  if (!productIntro && isUsableIntro(companyIntro)) productIntro = companyIntro;
  return {
    ok: Boolean(raw.ok) || hasLemma,
    has_lemma: hasLemma,
    lemma_status: lemmaStatus,
    miss_reason: strTrim(raw.miss_reason) || null,
    baike_url: strTrim(raw.baike_url) || null,
    company_intro: isUsableIntro(companyIntro) ? companyIntro : null,
    product_intro: isUsableIntro(productIntro) ? productIntro : null,
    error: strTrim(raw.error) || null,
    company_name: strTrim(raw.company_name) || fallbackName,
  };
}

function fetchBaikeHttp(companyName, sleepMs = 1200) {
  const name = strTrim(companyName);
  if (name.length < 2) return normalizeBaikePayload(null, name);
  const py = resolvePythonBin();
  const args = pythonArgs(PY_BAIKE, ['--name', name, '--sleep-ms', String(sleepMs), '--dry-json']);
  const r = spawnSync(py, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0) {
    return normalizeBaikePayload(
      { ok: false, has_lemma: false, lemma_status: 'error', miss_reason: 'fetch_error', error: r.stderr || r.stdout },
      name
    );
  }
  try {
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    return normalizeBaikePayload(JSON.parse(line), name);
  } catch (e) {
    return normalizeBaikePayload(
      { ok: false, has_lemma: false, lemma_status: 'error', miss_reason: 'parse_error', error: e.message },
      name
    );
  }
}

function buildBrowserPythonArgs(opts, extra = []) {
  const args = pythonArgs(PY_BAIKE_BROWSER, [
    ...extra,
    '--cdp-url',
    opts.cdpUrl || process.env.BAIKE_CDP_URL || 'http://127.0.0.1:9222',
    '--captcha-wait-ms',
    String(opts.captchaWaitMs ?? 15000),
    '--timeout-ms',
    String(opts.pageTimeoutMs ?? 30000),
  ]);
  if (opts.fastItemOnly) args.push('--fast-item-only');
  return args;
}

function mapBrowserBatchResults(companies, parsed) {
  if (!Array.isArray(parsed)) throw new Error('browser batch returned non-array');
  return parsed.map((item, i) =>
    normalizeBaikePayload(item, pickBaikeSearchName(companies[i]) || companies[i]?.company_name)
  );
}

class BaikeBrowserWorker {
  constructor(opts) {
    this.opts = opts;
    this.proc = null;
    this.lineBuffer = '';
    this.ready = false;
    this.pending = null;
    this.startPromise = null;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const py = resolvePythonBin();
      const args = buildBrowserPythonArgs(this.opts, ['--worker']);
      this.proc = spawn(py, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: path.dirname(PY_BAIKE_BROWSER),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      const onReadyFail = (err) => {
        if (!this.ready) reject(err);
      };
      this.proc.on('error', onReadyFail);
      this.proc.stderr.on('data', (chunk) => {
        const msg = String(chunk || '').trim();
        if (!msg || /DEP0169|trace-deprecation|EPIPE|broken pipe/i.test(msg)) return;
        console.warn('[baikeBrowserWorker]', msg);
      });
      this.proc.on('exit', (code) => {
        if (this.pending) {
          this.pending.reject(new Error(`baike browser worker exited (${code})`));
          this.pending = null;
        }
        this.ready = false;
        this.proc = null;
        this.startPromise = null;
        if (sharedBrowserWorker === this) {
          sharedBrowserWorker = null;
          sharedBrowserWorkerKey = null;
        }
      });
      this.proc.stdout.on('data', (chunk) => {
        this.lineBuffer += String(chunk || '');
        while (true) {
          const idx = this.lineBuffer.indexOf('\n');
          if (idx < 0) break;
          const line = this.lineBuffer.slice(0, idx).trim();
          this.lineBuffer = this.lineBuffer.slice(idx + 1);
          if (!line) continue;
          this._onLine(line, resolve, reject);
        }
      });
    });
    return this.startPromise;
  }

  _onLine(line, startResolve, startReject) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      if (!this.ready) startReject(new Error(`worker bad ready line: ${line}`));
      else if (this.pending) this.pending.reject(new Error(`worker bad response: ${line}`));
      return;
    }
    if (!this.ready) {
      if (parsed.ready) {
        this.ready = true;
        startResolve();
      } else {
        startReject(new Error(`worker not ready: ${line}`));
      }
      return;
    }
    if (parsed.error) {
      if (this.pending) this.pending.reject(new Error(parsed.error));
      this.pending = null;
      return;
    }
    if (this.pending) {
      this.pending.resolve(parsed);
      this.pending = null;
    }
  }

  fetchBatch(companies, opts = {}) {
    if (!this.ready || !this.proc) return Promise.reject(new Error('worker not ready'));
    const itemSleepMs = opts.itemSleepMs ?? opts.sleepMs ?? 400;
    const payload = {
      items: companies.map((c) => ({
        company_name: pickBaikeSearchName(c) || c.company_name || c.enterprise_full_name,
      })),
      sleep_ms: itemSleepMs,
      fast_item_only: Boolean(opts.fastItemOnly),
    };
    return new Promise((resolve, reject) => {
      const perItemMs = itemSleepMs + (opts.pageTimeoutMs ?? 30000) * 2;
      const timeoutMs = Math.max(900000, perItemMs * companies.length);
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending.reject(new Error(`worker batch timeout after ${timeoutMs}ms`));
          this.pending = null;
        }
      }, timeoutMs);
      this.pending = {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      try {
        this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (e) {
        clearTimeout(timer);
        this.pending = null;
        reject(e);
      }
    });
  }

  async close() {
    if (!this.proc) return;
    try {
      if (this.proc.stdin.writable) this.proc.stdin.write('{"cmd":"shutdown"}\n');
    } catch (_) {}
    await sleep(300);
    try {
      this.proc.kill();
    } catch (_) {}
    this.proc = null;
    this.ready = false;
    this.startPromise = null;
  }
}

let sharedBrowserWorker = null;
let sharedBrowserWorkerKey = null;

function browserWorkerKey(opts) {
  return [
    opts.cdpUrl || process.env.BAIKE_CDP_URL || 'http://127.0.0.1:9222',
    opts.captchaWaitMs ?? 15000,
    opts.pageTimeoutMs ?? 30000,
  ].join('|');
}

async function ensureBrowserWorker(opts = {}) {
  if (opts.useWorker === false) return null;
  const key = browserWorkerKey(opts);
  if (sharedBrowserWorker && sharedBrowserWorkerKey === key && sharedBrowserWorker.ready) {
    return sharedBrowserWorker;
  }
  await closeBrowserWorker();
  const worker = new BaikeBrowserWorker(opts);
  await worker.start();
  sharedBrowserWorker = worker;
  sharedBrowserWorkerKey = key;
  return worker;
}

async function closeBrowserWorker() {
  if (!sharedBrowserWorker) return;
  await sharedBrowserWorker.close();
  sharedBrowserWorker = null;
  sharedBrowserWorkerKey = null;
}

function fetchBaikeBrowserBatchSync(companies, opts = {}) {
  const py = resolvePythonBin();
  const payload = JSON.stringify(
    companies.map((c) => ({ company_name: pickBaikeSearchName(c) || c.company_name || c.enterprise_full_name }))
  );
  const itemSleepMs = opts.itemSleepMs ?? opts.sleepMs ?? 1200;
  const args = buildBrowserPythonArgs(opts, ['--batch', '--sleep-ms', String(itemSleepMs)]);
  const r = spawnSync(py, args, {
    input: payload,
    encoding: 'utf8',
    windowsHide: true,
    cwd: path.dirname(PY_BAIKE_BROWSER),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(String(r.stderr || r.stdout || 'browser batch failed').trim());
  }
  return mapBrowserBatchResults(companies, JSON.parse(String(r.stdout || '').trim()));
}

async function fetchBaikeBrowserBatch(companies, opts = {}) {
  if (opts.useWorker === false) return fetchBaikeBrowserBatchSync(companies, opts);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const worker = await ensureBrowserWorker(opts);
      if (!worker) break;
      const parsed = await worker.fetchBatch(companies, opts);
      return mapBrowserBatchResults(companies, parsed);
    } catch (e) {
      console.warn(
        `[fetchBaikeBrowserBatch] worker failed (attempt ${attempt + 1}/2):`,
        e.message
      );
      await closeBrowserWorker();
    }
  }
  console.warn('[fetchBaikeBrowserBatch] worker unavailable, fallback to sync batch');
  return fetchBaikeBrowserBatchSync(companies, opts);
}

function buildFinancingFanOutWhere(companyRow) {
  const credit = normalizeCreditCode(companyRow.company_credit_code);
  if (credit) {
    return { clause: 'F_DeleteMark = 0 AND TRIM(company_credit_code) = ?', params: [credit] };
  }
  const nm = normalizeCompanyName(companyRow.company_name);
  if (nm) {
    return {
      clause:
        "F_DeleteMark = 0 AND (company_credit_code IS NULL OR TRIM(company_credit_code) = '') AND TRIM(company_name) = ?",
      params: [nm],
    };
  }
  return null;
}

function buildPreInvFanOutWhere(companyRow) {
  const credit = normalizeCreditCode(companyRow.unified_credit_code);
  if (credit) {
    return { clause: 'F_DeleteMark = 0 AND TRIM(unified_credit_code) = ?', params: [credit] };
  }
  const nm = strTrim(companyRow.enterprise_full_name);
  if (nm) {
    return { clause: 'F_DeleteMark = 0 AND TRIM(enterprise_full_name) = ?', params: [nm] };
  }
  return null;
}

/**
 * 近 N 年有融资事件的企业（去重）；查词后 fan-out 至全部历史行。
 * @param {{ skipLookedUp?: boolean }} opts - skipLookedUp 默认 true，跳过已有 baike_lookup_at 的企业（断点续跑）
 */
async function loadRecentFinancingCompanies(db, opts = {}) {
  const skipLookedUp = opts.skipLookedUp !== false;
  const since = buildFinancingEventSinceClause(opts);
  const rows = await db.query(
    `SELECT company_name, company_credit_code, MAX(event_date) AS last_event,
            MAX(baike_lookup_at) AS last_baike_lookup
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND ${since.clause}
     GROUP BY company_credit_code, company_name
     ${skipLookedUp ? 'HAVING MAX(baike_lookup_at) IS NULL' : ''}`,
    since.params
  );
  const map = new Map();
  for (const row of rows) {
    const key = companyDedupeKey(row);
    const existing = map.get(key);
    const dt = String(row.last_event || '');
    if (!existing || dt > String(existing.last_event || '')) {
      map.set(key, {
        company_name: strTrim(row.company_name),
        company_credit_code: strTrim(row.company_credit_code) || null,
        last_event: row.last_event,
      });
    }
  }
  return [...map.values()];
}

/**
 * 近 N 年创建的投前项目（按信用代码/全称去重）。
 */
async function loadRecentPreInvestmentCompanies(db, opts = {}) {
  const since = buildPreInvSinceClause(opts);
  const rows = await db.query(
    `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation, F_CreatorTime
     FROM pre_investment_project
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(enterprise_full_name, '')) <> ''
       AND ${since.clause}
     ORDER BY F_CreatorTime DESC`,
    since.params
  );
  const map = new Map();
  for (const row of rows) {
    const credit = normalizeCreditCode(row.unified_credit_code);
    const key = credit ? `c:${credit}` : `n:${normalizeCompanyName(row.enterprise_full_name)}`;
    if (!map.has(key)) {
      map.set(key, {
        enterprise_full_name: strTrim(row.enterprise_full_name),
        unified_credit_code: credit || null,
        project_abbreviation: strTrim(row.project_abbreviation) || null,
        sample_id: row.F_Id,
        last_created: row.F_CreatorTime,
      });
    }
  }
  return [...map.values()];
}

async function countRecentFinancingCompanies(db, opts = {}) {
  const since = buildFinancingEventSinceClause(opts);
  const rows = await db.query(
    `SELECT COUNT(*) AS c FROM (
       SELECT 1
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0
         AND TRIM(COALESCE(company_name, '')) <> ''
         AND ${since.clause}
       GROUP BY company_credit_code, company_name
     ) t`,
    since.params
  );
  return Number(rows[0]?.c || 0);
}

async function countFinancingFanOutRows(db, companyRow) {
  const where = buildFinancingFanOutWhere(companyRow);
  if (!where) return 0;
  const rows = await db.query(`SELECT COUNT(*) AS c FROM sourcing_financing_event WHERE ${where.clause}`, where.params);
  return Number(rows[0]?.c || 0);
}

async function countPreInvFanOutRows(db, companyRow) {
  const where = buildPreInvFanOutWhere(companyRow);
  if (!where) return 0;
  const rows = await db.query(`SELECT COUNT(*) AS c FROM pre_investment_project WHERE ${where.clause}`, where.params);
  return Number(rows[0]?.c || 0);
}

async function isFinancingBaikeApplied(db, companyRow) {
  const where = buildFinancingFanOutWhere(companyRow);
  if (!where) return true;
  const rows = await db.query(
    `SELECT 1 AS ok FROM sourcing_financing_event WHERE ${where.clause} AND baike_lookup_at IS NOT NULL LIMIT 1`,
    where.params
  );
  return Number(rows[0]?.ok) === 1;
}

/**
 * 百科元数据写全部行；画像字段跳过 listed_sync / 受保护来源（除非 force）。
 */
async function applyBaikeToFinancingFanOut(db, companyRow, baike, opts = {}) {
  const where = buildFinancingFanOutWhere(companyRow);
  if (!where) return { updated: 0, profile_updated: 0 };

  const force = Boolean(opts.force);
  const profileGuard = force
    ? '1=1'
    : `COALESCE(profile_source, '') NOT IN ('listed_sync', 'bp', 'llm_web')
       AND COALESCE(listing_status, '') <> 'matched'`;
  const hasProfile = baike.has_lemma && (baike.company_intro || baike.product_intro);
  const freshGuard = force ? '' : ' AND baike_lookup_at IS NULL';

  if (hasProfile) {
    const r = await executeWithDeadlockRetry(
      db,
      `UPDATE sourcing_financing_event SET
        baike_lemma_url = ?,
        baike_lemma_status = ?,
        baike_miss_reason = ?,
        baike_lookup_at = CURRENT_TIMESTAMP,
        company_intro = CASE WHEN ${profileGuard} THEN ? ELSE company_intro END,
        ai_product_intro = CASE WHEN ${profileGuard} THEN ? ELSE ai_product_intro END,
        profile_source = CASE WHEN ${profileGuard} THEN 'baike' ELSE profile_source END,
        ai_enrich_status = CASE WHEN ${profileGuard} THEN 'skipped' ELSE ai_enrich_status END,
        ai_enrich_version = CASE WHEN ${profileGuard} THEN ? ELSE ai_enrich_version END,
        F_LastModifyTime = CURRENT_TIMESTAMP
      WHERE ${where.clause}${freshGuard}`,
      [
        baike.baike_url,
        baike.lemma_status,
        baike.miss_reason,
        baike.company_intro,
        baike.product_intro,
        BAIKE_LOOKUP_VERSION,
        ...where.params,
      ]
    );
    const affected = r.affectedRows || 0;
    return { updated: affected, profile_updated: affected };
  }

  const r = await executeWithDeadlockRetry(
    db,
    `UPDATE sourcing_financing_event SET
      baike_lemma_url = ?,
      baike_lemma_status = ?,
      baike_miss_reason = ?,
      baike_lookup_at = CURRENT_TIMESTAMP,
      F_LastModifyTime = CURRENT_TIMESTAMP
    WHERE ${where.clause}${freshGuard}`,
    [baike.baike_url, baike.lemma_status, baike.miss_reason, ...where.params]
  );
  const affected = r.affectedRows || 0;
  if (opts.skipFanOutCount) return { updated: affected, profile_updated: 0 };
  const total = await countFinancingFanOutRows(db, companyRow);
  return { updated: total, profile_updated: 0 };
}

async function applyBaikeToPreInvFanOut(db, companyRow, baike, opts = {}) {
  const where = buildPreInvFanOutWhere(companyRow);
  if (!where) return { updated: 0, profile_updated: 0 };

  const force = Boolean(opts.force);
  const profileGuard = force
    ? '1=1'
    : `COALESCE(profile_source, '') NOT IN ('bp', 'listed_sync', 'donor', 'llm_web')`;

  await executeWithDeadlockRetry(
    db,
    `UPDATE pre_investment_project SET
      baike_lemma_url = ?,
      baike_lemma_status = ?,
      baike_miss_reason = ?,
      baike_lookup_at = CURRENT_TIMESTAMP,
      F_LastModifyTime = CURRENT_TIMESTAMP
    WHERE ${where.clause}`,
    [baike.baike_url, baike.lemma_status, baike.miss_reason, ...where.params]
  );

  let profileUpdated = 0;
  if (baike.has_lemma && (baike.company_intro || baike.product_intro)) {
    const r = await executeWithDeadlockRetry(
      db,
      `UPDATE pre_investment_project SET
        company_intro = CASE WHEN ${profileGuard} THEN ? ELSE company_intro END,
        product_intro = CASE WHEN ${profileGuard} THEN ? ELSE product_intro END,
        profile_source = CASE WHEN ${profileGuard} THEN 'baike' ELSE profile_source END,
        ai_enrich_status = CASE WHEN ${profileGuard} THEN 'skipped' ELSE ai_enrich_status END,
        ai_enrich_version = CASE WHEN ${profileGuard} THEN ? ELSE ai_enrich_version END,
        F_LastModifyTime = CURRENT_TIMESTAMP
      WHERE ${where.clause}`,
      [baike.company_intro, baike.product_intro, BAIKE_LOOKUP_VERSION, ...where.params]
    );
    profileUpdated = r.affectedRows || 0;
  }

  const total = await countPreInvFanOutRows(db, companyRow);
  return { updated: total, profile_updated: profileUpdated };
}

module.exports = {
  BAIKE_LOOKUP_VERSION,
  MIN_INTRO_LEN,
  PROTECTED_FINANCING_PROFILE,
  PROTECTED_PRE_INV_PROFILE,
  sleep,
  pickBaikeSearchName,
  normalizeBaikePayload,
  fetchBaikeHttp,
  fetchBaikeBrowserBatch,
  ensureBrowserWorker,
  closeBrowserWorker,
  loadRecentFinancingCompanies,
  loadRecentPreInvestmentCompanies,
  isFinancingBaikeApplied,
  applyBaikeToFinancingFanOut,
  applyBaikeToPreInvFanOut,
  countFinancingFanOutRows,
  countRecentFinancingCompanies,
  countPreInvFanOutRows,
  buildFinancingFanOutWhere,
  buildPreInvFanOutWhere,
};
