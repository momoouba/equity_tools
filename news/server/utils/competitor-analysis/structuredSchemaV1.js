'use strict';

/**
 * Stage 3 — structured_profile_json 值域（structured_schema_v1）
 * 三大类：ai / bio / semi_mfg（semi_mfg 内 sub_track: semi | advanced_mfg）
 */

const STRUCTURED_SCHEMA_VERSION = 'structured_schema_v1';

const PRIORITY_CATEGORY_4 = Object.freeze(['ai', 'bio', 'semi_mfg']);

const SUB_TRACKS = Object.freeze(['semi', 'advanced_mfg']);

const FIELD_SCHEMAS = {
  ai: {
    primary_product: { type: 'string', maxLen: 300 },
    delivery: { type: 'string', maxLen: 64 },
    target_customer: { type: 'string', maxLen: 200 },
    scale_signals: { type: 'string', maxLen: 300 },
    tech_stack: { type: 'array', maxItems: 12, itemMaxLen: 64 },
  },
  bio: {
    value_chain: { type: 'string', maxLen: 64 },
    modality: { type: 'string', maxLen: 64 },
    process_stage: { type: 'string', maxLen: 64 },
    core_skus: { type: 'array', maxItems: 12, itemMaxLen: 80 },
    customer_type: { type: 'string', maxLen: 120 },
  },
  semi: {
    chain_position: { type: 'string', maxLen: 64 },
    process_node: { type: 'string', maxLen: 120 },
    product_class: { type: 'string', maxLen: 120 },
    foundry_model: { type: 'string', maxLen: 64 },
  },
  advanced_mfg: {
    process_route: { type: 'string', maxLen: 200 },
    downstream_application: { type: 'string', maxLen: 200 },
    capacity_scale: { type: 'string', maxLen: 120 },
    core_equipment: { type: 'array', maxItems: 12, itemMaxLen: 80 },
  },
};

function strTrim(v) {
  return v == null ? '' : String(v).trim();
}

