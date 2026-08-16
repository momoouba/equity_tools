const db = require('../../db');
const C = require('./constants');
const { comparabilityFromScore, defaultInPool } = require('./defaults');
const {
  padStockCode,
  listingMarketFromCode,
  listingMarketFromExchange,
  isAllowedListingMarket,
  isLikelyHkOrUs,
  HK_US_HINT,
} = require('./marketUtils');
const { generateId } = require('../idGenerator');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { getApplicationIdByAppName } = require('../applicationIdResolve');

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function resolveStockFromNewShare({ creditCode, displayName, stockCode }) {
  const code = padStockCode(stockCode);
  if (code) {
    const byCode = await db.query(
      `SELECT stock_code, stock_name, exchange, unified_credit_code,
              enterprise_full_name_cn, enterprise_full_name_display
       FROM ipo_new_share
       WHERE stock_code = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 1`,
      [code]
    );
    if (byCode.length) return byCode[0];
  }
  const credit = String(creditCode || '').replace(/\s+/g, '').trim();
  if (credit) {
    const byCredit = await db.query(
      `SELECT stock_code, stock_name, exchange, unified_credit_code,
              enterprise_full_name_cn, enterprise_full_name_display
       FROM ipo_new_share
       WHERE REPLACE(IFNULL(unified_credit_code,''), ' ', '') = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 1`,
      [credit]
    );
    if (byCredit.length) return byCredit[0];
  }
  const name = String(displayName || '').trim();
  if (name) {
    const byName = await db.query(
      `SELECT stock_code, stock_name, exchange, unified_credit_code,
              enterprise_full_name_cn, enterprise_full_name_display
       FROM ipo_new_share
       WHERE enterprise_full_name_cn = ?
          OR enterprise_full_name_display = ?
          OR stock_name = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 1`,
      [name, name, name]
    );
    if (byName.length) return byName[0];
  }
  return null;
}

function mapRelationToComparable(rel, listing) {
  const score = rel.relevance_score == null ? null : Number(rel.relevance_score);
  const degree = comparabilityFromScore(score);
  const stockCode = padStockCode(listing?.stock_code);
  const market = listingMarketFromExchange(listing?.exchange) || listingMarketFromCode(stockCode);
  const hkUs = isLikelyHkOrUs(listing?.exchange) || isLikelyHkOrUs(stockCode);
  const allowed = !!(stockCode && isAllowedListingMarket(market) && !hkUs);
  return {
    competitor_relation_id: String(rel.F_Id),
    competitor_display_name: rel.competitor_display_name,
    unified_credit_code: rel.unified_credit_code || listing?.unified_credit_code || null,
    relevance_score: score,
    comparability: degree,
    in_pool: defaultInPool(degree) ? 1 : 0,
    stock_code: stockCode || '',
    stock_name: listing?.stock_name || rel.competitor_display_name,
    listing_market: market,
    selected: allowed ? 1 : 0,
    source: 'competitor_run',
    disabled_reason: !stockCode
      ? '无股票代码'
      : hkUs || !allowed
        ? HK_US_HINT
        : null,
    selectable: allowed,
  };
}

