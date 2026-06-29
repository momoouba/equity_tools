const db = require('../../db');

/** run_id 形如 2026051516522200001，前 8 位为 YYYYMMDD */
function parseYmdFromRunId(runId) {
  const s = String(runId || '').trim();
  if (/^\d{8}/.test(s)) return s.slice(0, 8);
  return '';
}

function formatRunDateYmd(createdAt, runId) {
  const fromId = parseYmdFromRunId(runId);
  if (fromId) return fromId;
  const s = String(createdAt || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10).replace(/-/g, '');
  }
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** @param {object[]} runsAsc created_at ASC */
function assignVersionLabels(runsAsc) {
  const dayCounts = new Map();
  const labeled = [];
  for (const run of runsAsc) {
    const runId = run.id;
    if (!runId || !String(runId).trim()) continue;
    const day = formatRunDateYmd(run.created_at, runId);
    if (!day) continue;
    const n = (dayCounts.get(day) || 0) + 1;
    dayCounts.set(day, n);
    const version_label = `${day}-V${String(n).padStart(3, '0')}`;
    labeled.push({ ...run, version_label });
  }
  return labeled;
}

/** 有效版本：成功跑批且含 AI 落库行（排除仅 human_locked / 用户新增挂到新 run 的空跑） */
function isEffectiveCompetitorRunVersion(row) {
  const aiCount = Number(row.ai_relation_count) || 0;
  if (aiCount <= 0) return false;
  const status = row.status != null ? String(row.status).trim().toLowerCase() : '';
  if (status === 'success') return true;
  // 历史数据：run 表无记录但 relation 中仍有 AI 行
  return !status;
}

/**
 * 版本列表：以 run 表为准，含已归档 relation（历史批次软删后仍可切换查看）。
 */
async function listInvestedEnterpriseCompetitorRuns(investedEnterpriseId) {
  const ieId = String(investedEnterpriseId || '').trim();
  if (!ieId) return [];

  const runRows = await db.query(
    `SELECT scr.F_Id AS run_id,
            scr.F_CreatorTime AS run_created_at,
            scr.status,
            scr.message,
            scr.finished_at,
            scr.triggered_by_user_id,
            COALESCE(rel.relation_count, 0) AS relation_count,
            COALESCE(rel.ai_relation_count, 0) AS ai_relation_count
     FROM sourcing_competitor_run scr
     LEFT JOIN (
       SELECT run_id,
              COUNT(*) AS relation_count,
              SUM(CASE WHEN F_CreatorUserId IS NULL AND COALESCE(human_locked, 0) = 0 THEN 1 ELSE 0 END) AS ai_relation_count
       FROM sourcing_competitor_relation
       WHERE invested_enterprise_id = ?
         AND run_id IS NOT NULL AND TRIM(run_id) <> ''
         AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
       GROUP BY run_id
     ) rel ON rel.run_id = scr.F_Id
     WHERE scr.invested_enterprise_id = ?
       AND scr.F_DeleteMark = 0
       AND scr.status = 'success'
       AND COALESCE(rel.ai_relation_count, 0) > 0
     ORDER BY scr.F_CreatorTime ASC, scr.F_Id ASC`,
    [ieId, ieId]
  );

  const runsAsc = runRows
    .filter((row) => row.run_id && String(row.run_id).trim())
    .map((row) => ({
      id: row.run_id,
      created_at: row.run_created_at,
      status: row.status,
      message: row.message,
      finished_at: row.finished_at,
      triggered_by_user_id: row.triggered_by_user_id,
      relation_count: Number(row.relation_count) || 0,
      ai_relation_count: Number(row.ai_relation_count) || 0,
    }))
    .filter(isEffectiveCompetitorRunVersion);

  return assignVersionLabels(runsAsc).reverse();
}

/** 当前有效批次：最近一次成功且含 AI 落库数据的 run_id */
async function getLatestRunIdForInvestedEnterprise(investedEnterpriseId) {
  const ieId = String(investedEnterpriseId || '').trim();
  if (!ieId) return null;

  const fromRunTable = await db.query(
    `SELECT scr.F_Id AS run_id
     FROM sourcing_competitor_run scr
     INNER JOIN sourcing_competitor_relation r
       ON r.run_id = scr.F_Id
       AND r.invested_enterprise_id = scr.invested_enterprise_id
       AND r.F_DeleteMark = 0
       AND r.F_CreatorUserId IS NULL
       AND COALESCE(r.human_locked, 0) = 0
       AND (r.subject_type = 'invested_enterprise' OR r.subject_type IS NULL)
     WHERE scr.invested_enterprise_id = ?
       AND scr.F_DeleteMark = 0
       AND scr.status = 'success'
     ORDER BY scr.finished_at DESC, scr.F_CreatorTime DESC
     LIMIT 1`,
    [ieId]
  );
  if (fromRunTable.length) return fromRunTable[0].run_id;

  const rows = await db.query(
    `SELECT run_id
     FROM sourcing_competitor_relation
     WHERE invested_enterprise_id = ? AND F_DeleteMark = 0
       AND run_id IS NOT NULL AND TRIM(run_id) <> ''
       AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
       AND F_CreatorUserId IS NULL
       AND COALESCE(human_locked, 0) = 0
     ORDER BY F_CreatorTime DESC
     LIMIT 1`,
    [ieId]
  );
  return rows.length ? rows[0].run_id : null;
}

