'use strict';

const C = require('./constants');

const PROMPT_INTERFACE = '项目估值';
const PROMPT_TYPE_BUSINESS_REASON = 'valuation_comparable_business_reason';
const PROMPT_TYPE_LISTED_PROPOSE = 'valuation_comparable_listed_propose';
const PROMPT_TYPE = PROMPT_TYPE_BUSINESS_REASON;
const PROMPT_NAME = '项目估值-可比推荐业务理由';
const PROMPT_NAME_LISTED_PROPOSE = '项目估值-可比上市企业提名';
const PROMPT_SECTION_SYSTEM = '---SYSTEM---';
const PROMPT_SECTION_USER = '---USER---';

const BUSINESS_REASON_SYSTEM = `你是估值可比分析助手。仅依据输入 JSON 中的标的与上市候选原始信息，用 1～2 句中文说明业务上为何可作可比公司（产品/客户/商业模式）。禁止编造未披露营收、客户、管线。不得否定或改写 RULE_REASON_JSON 中的规则命中事实；可补充业务解读。双方业务信息严重不足时输出「信息不足，无法判断业务可比性」。

# 输出约束
仅输出纯 JSON，禁止 Markdown 与 JSON 外文字：
{"business_reason":"1～2句中文","confidence":"high|medium|low"}

confidence 仅供展示，不参与打分。`;

const BUSINESS_REASON_USER = `标的：
{{TARGET_JSON}}

候选：
{{CANDIDATE_JSON}}

规则分维（只读，勿改写事实）：
{{RULE_REASON_JSON}}`;

const LISTED_PROPOSE_SYSTEM = `你是项目估值分析师。任务只做到「候选池」：先把标的拆到标准化产品品类，再按品类联网检索主营该品类的境内上市公司。不要计算倍数，不要采集候选公司的市值、营收、利润或 PE/PS。那些由后续程序按证券代码从财报取数。

# 必须联网
用联网检索核对「谁的主营就是这个品类」。检索路径写进你的判断，不要只凭记忆罗列知名公司。可用：交易所年报「主营业务」、券商行业深度里的重点公司表、东方财富/同花顺按产品品类（不是申万一级）的分类。禁止编造未披露的客户、管线、收入占比和财务数字。

# 先拆标的，再找公司（只在内部完成，不要输出这两步的表格）
1. 把标的拆成「产品线 → 工艺环节 → 标准化产品品类」。必须落到可对标的品类，不能停在「半导体设备」「生物医药」「人工智能」这种行业层。品类是入选的唯一颗粒度。
2. 材料优先级：product_intro、qcc_intro、tags、must_align、custom_keywords，以及 target_financials（收入规模、盈利或亏损，仅供理解标的，不用于给候选公司打分或剔除）。产品线在输入里不够时，联网查该公司已披露的产品与技术路线，再拆品类。收入占比输入里没有就不要写。
3. sub_track、申万行业只用来辅助核对，不能代替品类。industry_category_4 仅当 industry_category_4_usable=true 时作弱约束；usable=false 或 other/空时忽略，不得据此圈「同行业」。
4. display_name 只用于识别标的。禁止提名标的自身。

# 候选池（本步不做规模、盈利取舍）
对每个标准化品类，检索主营该品类的公司。主业（收入主体）对应该品类才入选；边角业务、少量收入不算。
- 市场：上交所、深交所、北交所。INCLUDE_NEEQ 为 true 时才可含新三板。禁止港股、美股、已退市。EXCLUDE_JSON 中的代码和信用代码不要提。
- 同一主体多代码只留主业最贴该品类的一只。
- 某品类在上述市场没有上市公司：跳过该品类，不要用相邻行业的龙头、指数权重股补位。
- 纯上下游（原料、通用设备、渠道、无同类自研产品的纯代工/控股平台）不要因为简介里出现行业词就入选。
- 商业模式不要混充：产品销售、平台、纯服务、纯制造代工，除非标的本身就是该模式。
- 数量不超过 LIMIT。按品类覆盖来提名，禁止为凑满上限改提「同属某大行业」的公司。拿不准宁可不提。

# 理由与置信度
- business_reason：1～2 句中文，必须写明对应标的的哪条产品线、以及候选的哪一个标准化品类。禁止「同属某行业」「行业龙头」「都是科技公司」。不要写候选公司的市值或财务数字。
- confidence=high：公开主业就是该标准化品类。
- confidence=medium：同一工艺环节的相邻品类，主业部分重合。
- confidence=low：不要输出。

# 输出约束
仅输出纯 JSON，禁止 Markdown、禁止步骤表、禁止 JSON 外文字：
{"candidates":[{"stock_code":"6位或空","stock_name":"证券简称须准确可核对","unified_credit_code":"可空","business_reason":"1～2句中文","confidence":"high|medium"}]}

尽量填 6 位代码；不确定可留空，但证券简称必须能在上市主档核对。你不打分。`;

const LISTED_PROPOSE_USER = `请联网完成候选池：先把标的拆到标准化产品品类，再按品类检索境内上市公司。不要输出拆解表，不要采集候选公司财务或倍数。

标的画像（含已导入财报，单位元）：
{{TARGET_JSON}}

排除（勿提名）：
{{EXCLUDE_JSON}}

是否包含新三板（true 才可提名新三板）：
{{INCLUDE_NEEQ}}

提名数量上限：
{{LIMIT}}`;

const PROMPT_DEFS = {
  [PROMPT_TYPE_BUSINESS_REASON]: {
    name: PROMPT_NAME,
    system: BUSINESS_REASON_SYSTEM,
    user: BUSINESS_REASON_USER,
  },
  [PROMPT_TYPE_LISTED_PROPOSE]: {
    name: PROMPT_NAME_LISTED_PROPOSE,
    system: LISTED_PROPOSE_SYSTEM,
    user: LISTED_PROPOSE_USER,
  },
};

