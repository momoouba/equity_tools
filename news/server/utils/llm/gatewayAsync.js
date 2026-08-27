'use strict';

function isGatewayAsyncResponsesEnabled() {
  const v = String(process.env.LLM_GATEWAY_ASYNC_RESPONSES ?? '1')
    .trim()
    .toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function getResponsesPollIntervalMs() {
  return Math.max(
    1000,
    Math.min(60000, parseInt(process.env.LLM_RESPONSES_POLL_INTERVAL_MS || '3000', 10) || 3000)
  );
}

function getResponsesPollMaxMs() {
  return Math.max(
    60000,
    Math.min(
      3600000,
      parseInt(process.env.LLM_RESPONSES_POLL_MAX_MS || '600000', 10) || 600000
    )
  );
}

/** background 模式下 POST 只等任务入队/返回 id；联网检索场景网关可能较慢，提交超时需放宽 */
function getResponsesSubmitTimeoutMs(fallbackMs = 120000, opts = {}) {
  const wantSearch = !!opts.wantSearch;
  const envRaw = wantSearch
    ? process.env.LLM_RESPONSES_WEB_SUBMIT_TIMEOUT_MS ||
      process.env.LLM_RESPONSES_SUBMIT_TIMEOUT_MS ||
      '600000'
    : process.env.LLM_RESPONSES_SUBMIT_TIMEOUT_MS || '90000';
  const envMs = parseInt(envRaw, 10) || (wantSearch ? 600000 : 90000);
  const floor = wantSearch ? 60000 : 15000;
  // 联网提交：网关入队偶发很慢；允许 env 放到 15min。取 env 与调用方 timeout 的较大值，避免 fallback=180s 盖掉 env=600s。
  const ceil = wantSearch ? 900000 : 180000;
  const preferred = Math.max(envMs, fallbackMs > 0 ? fallbackMs : 0);
  return Math.max(floor, Math.min(ceil, preferred || envMs));
}

module.exports = {
  isGatewayAsyncResponsesEnabled,
  getResponsesPollIntervalMs,
  getResponsesPollMaxMs,
  getResponsesSubmitTimeoutMs,
};
