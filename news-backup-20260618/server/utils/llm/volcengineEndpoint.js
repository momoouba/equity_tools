'use strict';

const DEFAULT_VOLCENGINE_API_V3 = 'https://ark.cn-beijing.volces.com/api/v3';

function stripTrailingSlash(u) {
  return String(u || '').trim().replace(/\/$/, '');
}

function isVolcengineEndpoint(raw) {
  return /volces\.com|volcengine/i.test(String(raw || ''));
}

function volcengineApiV3Base(raw) {
  const u = stripTrailingSlash(raw);
  if (!u) return DEFAULT_VOLCENGINE_API_V3;
  if (/\/api\/v3$/i.test(u)) return u;
  if (/\/api\/v3\//i.test(u)) return u.replace(/\/(chat\/completions|responses|bots\/chat\/completions).*$/i, '');
  if (isVolcengineEndpoint(u)) return DEFAULT_VOLCENGINE_API_V3;
  return u;
}

/** @param {'chat'|'responses'|'bot'} kind */
function normalizeVolcengineEndpoint(raw, kind = 'chat') {
  const base = volcengineApiV3Base(raw);
  if (kind === 'responses') {
    if (/\/responses$/i.test(base)) return base;
    return `${base}/responses`;
  }
  if (kind === 'bot') {
    if (/\/bots\/chat\/completions$/i.test(base)) return base;
    if (/\/chat\/completions$/i.test(base)) {
      return base.replace(/\/chat\/completions$/i, '/bots/chat/completions');
    }
    return `${base}/bots/chat/completions`;
  }
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/bots\/chat\/completions$/i.test(base)) {
    return base.replace(/\/bots\/chat\/completions$/i, '/chat/completions');
  }
  if (/\/responses$/i.test(base)) return base.replace(/\/responses$/i, '/chat/completions');
  return `${base}/chat/completions`;
}

function isVolcengineBotModel(modelName) {
  return /^bot-/i.test(String(modelName || '').trim());
}

module.exports = {
  DEFAULT_VOLCENGINE_API_V3,
  isVolcengineEndpoint,
  normalizeVolcengineEndpoint,
  isVolcengineBotModel,
};
