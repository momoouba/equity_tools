/**
 * P3：wewe 专队提取调度
 * - extract_start（默认 21:00）：标记所有 active+mapped 为 extract_pending
 * - 每 poll_interval_minutes：提取 1 个号
 * - 会话失效暂停；恢复后共用同一队列补提
 */
const cron = require('node-cron');
const {
  getWewePrivateConfig
} = require('./wewePrivateTeam');
const {
  markAllActiveForExtract,
  runExtractTick,
  isExtractEnabled,
  formatBeijingYmd
} = require('./weweExtractService');

let startJob = null;
let tickJob = null;
let runningTick = false;

function parseHm(hm, fallbackH, fallbackM) {
  const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: fallbackH, mi: fallbackM };
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return { h, mi };
}

async function updateWeweExtractScheduledTasks() {
  if (startJob) {
    try {
      startJob.stop();
    } catch (_) {
      /* ignore */
    }
    startJob = null;
  }
  if (tickJob) {
    try {
      tickJob.stop();
    } catch (_) {
      /* ignore */
    }
    tickJob = null;
  }

  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.extract_enabled) !== 1) {
    console.log('[wewe提取调度] 未启用（需 wewe_enabled + extract_enabled），跳过注册');
    return { registered: false };
  }

  const { h, mi } = parseHm(cfg.extract_start || '21:00', 21, 0);
  const interval = Math.min(60, Math.max(1, parseInt(cfg.poll_interval_minutes, 10) || 5));

  // 每日 extract_start：入队
  const startCron = `${mi} ${h} * * *`;
  startJob = cron.schedule(
    startCron,
    async () => {
      try {
        console.log(`[wewe提取调度] extract_start 触发 ${formatBeijingYmd()}`);
        await markAllActiveForExtract();
      } catch (e) {
        console.error('[wewe提取调度] markAll 失败:', e.message);
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  // 每 interval 分钟 tick 1 个（全天可跑；无 pending 则 idle。会话暂停时 skip）
  const tickCron = `*/${interval} * * * *`;
  tickJob = cron.schedule(
    tickCron,
    async () => {
      if (runningTick) return;
      runningTick = true;
      try {
        if (!(await isExtractEnabled())) return;
        const result = await runExtractTick();
        if (result.action !== 'idle_empty_queue' && result.action !== 'skip_paused' && result.action !== 'skip_disabled') {
          console.log('[wewe提取调度] tick', result);
        }
      } catch (e) {
        console.error('[wewe提取调度] tick 失败:', e.message);
      } finally {
        runningTick = false;
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  console.log(
    `[wewe提取调度] 已注册 start=${startCron} tick=*/${interval} * * * * (Asia/Shanghai)`
  );
  return { registered: true, startCron, interval };
}

async function initializeWeweExtractScheduledTasks() {
  try {
    await updateWeweExtractScheduledTasks();
  } catch (e) {
    console.error('[wewe提取调度] 初始化失败:', e.message);
  }
}

module.exports = {
  updateWeweExtractScheduledTasks,
  initializeWeweExtractScheduledTasks
};
