'use strict';

/**
 * Stage 3 优先行业批范围：三大类（ai/bio/semi_mfg）× 近 N 年
 */

const { companyDedupeKey } = require('../project-sourcing/listedFinancingJoin');
const { normalizeCreditCode, strTrim } = require('./competitorMatchUtils');
const { inferSubTrack } = require('../project-sourcing/industryCategory4Map');
const { PRIORITY_CATEGORY_4 } = require('./structuredSchemaV1');
const {
  DEFAULT_EVENT_SINCE,
  buildFinancingEventSinceClause,
  buildPreInvSinceClause,
} = require('../project-sourcing/financingEventWindow');

function parseCategoryList(raw) {
  if (!raw) return [...PRIORITY_CATEGORY_4];
  const list = String(raw)
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter((x) => PRIORITY_CATEGORY_4.includes(x));
  return list.length ? list : [...PRIORITY_CATEGORY_4];
}

/**
 * Stage 3 优先行业批范围：三大类 × 自 2025-01-01 起有融资事件的企业
 * 画像/structured 查词后 fan-out 至该企业全部历史行（反向填充）
 */
async function loadPriorityFinancingCompanies(db, opts = {}) {
  const categories = parseCategoryList(opts.categories);
  const skipStructured = opts.skipStructured !== false;
  const placeholders = categories.map(() => '?').join(', ');
  const since = buildFinancingEventSinceClause(opts);

  const rows = await db.query(
    `SELECT company_name, company_credit_code, industry_category_4,
            industry_source_lv1, industry_source_lv2,
            MAX(event_date) AS last_event,
            MAX(CASE WHEN structured_profile_json IS NOT NULL AND TRIM(CAST(structured_profile_json AS CHAR)) NOT IN ('', 'null') THEN 1 ELSE 0 END) AS has_structured
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND ${since.clause}
       AND industry_category_4 IN (${placeholders})
     GROUP BY company_credit_code, company_name, industry_category_4,
              industry_source_lv1, industry_source_lv2`,
    [...since.params, ...categories]
  );

  const map = new Map();
  for (const row of rows) {
    const key = companyDedupeKey(row);
    const dt = String(row.last_event || '');
    const existing = map.get(key);
    if (!existing || dt > String(existing.last_event || '')) {
      const category4 = strTrim(row.industry_category_4);
      map.set(key, {
        company_name: strTrim(row.company_name),
        company_credit_code: normalizeCreditCode(row.company_credit_code) || null,
        industry_category_4: category4,
        industry_source_lv1: strTrim(row.industry_source_lv1) || null,
        industry_source_lv2: strTrim(row.industry_source_lv2) || null,
        sub_track:
          category4 === 'semi_mfg'
            ? inferSubTrack(category4, row.industry_source_lv1)
            : null,
        last_event: row.last_event,
        has_intro: false,
        has_structured: Number(row.has_structured) > 0,
      });
    }
  }

  await attachIntroFanOutFlags(db, [...map.values()]);

  let list = [...map.values()];
  if (skipStructured) list = list.filter((c) => !c.has_structured);
  return list;
}

async function attachIntroFanOutFlags(db, companies) {
  const creditHits = await db.query(
    `SELECT DISTINCT TRIM(company_credit_code) AS c
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND TRIM(COALESCE(company_credit_code, '')) <> ''
       AND TRIM(COALESCE(ai_product_intro, '')) <> ''`
  );
  const nameHits = await db.query(
    `SELECT DISTINCT TRIM(company_name) AS n
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND (company_credit_code IS NULL OR TRIM(company_credit_code) = '')
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND TRIM(COALESCE(ai_product_intro, '')) <> ''`
  );
  const creditSet = new Set(creditHits.map((r) => r.c));
  const nameSet = new Set(nameHits.map((r) => r.n));
  for (const c of companies) {
    const credit = normalizeCreditCode(c.company_credit_code);
    c.has_intro = credit ? creditSet.has(credit) : nameSet.has(strTrim(c.company_name));
  }
}

