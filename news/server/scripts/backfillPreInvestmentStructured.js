/**
 * Stage 3：投前优先行业批 structured 抽取
 *
 * 用法（news 目录）：
 *   npm run backfill:pre-investment-structured
 *   npm run backfill:pre-investment-structured -- --dry-run --limit=10
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { parseCategoryList, loadPriorityPreInvestmentProjects } = require('../utils/competitor-analysis/priorityBatchScope');
const {
  extractStructuredProfile,
  applyStructuredToPreInvestment,
  STRUCTURED_SCHEMA_VERSION,
} = require('../utils/competitor-analysis/structuredProfileService');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage3投前Structured报告.md');

function parseArgs() {
  const out = {
    dryRun: false,
    force: false,
    years: 3,
    limit: Infinity,
    categories: null,
    sleepMs: 800,
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--years=')) out.years = Math.max(1, parseInt(a.slice(8), 10) || 3);
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--category=')) out.categories = a.slice(11);
    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || 800);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  if (!Number.isFinite(out.limit)) out.limit = Infinity;
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const opts = parseArgs();
  const categories = parseCategoryList(opts.categories);
  const projects = await loadPriorityPreInvestmentProjects(db, {
    years: opts.years,
    categories,
    skipStructured: !opts.force,
  });
  const work = projects.filter((p) => p.has_intro).slice(0, opts.limit);
  console.log('[backfillPreInvestmentStructured] 候选', projects.length, '本次', work.length);

  const stats = { work: work.length, ok: 0, fail: 0 };

  for (let i = 0; i < work.length; i += 1) {
    const meta = work[i];
    const rows = await db.query(
      `SELECT enterprise_full_name, company_intro, product_intro, ai_product_intro, bp_extract_text,
              ai_industry_tags_display
       FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [meta.F_Id]
    );
    if (!rows.length) continue;
    const row = rows[0];

    if (opts.dryRun) {
      stats.ok += 1;
      continue;
    }

    try {
      const result = await extractStructuredProfile(
        {
          enterprise_full_name: meta.enterprise_full_name,
          industry_category_4: meta.industry_category_4,
          sub_track: meta.sub_track,
        },
        row
      );
      if (!result.ok) {
        stats.fail += 1;
        continue;
      }
      await applyStructuredToPreInvestment(db, meta.F_Id, result.profile);
      stats.ok += 1;
    } catch (e) {
      stats.fail += 1;
      console.warn('[backfillPreInvestmentStructured] 失败', meta.F_Id, e.message);
    }
    if (opts.sleepMs > 0 && i + 1 < work.length) await sleep(opts.sleepMs);
  }

  const report = `# Stage 3 投前 Structured 报告

> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  
> 版本：\`${STRUCTURED_SCHEMA_VERSION}\`

| 指标 | 值 |
|------|-----|
| 本次处理 | ${stats.work} |
| 成功 | ${stats.ok} |
| 失败 | ${stats.fail} |
`;

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');
  console.log('[backfillPreInvestmentStructured] 完成', stats);
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillPreInvestmentStructured] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
