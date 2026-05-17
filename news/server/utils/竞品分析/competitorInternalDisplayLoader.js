const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const {
  parseTagsFromJson,
  mergeTagArrays,
  strTrim,
  normalizeCreditCode,
} = require('./competitorMatchUtils');
const { parseFinancingTags } = require('./competitorMatchRecall');

function tagsFromIpoRow(row) {
  return mergeTagArrays(
    parseTagsFromJson(row.ai_industry_tags_json),
    strTrim(row.ai_industry_tags_display)
      ? strTrim(row.ai_industry_tags_display)
          .split(/[,，、]/g)
          .map((x) => x.trim())
          .filter(Boolean)
      : []
  );
}

function rowRichness(productIntro, tags) {
  return (strTrim(productIntro).length || 0) * 2 + (tags?.length || 0) * 8;
}

/**
 * 从底层项目（项目挖掘 data_app_id）与融资事件表读取产品介绍、企业标签。
 * 同一企业信用代码/公司名多行时取内容最丰富且最近更新的一条。
 */
async function loadInternalDisplayFields(unifiedCreditCode, companyName) {
  const credit = normalizeCreditCode(unifiedCreditCode);
  const name = strTrim(companyName);
  let productIntro = '';
  let tags = [];
  let ipoSubFunds = [];
  let bestScore = -1;

  const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);

  if (psAppId) {
    let ipoRows = [];
    if (credit.length >= 15) {
      ipoRows = await db.query(
        `SELECT ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, sub,
                F_LastModifyTime, biz_update_time
         FROM ipo_project
         WHERE F_DeleteMark = 0 AND data_app_id = ?
           AND unified_credit_code = ?
         ORDER BY COALESCE(F_LastModifyTime, biz_update_time) DESC
         LIMIT 20`,
        [psAppId, credit]
      );
    }
    if (!ipoRows.length && name) {
      ipoRows = await db.query(
        `SELECT ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, sub,
                F_LastModifyTime, biz_update_time
         FROM ipo_project
         WHERE F_DeleteMark = 0 AND data_app_id = ?
           AND TRIM(company) = ?
         ORDER BY COALESCE(F_LastModifyTime, biz_update_time) DESC
         LIMIT 20`,
        [psAppId, name]
      );
    }
    for (const row of ipoRows) {
      const intro = strTrim(row.ai_product_intro);
      const rowTags = tagsFromIpoRow(row);
      const score = rowRichness(intro, rowTags);
      if (score > bestScore) {
        bestScore = score;
        if (intro) productIntro = intro;
        if (rowTags.length) tags = rowTags;
      }
      const sub = strTrim(row.sub);
      if (sub && !ipoSubFunds.includes(sub)) ipoSubFunds.push(sub);
    }
  }

  let finRows = [];
  if (credit.length >= 15) {
    finRows = await db.query(
      `SELECT ai_product_intro, project_desc, ai_company_tags_display, ai_company_tags_json, event_date
       FROM sourcing_financing_event
       WHERE delete_mark = 0 AND company_credit_code = ?
       ORDER BY event_date DESC
       LIMIT 5`,
      [credit]
    );
  }
  if (!finRows.length && name) {
    finRows = await db.query(
      `SELECT ai_product_intro, project_desc, ai_company_tags_display, ai_company_tags_json, event_date
       FROM sourcing_financing_event
       WHERE delete_mark = 0 AND TRIM(company_name) = ?
       ORDER BY event_date DESC
       LIMIT 5`,
      [name]
    );
  }
  for (const row of finRows) {
    const intro = strTrim(row.ai_product_intro) || strTrim(row.project_desc);
    const rowTags = parseFinancingTags(row);
    const score = rowRichness(intro, rowTags);
    if (score > bestScore) {
      bestScore = score;
      if (intro) productIntro = intro;
      if (rowTags.length) tags = mergeTagArrays(tags, rowTags);
    } else {
      if (!productIntro && intro) productIntro = intro;
      if (rowTags.length) tags = mergeTagArrays(tags, rowTags);
    }
  }

  return {
    product_intro: productIntro || null,
    tags,
    ipo_sub_funds: ipoSubFunds,
  };
}

module.exports = {
  loadInternalDisplayFields,
};
