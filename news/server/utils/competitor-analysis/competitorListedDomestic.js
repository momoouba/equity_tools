'use strict';

const {
  strTrim,
  normalizeCreditCode,
  candidateDedupeKey,
  computeComprehensiveScore,
  getCandidateAiPart,
  meetsPersistThreshold,
  isPersistValidationPassed,
} = require('./competitorMatchUtils');
const { parseIsListedFromCandidate } = require('./competitorRelationPersistEnhance');
const { hasStrongOffTargetSignals } = require('./competitorProductLineUtils');
const { isOverseasCompetitorCandidate } = require('./competitorDomesticIdentityUtils');

/** 落库须包含的国内上市公司（上交所/深交所/北交所，含新三板）最少条数（交付客户≥5，用户可筛≥3） */
const MIN_DOMESTIC_LISTED_COMPETITORS = Math.max(
  1,
  parseInt(process.env.COMPETITOR_MIN_DOMESTIC_LISTED || '5', 10) || 5
);

/** 落库须包含的未上市竞品最少条数（交付客户≥8，用户可筛≥5） */
const MIN_UNLISTED_COMPETITORS = Math.max(
  1,
  parseInt(process.env.COMPETITOR_MIN_UNLISTED || '8', 10) || 8
);

const HK_LISTING_MARKETS = new Set(['hk', 'hkex', 'hkg', '港股']);
const DOMESTIC_LISTING_MARKETS = new Set(['sse', 'szse', 'bse', 'neeq', '新三板', 'a股', 'a-share']);
const WEB_LISTED_AI_FLOOR = 55;

function candidateSources(c) {
  return c?.sources || (c?.source ? [c.source] : []);
}

function isDomesticListedFromIpoPool(c) {
  const srcs = candidateSources(c);
  if (srcs.includes('ipo_project')) return true;
  if (!srcs.includes('ipo_new_share')) return false;
  if (c.domestic_listed === false) return false;
  if (c.domestic_listed === true) return true;
  const market = c.listing_market || c.validation?.listing_market;
  if (market && isOverseasListingMarket(market)) return false;
  if (market && isDomesticListedMarket(market)) return true;
  return true;
}

function isOverseasListingMarket(market) {
  const m = strTrim(market).toLowerCase();
  if (!m) return false;
  if (HK_LISTING_MARKETS.has(m)) return true;
  return /^(nyse|nasdaq|otc|lse|tse|hk)/.test(m);
}

function isDomesticListedMarket(market) {
  const m = strTrim(market).toLowerCase();
  if (!m) return false;
  if (DOMESTIC_LISTING_MARKETS.has(m)) return true;
  return /^(sse|szse|bse|neeq|sh\d|sz\d)/.test(m);
}

/** 是否为国内上市企业候选（底层 ipo 池，或联网/校验明确为国内 A 股/北交所/新三板） */
function isDomesticListedCandidate(c) {
  if (!c) return false;
  if (isDomesticListedFromIpoPool(c)) return true;
  if (c.domestic_listed === true) return true;
  const market = c.listing_market || c.validation?.listing_market;
  if (market && isOverseasListingMarket(market)) return false;
  if (market && isDomesticListedMarket(market)) return true;
  if (parseIsListedFromCandidate(c) === 1 || parseIsListedFromCandidate(c.validation) === 1) {
    if (market && isOverseasListingMarket(market)) return false;
    return true;
  }
  return false;
}

function countDomesticListedInScored(scored) {
  const keys = new Set();
  let n = 0;
  for (const c of scored || []) {
    if (!isDomesticListedCandidate(c)) continue;
    const k = candidateDedupeKey(c);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    n += 1;
  }
  return n;
}

function countDomesticListedInPersistRows(rows) {
  const keys = new Set();
  let n = 0;
  for (const row of rows || []) {
    const c = row._candidate || row;
    if (!isDomesticListedCandidate(c)) continue;
    const k = candidateDedupeKey({
      unified_credit_code: row.unified_credit_code || c.unified_credit_code,
      display_name: row.display_name || c.display_name,
    });
    if (!k || keys.has(k)) continue;
    keys.add(k);
    n += 1;
  }
  return n;
}

function buildListedDomesticDiscoverKeywords(target, baseKeywords) {
  const kw = [...(baseKeywords || [])];
  const coreLines = target?.core_product_lines?.length
    ? target.core_product_lines
    : [];
  for (const line of coreLines.slice(0, 6)) {
    kw.push(`${strTrim(line)} A股上市公司`);
    kw.push(`${strTrim(line)} 上市公司 对标`);
  }
  kw.push(
    'A股上市公司',
    '上交所上市公司',
    '深交所上市公司',
    '北交所上市公司',
    '同行业上市公司',
    '对标上市公司',
    '层析填料 上市公司',
    '色谱填料 上市公司',
    '生物制药纯化 上市公司'
  );
  const name = strTrim(target?.display_name);
  if (name) {
    kw.push(`${name} 同行业 A股`);
    kw.push(`${name} 上市公司 对标`);
  }
  return [...new Set(kw.map((x) => strTrim(x)).filter(Boolean))].slice(0, 24);
}

