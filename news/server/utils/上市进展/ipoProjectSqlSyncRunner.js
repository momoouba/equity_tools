const db = require('../../db');
const { generateIpoProjectNo } = require('./ipoProjectNumber');
const { getExternalPool, createExternalPool, queryExternal, closeExternalPool } = require('../externalDb');

const IPO_FIELDS = [
  'project_name',
  'company',
  'inv_amount',
  'residual_amount',
  'ratio',
  'ct_amount',
  'ct_residual',
  'fund',
  'sub',
];

function assertReadOnlySql(sql) {
  const s = String(sql || '')
    .trim()
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/gm, '');
  const first = s.split(/\s+/)[0]?.toLowerCase();
  if (first !== 'select' && first !== 'with') {
    throw new Error('仅允许 SELECT / WITH 查询');
  }
}

function camelToSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
}

function getFieldValue(row, fieldName) {
  if (row[fieldName] !== undefined) return row[fieldName];
  const camel = snakeToCamel(fieldName);
  if (row[camel] !== undefined) return row[camel];
  const snake = camelToSnake(fieldName);
  if (snake !== fieldName && row[snake] !== undefined) return row[snake];
  return undefined;
}

function mapRowToIpo(row) {
  const out = {};
  for (const f of IPO_FIELDS) {
    const v = getFieldValue(row, f);
    if (v !== undefined) out[f] = v;
  }

  const numFields = ['inv_amount', 'residual_amount', 'ratio', 'ct_amount', 'ct_residual'];
  for (const f of numFields) {
    if (out[f] === undefined || out[f] === null || out[f] === '') continue;
    const n = Number(out[f]);
    out[f] = Number.isFinite(n) ? n : out[f];
  }
  if (out.sub !== undefined && out.sub !== null) out.sub = String(out.sub).trim() || null;
  if (out.company !== undefined && out.company !== null) out.company = String(out.company).trim();
  if (out.fund !== undefined && out.fund !== null) out.fund = String(out.fund).trim();

  return out;
}

function normalizeDedupSub(sub) {
  if (sub == null || sub === '') return '';
  return String(sub).trim();
}

function formatExternalSqlError(error) {
  if (!error) return 'SQL 执行失败';
  if (error.code === 'ECONNRESET') {
    return '外部数据库连接被重置（ECONNRESET），请检查外部数据库服务状态、网络与防火墙配置后重试';
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'PROTOCOL_CONNECTION_LOST') {
    return `外部数据库连接异常（${error.code}），请检查网络连通性或数据库空闲连接超时配置`;
  }
  const msg = error.sqlMessage || error.message || 'SQL 执行失败';
  const code = error.code ? ` (${error.code})` : '';
  return `${msg}${code}`;
}

async function ensureExternalPool(configId) {
  const pool = getExternalPool(configId);
  if (pool) return;
  const configs = await db.query(
    'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0 AND is_active = 1',
    [configId]
  );
  if (!configs.length) throw new Error('数据库配置不存在或未启用');
  await createExternalPool(configs[0]);
}

async function runIpoProjectSqlSyncForUser({ userId, external_db_config_id, sql_text, is_enabled }) {
  const configId = external_db_config_id;
  const sqlText = (sql_text || '').trim();
  const enabled = is_enabled === false || is_enabled === 0 || is_enabled === '0' ? 0 : 1;

  if (!userId) throw new Error('缺少 userId');
  if (!configId) throw new Error('请选择业务数据库连接');
  if (!sqlText) throw new Error('请填写 SQL 或先保存配置');
  if (!enabled) throw new Error('当前配置未启用，请先启用后再执行同步');
  assertReadOnlySql(sqlText);

  await ensureExternalPool(configId);
  let externalRows;
  try {
    externalRows = await queryExternal(configId, sqlText, []);
  } catch (error) {
    // 外部连接偶发被远端重置：主动销毁并重建连接池后重试一次
    if (error && ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT'].includes(error.code)) {
      try {
        await closeExternalPool(configId);
      } catch (closeErr) {
        // ignore close error, still try recreate
      }
      await ensureExternalPool(configId);
      externalRows = await queryExternal(configId, sqlText, []);
    } else {
      throw error;
    }
  }
  if (!Array.isArray(externalRows) || externalRows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, total: 0, message: '查询成功，无数据可同步' };
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date();

  for (const raw of externalRows) {
    const m = mapRowToIpo(raw);
    if (!m.company || !m.fund) {
      skipped += 1;
      continue;
    }
    const need = ['project_name', 'inv_amount', 'residual_amount', 'ratio', 'ct_amount', 'ct_residual'];
    let ok = true;
    for (const k of need) {
      if (m[k] === undefined || m[k] === null || m[k] === '') {
        ok = false;
        break;
      }
    }
    if (!ok) {
      skipped += 1;
      continue;
    }

    const subNorm = normalizeDedupSub(m.sub);
    const existing = await db.query(
      `SELECT f_id, project_name, company, inv_amount, residual_amount, ratio, ct_amount, ct_residual, fund, sub
       FROM ipo_project
       WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?
         AND fund = ? AND IFNULL(TRIM(sub), '') = ? AND company = ?
       LIMIT 1`,
      [userId, m.fund, subNorm, m.company]
    );

    if (existing.length) {
      const ex = existing[0];
      const n = (v) => (v == null || v === '' ? null : Number(v));
      const same =
        String(ex.project_name || '') === String(m.project_name || '') &&
        String(ex.company || '') === String(m.company || '') &&
        n(ex.inv_amount) === n(m.inv_amount) &&
        n(ex.residual_amount) === n(m.residual_amount) &&
        n(ex.ratio) === n(m.ratio) &&
        n(ex.ct_amount) === n(m.ct_amount) &&
        n(ex.ct_residual) === n(m.ct_residual) &&
        String(ex.fund || '') === String(m.fund || '') &&
        normalizeDedupSub(ex.sub) === subNorm;

      if (same) {
        skipped += 1;
        continue;
      }

      await db.execute(
        `UPDATE ipo_project SET
          project_name = ?, company = ?, inv_amount = ?, residual_amount = ?, ratio = ?,
          ct_amount = ?, ct_residual = ?, fund = ?, sub = ?,
          biz_update_time = ?, F_LastModifyUserId = ?, F_LastModifyTime = ?
         WHERE f_id = ?`,
        [
          m.project_name,
          m.company,
          m.inv_amount,
          m.residual_amount,
          m.ratio,
          m.ct_amount,
          m.ct_residual,
          m.fund,
          m.sub ?? null,
          now,
          userId,
          now,
          ex.f_id,
        ]
      );
      updated += 1;
    } else {
      const project_no = await generateIpoProjectNo();
      await db.execute(
        `INSERT INTO ipo_project (
          project_no, biz_update_time, F_CreatorTime, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime,
          project_name, company, inv_amount, residual_amount, ratio, ct_amount, ct_residual, fund, sub
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project_no,
          now,
          now,
          userId,
          userId,
          now,
          m.project_name,
          m.company,
          m.inv_amount,
          m.residual_amount,
          m.ratio,
          m.ct_amount,
          m.ct_residual,
          m.fund,
          m.sub ?? null,
        ]
      );
      inserted += 1;
    }
  }

  return { inserted, updated, skipped, total: externalRows.length };
}

module.exports = {
  assertReadOnlySql,
  ensureExternalPool,
  formatExternalSqlError,
  runIpoProjectSqlSyncForUser,
};
