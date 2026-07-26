/**
 * 独立 apply 脚本 v2：最小化 DB 连接，跳过完整初始化
 * 用法：node scripts/applyBaikeFromJsonl2.js [--concurrency=8] [--batch-size=100]
 */
require('dotenv').config({ override: false });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// 最小化 DB 连接，不走 db.js 的完整初始化
async function createMinimalPool() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'investment_tools',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  return pool;
}

const DEFAULT_PENDING = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2b融资百科查词pending.jsonl');

function parseArgs() {
  const out = { concurrency: 2, batchSize: 50, pendingFile: DEFAULT_PENDING, delayMs: 100 };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--concurrency=')) out.concurrency = Math.max(1, Math.min(16, parseInt(a.slice(14), 10) || 2));
    else if (a.startsWith('--batch-size=')) out.batchSize = Math.max(10, parseInt(a.slice(13), 10) || 50);
    else if (a.startsWith('--pending-file=')) out.pendingFile = path.resolve(a.slice(15));
    else if (a.startsWith('--delay-ms=')) out.delayMs = Math.max(0, parseInt(a.slice(11), 10) || 100);
  }
  return out;
}

function loadCheckpoint(pendingFile) {
  const cpFile = pendingFile + '.checkpoint.json';
  if (!fs.existsSync(cpFile)) return { applied: 0 };
  return JSON.parse(fs.readFileSync(cpFile, 'utf8'));
}

function saveCheckpoint(pendingFile, applied) {
  const cpFile = pendingFile + '.checkpoint.json';
  fs.writeFileSync(cpFile, JSON.stringify({ applied, updated_at: new Date().toISOString() }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 简化的 apply 函数，直接更新 DB
async function applyBaikeRecord(pool, company, baike) {
  const creditCode = company.company_credit_code ? String(company.company_credit_code).trim() : '';
  const companyName = company.company_name ? String(company.company_name).trim() : '';

  if (!creditCode && !companyName) return { updated: 0, profile_updated: 0 };

  const lemmaUrl = baike && baike.ok && baike.lemma_url ? baike.lemma_url : null;
  const lemmaStatus = baike && baike.ok ? (baike.has_lemma ? 'found' : 'not_found') : null;
  const missReason = baike && !baike.ok ? (baike.miss_reason || 'error') : null;

  // Update sourcing_financing_event
  let updated = 0;
  if (creditCode) {
    const [result] = await pool.execute(
      `UPDATE sourcing_financing_event SET
        baike_lemma_url = ?,
        baike_lemma_status = ?,
        baike_miss_reason = ?,
        baike_lookup_at = CURRENT_TIMESTAMP,
        F_LastModifyTime = CURRENT_TIMESTAMP
      WHERE F_DeleteMark = 0 AND company_credit_code = ? AND baike_lookup_at IS NULL`,
      [lemmaUrl, lemmaStatus, missReason, creditCode]
    );
    updated = result.affectedRows || 0;
  } else if (companyName) {
    const [result] = await pool.execute(
      `UPDATE sourcing_financing_event SET
        baike_lemma_url = ?,
        baike_lemma_status = ?,
        baike_miss_reason = ?,
        baike_lookup_at = CURRENT_TIMESTAMP,
        F_LastModifyTime = CURRENT_TIMESTAMP
      WHERE F_DeleteMark = 0 AND company_name = ? AND (company_credit_code IS NULL OR company_credit_code = '') AND baike_lookup_at IS NULL`,
      [lemmaUrl, lemmaStatus, missReason, companyName]
    );
    updated = result.affectedRows || 0;
  }

  return { updated, profile_updated: 0 };
}

async function main() {
  const opts = parseArgs();
  console.log('[applyBaikeFromJsonl2] 开始', opts);

  const pool = await createMinimalPool();
  console.log('[applyBaikeFromJsonl2] DB 连接已建立');

  const lines = fs.readFileSync(opts.pendingFile, 'utf8').trim().split('\n');
  const checkpoint = loadCheckpoint(opts.pendingFile);
  const startFrom = checkpoint.applied;

  console.log('[applyBaikeFromJsonl2] JSONL 总:', lines.length, '已写库:', startFrom, '剩余:', lines.length - startFrom);

  let applied = 0;
  let skipped = 0;
  let errors = 0;

  async function applyBatch(startIdx, batchSize) {
    const end = Math.min(startIdx + batchSize, lines.length);
    const promises = [];
    for (let i = startIdx; i < end; i++) {
      const record = JSON.parse(lines[i]);
      promises.push(
        applyBaikeRecord(pool, record.company, record.baike)
          .then((result) => { applied += result.updated; })
          .catch(e => {
            if (e.errno === 1205 || e.code === 'ER_LOCK_WAIT_TIMEOUT' || e.code === 'ER_LOCK_DEADLOCK') {
              skipped++;
            } else {
              errors++;
              if (errors <= 10) console.error('[applyBaikeFromJsonl2] Error:', record.company?.company_name, e.message);
            }
          })
      );
    }
    await Promise.all(promises);
    return end;
  }

  const startTime = Date.now();
  console.log('[applyBaikeFromJsonl2] 开始写库循环...');
  for (let i = startFrom; i < lines.length; i += opts.batchSize) {
    if (i === startFrom) console.log('[applyBaikeFromJsonl2] 进入第一批...');
    await applyBatch(i, opts.batchSize);
    if (i === startFrom) console.log('[applyBaikeFromJsonl2] 第一批完成');

    // Save checkpoint every batch
    saveCheckpoint(opts.pendingFile, Math.min(i + opts.batchSize, lines.length));

    // Delay between batches to reduce lock contention
    if (opts.delayMs > 0) await sleep(opts.delayMs);

    // Progress report every 500 records
    if ((i - startFrom) % 500 === 0 && i > startFrom) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i - startFrom) / elapsed;
      const remaining = lines.length - i;
      const eta = remaining / rate;
      console.log(`[applyBaikeFromJsonl2] 进度: ${i - startFrom}/${lines.length - startFrom} | 已写: ${applied} | 跳过: ${skipped} | 错误: ${errors} | 速率: ${rate.toFixed(1)}/s | 预计剩余: ${Math.round(eta)}s`);
    }
  }

  // Final checkpoint
  saveCheckpoint(opts.pendingFile, lines.length);

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`[applyBaikeFromJsonl2] 完成! 总耗时: ${Math.round(totalTime)}s | 已写: ${applied} | 跳过: ${skipped} | 错误: ${errors}`);

  await pool.end();
  process.exit(0);
}

main().catch(e => {
  console.error('[applyBaikeFromJsonl2] Fatal:', e);
  process.exit(1);
});
