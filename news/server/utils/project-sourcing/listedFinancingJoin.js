'use strict';

/**
 * Stage 0 §4.4 / Stage 2 — 融资 IPO 类企业与 ipo_new_share 关联规则（§5.3.1）
 */

const { normalizeCompanyName } = require('../listing/zhconvUtils');
const { normalizeCreditCode, strTrim } = require('../competitor-analysis/competitorMatchUtils');

const DOMESTIC_EXCHANGES = new Set(['上交所', '深交所', '北交所']);

/** 业务口径：境内沪深北当前上市家数（2026-07，用于 Stage 1 扩池目标） */
const MARKET_LISTED_BASELINE = {
  上交所: 2318,
  深交所: 2897,
  北交所: 317,
};

function isDomesticExchange(exchange) {
  return DOMESTIC_EXCHANGES.has(strTrim(exchange));
}

function isOverseasFinancingCredit(code) {
  const c = strTrim(code).toLowerCase();
  if (!c) return false;
  if (c.startsWith('cp-')) return true;
  if (/^[a-z]/i.test(c) && !/^\d{18}$/.test(c.replace(/\s/g, ''))) return true;
  return false;
}

/**
 * 融资侧 IPO 类命中 new_share 失败时的噪声分类（不以融资为上市真值）
 */
function classifyFinancingListingNoise(companyRow, joinResult) {
  if (joinResult.listing_status === 'matched') {
    return 'in_new_share_pool';
  }
  if (isOverseasFinancingCredit(companyRow.company_credit_code)) {
    return 'financing_overseas_or_invalid_id';
  }
  if (joinResult.listing_status === 'unknown') {
    return 'financing_needs_review';
  }
  return 'financing_not_in_new_share_pool';
}

/** round / latest_round 命中 IPO、上市、定增、Post-IPO 等（无 LLM） */
const LISTING_ROUND_PATTERNS = [
  /\bipo\b/i,
  /post[\s-]?ipo/i,
  /上市/,
  /定增/,
  /公开发行/,
  /挂牌/,
  /借壳/,
  /基石投资/,
  /配售/,
  /转板/,
  /科创板/,
  /创业板/,
  /北交所/,
];

function isListingRoundText(text) {
  const s = strTrim(text);
  if (!s) return false;
  return LISTING_ROUND_PATTERNS.some((re) => re.test(s));
}

function isListingFinancingRow(row) {
  return isListingRoundText(row?.round) || isListingRoundText(row?.latest_round);
}

/** MySQL REGEXP，与 isListingRoundText 口径对齐（报告/SQL 预筛 IPO 类事件） */
const IPO_ROUND_SQL = `(
  round REGEXP 'ipo|post[[:space:]-]?ipo|上市|定增|公开发行|挂牌|借壳|基石投资|配售|转板|科创板|创业板|北交所'
  OR latest_round REGEXP 'ipo|post[[:space:]-]?ipo|上市|定增|公开发行|挂牌|借壳|基石投资|配售|转板|科创板|创业板|北交所'
)`;

function collectNameTrigrams(core) {
  const grams = new Set();
  if (!core || core.length < 3) return grams;
  for (let i = 0; i <= core.length - 3; i += 1) {
    grams.add(core.slice(i, i + 3));
  }
  return grams;
}

/** 去后缀后的全称核心，用于 exact match */
function extractCompanyNameCore(name) {
  let n = normalizeCompanyName(strTrim(name));
  n = n.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  n = n.replace(/股份有限公司$/u, '').replace(/有限责任公司$/u, '').replace(/有限公司$/u, '').trim();
  return n;
}

function normalizeStockCode(code) {
  return strTrim(code).replace(/^0+/, '') || '';
}

function companyDedupeKey(row) {
  const code = normalizeCreditCode(row.company_credit_code);
  if (code) return `c:${code}`;
  const name = normalizeCompanyName(strTrim(row.company_name));
  return `n:${name}`;
}

/**
 * @param {object[]} newShareRows
 * @param {{ hasUnifiedCreditCode: boolean }} opts
 */
