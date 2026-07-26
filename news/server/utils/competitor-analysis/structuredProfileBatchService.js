'use strict';

const crypto = require('crypto');
const {
  uploadDashScopeBatchJsonl,
  createDashScopeChatBatch,
  pollDashScopeBatchUntilDone,
  downloadDashScopeFileContent,
  parseDashScopeBatchOutputLines,
  extractChatCompletionContent,
  structuredChatParamsFromConfig,
  structuredBatchBodyExtrasForModel,
  buildChatCompletionsBatchJsonl,
  compatibleModeV1BaseUrl,
} = require('../llm/dashScopeBatchFile');
const { isDashScopeCompatibleModeEndpoint } = require('../dashScopeOpenAICompat');
const { companyDedupeKey } = require('../project-sourcing/listedFinancingJoin');
const {
  classifyStructuredExtract,
  buildStructuredPromptMessages,
  resolveStructuredLlmConfig,
  loadFinancingRepresentativeRowsMap,
  applyStructuredBatchParallel,
  APPLY_CONCURRENCY_DEFAULT,
} = require('./structuredProfileService');

const DEFAULT_BATCH_SIZE = Math.max(
  1,
  Math.min(5000, parseInt(process.env.STRUCTURED_BATCH_FILE_SIZE || '100', 10) || 100)
);

const DEFAULT_IN_FLIGHT = Math.max(
  1,
  Math.min(8, parseInt(process.env.STRUCTURED_BATCH_IN_FLIGHT || '2', 10) || 2)
);

function structuredBatchLog(phase, message, meta = null) {
  const head = `[structuredBatch][${phase}] ${message}`;
  if (meta && Object.keys(meta).length) console.log(head, meta);
  else console.log(head);
}

function assertDashScopeBatchConfig(config) {
  if (!isDashScopeCompatibleModeEndpoint(config.api_endpoint)) {
    throw new Error(
      `模型 ${config.model_name} 的 api_endpoint 非 DashScope compatible-mode，无法走 Batch File API`
    );
  }
}

function emptyBatchStats() {
  return {
    ok: 0,
    fail_llm: 0,
    fail_parse: 0,
    fail_parse_json: 0,
    fail_parse_empty: 0,
    fanout_rows: 0,
    missing: 0,
  };
}

function mergeBatchStats(into, from) {
  into.ok += from.ok;
  into.fail_llm += from.fail_llm;
  into.fail_parse += from.fail_parse;
  into.fail_parse_json += from.fail_parse_json;
  into.fail_parse_empty += from.fail_parse_empty;
  into.fanout_rows += from.fanout_rows;
  into.missing += from.missing;
}

/**
 * @param {object[]} companies
 * @param {import('mysql2/promise').Pool} dbConn
 */
async function prepareStructuredBatchJobs(dbConn, companies) {
  const repMap = await loadFinancingRepresentativeRowsMap(dbConn, companies);
  const jobs = [];
  let skipNoRep = 0;
  let skipNoContext = 0;

  for (let i = 0; i < companies.length; i += 1) {
    const company = companies[i];
    const rep = repMap.get(companyDedupeKey(company));
    if (!rep) {
      skipNoRep += 1;
      continue;
    }
    const prompts = buildStructuredPromptMessages(company, rep);
    if (!prompts) {
      skipNoContext += 1;
      continue;
    }
    jobs.push({
      customId: `s${i + 1}`,
      company,
      rep,
      systemContent: prompts.systemContent,
      userContent: prompts.userContent,
    });
  }

  return { jobs, skipNoRep, skipNoContext };
}

async function submitStructuredDashScopeBatch({ batchSeq, config, jobs }) {
  assertDashScopeBatchConfig(config);
  const baseUrl = compatibleModeV1BaseUrl(config.api_endpoint);
  const chatParams = structuredChatParamsFromConfig(config);
  const batchExtras = structuredBatchBodyExtrasForModel(config.model_name);
  const jsonl = buildChatCompletionsBatchJsonl(
    jobs.map((j) => ({
      customId: j.customId,
      systemContent: j.systemContent,
      userContent: j.userContent,
    })),
    config.model_name,
    chatParams,
    batchExtras
  );

  structuredBatchLog('submit', `batch_seq=${batchSeq} upload_jsonl requests=${jobs.length}`, {
    bytes: Buffer.byteLength(jsonl, 'utf8'),
    model: config.model_name,
    enable_thinking: batchExtras.enable_thinking === false ? false : undefined,
    response_format: batchExtras.response_format?.type || null,
    temperature: chatParams.temperature,
  });

  const inputFileId = await uploadDashScopeBatchJsonl(
    baseUrl,
    config.api_key,
    jsonl,
    `structured-batch-${batchSeq}.jsonl`
  );
  const dashscopeBatchId = await createDashScopeChatBatch(baseUrl, config.api_key, inputFileId);

  structuredBatchLog('submit_done', `batch_seq=${batchSeq} dashscope_batch_id=${dashscopeBatchId}`, {
    input_file_id: inputFileId,
  });

  return { baseUrl, dashscopeBatchId, inputFileId };
}

