'use strict';

const LLM_CONFIG_SELECT_SQL = `
  F_Id AS id, provider, model_name, api_key, api_endpoint, api_type,
  temperature, max_tokens, top_p, enable_thinking,
  wire_protocol, web_search_mode, reasoning_effort
`;

/** 将 ai_model_config 行转为 llmInvoke 所需 config */
function mapAiModelConfigRow(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    model_name: row.model_name,
    api_key: row.api_key,
    api_endpoint: row.api_endpoint,
    api_type: row.api_type,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    top_p: row.top_p,
    enable_thinking: row.enable_thinking,
    wire_protocol: row.wire_protocol,
    web_search_mode: row.web_search_mode,
    reasoning_effort: row.reasoning_effort,
  };
}

module.exports = { LLM_CONFIG_SELECT_SQL, mapAiModelConfigRow };
