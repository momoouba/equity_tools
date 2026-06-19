'use strict';

const DEFAULT_GATEWAY_V1 = 'https://gateway.di-matrix.ai/v1';

function isGatewayHost(endpoint) {
  return /di-matrix\.ai|gateway\./i.test(String(endpoint || ''));
}

function stripTrailingSlash(u) {
  return String(u || '').trim().replace(/\/$/, '');
}

function gatewayHostRoot(raw) {
  let u = stripTrailingSlash(raw);
  if (!u) u = DEFAULT_GATEWAY_V1;
  u = u.replace(/\/v1beta\/models\/[^:]+:generateContent$/i, '');
  u = u.replace(/\/(chat\/completions|responses|messages)$/i, '');
  if (/\/v1$/i.test(u)) return u.replace(/\/v1$/i, '');
  return u;
}

/** Anthropic Messages：DMGateway `POST …/v1/messages` */
function normalizeAnthropicMessagesEndpoint(raw) {
  const u = stripTrailingSlash(raw);
  if (!u) return `${DEFAULT_GATEWAY_V1}/messages`;
  if (/\/messages$/i.test(u)) return u;
  if (/\/responses$/i.test(u)) return u.replace(/\/responses$/i, '/messages');
  if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, '/messages');
  if (/\/v1$/i.test(u)) return `${u}/messages`;
  if (isGatewayHost(u)) return `${gatewayHostRoot(u)}/v1/messages`;
  if (/^https?:\/\//i.test(u)) return `${u}/v1/messages`;
  return `${DEFAULT_GATEWAY_V1}/messages`;
}

/** Google Gemini generateContent：DMGateway `POST …/v1beta/models/{model}:generateContent` */
function normalizeGeminiGenerateContentEndpoint(raw, modelName) {
  const model = String(modelName || '').trim();
  if (!model) throw new Error('Gemini generateContent 需要 model_name');
  const u = stripTrailingSlash(raw);
  if (/generateContent$/i.test(u)) return u;
  const host = gatewayHostRoot(u || DEFAULT_GATEWAY_V1.replace(/\/v1$/i, ''));
  return `${host}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

module.exports = {
  normalizeAnthropicMessagesEndpoint,
  normalizeGeminiGenerateContentEndpoint,
};
