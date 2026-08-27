'use strict';

const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { normalizeCompanyName } = require('../listing/zhconvUtils');
const { strTrim, normalizeCreditCode } = require('./competitorMatchUtils');
const {
  isValidMainlandUscc,
  isOverseasOrExemptCreditName,
} = require('./competitorCompanyMatch');

const OVERSEAS_LISTING_MARKETS = new Set([
  'hk',
  'hkex',
  'hkg',
  '港股',
  'nyse',
  'nasdaq',
  'otc',
  'lse',
  'tse',
]);

const _identityCache = new Map();

function clearDomesticIdentityCache() {
  _identityCache.clear();
}

function isOverseasListingMarket(market) {
  const m = strTrim(market).toLowerCase();
  if (!m) return false;
  if (OVERSEAS_LISTING_MARKETS.has(m)) return true;
  return /^(nyse|nasdaq|otc|lse|tse|hk)/.test(m);
}

/** 是否为境外/非中国大陆工商主体（用于名额统计与身份补齐分流，不再一律排除） */
function isOverseasCompetitorCandidate(c) {
  if (!c) return true;
  const name = strTrim(c.display_name || c.company_name);
  if (!name) return true;
  if (isOverseasOrExemptCreditName(name)) return true;

  const market = c.listing_market || c.validation?.listing_market;
  if (market && isOverseasListingMarket(market)) return true;

  const credit = normalizeCreditCode(c.unified_credit_code || c.company_credit_code);
  if (credit && credit.length >= 6 && !isValidMainlandUscc(credit)) {
    return true;
  }

  const latinOnly = /^[A-Za-z0-9\s.,&'\-()]+$/.test(name.replace(/\s+/g, ' ').trim());
  if (latinOnly && name.length > 3) return true;

  return false;
}

function parseRowTime(value) {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function officialNameScore(name) {
  const n = strTrim(name);
  if (!n) return 0;
  let score = n.length;
  if (n.includes('股份有限公司')) score += 500;
  else if (n.includes('有限公司')) score += 300;
  if (/[\u4e00-\u9fff]/.test(n)) score += 100;
  return score;
}

function pickBetterName(current, candidate, currentAt, candidateAt) {
  const cur = strTrim(current);
  const cand = strTrim(candidate);
  if (!cand) return { name: cur, at: currentAt };
  if (!cur) return { name: normalizeCompanyName(cand), at: candidateAt };

  const curT = parseRowTime(currentAt);
  const candT = parseRowTime(candidateAt);
  if (candT > curT) return { name: normalizeCompanyName(cand), at: candidateAt };
  if (curT > candT) return { name: normalizeCompanyName(cur), at: currentAt };

  const curScore = officialNameScore(cur);
  const candScore = officialNameScore(cand);
  return candScore >= curScore
    ? { name: normalizeCompanyName(cand), at: candidateAt }
    : { name: normalizeCompanyName(cur), at: currentAt };
}

function considerIdentity(state, name, code, at) {
  const n = strTrim(name);
  const c = normalizeCreditCode(code);
  if (c && isValidMainlandUscc(c)) {
    const upper = c.toUpperCase();
    if (!state.credit) state.credit = upper;
    else if (state.credit !== upper) return;
  }
  if (n) {
    const next = pickBetterName(state.bestName, n, state.bestAt, at);
    state.bestName = next.name;
    state.bestAt = next.at;
  }
}

function extractCompanyNameCore(name) {
  let n = normalizeCompanyName(strTrim(name));
  n = n.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  n = n.replace(/股份有限公司$/u, '').replace(/有限责任公司$/u, '').replace(/有限公司$/u, '').trim();
  return n;
}

async function queryIdentityRowsByNameFuzzy(inputName, psAppId) {
  const core = extractCompanyNameCore(inputName);
  if (core.length < 3) return [];

  const like = `%${core}%`;
  const rows = [];

  const finRows = await db.query(
    `SELECT company_name AS nm, company_credit_code AS cc, event_date AS ts
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND company_name LIKE ?
     ORDER BY event_date DESC
     LIMIT 8`,
    [like]
  );
  rows.push(...finRows);

  if (psAppId) {
    const ipoRows = await db.query(
      `SELECT company AS nm, unified_credit_code AS cc,
              COALESCE(F_LastModifyTime, biz_update_time) AS ts
       FROM ipo_project
       WHERE F_DeleteMark = 0 AND data_app_id = ?
         AND (company LIKE ? OR project_name LIKE ?)
       ORDER BY COALESCE(F_LastModifyTime, biz_update_time) DESC
       LIMIT 8`,
      [psAppId, like, like]
    );
    rows.push(...ipoRows);
  }

  const pipRows = await db.query(
    `SELECT enterprise_full_name AS nm, unified_credit_code AS cc, F_LastModifyTime AS ts
     FROM pre_investment_project
     WHERE F_DeleteMark = 0 AND enterprise_full_name LIKE ?
     ORDER BY F_LastModifyTime DESC
     LIMIT 5`,
    [like]
  );
  rows.push(...pipRows);

  return rows;
}

/**
 * 从内部主数据解析境内企业最新法定名称与 18 位统一社会信用代码。
 * @returns {Promise<{display_name:string, unified_credit_code:string}|null>}
 */
async function resolveDomesticCompetitorIdentity({ displayName, unifiedCreditCode }) {
  const inputName = strTrim(displayName);
  const inputCredit = normalizeCreditCode(unifiedCreditCode);
  const cacheKey = `${inputCredit}|${inputName}`;
  if (_identityCache.has(cacheKey)) return _identityCache.get(cacheKey);

  if (isOverseasOrExemptCreditName(inputName)) {
    _identityCache.set(cacheKey, null);
    return null;
  }

  const state = {
    credit: isValidMainlandUscc(inputCredit) ? inputCredit.toUpperCase() : '',
    bestName: normalizeCompanyName(inputName),
    bestAt: null,
  };

  const credit = state.credit;

  if (credit) {
    const pipRows = await db.query(
      `SELECT enterprise_full_name AS nm, unified_credit_code AS cc, F_LastModifyTime AS ts
       FROM pre_investment_project
       WHERE F_DeleteMark = 0 AND unified_credit_code = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 5`,
      [credit]
    );
    for (const r of pipRows) considerIdentity(state, r.nm, r.cc, r.ts);

    const ieRows = await db.query(
      `SELECT enterprise_full_name AS nm, unified_credit_code AS cc, F_LastModifyTime AS ts
       FROM invested_enterprises
       WHERE F_DeleteMark = 0 AND unified_credit_code = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 5`,
      [credit]
    );
    for (const r of ieRows) considerIdentity(state, r.nm, r.cc, r.ts);

    const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
    if (psAppId) {
      const ipoRows = await db.query(
        `SELECT company AS nm, unified_credit_code AS cc,
                COALESCE(F_LastModifyTime, biz_update_time) AS ts
         FROM ipo_project
         WHERE F_DeleteMark = 0 AND data_app_id = ? AND unified_credit_code = ?
         ORDER BY COALESCE(F_LastModifyTime, biz_update_time) DESC
         LIMIT 8`,
        [psAppId, credit]
      );
      for (const r of ipoRows) considerIdentity(state, r.nm, r.cc, r.ts);
    }

    const finRows = await db.query(
      `SELECT company_name AS nm, company_credit_code AS cc, event_date AS ts
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND company_credit_code = ?
       ORDER BY event_date DESC
       LIMIT 5`,
      [credit]
    );
    for (const r of finRows) considerIdentity(state, r.nm, r.cc, r.ts);
  }

  if (!state.credit && inputName) {
    const pipByName = await db.query(
      `SELECT enterprise_full_name AS nm, unified_credit_code AS cc, F_LastModifyTime AS ts
       FROM pre_investment_project
       WHERE F_DeleteMark = 0 AND TRIM(enterprise_full_name) = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 3`,
      [inputName]
    );
    for (const r of pipByName) considerIdentity(state, r.nm, r.cc, r.ts);

    const ieByName = await db.query(
      `SELECT enterprise_full_name AS nm, unified_credit_code AS cc, F_LastModifyTime AS ts
       FROM invested_enterprises
       WHERE F_DeleteMark = 0 AND TRIM(enterprise_full_name) = ?
       ORDER BY F_LastModifyTime DESC
       LIMIT 3`,
      [inputName]
    );
    for (const r of ieByName) considerIdentity(state, r.nm, r.cc, r.ts);

    const finByName = await db.query(
      `SELECT company_name AS nm, company_credit_code AS cc, event_date AS ts
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND TRIM(company_name) = ?
       ORDER BY event_date DESC
       LIMIT 5`,
      [inputName]
    );
    for (const r of finByName) considerIdentity(state, r.nm, r.cc, r.ts);

    const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
    if (psAppId) {
      const ipoByName = await db.query(
        `SELECT company AS nm, unified_credit_code AS cc,
                COALESCE(F_LastModifyTime, biz_update_time) AS ts
         FROM ipo_project
         WHERE F_DeleteMark = 0 AND data_app_id = ?
           AND (TRIM(company) = ? OR TRIM(project_name) = ?)
         ORDER BY COALESCE(F_LastModifyTime, biz_update_time) DESC
         LIMIT 5`,
        [psAppId, inputName, inputName]
      );
      for (const r of ipoByName) considerIdentity(state, r.nm, r.cc, r.ts);
    }

    if (!state.credit) {
      const psAppIdForFuzzy = psAppId || (await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS));
      const fuzzyRows = await queryIdentityRowsByNameFuzzy(inputName, psAppIdForFuzzy);
      for (const r of fuzzyRows) considerIdentity(state, r.nm, r.cc, r.ts);
    }
  }

  const result =
    state.credit && state.bestName && isValidMainlandUscc(state.credit)
      ? {
          display_name: state.bestName,
          unified_credit_code: state.credit,
        }
      : null;

  _identityCache.set(cacheKey, result);
  return result;
}

function applyDomesticIdentityToCandidate(c, identity) {
  if (!c || !identity?.display_name || !identity?.unified_credit_code) return false;
  c.display_name = identity.display_name;
  c.unified_credit_code = identity.unified_credit_code;
  return true;
}

async function normalizeDomesticCandidateIdentity(c) {
  if (!c || isOverseasCompetitorCandidate(c)) return null;
  const identity = await resolveDomesticCompetitorIdentity({
    displayName: c.display_name,
    unifiedCreditCode: c.unified_credit_code,
  });
  if (!identity) return null;
  applyDomesticIdentityToCandidate(c, identity);
  return identity;
}

function filterDomesticCompetitorCandidates(list) {
  return (list || []).filter((c) => c && !isOverseasCompetitorCandidate(c));
}

/**
 * 落库前：境内主体补齐法定名称与信用代码；境外主体保留名称（不占境内名额）。
 * @returns {Promise<object[]>}
 */
async function finalizePersistRows(rows, logCtx = {}) {
  const out = [];
  let skippedNoIdentity = 0;
  let keptOverseas = 0;
  let keptGoldNoUscc = 0;

  for (const row of rows || []) {
    const c = row._candidate;
    const probe = {
      display_name: row.display_name || c?.display_name,
      unified_credit_code: row.unified_credit_code || c?.unified_credit_code,
      listing_market: c?.listing_market || c?.validation?.listing_market,
    };

    if (isOverseasCompetitorCandidate(probe)) {
      const name = strTrim(row.display_name || probe.display_name);
      if (!name) continue;
      row.display_name = normalizeCompanyName(name);
      const credit = normalizeCreditCode(row.unified_credit_code || probe.unified_credit_code);
      row.unified_credit_code = credit || null;
      if (c) {
        c.display_name = row.display_name;
        c.unified_credit_code = row.unified_credit_code;
        c.overseas = true;
        c.domestic_listed = false;
      }
      out.push(row);
      keptOverseas += 1;
      continue;
    }

    const identity = await resolveDomesticCompetitorIdentity({
      displayName: row.display_name,
      unifiedCreditCode: row.unified_credit_code,
    });
    if (!identity) {
      const goldName = strTrim(row.display_name || c?.display_name);
      if (c?._fromGoldStandard && goldName) {
        row.display_name = normalizeCompanyName(goldName);
        row.unified_credit_code =
          normalizeCreditCode(row.unified_credit_code || c.unified_credit_code) || null;
        c.display_name = row.display_name;
        c.unified_credit_code = row.unified_credit_code;
        c.gold_name_only = !row.unified_credit_code;
        out.push(row);
        keptGoldNoUscc += 1;
        continue;
      }
      skippedNoIdentity += 1;
      continue;
    }

    row.display_name = identity.display_name;
    row.unified_credit_code = identity.unified_credit_code;
    if (c) applyDomesticIdentityToCandidate(c, identity);
    out.push(row);
  }

  if ((skippedNoIdentity > 0 || keptOverseas > 0 || keptGoldNoUscc > 0) && logCtx.runId) {
    const { logCompetitorRun } = require('./competitorAnalysisLogger');
    logCompetitorRun(logCtx.runId, 'S6_identity', '落库身份补齐', {
      kept: out.length,
      kept_overseas: keptOverseas,
      kept_gold_no_uscc: keptGoldNoUscc,
      skipped_no_uscc: skippedNoIdentity,
    });
  }

  return out;
}

/** @deprecated 使用 finalizePersistRows */
async function finalizeDomesticPersistRows(rows, logCtx = {}) {
  return finalizePersistRows(rows, logCtx);
}

module.exports = {
  clearDomesticIdentityCache,
  isOverseasListingMarket,
  isOverseasCompetitorCandidate,
  resolveDomesticCompetitorIdentity,
  applyDomesticIdentityToCandidate,
  normalizeDomesticCandidateIdentity,
  filterDomesticCompetitorCandidates,
  finalizePersistRows,
  finalizeDomesticPersistRows,
};