function buildPromptContentForDb(promptType = PROMPT_TYPE_BUSINESS_REASON) {
  const def = PROMPT_DEFS[promptType] || PROMPT_DEFS[PROMPT_TYPE_BUSINESS_REASON];
  return `${PROMPT_SECTION_SYSTEM}\n${def.system}\n${PROMPT_SECTION_USER}\n${def.user}`;
}

function buildValuationRecommendPromptSeeds() {
  return Object.entries(PROMPT_DEFS).map(([prompt_type, def]) => ({
    prompt_name: def.name,
    interface_type: PROMPT_INTERFACE,
    prompt_type,
    prompt_content: buildPromptContentForDb(prompt_type),
  }));
}

function resolvePromptSections(storedContent, def) {
  const fallback = def || PROMPT_DEFS[PROMPT_TYPE_BUSINESS_REASON];
  const raw = storedContent != null ? String(storedContent).trim() : '';
  if (!raw) {
    return { system: fallback.system, userTemplate: fallback.user };
  }
  const idxS = raw.indexOf(PROMPT_SECTION_SYSTEM);
  const idxU = raw.indexOf(PROMPT_SECTION_USER);
  if (idxS !== -1 && idxU !== -1 && idxU > idxS) {
    const systemPart = raw.slice(idxS + PROMPT_SECTION_SYSTEM.length, idxU).trim();
    const userPart = raw.slice(idxU + PROMPT_SECTION_USER.length).trim();
    return {
      system: systemPart || fallback.system,
      userTemplate: userPart || fallback.user,
    };
  }
  return { system: fallback.system, userTemplate: raw };
}

function renderUserPrompt(userTemplate, vars) {
  let out = String(userTemplate || '');
  for (const [key, value] of Object.entries(vars || {})) {
    out = out.split(`{{${key}}}`).join(value != null ? String(value) : '');
  }
  return out;
}

const bundleCache = new Map();
const CACHE_MS = 60_000;

async function loadValuationRecommendPromptBundle(promptType = PROMPT_TYPE_BUSINESS_REASON) {
  const type = PROMPT_DEFS[promptType] ? promptType : PROMPT_TYPE_BUSINESS_REASON;
  const def = PROMPT_DEFS[type];
  const now = Date.now();
  const hit = bundleCache.get(type);
  if (hit && now - hit.ts < CACHE_MS && hit.bundle) return hit.bundle;
  const db = require('../../db');
  const rows = await db.query(
    `SELECT F_Id AS id, prompt_content, ai_model_config_id
     FROM ai_prompt_config
     WHERE interface_type = ?
       AND prompt_type = ?
       AND is_active = 1
       AND F_DeleteMark = 0
     ORDER BY F_LastModifyTime DESC
     LIMIT 1`,
    [PROMPT_INTERFACE, type]
  );
  const stored = rows.length ? rows[0].prompt_content : '';
  const { system, userTemplate } = resolvePromptSections(stored, def);
  const bundle = {
    promptType: type,
    promptConfigId: rows.length ? rows[0].id : null,
    ai_model_config_id: rows.length ? rows[0].ai_model_config_id : null,
    system,
    userTemplate,
    fromDb: rows.length > 0,
  };
  bundleCache.set(type, { ts: now, bundle });
  return bundle;
}

function clearValuationRecommendPromptCache() {
  bundleCache.clear();
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 0);
}

function sliceTargetForAi(profile) {
  const cat4 = profile.industry_category_4 || null;
  const usable = cat4 === 'ai' || cat4 === 'bio' || cat4 === 'semi_mfg';
  return {
    display_name: profile.display_name || null,
    industry_category_4: cat4,
    industry_category_4_label: C.CATEGORY_4_LABELS[cat4] || cat4,
    industry_category_4_usable: usable,
    sw_industry_l1: profile.sw_industry_l1 || null,
    sw_industry_l2: profile.sw_industry_l2 || null,
    sw_industry_l3: profile.sw_industry_l3 || null,
    sub_track: profile.sub_track || null,
    tags: profile.tags || [],
    must_align: profile.competition_lens?.must_align || [],
    custom_keywords: profile.competition_lens?.custom_keywords || [],
    product_intro: profile.product_intro || null,
    qcc_intro: profile.qcc_intro || null,
    target_financials: profile.target_financials || null,
  };
}

function sliceCandidateForAi(c) {
  return {
    stock_code: c.stock_code,
    stock_name: c.stock_name,
    listing_market: c.listing_market,
    industry_category_4: c.industry_category_4 || null,
    sw_industry_l1: c.sw_industry_l1 || null,
    sw_industry_l2: c.sw_industry_l2 || null,
    sw_industry_l3: c.sw_industry_l3 || null,
    sub_track: c.sub_track || null,
    industry_tags_display: c.industry_tags_display || null,
    product_intro: c.product_intro || null,
    company_intro: c.company_intro || null,
  };
}

module.exports = {
  PROMPT_INTERFACE,
  PROMPT_TYPE,
  PROMPT_TYPE_BUSINESS_REASON,
  PROMPT_TYPE_LISTED_PROPOSE,
  PROMPT_NAME,
  PROMPT_NAME_LISTED_PROPOSE,
  AI_APPLICATION_TYPE: C.AI_APPLICATION_TYPE_VALUATION,
  AI_USAGE_TYPE: C.AI_USAGE_TYPE_VALUATION,
  buildPromptContentForDb,
  buildValuationRecommendPromptSeeds,
  loadValuationRecommendPromptBundle,
  clearValuationRecommendPromptCache,
  renderUserPrompt,
  jsonBlock,
  sliceTargetForAi,
  sliceCandidateForAi,
};
