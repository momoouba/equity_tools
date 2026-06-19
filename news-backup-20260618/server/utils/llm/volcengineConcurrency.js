'use strict';

const VOLCENGINE_LLM_CONCURRENCY_N = Math.max(
  1,
  Math.min(16, parseInt(process.env.LLM_VOLCENGINE_CONCURRENCY || '3', 10) || 3)
);

const waiters = [];
let active = 0;

function releaseVolcengineLlmSlot() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function acquireVolcengineLlmSlot() {
  if (active < VOLCENGINE_LLM_CONCURRENCY_N) {
    active += 1;
    return Promise.resolve(releaseVolcengineLlmSlot);
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve(releaseVolcengineLlmSlot);
    });
  });
}

async function withVolcengineLlmConcurrency(fn) {
  const release = await acquireVolcengineLlmSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

module.exports = {
  VOLCENGINE_LLM_CONCURRENCY_N,
  withVolcengineLlmConcurrency,
};
