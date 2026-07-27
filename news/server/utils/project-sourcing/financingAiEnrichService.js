const axios = require('axios');
const FormDataMultipart = require('form-data');
const crypto = require('crypto');
const db = require('../../db');
const newsAnalysis = require('../newsAnalysis');
const {
  searchMetaFromLlmCall,
  searchMetaForBatchFile,
  searchMetaForReuseDonor,
  searchMetaForReuseExisting,
  searchMetaSqlAssignments,
  searchMetaSqlValues,
} = require('./financingAiEnrichSearchMeta');
const { llmInvoke, resolveLlmProfile } = require('../llm/llmInvoke');
const { LLM_CONFIG_SELECT_SQL, mapAiModelConfigRow } = require('../llm/llmConfigMap');
const { executeWithAiEnrichLogColumns } = require('../migrateAiEnrichLogColumns');

const PROMPT_INTERFACE = '项目挖掘';
const PROMPT_TYPE = 'project_sourcing_financing_web_enrich';
const AI_ENRICH_VERSION = 'financing_web_enrich_v1';

/** 批量队列每条任务完成后间隔（毫秒），减轻大模型接口并发压力；可通过环境变量 FINANCING_AI_BATCH_GAP_MS 调整 */
const BATCH_AI_GAP_MS = Math.max(
  500,
  Math.min(60000, parseInt(process.env.FINANCING_AI_BATCH_GAP_MS || '500', 10) || 500)
);

/** 手动与小批量（≤阈值）共用：同时进行的 DashScope 请求上限 */
const FINANCING_AI_CONCURRENCY_N = Math.max(
  1,
  Math.min(32, parseInt(process.env.FINANCING_AI_CONCURRENCY || '4', 10) || 4)
);

/** 去重后的代表企业数大于该值时走百炼 Batch File 异步；否则走并发多条 chat/completions */
const BATCH_FILE_THRESHOLD = Math.max(
  1,
  Math.min(50000, parseInt(process.env.FINANCING_AI_BATCH_FILE_THRESHOLD || '100', 10) || 100)
);

/** 任务日志：扫描进度每隔 N 条输出摘要（FINANCING_AI_JOB_LOG_PROGRESS_EVERY） */
const FINANCING_AI_JOB_LOG_PROGRESS_EVERY = Math.max(
  1,
  Math.min(500, parseInt(process.env.FINANCING_AI_JOB_LOG_PROGRESS_EVERY || '25', 10) || 25)
);
/** Batch 轮询：每 N 次请求打一行远程状态 */
const FINANCING_AI_JOB_LOG_POLL_EVERY = Math.max(
  1,
  Math.min(120, parseInt(process.env.FINANCING_AI_JOB_LOG_POLL_EVERY || '6', 10) || 6)
);
/** Batch 回写：每成功解析 N 条打一行进度 */
const FINANCING_AI_JOB_LOG_APPLY_EVERY = Math.max(
  1,
  Math.min(500, parseInt(process.env.FINANCING_AI_JOB_LOG_APPLY_EVERY || '50', 10) || 50)
);

const financingAiBatchQueue = [];
/** @type {Promise<void>|null} */
let financingAiBatchPumpPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @type {Array<() => void>} */
const financingAiConcurrencyWaiters = [];
let financingAiConcurrencyActive = 0;

function acquireFinancingAiConcurrencySlot() {
  if (financingAiConcurrencyActive < FINANCING_AI_CONCURRENCY_N) {
    financingAiConcurrencyActive += 1;
    return Promise.resolve(releaseFinancingAiConcurrencySlot);
  }
  return new Promise((resolve) => {
    financingAiConcurrencyWaiters.push(() => {
      financingAiConcurrencyActive += 1;
      resolve(releaseFinancingAiConcurrencySlot);
    });
  });
}

function releaseFinancingAiConcurrencySlot() {
  financingAiConcurrencyActive -= 1;
  const next = financingAiConcurrencyWaiters.shift();
  if (next) next();
}

/**
 * 限制融资 AI 的 DashScope 同步并发（手动单条 + 小批量批量共用）。
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withFinancingAiConcurrency(fn) {
  const release = await acquireFinancingAiConcurrencySlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * 按「批量任务 batch_id」输出阶段日志，便于 Docker/运维对齐一次操作在跑哪一步。
 * @param {string} batchId
 * @param {'batch_file'|'concurrent_chat'} mode
 * @param {string} phase 短英文阶段名，如 prepare_progress / upload_start / poll_status
 * @param {string} message
 * @param {Record<string, unknown>|null} [meta]
 */
function financingAiJobLog(batchId, mode, phase, message, meta = null) {
  const head = `[financingAiEnrich][job=${batchId}][${mode}][${phase}] ${message}`;
  if (meta != null && typeof meta === 'object') {
    let s = '';
    try {
      s = JSON.stringify(meta);
      if (s.length > 1200) s = s.slice(0, 1200) + '…';
    } catch {
      s = '';
    }
    console.log(s ? `${head} | ${s}` : head);
  } else {
    console.log(head);
  }
}

function normalizeCompanyName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @returns {string} 非空则为 trim 后的统一社会信用代码，否则 '' */
function normalizedCreditCode(code) {
  const c = String(code ?? '').trim();
  return c.length ? c : '';
}

/** 手动 AI 取数：强制联网调用模型，不复用库内已有 AI 字段 */
function isManualFinancingAiEnrichTrigger(triggerType) {
  return String(triggerType || '').trim() === 'manual_api';
}

/** Stage 2b 无百科降级批处理（§6.6）：独立触发类型，落库 profile_source=llm_web */
const NO_BAIKE_ENRICH_TRIGGER = 'batch_no_baike_enrich';

function isNoBaikeEnrichTrigger(triggerType) {
  return String(triggerType || '').trim() === NO_BAIKE_ENRICH_TRIGGER;
}

const NO_BAIKE_USER_PREFIX = `【重要：无百度百科词条】
经系统检索，该企业无百度百科词条（baike_lemma_status=not_found）。请勿假设存在百科摘要。
请完全依赖联网检索（官网、新闻、招聘页、产品发布等）撰写 product_intro；企查查材料仅作主体核对，禁止照抄经营范围。
材料仍不足时，product_intro 固定写「公开信息不足，无法归纳」；tags 为 []。

`;

/**
 * 同一企业在库内多条融资记录：有信用代码则按代码批量更新；无代码则按企业全称批量更新；否则仅当前 id。
 */
function buildEnterpriseFanOutWhere(row, financingEventId) {
  const credit = normalizedCreditCode(row.company_credit_code);
  if (credit) {
    return {
      clause: 'F_DeleteMark = 0 AND TRIM(company_credit_code) = ?',
      params: [credit],
    };
  }
  const nm = normalizeCompanyName(row.company_name);
  if (nm) {
    return {
      clause:
        "F_DeleteMark = 0 AND (company_credit_code IS NULL OR TRIM(company_credit_code) = '') AND TRIM(company_name) = ?",
      params: [nm],
    };
  }
  return {
    clause: 'F_DeleteMark = 0 AND F_Id = ?',
    params: [financingEventId],
  };
}

