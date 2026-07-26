/**
 * Stage 2 §6.3–6.7：融资池已上市识别 + ipo_new_share 画像同步
 *
 * 范围默认：IPO 类轮次去重企业 + 关联 matched 子集 → 写回该企业全部融资事件行
 *
 * 用法（news 目录）：
 *   npm run sync:listed-financing-stage2
 *   npm run sync:listed-financing-stage2 -- --dry-run
 *   npm run sync:listed-financing-stage2 -- --all-companies
 *   npm run sync:listed-financing-stage2 -- --force
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { runListedFinancingSync, LISTED_SYNC_VERSION } = require('../utils/project-sourcing/listedFinancingSync');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2已上市同步报告.md');

function parseArgs() {
  const out = {
    dryRun: false,
    force: false,
    ipoOnly: true,
    markUnknown: false,
    markNoMatch: false,
    marksOnly: false,
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--all-companies') out.ipoOnly = false;
    else if (a === '--mark-unknown') out.markUnknown = true;
    else if (a === '--mark-no-match') out.markNoMatch = true;
    else if (a === '--marks-only') out.marksOnly = true;
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

function mdTable(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const r of rows) {
    lines.push(`| ${r.join(' | ')} |`);
  }
  return lines.join('\n');
}

async function loadPostSyncCounts() {
  const rows = await db.query(`
    SELECT
      COALESCE(listing_status, '(null)') AS listing_status,
      COUNT(*) AS cnt
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
    GROUP BY COALESCE(listing_status, '(null)')
    ORDER BY cnt DESC
  `);
  const profile = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(profile_source = 'listed_sync') AS listed_sync_cnt,
      SUM(TRIM(COALESCE(ai_product_intro, '')) <> '') AS has_product_intro,
      SUM(TRIM(COALESCE(industry_category_4, '')) <> '') AS has_category_4
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
  `);
  return { byStatus: rows, profile: profile[0] || {} };
}

function buildReport(opts, stats, post) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const methodRows = Object.entries(stats.by_match_method || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, String(v), pct(v, stats.companies_total)]);

  return `# Stage 2 已上市同步报告

> 生成时间：${now}  
> 脚本：\`syncListedFinancingFromNewShare.js\`  
> 版本：\`${LISTED_SYNC_VERSION}\`  
> 模式：${opts.dryRun ? '**dry-run**' : '**写入**'} | 企业范围：${opts.ipoOnly ? 'IPO 类去重' : '融资全量去重'} | force：${opts.force}

## 1. 同步结果（企业维度）

| 指标 | 值 |
|------|-----|
| 去重企业数 | ${stats.companies_total} |
| matched（可同步） | ${stats.matched_companies}（${pct(stats.matched_companies, stats.companies_total)}） |
| unknown（待复核） | ${stats.unknown_companies}（${pct(stats.unknown_companies, stats.companies_total)}） |
| no_match | ${stats.no_match_companies}（${pct(stats.no_match_companies, stats.companies_total)}） |
| **关联成功率（matched/企业）** | **${pct(stats.matched_companies, stats.companies_total)}** |

## 2. 事件行写入

| 指标 | 值 |
|------|-----|
| 融资事件总行数 | ${stats.financing_events_total} |
| IPO 类事件行数 | ${stats.financing_ipo_events} |
| 画像同步/将同步事件行 | ${stats.events_synced} |
| 跳过画像覆盖（受保护 profile_source） | ${stats.events_profile_skipped} |
| 标记 unknown 事件行 | ${stats.events_unknown_marked} |
| 标记 no_match 事件行 | ${stats.events_no_match_marked} |

## 3. matched 命中方式

${methodRows.length ? mdTable(['match_method', '企业数', '占比'], methodRows) : '_无_'}

## 4. 同步后融资表快照

${mdTable(
  ['listing_status', '事件行数'],
  (post.byStatus || []).map((r) => [r.listing_status, String(r.cnt)])
)}

| 画像字段 | 填充行数 / 总行数 |
|----------|-------------------|
| profile_source=listed_sync | ${post.profile.listed_sync_cnt || 0} / ${post.profile.total || 0} |
| ai_product_intro 非空 | ${post.profile.has_product_intro || 0} / ${post.profile.total || 0} |
| industry_category_4 非空 | ${post.profile.has_category_4 || 0} / ${post.profile.total || 0} |

## 5. 验收对照（§9.2）

| 指标 | 目标 | 本次 |
|------|------|------|
| listed 同步成功率（可关联子集） | ≥ 85% | matched 企业占比 ${pct(stats.matched_companies, stats.companies_total)}（IPO 去重口径） |
| profile_source 可追溯（listed_sync） | 100% matched 子集 | ${opts.dryRun ? 'dry-run 未写入' : '见上表'} |

## 6. 说明

- **上市真值**：\`ipo_new_share\` 沪深北主档（${stats.new_share_pool_size} 行）
- **同步字段**：listing_status、listed_stock_code、listed_exchange、new_share_row_id、profile_source=listed_sync、company_intro、ai_product_intro、tags、industry_category_4；ai_enrich_status=skipped
- **unknown 队列**：名称 fuzzy / 多候选，不自动写画像；需人工或规则二次匹配
- 烯牛行业 → category_4：另跑 \`npm run backfill:financing-category4-stage2\`
`;
}

async function main() {
  const opts = parseArgs();
  console.log('[syncListedFinancingFromNewShare] 开始', {
    dryRun: opts.dryRun,
    force: opts.force,
    ipoOnly: opts.ipoOnly,
    markUnknown: opts.markUnknown,
    markNoMatch: opts.markNoMatch,
    marksOnly: opts.marksOnly,
  });

  const stats = await runListedFinancingSync(db, {
    ipoOnly: opts.ipoOnly,
    markUnknown: opts.markUnknown,
    markNoMatch: opts.markNoMatch,
    marksOnly: opts.marksOnly,
    force: opts.force,
    dryRun: opts.dryRun,
  });

  console.log('[syncListedFinancingFromNewShare] 企业 matched:', stats.matched_companies, '/', stats.companies_total);
  console.log('[syncListedFinancingFromNewShare] 事件同步:', stats.events_synced);

  const post = opts.dryRun
    ? { byStatus: [], profile: {} }
    : await loadPostSyncCounts();

  const report = buildReport(opts, stats, post);
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');
  console.log('[syncListedFinancingFromNewShare] 报告:', opts.outFile);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[syncListedFinancingFromNewShare] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
