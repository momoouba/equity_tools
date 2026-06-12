const xlsx = require('xlsx');
const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { isInvestedEnterpriseCompetitorAnalysisApp } = require('../applicationIdResolve');
const { buildVersionLabelMapForInvestedEnterprise, buildVersionLabelMapForPreInvestmentProject } = require('./competitorRunVersionService');

const EXPORT_HEADERS = [
  '竞品名称',
  '统一社会信用代码',
  '是否上市',
  '等级',
  '综合分',
  '产品介绍',
  '企业标签',
  '子基金名称',
  '数据源',
  '融资',
  '是否放入可比公司',
  '落库时间',
];

const EXPORT_HEADERS_ALL_BATCHES = ['版本号', ...EXPORT_HEADERS];

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

function relationToRow(rel, versionLabel) {
  const base = {
    竞品名称: rel.competitor_display_name || '',
    统一社会信用代码: rel.unified_credit_code || '',
    是否上市: Number(rel.is_listed) === 1 ? '是' : '否',
    等级: rel.confidence_grade || '',
    综合分: rel.relevance_score != null ? rel.relevance_score : '',
    产品介绍: rel.competitor_product_intro || '',
    企业标签: rel.competitor_tags_display || '',
    子基金名称: rel.sub_fund_names || '',
    数据源: formatSources(rel.data_sources_json),
    融资: rel.financing_history_text || rel.financing_amount_text || '',
    是否放入可比公司: Number(rel.include_in_comparable) === 1 ? '是' : '否',
    落库时间: rel.created_at ? String(rel.created_at).replace('T', ' ').slice(0, 19) : '',
  };
  if (versionLabel != null) {
    return { 版本号: versionLabel || '', ...base };
  }
  return base;
}

/**
 * @param {string} [opts.exportBatchMode] latest | all（all 仅被投多选导出）
 */
async function buildCompetitorRelationsExportWorkbook(opts) {
  const {
    investedEnterpriseIds = [],
    exportAll = false,
    exportBatchMode = 'latest',
    years = [],
    psUser,
    isAdmin,
  } = opts;
  const allBatches = exportBatchMode === 'all';
  const headers = allBatches ? EXPORT_HEADERS_ALL_BATCHES : EXPORT_HEADERS;
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
    if (!(await isInvestedEnterpriseCompetitorAnalysisApp(row))) continue;
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
    let rels;
    let versionMap = null;
    if (allBatches) {
      versionMap = await buildVersionLabelMapForInvestedEnterprise(ie.id);
      const relParams = [ie.id];
      let yearClause = '';
      if (years.length) {
        yearClause = ` AND YEAR(run.created_at) IN (${years.map(() => '?').join(',')})`;
        relParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT r.competitor_display_name, r.unified_credit_code, r.confidence_grade, r.relevance_score,
                r.competitor_product_intro, r.competitor_tags_display, r.sub_fund_names,
                r.data_sources_json, r.financing_amount_text, r.financing_history_text,
                r.is_listed, r.include_in_comparable, r.created_at, r.run_id,
                run.created_at AS run_created_at
         FROM sourcing_competitor_relation r
         INNER JOIN sourcing_competitor_run run ON run.id = r.run_id AND run.delete_mark = 0
         WHERE r.invested_enterprise_id = ?
           AND (r.subject_type = 'invested_enterprise' OR r.subject_type IS NULL)
           ${yearClause}
         ORDER BY run.created_at DESC, r.include_in_comparable DESC, r.relevance_score DESC, r.created_at DESC`,
        relParams
      );
    } else {
      const relParams = [ie.id];
      let yearClause = '';
      if (years.length) {
        yearClause = ` AND YEAR(created_at) IN (${years.map(() => '?').join(',')})`;
        relParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT competitor_display_name, unified_credit_code, confidence_grade, relevance_score,
                competitor_product_intro, competitor_tags_display, sub_fund_names,
                data_sources_json, financing_amount_text, financing_history_text,
                is_listed, include_in_comparable, created_at
         FROM sourcing_competitor_relation
         WHERE invested_enterprise_id = ? AND delete_mark = 0
           AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
           ${yearClause}
         ORDER BY include_in_comparable DESC, relevance_score DESC, created_at DESC`,
        relParams
      );
    }
    if (!rels.length) {
      if (exportAll) continue;
    }
    const sheetLabel = sanitizeSheetName(ie.project_abbreviation || ie.enterprise_full_name || ie.id, usedNames);
    const data = rels.length
      ? rels.map((rel) =>
          relationToRow(
            rel,
            allBatches ? versionMap.get(String(rel.run_id)) || '' : null
          )
        )
      : [Object.fromEntries(headers.map((h) => [h, '']))];
    const ws = xlsx.utils.json_to_sheet(data, { header: headers });
    xlsx.utils.book_append_sheet(workbook, ws, sheetLabel);
    sheetCount += 1;
  }

  if (sheetCount === 0) {
    const ws = xlsx.utils.aoa_to_sheet([headers, ['（无数据）']]);
    xlsx.utils.book_append_sheet(workbook, ws, '无数据');
  }

  return { workbook, sheetCount, enterpriseCount: sheetCount };
}

