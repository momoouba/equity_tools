const crypto = require('crypto');
const db = require('../../db');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const {
  getApplicationIdByAppName,
  isInvestedEnterpriseCompetitorAnalysisApp,
} = require('../applicationIdResolve');
const {
  runFinancingStyleWebEnrichLlmCall,
  buildFinancingAiTemplateRow,
  withFinancingAiConcurrency,
  PROMPT_TYPE,
} = require('../项目挖掘/financingAiEnrichService');
const {
  searchMetaSqlAssignments,
  searchMetaSqlValues,
} = require('../项目挖掘/financingAiEnrichSearchMeta');
const { executeWithAiEnrichLogColumns } = require('../migrateAiEnrichLogColumns');

const IE_AI_VERSION = 'invested_enterprise_web_enrich_v1';

/** 日志 trigger_type：新数据带表前缀；无前缀旧数据按被投企业解读（见 db 注释） */
const IE_AI_LOG_TARGET = 'invested_enterprises';

function formatIeAiEnrichTriggerType(shortType) {
  const s = String(shortType || 'manual_api').trim();
  if (s.startsWith('invested_enterprises:') || s.startsWith('ipo_project:')) return s;
  return `${IE_AI_LOG_TARGET}:${s}`;
}

const BATCH_AI_GAP_MS = Math.max(
  500,
  Math.min(60000, parseInt(process.env.FINANCING_AI_BATCH_GAP_MS || '500', 10) || 500)
);

