'use strict';

/**
 * 项目估值被投企业：产品简介(AI) / 企业标签(AI) / 企查查介绍为空时，
 * 从 invested_enterprises 同表其它已有值的行按统一社会信用代码（其次企业全称）填空。
 * 不覆盖目标行已有非空字段；不调外部接口。
 */

const {
  DATA_APP_PROJECT_VALUATION,
  investedEnterpriseAppMatchClause,
} = require('../enterpriseDataApp');

const ENRICH_ORDER = `(CASE WHEN NULLIF(TRIM(ai_product_intro),'') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(qcc_company_intro),'') IS NOT NULL THEN 2 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(ai_industry_tags_display),'') IS NOT NULL THEN 1 ELSE 0 END) DESC, F_Id DESC`;

const NORM_UCC = `UPPER(REPLACE(REPLACE(TRIM(IFNULL(unified_credit_code,'')),' ',''),'　',''))`;
const NORM_NAME = `LOWER(TRIM(IFNULL(enterprise_full_name,'')))`;

const HAS_INTRO_SQL = `(
  NULLIF(TRIM(ai_product_intro),'') IS NOT NULL
  OR NULLIF(TRIM(qcc_company_intro),'') IS NOT NULL
  OR NULLIF(TRIM(ai_industry_tags_display),'') IS NOT NULL
)`;

const TARGET_NEEDS_SQL = `(
  NULLIF(TRIM(t.ai_product_intro),'') IS NULL
  OR NULLIF(TRIM(t.qcc_company_intro),'') IS NULL
  OR NULLIF(TRIM(t.ai_industry_tags_display),'') IS NULL
)`;

const FILL_SET_SQL = `
  t.qcc_sync_via = IF(NULLIF(TRIM(IFNULL(t.qcc_company_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.qcc_company_intro,'')),'') IS NOT NULL, 'cross_table_propagate', t.qcc_sync_via),
  t.qcc_sync_at = IF(NULLIF(TRIM(IFNULL(t.qcc_company_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.qcc_company_intro,'')),'') IS NOT NULL, COALESCE(s.qcc_sync_at, NOW()), t.qcc_sync_at),
  t.qcc_sync_error = IF(NULLIF(TRIM(IFNULL(t.qcc_company_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.qcc_company_intro,'')),'') IS NOT NULL, NULL, t.qcc_sync_error),
  t.ai_enrich_status = IF(NULLIF(TRIM(IFNULL(t.ai_product_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_product_intro,'')),'') IS NOT NULL, COALESCE(s.ai_enrich_status, t.ai_enrich_status), t.ai_enrich_status),
  t.ai_enrich_at = IF(NULLIF(TRIM(IFNULL(t.ai_product_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_product_intro,'')),'') IS NOT NULL, COALESCE(s.ai_enrich_at, t.ai_enrich_at), t.ai_enrich_at),
  t.ai_enrich_model = IF(NULLIF(TRIM(IFNULL(t.ai_product_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_product_intro,'')),'') IS NOT NULL, COALESCE(s.ai_enrich_model, t.ai_enrich_model), t.ai_enrich_model),
  t.ai_enrich_version = IF(NULLIF(TRIM(IFNULL(t.ai_product_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_product_intro,'')),'') IS NOT NULL, COALESCE(s.ai_enrich_version, t.ai_enrich_version), t.ai_enrich_version),
  t.ai_industry_tags_json = IF(NULLIF(TRIM(IFNULL(t.ai_industry_tags_display,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_industry_tags_display,'')),'') IS NOT NULL, s.ai_industry_tags_json, t.ai_industry_tags_json),
  t.ai_product_intro = IF(NULLIF(TRIM(IFNULL(t.ai_product_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_product_intro,'')),'') IS NOT NULL, s.ai_product_intro, t.ai_product_intro),
  t.ai_industry_tags_display = IF(NULLIF(TRIM(IFNULL(t.ai_industry_tags_display,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.ai_industry_tags_display,'')),'') IS NOT NULL, s.ai_industry_tags_display, t.ai_industry_tags_display),
  t.qcc_company_intro = IF(NULLIF(TRIM(IFNULL(t.qcc_company_intro,'')),'') IS NULL AND NULLIF(TRIM(IFNULL(s.qcc_company_intro,'')),'') IS NOT NULL, s.qcc_company_intro, t.qcc_company_intro),
  t.F_LastModifyTime = CURRENT_TIMESTAMP
`;

async function queryRows(executor, sql, params) {
  const result = await executor.query(sql, params);
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) {
    return result[0];
  }
  return result;
}

