'use strict';

/**
 * 百科批量查词后台任务：立即 202 受理，setImmediate 后台执行。
 * HTTP 优先，失败再走 Playwright（headless/cdp，见 BAIKE_BROWSER_MODE）。
 */

const db = require('../../db');
const { companyDedupeKey } = require('./listedFinancingJoin');
const {
  sleep,
  pickBaikeSearchName,
  resolveBaikeBrowserMode,
  fetchBaikeHttp,
  fetchBaikeBrowserBatch,
  closeBrowserWorker,
  applyBaikeToFinancingFanOut,
  applyBaikeToPreInvFanOut,
} = require('./baikeLookupService');

const LOG = '[baikeBatchJob]';
const runningByScope = new Map();

const BROWSER_CHUNK = Math.max(
  5,
  Math.min(30, parseInt(process.env.BAIKE_BROWSER_BATCH || '20', 10) || 20)
);

function hasUsableIntro(baike) {
  return Boolean(baike && baike.has_lemma && (baike.company_intro || baike.product_intro));
}

function emptyStats() {
  return {
    total: 0,
    found: 0,
    not_found: 0,
    anti_crawl: 0,
    error: 0,
    updated: 0,
    http_found: 0,
    browser_found: 0,
  };
}

function bumpStatus(stats, baike) {
  if (hasUsableIntro(baike)) {
    stats.found += 1;
    return;
  }
  const miss = String(baike?.miss_reason || '').trim();
  const lemma = String(baike?.lemma_status || '').trim();
  if (miss === 'anti_crawl' || lemma === 'unknown') {
    stats.anti_crawl += 1;
  } else if (lemma === 'error' || miss === 'fetch_error' || miss === 'parse_error' || miss === 'network_error') {
    stats.error += 1;
  } else {
    stats.not_found += 1;
  }
}

function preferBaike(httpResult, browserResult) {
  if (hasUsableIntro(browserResult)) return { baike: browserResult, via: 'browser' };
  if (browserResult?.has_lemma && !httpResult?.has_lemma) return { baike: browserResult, via: 'browser' };
  return { baike: httpResult, via: 'http' };
}

/**
 * @param {Array<{ searchName: string, row: object }>} items
 * @param {{ sleepMs?: number, applyOne: Function, logTag?: string }} opts
 */
async function runHttpThenBrowserBatch(items, opts = {}) {
  const sleepMs = opts.sleepMs ?? 800;
  const logTag = opts.logTag || LOG;
  const mode = resolveBaikeBrowserMode();
  const stats = emptyStats();
  stats.total = items.length;

  console.log(`${logTag} start total=${items.length} browserMode=${mode} sleepMs=${sleepMs}`);

  const needBrowser = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const name = String(item.searchName || '').trim();
    if (name.length < 2) {
      stats.error += 1;
      console.warn(`${logTag} skip empty name index=${i}`);
      continue;
    }
    if (sleepMs > 0 && i > 0) await sleep(Math.min(sleepMs, 400));
    let httpResult;
    try {
      httpResult = fetchBaikeHttp(name, sleepMs);
    } catch (e) {
      httpResult = {
        ok: false,
        has_lemma: false,
        lemma_status: 'error',
        miss_reason: 'fetch_error',
        company_intro: null,
        product_intro: null,
        error: e.message,
      };
    }
    if (hasUsableIntro(httpResult)) {
      try {
        const n = await opts.applyOne(item, httpResult);
        stats.updated += Number(n) || 0;
        stats.found += 1;
        stats.http_found += 1;
        console.log(
          `${logTag} [${i + 1}/${items.length}] "${name}" found via=http intro_len=${(httpResult.company_intro || httpResult.product_intro || '').length}`
        );
      } catch (e) {
        stats.error += 1;
        console.warn(`${logTag} [${i + 1}/${items.length}] "${name}" apply failed:`, e.message);
      }
      continue;
    }
    needBrowser.push({ item, httpResult, index: i });
    console.log(
      `${logTag} [${i + 1}/${items.length}] "${name}" http miss status=${httpResult.lemma_status} miss=${httpResult.miss_reason || '-'} → queue browser`
    );
  }

  console.log(`${logTag} browser queue size=${needBrowser.length} chunk=${BROWSER_CHUNK} mode=${mode}`);

  for (let i = 0; i < needBrowser.length; i += BROWSER_CHUNK) {
    const chunk = needBrowser.slice(i, i + BROWSER_CHUNK);
    const companies = chunk.map((c) => ({ company_name: c.item.searchName }));
    let browserResults = [];
    try {
      browserResults = await fetchBaikeBrowserBatch(companies, {
        itemSleepMs: sleepMs,
        sleepMs,
        captchaWaitMs: mode === 'headless' ? 0 : 15000,
      });
    } catch (e) {
      console.warn(`${logTag} browser batch failed (${i + 1}-${i + chunk.length}):`, e.message);
      for (const c of chunk) {
        try {
          const n = await opts.applyOne(c.item, c.httpResult);
          stats.updated += Number(n) || 0;
        } catch (applyErr) {
          console.warn(`${logTag} apply fallback failed:`, applyErr.message);
        }
        bumpStatus(stats, c.httpResult);
        console.log(
          `${logTag} browser-fail fallback "${c.item.searchName}" status=${c.httpResult?.lemma_status} miss=${c.httpResult?.miss_reason || '-'}`
        );
      }
      continue;
    }

    for (let j = 0; j < chunk.length; j += 1) {
      const c = chunk[j];
      const name = c.item.searchName;
      const { baike, via } = preferBaike(c.httpResult, browserResults[j]);
      try {
        const n = await opts.applyOne(c.item, baike);
        stats.updated += Number(n) || 0;
      } catch (e) {
        stats.error += 1;
        console.warn(`${logTag} apply failed "${name}":`, e.message);
        continue;
      }
      if (via === 'browser' && hasUsableIntro(baike)) stats.browser_found += 1;
      bumpStatus(stats, baike);
      const introLen = (baike?.company_intro || baike?.product_intro || '').length;
      console.log(
        `${logTag} browser [${i + j + 1}/${needBrowser.length}] "${name}" via=${via}` +
          ` status=${baike?.lemma_status} miss=${baike?.miss_reason || '-'} intro_len=${introLen}`
      );
    }
  }

  try {
    await closeBrowserWorker();
  } catch (_) {}

  console.log(`${logTag} done`, stats);
  return stats;
}

