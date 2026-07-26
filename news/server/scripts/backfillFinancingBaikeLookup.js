/**

 * Stage 2b §6.7：融资池百科查词

 * - 仅对自 2025-01-01 起有融资事件的企业查词（可用 --since= 覆盖）

 * - 结果 fan-out 至该企业全部历史融资行（含窗口前数据）

 * - 跳过 profile_source=listed_sync / listing_status=matched 的画像覆盖

 * - 查词结果先落盘 JSONL，写库异步并行（断点可续 apply）

 *

 * 用法（news 目录）：

 *   npm run backfill:financing-baike-lookup

 *   npm run backfill:financing-baike-lookup -- --dry-run --limit=50

 *   npm run backfill:financing-baike-lookup -- --mode=browser

 *   npm run backfill:financing-baike-lookup -- --since=2025-01-01 --item-sleep-ms=400 --batch-sleep-ms=1500 --fast-item-only

 *   npm run backfill:financing-baike-lookup -- --apply-only          # 仅消费 pending 写库

 *   npm run backfill:financing-baike-lookup -- --requery   # 含已查词企业全量重跑

 */



const fs = require('fs');

const path = require('path');

const db = require('../db');

const {

  BAIKE_LOOKUP_VERSION,

  sleep,

  pickBaikeSearchName,

  fetchBaikeHttp,

  fetchBaikeBrowserBatch,

  closeBrowserWorker,

  loadRecentFinancingCompanies,

  countRecentFinancingCompanies,

  applyBaikeToFinancingFanOut,

  isFinancingBaikeApplied,

  countFinancingFanOutRows,

} = require('../utils/project-sourcing/baikeLookupService');

const {

  DEFAULT_PENDING,

  appendPendingRecord,

  buildPendingRecord,

  createPendingApplyConsumer,

  applyPendingBatched,

  fastForwardAppliedCheckpoint,

  hasPendingApplyWork,

  loadApplyCheckpoint,

} = require('../utils/project-sourcing/baikePendingPipeline');

const {

  buildFinancingEventSinceClause,

  parseSinceArg,

} = require('../utils/project-sourcing/financingEventWindow');



const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2b融资百科查词报告.md');

const BROWSER_BATCH = Math.max(

  5,

  Math.min(50, parseInt(process.env.BAIKE_BROWSER_BATCH || '30', 10) || 30)

);



function parseArgs() {

  const sinceParsed = parseSinceArg(process.argv.slice(2));

  const out = {

    dryRun: false,

    force: false,

    applyOnly: false,

    skipFastForward: false,

    sinceDate: sinceParsed.sinceDate,

    years: sinceParsed.years,

    limit: Infinity,

    itemSleepMs: 400,

    batchSleepMs: 1500,

    sleepMs: null,

    mode: 'http',

    cdpUrl: process.env.BAIKE_CDP_URL || 'http://127.0.0.1:9222',

    captchaWaitMs: 15000,

    pageTimeoutMs: 15000,

    fastItemOnly: true,

    useWorker: true,

    applyConcurrency: 8,

    pendingFile: DEFAULT_PENDING,

    requery: false,

    outFile: DEFAULT_REPORT,

  };

  for (const a of process.argv.slice(2)) {

    if (a === '--dry-run') out.dryRun = true;

    else if (a === '--force') out.force = true;

    else if (a === '--apply-only') out.applyOnly = true;

    else if (a === '--skip-fast-forward') out.skipFastForward = true;

    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);

    else if (a.startsWith('--item-sleep-ms=')) out.itemSleepMs = Math.max(0, parseInt(a.slice(16), 10) || 400);

    else if (a.startsWith('--batch-sleep-ms=')) out.batchSleepMs = Math.max(0, parseInt(a.slice(17), 10) || 1500);

    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || 1200);

    else if (a.startsWith('--apply-concurrency=')) {

      out.applyConcurrency = Math.max(1, Math.min(16, parseInt(a.slice(20), 10) || 8));

    }

    else if (a.startsWith('--pending-file=')) out.pendingFile = path.resolve(a.slice(15));

    else if (a === '--fast-item-only') out.fastItemOnly = true;

    else if (a === '--full-search') out.fastItemOnly = false;

    else if (a === '--no-worker') out.useWorker = false;

    else if (a.startsWith('--mode=')) out.mode = String(a.slice(7)).trim().toLowerCase() || 'http';

    else if (a.startsWith('--cdp-url=')) out.cdpUrl = String(a.slice(10)).trim();

    else if (a === '--requery') out.requery = true;

    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));

  }

  if (!Number.isFinite(out.limit)) out.limit = Infinity;

  if (out.sleepMs != null) {

    out.itemSleepMs = out.sleepMs;

    out.batchSleepMs = Math.max(out.batchSleepMs, out.sleepMs);

  }

  return out;

}



