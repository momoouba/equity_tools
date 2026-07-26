'use strict';

const axios = require('axios');

function extractChatContent(response) {
  const msg = response?.data?.choices?.[0]?.message;
  const content = msg?.content;
  if (content == null || (typeof content === 'string' && !content.trim())) return '';
  return String(content);
}

/**
 * 通用 Chat Completions（无联网或 openai_web_search_options）。
 */
async function invokePlainChat({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  temperature,
  max_tokens,
  top_p,
  wantSearch,
  webSearchMode,
  timeout,
  logPrefix = '[llmChat]',
  chatBodyExtras,
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
    ...(chatBodyExtras && typeof chatBodyExtras === 'object' ? chatBodyExtras : {}),
  };

  let usedWebSearch = false;
  if (wantSearch && webSearchMode === 'openai_web_search_options') {
    body.web_search_options = {};
    usedWebSearch = true;
  }

  console.log(
    `${logPrefix} POST ${endpoint} model=${model} web_search=${usedWebSearch ? 1 : 0}`
  );

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: timeout || 120000,
  });

  return {
    content: extractChatContent(response),
    used_web_search: usedWebSearch,
    search_degraded: false,
    wire_protocol: 'chat_completions',
    web_search_mode: usedWebSearch ? webSearchMode : 'off',
  };
}

module.exports = { invokePlainChat, extractChatContent };
