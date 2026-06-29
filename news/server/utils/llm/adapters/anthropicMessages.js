'use strict';

const axios = require('axios');
const { invokePlainChat } = require('./plainChat');
const { WIRE_PROTOCOL, WEB_SEARCH_MODE } = require('../llmConstants');
const { errorBlob } = require('./openaiResponses');
const {
  anthropicModelOmitsSamplingParams,
  resolveAnthropicTemperature,
} = require('../anthropicModelUtils');

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

function buildAnthropicMessages(systemContent, userContent) {
  const messages = [];
  const usr = String(userContent || '').trim();
  if (usr) messages.push({ role: 'user', content: usr });
  return messages;
}

function extractAnthropicText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const parts = [];
  for (const block of blocks) {
    if (block?.type === 'text' && block.text) parts.push(String(block.text));
  }
  return parts.join('\n').trim();
}

function isAnthropicSearchRejected(err) {
  const blob = errorBlob(err).toLowerCase();
  const status = err?.response?.status;
  return (
    status === 400 &&
    /web_search|tools|unsupported|invalid|not supported/i.test(blob)
  );
}

function isAnthropicTransportError(err) {
  const status = err?.response?.status;
  return status === 404 || status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

/** DMGateway CC 分组：Anthropic 原生仅 x-api-key（与 Claude Code settings 一致） */
function anthropicHeaders(apiKey) {
  const key = String(apiKey || '')
    .trim()
    .replace(/^Bearer\s+/i, '');
  return {
    'Content-Type': 'application/json',
    'anthropic-version': DEFAULT_ANTHROPIC_VERSION,
    'x-api-key': key,
  };
}

function buildWebSearchTools() {
  return [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    },
  ];
}

/**
 * Anthropic Messages API（DMGateway Claude / CC 分组）。
 */
async function invokeAnthropicMessages({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  max_tokens,
  temperature,
  timeout,
  logPrefix = '[llmAnthropic]',
}) {
  const sys = String(systemContent || '').trim();
  const body = {
    model,
    max_tokens: max_tokens || 2048,
    messages: buildAnthropicMessages(systemContent, userContent),
  };
  if (sys) body.system = sys;
  const effTemperature = resolveAnthropicTemperature(model, temperature);
  if (effTemperature !== undefined) body.temperature = effTemperature;
  if (wantSearch) {
    body.tools = buildWebSearchTools();
  }

  const omitSampling = anthropicModelOmitsSamplingParams(model);
  console.log(
    `${logPrefix} POST ${endpoint} model=${model} anthropic_messages web_search=${wantSearch ? 1 : 0}${omitSampling ? ' omit_sampling=1' : ''}`
  );

  const response = await axios.post(endpoint, body, {
    headers: anthropicHeaders(apiKey),
    timeout: timeout || 180000,
  });

  return {
    content: extractAnthropicText(response.data),
    raw: response.data,
    used_web_search: !!wantSearch,
    search_degraded: false,
    wire_protocol: WIRE_PROTOCOL.ANTHROPIC_MESSAGES,
    web_search_mode: wantSearch ? WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH : WEB_SEARCH_MODE.OFF,
    anthropic_web_search_requests:
      response.data?.usage?.server_tool_use?.web_search_requests ?? null,
  };
}

async function invokeGatewayChatFallback({
  chatFallbackEndpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  max_tokens,
  temperature,
  top_p,
  timeout,
  logPrefix,
  reason,
}) {
  console.warn(`${logPrefix} ${reason}，降级 gateway chat/completions`);
  const plain = await invokePlainChat({
    endpoint: chatFallbackEndpoint,
    apiKey,
    model,
    systemContent,
    userContent,
    temperature,
    max_tokens,
    top_p,
    wantSearch: false,
    webSearchMode: WEB_SEARCH_MODE.OFF,
    timeout,
    logPrefix,
  });
  plain.wire_protocol = WIRE_PROTOCOL.CHAT_COMPLETIONS;
  plain.used_web_search = false;
  plain.search_degraded = !!wantSearch;
  plain.web_search_mode = wantSearch
    ? WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH
    : WEB_SEARCH_MODE.OFF;
  plain.anthropic_transport_fallback = true;
  return plain;
}

async function invokeAnthropicWithTransportFallback(ctx) {
  const {
    endpoint,
    apiKey,
    model,
    systemContent,
    userContent,
    wantSearch,
    max_tokens,
    temperature,
    top_p,
    timeout,
    logPrefix,
    chatFallbackEndpoint,
  } = ctx;

  try {
    return await invokeAnthropicMessages({
      endpoint,
      apiKey,
      model,
      systemContent,
      userContent,
      wantSearch,
      max_tokens,
      temperature,
      timeout,
      logPrefix,
    });
  } catch (err) {
    if (chatFallbackEndpoint && isAnthropicTransportError(err)) {
      return invokeGatewayChatFallback({
        chatFallbackEndpoint,
        apiKey,
        model,
        systemContent,
        userContent,
        wantSearch,
        max_tokens,
        temperature,
        top_p,
        timeout,
        logPrefix,
        reason: `Anthropic Messages HTTP ${err?.response?.status || '?'} (${errorBlob(err)})`,
      });
    }
    throw err;
  }
}

/**
 * 带联网 / 传输降级的 Anthropic Messages 出口。
 */
async function invokeAnthropicMessagesWithFallback({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  max_tokens,
  temperature,
  top_p,
  timeout,
  logPrefix = '[llmAnthropic]',
  chatFallbackEndpoint = null,
}) {
  const ctx = {
    endpoint,
    apiKey,
    model,
    systemContent,
    userContent,
    max_tokens,
    temperature,
    top_p,
    timeout,
    logPrefix,
    chatFallbackEndpoint,
  };

  if (!wantSearch) {
    return invokeAnthropicWithTransportFallback({ ...ctx, wantSearch: false });
  }

  try {
    return await invokeAnthropicWithTransportFallback({ ...ctx, wantSearch: true });
  } catch (err) {
    if (!isAnthropicSearchRejected(err)) throw err;
    console.warn(
      `${logPrefix} Anthropic web_search 被拒，尝试无联网 Messages。详情: ${errorBlob(err)}`
    );
    try {
      const plain = await invokeAnthropicWithTransportFallback({ ...ctx, wantSearch: false });
      plain.search_degraded = true;
      plain.used_web_search = false;
      plain.web_search_mode = WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH;
      return plain;
    } catch (err2) {
      if (chatFallbackEndpoint && isAnthropicTransportError(err2)) {
        return invokeGatewayChatFallback({
          chatFallbackEndpoint,
          apiKey,
          model,
          systemContent,
          userContent,
          wantSearch: true,
          max_tokens,
          temperature,
          top_p,
          timeout,
          logPrefix,
          reason: `Anthropic Messages（无联网）HTTP ${err2?.response?.status || '?'} (${errorBlob(err2)})`,
        });
      }
      throw err2;
    }
  }
}

module.exports = {
  invokeAnthropicMessages,
  invokeAnthropicMessagesWithFallback,
  extractAnthropicText,
  buildAnthropicMessages,
  isAnthropicTransportError,
};
