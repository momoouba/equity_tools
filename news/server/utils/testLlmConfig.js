'use strict';

const axios = require('axios');
const { resolveLlmProfile } = require('./llm/llmProfile');
const { resolveEndpoint } = require('./llm/llmEndpoint');
const { WIRE_PROTOCOL, WEB_SEARCH_MODE } = require('./llm/llmConstants');
const { buildInput, extractResponsesText } = require('./llm/adapters/openaiResponses');
const {
  buildVolcengineResponsesInput,
  isVolcengineBotModel,
} = require('./llm/adapters/volcengineSearch');
const {
  buildAnthropicMessages,
  extractAnthropicText,
} = require('./llm/adapters/anthropicMessages');
const { resolveAnthropicTemperature } = require('./llm/anthropicModelUtils');
const {
  buildGeminiContents,
  extractGeminiText,
} = require('./llm/adapters/geminiGenerateContent');
const { normalizeDashScopeChatEndpoint, isDashScopeCompatibleModeEndpoint, isDashScopeNativeGenerationEndpoint } = require('./dashScopeOpenAICompat');

const TEST_MSG = "你好，请回复'测试成功'";

function parseNum(v, fallback) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

async function testLlmConfig(config) {
  const profile = resolveLlmProfile(config);
  const temperature = parseNum(config.temperature, 0.7);
  const maxTokens = Math.min(parseNum(config.max_tokens, 2000), 100);
  const topP = parseNum(config.top_p, 1);

  console.log(
    `[测试AI模型] provider=${config.provider} model=${config.model_name} wire=${profile.wire_protocol} search_mode=${profile.web_search_mode} endpoint=${config.api_endpoint}`
  );

  if (
    String(config.provider || '').toLowerCase() === 'alibaba' &&
    String(config.api_type || '').toLowerCase() === 'chat' &&
    isDashScopeNativeGenerationEndpoint(config.api_endpoint) &&
    !isDashScopeCompatibleModeEndpoint(config.api_endpoint)
  ) {
    return testAlibabaNative(config, { temperature, maxTokens, topP });
  }

  if (profile.is_volcengine) {
    return testVolcengine(config, profile, { temperature, maxTokens, topP });
  }

  if (profile.wire_protocol === WIRE_PROTOCOL.VOLCENGINE_BOT) {
    return testVolcengineBot(config, { temperature, maxTokens, topP });
  }

  if (profile.wire_protocol === WIRE_PROTOCOL.ANTHROPIC_MESSAGES) {
    return testAnthropicMessages(config, profile, { maxTokens, temperature });
  }

  if (profile.wire_protocol === WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT) {
    return testGeminiGenerateContent(config, profile, { maxTokens, temperature });
  }

  if (profile.wire_protocol === WIRE_PROTOCOL.RESPONSES) {
    return testResponses(config, profile, { maxTokens });
  }

  if (profile.web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_OPTIONS) {
    return testChatCompletions(config, profile, { temperature, maxTokens, topP, withSearchOptions: true });
  }

  return testChatCompletions(config, profile, { temperature, maxTokens, topP, withSearchOptions: false });
}

