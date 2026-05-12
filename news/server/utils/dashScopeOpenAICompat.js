/**
 * DashScope OpenAI 兼容 Chat Completions：端点规范化与 HTTP 错误摘要。
 * 与 financingAiEnrichService 中逻辑保持一致，供打新日历等轻量调用复用。
 */

function normalizeDashScopeChatEndpoint(raw) {
  const DEFAULT_CN = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const DEFAULT_INTL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
  const DEFAULT_US = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions';

  const u = raw != null ? String(raw).trim() : '';
  const lower = u.toLowerCase();

  const defaultByHost = () => {
    if (lower.includes('dashscope-intl') || lower.includes('intl.aliyuncs')) return DEFAULT_INTL;
    if (lower.includes('dashscope-us') || lower.includes('us.aliyuncs')) return DEFAULT_US;
    return DEFAULT_CN;
  };

  const isNativeDashScopePath =
    lower.includes('aigc/text-generation') ||
    lower.includes('/api/v1/aigc/') ||
    (lower.includes('text-generation') &&
      lower.includes('generation') &&
      !lower.includes('compatible-mode'));

  if (!u) return DEFAULT_CN;

  if (isNativeDashScopePath) {
    const fallback = defaultByHost();
    console.warn(
      `[dashScopeOpenAICompat] api_endpoint 为 DashScope 原生路径或非 OpenAI 兼容地址（当前: ${u}），已自动改用: ${fallback}`
    );
    return fallback;
  }

  const trimmed = u.replace(/\/$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/compatible-mode\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;

  if (/dashscope[^/]*\.aliyuncs\.com/i.test(lower) && !lower.includes('compatible-mode')) {
    const fallback = defaultByHost();
    console.warn(`[dashScopeOpenAICompat] api_endpoint 未包含 compatible-mode（当前: ${u}），已使用: ${fallback}`);
    return fallback;
  }

  if (/^https?:\/\//i.test(trimmed)) return `${trimmed}/chat/completions`;

  return DEFAULT_CN;
}

function formatDashScopeHttpError(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  let detail = '';
  if (data && typeof data === 'object') {
    detail =
      data.error?.message ||
      data.message ||
      (typeof data.error === 'string' ? data.error : '') ||
      '';
    if (!detail) {
      try {
        detail = JSON.stringify(data);
      } catch {
        detail = String(data);
      }
    }
  } else if (data != null) {
    detail = String(data);
  }
  const head = status != null ? `HTTP ${status}` : '请求失败';
  return detail ? `${head}: ${detail}` : `${head}: ${err.message || 'unknown'}`;
}

module.exports = {
  normalizeDashScopeChatEndpoint,
  formatDashScopeHttpError,
};