/** 是否已有可用的产品介绍(AI)+企业标签(AI)，可供跳过模型调用 */
function eventHasCompleteAiContent(row) {
  const intro = String(row.ai_product_intro ?? '').trim();
  if (!intro) return false;
  const disp = String(row.ai_company_tags_display ?? '').trim();
  if (disp) return true;
  const j = row.ai_company_tags_json;
  if (j == null) return false;
  try {
    const arr = typeof j === 'string' ? JSON.parse(j) : j;
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

/**
 * 查找同主体另一条融资事件上已成功写入的 AI 简介+标签，供新事件复用。
 * 匹配规则与 buildEnterpriseFanOutWhere 一致：有信用代码按代码，否则按企业全称（且无代码）。
 */
async function findFinancingAiDonorRow({ credit, name, excludeId }) {
  const idEx = parseInt(String(excludeId), 10);
  if (!Number.isFinite(idEx) || idEx <= 0) return null;
  const creditNorm = normalizedCreditCode(credit);
  const nameNorm = normalizeCompanyName(name);

  const tail = `
      AND ai_enrich_status = 'success'
      AND TRIM(IFNULL(ai_product_intro,'')) <> ''
      AND (
        TRIM(IFNULL(ai_company_tags_display,'')) <> ''
        OR (ai_company_tags_json IS NOT NULL AND JSON_LENGTH(ai_company_tags_json) > 0)
      )
      ORDER BY ai_enrich_at DESC, F_Id DESC
      LIMIT 1`;

  if (creditNorm) {
    const rows = await db.query(
      `SELECT F_Id AS id, ai_product_intro, ai_company_tags_display, ai_company_tags_json,
              ai_enrich_at, ai_enrich_model, ai_enrich_version
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND F_Id <> ? AND TRIM(IFNULL(company_credit_code,'')) = ? ${tail}`,
      [idEx, creditNorm]
    );
    return rows[0] || null;
  }
  if (nameNorm) {
    const rows = await db.query(
      `SELECT F_Id AS id, ai_product_intro, ai_company_tags_display, ai_company_tags_json,
              ai_enrich_at, ai_enrich_model, ai_enrich_version
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND F_Id <> ?
         AND (company_credit_code IS NULL OR TRIM(company_credit_code) = '')
         AND TRIM(IFNULL(company_name,'')) = ?
       ${tail}`,
      [idEx, nameNorm]
    );
    return rows[0] || null;
  }
  return null;
}

function serializeTagsJsonForDb(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

/**
 * 将捐赠行的 AI 字段按主体扇出写入「尚未具备完整 AI 成功结果」的事件行。
 */
async function applyFinancingAiReuseFromDonor(donor, centerRow, financingEventId) {
  const fan = buildEnterpriseFanOutWhere(centerRow, financingEventId);
  const intro = donor.ai_product_intro != null ? String(donor.ai_product_intro) : '';
  const disp = donor.ai_company_tags_display != null ? String(donor.ai_company_tags_display).trim() : '';
  const tagsJson = serializeTagsJsonForDb(donor.ai_company_tags_json);
  const enrichAt = donor.ai_enrich_at || null;
  const model = donor.ai_enrich_model != null ? String(donor.ai_enrich_model) : null;
  const version =
    donor.ai_enrich_version != null && String(donor.ai_enrich_version).trim()
      ? String(donor.ai_enrich_version).trim()
      : AI_ENRICH_VERSION;

  await db.execute(
    `UPDATE sourcing_financing_event SET
       ai_product_intro = ?,
       ai_company_tags_display = ?,
       ai_company_tags_json = ?,
       ai_enrich_status = 'success',
       ai_enrich_at = COALESCE(?, NOW()),
       ai_enrich_model = ?,
       ai_enrich_version = ?,
       ai_enrich_error = NULL,
       F_LastModifyTime = NOW()
     WHERE ${fan.clause}
       AND F_DeleteMark = 0
       AND (
         ai_enrich_status IS NULL
         OR ai_enrich_status IN ('pending','failed','skipped','running')
         OR (ai_enrich_status = 'success' AND TRIM(IFNULL(ai_product_intro,'')) = '')
       )`,
    [intro || null, disp || null, tagsJson, enrichAt, model, version, ...fan.params]
  );
}

/** prepare 将扇出置为 running 但未清空正文时，恢复 success，不调用模型 */
async function restoreFanOutAiSuccessWithoutLlm(row, financingEventId) {
  const fan = buildEnterpriseFanOutWhere(row, financingEventId);
  await db.execute(
    `UPDATE sourcing_financing_event SET
       ai_enrich_status = 'success',
       ai_enrich_error = NULL,
       F_LastModifyTime = NOW()
     WHERE ${fan.clause}`,
    [...fan.params]
  );
}

async function markFinancingAiEnrichLogSuccess({
  logId,
  started,
  llmModelConfigId,
  promptConfigId,
  productIntroStored,
  display,
  searchMeta = null,
}) {
  const duration = Date.now() - started;
  const sm = searchMetaSqlValues(searchMeta);
  await executeWithAiEnrichLogColumns(
    db,
    `UPDATE sourcing_financing_ai_enrich_log SET
       execution_status = 'success',
       finished_at = NOW(),
       duration_ms = ?,
       llm_model_config_id = ?,
       prompt_type = ?,
       prompt_version = ?,
       ai_enrich_version = ?,
       error_message = NULL,
       result_product_intro = ?,
       result_company_tags_display = ?,
       ${searchMetaSqlAssignments()},
       F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [
      duration,
      llmModelConfigId != null ? llmModelConfigId : null,
      PROMPT_TYPE,
      promptConfigId != null ? String(promptConfigId) : null,
      AI_ENRICH_VERSION,
      productIntroStored || null,
      display || null,
      ...sm,
      logId,
    ]
  );
}

async function markFinancingAiEnrichFailed({
  financingEventId,
  logId,
  row,
  started,
  llmModelConfigId,
  promptMeta,
  err,
}) {
  const msg = (err && err.message) || String(err);
  const short = msg.length > 500 ? msg.slice(0, 497) + '...' : msg;
  const duration = Date.now() - started;
  try {
    const fanFail = row
      ? buildEnterpriseFanOutWhere(row, financingEventId)
      : { clause: 'F_DeleteMark = 0 AND F_Id = ?', params: [financingEventId] };
    await db.execute(
      `UPDATE sourcing_financing_event SET
           ai_enrich_status = 'failed',
           ai_enrich_error = ?,
           F_LastModifyTime = NOW()
         WHERE ${fanFail.clause}`,
      [short, ...fanFail.params]
    );
  } catch (e2) {
    console.error('[financingAiEnrich] rollback event status failed', e2);
  }
  try {
    await db.execute(
      `UPDATE sourcing_financing_ai_enrich_log SET
           execution_status = 'failed',
           finished_at = NOW(),
           duration_ms = ?,
           llm_model_config_id = ?,
           prompt_type = ?,
           prompt_version = ?,
           ai_enrich_version = ?,
           error_message = ?,
           F_LastModifyTime = NOW()
         WHERE F_Id = ?`,
      [
        duration,
        llmModelConfigId,
        PROMPT_TYPE,
        promptMeta?.id != null ? String(promptMeta.id) : null,
        AI_ENRICH_VERSION,
        short,
        logId,
      ]
    );
  } catch (e3) {
    console.error('[financingAiEnrich] log failed update', e3);
  }
  console.error('[financingAiEnrich] task failed', { financingEventId, logId, err: msg });
}

/**
 * 将单条 chat 返回正文解析并扇出写入事件表 + 成功日志（与 runFinancingAiEnrichTask 中 LLM 成功路径一致）。
 */
async function persistFinancingAiLlmSuccess({
  row,
  financingEventId,
  logId,
  raw,
  config,
  promptConfigId,
  llmModelConfigId,
  started,
  taskLog = null,
  searchMeta = null,
  syncProjectDesc = false,
  markProfileSourceLlmWeb = false,
}) {
  const parsed = extractJsonObject(raw);
  const norm = normalizeAiPayload(parsed);
  if (!norm) {
    logAndThrowUnparseableModelJson(raw, 'persist_financing');
  }

  const productIntroStored = stripProductIntroMetaAttribution(
    stripRedundantIdentifiersFromProductIntro(norm.product_intro, row)
  );
  const tagsJson = JSON.stringify(norm.tags);
  const display = norm.tags.join('、');

  const fan = buildEnterpriseFanOutWhere(row, financingEventId);
  const projectDescStored = syncProjectDesc ? productIntroStored : null;
  const profileSourceSql = markProfileSourceLlmWeb
    ? `profile_source = CASE
         WHEN COALESCE(profile_source, '') IN ('listed_sync', 'bp', 'baike') THEN profile_source
         ELSE 'llm_web'
       END,`
    : '';
  const updHdr = await db.execute(
    `UPDATE sourcing_financing_event SET
         ai_product_intro = ?,
         ${syncProjectDesc ? 'project_desc = ?,' : ''}
         ai_company_tags_display = ?,
         ai_company_tags_json = ?,
         ${profileSourceSql}
         ai_enrich_status = 'success',
         ai_enrich_at = NOW(),
         ai_enrich_model = ?,
         ai_enrich_version = ?,
         ai_enrich_error = NULL,
         F_LastModifyTime = NOW()
       WHERE ${fan.clause}`,
    [
      productIntroStored || null,
      ...(syncProjectDesc ? [projectDescStored || null] : []),
      display || null,
      tagsJson,
      String(config.model_name || ''),
      AI_ENRICH_VERSION,
      ...fan.params,
    ]
  );

  const duration = Date.now() - started;
  const sm = searchMetaSqlValues(searchMeta);
  await executeWithAiEnrichLogColumns(
    db,
    `UPDATE sourcing_financing_ai_enrich_log SET
         execution_status = 'success',
         finished_at = NOW(),
         duration_ms = ?,
         llm_model_config_id = ?,
         prompt_type = ?,
         prompt_version = ?,
         ai_enrich_version = ?,
         error_message = NULL,
         result_product_intro = ?,
         result_company_tags_display = ?,
         ${searchMetaSqlAssignments()},
         F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
    [
      duration,
      llmModelConfigId,
      PROMPT_TYPE,
      promptConfigId ? String(promptConfigId) : null,
      AI_ENRICH_VERSION,
      productIntroStored || null,
      display || null,
      ...sm,
      logId,
    ]
  );

  const affected = updHdr && typeof updHdr.affectedRows === 'number' ? updHdr.affectedRows : null;
  const searchNote =
    searchMeta && searchMeta.invoke_mode
      ? ` invoke=${searchMeta.invoke_mode} used_search=${searchMeta.used_enable_search} search_degraded=${searchMeta.search_degraded} used_thinking=${searchMeta.used_enable_thinking} thinking_degraded=${searchMeta.thinking_degraded}`
      : '';
  const baseOk = `[financingAiEnrich] success event_id=${financingEventId} log_id=${logId} duration_ms=${duration} model=${config.model_name}${searchNote}` +
    (affected != null ? ` rows_updated=${affected}` : '');
  if (taskLog && taskLog.batchId && taskLog.suppressSuccessConsole) {
    financingAiJobLog(taskLog.batchId, taskLog.mode || 'batch_file', 'persist_llm_ok', baseOk.replace(/^\[financingAiEnrich\] /, ''));
  } else {
    console.log(
      baseOk +
        `\n  product_intro(AI): ${productIntroStored || '(空)'}\n` +
        `  tags(AI): ${display || '(空)'}`
    );
  }

  /* ── AI 增强成功后异步触发结构化信息提取 ── */
  setImmediate(async () => {
    try {
      const metaRows = await db.query(
        `SELECT company_name, company_credit_code, industry_category_4, industry_source_lv1, industry_source_lv2,
                ai_product_intro, ai_company_tags_display
         FROM sourcing_financing_event WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
        [financingEventId]
      );
      if (!metaRows.length) return;
      const metaRow = metaRows[0];
      if (!String(metaRow.ai_product_intro || '').trim()) return;
      if (!String(metaRow.industry_category_4 || '').trim()) return;

      const { extractStructuredProfile, applyStructuredToFinancingFanOut } = require('../competitor-analysis/structuredProfileService');
      const sourceRow = {
        company_intro: null,
        ai_product_intro: metaRow.ai_product_intro,
        ai_company_tags_display: metaRow.ai_company_tags_display,
      };
      const meta = {
        company_name: metaRow.company_name,
        industry_category_4: metaRow.industry_category_4,
        sub_track: null,
      };
      const sp = await extractStructuredProfile(meta, sourceRow);
      if (sp && sp.ok && sp.profile) {
        const n = await applyStructuredToFinancingFanOut(db, { company_name: metaRow.company_name, company_credit_code: metaRow.company_credit_code }, sp.profile);
        console.log(`[financingAiEnrich][structured] event_id=${financingEventId} → ${n} rows, model=${sp.model}`);
      } else {
        console.log(`[financingAiEnrich][structured] event_id=${financingEventId} skipped: ${sp?.reason || 'no_profile'}`);
      }
    } catch (err) {
      console.warn('[financingAiEnrich][structured] trigger failed:', err.message);
    }
  });
}

/**
 * 投融资入库后：若库内同主体已有成功 AI 简介+标签，则扇出复写到本事件（及同主体待填行）。
 * @returns {Promise<boolean>} 是否发生了复用写入
 */
async function reuseFinancingAiForEventId(eventDbId) {
  const idNum = parseInt(String(eventDbId), 10);
  if (!Number.isFinite(idNum) || idNum <= 0) return false;

  const ev = await db.query(
    `SELECT F_Id AS id, company_name, company_credit_code, ai_enrich_status, ai_product_intro,
            ai_company_tags_display, ai_company_tags_json
     FROM sourcing_financing_event WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [idNum]
  );
  if (!ev.length) return false;
  const row = ev[0];
  if (eventHasCompleteAiContent(row)) return false;

  const donor = await findFinancingAiDonorRow({
    credit: row.company_credit_code,
    name: row.company_name,
    excludeId: idNum,
  });
  if (!donor) return false;

  await applyFinancingAiReuseFromDonor(donor, row, idNum);
  console.log(
    `[financingAiEnrich] ingest reuse enterprise_ai from sourcing_financing_event.id=${donor.id} -> fan-out center=${idNum}`
  );
  return true;
}

/** 与库表 ai_prompt_config.prompt_content 分段约定一致，初始化写入全量 */
const PROMPT_SECTION_SYSTEM = '---SYSTEM---';
const PROMPT_SECTION_USER = '---USER---';

/**
 * 系统侧内置（兜底）：角色、输出契约、联网与合规约束。
 * 若库中 ---SYSTEM--- 段落为空或缺失，则整段采用本内容。
 */
const BUILTIN_SYSTEM_PROMPT = `你是「项目挖掘-融资信息联网增强」任务中的企业研究助手，面向一级市场投研与项目初筛场景。

【任务】
在启用联网检索的前提下，根据用户消息中给出的企业名称、统一社会信用代码（如有）以及可选的项目/融资侧名称，检索并归纳该工商主体在公开渠道可核对的业务与产品信息，并生成简短企业标签，供列表展示与检索使用。

【信息来源与可信度】
- **product_intro 优先采信（按优先级）**：企业官网「产品/解决方案/关于我们」、权威媒体报道与访谈、产品发布/融资新闻、上市公司或发债主体披露（若适用）；须通过联网检索主动获取上述信息。
- **企查查/工商侧材料（低优先级，用途受限）**：用户消息中的企查查简介、公示经营范围等，**多数与工商登记经营范围雷同、过宽**，**不得**作为 product_intro 的主依据或照抄；仅用于：核对统一社会信用代码对应主体、现用名/曾用名/更名迁址、排除同名误匹配。
- 禁止编造：不得虚构融资额、估值、客户名单、订单收入、市占率等无法从公开检索合理支撑的数字与事实；不确定则省略或写笼统表述。
- **写法边界**：上述渠道仅用于你内心的检索、交叉验证与取舍；**写入 product_intro 时禁止带出出处措辞**，例如「官网显示」「官方网站显示」「公开信息显示」「部分媒体报道」「有媒体报道」「据悉」「有消息称」「资料表明」等——应改用**直接陈述语气**写产品与服务事实，仿佛对产品说明撰稿，而非新闻摘要。
- **主体对齐（硬性）**：
  - **统一社会信用代码是同一工商主体的主键**：代码不变则视为同一法人延续（含迁址、更名）；不得以「用户给出的名称与企查查现用名不一致」 alone 判定失败。
  - **更名、迁址、曾用名与投资简称**：用户消息中的「企业名称」可能是现用工商全称、历史名称、投资档案简称或项目简称；项目简称（如有）可作检索别名。须结合信用代码、企查查片段（若有，侧重名称与代码而非经营范围文案）、联网结果中的曾用名/原名/更名/迁址记录判断是否同一主体。**仅因字面名称不一致，禁止**直接输出「公开信息不足」。
  - 若提供了**非空**信用代码：以该代码锁定主体并归纳其业务；仅当代码明确指向另一家公司、或存在无法消解的同名歧义且完全无法建立名称与代码关联时，才按【失败与降级】处理。
  - 若信用代码**为空**：须联网检索，用企业名称、项目简称及企查查/官网交叉验证；仍无法唯一确认时才降级。
- **内容与可核对性**：product_intro 须与**联网检索到的该主体实际产品/业务**一致；勿把工商经营范围、企查查模板式简介当作真实产品描述。
- **反幻觉（硬性）**：以统一社会信用代码（若有）锁定主体后，product_intro 的每条关键表述须能在**官网产品页、媒体报道、检索摘要**等中合理对应；不得因名称含「智能/科技/机器人」等词默认写入人形机器人、通用机器人平台、全栈硬件+大模型等泛化话术。
- **企查查简介勿当产品说明**：即使用户消息附有企查查介绍，若其内容仅为经营范围罗列或宽泛行业表述，应**忽略其业务措辞**，改从联网检索归纳真实产品与场景。

【输出格式（硬性）】
- 仅输出一个 JSON 对象，不要 markdown、不要代码围栏、不要任何前缀或后缀说明文字。
- JSON 顶层字段固定且仅包含两个键：
  1）product_intro：字符串，对应库表语义为「产品简介(AI)」，与接口原始 project_desc 无关，勿把二者混写为同一段的「更正版」。
  2）tags：字符串数组，对应库表语义为「企业标签(AI)」的结构化来源；展示层会用顿号拼接，因此每个数组元素应是一个独立短语（元素内不要用顿号拼多个概念）。

【字段要求】
- product_intro：**范围限定为产品与商业化能力介绍**——产品线、平台/工具、解决方案、核心功能、目标客户与典型落地场景（电商/教育/营销等）、差异化价值；用简练书面语直接陈述，**不写**舆情报道式花边。
  **勿写**：出处套话（见上条）；单纯背书性质的「与高校/实验室/校企产学研合作研发」「联合开展课题」等表述，除非能明确对应**已商业化的具体产品或模块名称**（否则一律省略）；泛泛的合作传闻、媒体报道中的次要信息。
  **篇幅**：建议 80～400 字；信息不足时允许写「公开信息有限」类短句。
  **重要**：列表其它列已包含企业名称与统一社会信用代码，product_intro **不得以工商注册全称起笔**，也不得在正文开头复述全称；第一句应直接写业务、产品或应用场景（例如直接写「聚焦…」「主营…」「面向…」）。若必须指称主体，仅用「该公司」「其」「企业」等泛指，勿写全称。
  **禁止**：「企业名称：」「统一社会信用代码：」等标签行，以及在正文首句重复企业全称。
- tags：3～10 条为宜；每条 2～12 字为佳，如「工业机器人」「SaaS 财税」「半导体检测」；避免空泛词如「高科技」「创新企业」单独占一条；可与赛道弱相关但须能概括业务。完全无法归纳时允许 tags 为空数组。

【失败与降级】
- **仅当**经信用代码与联网/企查查仍无法确认主体、或确认是另一家无关公司时：product_intro **固定**写「公开信息不足，无法归纳」；tags 为 []。
- **不得**因「档案名称≠企查查现用名」但信用代码一致且可查更名关系，就误判为信息不足。
- 仍须输出合法 JSON，不要输出 null 或省略字段。`;

/**
 * 用户侧内置（兜底）：占位符说明 + 任务复述；库中 ---USER--- 为空或缺失时用本模板。
 */
const BUILTIN_USER_PROMPT = `以下为待增强的一条记录中的主体字段（占位符已由系统替换，你只需按要求输出 JSON）：

企业名称（档案/列表用，可能是现用名、曾用名或投资简称）：{{COMPANY_NAME}}
统一社会信用代码：{{CREDIT_CODE}}
（可选）项目简称：{{PROJECT_NAME}}
企查查侧参考（仅辅助核对主体/曾用名；多为经营范围口径，勿据此写 product_intro）：
{{QCC_COMPANY_INTRO}}

【本条执行要点】
1）**主体核对（含更名、迁址）**
   - 信用代码非空时：以代码为准锁定工商主体；{{COMPANY_NAME}} 与企查查/联网「现用名」不一致时，应检索曾用名、更名、迁址、项目简称是否指向同一主体，**不得**仅因字面不同就写「公开信息不足」。
   - 信用代码为空时：联网检索 {{COMPANY_NAME}}、{{PROJECT_NAME}} 及企查查片段；仍无法唯一确认时才写「公开信息不足，无法归纳」，tags 为 []。
   - 仅当确认是另一家无关公司，或完全无法建立名称与代码/业务关联时，才降级。

2）**产品简介质量**
   - 仅写产品与商业化能力；**以联网检索到的官网/产品/报道为准**，勿照抄企查查或工商经营范围。
   - 检索时建议组合：{{COMPANY_NAME}}、{{PROJECT_NAME}}（若有）、信用代码、官网域名/品牌名；优先找「产品」「解决方案」「关于我们」类页面。
   - **第一句不得以 {{COMPANY_NAME}} 全称起笔**；勿写「企业名称：」「统一社会信用代码：」等标签行；勿写「官网显示」「媒体报道」「公开信息显示」等出处套话；勿堆砌无对应产品的产学研合作花边。

3）**输出格式**
   - 严格遵循系统消息中的 JSON 契约与字段要求。
   - 最终回复**只能**是一个 JSON 对象，形如 {"product_intro":"...","tags":["..."]}，不要 markdown、不要代码围栏、不要其它说明文字。`;

function buildBuiltinPromptContentForDb() {
  return `${PROMPT_SECTION_SYSTEM}\n${BUILTIN_SYSTEM_PROMPT}\n${PROMPT_SECTION_USER}\n${BUILTIN_USER_PROMPT}`;
}

/**
 * 解析库中 prompt_content：优先使用用户配置的 SYSTEM/USER 分段；旧数据无分段时整段视为 USER，SYSTEM 用内置兜底。
 * @returns {{ system: string, userTemplate: string }}
 */
function resolveFinancingAiPromptSections(storedContent) {
  const raw = storedContent != null ? String(storedContent).trim() : '';
  if (!raw) {
    return { system: BUILTIN_SYSTEM_PROMPT, userTemplate: BUILTIN_USER_PROMPT };
  }
  const idxS = raw.indexOf(PROMPT_SECTION_SYSTEM);
  const idxU = raw.indexOf(PROMPT_SECTION_USER);
  if (idxS !== -1 && idxU !== -1 && idxU > idxS) {
    const systemPart = raw.slice(idxS + PROMPT_SECTION_SYSTEM.length, idxU).trim();
    const userPart = raw.slice(idxU + PROMPT_SECTION_USER.length).trim();
    return {
      system: systemPart || BUILTIN_SYSTEM_PROMPT,
      userTemplate: userPart || BUILTIN_USER_PROMPT,
    };
  }
  return {
    system: BUILTIN_SYSTEM_PROMPT,
    userTemplate: raw,
  };
}

const QCC_INTRO_TEMPLATE_MAX = Math.max(
  2000,
  Math.min(12000, parseInt(process.env.FINANCING_AI_QCC_INTRO_MAX_CHARS || '6000', 10) || 6000)
);

/** 供被投/投前/底层/融资等场景组装 LLM 用户消息占位符 */
function buildFinancingAiTemplateRow(fields) {
  const f = fields || {};
  return {
    company_name: String(f.company_name || f.enterprise_full_name || f.company || '').trim(),
    company_credit_code: String(f.company_credit_code || f.unified_credit_code || '').trim(),
    project_name: String(f.project_name || f.project_abbreviation || '').trim(),
    qcc_company_intro:
      f.qcc_company_intro != null ? String(f.qcc_company_intro).trim() : '',
  };
}

function formatQccIntroForTemplate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '（暂无；product_intro 请完全依赖联网检索与官网/报道，勿用经营范围凑数）';
  if (s.length <= QCC_INTRO_TEMPLATE_MAX) return s;
  return `${s.slice(0, QCC_INTRO_TEMPLATE_MAX)}…（已截断）`;
}

const QCC_BLOCK_FALLBACK = `企查查侧参考（仅辅助核对主体/曾用名；多为经营范围口径，勿据此写 product_intro）：
{{QCC_COMPANY_INTRO}}`;

/** 库内旧版 USER 段若缺少企查查占位符，自动补上，避免模型收不到 qcc_company_intro */
function ensureUserTemplateHasQccBlock(userTemplate) {
  const t = String(userTemplate || '');
  if (/\{\{\s*QCC_COMPANY_INTRO\s*\}\}/i.test(t)) return t;
  return `${t.trim()}\n\n${QCC_BLOCK_FALLBACK}`;
}

function fillTemplate(template, row) {
  const company = row.company_name != null ? String(row.company_name) : '';
  const credit = row.company_credit_code != null ? String(row.company_credit_code) : '';
  const project = row.project_name != null ? String(row.project_name) : '';
  const qcc = formatQccIntroForTemplate(row.qcc_company_intro);
  const tpl = ensureUserTemplateHasQccBlock(template);
  return String(tpl || '')
    .replace(/\{\{COMPANY_NAME\}\}/g, company)
    .replace(/\{\{CREDIT_CODE\}\}/g, credit)
    .replace(/\{\{PROJECT_NAME\}\}/g, project)
    .replace(/\{\{\s*QCC_COMPANY_INTRO\s*\}\}/gi, qcc);
}

/** 模型正文无法解析为 JSON 时，Docker 日志里打印的原文上限（可用环境变量 AI_PARSE_FAIL_LOG_RAW_MAX 调整） */
const AI_PARSE_FAIL_LOG_RAW_MAX = Math.max(
  800,
  Math.min(50000, parseInt(process.env.AI_PARSE_FAIL_LOG_RAW_MAX || '8000', 10) || 8000)
);

/**
 * 打完整/截断原文到 stderr，再抛出带长度与开头的 Error（便于 invested_enterprise / 融资表 VARCHAR 摘要仍可读）。
 * @param {unknown} raw 模型 assistant 正文（与 extractJsonObject 入参一致）
 * @param {string} tag 区分调用点，如 financing_style_llm / persist_financing
 */
function logAndThrowUnparseableModelJson(raw, tag) {
  const s = raw == null ? '' : String(raw);
  const len = s.length;
  const logged =
    len > AI_PARSE_FAIL_LOG_RAW_MAX
      ? `${s.slice(0, AI_PARSE_FAIL_LOG_RAW_MAX)}\n…(truncated, total_len=${len})`
      : s;
  console.error(`[financingAiEnrich] model_return_not_json tag=${tag} len=${len}\n${logged}`);
  const head = s.slice(0, 220).replace(/\s+/g, ' ');
  const more = len > 220 ? '…' : '';
  throw new Error(`模型返回无法解析为 JSON（tag=${tag} len=${len} head=${head}${more}）`);
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  let s = raw.replace(/^\uFEFF/, '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function normalizeAiPayload(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const intro =
    obj.product_intro != null
      ? String(obj.product_intro).trim()
      : obj.ai_product_intro != null
        ? String(obj.ai_product_intro).trim()
        : '';
  let tags = obj.tags ?? obj.company_tags ?? obj.ai_company_tags;
  if (typeof tags === 'string') {
    tags = tags
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(tags)) tags = [];
  tags = tags.map((t) => String(t).trim()).filter(Boolean);
  return { product_intro: intro, tags };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 去掉标签行、开头「全称（代码）」骨架句，以及正文开头的工商全称（与列表「企业名称」列重复时剔除）。
 */
function stripLeadingRegisteredName(text, fullName) {
  let t = String(text || '').trim();
  const n = String(fullName || '').trim();
  if (!n || !t) return t;
  const wrapped = new RegExp(`^[【\\[]\\s*${escapeRegExp(n)}\\s*[】\\]]\\s*`);
  if (wrapped.test(t)) {
    t = t.replace(wrapped, '').trim();
  }
  let guard = 0;
  while (guard++ < 3 && t.startsWith(n)) {
    t = t.slice(n.length).replace(/^[,，。；、：:\s]+/, '').trim();
  }
  return t;
}

function stripRedundantIdentifiersFromProductIntro(intro, row) {
  const original = String(intro || '').trim();
  if (!original) return original;
  const name = row.company_name != null ? String(row.company_name).trim() : '';
  const code = row.company_credit_code != null ? String(row.company_credit_code).trim() : '';

  const lineRes = [
    /^企业名称\s*[:：]\s*.+$/,
    /^公司名称\s*[:：]\s*.+$/,
    /^统一社会信用代码\s*[:：]\s*.+$/,
    /^信用代码\s*[:：]\s*.+$/,
    /^社会信用代码\s*[:：]\s*.+$/,
  ];
  let s = original
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      return !lineRes.some((re) => re.test(t));
    })
    .join('\n')
    .trim();

  if (name && code) {
    const reCombo = new RegExp(
      `^\\s*${escapeRegExp(name)}\\s*[（(]\\s*统一社会信用代码\\s*[:：]\\s*${escapeRegExp(code)}\\s*[）)]\\s*[。．.]?\\s*`,
      'u'
    );
    if (reCombo.test(s)) s = s.replace(reCombo, '').trim();
    const reCombo2 = new RegExp(
      `^\\s*${escapeRegExp(name)}\\s*[（(]\\s*${escapeRegExp(code)}\\s*[）)]\\s*[。．.]?\\s*`,
      'u'
    );
    if (reCombo2.test(s)) s = s.replace(reCombo2, '').trim();
  }

  if (name) {
    const peeled = stripLeadingRegisteredName(s, name);
    if (peeled.length > 0) {
      s = peeled;
    }
  }

  // 去掉「全称」已剥离后残留的 （统一社会信用代码：xxx）
  if (code) {
    const orphanCredit = new RegExp(
      `^[（(]\\s*统一社会信用代码\\s*[:：]\\s*${escapeRegExp(code)}\\s*[）)]\\s*[。．.]?\\s*`,
      'u'
    );
    if (orphanCredit.test(s)) s = s.replace(orphanCredit, '').trim();
  }

  return s || original;
}

/** 去掉出处套话，并剔除典型的媒体报道/校企背书式句子，使正文贴近产品介绍口径 */
function stripProductIntroMetaAttribution(text) {
  let s = String(text || '').trim();
  if (!s) return s;

  const phraseRes = [
    /官网(?:网站)?显示[，,、：:\s]*/g,
    /官方网站显示[，,、：:\s]*/g,
    /公开信息显示[，,、：:\s]*/g,
    /部分(?:主流)?媒体报道(?:称|提及)?[，,、：:\s]*/g,
    /有媒体报道(?:称|提及)?[，,、：:\s]*/g,
    /据媒体报道[，,、：:\s]*/g,
    /有消息称[，,、：:\s]*/g,
    /据悉[，,、：:\s]*/g,
    /资料(?:显示|表明)[，,、：:\s]*/g,
    /有(?:公开)?资料(?:称|显示)[，,、：:\s]*/g,
  ];
  for (const re of phraseRes) {
    s = s.replace(re, '');
  }
  s = s.replace(/\s+/g, ' ').replace(/^[，,、；;\s]+/, '').trim();

  const chunks = s.match(/[^。；]+[。；]?/gu);
  if (!chunks || chunks.length === 0) return s;

  const productCue = /(?:平台|产品|系统|工具|引擎|SaaS|解决方案|软件|应用|建模|套件|服务)/;
  const kept = chunks.filter((chunk) => {
    const core = chunk.trim();
    if (!core) return false;
    if (/媒体报道|有媒体称|据悉|有消息称|官网显示|公开信息显示|资料表明|有资料称/.test(core)) return false;
    const collabFluff =
      /(?:高校|大学|实验室|校企|产学研)/.test(core) &&
      /(?:合作|联合)/.test(core) &&
      /(?:研发|课题|开展)/.test(core) &&
      !productCue.test(core);
    if (collabFluff) return false;
    return true;
  });

  const out = kept.join('').trim();
  return out.length > 0 ? out : s;
}

async function loadActivePromptMeta() {
  const rows = await db.query(
    `SELECT F_Id, ai_model_config_id FROM ai_prompt_config
     WHERE interface_type = ? AND prompt_type = ?
       AND is_active = 1 AND F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC LIMIT 1`,
    [PROMPT_INTERFACE, PROMPT_TYPE]
  );
  return rows[0] || null;
}

/** 日志用：不输出完整 Key，仅尾部若干字符便于与控制台/账单侧核对 */
function maskApiKeyForLog(apiKey) {
  const s = apiKey != null ? String(apiKey).trim() : '';
  if (!s) return '(empty)';
  if (s.length <= 6) return `len=${s.length}`;
  return `…${s.slice(-4)}(len=${s.length})`;
}

function logFinancingLlmConfigResolved(source, llmModelConfigId, config) {
  if (!config) {
    console.warn(
      `[financingAiEnrich] resolveLlmConfig source=${source} → no usable config (check ai_prompt_config + ai_model_config)`
    );
    return;
  }
  const ep = String(config.api_endpoint || '').trim().slice(0, 120);
  const think =
    config.enable_thinking != null && config.enable_thinking !== ''
      ? Number(config.enable_thinking) === 1
        ? '1'
        : '0'
      : 'env';
  console.log(
    `[financingAiEnrich] resolveLlmConfig source=${source} llm_model_config_id=${llmModelConfigId ?? 'null'} model=${config.model_name || ''} enable_thinking=${think} api_key_hint=${maskApiKeyForLog(config.api_key)} endpoint_raw=${ep || '(empty)'}`
  );
  if (source === 'fallback_project_sourcing_analysis') {
    console.warn(
      '[financingAiEnrich] resolveLlmConfig 使用了兜底：提示词未 JOIN 到有效模型或 ai_model_config_id 指向已停用/无 Key 的配置；实际计费 Key 以本行 llm_model_config_id 为准，请在「模型提示词」上绑定预期模型或清理多余 project_sourcing_analysis 配置'
    );
  }
}

async function resolveLlmConfig(promptBundle, promptMeta) {
  if (promptBundle?.ai_model_config?.api_key && promptBundle.ai_model_config.model_name) {
    const c = promptBundle.ai_model_config;
    const out = {
      llm_model_config_id: c.id || null,
      config: mapAiModelConfigRow(c) || {
        model_name: c.model_name,
        api_key: c.api_key,
        api_endpoint: c.api_endpoint,
        temperature: c.temperature,
        max_tokens: c.max_tokens,
        top_p: c.top_p,
        enable_thinking: c.enable_thinking,
        provider: c.provider,
        api_type: c.api_type,
        wire_protocol: c.wire_protocol,
        web_search_mode: c.web_search_mode,
        reasoning_effort: c.reasoning_effort,
      },
    };
    logFinancingLlmConfigResolved('prompt_join', out.llm_model_config_id, out.config);
    return out;
  }
  const idFromPrompt = promptMeta?.ai_model_config_id;
  if (idFromPrompt) {
    const rows = await db.query(
      `SELECT ${LLM_CONFIG_SELECT_SQL}
       FROM ai_model_config
       WHERE F_Id = ? AND is_active = 1 AND F_DeleteMark = 0 LIMIT 1`,
      [idFromPrompt]
    );
    if (rows.length && rows[0].api_key && rows[0].model_name) {
      const r = rows[0];
      const out = {
        llm_model_config_id: r.id,
        config: mapAiModelConfigRow(r),
      };
      logFinancingLlmConfigResolved('prompt_ai_model_config_id', out.llm_model_config_id, out.config);
      return out;
    }
    console.warn(
      `[financingAiEnrich] resolveLlmConfig 提示词绑定的 ai_model_config_id=${idFromPrompt} 未得到可用模型（已删/停用/缺 Key），将尝试 application_type 兜底`
    );
  }
  const fallback = await db.query(
    `SELECT ${LLM_CONFIG_SELECT_SQL}
     FROM ai_model_config
     WHERE application_type = 'project_sourcing_analysis'
       AND is_active = 1 AND F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC LIMIT 1`
  );
  if (fallback.length && fallback[0].api_key && fallback[0].model_name) {
    const r = fallback[0];
    const out = {
      llm_model_config_id: r.id,
        config: mapAiModelConfigRow(r),
    };
    logFinancingLlmConfigResolved('fallback_project_sourcing_analysis', out.llm_model_config_id, out.config);
    return out;
  }
  logFinancingLlmConfigResolved('none', null, null);
  return { llm_model_config_id: null, config: null };
}

/**
 * 融资 AI 增强使用 OpenAI 兼容协议（messages + /chat/completions）。
 * 若库里填的是 DashScope 原生「文本生成」地址（…/aigc/text-generation/generation），
 * 不能再拼 /chat/completions，否则会 400：No static resource …/generation/chat/completions。
 */
function normalizeDashScopeChatEndpoint(raw) {
  const DEFAULT_CN = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const DEFAULT_INTL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
  const DEFAULT_US = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions';

  const u = raw != null ? String(raw).trim() : '';
  const lower = u.toLowerCase();

  const defaultByHost = () => {
    if (lower.includes('dashscope-intl') || lower.includes('intl.aliyuncs')) return DEFAULT_INTL;
    if (lower.includes('dashscope-us') || lower.includes('us.aliyuncs')) return DEFAULT_US;
    return DEFAULT_CN;
  };

  // 原生 generation 或其它非 compatible 家族
  const isNativeDashScopePath =
    lower.includes('aigc/text-generation') ||
    lower.includes('/api/v1/aigc/') ||
    (lower.includes('text-generation') &&
      lower.includes('generation') &&
      !lower.includes('compatible-mode'));

  if (!u) return DEFAULT_CN;

  if (isNativeDashScopePath) {
    const fallback = defaultByHost();
    console.warn(
      `[financingAiEnrich] api_endpoint 为 DashScope 原生路径或非 OpenAI 兼容地址（当前: ${u}），` +
        `已自动改用兼容地址: ${fallback}。请在「AI 模型配置」中将接口地址设为 …/compatible-mode/v1/chat/completions（新加坡/美东等同理）。`
    );
    return fallback;
  }

  const trimmed = u.replace(/\/$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/compatible-mode\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;

  // dashscope 域名但未写 compatible-mode，避免在错误 path 上拼接
  if (/dashscope[^/]*\.aliyuncs\.com/i.test(lower) && !lower.includes('compatible-mode')) {
    const fallback = defaultByHost();
    console.warn(
      `[financingAiEnrich] api_endpoint 未包含 compatible-mode（当前: ${u}），已使用: ${fallback}`
    );
    return fallback;
  }

  // 其它 https 网关：仍按「基址 + /chat/completions」处理
  if (/^https?:\/\//i.test(trimmed)) return `${trimmed}/chat/completions`;

  return DEFAULT_CN;
}

/** OpenAI 兼容 Batch/File API 使用的基址（…/compatible-mode/v1），不含 /chat/completions */
function compatibleModeV1BaseUrlFromEndpoint(apiEndpoint) {
  const ep = normalizeDashScopeChatEndpoint(apiEndpoint);
  return ep.replace(/\/chat\/completions\/?$/i, '');
}

function financingAiChatParamsFromConfig(config) {
  const temperature =
    typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature ?? 0.3;
  const maxTokensRaw =
    typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const max_tokens = Number.isFinite(maxTokensRaw) ? Math.min(8000, Math.max(512, maxTokensRaw)) : 4096;
  const top_p =
    typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p ?? 0.9;
  return { temperature, max_tokens, top_p };
}

async function dashScopeCompatibleFetchJson(url, apiKey, init = {}) {
  const headers = { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) };
  const r = await fetch(url, { ...init, headers });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  if (!r.ok) {
    const detail =
      (data &&
        typeof data === 'object' &&
        (data.error?.message ||
          data.message ||
          (typeof data.error === 'string' ? data.error : '') ||
          '')) ||
      text ||
      r.statusText;
    throw new Error(`HTTP ${r.status}: ${detail}`);
  }
  return data;
}

async function dashScopeUploadBatchInputJsonl(baseUrl, apiKey, jsonlUtf8, logCtx = null) {
  const buf = Buffer.from(jsonlUtf8, 'utf8');
  const form = new FormDataMultipart();
  form.append('purpose', 'batch');
  form.append('file', buf, {
    filename: 'financing-ai-batch.jsonl',
    contentType: 'application/octet-stream',
  });
  const url = `${baseUrl}/files`;
  if (logCtx && logCtx.batchId) {
    financingAiJobLog(logCtx.batchId, 'batch_file', 'upload_http_post', `POST ${url}`, {
      bytes: buf.length,
      lines_hint: (jsonlUtf8.match(/\n/g) || []).length + 1,
    });
  }
  let response;
  try {
    response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300000,
    });
  } catch (err) {
    throw new Error(`上传 batch 输入文件失败：${formatDashScopeHttpError(err)}`);
  }
  const data = response.data;
  const id = data && (data.id || data.file_id);
  if (!id) throw new Error('上传 batch 输入文件成功但未返回 file id');
  return String(id);
}

/**
 * 去重后大批量：同步完成 JSONL 上传 + 创建 Batch，返回 dashscope_batch_id；不含 enable_search。
 * @returns {Promise<{ kind: 'noop' } | { kind: 'submitted', dashscopeBatchId: string, llmJobs: { logId:number, financingEventId:number, row: object }[], config: object, promptConfigId: string|null, llmModelConfigId: number|null, promptMeta: object|null, baseUrl: string }>}
 */
async function submitLargeBatchFileFinancingAiEnrich({
  batchId,
  representativeIds,
  triggeredByUserId,
  clientIp,
  df,
  dt,
  totalInRange,
  triggerType = 'batch_date_range',
  llmConfigOverride = null,
}) {
  /** @type {{ logId:number, financingEventId:number, row: object }[]} */
  const llmJobs = [];

  try {
    const totalRep = representativeIds.length;
    let skipPrepare = 0;
    let skipGone = 0;
    let cntDonor = 0;
    let cntReuseLocal = 0;
    const batchTaskLog = { batchId, mode: 'batch_file', suppressSuccessConsole: true };

    financingAiJobLog(batchId, 'batch_file', 'submit_start', `event_date=${df}..${dt} rows_in_range=${totalInRange} dedup_representatives=${totalRep}`, {
      trigger_type: triggerType,
    });

    for (let ii = 0; ii < totalRep; ii++) {
      const financingEventId = representativeIds[ii];
      const prep = await prepareFinancingAiEnrichJob({
        eventId: financingEventId,
        triggerType,
        triggeredByUserId,
        clientIp,
      });
      if (!prep.ok) {
        skipPrepare += 1;
        financingAiJobLog(
          batchId,
          'batch_file',
          'prepare_skip',
          `index=${ii + 1}/${totalRep} event_id=${financingEventId}`,
          { reason: prep.message }
        );
        continue;
      }

      const events = await db.query(
        `SELECT F_Id AS id, event_id, company_name, company_credit_code, project_name, F_DeleteMark AS delete_mark,
                ai_enrich_status, ai_product_intro, ai_company_tags_display, ai_company_tags_json
         FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
        [prep.idNum]
      );
      if (!events.length || Number(events[0].delete_mark) !== 0) {
        skipGone += 1;
        await markFinancingAiEnrichFailed({
          financingEventId: prep.idNum,
          logId: prep.logId,
          row: null,
          started: Date.now(),
          llmModelConfigId: null,
          promptMeta: null,
          err: new Error('融资事件不存在或已删除'),
        });
        continue;
      }
      const row = events[0];

      const donorRow = await findFinancingAiDonorRow({
        credit: row.company_credit_code,
        name: row.company_name,
        excludeId: prep.idNum,
      });
      if (donorRow) {
        try {
          await runFinancingAiEnrichTask({
            financingEventId: prep.idNum,
            logId: prep.logId,
            triggerType,
            triggeredByUserId,
            clientIp,
            taskLog: batchTaskLog,
          });
          cntDonor += 1;
        } catch (e) {
          financingAiJobLog(batchId, 'batch_file', 'prepare_donor_error', `event_id=${prep.idNum}`, {
            err: (e && e.message) || String(e),
          });
        }
        const atEnd = ii === totalRep - 1;
        const atTick = (ii + 1) % FINANCING_AI_JOB_LOG_PROGRESS_EVERY === 0;
        if (atTick || atEnd) {
          financingAiJobLog(batchId, 'batch_file', 'prepare_progress', `scanned ${ii + 1}/${totalRep}`, {
            skip_prepare: skipPrepare,
            skip_gone: skipGone,
            reuse_donor: cntDonor,
            reuse_local: cntReuseLocal,
            queued_llm: llmJobs.length,
          });
        }
        continue;
      }
      if (eventHasCompleteAiContent(row)) {
        try {
          await runFinancingAiEnrichTask({
            financingEventId: prep.idNum,
            logId: prep.logId,
            triggerType,
            triggeredByUserId,
            clientIp,
            taskLog: batchTaskLog,
          });
          cntReuseLocal += 1;
        } catch (e) {
          financingAiJobLog(batchId, 'batch_file', 'prepare_reuse_local_error', `event_id=${prep.idNum}`, {
            err: (e && e.message) || String(e),
          });
        }
        const atEnd = ii === totalRep - 1;
        const atTick = (ii + 1) % FINANCING_AI_JOB_LOG_PROGRESS_EVERY === 0;
        if (atTick || atEnd) {
          financingAiJobLog(batchId, 'batch_file', 'prepare_progress', `scanned ${ii + 1}/${totalRep}`, {
            skip_prepare: skipPrepare,
            skip_gone: skipGone,
            reuse_donor: cntDonor,
            reuse_local: cntReuseLocal,
            queued_llm: llmJobs.length,
          });
        }
        continue;
      }

      llmJobs.push({ logId: prep.logId, financingEventId: prep.idNum, row });

      const atEnd = ii === totalRep - 1;
      const atTick = (ii + 1) % FINANCING_AI_JOB_LOG_PROGRESS_EVERY === 0;
      if (atTick || atEnd) {
        financingAiJobLog(batchId, 'batch_file', 'prepare_progress', `scanned ${ii + 1}/${totalRep}`, {
          skip_prepare: skipPrepare,
          skip_gone: skipGone,
          reuse_donor: cntDonor,
          reuse_local: cntReuseLocal,
          queued_llm: llmJobs.length,
        });
      }
    }

    if (!llmJobs.length) {
      financingAiJobLog(batchId, 'batch_file', 'prepare_done_no_llm', `no DashScope batch; all rows reused or skipped`, {
        skip_prepare: skipPrepare,
        skip_gone: skipGone,
        reuse_donor: cntDonor,
        reuse_local: cntReuseLocal,
      });
      return { kind: 'noop' };
    }

    financingAiJobLog(batchId, 'batch_file', 'prepare_done', `building JSONL for llm_jobs=${llmJobs.length}`, {
      skip_prepare: skipPrepare,
      skip_gone: skipGone,
      reuse_donor: cntDonor,
      reuse_local: cntReuseLocal,
    });
    const promptMeta = await loadActivePromptMeta();
    const promptConfigId = promptMeta?.id || null;
    financingAiJobLog(batchId, 'batch_file', 'resolve_prompt', 'loadActivePromptMeta + getPrompt + resolveLlmConfig');
    const promptBundle = await newsAnalysis.getPrompt(PROMPT_INTERFACE, PROMPT_TYPE);
    const storedRaw =
      promptBundle && promptBundle.prompt_content != null
        ? String(promptBundle.prompt_content)
        : '';
    const { system: systemContent, userTemplate } = resolveFinancingAiPromptSections(storedRaw);
    let llmModelConfigId;
    let config;
    if (llmConfigOverride && llmConfigOverride.api_key && llmConfigOverride.model_name) {
      config = llmConfigOverride;
      llmModelConfigId = llmConfigOverride.id != null ? llmConfigOverride.id : null;
      financingAiJobLog(batchId, 'batch_file', 'resolve_model_override', `model=${config.model_name}`, {
        llm_model_config_id: llmModelConfigId,
      });
    } else {
      const resolved = await resolveLlmConfig(promptBundle, promptMeta);
      llmModelConfigId = resolved.llm_model_config_id;
      config = resolved.config;
    }
    if (!config) {
      const err = new Error(
        '未配置可用的 AI 模型：请在「系统 AI 配置」中维护 application_type=project_sourcing_analysis 的模型，或为该提示词绑定模型'
      );
      for (const j of llmJobs) {
        await markFinancingAiEnrichFailed({
          financingEventId: j.financingEventId,
          logId: j.logId,
          row: j.row,
          started: Date.now(),
          llmModelConfigId,
          promptMeta,
          err,
        });
      }
      financingAiJobLog(batchId, 'batch_file', 'abort_no_model_config', (err && err.message) || String(err));
      return { kind: 'noop' };
    }

    const baseUrl = compatibleModeV1BaseUrlFromEndpoint(config.api_endpoint);
    const sys = String(systemContent || '').trim() || BUILTIN_SYSTEM_PROMPT;
    const { temperature, max_tokens, top_p } = financingAiChatParamsFromConfig(config);
    const batchBodyExtras = /^qwen3\.(5|6|7)/i.test(String(config.model_name || ''))
      ? { enable_thinking: false }
      : {};

    const lines = llmJobs.map((j) => {
      const templateRow = buildFinancingAiTemplateRow(j.row);
      let usr = String(fillTemplate(userTemplate, templateRow) || '').trim();
      if (isNoBaikeEnrichTrigger(triggerType)) {
        usr = `${NO_BAIKE_USER_PREFIX}${usr}`;
      }
      if (!usr) {
        return null;
      }
      const body = {
        model: config.model_name,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: usr },
        ],
        temperature,
        max_tokens,
        top_p,
        ...batchBodyExtras,
      };
      return JSON.stringify({
        custom_id: `l${j.logId}`,
        method: 'POST',
        url: '/v1/chat/completions',
        body,
      });
    });
    const badIdx = lines.findIndex((x) => x == null);
    if (badIdx !== -1) {
      const err = new Error('用户侧提示词为空，请检查 ---USER--- 段或占位符替换结果');
      for (const j of llmJobs) {
        await markFinancingAiEnrichFailed({
          financingEventId: j.financingEventId,
          logId: j.logId,
          row: j.row,
          started: Date.now(),
          llmModelConfigId,
          promptMeta,
          err,
        });
      }
      financingAiJobLog(batchId, 'batch_file', 'abort_empty_user_prompt', (err && err.message) || String(err));
      return { kind: 'noop' };
    }

    const jsonl = lines.join('\n') + '\n';
    financingAiJobLog(batchId, 'batch_file', 'jsonl_ready', `requests=${llmJobs.length}`, {
      jsonl_bytes: Buffer.byteLength(jsonl, 'utf8'),
    });

    const inputFileId = await dashScopeUploadBatchInputJsonl(baseUrl, config.api_key, jsonl, { batchId });
    financingAiJobLog(batchId, 'batch_file', 'upload_done', `input_file_id=${inputFileId}`);

    financingAiJobLog(batchId, 'batch_file', 'create_batch_post', 'POST /batches', {
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    });
    const batchCreate = await dashScopeCompatibleFetchJson(`${baseUrl}/batches`, config.api_key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_file_id: inputFileId,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
      }),
    });
    const dashscopeBatchIdRaw =
      batchCreate.id || batchCreate.batch_id || batchCreate.batch?.id || batchCreate.data?.id;
    if (!dashscopeBatchIdRaw) {
      throw new Error(`创建 Batch 任务未返回 id: ${JSON.stringify(batchCreate).slice(0, 500)}`);
    }
    const dashscopeBatchId = String(dashscopeBatchIdRaw);

    const logIds = llmJobs.map((j) => j.logId);
    const ph = logIds.map(() => '?').join(',');
    await db.execute(
      `UPDATE sourcing_financing_ai_enrich_log SET execution_status = 'running', started_at = NOW(), F_LastModifyTime = NOW() WHERE F_Id IN (${ph})`,
      logIds
    );

    financingAiJobLog(batchId, 'batch_file', 'submit_done', `dashscope_batch_id=${dashscopeBatchId} llm_jobs=${llmJobs.length} date=${df}..${dt}`, {
      input_file_id: inputFileId,
    });

    return {
      kind: 'submitted',
      dashscopeBatchId,
      llmJobs,
      config,
      promptConfigId,
      llmModelConfigId,
      promptMeta,
      baseUrl,
    };
  } catch (e) {
    console.error(`[financingAiEnrich batch_file ${batchId}] submit fatal`, e);
    financingAiJobLog(batchId, 'batch_file', 'submit_fatal', (e && e.message) || String(e));
    for (const j of llmJobs) {
      try {
        const rows = await db.query(
          `SELECT F_Id AS id, company_name, company_credit_code, project_name, F_DeleteMark AS delete_mark,
                  ai_enrich_status, ai_product_intro, ai_company_tags_display, ai_company_tags_json
           FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
          [j.financingEventId]
        );
        const row = rows[0] || j.row;
        await markFinancingAiEnrichFailed({
          financingEventId: j.financingEventId,
          logId: j.logId,
          row,
          started: Date.now(),
          llmModelConfigId: null,
          promptMeta: null,
          err: e,
        });
      } catch (e2) {
        console.error(`[financingAiEnrich batch_file ${batchId}] submit cleanup failed log_id=${j.logId}`, e2);
      }
    }
    throw e;
  }
}

/**
 * Batch 已创建后：后台轮询、下载输出并写库。
 */
async function pollAndApplyLargeBatchFileFinancingAiEnrich({
  batchId,
  dashscopeBatchId,
  llmJobs,
  config,
  promptConfigId,
  llmModelConfigId,
  promptMeta,
  baseUrl,
  triggerType = 'batch_date_range',
}) {
  const pollMs = Math.max(
    3000,
    Math.min(120000, parseInt(process.env.FINANCING_AI_BATCH_FILE_POLL_MS || '10000', 10) || 10000)
  );
  const pollMaxMs = Math.max(
    pollMs * 2,
    parseInt(process.env.FINANCING_AI_BATCH_FILE_POLL_MAX_MS || String(4 * 3600 * 1000), 10) ||
      4 * 3600 * 1000
  );
  const applyTaskLog = { batchId, mode: 'batch_file', suppressSuccessConsole: true };

  try {
    financingAiJobLog(batchId, 'batch_file', 'poll_start', `dashscope_batch_id=${dashscopeBatchId} llm_jobs=${llmJobs.length}`, {
      poll_ms: pollMs,
      poll_max_ms: pollMaxMs,
    });

    let waited = 0;
    /** @type {any} */
    let st = null;
    let pollRound = 0;
    while (waited < pollMaxMs) {
      await sleep(pollMs);
      waited += pollMs;
      pollRound += 1;
      st = await dashScopeCompatibleFetchJson(`${baseUrl}/batches/${dashscopeBatchId}`, config.api_key, {
        method: 'GET',
      });
      const status = String(st.status || st.batch_status || st.state || '').toLowerCase();
      if (
        pollRound <= 3 ||
        pollRound % FINANCING_AI_JOB_LOG_POLL_EVERY === 0 ||
        status === 'completed' ||
        status === 'complete'
      ) {
        financingAiJobLog(batchId, 'batch_file', 'poll_status', `round=${pollRound} elapsed_ms=${waited}`, {
          remote_status: status || 'unknown',
        });
      }
      if (status === 'completed' || status === 'complete') break;
      if (
        status === 'failed' ||
        status === 'expired' ||
        status === 'cancelled' ||
        status === 'canceled' ||
        status === 'error'
      ) {
        throw new Error(`Batch 任务结束状态异常: ${status} ${JSON.stringify(st).slice(0, 800)}`);
      }
    }
    const finalStatus = String(st?.status || st?.batch_status || st?.state || '').toLowerCase();
    if (finalStatus !== 'completed' && finalStatus !== 'complete') {
      throw new Error(`Batch 任务轮询超时（${pollMaxMs}ms）最后状态: ${JSON.stringify(st).slice(0, 800)}`);
    }

    financingAiJobLog(batchId, 'batch_file', 'poll_remote_complete', `rounds=${pollRound} elapsed_ms=${waited}`);

    const outputFileId =
      st.output_file_id || st.result?.output_file_id || st.output_file?.id || st.response?.output_file_id;
    if (!outputFileId) {
      throw new Error(`Batch 完成但未返回 output_file_id: ${JSON.stringify(st).slice(0, 800)}`);
    }

    const contentUrl = `${baseUrl}/files/${outputFileId}/content`;
    financingAiJobLog(batchId, 'batch_file', 'download_start', `GET files/.../content output_file_id=${outputFileId}`);
    const outResp = await fetch(contentUrl, { headers: { Authorization: `Bearer ${config.api_key}` } });
    const outText = await outResp.text();
    if (!outResp.ok) {
      throw new Error(`下载 Batch 输出失败 HTTP ${outResp.status}: ${outText.slice(0, 500)}`);
    }

    const doneLogIds = new Set();
    const linesOut = outText.split(/\r?\n/).filter((x) => x.trim());
    financingAiJobLog(batchId, 'batch_file', 'download_done', `non_empty_lines=${linesOut.length} response_bytes=${outText.length}`);

    let applyHandled = 0;
    for (const line of linesOut) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const cid = obj.custom_id != null ? String(obj.custom_id) : '';
      const m = /^l(\d+)$/.exec(cid);
      if (!m) continue;
      const logId = parseInt(m[1], 10);
      const job = llmJobs.find((x) => x.logId === logId);
      if (!job) continue;
      const startedLine = Date.now();

      const errObj = obj.error || obj.response?.body?.error;
      if (errObj) {
        const em =
          typeof errObj === 'string'
            ? errObj
            : errObj.message || errObj.code || JSON.stringify(errObj).slice(0, 400);
        await markFinancingAiEnrichFailed({
          financingEventId: job.financingEventId,
          logId: job.logId,
          row: job.row,
          started: startedLine,
          llmModelConfigId,
          promptMeta,
          err: new Error(String(em || 'Batch 行错误')),
        });
        doneLogIds.add(logId);
        applyHandled += 1;
        financingAiJobLog(batchId, 'batch_file', 'apply_row_fail', `log_id=${logId} event_id=${job.financingEventId}`, {
          err: String(em || '').slice(0, 400),
        });
        if (applyHandled % FINANCING_AI_JOB_LOG_APPLY_EVERY === 0) {
          financingAiJobLog(batchId, 'batch_file', 'apply_progress', `handled_output_rows=${applyHandled} done_jobs=${doneLogIds.size}/${llmJobs.length}`);
        }
        continue;
      }

      const body = obj.response?.body;
      const raw =
        body?.choices?.[0]?.message?.content ??
        obj.response?.choices?.[0]?.message?.content ??
        null;
      if (raw == null || raw === '') {
        await markFinancingAiEnrichFailed({
          financingEventId: job.financingEventId,
          logId: job.logId,
          row: job.row,
          started: startedLine,
          llmModelConfigId,
          promptMeta,
          err: new Error('Batch 输出缺少 choices[0].message.content'),
        });
        doneLogIds.add(logId);
        applyHandled += 1;
        financingAiJobLog(batchId, 'batch_file', 'apply_row_fail', `log_id=${logId} event_id=${job.financingEventId}`, {
          err: 'empty_content',
        });
        if (applyHandled % FINANCING_AI_JOB_LOG_APPLY_EVERY === 0) {
          financingAiJobLog(batchId, 'batch_file', 'apply_progress', `handled_output_rows=${applyHandled} done_jobs=${doneLogIds.size}/${llmJobs.length}`);
        }
        continue;
      }

      try {
        await persistFinancingAiLlmSuccess({
          row: job.row,
          financingEventId: job.financingEventId,
          logId: job.logId,
          raw,
          config,
          promptConfigId,
          llmModelConfigId,
          started: startedLine,
          taskLog: applyTaskLog,
          searchMeta: searchMetaForBatchFile(),
          markProfileSourceLlmWeb: isNoBaikeEnrichTrigger(triggerType),
        });
        doneLogIds.add(logId);
        applyHandled += 1;
        if (applyHandled % FINANCING_AI_JOB_LOG_APPLY_EVERY === 0) {
          financingAiJobLog(batchId, 'batch_file', 'apply_progress', `handled_output_rows=${applyHandled} done_jobs=${doneLogIds.size}/${llmJobs.length}`);
        }
      } catch (e) {
        await markFinancingAiEnrichFailed({
          financingEventId: job.financingEventId,
          logId: job.logId,
          row: job.row,
          started: startedLine,
          llmModelConfigId,
          promptMeta,
          err: e,
        });
        doneLogIds.add(logId);
        applyHandled += 1;
        financingAiJobLog(batchId, 'batch_file', 'apply_row_fail', `log_id=${logId} event_id=${job.financingEventId}`, {
          err: (e && e.message) || String(e),
        });
        if (applyHandled % FINANCING_AI_JOB_LOG_APPLY_EVERY === 0) {
          financingAiJobLog(batchId, 'batch_file', 'apply_progress', `handled_output_rows=${applyHandled} done_jobs=${doneLogIds.size}/${llmJobs.length}`);
        }
      }
    }

    for (const j of llmJobs) {
      if (doneLogIds.has(j.logId)) continue;
      await markFinancingAiEnrichFailed({
        financingEventId: j.financingEventId,
        logId: j.logId,
        row: j.row,
        started: Date.now(),
        llmModelConfigId,
        promptMeta,
        err: new Error('Batch 输出中未找到该 custom_id 或解析失败'),
      });
      financingAiJobLog(batchId, 'batch_file', 'apply_missing_output', `log_id=${j.logId} event_id=${j.financingEventId}`);
    }

    financingAiJobLog(batchId, 'batch_file', 'poll_apply_done', `dashscope_batch_id=${dashscopeBatchId} llm_jobs=${llmJobs.length}`, {
      output_lines: linesOut.length,
      jobs_marked_done: doneLogIds.size,
    });
  } catch (e) {
    console.error(`[financingAiEnrich batch_file ${batchId}] poll_apply fatal`, e);
    financingAiJobLog(batchId, 'batch_file', 'poll_apply_fatal', (e && e.message) || String(e));
    for (const j of llmJobs) {
      try {
        const rows = await db.query(
          `SELECT F_Id AS id, company_name, company_credit_code, project_name, F_DeleteMark AS delete_mark,
                  ai_enrich_status, ai_product_intro, ai_company_tags_display, ai_company_tags_json
           FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
          [j.financingEventId]
        );
        const row = rows[0] || j.row;
        await markFinancingAiEnrichFailed({
          financingEventId: j.financingEventId,
          logId: j.logId,
          row,
          started: Date.now(),
          llmModelConfigId: null,
          promptMeta: null,
          err: e,
        });
      } catch (e2) {
        console.error(`[financingAiEnrich batch_file ${batchId}] poll cleanup failed log_id=${j.logId}`, e2);
      }
    }
  }
}

/** 解析 DashScope / OpenAI 兼容错误体，便于日志与前端可见摘要 */
function formatDashScopeHttpError(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  let detail = '';
  if (data && typeof data === 'object') {
    detail =
      data.error?.message ||
      data.message ||
      (typeof data.error === 'string' ? data.error : '') ||
      '';
    if (!detail) {
      try {
        detail = JSON.stringify(data);
      } catch {
        detail = String(data);
      }
    }
  } else if (data != null) {
    detail = String(data);
  }
  const head = status != null ? `HTTP ${status}` : '请求失败';
  return detail ? `${head}: ${detail}` : `${head}: ${err.message || 'unknown'}`;
}

/**
 * 调用 DashScope OpenAI 兼容 Chat Completions（联网 + 深度思考，按 400 自动降级）。
 * 环境变量：FINANCING_AI_ENABLE_THINKING（默认 0；模型行 enable_thinking 优先）、FINANCING_AI_THINKING_BUDGET（默认 8192）、
 * FINANCING_AI_CHAT_TIMEOUT_THINKING_MS（默认 240000）。
 * @returns {Promise<{ content: string, used_enable_search: boolean, search_degraded: boolean, used_enable_thinking: boolean, thinking_degraded: boolean }>}
 */
async function callDashScopeOpenAIChat(
  systemContent,
  userContent,
  config,
  { searchRequired = true, wantSearch = true } = {}
) {
  const sys = String(systemContent || '').trim() || BUILTIN_SYSTEM_PROMPT;
  const usr = String(userContent || '').trim();
  if (!usr) {
    throw new Error('用户侧提示词为空，请检查 ---USER--- 段或占位符替换结果');
  }

  return llmInvoke(config, {
    systemContent: sys,
    userContent: usr,
    wantSearch,
    searchRequired,
    logPrefix: '[financingAiEnrich]',
  });
}

/** 竞品补录：仅从用户文本抽取标签，不启用联网检索。 */
async function callDashScopeOpenAiChatNoSearch(systemContent, userContent, config) {
  const endpoint = normalizeDashScopeChatEndpoint(config.api_endpoint);
  const temperature =
    typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature ?? 0.2;
  const maxTokensRaw =
    typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const max_tokens = Number.isFinite(maxTokensRaw) ? Math.min(4000, Math.max(256, maxTokensRaw)) : 2048;
  const top_p = typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p ?? 0.9;
  const sys = String(systemContent || '').trim();
  const usr = String(userContent || '').trim();
  if (!sys || !usr) {
    throw new Error('系统或用户提示词为空');
  }
  const body = {
    model: config.model_name,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ],
    temperature,
    max_tokens,
    top_p,
  };
  try {
    const response = await axios.post(endpoint, body, {
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });
    const content = response.data?.choices?.[0]?.message?.content;
    if (content == null || (typeof content === 'string' && !content.trim())) {
      console.warn('[callDashScopeOpenAiChatNoSearch] AI 返回空 content');
      return undefined;
    }
    return content;
  } catch (err) {
    throw new Error(formatDashScopeHttpError(err));
  }
}

const COMPETITOR_NARRATIVE_EXTRACT_SYSTEM = `你是企业业务标签抽取助手。用户提供一段关于公司产品与业务的自述（可能含中文标点）。
只做归纳，不要做联网搜索，不要照抄工商经营范围式套话。
输出且仅输出一个 JSON 对象，字段固定为：
{"tags":["标签1","标签2",...],"short_summary":"一句话业务概括"}
要求：
- tags 为 4～16 个中文短语或常见行业英文词（如 K12、AI），贴近赛道/场景/客户类型；不要输出企业全称；不要输出过宽地名或空泛词。
- short_summary 不超过 80 个汉字。
- 不要输出 Markdown、不要用代码块包裹 JSON。`;

/**
 * 从用户粘贴的「企业业务/产品介绍」中抽取标签（不走联网检索）。
 * @param {string} narrative
 * @returns {Promise<{ tags: string[], short_summary: string, raw: string, llm_model_config_id: string|null }>}
 */
async function extractCompetitorSupplementTagsFromNarrative(narrative) {
  const text0 = String(narrative || '').trim();
  if (!text0) {
    throw new Error('请先粘贴企业业务/产品介绍文本');
  }
  const text = text0.length > 2000 ? text0.slice(0, 2000) : text0;
  const promptMeta = await loadActivePromptMeta();
  const promptBundle = await newsAnalysis.getPrompt(PROMPT_INTERFACE, PROMPT_TYPE);
  const { llm_model_config_id, config } = await resolveLlmConfig(promptBundle, promptMeta);
  if (!config) {
    throw new Error(
      '未配置可用的 AI 模型：请在「系统 AI 配置」中维护 application_type=project_sourcing_analysis 的模型'
    );
  }
  const usr = `以下为用户提供的文本，请按要求输出 JSON：\n\n---\n${text}\n---`;
  const raw = await callDashScopeOpenAiChatNoSearch(COMPETITOR_NARRATIVE_EXTRACT_SYSTEM, usr, config);
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    logAndThrowUnparseableModelJson(raw, 'competitor_narrative_extract');
  }
  let tags = parsed.tags;
  if (typeof tags === 'string') {
    tags = tags
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(tags)) tags = [];
  tags = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  const short_summary =
    parsed.short_summary != null ? String(parsed.short_summary).trim().slice(0, 120) : '';
  if (tags.length < 1) {
    throw new Error('模型未返回有效标签，请修改文案后重试');
  }
  return {
    tags,
    short_summary,
    raw: String(raw || ''),
    llm_model_config_id: llm_model_config_id != null ? String(llm_model_config_id) : null,
  };
}

/**
 * 异步执行单条融资事件的联网 AI 增强（写标准表 + 日志）。
 */
async function runFinancingAiEnrichTask({
  financingEventId,
  logId,
  triggerType,
  triggeredByUserId,
  clientIp,
  taskLog = null,
}) {
  const started = Date.now();
  let promptMeta = null;
  let llmModelConfigId = null;
  let promptConfigId = null;
  /** @type {null | { company_name?: string, company_credit_code?: string, id?: number }} */
  let row = null;
  try {
    await db.execute(
      `UPDATE sourcing_financing_ai_enrich_log
       SET execution_status = 'running', started_at = NOW(), F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [logId]
    );

    const events = await db.query(
      `SELECT F_Id AS id, event_id, company_name, company_credit_code, project_name, project_desc,
              baike_lemma_status,
              F_DeleteMark AS delete_mark,
              ai_enrich_status, ai_product_intro, ai_company_tags_display, ai_company_tags_json
       FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
      [financingEventId]
    );
    if (!events.length || Number(events[0].delete_mark) !== 0) {
      throw new Error('融资事件不存在或已删除');
    }
    row = events[0];
    const forceLlmRefresh = isManualFinancingAiEnrichTrigger(triggerType);

    if (!forceLlmRefresh) {
      const donorRow = await findFinancingAiDonorRow({
        credit: row.company_credit_code,
        name: row.company_name,
        excludeId: financingEventId,
      });
      if (donorRow) {
        await applyFinancingAiReuseFromDonor(donorRow, row, financingEventId);
        const introLog =
          donorRow.ai_product_intro != null ? String(donorRow.ai_product_intro).trim() : '';
        const dispLog =
          donorRow.ai_company_tags_display != null ? String(donorRow.ai_company_tags_display).trim() : '';
        await markFinancingAiEnrichLogSuccess({
          logId,
          started,
          llmModelConfigId: null,
          promptConfigId: null,
          productIntroStored: introLog,
          display: dispLog,
          searchMeta: searchMetaForReuseDonor(),
        });
        const duration = Date.now() - started;
        if (taskLog && taskLog.batchId && taskLog.suppressSuccessConsole) {
          financingAiJobLog(
            taskLog.batchId,
            taskLog.mode || 'batch',
            'reuse_from_db',
            `donor_id=${donorRow.id} event_id=${financingEventId} log_id=${logId} duration_ms=${duration}`
          );
        } else {
          console.log(
            `[financingAiEnrich] reused_from_db donor_id=${donorRow.id} event_id=${financingEventId} log_id=${logId} duration_ms=${duration}`
          );
        }
        return;
      }

      if (eventHasCompleteAiContent(row)) {
        await restoreFanOutAiSuccessWithoutLlm(row, financingEventId);
        const introLog = String(row.ai_product_intro ?? '').trim();
        const dispLog = String(row.ai_company_tags_display ?? '').trim();
        await markFinancingAiEnrichLogSuccess({
          logId,
          started,
          llmModelConfigId: null,
          promptConfigId: null,
          productIntroStored: introLog,
          display: dispLog,
          searchMeta: searchMetaForReuseExisting(),
        });
        const duration = Date.now() - started;
        if (taskLog && taskLog.batchId && taskLog.suppressSuccessConsole) {
          financingAiJobLog(
            taskLog.batchId,
            taskLog.mode || 'batch',
            'reuse_existing_row',
            `event_id=${financingEventId} log_id=${logId} duration_ms=${duration}`
          );
        } else {
          console.log(
            `[financingAiEnrich] reused_existing_row_content event_id=${financingEventId} log_id=${logId} duration_ms=${duration}`
          );
        }
        return;
      }
    } else {
      console.log(
        `[financingAiEnrich] manual_force_llm_refresh event_id=${financingEventId} log_id=${logId} company=${String(row.company_name || '').slice(0, 40)} credit=${String(row.company_credit_code || '').slice(0, 18)}`
      );
    }

    promptMeta = await loadActivePromptMeta();
    promptConfigId = promptMeta?.id || null;

    const promptBundle = await newsAnalysis.getPrompt(PROMPT_INTERFACE, PROMPT_TYPE);
    const storedRaw =
      promptBundle && promptBundle.prompt_content != null
        ? String(promptBundle.prompt_content)
        : '';
    const { system: systemContent, userTemplate } = resolveFinancingAiPromptSections(storedRaw);
    const templateRow = buildFinancingAiTemplateRow(row);
    let userContent = fillTemplate(userTemplate, templateRow);
    if (isNoBaikeEnrichTrigger(triggerType)) {
      userContent = `${NO_BAIKE_USER_PREFIX}${userContent}`;
    }

    const { llm_model_config_id, config } = await resolveLlmConfig(promptBundle, promptMeta);
    llmModelConfigId = llm_model_config_id;
    if (!config) {
      throw new Error('未配置可用的 AI 模型：请在「系统 AI 配置」中维护 application_type=project_sourcing_analysis 的模型，或为该提示词绑定模型');
    }

    let llmOut = null;
    const enrichMaxRetries = 2;
    for (let attempt = 0; attempt <= enrichMaxRetries; attempt++) {
      try {
        llmOut = await callDashScopeOpenAIChat(systemContent, userContent, config);
        break;
      } catch (enrichErr) {
        const status = enrichErr?.response?.status;
        const code = enrichErr?.code;
        const isTransient = status === 429 || (status >= 500 && status < 600) ||
          code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET';
        if (isTransient && attempt < enrichMaxRetries) {
          const delay = (attempt + 1) * 2000;
          console.warn(`[financingAiEnrich] 瞬时错误，${delay}ms 后重试 (${attempt + 1}/${enrichMaxRetries}): ${enrichErr.message}`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw enrichErr;
      }
    }
    await persistFinancingAiLlmSuccess({
      row,
      financingEventId,
      logId,
      raw: llmOut.content,
      config,
      promptConfigId,
      llmModelConfigId,
      started,
      taskLog,
      searchMeta: searchMetaFromLlmCall(llmOut),
      syncProjectDesc: forceLlmRefresh,
      markProfileSourceLlmWeb: isNoBaikeEnrichTrigger(triggerType),
    });
  } catch (err) {
    await markFinancingAiEnrichFailed({
      financingEventId,
      logId,
      row,
      started,
      llmModelConfigId,
      promptMeta,
      err,
    });
  }
}

/**
 * 创建 pending 日志并将事件置为 running（不调用模型）。
 * @returns {Promise<{ok:true, logId:number, idNum:number, jobTraceId:string}|{ok:false, code:number, message:string}>}
 */
async function prepareFinancingAiEnrichJob({ eventId, triggerType, triggeredByUserId, clientIp }) {
  const idNum = parseInt(String(eventId), 10);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { ok: false, code: 400, message: '无效的融资事件 id' };
  }

  const ev = await db.query(
    `SELECT F_Id AS id, event_id, company_name, company_credit_code, F_DeleteMark AS delete_mark FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
    [idNum]
  );
  if (!ev.length || Number(ev[0].delete_mark) !== 0) {
    return { ok: false, code: 404, message: '融资事件不存在' };
  }

  const credit = normalizedCreditCode(ev[0].company_credit_code);
  const nameNorm = normalizeCompanyName(ev[0].company_name);

  if (credit) {
    const busyEnt = await db.query(
      `SELECT l.F_Id FROM sourcing_financing_ai_enrich_log l
       INNER JOIN sourcing_financing_event e ON e.F_Id = l.financing_event_id
       WHERE l.execution_status IN ('pending','running')
         AND TIMESTAMPDIFF(MINUTE, l.triggered_at, NOW()) < 10
         AND TRIM(IFNULL(e.company_credit_code,'')) <> ''
         AND TRIM(e.company_credit_code) = ?`,
      [credit]
    );
    if (busyEnt.length) {
      return {
        ok: false,
        code: 409,
        message: '该统一社会信用代码下已有进行中的 AI 任务，请稍后再试',
      };
    }
  } else if (nameNorm) {
    const busyName = await db.query(
      `SELECT l.F_Id FROM sourcing_financing_ai_enrich_log l
       INNER JOIN sourcing_financing_event e ON e.F_Id = l.financing_event_id
       WHERE l.execution_status IN ('pending','running')
         AND TIMESTAMPDIFF(MINUTE, l.triggered_at, NOW()) < 10
         AND (e.company_credit_code IS NULL OR TRIM(e.company_credit_code) = '')
         AND TRIM(IFNULL(e.company_name,'')) = ?`,
      [nameNorm]
    );
    if (busyName.length) {
      return {
        ok: false,
        code: 409,
        message: '该企业名称（无统一社会信用代码）已有进行中的 AI 任务，请稍后再试',
      };
    }
  }

  const dup = await db.query(
    `SELECT F_Id AS id, triggered_at FROM sourcing_financing_ai_enrich_log
     WHERE financing_event_id = ? AND execution_status IN ('pending','running')
     ORDER BY F_Id DESC LIMIT 1`,
    [idNum]
  );
  if (dup.length) {
    const t = dup[0].triggered_at;
    if (t) {
      const ageRows = await db.query(`SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS m`, [t]);
      const minutes = Number(ageRows[0]?.m ?? 0);
      if (minutes < 10) {
        return { ok: false, code: 409, message: '该事件已有进行中的 AI 任务，请稍后再试' };
      }
    }
  }

  const jobTraceId = crypto.randomUUID();

  const ins = await db.execute(
    `INSERT INTO sourcing_financing_ai_enrich_log
     (financing_event_id, event_id, company_name, trigger_type, triggered_by_user_id, client_ip, job_trace_id, execution_status, prompt_type, ai_enrich_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      idNum,
      ev[0].event_id != null ? String(ev[0].event_id) : null,
      ev[0].company_name != null ? String(ev[0].company_name) : null,
      String(triggerType || 'manual_api'),
      triggeredByUserId || null,
      clientIp || null,
      jobTraceId,
      PROMPT_TYPE,
      AI_ENRICH_VERSION,
    ]
  );
  const logId = ins.insertId;

  const fanRun = buildEnterpriseFanOutWhere(ev[0], idNum);
  await db.execute(
    `UPDATE sourcing_financing_event SET ai_enrich_status = 'running', ai_enrich_error = NULL, F_LastModifyTime = NOW() WHERE ${fanRun.clause}`,
    [...fanRun.params]
  );

  return { ok: true, logId, idNum, jobTraceId };
}

/** 受理手动 AI 取数：写日志、置 running、异步执行任务 */
async function enqueueManualFinancingAiEnrich({ eventId, triggeredByUserId, clientIp }) {
  const prep = await prepareFinancingAiEnrichJob({
    eventId,
    triggerType: 'manual_api',
    triggeredByUserId,
    clientIp,
  });
  if (!prep.ok) {
    return { ok: false, code: prep.code, message: prep.message };
  }

  setImmediate(() => {
    withFinancingAiConcurrency(() =>
      runFinancingAiEnrichTask({
        financingEventId: prep.idNum,
        logId: prep.logId,
        triggerType: 'manual_api',
        triggeredByUserId,
        clientIp,
      })
    ).catch((e) => console.error('[financingAiEnrich manual]', e));
  });

  return {
    ok: true,
    code: 202,
    data: {
      log_id: prep.logId != null ? String(prep.logId) : null,
      job_trace_id: prep.jobTraceId,
      financing_event_id: String(prep.idNum),
    },
  };
}

/**
 * 投融资入库（定时/手动同步）后：同主体库内复用仍不足时，异步排队联网 AI；与 manual 共用并发与任务逻辑。
 */
async function enqueueIngestFinancingAiEnrich({ eventId, triggeredByUserId = null, clientIp = null }) {
  const prep = await prepareFinancingAiEnrichJob({
    eventId,
    triggerType: 'ingest_sync',
    triggeredByUserId,
    clientIp,
  });
  if (!prep.ok) {
    return { ok: false, code: prep.code, message: prep.message };
  }

  setImmediate(() => {
    withFinancingAiConcurrency(() =>
      runFinancingAiEnrichTask({
        financingEventId: prep.idNum,
        logId: prep.logId,
        triggerType: 'ingest_sync',
        triggeredByUserId,
        clientIp,
      })
    ).catch((e) => console.error('[financingAiEnrich ingest_sync]', e));
  });

  return {
    ok: true,
    code: 202,
    data: {
      log_id: prep.logId != null ? String(prep.logId) : null,
      job_trace_id: prep.jobTraceId,
      financing_event_id: String(prep.idNum),
    },
  };
}

async function processOneFinancingAiBatchQueueJob(job) {
  try {
    const triggerType = job.triggerType || 'batch_date_range';
    const prep = await prepareFinancingAiEnrichJob({
      eventId: job.financingEventId,
      triggerType,
      triggeredByUserId: job.triggeredByUserId,
      clientIp: job.clientIp,
    });
    if (!prep.ok) {
      financingAiJobLog(
        job.batchId,
        'concurrent_chat',
        'prepare_skip',
        `financing_event_id=${job.financingEventId}`,
        { reason: prep.message }
      );
      return;
    }
    await withFinancingAiConcurrency(() =>
      runFinancingAiEnrichTask({
        financingEventId: prep.idNum,
        logId: prep.logId,
        triggerType,
        triggeredByUserId: job.triggeredByUserId,
        clientIp: job.clientIp,
        taskLog: { batchId: job.batchId, mode: 'concurrent_chat', suppressSuccessConsole: true },
      })
    );
  } catch (e) {
    console.error(`[financingAiEnrich batch ${job.batchId}] job error`, e);
  }
}

async function pumpFinancingAiBatchQueue() {
  const jobs = [];
  while (financingAiBatchQueue.length) {
    const job = financingAiBatchQueue.shift();
    if (job) jobs.push(job);
  }
  const batchId = jobs[0]?.batchId || 'unknown';
  financingAiJobLog(batchId, 'concurrent_chat', 'pump_start', `total_queue_jobs=${jobs.length}`);
  for (let i = 0, wave = 0; i < jobs.length; i += FINANCING_AI_CONCURRENCY_N, wave++) {
    const chunk = jobs.slice(i, i + FINANCING_AI_CONCURRENCY_N);
    const wid = chunk[0]?.batchId || batchId;
    financingAiJobLog(
      wid,
      'concurrent_chat',
      'wave_start',
      `wave=${wave + 1} range=${i + 1}-${Math.min(i + chunk.length, jobs.length)}/${jobs.length} parallel=${chunk.length}`
    );
    await Promise.all(chunk.map((job) => processOneFinancingAiBatchQueueJob(job)));
    if (i + FINANCING_AI_CONCURRENCY_N < jobs.length && BATCH_AI_GAP_MS > 0) {
      financingAiJobLog(wid, 'concurrent_chat', 'wave_gap', `sleep_ms=${BATCH_AI_GAP_MS}`);
      await sleep(BATCH_AI_GAP_MS);
    }
  }
  financingAiJobLog(batchId, 'concurrent_chat', 'pump_done', `processed_jobs=${jobs.length}`);
}

function scheduleFinancingAiBatchPump() {
  if (financingAiBatchPumpPromise) return;
  financingAiBatchPumpPromise = pumpFinancingAiBatchQueue()
    .catch((e) => console.error('[financingAiEnrich batch pump]', e))
    .finally(() => {
      financingAiBatchPumpPromise = null;
      if (financingAiBatchQueue.length) scheduleFinancingAiBatchPump();
    });
}

/**
 * 按融资日期区间批量：去重后条数大于 {@link BATCH_FILE_THRESHOLD} 时走百炼 Batch File 异步；
 * 否则服务端并发池（{@link FINANCING_AI_CONCURRENCY_N}）执行多条 chat/completions，波次间间隔 {@link BATCH_AI_GAP_MS}。
 */
async function enqueueBatchFinancingAiEnrichByDateRange({
  dateFrom,
  dateTo,
  triggeredByUserId,
  clientIp,
  onlyFailed = false,
}) {
  // 前端按北京时间日历日传 yyyy-MM-dd；库 event_date 为 DATE，直接字符串比较，不做时区换算
  const df = dateFrom != null ? String(dateFrom).trim().slice(0, 10) : '';
  const dt = dateTo != null ? String(dateTo).trim().slice(0, 10) : '';
  if (!df || !dt) {
    return { ok: false, code: 400, message: '请选择融资日期起止（yyyy-MM-dd）' };
  }
  if (df > dt) {
    return { ok: false, code: 400, message: '开始日期不能晚于结束日期' };
  }

  const failedClause = onlyFailed ? ` AND ai_enrich_status = 'failed' ` : '';
  const rows = await db.query(
    `SELECT F_Id AS id, company_name, company_credit_code FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ? ${failedClause}
     ORDER BY event_date DESC, F_Id DESC`,
    [df, dt]
  );
  const totalInRange = rows.length;
  if (!totalInRange) {
    return {
      ok: false,
      code: 400,
      message: onlyFailed
        ? '该融资日期范围内没有 AI 状态为 failed 的融资事件'
        : '该融资日期范围内没有可处理的融资事件',
    };
  }

  const batchTriggerType = onlyFailed ? 'batch_retry_failed' : 'batch_date_range';

  /**
   * 去重减少无效调用：有统一社会信用代码时按代码去重（推荐）；无代码时按企业全称去重。
   * 代表行取区间内最新融资（ORDER BY event_date DESC, id DESC 已保证顺序）。
   */
  const seenKey = new Set();
  const representativeIds = [];
  for (const r of rows) {
    const credit = normalizedCreditCode(r.company_credit_code);
    const nm = normalizeCompanyName(r.company_name);
    const dedupeKey = credit ? `c:${credit}` : nm ? `n:${nm}` : `id:${r.id}`;
    if (seenKey.has(dedupeKey)) continue;
    seenKey.add(dedupeKey);
    const idNum = Number(r.id);
    if (Number.isFinite(idNum) && idNum > 0) representativeIds.push(idNum);
  }

  const batchId = crypto.randomUUID();
  const queuedJobs = representativeIds.length;

  let useDashScopeBatchFile = queuedJobs > BATCH_FILE_THRESHOLD;
  if (useDashScopeBatchFile) {
    try {
      const promptMetaProbe = await loadActivePromptMeta();
      const promptBundleProbe = await newsAnalysis.getPrompt(PROMPT_INTERFACE, PROMPT_TYPE);
      const { config: probeConfig } = await resolveLlmConfig(promptBundleProbe, promptMetaProbe);
      if (probeConfig && (resolveLlmProfile(probeConfig).is_gateway || resolveLlmProfile(probeConfig).is_volcengine)) {
        useDashScopeBatchFile = false;
        financingAiJobLog(
          batchId,
          'concurrent_chat',
          'gateway_skip_dashscope_batch',
          `dedup_jobs=${queuedJobs} gateway 模型走 Responses 异步并发，不使用百炼 Batch File`,
          { threshold: BATCH_FILE_THRESHOLD, model: probeConfig.model_name }
        );
      }
    } catch (probeErr) {
      console.warn('[financingAiEnrich] gateway batch probe failed, fallback dashscope batch', probeErr);
    }
  }

  if (useDashScopeBatchFile) {
    financingAiJobLog(batchId, 'batch_file', 'enqueue', `date=${df}..${dt} dedup_jobs=${queuedJobs} threshold=${BATCH_FILE_THRESHOLD}`, {
      rows_in_range: totalInRange,
      only_failed: !!onlyFailed,
      trigger_type: batchTriggerType,
    });
    let submitResult;
    try {
      submitResult = await submitLargeBatchFileFinancingAiEnrich({
        batchId,
        representativeIds,
        triggeredByUserId,
        clientIp,
        df,
        dt,
        totalInRange,
        triggerType: batchTriggerType,
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.error(`[financingAiEnrich batch_file] submit failed batch_id=${batchId}`, e);
      financingAiJobLog(batchId, 'batch_file', 'submit_http_error', msg);
      return { ok: false, code: 502, message: `百炼 Batch 提交失败：${msg}` };
    }

    if (submitResult.kind === 'noop') {
      financingAiJobLog(
        batchId,
        'batch_file',
        'submit_noop',
        `no DashScope batch created date=${df}..${dt}`,
        {
          rows_in_range: totalInRange,
          dedup_jobs: queuedJobs,
          threshold: BATCH_FILE_THRESHOLD,
        }
      );
      return {
        ok: true,
        code: 202,
        data: {
          batch_id: batchId,
          mode: 'dashscope_batch_file',
          batch_file_phase: 'noop',
          batch_file_threshold: BATCH_FILE_THRESHOLD,
          total_in_range: totalInRange,
          queued_jobs: queuedJobs,
          total: queuedJobs,
          date_from: df,
          date_to: dt,
          gap_ms: BATCH_AI_GAP_MS,
          concurrency: FINANCING_AI_CONCURRENCY_N,
          dashscope_batch_id: null,
          llm_jobs_submitted: 0,
          only_failed: !!onlyFailed,
        },
      };
    }

    const { dashscopeBatchId, llmJobs, config, promptConfigId, llmModelConfigId, promptMeta, baseUrl } =
      submitResult;

    financingAiJobLog(batchId, 'batch_file', 'http202_poll_scheduled', `returning 202; background poll+apply`, {
      dashscope_batch_id: dashscopeBatchId,
      llm_jobs: llmJobs.length,
    });

    setImmediate(() => {
      pollAndApplyLargeBatchFileFinancingAiEnrich({
        batchId,
        dashscopeBatchId,
        llmJobs,
        config,
        promptConfigId,
        llmModelConfigId,
        promptMeta,
        baseUrl,
      }).catch((e) => {
        console.error(`[financingAiEnrich batch_file][poll] ${batchId}`, e);
        financingAiJobLog(batchId, 'batch_file', 'poll_async_error', (e && e.message) || String(e));
      });
    });

    return {
      ok: true,
      code: 202,
      data: {
        batch_id: batchId,
        mode: 'dashscope_batch_file',
        batch_file_phase: 'submitted',
        batch_file_threshold: BATCH_FILE_THRESHOLD,
        total_in_range: totalInRange,
        queued_jobs: queuedJobs,
        total: queuedJobs,
        date_from: df,
        date_to: dt,
        gap_ms: BATCH_AI_GAP_MS,
        concurrency: FINANCING_AI_CONCURRENCY_N,
        dashscope_batch_id: dashscopeBatchId,
        llm_jobs_submitted: llmJobs.length,
        only_failed: !!onlyFailed,
      },
    };
  }

  for (const financingEventId of representativeIds) {
    financingAiBatchQueue.push({
      batchId,
      financingEventId,
      triggeredByUserId,
      clientIp,
      triggerType: batchTriggerType,
    });
  }

  financingAiJobLog(batchId, 'concurrent_chat', 'queue_ready', `dedup_jobs=${queuedJobs} date=${df}..${dt}`, {
    concurrency: FINANCING_AI_CONCURRENCY_N,
    wave_gap_ms: BATCH_AI_GAP_MS,
    only_failed: !!onlyFailed,
    trigger_type: batchTriggerType,
  });
  scheduleFinancingAiBatchPump();

  return {
    ok: true,
    code: 202,
    data: {
      batch_id: batchId,
      mode: 'concurrent_chat',
      batch_file_threshold: BATCH_FILE_THRESHOLD,
      /** 区间内融资事件条数 */
      total_in_range: totalInRange,
      /** 去重后的 AI 任务数（有代码按代码，无代码按企业全称） */
      queued_jobs: queuedJobs,
      /** 兼容旧字段：与 queued_jobs 相同 */
      total: queuedJobs,
      date_from: df,
      date_to: dt,
      gap_ms: BATCH_AI_GAP_MS,
      concurrency: FINANCING_AI_CONCURRENCY_N,
      only_failed: !!onlyFailed,
    },
  };
}

/**
 * 与融资事件同一套提示词/模型：仅执行一次 chat，返回解析后的简介与标签（不落库）。
 * rowForTemplate 需含 financing 模板占位：company_name、company_credit_code、project_name（可空）。
 */
async function runFinancingStyleWebEnrichLlmCall(rowForTemplate, extraContext, opts = {}) {
  const searchRequired = opts.searchRequired !== false;
  const wantSearch = opts.wantSearch !== false;
  const promptMeta = await loadActivePromptMeta();
  const promptConfigId = promptMeta?.id || null;
  const promptBundle = await newsAnalysis.getPrompt(PROMPT_INTERFACE, PROMPT_TYPE);
  const storedRaw =
    promptBundle && promptBundle.prompt_content != null ? String(promptBundle.prompt_content) : '';
  const { system: systemContent, userTemplate } = resolveFinancingAiPromptSections(storedRaw);
  let userContent = fillTemplate(userTemplate, rowForTemplate);
  if (extraContext && typeof extraContext === 'string' && extraContext.trim()) {
    userContent += `\n\n【以下为商业计划书（BP）内容，请一并参考】\n${extraContext.trim()}`;
  }
  const { llm_model_config_id, config } = await resolveLlmConfig(promptBundle, promptMeta);
  if (!config) {
    throw new Error(
      '未配置可用的 AI 模型：请在「系统 AI 配置」中维护 application_type=project_sourcing_analysis 的模型，或为该提示词绑定模型'
    );
  }
  const qccLen = String(rowForTemplate.qcc_company_intro || '').trim().length;
  const thinkFlag =
    config.enable_thinking != null && config.enable_thinking !== ''
      ? Number(config.enable_thinking) === 1
        ? '1'
        : '0'
      : 'env';
  console.log(
    `[financingAiEnrich] web_enrich_request company=${String(rowForTemplate.company_name || '').slice(0, 40)} credit=${String(rowForTemplate.company_credit_code || '').slice(0, 18)} qcc_len=${qccLen} enable_thinking=${thinkFlag} user_msg_len=${userContent.length} search_required=${searchRequired ? 1 : 0}`
  );
  const llmOut = await callDashScopeOpenAIChat(systemContent, userContent, config, {
    searchRequired,
    wantSearch,
  });
  const raw = llmOut.content;
  const parsed = extractJsonObject(raw);
  const norm = normalizeAiPayload(parsed);
  if (!norm) {
    logAndThrowUnparseableModelJson(raw, 'financing_style_llm');
  }
  const productIntroStored = stripProductIntroMetaAttribution(
    stripRedundantIdentifiersFromProductIntro(norm.product_intro, rowForTemplate)
  );
  const tagsJson = JSON.stringify(norm.tags);
  const display = norm.tags.join('、');
  const persistIntroLen = String(productIntroStored || '').trim().length;
  const persistTagCount = Array.isArray(norm.tags) ? norm.tags.length : 0;
  if (persistIntroLen === 0 && persistTagCount === 0) {
    const rawStr = raw == null ? '' : String(raw);
    const max = AI_PARSE_FAIL_LOG_RAW_MAX;
    const logged =
      rawStr.length > max
        ? `${rawStr.slice(0, max)}\n…(truncated total_len=${rawStr.length})`
        : rawStr;
    const preStripIntroLen = String(norm.product_intro || '').trim().length;
    console.warn(
      `[financingAiEnrich] web_enrich_persist_empty tag=financing_style_llm model=${config.model_name} pre_strip_intro_len=${preStripIntroLen} parsed_keys=${parsed && typeof parsed === 'object' ? Object.keys(parsed).join(',') : 'n/a'}\n${logged}`
    );
  }
  return {
    raw,
    config,
    promptConfigId,
    llmModelConfigId: llm_model_config_id,
    promptMeta,
    productIntroStored,
    display,
    tagsJson,
    searchMeta: searchMetaFromLlmCall(llmOut),
  };
}

module.exports = {
  enqueueManualFinancingAiEnrich,
  enqueueIngestFinancingAiEnrich,
  enqueueBatchFinancingAiEnrichByDateRange,
  runFinancingAiEnrichTask,
  prepareFinancingAiEnrichJob,
  findFinancingAiDonorRow,
  applyFinancingAiReuseFromDonor,
  reuseFinancingAiForEventId,
  eventHasCompleteAiContent,
  runFinancingStyleWebEnrichLlmCall,
  buildFinancingAiTemplateRow,
  buildEnterpriseFanOutWhere,
  withFinancingAiConcurrency,
  callDashScopeOpenAIChat,
  PROMPT_INTERFACE,
  PROMPT_TYPE,
  AI_ENRICH_VERSION,
  NO_BAIKE_ENRICH_TRIGGER,
  isNoBaikeEnrichTrigger,
  buildBuiltinPromptContentForDb,
  PROMPT_SECTION_SYSTEM,
  PROMPT_SECTION_USER,
  extractCompetitorSupplementTagsFromNarrative,
  submitLargeBatchFileFinancingAiEnrich,
  pollAndApplyLargeBatchFileFinancingAiEnrich,
};
