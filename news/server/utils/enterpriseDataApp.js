'use strict';

/**
 * invested_enterprises：data_app_id 存 applications.id（写入以 id 为准）；data_app_name 为历史/展示兼容。
 * 新闻舆情侧抓取、公众号与统一社会信用代码匹配等，请用 `investedEnterpriseNewsAppSql` 中按 id 优先的过滤条件。
 */
const DATA_APP_NEWS_SENTIMENT = '新闻舆情';
const DATA_APP_PROJECT_SOURCING = '项目挖掘';
const DATA_APP_COMPETITOR_ANALYSIS = '竞品分析';

const ALLOWED = new Set([DATA_APP_NEWS_SENTIMENT, DATA_APP_PROJECT_SOURCING, DATA_APP_COMPETITOR_ANALYSIS]);

function normalizeDataAppName(input) {
  if (input === undefined || input === null) return DATA_APP_NEWS_SENTIMENT;
  const v = String(input).trim();
  if (!v) return DATA_APP_NEWS_SENTIMENT;
  return ALLOWED.has(v) ? v : null;
}

module.exports = {
  DATA_APP_NEWS_SENTIMENT,
  DATA_APP_PROJECT_SOURCING,
  DATA_APP_COMPETITOR_ANALYSIS,
  ALLOWED,
  normalizeDataAppName,
};
