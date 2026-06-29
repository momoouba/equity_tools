'use strict';

/**
 * Claude Opus 4.7+ 不再接受非默认的 temperature / top_p / top_k，传参会 400。
 * @see https://platform.claude.com/docs/en/about-claude/models/migration-guide
 */
function anthropicModelOmitsSamplingParams(modelName) {
  const m = String(modelName || '').trim().toLowerCase();
  if (!m.includes('opus')) return false;
  const match = m.match(/opus-4-(\d+)/);
  if (match) {
    return parseInt(match[1], 10) >= 7;
  }
  return false;
}

/** 返回应写入 Anthropic Messages body 的 temperature，不支持时返回 undefined。 */
function resolveAnthropicTemperature(modelName, temperature) {
  if (anthropicModelOmitsSamplingParams(modelName)) return undefined;
  return Number.isFinite(temperature) ? temperature : undefined;
}

module.exports = {
  anthropicModelOmitsSamplingParams,
  resolveAnthropicTemperature,
};
