'use strict';

const axios = require('axios');
const {
  isGatewayAsyncResponsesEnabled,
  getResponsesPollIntervalMs,
  getResponsesPollMaxMs,
} = require('../gatewayAsync');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInput(systemContent, userContent) {
  const sys = String(systemContent || '').trim();
  const usr = String(userContent || '').trim();
  if (!usr) return sys || '';
  if (!sys) return usr;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: usr },
  ];
}

function extractResponsesText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = Array.isArray(data.output) ? data.output : [];
  const parts = [];
  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === 'output_text' && c.text) parts.push(String(c.text));
        else if (typeof c?.text === 'string') parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function errorBlob(err) {
  const pick = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  };
  const status = err?.response?.status;
  const body =
    pick(err?.response?.data?.error?.message) ||
    pick(err?.response?.data?.message) ||
    pick(err?.response?.data?.error) ||
    pick(err?.response?.data);
  const code = err?.code || '';
  const prefix = status ? `HTTP ${status}` : code ? String(code) : '';
  const msg = body || pick(err?.message);
  return prefix && msg ? `${prefix}: ${msg}` : prefix || msg || 'unknown error';
}

function responsesPollUrl(endpoint, responseId) {
  const base = String(endpoint || '').trim().replace(/\/$/, '');
  const root = base.replace(/\/responses$/i, '');
  return `${root}/responses/${encodeURIComponent(String(responseId))}`;
}

function isResponsesCompleted(status) {
  const s = String(status || '').toLowerCase();
  return s === 'completed' || s === 'complete' || s === 'succeeded' || s === 'success';
}

function isResponsesFailed(status) {
  const s = String(status || '').toLowerCase();
  return s === 'failed' || s === 'cancelled' || s === 'canceled' || s === 'error';
}

async function pollResponsesUntilDone({
  pollUrl,
  apiKey,
  pollIntervalMs,
  pollMaxMs,
  logPrefix,
  requestTimeoutMs,
}) {
  const getTimeout = Math.max(30000, requestTimeoutMs || 120000);
  const start = Date.now();
  let round = 0;
  while (Date.now() - start < pollMaxMs) {
    round += 1;
    const res = await axios.get(pollUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: getTimeout,
    });
    const data = res.data || {};
    const status = data.status;
    if (isResponsesCompleted(status)) {
      console.log(`${logPrefix} background poll done round=${round} status=${status}`);
      return data;
    }
    if (isResponsesFailed(status)) {
      throw new Error(
        `Responses 后台任务失败: status=${status} ${data.error?.message || data.message || ''}`
      );
    }
    if (round === 1 || round % 10 === 0) {
      console.log(`${logPrefix} background poll round=${round} status=${status || 'pending'}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Responses 后台任务超时（${pollMaxMs}ms）`);
}

/**
 * OpenAI Responses API（DMGateway Codex / GPT 联网推荐路径）。
 */
async function invokeOpenAiResponses({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  reasoningEffort,
  timeout,
  useBackground,
  logPrefix = '[llmResponses]',
}) {
  const body = {
    model,
    input: buildInput(systemContent, userContent),
  };
  if (wantSearch) {
    body.tools = [{ type: 'web_search' }];
    body.tool_choice = 'auto';
  }
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }
  const asyncMode = useBackground && isGatewayAsyncResponsesEnabled();
  if (asyncMode) {
    body.background = true;
  }

  console.log(
    `${logPrefix} POST ${endpoint} model=${model} web_search=${wantSearch ? 1 : 0} background=${asyncMode ? 1 : 0}` +
      (reasoningEffort ? ` reasoning=${reasoningEffort}` : '')
  );

  const requestTimeoutMs = Math.max(30000, timeout || 120000);
  const submitTimeout = requestTimeoutMs;

  const response = await axios.post(endpoint, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: submitTimeout,
  });

  let data = response.data;
  if (asyncMode && data?.id && !isResponsesCompleted(data.status)) {
    const pollUrl = responsesPollUrl(endpoint, data.id);
    data = await pollResponsesUntilDone({
      pollUrl,
      apiKey,
      pollIntervalMs: getResponsesPollIntervalMs(),
      pollMaxMs: getResponsesPollMaxMs(),
      logPrefix,
      requestTimeoutMs,
    });
  }

  const content = extractResponsesText(data);
  return {
    content,
    raw: data,
    used_web_search: !!wantSearch,
    search_degraded: false,
    wire_protocol: 'responses',
    web_search_mode: wantSearch ? 'openai_web_search_tool' : 'off',
    responses_async: asyncMode,
  };
}

module.exports = {
  buildInput,
  extractResponsesText,
  invokeOpenAiResponses,
  errorBlob,
};
