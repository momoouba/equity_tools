'use strict';

/**
 * 将项目估值被投企业空的产品简介/标签/企查查介绍，从 invested_enterprises 同表其它已有值的行回填。
 * Usage: node server/scripts/backfillValuationInvestedIntros.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), override: true });
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const mysql = require('mysql2/promise');
const {
  backfillValuationInvestedEnterpriseIntros,
} = require('../utils/valuation/investedEnterpriseIntroBackfill');

function wrapPool(pool) {
  return {
    query: async (sql, params) => {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    execute: async (sql, params) => {
      const [result] = await pool.execute(sql, params);
      return result;
    },
  };
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'investment_tools',
    waitForConnections: true,
    connectionLimit: 4,
  });
  const exec = wrapPool(pool);
  try {
    const [valApp] = await pool.query(
      `SELECT F_Id AS id FROM applications WHERE app_name = '项目估值' LIMIT 1`
    );
    const valAppId = valApp[0]?.id || null;
    const gapSql = `
       SELECT COUNT(*) AS c
       FROM invested_enterprises
       WHERE F_DeleteMark = 0
         AND (data_app_name = '项目估值' OR data_app_id <=> ?)
         AND (
           NULLIF(TRIM(ai_product_intro),'') IS NULL
           OR NULLIF(TRIM(qcc_company_intro),'') IS NULL
           OR NULLIF(TRIM(ai_industry_tags_display),'') IS NULL
         )`;
    const [gapBefore] = await pool.query(gapSql, [valAppId]);
    const stats = await backfillValuationInvestedEnterpriseIntros({ executor: exec });
    const [gapAfter] = await pool.query(gapSql, [valAppId]);
    const [sample] = await pool.query(
      `SELECT enterprise_full_name, data_app_name,
              CHAR_LENGTH(IFNULL(ai_product_intro,'')) AS intro_len,
              CHAR_LENGTH(IFNULL(ai_industry_tags_display,'')) AS tags_len,
              CHAR_LENGTH(IFNULL(qcc_company_intro,'')) AS qcc_len,
              qcc_sync_via
       FROM invested_enterprises
       WHERE F_DeleteMark = 0
         AND enterprise_full_name LIKE '%麦阳光%'
       ORDER BY data_app_name, F_Id`
    );
    console.log(JSON.stringify({
      gap_before: Number(gapBefore[0]?.c || 0),
      gap_after: Number(gapAfter[0]?.c || 0),
      stats,
      sample: sample.map((r) => ({
        name: r.enterprise_full_name,
        app: r.data_app_name,
        intro_len: r.intro_len,
        tags_len: r.tags_len,
        qcc_len: r.qcc_len,
        qcc_sync_via: r.qcc_sync_via,
      })),
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
