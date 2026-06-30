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
- TARGET_JSON / CANDIDATE_JSON 常见字段：display_name、product_intro、qcc_intro_effective、tags、industry_l1、industry_l2、subject_track_hint、core_product_lines（以实际传入为准）
- **core_product_lines** 表示目标/候选的核心装备、耗材、SKU 品类，是对标首要依据
- 禁止仅因同属大行业、下游同为生物制药/生命科学、客户类型有交集而给高分

# 评分标准（similarity_score：0-100 整数）
80-100：core_product_lines 或 product_intro 中**核心品类/SKU 高度重合**（如均为过滤/纯化装备耗材、或均为一次性反应器+层析系统），客户采购可二选一
60-79：主品类中度重合，存在明确对标关系（至少 2 项 core_product_lines 语义对齐）
30-59：部分工艺环节或辅线重叠，但核心 SKU 不完全一致
0-29：几乎无 core_product_lines 重合；或仅为同一大行业/同类型客户

**硬上限（必须遵守）**：
- 仅大行业/客户类型相同，core_product_lines 无实质对齐 → **similarity_score 不得高于 45**
- 候选为创新药/试剂/检测设备/数字化/医院信息化/水处理/半导体等与目标装备耗材品类不同 → **不得高于 40**

须综合评估核心产品线替代性、场景重合度。不得仅因上市或规模差距单独加减分。

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

# 检索要求（按 core_product_lines / 核心 SKU 相似度排序，禁止硬编码或臆造企业名单）
1. 与目标 **core_product_lines** 直接对位的同业（同类装备/耗材/SKU，含本土与境外企业）
2. **境内企业**：须可核验 18 位统一社会信用代码，并填写最新工商注册全称
3. **境外企业**（港股/美股/欧洲等）：可返回，listing_market 填 hk/nyse/nasdaq 等；unified_credit_code 可留空
4. 不得仅因同属生物制药、生命科学、医疗健康等大行业而列入；须说明与目标哪条 core_product_lines 对齐
5. **境内上市公司硬性至少 3 家**（sse/szse/bse/neeq）：须与目标**核心品类**最相似，按 ai_relevance_score 降序；**境外上市公司不计入该 3 家名额**

**排除**：创新药研发企业、纯试剂/工具、检测设备、数字化平台、水处理/环保、半导体装备等——除非其明确经营与目标重合的核心 SKU。

# 输出 JSON（禁止 Markdown 与 JSON 外文字）
{"candidates":[{"company_name":"","unified_credit_code":"","is_listed":true/false,"listing_market":"sse|szse|bse|neeq|hk|nyse|nasdaq","core_products":"","business_domain":"","ai_relevance_score":0}]}

字段规则：
- company_name：**当前最新法定全称**（境内用工商全称；境外用官方英文或中英文法定名）
- unified_credit_code：**18 位中国大陆统一社会信用代码**（仅境内企业必填；境外可留空）
- is_listed：已上市为 true；无法判断为 false
- listing_market：sse/szse/bse/neeq（境内）；hk/nyse/nasdaq 等（境外）
- ai_relevance_score：0-100 整数，与目标产品/场景匹配度
- 候选不超过 20 条；其中 **境内** is_listed=true 且 listing_market 为 sse/szse/bse/neeq 的不得少于 3 家（境外上市不计入）

# 兜底
目标信息不足或检索无结果时返回 {"candidates":[]}；禁止编造未在检索中确认的企业。`,
    userTemplate: `目标画像：
{{TARGET_PROFILE_JSON}}

检索词（请组合产品词、应用场景与下列检索词进行联网搜索）：{{KEYWORDS_JSON}}

排除公司（已召回或已排除，勿重复）：{{EXCLUDE_NAMES_JSON}}

请检索：
①与目标业务直接对位的同业（境内须含 18 位统一社会信用代码与最新法定全称；境外可仅填公司法定名与 listing_market）；
②至少 3 家与目标产品/场景最相似的**中国大陆** A 股或北交所/新三板上市公司，按相似度降序（**境外上市不计入该 3 家**）。`,
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
0. **不得仅因候选为境外/港股/美股主体而判 not_competitor**；须按产品与场景对标关系判定。境外主体无法提供境内信用代码时，仍可依据 product_intro/core_product_lines 判竞品类型。
1. 目标为初创或未上市：不得仅因候选上市、营收或规模差距大而降分，或改判 same_track / not_competitor。
2. 候选为整线集成商、渠道平台、装备总包或控股平台型，目标为单品/组件/耗材型：competitor_type 为 upstream_downstream，不得 direct/indirect。
3. **仅大行业/客户类型相同，core_product_lines 或 product_intro 核心 SKU 未对齐**：不得判 direct/indirect/substitute；应判 same_track 或 not_competitor，validated_score≤45。

# 二、六大竞品类型（六选一，仅用给定枚举）
- direct：core_product_lines 高度重合，同客户、同场景、同采购预算，采购二选一
- indirect：核心品类部分重合或工艺环节相邻，存在选型替换竞争
- substitute：不同品牌/路线可替代，但须与目标至少一条 core_product_lines 语义相关
- upstream_downstream：产业链上下游、配套关系，无直接 SKU 替代
- same_track：同一大行业或标签相近，但 core_product_lines 不对齐、采购预算不重叠
- not_competitor：业务实质无关；或仅同属大行业/客户有交集但产品线完全不同（创新药、试剂、检测、数字化、水处理等）

# 三、主副业/商业模式错位（优先级 2）
结合 subject_track_hint、core_product_lines、product_intro、tags、industry 判断：
1. 双方 core_product_lines 不对齐，仅大行业或客户类型相同 → same_track 或 not_competitor（禁止 direct）
2. 目标 core_product_lines 明确，候选为多元化平台且目标品类仅为边缘子线 → not_competitor（最高 indirect）
3. 候选 core_product_lines 与目标有多条对齐 → direct（不得仅因辅线改 indirect）
4. 仅关联关系无产品对位 → not_competitor

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
- is_listed：候选在 A股/北交所/新三板公开上市或处于明确境内 IPO/申报进程为 true；仅境外上市、或无法判断 → false（境外上市仍可为竞品，is_listed 填 false）
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
