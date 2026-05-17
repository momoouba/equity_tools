'use strict';

/**
 * 将 applications.app_name 解析为 applications.id（带内存缓存）。
 * 业务表写入以 id 为准，避免应用改名导致历史行语义漂移。
 */
const db = require('../db');
const { DATA_APP_PROJECT_SOURCING, DATA_APP_COMPETITOR_ANALYSIS } = require('./enterpriseDataApp');

const idByAppName = new Map();

/**
 * @param {string} appName applications.app_name（如 项目挖掘、新闻舆情）
 * @returns {Promise<string|null>} applications.id
 */
async function getApplicationIdByAppName(appName) {
  const key = String(appName == null ? '' : appName).trim();
  if (!key) return null;
  if (idByAppName.has(key)) {
    const cached = idByAppName.get(key);
    return cached === false ? null : cached;
  }
  const rows = await db.query(
    `SELECT id FROM applications
     WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci =
           CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
     LIMIT 1`,
    [key]
  );
  const id = rows.length ? String(rows[0].id) : false;
  idByAppName.set(key, id === false ? false : id);
  return id === false ? null : id;
}

/**
 * 是否「项目挖掘」应用下的被投企业行（优先 data_app_id，旧数据仅 data_app_name 时回退字符串比对）。
 * @param {{ data_app_id?: string|null, data_app_name?: string|null }} row
 */
async function isInvestedEnterpriseProjectSourcingApp(row) {
  const psId = await getApplicationIdByAppName(DATA_APP_PROJECT_SOURCING);
  const idCol = row.data_app_id != null ? String(row.data_app_id).trim() : '';
  if (idCol && psId) return idCol === psId;
  return String(row.data_app_name || '') === DATA_APP_PROJECT_SOURCING;
}

/**
 * 是否「项目挖掘」应用下的底层项目行（`ipo_project.data_app_id`）。
 * @param {{ data_app_id?: string|null }} row
 */
async function isIpoProjectProjectSourcingApp(row) {
  const psId = await getApplicationIdByAppName(DATA_APP_PROJECT_SOURCING);
  const idCol = row.data_app_id != null ? String(row.data_app_id).trim() : '';
  return !!(idCol && psId && idCol === psId);
}

/**
 * 是否「竞品分析」应用下的被投企业行。
 */
async function isInvestedEnterpriseCompetitorAnalysisApp(row) {
  const caId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  const idCol = row.data_app_id != null ? String(row.data_app_id).trim() : '';
  if (idCol && caId) return idCol === caId;
  return String(row.data_app_name || '') === DATA_APP_COMPETITOR_ANALYSIS;
}

/**
 * 是否「竞品分析」应用下的底层项目行。
 */
async function isIpoProjectCompetitorAnalysisApp(row) {
  const caId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  const idCol = row.data_app_id != null ? String(row.data_app_id).trim() : '';
  return !!(idCol && caId && idCol === caId);
}

module.exports = {
  getApplicationIdByAppName,
  isInvestedEnterpriseProjectSourcingApp,
  isIpoProjectProjectSourcingApp,
  isInvestedEnterpriseCompetitorAnalysisApp,
  isIpoProjectCompetitorAnalysisApp,
};
