/**
 * 交易所 IPO 宽名单 / 终态判定（§1.4.5）
 */

const WATCHLIST_PATTERNS = [
  '已问询',
  '中止',
  '上市委',
  '提交注册',
  '注册结果',
  '注册',
  '不予注册',
];

const TERMINAL_PATTERNS = ['终止', '不予注册', '注册生效', '注册', '核准注册', '同意注册'];

const MAINLAND_EXCHANGES = new Set(['深交所', '上交所', '北交所']);

function normalizeStatusText(s) {
  return String(s || '')
    .replace(/[()（）]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function isWatchlistStatus(status) {
  const x = normalizeStatusText(status);
  if (!x) return false;
  if (WATCHLIST_PATTERNS.some((p) => x.includes(p))) {
    // 「注册」 alone may match 提交注册; exclude pure 已受理
    if (x === '已受理' || x.includes('已受理')) return false;
    return true;
  }
  return false;
}

function isTerminalStatus(status) {
  const x = normalizeStatusText(status);
  if (!x) return false;
  // 注册生效 / 终止 / 不予注册
  if (/终止/.test(x)) return true;
  if (/不予注册/.test(x)) return true;
  if (/注册生效/.test(x)) return true;
  if (/核准注册|同意注册/.test(x)) return true;
  // 北交所「注册」终态（非「提交注册」）
  if (x === '注册' || (x.includes('注册') && !x.includes('提交') && !x.includes('问询'))) {
    return TERMINAL_PATTERNS.some((p) => x.includes(p));
  }
  return false;
}

function defaultMaxAttempts(exchange) {
  return exchange === '北交所' ? 45 : 21;
}

function isMainlandExchange(exchange) {
  return MAINLAND_EXCHANGES.has(String(exchange || '').trim());
}

module.exports = {
  WATCHLIST_PATTERNS,
  TERMINAL_PATTERNS,
  MAINLAND_EXCHANGES,
  normalizeStatusText,
  isWatchlistStatus,
  isTerminalStatus,
  defaultMaxAttempts,
  isMainlandExchange,
};
