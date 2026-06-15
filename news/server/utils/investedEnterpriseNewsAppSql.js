'use strict';

const { DATA_APP_NEWS_SENTIMENT } = require('./enterpriseDataApp');

/**
 * 子查询：applications 表中「新闻舆情」应用的 id（与 db.js 回填 invested_enterprises.data_app_id 的比对方式一致）。
 * 嵌入 SQL 片段，避免在大量调用点逐个 await 传参。
 */
const NEWS_SENTIMENT_APP_ID_SUBSELECT = `(SELECT F_Id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST('${DATA_APP_NEWS_SENTIMENT}' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1)`;

/**
 * invested_enterprises 属于「新闻舆情」监控对象：
 * - 优先 data_app_id 与 applications 中「新闻舆情」id 一致；
 * - data_app_id 为空时回退 COALESCE(data_app_name) = 新闻舆情（兼容迁移前旧行）。
 *
 * @param {string} [alias] 表别名，如 ie；不传表示无别名
 * @returns {string} 已带外层括号的布尔表达式，可直接嵌入 WHERE / JOIN ON
 */
function sqlInvestedEnterpriseNewsApp(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `(${p}data_app_id <=> ${NEWS_SENTIMENT_APP_ID_SUBSELECT} OR (${p}data_app_id IS NULL AND COALESCE(${p}data_app_name, '${DATA_APP_NEWS_SENTIMENT}') = '${DATA_APP_NEWS_SENTIMENT}'))`;
}

const IE_NEWS_APP_FILTER_SQL = sqlInvestedEnterpriseNewsApp();
const IE_NEWS_APP_FILTER_SQL_IE = sqlInvestedEnterpriseNewsApp('ie');

module.exports = {
  sqlInvestedEnterpriseNewsApp,
  IE_NEWS_APP_FILTER_SQL,
  IE_NEWS_APP_FILTER_SQL_IE,
  NEWS_SENTIMENT_APP_ID_SUBSELECT,
};