const FINANCING_AI_CONCURRENCY_N = Math.max(
  1,
  Math.min(32, parseInt(process.env.FINANCING_AI_CONCURRENCY || '4', 10) || 4)
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normYmd(v) {
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function normalizeNameKey(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function markIeAiLogSuccess({
  logId,
  started,
  llmModelConfigId,
  promptConfigId,
  productIntroStored,
  tagsDisplay,
  searchMeta = null,
}) {
  const duration = Date.now() - started;
  const sm = searchMetaSqlValues(searchMeta);
  await executeWithAiEnrichLogColumns(
    db,
    `UPDATE invested_enterprise_ai_enrich_log SET
       execution_status = 'success',
       finished_at = NOW(),
       duration_ms = ?,
       llm_model_config_id = ?,
       prompt_type = ?,
       prompt_version = ?,
       ai_enrich_version = ?,
       error_message = NULL,
       result_product_intro = ?,
       result_industry_tags_display = ?,
       ${searchMetaSqlAssignments()},
       updated_at = NOW()
     WHERE id = ?`,
    [
      duration,
      llmModelConfigId != null ? String(llmModelConfigId) : null,
      PROMPT_TYPE,
      promptConfigId != null ? String(promptConfigId) : null,
      IE_AI_VERSION,
      productIntroStored || null,
      tagsDisplay || null,
      ...sm,
      logId,
    ]
  );
}

async function markIeAiLogFailed({ logId, started, llmModelConfigId, promptConfigId, err }) {
  const msg = (err && err.message) || String(err);
  const short = msg.length > 480 ? `${msg.slice(0, 480)}…` : msg;
  const duration = Date.now() - started;
  try {
    await db.execute(
      `UPDATE invested_enterprise_ai_enrich_log SET
         execution_status = 'failed',
         finished_at = NOW(),
         duration_ms = ?,
         llm_model_config_id = ?,
         prompt_type = ?,
         prompt_version = ?,
         ai_enrich_version = ?,
         error_message = ?,
         updated_at = NOW()
       WHERE id = ?`,
      [
        duration,
        llmModelConfigId != null ? String(llmModelConfigId) : null,
        PROMPT_TYPE,
        promptConfigId != null ? String(promptConfigId) : null,
        IE_AI_VERSION,
        short,
        logId,
      ]
    );
  } catch (e2) {
    console.error('[ieAiEnrich] log failed update', e2);
  }
}

/**
 * @returns {Promise<{ok:true, logId:number, jobTraceId:string}|{ok:false, code:number, message:string}>}
 */
async function prepareInvestedEnterpriseAiJob({ enterpriseId, triggerType, triggeredByUserId, clientIp }) {
  const id = String(enterpriseId || '').trim();
  if (!id) {
    return { ok: false, code: 400, message: '无效的企业 id' };
  }

  const rows = await db.query(
    `SELECT id, enterprise_full_name, data_app_name, data_app_id, delete_mark
     FROM invested_enterprises WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].delete_mark) !== 0) {
    return { ok: false, code: 404, message: '被投企业不存在或已删除' };
  }
  if (!(await isInvestedEnterpriseCompetitorAnalysisApp(rows[0]))) {
    return { ok: false, code: 400, message: '仅支持竞品分析应用下的被投企业' };
  }

  const dup = await db.query(
    `SELECT id, triggered_at FROM invested_enterprise_ai_enrich_log
     WHERE invested_enterprise_id = ? AND ipo_project_f_id IS NULL
       AND execution_status IN ('pending','running')
     ORDER BY id DESC LIMIT 1`,
    [id]
  );
  if (dup.length) {
    const t = dup[0].triggered_at;
    if (t) {
      const ageRows = await db.query(`SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS m`, [t]);
      const minutes = Number(ageRows[0]?.m ?? 0);
      if (minutes < 10) {
        return { ok: false, code: 409, message: '该企业已有进行中的 AI 任务，请稍后再试' };
      }
    }
  }

  const jobTraceId = crypto.randomUUID();
  const ins = await db.execute(
    `INSERT INTO invested_enterprise_ai_enrich_log
     (invested_enterprise_id, ipo_project_f_id, enterprise_full_name, trigger_type, triggered_by_user_id, client_ip, job_trace_id, execution_status, prompt_type, ai_enrich_version)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      rows[0].enterprise_full_name != null ? String(rows[0].enterprise_full_name) : null,
      formatIeAiEnrichTriggerType(triggerType),
      triggeredByUserId || null,
      clientIp || null,
      jobTraceId,
      PROMPT_TYPE,
      IE_AI_VERSION,
    ]
  );
  const logId = ins.insertId;

  await db.execute(
    `UPDATE invested_enterprises SET ai_enrich_status = 'running', ai_enrich_error = NULL, updated_at = NOW()
     WHERE id = ? AND delete_mark = 0`,
    [id]
  );

  return { ok: true, logId, jobTraceId, enterpriseId: id };
}

async function runInvestedEnterpriseAiEnrichTask({
  enterpriseId,
  logId,
  triggerType,
  triggeredByUserId,
  clientIp,
}) {
  const started = Date.now();
  let llmModelConfigId = null;
  let promptMeta = null;
  let promptConfigId = null;
  let row = null;
  try {
    await db.execute(
      `UPDATE invested_enterprise_ai_enrich_log
       SET execution_status = 'running', started_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [logId]
    );

    const ev = await db.query(
      `SELECT id, enterprise_full_name, unified_credit_code, project_abbreviation,
              qcc_company_intro, delete_mark
       FROM invested_enterprises WHERE id = ? LIMIT 1`,
      [enterpriseId]
    );
    if (!ev.length || Number(ev[0].delete_mark) !== 0) {
      throw new Error('被投企业不存在或已删除');
    }
    row = ev[0];

    const rowForTemplate = buildFinancingAiTemplateRow(row);
    if (!rowForTemplate.company_name) {
      throw new Error('被投企业全称为空，无法调用模型');
    }

    const llm = await withFinancingAiConcurrency(() => runFinancingStyleWebEnrichLlmCall(rowForTemplate));
    llmModelConfigId = llm.llmModelConfigId;
    promptMeta = llm.promptMeta;
    promptConfigId = llm.promptConfigId;

    const introLen = String(llm.productIntroStored || '').trim().length;
    const tagCount = (() => { try { const a = JSON.parse(llm.tagsJson || '[]'); return Array.isArray(a) ? a.length : 0; } catch { return 0; } })();
    if (introLen === 0 && tagCount === 0) {
      throw new Error('AI 补全返回空结果（product_intro 和 industry_tags 均为空），标记为失败以便重试');
    }

    await db.execute(
      `UPDATE invested_enterprises SET
         ai_product_intro = ?,
         ai_industry_tags_display = ?,
         ai_industry_tags_json = ?,
         ai_enrich_status = 'success',
         ai_enrich_at = NOW(),
         ai_enrich_model = ?,
         ai_enrich_version = ?,
         ai_enrich_error = NULL,
         updated_at = NOW()
       WHERE id = ? AND delete_mark = 0`,
      [
        llm.productIntroStored || null,
        llm.display || null,
        llm.tagsJson,
        String(llm.config.model_name || ''),
        IE_AI_VERSION,
        enterpriseId,
      ]
    );

    await markIeAiLogSuccess({
      logId,
      started,
      llmModelConfigId,
      promptConfigId,
      productIntroStored: llm.productIntroStored,
      tagsDisplay: llm.display,
      searchMeta: llm.searchMeta,
    });
    const sm = llm.searchMeta || {};
    console.log(
      `[ieAiEnrich] success enterprise_id=${enterpriseId} log_id=${logId} trigger=${triggerType} model=${llm.config.model_name} product_intro_len=${introLen} tags_count=${tagCount} invoke=${sm.invoke_mode || 'n/a'} used_thinking=${sm.used_enable_thinking} thinking_degraded=${sm.thinking_degraded}`
    );
    if (introLen === 0 && tagCount === 0) {
      const raw = llm.raw == null ? '' : String(llm.raw);
      const max = Math.max(800, Math.min(50000, parseInt(process.env.AI_PARSE_FAIL_LOG_RAW_MAX || '8000', 10) || 8000));
      const logged = raw.length > max ? `${raw.slice(0, max)}\n…(truncated total_len=${raw.length})` : raw;
      console.warn(`[ieAiEnrich] persist_empty_llm_raw enterprise_id=${enterpriseId} log_id=${logId}\n${logged}`);
    }
  } catch (err) {
    await db.execute(
      `UPDATE invested_enterprises SET
         ai_enrich_status = 'failed',
         ai_enrich_error = ?,
         updated_at = NOW()
       WHERE id = ? AND delete_mark = 0`,
      [String((err && err.message) || err).slice(0, 480), enterpriseId]
    );
    await markIeAiLogFailed({
      logId,
      started,
      llmModelConfigId,
      promptConfigId,
      err,
    });
    console.error('[ieAiEnrich] task failed', { enterpriseId, logId, err: (err && err.message) || String(err) });
  }
}

async function enqueueManualInvestedEnterpriseAiEnrich({ enterpriseId, triggeredByUserId, clientIp }) {
  const prep = await prepareInvestedEnterpriseAiJob({
    enterpriseId,
    triggerType: 'manual_api',
    triggeredByUserId,
    clientIp,
  });
  if (!prep.ok) {
    return { ok: false, code: prep.code, message: prep.message };
  }
  setImmediate(() => {
    runInvestedEnterpriseAiEnrichTask({
      enterpriseId: prep.enterpriseId,
      logId: prep.logId,
      triggerType: 'manual_api',
      triggeredByUserId,
      clientIp,
    }).catch((e) => console.error('[ieAiEnrich manual]', e));
  });
  return {
    ok: true,
    code: 202,
    data: {
      log_id: String(prep.logId),
      job_trace_id: prep.jobTraceId,
      invested_enterprise_id: prep.enterpriseId,
    },
  };
}

async function enqueueBatchInvestedEnterpriseAiEnrich({
  dateFrom,
  dateTo,
  onlyFailed = false,
  triggeredByUserId,
  clientIp,
}) {
  const df = normYmd(dateFrom);
  const dt = normYmd(dateTo);
  if (!df || !dt) {
    return { ok: false, code: 400, message: '请选择创建日期起止（yyyy-MM-dd）' };
  }
  if (df > dt) {
    return { ok: false, code: 400, message: '开始日期不能晚于结束日期' };
  }

  const failedClause = onlyFailed ? ` AND ai_enrich_status = 'failed' ` : '';
  const psId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  const appClause = psId
    ? `(data_app_id = ? OR (data_app_id IS NULL AND data_app_name = ?))`
    : `data_app_name = ?`;
  const appParams = psId ? [psId, DATA_APP_COMPETITOR_ANALYSIS] : [DATA_APP_COMPETITOR_ANALYSIS];
  const rows = await db.query(
    `SELECT id, enterprise_full_name FROM invested_enterprises
     WHERE delete_mark = 0 AND ${appClause}
       AND DATE(created_at) >= ? AND DATE(created_at) <= ?
       ${failedClause}
     ORDER BY created_at DESC, id DESC`,
    [...appParams, df, dt]
  );
  const totalInRange = rows.length;
  if (!totalInRange) {
    return {
      ok: false,
      code: 400,
      message: onlyFailed
        ? '该创建日期范围内没有 AI 状态为 failed 的被投企业'
        : '该创建日期范围内没有可处理的被投企业',
    };
  }

  const seen = new Set();
  const representativeIds = [];
  for (const r of rows) {
    const k = normalizeNameKey(r.enterprise_full_name) || `id:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    representativeIds.push(String(r.id));
  }

  const batchId = crypto.randomUUID();
  const queued = representativeIds.length;
  console.log(
    `[ieAiEnrich][batch=${batchId}] enqueue created_at=${df}..${dt} rows=${totalInRange} dedup=${queued} only_failed=${!!onlyFailed}`
  );

  for (let i = 0; i < representativeIds.length; i += FINANCING_AI_CONCURRENCY_N) {
    const chunk = representativeIds.slice(i, i + FINANCING_AI_CONCURRENCY_N);
    await Promise.all(
      chunk.map(async (eid) => {
        const prep = await prepareInvestedEnterpriseAiJob({
          enterpriseId: eid,
          triggerType: onlyFailed ? 'batch_retry_failed' : 'batch_date_range',
          triggeredByUserId,
          clientIp,
        });
        if (!prep.ok) {
          console.warn(`[ieAiEnrich][batch] skip enterprise_id=${eid}`, prep.message);
          return;
        }
        // 不在此再包 withFinancingAiConcurrency：runInvestedEnterpriseAiEnrichTask 内部已对 LLM 调用占槽；
        // 外层 Promise.all 已按 FINANCING_AI_CONCURRENCY_N 限流，若双层占槽会死锁（首批占满槽后内层永远等不到槽）。
        await runInvestedEnterpriseAiEnrichTask({
          enterpriseId: prep.enterpriseId,
          logId: prep.logId,
          triggerType: onlyFailed ? 'batch_retry_failed' : 'batch_date_range',
          triggeredByUserId,
          clientIp,
        });
      })
    );
    if (i + FINANCING_AI_CONCURRENCY_N < representativeIds.length && BATCH_AI_GAP_MS > 0) {
      await sleep(BATCH_AI_GAP_MS);
    }
  }

  return {
    ok: true,
    code: 202,
    data: {
      batch_id: batchId,
      mode: 'concurrent_inline',
      total_in_range: totalInRange,
      queued_jobs: queued,
      total: queued,
      date_from: df,
      date_to: dt,
      only_failed: !!onlyFailed,
      gap_ms: BATCH_AI_GAP_MS,
      concurrency: FINANCING_AI_CONCURRENCY_N,
    },
  };
}

module.exports = {
  enqueueManualInvestedEnterpriseAiEnrich,
  enqueueBatchInvestedEnterpriseAiEnrich,
  IE_AI_VERSION,
};
