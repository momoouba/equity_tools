'use strict';

const { WIRE_PROTOCOL, WEB_SEARCH_MODE } = require('./llmConstants');
const { isGatewayHost } = require('./llmEndpoint');
const {
  isVolcengineEndpoint,
  isVolcengineBotModel,
} = require('./volcengineEndpoint');
const {
  isDashScopeCompatibleModeEndpoint,
  isDashScopeNativeGenerationEndpoint,
} = require('../dashScopeOpenAICompat');

function normLower(v) {
  return String(v || '').trim().toLowerCase();
}

function looksLikeGptModel(model) {
  const m = normLower(model);
  return /^gpt-|^o[1-9]|^chatgpt-/.test(m);
}

function looksLikeClaudeModel(model) {
  return /claude/i.test(String(model || ''));
}

function looksLikeGeminiModel(model) {
  return /gemini/i.test(String(model || ''));
}

function isDashScopeEndpoint(endpoint) {
  return /dashscope[^/]*\.aliyuncs\.com/i.test(String(endpoint || ''));
}

/** Gateway：模型名优先于 DB 中过期的 wire_protocol（如 Claude 模型 + gemini 协议） */
function reconcileGatewayWireWithModel(model, wire_protocol, web_search_mode) {
  let wire = wire_protocol;
  let search = web_search_mode;
  const m = String(model || '');

  if (looksLikeClaudeModel(m)) {
    wire = WIRE_PROTOCOL.ANTHROPIC_MESSAGES;
    if (
      search === WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH ||
      search === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL ||
      search === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_OPTIONS ||
      !search
    ) {
      search = WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH;
    }
  } else if (looksLikeGeminiModel(m)) {
    wire = WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT;
    if (
      search === WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH ||
      search === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL ||
      search === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_OPTIONS ||
      !search
    ) {
      search = WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH;
    }
  } else if (looksLikeGptModel(m) || normLower(m).includes('search-api')) {
    if (
      wire === WIRE_PROTOCOL.ANTHROPIC_MESSAGES ||
      wire === WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT
    ) {
      wire = WIRE_PROTOCOL.RESPONSES;
    }
    if (
      search === WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH ||
      search === WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH ||
      !search
    ) {
      search = WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL;
    }
    if (
      wire === WIRE_PROTOCOL.CHAT_COMPLETIONS &&
      search === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL
    ) {
      wire = WIRE_PROTOCOL.RESPONSES;
    }
  }

  return { wire_protocol: wire, web_search_mode: search };
}

/**
 * @param {object} config ai_model_config 行
 * @returns {{
 *   provider: string,
 *   wire_protocol: string,
 *   web_search_mode: string,
 *   reasoning_effort: string|null,
 *   is_dashscope: boolean,
 *   is_gateway: boolean,
 *   is_volcengine: boolean,
 * }}
 */
