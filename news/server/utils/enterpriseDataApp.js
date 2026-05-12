'use strict';

/**
 * invested_enterprises.data_app_name 与 users.app_permissions 中 app_name 对齐，
 * 用于隔离「新闻舆情」与「项目挖掘」两套监控对象数据。
 */
const DATA_APP_NEWS_SENTIMENT = '新闻舆情';
const DATA_APP_PROJECT_SOURCING = '项目挖掘';

const ALLOWED = new Set([DATA_APP_NEWS_SENTIMENT, DATA_APP_PROJECT_SOURCING]);

function normalizeDataAppName(input) {
  if (input === undefined || input === null) return DATA_APP_NEWS_SENTIMENT;
  const v = String(input).trim();
  if (!v) return DATA_APP_NEWS_SENTIMENT;
  return ALLOWED.has(v) ? v : null;
}

module.exports = {
  DATA_APP_NEWS_SENTIMENT,
  DATA_APP_PROJECT_SOURCING,
  ALLOWED,
  normalizeDataAppName,
};
