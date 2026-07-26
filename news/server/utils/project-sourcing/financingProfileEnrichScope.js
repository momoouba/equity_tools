'use strict';

/**
 * 无百科词条融资企业 enrich 候选范围（三大类 × 时间窗）
 */

const { companyDedupeKey } = require('./listedFinancingJoin');
const { normalizeCreditCode, strTrim } = require('../competitor-analysis/competitorMatchUtils');
const { inferSubTrack } = require('./industryCategory4Map');
const { PRIORITY_CATEGORY_4 } = require('../competitor-analysis/structuredSchemaV1');
const { MIN_INTRO_LEN } = require('./baikeLookupService');
const { buildFinancingEventSinceClause } = require('./financingEventWindow');
const { parseCategoryList } = require('../competitor-analysis/priorityBatchScope');

const STRUCTURED_MIN_INTRO = 40;

function needsNoBaikeEnrich(row) {
  if (strTrim(row.baike_lemma_status) !== 'not_found') return false;
  if (!row.baike_lookup_at) return false;
  if (strTrim(row.listing_status) === 'matched') return false;
  const src = strTrim(row.profile_source);
  if (['listed_sync', 'bp', 'baike', 'llm_web'].includes(src)) return false;
  if (strTrim(row.ai_product_intro).length >= MIN_INTRO_LEN) return false;
  return true;
}

function pickBetterRepresentative(existing, row) {
  if (!existing) return row;
  const dt = String(row.event_date || '');
  const existingDt = String(existing.event_date || '');
  return dt > existingDt ? row : existing;
}

/**
 * @returns {Promise<Array<{
 *   company_name: string,
 *   company_credit_code: string|null,
 *   industry_category_4: string,
 *   sub_track: string|null,
 *   representative_event_id: number,
 *   qcc_company_intro: string,
 *   baike_lemma_status: string,
 *   last_event: string,
 * }>>}
 */
async function loadNoBaikeFinancingCandidates(db, opts = {}) {
  const categories = parseCategoryList(opts.categories);
  const since = buildFinancingEventSinceClause(opts);
  const placeholders = categories.map(() => '?').join(', ');

  const rows = await db.query(
    `SELECT F_Id AS id, company_name, company_credit_code, industry_category_4,
            industry_source_lv1, industry_source_lv2, event_date,
            baike_lemma_status, baike_lookup_at, listing_status, profile_source,
            ai_product_intro
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND ${since.clause}
       AND industry_category_4 IN (${placeholders})
       AND baike_lookup_at IS NOT NULL
       AND baike_lemma_status = 'not_found'
       AND COALESCE(listing_status, '') <> 'matched'
       AND COALESCE(profile_source, '') NOT IN ('listed_sync', 'bp', 'baike', 'llm_web')
       AND TRIM(COALESCE(ai_product_intro, '')) = ''`,
    [...since.params, ...categories]
  );

  const map = new Map();
  for (const row of rows) {
    if (!needsNoBaikeEnrich(row)) continue;
    const key = companyDedupeKey(row);
    const existing = map.get(key);
    map.set(key, pickBetterRepresentative(existing, row));
  }

  const out = [];
  for (const row of map.values()) {
    const category4 = strTrim(row.industry_category_4);
    out.push({
      company_name: strTrim(row.company_name),
      company_credit_code: normalizeCreditCode(row.company_credit_code) || null,
      industry_category_4: category4,
      industry_source_lv1: strTrim(row.industry_source_lv1) || null,
      industry_source_lv2: strTrim(row.industry_source_lv2) || null,
      sub_track:
        category4 === 'semi_mfg' ? inferSubTrack(category4, row.industry_source_lv1) : null,
      representative_event_id: Number(row.id),
      qcc_company_intro: '',
      baike_lemma_status: strTrim(row.baike_lemma_status) || 'not_found',
      last_event: String(row.event_date || ''),
    });
  }

  out.sort((a, b) => String(b.last_event).localeCompare(String(a.last_event)));
  return out;
}

/**
 * 按赛道限额抽样（试点默认每类 30 家）
 */
function sampleByCategory(candidates, perCategory, totalLimit = Infinity) {
  const buckets = { ai: [], bio: [], semi_mfg: [] };
  for (const c of candidates) {
    if (buckets[c.industry_category_4]) buckets[c.industry_category_4].push(c);
  }
  const out = [];
  for (const cat of PRIORITY_CATEGORY_4) {
    const take = Math.min(perCategory, buckets[cat]?.length || 0);
    out.push(...(buckets[cat] || []).slice(0, take));
  }
  if (Number.isFinite(totalLimit) && totalLimit > 0) {
    return out.slice(0, totalLimit);
  }
  return out;
}

module.exports = {
  loadNoBaikeFinancingCandidates,
  sampleByCategory,
  needsNoBaikeEnrich,
  STRUCTURED_MIN_INTRO,
  MIN_INTRO_LEN,
};
