/**
 * 日志工具模块
 * 提供带时间戳的日志输出函数
 */

/**
 * 格式化时间为字符串（用于日志输出）
 * @returns {string} 格式化的时间字符串，格式：YYYY-MM-DD HH:mm:ss
 */
function getLogTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 带时间戳的日志输出函数
 * @param {...any} args - 日志参数
 */
function logWithTimestamp(...args) {
  const timestamp = getLogTimestamp();
  console.log(`[${timestamp}]`, ...args);
}

/**
 * 带时间戳的错误日志输出函数
 * @param {...any} args - 日志参数
 */
function errorWithTimestamp(...args) {
  const timestamp = getLogTimestamp();
  console.error(`[${timestamp}]`, ...args);
}

/**
 * 带时间戳的警告日志输出函数
 * @param {...any} args - 日志参数
 */
function warnWithTimestamp(...args) {
  const timestamp = getLogTimestamp();
  console.warn(`[${timestamp}]`, ...args);
}

/**
 * 带时间戳和信息标签的日志输出函数
 * @param {string} tag - 日志标签，如 '[新闻同步]', '[AI分析]' 等
 * @param {...any} args - 日志参数
 */
function logWithTag(tag, ...args) {
  const timestamp = getLogTimestamp();
  console.log(`[${timestamp}] ${tag}`, ...args);
}

/**
 * 带时间戳和信息标签的错误日志输出函数
 * @param {string} tag - 日志标签
 * @param {...any} args - 日志参数
 */
function errorWithTag(tag, ...args) {
  const timestamp = getLogTimestamp();
  console.error(`[${timestamp}] ${tag}`, ...args);
}

/**
 * 带时间戳和信息标签的警告日志输出函数
 * @param {string} tag - 日志标签
 * @param {...any} args - 日志参数
 */
function warnWithTag(tag, ...args) {
  const timestamp = getLogTimestamp();
  console.warn(`[${timestamp}] ${tag}`, ...args);
}

module.exports = {
  getLogTimestamp,
  logWithTimestamp,
  errorWithTimestamp,
  warnWithTimestamp,
  logWithTag,
  errorWithTag,
  warnWithTag
};
