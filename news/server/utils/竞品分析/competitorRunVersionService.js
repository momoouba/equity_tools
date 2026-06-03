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

/**
 * 版本列表：仅含该被投企业在 relation 中真实存在数据的 run_id（不含空跑/失败 run）。
 */
async function listInvestedEnterpriseCompetitorRuns(investedEnterpriseId) {
  const ieId = String(investedEnterpriseId || '').trim();
  if (!ieId) return [];

  const runRows = await db.query(
    `SELECT r.run_id AS id,
            MIN(r.created_at) AS first_relation_at,
            COUNT(*) AS relation_count,
            MAX(scr.created_at) AS run_created_at,
            MAX(scr.status) AS status,
            MAX(scr.message) AS message,
            MAX(scr.finished_at) AS finished_at,
            MAX(scr.triggered_by_user_id) AS triggered_by_user_id
     FROM sourcing_competitor_relation r
     LEFT JOIN sourcing_competitor_run scr ON scr.id = r.run_id AND scr.delete_mark = 0
     WHERE r.invested_enterprise_id = ?
       AND r.run_id IS NOT NULL AND TRIM(r.run_id) <> ''
       AND (r.subject_type = 'invested_enterprise' OR r.subject_type IS NULL)
     GROUP BY r.run_id
     ORDER BY COALESCE(MAX(scr.created_at), MIN(r.created_at)) ASC, r.run_id ASC`,
    [ieId]
  );

  const runsAsc = runRows
    .filter((row) => row.id && String(row.id).trim())
    .map((row) => ({
      id: row.id,
      created_at: row.run_created_at || row.first_relation_at,
      status: row.status,
      message: row.message,
      finished_at: row.finished_at,
      triggered_by_user_id: row.triggered_by_user_id,
      relation_count: Number(row.relation_count) || 0,
    }));

  return assignVersionLabels(runsAsc).reverse();
}

/** 当前有效批次（delete_mark=0 关系所属 run_id） */
async function getLatestRunIdForInvestedEnterprise(investedEnterpriseId) {
  const ieId = String(investedEnterpriseId || '').trim();
  if (!ieId) return null;
  const rows = await db.query(
    `SELECT run_id AS id
     FROM sourcing_competitor_relation
     WHERE invested_enterprise_id = ? AND delete_mark = 0
       AND run_id IS NOT NULL AND TRIM(run_id) <> ''
       AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
     ORDER BY created_at DESC
     LIMIT 1`,
    [ieId]
  );
  return rows.length ? rows[0].id : null;
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
 * 版本列表：仅含该投前项目在 relation 中真实存在数据的 pre_investment_run_id（不含空跑/失败 run）。
 */
async function listPreInvestmentCompetitorRuns(preInvestmentProjectId) {
  const pipId = String(preInvestmentProjectId || '').trim();
  if (!pipId) return [];

  const runRows = await db.query(
    `SELECT r.pre_investment_run_id AS id,
            MIN(r.created_at) AS first_relation_at,
            COUNT(*) AS relation_count,
            MAX(scr.created_at) AS run_created_at,
            MAX(scr.status) AS status,
            MAX(scr.message) AS message,
            MAX(scr.finished_at) AS finished_at,
            MAX(scr.triggered_by_user_id) AS triggered_by_user_id
     FROM sourcing_competitor_relation r
     LEFT JOIN sourcing_pre_investment_competitor_run scr
       ON scr.id = r.pre_investment_run_id AND scr.delete_mark = 0
     WHERE r.pre_investment_project_id = ?
       AND r.pre_investment_run_id IS NOT NULL AND TRIM(r.pre_investment_run_id) <> ''
       AND r.subject_type = 'pre_investment_project'
     GROUP BY r.pre_investment_run_id
     ORDER BY COALESCE(MAX(scr.created_at), MIN(r.created_at)) ASC, r.pre_investment_run_id ASC`,
    [pipId]
  );

  const runsAsc = runRows
    .filter((row) => row.id && String(row.id).trim())
    .map((row) => ({
      id: row.id,
      created_at: row.run_created_at || row.first_relation_at,
      status: row.status,
      message: row.message,
      finished_at: row.finished_at,
      triggered_by_user_id: row.triggered_by_user_id,
      relation_count: Number(row.relation_count) || 0,
    }));

  return assignVersionLabels(runsAsc).reverse();
}

/** 当前有效批次（delete_mark=0 关系所属 pre_investment_run_id） */
async function getLatestRunIdForPreInvestmentProject(preInvestmentProjectId) {
  const pipId = String(preInvestmentProjectId || '').trim();
  if (!pipId) return null;
  const rows = await db.query(
    `SELECT pre_investment_run_id AS id
     FROM sourcing_competitor_relation
     WHERE pre_investment_project_id = ? AND delete_mark = 0
       AND subject_type = 'pre_investment_project'
       AND pre_investment_run_id IS NOT NULL AND TRIM(pre_investment_run_id) <> ''
     ORDER BY created_at DESC
     LIMIT 1`,
    [pipId]
  );
  return rows.length ? rows[0].id : null;
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
  listInvestedEnterpriseCompetitorRuns,
  getLatestRunIdForInvestedEnterprise,
  buildVersionLabelMapForInvestedEnterprise,
  listPreInvestmentCompetitorRuns,
  getLatestRunIdForPreInvestmentProject,
  buildVersionLabelMapForPreInvestmentProject,
};
