/**
 * AI 模型配置：应用类型 / 使用类型 — 与 base_dictionary 对齐。
 * dict_code: ai_model_application_type | ai_model_usage_type
 * item_code 写入 ai_model_config.application_type / usage_type
 */
const db = require('../db');

const DICT_APPLICATION_TYPE = 'ai_model_application_type';
const DICT_USAGE_TYPE = 'ai_model_usage_type';

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

async function loadAiModelMetaFromDictionary() {
  const [applicationTypes, usageTypes] = await Promise.all([
    loadApplicationTypeOptions(),
    loadUsageTypeOptions(),
  ]);
  return { applicationTypes, usageTypes };
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
  FALLBACK_APPLICATION_TYPES,
  FALLBACK_USAGE_TYPES,
  loadDictOptionsByCode,
  loadApplicationTypeOptions,
  loadUsageTypeOptions,
  loadAiModelMetaFromDictionary,
  optionsToLabelMap,
  assertApplicationTypeAllowed,
  assertUsageTypeAllowed,
};
