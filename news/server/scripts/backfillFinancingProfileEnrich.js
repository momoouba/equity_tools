/**
 * Stage 2b §6.6：无百科词条融资企业画像 enrich（donor → 联网 LLM / DashScope Batch）
 *
 * 用法（news 目录）：
 *   npm run backfill:financing-profile-enrich -- --dry-run --since=2025-01-01
 *   npm run backfill:financing-profile-enrich -- --with-llm --mode=dashscope_batch --model=qwen3.6-flash --since=2025-01-01
 *   npm run backfill:financing-profile-enrich -- --with-llm --mode=chat --per-category=30
 *   npm run backfill:financing-profile-enrich -- --with-llm --mode=dashscope_batch --batch-size=200 --in-flight=2 --limit=500
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  loadNoBaikeFinancingCandidates,
  sampleByCategory,
  STRUCTURED_MIN_INTRO,
  MIN_INTRO_LEN,
} = require('../utils/project-sourcing/financingProfileEnrichScope');
const {
  findFinancingProfileDonor,
  applyFinancingProfileDonor,
  hasIntro,
} = require('../utils/project-sourcing/financingProfileDonor');
const {
  prepareFinancingAiEnrichJob,
  runFinancingAiEnrichTask,
  withFinancingAiConcurrency,
  findFinancingAiDonorRow,
  applyFinancingAiReuseFromDonor,
  NO_BAIKE_ENRICH_TRIGGER,
  AI_ENRICH_VERSION,
} = require('../utils/project-sourcing/financingAiEnrichService');
const {
  runNoBaikeEnrichDashScopeBatches,
  DEFAULT_BATCH_SIZE,
  DEFAULT_IN_FLIGHT,
  DEFAULT_BATCH_MODEL,
} = require('../utils/project-sourcing/financingProfileEnrichBatchService');
const { parseSinceArg, buildFinancingEventSinceClause } = require('../utils/project-sourcing/financingEventWindow');

const DEFAULT_REPORT = path.resolve(
  __dirname,
  '../../../需求文档/竞品分析/Stage2b融资无百科Enrich报告.md'
);
const DEFAULT_LOG = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2b融资无百科Enrich运行.log');

function parseArgs() {
  const sinceParsed = parseSinceArg(process.argv.slice(2));
  const out = {
    dryRun: false,
    withLlm: false,
    mode: 'dashscope_batch',
    sinceDate: sinceParsed.sinceDate,
    years: sinceParsed.years,
    categories: null,
    limit: Infinity,
    perCategory: 0,
    sleepMs: 1200,
    batchSize: DEFAULT_BATCH_SIZE,
    inFlight: DEFAULT_IN_FLIGHT,
    modelName: DEFAULT_BATCH_MODEL,
    outFile: DEFAULT_REPORT,
    logFile: DEFAULT_LOG,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--with-llm') out.withLlm = true;
    else if (a.startsWith('--mode=')) out.mode = String(a.slice(7)).trim().toLowerCase() || 'dashscope_batch';
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--per-category=')) {
      out.perCategory = Math.max(0, parseInt(a.slice(15), 10) || 0);
    } else if (a.startsWith('--category=')) out.categories = a.slice(11);
    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || 1200);
    else if (a.startsWith('--batch-size=')) {
      out.batchSize = Math.max(1, parseInt(a.slice(13), 10) || DEFAULT_BATCH_SIZE);
    }     else if (a.startsWith('--in-flight=')) {
      out.inFlight = Math.max(1, parseInt(a.slice(12), 10) || DEFAULT_IN_FLIGHT);
    } else if (a.startsWith('--model=')) out.modelName = String(a.slice(8)).trim() || DEFAULT_BATCH_MODEL; else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
    else if (a.startsWith('--log=')) out.logFile = path.resolve(a.slice(6));
  }
  if (!Number.isFinite(out.limit)) out.limit = Infinity;
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pct(n, d) {
  if (!d) return '0.0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function appendLog(logFile, line) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch (e) {
    if (e && e.code !== 'EBUSY') {
      console.warn('[backfillFinancingProfileEnrich] log append failed', e.message);
    }
  }
}

async function readIntroAfterEnrich(eventId) {
  const rows = await db.query(
    `SELECT ai_product_intro, ai_company_tags_display, profile_source, ai_enrich_status
     FROM sourcing_financing_event WHERE F_Id = ? LIMIT 1`,
    [eventId]
  );
  return rows[0] || null;
}

function selectWork(allCandidates, opts) {
  let work = allCandidates;
  if (opts.perCategory > 0) {
    work = sampleByCategory(work, opts.perCategory, opts.limit);
  } else if (Number.isFinite(opts.limit) && opts.limit > 0) {
    work = work.slice(0, opts.limit);
  }
  return work;
}

async function runChatMode(work, opts, stats, samples) {
  for (let i = 0; i < work.length; i += 1) {
    const row = work[i];
    const eventId = row.representative_event_id;

    const crossDonor = await findFinancingProfileDonor(db, row.company_credit_code, row.company_name);
    if (crossDonor && hasIntro(crossDonor.product_intro)) {
      if (!opts.dryRun) {
        const n = await applyFinancingProfileDonor(db, row, crossDonor);
        stats.donor_cross_rows += n;
      }
      stats.donor_cross += 1;
      continue;
    }

    const poolDonor = await findFinancingAiDonorRow({
      credit: row.company_credit_code,
      name: row.company_name,
      excludeId: eventId,
    });
    if (poolDonor) {
      if (!opts.dryRun) {
        await applyFinancingAiReuseFromDonor(poolDonor, row, eventId);
        stats.donor_pool_rows += 1;
      }
      stats.donor_pool += 1;
      continue;
    }

    if (!opts.withLlm || opts.dryRun) {
      stats.skipped_dry += 1;
      continue;
    }

    const prep = await prepareFinancingAiEnrichJob({
      eventId,
      triggerType: NO_BAIKE_ENRICH_TRIGGER,
      triggeredByUserId: null,
      clientIp: null,
    });
    if (!prep.ok) {
      stats.llm_fail += 1;
      appendLog(opts.logFile, `prepare_fail event=${eventId} ${prep.message}`);
      continue;
    }

    try {
      await withFinancingAiConcurrency(() =>
        runFinancingAiEnrichTask({
          financingEventId: prep.idNum,
          logId: prep.logId,
          triggerType: NO_BAIKE_ENRICH_TRIGGER,
          triggeredByUserId: null,
          clientIp: null,
        })
      );
      const after = await readIntroAfterEnrich(eventId);
      const introLen = strLen(after?.ai_product_intro);
      const src = String(after?.profile_source || '');
      if (introLen < MIN_INTRO_LEN) stats.llm_empty += 1;
      else {
        stats.llm_ok += 1;
        if (introLen >= STRUCTURED_MIN_INTRO) stats.llm_structured_ready += 1;
      }
      if (samples.length < Math.max(5, Math.ceil(work.length * 0.05))) {
        samples.push({
          company: row.company_name,
          category: row.industry_category_4,
          intro_len: introLen,
          profile_source: src,
          status:
            introLen >= STRUCTURED_MIN_INTRO
              ? 'structured_ready'
              : introLen >= MIN_INTRO_LEN
                ? 'partial'
                : 'empty',
        });
      }
    } catch (e) {
      stats.llm_fail += 1;
      appendLog(opts.logFile, `llm_fail event=${eventId} ${e.message}`);
      console.warn('[backfillFinancingProfileEnrich] LLM 失败', eventId, row.company_name, e.message);
    }

    if ((i + 1) % 5 === 0) {
      console.log(`[backfillFinancingProfileEnrich] 进度 ${i + 1}/${work.length}`, stats);
    }
    if (opts.sleepMs > 0) await sleep(opts.sleepMs);
  }
}

async function main() {
  const opts = parseArgs();
  const windowOpts = { sinceDate: opts.sinceDate, years: opts.years, categories: opts.categories };
  const windowLabel = buildFinancingEventSinceClause(windowOpts).label;

  console.log('[backfillFinancingProfileEnrich] 开始', {
    ...opts,
    window: windowLabel,
    trigger: NO_BAIKE_ENRICH_TRIGGER,
  });
  appendLog(opts.logFile, `start opts=${JSON.stringify({ ...opts, window: windowLabel })}`);

  const allCandidates = await loadNoBaikeFinancingCandidates(db, windowOpts);
  const work = selectWork(allCandidates, opts);

  const byCatAll = { ai: 0, bio: 0, semi_mfg: 0 };
  for (const c of allCandidates) byCatAll[c.industry_category_4] = (byCatAll[c.industry_category_4] || 0) + 1;
  const byCatWork = { ai: 0, bio: 0, semi_mfg: 0 };
  for (const c of work) byCatWork[c.industry_category_4] = (byCatWork[c.industry_category_4] || 0) + 1;

  console.log(
    '[backfillFinancingProfileEnrich] 无词条待 enrich',
    allCandidates.length,
    '本次处理',
    work.length,
    byCatWork
  );

  const stats = {
    total_pool: allCandidates.length,
    total_work: work.length,
    donor_cross: 0,
    donor_cross_rows: 0,
    donor_pool: 0,
    donor_pool_rows: 0,
    llm_ok: 0,
    llm_fail: 0,
    llm_empty: 0,
    llm_structured_ready: 0,
    skipped_dry: 0,
    batches: 0,
    submitted: 0,
    run_id: null,
  };

  const samples = [];

  if (opts.mode === 'dashscope_batch' && opts.withLlm) {
    const batchTotals = await runNoBaikeEnrichDashScopeBatches(db, work, {
      dryRun: opts.dryRun,
      batchSize: opts.batchSize,
      inFlight: opts.inFlight,
      modelName: opts.modelName,
    });
    stats.donor_cross = batchTotals.donor_cross;
    stats.donor_cross_rows = batchTotals.donor_cross_rows;
    stats.donor_pool = batchTotals.donor_pool;
    stats.donor_pool_rows = batchTotals.donor_pool_rows;
    stats.llm_ok = batchTotals.llm_ok;
    stats.llm_fail = batchTotals.llm_fail;
    stats.llm_empty = batchTotals.llm_empty;
    stats.llm_structured_ready = batchTotals.llm_structured_ready;
    stats.batches = batchTotals.batches;
    stats.submitted = batchTotals.submitted;
    stats.run_id = batchTotals.run_id;
    stats.model = batchTotals.model || opts.modelName;
  } else {
    await runChatMode(work, opts, stats, samples);
  }

  const llmAttempted = stats.llm_ok + stats.llm_fail + stats.llm_empty;
  const report = `# Stage 2b 融资无百科 Enrich 报告

> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  
> 版本：\`${AI_ENRICH_VERSION}\` · 触发：\`${NO_BAIKE_ENRICH_TRIGGER}\`  
> 范围：**${windowLabel}** · 三大类 · \`baike_lemma_status=not_found\`  
> dry-run：${opts.dryRun} · mode：${opts.mode} · LLM：${opts.withLlm}${opts.mode === 'dashscope_batch' ? ` · model=${opts.modelName} · batch=${opts.batchSize} in-flight=${opts.inFlight}` : ''}${opts.perCategory > 0 ? ` · per-category=${opts.perCategory}` : ''}${stats.run_id ? ` · run_id=${stats.run_id}` : ''}

## 1. 候选规模

| 指标 | 值 |
|------|-----|
| 全池无词条且无简介 | ${stats.total_pool} |
| 本次处理 | ${stats.total_work} |
| ai / bio / semi_mfg（全池） | ${byCatAll.ai || 0} / ${byCatAll.bio || 0} / ${byCatAll.semi_mfg || 0} |
| ai / bio / semi_mfg（本次） | ${byCatWork.ai || 0} / ${byCatWork.bio || 0} / ${byCatWork.semi_mfg || 0} |

## 2. 执行结果

| 指标 | 值 |
|------|-----|
| 跨表 donor 命中 | ${stats.donor_cross}（fan-out 行 ${stats.donor_cross_rows}） |
| 融资池 AI donor 复用 | ${stats.donor_pool} |
| DashScope Batch 批次数 | ${stats.batches || '—'} |
| Batch 提交 LLM 条数 | ${stats.submitted || llmAttempted} |
| LLM 成功（简介≥${MIN_INTRO_LEN}字） | ${stats.llm_ok}（${pct(stats.llm_ok, llmAttempted)}） |
| LLM 空结果 | ${stats.llm_empty} |
| LLM 失败 | ${stats.llm_fail} |
| 达 Structured 门槛（≥${STRUCTURED_MIN_INTRO}字） | ${stats.llm_structured_ready} |
| 未执行 LLM（dry/无 --with-llm） | ${stats.skipped_dry} |

## 3. 抽检样本（≥5%）

| 企业 | 赛道 | 简介字数 | profile_source | 状态 |
|------|------|----------|----------------|------|
${samples.map((s) => `| ${s.company} | ${s.category} | ${s.intro_len} | ${s.profile_source || '—'} | ${s.status} |`).join('\n') || '| — | — | — | — | — |'}

## 4. 说明

- Batch 模式**不含联网搜索**（DashScope Batch 限制）；试点 chat+search 质量更高，Batch 适合全量补齐。
- \`profile_source=llm_web\` 表示低置信联网生成（§6.6）。

## 5. 下一步

\`\`\`bash
cd news
npm run backfill:financing-profile-enrich -- --with-llm --mode=dashscope_batch --since=2025-01-01
npm run backfill:financing-structured -- --mode=dashscope_batch --model=qwen3.6-flash --batch-size=100 --since=2025-01-01 --category=ai,bio,semi_mfg --in-flight=1
\`\`\`
`;

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');
  appendLog(opts.logFile, `done stats=${JSON.stringify(stats)}`);
  console.log('[backfillFinancingProfileEnrich] 完成', stats);
  console.log('[backfillFinancingProfileEnrich] 报告:', opts.outFile);
  await db.closePool();
}

function strLen(v) {
  return String(v || '').trim().length;
}

main().catch(async (e) => {
  console.error('[backfillFinancingProfileEnrich] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