async function execUpdate(executor, sql, params) {
  const result = await executor.execute(sql, params);
  const header = Array.isArray(result) && result.length === 2 ? result[0] : result;
  return Number(header?.affectedRows || 0);
}

async function resolveAppId(executor, appName) {
  const rows = await queryRows(
    executor,
    `SELECT F_Id AS id FROM applications
     WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci =
           CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
     LIMIT 1`,
    [appName]
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

function defaultExecutor() {
  return require('../../db');
}

/**
 * @param {{ executor?: { query: Function, execute: Function }, targetAppName?: string }} [opts]
 * @returns {Promise<{ by_credit: number, by_name: number, target_app_id: string|null }>}
 */
async function backfillValuationInvestedEnterpriseIntros(opts = {}) {
  const executor = opts.executor || defaultExecutor();
  const targetAppName = opts.targetAppName || DATA_APP_PROJECT_VALUATION;
  const appId = await resolveAppId(executor, targetAppName);
  const { sql: appMatch, params: appParams } = investedEnterpriseAppMatchClause('t', appId, targetAppName);

  const sourceByCredit = `
    SELECT e.F_Id,
           e.ai_product_intro, e.ai_industry_tags_display, e.ai_industry_tags_json,
           e.ai_enrich_status, e.ai_enrich_at, e.ai_enrich_model, e.ai_enrich_version,
           e.qcc_company_intro, e.qcc_sync_at,
           ${NORM_UCC.replace(/unified_credit_code/g, 'e.unified_credit_code')} AS ucc
    FROM invested_enterprises e
    INNER JOIN (
      SELECT ${NORM_UCC} AS ucc,
             SUBSTRING_INDEX(GROUP_CONCAT(F_Id ORDER BY ${ENRICH_ORDER} SEPARATOR ','), ',', 1) AS mid
      FROM invested_enterprises
      WHERE F_DeleteMark = 0
        AND unified_credit_code IS NOT NULL AND TRIM(unified_credit_code) != ''
        AND ${HAS_INTRO_SQL}
      GROUP BY ${NORM_UCC}
    ) p ON e.F_Id = p.mid
  `;

  const byCredit = await execUpdate(
    executor,
    `UPDATE invested_enterprises t
     INNER JOIN (${sourceByCredit}) s
       ON s.ucc = ${NORM_UCC.replace(/unified_credit_code/g, 't.unified_credit_code')}
      AND s.F_Id <> t.F_Id
     SET ${FILL_SET_SQL}
     WHERE t.F_DeleteMark = 0
       AND ${appMatch}
       AND ${TARGET_NEEDS_SQL}
       AND t.unified_credit_code IS NOT NULL AND TRIM(t.unified_credit_code) != ''`,
    appParams
  );

  const sourceByName = `
    SELECT e.F_Id,
           e.ai_product_intro, e.ai_industry_tags_display, e.ai_industry_tags_json,
           e.ai_enrich_status, e.ai_enrich_at, e.ai_enrich_model, e.ai_enrich_version,
           e.qcc_company_intro, e.qcc_sync_at,
           ${NORM_NAME.replace(/enterprise_full_name/g, 'e.enterprise_full_name')} AS ename
    FROM invested_enterprises e
    INNER JOIN (
      SELECT ${NORM_NAME} AS ename,
             SUBSTRING_INDEX(GROUP_CONCAT(F_Id ORDER BY ${ENRICH_ORDER} SEPARATOR ','), ',', 1) AS mid
      FROM invested_enterprises
      WHERE F_DeleteMark = 0
        AND ${NORM_NAME} != ''
        AND ${HAS_INTRO_SQL}
      GROUP BY ${NORM_NAME}
    ) p ON e.F_Id = p.mid
  `;

  const byName = await execUpdate(
    executor,
    `UPDATE invested_enterprises t
     INNER JOIN (${sourceByName}) s
       ON s.ename = ${NORM_NAME.replace(/enterprise_full_name/g, 't.enterprise_full_name')}
      AND s.F_Id <> t.F_Id
     SET ${FILL_SET_SQL}
     WHERE t.F_DeleteMark = 0
       AND ${appMatch}
       AND ${TARGET_NEEDS_SQL}
       AND ${NORM_NAME.replace(/enterprise_full_name/g, 't.enterprise_full_name')} != ''`,
    appParams
  );

  return { by_credit: byCredit, by_name: byName, target_app_id: appId };
}

module.exports = {
  backfillValuationInvestedEnterpriseIntros,
};
