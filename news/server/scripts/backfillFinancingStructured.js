/**

 * Stage 3：融资池优先行业批 structured 抽取

 *

 * 用法（news 目录）：

 *   npm run backfill:financing-structured

 *   npm run backfill:financing-structured -- --dry-run --limit=20

 *   npm run backfill:financing-structured -- --category=ai,bio,semi_mfg --since=2025-01-01

 *   npm run backfill:financing-structured -- --mode=dashscope_batch --model=qwen3.6-flash --batch-size=100

 */



const fs = require('fs');

const path = require('path');

const db = require('../db');

const { parseCategoryList, loadPriorityFinancingCompanies } = require('../utils/competitor-analysis/priorityBatchScope');

const {

  extractStructuredProfile,

  loadFinancingRepresentativeRow,

  applyStructuredToFinancingFanOut,

  STRUCTURED_SCHEMA_VERSION,

} = require('../utils/competitor-analysis/structuredProfileService');

const {

  runStructuredDashScopeBatches,

  DEFAULT_BATCH_SIZE,

  DEFAULT_IN_FLIGHT,

} = require('../utils/competitor-analysis/structuredProfileBatchService');

const {

  APPLY_CONCURRENCY_DEFAULT,

} = require('../utils/competitor-analysis/structuredProfileService');

const {

  buildFinancingEventSinceClause,

  parseSinceArg,

} = require('../utils/project-sourcing/financingEventWindow');



const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage3融资Structured报告.md');

const DEFAULT_BATCH_MODEL = 'qwen3.6-flash';



function parseArgs() {

  const sinceParsed = parseSinceArg(process.argv.slice(2));

  const out = {

    dryRun: false,

    force: false,

    sinceDate: sinceParsed.sinceDate,

    years: sinceParsed.years,

    limit: Infinity,

    categories: null,

    sleepMs: 800,

    mode: 'dashscope_batch',

    modelName: DEFAULT_BATCH_MODEL,

    batchSize: DEFAULT_BATCH_SIZE,

    inFlight: DEFAULT_IN_FLIGHT,

    applyConcurrency: APPLY_CONCURRENCY_DEFAULT,

    outFile: DEFAULT_REPORT,

  };

  for (const a of process.argv.slice(2)) {

    if (a === '--dry-run') out.dryRun = true;

    else if (a === '--force') out.force = true;

    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);

    else if (a.startsWith('--category=')) out.categories = a.slice(11);

    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || 800);

    else if (a.startsWith('--mode=')) out.mode = String(a.slice(7)).trim().toLowerCase() || 'dashscope_batch';

    else if (a.startsWith('--model=')) out.modelName = String(a.slice(8)).trim() || DEFAULT_BATCH_MODEL;

    else if (a.startsWith('--batch-size=')) {

      out.batchSize = Math.max(1, parseInt(a.slice(13), 10) || DEFAULT_BATCH_SIZE);

    } else if (a.startsWith('--in-flight=')) {

      out.inFlight = Math.max(1, parseInt(a.slice(12), 10) || DEFAULT_IN_FLIGHT);

    } else if (a.startsWith('--apply-concurrency=')) {

      out.applyConcurrency = Math.max(1, parseInt(a.slice(20), 10) || APPLY_CONCURRENCY_DEFAULT);

    } else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));

  }

  if (!Number.isFinite(out.limit)) out.limit = Infinity;

  return out;

}



function sleep(ms) {

  return new Promise((r) => setTimeout(r, ms));

}



async function runRealtimeBatch(opts, companies, work) {

  const stats = {

    candidates: companies.length,

    work: work.length,

    ok: 0,

    skip_no_intro: companies.length - companies.filter((c) => c.has_intro).length,

    fail_context: 0,

    fail_llm: 0,

    fanout_rows: 0,

    mode: 'realtime',

    model: null,

  };



  for (let i = 0; i < work.length; i += 1) {

    const company = work[i];

    const rep = await loadFinancingRepresentativeRow(db, company);

    if (!rep) {

      stats.fail_context += 1;

      continue;

    }



    if (opts.dryRun) {

      stats.ok += 1;

      continue;

    }



    try {

      const llmOpts = opts.modelName ? { modelName: opts.modelName } : {};

      const result = await extractStructuredProfile(company, rep, llmOpts);

      if (!result.ok) {

        if (result.reason === 'insufficient_context') stats.fail_context += 1;

        else stats.fail_llm += 1;

        continue;

      }

      stats.model = result.model || stats.model;

      const n = await applyStructuredToFinancingFanOut(db, company, result.profile);

      stats.ok += 1;

      stats.fanout_rows += n;

    } catch (e) {

      stats.fail_llm += 1;

      console.warn('[backfillFinancingStructured] 失败', company.company_name, e.message);

    }



    if ((i + 1) % 10 === 0) {

      console.log(`[backfillFinancingStructured] 进度 ${i + 1}/${work.length}`);

    }

    if (opts.sleepMs > 0 && i + 1 < work.length) await sleep(opts.sleepMs);

  }



  return stats;

}



