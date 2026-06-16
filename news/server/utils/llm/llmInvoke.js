'use strict';

const { resolveLlmProfile, shouldAttemptWebSearch } = require('./llmProfile');
const { resolveEndpoint } = require('./llmEndpoint');
const { WIRE_PROTOCOL, WEB_SEARCH_MODE } = require('./llmConstants');
const { invokeOpenAiResponses, errorBlob } = require('./adapters/openaiResponses');
const { invokePlainChat } = require('./adapters/plainChat');
const { invokeDashScopeSearch } = require('./adapters/dashscopeSearch');
const { invokeVolcengineSearch } = require('./adapters/volcengineSearch');
const { invokeAnthropicMessagesWithFallback } = require('./adapters/anthropicMessages');
const { invokeGeminiGenerateContentWithFallback } = require('./adapters/geminiGenerateContent');
const { withGatewayLlmConcurrency } = require('./gatewayConcurrency');
const { withVolcengineLlmConcurrency } = require('./volcengineConcurrency');
const { isGatewayAsyncResponsesEnabled } = require('./gatewayAsync');

class LlmSearchRequiredError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'LlmSearchRequiredError';
    this.meta = meta;
  }
}

/**
 * 统一 LLM 调用（联网可选 / 可强制）。
 * @param {object} config ai_model_config
 * @param {{ systemContent?: string, userContent: string, wantSearch?: boolean, searchRequired?: boolean, timeout?: number, logPrefix?: string }} opts
 */
