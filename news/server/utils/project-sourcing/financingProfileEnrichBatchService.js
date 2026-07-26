'use strict';

const crypto = require('crypto');
const {
  submitLargeBatchFileFinancingAiEnrich,
  pollAndApplyLargeBatchFileFinancingAiEnrich,
  NO_BAIKE_ENRICH_TRIGGER,
} = require('../project-sourcing/financingAiEnrichService');
const {
  findFinancingProfileDonor,
  applyFinancingProfileDonor,
  buildFinancingProfileDonorIndex,
  lookupDonorFromIndex,
  hasIntro,
} = require('../project-sourcing/financingProfileDonor');
const { MIN_INTRO_LEN, STRUCTURED_MIN_INTRO } = require('../project-sourcing/financingProfileEnrichScope');
const { resolveStructuredLlmConfig } = require('../competitor-analysis/structuredProfileService');

const DEFAULT_BATCH_MODEL = 'qwen3.6-flash';

const DEFAULT_BATCH_SIZE = Math.max(
  1,
  Math.min(5000, parseInt(process.env.FINANCING_PROFILE_ENRICH_BATCH_SIZE || '200', 10) || 200)
);

const DEFAULT_IN_FLIGHT = Math.max(
  1,
  Math.min(4, parseInt(process.env.FINANCING_PROFILE_ENRICH_IN_FLIGHT || '2', 10) || 2)
);

function batchLog(phase, message, meta = null) {
  const head = `[noBaikeEnrichBatch][${phase}] ${message}`;
  if (meta && Object.keys(meta).length) console.log(head, meta);
  else console.log(head);
}

function emptyStats() {
  return {
    donor_cross: 0,
    donor_cross_rows: 0,
    donor_pool: 0,
    donor_pool_rows: 0,
    skip_prepare: 0,
    llm_ok: 0,
    llm_fail: 0,
    llm_empty: 0,
    llm_structured_ready: 0,
    missing_output: 0,
  };
}

function mergeStats(into, from) {
  for (const k of Object.keys(into)) {
    into[k] += Number(from[k] || 0);
  }
}

function strLen(v) {
  return String(v || '').trim().length;
}

/**
 * donor 过滤 + 收集待 Batch 的代表 event id
 */
async function prepareNoBaikeEnrichLlmIds(dbConn, candidates, opts = {}) {
  const representativeIds = [];
  const stats = emptyStats();

  batchLog('prepare_index', `candidates=${candidates.length}`);
  const donorIndex = await buildFinancingProfileDonorIndex(dbConn, candidates);

  for (let i = 0; i < candidates.length; i += 1) {
    const row = candidates[i];
    const eventId = row.representative_event_id;

    const crossDonor = lookupDonorFromIndex(donorIndex, row.company_credit_code, row.company_name);
    if (crossDonor && hasIntro(crossDonor.product_intro)) {
      if (!opts.dryRun) {
        const n = await applyFinancingProfileDonor(dbConn, row, crossDonor);
        stats.donor_cross_rows += n;
      }
      stats.donor_cross += 1;
      continue;
    }

    representativeIds.push(eventId);

    if ((i + 1) % 200 === 0) {
      batchLog('prepare_progress', `${i + 1}/${candidates.length}`, {
        queued_llm: representativeIds.length,
        donor_cross: stats.donor_cross,
        donor_pool: stats.donor_pool,
      });
    }
  }

  return { representativeIds, stats };
}

