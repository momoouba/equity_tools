'use strict';

const db = require('../../db');
const { AI_APPLICATION_TYPE_COMPETITOR, AI_USAGE_TYPE_COMPETITOR_MATCH } = require('./constants');

const PROMPT_INTERFACE = '竞品分析';

const PROMPT_TYPES = {
  PAIR_SIMILARITY: 'competitor_pair_similarity',
  WEB_DISCOVER: 'competitor_web_discover',
  VALIDATE: 'competitor_validate',
};

const PROMPT_SECTION_SYSTEM = '---SYSTEM---';
const PROMPT_SECTION_USER = '---USER---';

const BUILTIN = {
  [PROMPT_TYPES.PAIR_SIMILARITY]: {
    prompt_name: '竞品分析-产品相似度对标',
    system: `你是企业产品对标分析助手。根据目标企业与候选企业的产品简介与业务介绍，评估产品/业务相似度。
仅输出 JSON：{"similarity_score":0-100的整数,"rationale":"一句中文"}
禁止 Markdown 与 JSON 外文字。`,
    userTemplate: `目标企业：
{{TARGET_JSON}}

候选企业：
{{CANDIDATE_JSON}}`,
  },
  [PROMPT_TYPES.WEB_DISCOVER]: {
    prompt_name: '竞品分析-联网发现竞品',
    system: `你是竞品研究助理。在允许联网时优先用联网检索；若无法联网则根据公开知识与检索词，列出与目标企业存在竞争或对标关系的公司（同类产品/服务或可替代方案），不是上下游。
须同时覆盖两类对象（均按产品/场景匹配度排序，禁止硬编码企业名单）：
1）**与目标产品/应用场景直接重叠的同业**（含本土中小型，易被遗漏）；
2）**中国大陆上市公司**（**硬性至少 3 家**）：须在上交所（SSE）、深交所（SZSE）、北交所（BSE）或新三板（NEEQ）已上市/挂牌，按与目标**产品相似度**降序；用于估值与产品对标，**不要求与目标体量相当**。
进口品牌在华主体、港股、美股可列为 substitute 候选，但**不计入**上述 3 家国内上市公司名额。
仅输出 JSON：{"candidates":[{"company_name":"","unified_credit_code":"","is_listed":true/false,"listing_market":"sse|szse|bse|neeq|hk|other","core_products":"","business_domain":"","ai_relevance_score":0}]}
is_listed：A股/北交所/新三板已上市或挂牌为 true；无法判断则为 false。
listing_market：国内上市填 sse（上交所）、szse（深交所）、bse（北交所）、neeq（新三板）；港股填 hk；其它填 other。
禁止 Markdown。候选不超过 20 条；**其中 is_listed=true 且 listing_market 为 sse/szse/bse/neeq 的不得少于 3 家**（按 ai_relevance_score 降序取最相似者）。`,
    userTemplate: `目标画像：
{{TARGET_PROFILE_JSON}}

检索词（请用于联网搜索，可组合产品词+应用场景+「A股上市公司/上交所/深交所/北交所/同行业上市」等）：{{KEYWORDS_JSON}}

排除公司（已召回或已排除，勿重复）：{{EXCLUDE_NAMES_JSON}}

请检索：
①与目标业务直接对位的同业（含未在排除列表中的中小企业）；
②**至少 3 家**与目标产品/场景最相似的中国大陆 A 股或北交所/新三板**上市公司**（上交所、深交所、北交所均可），按相似度排序，勿用港股/美股凑数。`,
  },
  [PROMPT_TYPES.VALIDATE]: {
    prompt_name: '竞品分析-竞品关系校验',
    system: `你是企业竞品校验助手。根据目标企业与候选企业信息，完成竞品关系判断与结构化评估。

一、竞品类型（competitor_type，六选一）：
- direct：同客户、同场景、同预算，客户通常二选一（同类产品/耗材竞争）；**仅限本土或同梯队直接对位**
- indirect：解决同一需求，产品形态或路线不同
- substitute：非同类产品，但争夺同一预算或使用路径；**外资/进口头部品牌在华子公司（如颇尔、赛多利斯、默克/Millipore、Cytiva/思拓凡）即使产品线重叠，也标 substitute 而非 direct**
- upstream_downstream：供应链/渠道/能力互补，或制药装备集成商、整线设备商（不以过滤膜耗材为主业，如东富龙、楚天）
- same_track：行业/概念相近，但不构成实质竞争（如透析为主业而候选做生物工艺过滤膜）
- not_competitor：文本或标签相似但业务实质不相关；或装备平台/控股方而非膜耗材同业；或综合型生物工艺平台（培养基/反应器/填料为主、过滤仅为子线）与专注过滤膜耗材目标无直接二选一

二、三维度评估（各 0-100 整数）：
- substitutability：产品/方案替代性（客户是否二选一）
- customer_overlap：目标客户重合度
- scenario_overlap：使用场景重合度

三、综合：
- is_competitor：direct/indirect/substitute/same_track 为 true；upstream_downstream/not_competitor 为 false
- is_upstream_downstream：类型为 upstream_downstream 时为 true
- validated_score：校验综合分 0-100
- **体量/市值**：目标为初创或未上市企业时，候选为上市公司**不得**仅因规模更大或更小而降分、改判非竞品或改判 same_track；按产品与客户场景重叠度评分即可

四、主副业错位（重点）：
- 目标 **subject_track_hint** 或简介显示以**血液透析/透析器/医院肾科血液净化**为主业，候选以**生物制药除菌/除病毒/深层/TFF 过滤膜耗材**为主业 → **same_track**（客户与采购预算不同，勿标 direct）
- 目标以**生物制药过滤膜/过滤器耗材**为主业，候选为**综合型生物工艺平台**（细胞培养基、生物反应器、填料、一次性系统为主，过滤仅为子产品线且无除病毒/深层膜核心 SKU）→ **not_competitor** 或最多 indirect（勿标 direct）
- 装备集成商/控股方（东富龙等）→ upstream_downstream 或 not_competitor
- 目标为生物制药过滤膜/耗材，候选为**多宁生物**等综合生物工艺平台（培养基/反应器/填料为主，与膜企多为创始人/履历关联而非产品 direct 竞争）→ **not_competitor**（勿标 direct；上市对标 run 可保留 substitute/indirect 由检索意图决定）
- 候选同时布局层析填料/细胞培养等辅线，但**除菌/深层/除病毒/囊式/TFF 等制药过滤膜或过滤器**为明确 SKU 且客户群与目标重叠（如品善生物）→ **direct**（勿因辅产品线标 indirect；与一次性配液/储液系统为主的乐纯、百林科不同）

仅输出 JSON（禁止 Markdown）：
{"is_competitor":true/false,"competitor_type":"direct|indirect|substitute|upstream_downstream|same_track|not_competitor","is_listed":true/false,"industry_match":true/false,"core_overlap_percent":0-100,"is_upstream_downstream":false,"validated_score":0-100,"reject_reason":"","key_differences":"核心差异一句话","dimension_scores":{"substitutability":0,"customer_overlap":0,"scenario_overlap":0},"rationale":"竞品判断一句话"}

is_listed：新三板、拟上市、A股/港股(含仅H股)等已上市或处于上市进程为 true；无法判断则为 false。若候选为上市公司，须在 JSON 中准确标 is_listed=true。`,
    userTemplate: `目标：
{{TARGET_JSON}}

候选：
{{CANDIDATE_JSON}}`,
  },
};

