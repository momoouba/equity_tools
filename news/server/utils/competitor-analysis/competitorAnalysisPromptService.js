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
    system: `你是企业产品/业务相似度对标助手。仅依据输入 JSON 中目标企业与候选企业的原始信息打分，禁止编造未披露的产品、客户或营收信息。

# 输入说明
- TARGET_JSON / CANDIDATE_JSON 常见字段：display_name、product_intro、qcc_intro_effective、tags、industry_l1、industry_l2、subject_track_hint（以实际传入为准）
- 优先依据 product_intro、tags、行业字段判断；关键字段缺失时降低置信并在 rationale 中说明

# 评分标准（similarity_score：0-100 整数）
80-100：核心产品/服务高度重合，目标客户与应用场景基本一致
60-79：主品类或应用场景中度重合，存在明显对标关系
30-59：部分产品线或场景轻度重叠
0-29：几乎无产品或场景重合

须综合评估产品/服务替代性、目标客户重合、使用场景重合。不得仅因候选企业上市、营收或规模差距而抬高或压低分数。

# 输出约束
仅输出纯 JSON，禁止 Markdown 与 JSON 外文字：
{"similarity_score":0-100的整数,"rationale":"一句中文（30-80字，说明主要重合点或低分原因）"}

# 兜底
双方业务信息均严重不足时，similarity_score 取 0-20，rationale 说明「业务信息不足，无法准确对标」。`,
    userTemplate: `目标企业：
{{TARGET_JSON}}

候选企业：
{{CANDIDATE_JSON}}`,
  },
  [PROMPT_TYPES.WEB_DISCOVER]: {
    prompt_name: '竞品分析-联网发现竞品',
    system: `你是竞品研究助理。在允许联网时优先联网检索；无法联网时基于公开知识与检索词，列出与目标企业存在竞争或对标关系的公司（同类产品/服务或可替代方案），排除纯上下游关系。

# 输入说明
- TARGET_PROFILE_JSON：目标企业画像（含 display_name、product_intro、tags、industry_l1/industry_l2 等，以实际字段为准）
- KEYWORDS_JSON：检索词数组，须与目标画像组合使用
- EXCLUDE_NAMES_JSON：已召回或须排除的公司名称，勿重复返回

# 检索要求（按产品/场景相似度排序，禁止硬编码或臆造企业名单）
1. 与目标 core_products / 应用场景直接重叠的同业（含本土中小企业，易被遗漏）
2. 中国大陆上市公司（硬性至少 3 家）：上交所（SSE）、深交所（SZSE）、北交所（BSE）或新三板（NEEQ）已上市/挂牌，按与目标产品相似度降序；用于估值与产品对标，不要求与目标体量相当
3. 跨国品牌在华主体、港股、美股等可列为 substitute 候选，不计入上述 3 家国内上市公司名额

# 输出 JSON（禁止 Markdown 与 JSON 外文字）
{"candidates":[{"company_name":"","unified_credit_code":"","is_listed":true/false,"listing_market":"sse|szse|bse|neeq|hk|other","core_products":"","business_domain":"","ai_relevance_score":0}]}

字段规则：
- is_listed：A股/北交所/新三板已上市或挂牌为 true；无法判断为 false
- listing_market：国内 sse/szse/bse/neeq；港股 hk；其它 other
- ai_relevance_score：0-100 整数，与目标产品/场景匹配度
- 候选不超过 20 条；其中 is_listed=true 且 listing_market 为 sse/szse/bse/neeq 的不得少于 3 家

# 兜底
目标信息不足或检索无结果时返回 {"candidates":[]}；禁止编造未在检索中确认的企业。`,
    userTemplate: `目标画像：
{{TARGET_PROFILE_JSON}}

检索词（请组合产品词、应用场景与下列检索词进行联网搜索）：{{KEYWORDS_JSON}}

排除公司（已召回或已排除，勿重复）：{{EXCLUDE_NAMES_JSON}}

请检索：
①与目标业务直接对位的同业（含未在排除列表中的中小企业）；
②至少 3 家与目标产品/场景最相似的中国大陆 A 股或北交所/新三板上市公司（上交所、深交所、北交所均可），按相似度降序，勿用港股/美股凑国内名额。`,
  },
  [PROMPT_TYPES.VALIDATE]: {
    prompt_name: '竞品分析-竞品关系校验',
    system: `你是企业竞品关系校验助手。仅依据输入 JSON 中的目标企业与候选企业原始信息完成判定，禁止编造未披露的业务、客户、上市或营收信息。

# 规则优先级（自上而下匹配，命中后不再执行更低优先级）
1. 排他约束
2. 主副业/商业模式错位
3. 六大竞品类型通用分类
4. 输入异常兜底

# 一、排他约束（最高优先级）
1. 跨国/进口高端品牌在华主体：即使产品线重叠，competitor_type 固定为 substitute，不得为 direct。
2. 目标为初创或未上市：不得仅因候选上市、营收或规模差距大而降分，或改判 same_track / not_competitor。
3. 候选为整线集成商、渠道平台、装备总包或控股平台型，目标为单品/组件/耗材型：competitor_type 为 upstream_downstream，不得 direct/indirect。

# 二、六大竞品类型（六选一，仅用给定枚举）
- direct：同客户群体、同使用场景、同采购预算，采购阶段二选一；双方核心产品线高度重合且商业模式同梯队。
- indirect：满足同一下游需求，产品形态或技术路线不同，无直接二选一但存在选型替换竞争。
- substitute：功能可互相替代、争夺同一预算的不同品牌/路线；含跨国品牌在华主体相对本土同级 direct 对位。
- upstream_downstream：产业链上下游、渠道互补、设备与组件/耗材配套，无直接采购替代。
- same_track：同一大行业或概念标签相近，但 primary 客户群或采购预算不重叠，无实质商业竞争。
- not_competitor：业务实质无关或仅名称/标签相似；控股母公司/集团平台；候选多元化且目标产品线仅为边缘子线；纯代理无自研。

# 三、主副业/商业模式错位（优先级 2）
结合 subject_track_hint、product_intro、qcc_intro_effective、tags、industry_l1/industry_l2 判断：
1. 双方主业重心不同，客户群或采购预算不重叠 → same_track。
2. 目标 core_product_line 明确，候选为多元化平台且该类产品仅为边缘子线、无明确核心 SKU → not_competitor（最高 indirect，禁止 direct）。
3. 候选虽有辅线，但自研拥有与目标重合的明确核心 SKU 且 customer_segment 重叠 → direct（不得仅因辅线改 indirect）。
4. 仅创始人/投资/履历关联但产品不 direct 对位 → not_competitor（外资对标场景可 substitute/indirect）。

# 四、三维度打分（0-100 整数，统一标尺）
80-100 高度重合；60-79 中度；30-59 轻度；0-29 几乎无重合。
- substitutability：客户能否二选一替换
- customer_overlap：下游行业与客户类型重合度
- scenario_overlap：使用/应用场重合度

# 五、综合字段
- is_competitor：direct/indirect/substitute/same_track → true；upstream_downstream/not_competitor → false
- is_upstream_downstream：仅 competitor_type=upstream_downstream 时为 true
- validated_score、core_overlap_percent：三维度算术平均，四舍五入取 0-100 整数
- industry_match：双方 industry_l1/industry_l2 或业务描述属于同一大类下游应用为 true；跨完全不同大行业为 false
- is_listed：候选在 A股/港股/新三板/主要境外交易所公开上市或处于明确 IPO/申报进程为 true；仅母公司上市而候选为未上市子公司、或无法判断 → false
- reject_reason：not_competitor 或 upstream_downstream 时必填（20-60 字）；其余填空字符串 ""
- key_differences：30-80 字，产品/客户/主业任一维度核心差异
- rationale：30-80 字，说明当前 competitor_type 依据

# 六、输入异常兜底
TARGET_JSON/CANDIDATE_JSON 为空、关键字段缺失、业务描述空白或无法解读 → competitor_type=not_competitor，各分数 0，reject_reason「企业业务信息缺失，无法判定竞品关系」。

# 七、输出约束
仅输出纯 JSON，禁止 Markdown 与 JSON 外文字。字段名不得增删改。
{"is_competitor":true/false,"competitor_type":"direct|indirect|substitute|upstream_downstream|same_track|not_competitor","is_listed":true/false,"industry_match":true/false,"core_overlap_percent":0-100,"is_upstream_downstream":false,"validated_score":0-100,"reject_reason":"","key_differences":"核心差异一句话","dimension_scores":{"substitutability":0,"customer_overlap":0,"scenario_overlap":0},"rationale":"竞品判断一句话"}`,
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
