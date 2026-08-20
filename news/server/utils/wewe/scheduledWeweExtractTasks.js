/**
 * P3：wewe 专队提取调度
 * - extract_start：当晚入队，抓当天 21:00 前的稿
 * - catchup_extract_start：隔日补抓入队，抓昨天（含 21:00 后）
 * - 每分钟巡检；有文后等 poll_interval_minutes，空号/失败等 1 分钟再提下一个
 * - 排队：上次 success 优先，empty 最后
 * - 会话失效暂停；恢复后共用同一队列补提
 * - 隔日补抓队列清空后补一次入库，避免晚于 ingest_at 的稿漏进当天新闻
 */
const cron = require('node-cron');
const {
  getWewePrivateConfig
} = require('./wewePrivateTeam');
const {
  markAllActiveForExtract,
  catchUpExtractQueueAfterRestart,
  runExtractTick,
  isExtractEnabled,
  formatBeijingYmd,
  parseHmToMinutes
} = require('./weweExtractService');

const EMPTY_INTERVAL_MINUTES = 1;

let startJob = null;
let catchupJob = null;
let tickJob = null;
let runningTick = false;
/** 下次允许提取的时间戳（毫秒）；进程重启后归零，会立刻提一个 */
let nextTickAllowedAt = 0;
/** 隔日补抓队列清空后已补入库的北京日，避免每分钟重复入库 */
let catchupIngestDoneYmd = '';

function delayMinutesForResult(result, longMinutes) {
  if (!result || !result.action) return 0;
  if (
    result.action === 'idle_empty_queue' ||
    result.action === 'skip_paused' ||
    result.action === 'skip_disabled' ||
    result.action === 'skip_idle_window' ||
    result.action === 'session_dead'
  ) {
    return 0;
  }
  if (result.action === 'wewe_unavailable') {
    return EMPTY_INTERVAL_MINUTES;
  }
  const hadArticle =
    result.status === 'success' ||
    result.status === 'partial' ||
    Number(result.staged) > 0;
  return hadArticle ? longMinutes : EMPTY_INTERVAL_MINUTES;
}

function parseHm(hm, fallbackH, fallbackM) {
  const fallback = fallbackH * 60 + fallbackM;
  const total = parseHmToMinutes(hm, fallback);
  return { h: Math.floor(total / 60), mi: total % 60 };
}

async function maybeIngestAfterCatchupIdle(result) {
  if (!result || result.action !== 'idle_empty_queue' || result.extractKind !== 'catchup') {
    return;
  }
  const today = formatBeijingYmd();
  if (catchupIngestDoneYmd === today) return;
  const cfg = await getWewePrivateConfig();
  const ingestMin = parseHmToMinutes((cfg && cfg.ingest_at) || '07:00', 7 * 60);
  const nowMin = parseHmToMinutes(
    new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(11, 16),
    0
  );
  if (nowMin < ingestMin) return;
  try {
    const { triggerIngestTick } = require('./scheduledWeweIngestTasks');
    console.log(`[wewe提取调度] 隔日补抓队列已空且已过入库时刻，补入库 ${today}`);
    const ingestResult = await triggerIngestTick('catchup_idle');
    if (ingestResult && ingestResult.action !== 'skip_busy') {
      catchupIngestDoneYmd = today;
    }
    console.log('[wewe提取调度] 隔日补抓后入库', {
      action: ingestResult.action,
      pending: ingestResult.pending,
      ingested: ingestResult.ingested
    });
  } catch (e) {
    console.warn(`[wewe提取调度] 隔日补抓后入库失败: ${e.message}`);
  }
}

function stopJob(job) {
  if (!job) return null;
  try {
    job.stop();
  } catch (_) {
    /* ignore */
  }
  return null;
}

async function updateWeweExtractScheduledTasks() {
  startJob = stopJob(startJob);
  catchupJob = stopJob(catchupJob);
  tickJob = stopJob(tickJob);

  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.extract_enabled) !== 1) {
    console.log('[wewe提取调度] 未启用（需 wewe_enabled + extract_enabled），跳过注册');
    return { registered: false };
  }

  const { h, mi } = parseHm(cfg.extract_start || '21:00', 21, 0);
  const catchup = parseHm(cfg.catchup_extract_start || '06:00', 6, 0);
  const interval = Math.min(60, Math.max(1, parseInt(cfg.poll_interval_minutes, 10) || 5));

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

  const catchupCron = `${catchup.mi} ${catchup.h} * * *`;
  catchupJob = cron.schedule(
    catchupCron,
    async () => {
      try {
        const ymd = formatBeijingYmd();
        console.log(`[wewe提取调度] catchup_extract_start 触发 ${ymd}（抓昨天 21:00 后）`);
        nextTickAllowedAt = 0;
        catchupIngestDoneYmd = '';
        await markAllActiveForExtract();
      } catch (e) {
        console.error('[wewe提取调度] 隔日补抓 markAll 失败:', e.message);
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

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
        if (
          result.action !== 'idle_empty_queue' &&
          result.action !== 'skip_paused' &&
          result.action !== 'skip_disabled' &&
          result.action !== 'skip_idle_window'
        ) {
          console.log('[wewe提取调度] tick', { ...result, nextWaitMin: waitMin });
        }
        await maybeIngestAfterCatchupIdle(result);
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
    `[wewe提取调度] 已注册 start=${startCron} catchup=${catchupCron} tick=* * * * * empty=${EMPTY_INTERVAL_MINUTES}m success=${interval}m (Asia/Shanghai)`
  );
  return {
    registered: true,
    startCron,
    catchupCron,
    interval,
    emptyInterval: EMPTY_INTERVAL_MINUTES
  };
}

async function initializeWeweExtractScheduledTasks() {
  try {
    const reg = await updateWeweExtractScheduledTasks();
    if (reg && reg.registered) {
      await catchUpExtractQueueAfterRestart();
      nextTickAllowedAt = 0;
    }
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