function tryBeginScope(scope) {
  if (runningByScope.get(scope)) {
    return {
      ok: false,
      code: 409,
      message: `已有「${scope}」百科批量任务在执行，请稍后再试（可 docker compose logs app -f 查看进度）`,
    };
  }
  runningByScope.set(scope, true);
  return { ok: true };
}

function endScope(scope) {
  runningByScope.delete(scope);
}

function enqueueBackground(scope, runner) {
  const gate = tryBeginScope(scope);
  if (!gate.ok) return gate;
  setImmediate(() => {
    Promise.resolve()
      .then(() => runner())
      .catch((e) => {
        console.error(`${LOG}[${scope}] fatal:`, e);
      })
      .finally(() => endScope(scope));
  });
  return { ok: true };
}

/** 融资：按 event_date 区间，去重企业后查词并 fan-out
 * @param {{ dateFrom, dateTo, sleepMs?, force? }} opts
 *   force=true 时包含已查词企业并覆盖写入（强制重跑）
 */
async function enqueueFinancingBatchBaikeLookup({ dateFrom, dateTo, sleepMs = 800, force = false } = {}) {
  const df = String(dateFrom || '').slice(0, 10);
  const dt = String(dateTo || '').slice(0, 10);
  const forceRun = Boolean(force);
  if (!df || !dt) {
    return { ok: false, code: 400, message: '缺少参数：start_date、end_date（yyyy-MM-dd）' };
  }
  if (df > dt) {
    return { ok: false, code: 400, message: '开始日期不能晚于结束日期' };
  }

  const rows = await db.query(
    `SELECT F_Id AS id, company_name, project_name, company_credit_code, baike_lookup_at
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
       ${forceRun ? '' : 'AND baike_lookup_at IS NULL'}
     ORDER BY event_date DESC, F_Id DESC`,
    [df, dt]
  );
  if (!rows.length) {
    return {
      ok: true,
      code: 200,
      message: forceRun ? '区间内无融资记录' : '区间内无待查词记录（已查过的已跳过；勾选强制重跑可覆盖）',
      data: { total: 0, accepted: false, force: forceRun },
    };
  }

  const map = new Map();
  for (const row of rows) {
    const company_name = String(row.company_name || row.project_name || '').trim();
    if (company_name.length < 2) continue;
    const key = companyDedupeKey({
      company_name,
      company_credit_code: row.company_credit_code,
    });
    if (!map.has(key)) {
      map.set(key, {
        id: row.id,
        company_name,
        company_credit_code: row.company_credit_code || null,
      });
    }
  }
  const companies = [...map.values()];
  if (!companies.length) {
    return { ok: true, code: 200, message: '区间内无有效企业名称', data: { total: 0, accepted: false, force: forceRun } };
  }

  const scope = 'financing';
  const mode = resolveBaikeBrowserMode();
  const queued = enqueueBackground(scope, async () => {
    const items = companies.map((c) => ({
      searchName: c.company_name,
      row: c,
    }));
    console.log(
      `${LOG}[financing] accepted total=${companies.length} force=${forceRun} browserMode=${mode} range=${df}~${dt}`
    );
    await runHttpThenBrowserBatch(items, {
      sleepMs,
      logTag: `${LOG}[financing]`,
      applyOne: async (item, baike) => {
        if (hasUsableIntro(baike) || baike?.has_lemma) {
          const r = await applyBaikeToFinancingFanOut(
            db,
            {
              company_name: item.row.company_name,
              company_credit_code: item.row.company_credit_code,
            },
            baike,
            { force: true }
          );
          return r.updated || 0;
        }
        // 未命中：force 时 fan-out 写状态；否则只写抽样行
        if (forceRun) {
          const r = await applyBaikeToFinancingFanOut(
            db,
            {
              company_name: item.row.company_name,
              company_credit_code: item.row.company_credit_code,
            },
            baike || {
              has_lemma: false,
              lemma_status: 'not_found',
              miss_reason: 'fetch_error',
              baike_url: null,
              company_intro: null,
              product_intro: null,
            },
            { force: true }
          );
          return r.updated || 0;
        }
        await db.execute(
          `UPDATE sourcing_financing_event SET baike_lemma_status = ?, baike_miss_reason = ?, baike_lookup_at = NOW(), F_LastModifyTime = NOW()
           WHERE F_Id = ?`,
          [baike?.lemma_status || 'not_found', baike?.miss_reason || 'fetch_error', item.row.id]
        );
        return 1;
      },
    });
  });
  if (!queued.ok) return queued;

  return {
    ok: true,
    code: 202,
    message: `已受理融资百科批量查词${forceRun ? '（强制重跑）' : ''}：区间 ${df}～${dt}，待查 ${companies.length} 家企业（browser=${mode}），后台执行中；进度见 docker compose logs app -f`,
    data: {
      accepted: true,
      scope,
      total: companies.length,
      event_rows: rows.length,
      browser_mode: mode,
      date_from: df,
      date_to: dt,
      force: forceRun,
    },
  };
}

