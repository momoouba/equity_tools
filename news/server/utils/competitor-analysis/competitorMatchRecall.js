const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { isDomesticExchange } = require('../listing/listedUniverseUtils');
const {
  parseTagsFromJson,
  mergeTagArrays,
  candidateDedupeKey,
  normalizeCreditCode,
  strTrim,
} = require('./competitorMatchUtils');
const { recallGoldStandardCandidates } = require('./competitorGoldStandardRecall');
const { PRIORITY_CATEGORY_4 } = require('./structuredSchemaV1');

const IPO_YEARS = 3;
const FIN_YEARS = Math.max(
  1,
  parseInt(process.env.COMPETITOR_FINANCING_MAX_AGE_YEARS || '6', 10) || 6
);
const RECALL_LIMIT = 3000;
/** 三大类目标：6 年窗口内按企业去重后，不再与全行业抢 3000 名额 */
const RECALL_INDUSTRY_FINANCING_LIMIT = Math.max(
  RECALL_LIMIT,
  parseInt(process.env.COMPETITOR_FINANCING_INDUSTRY_LIMIT || '8000', 10) || 8000
);
/** 未标注 category_4 时，用来源/标准一二级把同一大类捞回来。
 * 烯牛常见 L1=医疗、L2=生物医药；只看一级会对不上「医疗」。
 * 这里用的是大类文案（生物医药），不是核药/肿瘤等细分赛道。
 */
const CATEGORY_UNLABELED_INDUSTRY_RE = {
  bio: '生物医药|生物制药|生命科学|医疗健康|化学制药|创新药|医药',
  ai: '数字智能|人工智能|软件和信息技术|互联网|企业服务',
  semi_mfg: '半导体|先进制造|电子|高端装备|机器人',
};
const RECALL_LISTED_BY_PRODUCT_LIMIT = 120;
const RECALL_FINANCING_BY_PRODUCT_LIMIT = 160;
const RECALL_RADIO_FINANCING_BY_PRODUCT_LIMIT = Math.max(
  200,
  parseInt(process.env.COMPETITOR_RADIO_FINANCING_PRODUCT_LIMIT || '600', 10) || 600
);
const NEW_SHARE_RECALL_LIMIT = 8000;

/** 宽词会把产品定向召回灌满最近融资事件，核药同行被挤出 160 条上限 */
const FLOOD_FINANCING_PRODUCT_TERM_RE =
  /诊疗一体化(?!核药)|阿尔茨海默|神经退行|^创新药$|^未上市$|融资$|^RDC$|^PET$/i;

/** 核药目标专用检索锚点（不写公司名；避免透镜宽词占满前 10 个 LIKE） */
const RADIO_FINANCING_SEED_TERMS = [
  '核药',
  '放射性药物',
  '放射性治疗',
  '核素偶联',
  'RDC药物',
  'PET显像剂',
  'PET成像药物',
  'α核素',
  '砹-211',
  'Lu-177',
  '镥-177',
  'Ac-225',
  '锕-225',
  '锝-99',
];

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

