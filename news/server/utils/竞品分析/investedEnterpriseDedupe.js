'use strict';

const db = require('../../db');
const CA_C = require('./constants');
const { migrateCompetitorEnterpriseIds } = require('./competitorSyncSnapshot');

const MERGE_FIELDS = [
  'ai_product_intro',
  'ai_industry_tags_display',
  'ai_industry_tags_json',
  'ai_enrich_status',
  'ai_enrich_at',
  'ai_enrich_model',
  'ai_enrich_version',
  'qcc_company_intro',
  'wechat_official_account_id',
  'official_website',
];

const ENRICH_ORDER = `(CASE WHEN NULLIF(TRIM(ai_product_intro),'') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(qcc_company_intro),'') IS NOT NULL THEN 2 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(ai_industry_tags_display),'') IS NOT NULL THEN 1 ELSE 0 END) DESC, id DESC`;

const NORM_UCC = `UPPER(REPLACE(TRIM(IFNULL(unified_credit_code,'')),' ',''))`;
const NORM_NAME = `LOWER(TRIM(IFNULL(enterprise_full_name,'')))`;
const NORM_ABBR = `LOWER(TRIM(IFNULL(project_abbreviation,'')))`;

function mergeWechatIds(a, b) {
  const oldStr = (a || '').trim();
  const newStr = (b || '').trim();
  if (!oldStr && !newStr) return null;
  if (!oldStr) return newStr;
  if (!newStr) return oldStr;
  const merged = new Set([
    ...oldStr.split(',').map((s) => s.trim()).filter(Boolean),
    ...newStr.split(',').map((s) => s.trim()).filter(Boolean),
  ]);
  return merged.size ? [...merged].join(',') : null;
}

