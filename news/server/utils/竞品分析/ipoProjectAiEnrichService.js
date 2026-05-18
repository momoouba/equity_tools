const crypto = require('crypto');
const db = require('../../db');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { getApplicationIdByAppName, isIpoProjectCompetitorAnalysisApp } = require('../applicationIdResolve');
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

const IPP_AI_VERSION = 'ipo_project_web_enrich_v1';
const IPP_AI_LOG_TARGET = 'ipo_project';

function formatIppAiEnrichTriggerType(shortType) {
  const s = String(shortType || 'manual_api').trim();
  if (s.startsWith('invested_enterprises:') || s.startsWith('ipo_project:')) return s;
  return `${IPP_AI_LOG_TARGET}:${s}`;
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

/** 与企查查侧一致：批量 AI 去重；成功时按统一社会信用代码回写同源多行 */
function normalizeCreditDedupe(code) {
  return String(code ?? '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

async function markIppAiLogSuccess({
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
      IPP_AI_VERSION,
      productIntroStored || null,
      tagsDisplay || null,
      ...sm,
      logId,
    ]
  );
}

async function markIppAiLogFailed({ logId, started, llmModelConfigId, promptConfigId, err }) {
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
        IPP_AI_VERSION,
        short,
        logId,
      ]
    );
  } catch (e2) {
    console.error('[ippAiEnrich] log failed update', e2);
  }
}

/**
 * @returns {Promise<{ok:true, logId:number, jobTraceId:string}|{ok:false, code:number, message:string}>}
 */
async function prepareIpoProjectAiJob({ fId, triggerType, triggeredByUserId, clientIp }) {
  const id = String(fId || '').trim();
  if (!id) {
    return { ok: false, code: 400, message: '无效的底层项目 f_id' };
  }

  const rows = await db.query(
    `SELECT f_id, company, project_name, unified_credit_code, data_app_id, F_DeleteMark
     FROM ipo_project WHERE f_id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].F_DeleteMark) !== 0) {
    return { ok: false, code: 404, message: '底层项目不存在或已删除' };
  }
  if (!(await isIpoProjectCompetitorAnalysisApp(rows[0]))) {
    return { ok: false, code: 400, message: '仅支持竞品分析应用下的底层项目' };
  }

  const dup = await db.query(
    `SELECT id, triggered_at FROM invested_enterprise_ai_enrich_log
     WHERE ipo_project_f_id = ? AND execution_status IN ('pending','running')
     ORDER BY id DESC LIMIT 1`,
    [id]
  );
  if (dup.length) {
    const t = dup[0].triggered_at;
    if (t) {
      const ageRows = await db.query(`SELECT TIMESTAMPDIFF(MINUTE, ?, NOW()) AS m`, [t]);
      const minutes = Number(ageRows[0]?.m ?? 0);
      if (minutes < 10) {
        return { ok: false, code: 409, message: '该项目已有进行中的 AI 任务，请稍后再试' };
      }
    }
  }

  const jobTraceId = crypto.randomUUID();
  const companyName = rows[0].company != null ? String(rows[0].company) : null;
  const ins = await db.execute(
    `INSERT INTO invested_enterprise_ai_enrich_log
     (invested_enterprise_id, ipo_project_f_id, enterprise_full_name, trigger_type, triggered_by_user_id, client_ip, job_trace_id, execution_status, prompt_type, ai_enrich_version)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      companyName,
      formatIppAiEnrichTriggerType(triggerType),
      triggeredByUserId || null,
      clientIp || null,
      jobTraceId,
      PROMPT_TYPE,
      IPP_AI_VERSION,
    ]
  );
  const logId = ins.insertId;

  await db.execute(
    `UPDATE ipo_project SET ai_enrich_status = 'running', ai_enrich_error = NULL WHERE f_id = ? AND F_DeleteMark = 0`,
    [id]
  );

  return { ok: true, logId, jobTraceId, fId: id };
}

