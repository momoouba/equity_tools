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
  if (!Array.isArray(externalRows)) {
    externalRows = [];
  }
  /** @type {{ project_name: string, company: string, inv_amount: any, residual_amount: any, ratio: any, ct_amount: any, ct_residual: any, fund: string, sub?: string|null }[]} */
  const prepared = [];
  for (const raw of externalRows) {
    const m = mapRowToIpo(raw);
    if (!m.company || !m.fund) {
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
    if (!ok) continue;
    prepared.push(m);
  }

  if (Array.isArray(externalRows) && externalRows.length > 0 && prepared.length === 0) {
    throw new Error(
      '外部查询有结果，但没有任何一行满足必填字段（company、fund、project_name、各项金额等），已中止同步以免清空现有底层项目'
    );
  }

  const skipped = externalRows.length - prepared.length;

  /**
   * 全量替换：按用户清空 ipo_project（含软删历史）及关联 ipo_project_progress，再以本次 SQL 结果唯一写入。
   * 说明：同一 F_CreatorUserId 下手工录入、导入与历史软删行一并删除，以外部查询结果为唯一快照。
   */
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [idRows] = await conn.query(`SELECT f_id FROM ipo_project WHERE F_CreatorUserId = ?`, [userId]);
    const prevIds = Array.isArray(idRows) ? idRows.map((r) => r.f_id).filter((id) => id != null) : [];
    if (prevIds.length) {
      const ph = prevIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM ipo_project_progress WHERE ipo_project_f_id IN (${ph})`, prevIds);
    }
    await conn.query(`DELETE FROM ipo_project WHERE F_CreatorUserId = ?`, [userId]);

    if (!prepared.length) {
      await conn.commit();
      return {
        inserted: 0,
        updated: 0,
        skipped,
        deletedPrevious: prevIds.length,
        total: externalRows.length,
        message: '查询成功，已清空该用户底层项目（本次无有效行可写入）',
      };
    }

    let inserted = 0;
    const now = new Date();

    for (const m of prepared) {
      const project_no = await generateIpoProjectNo();
      await conn.execute(
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

    await conn.commit();
    return {
      inserted,
      updated: 0,
      skipped,
      deletedPrevious: prevIds.length,
      total: externalRows.length,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  assertReadOnlySql,
  ensureExternalPool,
  formatExternalSqlError,
  runIpoProjectSqlSyncForUser,
};
