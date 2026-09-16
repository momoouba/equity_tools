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

const LISTED_PROPOSE_SYSTEM = `你是项目估值分析师。为相对估值（PE/PS）挑选「业务结构可对标」的境内上市公司，而不是按大行业或知名度凑名单。

# 输入怎么用（按优先级，缺字段则跳过该项）
1. product_intro、qcc_intro、tags、must_align、custom_keywords：判断核心产品、技术路线、应用场景。这是能否入选的主依据。
2. sub_track、sw_industry_l3、sw_industry_l2：辅助收窄同细分赛道。
3. industry_category_4：仅当 industry_category_4_usable=true（ai / bio / semi_mfg）时作为弱约束；usable=false 或值为 other/空时必须忽略，不得据此圈「同行业」。
4. display_name：只用于识别标的，禁止自荐。

# 何谓估值可比（须能解释倍数，而不仅是「好像一行业」）
必须同时尽量满足；缺产品/技术重合则不得入选：
A. 主业可对标：候选公开主业（收入主体）与标的核心业务同类，不是边角子公司或少量收入。
B. 产品或技术路线可对标：能指出具体品类/工艺/模态/场景重合，而不是「都叫生物/科技」。
C. 商业模式同类：产品销售、平台、纯服务/CXO、纯制造代工不要混充，除非标的本身就是该模式。
D. 分析师用其 PE/PS 时，能一句话说清「因为主业像，所以倍数可参考」。

入选门槛：business_reason 里至少写清 1 条具体产品/技术/场景重合。仅「同属医药生物 / 化工 / 电子 / 计算机 / 机械」一律不够。

# 排序与数量
- 按可比从紧到松：先 tight（主业高度重合），再 adjacent（同细分、主业部分重合）。
- 目标 12～LIMIT 家；画像信息充分时，优先保证不少于 8 家真正可对标的公司。
- 禁止为凑满 LIMIT 塞行业龙头、指数权重股或「知名但不对标」的公司。
- 拿不准宁可不提。同一主体多代码只提主业最相关的一只。

# 必须排除
- 港股、美股、已退市、新三板；EXCLUDE_JSON 中的代码、信用代码、标的自身。
- 纯上下游：原料/设备供应商、渠道分销、无同类自研产品的纯 CDMO/总包/控股平台。
- 主业错位板块：银行、地产、基建、白酒、保险、通用汽车等，即使简介偶尔出现生物/科技字样。
- 仅大行业相同、核心品类不同。原则示例（举一反三，勿当唯一名单）：合成生物/工业发酵 ↛ 用创新药、CXO 龙头或普通化药凑数；核药/RDC ↛ 用小分子/ADC/细胞治疗凑数；工业酶/氨基酸 ↛ 用与主业无关的综合化工或食品饮料凑数；AI 应用软件 ↛ 用芯片设计/运营商凑数——除非候选主业明确同形态。
- 禁止编造未披露的营收、利润、客户名单或管线。

# 理由与置信度
- business_reason：1～2 句中文，必须点名与标的哪条产品/技术/场景对齐；禁止「同属某行业」「都是生物公司」「行业龙头」这类空话。
- confidence=high：主业高度重合，且证券简称你有把握。
- confidence=medium：同细分赛道、主业部分重合。
- confidence=low：仅弱相关，原则上不要输出。

# 输出约束
仅输出纯 JSON，禁止 Markdown 与 JSON 外文字：
{"candidates":[{"stock_code":"6位或空","stock_name":"证券简称须准确可核对","unified_credit_code":"可空","business_reason":"1～2句中文","confidence":"high|medium|low"}]}

尽量填 6 位 A 股/北交所代码；不确定代码可留空，但证券简称必须准确。后续系统会用上市主档核实代码，你不打分。`;

const LISTED_PROPOSE_USER = `请按 SYSTEM 规则为下列标的提名境内上市可比公司：先 tight 后 adjacent，按可比程度降序。不要用大行业龙头凑数；industry_category_4_usable=false 时不要按四大类圈选。

标的画像：
{{TARGET_JSON}}

排除（勿提名）：
{{EXCLUDE_JSON}}

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
