'use strict';

/**
 * 百科查词 JSONL 落盘 + 异步写库流水线。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PENDING = path.resolve(
  __dirname,
  '../../../../需求文档/竞品分析/Stage2b融资百科查词pending.jsonl'
);

function checkpointPath(pendingFile) {
  return `${pendingFile}.checkpoint.json`;
}

function loadApplyCheckpoint(pendingFile) {
  const cp = checkpointPath(pendingFile);
  if (!fs.existsSync(cp)) return { applied: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(cp, 'utf8'));
    return { applied: Number(raw.applied) || 0 };
  } catch {
    return { applied: 0 };
  }
}

function saveApplyCheckpoint(pendingFile, applied) {
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.writeFileSync(
    checkpointPath(pendingFile),
    JSON.stringify({ applied, updated_at: new Date().toISOString() }),
    'utf8'
  );
}

function appendPendingRecord(pendingFile, record) {
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  fs.appendFileSync(pendingFile, `${JSON.stringify(record)}\n`, 'utf8');
}

function readPendingLines(pendingFile) {
  if (!fs.existsSync(pendingFile)) return [];
  return fs
    .readFileSync(pendingFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function readPendingFromIndex(pendingFile, fromIndex) {
  const lines = readPendingLines(pendingFile);
  return { lines, total: lines.length, fromIndex };
}

function companyApplyKey(company) {
  const credit = String(company?.company_credit_code || '').trim();
  if (credit) return `c:${credit}`;
  return `n:${String(company?.company_name || '').trim()}`;
}

/**
 * 批量跳过 pending 中已在库内写过的企业（乱序写库后 checkpoint 落后时）。
 */
async function fastForwardAppliedCheckpoint(pendingFile, db, appliedStart, chunkSize = 100) {
  const lines = readPendingLines(pendingFile);
  let applied = appliedStart;
  while (applied < lines.length) {
    const slice = lines.slice(applied, applied + chunkSize);
    const records = slice.map((line) => JSON.parse(line));
    const credits = [
      ...new Set(
        records.map((r) => String(r.company?.company_credit_code || '').trim()).filter(Boolean)
      ),
    ];
    const names = [
      ...new Set(
        records
          .filter((r) => !String(r.company?.company_credit_code || '').trim())
          .map((r) => String(r.company?.company_name || '').trim())
          .filter(Boolean)
      ),
    ];

    const appliedKeys = new Set();
    if (credits.length) {
      const placeholders = credits.map(() => '?').join(',');
      const rows = await db.query(
        `SELECT DISTINCT TRIM(company_credit_code) AS credit
         FROM sourcing_financing_event
         WHERE F_DeleteMark = 0
           AND baike_lookup_at IS NOT NULL
           AND TRIM(company_credit_code) IN (${placeholders})`,
        credits
      );
      for (const row of rows) appliedKeys.add(`c:${String(row.credit || '').trim()}`);
    }
    if (names.length) {
      const placeholders = names.map(() => '?').join(',');
      const rows = await db.query(
        `SELECT DISTINCT TRIM(company_name) AS name
         FROM sourcing_financing_event
         WHERE F_DeleteMark = 0
           AND baike_lookup_at IS NOT NULL
           AND (company_credit_code IS NULL OR TRIM(company_credit_code) = '')
           AND TRIM(company_name) IN (${placeholders})`,
        names
      );
      for (const row of rows) appliedKeys.add(`n:${String(row.name || '').trim()}`);
    }

    let matched = 0;
    for (const rec of records) {
      if (!appliedKeys.has(companyApplyKey(rec.company))) break;
      matched += 1;
    }
    if (!matched) break;
    applied += matched;
    saveApplyCheckpoint(pendingFile, applied);
    if (matched < records.length) break;
  }
  return applied;
}

function hasPendingApplyWork(pendingFile) {
  const lines = readPendingLines(pendingFile);
  const applied = loadApplyCheckpoint(pendingFile).applied;
  return lines.length > applied;
}

function buildPendingRecord(company, baike) {
  return {
    v: 1,
    fetched_at: new Date().toISOString(),
    company: {
      company_name: company.company_name,
      company_credit_code: company.company_credit_code || null,
    },
    baike,
  };
}

/**
 * apply-only 快速路径：按批并行写库，批末 checkpoint（无需按序前缀）。
 */