/** 可选年度列表（被投项目编号前四位） */
async function listInvestedEnterpriseYears(psUser, isAdmin) {
  const uid = psUser?.id ? String(psUser.id) : null;
  const baseWhere = `delete_mark = 0 AND TRIM(COALESCE(exit_status,'')) <> '已退出'
    AND project_number IS NOT NULL AND LENGTH(TRIM(project_number)) >= 4`;
  const sql = isAdmin || !uid
    ? `SELECT DISTINCT LEFT(project_number, 4) AS y FROM invested_enterprises WHERE ${baseWhere} ORDER BY y DESC`
    : `SELECT DISTINCT LEFT(project_number, 4) AS y FROM invested_enterprises WHERE ${baseWhere} AND creator_user_id = ? ORDER BY y DESC`;
  const params = (!isAdmin && uid) ? [uid] : [];
  const rows = await db.query(sql, params);
  return rows.map((r) => String(r.y || '').trim()).filter((y) => /^\d{4}$/.test(y));
}

function preProjectYear(projectNo) {
  const s = String(projectNo || '').trim();
  if (s.length >= 5 && s[0] === 'P') return s.slice(1, 5);
  return s.slice(0, 4);
}

/**
 * @param {object} opts
 * @param {string[]} [opts.preInvestmentProjectIds]
 * @param {boolean} [opts.exportAll]
 * @param {string[]} [opts.years] 项目编号 P 后四位年度
 */
