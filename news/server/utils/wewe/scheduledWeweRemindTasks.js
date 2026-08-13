/**
 * P5：催办调度 — 扫码巡检 + 待订阅日催
 */
const cron = require('node-cron');
const { getWewePrivateConfig } = require('./wewePrivateTeam');
const {
  runScanRemindTick,
  runPendingSubscribeRemindTick
} = require('./weweRemindService');

let scanJob = null;
let pendingJob = null;
let runningScan = false;
let runningPending = false;

async function updateWeweRemindScheduledTasks() {
  if (scanJob) {
    try {
      scanJob.stop();
    } catch (_) {
      /* ignore */
    }
    scanJob = null;
  }
  if (pendingJob) {
    try {
      pendingJob.stop();
    } catch (_) {
      /* ignore */
    }
    pendingJob = null;
  }

  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.remind_enabled) !== 1) {
    console.log('[wewe催办调度] 未启用（需 wewe_enabled + remind_enabled），跳过注册');
    return { registered: false };
  }

  // 每 10 分钟巡检扫码催办（内部再按 2h/30min 节流）
  scanJob = cron.schedule(
    '*/10 * * * *',
    async () => {
      if (runningScan) return;
      runningScan = true;
      try {
        const result = await runScanRemindTick();
        if (result.action === 'sent' || result.action.startsWith('not_sent')) {
          console.log('[wewe催办调度] scan', result.action, result.kind);
        }
      } catch (e) {
        console.error('[wewe催办调度] scan 失败:', e.message);
      } finally {
        runningScan = false;
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  // 每天 12:00 待订阅催办
  pendingJob = cron.schedule(
    '0 12 * * *',
    async () => {
      if (runningPending) return;
      runningPending = true;
      try {
        const result = await runPendingSubscribeRemindTick();
        console.log('[wewe催办调度] pending_subscribe', result.action, result.count);
      } catch (e) {
        console.error('[wewe催办调度] pending 失败:', e.message);
      } finally {
        runningPending = false;
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  console.log('[wewe催办调度] 已注册 scan=*/10 * * * * pending=0 12 * * * (Asia/Shanghai)');
  return { registered: true };
}

async function initializeWeweRemindScheduledTasks() {
  try {
    await updateWeweRemindScheduledTasks();
  } catch (e) {
    console.error('[wewe催办调度] 初始化失败:', e.message);
  }
}

module.exports = {
  updateWeweRemindScheduledTasks,
  initializeWeweRemindScheduledTasks
};
