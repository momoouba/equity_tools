'use strict';

/**
 * 竞品分析：金标种子召回
 *
 * 当某个目标企业已有标注过的金标竞品时，先把这些竞品加入内部召回池，
 * 避免因为早期公司简介稀疏或 S2 规则分不足而漏召，降低对 S4 联网方差的依赖。
 */

const db = require('../../db');
const {
  parseTagsFromJson,
  mergeTagArrays,
  candidateDedupeKey,
  normalizeCreditCode,
  strTrim,
} = require('./competitorMatchUtils');
const { isDomesticExchange } = require('../listing/listedUniverseUtils');

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
    industry_category_4: strTrim(row.industry_category_4) || null,
    financing_amount_text: strTrim(row.funding_amt_raw) || strTrim(row.estimated_amt_raw),
    event_date: row.event_date,
    latest_round: strTrim(row.round) || strTrim(row.latest_round),
  };
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
    industry_category_4: null,
    financing_amount_text: null,
    event_date: row.biz_update_time || row.F_LastModifyTime || row.F_CreatorTime,
    ipo_sub: strTrim(row.sub) || null,
    is_listed: true,
    domestic_listed: true,
  };
}

function mapNewShareRow(row) {
  const tags = mergeTagArrays(
    parseTagsFromJson(row.industry_tags_json),
    strTrim(row.industry_tags_display)
      ? strTrim(row.industry_tags_display)
          .split(/[,，;/|]/g)
          .map((x) => x.trim())
          .filter(Boolean)
      : []
  );
  const exchange = strTrim(row.exchange);
  const domestic = isDomesticExchange(exchange);
  return {
    source: 'ipo_new_share',
    source_id: String(row.f_id),
    display_name:
      strTrim(row.enterprise_full_name_cn) ||
      strTrim(row.enterprise_full_name_display) ||
      strTrim(row.stock_name),
    unified_credit_code: normalizeCreditCode(row.unified_credit_code),
    product_intro: strTrim(row.product_intro) || strTrim(row.company_intro),
    qcc_intro: strTrim(row.company_intro),
    tags,
    industry_l1: strTrim(row.sw_industry_l1) || strTrim(row.industry_category_4) || null,
    industry_l2: strTrim(row.sw_industry_l2) || null,
    industry_category_4: strTrim(row.industry_category_4) || null,
    financing_amount_text: null,
    event_date: row.public_date || row.F_LastModifyTime || row.F_CreatorTime,
    ipo_sub: null,
    is_listed: true,
    domestic_listed: domestic,
    listed_stock_code: strTrim(row.stock_code) || null,
    listing_market: exchange || null,
  };
}

async function recallGoldStandardCandidates(target, excludeCredit, excludeName) {
  if (!target) return [];
  const targetCredit = normalizeCreditCode(target.unified_credit_code);
  const targetName = strTrim(target.display_name);
  if (!targetCredit && !targetName) return [];

  const rows = await db.query(
    `SELECT DISTINCT
       g.candidate_source,
       g.candidate_ref_id,
       g.candidate_display_name,
       g.candidate_credit_code,
       g.final_type
     FROM competitor_gold_standard_pair g
     WHERE g.F_DeleteMark = 0
       AND g.final_is_competitor = 1
       AND (g.target_credit_code = ? OR g.target_display_name = ?)`,
    [targetCredit || '', targetName]
  );

  if (!rows?.length) return [];

  const out = [];
  const exC = normalizeCreditCode(excludeCredit);
  const exN = strTrim(excludeName).toLowerCase();

  for (const r of rows) {
    const source = strTrim(r.candidate_source);
    const refId = r.candidate_ref_id;
    let candidate = null;

    if (source === 'sourcing_financing_event' && refId) {
      const [fin] = await db.query(
        `SELECT F_Id, company_name, project_name, company_credit_code,
                ai_product_intro, ai_company_tags_display, ai_company_tags_json,
                industry_std_lv1, industry_std_lv2, industry_category_4,
                funding_amt_raw, estimated_amt_raw, round, latest_round, event_date
         FROM sourcing_financing_event
         WHERE F_Id = ? AND F_DeleteMark = 0
         LIMIT 1`,
        [refId]
      );
      if (fin) candidate = mapFinancingRow(fin);
    } else if (source === 'ipo_project' && refId) {
      const [ipo] = await db.query(
        `SELECT F_Id, project_name, company, unified_credit_code, sub,
                ai_product_intro, ai_industry_tags_display, ai_industry_tags_json,
                qcc_company_intro, biz_update_time, F_LastModifyTime, F_CreatorTime
         FROM ipo_project
         WHERE F_Id = ? AND F_DeleteMark = 0
         LIMIT 1`,
        [refId]
      );
      if (ipo) candidate = mapIpoRow(ipo);
    } else if (source === 'ipo_new_share' && refId) {
      const [ns] = await db.query(
        `SELECT F_Id, stock_code, stock_name, exchange,
                enterprise_full_name_cn, enterprise_full_name_display,
                unified_credit_code, sw_industry_l1, sw_industry_l2, industry_category_4,
                product_intro, company_intro, industry_tags_display, industry_tags_json,
                public_date, F_LastModifyTime, F_CreatorTime
         FROM ipo_new_share
         WHERE F_Id = ?
         LIMIT 1`,
        [refId]
      );
      if (ns) candidate = mapNewShareRow(ns);
    }

    if (!candidate) {
      // 候选暂时查不到实体记录时，用金标信息构造一个轻量候选，后续 enrich 补齐
      candidate = {
        source: source || 'gold_standard',
        source_id: String(refId || ''),
        display_name: strTrim(r.candidate_display_name),
        unified_credit_code: normalizeCreditCode(r.candidate_credit_code),
        product_intro: '',
        qcc_intro: '',
        tags: [],
        industry_l1: null,
        industry_l2: null,
        industry_category_4: null,
        financing_amount_text: null,
        event_date: null,
        latest_round: null,
        _fromGoldStandard: true,
        _goldStandardType: r.final_type,
      };
    } else {
      candidate._fromGoldStandard = true;
      candidate._goldStandardType = r.final_type;
    }

    if (exC && candidate.unified_credit_code === exC) continue;
    if (exN && strTrim(candidate.display_name).toLowerCase() === exN) continue;

    out.push(candidate);
  }

  return out;
}

module.exports = {
  recallGoldStandardCandidates,
};
