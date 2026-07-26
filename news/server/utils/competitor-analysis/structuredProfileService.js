'use strict';

const db = require('../../db');
const { llmInvoke } = require('../llm/llmInvoke');
const { getActiveCompetitorModelConfig } = require('./competitorAnalysisAi');
const { mapAiModelConfigRow } = require('../llm/llmConfigMap');
const { strTrim, normalizeCreditCode } = require('./competitorMatchUtils');
const { withFinancingAiConcurrency } = require('../project-sourcing/financingAiEnrichService');
const {
  STRUCTURED_SCHEMA_VERSION,
  normalizeStructuredProfile,
  getSchemaPromptBlock,
  getSchemaJsonExample,
} = require('./structuredSchemaV1');
const { buildFinancingFanOutWhere } = require('../project-sourcing/baikeLookupService');
const { companyDedupeKey } = require('../project-sourcing/listedFinancingJoin');
const { normalizeCompanyName } = require('../listing/zhconvUtils');

const MIN_CONTEXT_LEN = 40;
const APPLY_CONCURRENCY_DEFAULT = Math.max(
  1,
  Math.min(4, parseInt(process.env.STRUCTURED_APPLY_CONCURRENCY || '1', 10) || 1)
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function executeWithDeadlockRetry(dbConn, sql, params, retries = 12) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await dbConn.execute(sql, params);
    } catch (err) {
      const retryable =
        err &&
        (err.code === 'ER_LOCK_DEADLOCK' ||
          err.code === 'ER_LOCK_WAIT_TIMEOUT' ||
          err.errno === 1205 ||
          err.errno === 1213);
      if (retryable && attempt < retries) {
        await sleep(Math.min(5000, 300 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function mapWithConcurrency(items, concurrency, fn) {
  if (!items.length) return [];
  const n = Math.min(concurrency, items.length);
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

function extractJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function resolveStructuredLlmConfig(opts = {}) {
  if (opts.modelName) {
    const rows = await db.query(
      `SELECT F_Id AS id, provider, model_name, api_key, api_endpoint, api_type,
              temperature, max_tokens, top_p, enable_thinking,
              wire_protocol, web_search_mode, reasoning_effort
       FROM ai_model_config
       WHERE model_name = ? AND is_active = 1 AND F_DeleteMark = 0
         AND api_key IS NOT NULL AND TRIM(api_key) <> ''
       ORDER BY F_CreatorTime DESC
       LIMIT 1`,
      [opts.modelName]
    );
    if (rows[0]) return mapAiModelConfigRow(rows[0]);

    // 百炼新模型名可能尚未单独入库：复用 compatible-mode 基座，仅替换 model_name
    if (/^qwen/i.test(opts.modelName)) {
      const baseRows = await db.query(
        `SELECT F_Id AS id, provider, model_name, api_key, api_endpoint, api_type,
                temperature, max_tokens, top_p, enable_thinking,
                wire_protocol, web_search_mode, reasoning_effort
         FROM ai_model_config
         WHERE is_active = 1 AND F_DeleteMark = 0
           AND api_key IS NOT NULL AND TRIM(api_key) <> ''
           AND api_endpoint LIKE '%compatible-mode%'
           AND model_name IN ('qwen3.6-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.5-plus', 'qwen-plus', 'qwen-turbo')
         ORDER BY FIELD(model_name, 'qwen3.6-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.5-plus', 'qwen-plus', 'qwen-turbo'), F_CreatorTime DESC
         LIMIT 1`
      );
      if (baseRows[0]) {
        const cfg = mapAiModelConfigRow(baseRows[0]);
        const baseName = cfg.model_name;
        cfg.model_name = opts.modelName;
        console.warn(
          `[structuredProfile] 模型 ${opts.modelName} 未单独入库，复用 ${baseName} 的 DashScope compatible-mode 配置`
        );
        return cfg;
      }
    }
    throw new Error(`未找到可用模型配置: ${opts.modelName}`);
  }

  let row = await getActiveCompetitorModelConfig();
  if (!row) {
    const fallback = await db.query(
      `SELECT F_Id AS id, provider, model_name, api_key, api_endpoint, api_type,
              temperature, max_tokens, top_p, enable_thinking,
              wire_protocol, web_search_mode, reasoning_effort
       FROM ai_model_config
       WHERE application_type = 'project_sourcing_analysis'
         AND is_active = 1 AND F_DeleteMark = 0
         AND api_key IS NOT NULL AND TRIM(api_key) <> ''
       ORDER BY F_CreatorTime DESC
       LIMIT 1`
    );
    row = fallback[0];
  }
  if (!row) {
    throw new Error('未找到可用的 AI 模型配置（competitor_match / project_sourcing_analysis）');
  }
  return mapAiModelConfigRow(row);
}

function buildContextBlock(row) {
  const parts = [];
  const intro =
    strTrim(row.ai_product_intro) ||
    strTrim(row.product_intro) ||
    strTrim(row.company_intro) ||
    strTrim(row.bp_extract_text);
  if (intro) parts.push(`【产品/业务简介】\n${intro.slice(0, 6000)}`);
  const tags = strTrim(row.ai_company_tags_display) || strTrim(row.ai_industry_tags_display);
  if (tags) parts.push(`【行业标签】\n${tags.slice(0, 1000)}`);
  const lv = [row.industry_source_lv1, row.industry_source_lv2].filter(Boolean).join(' / ');
  if (lv) parts.push(`【烯牛行业】\n${lv}`);
  return parts.join('\n\n');
}

function classifyStructuredExtract(content, category4, subTrack) {
  const raw = extractJsonObject(content);
  if (!raw) {
    return { ok: false, reason: 'json_parse_fail', profile: null, raw: null };
  }
  const profile = normalizeStructuredProfile(category4, subTrack, raw);
  if (!profile) {
    return { ok: false, reason: 'all_fields_empty', profile: null, raw };
  }
  return { ok: true, reason: null, profile, raw };
}

/**
 * @returns {{ systemContent: string, userContent: string } | null}
 */
function buildStructuredPromptMessages(meta, sourceRow) {
  const context = buildContextBlock(sourceRow);
  if (context.length < MIN_CONTEXT_LEN) return null;

  const category4 = strTrim(meta.industry_category_4);
  const subTrack = meta.sub_track ?? null;
  const companyName = strTrim(meta.company_name || meta.enterprise_full_name);
  const systemContent = `你是竞品分析结构化画像助手。根据给定企业材料，抽取 L2 structured 字段并输出 JSON。

# 任务
将非结构化简介转为下方 schema 的 JSON 对象，用于竞品对标。

# 输入说明
- 【产品/业务简介】为主依据；【行业标签】【烯牛行业】仅辅助归类
- 禁止编造材料中未出现的客户、营收、产品细节

# 规则
1. 仅输出一个 JSON 对象，禁止 markdown、代码块、JSON 外说明文字。
2. schema_version 固定为 "${STRUCTURED_SCHEMA_VERSION}"；category_4 固定为 "${category4}"。
${category4 === 'semi_mfg' ? `3. sub_track 固定为 "${subTrack || 'advanced_mfg'}"。` : ''}
4. 至少 1 个业务字段必须有实质内容（非 null、非空字符串、非空数组）。
5. 材料极弱时，仍须输出完整 JSON，并尽量填写 primary_product 或等价主字段的一句话摘要。
6. 不确定的字段用 null；数组字段必须是 JSON array，勿用逗号拼接字符串。
7. 若材料与当前赛道不完全匹配，仍抽取最接近的 1-2 项：能源/化工→工艺与应用；投资控股→主字段写投资领域；外文公司→按中文简介或英文关键词填写。

${getSchemaPromptBlock(category4, subTrack)}

# 输出示例（字段名与类型必须一致，值请按实际材料填写，勿照抄）
${getSchemaJsonExample(category4, subTrack)}`;

  const userContent = `企业：${companyName}\n\n${context}`;
  return { systemContent, userContent };
}

/**
 * @param {{ company_name?: string, enterprise_full_name?: string, industry_category_4: string, sub_track?: string|null }} meta
 * @param {object} sourceRow
 */
async function extractStructuredProfile(meta, sourceRow, opts = {}) {
  const prompts = buildStructuredPromptMessages(meta, sourceRow);
  if (!prompts) {
    return { ok: false, reason: 'insufficient_context', profile: null };
  }

  const category4 = strTrim(meta.industry_category_4);
  const subTrack = meta.sub_track ?? null;
  const { systemContent, userContent } = prompts;

  const config = await resolveStructuredLlmConfig(opts);
  const llm = await withFinancingAiConcurrency(() =>
    llmInvoke(config, {
      systemContent,
      userContent,
      wantSearch: false,
      searchRequired: false,
      logPrefix: '[structuredProfile]',
      timeout: 120000,
      temperature: 0.1,
      top_p: 0.8,
      max_tokens: 2048,
      chatBodyExtras: { response_format: { type: 'json_object' } },
    })
  );

  const classified = classifyStructuredExtract(llm.content, category4, subTrack);
  if (!classified.ok) {
    return {
      ok: false,
      reason: classified.reason === 'json_parse_fail' ? 'empty_or_invalid_json' : 'all_fields_empty',
      profile: null,
      raw: classified.raw,
    };
  }
  return { ok: true, profile: classified.profile, model: config.model_name };
}

async function loadFinancingRepresentativeRow(db, companyRow) {
  const map = await loadFinancingRepresentativeRowsMap(db, [companyRow]);
  return map.get(companyDedupeKey(companyRow)) || null;
}

/**
 * 批量加载代表行（一次 SQL + 内存择优），供 Batch prep 使用。
 * @returns {Map<string, object>} dedupeKey → row
 */
async function loadFinancingRepresentativeRowsMap(dbConn, companies) {
  const credits = new Set();
  const namesNoCredit = new Set();

  for (const c of companies) {
    const credit = normalizeCreditCode(c.company_credit_code);
    if (credit) credits.add(credit);
    else {
      const nm = normalizeCompanyName(strTrim(c.company_name));
      if (nm) namesNoCredit.add(nm);
    }
  }

  const bestByKey = new Map();
  if (!credits.size && !namesNoCredit.size) return bestByKey;

  const conditions = [];
  const params = [];
  if (credits.size) {
    const list = [...credits];
    conditions.push(`TRIM(company_credit_code) IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
  if (namesNoCredit.size) {
    const list = [...namesNoCredit];
    conditions.push(
      `(company_credit_code IS NULL OR TRIM(company_credit_code) = '') AND TRIM(company_name) IN (${list.map(() => '?').join(',')})`
    );
    params.push(...list);
  }

  const rows = await dbConn.query(
    `SELECT company_name, company_credit_code, industry_category_4, industry_source_lv1, industry_source_lv2,
            company_intro, ai_product_intro, ai_company_tags_display, profile_source, event_date
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND (${conditions.join(' OR ')})`,
    params
  );

  for (const row of rows) {
    const key = companyDedupeKey(row);
    const existing = bestByKey.get(key);
    const hasIntro = strTrim(row.ai_product_intro).length > 0;
    const existingHasIntro = existing && strTrim(existing.ai_product_intro).length > 0;
    const dt = String(row.event_date || '');
    const existingDt = existing ? String(existing.event_date || '') : '';
    if (!existing || (hasIntro && !existingHasIntro) || (hasIntro === existingHasIntro && dt > existingDt)) {
      bestByKey.set(key, row);
    }
  }
  return bestByKey;
}

async function applyStructuredToFinancingFanOut(db, companyRow, profile) {
  const where = buildFinancingFanOutWhere(companyRow);
  if (!where) return 0;
  const json = JSON.stringify(profile);
  const r = await executeWithDeadlockRetry(
    db,
    `UPDATE sourcing_financing_event SET
       structured_profile_json = ?,
       structured_schema_version = ?,
       structured_at = CURRENT_TIMESTAMP,
       F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE ${where.clause}`,
    [json, STRUCTURED_SCHEMA_VERSION, ...where.params]
  );
  return r.affectedRows || 0;
}

/**
 * 并行 fan-out 写库（有限并发 + 死锁重试）。
 */
async function applyStructuredBatchParallel(dbConn, items, opts = {}) {
  const concurrency = opts.concurrency || APPLY_CONCURRENCY_DEFAULT;
  const results = await mapWithConcurrency(items, concurrency, async ({ company, profile }) => {
    const n = await applyStructuredToFinancingFanOut(dbConn, company, profile);
    return n;
  });
  return results.reduce((sum, n) => sum + (Number(n) || 0), 0);
}

async function applyStructuredToPreInvestment(db, projectId, profile) {
  const json = JSON.stringify(profile);
  const r = await db.execute(
    `UPDATE pre_investment_project SET
       structured_profile_json = ?,
       structured_schema_version = ?,
       structured_at = CURRENT_TIMESTAMP,
       F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [json, STRUCTURED_SCHEMA_VERSION, projectId]
  );
  return r.affectedRows || 0;
}

module.exports = {
  STRUCTURED_SCHEMA_VERSION,
  MIN_CONTEXT_LEN,
  extractJsonObject,
  classifyStructuredExtract,
  buildStructuredPromptMessages,
  resolveStructuredLlmConfig,
  extractStructuredProfile,
  loadFinancingRepresentativeRow,
  loadFinancingRepresentativeRowsMap,
  applyStructuredToFinancingFanOut,
  applyStructuredBatchParallel,
  APPLY_CONCURRENCY_DEFAULT,
  applyStructuredToPreInvestment,
};
