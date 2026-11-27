'use strict';

const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const {
  DATA_APP_COMPETITOR_ANALYSIS,
  DATA_APP_PROJECT_VALUATION,
  investedEnterpriseAppMatchClause,
} = require('../enterpriseDataApp');
const { APP_NAME_PROJECT_VALUATION, PROJECT_VALUATION_APP_ID, CASE_TYPE_PRE, CASE_TYPE_POST } = require('../valuation/constants');
const { previewComparablesFromCompetitor } = require('../valuation/comparableService');
const { loadComparison } = require('../valuation/workspaceStore');
const {
  httpError,
  numOrNull,
  toPublicComparable,
  toForecastLines,
  toConclusion,
  isDraftVersionId,
  COMPARABLE_NOTICE,
  FORECAST_NOTICE,
} = require('./contract');

function likeTerm(keyword) {
  const s = String(keyword || '').trim().slice(0, 100);
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function fmtTs(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v).replace('T', ' ').slice(0, 19);
}

async function competitorAppClause(alias) {
  const appId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  return investedEnterpriseAppMatchClause(alias, appId, DATA_APP_COMPETITOR_ANALYSIS);
}

async function valuationAppClause(alias) {
  const appId = (await getApplicationIdByAppName(APP_NAME_PROJECT_VALUATION)) || PROJECT_VALUATION_APP_ID;
  return investedEnterpriseAppMatchClause(alias, appId, DATA_APP_PROJECT_VALUATION);
}

function firstBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row[key] || '');
    if (!id || map.has(id)) continue;
    map.set(id, row);
  }
  return map;
}

async function latestRuns(stage, ids) {
  if (!ids.length) return new Map();
  const sql = stage === 'pre'
    ? `SELECT pre_investment_project_id AS subject_id, F_Id AS run_id, finished_at
       FROM sourcing_pre_investment_competitor_run
       WHERE F_DeleteMark = 0 AND status = 'success' AND pre_investment_project_id IN (?)
       ORDER BY F_CreatorTime DESC, F_Id DESC`
    : `SELECT invested_enterprise_id AS subject_id, F_Id AS run_id, finished_at
       FROM sourcing_competitor_run
       WHERE F_DeleteMark = 0 AND status = 'success' AND invested_enterprise_id IN (?)
       ORDER BY F_CreatorTime DESC, F_Id DESC`;
  const rows = await db.query(sql, [ids]);
  return firstBy(rows, 'subject_id');
}

async function latestVersions(caseIds) {
  if (!caseIds.length) return new Map();
  const rows = await db.query(
    `SELECT case_id, F_Id AS version_id, version_no
     FROM valuation_version
     WHERE F_DeleteMark = 0 AND case_id IN (?)
     ORDER BY version_no DESC, F_Id DESC`,
    [caseIds]
  );
  return firstBy(rows, 'case_id');
}

async function preCases(ids) {
  if (!ids.length) return new Map();
  const rows = await db.query(
    `SELECT vp.competitor_pre_project_id AS subject_id, c.F_Id AS case_id
     FROM valuation_pre_project vp
     INNER JOIN valuation_case c
       ON c.pre_project_id = vp.F_Id AND c.F_DeleteMark = 0 AND c.case_type = ?
     WHERE vp.F_DeleteMark = 0 AND vp.competitor_pre_project_id IN (?)
     ORDER BY c.F_LastModifyTime DESC, c.F_Id DESC`,
    [CASE_TYPE_PRE, ids]
  );
  return firstBy(rows, 'subject_id');
}

async function fillPreCasesByCredit(rows, cases) {
  const missing = rows.filter((row) => !cases.has(String(row.id)) && String(row.unified_credit_code || '').trim());
  if (!missing.length) return;
  const credits = [...new Set(missing.map((row) => String(row.unified_credit_code).trim().toUpperCase()))];
  const found = await db.query(
    `SELECT UPPER(REPLACE(REPLACE(TRIM(IFNULL(vp.unified_credit_code,'')),' ',''),'　','')) AS credit,
            c.F_Id AS case_id
     FROM valuation_pre_project vp
     INNER JOIN valuation_case c
       ON c.pre_project_id = vp.F_Id AND c.F_DeleteMark = 0 AND c.case_type = ?
     WHERE vp.F_DeleteMark = 0
       AND UPPER(REPLACE(REPLACE(TRIM(IFNULL(vp.unified_credit_code,'')),' ',''),'　','')) IN (?)
     ORDER BY c.F_LastModifyTime DESC, c.F_Id DESC`,
    [CASE_TYPE_PRE, credits]
  );
  const byCredit = firstBy(found, 'credit');
  for (const row of missing) {
    const hit = byCredit.get(String(row.unified_credit_code).trim().toUpperCase());
    if (hit) cases.set(String(row.id), { case_id: hit.case_id });
  }
}