async function countPriorityFinancingByCategory(db, opts = {}) {
  const since = buildFinancingEventSinceClause(opts);
  const rows = await db.query(
    `SELECT industry_category_4 AS cat, COUNT(DISTINCT CONCAT(COALESCE(company_credit_code,''), '\\0', company_name)) AS c
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND ${since.clause}
       AND industry_category_4 IN ('ai', 'bio', 'semi_mfg')
     GROUP BY industry_category_4`,
    since.params
  );
  return Object.fromEntries(rows.map((r) => [r.cat, Number(r.c || 0)]));
}

/**
 * 近 N 年投前；赛道由同信用代码融资行推断，否则跳过（样本少）
 */
async function loadPriorityPreInvestmentProjects(db, opts = {}) {
  const categories = parseCategoryList(opts.categories);
  const skipStructured = opts.skipStructured !== false;
  const placeholders = categories.map(() => '?').join(', ');
  const since = buildPreInvSinceClause(opts);
  const finSince = buildFinancingEventSinceClause(opts);

  const rows = await db.query(
    `SELECT p.F_Id, p.enterprise_full_name, p.unified_credit_code, p.project_abbreviation,
            p.company_intro, p.product_intro, p.ai_product_intro, p.bp_extract_text, p.profile_source,
            p.structured_profile_json, p.F_CreatorTime,
            (
              SELECT s.industry_category_4
              FROM sourcing_financing_event s
              WHERE s.F_DeleteMark = 0
                AND TRIM(COALESCE(s.company_credit_code, '')) <> ''
                AND TRIM(s.company_credit_code) = TRIM(COALESCE(p.unified_credit_code, ''))
                AND s.industry_category_4 IN (${placeholders})
                AND ${finSince.clause.replace(/event_date/g, 's.event_date')}
              ORDER BY s.event_date DESC
              LIMIT 1
            ) AS industry_category_4,
            (
              SELECT s.industry_source_lv1
              FROM sourcing_financing_event s
              WHERE s.F_DeleteMark = 0
                AND TRIM(COALESCE(s.company_credit_code, '')) <> ''
                AND TRIM(s.company_credit_code) = TRIM(COALESCE(p.unified_credit_code, ''))
                AND ${finSince.clause.replace(/event_date/g, 's.event_date')}
              ORDER BY s.event_date DESC
              LIMIT 1
            ) AS industry_source_lv1
     FROM pre_investment_project p
     WHERE p.F_DeleteMark = 0
       AND TRIM(COALESCE(p.enterprise_full_name, '')) <> ''
       AND ${since.clause}
     HAVING industry_category_4 IS NOT NULL`,
    [...categories, ...finSince.params, ...finSince.params, ...since.params]
  );

  return rows
    .map((row) => ({
      F_Id: row.F_Id,
      enterprise_full_name: strTrim(row.enterprise_full_name),
      unified_credit_code: normalizeCreditCode(row.unified_credit_code) || null,
      industry_category_4: strTrim(row.industry_category_4),
      sub_track:
        strTrim(row.industry_category_4) === 'semi_mfg'
          ? inferSubTrack('semi_mfg', row.industry_source_lv1)
          : null,
      has_intro:
        strTrim(row.ai_product_intro).length >= 20 ||
        strTrim(row.product_intro).length >= 20 ||
        strTrim(row.bp_extract_text).length >= 20,
      has_structured:
        row.structured_profile_json != null && strTrim(row.structured_profile_json).length > 2,
      profile_source: strTrim(row.profile_source) || null,
    }))
    .filter((row) => categories.includes(row.industry_category_4))
    .filter((row) => (skipStructured ? !row.has_structured : true));
}

module.exports = {
  PRIORITY_CATEGORY_4,
  DEFAULT_EVENT_SINCE,
  parseCategoryList,
  loadPriorityFinancingCompanies,
  countPriorityFinancingByCategory,
  loadPriorityPreInvestmentProjects,
};
