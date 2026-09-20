/**
 * 最新版竞品 vs 上一版本：重复识别、三档排序。
 * 身份：优先统一社会信用代码，否则规范化企业名（去括号、繁简、分子公司后缀）。
 */
const db = require('../../db');
const { collectCompetitorLookupKeys } = require('./competitorCompanyMatch');
const {
  listInvestedEnterpriseCompetitorRuns,
  listPreInvestmentCompetitorRuns,
  getLatestRunIdForInvestedEnterprise,
  getLatestRunIdForPreInvestmentProject,
  getPreviousRunIdByVersionLabel,
} = require('./competitorRunVersionService');

function buildPrevLookupKeySet(rows) {
  const keys = new Set();
  for (const row of rows || []) {
    for (const k of collectCompetitorLookupKeys(row)) {
      if (k) keys.add(k);
    }
  }
  return keys;
}

function appearedInPrevVersion(row, prevKeys) {
  if (!prevKeys || !prevKeys.size) return false;
  for (const k of collectCompetitorLookupKeys(row)) {
    if (k && prevKeys.has(k)) return true;
  }
  return false;
}

function relationCreatedAt(row) {
  return String(row?.created_at || row?.F_CreatorTime || '');
}

function relationRunId(row) {
  return String(row?.run_id || row?.pre_investment_run_id || '').trim();
}

/**
 * 1 已勾选可比；2 非上轮重复；3 上轮重复且未勾选可比。
 * applyPrevRepeat=false 时退化为两档（历史版本）。
 */
function relationDisplayTier(row, applyPrevRepeat = true) {
  if (Number(row?.include_in_comparable) === 1) return 1;
  if (applyPrevRepeat && Number(row?.appeared_in_prev_version) === 1) return 3;
  return 2;
}

function isPrevRepeatFillRow(row) {
  return relationDisplayTier(row, true) === 3;
}

/** 与前端 competitorRelationColumns.sortRelationsForDisplay 保持一致 */
function sortRelationsForDisplay(list, { applyPrevRepeat = true } = {}) {
  return [...(list || [])].sort((a, b) => {
    const ta = relationDisplayTier(a, applyPrevRepeat);
    const tb = relationDisplayTier(b, applyPrevRepeat);
    if (ta !== tb) return ta - tb;
    const sa = Number(a.relevance_score) || 0;
    const sb = Number(b.relevance_score) || 0;
    if (sb !== sa) return sb - sa;
    return relationCreatedAt(b).localeCompare(relationCreatedAt(a));
  });
}

function sortExportRelationsByVersionThenDisplay(list, latestRunId) {
  const groups = [];
  const index = new Map();
  for (const rel of list || []) {
    const id = relationRunId(rel);
    if (!index.has(id)) {
      index.set(id, groups.length);
      groups.push({ id, rows: [] });
    }
    groups[index.get(id)].rows.push(rel);
  }
  const out = [];
  const latest = String(latestRunId || '').trim();
  for (const g of groups) {
    const applyPrevRepeat = !!(latest && g.id === latest);
    out.push(...sortRelationsForDisplay(g.rows, { applyPrevRepeat }));
  }
  return out;
}

async function loadPrevVersionLookupKeySet({ subjectType, subjectId, prevRunId }) {
  const runId = String(prevRunId || '').trim();
  const id = String(subjectId || '').trim();
  if (!runId || !id) return new Set();

  let rows;
  if (subjectType === 'pre_investment_project') {
    rows = await db.query(
      `SELECT competitor_display_name, unified_credit_code, competitor_weak_key
       FROM sourcing_competitor_relation
       WHERE pre_investment_project_id = ?
         AND subject_type = 'pre_investment_project'
         AND pre_investment_run_id = ?`,
      [id, runId]
    );
  } else {
    rows = await db.query(
      `SELECT competitor_display_name, unified_credit_code, competitor_weak_key
       FROM sourcing_competitor_relation
       WHERE invested_enterprise_id = ?
         AND run_id = ?
         AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)`,
      [id, runId]
    );
  }
  return buildPrevLookupKeySet(rows);
}