/** 投前：按 ids 或空简介上限 */
async function enqueuePreInvestmentBatchBaikeLookup({ ids, sleepMs = 800 } = {}) {
  let rows;
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, company_intro, project_abbreviation
       FROM pre_investment_project WHERE F_Id IN (${placeholders}) AND F_DeleteMark = 0`,
      ids.map(String)
    );
  } else {
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, company_intro, project_abbreviation
       FROM pre_investment_project WHERE F_DeleteMark = 0 AND (company_intro IS NULL OR company_intro = '')
       ORDER BY F_Id DESC LIMIT 200`
    );
  }
  if (!rows.length) {
    return { ok: true, code: 200, message: '无需查词的记录', data: { total: 0, accepted: false } };
  }

  const mode = resolveBaikeBrowserMode();
  const scope = 'pre_investment';
  const queued = enqueueBackground(scope, async () => {
    const items = rows
      .map((row) => ({
        searchName: pickBaikeSearchName(row, ['enterprise_full_name', 'project_abbreviation']),
        row,
      }))
      .filter((x) => x.searchName.length >= 2);
    await runHttpThenBrowserBatch(items, {
      sleepMs,
      logTag: `${LOG}[pre_investment]`,
      applyOne: async (item, baike) => {
        const r = await applyBaikeToPreInvFanOut(
          db,
          {
            enterprise_full_name: item.row.enterprise_full_name,
            unified_credit_code: item.row.unified_credit_code,
          },
          baike,
          { force: false }
        );
        // 兼容旧逻辑：至少写当前行 company_intro
        const intro = hasUsableIntro(baike) ? baike.company_intro || baike.product_intro : null;
        if (intro) {
          await db.execute(
            `UPDATE pre_investment_project SET company_intro = COALESCE(?, company_intro), F_LastModifyTime = NOW()
             WHERE F_Id = ?`,
            [intro, item.row.id]
          );
        }
        return (r.updated || 0) || (intro ? 1 : 0);
      },
    });
  });
  if (!queued.ok) return queued;

  return {
    ok: true,
    code: 202,
    message: `已受理投前百科批量查词：共 ${rows.length} 条（browser=${mode}），后台执行中，请稍后刷新列表`,
    data: { accepted: true, scope, total: rows.length, browser_mode: mode },
  };
}

