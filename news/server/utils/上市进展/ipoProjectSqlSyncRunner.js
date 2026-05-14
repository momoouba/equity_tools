const crypto = require('crypto');
const db = require('../../db');
const { allocateConsecutiveIpoProjectNos } = require('./ipoProjectNumber');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { getExternalPool, createExternalPool, queryExternal, closeExternalPool } = require('../externalDb');

const IPO_FIELDS = [
  'project_name',
  'company',
  'unified_credit_code',
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
  if (out.unified_credit_code !== undefined && out.unified_credit_code !== null) {
    const u = String(out.unified_credit_code).replace(/\s+/g, '').trim();
    out.unified_credit_code = u || null;
  }

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
    'SELECT * FROM external_db_config WHERE id = ? AND delete_mark = 0 AND is_active = 1',
    [configId]
  );
  if (!configs.length) throw new Error('数据库配置不存在或未启用');
  await createExternalPool(configs[0]);
}

/** 与 ipo_project_sql_sync_setting.write_target 一致：listing=上市进展写入；project_sourcing=项目挖掘写入 */
const IPO_SQL_WRITE_TARGET_LISTING = 'listing';
const IPO_SQL_WRITE_TARGET_PROJECT_SOURCING = 'project_sourcing';

/** MySQL：与快照表 unified_credit_code 存值一致（trim、去空格、大写） */
function sqlNormIpoProjectUnifiedCredit(alias) {
  const p = alias ? `${alias}.` : '';
  return `UPPER(REPLACE(TRIM(IFNULL(${p}unified_credit_code,'')),' ',''))`;
}

/**
 * 硬删前写入 AI/企查查快照（仅统一社会信用代码非空；同一信用多行取 f_id 最大一条）。
 * data_app_id 存本次同步目标 applications.id，便于与写入后的新行 JOIN 回填。
 */
async function insertIpoProjectAiSnapshotBeforeDelete(conn, { batchId, userId, targetDataAppId, listingAppId, wt }) {
  const normP = sqlNormIpoProjectUnifiedCredit('p');
  const normSub = sqlNormIpoProjectUnifiedCredit('ipo_sub');
  const scopeWhere =
    wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING
      ? 'ipo_sub.F_CreatorUserId = ? AND ipo_sub.data_app_id <=> ?'
      : 'ipo_sub.F_CreatorUserId = ? AND (ipo_sub.data_app_id <=> ? OR ipo_sub.data_app_id IS NULL)';
  const scopeParams =
    wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING ? [userId, targetDataAppId] : [userId, listingAppId];

  const sql = `
    INSERT INTO ipo_project_ai_sync_snapshot (
      batch_id, F_CreatorUserId, data_app_id, unified_credit_code,
      ai_product_intro, ai_industry_tags_display, ai_industry_tags_json,
      ai_enrich_status, ai_enrich_at, ai_enrich_model, ai_enrich_version,
      qcc_company_intro
    )
    SELECT ?, p.F_CreatorUserId, ?, ${normP},
           p.ai_product_intro, p.ai_industry_tags_display, p.ai_industry_tags_json,
           p.ai_enrich_status, p.ai_enrich_at, p.ai_enrich_model, p.ai_enrich_version,
           p.qcc_company_intro
    FROM ipo_project p
    INNER JOIN (
      SELECT ipo_sub.F_CreatorUserId, ${normSub} AS ucc, MAX(ipo_sub.f_id) AS mid
      FROM ipo_project ipo_sub
      WHERE ${scopeWhere}
        AND ipo_sub.unified_credit_code IS NOT NULL
        AND TRIM(IFNULL(ipo_sub.unified_credit_code,'')) != ''
      GROUP BY ipo_sub.F_CreatorUserId, ${normSub}
    ) t ON p.f_id = t.mid
  `;
  const params = [batchId, targetDataAppId, ...scopeParams];
  const [res] = await conn.query(sql, params);
  return res.affectedRows != null ? res.affectedRows : 0;
}

