/**
 * Stage 0：从 xlsx 导入 industry_source_l1_map
 *
 * 用法（在 news 目录）：
 *   node server/scripts/importIndustrySourceL1Map.js
 *   node server/scripts/importIndustrySourceL1Map.js --dry-run
 *   node server/scripts/importIndustrySourceL1Map.js --file=../需求文档/竞品分析/行业分类映射.xlsx
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const db = require('../db');
const {
  parseXlsxSheetRows,
  clearIndustryMapCache,
} = require('../utils/project-sourcing/industryCategory4Map');

const MAP_VERSION = 'stage0_v1';
const DEFAULT_XLSX = path.resolve(__dirname, '../../../需求文档/竞品分析/行业分类映射.xlsx');

function parseArgs() {
  const out = { dryRun: false, file: DEFAULT_XLSX, confirmedBy: 'business' };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--file=')) out.file = path.resolve(a.slice(6));
    else if (a.startsWith('--confirmed-by=')) out.confirmedBy = a.slice(15);
  }
  return out;
}

function loadRowsFromXlsx(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`xlsx 不存在: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return parseXlsxSheetRows(matrix);
}

async function upsertRows(rows, confirmedBy, dryRun) {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    if (dryRun) continue;

    const result = await db.execute(
      `INSERT INTO industry_source_l1_map (
        source_lv1, source_lv2, category_4, category_display, sub_track,
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
        row.source_lv1,
        row.source_lv2 || '',
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

function summarizeByCategory(rows) {
  const byCat = {};
  for (const r of rows) {
    const k = `${r.category_4} (${r.category_display})`;
    byCat[k] = (byCat[k] || 0) + 1;
  }
  return byCat;
}

async function main() {
  const opts = parseArgs();
  console.log('[importIndustrySourceL1Map] file:', opts.file);
  console.log('[importIndustrySourceL1Map] dry-run:', opts.dryRun);

  const rows = loadRowsFromXlsx(opts.file);
  console.log('[importIndustrySourceL1Map] 解析行数:', rows.length);

  const byCat = summarizeByCategory(rows);
  for (const [k, n] of Object.entries(byCat).sort()) {
    console.log(`  ${k}: ${n} 行`);
  }

  const lv1Set = new Set(rows.filter((r) => !r.source_lv2).map((r) => r.source_lv1));
  console.log('[importIndustrySourceL1Map] 含 L1 默认行的一级行业数:', lv1Set.size);

  if (opts.dryRun) {
    console.log('[importIndustrySourceL1Map] dry-run 完成，未写入数据库');
    await db.closePool();
    return;
  }

  const { inserted, updated } = await upsertRows(rows, opts.confirmedBy, false);
  clearIndustryMapCache();

  const countRows = await db.query(
    `SELECT COUNT(*) AS c FROM industry_source_l1_map WHERE F_DeleteMark = 0`
  );
  console.log('[importIndustrySourceL1Map] 新增:', inserted, '更新:', updated);
  console.log('[importIndustrySourceL1Map] 表内有效行数:', countRows[0]?.c);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[importIndustrySourceL1Map] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