function buildNewShareIndex(newShareRows, opts = {}) {
  const byCredit = new Map();
  const byStock = new Map();
  const byNameCore = new Map();
  const fuzzyGramToIds = new Map();
  const byId = new Map();
  const allRows = [];

  for (const row of newShareRows) {
    allRows.push(row);
    byId.set(row.F_Id, row);
    const rowGrams = new Set();
    if (opts.hasUnifiedCreditCode) {
      const credit = normalizeCreditCode(row.unified_credit_code);
      if (credit) {
        if (!byCredit.has(credit)) byCredit.set(credit, []);
        byCredit.get(credit).push(row);
      }
    }
    const stock = normalizeStockCode(row.stock_code);
    if (stock) {
      const sk = `${stock}\0${strTrim(row.exchange)}`;
      if (!byStock.has(sk)) byStock.set(sk, []);
      byStock.get(sk).push(row);
    }
    for (const nm of [row.enterprise_full_name_cn, row.enterprise_full_name_display, row.stock_name]) {
      const core = extractCompanyNameCore(nm);
      if (!core || core.length < 2) continue;
      if (!byNameCore.has(core)) byNameCore.set(core, []);
      const bucket = byNameCore.get(core);
      if (!bucket.some((r) => r.F_Id === row.F_Id)) bucket.push(row);
      for (const g of collectNameTrigrams(core)) rowGrams.add(g);
    }
    for (const g of rowGrams) {
      if (!fuzzyGramToIds.has(g)) fuzzyGramToIds.set(g, new Set());
      fuzzyGramToIds.get(g).add(row.F_Id);
    }
  }

  return { byCredit, byStock, byNameCore, fuzzyGramToIds, byId, allRows };
}

/**
 * 名称 fuzzy：核心名长度≥3 且 new_share 全称核心包含关系（仅用于 unknown 队列，不自动关联）
 */
function fuzzyNameCandidates(companyName, index) {
  const core = extractCompanyNameCore(companyName);
  if (core.length < 3) return [];

  const candidateIds = new Set();
  for (const g of collectNameTrigrams(core)) {
    const ids = index.fuzzyGramToIds?.get(g);
    if (!ids) continue;
    for (const id of ids) candidateIds.add(id);
  }
  if (!candidateIds.size) return [];

  const hits = [];
  for (const id of candidateIds) {
    const row = index.byId?.get(id);
    if (!row) continue;
    const names = [row.enterprise_full_name_cn, row.enterprise_full_name_display, row.stock_name]
      .map(extractCompanyNameCore)
      .filter(Boolean);
    const matched = names.some((n) => n.includes(core) || core.includes(n));
    if (matched) hits.push(row);
  }
  return hits;
}

/**
 * @returns {{
 *   listing_status: 'matched'|'unknown'|'no_match',
 *   match_method: string,
 *   match_confidence: 'high'|'low'|'none',
 *   new_share_id: number|null,
 *   stock_code: string|null,
 *   exchange: string|null,
 *   candidate_count: number,
 *   note: string,
 * }}
 */
function classifyListedJoin(companyRow, index, opts = {}) {
  const credit = normalizeCreditCode(companyRow.company_credit_code);
  const listedStock = strTrim(companyRow.listed_stock_code || '');

  if (credit && index.byCredit.has(credit)) {
    const hits = index.byCredit.get(credit);
    if (hits.length === 1) {
      return resultMatched('credit_code', hits[0], hits.length, '信用代码精确匹配');
    }
    return resultUnknown('credit_code_ambiguous', hits.length, '信用代码命中多条 new_share');
  }

  if (listedStock && opts.financingHasListedStock) {
    const stockNorm = normalizeStockCode(listedStock);
    const stockHits = [];
    for (const [key, rows] of index.byStock.entries()) {
      if (key.startsWith(`${stockNorm}\0`)) stockHits.push(...rows);
    }
    if (stockHits.length === 1) {
      return resultMatched('stock_code', stockHits[0], 1, '股票代码一致');
    }
    if (stockHits.length > 1) {
      return resultUnknown('stock_code_ambiguous', stockHits.length, '股票代码命中多条');
    }
  }

  const nameCore = extractCompanyNameCore(companyRow.company_name);
  if (nameCore.length >= 2 && index.byNameCore.has(nameCore)) {
    const hits = index.byNameCore.get(nameCore);
    if (hits.length === 1) {
      return resultMatched('name_exact', hits[0], 1, '规范化全称精确匹配');
    }
    return resultUnknown('name_exact_ambiguous', hits.length, '全称精确命中多条');
  }

  const fuzzyHits = opts.skipFuzzy ? [] : fuzzyNameCandidates(companyRow.company_name, index);
  if (fuzzyHits.length > 0) {
    return resultUnknown('fuzzy', fuzzyHits.length, '名称 fuzzy 候选，进二次匹配队列');
  }

  return resultNoMatch('no_match', 0, credit ? '有信用代码但未命中 new_share' : '无可用关联键');
}