async function buildVersionLabelMapForInvestedEnterprise(investedEnterpriseId) {
  const runs = await listInvestedEnterpriseCompetitorRuns(investedEnterpriseId);
  const map = new Map();
  for (const run of runs) {
    map.set(String(run.id), run.version_label);
  }
  return map;
}

/**
 * 版本列表：以 run 表为准，含已归档 relation（历史批次软删后仍可切换查看）。
 */
async function listPreInvestmentCompetitorRuns(preInvestmentProjectId) {
  const pipId = String(preInvestmentProjectId || '').trim();
  if (!pipId) return [];

  const runRows = await db.query(
    `SELECT scr.F_Id AS pre_investment_run_id,
            scr.F_CreatorTime AS run_created_at,
            scr.status,
            scr.message,
            scr.finished_at,
            scr.triggered_by_user_id,
            COALESCE(rel.relation_count, 0) AS relation_count,
            COALESCE(rel.ai_relation_count, 0) AS ai_relation_count
     FROM sourcing_pre_investment_competitor_run scr
     LEFT JOIN (
       SELECT pre_investment_run_id,
              COUNT(*) AS relation_count,
              SUM(CASE WHEN F_CreatorUserId IS NULL AND COALESCE(human_locked, 0) = 0 THEN 1 ELSE 0 END) AS ai_relation_count
       FROM sourcing_competitor_relation
       WHERE pre_investment_project_id = ?
         AND subject_type = 'pre_investment_project'
         AND pre_investment_run_id IS NOT NULL AND TRIM(pre_investment_run_id) <> ''
       GROUP BY pre_investment_run_id
     ) rel ON rel.pre_investment_run_id = scr.F_Id
     WHERE scr.pre_investment_project_id = ?
       AND scr.F_DeleteMark = 0
       AND scr.status = 'success'
       AND COALESCE(rel.ai_relation_count, 0) > 0
     ORDER BY scr.F_CreatorTime ASC, scr.F_Id ASC`,
    [pipId, pipId]
  );

  const runsAsc = runRows
    .filter((row) => row.pre_investment_run_id && String(row.pre_investment_run_id).trim())
    .map((row) => ({
      id: row.pre_investment_run_id,
      created_at: row.run_created_at,
      status: row.status,
      message: row.message,
      finished_at: row.finished_at,
      triggered_by_user_id: row.triggered_by_user_id,
      relation_count: Number(row.relation_count) || 0,
      ai_relation_count: Number(row.ai_relation_count) || 0,
    }))
    .filter(isEffectiveCompetitorRunVersion);

  return assignVersionLabels(runsAsc).reverse();
}

/** 当前有效批次：最近一次成功且含 AI 落库数据的 pre_investment_run_id */
async function getLatestRunIdForPreInvestmentProject(preInvestmentProjectId) {
  const pipId = String(preInvestmentProjectId || '').trim();
  if (!pipId) return null;

  const fromRunTable = await db.query(
    `SELECT scr.F_Id AS run_id
     FROM sourcing_pre_investment_competitor_run scr
     INNER JOIN sourcing_competitor_relation r
       ON r.pre_investment_run_id = scr.F_Id
       AND r.pre_investment_project_id = scr.pre_investment_project_id
       AND r.subject_type = 'pre_investment_project'
       AND r.F_DeleteMark = 0
       AND r.F_CreatorUserId IS NULL
       AND COALESCE(r.human_locked, 0) = 0
     WHERE scr.pre_investment_project_id = ?
       AND scr.F_DeleteMark = 0
       AND scr.status = 'success'
     ORDER BY scr.finished_at DESC, scr.F_CreatorTime DESC
     LIMIT 1`,
    [pipId]
  );
  if (fromRunTable.length) return fromRunTable[0].run_id;

  const rows = await db.query(
    `SELECT pre_investment_run_id AS run_id
     FROM sourcing_competitor_relation
     WHERE pre_investment_project_id = ? AND F_DeleteMark = 0
       AND subject_type = 'pre_investment_project'
       AND pre_investment_run_id IS NOT NULL AND TRIM(pre_investment_run_id) <> ''
       AND F_CreatorUserId IS NULL
       AND COALESCE(human_locked, 0) = 0
     ORDER BY F_CreatorTime DESC
     LIMIT 1`,
    [pipId]
  );
  return rows.length ? rows[0].run_id : null;
}

async function buildVersionLabelMapForPreInvestmentProject(preInvestmentProjectId) {
  const runs = await listPreInvestmentCompetitorRuns(preInvestmentProjectId);
  const map = new Map();
  for (const run of runs) {
    map.set(String(run.id), run.version_label);
  }
  return map;
}

module.exports = {
  parseYmdFromRunId,
  assignVersionLabels,
  isEffectiveCompetitorRunVersion,
  listInvestedEnterpriseCompetitorRuns,
  getLatestRunIdForInvestedEnterprise,
  buildVersionLabelMapForInvestedEnterprise,
  listPreInvestmentCompetitorRuns,
  getLatestRunIdForPreInvestmentProject,
  buildVersionLabelMapForPreInvestmentProject,
};
