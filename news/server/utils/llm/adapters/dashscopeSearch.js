'use strict';

const {
  postDashScopeChatWithSearchAndThinking,
  resolveEnrichWantThinking,
} = require('../../project-sourcing/financingAiEnrichDashScopeChat');
const { resolveEndpoint } = require('../llmEndpoint');
const { WIRE_PROTOCOL } = require('../llmConstants');

/**
 * DashScope 兼容 Chat：enable_search + enable_thinking。
 */
async function invokeDashScopeSearch({
  config,
  systemContent,
  userContent,
  wantSearch,
  timeout,
  logPrefix = '[llmDashScope]',
}) {
  const endpoint = resolveEndpoint(config, WIRE_PROTOCOL.CHAT_COMPLETIONS);
  const tempRaw =
    typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature ?? 0.3;
  const tempCap = parseFloat(process.env.FINANCING_AI_TEMPERATURE_CAP || '0.35');
  const temperature = Number.isFinite(tempCap)
    ? Math.min(tempCap, Number.isFinite(tempRaw) ? tempRaw : 0.3)
    : Number.isFinite(tempRaw)
      ? tempRaw
      : 0.3;
  const maxTokensRaw =
    typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const maxCap = 32000;
  const max_tokens = Number.isFinite(maxTokensRaw)
    ? Math.min(maxCap, Math.max(1024, maxTokensRaw))
    : 8192;
  const top_p =
    typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p ?? 0.9;

  const result = await postDashScopeChatWithSearchAndThinking({
    endpoint,
    apiKey: config.api_key,
    bodyBase: {
      model: config.model_name,
      messages: [
        { role: 'system', content: String(systemContent || '').trim() },
        { role: 'user', content: String(userContent || '').trim() },
      ],
      temperature,
      max_tokens,
      top_p,
    },
    wantSearch,
    wantThinking: resolveEnrichWantThinking(config),
    logPrefix,
  });

  return {
    content: result.content,
    used_web_search: !!result.used_enable_search,
    used_enable_search: !!result.used_enable_search,
    search_degraded: !!result.search_degraded,
    used_enable_thinking: !!result.used_enable_thinking,
    thinking_degraded: !!result.thinking_degraded,
    wire_protocol: 'chat_completions',
    web_search_mode: result.used_enable_search ? 'dashscope_enable_search' : 'off',
  };
}

module.exports = { invokeDashScopeSearch };
