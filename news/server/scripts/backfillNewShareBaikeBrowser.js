/**
 * Stage 1d 补充：ipo_new_share 百科查词（browser mode）
 *
 * 用法（news 目录）：
 *   node server/scripts/backfillNewShareBaikeBrowser.js
 *   node server/scripts/backfillNewShareBaikeBrowser.js --dry-run
 *   node server/scripts/backfillNewShareBaikeBrowser.js --limit=100
 *   node server/scripts/backfillNewShareBaikeBrowser.js --priority-only
 */

const path = require('path');
require('dotenv').config({ override: false });
const mysql = require('mysql2/promise');
const {
  fetchBaikeBrowserBatch,
  closeBrowserWorker,
} = require('../utils/project-sourcing/baikeLookupService');

const BATCH_SIZE = 30;
const SLEEP_MS = 1200;

function parseArgs() {
  const out = { dryRun: false, limit: Infinity, priorityOnly: false, batchSize: BATCH_SIZE, sleepMs: SLEEP_MS, fastItemOnly: true, timeoutMs: 15000 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--priority-only') out.priorityOnly = true;
    else if (a === '--no-fast') out.fastItemOnly = false;
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--batch-size=')) out.batchSize = Math.max(1, parseInt(a.slice(13), 10) || BATCH_SIZE);
    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || SLEEP_MS);
    else if (a.startsWith('--timeout-ms=')) out.timeoutMs = Math.max(1000, parseInt(a.slice(13), 10) || 15000);
  }
  if (!Number.isFinite(out.limit)) out.limit = Infinity;
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const opts = parseArgs();

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 4,
  });

  console.log('[newShareBaikeBrowser] DB 连接已建立');
  console.log(`[newShareBaikeBrowser] 配置: batchSize=${opts.batchSize} sleepMs=${opts.sleepMs} fastItemOnly=${opts.fastItemOnly} timeoutMs=${opts.timeoutMs}`);

  const catFilter = opts.priorityOnly ? "AND industry_category_4 IN ('ai','bio','semi_mfg')" : '';
  const [rows] = await pool.execute(
    `SELECT F_Id, stock_code, stock_name, enterprise_full_name_cn, enterprise_full_name_display,
            industry_category_4, product_intro, company_intro, baike_lemma_status
     FROM ipo_new_share
     WHERE baike_lemma_status IS NULL
     ${catFilter}
     ORDER BY F_Id ASC`
  );

  const work = rows.slice(0, opts.limit);
  console.log(`[newShareBaikeBrowser] 待查词: ${rows.length} | 本次处理: ${work.length}${opts.dryRun ? ' (dry-run)' : ''}`);

  if (!work.length) {
    console.log('[newShareBaikeBrowser] 无待处理记录，退出');
    await pool.end();
    return;
  }

  const stats = { total: work.length, found: 0, not_found: 0, anti_crawl: 0, error: 0, intro_updated: 0 };

  for (let i = 0; i < work.length; i += opts.batchSize) {
    const batch = work.slice(i, i + opts.batchSize);
    const companies = batch.map((r) => ({
      company_name:
        String(r.enterprise_full_name_cn || '').trim() ||
        String(r.enterprise_full_name_display || '').trim() ||
        String(r.stock_name || '').trim(),
      company_credit_code: null,
    }));

    let results;
    try {
      results = await fetchBaikeBrowserBatch(companies, {
        sleepMs: opts.sleepMs,
        fastItemOnly: opts.fastItemOnly,
        pageTimeoutMs: opts.timeoutMs,
        captchaWaitMs: opts.timeoutMs,
        useWorker: false,
      });
    } catch (e) {
      console.warn(`[newShareBaikeBrowser] batch ${i / opts.batchSize + 1} 失败:`, e.message);
      stats.error += batch.length;
      continue;
    }

    for (let j = 0; j < batch.length; j += 1) {
      const row = batch[j];
      const baike = results && results[j];
      if (!baike) {
        stats.error += 1;
        continue;
      }

      const status = baike.lemma_status || (baike.ok && baike.has_lemma ? 'found' : 'not_found');
      const missReason = baike.miss_reason || null;
      const baikeUrl = baike.baike_url || null;

      if (status === 'found') stats.found += 1;
      else if (missReason === 'anti_crawl') stats.anti_crawl += 1;
      else stats.not_found += 1;

      if (opts.dryRun) continue;

      const productIntro = baike.product_intro || baike.company_intro || null;
      const companyIntro = baike.company_intro || null;
      const hasNewIntro = productIntro && String(productIntro).trim().length >= 20 &&
        (!row.product_intro || String(row.product_intro).trim().length < 20);

      await pool.execute(
        `UPDATE ipo_new_share
         SET baike_lemma_url = ?,
             baike_lemma_status = ?,
             baike_miss_reason = ?,
             product_intro = CASE WHEN ? = 1 AND (product_intro IS NULL OR LENGTH(TRIM(product_intro)) < 20) THEN ? ELSE product_intro END,
             company_intro = CASE WHEN company_intro IS NULL OR LENGTH(TRIM(company_intro)) < 20 THEN COALESCE(?, company_intro) ELSE company_intro END,
             profile_source = CASE WHEN ? = 1 AND (profile_source IS NULL OR profile_source = '') THEN 'baike' ELSE profile_source END,
             F_LastModifyTime = NOW()
         WHERE F_Id = ?`,
        [
          baikeUrl,
          status,
          missReason,
          hasNewIntro ? 1 : 0,
          productIntro,
          companyIntro,
          hasNewIntro ? 1 : 0,
          row.F_Id,
        ]
      );

      if (hasNewIntro) stats.intro_updated += 1;
    }

    const done = Math.min(i + opts.batchSize, work.length);
    if (done % 100 === 0 || done === work.length) {
      console.log(
        `[newShareBaikeBrowser] 进度 ${done}/${work.length} | found=${stats.found} not_found=${stats.not_found} anti_crawl=${stats.anti_crawl} error=${stats.error} intro_updated=${stats.intro_updated}`
      );
    }

    if (opts.sleepMs > 0 && i + opts.batchSize < work.length) await sleep(opts.sleepMs);
  }

  await closeBrowserWorker();
  await pool.end();

  console.log('[newShareBaikeBrowser] 完成!', stats);
}

main().catch((e) => {
  console.error('[newShareBaikeBrowser] 致命错误:', e);
  process.exit(1);
});
