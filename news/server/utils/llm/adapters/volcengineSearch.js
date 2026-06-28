'use strict';

const axios = require('axios');
const { invokePlainChat } = require('./plainChat');
const { extractResponsesText, errorBlob } = require('./openaiResponses');
const {
  normalizeVolcengineEndpoint,
  isVolcengineBotModel,
} = require('../volcengineEndpoint');
const { WEB_SEARCH_MODE, WIRE_PROTOCOL } = require('../llmConstants');

function buildVolcengineResponsesInput(systemContent, userContent) {
  const input = [];
  const sys = String(systemContent || '').trim();
  const usr = String(userContent || '').trim();
  if (sys) {
    input.push({
      role: 'system',
      content: [{ type: 'input_text', text: sys }],
    });
  }
  if (usr) {
    input.push({
      role: 'user',
      content: [{ type: 'input_text', text: usr }],
    });
  }
  return input;
}

function isSearchRejected(err) {
  const blob = errorBlob(err).toLowerCase();
  return err?.response?.status === 400 && /web_search|tools|unsupported|invalid/i.test(blob);
}

/**
 * 火山方舟 Bot（控制台已配置联网插件），model 为 bot-xxx。
 */
async function invokeVolcengineBotChat({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  temperature,
  max_tokens,
  top_p,
  timeout,
  logPrefix,
}) {
  const messages = [];
  const sys = String(systemContent || '').trim();
  const usr = String(userContent || '').trim();
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: usr });

  const body = {
    model,
    messages,
    temperature,
    max_tokens,
    top_p,
  };

  console.log(`${logPrefix} POST ${endpoint} model=${model} volcengine_bot=1`);

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: timeout || 180000,
  });

  const content = response.data?.choices?.[0]?.message?.content || '';
  return {
    content: String(content),
    raw: response.data,
    used_web_search: true,
    search_degraded: false,
    wire_protocol: WIRE_PROTOCOL.VOLCENGINE_BOT,
    web_search_mode: WEB_SEARCH_MODE.VOLCENGINE_BOT,
  };
}

/**
 * 火山方舟 Responses API + tools: web_search（官方联网内容插件路径）。
 */
async function invokeVolcengineResponses({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  timeout,
  logPrefix,
}) {
  const body = {
    model,
    input: buildVolcengineResponsesInput(systemContent, userContent),
  };
  if (wantSearch) {
    body.tools = [{ type: 'web_search' }];
  }

  console.log(
    `${logPrefix} POST ${endpoint} model=${model} volcengine_responses web_search=${wantSearch ? 1 : 0}`
  );

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: timeout || 180000,
  });

  return {
    content: extractResponsesText(response.data),
    raw: response.data,
    used_web_search: !!wantSearch,
    search_degraded: false,
    wire_protocol: WIRE_PROTOCOL.RESPONSES,
    web_search_mode: wantSearch ? WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL : WEB_SEARCH_MODE.OFF,
  };
}

/**
 * Chat Completions + tools: [{ type: 'web_search' }] 降级路径。
 */
async function invokeVolcengineChatWithTools({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  temperature,
  max_tokens,
  top_p,
  timeout,
  logPrefix,
}) {
  const messages = [];
  const sys = String(systemContent || '').trim();
  const usr = String(userContent || '').trim();
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: usr });

  const body = {
    model,
    messages,
    tools: [{ type: 'web_search' }],
    temperature,
    max_tokens,
    top_p,
  };

  console.log(`${logPrefix} POST ${endpoint} model=${model} volcengine_chat_tools=1`);

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: timeout || 180000,
  });

  const content = response.data?.choices?.[0]?.message?.content || '';
  return {
    content: String(content),
    raw: response.data,
    used_web_search: true,
    search_degraded: false,
    wire_protocol: WIRE_PROTOCOL.CHAT_COMPLETIONS,
    web_search_mode: WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL,
  };
}

/**
 * 火山引擎（豆包）统一出口。
 */
async function invokeVolcengineSearch({
  config,
  systemContent,
  userContent,
  wantSearch,
  timeout,
  logPrefix = '[llmVolcengine]',
}) {
  const model = config.model_name;
  const apiKey = config.api_key;
  const tempRaw =
    typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature ?? 0.3;
  const temperature = Number.isFinite(tempRaw) ? tempRaw : 0.3;
  const maxTokensRaw =
    typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const max_tokens = Number.isFinite(maxTokensRaw) ? Math.min(32000, Math.max(256, maxTokensRaw)) : 2048;
  const top_p =
    typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p ?? 0.9;

  const wireProtocol = String(config.wire_protocol || '').trim().toLowerCase();

  if (isVolcengineBotModel(model) || wireProtocol === WIRE_PROTOCOL.VOLCENGINE_BOT) {
    const endpoint = normalizeVolcengineEndpoint(config.api_endpoint, 'bot');
    return invokeVolcengineBotChat({
      endpoint,
      apiKey,
      model,
      systemContent,
      userContent,
      temperature,
      max_tokens,
      top_p,
      timeout,
      logPrefix,
    });
  }

  if (!wantSearch) {
    const endpoint = normalizeVolcengineEndpoint(config.api_endpoint, 'chat');
    return invokePlainChat({
      endpoint,
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
  }

  const responsesEndpoint = normalizeVolcengineEndpoint(config.api_endpoint, 'responses');
  try {
    return await invokeVolcengineResponses({
      endpoint: responsesEndpoint,
      apiKey,
      model,
      systemContent,
      userContent,
      wantSearch: true,
      timeout,
      logPrefix,
    });
  } catch (err1) {
    if (!isSearchRejected(err1)) throw err1;
    console.warn(
      `${logPrefix} Responses web_search 被拒，尝试 chat/completions+tools。详情: ${errorBlob(err1)}`
    );
    try {
      const chatEndpoint = normalizeVolcengineEndpoint(config.api_endpoint, 'chat');
      return await invokeVolcengineChatWithTools({
        endpoint: chatEndpoint,
        apiKey,
        model,
        systemContent,
        userContent,
        temperature,
        max_tokens,
        top_p,
        timeout,
        logPrefix,
      });
    } catch (err2) {
      if (!isSearchRejected(err2)) throw err2;
      console.warn(
        `${logPrefix} chat tools web_search 被拒，降级无联网。详情: ${errorBlob(err2)}`
      );
      const chatEndpoint = normalizeVolcengineEndpoint(config.api_endpoint, 'chat');
      const plain = await invokePlainChat({
        endpoint: chatEndpoint,
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
      plain.search_degraded = true;
      plain.used_web_search = false;
      plain.wire_protocol = WIRE_PROTOCOL.CHAT_COMPLETIONS;
      plain.web_search_mode = WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL;
      return plain;
    }
  }
}

module.exports = {
  invokeVolcengineSearch,
  buildVolcengineResponsesInput,
  isVolcengineBotModel,
};
