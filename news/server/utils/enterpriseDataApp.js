'use strict';

/**
 * invested_enterprises：历史列 data_app_name 存 applications.app_name 文案；
 * 新增列 data_app_id 存 applications.id（写入以 id 为准，避免应用改名影响已落库行）。
 * 列表/权限仍可与 app_name 对齐；迁移期兼容「仅有 data_app_name」的旧数据。
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