async function buildPreInvestmentCompetitorExportWorkbook(opts) {
  const {
    preInvestmentProjectIds = [],
    exportAll = false,
    exportBatchMode = 'latest',
    years = [],
    psUser,
    isAdmin,
  } = opts;
  const allBatches = exportBatchMode === 'all';
  const headers = allBatches ? EXPORT_HEADERS_ALL_BATCHES : EXPORT_HEADERS;
  const uid = psUser?.id ? String(psUser.id) : null;

  let pipRows = await db.query(
    `SELECT id, project_no, enterprise_full_name, project_abbreviation, creator_user_id
     FROM pre_investment_project
     WHERE delete_mark = 0`
  );
  const filtered = [];
  for (const row of pipRows) {
    if (!isAdmin && String(row.creator_user_id) !== uid) continue;
    if (years.length) {
      const y = preProjectYear(row.project_no);
      if (!years.includes(y)) continue;
    }
    if (!exportAll && preInvestmentProjectIds.length) {
      if (!preInvestmentProjectIds.includes(String(row.id))) continue;
    }
    filtered.push(row);
  }

  if (!exportAll && preInvestmentProjectIds.length) {
    pipRows = preInvestmentProjectIds
      .map((id) => filtered.find((r) => String(r.id) === String(id)))
      .filter(Boolean);
  } else {
    pipRows = filtered.sort((a, b) => String(b.project_no || '').localeCompare(String(a.project_no || '')));
  }

  const workbook = xlsx.utils.book_new();
  const usedNames = new Set();
  let sheetCount = 0;

  for (const pip of pipRows) {
    let rels;
    let versionMap = null;
    if (allBatches) {
      versionMap = await buildVersionLabelMapForPreInvestmentProject(pip.id);
      const pipRelParams = [pip.id];
      let pipYearClause = '';
      if (years.length) {
        pipYearClause = ` AND YEAR(run.created_at) IN (${years.map(() => '?').join(',')})`;
        pipRelParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT r.competitor_display_name, r.unified_credit_code, r.confidence_grade, r.relevance_score,
                r.competitor_product_intro, r.competitor_tags_display, r.sub_fund_names,
                r.data_sources_json, r.financing_amount_text, r.financing_history_text,
                r.is_listed, r.include_in_comparable, r.created_at, r.pre_investment_run_id,
                run.created_at AS run_created_at
         FROM sourcing_competitor_relation r
         INNER JOIN sourcing_pre_investment_competitor_run run
           ON run.id = r.pre_investment_run_id AND run.delete_mark = 0
         WHERE r.pre_investment_project_id = ?
           AND r.subject_type = 'pre_investment_project'
           AND r.pre_investment_run_id IS NOT NULL AND TRIM(r.pre_investment_run_id) <> ''
           ${pipYearClause}
         ORDER BY run.created_at DESC, r.include_in_comparable DESC, r.relevance_score DESC, r.created_at DESC`,
        pipRelParams
      );
    } else {
      const pipRelParams = [pip.id];
      let pipYearClause = '';
      if (years.length) {
        pipYearClause = ` AND YEAR(created_at) IN (${years.map(() => '?').join(',')})`;
        pipRelParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT competitor_display_name, unified_credit_code, confidence_grade, relevance_score,
                competitor_product_intro, competitor_tags_display, sub_fund_names,
                data_sources_json, financing_amount_text, financing_history_text,
                is_listed, include_in_comparable, created_at
         FROM sourcing_competitor_relation
         WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND delete_mark = 0
           ${pipYearClause}
         ORDER BY include_in_comparable DESC, relevance_score DESC, created_at DESC`,
        pipRelParams
      );
    }
    if (!rels.length && exportAll) continue;
    const sheetLabel = sanitizeSheetName(
      pip.project_abbreviation || pip.enterprise_full_name || pip.project_no || pip.id,
      usedNames
    );
    const data = rels.length
      ? rels.map((rel) =>
          relationToRow(
            rel,
            allBatches ? versionMap.get(String(rel.pre_investment_run_id)) || '' : null
          )
        )
      : [Object.fromEntries(headers.map((h) => [h, '']))];
    const ws = xlsx.utils.json_to_sheet(data, { header: headers });
    xlsx.utils.book_append_sheet(workbook, ws, sheetLabel);
    sheetCount += 1;
  }

  if (sheetCount === 0) {
    const ws = xlsx.utils.aoa_to_sheet([EXPORT_HEADERS, ['（无数据）']]);
    xlsx.utils.book_append_sheet(workbook, ws, '无数据');
  }

  return { workbook, sheetCount, enterpriseCount: pipRows.length };
}

async function exportCompetitorRelationsToBuffer(opts) {
  const subjectType = opts.subjectType || 'invested_enterprise';
  const { workbook } =
    subjectType === 'pre_investment_project'
      ? await buildPreInvestmentCompetitorExportWorkbook(opts)
      : await buildCompetitorRelationsExportWorkbook(opts);
  return xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

/** 投前项目编号 P+年度 可选列表 */
// fix #15: 非管理员仅需一次限定查询，避免先全量查询再丢弃结果
async function listPreInvestmentYears(psUser, isAdmin) {
  const uid = psUser?.id ? String(psUser.id) : null;
  const baseWhere = `delete_mark = 0 AND project_no IS NOT NULL AND LENGTH(TRIM(project_no)) >= 5 AND project_no LIKE 'P%'`;
  const sql = isAdmin || !uid
    ? `SELECT DISTINCT SUBSTRING(project_no, 2, 4) AS y FROM pre_investment_project WHERE ${baseWhere} ORDER BY y DESC`
    : `SELECT DISTINCT SUBSTRING(project_no, 2, 4) AS y FROM pre_investment_project WHERE ${baseWhere} AND creator_user_id = ? ORDER BY y DESC`;
  const params = (!isAdmin && uid) ? [uid] : [];
  const rows = await db.query(sql, params);
  return rows.map((r) => String(r.y || '').trim()).filter((y) => /^\d{4}$/.test(y));
}

module.exports = {
  exportCompetitorRelationsToBuffer,
  listInvestedEnterpriseYears,
  listPreInvestmentYears,
  buildPreInvestmentCompetitorExportWorkbook,
  EXPORT_HEADERS,
  EXPORT_HEADERS_ALL_BATCHES,
};