function resultMatched(method, row, count, note) {
  return {
    listing_status: 'matched',
    match_method: method,
    match_confidence: 'high',
    new_share_id: row.F_Id,
    stock_code: row.stock_code,
    exchange: row.exchange,
    candidate_count: count,
    note,
  };
}

function resultUnknown(method, count, note) {
  return {
    listing_status: 'unknown',
    match_method: method,
    match_confidence: 'low',
    new_share_id: null,
    stock_code: null,
    exchange: null,
    candidate_count: count,
    note,
  };
}

function resultNoMatch(method, count, note) {
  return {
    listing_status: 'no_match',
    match_method: method,
    match_confidence: 'none',
    new_share_id: null,
    stock_code: null,
    exchange: null,
    candidate_count: count,
    note,
  };
}

/**
 * 去重企业：同一信用代码或名称保留最近 event_date 一条
 */
function dedupeIpoCompanies(eventRows) {
  const map = new Map();
  for (const row of eventRows) {
    if (!isListingFinancingRow(row)) continue;
    const key = companyDedupeKey(row);
    const existing = map.get(key);
    const dt = String(row.event_date || '');
    if (!existing || dt > String(existing.event_date || '')) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

function buildFinancingIpoIndex(companies) {
  const byCredit = new Map();
  const byNameCore = new Map();
  for (const row of companies) {
    const credit = normalizeCreditCode(row.company_credit_code);
    if (credit) {
      if (!byCredit.has(credit)) byCredit.set(credit, []);
      byCredit.get(credit).push(row);
    }
    const core = extractCompanyNameCore(row.company_name);
    if (core.length >= 2) {
      if (!byNameCore.has(core)) byNameCore.set(core, []);
      byNameCore.get(core).push(row);
    }
  }
  return { byCredit, byNameCore, allRows: companies };
}

/**
 * 主口径：以 ipo_new_share 为真值，反查融资池是否存在 IPO 类记录
 */
function findFinancingDonorForNewShare(nsRow, financingIndex, opts = {}) {
  const credit = opts.hasUnifiedCreditCode ? normalizeCreditCode(nsRow.unified_credit_code) : '';
  if (credit && financingIndex.byCredit.has(credit)) {
    const hits = financingIndex.byCredit.get(credit);
    return {
      has_financing_ipo: true,
      match_method: hits.length === 1 ? 'credit_code' : 'credit_code_ambiguous',
      candidate_count: hits.length,
    };
  }
  for (const nm of [nsRow.enterprise_full_name_cn, nsRow.enterprise_full_name_display, nsRow.stock_name]) {
    const core = extractCompanyNameCore(nm);
    if (core.length >= 2 && financingIndex.byNameCore.has(core)) {
      const hits = financingIndex.byNameCore.get(core);
      return {
        has_financing_ipo: true,
        match_method: hits.length === 1 ? 'name_exact' : 'name_exact_ambiguous',
        candidate_count: hits.length,
      };
    }
  }
  return { has_financing_ipo: false, match_method: 'none', candidate_count: 0 };
}

function countNewShareByExchange(rows) {
  const counts = { 上交所: 0, 深交所: 0, 北交所: 0, 港交所: 0, other: 0 };
  for (const r of rows) {
    const ex = strTrim(r.exchange);
    if (counts[ex] !== undefined) counts[ex] += 1;
    else counts.other += 1;
  }
  const domesticTotal = counts.上交所 + counts.深交所 + counts.北交所;
  const marketTotal = Object.values(MARKET_LISTED_BASELINE).reduce((a, b) => a + b, 0);
  return { counts, domesticTotal, marketTotal };
}

module.exports = {
  DOMESTIC_EXCHANGES,
  MARKET_LISTED_BASELINE,
  LISTING_ROUND_PATTERNS,
  IPO_ROUND_SQL,
  isDomesticExchange,
  isOverseasFinancingCredit,
  classifyFinancingListingNoise,
  isListingRoundText,
  isListingFinancingRow,
  extractCompanyNameCore,
  companyDedupeKey,
  buildNewShareIndex,
  buildFinancingIpoIndex,
  classifyListedJoin,
  findFinancingDonorForNewShare,
  countNewShareByExchange,
  dedupeIpoCompanies,
  normalizeStockCode,
};