function pct(n, d) {

  if (!d) return '0.00%';

  return `${((n / d) * 100).toFixed(2)}%`;

}



function createStats() {

  return {

    fetched: 0,

    applied: 0,

    has_lemma: 0,

    not_found: 0,

    anti_crawl: 0,

    errors: 0,

    fanout_rows: 0,

    profile_rows: 0,

  };

}



function tallyBaike(stats, baike) {

  if (baike.has_lemma) stats.has_lemma += 1;

  else if (baike.lemma_status === 'anti_crawl') stats.anti_crawl += 1;

  else if (baike.lemma_status === 'not_found') stats.not_found += 1;

  else stats.errors += 1;

}



async function main() {

  const opts = parseArgs();

  const windowOpts = { sinceDate: opts.sinceDate, years: opts.years };

  const windowLabel = buildFinancingEventSinceClause(windowOpts).label;

  const stats = createStats();

  const usePipeline = !opts.dryRun;



  console.log('[backfillFinancingBaikeLookup] 开始', {

    window: windowLabel,

    mode: opts.mode,

    dryRun: opts.dryRun,

    applyOnly: opts.applyOnly,

    limit: opts.limit,

    itemSleepMs: opts.itemSleepMs,

    batchSleepMs: opts.batchSleepMs,

    fastItemOnly: opts.fastItemOnly,

    useWorker: opts.useWorker,

    applyConcurrency: opts.applyConcurrency,

    pendingFile: opts.pendingFile,

    browserBatch: BROWSER_BATCH,

  });



  if (opts.applyOnly) {

    if (!usePipeline) {

      console.log('[backfillFinancingBaikeLookup] dry-run 不支持 --apply-only');

      await db.closePool();

      return;

    }

    if (!hasPendingApplyWork(opts.pendingFile)) {

      console.log('[backfillFinancingBaikeLookup] 无 pending 待写库，退出');

      await closeBrowserWorker();

      await db.closePool();

      return;

    }

    const startApplied = loadApplyCheckpoint(opts.pendingFile).applied;

    console.log('[backfillFinancingBaikeLookup] pending 写库续跑 checkpoint applied=', startApplied);

    let fastForwarded = startApplied;
    if (!opts.skipFastForward) {
      fastForwarded = await fastForwardAppliedCheckpoint(opts.pendingFile, db, startApplied);
      if (fastForwarded > startApplied) {
        console.log('[backfillFinancingBaikeLookup] 跳过已写库前缀', startApplied, '->', fastForwarded);
      }
    } else {
      console.log('[backfillFinancingBaikeLookup] 跳过 fast-forward（--skip-fast-forward）');
    }

    if (!hasPendingApplyWork(opts.pendingFile)) {

      console.log('[backfillFinancingBaikeLookup] pending 已全部写库，退出');

      await closeBrowserWorker();

      await db.closePool();

      return;

    }

    const applyRecord = async (record) => {

      const company = record.company;

      const baike = record.baike;

      stats.applied += 1;

      tallyBaike(stats, baike);

      const { updated, profile_updated } = await applyBaikeToFinancingFanOut(db, company, baike, {

        force: opts.force,

        skipFanOutCount: true,

      });

      stats.fanout_rows += updated;

      stats.profile_rows += profile_updated;

    };

    await applyPendingBatched({

      pendingFile: opts.pendingFile,

      concurrency: opts.applyConcurrency,

      batchSize: 100,

      applyFn: applyRecord,

      onBatch: (applied, total) => {

        console.log(`[backfillFinancingBaikeLookup] 写库进度 ${applied}/${total}`);

      },

    });

    console.log('[backfillFinancingBaikeLookup] apply-only 完成', stats);

    await closeBrowserWorker();

    await db.closePool();

    return;

  }



  let consumer = null;

  if (usePipeline) {

    consumer = createPendingApplyConsumer({

      pendingFile: opts.pendingFile,

      concurrency: opts.applyConcurrency,

      onApplied: (_record, appliedTotal) => {

        if (appliedTotal % 50 === 0) {

          console.log(`[backfillFinancingBaikeLookup] 写库进度 applied=${appliedTotal}`);

        }

      },

      applyFn: async (record) => {

        const company = record.company;

        const baike = record.baike;

        stats.applied += 1;

        tallyBaike(stats, baike);

        try {
          const { updated, profile_updated } = await applyBaikeToFinancingFanOut(db, company, baike, {

            force: opts.force,

            skipFanOutCount: true,

          });

          stats.fanout_rows += updated;

          stats.profile_rows += profile_updated;
        } catch (applyErr) {
          if (applyErr && (applyErr.errno === 1205 || applyErr.code === 'ER_LOCK_WAIT_TIMEOUT' || applyErr.code === 'ER_LOCK_DEADLOCK')) {
            console.warn(`[backfillFinancingBaikeLookup] apply 锁超时跳过: ${company.company_name || company.company_credit_code} — ${applyErr.code}`);
            stats.apply_skipped = (stats.apply_skipped || 0) + 1;
          } else {
            throw applyErr;
          }
        }

      },

    });

    consumer.start();

    const pendingApplied = loadApplyCheckpoint(opts.pendingFile).applied;

    if (pendingApplied > 0 || hasPendingApplyWork(opts.pendingFile)) {

      console.log('[backfillFinancingBaikeLookup] pending 写库续跑 checkpoint applied=', pendingApplied);

    }

  }



  const totalRecent = await countRecentFinancingCompanies(db, windowOpts);

  const companies = await loadRecentFinancingCompanies(db, {

    ...windowOpts,

    skipLookedUp: !opts.requery,

  });

  const take = Math.min(companies.length, opts.limit);

  const work = companies.slice(0, take);

  const skipped = Math.max(0, totalRecent - companies.length);



  console.log(

    '[backfillFinancingBaikeLookup]',

    windowLabel,

    '去重企业',

    totalRecent,

    '已查词跳过',

    skipped,

    '本次处理',

    work.length

  );



  if (!work.length) {

    if (consumer && hasPendingApplyWork(opts.pendingFile)) {

      console.log('[backfillFinancingBaikeLookup] 无新查词任务，继续消费 pending');

      consumer.signalProducerDone();

      await consumer.waitForIdle();

      console.log('[backfillFinancingBaikeLookup] pending 写库完成', { applied: consumer.applied, ...stats });

    } else {

      console.log('[backfillFinancingBaikeLookup] 无待查词企业，退出');

    }

    await closeBrowserWorker();

    await db.closePool();

    return;

  }



  const appendFetched = (company, baike) => {

    stats.fetched += 1;

    if (usePipeline) {

      appendPendingRecord(opts.pendingFile, buildPendingRecord(company, baike));

    }

  };



  const processOneSync = async (company, baike) => {

    stats.fetched += 1;

    tallyBaike(stats, baike);

    if (opts.dryRun) {

      stats.fanout_rows += await countFinancingFanOutRows(db, company);

      return;

    }

    stats.applied += 1;

    const { updated, profile_updated } = await applyBaikeToFinancingFanOut(db, company, baike, {

      force: opts.force,

    });

    stats.fanout_rows += updated;

    stats.profile_rows += profile_updated;

  };



  if (opts.mode === 'browser') {

    for (let i = 0; i < work.length; i += BROWSER_BATCH) {

      const chunk = work.slice(i, i + BROWSER_BATCH);

      const names = chunk.map((c) => ({ company_name: pickBaikeSearchName(c) }));

      console.log(`[backfillFinancingBaikeLookup] browser 批次 ${i + 1}-${i + chunk.length}/${work.length}`);

      if (opts.dryRun) {

        for (const c of chunk) {

          stats.fetched += 1;

          stats.fanout_rows += await countFinancingFanOutRows(db, c);

        }

        continue;

      }

      const results = await fetchBaikeBrowserBatch(names, opts);

      for (let j = 0; j < chunk.length; j += 1) {

        if (usePipeline) appendFetched(chunk[j], results[j]);

        else await processOneSync(chunk[j], results[j]);

      }

      if (i + BROWSER_BATCH < work.length && opts.batchSleepMs > 0) await sleep(opts.batchSleepMs);

    }

  } else {

    for (let i = 0; i < work.length; i += 1) {

      const company = work[i];

      const name = pickBaikeSearchName(company);

      if ((i + 1) % 100 === 0) {

        console.log(`[backfillFinancingBaikeLookup] 进度 ${i + 1}/${work.length}`);

      }

      const baike = opts.dryRun

        ? { has_lemma: false, lemma_status: 'dry_run', miss_reason: null, baike_url: null }

        : fetchBaikeHttp(name, opts.itemSleepMs ?? opts.sleepMs);

      if (usePipeline && !opts.dryRun) appendFetched(company, baike);

      else await processOneSync(company, baike);

    }

  }



  if (consumer) {

    consumer.signalProducerDone();

    await consumer.waitForIdle();

  }



  const report = `# Stage 2b 融资池百科查词报告



> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  

> 版本：\`${BAIKE_LOOKUP_VERSION}\`  

> 范围：**${windowLabel}** 有融资事件的去重企业；结果 **fan-out 至全部历史行**  

> 模式：${opts.dryRun ? '**dry-run**' : '**写入**'} | 抓取：${opts.mode} | force：${opts.force} | fast-item-only：${opts.fastItemOnly} | worker：${opts.useWorker} | apply并发：${opts.applyConcurrency}



## 结果



| 指标 | 值 |

|------|-----|

| 查词抓取 | ${stats.fetched} |

| 写库完成 | ${stats.applied} |

| 有词条 | ${stats.has_lemma}（${pct(stats.has_lemma, stats.applied || stats.fetched)}） |

| 确认无词条 | ${stats.not_found} |

| 反爬/受限 | ${stats.anti_crawl} |

| 其它错误 | ${stats.errors} |

| fan-out 事件行（累计） | ${stats.fanout_rows} |

| 画像写入行 | ${stats.profile_rows || 0} |



## 说明



- \`listed_sync\` / \`listing_status=matched\` 行仅写百科元数据，不覆盖上市主档画像

- pending 文件：\`${opts.pendingFile}\`（checkpoint 同名 \`.checkpoint.json\`）

- 仅写库：\`npm run backfill:financing-baike-lookup -- --apply-only\`

- 全量跑建议 \`--mode=browser\` + CDP（\`startChromeForBaike.ps1\`）

`;



  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });

  fs.writeFileSync(opts.outFile, report, 'utf8');

  console.log('[backfillFinancingBaikeLookup] 完成', stats);

  console.log('[backfillFinancingBaikeLookup] 报告:', opts.outFile);

  await closeBrowserWorker();

  await db.closePool();

}



main().catch(async (e) => {

  console.error('[backfillFinancingBaikeLookup] 失败:', e);

  try {

    await closeBrowserWorker();

  } catch (_) {}

  try {

    await db.closePool();

  } catch (_) {}

  process.exit(1);

});


