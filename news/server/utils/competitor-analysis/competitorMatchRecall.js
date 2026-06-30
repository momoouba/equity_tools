const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const {
  parseTagsFromJson,
  mergeTagArrays,
  candidateDedupeKey,
  normalizeCreditCode,
  strTrim,
} = require('./competitorMatchUtils');

const IPO_YEARS = 3;
const FIN_YEARS = 3;
const RECALL_LIMIT = 3000;
const RECALL_LISTED_BY_PRODUCT_LIMIT = 120;

const IPO_RECALL_SELECT = `SELECT F_Id AS f_id, project_name, company, unified_credit_code, sub,
            ai_product_intro, ai_industry_tags_display, ai_industry_tags_json,
            qcc_company_intro, biz_update_time, F_LastModifyTime, F_CreatorTime
     FROM ipo_project
     WHERE F_DeleteMark = 0
       AND data_app_id = ?
       AND (
         TRIM(IFNULL(ai_product_intro, '')) <> ''
         OR TRIM(IFNULL(ai_industry_tags_display, '')) <> ''
         OR ai_industry_tags_json IS NOT NULL
       )`;

function parseFinancingTags(row) {
  const fromJson = parseTagsFromJson(row.ai_company_tags_json);
  const disp = strTrim(row.ai_company_tags_display);
  const fromDisp = disp
    ? disp
        .split(/[,，、]/g)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  return mergeTagArrays(fromJson, fromDisp);
}

function mapIpoRow(row) {
  const tags = mergeTagArrays(
    parseTagsFromJson(row.ai_industry_tags_json),
    strTrim(row.ai_industry_tags_display)
      ? strTrim(row.ai_industry_tags_display)
          .split(/[,，、]/g)
          .map((x) => x.trim())
          .filter(Boolean)
      : []
  );
  return {
    source: 'ipo_project',
    source_id: String(row.f_id),
    display_name: strTrim(row.company) || strTrim(row.project_name),
    unified_credit_code: normalizeCreditCode(row.unified_credit_code),
    product_intro: strTrim(row.ai_product_intro),
    qcc_intro: strTrim(row.qcc_company_intro),
    tags,
    industry_l1: null,
    industry_l2: null,
    financing_amount_text: null,
    event_date: row.biz_update_time || row.F_LastModifyTime || row.F_CreatorTime,
    ipo_sub: strTrim(row.sub) || null,
    is_listed: true,
    domestic_listed: true,
  };
}

function mapFinancingRow(row) {
  return {
    source: 'sourcing_financing_event',
    source_id: String(row.F_Id),
    display_name: strTrim(row.company_name) || strTrim(row.project_name),
    unified_credit_code: normalizeCreditCode(row.company_credit_code),
    product_intro: strTrim(row.ai_product_intro) || strTrim(row.project_desc),
    qcc_intro: null,
    tags: parseFinancingTags(row),
    industry_l1: strTrim(row.industry_std_lv1),
    industry_l2: strTrim(row.industry_std_lv2),
    financing_amount_text: strTrim(row.funding_amt_raw) || strTrim(row.estimated_amt_raw),
    event_date: row.event_date,
    latest_round: strTrim(row.round) || strTrim(row.latest_round),
  };
}

/**
 * 底层项目池召回（项目挖掘 data_app_id，近 3 年有更新，具备 AI 简介或标签）。
 */
async function recallFromIpoProjects(excludeCredit, excludeName) {
  const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!psAppId) return [];
  const rows = await db.query(
    `${IPO_RECALL_SELECT}
       AND COALESCE(F_LastModifyTime, biz_update_time, F_CreatorTime) >= DATE_SUB(NOW(), INTERVAL ? YEAR)
     ORDER BY COALESCE(F_LastModifyTime, biz_update_time, F_CreatorTime) DESC
     LIMIT ?`,
    [psAppId, IPO_YEARS, RECALL_LIMIT]
  );
  return filterExcludedIpoRows(rows, excludeCredit, excludeName);
}

/**
 * 按目标核心产品线/同义词在 ipo 池定向召回上市公司（不受 3000 条时间排序截断影响）。
 */