function buildPromptContentForDb(promptType) {
  const b = BUILTIN[promptType];
  if (!b) throw new Error(`未知竞品提示词类型: ${promptType}`);
  return `${PROMPT_SECTION_SYSTEM}\n${b.system}\n${PROMPT_SECTION_USER}\n${b.userTemplate}`;
}

function buildAllCompetitorPromptSeeds() {
  return Object.values(PROMPT_TYPES).map((promptType) => ({
    prompt_name: BUILTIN[promptType].prompt_name,
    interface_type: PROMPT_INTERFACE,
    prompt_type: promptType,
    prompt_content: buildPromptContentForDb(promptType),
  }));
}

function resolveCompetitorPromptSections(storedContent, promptType) {
  const fallback = BUILTIN[promptType];
  if (!fallback) {
    throw new Error(`未知竞品提示词类型: ${promptType}`);
  }
  const raw = storedContent != null ? String(storedContent).trim() : '';
  if (!raw) {
    return { system: fallback.system, userTemplate: fallback.userTemplate };
  }
  const idxS = raw.indexOf(PROMPT_SECTION_SYSTEM);
  const idxU = raw.indexOf(PROMPT_SECTION_USER);
  if (idxS !== -1 && idxU !== -1 && idxU > idxS) {
    const systemPart = raw.slice(idxS + PROMPT_SECTION_SYSTEM.length, idxU).trim();
    const userPart = raw.slice(idxU + PROMPT_SECTION_USER.length).trim();
    return {
      system: systemPart || fallback.system,
      userTemplate: userPart || fallback.userTemplate,
    };
  }
  return {
    system: fallback.system,
    userTemplate: raw,
  };
}

function renderCompetitorUserPrompt(userTemplate, vars) {
  let out = String(userTemplate || '');
  for (const [key, value] of Object.entries(vars || {})) {
    const token = `{{${key}}}`;
    out = out.split(token).join(value != null ? String(value) : '');
  }
  return out;
}

const bundleCache = {
  ts: 0,
  map: new Map(),
};
const CACHE_MS = 60_000;

async function loadCompetitorPromptBundle(promptType) {
  const now = Date.now();
  if (now - bundleCache.ts < CACHE_MS && bundleCache.map.has(promptType)) {
    return bundleCache.map.get(promptType);
  }

  const rows = await db.query(
    `SELECT F_Id AS id, prompt_content, ai_model_config_id
     FROM ai_prompt_config
     WHERE interface_type = ?
       AND prompt_type = ?
       AND is_active = 1
       AND F_DeleteMark = 0
     ORDER BY F_LastModifyTime DESC
     LIMIT 1`,
    [PROMPT_INTERFACE, promptType]
  );

  const stored = rows.length ? rows[0].prompt_content : '';
  const { system, userTemplate } = resolveCompetitorPromptSections(stored, promptType);
  const bundle = {
    promptType,
    promptConfigId: rows.length ? rows[0].id : null,
    ai_model_config_id: rows.length ? rows[0].ai_model_config_id : null,
    system,
    userTemplate,
    fromDb: rows.length > 0,
  };
  bundleCache.map.set(promptType, bundle);
  bundleCache.ts = now;
  return bundle;
}

function clearCompetitorPromptCache() {
  bundleCache.ts = 0;
  bundleCache.map.clear();
}

module.exports = {
  PROMPT_INTERFACE,
  PROMPT_TYPES,
  PROMPT_SECTION_SYSTEM,
  PROMPT_SECTION_USER,
  BUILTIN,
  buildPromptContentForDb,
  buildAllCompetitorPromptSeeds,
  resolveCompetitorPromptSections,
  renderCompetitorUserPrompt,
  loadCompetitorPromptBundle,
  clearCompetitorPromptCache,
};
