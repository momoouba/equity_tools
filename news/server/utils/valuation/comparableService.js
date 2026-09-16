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
const { resolveMergeAction } = require('./comparableMergePolicy');
const {
  inPoolFromScore,
  comparabilityFromScore: degreeFromScore,
  composeMatchReason,
} = require('./listedIndustryRecommendScore');

function httpError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const COMPARABLE_SELECT = `F_Id AS id, stock_code, stock_name, listing_market, unified_credit_code,
            competitor_relation_id, relevance_score, comparability, in_pool, selected,
            source, disabled_reason, pe_median_override, ps_median_override,
            match_reason, match_reason_json, recommend_run_id`;

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

function stringifyReasonJson(obj) {
  if (obj == null) return null;
  if (typeof obj === 'string') return obj;
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

function mapComparableRow(row) {
  if (!row) return row;
  return {
    ...row,
    match_reason_json: parseJson(row.match_reason_json, null),
  };
}

async function findActiveByCode(caseId, stockCode) {
  const code = padStockCode(stockCode);
  if (!code) return null;
  const rows = await db.query(
    `SELECT ${COMPARABLE_SELECT}
     FROM valuation_case_comparable
     WHERE case_id = ? AND stock_code = ? AND F_DeleteMark = 0
     ORDER BY F_LastModifyTime DESC LIMIT 1`,
    [caseId, code]
  );
  return rows[0] ? mapComparableRow(rows[0]) : null;
}

async function findLatestDeletedByCode(caseId, stockCode) {
  const code = padStockCode(stockCode);
  if (!code) return null;
  const rows = await db.query(
    `SELECT ${COMPARABLE_SELECT}
     FROM valuation_case_comparable
     WHERE case_id = ? AND stock_code = ? AND F_DeleteMark = 1
     ORDER BY F_LastModifyTime DESC, F_Id DESC LIMIT 1`,
    [caseId, code]
  );
  return rows[0] ? mapComparableRow(rows[0]) : null;
}

async function insertComparableRow(caseId, row) {
  const id = await generateId('valuation_case_comparable');
  const code = padStockCode(row.stock_code);
  await db.execute(
    `INSERT INTO valuation_case_comparable (
       F_Id, case_id, stock_code, stock_name, listing_market, unified_credit_code,
       competitor_relation_id, relevance_score, comparability, in_pool, selected,
       source, disabled_reason, pe_median_override, ps_median_override,
       match_reason, match_reason_json, recommend_run_id,
       F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
    [
      id,
      caseId,
      code,
      row.stock_name || null,
      row.listing_market || listingMarketFromCode(code),
      row.unified_credit_code || null,
      row.competitor_relation_id || null,
      row.relevance_score ?? null,
      row.comparability || comparabilityFromScore(row.relevance_score),
      row.in_pool ? 1 : 0,
      row.selected ? 1 : 0,
      row.source || C.COMPARABLE_SOURCE.MANUAL,
      row.disabled_reason || null,
      row.pe_median_override ?? null,
      row.ps_median_override ?? null,
      row.match_reason || null,
      stringifyReasonJson(row.match_reason_json),
      row.recommend_run_id || null,
    ]
  );
  return { ...row, id, stock_code: code };
}

async function fillEmptyDisplayFields(id, caseId, incoming) {
  const cur = await db.query(
    `SELECT ${COMPARABLE_SELECT} FROM valuation_case_comparable WHERE F_Id = ? AND case_id = ? LIMIT 1`,
    [id, caseId]
  );
  if (!cur.length) return;
  const row = cur[0];
  const sets = [];
  const params = [];
  const fill = (col, next) => {
    if (next == null || next === '') return;
    if (row[col] != null && String(row[col]).trim() !== '') return;
    sets.push(`${col} = ?`);
    params.push(next);
  };
  fill('stock_name', incoming.stock_name);
  fill('listing_market', incoming.listing_market);
  fill('unified_credit_code', incoming.unified_credit_code);
  fill('disabled_reason', incoming.disabled_reason);
  if (!sets.length) return;
  params.push(id, caseId);
  await db.execute(
    `UPDATE valuation_case_comparable SET ${sets.join(', ')}, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND case_id = ?`,
    params
  );
}

async function reviveKeep(id, caseId, { source, stockName, listingMarket, creditCode }) {
  const sets = ['F_DeleteMark = 0', 'source = ?'];
  const params = [source];
  if (stockName) {
    sets.push('stock_name = COALESCE(NULLIF(stock_name, \'\'), ?)');
    params.push(stockName);
  }
  if (listingMarket) {
    sets.push('listing_market = COALESCE(NULLIF(listing_market, \'\'), ?)');
    params.push(listingMarket);
  }
  if (creditCode) {
    sets.push('unified_credit_code = COALESCE(NULLIF(unified_credit_code, \'\'), ?)');
    params.push(creditCode);
  }
  params.push(id, caseId);
  await db.execute(
    `UPDATE valuation_case_comparable SET ${sets.join(', ')}, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND case_id = ?`,
    params
  );
}

async function reviveResetRecommend(id, caseId, row) {
  const score = row.relevance_score ?? row.score;
  await db.execute(
    `UPDATE valuation_case_comparable SET
       F_DeleteMark = 0,
       source = ?,
       relevance_score = ?,
       comparability = ?,
       selected = 1,
       in_pool = ?,
       match_reason = ?,
       match_reason_json = ?,
       recommend_run_id = ?,
       pe_median_override = NULL,
       ps_median_override = NULL,
       stock_name = COALESCE(?, stock_name),
       listing_market = COALESCE(?, listing_market),
       unified_credit_code = COALESCE(?, unified_credit_code),
       disabled_reason = ?,
       F_LastModifyTime = NOW()
     WHERE F_Id = ? AND case_id = ?`,
    [
      C.COMPARABLE_SOURCE.INDUSTRY_RECOMMEND,
      score ?? null,
      row.comparability || degreeFromScore(score),
      inPoolFromScore(score),
      row.match_reason || null,
      stringifyReasonJson(row.match_reason_json),
      row.recommend_run_id || null,
      row.stock_name || null,
      row.listing_market || null,
      row.unified_credit_code || null,
      row.disabled_reason || null,
      id,
      caseId,
    ]
  );
}

async function applyMergeRow(caseId, row, source) {
  const code = padStockCode(row.stock_code);
  if (!code) return { action: 'skip', reason: '无股票代码', stock_code: '' };
  const active = await findActiveByCode(caseId, code);
  const deleted = active ? null : await findLatestDeletedByCode(caseId, code);
  const action = resolveMergeAction(source, { hasActive: !!active, hasDeleted: !!deleted });
  if (action === 'skip') {
    return { action, stock_code: code, id: active?.id || deleted?.id, reason: active ? '已在名单' : '曾删除未复活' };
  }
  if (action === 'keep_fill_empty') {
    await fillEmptyDisplayFields(active.id, caseId, row);
    return { action, stock_code: code, id: active.id };
  }
  if (action === 'revive_keep') {
    await reviveKeep(deleted.id, caseId, {
      source,
      stockName: row.stock_name,
      listingMarket: row.listing_market,
      creditCode: row.unified_credit_code,
    });
    return { action, stock_code: code, id: deleted.id };
  }
  if (action === 'revive_reset') {
    await reviveResetRecommend(deleted.id, caseId, { ...row, stock_code: code });
    return { action, stock_code: code, id: deleted.id };
  }
  const inserted = await insertComparableRow(caseId, { ...row, stock_code: code, source: row.source || source });
  return { action: 'insert', stock_code: code, id: inserted.id };
}

/** PUT：按代码 upsert，payload 缺席的有效行不删。 */
async function replaceCaseComparables(caseId, rows) {
  for (const row of rows || []) {
    const code = padStockCode(row.stock_code);
    if (!code) continue;
    const source = row.source || C.COMPARABLE_SOURCE.MANUAL;
    const active = await findActiveByCode(caseId, code);
    if (active) {
      const sets = [];
      const params = [];
      const put = (col, val) => {
        if (val === undefined) return;
        sets.push(`${col} = ?`);
        params.push(val);
      };
      put('stock_name', row.stock_name);
      put('listing_market', row.listing_market || listingMarketFromCode(code));
      if (row.unified_credit_code !== undefined) put('unified_credit_code', row.unified_credit_code || null);
      if (row.comparability !== undefined) put('comparability', row.comparability);
      if (row.in_pool != null) put('in_pool', row.in_pool ? 1 : 0);
      if (row.selected != null) put('selected', row.selected ? 1 : 0);
      if (row.relevance_score !== undefined) put('relevance_score', row.relevance_score);
      if (row.disabled_reason !== undefined) put('disabled_reason', row.disabled_reason);
      if (!sets.length) continue;
      params.push(active.id, caseId);
      await db.execute(
        `UPDATE valuation_case_comparable SET ${sets.join(', ')}, F_LastModifyTime = NOW()
         WHERE F_Id = ? AND case_id = ? AND F_DeleteMark = 0`,
        params
      );
      continue;
    }
    await applyMergeRow(caseId, { ...row, stock_code: code, source }, source);
  }
  return listCaseComparables(caseId);
}

async function listCaseComparables(caseId) {
  const rows = await db.query(
    `SELECT ${COMPARABLE_SELECT}
     FROM valuation_case_comparable
     WHERE case_id = ? AND F_DeleteMark = 0
     ORDER BY relevance_score DESC, stock_code ASC`,
    [caseId]
  );
  return rows.map(mapComparableRow);
}

async function listDeletedCodes(caseId) {
  const rows = await db.query(
    `SELECT stock_code FROM valuation_case_comparable
     WHERE case_id = ? AND F_DeleteMark = 1`,
    [caseId]
  );
  return new Set(rows.map((r) => padStockCode(r.stock_code)).filter(Boolean));
}

async function addManualComparable(caseId, { stockCode, stockName, source = 'manual' }) {
  const code = padStockCode(stockCode);
  if (!code) throw httpError('请填写股票代码', 400);
  if (isLikelyHkOrUs(code)) throw httpError(HK_US_HINT, 400);
  const listing = await resolveStockFromNewShare({ stockCode: code });
  const market = listingMarketFromExchange(listing?.exchange) || listingMarketFromCode(code);
  if (!isAllowedListingMarket(market)) throw httpError(HK_US_HINT, 400);
  const name = stockName || listing?.stock_name || code;
  const credit = listing?.unified_credit_code || null;
  const active = await findActiveByCode(caseId, code);
  if (active) {
    return { id: active.id, stock_code: code, already: true };
  }
  const result = await applyMergeRow(
    caseId,
    {
      stock_code: code,
      stock_name: name,
      listing_market: market,
      unified_credit_code: credit,
      comparability: 'medium',
      in_pool: 1,
      selected: 1,
      source,
    },
    source
  );
  return {
    id: result.id,
    stock_code: code,
    stock_name: name,
    listing_market: market,
    selected: 1,
    in_pool: 1,
    comparability: 'medium',
    source,
    revived: result.action === 'revive_keep',
  };
}

async function mergeFromCompetitor(cse) {
  const preview = await previewComparablesFromCompetitor({
    caseType: cse.case_type,
    investedEnterpriseId: cse.invested_enterprise_id,
    competitorPreProjectId: cse.subject?.competitor_pre_project_id,
    creditCode: cse.subject?.unified_credit_code,
    fullName: cse.subject?.enterprise_full_name || cse.subject?.display_name,
  });
  const selectable = (preview.list || []).filter((x) => x.selectable);
  const inserted = [];
  const skipped = [];
  for (const row of selectable) {
    const out = await applyMergeRow(cse.id || cse.F_Id, { ...row, selected: 1 }, C.COMPARABLE_SOURCE.COMPETITOR);
    if (out.action === 'insert') inserted.push(out);
    else skipped.push(out);
  }
  return {
    ...preview,
    inserted_count: inserted.length,
    skipped_count: skipped.length,
    skipped,
    list: await listCaseComparables(cse.id || cse.F_Id),
  };
}

async function applyRecommendCodes(caseId, runId, candidates, stockCodes) {
  const wanted = new Set((stockCodes || []).map((c) => padStockCode(c)).filter(Boolean));
  const byCode = new Map();
  for (const c of candidates || []) {
    const code = padStockCode(c.stock_code);
    if (code) byCode.set(code, c);
  }
  const applied = [];
  const skipped = [];
  for (const code of wanted) {
    const cand = byCode.get(code);
    if (!cand) {
      skipped.push({ stock_code: code, reason: '不在本版推荐结果中' });
      continue;
    }
    const reasonJson = {
      ...(cand.match_reason_json || cand.reason || {}),
      business: cand.business_reason || cand.reason?.dimensions?.business || null,
    };
    const row = {
      stock_code: code,
      stock_name: cand.stock_name,
      listing_market: cand.listing_market,
      unified_credit_code: cand.unified_credit_code,
      relevance_score: cand.relevance_score ?? cand.score,
      comparability: cand.comparability || degreeFromScore(cand.relevance_score ?? cand.score),
      selected: 1,
      in_pool: inPoolFromScore(cand.relevance_score ?? cand.score),
      source: C.COMPARABLE_SOURCE.INDUSTRY_RECOMMEND,
      match_reason: composeMatchReason(cand.match_reason || cand.reason?.summary, cand.business_reason),
      match_reason_json: reasonJson,
      recommend_run_id: runId,
    };
    const out = await applyMergeRow(caseId, row, C.COMPARABLE_SOURCE.INDUSTRY_RECOMMEND);
    if (out.action === 'skip') skipped.push({ stock_code: code, reason: out.reason || '已在名单，已跳过' });
    else applied.push(out);
  }
  return { applied, skipped, list: await listCaseComparables(caseId) };
}

async function softDeleteComparable(caseId, cid) {
  const rows = await db.query(
    `SELECT F_Id FROM valuation_case_comparable
     WHERE F_Id = ? AND case_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [cid, caseId]
  );
  if (!rows.length) throw httpError('可比公司不存在或已删除', 404);
  await db.execute(
    `UPDATE valuation_case_comparable
     SET F_DeleteMark = 1, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND case_id = ?`,
    [cid, caseId]
  );
  return { id: cid };
}

async function patchComparable(caseId, cid, body) {
  const rows = await db.query(
    `SELECT ${COMPARABLE_SELECT} FROM valuation_case_comparable
     WHERE F_Id = ? AND case_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [cid, caseId]
  );
  if (!rows.length) throw httpError('可比公司不存在或已删除', 404);
  const cur = mapComparableRow(rows[0]);
  const sets = [];
  const params = [];
  let warning = null;

  if (body?.stock_code != null && padStockCode(body.stock_code) !== padStockCode(cur.stock_code)) {
    const code = padStockCode(body.stock_code);
    if (!code) throw httpError('请填写股票代码', 400);
    if (isLikelyHkOrUs(code)) throw httpError(HK_US_HINT, 400);
    const listing = await resolveStockFromNewShare({ stockCode: code });
    const market = listingMarketFromExchange(listing?.exchange) || listingMarketFromCode(code);
    if (!listing || !isAllowedListingMarket(market)) throw httpError(HK_US_HINT, 400);
    const otherActive = await findActiveByCode(caseId, code);
    if (otherActive && otherActive.id !== cid) {
      throw httpError('该代码已在本案件有效名单中', 400);
    }
    const deleted = await findLatestDeletedByCode(caseId, code);
    if (deleted) {
      throw httpError('该代码曾删除，请用手工添加或推荐勾选加回', 400);
    }
    sets.push('stock_code = ?', 'stock_name = ?', 'listing_market = ?', 'unified_credit_code = ?');
    params.push(code, listing.stock_name || code, market, listing.unified_credit_code || null);
    sets.push('pe_median_override = NULL', 'ps_median_override = NULL');
    warning = '将清除底稿覆盖';
  }
  if (body?.comparability) {
    sets.push('comparability = ?');
    params.push(body.comparability);
  }
  if (body?.in_pool != null) {
    sets.push('in_pool = ?');
    params.push(body.in_pool ? 1 : 0);
  }
  if (body?.selected != null) {
    sets.push('selected = ?');
    params.push(body.selected ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'pe_median_override')) {
    const n = Number(body.pe_median_override);
    sets.push('pe_median_override = ?');
    params.push(body.pe_median_override == null || body.pe_median_override === '' || !Number.isFinite(n) ? null : n);
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'ps_median_override')) {
    const n = Number(body.ps_median_override);
    sets.push('ps_median_override = ?');
    params.push(body.ps_median_override == null || body.ps_median_override === '' || !Number.isFinite(n) ? null : n);
  }
  if (body?.relevance_score != null) {
    const score = Number(body.relevance_score);
    sets.push('relevance_score = ?');
    params.push(score);
    if (!body.comparability) {
      sets.push('comparability = ?');
      params.push(comparabilityFromScore(score));
    }
  }
  if (!sets.length) return { warning };
  params.push(cid, caseId);
  await db.execute(
    `UPDATE valuation_case_comparable SET ${sets.join(', ')}, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND case_id = ? AND F_DeleteMark = 0`,
    params
  );
  return { warning };
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
  listDeletedCodes,
  addManualComparable,
  mergeFromCompetitor,
  applyRecommendCodes,
  softDeleteComparable,
  patchComparable,
  listComparableFinancials,
  findCompetitorInvestedEnterprise,
  latestSuccessRun,
  padStockCode,
};