async function applyPendingBatched(opts) {
  const pendingFile = opts.pendingFile || DEFAULT_PENDING;
  const concurrency = Math.max(1, Math.min(16, opts.concurrency ?? 12));
  const batchSize = Math.max(10, opts.batchSize ?? 100);
  const applyFn = opts.applyFn;
  let applied = loadApplyCheckpoint(pendingFile).applied;
  const lines = readPendingLines(pendingFile);

  while (applied < lines.length) {
    const slice = lines.slice(applied, applied + batchSize);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, slice.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= slice.length) break;
        const record = JSON.parse(slice[i]);
        await applyFn(record);
      }
    });
    await Promise.all(workers);
    applied += slice.length;
    saveApplyCheckpoint(pendingFile, applied);
    if (opts.onBatch) opts.onBatch(applied, lines.length);
  }
  return applied;
}

/**
 * @param {{
 *   pendingFile?: string,
 *   applyFn: (record: object) => Promise<void>,
 *   concurrency?: number,
 *   pollMs?: number,
 *   checkpointEvery?: number,
 *   onApplied?: (record: object, appliedTotal: number) => void,
 * }} opts
 */
function createPendingApplyConsumer(opts) {
  const pendingFile = opts.pendingFile || DEFAULT_PENDING;
  const concurrency = Math.max(1, Math.min(16, opts.concurrency ?? 8));
  const pollMs = opts.pollMs ?? 200;
  const checkpointEvery = Math.max(1, opts.checkpointEvery ?? 100);
  const applyFn = opts.applyFn;

  let applied = loadApplyCheckpoint(pendingFile).applied;
  let lastSavedApplied = applied;
  const doneAt = new Map();
  let producerDone = false;
  let inFlight = 0;
  let fatalError = null;
  let pumpPromise = null;
  let scheduledUpTo = applied;

  function maybeSaveCheckpoint(force = false) {
    if (force || applied - lastSavedApplied >= checkpointEvery) {
      saveApplyCheckpoint(pendingFile, applied);
      lastSavedApplied = applied;
    }
  }

  function advanceAppliedPrefix() {
    while (doneAt.get(applied)) {
      doneAt.delete(applied);
      applied += 1;
      maybeSaveCheckpoint(false);
    }
  }

  async function applyLine(index, record) {
    await applyFn(record);
    doneAt.set(index, true);
    advanceAppliedPrefix();
    if (opts.onApplied) opts.onApplied(record, applied);
  }

  async function waitForSlot(active) {
    while (active.size >= concurrency) {
      await Promise.race(active);
      if (fatalError) throw fatalError;
    }
  }

  async function schedulePendingLines(lines) {
    const active = new Set();
    while (scheduledUpTo < lines.length) {
      if (fatalError) throw fatalError;
      const index = scheduledUpTo;
      scheduledUpTo += 1;
      let record;
      try {
        record = JSON.parse(lines[index]);
      } catch (err) {
        throw new Error(`pending.jsonl 第 ${index + 1} 行解析失败: ${err.message}`);
      }
      await waitForSlot(active);
      inFlight += 1;
      const job = applyLine(index, record)
        .catch((err) => {
          fatalError = err;
        })
        .finally(() => {
          inFlight -= 1;
          active.delete(job);
        });
      active.add(job);
    }
    await Promise.all([...active]);
    if (fatalError) throw fatalError;
  }

  async function pump() {
    while (true) {
      if (fatalError) throw fatalError;
      const { lines, total } = readPendingFromIndex(pendingFile, scheduledUpTo);
      if (scheduledUpTo < total) {
        await schedulePendingLines(lines);
      }
      if (producerDone && inFlight === 0 && scheduledUpTo >= total) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    maybeSaveCheckpoint(true);
    return applied;
  }

  return {
    pendingFile,
    get applied() {
      return applied;
    },
    start() {
      if (!pumpPromise) pumpPromise = pump();
      return pumpPromise;
    },
    signalProducerDone() {
      producerDone = true;
    },
    waitForIdle() {
      return pumpPromise || Promise.resolve(applied);
    },
  };
}

module.exports = {
  DEFAULT_PENDING,
  checkpointPath,
  loadApplyCheckpoint,
  saveApplyCheckpoint,
  appendPendingRecord,
  readPendingLines,
  readPendingFromIndex,
  fastForwardAppliedCheckpoint,
  companyApplyKey,
  hasPendingApplyWork,
  buildPendingRecord,
  createPendingApplyConsumer,
  applyPendingBatched,
};