/** 境内未上市候选（境外主体单独统计，不计入未上市名额） */
function isDomesticUnlistedCandidate(c) {
  if (!c) return false;
  if (isOverseasCompetitorCandidate(c)) return false;
  return !isDomesticListedCandidate(c);
}

function mergeWebCandidatesIntoScored(scored, webList, { parseIsListedFromCandidate: parseListed }) {
  let added = 0;
  let merged = 0;
  for (const w of webList || []) {
    const name = strTrim(w.company_name);
    if (!name) continue;
    const market = strTrim(w.listing_market || w.exchange || '');
    const overseas = isOverseasListingMarket(market);

    const credit = normalizeCreditCode(w.unified_credit_code) || null;
    const webProbe = {
      display_name: name,
      unified_credit_code: credit,
      listing_market: market,
      is_listed: w.is_listed,
    };
    const key = credit || name.toLowerCase();
    const dupIdx = scored.findIndex(
      (x) => (x.unified_credit_code && credit && x.unified_credit_code === credit) || x.display_name === name
    );
    const domesticListed =
      !overseas &&
      (parseListed({ is_listed: w.is_listed }) === 1 ||
        isDomesticListedMarket(market) ||
        !!w.is_listed);

    if (dupIdx >= 0) {
      const x = scored[dupIdx];
      const srcs = x.sources || (x.source ? [x.source] : []);
      if (!srcs.includes('ai_web')) x.sources = [...srcs, 'ai_web'];
      if (overseas) {
        x.overseas = true;
        x.domestic_listed = false;
        if (market) x.listing_market = market;
      } else if (domesticListed) {
        x.is_listed = true;
        if (market) x.listing_market = market;
        x.domestic_listed = isDomesticListedMarket(market) || domesticListed;
      }
      if (credit && !x.unified_credit_code) x.unified_credit_code = credit;
      // 联网 core_products 优先覆盖库内错绑/企查查空话，避免 S5 用错误画像压分（如欧拉/破壳）
      const webIntro = strTrim(w.core_products);
      if (webIntro) {
        x.web_core_products = webIntro;
        const prevIntro = strTrim(x.product_intro);
        const prevLooksBoilerplate =
          !prevIntro ||
          /经营范围包括|一般项目：|成立于|法定代表人|科技推广和应用服务业/.test(prevIntro);
        if (prevLooksBoilerplate || webIntro.length >= 16) {
          x.product_intro = webIntro;
        }
      }
      // product_intro 可能被联网结果升级，重算跑偏标记，避免沿用库内稀疏文本得出的旧值
      x._hasStrongOffTargetSignals = hasStrongOffTargetSignals(x);
      const rawRel = Number(w.ai_relevance_score);
      if (Number.isFinite(rawRel)) {
        const rel = Math.min(100, Math.max(0, rawRel));
        const webAi = Math.max(WEB_LISTED_AI_FLOOR, rel) || WEB_LISTED_AI_FLOOR;
        const prev = x.llmProductScore != null ? Number(x.llmProductScore) : 0;
        x.llmProductScore = Math.max(Number.isFinite(prev) ? prev : 0, webAi);
      }
      merged += 1;
      continue;
    }

    const rawRel = Number(w.ai_relevance_score);
    const rel = Number.isFinite(rawRel) ? Math.min(100, Math.max(0, rawRel)) : 0;
    const webAi = Math.max(WEB_LISTED_AI_FLOOR, rel) || WEB_LISTED_AI_FLOOR;
    const webIntroNew = strTrim(w.core_products);
    const webCandidate = {
      source: 'ai_web',
      sources: ['ai_web'],
      display_name: name,
      unified_credit_code: credit,
      is_listed: overseas ? !!w.is_listed : domesticListed,
      domestic_listed: overseas ? false : isDomesticListedMarket(market) || domesticListed,
      overseas: overseas || isOverseasCompetitorCandidate(webProbe),
      listing_market: market || null,
      product_intro: webIntroNew,
      web_core_products: webIntroNew || null,
      tags: [],
      internalScore: 0,
      hasInternal: false,
      llmProductScore: webAi,
      financing_amount_text: null,
    };
    webCandidate._hasStrongOffTargetSignals = hasStrongOffTargetSignals(webCandidate);
    scored.push(webCandidate);
    added += 1;
  }
  return { added, merged };
}

