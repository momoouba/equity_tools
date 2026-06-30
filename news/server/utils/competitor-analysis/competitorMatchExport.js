const xlsx = require('xlsx');
const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { isInvestedEnterpriseCompetitorAnalysisApp } = require('../applicationIdResolve');
const { buildVersionLabelMapForInvestedEnterprise, buildVersionLabelMapForPreInvestmentProject } = require('./competitorRunVersionService');
const { formatFinancingDate } = require('./competitorFinancingResolve');

const EXPORT_HEADERS = [
  '竞品名称',
  '统一社会信用代码',
  '是否上市',
  '等级',
  '竞品类型',
  '综合分',
  '判断依据',
  '证据可信',
  '待复核',
  '来源覆盖分',
  '新鲜度分',
  '一致性分',
  '判断强度分',
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
  user_added: '用户新增',
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

const COMPETITOR_TYPE_LABELS = {
  direct: '直接竞品',
  indirect: '间接竞品',
  substitute: '替代品',
  same_track: '同赛道',
  upstream_downstream: '上下游',
  not_competitor: '非竞品',
};

function parseJsonField(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

/** 导出用日期：统一 YYYY-MM-DD（兼容 Date / ISO / MySQL 字符串） */
function formatExportYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatExportYmd(d);
  return s;
}

/** 融资历史多行文本：每行首段日期规范为 YYYY-MM-DD */
function normalizeFinancingLineDate(prefix) {
  const s = String(prefix || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, '0');
    const day = m[3] != null && m[3] !== '' ? String(m[3]).padStart(2, '0') : '01';
    return `${y}-${mo}-${day}`;
  }
  const ymd = formatFinancingDate(s);
  return ymd && ymd !== '【无】' ? ymd : s;
}

function formatFinancingExportText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const t = String(line).trim();
      if (!t) return '';
      const m = t.match(/^(\d{4}-\d{1,2}-\d{0,2})(.*)$/);
      if (!m) return t;
      const ymd = normalizeFinancingLineDate(m[1]);
      const rest = m[2] || '';
      return `${ymd}${rest}`;
    })
    .filter(Boolean)
    .join('\n');
}

function resolveEvidenceBreakdown(rel) {
  const direct = parseJsonField(rel.evidence_breakdown_json);
  if (direct && typeof direct === 'object') return direct;
  const scoreBd = parseJsonField(rel.score_breakdown_json);
  if (scoreBd?.evidence_breakdown && typeof scoreBd.evidence_breakdown === 'object') {
    return scoreBd.evidence_breakdown;
  }
  return null;
}

function resolveEvidenceConfidence(rel, breakdown) {
  if (rel.evidence_confidence != null && rel.evidence_confidence !== '') {
    return rel.evidence_confidence;
  }
  const scoreBd = parseJsonField(rel.score_breakdown_json);
  if (scoreBd?.evidence_confidence != null) return scoreBd.evidence_confidence;
  if (breakdown && breakdown.source_coverage_score != null) {
    return Math.round(
      (Number(breakdown.source_coverage_score) || 0) * 0.35 +
        (Number(breakdown.freshness_score) || 0) * 0.3 +
        (Number(breakdown.consistency_score) || 0) * 0.25 +
        (Number(breakdown.judgment_strength_score) || 0) * 0.1
    );
  }
  return '';
}

function resolveNeedsReview(rel, breakdown) {
  if (rel.needs_review != null && rel.needs_review !== '') {
    return Number(rel.needs_review) === 1 ? '是' : '否';
  }
  const scoreBd = parseJsonField(rel.score_breakdown_json);
  if (scoreBd?.needs_review != null) {
    return Number(scoreBd.needs_review) === 1 ? '是' : '否';
  }
  const conf = Number(resolveEvidenceConfidence(rel, breakdown));
  if (Number.isFinite(conf) && conf < 60) return '是';
  return '否';
}

