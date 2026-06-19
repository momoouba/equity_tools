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

/** 列表/硬删/快照：以 data_app_id 为准，data_app_name 仅兜底 NULL id 的历史行 */
function investedEnterpriseAppMatchClause(alias, dataAppId, dataAppName) {
  const p = alias ? `${alias}.` : '';
  if (dataAppId) {
    return {
      sql: `(${p}data_app_id <=> ? OR (${p}data_app_id IS NULL AND ${p}data_app_name = ?))`,
      params: [dataAppId, dataAppName],
    };
  }
  return {
    sql: `${p}data_app_name = ?`,
    params: [dataAppName],
  };
}

/**
 * 同步任务「本用户」范围：含 F_CreatorUserId 为空的历史行（批量导入/迁移遗留）。
 * 管理员列表可见全应用数据，但定时任务仅按任务所属用户硬删；须纳入空创建人行。
 */
function investedEnterpriseSyncOwnerClause(alias, syncOwnerUserId) {
  const p = alias ? `${alias}.` : '';
  if (!syncOwnerUserId) {
    return { sql: '1=1', params: [] };
  }
  return {
    sql: `(${p}F_CreatorUserId <=> ? OR ${p}F_CreatorUserId IS NULL OR TRIM(IFNULL(${p}F_CreatorUserId,'')) = '')`,
    params: [syncOwnerUserId],
  };
}

module.exports = {
  DATA_APP_NEWS_SENTIMENT,
  DATA_APP_PROJECT_SOURCING,
  DATA_APP_COMPETITOR_ANALYSIS,
  ALLOWED,
  normalizeDataAppName,
  investedEnterpriseAppMatchClause,
  investedEnterpriseSyncOwnerClause,
};
