const crypto = require('crypto');
const db = require('../../db');
const { isAdminUser } = require('./competitorAnalysisRouteAuth');
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

const PRE_INV_AI_VERSION = 'pre_investment_project_web_enrich_v1';

/** BP 内容注入到 AI 取数 prompt 时的最大字符数，防止超大 BP 超出模型上下文窗口 */
const BP_CONTEXT_MAX_CHARS = Math.max(
  2000,
  Math.min(80000, parseInt(process.env.FINANCING_AI_BP_CONTEXT_MAX_CHARS || '50000', 10) || 50000)
);

function formatPreInvAiEnrichTriggerType(shortType) {
  const s = String(shortType || 'manual_api').trim();
  if (s.startsWith('pre_investment_project:')) return s;
  return `pre_investment_project:${s}`;
}

async function markPreInvAiLogSuccess({
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
       F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [
      duration,
      llmModelConfigId != null ? String(llmModelConfigId) : null,
      PROMPT_TYPE,
      promptConfigId != null ? String(promptConfigId) : null,
      PRE_INV_AI_VERSION,
      productIntroStored || null,
      tagsDisplay || null,
      ...sm,
      logId,
    ]
  );
}

async function markPreInvAiLogFailed({ logId, started, llmModelConfigId, promptConfigId, err }) {
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
         F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [
        duration,
        llmModelConfigId != null ? String(llmModelConfigId) : null,
        PROMPT_TYPE,
        promptConfigId != null ? String(promptConfigId) : null,
        PRE_INV_AI_VERSION,
        short,
        logId,
      ]
    );
  } catch (e2) {
    console.error('[preInvAiEnrich] log failed update', e2);
  }
}

/**
 * @returns {Promise<{ok:true, logId:number, jobTraceId:string, preProjectId:string}|{ok:false, code:number, message:string}>}
 */
