'use strict';

/**
 * 日志中展示 searchKey（信用码或公司名），过长时中间省略。
 * @param {string} searchKey
 * @returns {string}
 */
function maskSearchKeyForLog(searchKey) {
  const k = String(searchKey ?? '').trim();
  if (!k) return '(empty)';
  if (k.length <= 18) return k;
  return `${k.slice(0, 8)}…${k.slice(-4)}(${k.length})`;
}

/**
 * 截断响应体用于日志（避免刷屏或泄露过长正文）。
 * @param {unknown} data
 * @param {number} [maxLen]
 * @returns {string}
 */
function previewBodyForLog(data, maxLen = 400) {
  if (data == null) return '';
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
  } catch {
    return String(data).slice(0, maxLen);
  }
}

module.exports = { maskSearchKeyForLog, previewBodyForLog };
