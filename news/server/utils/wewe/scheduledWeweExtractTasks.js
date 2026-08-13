/**
 * P3：wewe 专队提取调度
 * - extract_start：标记所有 active+mapped 为 extract_pending
 * - 每分钟巡检；有文后等 poll_interval_minutes，空号/失败等 1 分钟再提下一个
 * - 排队：上次 success 优先，empty 最后
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

const EMPTY_INTERVAL_MINUTES = 1;

let startJob = null;
let tickJob = null;
let runningTick = false;
/** 下次允许提取的时间戳（毫秒）；进程重启后归零，会立刻提一个 */
let nextTickAllowedAt = 0;

function delayMinutesForResult(result, longMinutes) {
  if (!result || !result.action) return 0;
  if (
    result.action === 'idle_empty_queue' ||
    result.action === 'skip_paused' ||
    result.action === 'skip_disabled' ||
    result.action === 'session_dead'
  ) {
    return 0;
  }
  const hadArticle =
    result.status === 'success' ||
    Number(result.staged) > 0 ||
    Number(result.matchedDay) > 0;
  return hadArticle ? longMinutes : EMPTY_INTERVAL_MINUTES;
}

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
        nextTickAllowedAt = 0;
        await markAllActiveForExtract();
      } catch (e) {
        console.error('[wewe提取调度] markAll 失败:', e.message);
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  // 每分钟巡检 1 次；实际是否提取由 nextTickAllowedAt 节流
  tickJob = cron.schedule(
    '* * * * *',
    async () => {
      if (runningTick) return;
      if (Date.now() < nextTickAllowedAt) return;
      runningTick = true;
      try {
        if (!(await isExtractEnabled())) return;
        const result = await runExtractTick();
        const waitMin = delayMinutesForResult(result, interval);
        if (waitMin > 0) {
          nextTickAllowedAt = Date.now() + waitMin * 60 * 1000;
        }
        if (result.action !== 'idle_empty_queue' && result.action !== 'skip_paused' && result.action !== 'skip_disabled') {
          console.log('[wewe提取调度] tick', { ...result, nextWaitMin: waitMin });
        }
      } catch (e) {
        console.error('[wewe提取调度] tick 失败:', e.message);
        nextTickAllowedAt = Date.now() + EMPTY_INTERVAL_MINUTES * 60 * 1000;
      } finally {
        runningTick = false;
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  console.log(
    `[wewe提取调度] 已注册 start=${startCron} tick=* * * * * empty=${EMPTY_INTERVAL_MINUTES}m success=${interval}m (Asia/Shanghai)`
  );
  return { registered: true, startCron, interval, emptyInterval: EMPTY_INTERVAL_MINUTES };
}

async function initializeWeweExtractScheduledTasks() {
  try {
    await updateWeweExtractScheduledTasks();
  } catch (e) {
    console.error('[wewe提取调度] 初始化失败:', e.message);
  }
}

async function applyExtractTickDelay(result) {
  const cfg = await getWewePrivateConfig();
  const interval = Math.min(60, Math.max(1, parseInt(cfg && cfg.poll_interval_minutes, 10) || 5));
  const waitMin = delayMinutesForResult(result, interval);
  nextTickAllowedAt = waitMin > 0 ? Date.now() + waitMin * 60 * 1000 : 0;
  return waitMin;
}

function resetExtractTickGate() {
  nextTickAllowedAt = 0;
}

module.exports = {
  updateWeweExtractScheduledTasks,
  initializeWeweExtractScheduledTasks,
  applyExtractTickDelay,
  resetExtractTickGate
};