async function recallListedIpoByProductTerms(target, excludeCredit, excludeName) {
  const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!psAppId || !target) return [];
  const { expandProductLineSearchTerms } = require('./competitorProductLineUtils');
  const introBlob = [target.product_intro, target.qcc_intro_effective].filter(Boolean).join('\n');
  const terms = expandProductLineSearchTerms(target.core_product_lines, introBlob);
  if (!terms.length) return [];

  const termClauses = [];
  const params = [psAppId];
  for (const term of terms.slice(0, 10)) {
    const like = `%${term}%`;
    termClauses.push(
      `(ai_product_intro LIKE ? OR ai_industry_tags_display LIKE ? OR qcc_company_intro LIKE ? OR company LIKE ? OR project_name LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }
  params.push(RECALL_LISTED_BY_PRODUCT_LIMIT);

  const rows = await db.query(
    `${IPO_RECALL_SELECT}
       AND (${termClauses.join(' OR ')})
     ORDER BY COALESCE(F_LastModifyTime, biz_update_time, F_CreatorTime) DESC
     LIMIT ?`,
    params
  );
  return filterExcludedIpoRows(rows, excludeCredit, excludeName);
}

function filterExcludedIpoRows(rows, excludeCredit, excludeName) {
  const exC = normalizeCreditCode(excludeCredit);
  const exN = strTrim(excludeName).toLowerCase();
  const out = [];
  for (const r of rows) {
    const mapped = mapIpoRow(r);
    if (exC && mapped.unified_credit_code === exC) continue;
    if (exN && strTrim(mapped.display_name).toLowerCase() === exN) continue;
    out.push(mapped);
  }
  return dedupeRecalledByCompanyKey(out);
}

function recallRichness(item) {
  return (
    (strTrim(item.product_intro).length || 0) * 2 +
    (item.tags?.length || 0) * 8 +
    (strTrim(item.qcc_intro).length || 0)
  );
}

/** 底层/融资召回：按企业信用代码或公司名去重，保留内容最丰富的一条（data_app_id 已在 SQL 限定）。 */
function dedupeRecalledByCompanyKey(list) {
  const map = new Map();
  for (const item of list) {
    const key = candidateDedupeKey(item);
    const prev = map.get(key);
    if (!prev || recallRichness(item) > recallRichness(prev)) {
      map.set(key, item);
    } else if (item.ipo_sub && prev) {
      if (!prev.ipo_sub) prev.ipo_sub = item.ipo_sub;
    }
  }
  return [...map.values()];
}

/**
 * 融资事件池：近 3 年，按企业信用代码/公司名取最近一条 event_date。
 */
async function recallFromFinancingEvents(excludeCredit, excludeName) {
  const rows = await db.query(
    `SELECT e.F_Id, e.company_name, e.company_credit_code, e.project_name, e.project_desc,
            e.ai_product_intro, e.ai_company_tags_display, e.ai_company_tags_json,
            e.industry_std_lv1, e.industry_std_lv2, e.funding_amt_raw, e.estimated_amt_raw,
            e.round, e.latest_round, e.event_date
     FROM sourcing_financing_event e
     INNER JOIN (
       SELECT
         COALESCE(NULLIF(TRIM(company_credit_code), ''), CONCAT('nm:', TRIM(company_name))) AS grp_key,
         MAX(event_date) AS max_dt
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0
         AND event_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)
         AND (
           TRIM(IFNULL(ai_product_intro, '')) <> ''
           OR TRIM(IFNULL(ai_company_tags_display, '')) <> ''
           OR ai_company_tags_json IS NOT NULL
         )
       GROUP BY grp_key
     ) t ON COALESCE(NULLIF(TRIM(e.company_credit_code), ''), CONCAT('nm:', TRIM(e.company_name))) = t.grp_key
        AND e.event_date = t.max_dt
     WHERE e.F_DeleteMark = 0
     ORDER BY e.event_date DESC
     LIMIT ?`,
    [FIN_YEARS, RECALL_LIMIT]
  );
  const exC = normalizeCreditCode(excludeCredit);
  const exN = strTrim(excludeName).toLowerCase();
  const out = [];
  for (const r of rows) {
    const mapped = mapFinancingRow(r);
    if (exC && mapped.unified_credit_code === exC) continue;
    if (exN && strTrim(mapped.display_name).toLowerCase() === exN) continue;
    out.push(mapped);
  }
  return dedupeRecalledByCompanyKey(out);
}

/** 合并双源候选（同键保留双源标记）。 */
function parseRecallEventDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mergeRecalledCandidates(ipoList, finList) {
  const map = new Map();
  const add = (item) => {
    const key = candidateDedupeKey(item);
    const prev = map.get(key);
    if (!prev) {
      const subs = item.ipo_sub ? [item.ipo_sub] : [];
      map.set(key, { ...item, sources: [item.source], ipo_sub_funds: subs });
      return;
    }
    if (!prev.unified_credit_code && item.unified_credit_code) {
      prev.unified_credit_code = item.unified_credit_code;
    }
    if (
      strTrim(item.display_name).length > strTrim(prev.display_name).length &&
      /[\u4e00-\u9fff]/.test(item.display_name || '')
    ) {
      prev.display_name = item.display_name;
    }
    if (!prev.sources.includes(item.source)) prev.sources.push(item.source);
    if (item.ipo_sub) {
      if (!prev.ipo_sub_funds) prev.ipo_sub_funds = [];
      if (!prev.ipo_sub_funds.includes(item.ipo_sub)) prev.ipo_sub_funds.push(item.ipo_sub);
    }
    if (
      recallRichness({ product_intro: item.product_intro, tags: item.tags }) >
      recallRichness({ product_intro: prev.product_intro, tags: prev.tags })
    ) {
      if (item.product_intro) prev.product_intro = item.product_intro;
      if (item.tags?.length) prev.tags = item.tags;
      if (item.qcc_intro) prev.qcc_intro = item.qcc_intro;
    } else {
      if (!prev.product_intro && item.product_intro) prev.product_intro = item.product_intro;
      if (!prev.tags?.length && item.tags?.length) prev.tags = item.tags;
    }
    if (!prev.industry_l1 && item.industry_l1) prev.industry_l1 = item.industry_l1;
    if (!prev.industry_l2 && item.industry_l2) prev.industry_l2 = item.industry_l2;
    if (!prev.financing_amount_text && item.financing_amount_text) {
      prev.financing_amount_text = item.financing_amount_text;
    }
    const prevDt = parseRecallEventDate(prev.event_date);
    const itemDt = parseRecallEventDate(item.event_date);
    if (itemDt && (!prevDt || itemDt > prevDt)) {
      prev.event_date = item.event_date;
    }
  };
  for (const x of ipoList) add(x);
  for (const x of finList) add(x);
  return [...map.values()];
}

module.exports = {
  recallFromIpoProjects,
  recallListedIpoByProductTerms,
  recallFromFinancingEvents,
  mergeRecalledCandidates,
  parseFinancingTags,
};
