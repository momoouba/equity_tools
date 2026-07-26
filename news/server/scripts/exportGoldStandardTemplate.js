/**
 * Stage 0-4：导出金标准标注模板（目标企业 × 候选待填）
 *
 * 用法（news 目录）：
 *   node server/scripts/exportGoldStandardTemplate.js
 *   node server/scripts/exportGoldStandardTemplate.js --per-category=30 --import-db
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  loadIndustryMapFromDb,
  mapSourceIndustryToCategory4,
} = require('../utils/project-sourcing/industryCategory4Map');

const DEFAULT_CSV = path.resolve(__dirname, '../../../需求文档/竞品分析/金标准标注模板.csv');
const CATEGORIES = ['ai', 'bio', 'semi_mfg'];

function parseArgs() {
  const out = {
    perCategory: 30,
    years: 3,
    importDb: false,
    outFile: DEFAULT_CSV,
    batchId: `gold_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--import-db') out.importDb = true;
    else if (a.startsWith('--per-category=')) out.perCategory = Math.max(1, parseInt(a.slice(15), 10) || 30);
    else if (a.startsWith('--years=')) out.years = Math.max(1, parseInt(a.slice(8), 10) || 3);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
    else if (a.startsWith('--batch=')) out.batchId = a.slice(8);
  }
  return optsFix(out);
}

function optsFix(o) {
  return o;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function pickTargets(mapRows, years, perCategory) {
  const rows = await db.query(
    `SELECT company_name, company_credit_code, industry_source_lv1, industry_source_lv2,
            MAX(event_date) AS last_event, COUNT(*) AS event_cnt
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND event_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)
     GROUP BY company_name, company_credit_code, industry_source_lv1, industry_source_lv2
     ORDER BY event_cnt DESC`,
    [years]
  );

  const pools = { ai: [], bio: [], semi_mfg: [] };
  const seen = new Set();
  for (const row of rows) {
    const mapped = mapSourceIndustryToCategory4(row.industry_source_lv1, row.industry_source_lv2, mapRows);
    if (!CATEGORIES.includes(mapped.category_4)) continue;
    const code = String(row.company_credit_code || '').trim();
    const key = code || row.company_name;
    if (seen.has(`${mapped.category_4}:${key}`)) continue;
    seen.add(`${mapped.category_4}:${key}`);
    pools[mapped.category_4].push({
      category_4: mapped.category_4,
      target_source: 'financing',
      target_ref_id: null,
      target_display_name: String(row.company_name).trim(),
      target_credit_code: code || null,
      industry_source_lv1: row.industry_source_lv1,
      last_event: row.last_event,
      event_cnt: Number(row.event_cnt || 0),
    });
  }

  const picked = [];
  for (const cat of CATEGORIES) {
    const arr = pools[cat].sort((a, b) => b.event_cnt - a.event_cnt || String(b.last_event).localeCompare(String(a.last_event)));
    picked.push(...arr.slice(0, perCategory));
  }
  return picked;
}

function toCsvRows(targets, batchId) {
  const header = [
    'batch_id',
    'category_4',
    'target_source',
    'target_display_name',
    'target_credit_code',
    'industry_source_lv1',
    'candidate_display_name',
    'candidate_credit_code',
    'candidate_source',
    'annotator_1_is_competitor',
    'annotator_1_type',
    'annotator_2_is_competitor',
    'annotator_2_type',
    'annotator_3_is_competitor',
    'annotator_3_type',
    'final_is_competitor',
    'final_type',
    'notes',
  ];
  const lines = [header.join(',')];
  for (const t of targets) {
    lines.push(
      [
        batchId,
        t.category_4,
        t.target_source,
        t.target_display_name,
        t.target_credit_code || '',
        t.industry_source_lv1 || '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '候选企业由业务填写；1=竞品 0=非竞品',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}

async function importToDb(targets, batchId) {
  let n = 0;
  for (const t of targets) {
    await db.execute(
      `INSERT INTO competitor_gold_standard_pair (
        category_4, target_source, target_ref_id, target_display_name, target_credit_code,
        status, batch_id, notes, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0)`,
      [
        t.category_4,
        t.target_source,
        t.target_ref_id,
        t.target_display_name,
        t.target_credit_code,
        batchId,
        '候选待业务填写；三人独立标注',
      ]
    );
    n += 1;
  }
  return n;
}

async function main() {
  const opts = parseArgs();
  const mapRows = await loadIndustryMapFromDb(db, { force: true });
  const targets = await pickTargets(mapRows, opts.years, opts.perCategory);

  const csv = toCsvRows(targets, opts.batchId);
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, `\ufeff${csv}`, 'utf8');
  console.log('[exportGoldStandardTemplate] CSV:', opts.outFile);
  console.log('[exportGoldStandardTemplate] 目标企业数:', targets.length);

  if (opts.importDb) {
    const n = await importToDb(targets, opts.batchId);
    console.log('[exportGoldStandardTemplate] 已写入 competitor_gold_standard_pair:', n, 'batch=', opts.batchId);
  }

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[exportGoldStandardTemplate] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
