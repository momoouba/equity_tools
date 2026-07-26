/**
 * Stage 1c：导入申万行业 → category_4 映射种子
 *
 * 用法（news 目录）：
 *   node server/scripts/importSwIndustryCategoryMap.js
 *   node server/scripts/importSwIndustryCategoryMap.js --dry-run
 */

const db = require('../db');
const { buildSeedRows, clearSwIndustryMapCache } = require('../utils/project-sourcing/swIndustryCategoryMap');

const MAP_VERSION = 'stage1c_v1';

function parseArgs() {
  const out = { dryRun: false, confirmedBy: 'business' };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--confirmed-by=')) out.confirmedBy = a.slice(15);
  }
  return out;
}

async function upsertRows(rows, confirmedBy, dryRun) {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (dryRun) continue;
    const result = await db.execute(
      `INSERT INTO sw_industry_category_map (
        sw_industry_l1, sw_industry_l2, category_4, category_display, sub_track,
        boundary_note, confirmed_by, map_version, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON DUPLICATE KEY UPDATE
        category_4 = VALUES(category_4),
        category_display = VALUES(category_display),
        sub_track = VALUES(sub_track),
        boundary_note = VALUES(boundary_note),
        confirmed_by = VALUES(confirmed_by),
        map_version = VALUES(map_version),
        F_DeleteMark = 0,
        F_LastModifyTime = CURRENT_TIMESTAMP`,
      [
        row.sw_industry_l1,
        row.sw_industry_l2 || '',
        row.category_4,
        row.category_display,
        row.sub_track,
        row.boundary_note,
        confirmedBy,
        MAP_VERSION,
      ]
    );
    if (result?.affectedRows === 1) inserted += 1;
    else if (result?.affectedRows === 2) updated += 1;
  }
  return { inserted, updated };
}

async function main() {
  const opts = parseArgs();
  await db.query('SELECT 1');
  const rows = buildSeedRows();
  console.log('[importSwIndustryCategoryMap] 种子行数:', rows.length);

  const byCat = {};
  for (const r of rows.filter((x) => !x.sw_industry_l2)) {
    byCat[r.category_4] = (byCat[r.category_4] || 0) + 1;
  }
  for (const [k, n] of Object.entries(byCat).sort()) {
    console.log(`  ${k}: ${n} 个 L1`);
  }

  if (opts.dryRun) {
    console.log('[importSwIndustryCategoryMap] dry-run 完成');
    await db.closePool();
    return;
  }

  const { inserted, updated } = await upsertRows(rows, opts.confirmedBy, false);
  clearSwIndustryMapCache();
  const countRows = await db.query(`SELECT COUNT(*) AS c FROM sw_industry_category_map WHERE F_DeleteMark = 0`);
  console.log('[importSwIndustryCategoryMap] 新增:', inserted, '更新:', updated);
  console.log('[importSwIndustryCategoryMap] 表内有效行数:', countRows[0]?.c);
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[importSwIndustryCategoryMap] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