/** IPO 底层项目 */
async function enqueueIpoBatchBaikeLookup({ ids, sleepMs = 800 } = {}) {
  let rows;
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = await db.query(
      `SELECT F_Id AS id, company, unified_credit_code, qcc_company_intro
       FROM ipo_project WHERE F_Id IN (${placeholders}) AND F_DeleteMark = 0`,
      ids.map(String)
    );
  } else {
    rows = await db.query(
      `SELECT F_Id AS id, company, unified_credit_code, qcc_company_intro
       FROM ipo_project WHERE F_DeleteMark = 0 AND (qcc_company_intro IS NULL OR qcc_company_intro = '')
       ORDER BY F_Id DESC LIMIT 200`
    );
  }
  if (!rows.length) {
    return { ok: true, code: 200, message: '无需查词的记录', data: { total: 0, accepted: false } };
  }

  const mode = resolveBaikeBrowserMode();
  const scope = 'ipo_project';
  const queued = enqueueBackground(scope, async () => {
    const items = rows
      .map((row) => ({
        searchName: String(row.company || '').trim(),
        row,
      }))
      .filter((x) => x.searchName.length >= 2);
    await runHttpThenBrowserBatch(items, {
      sleepMs,
      logTag: `${LOG}[ipo]`,
      applyOne: async (item, baike) => {
        const intro = hasUsableIntro(baike) ? baike.company_intro || baike.product_intro : null;
        await db.execute(
          `UPDATE ipo_project SET qcc_company_intro = COALESCE(?, qcc_company_intro), F_LastModifyTime = NOW()
           WHERE F_Id = ?`,
          [intro, item.row.id]
        );
        return intro ? 1 : 0;
      },
    });
  });
  if (!queued.ok) return queued;

  return {
    ok: true,
    code: 202,
    message: `已受理底层项目百科批量查词：共 ${rows.length} 条（browser=${mode}），后台执行中，请稍后刷新列表`,
    data: { accepted: true, scope, total: rows.length, browser_mode: mode },
  };
}

/** 被投企业：ids 或按创建日期 + 空简介 */
async function enqueueInvestedEnterpriseBatchBaikeLookup({
  ids,
  dateFrom,
  dateTo,
  sleepMs = 800,
} = {}) {
  let rows;
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, qcc_company_intro
       FROM invested_enterprises WHERE F_Id IN (${placeholders}) AND F_DeleteMark = 0`,
      ids.map(String)
    );
  } else if (dateFrom && dateTo) {
    const df = String(dateFrom).slice(0, 10);
    const dt = String(dateTo).slice(0, 10);
    if (df > dt) {
      return { ok: false, code: 400, message: '开始日期不能晚于结束日期' };
    }
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, qcc_company_intro
       FROM invested_enterprises
       WHERE F_DeleteMark = 0
         AND DATE(F_CreatorTime) >= ? AND DATE(F_CreatorTime) <= ?
         AND (qcc_company_intro IS NULL OR TRIM(qcc_company_intro) = '')
       ORDER BY F_Id DESC
       LIMIT 200`,
      [df, dt]
    );
  } else {
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, qcc_company_intro
       FROM invested_enterprises WHERE F_DeleteMark = 0 AND (qcc_company_intro IS NULL OR qcc_company_intro = '')
       ORDER BY F_Id DESC LIMIT 200`
    );
  }
  if (!rows.length) {
    return { ok: true, code: 200, message: '无需查词的记录', data: { total: 0, accepted: false } };
  }

  const mode = resolveBaikeBrowserMode();
  const scope = 'invested_enterprise';
  const queued = enqueueBackground(scope, async () => {
    const items = rows
      .map((row) => ({
        searchName: String(row.enterprise_full_name || '').trim(),
        row,
      }))
      .filter((x) => x.searchName.length >= 2);
    await runHttpThenBrowserBatch(items, {
      sleepMs,
      logTag: `${LOG}[invested]`,
      applyOne: async (item, baike) => {
        const intro = hasUsableIntro(baike) ? baike.company_intro || baike.product_intro : null;
        await db.execute(
          `UPDATE invested_enterprises SET qcc_company_intro = COALESCE(?, qcc_company_intro), F_LastModifyTime = NOW()
           WHERE F_Id = ?`,
          [intro, item.row.id]
        );
        return intro ? 1 : 0;
      },
    });
  });
  if (!queued.ok) return queued;

  return {
    ok: true,
    code: 202,
    message: `已受理被投企业百科批量查词：共 ${rows.length} 条（browser=${mode}），后台执行中，请稍后刷新列表`,
    data: { accepted: true, scope, total: rows.length, browser_mode: mode },
  };
}

module.exports = {
  enqueueFinancingBatchBaikeLookup,
  enqueuePreInvestmentBatchBaikeLookup,
  enqueueIpoBatchBaikeLookup,
  enqueueInvestedEnterpriseBatchBaikeLookup,
  runHttpThenBrowserBatch,
  resolveBaikeBrowserMode,
};
