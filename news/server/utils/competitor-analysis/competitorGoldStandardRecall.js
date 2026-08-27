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
const { namesMatchLoosely } = require('./competitorCompanyMatch');

/** 海外/简称金标：本地库无实体时的种子简介，避免 S3/S5「仅有名称」误杀 */
const GOLD_SEED_PRODUCT_INTRO = {
  ITM: '德国核药企业 ITM Isotope Technologies Munich，专注医用放射性同位素与核素偶联药物（RDC/TRT）的研发、生产与供应，覆盖镥-177 等治疗用核素及肿瘤靶向核药管线。',
  Curium: '全球核药龙头 Curium，主营诊断与治疗用放射性药物的研发、生产与商业化，产品矩阵覆盖 PET/SPECT 显像剂与肿瘤核素治疗，规模显著大于早期核药初创。',
  速康药业:
    '核药/放射性药物方向企业（反馈表金标种子；本地融资库暂无可靠工商全称，以名称召回）。',
  先通医药:
    '创新放射性药物研发生产商，管线覆盖神经退行性疾病、心血管与肿瘤核药；已有 Aβ-PET 等商业化产品，阶段/量级通常高于早期初创。',
};

function seedIntroForGoldName(name) {
  const n = strTrim(name);
  if (!n) return '';
  if (GOLD_SEED_PRODUCT_INTRO[n]) return GOLD_SEED_PRODUCT_INTRO[n];
  for (const [k, v] of Object.entries(GOLD_SEED_PRODUCT_INTRO)) {
    if (namesMatchLoosely(n, k)) return v;
  }
  return '';
}

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
       g.final_type,
       g.notes
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
      const seedIntro = seedIntroForGoldName(r.candidate_display_name);
      candidate = {
        source: source || 'gold_standard',
        source_id: String(refId || ''),
        display_name: strTrim(r.candidate_display_name),
        unified_credit_code: normalizeCreditCode(r.candidate_credit_code),
        product_intro: seedIntro,
        qcc_intro: '',
        tags: seedIntro ? ['核药', '放射性药物'] : [],
        industry_l1: null,
        industry_l2: null,
        industry_category_4: null,
        financing_amount_text: null,
        event_date: null,
        latest_round: null,
        _fromGoldStandard: true,
        _goldStandardType: r.final_type,
        _goldStandardIsCompetitor: true,
        ...(goldNotesExcludeComparable(r.notes) ? { _goldStandardComparableExclude: true } : {}),
      };
    } else {
      candidate._fromGoldStandard = true;
      candidate._goldStandardType = r.final_type;
      candidate._goldStandardIsCompetitor = true;
      if (goldNotesExcludeComparable(r.notes)) {
        candidate._goldStandardComparableExclude = true;
      }
      if (!strTrim(candidate.product_intro)) {
        const seedIntro = seedIntroForGoldName(r.candidate_display_name) || seedIntroForGoldName(candidate.display_name);
        if (seedIntro) candidate.product_intro = seedIntro;
      }
    }

    // 有信用代码但融资 ref 未命中时，按信用代码补一次融资画像
    if (
      candidate &&
      !strTrim(candidate.product_intro) &&
      normalizeCreditCode(r.candidate_credit_code)
    ) {
      const [finByCredit] = await db.query(
        `SELECT F_Id, company_name, project_name, company_credit_code,
                ai_product_intro, ai_company_tags_display, ai_company_tags_json,
                industry_std_lv1, industry_std_lv2, industry_category_4,
                funding_amt_raw, estimated_amt_raw, round, latest_round, event_date
         FROM sourcing_financing_event
         WHERE F_DeleteMark = 0 AND company_credit_code = ?
         ORDER BY event_date DESC, F_Id DESC
         LIMIT 1`,
        [normalizeCreditCode(r.candidate_credit_code)]
      );
      if (finByCredit) {
        const mapped = mapFinancingRow(finByCredit);
        candidate = {
          ...mapped,
          _fromGoldStandard: true,
          _goldStandardType: r.final_type,
          _goldStandardIsCompetitor: true,
          display_name: mapped.display_name || candidate.display_name,
        };
      }
    }

    if (exC && candidate.unified_credit_code === exC) continue;
    if (exN && strTrim(candidate.display_name).toLowerCase() === exN) continue;

    out.push(candidate);
  }

  return out;
}

/**
 * 加载目标下全部金标标注（含非竞品），供落库过滤 / 类型护栏 / checklist 使用。
 */
async function loadGoldStandardAnnotations(target) {
  if (!target) return [];
  const targetCredit = normalizeCreditCode(target.unified_credit_code);
  const targetName = strTrim(target.display_name);
  if (!targetCredit && !targetName) return [];
  const rows = await db.query(
    `SELECT candidate_display_name, candidate_credit_code, final_is_competitor, final_type, notes
     FROM competitor_gold_standard_pair
     WHERE F_DeleteMark = 0
       AND (target_credit_code = ? OR target_display_name = ?)`,
    [targetCredit || '', targetName]
  );
  return rows || [];
}

function matchGoldAnnotation(candidate, annotations) {
  if (!candidate || !annotations?.length) return null;
  const credit = normalizeCreditCode(candidate.unified_credit_code);
  const name = strTrim(candidate.display_name);
  for (const g of annotations) {
    const gc = normalizeCreditCode(g.candidate_credit_code);
    if (credit && gc && credit === gc) return g;
    if (namesMatchLoosely(name, g.candidate_display_name)) return g;
  }
  return null;
}

/** 金标备注：明确标注不应纳入可比（阶段/量级不可比等） */
function goldNotesExcludeComparable(notes) {
  const n = strTrim(notes);
  if (!n) return false;
  return /不应放入可比|量级不可比|阶段\/量级不可比|阶段差异.*不可比/.test(n);
}

/** 在 scored 池上标注金标正/负样本，供类型护栏与落库过滤 */
function annotateCandidatesWithGoldStandard(scored, annotations) {
  if (!scored?.length || !annotations?.length) return { positive: 0, negative: 0 };
  let positive = 0;
  let negative = 0;
  for (const c of scored) {
    const hit = matchGoldAnnotation(c, annotations);
    if (!hit) continue;
    const isComp = Number(hit.final_is_competitor) === 1;
    c._fromGoldStandard = c._fromGoldStandard || isComp;
    c._goldStandardType = hit.final_type || c._goldStandardType;
    c._goldStandardIsCompetitor = isComp;
    c._goldStandardNegative = !isComp;
    if (goldNotesExcludeComparable(hit.notes)) {
      c._goldStandardComparableExclude = true;
    }
    if (isComp) positive += 1;
    else negative += 1;
  }
  return { positive, negative };
}

module.exports = {
  recallGoldStandardCandidates,
  loadGoldStandardAnnotations,
  matchGoldAnnotation,
  annotateCandidatesWithGoldStandard,
  namesMatchLoosely,
  GOLD_SEED_PRODUCT_INTRO,
};