async function findCompetitorInvestedEnterprise({ creditCode, fullName }) {
  const caId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  const credit = String(creditCode || '').replace(/\s+/g, '').trim();
  if (credit) {
    const rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code
       FROM invested_enterprises
       WHERE F_DeleteMark = 0
         AND (data_app_id <=> ? OR (data_app_id IS NULL AND data_app_name = ?))
         AND REPLACE(IFNULL(unified_credit_code,''), ' ', '') = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 1`,
      [caId, DATA_APP_COMPETITOR_ANALYSIS, credit]
    );
    if (rows.length) return rows[0];
  }
  const name = String(fullName || '').trim();
  if (name) {
    const rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, unified_credit_code
       FROM invested_enterprises
       WHERE F_DeleteMark = 0
         AND (data_app_id <=> ? OR (data_app_id IS NULL AND data_app_name = ?))
         AND enterprise_full_name = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 1`,
      [caId, DATA_APP_COMPETITOR_ANALYSIS, name]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

async function latestSuccessRun({ subjectType, investedEnterpriseId, preInvestmentProjectId }) {
  if (subjectType === 'pre_investment_project') {
    const rows = await db.query(
      `SELECT F_Id AS run_id, F_CreatorTime AS created_at
       FROM sourcing_pre_investment_competitor_run
       WHERE pre_investment_project_id = ? AND F_DeleteMark = 0 AND status = 'success'
       ORDER BY F_CreatorTime DESC, F_Id DESC
       LIMIT 1`,
      [preInvestmentProjectId]
    );
    return rows[0] || null;
  }
  const rows = await db.query(
    `SELECT F_Id AS run_id, F_CreatorTime AS created_at
     FROM sourcing_competitor_run
     WHERE invested_enterprise_id = ? AND F_DeleteMark = 0 AND status = 'success'
     ORDER BY F_CreatorTime DESC, F_Id DESC
     LIMIT 1`,
    [investedEnterpriseId]
  );
  return rows[0] || null;
}

async function loadListedRelationsForRun({ subjectType, runId, investedEnterpriseId, preInvestmentProjectId }) {
  let sql;
  let params;
  if (subjectType === 'pre_investment_project') {
    sql = `SELECT F_Id, competitor_display_name, unified_credit_code, is_listed, relevance_score
           FROM sourcing_competitor_relation
           WHERE F_DeleteMark = 0
             AND subject_type = 'pre_investment_project'
             AND pre_investment_project_id = ?
             AND pre_investment_run_id = ?
             AND is_listed = 1`;
    params = [preInvestmentProjectId, runId];
  } else {
    sql = `SELECT F_Id, competitor_display_name, unified_credit_code, is_listed, relevance_score
           FROM sourcing_competitor_relation
           WHERE F_DeleteMark = 0
             AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             AND invested_enterprise_id = ?
             AND run_id = ?
             AND is_listed = 1`;
    params = [investedEnterpriseId, runId];
  }
  return db.query(sql, params);
}

async function previewComparablesFromCompetitor({
  caseType,
  investedEnterpriseId,
  competitorPreProjectId,
  creditCode,
  fullName,
}) {
  let subjectType;
  let ieId = investedEnterpriseId;
  let pipId = competitorPreProjectId;
  let runDeleted = false;
  let sourceMissing = false;

  if (caseType === C.CASE_TYPE_PRE) {
    subjectType = 'pre_investment_project';
    if (pipId) {
      const exists = await db.query(
        'SELECT F_Id FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1',
        [pipId]
      );
      if (!exists.length) {
        sourceMissing = true;
        pipId = null;
      }
    }
  } else {
    subjectType = 'invested_enterprise';
    const matched = await findCompetitorInvestedEnterprise({ creditCode, fullName });
    ieId = matched?.id || null;
    if (!ieId) sourceMissing = true;
  }

  if (sourceMissing) {
    return {
      run: null,
      source_missing: true,
      refresh_blocked: true,
      list: [],
      message: caseType === C.CASE_TYPE_PRE
        ? '竞品分析投前项目已删除，无法刷新可比，仅可使用已勾选快照或手工导入'
        : '未在竞品分析中匹配到被投企业（信用代码优先、全称其次）',
    };
  }

  const run = await latestSuccessRun({
    subjectType,
    investedEnterpriseId: ieId,
    preInvestmentProjectId: pipId,
  });
  if (!run) {
    return {
      run: null,
      source_missing: false,
      refresh_blocked: false,
      list: [],
      message: '无最新成功竞品分析 run，请手工或 Excel 导入股票代码',
    };
  }

  const rels = await loadListedRelationsForRun({
    subjectType,
    runId: run.run_id,
    investedEnterpriseId: ieId,
    preInvestmentProjectId: pipId,
  });
  const list = [];
  for (const rel of rels) {
    const listing = await resolveStockFromNewShare({
      creditCode: rel.unified_credit_code,
      displayName: rel.competitor_display_name,
    });
    list.push(mapRelationToComparable(rel, listing));
  }
  return {
    run,
    source_missing: false,
    refresh_blocked: runDeleted,
    list,
    message: null,
  };
}

async function replaceCaseComparables(caseId, rows) {
  const prev = await listCaseComparables(caseId);
  const kept = new Map();
  for (const p of prev) {
    kept.set(padStockCode(p.stock_code), {
      pe: p.pe_median_override,
      ps: p.ps_median_override,
    });
  }
  await db.execute(
    'UPDATE valuation_case_comparable SET F_DeleteMark = 1 WHERE case_id = ? AND F_DeleteMark = 0',
    [caseId]
  );
  const saved = [];
  for (const row of rows || []) {
    const id = await generateId('valuation_case_comparable');
    const code = padStockCode(row.stock_code);
    const ov = kept.get(code) || {};
    const peOv = row.pe_median_override != null && row.pe_median_override !== '' ? row.pe_median_override : ov.pe;
    const psOv = row.ps_median_override != null && row.ps_median_override !== '' ? row.ps_median_override : ov.ps;
    await db.execute(
      `INSERT INTO valuation_case_comparable (
         F_Id, case_id, stock_code, stock_name, listing_market, unified_credit_code,
         competitor_relation_id, relevance_score, comparability, in_pool, selected,
         source, disabled_reason, pe_median_override, ps_median_override,
         F_CreatorTime, F_LastModifyTime, F_DeleteMark
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
      [
        id,
        caseId,
        code,
        row.stock_name || null,
        row.listing_market || listingMarketFromCode(row.stock_code),
        row.unified_credit_code || null,
        row.competitor_relation_id || null,
        row.relevance_score ?? null,
        row.comparability || comparabilityFromScore(row.relevance_score),
        row.in_pool ? 1 : 0,
        row.selected ? 1 : 0,
        row.source || 'competitor_run',
        row.disabled_reason || null,
        peOv ?? null,
        psOv ?? null,
      ]
    );
    saved.push({ ...row, id, stock_code: code, pe_median_override: peOv ?? null, ps_median_override: psOv ?? null });
  }
  return saved;
}

async function listCaseComparables(caseId) {
  return db.query(
    `SELECT F_Id AS id, stock_code, stock_name, listing_market, unified_credit_code,
            competitor_relation_id, relevance_score, comparability, in_pool, selected,
            source, disabled_reason, pe_median_override, ps_median_override
     FROM valuation_case_comparable
     WHERE case_id = ? AND F_DeleteMark = 0
     ORDER BY relevance_score DESC, stock_code ASC`,
    [caseId]
  );
}

async function addManualComparable(caseId, { stockCode, stockName, source = 'manual' }) {
  const code = padStockCode(stockCode);
  if (!code) {
    const err = new Error('请填写股票代码');
    err.code = 400;
    throw err;
  }
  if (isLikelyHkOrUs(code)) {
    const err = new Error(HK_US_HINT);
    err.code = 400;
    throw err;
  }
  const listing = await resolveStockFromNewShare({ stockCode: code });
  const market = listingMarketFromExchange(listing?.exchange) || listingMarketFromCode(code);
  if (!isAllowedListingMarket(market)) {
    const err = new Error(HK_US_HINT);
    err.code = 400;
    throw err;
  }
  const exist = await db.query(
    `SELECT F_Id FROM valuation_case_comparable
     WHERE case_id = ? AND stock_code = ? AND F_DeleteMark = 0 LIMIT 1`,
    [caseId, code]
  );
  if (exist.length) {
    return { id: exist[0].F_Id, stock_code: code, already: true };
  }
  const id = await generateId('valuation_case_comparable');
  const name = stockName || listing?.stock_name || code;
  await db.execute(
    `INSERT INTO valuation_case_comparable (
       F_Id, case_id, stock_code, stock_name, listing_market, unified_credit_code,
       comparability, in_pool, selected, source, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
    [id, caseId, code, name, market, listing?.unified_credit_code || null, 'medium', 1, 1, source]
  );
  return {
    id,
    stock_code: code,
    stock_name: name,
    listing_market: market,
    selected: 1,
    in_pool: 1,
    comparability: 'medium',
    source,
  };
}

function periodLabel(period) {
  if (period instanceof Date && !Number.isNaN(period.getTime())) {
    const y = period.getFullYear();
    const mo = String(period.getMonth() + 1).padStart(2, '0');
    const da = String(period.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const s = String(period || '');
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

async function listComparableFinancials(caseId) {
  const comps = (await listCaseComparables(caseId)).filter((c) => Number(c.selected) === 1 && c.stock_code);
  if (!comps.length) return { companies: [], list: [] };
  const { LISTED_METRIC_COLS } = require('./listedMetrics');
  const codes = comps.map((c) => c.stock_code);
  const placeholders = codes.map(() => '?').join(',');
  const rows = await db.query(
    `SELECT stock_code, report_period, report_type, statement_type, ${LISTED_METRIC_COLS.join(', ')}
     FROM listed_company_financials
     WHERE stock_code IN (${placeholders})
     ORDER BY stock_code ASC, statement_type ASC, report_period DESC`,
    codes
  );
  const nameByCode = {};
  for (const c of comps) nameByCode[c.stock_code] = c.stock_name;
  return {
    companies: comps.map((c) => ({
      stock_code: c.stock_code,
      stock_name: c.stock_name,
      listing_market: c.listing_market,
    })),
    list: rows.map((r) => {
      const metrics = {};
      for (const k of LISTED_METRIC_COLS) {
        const n = r[k] == null ? null : Number(r[k]);
        metrics[k] = Number.isFinite(n) ? n : null;
      }
      return {
        stock_code: r.stock_code,
        stock_name: nameByCode[r.stock_code] || r.stock_code,
        report_period: periodLabel(r.report_period),
        report_type: r.report_type,
        statement_type: r.statement_type,
        ...metrics,
        gross_profit: metrics.gross_profit != null
          ? metrics.gross_profit
          : (metrics.revenue != null && metrics.cogs != null ? metrics.revenue - metrics.cogs : null),
      };
    }),
  };
}

module.exports = {
  parseJson,
  resolveStockFromNewShare,
  previewComparablesFromCompetitor,
  replaceCaseComparables,
  listCaseComparables,
  addManualComparable,
  listComparableFinancials,
  findCompetitorInvestedEnterprise,
};
