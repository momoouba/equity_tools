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

module.exports = {
  isGatewayAsyncResponsesEnabled,
  getResponsesPollIntervalMs,
  getResponsesPollMaxMs,
};