async function postCases(rows) {
  const ids = rows.map((row) => String(row.id));
  const credits = rows.map((row) => String(row.unified_credit_code || '').trim()).filter(Boolean);
  if (!ids.length) return new Map();
  const app = await valuationAppClause('ie');
  const creditSql = credits.length
    ? `OR UPPER(REPLACE(REPLACE(TRIM(IFNULL(ie.unified_credit_code,'')),' ',''),'　','')) IN (${credits.map(() => '?').join(',')})`
    : '';
  const creditParams = credits.map((code) => code.toUpperCase());
  const found = await db.query(
    `SELECT c.F_Id AS case_id, c.invested_enterprise_id, ie.unified_credit_code
     FROM valuation_case c
     INNER JOIN invested_enterprises ie ON ie.F_Id = c.invested_enterprise_id AND ie.F_DeleteMark = 0
     WHERE c.F_DeleteMark = 0 AND c.case_type = ? AND ${app.sql}
       AND (c.invested_enterprise_id IN (?) ${creditSql})
     ORDER BY c.F_LastModifyTime DESC, c.F_Id DESC`,
    [CASE_TYPE_POST, ...app.params, ids, ...creditParams]
  );
  const byId = new Map();
  const byCredit = new Map();
  for (const row of found) {
    const ieId = String(row.invested_enterprise_id || '');
    const credit = String(row.unified_credit_code || '').trim().toUpperCase();
    if (ieId && !byId.has(ieId)) byId.set(ieId, row.case_id);
    if (credit && !byCredit.has(credit)) byCredit.set(credit, row.case_id);
  }
  const out = new Map();
  for (const row of rows) {
    const id = String(row.id);
    const credit = String(row.unified_credit_code || '').trim().toUpperCase();
    const caseId = byId.get(id) || (credit ? byCredit.get(credit) : null) || null;
    if (caseId) out.set(id, { case_id: caseId });
  }
  return out;
}

function publicSubject(stage, row, run, caseRow, version) {
  return {
    stage,
    id: String(row.id),
    name: row.enterprise_full_name || '',
    project_abbreviation: row.project_abbreviation || null,
    unified_credit_code: row.unified_credit_code || null,
    competitor_run_id: run?.run_id ? String(run.run_id) : null,
    competitor_run_finished_at: fmtTs(run?.finished_at),
    valuation_case_id: caseRow?.case_id ? String(caseRow.case_id) : null,
    latest_version_id: version?.version_id ? String(version.version_id) : null,
    latest_version_no: version?.version_no == null ? null : numOrNull(version.version_no),
  };
}

async function listSubjects({ stage, keyword, page, pageSize }) {
  const like = likeTerm(keyword);
  const offset = (page - 1) * pageSize;
  let total = 0;
  let rows = [];
  if (stage === 'pre') {
    const where = ['F_DeleteMark = 0'];
    const params = [];
    if (like) {
      where.push('(enterprise_full_name LIKE ? ESCAPE \'\\\\\' OR project_abbreviation LIKE ? ESCAPE \'\\\\\' OR project_no LIKE ? ESCAPE \'\\\\\' OR unified_credit_code LIKE ? ESCAPE \'\\\\\')');
      params.push(like, like, like, like);
    }
    const whereSql = where.join(' AND ');
    const countRows = await db.query(`SELECT COUNT(*) AS c FROM pre_investment_project WHERE ${whereSql}`, params);
    total = Number(countRows[0]?.c || 0);
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, unified_credit_code
       FROM pre_investment_project
       WHERE ${whereSql}
       ORDER BY F_LastModifyTime DESC, F_Id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
  } else {
    const app = await competitorAppClause('');
    const where = ['F_DeleteMark = 0', app.sql, "(TRIM(COALESCE(entity_type, '')) = '被投企业' OR TRIM(COALESCE(entity_type, '')) = '')"];
    const params = [...app.params];
    if (like) {
      where.push('(enterprise_full_name LIKE ? ESCAPE \'\\\\\' OR project_abbreviation LIKE ? ESCAPE \'\\\\\' OR project_number LIKE ? ESCAPE \'\\\\\' OR unified_credit_code LIKE ? ESCAPE \'\\\\\')');
      params.push(like, like, like, like);
    }
    const whereSql = where.join(' AND ');
    const countRows = await db.query(`SELECT COUNT(*) AS c FROM invested_enterprises WHERE ${whereSql}`, params);
    total = Number(countRows[0]?.c || 0);
    rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, unified_credit_code
       FROM invested_enterprises
       WHERE ${whereSql}
       ORDER BY F_LastModifyTime DESC, F_Id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
  }
  const ids = rows.map((row) => String(row.id));
  const runs = await latestRuns(stage, ids);
  const cases = stage === 'pre' ? await preCases(ids) : await postCases(rows);
  if (stage === 'pre') await fillPreCasesByCredit(rows, cases);
  const caseIds = [...cases.values()].map((row) => String(row.case_id)).filter(Boolean);
  const versions = await latestVersions(caseIds);
  const list = rows.map((row) => {
    const caseRow = cases.get(String(row.id));
    const version = caseRow ? versions.get(String(caseRow.case_id)) : null;
    return publicSubject(stage, row, runs.get(String(row.id)), caseRow, version);
  });
  return { list, total, page, pageSize, stage };
}

