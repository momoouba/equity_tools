'use strict';

const axios = require('axios');

/** 是否开启深度思考（默认开；设 FINANCING_AI_ENABLE_THINKING=0 关闭） */
function isFinancingAiThinkingEnabled() {
  const v = String(process.env.FINANCING_AI_ENABLE_THINKING ?? '1')
    .trim()
    .toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function getFinancingAiThinkingBudget() {
  const n = parseInt(process.env.FINANCING_AI_THINKING_BUDGET || '8192', 10);
  return Number.isFinite(n) ? Math.min(32768, Math.max(512, n)) : 8192;
}

function getFinancingAiChatTimeoutMs(withThinking) {
  const base = parseInt(process.env.FINANCING_AI_CHAT_TIMEOUT_MS || '120000', 10) || 120000;
  if (!withThinking) return base;
  const thinkingMs = parseInt(process.env.FINANCING_AI_CHAT_TIMEOUT_THINKING_MS || '240000', 10) || 240000;
  return Math.max(base, thinkingMs);
}

function errorBlob(err) {
  return String(
    err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.response?.data ||
      err?.message ||
      ''
  );
}

function isHttp400(err) {
  return err?.response?.status === 400;
}

function looksLikeWrongChatUrl(detail) {
  return (
    /no static resource/i.test(detail) ||
    /invalid.*url/i.test(detail) ||
    /unknown path/i.test(detail)
  );
}

function isThinkingParamRejected(detail) {
  return /enable_thinking|thinking_budget|深度思考|does not support.*think|unsupported.*think/i.test(
    detail
  );
}

function isSearchParamRejected(detail) {
  return /enable_search|does not support.*search|不支持.*联网|invalidparameter.*search/i.test(detail);
}

/**
 * @param {import('axios').AxiosResponse} response
 */
function extractAssistantContent(response) {
  const msg = response?.data?.choices?.[0]?.message;
  const content = msg?.content;
  return content != null ? String(content) : '';
}

function extractReasoningLen(response) {
  try {
    const msg = response?.data?.choices?.[0]?.message;
    const rc = msg?.reasoning_content;
    return rc == null ? 0 : String(rc).length;
  } catch {
    return 0;
  }
}

/**
 * DashScope OpenAI 兼容 Chat：联网 + 深度思考，按 400 自动降级。
 * @returns {Promise<{
 *   content: string,
 *   used_enable_search: boolean,
 *   search_degraded: boolean,
 *   used_enable_thinking: boolean,
 *   thinking_degraded: boolean,
 * }>}
 */
async function postDashScopeChatWithSearchAndThinking({
  endpoint,
  apiKey,
  bodyBase,
  wantThinking,
  logPrefix = '[financingAiEnrich]',
}) {
  const thinkingBudget = getFinancingAiThinkingBudget();

  const buildBody = ({ withSearch, withThinking }) => {
    const body = { ...bodyBase };
    if (withSearch) body.enable_search = true;
    if (withThinking) {
      body.enable_thinking = true;
      body.thinking_budget = thinkingBudget;
    }
    return body;
  };

  const post = async ({ withSearch, withThinking }) => {
    return axios.post(endpoint, buildBody({ withSearch, withThinking }), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: getFinancingAiChatTimeoutMs(withThinking),
    });
  };

  const logOk = (response, note) => {
    try {
      const ch0 = response?.data?.choices?.[0];
      const len = extractAssistantContent(response).length;
      const reasoningLen = extractReasoningLen(response);
      console.log(
        `${logPrefix} chat_response_ok model=${bodyBase.model} finish_reason=${ch0?.finish_reason ?? 'n/a'} content_len=${len} reasoning_len=${reasoningLen} id=${response?.data?.id ?? 'n/a'}${note ? ` ${note}` : ''}`
      );
    } catch {
      /* ignore */
    }
  };

  const wrapResult = (response, meta) => ({
    content: extractAssistantContent(response),
    used_enable_search: !!meta.used_enable_search,
    search_degraded: !!meta.search_degraded,
    used_enable_thinking: !!meta.used_enable_thinking,
    thinking_degraded: !!meta.thinking_degraded,
  });

  const attempt = async ({ withSearch, withThinking }) => {
    const response = await post({ withSearch, withThinking });
    const parts = [];
    if (withSearch) parts.push('enable_search=1');
    else parts.push('enable_search=0');
    if (withThinking) parts.push('enable_thinking=1');
    else parts.push('enable_thinking=0');
    logOk(response, parts.join(' '));
    return response;
  };

  const wantSearch = true;
  const tryThinking = wantThinking && isFinancingAiThinkingEnabled();

  try {
    const response = await attempt({ withSearch: wantSearch, withThinking: tryThinking });
    return wrapResult(response, {
      used_enable_search: wantSearch,
      search_degraded: false,
      used_enable_thinking: tryThinking,
      thinking_degraded: false,
    });
  } catch (err) {
    const firstDetail = errorBlob(err);
    if (isHttp400(err) && looksLikeWrongChatUrl(firstDetail)) {
      throw new Error(
        `${firstDetail} 请检查「AI 模型配置」中的接口地址是否为 OpenAI 兼容地址：` +
          `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions（国际域用 dashscope-intl 等）。` +
          `勿使用 …/aigc/text-generation/generation 等原生路径。`
      );
    }
    if (!isHttp400(err)) {
      throw err;
    }

    const thinkingRejected = tryThinking && isThinkingParamRejected(firstDetail);
    const searchRejected = isSearchParamRejected(firstDetail);

    if (tryThinking && (thinkingRejected || !searchRejected)) {
      console.warn(
        `${logPrefix} DashScope 400（含 enable_thinking），将关闭深度思考并保留联网重试。详情: ${firstDetail}`
      );
      try {
        const response2 = await attempt({ withSearch: true, withThinking: false });
        return wrapResult(response2, {
          used_enable_search: true,
          search_degraded: false,
          used_enable_thinking: false,
          thinking_degraded: true,
        });
      } catch (err2) {
        if (!isHttp400(err2)) throw err2;
        const d2 = errorBlob(err2);
        if (!isSearchParamRejected(d2)) {
          throw new Error(d2);
        }
        console.warn(
          `${logPrefix} DashScope 400（联网），将关闭 enable_search 重试。详情: ${d2}`
        );
        const response3 = await attempt({ withSearch: false, withThinking: false });
        return wrapResult(response3, {
          used_enable_search: false,
          search_degraded: true,
          used_enable_thinking: false,
          thinking_degraded: true,
        });
      }
    }

    if (searchRejected || wantSearch) {
      console.warn(
        `${logPrefix} DashScope 400（含 enable_search），将不带联网参数重试。详情: ${firstDetail}`
      );
      try {
        const response4 = await attempt({
          withSearch: false,
          withThinking: tryThinking && !thinkingRejected,
        });
        return wrapResult(response4, {
          used_enable_search: false,
          search_degraded: true,
          used_enable_thinking: tryThinking && !thinkingRejected,
          thinking_degraded: thinkingRejected,
        });
      } catch (err4) {
        if (isHttp400(err4) && tryThinking && !thinkingRejected) {
          const d4 = errorBlob(err4);
          console.warn(
            `${logPrefix} 联网关闭后仍 400，再关闭深度思考重试。详情: ${d4}`
          );
          const response5 = await attempt({ withSearch: false, withThinking: false });
          return wrapResult(response5, {
            used_enable_search: false,
            search_degraded: true,
            used_enable_thinking: false,
            thinking_degraded: true,
          });
        }
        throw err4;
      }
    }

    throw new Error(firstDetail);
  }
}

module.exports = {
  isFinancingAiThinkingEnabled,
  getFinancingAiThinkingBudget,
  postDashScopeChatWithSearchAndThinking,
};
