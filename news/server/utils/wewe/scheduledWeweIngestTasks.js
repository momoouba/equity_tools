/**
 * P4：wewe 专队工作日入库调度（ingest_at，默认 00:00）
 */
const cron = require('node-cron');
const { getWewePrivateConfig } = require('./wewePrivateTeam');
const { runIngestTick, isIngestEnabled, formatBeijingYmd } = require('./weweIngestService');

let ingestJob = null;
let running = false;

function parseHm(hm, fallbackH, fallbackM) {
  const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: fallbackH, mi: fallbackM };
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return { h, mi };
}

async function triggerIngestTick(reason = 'ingest_at') {
  if (running) {
    console.log(`[wewe入库调度] 已在跑，跳过 ${reason}`);
    return { action: 'skip_busy', reason };
  }
  if (!(await isIngestEnabled()) && reason !== 'force') {
    return { action: 'skip_disabled' };
  }
  running = true;
  try {
    console.log(`[wewe入库调度] ${reason} 触发 ${formatBeijingYmd()}`);
    const result = await runIngestTick();
    console.log('[wewe入库调度] 结果', {
      action: result.action,
      ingestYmd: result.ingestYmd,
      pending: result.pending,
      ingested: result.ingested,
      skipped: result.skipped,
      failed: result.failed,
      bizDates: result.bizDates,
      reason
    });
    return result;
  } catch (e) {
    console.error('[wewe入库调度] 失败:', e.message);
    return { action: 'error', error: e.message };
  } finally {
    running = false;
  }
}

async function updateWeweIngestScheduledTasks() {
  if (ingestJob) {
    try {
      ingestJob.stop();
    } catch (_) {
      /* ignore */
    }
    ingestJob = null;
  }

  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.ingest_enabled) !== 1) {
    console.log('[wewe入库调度] 未启用（需 wewe_enabled + ingest_enabled），跳过注册');
    return { registered: false };
  }

  const { h, mi } = parseHm(cfg.ingest_at || '00:00', 0, 0);
  const expr = `${mi} ${h} * * *`;

  ingestJob = cron.schedule(
    expr,
    async () => {
      await triggerIngestTick('ingest_at');
    },
    { timezone: 'Asia/Shanghai' }
  );

  console.log(`[wewe入库调度] 已注册 cron=${expr} (Asia/Shanghai)`);
  return { registered: true, cron: expr };
}

async function initializeWeweIngestScheduledTasks() {
  try {
    await updateWeweIngestScheduledTasks();
  } catch (e) {
    console.error('[wewe入库调度] 初始化失败:', e.message);
  }
}

module.exports = {
  updateWeweIngestScheduledTasks,
  initializeWeweIngestScheduledTasks,
  triggerIngestTick
};
