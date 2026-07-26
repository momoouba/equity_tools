'use strict';

/**
 * 投前画像 donor：只读融资池 / 上市主档已有画像（§6.5）
 */

const { normalizeCreditCode, strTrim } = require('../competitor-analysis/competitorMatchUtils');
const { normalizeCompanyName } = require('../listing/zhconvUtils');
const { MIN_INTRO_LEN } = require('../project-sourcing/baikeLookupService');

function hasIntro(text) {
  return strTrim(text).length >= MIN_INTRO_LEN;
}

/**
 * @returns {Promise<{
 *   source: 'ipo_new_share'|'sourcing_financing_event',
 *   company_intro: string|null,
 *   product_intro: string|null,
 *   tags_display: string|null,
 *   tags_json: unknown,
 *   profile_source: string,
 * }|null>}
 */
async function findPreInvestmentProfileDonor(db, credit, name) {
  const creditNorm = normalizeCreditCode(credit);
  if (creditNorm) {
    const ns = await db.query(
      `SELECT company_intro, product_intro, industry_tags_display, industry_tags_json, profile_source
       FROM ipo_new_share
       WHERE TRIM(COALESCE(unified_credit_code, '')) = ?
         AND TRIM(COALESCE(product_intro, '')) <> ''
       LIMIT 1`,
      [creditNorm]
    );
    if (ns.length && hasIntro(ns[0].product_intro)) {
      return {
        source: 'ipo_new_share',
        company_intro: strTrim(ns[0].company_intro) || null,
        product_intro: strTrim(ns[0].product_intro),
        tags_display: strTrim(ns[0].industry_tags_display) || null,
        tags_json: ns[0].industry_tags_json,
        profile_source: strTrim(ns[0].profile_source) || 'listed_sync',
      };
    }

    const fin = await db.query(
      `SELECT company_intro, ai_product_intro, ai_company_tags_display, ai_company_tags_json, profile_source
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND TRIM(COALESCE(company_credit_code, '')) = ?
         AND (
           profile_source IN ('listed_sync', 'baike')
           OR TRIM(COALESCE(ai_product_intro, '')) <> ''
         )
       ORDER BY
         CASE profile_source WHEN 'listed_sync' THEN 0 WHEN 'baike' THEN 1 ELSE 2 END,
         F_LastModifyTime DESC
       LIMIT 1`,
      [creditNorm]
    );
    if (fin.length && hasIntro(fin[0].ai_product_intro)) {
      return {
        source: 'sourcing_financing_event',
        company_intro: strTrim(fin[0].company_intro) || null,
        product_intro: strTrim(fin[0].ai_product_intro),
        tags_display: strTrim(fin[0].ai_company_tags_display) || null,
        tags_json: fin[0].ai_company_tags_json,
        profile_source: strTrim(fin[0].profile_source) || 'donor',
      };
    }
  }

  const nameNorm = normalizeCompanyName(name);
  if (nameNorm) {
    const fin = await db.query(
      `SELECT company_intro, ai_product_intro, ai_company_tags_display, ai_company_tags_json, profile_source
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0
         AND TRIM(COALESCE(company_name, '')) = ?
         AND TRIM(COALESCE(ai_product_intro, '')) <> ''
       ORDER BY F_LastModifyTime DESC
       LIMIT 1`,
      [nameNorm]
    );
    if (fin.length) {
      return {
        source: 'sourcing_financing_event',
        company_intro: strTrim(fin[0].company_intro) || null,
        product_intro: strTrim(fin[0].ai_product_intro),
        tags_display: strTrim(fin[0].ai_company_tags_display) || null,
        tags_json: fin[0].ai_company_tags_json,
        profile_source: 'donor',
      };
    }
  }

  return null;
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

/**
 * donor 画像 fan-out 至同主体全部投前项目（含 3 年前记录）。
 */
async function applyDonorToPreInvFanOut(db, projectRow, donor) {
  const credit = normalizeCreditCode(projectRow.unified_credit_code);
  let clause;
  let params;
  if (credit) {
    clause = 'F_DeleteMark = 0 AND TRIM(unified_credit_code) = ?';
    params = [credit];
  } else {
    const nm = strTrim(projectRow.enterprise_full_name);
    if (!nm) return 0;
    clause = 'F_DeleteMark = 0 AND TRIM(enterprise_full_name) = ?';
    params = [nm];
  }

  const tagsJson = serializeTagsJson(donor.tags_json);
  const profileSource = donor.profile_source === 'listed_sync' ? 'listed_sync' : 'donor';

  const r = await db.execute(
    `UPDATE pre_investment_project SET
      company_intro = COALESCE(?, company_intro),
      product_intro = ?,
      ai_product_intro = ?,
      ai_industry_tags_display = COALESCE(?, ai_industry_tags_display),
      ai_industry_tags_json = COALESCE(?, ai_industry_tags_json),
      profile_source = ?,
      ai_enrich_status = 'skipped',
      pipeline_status = CASE WHEN pipeline_status = 'draft' THEN 'ai_done' ELSE pipeline_status END,
      F_LastModifyTime = CURRENT_TIMESTAMP
    WHERE ${clause}
      AND COALESCE(profile_source, '') NOT IN ('bp', 'llm_web')`,
    [
      donor.company_intro,
      donor.product_intro,
      donor.product_intro,
      donor.tags_display,
      tagsJson,
      profileSource,
      ...params,
    ]
  );
  return r.affectedRows || 0;
}

/**
 * 近 N 年投前项目列表（逐条处理 enrich；donor/bp/baike 可跳过）。
 */
async function loadPreInvestmentProjectsForEnrich(db, years) {
  return db.query(
    `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation,
            bp_extract_text, bp_filename, company_intro, product_intro, profile_source,
            baike_lemma_status, ai_product_intro, ai_enrich_status, F_CreatorTime
     FROM pre_investment_project
     WHERE F_DeleteMark = 0
       AND F_CreatorTime >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)
     ORDER BY F_CreatorTime DESC`,
    [years]
  );
}

function projectNeedsEnrich(row) {
  if (strTrim(row.profile_source) === 'bp' && hasIntro(row.product_intro)) return false;
  if (strTrim(row.profile_source) === 'listed_sync' && hasIntro(row.product_intro)) return false;
  if (strTrim(row.baike_lemma_status) === 'found' && hasIntro(row.product_intro)) return false;
  if (hasIntro(row.ai_product_intro)) return false;
  if (hasIntro(row.product_intro) && strTrim(row.profile_source) === 'baike') return false;
  return true;
}

module.exports = {
  findPreInvestmentProfileDonor,
  applyDonorToPreInvFanOut,
  loadPreInvestmentProjectsForEnrich,
  projectNeedsEnrich,
  hasIntro,
};