/** 全量插入完成后，按统一社会信用代码将快照中的 AI/企查查简介写回新行 */
async function applyIpoProjectAiSnapshotAfterInsert(conn, { batchId, userId }) {
  const normT = sqlNormIpoProjectUnifiedCredit('t');
  const [r] = await conn.query(
    `UPDATE ipo_project t
     INNER JOIN ipo_project_ai_sync_snapshot s
       ON s.batch_id = ?
       AND s.F_CreatorUserId <=> t.F_CreatorUserId
       AND s.data_app_id <=> t.data_app_id
       AND s.unified_credit_code = ${normT}
     SET t.ai_product_intro = s.ai_product_intro,
         t.ai_industry_tags_display = s.ai_industry_tags_display,
         t.ai_industry_tags_json = s.ai_industry_tags_json,
         t.ai_enrich_status = s.ai_enrich_status,
         t.ai_enrich_at = s.ai_enrich_at,
         t.ai_enrich_model = s.ai_enrich_model,
         t.ai_enrich_version = s.ai_enrich_version,
         t.ai_enrich_error = NULL,
         t.qcc_company_intro = s.qcc_company_intro
     WHERE t.F_CreatorUserId = ?`,
    [batchId, userId]
  );
  return r.affectedRows != null ? r.affectedRows : 0;
}

async function pruneOldIpoProjectAiSnapshots() {
  try {
    const r = await db.execute(
      `DELETE FROM ipo_project_ai_sync_snapshot WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)`
    );
    const n = r.affectedRows != null ? r.affectedRows : 0;
    if (n > 0) {
      console.log(`[ipoProjectSqlSync] 已清理 ipo_project_ai_sync_snapshot 过期行 ${n} 条（>180 天）`);
    }
  } catch (e) {
    console.warn('[ipoProjectSqlSync] 清理 AI 快照表失败', e.message);
  }
}

