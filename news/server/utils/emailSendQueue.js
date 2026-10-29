/**
 * 全局邮件发送队列：定时/手动入队，串行执行，避免同刻多任务抢 AI/DB。
 * 同一 recipientId 已在队列或执行中则去重跳过。
 */

const EMAIL_SEND_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.EMAIL_SEND_TIMEOUT_MS) || 20 * 60 * 1000
);

/** @type {Array<{ key: string, label: string, source: string, enqueuedAt: number, run: () => Promise<any>, resolveWait?: Function, rejectWait?: Function }>} */
const queue = [];
const queuedKeys = new Set();
let runningKey = null;
let drainPromise = null;

function queueSnapshot() {
  return {
    running: runningKey,
    queued: queue.map((j) => j.key),
    length: queue.length + (runningKey ? 1 : 0),
    timeoutMs: EMAIL_SEND_TIMEOUT_MS,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.key 去重键（通常为 recipientId）
 * @param {string} [opts.label]
 * @param {string} [opts.source] cron | manual | listing-test | ...
 * @param {() => Promise<any>} opts.run
 * @param {boolean} [opts.wait] 是否等到本任务结束（或超时）
 * @returns {Promise<{ enqueued: boolean, reason?: string, ok?: boolean, result?: any, timedOut?: boolean }>}
 */
function enqueueEmailJob(opts) {
  const key = String(opts.key || '').trim();
  if (!key) {
    return Promise.reject(new Error('enqueueEmailJob: key 不能为空'));
  }
  if (typeof opts.run !== 'function') {
    return Promise.reject(new Error('enqueueEmailJob: run 必须是函数'));
  }
  const source = opts.source || 'unknown';
  const label = opts.label || key;
  const wait = opts.wait === true;

  if (runningKey === key || queuedKeys.has(key)) {
    console.log(
      `[邮件发送队列] 跳过重复入队 key=${key} source=${source}（已在队列或执行中） ` +
        `snapshot=${JSON.stringify(queueSnapshot())}`
    );
    if (!wait) {
      return Promise.resolve({ enqueued: false, reason: 'duplicate' });
    }
    // 等待现有同 key 任务结束后再返回（不二次执行）
    return waitUntilKeyIdle(key).then(() => ({
      enqueued: false,
      reason: 'duplicate',
      ok: true,
    }));
  }

  let resolveWait;
  let rejectWait;
  const waitPromise = wait
    ? new Promise((res, rej) => {
        resolveWait = res;
        rejectWait = rej;
      })
    : null;

  queuedKeys.add(key);
  queue.push({
    key,
    label,
    source,
    enqueuedAt: Date.now(),
    run: opts.run,
    resolveWait,
    rejectWait,
  });
  console.log(
    `[邮件发送队列] 入队 key=${key} label=${label} source=${source} ` +
      `queueLen=${queue.length} timeoutMs=${EMAIL_SEND_TIMEOUT_MS}`
  );
  kickDrain();

  if (wait) return waitPromise;
  return Promise.resolve({ enqueued: true, queueLen: queue.length });
}

function waitUntilKeyIdle(key) {
  return new Promise((resolve) => {
    const tick = () => {
      if (runningKey !== key && !queuedKeys.has(key) && !queue.some((j) => j.key === key)) {
        resolve();
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

function kickDrain() {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    while (queue.length) {
      const job = queue.shift();
      queuedKeys.delete(job.key);
      runningKey = job.key;
      const waitedMs = Date.now() - job.enqueuedAt;
      console.log(
        `[邮件发送队列] 开始执行 key=${job.key} label=${job.label} source=${job.source} ` +
          `排队等待=${waitedMs}ms 剩余队列=${queue.length}`
      );

      const runPromise = Promise.resolve()
        .then(() => job.run())
        .then((result) => ({ ok: true, result }))
        .catch((err) => ({ ok: false, error: err }));

      let timedOut = false;
      let outcome;
      try {
        outcome = await Promise.race([
          runPromise,
          new Promise((_, reject) => {
            setTimeout(() => {
              timedOut = true;
              reject(
                Object.assign(new Error(`邮件发送超时（${EMAIL_SEND_TIMEOUT_MS}ms） key=${job.key}`), {
                  code: 'EMAIL_SEND_TIMEOUT',
                })
              );
            }, EMAIL_SEND_TIMEOUT_MS);
          }),
        ]);
      } catch (timeoutErr) {
        console.error(`[邮件发送队列] ${timeoutErr.message || timeoutErr}`);
        if (job.rejectWait) {
          try {
            job.rejectWait(timeoutErr);
          } catch (_) {
            /* ignore */
          }
          job.resolveWait = null;
          job.rejectWait = null;
        }
        // 超时后仍等原任务结束再跑下一条，避免并发叠加
        console.warn(
          `[邮件发送队列] 超时后等待原任务结束再继续串行 key=${job.key}（避免并发叠加）`
        );
        outcome = await runPromise;
        timedOut = true;
      }

      if (outcome && outcome.ok) {
        console.log(
          `[邮件发送队列] 执行完成 key=${job.key}` +
            (timedOut ? '（此前已超时告警，任务最终跑完）' : '')
        );
        if (job.resolveWait) {
          job.resolveWait({
            enqueued: true,
            ok: true,
            result: outcome.result,
            timedOut,
          });
        }
      } else {
        const err = (outcome && outcome.error) || new Error('邮件发送失败');
        console.error(
          `[邮件发送队列] 执行失败 key=${job.key}:`,
          err.message || err
        );
        if (job.rejectWait) {
          job.rejectWait(err);
        } else if (job.resolveWait) {
          job.resolveWait({ enqueued: true, ok: false, error: err.message, timedOut });
        }
      }
      runningKey = null;
    }
  })()
    .catch((e) => {
      console.error('[邮件发送队列] drain 异常:', e.message || e);
      runningKey = null;
    })
    .finally(() => {
      drainPromise = null;
      if (queue.length) kickDrain();
    });

  return drainPromise;
}

module.exports = {
  enqueueEmailJob,
  queueSnapshot,
  EMAIL_SEND_TIMEOUT_MS,
};