async function testAnthropicMessages(config, profile, { maxTokens, temperature }) {
  const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.ANTHROPIC_MESSAGES);
  const body = {
    model: config.model_name,
    max_tokens: maxTokens,
    messages: buildAnthropicMessages('', TEST_MSG),
  };
  const effTemperature = resolveAnthropicTemperature(config.model_name, temperature);
  if (effTemperature !== undefined) body.temperature = effTemperature;
  if (profile.web_search_mode === WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
  }

  console.log(`[测试AI模型] Anthropic Messages POST ${endpoint}`);

  const response = await axios.post(endpoint, body, {
    headers: {
      'x-api-key': String(config.api_key || '').trim().replace(/^Bearer\s+/i, ''),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const modelResponse = extractAnthropicText(response.data) || '模型响应格式未知';
  return wrapSuccess(
    modelResponse,
    response.data.usage,
    `anthropic_messages/${profile.web_search_mode}`
  );
}

async function testGeminiGenerateContent(config, profile, { maxTokens, temperature }) {
  const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT);
  const body = {
    contents: buildGeminiContents('', TEST_MSG),
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (profile.web_search_mode === WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH) {
    body.tools = [{ google_search: {} }];
  }

  console.log(`[测试AI模型] Gemini generateContent POST ${endpoint}`);

  const response = await axios.post(endpoint, body, {
    headers: {
      'x-goog-api-key': config.api_key,
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const modelResponse = extractGeminiText(response.data) || '模型响应格式未知';
  return wrapSuccess(
    modelResponse,
    response.data.usageMetadata,
    `gemini_generate_content/${profile.web_search_mode}`
  );
}

async function testVolcengine(config, profile, { temperature, maxTokens, topP }) {
  if (
    profile.wire_protocol === WIRE_PROTOCOL.VOLCENGINE_BOT ||
    isVolcengineBotModel(config.model_name)
  ) {
    return testVolcengineBot(config, { temperature, maxTokens, topP });
  }
  if (
    profile.wire_protocol === WIRE_PROTOCOL.RESPONSES ||
    profile.web_search_mode === WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL
  ) {
    return testVolcengineResponses(config, profile, { maxTokens });
  }
  return testChatCompletions(config, profile, {
    temperature,
    maxTokens,
    topP,
    withSearchOptions: false,
  });
}

async function testVolcengineResponses(config, profile, { maxTokens }) {
  const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.RESPONSES);
  const body = {
    model: config.model_name,
    input: buildVolcengineResponsesInput('', TEST_MSG),
    max_output_tokens: maxTokens,
  };
  if (profile.web_search_mode === WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL) {
    body.tools = [{ type: 'web_search' }];
  }

  console.log(`[测试AI模型] Volcengine Responses POST ${endpoint}`, JSON.stringify(body));

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const modelResponse = extractResponsesText(response.data) || '模型响应格式未知';
  return wrapSuccess(
    modelResponse,
    response.data.usage,
    `volcengine_responses/${profile.web_search_mode}`
  );
}

async function testVolcengineBot(config, { temperature, maxTokens, topP }) {
  const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.VOLCENGINE_BOT);
  const requestData = {
    model: config.model_name,
    messages: [{ role: 'user', content: TEST_MSG }],
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
  };

  console.log(`[测试AI模型] Volcengine Bot POST ${endpoint}`);

  const response = await axios.post(endpoint, requestData, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const modelResponse = response.data.choices?.[0]?.message?.content || '模型响应格式未知';
  return wrapSuccess(modelResponse, response.data.usage, 'volcengine_bot');
}

async function testAlibabaNative(config, { temperature, maxTokens, topP }) {
  const requestData = {
    model: config.model_name,
    input: { messages: [{ role: 'user', content: TEST_MSG }] },
    parameters: { temperature, max_tokens: maxTokens, top_p: topP },
  };
  const response = await axios.post(config.api_endpoint, requestData, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });
  const modelResponse =
    response.data.output?.text ||
    response.data.output?.choices?.[0]?.message?.content ||
    '模型响应格式未知';
  return wrapSuccess(modelResponse, response.data.usage, profileLabel('alibaba_native'));
}

async function testResponses(config, profile, { maxTokens }) {
  const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.RESPONSES);
  const body = {
    model: config.model_name,
    input: TEST_MSG,
    max_output_tokens: maxTokens,
  };
  if (profile.web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL) {
    body.tools = [{ type: 'web_search' }];
  }
  if (profile.reasoning_effort) {
    body.reasoning = { effort: profile.reasoning_effort };
  }

  console.log(`[测试AI模型] Responses POST ${endpoint}`, JSON.stringify(body));

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const modelResponse = extractResponsesText(response.data) || '模型响应格式未知';
  return wrapSuccess(modelResponse, response.data.usage, `responses/${profile.web_search_mode}`);
}

async function testChatCompletions(config, profile, { temperature, maxTokens, topP, withSearchOptions }) {
  let endpoint = config.api_endpoint;
  if (config.provider === 'alibaba') {
    endpoint = normalizeDashScopeChatEndpoint(endpoint);
  } else {
    endpoint = resolveEndpoint(config, WIRE_PROTOCOL.CHAT_COMPLETIONS);
  }

  const requestData = {
    model: config.model_name,
    messages: [{ role: 'user', content: TEST_MSG }],
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
  };
  if (withSearchOptions) {
    requestData.web_search_options = {};
  }

  const response = await axios.post(endpoint, requestData, {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  const modelResponse = response.data.choices?.[0]?.message?.content || '模型响应格式未知';
  return wrapSuccess(
    modelResponse,
    response.data.usage,
    `chat_completions${withSearchOptions ? '+web_search_options' : ''}`
  );
}

function profileLabel(extra) {
  return extra;
}

function wrapSuccess(modelResponse, tokenUsage, wireLabel) {
  return {
    status: 'success',
    response_time: new Date().toISOString(),
    model_response: modelResponse,
    token_usage: tokenUsage || null,
    wire_protocol: wireLabel,
  };
}

module.exports = { testLlmConfig, TEST_MSG };