async function runIpoProjectAiEnrichTask({
  fId,
  logId,
  triggerType,
  triggeredByUserId,
  clientIp,
}) {
  const started = Date.now();
  let llmModelConfigId = null;
  let promptConfigId = null;
  try {
    await db.execute(
      `UPDATE invested_enterprise_ai_enrich_log
       SET execution_status = 'running', started_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [logId]
    );

    const ev = await db.query(
      `SELECT f_id, company, project_name, unified_credit_code, qcc_company_intro, data_app_id, F_DeleteMark
       FROM ipo_project WHERE f_id = ? LIMIT 1`,
      [fId]
    );
    if (!ev.length || Number(ev[0].F_DeleteMark) !== 0) {
      throw new Error('底层项目不存在或已删除');
    }
    const row = ev[0];
    if (!(await isIpoProjectCompetitorAnalysisApp(row))) {
      throw new Error('仅支持竞品分析应用下的底层项目');
    }

    const rowForTemplate = buildFinancingAiTemplateRow(row);
    if (!rowForTemplate.company_name) {
      throw new Error('企业全称为空，无法调用模型');
    }

    const llm = await withFinancingAiConcurrency(() => runFinancingStyleWebEnrichLlmCall(rowForTemplate));
    llmModelConfigId = llm.llmModelConfigId;
    promptConfigId = llm.promptConfigId;

    await db.execute(
      `UPDATE ipo_project SET
         ai_product_intro = ?,
         ai_industry_tags_display = ?,
         ai_industry_tags_json = ?,
         ai_enrich_status = 'success',
         ai_enrich_at = NOW(),
         ai_enrich_model = ?,
         ai_enrich_version = ?,
         ai_enrich_error = NULL
       WHERE f_id = ? AND F_DeleteMark = 0`,
      [
        llm.productIntroStored || null,
        llm.display || null,
        llm.tagsJson,
        String(llm.config.model_name || ''),
        IPP_AI_VERSION,
        fId,
      ]
    );

    const creditNorm = normalizeCreditDedupe(row.unified_credit_code);
    if (creditNorm.length >= 8) {
      await db.execute(
        `UPDATE ipo_project SET
           ai_product_intro = ?,
           ai_industry_tags_display = ?,
           ai_industry_tags_json = ?,
           ai_enrich_status = 'success',
           ai_enrich_at = NOW(),
           ai_enrich_model = ?,
           ai_enrich_version = ?,
           ai_enrich_error = NULL
         WHERE F_DeleteMark = 0 AND data_app_id <=> ?
           AND UPPER(REPLACE(REPLACE(IFNULL(unified_credit_code,''),' ',''),'　','')) = ?
           AND f_id <> ?`,
        [
          llm.productIntroStored || null,
          llm.display || null,
          llm.tagsJson,
          String(llm.config.model_name || ''),
          IPP_AI_VERSION,
          row.data_app_id,
          creditNorm,
          fId,
        ]
      );
    }

    await markIppAiLogSuccess({
      logId,
      started,
      llmModelConfigId,
      promptConfigId,
      productIntroStored: llm.productIntroStored,
      tagsDisplay: llm.display,
      searchMeta: llm.searchMeta,
    });
    console.log(
      `[ippAiEnrich] success f_id=${fId} log_id=${logId} trigger=${triggerType} model=${llm.config.model_name}`
    );
  } catch (err) {
    await db.execute(
      `UPDATE ipo_project SET
         ai_enrich_status = 'failed',
         ai_enrich_error = ?
       WHERE f_id = ? AND F_DeleteMark = 0`,
      [String((err && err.message) || err).slice(0, 480), fId]
    );
    await markIppAiLogFailed({
      logId,
      started,
      llmModelConfigId,
      promptConfigId,
      err,
    });
    console.error('[ippAiEnrich] task failed', { fId, logId, err: (err && err.message) || String(err) });
  }
}

async function enqueueManualIpoProjectAiEnrich({ fId, triggeredByUserId, clientIp }) {
  const prep = await prepareIpoProjectAiJob({
    fId,
    triggerType: 'manual_api',
    triggeredByUserId,
    clientIp,
  });
  if (!prep.ok) {
    return { ok: false, code: prep.code, message: prep.message };
  }
  setImmediate(() => {
    runIpoProjectAiEnrichTask({
      fId: prep.fId,
      logId: prep.logId,
      triggerType: 'manual_api',
      triggeredByUserId,
      clientIp,
    }).catch((e) => console.error('[ippAiEnrich manual]', e));
  });
  return {
    ok: true,
    code: 202,
    data: {
      log_id: String(prep.logId),
      job_trace_id: prep.jobTraceId,
      ipo_project_f_id: prep.fId,
    },
  };
}

async function enqueueBatchIpoProjectAiEnrich({
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
  if (!psId) {
    return { ok: false, code: 400, message: '未找到「竞品分析」应用，无法筛选底层项目' };
  }
  const rows = await db.query(
    `SELECT f_id, company, unified_credit_code FROM ipo_project
     WHERE F_DeleteMark = 0 AND data_app_id = ?
       AND DATE(F_CreatorTime) >= ? AND DATE(F_CreatorTime) <= ?
       ${failedClause}
     ORDER BY F_CreatorTime DESC, f_id DESC`,
    [psId, df, dt]
  );
  const totalInRange = rows.length;
  if (!totalInRange) {
    return {
      ok: false,
      code: 400,
      message: onlyFailed
        ? '该创建日期范围内没有 AI 状态为 failed 的底层项目'
        : '该创建日期范围内没有可处理的底层项目',
    };
  }

  const seen = new Set();
  const representativeIds = [];
  for (const r of rows) {
    const credit = normalizeCreditDedupe(r.unified_credit_code);
    const k =
      credit.length >= 8 ? `cc:${credit}` : normalizeNameKey(r.company) || `id:${r.f_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    representativeIds.push(String(r.f_id));
  }

  const batchId = crypto.randomUUID();
  const queued = representativeIds.length;
  console.log(
    `[ippAiEnrich][batch=${batchId}] enqueue F_CreatorTime=${df}..${dt} rows=${totalInRange} dedup=${queued} only_failed=${!!onlyFailed}`
  );

  for (let i = 0; i < representativeIds.length; i += FINANCING_AI_CONCURRENCY_N) {
    const chunk = representativeIds.slice(i, i + FINANCING_AI_CONCURRENCY_N);
    await Promise.all(
      chunk.map(async (fid) => {
        const prep = await prepareIpoProjectAiJob({
          fId: fid,
          triggerType: onlyFailed ? 'batch_retry_failed' : 'batch_date_range',
          triggeredByUserId,
          clientIp,
        });
        if (!prep.ok) {
          console.warn(`[ippAiEnrich][batch] skip f_id=${fid}`, prep.message);
          return;
        }
        await runIpoProjectAiEnrichTask({
          fId: prep.fId,
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
  enqueueManualIpoProjectAiEnrich,
  enqueueBatchIpoProjectAiEnrich,
  IPP_AI_VERSION,
};