async function mergeKeeperAndDeleteExtras(executor, keeperRow, extraRows, caName) {
  const keeper = { ...keeperRow };
  for (const row of extraRows) {
    for (const f of MERGE_FIELDS) {
      if (f === 'wechat_official_account_id') {
        keeper[f] = mergeWechatIds(keeper[f], row[f]);
        continue;
      }
      const kv = keeper[f];
      const rv = row[f];
      const keeperEmpty = kv == null || String(kv).trim() === '';
      const rowHas = rv != null && String(rv).trim() !== '';
      if (keeperEmpty && rowHas) keeper[f] = rv;
    }
    await migrateCompetitorEnterpriseIds(row.id, keeper.id);
    await executor.execute('DELETE FROM invested_enterprises WHERE id = ?', [row.id]);
  }
  await executor.execute(
    `UPDATE invested_enterprises SET
       ai_product_intro = ?, ai_industry_tags_display = ?, ai_industry_tags_json = ?,
       ai_enrich_status = ?, ai_enrich_at = ?, ai_enrich_model = ?, ai_enrich_version = ?,
       qcc_company_intro = ?, wechat_official_account_id = ?, official_website = ?,
       data_app_name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      keeper.ai_product_intro,
      keeper.ai_industry_tags_display,
      keeper.ai_industry_tags_json,
      keeper.ai_enrich_status,
      keeper.ai_enrich_at,
      keeper.ai_enrich_model,
      keeper.ai_enrich_version,
      keeper.qcc_company_intro,
      keeper.wechat_official_account_id,
      keeper.official_website,
      caName,
      keeper.id,
    ]
  );
  return extraRows.length;
}

/**
 * 竞品分析被投企业去重：同用户 +（信用代码 / 企业全称 / 项目简称）多行合并 AI、企查查、公众号与官网后删余行。
 * @param {import('mysql2/promise').Pool|object} [executor] 默认 db；传 dbPool 用于 initializeTables
 * @returns {Promise<number>} 删除的重复行数
 */
async function dedupeCompetitorInvestedEnterprises(executor = db) {
  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const caName = CA_C.APP_NAME_COMPETITOR_ANALYSIS;
  let deduped = 0;

  const selectCols = `id, ai_product_intro, ai_industry_tags_display, ai_industry_tags_json,
    ai_enrich_status, ai_enrich_at, ai_enrich_model, ai_enrich_version, qcc_company_intro,
    wechat_official_account_id, official_website`;

  const [byUcc] = await executor.query(
    `SELECT creator_user_id, ${NORM_UCC} AS ucc, COUNT(*) AS cnt
     FROM invested_enterprises
     WHERE delete_mark = 0 AND data_app_id <=> ?
       AND unified_credit_code IS NOT NULL AND TRIM(unified_credit_code) != ''
     GROUP BY creator_user_id, ${NORM_UCC}
     HAVING cnt > 1`,
    [caId]
  );
  for (const g of byUcc) {
    const [rows] = await executor.query(
      `SELECT ${selectCols}
       FROM invested_enterprises
       WHERE delete_mark = 0 AND data_app_id <=> ?
         AND creator_user_id <=> ? AND ${NORM_UCC} = ?
       ORDER BY ${ENRICH_ORDER}`,
      [caId, g.creator_user_id, g.ucc]
    );
    if (rows.length < 2) continue;
    deduped += await mergeKeeperAndDeleteExtras(executor, rows[0], rows.slice(1), caName);
  }

  const [byName] = await executor.query(
    `SELECT creator_user_id, ${NORM_NAME} AS ename, COUNT(*) AS cnt
     FROM invested_enterprises
     WHERE delete_mark = 0 AND data_app_id <=> ?
       AND (${NORM_UCC} = '' OR unified_credit_code IS NULL OR TRIM(unified_credit_code) = '')
       AND ${NORM_NAME} != ''
     GROUP BY creator_user_id, ${NORM_NAME}
     HAVING cnt > 1`,
    [caId]
  );
  for (const g of byName) {
    const [rows] = await executor.query(
      `SELECT ${selectCols}
       FROM invested_enterprises
       WHERE delete_mark = 0 AND data_app_id <=> ?
         AND creator_user_id <=> ? AND ${NORM_NAME} = ?
         AND (${NORM_UCC} = '' OR unified_credit_code IS NULL OR TRIM(unified_credit_code) = '')
       ORDER BY ${ENRICH_ORDER}`,
      [caId, g.creator_user_id, g.ename]
    );
    if (rows.length < 2) continue;
    deduped += await mergeKeeperAndDeleteExtras(executor, rows[0], rows.slice(1), caName);
  }

  const [byAbbr] = await executor.query(
    `SELECT creator_user_id, ${NORM_ABBR} AS abbr, COUNT(*) AS cnt
     FROM invested_enterprises
     WHERE delete_mark = 0 AND data_app_id <=> ?
       AND (${NORM_UCC} = '' OR unified_credit_code IS NULL OR TRIM(unified_credit_code) = '')
       AND ${NORM_NAME} = ''
       AND ${NORM_ABBR} != ''
     GROUP BY creator_user_id, ${NORM_ABBR}
     HAVING cnt > 1`,
    [caId]
  );
  for (const g of byAbbr) {
    const [rows] = await executor.query(
      `SELECT ${selectCols}
       FROM invested_enterprises
       WHERE delete_mark = 0 AND data_app_id <=> ?
         AND creator_user_id <=> ? AND ${NORM_ABBR} = ?
         AND (${NORM_UCC} = '' OR unified_credit_code IS NULL OR TRIM(unified_credit_code) = '')
         AND ${NORM_NAME} = ''
       ORDER BY ${ENRICH_ORDER}`,
      [caId, g.creator_user_id, g.abbr]
    );
    if (rows.length < 2) continue;
    deduped += await mergeKeeperAndDeleteExtras(executor, rows[0], rows.slice(1), caName);
  }

  return deduped;
}

module.exports = {
  dedupeCompetitorInvestedEnterprises,
};
