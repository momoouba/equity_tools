/**
 * AI 模型配置：应用类型 / 使用类型 — 与 base_dictionary 对齐。
 * dict_code: ai_model_application_type | ai_model_usage_type
 * item_code 写入 ai_model_config.application_type / usage_type
 */
const db = require('../db');

const DICT_APPLICATION_TYPE = 'ai_model_application_type';
const DICT_USAGE_TYPE = 'ai_model_usage_type';

/** 非「提供商」的 ai_model_* 字典类型（应用/使用类型等元数据） */
const AI_MODEL_META_DICT_CODES = new Set([
  DICT_APPLICATION_TYPE,
  DICT_USAGE_TYPE,
]);

const FALLBACK_PROVIDERS = [
  { value: 'alibaba', label: '阿里云（千问）' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'baidu', label: '百度（文心一言）' },
  { value: 'tencent', label: '腾讯（混元）' },
];

/** 数据字典无提供商类型时的兜底（与历史硬编码一致） */
const LEGACY_PROVIDER_DICT_CODE = {
  alibaba: 'ai_model_alibaba',
  openai: 'ai_model_openai',
  baidu: 'ai_model_baidu',
  tencent: 'ai_model_tencent',
};

const FALLBACK_AI_MODELS = {
  alibaba: ['qwen-turbo', 'qwen-plus', 'qwen3-max', 'qwen-long', 'qwen3-vl-plus'],
  openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'gpt-4o'],
  baidu: ['ernie-bot', 'ernie-bot-turbo', 'ernie-bot-4'],
  tencent: ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro'],
};

function dictCodeToProvider(dictCode) {
  const code = String(dictCode || '').trim();
  if (!code.startsWith('ai_model_')) return '';
  return code.slice('ai_model_'.length);
}

const FALLBACK_APPLICATION_TYPES = [
  { value: 'news_analysis', label: '新闻分析' },
  { value: 'project_sourcing_analysis', label: '项目挖掘分析' },
  { value: 'competitor_analysis', label: '竞品分析应用' },
  { value: 'listing_progress_analysis', label: '上市进展分析' },
  { value: 'general', label: '通用' },
];

const FALLBACK_USAGE_TYPES = [
  { value: 'content_analysis', label: '情绪分析' },
  { value: 'image_recognition', label: '图片识别' },
  { value: 'project_mining', label: '项目挖掘' },
  { value: 'listing_data', label: '上市数据' },
  { value: 'competitor_match', label: '竞品匹配' },
];

async function loadDictOptionsByCode(dictCode) {
  const code = String(dictCode || '').trim();
  if (!code) return [];
  const parents = await db.query(
    `SELECT id FROM base_dictionary
     WHERE dict_code = ? AND parent_id IS NULL AND delete_mark = 0
     ORDER BY sort_order ASC, created_at ASC
     LIMIT 1`,
    [code]
  );
  if (!parents.length) return [];
  const rows = await db.query(
    `SELECT item_code, item_name, sort_order
     FROM base_dictionary
     WHERE parent_id = ? AND delete_mark = 0 AND is_enabled = 1
       AND item_code IS NOT NULL AND TRIM(item_code) != ''
     ORDER BY sort_order ASC, id ASC`,
    [parents[0].id]
  );
  return rows.map((r) => {
    const v = String(r.item_code || '').trim();
    const label = String(r.item_name || '').trim() || v;
    return { value: v, label };
  });
}

async function loadApplicationTypeOptions() {
  const list = await loadDictOptionsByCode(DICT_APPLICATION_TYPE);
  return list.length ? list : FALLBACK_APPLICATION_TYPES;
}

async function loadUsageTypeOptions() {
  const list = await loadDictOptionsByCode(DICT_USAGE_TYPE);
  return list.length ? list : FALLBACK_USAGE_TYPES;
}

/**
 * 从 base_dictionary 加载 AI 提供商：dict_code 为 ai_model_* 且非元数据类型。
 * provider 写入 ai_model_config.provider = dict_code 去掉 ai_model_ 前缀（如 volcengine）。
 */
async function loadAiModelProviderTypesFromDictionary() {
  const rows = await db.query(
    `SELECT dict_code, dict_name, sort_order
     FROM base_dictionary
     WHERE parent_id IS NULL AND delete_mark = 0 AND is_enabled = 1
       AND dict_code LIKE 'ai_model_%'
     ORDER BY sort_order ASC, created_at ASC`
  );
  const providers = [];
  for (const r of rows) {
    const dictCode = String(r.dict_code || '').trim();
    if (!dictCode || AI_MODEL_META_DICT_CODES.has(dictCode)) continue;
    const value = dictCodeToProvider(dictCode);
    if (!value) continue;
    const label = String(r.dict_name || '').trim() || value;
    providers.push({ value, label, dictCode });
  }
  return providers;
}

async function loadAiModelProviderOptions() {
  const types = await loadAiModelProviderTypesFromDictionary();
  if (types.length) {
    return types.map(({ value, label }) => ({ value, label }));
  }
  return FALLBACK_PROVIDERS;
}

async function loadAiModelProviderDictMap() {
  const types = await loadAiModelProviderTypesFromDictionary();
  if (types.length) {
    const map = {};
    for (const t of types) {
      map[t.value] = t.dictCode;
    }
    return map;
  }
  return { ...LEGACY_PROVIDER_DICT_CODE };
}

