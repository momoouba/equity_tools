'use strict';

const { normalizeDashScopeChatEndpoint } = require('../dashScopeOpenAICompat');
const { WIRE_PROTOCOL } = require('./llmConstants');
const {
  normalizeAnthropicMessagesEndpoint,
  normalizeGeminiGenerateContentEndpoint,
} = require('./gatewayNativeEndpoint');

const DEFAULT_GATEWAY_V1 = 'https://gateway.di-matrix.ai/v1';

function isGatewayHost(endpoint) {
  return /di-matrix\.ai|gateway\./i.test(String(endpoint || ''));
}

function stripTrailingSlash(u) {
  return String(u || '').trim().replace(/\/$/, '');
}

/** @param {string} raw @param {'chat_completions'|'responses'} wire */
function normalizeGatewayEndpoint(raw, wire = WIRE_PROTOCOL.CHAT_COMPLETIONS) {
  let u = stripTrailingSlash(raw);
  if (!u) u = DEFAULT_GATEWAY_V1;

  if (wire === WIRE_PROTOCOL.RESPONSES) {
    if (/\/responses$/i.test(u)) return u;
    if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, '/responses');
    if (/\/v1$/i.test(u)) return `${u}/responses`;
    if (isGatewayHost(u) && !/\/v1/i.test(u)) return `${u}/v1/responses`;
    if (/^https?:\/\//i.test(u) && !/\/v1/i.test(u)) return `${u}/v1/responses`;
    return `${u}/responses`;
  }

  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/responses$/i.test(u)) return u.replace(/\/responses$/i, '/chat/completions');
  if (/\/v1$/i.test(u)) return `${u}/chat/completions`;
  if (isGatewayHost(u) && !/\/v1/i.test(u)) return `${u}/v1/chat/completions`;
  if (/^https?:\/\//i.test(u)) return `${u}/chat/completions`;
  return `${DEFAULT_GATEWAY_V1}/chat/completions`;
}

/**
 * @param {{ api_endpoint?: string, provider?: string, wire_protocol?: string|null }} config
 * @param {import('./llmConstants').WIRE_PROTOCOL[keyof import('./llmConstants').WIRE_PROTOCOL]} wire
 */
function resolveEndpoint(config, wire) {
  const raw = config?.api_endpoint;
  const provider = String(config?.provider || '').toLowerCase();

  if (wire === WIRE_PROTOCOL.ALIBABA_NATIVE) {
    return String(raw || '').trim();
  }

  if (provider === 'gateway' || isGatewayHost(raw)) {
    if (wire === WIRE_PROTOCOL.ANTHROPIC_MESSAGES) {
      return normalizeAnthropicMessagesEndpoint(raw);
    }
    if (wire === WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT) {
      return normalizeGeminiGenerateContentEndpoint(raw, config?.model_name);
    }
    return normalizeGatewayEndpoint(raw, wire);
  }

  if (provider === 'volcengine' || isVolcengineEndpoint(raw)) {
    if (wire === WIRE_PROTOCOL.VOLCENGINE_BOT) {
      return normalizeVolcengineEndpoint(raw, 'bot');
    }
    if (wire === WIRE_PROTOCOL.RESPONSES) {
      return normalizeVolcengineEndpoint(raw, 'responses');
    }
    return normalizeVolcengineEndpoint(raw, 'chat');
  }

  if (provider === 'alibaba' || /dashscope/i.test(String(raw || ''))) {
    return normalizeDashScopeChatEndpoint(raw);
  }

  if (wire === WIRE_PROTOCOL.RESPONSES) {
    return normalizeGatewayEndpoint(raw, WIRE_PROTOCOL.RESPONSES);
  }

  const u = stripTrailingSlash(raw);
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return `${u}/chat/completions`;
  return u || `${DEFAULT_GATEWAY_V1}/chat/completions`;
}

module.exports = {
  DEFAULT_GATEWAY_V1,
  isGatewayHost,
  normalizeGatewayEndpoint,
  resolveEndpoint,
};
