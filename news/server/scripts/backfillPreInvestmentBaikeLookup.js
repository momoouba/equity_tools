/**
 * Stage 2b §6.8：投前项目百科查词
 * - 近 N 年创建的投前项目（默认 3 年）按企业去重查词
 * - 结果 fan-out 至同信用代码/全称的全部投前记录
 *
 * 用法（news 目录）：
 *   npm run backfill:pre-investment-baike-lookup
 *   npm run backfill:pre-investment-baike-lookup -- --dry-run --limit=30
 *   npm run backfill:pre-investment-baike-lookup -- --mode=browser
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
  loadRecentPreInvestmentCompanies,
  applyBaikeToPreInvFanOut,
  countPreInvFanOutRows,
} = require('../utils/project-sourcing/baikeLookupService');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2b投前百科查词报告.md');
const BROWSER_BATCH = 25;

function parseArgs() {
  const out = {
    dryRun: false,
    force: false,
    years: 3,
    limit: Infinity,
    sleepMs: 1200,
    mode: 'http',
    cdpUrl: process.env.BAIKE_CDP_URL || 'http://127.0.0.1:9222',
    captchaWaitMs: 15000,
    pageTimeoutMs: 30000,
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--years=')) out.years = Math.max(1, parseInt(a.slice(8), 10) || 3);
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || 1200);
    else if (a.startsWith('--mode=')) out.mode = String(a.slice(7)).trim().toLowerCase() || 'http';
    else if (a.startsWith('--cdp-url=')) out.cdpUrl = String(a.slice(10)).trim();
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  if (!Number.isFinite(out.limit)) out.limit = Infinity;
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

async function main() {
  const opts = parseArgs();
  console.log('[backfillPreInvestmentBaikeLookup] 开始', opts);

  const companies = await loadRecentPreInvestmentCompanies(db, opts.years);
  const work = companies.slice(0, Math.min(companies.length, opts.limit));
  console.log('[backfillPreInvestmentBaikeLookup] 近', opts.years, '年去重企业', companies.length, '本次', work.length);

  const stats = { queried: 0, has_lemma: 0, not_found: 0, fanout_rows: 0, profile_rows: 0 };

  const processOne = async (company, baike) => {
    stats.queried += 1;
    if (baike.has_lemma) stats.has_lemma += 1;
    else stats.not_found += 1;
    if (opts.dryRun) {
      stats.fanout_rows += await countPreInvFanOutRows(db, company);
      return;
    }
    const { updated, profile_updated } = await applyBaikeToPreInvFanOut(db, company, baike, { force: opts.force });
    stats.fanout_rows += updated;
    stats.profile_rows += profile_updated;
  };

  if (opts.mode === 'browser') {
    for (let i = 0; i < work.length; i += BROWSER_BATCH) {
      const chunk = work.slice(i, i + BROWSER_BATCH);
      const payload = chunk.map((c) => ({
        company_name: pickBaikeSearchName(c, ['enterprise_full_name', 'project_abbreviation']),
      }));
      if (opts.dryRun) {
        for (const c of chunk) {
          stats.queried += 1;
          stats.fanout_rows += await countPreInvFanOutRows(db, c);
        }
        continue;
      }
      const results = await fetchBaikeBrowserBatch(payload, opts);
      for (let j = 0; j < chunk.length; j += 1) await processOne(chunk[j], results[j]);
      if (i + BROWSER_BATCH < work.length) await sleep(opts.sleepMs);
    }
  } else {
    for (let i = 0; i < work.length; i += 1) {
      const company = work[i];
      const name = pickBaikeSearchName(company, ['enterprise_full_name', 'project_abbreviation']);
      const baike = opts.dryRun
        ? { has_lemma: false, lemma_status: 'dry_run', miss_reason: null, baike_url: null }
        : fetchBaikeHttp(name, opts.sleepMs);
      await processOne(company, baike);
    }
  }

  const report = `# Stage 2b 投前百科查词报告

> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  
> 近 **${opts.years}** 年投前项目去重企业；fan-out 至同主体全部记录  
> 模式：${opts.dryRun ? 'dry-run' : '写入'} | ${opts.mode}

| 指标 | 值 |
|------|-----|
| 查词企业 | ${stats.queried} |
| 有词条 | ${stats.has_lemma}（${pct(stats.has_lemma, stats.queried)}） |
| fan-out 行 | ${stats.fanout_rows} |
| 画像写入 | ${stats.profile_rows} |
`;

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');
  console.log('[backfillPreInvestmentBaikeLookup] 完成', stats);
  await closeBrowserWorker();
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillPreInvestmentBaikeLookup] 失败:', e);
  try {
    await closeBrowserWorker();
  } catch (_) {}
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