async function pollAndApplyStructuredDashScopeBatch({
  batchSeq,
  dbConn,
  config,
  baseUrl,
  dashscopeBatchId,
  jobs,
  applyConcurrency,
}) {
  const pollMs = Math.max(
    3000,
    Math.min(120000, parseInt(process.env.STRUCTURED_BATCH_POLL_MS || '3000', 10) || 3000)
  );
  const pollMaxMs = Math.max(
    pollMs * 2,
    parseInt(process.env.STRUCTURED_BATCH_POLL_MAX_MS || String(24 * 3600 * 1000), 10) ||
      24 * 3600 * 1000
  );

  structuredBatchLog('poll_start', `batch_seq=${batchSeq} dashscope_batch_id=${dashscopeBatchId}`, {
    jobs: jobs.length,
    poll_ms: pollMs,
  });

  const { outputFileId, pollRound, waited } = await pollDashScopeBatchUntilDone({
    baseUrl,
    apiKey: config.api_key,
    batchId: dashscopeBatchId,
    pollMs,
    pollMaxMs,
    onPoll: ({ pollRound: round, waited: w, status, requestCounts }) => {
      if (round <= 3 || round % 6 === 0 || status === 'completed' || status === 'complete') {
        structuredBatchLog('poll_status', `batch_seq=${batchSeq} round=${round} elapsed_ms=${w}`, {
          remote_status: status || 'unknown',
          request_counts: requestCounts,
        });
      }
      const completed = Number(requestCounts?.completed || 0);
      const total = Number(requestCounts?.total || 0);
      if (w >= 2 * 3600 * 1000 && total > 0 && completed === 0) {
        structuredBatchLog(
          'poll_stall_warn',
          `batch_seq=${batchSeq} ${w}ms elapsed but request_counts still 0/${total} — check model name or cancel stale batch`
        );
      }
    },
  });

  const outText = await downloadDashScopeFileContent(baseUrl, config.api_key, outputFileId);
  const lines = parseDashScopeBatchOutputLines(outText);
  const jobById = new Map(jobs.map((j) => [j.customId, j]));

  const stats = emptyBatchStats();
  const applyItems = [];
  const failLogs = [];

  for (const obj of lines) {
    const customId = obj.custom_id != null ? String(obj.custom_id) : '';
    const job = jobById.get(customId);
    if (!job) continue;
    jobById.delete(customId);

    const parsed = extractChatCompletionContent(obj);
    if (!parsed.ok) {
      stats.fail_llm += 1;
      failLogs.push({ name: job.company.company_name, reason: parsed.error });
      continue;
    }

    const classified = classifyStructuredExtract(
      parsed.content,
      job.company.industry_category_4,
      job.company.sub_track
    );
    if (!classified.ok) {
      stats.fail_parse += 1;
      if (classified.reason === 'json_parse_fail') stats.fail_parse_json += 1;
      else stats.fail_parse_empty += 1;
      failLogs.push({ name: job.company.company_name, reason: classified.reason });
      continue;
    }

    applyItems.push({ company: job.company, profile: classified.profile });
  }

  if (applyItems.length) {
    stats.fanout_rows = await applyStructuredBatchParallel(dbConn, applyItems, {
      concurrency: applyConcurrency,
    });
    stats.ok = applyItems.length;
  }

  for (const f of failLogs) {
    structuredBatchLog('apply_fail', `${f.name}: ${f.reason}`);
  }

  for (const job of jobById.values()) {
    stats.missing += 1;
    structuredBatchLog('apply_missing', `${job.company.company_name} custom_id=${job.customId}`);
  }

  structuredBatchLog('poll_apply_done', `batch_seq=${batchSeq} dashscope_batch_id=${dashscopeBatchId}`, {
    ...stats,
    output_lines: lines.length,
    poll_rounds: pollRound,
    elapsed_ms: waited,
    apply_concurrency: applyConcurrency,
  });

  return stats;
}

