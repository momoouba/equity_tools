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

  // 拒绝多语句 SQL（分号分隔），防止 "SELECT 1; DROP TABLE ..." 攻击
  // 简单策略：在去掉字符串字面量后，若存在分号则拒绝
  const stripped = s.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``');
  if (stripped.includes(';')) {
    throw new Error('仅允许单条 SELECT / WITH 查询，不允许包含分号的多语句 SQL');
  }

  const first = s.split(/\s+/)[0]?.toLowerCase();
  if (first !== 'select' && first !== 'with') {
    throw new Error('仅允许 SELECT / WITH 查询');
  }

  // SELECT ... INTO OUTFILE / INTO DUMPFILE 可写文件，INTO @var 可设置变量
  const sUpper = s.toUpperCase();
  if (/\bINTO\s+(OUTFILE|DUMPFILE)\b/.test(sUpper)) {
    throw new Error('SELECT 中不允许使用 INTO OUTFILE / DUMPFILE');
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

/** 与 ipo_project_sql_sync_setting.write_target 一致 */
const IPO_SQL_WRITE_TARGET_LISTING = 'listing';
/** @deprecated 历史值；新配置请用 competitor_analysis */
const IPO_SQL_WRITE_TARGET_PROJECT_SOURCING = 'project_sourcing';
const IPO_SQL_WRITE_TARGET_COMPETITOR = 'competitor_analysis';

function isCompetitorFamilyWriteTarget(wt) {
  const s = String(wt || '').trim();
  return s === IPO_SQL_WRITE_TARGET_PROJECT_SOURCING || s === IPO_SQL_WRITE_TARGET_COMPETITOR;
}

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
  const scopeWhere = isCompetitorFamilyWriteTarget(wt)
      ? 'ipo_sub.F_CreatorUserId = ? AND ipo_sub.data_app_id <=> ?'
      : 'ipo_sub.F_CreatorUserId = ? AND ipo_sub.data_app_id <=> ?';
  const scopeParams = isCompetitorFamilyWriteTarget(wt) ? [userId, targetDataAppId] : [userId, listingAppId];

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
/** 上市进展：底层项目 SQL 全量替换后，按 fund + sub + company 重挂 ipo_project_progress（不删历史匹配行） */
async function relinkIpoProjectProgressAfterSqlSync(conn, { userId, listingAppId }) {
  if (!listingAppId) {
    return { progressRelinked: 0, progressOrphaned: 0 };
  }

  // #3: JOIN key 增加 project_name，避免 fund+sub+company 相同但项目不同时误关联
  const [relinkRes] = await conn.query(
    `UPDATE ipo_project_progress ipp
     INNER JOIN (
       SELECT F_CreatorUserId,
              TRIM(fund) AS fund_k,
              TRIM(IFNULL(sub, '')) AS sub_k,
              TRIM(company) AS company_k,
              TRIM(IFNULL(project_name, '')) AS project_name_k,
              MAX(f_id) AS new_f_id
       FROM ipo_project
       WHERE F_DeleteMark = 0
         AND F_CreatorUserId = ?
         AND data_app_id <=> ?
       GROUP BY F_CreatorUserId, TRIM(fund), TRIM(IFNULL(sub, '')), TRIM(company), TRIM(IFNULL(project_name, ''))
     ) pk ON ipp.F_CreatorUserId = pk.F_CreatorUserId
        AND TRIM(ipp.fund) = pk.fund_k
        AND TRIM(IFNULL(ipp.sub, '')) = pk.sub_k
        AND TRIM(ipp.company) = pk.company_k
        AND TRIM(IFNULL(ipp.project_name, '')) = pk.project_name_k
     INNER JOIN ipo_project np ON np.f_id = pk.new_f_id
     SET ipp.ipo_project_f_id = pk.new_f_id,
         ipp.fund = np.fund,
         ipp.sub = np.sub,
         ipp.project_name = np.project_name,
         ipp.company = np.company,
         ipp.inv_amount = np.inv_amount,
         ipp.residual_amount = np.residual_amount,
         ipp.ratio = np.ratio,
         ipp.ct_amount = np.ct_amount,
         ipp.ct_residual = np.ct_residual
     WHERE ipp.F_CreatorUserId = ?`,
    [userId, listingAppId, userId]
  );

  const [orphanRes] = await conn.query(
    `UPDATE ipo_project_progress ipp
     SET ipp.ipo_project_f_id = NULL
     WHERE ipp.F_CreatorUserId = ?
       AND ipp.ipo_project_f_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ipo_project p
         WHERE p.f_id = ipp.ipo_project_f_id AND p.F_DeleteMark = 0
       )`,
    [userId]
  );

  const progressRelinked = relinkRes.affectedRows != null ? relinkRes.affectedRows : 0;
  const progressOrphaned = orphanRes.affectedRows != null ? orphanRes.affectedRows : 0;
  if (progressRelinked > 0 || progressOrphaned > 0) {
    console.log(
      `[ipoProjectSqlSync] 底层项目上市进展重关联 user=${userId} relinked=${progressRelinked} orphaned=${progressOrphaned}`
    );
  }
  return { progressRelinked, progressOrphaned };
}

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

async function maybeRunQccAfterSqlSync({ qccAfterSyncOn, userId, targetDataAppId }) {
  if (!qccAfterSyncOn || !targetDataAppId) return null;
  try {
    const { runPostSqlSyncQccBriefsForProjectSourcingUser } = require('../竞品分析/ipoProjectQccBriefService');
    return await runPostSqlSyncQccBriefsForProjectSourcingUser({ userId, psAppId: targetDataAppId });
  } catch (e) {
    console.error('[ipoProjectSqlSync] 同步后企查查简介失败', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function runIpoProjectSqlSyncForUser({
  userId,
  external_db_config_id,
  sql_text,
  is_enabled,
  writeTarget = IPO_SQL_WRITE_TARGET_LISTING,
  qccBriefAfterSync = false,
}) {
  const configId = external_db_config_id;
  const sqlText = (sql_text || '').trim();
  const enabled = is_enabled === false || is_enabled === 0 || is_enabled === '0' ? 0 : 1;
  const wtRaw = String(writeTarget || '').trim();
  const wt = isCompetitorFamilyWriteTarget(wtRaw)
    ? wtRaw === IPO_SQL_WRITE_TARGET_COMPETITOR
      ? IPO_SQL_WRITE_TARGET_COMPETITOR
      : IPO_SQL_WRITE_TARGET_PROJECT_SOURCING
    : IPO_SQL_WRITE_TARGET_LISTING;
  const qccAfterSyncOn =
    (qccBriefAfterSync === true ||
      qccBriefAfterSync === 1 ||
      qccBriefAfterSync === '1') &&
    isCompetitorFamilyWriteTarget(wt);

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

  // 外部查询返回空集时中止同步：防止外部数据库故障（返回空结果）时清空现有底层项目
  if (externalRows.length === 0) {
    throw new Error(
      '外部查询返回空结果，已中止同步以免清空现有底层项目。请检查外部数据库连接及 SQL 条件。'
    );
  }

  const skipped = externalRows.length - prepared.length;

  const listingAppId = await getApplicationIdByAppName('上市进展');
  const caAppId = await getApplicationIdByAppName('竞品分析');
  const targetDataAppId = isCompetitorFamilyWriteTarget(wt) ? caAppId : listingAppId;
  if (!targetDataAppId) {
    throw new Error(
      isCompetitorFamilyWriteTarget(wt)
        ? '未找到「竞品分析」应用，无法写入 data_app_id'
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
    if (isCompetitorFamilyWriteTarget(wt)) {
      [idRows] = await conn.query(
        `SELECT f_id FROM ipo_project WHERE F_CreatorUserId = ? AND data_app_id <=> ?`,
        [userId, targetDataAppId]
      );
    } else {
      [idRows] = await conn.query(
        `SELECT f_id FROM ipo_project WHERE F_CreatorUserId = ? AND data_app_id <=> ?`,
        [userId, listingAppId]
      );
    }
    const prevIds = Array.isArray(idRows) ? idRows.map((r) => r.f_id).filter((id) => id != null) : [];
    if (isCompetitorFamilyWriteTarget(wt)) {
      await conn.query(`DELETE FROM ipo_project WHERE F_CreatorUserId = ? AND data_app_id <=> ?`, [
        userId,
        targetDataAppId,
      ]);
    } else {
      await conn.query(
        `DELETE FROM ipo_project WHERE F_CreatorUserId = ? AND data_app_id <=> ?`,
        [userId, listingAppId]
      );
    }

    let progressRelinked = 0;
    let progressOrphaned = 0;

    if (!prepared.length) {
      if (!isCompetitorFamilyWriteTarget(wt) && listingAppId) {
        ({ progressRelinked, progressOrphaned } = await relinkIpoProjectProgressAfterSqlSync(conn, {
          userId,
          listingAppId,
        }));
      }
      await conn.commit();
      await pruneOldIpoProjectAiSnapshots();
      const qcc_post_sync = await maybeRunQccAfterSqlSync({ qccAfterSyncOn, userId, targetDataAppId });
      return {
        inserted: 0,
        updated: 0,
        skipped,
        deletedPrevious: prevIds.length,
        progress_relinked: progressRelinked,
        progress_orphaned: progressOrphaned,
        total: externalRows.length,
        write_target: wt,
        ai_snapshot_batch_id: batchId,
        ai_snapshot_saved: aiSnapshotSaved,
        ai_snapshot_restored: 0,
        qcc_post_sync,
        message: isCompetitorFamilyWriteTarget(wt)
            ? '查询成功，已清空该用户在竞品分析下的底层项目（本次无有效行可写入）'
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

    if (!isCompetitorFamilyWriteTarget(wt) && listingAppId) {
      ({ progressRelinked, progressOrphaned } = await relinkIpoProjectProgressAfterSqlSync(conn, {
        userId,
        listingAppId,
      }));
    }

    await conn.commit();
    await pruneOldIpoProjectAiSnapshots();

    const qcc_post_sync = await maybeRunQccAfterSqlSync({ qccAfterSyncOn, userId, targetDataAppId });

    return {
      inserted,
      updated: 0,
      skipped,
      deletedPrevious: prevIds.length,
      progress_relinked: progressRelinked,
      progress_orphaned: progressOrphaned,
      total: externalRows.length,
      write_target: wt,
      ai_snapshot_batch_id: batchId,
      ai_snapshot_saved: aiSnapshotSaved,
      ai_snapshot_restored: aiSnapshotRestored,
      qcc_post_sync,
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
  IPO_SQL_WRITE_TARGET_COMPETITOR,
};