function clipStr(s, maxLen) {
  const t = strTrim(s);
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function normalizeStringField(value, spec) {
  return clipStr(value, spec.maxLen || 500);
}

function normalizeArrayField(value, spec) {
  let arr = value;
  if (typeof arr === 'string') {
    arr = arr.split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
  }
  if (!Array.isArray(arr)) return null;
  const out = arr
    .map((x) => clipStr(x, spec.itemMaxLen || 80))
    .filter(Boolean)
    .slice(0, spec.maxItems || 12);
  return out.length ? out : null;
}

/**
 * @param {string} category4
 * @param {string|null} subTrack
 * @param {object} raw
 */
function normalizeStructuredProfile(category4, subTrack, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cat = strTrim(category4);
  if (!PRIORITY_CATEGORY_4.includes(cat)) return null;

  const out = {
    schema_version: STRUCTURED_SCHEMA_VERSION,
    category_4: cat,
    sub_track: cat === 'semi_mfg' ? strTrim(subTrack) || 'advanced_mfg' : null,
  };

  let fieldSet;
  if (cat === 'ai') fieldSet = FIELD_SCHEMAS.ai;
  else if (cat === 'bio') fieldSet = FIELD_SCHEMAS.bio;
  else if (out.sub_track === 'semi') fieldSet = FIELD_SCHEMAS.semi;
  else fieldSet = FIELD_SCHEMAS.advanced_mfg;

  for (const [key, spec] of Object.entries(fieldSet)) {
    if (spec.type === 'array') out[key] = normalizeArrayField(raw[key], spec);
    else out[key] = normalizeStringField(raw[key], spec);
  }

  const filled = Object.keys(fieldSet).filter((k) => {
    const v = out[k];
    return v != null && (!(Array.isArray(v)) || v.length > 0);
  });
  if (!filled.length) return null;
  return out;
}

function getSchemaPromptBlock(category4, subTrack) {
  const cat = strTrim(category4);
  if (cat === 'ai') {
    return `赛道=ai（数字智能）。JSON 业务字段：
- primary_product: 核心产品/服务（一句话，必填优先）
- delivery: 交付形态，优先从枚举取值：SaaS / 硬件 / 解决方案 / 平台 / API / 其他
- target_customer: 目标客户（一句话）
- scale_signals: 规模/阶段信号（融资轮次、客户数、营收区间等；无则 null）
- tech_stack: 技术栈关键词 JSON 数组（2-8 项，勿用逗号拼接字符串）`;
  }
  if (cat === 'bio') {
    return `赛道=bio（生物医药）。JSON 业务字段：
- value_chain: 产业链位置，优先：创新药 / CXO / 器械 / 诊断 / 数字化 / 其他
- modality: 技术模态（小分子/抗体/细胞治疗等；无则 null）
- process_stage: 阶段，优先：临床前 / 临床 / 注册 / 商业化 / 其他
- core_skus: 核心产品/管线 JSON 数组（1-8 项）
- customer_type: 客户类型（医院/药企/渠道等）`;
  }
  const st = strTrim(subTrack) === 'semi' ? 'semi' : 'advanced_mfg';
  if (st === 'semi') {
    return `赛道=semi_mfg，sub_track=semi（半导体）。JSON 业务字段：
- chain_position: 产业链位置，优先：设计 / 制造 / 封测 / 设备 / 材料 / EDA/IP / 其他
- process_node: 制程节点或工艺代际（无则 null）
- product_class: 产品类别（存储/逻辑/模拟/MCU 等）
- foundry_model: 经营模式（Fabless/IDM/Foundry 等）`;
  }
  return `赛道=semi_mfg，sub_track=advanced_mfg（先进制造）。JSON 业务字段：
- process_route: 工艺路线/制造能力（20 字内短语，勿整段复制简介）
- downstream_application: 下游应用行业
- capacity_scale: 产能/规模信号（无则 null）
- core_equipment: 核心装备/产品线 JSON 数组（1-8 项）`;
}

function getSchemaJsonExample(category4, subTrack) {
  const cat = strTrim(category4);
  if (cat === 'ai') {
    return `{
  "schema_version": "${STRUCTURED_SCHEMA_VERSION}",
  "category_4": "ai",
  "sub_track": null,
  "primary_product": "企业级大模型应用开发平台",
  "delivery": "SaaS",
  "target_customer": "中大型互联网企业",
  "scale_signals": "B轮，服务百余家企业客户",
  "tech_stack": ["大模型", "RAG", "Agent"]
}`;
  }
  if (cat === 'bio') {
    return `{
  "schema_version": "${STRUCTURED_SCHEMA_VERSION}",
  "category_4": "bio",
  "sub_track": null,
  "value_chain": "CXO",
  "modality": "抗体",
  "process_stage": "临床",
  "core_skus": ["抗肿瘤单抗管线", "ADC 平台"],
  "customer_type": "创新药企"
}`;
  }
  const st = strTrim(subTrack) === 'semi' ? 'semi' : 'advanced_mfg';
  if (st === 'semi') {
    return `{
  "schema_version": "${STRUCTURED_SCHEMA_VERSION}",
  "category_4": "semi_mfg",
  "sub_track": "semi",
  "chain_position": "设计",
  "process_node": "7nm",
  "product_class": "MCU",
  "foundry_model": "Fabless"
}`;
  }
  return `{
  "schema_version": "${STRUCTURED_SCHEMA_VERSION}",
  "category_4": "semi_mfg",
  "sub_track": "advanced_mfg",
  "process_route": "精密零部件数控加工",
  "downstream_application": "新能源汽车",
  "capacity_scale": "年产千万件级",
  "core_equipment": ["五轴加工中心", "检测仪器"]
}`;
}

module.exports = {
  STRUCTURED_SCHEMA_VERSION,
  PRIORITY_CATEGORY_4,
  SUB_TRACKS,
  FIELD_SCHEMAS,
  normalizeStructuredProfile,
  getSchemaPromptBlock,
  getSchemaJsonExample,
};