async function runOneStructuredBatch({
  batchSeq,
  dbConn,
  config,
  chunk,
  offsetEnd,
  totalCompanies,
  opts,
}) {
  const { jobs, skipNoRep, skipNoContext } = await prepareStructuredBatchJobs(dbConn, chunk);
  const batchStats = emptyBatchStats();

  if (!jobs.length) {
    structuredBatchLog('batch_skip', `batch_seq=${batchSeq} no_llm_jobs`, {
      chunk: chunk.length,
      skip_no_rep: skipNoRep,
      skip_no_context: skipNoContext,
    });
    return { batchStats, skipNoRep, skipNoContext, submitted: 0, batches: 0 };
  }

  if (opts.dryRun) {
    structuredBatchLog('dry_run', `batch_seq=${batchSeq} would_submit=${jobs.length}`);
    batchStats.ok = jobs.length;
    return { batchStats, skipNoRep, skipNoContext, submitted: jobs.length, batches: 1 };
  }

  const { baseUrl, dashscopeBatchId } = await submitStructuredDashScopeBatch({
    batchSeq,
    config,
    jobs,
  });
  mergeBatchStats(
    batchStats,
    await pollAndApplyStructuredDashScopeBatch({
      batchSeq,
      dbConn,
      config,
      baseUrl,
      dashscopeBatchId,
      jobs,
      applyConcurrency: opts.applyConcurrency,
    })
  );

  structuredBatchLog('batch_done', `batch_seq=${batchSeq} offset=${offsetEnd}/${totalCompanies}`, {
    ok: batchStats.ok,
    fail_llm: batchStats.fail_llm,
    fail_parse: batchStats.fail_parse,
    fail_parse_json: batchStats.fail_parse_json,
    fail_parse_empty: batchStats.fail_parse_empty,
  });

  return { batchStats, skipNoRep, skipNoContext, submitted: jobs.length, batches: 1 };
}

/**
 * 分批次提交百炼 Batch File；支持 in-flight 流水线并行。
 */
async function runStructuredDashScopeBatches(dbConn, companies, opts = {}) {
  const batchSize = Math.max(1, opts.batchSize || DEFAULT_BATCH_SIZE);
  const inFlight = Math.max(1, opts.inFlight || DEFAULT_IN_FLIGHT);
  const modelName = opts.modelName;
  if (!modelName) throw new Error('runStructuredDashScopeBatches 需要 modelName');

  const config = await resolveStructuredLlmConfig({ modelName });
  const runId = crypto.randomUUID().slice(0, 8);
  const totals = {
    companies: companies.length,
    batches: 0,
    submitted: 0,
    ok: 0,
    skip_no_rep: 0,
    skip_no_context: 0,
    fail_llm: 0,
    fail_parse: 0,
    fail_parse_json: 0,
    fail_parse_empty: 0,
    missing: 0,
    fanout_rows: 0,
  };

  const chunks = [];
  for (let offset = 0; offset < companies.length; offset += batchSize) {
    chunks.push({
      batchSeq: Math.floor(offset / batchSize) + 1,
      chunk: companies.slice(offset, offset + batchSize),
      offsetEnd: Math.min(offset + batchSize, companies.length),
    });
  }

  structuredBatchLog('run_start', `run_id=${runId} model=${config.model_name} companies=${companies.length}`, {
    batch_size: batchSize,
    in_flight: inFlight,
    apply_concurrency: opts.applyConcurrency || APPLY_CONCURRENCY_DEFAULT,
  });

  let nextChunk = 0;
  async function pipelineWorker() {
    while (nextChunk < chunks.length) {
      const idx = nextChunk;
      nextChunk += 1;
      const { batchSeq, chunk, offsetEnd } = chunks[idx];
      const result = await runOneStructuredBatch({
        batchSeq,
        dbConn,
        config,
        chunk,
        offsetEnd,
        totalCompanies: companies.length,
        opts,
      });
      totals.skip_no_rep += result.skipNoRep;
      totals.skip_no_context += result.skipNoContext;
      totals.batches += result.batches;
      totals.submitted += result.submitted;
      mergeBatchStats(totals, result.batchStats);

      if (!opts.dryRun && idx < chunks.length - 1) {
        const cooldownMs = Math.max(
          0,
          parseInt(process.env.STRUCTURED_BATCH_SUBMIT_COOLDOWN_MS || '15000', 10) || 15000
        );
        if (cooldownMs > 0) {
          await new Promise((r) => setTimeout(r, cooldownMs));
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(inFlight, chunks.length) }, pipelineWorker));

  structuredBatchLog('run_done', `run_id=${runId}`, totals);
  return { runId, config, totals };
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_IN_FLIGHT,
  runStructuredDashScopeBatches,
  prepareStructuredBatchJobs,
  submitStructuredDashScopeBatch,
  pollAndApplyStructuredDashScopeBatch,
};
