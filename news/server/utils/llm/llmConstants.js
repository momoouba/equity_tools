'use strict';

const WIRE_PROTOCOL = {
  CHAT_COMPLETIONS: 'chat_completions',
  RESPONSES: 'responses',
  ALIBABA_NATIVE: 'alibaba_native',
  /** 火山方舟 Bot 应用（bots/chat/completions，model=bot-xxx） */
  VOLCENGINE_BOT: 'volcengine_bot',
  /** Anthropic Messages API（/v1/messages，Claude） */
  ANTHROPIC_MESSAGES: 'anthropic_messages',
  /** Google Gemini generateContent（/v1beta/models/…:generateContent） */
  GEMINI_GENERATE_CONTENT: 'gemini_generate_content',
};

const WEB_SEARCH_MODE = {
  OFF: 'off',
  DASHSCOPE_ENABLE_SEARCH: 'dashscope_enable_search',
  OPENAI_WEB_SEARCH_TOOL: 'openai_web_search_tool',
  OPENAI_WEB_SEARCH_OPTIONS: 'openai_web_search_options',
  /** 火山方舟 Responses / Chat tools: web_search */
  VOLCENGINE_WEB_SEARCH_TOOL: 'volcengine_web_search_tool',
  /** 火山控制台 Bot 应用（bot-xxx），联网在应用内配置 */
  VOLCENGINE_BOT: 'volcengine_bot',
  /** Anthropic Messages tools: web_search_20250305 */
  ANTHROPIC_WEB_SEARCH: 'anthropic_web_search',
  /** Gemini generateContent tools: google_search */
  GEMINI_GOOGLE_SEARCH: 'gemini_google_search',
};

module.exports = { WIRE_PROTOCOL, WEB_SEARCH_MODE };