async function runDashScopeBatchMode(opts, companies, work) {

  const { runId, config, totals } = await runStructuredDashScopeBatches(db, work, {

    modelName: opts.modelName,

    batchSize: opts.batchSize,

    inFlight: opts.inFlight,

    applyConcurrency: opts.applyConcurrency,

    dryRun: opts.dryRun,

  });



  return {

    candidates: companies.length,

    work: work.length,

    ok: totals.ok,

    skip_no_intro: companies.length - companies.filter((c) => c.has_intro).length,

    skip_no_rep: totals.skip_no_rep,

    skip_no_context: totals.skip_no_context,

    fail_context: totals.skip_no_context + totals.skip_no_rep,

    fail_llm: totals.fail_llm,

    fail_parse: totals.fail_parse,

    missing: totals.missing,

    batches: totals.batches,

    submitted: totals.submitted,

    fanout_rows: totals.fanout_rows,

    mode: 'dashscope_batch',

    model: config.model_name,

    run_id: runId,

  };

}



async function main() {

  const opts = parseArgs();

  const categories = parseCategoryList(opts.categories);

  const windowOpts = { sinceDate: opts.sinceDate, years: opts.years };

  const windowLabel = buildFinancingEventSinceClause(windowOpts).label;

  console.log('[backfillFinancingStructured] 开始', {

    window: windowLabel,

    categories,

    mode: opts.mode,

    model: opts.modelName,

    batchSize: opts.batchSize,

    inFlight: opts.inFlight,

    applyConcurrency: opts.applyConcurrency,

    dryRun: opts.dryRun,

    limit: opts.limit,

  });



  const companies = await loadPriorityFinancingCompanies(db, {

    ...windowOpts,

    categories,

    skipStructured: !opts.force,

  });

  const work = companies.filter((c) => c.has_intro).slice(0, opts.limit);

  console.log('[backfillFinancingStructured] 待处理', companies.length, '有简介本次', work.length);



  if (!work.length) {

    console.log('[backfillFinancingStructured] 无待处理企业，退出');

    await db.closePool();

    return;

  }



  const stats =

    opts.mode === 'realtime'

      ? await runRealtimeBatch(opts, companies, work)

      : await runDashScopeBatchMode(opts, companies, work);



  const report = `# Stage 3 融资池 Structured 报告



> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  

> 版本：\`${STRUCTURED_SCHEMA_VERSION}\`  

> 三大类：${categories.join(', ')} | ${windowLabel} | 模式：${stats.mode} | 模型：${stats.model || opts.modelName} | dry-run：${opts.dryRun}



| 指标 | 值 |

|------|-----|

| 候选企业 | ${stats.candidates} |

| 本次处理（有简介） | ${stats.work} |

| 成功 | ${stats.ok} |

| 无简介跳过 | ${stats.skip_no_intro} |

| Batch 批次数 | ${stats.batches ?? '—'} |

| Batch 提交条数 | ${stats.submitted ?? '—'} |

| 无代表行/上下文不足 | ${stats.fail_context} |

| LLM 失败 | ${stats.fail_llm} |

| JSON 解析失败 | ${stats.fail_parse ?? 0} |

| 输出缺失 | ${stats.missing ?? 0} |

| fan-out 行数 | ${stats.fanout_rows} |

`;



  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });

  fs.writeFileSync(opts.outFile, report, 'utf8');

  console.log('[backfillFinancingStructured] 完成', stats);

  console.log('[backfillFinancingStructured] 报告:', opts.outFile);

  await db.closePool();

}



main().catch(async (e) => {

  console.error('[backfillFinancingStructured] 失败:', e);

  try {

    await db.closePool();

  } catch (_) {}

  process.exit(1);

});