async function runIpoProjectSqlSyncForUser({
  userId,
  external_db_config_id,
  sql_text,
  is_enabled,
  writeTarget = IPO_SQL_WRITE_TARGET_LISTING,
}) {
  const configId = external_db_config_id;
  const sqlText = (sql_text || '').trim();
  const enabled = is_enabled === false || is_enabled === 0 || is_enabled === '0' ? 0 : 1;
  const wt =
    String(writeTarget || '').trim() === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING
      ? IPO_SQL_WRITE_TARGET_PROJECT_SOURCING
      : IPO_SQL_WRITE_TARGET_LISTING;

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
    if (error && ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT'].includes(error.code)) {
      try {
        await closeExternalPool(configId);
      } catch (closeErr) {
        /* ignore */
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

  const listingAppId = await getApplicationIdByAppName('上市进展');
  const psAppId = await getApplicationIdByAppName('项目挖掘');
  const targetDataAppId = wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING ? psAppId : listingAppId;
  if (!targetDataAppId) {
    throw new Error(
      wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING
        ? '未找到「项目挖掘」应用，无法写入 data_app_id'
        : '未找到「上市进展」应用，无法写入 data_app_id'
    );
  }

  const batchId = crypto.randomUUID();
  const conn = await db.getConnection();
  let aiSnapshotSaved = 0;
  let aiSnapshotRestored = 0;
  try {
    await conn.beginTransaction();

    try {
      aiSnapshotSaved = await insertIpoProjectAiSnapshotBeforeDelete(conn, {
        batchId,
        userId,
        targetDataAppId,
        listingAppId,
        wt,
      });
    } catch (snapErr) {
      console.error('[ipoProjectSqlSync] 写入 AI 快照失败（中止同步）', snapErr);
      throw snapErr;
    }
    if (aiSnapshotSaved > 0) {
      console.log(
        `[ipoProjectSqlSync] AI/企查查快照已写入 batch_id=${batchId} rows=${aiSnapshotSaved}（按统一社会信用代码，供硬删后回填）`
      );
    }

    let idRows;
    if (wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING) {
      [idRows] = await conn.query(
        `SELECT f_id FROM ipo_project WHERE F_CreatorUserId = ? AND data_app_id <=> ?`,
        [userId, targetDataAppId]
      );
    } else {
      [idRows] = await conn.query(
        `SELECT f_id FROM ipo_project WHERE F_CreatorUserId = ? AND (data_app_id <=> ? OR data_app_id IS NULL)`,
        [userId, listingAppId]
      );
    }
    const prevIds = Array.isArray(idRows) ? idRows.map((r) => r.f_id).filter((id) => id != null) : [];
    if (prevIds.length) {
      const ph = prevIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM ipo_project_progress WHERE ipo_project_f_id IN (${ph})`, prevIds);
    }
    if (wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING) {
      await conn.query(`DELETE FROM ipo_project WHERE F_CreatorUserId = ? AND data_app_id <=> ?`, [
        userId,
        targetDataAppId,
      ]);
    } else {
      await conn.query(
        `DELETE FROM ipo_project WHERE F_CreatorUserId = ? AND (data_app_id <=> ? OR data_app_id IS NULL)`,
        [userId, listingAppId]
      );
    }

    if (!prepared.length) {
      await conn.commit();
      await pruneOldIpoProjectAiSnapshots();
      return {
        inserted: 0,
        updated: 0,
        skipped,
        deletedPrevious: prevIds.length,
        total: externalRows.length,
        write_target: wt,
        ai_snapshot_batch_id: batchId,
        ai_snapshot_saved: aiSnapshotSaved,
        ai_snapshot_restored: 0,
        message:
          wt === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING
            ? '查询成功，已清空该用户在项目挖掘下的底层项目（本次无有效行可写入）'
            : '查询成功，已清空该用户在上市进展下的底层项目（本次无有效行可写入）',
      };
    }

    let inserted = 0;
    const now = new Date();
    const projectNumbers = await allocateConsecutiveIpoProjectNos(conn, prepared.length);

    for (let i = 0; i < prepared.length; i++) {
      const m = prepared[i];
      const project_no = projectNumbers[i];
      await conn.execute(
        `INSERT INTO ipo_project (
          project_no, biz_update_time, F_CreatorTime, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime,
          project_name, company, unified_credit_code, inv_amount, residual_amount, ratio, ct_amount, ct_residual, fund, sub,
          data_app_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project_no,
          now,
          now,
          userId,
          userId,
          now,
          m.project_name,
          m.company,
          m.unified_credit_code != null && String(m.unified_credit_code).trim() !== ''
            ? String(m.unified_credit_code).trim()
            : null,
          m.inv_amount,
          m.residual_amount,
          m.ratio,
          m.ct_amount,
          m.ct_residual,
          m.fund,
          m.sub ?? null,
          targetDataAppId,
        ]
      );
      inserted += 1;
    }

    try {
      aiSnapshotRestored = await applyIpoProjectAiSnapshotAfterInsert(conn, { batchId, userId });
    } catch (restoreErr) {
      console.error(
        `[ipoProjectSqlSync] AI 快照回填失败 batch_id=${batchId}（业务数据已写入；可查表 ipo_project_ai_sync_snapshot 手工恢复）`,
        restoreErr
      );
      throw restoreErr;
    }
    if (aiSnapshotRestored > 0) {
      console.log(`[ipoProjectSqlSync] AI/企查查快照回填完成 batch_id=${batchId} affected_rows=${aiSnapshotRestored}`);
    }

    await conn.commit();
    await pruneOldIpoProjectAiSnapshots();

    return {
      inserted,
      updated: 0,
      skipped,
      deletedPrevious: prevIds.length,
      total: externalRows.length,
      write_target: wt,
      ai_snapshot_batch_id: batchId,
      ai_snapshot_saved: aiSnapshotSaved,
      ai_snapshot_restored: aiSnapshotRestored,
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
  IPO_SQL_WRITE_TARGET_LISTING,
  IPO_SQL_WRITE_TARGET_PROJECT_SOURCING,
};
