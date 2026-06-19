require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const TABLES = [
  'b_transaction_indicator',
  'b_investor_list',
  'b_investment_indicator',
  'b_investment',
  'b_investment_sum',
  'b_manage',
  'b_transaction',
  'b_ipo',
  'b_ipo_a',
  'b_project',
  'b_project_a',
  'b_region',
  'b_region_a',
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const alters = [];
  for (const t of TABLES) {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME, COLUMN_COMMENT, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [process.env.DB_NAME, t]
    );
    for (const r of rows) {
      const comment = String(r.COLUMN_COMMENT || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      let type = r.COLUMN_TYPE;
      const nullable = r.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      let defaultClause = '';
      if (r.COLUMN_DEFAULT != null) {
        if (r.COLUMN_DEFAULT === 'CURRENT_TIMESTAMP') defaultClause = ' DEFAULT CURRENT_TIMESTAMP';
        else if (/^(0|1)$/.test(String(r.COLUMN_DEFAULT)) && /int|tinyint|decimal/i.test(type)) {
          defaultClause = ` DEFAULT ${r.COLUMN_DEFAULT}`;
        } else defaultClause = ` DEFAULT '${String(r.COLUMN_DEFAULT).replace(/'/g, "''")}'`;
      } else if (r.IS_NULLABLE === 'YES') {
        defaultClause = ' DEFAULT NULL';
      }
      const extra = r.EXTRA ? ` ${r.EXTRA}` : '';
      alters.push(
        `ALTER TABLE ${t} MODIFY COLUMN ${r.COLUMN_NAME} ${type} ${nullable}${defaultClause} COMMENT '${comment}'${extra};`
      );
    }
  }
  await conn.end();

  const out = `/** 自动生成：同步业绩看板导出表字段 COMMENT（含 -数字 排序标记） */\nmodule.exports = ${JSON.stringify(alters, null, 2)};\n`;
  fs.writeFileSync(path.join(__dirname, '../server/utils/performance/performanceExportColumnComments.js'), out, 'utf8');
  console.log('Wrote', alters.length, 'ALTER statements');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
