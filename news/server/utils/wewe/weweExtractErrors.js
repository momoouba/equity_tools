/**
 * wewe 提取错误分类 / 会话 TTL 判定（无 DB，可供单测直接 require）
 */
const SESSION_DEAD_RE = /登录|失效|扫码|未登录|auth|token|session|账号.*(过期|无效)|请重新/i;
const WEWE_DOWN_RE =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|暂无可用读书账号|无可用读书账号/i;
const HTTP_404_RE = /status code 404|HTTP 404/i;

function errorText(err) {
  return String((err && err.message) || err || '');
}

function errorStatus(err) {
  if (!err || typeof err !== 'object') return 0;
  return Number(err.status || (err.response && err.response.status) || 0);
}

function isHttp404Error(err) {
  if (!err) return false;
  if (errorStatus(err) === 404) return true;
  const msg = errorText(err);
  const body = err.body ? JSON.stringify(err.body) : '';
  return HTTP_404_RE.test(msg) || HTTP_404_RE.test(body);
}

function isSessionDeadError(err) {
  const msg = errorText(err);
  const body = err && err.body ? JSON.stringify(err.body) : '';
  return SESSION_DEAD_RE.test(msg) || SESSION_DEAD_RE.test(body);
}

function isWeweUnavailableError(err) {
  if (!err) return false;
  // 微信读书侧 404（常被 tRPC 包成 500，message 仍是 axios 原文）≠ wewe-rss 宕机
  if (isHttp404Error(err)) return false;
  const msg = errorText(err);
  const code = String(err.code || '');
  const status = errorStatus(err);
  if (WEWE_DOWN_RE.test(msg) || WEWE_DOWN_RE.test(code)) return true;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

/** TTL 已过或库内已标 expired：即使 pause_extract=0 也应停提取 */
function isSessionTtlExpired(session, cfg = {}, now = new Date()) {
  if (!session) return false;
  if (String(session.session_status || '') === 'expired') return true;
  const lastLogin = session.last_login_at ? new Date(session.last_login_at) : null;
  if (!lastLogin || Number.isNaN(lastLogin.getTime())) return false;
  const ttlHours = Number(session.session_ttl_hours || cfg.session_ttl_hours || 24) || 24;
  return now.getTime() >= lastLogin.getTime() + ttlHours * 3600 * 1000;
}

module.exports = {
  SESSION_DEAD_RE,
  WEWE_DOWN_RE,
  isHttp404Error,
  isSessionDeadError,
  isWeweUnavailableError,
  isSessionTtlExpired
};