async function llmInvoke(config, opts = {}) {
  const {
    systemContent = '',
    userContent,
    wantSearch = false,
    searchRequired = false,
    timeout,
    logPrefix = '[llmInvoke]',
  } = opts;

  if (!config?.api_key || !config?.model_name) {
    throw new Error('AI 模型配置不完整（缺少 api_key 或 model_name）');
  }

  const profile = resolveLlmProfile(config);
  const attemptSearch = shouldAttemptWebSearch(profile, wantSearch);

  let result;

  const maxTokensRaw =
    typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const max_tokens = Number.isFinite(maxTokensRaw)
    ? Math.min(32000, Math.max(256, maxTokensRaw))
    : 2048;
  const tempRaw =
    typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature;
  const temperature = Number.isFinite(tempRaw) ? tempRaw : 0.3;

  if (profile.is_volcengine) {
    result = await withVolcengineLlmConcurrency(() =>
      invokeVolcengineSearch({
        config,
        systemContent,
        userContent,
        wantSearch: attemptSearch,
        timeout,
        logPrefix,
      })
    );
  } else if (
    profile.web_search_mode === WEB_SEARCH_MODE.DASHSCOPE_ENABLE_SEARCH &&
    profile.is_dashscope
  ) {
    result = await invokeDashScopeSearch({
      config,
      systemContent,
      userContent,
      wantSearch: attemptSearch,
      timeout,
      logPrefix,
    });
  } else if (profile.wire_protocol === WIRE_PROTOCOL.ANTHROPIC_MESSAGES) {
    const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.ANTHROPIC_MESSAGES);
    const runAnthropic = async () => {
      try {
        return await invokeAnthropicMessagesWithFallback({
          endpoint,
          apiKey: config.api_key,
          model: config.model_name,
          systemContent,
          userContent,
          wantSearch: attemptSearch,
          max_tokens,
          temperature,
          top_p: parseFloat(config.top_p) || 0.9,
          timeout,
          logPrefix,
          chatFallbackEndpoint: profile.is_gateway
            ? resolveEndpoint(config, WIRE_PROTOCOL.CHAT_COMPLETIONS)
            : null,
        });
      } catch (err) {
        if (searchRequired && attemptSearch) {
          throw new LlmSearchRequiredError(
            `Anthropic Messages 联网调用失败（必须联网）：${errorBlob(err)}`,
            { profile, err }
          );
        }
        throw err;
      }
    };
    result = profile.is_gateway
      ? await withGatewayLlmConcurrency(runAnthropic)
      : await runAnthropic();
  } else if (profile.wire_protocol === WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT) {
    const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT);
    const runGemini = async () => {
      try {
        return await invokeGeminiGenerateContentWithFallback({
          endpoint,
          apiKey: config.api_key,
          model: config.model_name,
          systemContent,
          userContent,
          wantSearch: attemptSearch,
          maxOutputTokens: max_tokens,
          temperature,
          timeout,
          logPrefix,
        });
      } catch (err) {
        if (searchRequired && attemptSearch) {
          throw new LlmSearchRequiredError(
            `Gemini generateContent 联网调用失败（必须联网）：${errorBlob(err)}`,
            { profile, err }
          );
        }
        throw err;
      }
    };
    result = profile.is_gateway
      ? await withGatewayLlmConcurrency(runGemini)
      : await runGemini();
  } else if (
    profile.wire_protocol === WIRE_PROTOCOL.RESPONSES ||
    (attemptSearch && profile.web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_TOOL)
  ) {
    const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.RESPONSES);
    const runResponses = async () => {
      try {
        return await invokeOpenAiResponses({
          endpoint,
          apiKey: config.api_key,
          model: config.model_name,
          systemContent,
          userContent,
          wantSearch: attemptSearch,
          reasoningEffort: profile.reasoning_effort,
          timeout,
          useBackground: profile.is_gateway,
          logPrefix,
        });
      } catch (err) {
        if (searchRequired && attemptSearch) {
          throw new LlmSearchRequiredError(
            `联网 Responses 调用失败（必须联网）：${errorBlob(err)}`,
            { profile, err }
          );
        }
        if (!attemptSearch || profile.wire_protocol !== WIRE_PROTOCOL.RESPONSES) {
          throw err;
        }
        console.warn(`${logPrefix} Responses 联网失败，降级 plain chat：${errorBlob(err)}`);
        const fallback = await invokePlainChat({
          endpoint: resolveEndpoint(config, WIRE_PROTOCOL.CHAT_COMPLETIONS),
          apiKey: config.api_key,
          model: config.model_name,
          systemContent,
          userContent,
          temperature: parseFloat(config.temperature) || 0.3,
          max_tokens: parseInt(config.max_tokens, 10) || 2048,
          top_p: parseFloat(config.top_p) || 0.9,
          wantSearch: false,
          webSearchMode: WEB_SEARCH_MODE.OFF,
          timeout,
          logPrefix,
        });
        fallback.search_degraded = true;
        fallback.used_web_search = false;
        fallback.used_enable_search = false;
        return fallback;
      }
    };
    result = profile.is_gateway
      ? await withGatewayLlmConcurrency(runResponses)
      : await runResponses();
  } else {
    const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.CHAT_COMPLETIONS);
    const useSearchOptions =
      attemptSearch && profile.web_search_mode === WEB_SEARCH_MODE.OPENAI_WEB_SEARCH_OPTIONS;
    try {
      result = await invokePlainChat({
        endpoint,
        apiKey: config.api_key,
        model: config.model_name,
        systemContent,
        userContent,
        temperature: parseFloat(config.temperature) || 0.3,
        max_tokens: parseInt(config.max_tokens, 10) || 2048,
        top_p: parseFloat(config.top_p) || 0.9,
        wantSearch: useSearchOptions,
        webSearchMode: profile.web_search_mode,
        timeout,
        logPrefix,
      });
    } catch (err) {
      if (searchRequired && attemptSearch) {
        throw new LlmSearchRequiredError(
          `联网 Chat 调用失败（必须联网）：${errorBlob(err)}`,
          { profile, err }
        );
      }
      throw err;
    }
    if (attemptSearch && !useSearchOptions && profile.web_search_mode !== WEB_SEARCH_MODE.OFF) {
      result.search_degraded = true;
      result.used_web_search = false;
      result.used_enable_search = false;
    }
  }

  result.used_enable_search = !!result.used_web_search || !!result.used_enable_search;
  result.wire_protocol = result.wire_protocol || profile.wire_protocol;
  result.web_search_mode = result.web_search_mode || profile.web_search_mode;

  if (searchRequired && wantSearch) {
    if (!result.used_web_search && !result.used_enable_search) {
      throw new LlmSearchRequiredError('模型未启用联网检索，本场景要求必须联网分析', {
        profile,
        result,
      });
    }
    if (result.search_degraded) {
      throw new LlmSearchRequiredError('联网参数被拒绝或已降级，本场景要求必须联网分析', {
        profile,
        result,
      });
    }
  }

  return result;
}

module.exports = {
  llmInvoke,
  LlmSearchRequiredError,
  resolveLlmProfile,
  isGatewayAsyncResponsesEnabled,
};