async function loadModelOptionsForDictCode(provider, dictCode) {
  const parents = await db.query(
    `SELECT id FROM base_dictionary
     WHERE dict_code = ? AND parent_id IS NULL AND delete_mark = 0
     ORDER BY created_at ASC
     LIMIT 1`,
    [dictCode]
  );
  if (!parents.length) {
    const fallback = FALLBACK_AI_MODELS[provider];
    return (fallback || []).map((code) => ({ value: code, label: code }));
  }
  const rows = await db.query(
    `SELECT item_code, item_name, sort_order
     FROM base_dictionary
     WHERE parent_id = ? AND delete_mark = 0 AND is_enabled = 1
       AND item_code IS NOT NULL AND TRIM(item_code) != ''
     ORDER BY sort_order ASC, id ASC`,
    [parents[0].id]
  );
  if (!rows.length) {
    const fallback = FALLBACK_AI_MODELS[provider];
    return (fallback || []).map((code) => ({ value: code, label: code }));
  }
  return rows.map((r) => {
    const code = String(r.item_code || '').trim();
    const name = String(r.item_name || '').trim() || code;
    return { value: code, label: name };
  });
}

/** 各提供商可选模型：value=item_code，label=item_name */
async function loadAiModelOptionsFromDictionary() {
  const providerMap = await loadAiModelProviderDictMap();
  const out = {};
  for (const [provider, dictCode] of Object.entries(providerMap)) {
    out[provider] = await loadModelOptionsForDictCode(provider, dictCode);
  }
  return out;
}

async function getAllowedProviderCodes() {
  const opts = await loadAiModelProviderOptions();
  return opts.map((o) => o.value);
}

async function assertProviderAllowed(provider) {
  const code = String(provider || '').trim();
  const allowed = await getAllowedProviderCodes();
  if (!code || !allowed.includes(code)) {
    const err = new Error(
      '无效的提供商：须在数据字典中维护 ai_model_<提供商> 类型（如 ai_model_volcengine）且已启用'
    );
    err.statusCode = 400;
    throw err;
  }
}

async function assertModelNameAllowedForProvider(provider, modelName) {
  const mn = String(modelName || '').trim();
  if (!mn) return;
  const opts = await loadAiModelOptionsFromDictionary();
  const list = opts[provider] || [];
  if (!list.length) return;
  const codes = new Set(list.map((o) => o.value));
  if (!codes.has(mn)) {
    const err = new Error(
      '模型名称须为当前提供商在数据字典中已启用的选项编码（item_code），请在「管理员设置 → 数据字典」维护对应字典类型'
    );
    err.statusCode = 400;
    throw err;
  }
}

async function loadAiModelMetaFromDictionary() {
  const [applicationTypes, usageTypes, providers] = await Promise.all([
    loadApplicationTypeOptions(),
    loadUsageTypeOptions(),
    loadAiModelProviderOptions(),
  ]);
  return { applicationTypes, usageTypes, providers };
}

function optionsToLabelMap(options) {
  const map = {};
  for (const o of options || []) {
    if (o && o.value) map[o.value] = o.label || o.value;
  }
  return map;
}

async function getAllowedApplicationTypeCodes() {
  const opts = await loadApplicationTypeOptions();
  return opts.map((o) => o.value);
}

async function getAllowedUsageTypeCodes() {
  const opts = await loadUsageTypeOptions();
  return opts.map((o) => o.value);
}

async function assertApplicationTypeAllowed(applicationType) {
  const code = String(applicationType || '').trim();
  const allowed = await getAllowedApplicationTypeCodes();
  if (!code || !allowed.includes(code)) {
    const err = new Error(
      '无效的应用类型：须在数据字典「AI模型应用类型」(ai_model_application_type) 中维护且已启用'
    );
    err.statusCode = 400;
    throw err;
  }
}

async function assertUsageTypeAllowed(usageType) {
  const code = String(usageType || '').trim();
  const allowed = await getAllowedUsageTypeCodes();
  if (!code || !allowed.includes(code)) {
    const err = new Error(
      '无效的使用类型：须在数据字典「AI模型使用类型」(ai_model_usage_type) 中维护且已启用'
    );
    err.statusCode = 400;
    throw err;
  }
}

module.exports = {
  DICT_APPLICATION_TYPE,
  DICT_USAGE_TYPE,
  AI_MODEL_META_DICT_CODES,
  FALLBACK_APPLICATION_TYPES,
  FALLBACK_USAGE_TYPES,
  FALLBACK_PROVIDERS,
  LEGACY_PROVIDER_DICT_CODE,
  FALLBACK_AI_MODELS,
  dictCodeToProvider,
  loadDictOptionsByCode,
  loadApplicationTypeOptions,
  loadUsageTypeOptions,
  loadAiModelProviderTypesFromDictionary,
  loadAiModelProviderOptions,
  loadAiModelProviderDictMap,
  loadAiModelOptionsFromDictionary,
  loadAiModelMetaFromDictionary,
  optionsToLabelMap,
  assertProviderAllowed,
  assertModelNameAllowedForProvider,
  assertApplicationTypeAllowed,
  assertUsageTypeAllowed,
};