async function resolvePrevVersionContext({ subjectType, subjectId, latestRunId }) {
  const id = String(subjectId || '').trim();
  const latest = String(latestRunId || '').trim();
  if (!id || !latest) {
    return { prevRunId: null, prevKeys: new Set() };
  }
  const runs =
    subjectType === 'pre_investment_project'
      ? await listPreInvestmentCompetitorRuns(id)
      : await listInvestedEnterpriseCompetitorRuns(id);
  const prevRunId = getPreviousRunIdByVersionLabel(runs, latest);
  const prevKeys = await loadPrevVersionLookupKeySet({
    subjectType,
    subjectId: id,
    prevRunId,
  });
  return { prevRunId, prevKeys };
}

function markAppearedInPrevVersion(list, prevKeys, { shouldMark } = {}) {
  const mark = shouldMark !== false;
  return (list || []).map((row) => ({
    ...row,
    appeared_in_prev_version: mark && appearedInPrevVersion(row, prevKeys) ? 1 : 0,
  }));
}

/**
 * 列表接口：仅最新版打标；历史版一律 0。
 */
async function annotateLatestViewPrevRepeats({
  list,
  subjectType,
  subjectId,
  latestRunId,
  isHistoricalView,
}) {
  if (isHistoricalView) {
    return markAppearedInPrevVersion(list, new Set(), { shouldMark: false });
  }
  const { prevKeys } = await resolvePrevVersionContext({
    subjectType,
    subjectId,
    latestRunId,
  });
  return markAppearedInPrevVersion(list, prevKeys, { shouldMark: true });
}

/**
 * 导出：仅最新版三档排序 + 上轮重复填充标记；历史版两档且不标重复。
 * allBatches 时只给最新版分组打标，组内各自排序。
 */
async function decorateRelationsForExport({
  rels,
  subjectType,
  subjectId,
  allBatches,
  exportRunId,
}) {
  const id = String(subjectId || '').trim();
  const latestRunId =
    subjectType === 'pre_investment_project'
      ? await getLatestRunIdForPreInvestmentProject(id)
      : await getLatestRunIdForInvestedEnterprise(id);
  const exportingLatest =
    allBatches ||
    !!(exportRunId && latestRunId && String(exportRunId) === String(latestRunId));

  let prevKeys = new Set();
  if (exportingLatest) {
    const ctx = await resolvePrevVersionContext({
      subjectType,
      subjectId: id,
      latestRunId,
    });
    prevKeys = ctx.prevKeys;
  }

  const marked = (rels || []).map((rel) => {
    const relRun = relationRunId(rel);
    const shouldMark = allBatches
      ? !!(latestRunId && relRun && relRun === String(latestRunId))
      : exportingLatest;
    return {
      ...rel,
      appeared_in_prev_version: shouldMark && appearedInPrevVersion(rel, prevKeys) ? 1 : 0,
    };
  });

  if (allBatches) {
    return sortExportRelationsByVersionThenDisplay(marked, latestRunId);
  }
  return sortRelationsForDisplay(marked, { applyPrevRepeat: exportingLatest });
}

function excelFillRowsFromRels(rels) {
  const rows = [];
  (rels || []).forEach((rel, i) => {
    if (isPrevRepeatFillRow(rel)) rows.push(i + 2);
  });
  return rows;
}

module.exports = {
  buildPrevLookupKeySet,
  appearedInPrevVersion,
  relationDisplayTier,
  isPrevRepeatFillRow,
  sortRelationsForDisplay,
  sortExportRelationsByVersionThenDisplay,
  loadPrevVersionLookupKeySet,
  resolvePrevVersionContext,
  markAppearedInPrevVersion,
  annotateLatestViewPrevRepeats,
  decorateRelationsForExport,
  excelFillRowsFromRels,
};
