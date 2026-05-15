const xlsx = require('xlsx');
const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_PROJECT_SOURCING } = require('../enterpriseDataApp');
const { isInvestedEnterpriseProjectSourcingApp } = require('../applicationIdResolve');

const EXPORT_HEADERS = [
  '竞品名称',
  '统一社会信用代码',
  '等级',
  '综合分',
  '产品介绍',
  '企业标签',
  '子基金名称',
  '数据源',
  '融资金额',
  '落库时间',
];

const SOURCE_LABELS = {
  ipo_project: '底层',
  sourcing_financing_event: '融资',
  ai_web: '联网',
};

function sanitizeSheetName(name, used) {
  let s = String(name || '未命名')
    .replace(/[\\/?*[\]:]/g, '_')
    .trim()
    .slice(0, 31);
  if (!s) s = 'Sheet';
  let base = s;
  let n = 1;
  while (used.has(s)) {
    const suffix = `_${n}`;
    s = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(s);
  return s;
}

function formatSources(v) {
  if (!v) return '';
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (Array.isArray(arr)) return arr.map((x) => SOURCE_LABELS[x] || x).join('、');
  } catch {
    /* ignore */
  }
  return '';
}

function relationToRow(rel) {
  return {
    竞品名称: rel.competitor_display_name || '',
    统一社会信用代码: rel.unified_credit_code || '',
    等级: rel.confidence_grade || '',
    综合分: rel.relevance_score != null ? rel.relevance_score : '',
    产品介绍: rel.competitor_product_intro || '',
    企业标签: rel.competitor_tags_display || '',
    子基金名称: rel.sub_fund_names || '',
    数据源: formatSources(rel.data_sources_json),
    融资金额: rel.financing_amount_text || '',
    落库时间: rel.created_at ? String(rel.created_at).replace('T', ' ').slice(0, 19) : '',
  };
}

/**
 * @param {object} opts
 * @param {string[]} [opts.investedEnterpriseIds]
 * @param {boolean} [opts.exportAll]
 * @param {string[]} [opts.years] 项目编号前四位年度
 * @param {object} opts.psUser
 * @param {boolean} opts.isAdmin
 */
async function buildCompetitorRelationsExportWorkbook(opts) {
  const { investedEnterpriseIds = [], exportAll = false, years = [], psUser, isAdmin } = opts;
  const uid = psUser?.id ? String(psUser.id) : null;

  let ieRows = await db.query(
    `SELECT id, project_number, project_abbreviation, enterprise_full_name, creator_user_id,
            data_app_id, data_app_name, exit_status, delete_mark
     FROM invested_enterprises
     WHERE delete_mark = 0`
  );
  const filtered = [];
  for (const row of ieRows) {
    if (Number(row.delete_mark) !== 0) continue;
    if (String(row.exit_status || '').trim() === '已退出') continue;
    if (!(await isInvestedEnterpriseProjectSourcingApp(row))) continue;
    if (!isAdmin && String(row.creator_user_id) !== uid) continue;
    if (years.length) {
      const y = String(row.project_number || '').slice(0, 4);
      if (!years.includes(y)) continue;
    }
    if (!exportAll && investedEnterpriseIds.length) {
      if (!investedEnterpriseIds.includes(String(row.id))) continue;
    }
    filtered.push(row);
  }

  if (!exportAll && investedEnterpriseIds.length) {
    ieRows = investedEnterpriseIds
      .map((id) => filtered.find((r) => String(r.id) === String(id)))
      .filter(Boolean);
  } else {
    ieRows = filtered.sort((a, b) =>
      String(b.project_number || '').localeCompare(String(a.project_number || ''))
    );
  }

  const workbook = xlsx.utils.book_new();
  const usedNames = new Set();
  let sheetCount = 0;

  for (const ie of ieRows) {
    const rels = await db.query(
      `SELECT competitor_display_name, unified_credit_code, confidence_grade, relevance_score,
              competitor_product_intro, competitor_tags_display, sub_fund_names,
              data_sources_json, financing_amount_text, created_at
       FROM sourcing_competitor_relation
       WHERE invested_enterprise_id = ? AND delete_mark = 0
         AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
       ORDER BY relevance_score DESC, created_at DESC`,
      [ie.id]
    );
    const sheetLabel = sanitizeSheetName(ie.project_abbreviation || ie.enterprise_full_name || ie.id, usedNames);
    const data = rels.length ? rels.map(relationToRow) : [Object.fromEntries(EXPORT_HEADERS.map((h) => [h, '']))];
    const ws = xlsx.utils.json_to_sheet(data, { header: EXPORT_HEADERS });
    xlsx.utils.book_append_sheet(workbook, ws, sheetLabel);
    sheetCount += 1;
  }

  if (sheetCount === 0) {
    const ws = xlsx.utils.aoa_to_sheet([EXPORT_HEADERS, ['（无数据）']]);
    xlsx.utils.book_append_sheet(workbook, ws, '无数据');
  }

  return { workbook, sheetCount, enterpriseCount: ieRows.length };
}

async function exportCompetitorRelationsToBuffer(opts) {
  const { workbook } = await buildCompetitorRelationsExportWorkbook(opts);
  return xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

/** 可选年度列表（项目编号前四位） */
async function listInvestedEnterpriseYears(psUser, isAdmin) {
  const uid = psUser?.id ? String(psUser.id) : null;
  const rows = await db.query(
    `SELECT DISTINCT LEFT(project_number, 4) AS y
     FROM invested_enterprises
     WHERE delete_mark = 0 AND TRIM(COALESCE(exit_status,'')) <> '已退出'
       AND project_number IS NOT NULL AND LENGTH(TRIM(project_number)) >= 4
     ORDER BY y DESC`
  );
  const years = [];
  for (const r of rows) {
    const y = String(r.y || '').trim();
    if (/^\d{4}$/.test(y)) years.push(y);
  }
  if (!isAdmin && uid) {
    const scoped = await db.query(
      `SELECT DISTINCT LEFT(project_number, 4) AS y
       FROM invested_enterprises
       WHERE delete_mark = 0 AND creator_user_id = ?
         AND TRIM(COALESCE(exit_status,'')) <> '已退出'
         AND project_number IS NOT NULL AND LENGTH(TRIM(project_number)) >= 4
       ORDER BY y DESC`,
      [uid]
    );
    return scoped.map((r) => String(r.y)).filter((y) => /^\d{4}$/.test(y));
  }
  return years;
}

module.exports = {
  exportCompetitorRelationsToBuffer,
  listInvestedEnterpriseYears,
  EXPORT_HEADERS,
};
