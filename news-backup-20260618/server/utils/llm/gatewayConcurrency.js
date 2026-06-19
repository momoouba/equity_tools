'use strict';

/** 网关（DMGateway 等）Responses 联网请求并发上限，避免长连接占满线程 */
const GATEWAY_LLM_CONCURRENCY_N = Math.max(
  1,
  Math.min(16, parseInt(process.env.LLM_GATEWAY_CONCURRENCY || '2', 10) || 2)
);

const waiters = [];
let active = 0;

function releaseGatewayLlmSlot() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function acquireGatewayLlmSlot() {
  if (active < GATEWAY_LLM_CONCURRENCY_N) {
    active += 1;
    return Promise.resolve(releaseGatewayLlmSlot);
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve(releaseGatewayLlmSlot);
    });
  });
}

async function withGatewayLlmConcurrency(fn) {
  const release = await acquireGatewayLlmSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

module.exports = {
  GATEWAY_LLM_CONCURRENCY_N,
  withGatewayLlmConcurrency,
};
