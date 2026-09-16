'use strict';

const db = require('../../db');
const { generateId } = require('../idGenerator');
const C = require('./constants');
const { getDraft } = require('./caseService');
const { recommendListedComparables, DEFAULT_LIMIT, MAX_LIMIT } = require('./listedIndustryRecommend');
const { enrichBusinessReasons } = require('./listedIndustryRecommendAi');
const { applyRecommendCodes, parseJson } = require('./comparableService');

const DEBOUNCE_MS = 5000;
const KEEP_SUCCESS = 5;
const KEEP_FAILED = 2;
const TIMEOUT_MS = Math.max(
  120000,
  parseInt(process.env.VALUATION_RECOMMEND_RUN_TIMEOUT_MS || '420000', 10) || 420000
);

const lastStartedAt = new Map();
const executing = new Set();

function httpError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseRunJson(row) {
  if (!row) return null;
  return {
    ...row,
    relax: Number(row.relax) === 1,
    include_neeq: Number(row.include_neeq) === 1,
    profile: parseJson(row.profile_json, null),
    result: parseJson(row.result_json, null),
  };
}

async function getRunRow(caseId, runId) {
  const rows = await db.query(
    `SELECT F_Id AS id, case_id, version_no, status, relax, include_neeq, result_limit,
            profile_json, result_json, error_message, F_CreatorUserId AS creator_user_id,
            started_at, finished_at, F_CreatorTime AS created_at
     FROM valuation_case_recommend_run
     WHERE F_Id = ? AND case_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [runId, caseId]
  );
  return parseRunJson(rows[0]);
}

async function listRecommendRuns(caseId) {
  const rows = await db.query(
    `SELECT F_Id AS id, case_id, version_no, status, relax, include_neeq, result_limit,
            error_message, started_at, finished_at, F_CreatorTime AS created_at
     FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0
     ORDER BY version_no DESC, F_CreatorTime DESC
     LIMIT 20`,
    [caseId]
  );
  return rows.map((r) => ({
    ...r,
    relax: Number(r.relax) === 1,
    include_neeq: Number(r.include_neeq) === 1,
  }));
}

async function getLatestRecommendState(caseId) {
  const latest = await db.query(
    `SELECT F_Id AS id, version_no, status, started_at, finished_at, F_CreatorTime AS created_at, error_message
     FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0
     ORDER BY version_no DESC LIMIT 1`,
    [caseId]
  );
  const runningRows = await db.query(
    `SELECT F_Id AS id, version_no, status, started_at, F_CreatorTime AS created_at
     FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0 AND status IN ('queued','running')
     ORDER BY version_no DESC LIMIT 1`,
    [caseId]
  );
  const successRows = await db.query(
    `SELECT F_Id AS id, version_no, status, relax, include_neeq, result_limit,
            error_message, finished_at, F_CreatorTime AS created_at
     FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0 AND status = 'success'
     ORDER BY version_no DESC LIMIT 1`,
    [caseId]
  );
  const failedRows = await db.query(
    `SELECT F_Id AS id, version_no, status, error_message, finished_at
     FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0 AND status IN ('failed','timeout')
     ORDER BY version_no DESC LIMIT 1`,
    [caseId]
  );
  const running = runningRows[0] || null;
  const latest_success = successRows[0] || null;
  const latest_failed = failedRows[0] || null;
  const head = latest[0] || null;
  let button = 'idle';
  if (running) button = 'running';
  else if (head?.status === 'success') button = 'success';
  return { running, latest_success, latest_failed, button };
}

async function nextVersionNo(caseId) {
  const rows = await db.query(
    `SELECT MAX(version_no) AS m FROM valuation_case_recommend_run WHERE case_id = ?`,
    [caseId]
  );
  return Number(rows[0]?.m || 0) + 1;
}

async function pruneRuns(caseId) {
  const success = await db.query(
    `SELECT F_Id AS id FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0 AND status = 'success'
     ORDER BY version_no DESC`,
    [caseId]
  );
  const failed = await db.query(
    `SELECT F_Id AS id FROM valuation_case_recommend_run
     WHERE case_id = ? AND F_DeleteMark = 0 AND status IN ('failed','timeout')
     ORDER BY version_no DESC`,
    [caseId]
  );
  const drop = [
    ...success.slice(KEEP_SUCCESS).map((r) => r.id),
    ...failed.slice(KEEP_FAILED).map((r) => r.id),
  ];
  if (!drop.length) return;
  await db.execute(
    `UPDATE valuation_case_recommend_run SET F_DeleteMark = 1, F_LastModifyTime = NOW()
     WHERE F_Id IN (${drop.map(() => '?').join(',')})`,
    drop
  );
}

async function markRun(runId, patch) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (!sets.length) return;
  params.push(runId);
  await db.execute(
    `UPDATE valuation_case_recommend_run SET ${sets.join(', ')}, F_LastModifyTime = NOW() WHERE F_Id = ?`,
    params
  );
}

async function executeRun(runId, caseId, cse, { relax, includeNeeq, limit }) {
  if (executing.has(runId)) return;
  executing.add(runId);
  const timeoutAt = Date.now() + TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(async () => {
    timedOut = true;
    try {
      const cur = await getRunRow(caseId, runId);
      if (cur && (cur.status === 'queued' || cur.status === 'running')) {
        await markRun(runId, {
          status: 'timeout',
          error_message: `推荐超时（${Math.round(TIMEOUT_MS / 1000)} 秒）`,
          finished_at: new Date(),
        });
      }
    } catch (e) {
      console.warn('[valuationRecommend] timeout mark failed', e.message);
    }
  }, TIMEOUT_MS);

  try {
    await markRun(runId, { status: C.JOB_STATUS.RUNNING, started_at: new Date() });
    const draft = await getDraft(caseId);
    const preview = await recommendListedComparables({
      cse: { ...cse, id: caseId },
      draft,
      relax,
      includeNeeq,
      limit,
    });
    if (timedOut) return;
    const ai = await enrichBusinessReasons(preview.profile, preview.candidates);
    if (timedOut) return;
    const still = await getRunRow(caseId, runId);
    if (!still || still.status === 'timeout' || still.status === 'failed') return;
    const result = {
      params: preview.params,
      warnings: preview.warnings,
      message: preview.message,
      default_checked: preview.default_checked,
      candidates: ai.candidates,
      ai_status: ai.ai_status,
      ai_message: ai.ai_message,
      ai_propose: preview.ai_propose || null,
    };
    await markRun(runId, {
      status: C.JOB_STATUS.SUCCESS,
      profile_json: JSON.stringify(preview.profile || {}),
      result_json: JSON.stringify(result),
      error_message: ai.ai_status === 'failed' ? ai.ai_message : preview.message || null,
      finished_at: new Date(),
    });
    await pruneRuns(caseId);
  } catch (e) {
    if (!timedOut) {
      console.error('[valuationRecommend] run failed', runId, e);
      await markRun(runId, {
        status: C.JOB_STATUS.FAILED,
        error_message: String(e.message || e).slice(0, 500),
        finished_at: new Date(),
      });
      await pruneRuns(caseId);
    }
  } finally {
    clearTimeout(timer);
    executing.delete(runId);
    void timeoutAt;
  }
}

async function startRecommendRun(req, cse, body = {}) {
  const caseId = cse.id;
  const now = Date.now();
  const prev = lastStartedAt.get(caseId) || 0;
  if (now - prev < DEBOUNCE_MS) {
    throw httpError('推荐进行中 / 请稍后再试', 409);
  }
  const state = await getLatestRecommendState(caseId);
  if (state.running) {
    throw httpError('推荐进行中 / 请稍后再试', 409);
  }
  lastStartedAt.set(caseId, now);

  const relax = !!body.relax;
  const includeNeeq = !!(body.include_neeq || body.includeNeeq);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(body.limit, 10) || DEFAULT_LIMIT));
  const versionNo = await nextVersionNo(caseId);
  const id = await generateId('valuation_case_recommend_run');
  await db.execute(
    `INSERT INTO valuation_case_recommend_run (
       F_Id, case_id, version_no, status, relax, include_neeq, result_limit,
       F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
    [id, caseId, versionNo, C.JOB_STATUS.QUEUED, relax ? 1 : 0, includeNeeq ? 1 : 0, limit, req.valUser?.id || null]
  );
  setImmediate(() => {
    executeRun(id, caseId, cse, { relax, includeNeeq, limit }).catch((e) =>
      console.error('[valuationRecommend]', id, e)
    );
  });
  return { run_id: id, version_no: versionNo, status: C.JOB_STATUS.QUEUED };
}

async function getRecommendRun(caseId, runId) {
  const row = await getRunRow(caseId, runId);
  if (!row) return null;
  if (row.status !== 'success') {
    return { ...row, result: row.status === 'success' ? row.result : null };
  }
  return row;
}

async function applyRecommendRun(caseId, runId, stockCodes) {
  const run = await getRunRow(caseId, runId);
  if (!run) throw httpError('推荐版本不存在', 404);
  if (run.status !== 'success') throw httpError('仅成功完成的推荐版本可加入名单', 400);
  const candidates = run.result?.candidates || [];
  return applyRecommendCodes(caseId, runId, candidates, stockCodes);
}

async function enrichExistingRun(caseId, runId) {
  const run = await getRunRow(caseId, runId);
  if (!run) throw httpError('推荐版本不存在', 404);
  if (run.status !== 'success') throw httpError('仅成功版本可补业务理由', 400);
  const candidates = run.result?.candidates || [];
  const ai = await enrichBusinessReasons(run.profile || {}, candidates);
  const result = {
    ...(run.result || {}),
    candidates: ai.candidates,
    ai_status: ai.ai_status,
    ai_message: ai.ai_message,
  };
  await markRun(runId, { result_json: JSON.stringify(result) });
  return getRunRow(caseId, runId);
}

module.exports = {
  startRecommendRun,
  listRecommendRuns,
  getRecommendRun,
  getLatestRecommendState,
  applyRecommendRun,
  enrichExistingRun,
  TIMEOUT_MS,
};
