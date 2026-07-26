'use strict';

/**
 * 融资池画像 donor：跨表只读 ipo_new_share / 融资池已有画像（§6.5）
 */

const { strTrim, normalizeCreditCode } = require('../competitor-analysis/competitorMatchUtils');
const { normalizeCompanyName } = require('../listing/zhconvUtils');
const { MIN_INTRO_LEN, buildFinancingFanOutWhere } = require('./baikeLookupService');
const {
  findPreInvestmentProfileDonor,
} = require('../competitor-analysis/preInvestmentProfileDonor');
const { AI_ENRICH_VERSION } = require('./financingAiEnrichService');

const DONOR_CHUNK = 400;

function hasIntro(text) {
  return strTrim(text).length >= MIN_INTRO_LEN;
}

function serializeTagsJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

async function findFinancingProfileDonor(db, credit, name) {
  return findPreInvestmentProfileDonor(db, credit, name);
}

function donorFromFinancingRow(row) {
  if (!row || !hasIntro(row.ai_product_intro)) return null;
  return {
    source: 'sourcing_financing_event',
    company_intro: strTrim(row.company_intro) || null,
    product_intro: strTrim(row.ai_product_intro),
    tags_display: strTrim(row.ai_company_tags_display) || null,
    tags_json: row.ai_company_tags_json,
    profile_source: strTrim(row.profile_source) || 'donor',
  };
}

function donorFromIpoRow(row) {
  if (!row || !hasIntro(row.product_intro)) return null;
  return {
    source: 'ipo_new_share',
    company_intro: strTrim(row.company_intro) || null,
    product_intro: strTrim(row.product_intro),
    tags_display: strTrim(row.industry_tags_display) || null,
    tags_json: row.industry_tags_json,
    profile_source: strTrim(row.profile_source) || 'listed_sync',
  };
}

/**
 * 批量 donor 索引（避免 6k+ 逐条 SQL）
 * @returns {Promise<{ byCredit: Map<string, object>, byName: Map<string, object> }>}
 */
async function buildFinancingProfileDonorIndex(db, candidates) {
  const credits = new Set();
  const namesNoCredit = new Set();
  for (const c of candidates) {
    const credit = normalizeCreditCode(c.company_credit_code);
    if (credit) credits.add(credit);
    else {
      const nm = normalizeCompanyName(strTrim(c.company_name));
      if (nm) namesNoCredit.add(nm);
    }
  }

  const byCredit = new Map();
  const byName = new Map();
  const creditList = [...credits];

  for (let i = 0; i < creditList.length; i += DONOR_CHUNK) {
    const chunk = creditList.slice(i, i + DONOR_CHUNK);
    const ph = chunk.map(() => '?').join(', ');

    const nsRows = await db.query(
      `SELECT unified_credit_code, company_intro, product_intro, industry_tags_display, industry_tags_json, profile_source
       FROM ipo_new_share
       WHERE TRIM(COALESCE(unified_credit_code, '')) IN (${ph})
         AND TRIM(COALESCE(product_intro, '')) <> ''`,
      chunk
    );
    for (const row of nsRows) {
      const c = normalizeCreditCode(row.unified_credit_code);
      const d = donorFromIpoRow(row);
      if (c && d && !byCredit.has(c)) byCredit.set(c, d);
    }

    const finRows = await db.query(
      `SELECT company_credit_code, company_intro, ai_product_intro, ai_company_tags_display,
              ai_company_tags_json, profile_source, ai_enrich_status
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0
         AND TRIM(COALESCE(company_credit_code, '')) IN (${ph})
         AND TRIM(COALESCE(ai_product_intro, '')) <> ''
       ORDER BY
         CASE profile_source WHEN 'listed_sync' THEN 0 WHEN 'baike' THEN 1 WHEN 'llm_web' THEN 2 ELSE 3 END,
         F_LastModifyTime DESC`,
      chunk
    );
    for (const row of finRows) {
      const c = normalizeCreditCode(row.company_credit_code);
      const d = donorFromFinancingRow(row);
      if (c && d && !byCredit.has(c)) byCredit.set(c, d);
    }
  }

  if (namesNoCredit.size) {
    const nameList = [...namesNoCredit];
    for (let i = 0; i < nameList.length; i += DONOR_CHUNK) {
      const chunk = nameList.slice(i, i + DONOR_CHUNK);
      const ph = chunk.map(() => '?').join(', ');
      const finRows = await db.query(
        `SELECT company_name, company_intro, ai_product_intro, ai_company_tags_display,
                ai_company_tags_json, profile_source
         FROM sourcing_financing_event
         WHERE F_DeleteMark = 0
           AND (company_credit_code IS NULL OR TRIM(company_credit_code) = '')
           AND TRIM(COALESCE(company_name, '')) IN (${ph})
           AND TRIM(COALESCE(ai_product_intro, '')) <> ''
         ORDER BY F_LastModifyTime DESC`,
        chunk
      );
      for (const row of finRows) {
        const nm = normalizeCompanyName(strTrim(row.company_name));
        const d = donorFromFinancingRow(row);
        if (nm && d && !byName.has(nm)) byName.set(nm, d);
      }
    }
  }

  return { byCredit, byName };
}

function lookupDonorFromIndex(index, credit, name) {
  const creditNorm = normalizeCreditCode(credit);
  if (creditNorm && index.byCredit.has(creditNorm)) {
    return index.byCredit.get(creditNorm);
  }
  const nameNorm = normalizeCompanyName(name);
  if (nameNorm && index.byName.has(nameNorm)) {
    return index.byName.get(nameNorm);
  }
  return null;
}

/**
 * donor 画像 fan-out 至融资池（跳过 listed_sync / bp / baike / llm_web / matched）
 * @returns {Promise<number>} affected rows
 */
async function applyFinancingProfileDonor(db, companyRow, donor) {
  const where = buildFinancingFanOutWhere(companyRow);
  if (!where || !donor || !hasIntro(donor.product_intro)) return 0;

  const profileSource =
    donor.profile_source === 'listed_sync'
      ? 'listed_sync'
      : donor.profile_source === 'baike'
        ? 'baike'
        : 'donor';

  const tagsJson = serializeTagsJson(donor.tags_json);
  const r = await db.execute(
    `UPDATE sourcing_financing_event SET
       company_intro = COALESCE(?, company_intro),
       ai_product_intro = ?,
       ai_company_tags_display = COALESCE(?, ai_company_tags_display),
       ai_company_tags_json = COALESCE(?, ai_company_tags_json),
       profile_source = CASE
         WHEN COALESCE(profile_source, '') IN ('listed_sync', 'bp', 'baike', 'llm_web') THEN profile_source
         WHEN COALESCE(listing_status, '') = 'matched' THEN profile_source
         ELSE ?
       END,
       ai_enrich_status = 'success',
       ai_enrich_at = COALESCE(ai_enrich_at, NOW()),
       ai_enrich_version = COALESCE(ai_enrich_version, ?),
       ai_enrich_error = NULL,
       F_LastModifyTime = NOW()
     WHERE ${where.clause}
       AND F_DeleteMark = 0
       AND TRIM(COALESCE(ai_product_intro, '')) = ''`,
    [
      donor.company_intro || null,
      donor.product_intro,
      donor.tags_display || null,
      tagsJson,
      profileSource,
      AI_ENRICH_VERSION,
      ...where.params,
    ]
  );
  return Number(r?.affectedRows || 0);
}

module.exports = {
  findFinancingProfileDonor,
  applyFinancingProfileDonor,
  buildFinancingProfileDonorIndex,
  lookupDonorFromIndex,
  hasIntro,
};