const NEW_SHARE_RECALL_SELECT = `SELECT F_Id AS f_id, stock_code, stock_name, exchange,
            enterprise_full_name_cn, enterprise_full_name_display,
            unified_credit_code, sw_industry_l1, sw_industry_l2, industry_category_4,
            product_intro, company_intro, industry_tags_display, industry_tags_json,
            public_date, F_LastModifyTime, F_CreatorTime
     FROM ipo_new_share
     WHERE (
         TRIM(IFNULL(product_intro, '')) <> ''
         OR TRIM(IFNULL(company_intro, '')) <> ''
         OR TRIM(IFNULL(industry_tags_display, '')) <> ''
         OR industry_tags_json IS NOT NULL
         OR TRIM(IFNULL(sw_industry_l1, '')) <> ''
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
          .split(/[,，、;/|]/g)
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
  return filterExcludedMappedRows(rows, mapIpoRow, excludeCredit, excludeName);
}

/**
 * Stage 4：上市主池 `ipo_new_share` 召回（与 mapIpoRow 同构）。
 */
async function recallFromListedNewShare(excludeCredit, excludeName, opts = {}) {
  const limit = Math.max(100, opts.limit || NEW_SHARE_RECALL_LIMIT);
  const categories = Array.isArray(opts.categories)
    ? opts.categories.map((x) => strTrim(x)).filter(Boolean)
    : [];
  let sql = `${NEW_SHARE_RECALL_SELECT}`;
  const params = [];
  if (categories.length) {
    sql += ` AND industry_category_4 IN (${categories.map(() => '?').join(',')})`;
    params.push(...categories);
  }
  sql += ` ORDER BY COALESCE(public_date, F_LastModifyTime, F_CreatorTime) DESC LIMIT ?`;
  params.push(limit);
  const rows = await db.query(sql, params);
  return filterExcludedMappedRows(rows, mapNewShareRow, excludeCredit, excludeName);
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
  return filterExcludedMappedRows(rows, mapIpoRow, excludeCredit, excludeName);
}

function isRadiopharmaRecallTarget(target) {
  const { looksLikeRadiopharma, RADIOPHARMA_TRACK_RE } = require('./industry-strategies/baseStrategy');
  if (looksLikeRadiopharma(target)) return true;
  const blob = [
    target?.display_name,
    target?.product_intro,
    target?.qcc_intro_effective,
    ...(target?.tags || []),
    ...(target?.core_product_lines || []),
    ...(target?.competition_lens?.must_align || []),
  ]
    .filter(Boolean)
    .join('\n');
  return RADIOPHARMA_TRACK_RE.test(blob);
}

function collectFinancingProductRecallTerms(target) {
  const {
    expandProductLineSearchTerms,
    buildLensScoringAnchors,
  } = require('./competitorProductLineUtils');
  const introBlob = [target.product_intro, target.qcc_intro_effective].filter(Boolean).join('\n');
  const lensAnchors = buildLensScoringAnchors(
    [
      ...(target.competition_lens?.must_align || []),
      ...(target.competition_lens?.custom_keywords || []),
    ],
    10
  );
  const expanded = expandProductLineSearchTerms(target.core_product_lines, introBlob);
  const radio = isRadiopharmaRecallTarget(target);
  const raw = radio
    ? [...RADIO_FINANCING_SEED_TERMS, ...expanded, ...lensAnchors]
    : [...lensAnchors, ...expanded];
  const uniq = [];
  const seen = new Set();
  for (const term of raw.map((t) => strTrim(t))) {
    // 「核药」仅 2 字，但仍是核药召回主锚点
    const minLen = radio && term === '核药' ? 2 : 3;
    if (term.length < minLen || term.length > 16) continue;
    if (radio && FLOOD_FINANCING_PRODUCT_TERM_RE.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(term);
    if (uniq.length >= (radio ? 14 : 10)) break;
  }
  return { terms: uniq, radio };
}

/**
 * 按透镜/核心产品短锚点在融资池定向召回（不受近 3000 条时间截断影响）。
 * 核药目标：优先用核素/核药专词，并搜标签 JSON；宽词（诊疗一体化等）不进 LIKE。
 */
async function recallFinancingByProductTerms(target, excludeCredit, excludeName, metaOut) {
  if (!target) return [];
  const { terms: uniq, radio } = collectFinancingProductRecallTerms(target);
  if (!uniq.length) return [];
  const limit = radio
    ? Math.max(RECALL_FINANCING_BY_PRODUCT_LIMIT, RECALL_RADIO_FINANCING_BY_PRODUCT_LIMIT)
    : RECALL_FINANCING_BY_PRODUCT_LIMIT;

  const termClauses = [];
  const params = [FIN_YEARS];
  for (const term of uniq) {
    const like = `%${term}%`;
    termClauses.push(
      `(ai_product_intro LIKE ? OR ai_company_tags_display LIKE ? OR CAST(IFNULL(ai_company_tags_json, '') AS CHAR) LIKE ? OR project_desc LIKE ? OR company_name LIKE ? OR project_name LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }
  params.push(limit);

  const rows = await db.query(
    `SELECT e.F_Id, e.company_name, e.company_credit_code, e.project_name, e.project_desc,
            e.ai_product_intro, e.ai_company_tags_display, e.ai_company_tags_json,
            e.industry_std_lv1, e.industry_std_lv2, e.industry_category_4,
            e.funding_amt_raw, e.estimated_amt_raw,
            e.round, e.latest_round, e.event_date
     FROM sourcing_financing_event e
     WHERE e.F_DeleteMark = 0
       AND e.event_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)
       AND (${termClauses.join(' OR ')})
     ORDER BY e.event_date DESC
     LIMIT ?`,
    params
  );
  const mapped = filterExcludedMappedRows(rows, mapFinancingRow, excludeCredit, excludeName);
  if (metaOut && typeof metaOut === 'object') {
    metaOut.terms = uniq;
    metaOut.limit = limit;
    metaOut.radio = radio;
    metaOut.count = mapped.length;
  }
  return mapped;
}

