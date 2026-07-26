/**
 * Stage 1c：申万行业 → industry_category_4 回填
 *
 * 用法（news 目录）：
 *   npm run import:sw-industry-category-map
 *   npm run backfill:new-share-category4-stage1c
 *   npm run backfill:new-share-category4-stage1c -- --dry-run
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { isDomesticExchange } = require('../utils/listing/listedUniverseUtils');
const {
  loadSwIndustryMapFromDb,
  mapSwIndustryToCategory4,
  clearSwIndustryMapCache,
} = require('../utils/project-sourcing/swIndustryCategoryMap');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage1c四大类标注报告.md');

function parseArgs() {
  const out = { dryRun: false, force: false, outFile: DEFAULT_REPORT, importMap: true };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--skip-import') out.importMap = false;
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

async function ensureMapSeeded() {
  const cnt = await db.query(`SELECT COUNT(*) AS c FROM sw_industry_category_map WHERE F_DeleteMark = 0`);
  if (Number(cnt[0]?.c || 0) > 0) return false;
  const { buildSeedRows } = require('../utils/project-sourcing/swIndustryCategoryMap');
  const rows = buildSeedRows();
  for (const row of rows) {
    await db.execute(
      `INSERT INTO sw_industry_category_map (
        sw_industry_l1, sw_industry_l2, category_4, category_display, sub_track,
        boundary_note, confirmed_by, map_version, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, 'auto_seed', 'stage1c_v1', 0)
      ON DUPLICATE KEY UPDATE
        category_4 = VALUES(category_4),
        F_DeleteMark = 0,
        F_LastModifyTime = CURRENT_TIMESTAMP`,
      [
        row.sw_industry_l1,
        row.sw_industry_l2 || '',
        row.category_4,
        row.category_display,
        row.sub_track,
        row.boundary_note,
      ]
    );
  }
  clearSwIndustryMapCache();
  return true;
}

async function queryPostStats() {
  const base = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(industry_category_4, '')) <> '' THEN 1 ELSE 0 END) AS cat4
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
  `);
  const byCat = await db.query(`
    SELECT industry_category_4, COUNT(*) AS c
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
      AND TRIM(COALESCE(industry_category_4, '')) <> ''
    GROUP BY industry_category_4
    ORDER BY c DESC
  `);
  const byMatch = await db.query(`
    SELECT
      SUM(CASE WHEN TRIM(COALESCE(sw_industry_l1, '')) = '' THEN 1 ELSE 0 END) AS no_sw,
      SUM(CASE WHEN TRIM(COALESCE(sw_industry_l1, '')) <> '' THEN 1 ELSE 0 END) AS has_sw
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
  `);
  const b = base[0] || {};
  const m = byMatch[0] || {};
  return {
    total: Number(b.total || 0),
    cat4: Number(b.cat4 || 0),
    byCat,
    noSw: Number(m.no_sw || 0),
    hasSw: Number(m.has_sw || 0),
  };
}

function writeReport(opts, counters, postStats, mapRowCount) {
  const lines = [];
  lines.push('# Stage 1c 四大类（industry_category_4）标注报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`模式：${opts.dryRun ? '**dry-run**' : '**写入**'}`);
  lines.push('');
  lines.push('## 1. 回填摘要');
  lines.push('');
  lines.push(`- 映射表行数：**${mapRowCount}**`);
  lines.push(`- 更新 industry_category_4：**${counters.updated}**（跳过 ${counters.skipped}）`);
  lines.push(`- 匹配级别：L2=${counters.match.l2} L1=${counters.match.l1} 无申万=${counters.match.no_sw} 未映射=${counters.match.unmapped}`);
  lines.push('');
  lines.push('## 2. 库内沪深北（回填后）');
  lines.push('');
  lines.push(`- 记录总数：**${postStats.total.toLocaleString()}**`);
  lines.push(`- 四大类已标注：**${postStats.cat4.toLocaleString()}**（**${pct(postStats.cat4, postStats.total)}**）`);
  lines.push(`- 有申万行业：**${postStats.hasSw}**；无申万（标为 other）：**${postStats.noSw}**`);
  lines.push('');
  lines.push('### 2.1 分 category_4');
  lines.push('');
  lines.push('| category_4 | 条数 | 占比 |');
  lines.push('| --- | --- | --- |');
  for (const r of postStats.byCat) {
    const c = Number(r.c || 0);
    lines.push(`| ${r.industry_category_4 || '—'} | ${c.toLocaleString()} | ${pct(c, postStats.total)} |`);
  }
  lines.push('');
  lines.push('## 3. 验收（§5.4 Stage 1c）');
  lines.push('');
  const pass = postStats.total > 0 && postStats.cat4 === postStats.total;
  lines.push(`- 四大类已标注 100%：**${pass ? '达标' : '未达标'}**（当前 ${pct(postStats.cat4, postStats.total)}）`);
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  return opts.outFile;
}

async function main() {
  const opts = parseArgs();
  await db.query('SELECT 1');

  if (opts.importMap) {
    const seeded = await ensureMapSeeded();
    if (seeded) console.log('[backfillNewShareCategory4Stage1c] 映射表为空，已自动导入种子');
  }

  const mapRows = await loadSwIndustryMapFromDb(db, { force: true });
  const mapRowCount = mapRows.length;

  const rows = await db.query(`
    SELECT F_Id, stock_code, exchange, stock_name,
           sw_industry_l1, sw_industry_l2, industry_category_4
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
    ORDER BY F_Id ASC
  `);

  const counters = {
    updated: 0,
    skipped: 0,
    match: { l2: 0, l1: 0, no_sw: 0, unmapped: 0 },
  };

  for (const row of rows) {
    if (!isDomesticExchange(row.exchange)) continue;
    const existing = String(row.industry_category_4 || '').trim();
    if (existing && !opts.force) {
      counters.skipped += 1;
      continue;
    }

    const mapped = mapSwIndustryToCategory4(row.sw_industry_l1, row.sw_industry_l2, mapRows);
    counters.match[mapped.match_level] = (counters.match[mapped.match_level] || 0) + 1;

    if (!opts.dryRun) {
      await db.execute(
        `UPDATE ipo_new_share
         SET industry_category_4 = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ?`,
        [mapped.category_4, row.F_Id]
      );
    }
    counters.updated += 1;
  }

  const postStats = await queryPostStats();
  const reportPath = writeReport(opts, counters, postStats, mapRowCount);

  console.log('[backfillNewShareCategory4Stage1c] 完成', counters);
  console.log(
    '[backfillNewShareCategory4Stage1c] category_4',
    pct(postStats.cat4, postStats.total),
    `(${postStats.cat4}/${postStats.total})`
  );
  console.log('[backfillNewShareCategory4Stage1c] 报告:', reportPath);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillNewShareCategory4Stage1c] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