async function loadSubject(stage, id) {
  if (stage === 'pre') {
    const rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code
       FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }
  const app = await competitorAppClause('');
  const rows = await db.query(
    `SELECT F_Id AS id, enterprise_full_name, unified_credit_code
     FROM invested_enterprises
     WHERE F_Id = ? AND F_DeleteMark = 0 AND ${app.sql}
       AND (TRIM(COALESCE(entity_type, '')) = '被投企业' OR TRIM(COALESCE(entity_type, '')) = '')
     LIMIT 1`,
    [id, ...app.params]
  );
  return rows[0] || null;
}

async function runSubjectId(stage, runId) {
  if (!runId) return null;
  const sql = stage === 'pre'
    ? 'SELECT pre_investment_project_id AS id FROM sourcing_pre_investment_competitor_run WHERE F_Id = ? LIMIT 1'
    : 'SELECT invested_enterprise_id AS id FROM sourcing_competitor_run WHERE F_Id = ? LIMIT 1';
  const rows = await db.query(sql, [runId]);
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function getComparables(stage, id) {
  const subject = await loadSubject(stage, id);
  if (!subject) throw httpError('记录不存在', 404);
  const preview = await previewComparablesFromCompetitor({
    caseType: stage === 'pre' ? CASE_TYPE_PRE : CASE_TYPE_POST,
    investedEnterpriseId: stage === 'post' ? subject.id : null,
    competitorPreProjectId: stage === 'pre' ? subject.id : null,
    creditCode: subject.unified_credit_code,
    fullName: subject.enterprise_full_name,
  });
  const runId = preview.run?.run_id ? String(preview.run.run_id) : null;
  return {
    source: 'system_run',
    stage,
    subject_id: String(subject.id),
    name: subject.enterprise_full_name || '',
    unified_credit_code: subject.unified_credit_code || null,
    run_id: runId,
    run_subject_id: await runSubjectId(stage, runId),
    message: preview.message || null,
    notice: COMPARABLE_NOTICE,
    list: (preview.list || []).map(toPublicComparable),
  };
}

async function getForecast(caseId, versionId) {
  if (versionId && isDraftVersionId(versionId)) {
    throw httpError('不返回草稿', 400);
  }
  const cases = await db.query(
    `SELECT F_Id AS id, subject_display_name
     FROM valuation_case WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [caseId]
  );
  if (!cases.length) throw httpError('案件不存在', 404);
  const params = [caseId];
  let versionSql = `SELECT F_Id AS id, version_no, remark, F_CreatorTime AS saved_at
     FROM valuation_version
     WHERE case_id = ? AND F_DeleteMark = 0`;
  if (versionId) {
    versionSql += ' AND F_Id = ?';
    params.push(versionId);
  }
  versionSql += ' ORDER BY version_no DESC, F_Id DESC LIMIT 1';
  const versions = await db.query(versionSql, params);
  if (versionId && !versions.length) throw httpError('版本不存在', 404);
  const version = versions[0] || null;
  if (!version) {
    return {
      case_id: String(cases[0].id),
      subject_name: cases[0].subject_display_name || '',
      version: null,
      money_unit: 'yuan',
      revenue_growth_unit: 'ratio',
      lines: [],
      conclusion: null,
      message: '尚未保存估值版本',
      notice: FORECAST_NOTICE,
    };
  }
  const [plRows, comparison] = await Promise.all([
    db.query(
      `SELECT fiscal_year, revenue, cogs, gross_profit, selling, admin, rd,
              operating_profit, net_income, revenue_growth
       FROM valuation_forecast_pl_line
       WHERE case_id = ? AND version_id = ?
       ORDER BY line_no ASC`,
      [cases[0].id, version.id]
    ),
    loadComparison(cases[0].id, version.id),
  ]);
  const lines = toForecastLines(plRows);
  return {
    case_id: String(cases[0].id),
    subject_name: cases[0].subject_display_name || '',
    version: {
      id: String(version.id),
      version_no: numOrNull(version.version_no),
      remark: version.remark || null,
      saved_at: fmtTs(version.saved_at),
    },
    money_unit: 'yuan',
    revenue_growth_unit: 'ratio',
    lines,
    conclusion: toConclusion(comparison),
    message: lines.length ? null : '该版本没有盈利预测快照',
    notice: FORECAST_NOTICE,
  };
}

module.exports = {
  listSubjects,
  getComparables,
  getForecast,
};