async function preparePreInvestmentProjectAiJob({
  preProjectId,
  triggerType,
  triggeredByUserId,
  clientIp,
  psUser,
}) {
  const id = String(preProjectId || '').trim();
  if (!id) {
    return { ok: false, code: 400, message: '无效的项目 id' };
  }

  const rows = await db.query(
    `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation, F_CreatorUserId, F_DeleteMark
     FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].F_DeleteMark) !== 0) {
    return { ok: false, code: 404, message: '投前项目不存在或已删除' };
  }
  const uid = psUser && psUser.id ? String(psUser.id) : '';
  if (!isAdminUser(psUser) && String(rows[0].F_CreatorUserId || '') !== uid) {
    return { ok: false, code: 403, message: '仅创建人或管理员可发起 AI 取数' };
  }

  const dup = await db.query(
    `SELECT F_Id, triggered_at FROM invested_enterprise_ai_enrich_log
     WHERE pre_investment_project_id = ? AND execution_status IN ('pending','running')
     ORDER BY F_Id DESC LIMIT 1`,
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
  const name = rows[0].enterprise_full_name != null ? String(rows[0].enterprise_full_name) : null;
  const ins = await db.execute(
    `INSERT INTO invested_enterprise_ai_enrich_log
     (invested_enterprise_id, ipo_project_f_id, pre_investment_project_id, enterprise_full_name, trigger_type, triggered_by_user_id, client_ip, job_trace_id, execution_status, prompt_type, ai_enrich_version)
     VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      name,
      formatPreInvAiEnrichTriggerType(triggerType),
      triggeredByUserId || null,
      clientIp || null,
      jobTraceId,
      PROMPT_TYPE,
      PRE_INV_AI_VERSION,
    ]
  );
  const logId = ins.insertId;

  await db.execute(
    `UPDATE pre_investment_project SET ai_enrich_status = 'running', ai_enrich_error = NULL, pipeline_error = NULL, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [id]
  );

  return { ok: true, logId, jobTraceId, preProjectId: id };
}

async function runPreInvestmentProjectAiEnrichTask({
  preProjectId,
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
       SET execution_status = 'running', started_at = NOW(), F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [logId]
    );

    const ev = await db.query(
      `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation,
              qcc_company_intro, bp_extract_text, F_DeleteMark
       FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
      [preProjectId]
    );
    if (!ev.length || Number(ev[0].F_DeleteMark) !== 0) {
      throw new Error('投前项目不存在或已删除');
    }
    const row = ev[0];

    const rowForTemplate = buildFinancingAiTemplateRow(row);
    if (!rowForTemplate.company_name) {
      throw new Error('企业全称为空，无法调用模型');
    }

    // 如果有 BP 提取文本，作为额外上下文传入 LLM（不受 QCC 截断限制）
    let bpExtraContext = row.bp_extract_text ? String(row.bp_extract_text).trim() : null;
    if (bpExtraContext && bpExtraContext.length > BP_CONTEXT_MAX_CHARS) {
      bpExtraContext = bpExtraContext.slice(0, BP_CONTEXT_MAX_CHARS) + '\n\n…（BP 内容过长已截断）';
    }

    const llm = await withFinancingAiConcurrency(() => runFinancingStyleWebEnrichLlmCall(rowForTemplate, bpExtraContext));
    llmModelConfigId = llm.llmModelConfigId;
    promptConfigId = llm.promptConfigId;

    const introLen = String(llm.productIntroStored || '').trim().length;
    let tagCount = 0;
    try {
      const tags = typeof llm.tagsJson === 'string' ? JSON.parse(llm.tagsJson) : llm.tagsJson;
      tagCount = Array.isArray(tags) ? tags.filter(Boolean).length : 0;
    } catch {
      tagCount = String(llm.display || '')
        .split(/[,，、]/)
        .map((x) => x.trim())
        .filter(Boolean).length;
    }
    if (introLen === 0 && tagCount === 0) {
      throw new Error(
        '模型未返回有效产品介绍或企业标签（可能联网检索无结果或 JSON 字段为空），请核对企业全称后重试或更换模型'
      );
    }

    await db.execute(
      `UPDATE pre_investment_project SET
         ai_product_intro = ?,
         ai_industry_tags_display = ?,
         ai_industry_tags_json = ?,
         ai_enrich_status = 'success',
         ai_enrich_at = NOW(),
         ai_enrich_model = ?,
         ai_enrich_version = ?,
         ai_enrich_error = NULL,
         pipeline_status = 'ai_done',
         pipeline_error = NULL,
         F_LastModifyTime = NOW()
       WHERE F_Id = ? AND F_DeleteMark = 0`,
      [
        llm.productIntroStored || null,
        llm.display || null,
        llm.tagsJson,
        String(llm.config.model_name || ''),
        PRE_INV_AI_VERSION,
        preProjectId,
      ]
    );

    await markPreInvAiLogSuccess({
      logId,
      started,
      llmModelConfigId,
      promptConfigId,
      productIntroStored: llm.productIntroStored,
      tagsDisplay: llm.display,
      searchMeta: llm.searchMeta,
    });
    console.log(
      `[preInvAiEnrich] success pre_project_id=${preProjectId} log_id=${logId} trigger=${triggerType} model=${llm.config.model_name}`
    );
  } catch (err) {
    const errMsg = String((err && err.message) || err).slice(0, 480);
    await db.execute(
      `UPDATE pre_investment_project SET
         ai_enrich_status = 'failed',
         ai_enrich_error = ?,
         pipeline_status = 'failed',
         pipeline_error = ?,
         F_LastModifyTime = NOW()
       WHERE F_Id = ? AND F_DeleteMark = 0`,
      [errMsg, errMsg, preProjectId]
    );
    await markPreInvAiLogFailed({
      logId,
      started,
      llmModelConfigId,
      promptConfigId,
      err,
    });
    console.error('[preInvAiEnrich] task failed', { preProjectId, logId, err: (err && err.message) || String(err) });
  }
}

async function enqueueManualPreInvestmentProjectAiEnrich({
  preProjectId,
  triggeredByUserId,
  clientIp,
  psUser,
}) {
  const prep = await preparePreInvestmentProjectAiJob({
    preProjectId,
    triggerType: 'manual_api',
    triggeredByUserId,
    clientIp,
    psUser,
  });
  if (!prep.ok) {
    return { ok: false, code: prep.code, message: prep.message };
  }
  setImmediate(() => {
    runPreInvestmentProjectAiEnrichTask({
      preProjectId: prep.preProjectId,
      logId: prep.logId,
      triggerType: 'manual_api',
      triggeredByUserId,
      clientIp,
    }).catch((e) => console.error('[preInvAiEnrich manual]', e));
  });
  return {
    ok: true,
    code: 202,
    data: {
      log_id: String(prep.logId),
      job_trace_id: prep.jobTraceId,
      pre_investment_project_id: prep.preProjectId,
    },
  };
}

module.exports = {
  enqueueManualPreInvestmentProjectAiEnrich,
  PRE_INV_AI_VERSION,
};