async function runOneNoBaikeEnrichBatch({
  batchSeq,
  runId,
  dbConn,
  representativeIds,
  totalLlm,
  offsetEnd,
  dryRun,
  llmConfig,
}) {
  const batchStats = emptyStats();
  if (!representativeIds.length) {
    return { batchStats, submitted: 0, dashscopeBatchId: null };
  }
  if (dryRun) {
    batchStats.llm_ok = representativeIds.length;
    return { batchStats, submitted: representativeIds.length, dashscopeBatchId: null };
  }

  const batchId = `${runId}-b${batchSeq}`;
  batchLog('submit_start', `batch_seq=${batchSeq} ids=${representativeIds.length} offset_end=${offsetEnd}/${totalLlm}`);

  const submitResult = await submitLargeBatchFileFinancingAiEnrich({
    batchId,
    representativeIds,
    triggeredByUserId: null,
    clientIp: null,
    df: 'no-baike',
    dt: 'no-baike',
    totalInRange: totalLlm,
    triggerType: NO_BAIKE_ENRICH_TRIGGER,
    llmConfigOverride: llmConfig,
  });

  if (!submitResult || submitResult.kind === 'noop') {
    batchLog('submit_noop', `batch_seq=${batchSeq}`);
    return { batchStats, submitted: 0, dashscopeBatchId: null };
  }

  const { dashscopeBatchId, llmJobs, config, promptConfigId, llmModelConfigId, promptMeta, baseUrl } =
    submitResult;

  batchLog('poll_start', `batch_seq=${batchSeq} dashscope_batch_id=${dashscopeBatchId} jobs=${llmJobs.length}`);

  await pollAndApplyLargeBatchFileFinancingAiEnrich({
    batchId,
    dashscopeBatchId,
    llmJobs,
    config,
    promptConfigId,
    llmModelConfigId,
    promptMeta,
    baseUrl,
    triggerType: NO_BAIKE_ENRICH_TRIGGER,
  });

  for (const job of llmJobs) {
    const rows = await dbConn.query(
      `SELECT ai_product_intro, ai_enrich_status, profile_source
       FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
      [job.financingEventId]
    );
    const after = rows[0];
    if (!after || String(after.ai_enrich_status) === 'failed') {
      batchStats.llm_fail += 1;
      continue;
    }
    const introLen = strLen(after.ai_product_intro);
    if (introLen < MIN_INTRO_LEN) {
      batchStats.llm_empty += 1;
    } else {
      batchStats.llm_ok += 1;
      if (introLen >= STRUCTURED_MIN_INTRO) batchStats.llm_structured_ready += 1;
    }
  }

  batchLog('batch_done', `batch_seq=${batchSeq}`, batchStats);
  return { batchStats, submitted: llmJobs.length, dashscopeBatchId };
}

/**
 * DashScope Batch File 流水线补齐无百科 enrich
 */
async function runNoBaikeEnrichDashScopeBatches(dbConn, candidates, opts = {}) {
  const batchSize = Math.max(1, opts.batchSize || DEFAULT_BATCH_SIZE);
  const inFlight = Math.max(1, opts.inFlight || DEFAULT_IN_FLIGHT);
  const modelName = opts.modelName || DEFAULT_BATCH_MODEL;
  const runId = crypto.randomUUID().slice(0, 8);

  const llmConfig = await resolveStructuredLlmConfig({ modelName });

  const { representativeIds, stats: prepStats } = await prepareNoBaikeEnrichLlmIds(dbConn, candidates, opts);
  const totals = { ...emptyStats(), ...prepStats, batches: 0, submitted: 0, run_id: runId, model: llmConfig.model_name };

  batchLog('run_start', `run_id=${runId} candidates=${candidates.length} llm_queue=${representativeIds.length}`, {
    batch_size: batchSize,
    in_flight: inFlight,
    model: llmConfig.model_name,
    dry_run: Boolean(opts.dryRun),
  });

  const chunks = [];
  for (let offset = 0; offset < representativeIds.length; offset += batchSize) {
    chunks.push({
      batchSeq: Math.floor(offset / batchSize) + 1,
      ids: representativeIds.slice(offset, offset + batchSize),
      offsetEnd: Math.min(offset + batchSize, representativeIds.length),
    });
  }

  if (!chunks.length) {
    batchLog('run_done', `run_id=${runId} nothing to batch`, totals);
    return totals;
  }

  let nextChunk = 0;
  async function pipelineWorker() {
    while (nextChunk < chunks.length) {
      const idx = nextChunk;
      nextChunk += 1;
      const { batchSeq, ids, offsetEnd } = chunks[idx];
      const result = await runOneNoBaikeEnrichBatch({
        batchSeq,
        runId,
        dbConn,
        representativeIds: ids,
        totalLlm: representativeIds.length,
        offsetEnd,
        dryRun: opts.dryRun,
        llmConfig,
      });
      totals.batches += 1;
      totals.submitted += result.submitted;
      mergeStats(totals, result.batchStats);
    }
  }

  await Promise.all(Array.from({ length: Math.min(inFlight, chunks.length) }, pipelineWorker));

  batchLog('run_done', `run_id=${runId}`, totals);
  return totals;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_IN_FLIGHT,
  DEFAULT_BATCH_MODEL,
  prepareNoBaikeEnrichLlmIds,
  runNoBaikeEnrichDashScopeBatches,
};