function relationToRow(rel, versionLabel) {
  const bd = resolveEvidenceBreakdown(rel);
  const financingRaw = rel.financing_history_text || rel.financing_amount_text || '';
  const base = {
    竞品名称: rel.competitor_display_name || '',
    统一社会信用代码: rel.unified_credit_code || '',
    是否上市: Number(rel.is_listed) === 1 ? '是' : '否',
    等级: rel.confidence_grade || '',
    竞品类型: COMPETITOR_TYPE_LABELS[rel.competitor_type] || rel.competitor_type || '',
    综合分: rel.relevance_score != null ? rel.relevance_score : '',
    判断依据: rel.evidence_summary || '',
    证据可信: resolveEvidenceConfidence(rel, bd),
    待复核: resolveNeedsReview(rel, bd),
    来源覆盖分: bd?.source_coverage_score ?? '',
    新鲜度分: bd?.freshness_score ?? '',
    一致性分: bd?.consistency_score ?? '',
    判断强度分: bd?.judgment_strength_score ?? '',
    产品介绍: rel.competitor_product_intro || '',
    企业标签: rel.competitor_tags_display || '',
    子基金名称: rel.sub_fund_names || '',
    数据源: formatSources(rel.data_sources_json),
    融资: formatFinancingExportText(financingRaw),
    是否放入可比公司: Number(rel.include_in_comparable) === 1 ? '是' : '否',
    落库时间: formatExportYmd(rel.F_CreatorTime),
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
    `SELECT F_Id, project_number, project_abbreviation, enterprise_full_name, F_CreatorUserId,
            data_app_id, data_app_name, exit_status, F_DeleteMark
     FROM invested_enterprises
     WHERE F_DeleteMark = 0`
  );
  const filtered = [];
  for (const row of ieRows) {
    if (Number(row.F_DeleteMark) !== 0) continue;
    if (String(row.exit_status || '').trim() === '已退出') continue;
    if (!(await isInvestedEnterpriseCompetitorAnalysisApp(row))) continue;
    if (!isAdmin && String(row.F_CreatorUserId) !== uid) continue;
    if (years.length) {
      const y = String(row.project_number || '').slice(0, 4);
      if (!years.includes(y)) continue;
    }
    if (!exportAll && investedEnterpriseIds.length) {
      if (!investedEnterpriseIds.includes(String(row.F_Id))) continue;
    }
    filtered.push(row);
  }

  if (!exportAll && investedEnterpriseIds.length) {
    ieRows = investedEnterpriseIds
      .map((id) => filtered.find((r) => String(r.F_Id) === String(id)))
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
      versionMap = await buildVersionLabelMapForInvestedEnterprise(ie.F_Id);
      const relParams = [ie.F_Id];
      let yearClause = '';
      if (years.length) {
        yearClause = ` AND YEAR(run.F_CreatorTime) IN (${years.map(() => '?').join(',')})`;
        relParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT r.competitor_display_name, r.unified_credit_code, r.confidence_grade, r.relevance_score,
                r.competitor_type, r.evidence_summary, r.evidence_confidence, r.needs_review,
                r.evidence_breakdown_json, r.score_breakdown_json,
                r.competitor_product_intro, r.competitor_tags_display, r.sub_fund_names,
                r.data_sources_json, r.financing_amount_text, r.financing_history_text,
                r.is_listed, r.include_in_comparable, r.F_CreatorTime, r.run_id,
                run.F_CreatorTime AS run_created_at
         FROM sourcing_competitor_relation r
         INNER JOIN sourcing_competitor_run run ON run.F_Id = r.run_id AND run.F_DeleteMark = 0
         WHERE r.invested_enterprise_id = ?
           AND (r.subject_type = 'invested_enterprise' OR r.subject_type IS NULL)
           ${yearClause}
         ORDER BY run.F_CreatorTime DESC, r.include_in_comparable DESC, r.relevance_score DESC, r.F_CreatorTime DESC`,
        relParams
      );
    } else {
      const relParams = [ie.F_Id];
      let yearClause = '';
      if (years.length) {
        yearClause = ` AND YEAR(F_CreatorTime) IN (${years.map(() => '?').join(',')})`;
        relParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT competitor_display_name, unified_credit_code, confidence_grade, relevance_score,
                competitor_type, evidence_summary, evidence_confidence, needs_review,
                evidence_breakdown_json, score_breakdown_json,
                competitor_product_intro, competitor_tags_display, sub_fund_names,
                data_sources_json, financing_amount_text, financing_history_text,
                is_listed, include_in_comparable, F_CreatorTime
         FROM sourcing_competitor_relation
         WHERE invested_enterprise_id = ? AND F_DeleteMark = 0
           AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
           ${yearClause}
         ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC`,
        relParams
      );
    }
    if (!rels.length) {
      if (exportAll) continue;
    }
    const sheetLabel = sanitizeSheetName(ie.project_abbreviation || ie.enterprise_full_name || ie.F_Id, usedNames);
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
  const baseWhere = `F_DeleteMark = 0 AND TRIM(COALESCE(exit_status,'')) <> '已退出'
    AND project_number IS NOT NULL AND LENGTH(TRIM(project_number)) >= 4`;
  const sql = isAdmin || !uid
    ? `SELECT DISTINCT LEFT(project_number, 4) AS y FROM invested_enterprises WHERE ${baseWhere} ORDER BY y DESC`
    : `SELECT DISTINCT LEFT(project_number, 4) AS y FROM invested_enterprises WHERE ${baseWhere} AND F_CreatorUserId = ? ORDER BY y DESC`;
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
    `SELECT F_Id, project_no, enterprise_full_name, project_abbreviation, F_CreatorUserId
     FROM pre_investment_project
     WHERE F_DeleteMark = 0`
  );
  const filtered = [];
  for (const row of pipRows) {
    if (!isAdmin && String(row.F_CreatorUserId) !== uid) continue;
    if (years.length) {
      const y = preProjectYear(row.project_no);
      if (!years.includes(y)) continue;
    }
    if (!exportAll && preInvestmentProjectIds.length) {
      if (!preInvestmentProjectIds.includes(String(row.F_Id))) continue;
    }
    filtered.push(row);
  }

  if (!exportAll && preInvestmentProjectIds.length) {
    pipRows = preInvestmentProjectIds
      .map((id) => filtered.find((r) => String(r.F_Id) === String(id)))
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
      versionMap = await buildVersionLabelMapForPreInvestmentProject(pip.F_Id);
      const pipRelParams = [pip.F_Id];
      let pipYearClause = '';
      if (years.length) {
        pipYearClause = ` AND YEAR(run.F_CreatorTime) IN (${years.map(() => '?').join(',')})`;
        pipRelParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT r.competitor_display_name, r.unified_credit_code, r.confidence_grade, r.relevance_score,
                r.competitor_type, r.evidence_summary, r.evidence_confidence, r.needs_review,
                r.evidence_breakdown_json, r.score_breakdown_json,
                r.competitor_product_intro, r.competitor_tags_display, r.sub_fund_names,
                r.data_sources_json, r.financing_amount_text, r.financing_history_text,
                r.is_listed, r.include_in_comparable, r.F_CreatorTime, r.pre_investment_run_id,
                run.F_CreatorTime AS run_created_at
         FROM sourcing_competitor_relation r
         INNER JOIN sourcing_pre_investment_competitor_run run
           ON run.F_Id = r.pre_investment_run_id AND run.F_DeleteMark = 0
         WHERE r.pre_investment_project_id = ?
           AND r.subject_type = 'pre_investment_project'
           AND r.pre_investment_run_id IS NOT NULL AND TRIM(r.pre_investment_run_id) <> ''
           ${pipYearClause}
         ORDER BY run.F_CreatorTime DESC, r.include_in_comparable DESC, r.relevance_score DESC, r.F_CreatorTime DESC`,
        pipRelParams
      );
    } else {
      const pipRelParams = [pip.F_Id];
      let pipYearClause = '';
      if (years.length) {
        pipYearClause = ` AND YEAR(F_CreatorTime) IN (${years.map(() => '?').join(',')})`;
        pipRelParams.push(...years.map(Number));
      }
      rels = await db.query(
        `SELECT competitor_display_name, unified_credit_code, confidence_grade, relevance_score,
                competitor_type, evidence_summary, evidence_confidence, needs_review,
                evidence_breakdown_json, score_breakdown_json,
                competitor_product_intro, competitor_tags_display, sub_fund_names,
                data_sources_json, financing_amount_text, financing_history_text,
                is_listed, include_in_comparable, F_CreatorTime
         FROM sourcing_competitor_relation
         WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0
           ${pipYearClause}
         ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC`,
        pipRelParams
      );
    }
    if (!rels.length && exportAll) continue;
    const sheetLabel = sanitizeSheetName(
      pip.project_abbreviation || pip.enterprise_full_name || pip.project_no || pip.F_Id,
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
  const baseWhere = `F_DeleteMark = 0 AND project_no IS NOT NULL AND LENGTH(TRIM(project_no)) >= 5 AND project_no LIKE 'P%'`;
  const sql = isAdmin || !uid
    ? `SELECT DISTINCT SUBSTRING(project_no, 2, 4) AS y FROM pre_investment_project WHERE ${baseWhere} ORDER BY y DESC`
    : `SELECT DISTINCT SUBSTRING(project_no, 2, 4) AS y FROM pre_investment_project WHERE ${baseWhere} AND F_CreatorUserId = ? ORDER BY y DESC`;
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