/**
 * Stage 4：按产品线在 new_share 定向召回。
 */
async function recallListedNewShareByProductTerms(target, excludeCredit, excludeName, opts = {}) {
  if (!target) return [];
  const { expandProductLineSearchTerms } = require('./competitorProductLineUtils');
  const introBlob = [target.product_intro, target.qcc_intro_effective].filter(Boolean).join('\n');
  const terms = expandProductLineSearchTerms(target.core_product_lines, introBlob);
  if (!terms.length) return [];

  const categories = Array.isArray(opts.categories)
    ? opts.categories.map((x) => strTrim(x)).filter(Boolean)
    : [];
  const termClauses = [];
  const params = [];
  for (const term of terms.slice(0, 10)) {
    const like = `%${term}%`;
    termClauses.push(
      `(product_intro LIKE ? OR company_intro LIKE ? OR industry_tags_display LIKE ? OR stock_name LIKE ? OR enterprise_full_name_cn LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }
  let sql = `${NEW_SHARE_RECALL_SELECT} AND (${termClauses.join(' OR ')})`;
  if (categories.length) {
    sql += ` AND industry_category_4 IN (${categories.map(() => '?').join(',')})`;
    params.push(...categories);
  }
  sql += ` ORDER BY COALESCE(public_date, F_LastModifyTime, F_CreatorTime) DESC LIMIT ?`;
  params.push(RECALL_LISTED_BY_PRODUCT_LIMIT);

  const rows = await db.query(sql, params);
  return filterExcludedMappedRows(rows, mapNewShareRow, excludeCredit, excludeName);
}

function filterExcludedMappedRows(rows, mapFn, excludeCredit, excludeName) {
  const exC = normalizeCreditCode(excludeCredit);
  const exN = strTrim(excludeName).toLowerCase();
  const out = [];
  for (const r of rows) {
    const mapped = mapFn(r);
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

function isNewShareListedSource(item) {
  const srcs = item?.sources || (item?.source ? [item.source] : []);
  return srcs.includes('ipo_new_share') && item?.is_listed === true;
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

function resolveFinancingIndustryScope(target) {
  const category4 = strTrim(target?.industry_category_4);
  if (PRIORITY_CATEGORY_4.includes(category4)) {
    return {
      mode: 'industry',
      category4,
      unlabeledRe: CATEGORY_UNLABELED_INDUSTRY_RE[category4] || null,
      limit: RECALL_INDUSTRY_FINANCING_LIMIT,
    };
  }
  return {
    mode: 'global',
    category4: category4 || null,
    unlabeledRe: null,
    limit: RECALL_LIMIT,
  };
}

/**
 * 融资事件池：近 6 年、按信用代码（无则公司名）去重取最近一条有简介的事件。
 * 目标属于 ai/bio/semi_mfg 时先按四大类（及未标注但一级行业同族）收窄，再截断，
 * 避免全行业最近 3000 家把同业更早融资的公司挤掉。
 */
async function recallFromFinancingEvents(excludeCredit, excludeName, opts = {}) {
  const scope = resolveFinancingIndustryScope(opts.target);
  const params = [FIN_YEARS];
  let industrySql = '';
  const industryParams = [];
  if (scope.mode === 'industry') {
    if (scope.unlabeledRe) {
      industrySql = ` AND (
        TRIM(IFNULL(e.industry_category_4, '')) = ?
        OR (
          TRIM(IFNULL(e.industry_category_4, '')) = ''
          AND (
            IFNULL(e.industry_std_lv1, '') REGEXP ?
            OR IFNULL(e.industry_std_lv2, '') REGEXP ?
            OR IFNULL(e.industry_source_lv1, '') REGEXP ?
            OR IFNULL(e.industry_source_lv2, '') REGEXP ?
          )
        )
      )`;
      industryParams.push(
        scope.category4,
        scope.unlabeledRe,
        scope.unlabeledRe,
        scope.unlabeledRe,
        scope.unlabeledRe
      );
    } else {
      industrySql = ` AND TRIM(IFNULL(e.industry_category_4, '')) = ?`;
      industryParams.push(scope.category4);
    }
  }
  params.push(...industryParams, ...industryParams, scope.limit);

  const rows = await db.query(
    `SELECT e.F_Id, e.company_name, e.company_credit_code, e.project_name, e.project_desc,
            e.ai_product_intro, e.ai_company_tags_display, e.ai_company_tags_json,
            e.industry_std_lv1, e.industry_std_lv2, e.industry_category_4,
            e.funding_amt_raw, e.estimated_amt_raw,
            e.round, e.latest_round, e.event_date
     FROM sourcing_financing_event e
     INNER JOIN (
       SELECT
         COALESCE(NULLIF(TRIM(e.company_credit_code), ''), CONCAT('nm:', TRIM(e.company_name))) AS grp_key,
         MAX(e.event_date) AS max_dt
       FROM sourcing_financing_event e
       WHERE e.F_DeleteMark = 0
         AND e.event_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)
         AND (
           TRIM(IFNULL(e.ai_product_intro, '')) <> ''
           OR TRIM(IFNULL(e.ai_company_tags_display, '')) <> ''
           OR e.ai_company_tags_json IS NOT NULL
         )
         ${industrySql}
       GROUP BY grp_key
     ) t ON COALESCE(NULLIF(TRIM(e.company_credit_code), ''), CONCAT('nm:', TRIM(e.company_name))) = t.grp_key
        AND e.event_date = t.max_dt
     WHERE e.F_DeleteMark = 0
       ${industrySql}
     ORDER BY e.event_date DESC
     LIMIT ?`,
    params
  );
  const mapped = filterExcludedMappedRows(rows, mapFinancingRow, excludeCredit, excludeName);
  if (opts.metaOut && typeof opts.metaOut === 'object') {
    opts.metaOut.mode = scope.mode;
    opts.metaOut.category4 = scope.category4;
    opts.metaOut.limit = scope.limit;
    opts.metaOut.count = mapped.length;
  }
  return mapped;
}

/** 合并双源候选（同键保留双源标记）。 */
function parseRecallEventDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Stage 4 §8.1.1：new_share 行业优先 + recallRichness 富者覆盖；冲突时 new_share 优先。
 */
function mergeRecalledCandidates(ipoList, finList) {
  const map = new Map();
  const add = (item) => {
    const key = candidateDedupeKey(item);
    const prev = map.get(key);
    if (!prev) {
      const subs = item.ipo_sub ? [item.ipo_sub] : [];
      map.set(key, {
        ...item,
        sources: [item.source],
        ipo_sub_funds: subs,
        is_listed: item.is_listed === true ? true : item.is_listed,
        domestic_listed: item.domestic_listed === true ? true : item.domestic_listed,
      });
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

    // 禁止丢弃上市标记
    if (item.is_listed === true) prev.is_listed = true;
    if (item.domestic_listed === true) prev.domestic_listed = true;
    if (item.listed_stock_code && !prev.listed_stock_code) {
      prev.listed_stock_code = item.listed_stock_code;
    }
    if (item.listing_market && !prev.listing_market) {
      prev.listing_market = item.listing_market;
    }

    // 金标标记不可在合并中丢失：否则同时被常规召回命中的金标竞品会失去强制进池资格
    if (item._fromGoldStandard) {
      prev._fromGoldStandard = true;
      if (!prev._goldStandardType && item._goldStandardType) {
        prev._goldStandardType = item._goldStandardType;
      }
    }

    const itemRich = recallRichness(item);
    const prevRich = recallRichness(prev);
    const itemIsNewShare = item.source === 'ipo_new_share';
    const prevIsNewShareListed = isNewShareListedSource(prev);
    const preferItemProfile =
      itemRich > prevRich || (itemRich === prevRich && itemIsNewShare && !prevIsNewShareListed);

    if (preferItemProfile) {
      if (item.product_intro) prev.product_intro = item.product_intro;
      if (item.tags?.length) prev.tags = item.tags;
      if (item.qcc_intro) prev.qcc_intro = item.qcc_intro;
    } else {
      if (!prev.product_intro && item.product_intro) prev.product_intro = item.product_intro;
      if (!prev.tags?.length && item.tags?.length) prev.tags = item.tags;
      if (!prev.qcc_intro && item.qcc_intro) prev.qcc_intro = item.qcc_intro;
    }

    // 上市 new_share 侧行业优先；融资侧仅补空
    if (itemIsNewShare && item.is_listed) {
      if (item.industry_l1) prev.industry_l1 = item.industry_l1;
      if (item.industry_l2) prev.industry_l2 = item.industry_l2;
      if (item.industry_category_4) prev.industry_category_4 = item.industry_category_4;
    } else if (!prevIsNewShareListed) {
      if (!prev.industry_l1 && item.industry_l1) prev.industry_l1 = item.industry_l1;
      if (!prev.industry_l2 && item.industry_l2) prev.industry_l2 = item.industry_l2;
      if (!prev.industry_category_4 && item.industry_category_4) {
        prev.industry_category_4 = item.industry_category_4;
      }
    }

    if (item.financing_amount_text) {
      if (!prev.financing_amount_text || item.source === 'sourcing_financing_event') {
        prev.financing_amount_text = item.financing_amount_text;
      }
    }
    if (item.latest_round) {
      if (!prev.latest_round || item.source === 'sourcing_financing_event') {
        prev.latest_round = item.latest_round;
      }
    }

    const prevDt = parseRecallEventDate(prev.event_date);
    const itemDt = parseRecallEventDate(item.event_date);
    if (itemDt && (!prevDt || itemDt > prevDt)) {
      prev.event_date = item.event_date;
    }
  };
  for (const x of ipoList || []) add(x);
  for (const x of finList || []) add(x);
  return [...map.values()];
}

function parseGrayCategories(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => strTrim(x)).filter(Boolean);
  return String(raw)
    .split(/[,，\s]+/)
    .map((x) => strTrim(x))
    .filter(Boolean);
}

function shouldUseNewShareForTarget(recallFlags, target) {
  if (!recallFlags?.use_new_share_listed_recall) return false;
  const cats = parseGrayCategories(recallFlags.new_share_gray_categories);
  if (!cats.length) return true;
  const hint =
    strTrim(target?.industry_category_4) ||
    strTrim(target?.subject_track_hint) ||
    strTrim(target?.industry_l1) ||
    '';
  if (!hint) return false;
  return cats.some((c) => hint === c || hint.includes(c));
}

/**
 * Runner / POC 共用：按配置组装内部召回池（含可选 A/B 对比，不双写 relation）。
 */
async function buildInternalRecallPool({
  target,
  recallFlags,
  canFinancing = false,
}) {
  const useNewShare = shouldUseNewShareForTarget(recallFlags, target);
  const enableIpo = !!recallFlags.enable_ipo_project;
  const enableAb = !!recallFlags.enable_recall_ab_compare;
  const grayCategories = parseGrayCategories(recallFlags.new_share_gray_categories);
  const excludeCredit = target?.unified_credit_code;
  const excludeName = target?.display_name;

  let listedMain = [];
  let listedProduct = [];
  let ipoSupplement = [];
  let ipoProductSupplement = [];
  let financingSkipReason = null;
  let finList = [];
  let financingProductMeta = null;
  let financingRecallMeta = null;

  if (useNewShare) {
    listedMain = await recallFromListedNewShare(excludeCredit, excludeName);
    listedProduct = await recallListedNewShareByProductTerms(target, excludeCredit, excludeName);
    if (enableIpo) {
      ipoSupplement = await recallFromIpoProjects(excludeCredit, excludeName);
      ipoProductSupplement = await recallListedIpoByProductTerms(
        target,
        excludeCredit,
        excludeName
      );
    }
  } else if (enableIpo) {
    listedMain = await recallFromIpoProjects(excludeCredit, excludeName);
    listedProduct = await recallListedIpoByProductTerms(target, excludeCredit, excludeName);
  }

  if (!recallFlags.enable_financing_event) {
    financingSkipReason = 'config_disabled';
  } else if (!canFinancing) {
    financingSkipReason = 'no_project_sourcing_permission';
  } else {
    financingRecallMeta = {};
    finList = await recallFromFinancingEvents(excludeCredit, excludeName, {
      target,
      metaOut: financingRecallMeta,
    });
    const productMeta = {};
    const finByProduct = await recallFinancingByProductTerms(
      target,
      excludeCredit,
      excludeName,
      productMeta
    );
    finList = mergeRecalledCandidates(finList, finByProduct);
    financingProductMeta = productMeta;
  }

  // 金标种子召回：同目标已有标注竞品时优先进入候选池，降低对 S4 联网方差的依赖
  if (recallFlags?.enable_gold_standard_recall !== false && target) {
    try {
      const goldCandidates = await recallGoldStandardCandidates(
        target,
        excludeCredit,
        excludeName
      );
      if (goldCandidates?.length) {
        finList = mergeRecalledCandidates(finList, goldCandidates);
      }
    } catch (e) {
      // 金标召回失败不应阻塞主召回流程
      console.warn('金标种子召回失败:', e.message);
    }
  }

  const listedMerged = mergeRecalledCandidates(
    mergeRecalledCandidates(listedMain, listedProduct),
    mergeRecalledCandidates(ipoSupplement, ipoProductSupplement)
  );
  const candidates = mergeRecalledCandidates(listedMerged, finList);

  let abCompare = null;
  if (enableAb) {
    const altListed = useNewShare
      ? mergeRecalledCandidates(
          await recallFromIpoProjects(excludeCredit, excludeName),
          await recallListedIpoByProductTerms(target, excludeCredit, excludeName)
        )
      : mergeRecalledCandidates(
          await recallFromListedNewShare(excludeCredit, excludeName),
          await recallListedNewShareByProductTerms(target, excludeCredit, excludeName)
        );
    const altMerged = mergeRecalledCandidates(altListed, finList);
    const primaryKeys = new Set(candidates.map((c) => candidateDedupeKey(c)));
    const altKeys = new Set(altMerged.map((c) => candidateDedupeKey(c)));
    let overlap = 0;
    for (const k of primaryKeys) {
      if (altKeys.has(k)) overlap += 1;
    }
    abCompare = {
      primary_mode: useNewShare ? 'ipo_new_share' : 'ipo_project',
      primary_count: candidates.length,
      alt_mode: useNewShare ? 'ipo_project' : 'ipo_new_share',
      alt_count: altMerged.length,
      overlap,
      primary_only: primaryKeys.size - overlap,
      alt_only: altKeys.size - overlap,
      primary_with_industry_l1: candidates.filter((c) => strTrim(c.industry_l1)).length,
      alt_with_industry_l1: altMerged.filter((c) => strTrim(c.industry_l1)).length,
      switch_on: !!recallFlags.use_new_share_listed_recall,
      gray_categories: grayCategories,
      used_new_share_for_target: useNewShare,
    };
  }

  return {
    candidates,
    stats: {
      listed_main: listedMain.length,
      listed_product_terms: listedProduct.length,
      ipo_supplement: ipoSupplement.length,
      ipo_product_supplement: ipoProductSupplement.length,
      financing: finList.length,
      financing_recall_mode: financingRecallMeta?.mode || null,
      financing_industry_category_4: financingRecallMeta?.category4 || null,
      financing_industry_limit: financingRecallMeta?.limit || null,
      financing_industry_count: financingRecallMeta?.count || 0,
      financing_product_terms: financingProductMeta?.count || 0,
      financing_product_term_limit: financingProductMeta?.limit || null,
      financing_product_term_sample: financingProductMeta?.terms || [],
      financing_skipped: financingSkipReason,
      merged: candidates.length,
      use_new_share_listed_recall: !!recallFlags.use_new_share_listed_recall,
      used_new_share_for_target: useNewShare,
      gray_categories: grayCategories,
    },
    abCompare,
  };
}

module.exports = {
  recallFromIpoProjects,
  recallFromListedNewShare,
  recallListedIpoByProductTerms,
  recallListedNewShareByProductTerms,
  recallFinancingByProductTerms,
  recallFromFinancingEvents,
  mergeRecalledCandidates,
  buildInternalRecallPool,
  shouldUseNewShareForTarget,
  parseFinancingTags,
  mapIpoRow,
  mapNewShareRow,
  recallRichness,
};
