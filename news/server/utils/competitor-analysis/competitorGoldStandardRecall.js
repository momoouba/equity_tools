'use strict';

/**
 * 竞品分析：用户可比金标种子召回
 *
 * 金标只来自用户在竞品分析后勾选「放入可比公司」的企业，不读取人工导入的
 * competitor_gold_standard_pair 批次。下一轮分析把这些公司优先召回、标注。
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
const {
  namesMatchLoosely,
  nameMatchTightness,
  extractBrandSearchToken,
  creditBoundNameConsistent,
} = require('./competitorCompanyMatch');
const { normalizeDomesticCandidateIdentity } = require('./competitorDomesticIdentityUtils');

const FIN_SELECT = `F_Id, company_name, project_name, company_credit_code, project_desc,
                ai_product_intro, ai_company_tags_display, ai_company_tags_json,
                industry_std_lv1, industry_std_lv2, industry_category_4,
                funding_amt_raw, estimated_amt_raw, round, latest_round, event_date`;

function hasFinancingIntro(row) {
  return !!(
    strTrim(row?.ai_product_intro) ||
    strTrim(row?.ai_company_tags_display) ||
    row?.ai_company_tags_json
  );
}

function searchNameToken(name) {
  const n = strTrim(name)
    .replace(/[（(].*?[）)]/g, '')
    .replace(/(股份有限公司|有限责任公司|有限公司|集团|控股)$/g, '')
    .trim();
  if (n.length >= 2 && n.length <= 24) return n;
  return strTrim(name).slice(0, 16);
}

function parsePrefCompetitorKey(key) {
  const k = strTrim(key);
  if (k.startsWith('cc:')) return { credit: normalizeCreditCode(k.slice(3)), name: '' };
  if (k.startsWith('name:')) return { credit: '', name: strTrim(k.slice(5)) };
  return { credit: '', name: k };
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

async function resolveFinancingEntity(credit, name) {
  const code = normalizeCreditCode(credit);
  if (code) {
    const rows = await db.query(
      `SELECT ${FIN_SELECT}
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND company_credit_code = ?
       ORDER BY (TRIM(IFNULL(ai_product_intro, '')) <> '') DESC, event_date DESC, F_Id DESC
       LIMIT 3`,
      [code]
    );
    const finHit = (rows || []).find((r) => creditBoundNameConsistent(name, r.company_name));
    if (finHit) return mapFinancingRow(finHit);
    const [ipo] = await db.query(
      `SELECT F_Id AS f_id, project_name, company, unified_credit_code, sub,
              ai_product_intro, ai_industry_tags_display, ai_industry_tags_json,
              qcc_company_intro, biz_update_time, F_LastModifyTime, F_CreatorTime
       FROM ipo_project
       WHERE F_DeleteMark = 0 AND unified_credit_code = ?
       LIMIT 1`,
      [code]
    );
    if (ipo && creditBoundNameConsistent(name, ipo.company || ipo.project_name)) {
      return mapIpoRow(ipo);
    }
  }
  const tokens = [extractBrandSearchToken(name), searchNameToken(name)].filter(
    (t, i, arr) => t && t.length >= 2 && arr.indexOf(t) === i
  );
  for (const token of tokens) {
    const rows = await db.query(
      `SELECT ${FIN_SELECT}
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND company_name LIKE ?
       ORDER BY (TRIM(IFNULL(ai_product_intro, '')) <> '') DESC, event_date DESC, F_Id DESC
       LIMIT 40`,
      [`%${token}%`]
    );
    const hits = (rows || [])
      .filter((r) => namesMatchLoosely(r.company_name, name))
      .sort(
        (x, y) =>
          nameMatchTightness(name, y.company_name) - nameMatchTightness(name, x.company_name)
      );
    const hit = hits.find((r) => hasFinancingIntro(r)) || hits[0] || null;
    if (hit) return mapFinancingRow(hit);
  }
  return null;
}

function markUserComparable(candidate, type) {
  if (!candidate) return null;
  candidate.source = candidate.source || 'user_comparable';
  candidate.sources = candidate.sources || [candidate.source, 'user_comparable'].filter(Boolean);
  if (!candidate.sources.includes('user_comparable')) candidate.sources.push('user_comparable');
  candidate._fromGoldStandard = true;
  candidate._goldStandardIsCompetitor = true;
  candidate._goldStandardType = type || candidate._goldStandardType || 'direct';
  candidate._goldStandardNegative = false;
  return candidate;
}

async function loadUserComparableSeeds(subjectCtx) {
  const subjectType = strTrim(subjectCtx?.subjectType || subjectCtx?.subject_type);
  const ieId = subjectCtx?.investedEnterpriseId || subjectCtx?.invested_enterprise_id || null;
  const pipId = subjectCtx?.preInvestmentProjectId || subjectCtx?.pre_investment_project_id || null;
  if (!subjectType || (!ieId && !pipId)) return [];

  const seeds = [];
  const seen = new Set();
  const pushSeed = (credit, name, type) => {
    const key = candidateDedupeKey({ unified_credit_code: credit, display_name: name });
    if (!key || seen.has(key)) return;
    seen.add(key);
    seeds.push({
      candidate_display_name: strTrim(name),
      candidate_credit_code: normalizeCreditCode(credit),
      final_is_competitor: 1,
      final_type: type || 'direct',
      notes: '用户勾选放入可比公司',
    });
  };

  const rels = await db.query(
    `SELECT competitor_display_name, unified_credit_code, competitor_type
     FROM sourcing_competitor_relation
     WHERE F_DeleteMark = 0
       AND include_in_comparable = 1
       AND subject_type = ?
       AND (invested_enterprise_id <=> ?)
       AND (pre_investment_project_id <=> ?)
     ORDER BY F_LastModifyTime DESC`,
    [subjectType, ieId ? String(ieId) : null, pipId ? String(pipId) : null]
  );
  for (const r of rels || []) {
    pushSeed(r.unified_credit_code, r.competitor_display_name, r.competitor_type);
  }

  const prefs = await db.query(
    `SELECT competitor_key
     FROM sourcing_competitor_comparable_pref
     WHERE include_in_comparable = 1
       AND subject_type = ?
       AND (invested_enterprise_id <=> ?)
       AND (pre_investment_project_id <=> ?)`,
    [subjectType, ieId ? String(ieId) : null, pipId ? String(pipId) : null]
  );
  for (const p of prefs || []) {
    const parsed = parsePrefCompetitorKey(p.competitor_key);
    if (!parsed.credit && !parsed.name) continue;
    pushSeed(parsed.credit, parsed.name, 'direct');
  }

  return seeds;
}

async function recallGoldStandardCandidates(target, excludeCredit, excludeName, subjectCtx) {
  const ctx = subjectCtx || {
    subjectType: target?.subject_type,
    investedEnterpriseId: target?.invested_enterprise_id,
    preInvestmentProjectId: target?.pre_investment_project_id,
  };
  const seeds = await loadUserComparableSeeds(ctx);
  if (!seeds.length) return [];

  const out = [];
  const exC = normalizeCreditCode(excludeCredit);
  const exN = strTrim(excludeName).toLowerCase();

  for (const r of seeds) {
    let candidate = await resolveFinancingEntity(r.candidate_credit_code, r.candidate_display_name);
    if (!candidate) {
      candidate = {
        source: 'user_comparable',
        source_id: '',
        display_name: strTrim(r.candidate_display_name),
        unified_credit_code: null,
        product_intro: '',
        qcc_intro: '',
        tags: [],
        industry_l1: null,
        industry_l2: null,
        industry_category_4: null,
        financing_amount_text: null,
        event_date: null,
        latest_round: null,
      };
    }
    markUserComparable(candidate, r.final_type);
    await normalizeDomesticCandidateIdentity(candidate);
    if (exC && candidate.unified_credit_code === exC) continue;
    if (exN && strTrim(candidate.display_name).toLowerCase() === exN) continue;
    out.push(candidate);
  }
  return out;
}

async function loadGoldStandardAnnotations(target, subjectCtx) {
  const ctx = subjectCtx || {
    subjectType: target?.subject_type,
    investedEnterpriseId: target?.invested_enterprise_id,
    preInvestmentProjectId: target?.pre_investment_project_id,
  };
  return loadUserComparableSeeds(ctx);
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

function goldNotesExcludeComparable() {
  return false;
}

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
  mapFinancingRow,
  mapIpoRow,
  mapNewShareRow,
  goldNotesExcludeComparable,
};
