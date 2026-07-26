/**
 * 独立 apply 脚本：跳过 DB 初始化，直接从 JSONL 写库
 * 用法：node scripts/applyBaikeFromJsonl.js [--concurrency=8] [--batch-size=100]
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { applyBaikeToFinancingFanOut } = require('../utils/project-sourcing/baikeLookupService');

const DEFAULT_PENDING = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2b融资百科查词pending.jsonl');

function parseArgs() {
  const out = { concurrency: 8, batchSize: 100, pendingFile: DEFAULT_PENDING };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--concurrency=')) out.concurrency = Math.max(1, Math.min(16, parseInt(a.slice(14), 10) || 8));
    else if (a.startsWith('--batch-size=')) out.batchSize = Math.max(10, parseInt(a.slice(13), 10) || 100);
    else if (a.startsWith('--pending-file=')) out.pendingFile = path.resolve(a.slice(15));
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

async function main() {
  const opts = parseArgs();
  console.log('[applyBaikeFromJsonl] 开始', opts);

  const lines = fs.readFileSync(opts.pendingFile, 'utf8').trim().split('\n');
  const checkpoint = loadCheckpoint(opts.pendingFile);
  const startFrom = checkpoint.applied;

  console.log('[applyBaikeFromJsonl] JSONL 总:', lines.length, '已写库:', startFrom, '剩余:', lines.length - startFrom);

  let applied = 0;
  let skipped = 0;
  let errors = 0;

  async function applyBatch(startIdx, batchSize) {
    const end = Math.min(startIdx + batchSize, lines.length);
    const promises = [];
    for (let i = startIdx; i < end; i++) {
      const record = JSON.parse(lines[i]);
      promises.push(
        applyBaikeToFinancingFanOut(db, record.company, record.baike, { skipFanOutCount: true })
          .then(() => { applied++; })
          .catch(e => {
            if (e.errno === 1205 || e.code === 'ER_LOCK_WAIT_TIMEOUT' || e.code === 'ER_LOCK_DEADLOCK') {
              skipped++;
            } else {
              errors++;
              if (errors <= 10) console.error('[applyBaikeFromJsonl] Error:', record.company?.company_name, e.message);
            }
          })
      );
    }
    await Promise.all(promises);
    return end;
  }

  const startTime = Date.now();
  for (let i = startFrom; i < lines.length; i += opts.batchSize) {
    await applyBatch(i, opts.batchSize);

    // Save checkpoint every batch
    saveCheckpoint(opts.pendingFile, Math.min(i + opts.batchSize, lines.length));

    // Progress report every 500 records
    if ((i - startFrom) % 500 === 0 && i > startFrom) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i - startFrom) / elapsed;
      const remaining = lines.length - i;
      const eta = remaining / rate;
      console.log(`[applyBaikeFromJsonl] 进度: ${i - startFrom}/${lines.length - startFrom} | 已写: ${applied} | 跳过: ${skipped} | 错误: ${errors} | 速率: ${rate.toFixed(1)}/s | 预计剩余: ${Math.round(eta)}s`);
    }
  }

  // Final checkpoint
  saveCheckpoint(opts.pendingFile, lines.length);

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`[applyBaikeFromJsonl] 完成! 总耗时: ${Math.round(totalTime)}s | 已写: ${applied} | 跳过: ${skipped} | 错误: ${errors}`);

  await db.closePool();
  process.exit(0);
}

main().catch(e => {
  console.error('[applyBaikeFromJsonl] Fatal:', e);
  db.closePool().finally(() => process.exit(1));
});