function mandateMeetsThreshold(c, row, persistThresholdOpts) {
  if (meetsPersistThreshold(c, row.finalScore, persistThresholdOpts)) return true;
  const hasOffTarget = c._hasStrongOffTargetSignals ?? hasStrongOffTargetSignals(c);
  if (hasOffTarget && Number(c?.validation?.validated_score) < 60) return false;
  const ai = getCandidateAiPart(c);
  const internal = Number(c.internalScore) || 0;
  const vs = Number(c.validation?.validated_score);
  const form = Number(c.formCustomerScore) || 0;
  const type = c.validation?.competitor_type;
  // same_track 且形态对齐很弱时，不拿来凑上市/未上市硬配额（仍允许其他路径落库）
  if (type === 'same_track' && form < 25 && (!Number.isFinite(vs) || vs < 40)) {
    return false;
  }
  if (isPersistValidationPassed(c) && Number.isFinite(vs) && vs >= 35) return true;
  if ((ai >= 40 || internal >= 28) && form >= 20) return true;
  if (ai >= 55 || internal >= 40) return true;
  return false;
}

function listedMandateMeetsThreshold(c, row, persistThresholdOpts) {
  if (!isDomesticListedCandidate(c)) return false;
  return mandateMeetsThreshold(c, row, persistThresholdOpts);
}

function unlistedMandateMeetsThreshold(c, row, persistThresholdOpts) {
  if (!isDomesticUnlistedCandidate(c)) return false;
  return mandateMeetsThreshold(c, row, persistThresholdOpts);
}

function countUnlistedInPersistRows(rows) {
  const keys = new Set();
  let n = 0;
  for (const row of rows || []) {
    const c = row._candidate || row;
    if (!isDomesticUnlistedCandidate(c)) continue;
    const k = candidateDedupeKey({
      unified_credit_code: row.unified_credit_code || c.unified_credit_code,
      display_name: row.display_name || c.display_name,
    });
    if (!k || keys.has(k)) continue;
    keys.add(k);
    n += 1;
  }
  return n;
}

function competitorTypeRank(c) {
  const t = c?.validation?.competitor_type;
  if (t === 'direct') return 4;
  if (t === 'indirect') return 3;
  if (t === 'substitute') return 2;
  if (t === 'same_track') return 1;
  return 0;
}

function sortDomesticListedCandidates(scored) {
  return [...(scored || [])]
    .filter(isDomesticListedCandidate)
    .sort((a, b) => {
      // 形态接近 + 竞品类型优先于「仅大类同轨」的凑数上市
      const formA = a.formCustomerScore || 0;
      const formB = b.formCustomerScore || 0;
      if (formB !== formA) return formB - formA;
      const tr = competitorTypeRank(b) - competitorTypeRank(a);
      if (tr !== 0) return tr;
      const coreA = a.coreLineScore || 0;
      const coreB = b.coreLineScore || 0;
      if (coreB !== coreA) return coreB - coreA;
      const sa = computeComprehensiveScore(a);
      const sb = computeComprehensiveScore(b);
      if (sb !== sa) return sb - sa;
      return (getCandidateAiPart(b) || 0) - (getCandidateAiPart(a) || 0);
    });
}

function sortUnlistedCandidates(scored) {
  return [...(scored || [])]
    .filter(isDomesticUnlistedCandidate)
    .sort((a, b) => {
      const tr = competitorTypeRank(b) - competitorTypeRank(a);
      if (tr !== 0) return tr;
      const formA = a.formCustomerScore || 0;
      const formB = b.formCustomerScore || 0;
      if (formB !== formA) return formB - formA;
      const coreA = a.coreLineScore || 0;
      const coreB = b.coreLineScore || 0;
      if (coreB !== coreA) return coreB - coreA;
      const sa = computeComprehensiveScore(a);
      const sb = computeComprehensiveScore(b);
      if (sb !== sa) return sb - sa;
      return (getCandidateAiPart(b) || 0) - (getCandidateAiPart(a) || 0);
    });
}

module.exports = {
  MIN_DOMESTIC_LISTED_COMPETITORS,
  MIN_UNLISTED_COMPETITORS,
  isDomesticListedCandidate,
  isDomesticUnlistedCandidate,
  isDomesticListedFromIpoPool,
  countDomesticListedInScored,
  countDomesticListedInPersistRows,
  buildListedDomesticDiscoverKeywords,
  mergeWebCandidatesIntoScored,
  listedMandateMeetsThreshold,
  unlistedMandateMeetsThreshold,
  countUnlistedInPersistRows,
  sortDomesticListedCandidates,
  sortUnlistedCandidates,
};