function resolveLlmProfile(config) {
  const provider = normLower(config?.provider) || 'alibaba';
  const endpoint = String(config?.api_endpoint || '');
  const model = String(config?.model_name || '');
  const apiType = normLower(config?.api_type);

  let wire_protocol = normLower(config?.wire_protocol);
  let web_search_mode = normLower(config?.web_search_mode);
  const reasoning_effort = config?.reasoning_effort
    ? normLower(config.reasoning_effort)
    : null;

  const is_gateway = provider === 'gateway' || isGatewayHost(endpoint);
  const is_volcengine = provider === 'volcengine' || isVolcengineEndpoint(endpoint);
  const alibaba_compat =
    provider === 'alibaba' &&
    (normLower(config?.wire_protocol) === WIRE_PROTOCOL.CHAT_COMPLETIONS ||
      apiType === 'chat_completion' ||
      isDashScopeCompatibleModeEndpoint(endpoint));
  const is_dashscope =
    provider === 'alibaba' &&
    (isDashScopeEndpoint(endpoint) || apiType === 'chat_completion' || alibaba_compat);

  if (!wire_protocol) {
    if (/\/responses$/i.test(endpoint)) {
      wire_protocol = WIRE_PROTOCOL.RESPONSES;
    } else if (
      provider === 'alibaba' &&
      apiType === 'chat' &&
      isDashScopeNativeGenerationEndpoint(endpoint)
    ) {
      wire_protocol = WIRE_PROTOCOL.ALIBABA_NATIVE;
    } else if (provider === 'alibaba' && (apiType === 'chat_completion' || isDashScopeCompatibleModeEndpoint(endpoint))) {
      wire_protocol = WIRE_PROTOCOL.CHAT_COMPLETIONS;
    } else if (provider === 'alibaba' && apiType === 'chat') {
      wire_protocol = WIRE_PROTOCOL.ALIBABA_NATIVE;
    } else if (is_gateway) {
      if (looksLikeGptModel(model) || normLower(model).includes('search-api')) {
        wire_protocol = WIRE_PROTOCOL.RESPONSES;
      } else if (looksLikeClaudeModel(model)) {
        wire_protocol = WIRE_PROTOCOL.ANTHROPIC_MESSAGES;
      } else if (looksLikeGeminiModel(model)) {
        wire_protocol = WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT;
      } else {
        wire_protocol = WIRE_PROTOCOL.CHAT_COMPLETIONS;
      }
    } else if (is_volcengine) {
      if (isVolcengineBotModel(model)) {
        wire_protocol = WIRE_PROTOCOL.VOLCENGINE_BOT;
      } else {
        wire_protocol = WIRE_PROTOCOL.RESPONSES;
      }
    } else if (isDashScopeEndpoint(endpoint)) {
      wire_protocol = WIRE_PROTOCOL.CHAT_COMPLETIONS;
    } else {
      wire_protocol = WIRE_PROTOCOL.CHAT_COMPLETIONS;
    }
  }

  if (!web_search_mode) {
    if (is_dashscope) {
      web_search_mode = WEB_SEARCH_MODE.DASHSCOPE_ENABLE_SEARCH;
    } else if (is_gateway || provider === 'openai') {
      if (looksLikeClaudeModel(model)) {
        web_search_mode = WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH;
      } else if (looksLikeGeminiModel(model)) {
        web_search_mode = WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH;
      } else if (normLower(model).includes('search-api')) {
        web_search_mode = WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_OPTIONS;
      } else if (wire_protocol === WIRE_PROTOCOL.RESPONSES) {
        web_search_mode = WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL;
      } else if (looksLikeGptModel(model)) {
        web_search_mode = WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL;
      } else {
        web_search_mode = WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL;
      }
    } else if (is_volcengine) {
      if (
        isVolcengineBotModel(model) ||
        wire_protocol === WIRE_PROTOCOL.VOLCENGINE_BOT
      ) {
        web_search_mode = WEB_SEARCH_MODE.VOLCENGINE_BOT;
      } else {
        web_search_mode = WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL;
      }
    } else {
      web_search_mode = WEB_SEARCH_MODE.OFF;
    }
  }

  if (
    wire_protocol === WIRE_PROTOCOL.ANTHROPIC_MESSAGES &&
    web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL
  ) {
    web_search_mode = WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH;
  }

  if (
    wire_protocol === WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT &&
    web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL
  ) {
    web_search_mode = WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH;
  }

  if (
    web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL &&
    wire_protocol === WIRE_PROTOCOL.CHAT_COMPLETIONS
  ) {
    if (is_gateway && looksLikeGptModel(model)) {
      wire_protocol = WIRE_PROTOCOL.RESPONSES;
    }
  }

  if (
    is_gateway &&
    web_search_mode === WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH &&
    wire_protocol === WIRE_PROTOCOL.CHAT_COMPLETIONS
  ) {
    wire_protocol = WIRE_PROTOCOL.ANTHROPIC_MESSAGES;
  }

  if (
    is_gateway &&
    web_search_mode === WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH &&
    wire_protocol === WIRE_PROTOCOL.CHAT_COMPLETIONS
  ) {
    wire_protocol = WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT;
  }

  if (
    is_volcengine &&
    web_search_mode === WEB_SEARCH_MODE.VOLCENGINE_WEB_SEARCH_TOOL &&
    wire_protocol === WIRE_PROTOCOL.CHAT_COMPLETIONS
  ) {
    wire_protocol = WIRE_PROTOCOL.RESPONSES;
  }

  // Gateway：按模型名最终对齐协议（覆盖 DB 中 Claude+gemini 等错配）
  if (is_gateway) {
    const reconciled = reconcileGatewayWireWithModel(model, wire_protocol, web_search_mode);
    wire_protocol = reconciled.wire_protocol;
    web_search_mode = reconciled.web_search_mode;
  }

  return {
    provider,
    wire_protocol,
    web_search_mode,
    reasoning_effort,
    is_dashscope,
    is_gateway,
    is_volcengine,
  };
}

function shouldAttemptWebSearch(profile, wantSearch) {
  if (!wantSearch) return false;
  if (profile.web_search_mode === WEB_SEARCH_MODE.VOLCENGINE_BOT) return true;
  if (profile.web_search_mode === WEB_SEARCH_MODE.ANTHROPIC_WEB_SEARCH) return true;
  if (profile.web_search_mode === WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH) return true;
  return profile.web_search_mode !== WEB_SEARCH_MODE.OFF;
}

/** 保存配置前：按 Profile 规范化 wire_protocol / web_search_mode */
function normalizeLlmConfigWireFields(config) {
  const profile = resolveLlmProfile(config || {});
  return {
    wire_protocol: profile.wire_protocol,
    web_search_mode: profile.web_search_mode,
  };
}

module.exports = {
  resolveLlmProfile,
  shouldAttemptWebSearch,
  looksLikeGptModel,
  looksLikeClaudeModel,
  looksLikeGeminiModel,
  normalizeLlmConfigWireFields,
};
