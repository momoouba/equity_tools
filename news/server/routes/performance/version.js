/**
 * 业绩看板应用 - 版本管理路由
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getCurrentUser } = require('../../middleware/auth');
const {
  replaceDateInSql,
  replaceVersionInSql,
  replacePrevVersionPlaceholders,
  getSqlFirstKeyword,
  extraSqlStatementMessage
} = require('./config');
const {
  queryExternal,
  ensureExternalPool,
  closeExternalPool
} = require('../../utils/externalDb');
const { computeAndUpdateTransactionIrr, computeIRR } = require('./transactionIrr');
const {
  EXTERNAL_QUERY_TIMEOUT_MS,
  PERF_TABLES,
  GENERATE_TARGETS,
  VERSION_DATA_TABLES,
  READY_STATUS_SQL,
  normalizeLayer,
  findForbiddenCustomerTable
} = require('../../utils/performance/sqlLayers');

// 业绩看板 b_* 表主键为 F_Id，插入时若结果中无则需生成
const ID_COLUMN = 'F_Id';

// 版本创建并发锁（防止同日期并发创建导致版本号重复）
const versionCreationLocks = new Set();

// fix#19: 版本号解析统一用正则，与 SQL SUBSTRING_INDEX(version, 'V', -1) 行为一致
// 正常格式 "20250601V01" → 1；畸形（无V/无数字）→ 0，与 SQL CAST(...AS UNSIGNED) 对齐
function parseVersionNum(versionStr) {
  if (!versionStr) return 0;
  const m = String(versionStr).match(/V(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// 统一使用中国上海时间（UTC+8）—— 使用 Intl API 避免 Date 方法在非 UTC/UTC+8 服务器上出错
function getShanghaiNow() {
  const now = new Date();
  const shanghaiParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const get = (type) => {
    const part = shanghaiParts.find(p => p.type === type);
    return part ? part.value : '00';
  };
  return new Date(Date.UTC(
    parseInt(get('year')),
    parseInt(get('month')) - 1,
    parseInt(get('day')),
    parseInt(get('hour')) === 24 ? 0 : parseInt(get('hour')),
    parseInt(get('minute')),
    parseInt(get('second'))
  ));
}

/** 是否为需要写入创建人时间的业务表（b_* 排除配置表；perf_* 维度表） */
function isBizTableWithAudit(targetTable) {
  if (!targetTable || typeof targetTable !== 'string') return false;
  if (targetTable.startsWith('perf_')) return true;
  return targetTable.startsWith('b_') && targetTable !== 'b_sql' && targetTable !== 'b_sql_change_log';
}

/**
 * 为即将写入 b_ 业务表的行注入 F_CreatorUserId、F_CreatorTime（触发版本创建的用户与时间）。
 * 除 b_sql、b_sql_change_log 外的 b_* 表在初始化时已去掉 F_LastModifyTime/F_LastModifyUserId，故不再写入。
 */
function injectCreatorAndModify(rows, creatorId, creatorTimeStr) {
  if (!rows.length) return;
  const uid = creatorId != null ? String(creatorId) : null;
  const tm = creatorTimeStr || null;
  rows.forEach((r) => {
    if (typeof r === 'object' && r !== null) {
      r.F_CreatorUserId = uid;
      r.F_CreatorTime = tm;
    }
  });
}

/**
 * 为缺少主键的行生成 F_Id/id。传入 connection 时 generateId 用其查 max id，可见本事务未提交插入，避免与前面插入的 F_Id 重复。
 * 同一批内首行调 generateId，其余在本地递增序列。
 */
async function ensureRowIds(rows, targetTable, connection) {
  if (!rows.length) return rows;
  const useFId = targetTable.startsWith('b_') || targetTable.startsWith('perf_') || targetTable === 'b_sql_change_log';
  const idCol = useFId ? ID_COLUMN : 'id';
  let lastId = null;
  const out = [];
  for (const r of rows) {
    const row = typeof r === 'object' && r !== null ? { ...r } : { value: r };
    if (row[idCol] == null || row[idCol] === '') {
      if (lastId === null) {
        row[idCol] = await generateId(targetTable, connection);
        lastId = row[idCol];
      } else {
        const prefix = lastId.slice(0, -5);
        let seq = parseInt(lastId.slice(-5), 10) + 1;
        if (seq > 99999) {
          row[idCol] = await generateId(targetTable, connection);
          lastId = row[idCol];
        } else {
          lastId = prefix + String(seq).padStart(5, '0');
          row[idCol] = lastId;
        }
      }
    }
    out.push(row);
  }
  return out;
}

// 应用自定义中间件获取当前用户
router.use(getCurrentUser);

/**
 * 获取目标表的实际列名集合（带缓存），用于向下兼容写入：
 * 若 SQL 查询返回的字段多于数据库表的字段，只写入匹配的列，多余的自动忽略。
 */
const tableColumnCache = new Map();
async function getTableColumns(tableName, connection) {
  if (tableColumnCache.has(tableName)) return tableColumnCache.get(tableName);
  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  // 使用 Map（小写→实际列名）支持大小写不敏感匹配
  const map = new Map();
  cols.forEach(c => map.set(c.COLUMN_NAME.toLowerCase(), c.COLUMN_NAME));
  tableColumnCache.set(tableName, map);
  return map;
}

/**
 * 过滤行对象，只保留目标表中实际存在的列。
 * 向下兼容：SQL 查询返回的字段多于数据库表字段时，不阻断流程，只写入匹配字段。
 * 大小写不敏感：SQL 别名 MOC 可匹配表列 moc，写入时使用表的实际列名。
 */
async function filterColumnsForInsert(rows, targetTable, connection) {
  const colMap = await getTableColumns(targetTable, connection);
  return rows.map(r => {
    const filtered = {};
    for (const key of Object.keys(r)) {
      const actualCol = colMap.get(key.toLowerCase());
      if (actualCol !== undefined) {
        filtered[actualCol] = r[key];
      }
    }
    return filtered;
  });
}

async function setVersionStatus(version, status, extra = {}) {
  await db.execute(
    `UPDATE b_version
     SET status = ?, failed_layer = ?, status_message = ?
     WHERE version = ? AND F_DeleteMark = 0`,
    [status, extra.failedLayer || null, extra.message ? String(extra.message).slice(0, 500) : null, version]
  );
}

async function softDeleteByVersion(tables, version, userId) {
  for (const table of tables) {
    await db.execute(
      `UPDATE \`${table}\`
       SET F_DeleteMark = 1, F_DeleteUserId = ?, F_DeleteTime = NOW()
       WHERE version = ? AND F_DeleteMark = 0`,
      [userId || null, version]
    );
  }
}

/** 版本创建执行日志：控制台 + b_version_run_log（失败回滚不删此表） */
async function appendVersionRunLog({
  version,
  bDate,
  layer,
  stepNo,
  sqlId,
  interfaceName,
  targetTable,
  event,
  queryRows,
  insertedRows,
  durationMs,
  message,
  userId
}) {
  const msg = message != null ? String(message).slice(0, 1000) : null;
  const label = interfaceName || targetTable || sqlId || layer || '-';
  const tablePart = targetTable ? ` → ${targetTable}` : '';
  const statParts = [];
  if (queryRows != null) statParts.push(`查询=${queryRows}`);
  if (insertedRows != null) statParts.push(`写入=${insertedRows}`);
  if (durationMs != null) statParts.push(`${durationMs}ms`);
  const stat = statParts.length ? ` ${statParts.join(' ')}` : '';
  const extra = msg ? ` ${msg}` : '';
  const line = `[版本创建][${version || '-'}][${layer || '-'}] ${event} ${label}${tablePart}${stat}${extra}`;
  if (event === 'fail') console.error(line);
  else if (event === 'skip') console.warn(line);
  else console.log(line);

  if (!version) return;
  try {
    const id = await generateId('b_version_run_log');
    await db.execute(
      `INSERT INTO b_version_run_log
       (F_Id, F_CreatorUserId, F_CreatorTime, version, b_date, layer, step_no,
        sql_id, interface_name, target_table, event, query_rows, inserted_rows, duration_ms, message)
       VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId || null,
        version,
        bDate || null,
        layer || null,
        stepNo != null ? stepNo : 0,
        sqlId || null,
        interfaceName ? String(interfaceName).slice(0, 200) : null,
        targetTable ? String(targetTable).slice(0, 100) : null,
        event || null,
        queryRows != null ? queryRows : null,
        insertedRows != null ? insertedRows : null,
        durationMs != null ? durationMs : null,
        msg
      ]
    );
  } catch (e) {
    console.warn(`[版本创建] 写执行日志失败: ${e.message}`);
  }
}

async function listVersionRunLogs(version) {
  if (!version) return [];
  try {
    return await db.query(
      `SELECT version, b_date, layer, step_no, sql_id, interface_name, target_table,
              event, query_rows, inserted_rows, duration_ms, message, F_CreatorTime
       FROM b_version_run_log
       WHERE version = ?
       ORDER BY step_no ASC, F_CreatorTime ASC`,
      [version]
    );
  } catch (e) {
    console.warn(`[版本创建] 读执行日志失败: ${e.message}`);
    return [];
  }
}

/**
 * 版本最终失败：该 version 在所有业绩表（含 b_version）全部软删，不占版本号、不留半成品。
 */
async function abortFailedVersion(version, userId, err) {
  if (!version) return;
  try {
    await setVersionStatus(version, 'failed', {
      failedLayer: err?.failedLayer || 'unknown',
      message: err?.message
    });
  } catch (statusErr) {
    console.error('回写版本失败状态出错:', statusErr.message);
  }
  try {
    await softDeleteByVersion(VERSION_DATA_TABLES, version, userId);
    console.warn(
      `[版本创建] 已回滚失败版本 ${version}` +
        (err?.failedLayer ? ` (layer=${err.failedLayer})` : '') +
        (err?.message ? `: ${String(err.message).slice(0, 200)}` : '')
    );
  } catch (delErr) {
    console.error(`回滚失败版本 ${version} 数据出错:`, delErr.message);
  }
}

/**
 * 同日期未成功（failed / washing / extracting / generating）且未锁定的版本软删，避免跳号。
 */
async function purgeIncompleteVersionsForDate(monthDate, userId) {
  const rows = await db.query(
    `SELECT version FROM b_version
     WHERE DATE(b_date) = ?
       AND F_DeleteMark = 0
       AND (F_Lock IS NULL OR F_Lock = 0)
       AND (status IS NULL OR status <> 'ready')`,
    [monthDate]
  );
  for (const row of rows) {
    if (!row?.version) continue;
    await softDeleteByVersion(VERSION_DATA_TABLES, row.version, userId);
    console.warn(`[版本创建] 已清理未成功版本 ${row.version}（不占号）`);
  }
}

async function getPrevMonthReadyVersion(monthDate) {
  const rows = await db.query(
    `SELECT version FROM b_version
     WHERE F_DeleteMark = 0 AND ${READY_STATUS_SQL}
       AND DATE_FORMAT(b_date, '%Y-%m') = DATE_FORMAT(DATE_SUB(?, INTERVAL 1 MONTH), '%Y-%m')
     ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC
     LIMIT 1`,
    [monthDate]
  );
  return (rows[0] && rows[0].version) || '';
}

async function getPrevYearEndReadyVersion(monthDate) {
  const rows = await db.query(
    `SELECT version FROM b_version
     WHERE F_DeleteMark = 0 AND ${READY_STATUS_SQL}
       AND YEAR(b_date) = YEAR(?) - 1 AND MONTH(b_date) = 12
     ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC
     LIMIT 1`,
    [monthDate]
  );
  return (rows[0] && rows[0].version) || '';
}

async function insertRowsToTarget(connection, rows, targetTable, version, monthDate, creatorId, creatorTimeStr) {
  if (!rows.length || !targetTable) return 0;
  const withVersion = rows.map((r) => (
    typeof r === 'object' && r !== null
      ? { ...r, version, b_date: monthDate }
      : { version, b_date: monthDate, value: r }
  ));
  if (isBizTableWithAudit(targetTable)) injectCreatorAndModify(withVersion, creatorId, creatorTimeStr);
  const withIds = await ensureRowIds(withVersion, targetTable, connection);
  const filtered = await filterColumnsForInsert(withIds, targetTable, connection);
  if (!filtered.length || !Object.keys(filtered[0] || {}).length) return 0;
  // datetime 空串会导致 ER_TRUNCATED_WRONG_VALUE，统一写成 NULL
  for (const row of filtered) {
    for (const key of Object.keys(row)) {
      if (row[key] === '') row[key] = null;
    }
  }
  const cols = Object.keys(filtered[0]);
  const quotedCols = cols.map((c) => '`' + String(c).replace(/`/g, '``') + '`').join(',');
  const values = filtered.map((r) => cols.map((c) => r[c]));
  await connection.query(
    `INSERT INTO \`${targetTable.replace(/`/g, '``')}\` (${quotedCols}) VALUES ?`,
    [values]
  );
  return filtered.length;
}

async function executeConfiguredSql(row, ctx) {
  const {
    monthDate, version, prevMonthVersion, prevYearEndVersion,
    creatorId, creatorTimeStr, connection, queryTimeoutMs, layerLabel, nextStepNo
  } = ctx;
  const name = row.interface_name || row.F_Id;
  const layer = layerLabel || normalizeLayer(row.sql_layer) || 'legacy';
  const stepNo = typeof nextStepNo === 'function' ? nextStepNo() : 0;
  const logBase = {
    version,
    bDate: monthDate,
    layer,
    stepNo,
    sqlId: row.F_Id,
    interfaceName: name,
    targetTable: row.target_table || null,
    userId: creatorId
  };

  let sql = (row.sql_content || '').trim();
  if (!sql) {
    await appendVersionRunLog({ ...logBase, event: 'skip', message: 'SQL 为空' });
    return { skipped: true, queryRows: 0, insertedRows: 0, durationMs: 0 };
  }
  sql = replaceDateInSql(sql, monthDate);
  sql = replaceVersionInSql(sql, version);
  sql = replacePrevVersionPlaceholders(sql, prevMonthVersion, prevYearEndVersion);
  const extraSql = extraSqlStatementMessage(sql);
  if (extraSql) {
    throw new Error(`数据接口「${name}」${extraSql}`);
  }
  const firstKeyword = getSqlFirstKeyword(sql);
  const isInsert = firstKeyword === 'INSERT';
  const targetTable = row.target_table;
  const sanitizedTargetTable = targetTable ? String(targetTable).trim() : '';
  if (sanitizedTargetTable && sanitizedTargetTable.toLowerCase() === 'b_version') {
    await appendVersionRunLog({ ...logBase, event: 'skip', message: '目标表 b_version 由外层写入，跳过' });
    return { skipped: true, queryRows: 0, insertedRows: 0, durationMs: 0 };
  }
  if (sanitizedTargetTable && sanitizedTargetTable.includes('.')) {
    throw new Error(`数据接口「${name}」目标表名包含非法字符（不允许 schema 限定）: ${targetTable}`);
  }

  let externalId = row.external_db_config_id || null;
  const cfgLayer = normalizeLayer(row.sql_layer);
  const isTxn = sanitizedTargetTable.toLowerCase() === 'b_transaction';
  if (!externalId && (cfgLayer === 'wash' || (!cfgLayer && isTxn))) {
    const peers = await db.query(
      `SELECT external_db_config_id FROM b_sql
       WHERE F_DeleteMark = 0
         AND sql_layer IN ('extract', 'wash')
         AND external_db_config_id IS NOT NULL
         AND TRIM(external_db_config_id) <> ''
       ORDER BY exec_order
       LIMIT 1`
    );
    externalId = peers?.[0]?.external_db_config_id || null;
  }

  if (!externalId) {
    const customerTable = findForbiddenCustomerTable(sql);
    if (customerTable) {
      throw new Error(
        cfgLayer === 'generate'
          ? `数据接口「${name}」为 generate，将在本系统 investment_tools 执行，但 SQL 引用了客户库表 ${customerTable}。请改用本系统 perf_* / b_transaction，或粘贴需求文档中改写后的 SQL。`
          : isTxn
            ? `数据接口「${name}」是交易明细洗数，引用了客户库表 ${customerTable}。请到「外部数据提取」改为 wash 并选择外部数据库。`
            : `数据接口「${name}」将在本系统执行，但 SQL 引用了客户库表 ${customerTable}。请改为 extract/wash 并选择外部数据库，或改写为只读本系统表。`
      );
    }
  }

  const runInsert = async (localConn, resultRows) => {
    return insertRowsToTarget(localConn, resultRows, sanitizedTargetTable, version, monthDate, creatorId, creatorTimeStr);
  };

  await appendVersionRunLog({
    ...logBase,
    event: 'start',
    message: externalId ? `外部库查询 ${externalId}` : (isInsert ? '本库 INSERT' : '本库 SELECT 后写入')
  });
  const started = Date.now();

  try {
    let queryRows = 0;
    let insertedRows = 0;

    if (externalId) {
      const loadExternalConfig = async () => {
        const cfgRows = await db.query(
          'SELECT * FROM external_db_config WHERE F_Id = ? AND F_DeleteMark = 0 AND is_active = 1',
          [externalId]
        );
        if (!cfgRows || cfgRows.length === 0) {
          throw new Error(`外部数据源配置不存在或未启用: ${externalId}`);
        }
        return cfgRows[0];
      };
      const ensureExternalPoolReady = async () => {
        const cfg = await loadExternalConfig();
        await ensureExternalPool(cfg);
      };
      await ensureExternalPoolReady();
      if (isInsert) {
        throw new Error(`数据接口「${name}」使用外部数据源时仅支持 SELECT/WITH，请用 SELECT 取数后由系统写入目标表`);
      }
      const timeoutOpts = queryTimeoutMs ? { timeoutMs: queryTimeoutMs } : {};
      let rows;
      try {
        rows = await queryExternal(externalId, sql, [], timeoutOpts);
      } catch (err) {
        if (
          err &&
          (err.code === 'ECONNRESET' ||
            err.code === 'PROTOCOL_CONNECTION_LOST' ||
            err.code === 'ETIMEDOUT' ||
            err.errno === -4077)
        ) {
          if (err.code === 'ETIMEDOUT') {
            throw new Error(`数据接口「${name}」外部查询超时（${Math.round((queryTimeoutMs || 0) / 60000)} 分钟）`);
          }
          console.warn(`外部数据库连接异常，将尝试重连后重试一次 (${externalId}):`, err.message);
          await closeExternalPool(externalId);
          await ensureExternalPoolReady();
          rows = await queryExternal(externalId, sql, [], timeoutOpts);
        } else {
          throw err;
        }
      }
      queryRows = Array.isArray(rows) ? rows.length : 0;
      if (queryRows > 0 && sanitizedTargetTable) {
        if (connection) {
          insertedRows = await runInsert(connection, rows);
        } else {
          const writeConn = await db.getConnection();
          try {
            await writeConn.beginTransaction();
            insertedRows = await runInsert(writeConn, rows);
            await writeConn.commit();
          } catch (writeErr) {
            await writeConn.rollback();
            throw writeErr;
          } finally {
            writeConn.release();
          }
        }
      }
    } else {
      const runLocal = async (localConn) => {
        if (isInsert) {
          await localConn.execute(sql, []);
          insertedRows = null;
        } else {
          const [rows] = await localConn.query(sql, []);
          queryRows = Array.isArray(rows) ? rows.length : 0;
          if (queryRows > 0 && sanitizedTargetTable) {
            insertedRows = await runInsert(localConn, rows);
          }
        }
      };

      if (connection) {
        await runLocal(connection);
      } else {
        const writeConn = await db.getConnection();
        try {
          await writeConn.beginTransaction();
          await runLocal(writeConn);
          await writeConn.commit();
        } catch (writeErr) {
          await writeConn.rollback();
          throw writeErr;
        } finally {
          writeConn.release();
        }
      }
    }

    const durationMs = Date.now() - started;
    await appendVersionRunLog({
      ...logBase,
      event: 'success',
      queryRows,
      insertedRows,
      durationMs,
      message: queryRows === 0 && !isInsert ? '查询 0 行，未写入' : null
    });
    try {
      await setVersionStatus(version, layer === 'wash' ? 'washing' : layer === 'extract' ? 'extracting' : 'generating', {
        message: `${layer}/${name} OK` + (sanitizedTargetTable ? ` → ${sanitizedTargetTable}` : '') +
          (queryRows != null ? ` 查询${queryRows}` : '') +
          (insertedRows != null ? ` 写入${insertedRows}` : '')
      });
    } catch (_) { /* ignore progress write */ }

    return { skipped: false, queryRows, insertedRows, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    await appendVersionRunLog({
      ...logBase,
      event: 'fail',
      durationMs,
      message: err.message
    });
    if (!String(err.message || '').includes(`数据接口「${name}」`)) {
      err.message = `数据接口「${name}」执行失败: ${err.message}`;
    }
    throw err;
  }
}

async function runVersionPipeline({
  version, monthDate, creatorId, creatorTimeStr, sqlRows
}) {
  const prevMonthVersion = await getPrevMonthReadyVersion(monthDate);
  const prevYearEndVersion = await getPrevYearEndReadyVersion(monthDate);
  const washRows = sqlRows.filter((r) => normalizeLayer(r.sql_layer) === 'wash');
  const extractRows = sqlRows.filter((r) => normalizeLayer(r.sql_layer) === 'extract');
  const generateRows = sqlRows.filter((r) => normalizeLayer(r.sql_layer) === 'generate');
  const legacyRows = sqlRows.filter((r) => !normalizeLayer(r.sql_layer));
  const isTxnTarget = (r) => String(r.target_table || '').trim().toLowerCase() === 'b_transaction';
  const generateTargetSet = new Set(
    generateRows.map((r) => String(r.target_table || '').trim().toLowerCase()).filter(Boolean)
  );
  const hasExplicitTxn = washRows.length > 0 || extractRows.some(isTxnTarget);
  // 现网「2.交易明细表」未分层：没有 wash/extract 写 b_transaction 时，当作 wash 跑
  const implicitWash = hasExplicitTxn ? [] : legacyRows.filter(isTxnTarget);
  // 目标表已有 generate 的未分层残留不再本库重跑
  const leftoverLegacy = legacyRows.filter((r) => {
    if (isTxnTarget(r)) return false;
    const t = String(r.target_table || '').trim().toLowerCase();
    if (!t || t === 'b_version') return false;
    if (generateTargetSet.has(t)) return false;
    return true;
  });
  // 外层先打版本（本系统已 INSERT b_version），再入库流水，维度 extract 才有时点
  const txnRows = [...washRows, ...extractRows.filter(isTxnTarget), ...implicitWash];
  const dimExtractRows = extractRows.filter((r) => !isTxnTarget(r));

  let stepCounter = 0;
  const nextStepNo = () => {
    stepCounter += 1;
    return stepCounter;
  };

  const baseCtx = {
    monthDate, version, prevMonthVersion, prevYearEndVersion, creatorId, creatorTimeStr, nextStepNo
  };

  await appendVersionRunLog({
    version,
    bDate: monthDate,
    layer: 'pipeline',
    stepNo: nextStepNo(),
    event: 'info',
    message: `开始流水线 wash=${txnRows.length} extract=${dimExtractRows.length} generate=${generateRows.length} legacy=${leftoverLegacy.length}`,
    userId: creatorId
  });

  await setVersionStatus(version, 'washing');
  if (txnRows.length) {
    try {
      for (const row of txnRows) {
        await executeConfiguredSql(row, {
          ...baseCtx,
          layerLabel: 'wash',
          queryTimeoutMs: EXTERNAL_QUERY_TIMEOUT_MS
        });
      }
    } catch (err) {
      await softDeleteByVersion(['b_transaction'], version, creatorId);
      err.failedLayer = 'wash';
      throw err;
    }
  } else {
    await appendVersionRunLog({
      version, bDate: monthDate, layer: 'wash', stepNo: nextStepNo(),
      event: 'skip', message: '无 wash / 交易明细接口', userId: creatorId
    });
  }

  await setVersionStatus(version, 'extracting');
  if (dimExtractRows.length) {
    try {
      for (const row of dimExtractRows) {
        await executeConfiguredSql(row, {
          ...baseCtx,
          layerLabel: 'extract',
          queryTimeoutMs: EXTERNAL_QUERY_TIMEOUT_MS
        });
      }
    } catch (err) {
      await softDeleteByVersion(PERF_TABLES, version, creatorId);
      err.failedLayer = 'extract';
      throw err;
    }
  } else {
    await appendVersionRunLog({
      version, bDate: monthDate, layer: 'extract', stepNo: nextStepNo(),
      event: 'skip', message: '无 extract 维度接口', userId: creatorId
    });
  }

  await setVersionStatus(version, 'generating');
  const localConn = await db.getConnection();
  try {
    await localConn.beginTransaction();
    for (const row of generateRows) {
      await executeConfiguredSql(row, { ...baseCtx, layerLabel: 'generate', connection: localConn });
    }
    for (const row of leftoverLegacy) {
      await executeConfiguredSql(row, { ...baseCtx, layerLabel: 'legacy', connection: localConn });
    }
    await computeAndUpdateTransactionIrr(localConn, version);
    try {
      const [fundCashflows] = await localConn.query(
        `SELECT fund, COALESCE(sub_fund, company) AS project, transaction_date,
                (CASE WHEN transaction_type IN ('实缴','出资') THEN -1 ELSE 1 END) * transaction_amount AS amount
         FROM b_transaction
         WHERE version = ? AND lp IS NULL AND transaction_type <> '认缴'
           AND ((fund IS NOT NULL AND sub_fund IS NULL AND company IS NOT NULL) OR (fund IS NOT NULL AND sub_fund IS NOT NULL AND company IS NULL))
         ORDER BY fund, project, transaction_date ASC`,
        [version]
      );
      const fundProjectMap = {};
      for (const cf of fundCashflows) {
        if (!cf.fund || !cf.project) continue;
        const key = `${cf.fund}||${cf.project}`;
        if (!fundProjectMap[key]) fundProjectMap[key] = { fund: cf.fund, project: cf.project, amounts: [], dates: [] };
        fundProjectMap[key].amounts.push(Number(cf.amount));
        fundProjectMap[key].dates.push(cf.transaction_date);
      }
      for (const { fund, project, amounts, dates } of Object.values(fundProjectMap)) {
        const irr = computeIRR(amounts, dates);
        await localConn.query(
          `UPDATE b_investment SET irr = ? WHERE version = ? AND fund = ? AND project = ? AND F_DeleteMark = 0`,
          [irr, version, fund, project]
        );
      }

      const [allCashflows] = await localConn.query(
        `SELECT COALESCE(sub_fund, company) AS project, transaction_date,
                (CASE WHEN transaction_type IN ('实缴','出资') THEN -1 ELSE 1 END) * transaction_amount AS amount
         FROM b_transaction
         WHERE version = ? AND fund <> '国方一期产品' AND lp IS NULL AND transaction_type <> '认缴'
           AND ((fund IS NOT NULL AND sub_fund IS NULL AND company IS NOT NULL) OR (fund IS NOT NULL AND sub_fund IS NOT NULL AND company IS NULL))
         ORDER BY project, transaction_date ASC`,
        [version]
      );
      const allProjectMap = {};
      for (const cf of allCashflows) {
        if (!cf.project) continue;
        if (!allProjectMap[cf.project]) allProjectMap[cf.project] = { amounts: [], dates: [] };
        allProjectMap[cf.project].amounts.push(Number(cf.amount));
        allProjectMap[cf.project].dates.push(cf.transaction_date);
      }
      for (const [project, { amounts, dates }] of Object.entries(allProjectMap)) {
        const irr = computeIRR(amounts, dates);
        await localConn.query(
          `UPDATE b_investment_sum SET irr = ? WHERE version = ? AND project = ? AND F_DeleteMark = 0`,
          [irr, version, project]
        );
      }
      await appendVersionRunLog({
        version, bDate: monthDate, layer: 'generate', stepNo: nextStepNo(),
        event: 'success', interfaceName: 'IRR回写', targetTable: 'b_investment/b_investment_sum',
        message: `基金项目=${Object.keys(fundProjectMap).length} 去重项目=${Object.keys(allProjectMap).length}`,
        userId: creatorId
      });
    } catch (irrErr) {
      console.warn('版本创建时计算项目级IRR失败:', irrErr.message);
      await appendVersionRunLog({
        version, bDate: monthDate, layer: 'generate', stepNo: nextStepNo(),
        event: 'fail', interfaceName: 'IRR回写', message: irrErr.message, userId: creatorId
      });
    }
    await localConn.commit();
  } catch (err) {
    await localConn.rollback();
    await softDeleteByVersion(GENERATE_TARGETS, version, creatorId);
    err.failedLayer = err.failedLayer || (generateRows.length ? 'generate' : 'legacy');
    throw err;
  } finally {
    localConn.release();
  }

  await setVersionStatus(version, 'ready', { message: '版本创建完成' });
  await appendVersionRunLog({
    version, bDate: monthDate, layer: 'pipeline', stepNo: nextStepNo(),
    event: 'success', message: '流水线完成 status=ready', userId: creatorId
  });
}

/**
 * 获取日期列表
 * GET /api/performance/versions/dates
 */
router.get('/dates', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT DATE(b_date) as date 
       FROM b_version 
       WHERE F_DeleteMark = 0 AND ${READY_STATUS_SQL}
       ORDER BY date DESC`
    );
    
    const dates = rows.map(row => {
      const d = new Date(row.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    
    res.json({ success: true, data: { dates } });
  } catch (error) {
    console.error('获取日期列表失败:', error);
    res.status(500).json({ success: false, message: '获取日期列表失败' });
  }
});

/**
 * 获取版本列表
 * GET /api/performance/versions?date=YYYY-MM-DD
 */
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: '日期参数不能为空' });
    }
    
    // fix#19: SUBSTRING_INDEX 排序与 JS parseVersionNum 正则解析对畸形版本号行为一致（无数字均视为 0）
    const rows = await db.query(
      `SELECT 
        version,
        b_date,
        F_CreatorUserId,
        F_CreatorTime,
        F_Lock,
        F_DeleteMark,
        status
       FROM b_version
       WHERE F_DeleteMark = 0 
         AND ${READY_STATUS_SQL}
         AND DATE(b_date) = ?
       ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC`,
      [date]
    );
    
    const versions = rows.map(row => ({
      version: row.version,
      bDate: row.b_date,
      creatorId: row.F_CreatorUserId,
      creatorName: row.F_CreatorUserId ? '用户' : '系统',
      createTime: row.F_CreatorTime,
      isLocked: row.F_Lock === 1
    }));
    
    res.json({ success: true, data: { versions } });
  } catch (error) {
    console.error('获取版本列表失败:', error);
    res.status(500).json({ success: false, message: '获取版本列表失败' });
  }
});

/**
 * 获取版本历史（包含已删除的）
 * GET /api/performance/versions/history?date=YYYY-MM-DD
 */
router.get('/history', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: '日期参数不能为空' });
    }
    
    // fix#19: 排序逻辑与 parseVersionNum 一致
    const rows = await db.query(
      `SELECT 
        version,
        b_date,
        F_CreatorUserId,
        F_CreatorTime,
        F_Lock,
        F_DeleteMark,
        F_DeleteTime,
        status,
        failed_layer,
        status_message
       FROM b_version
       WHERE DATE(b_date) = ?
       ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC`,
      [date]
    );
    
    const versions = rows.map(row => ({
      version: row.version,
      bDate: row.b_date,
      creatorId: row.F_CreatorUserId,
      creatorName: row.F_CreatorUserId ? '用户' : '系统',
      createTime: row.F_CreatorTime,
      isLocked: row.F_Lock === 1,
      isDeleted: row.F_DeleteMark === 1,
      deleteTime: row.F_DeleteTime,
      status: row.status || 'ready',
      failedLayer: row.failed_layer || null,
      statusMessage: row.status_message || null
    }));
    
    res.json({ success: true, data: { versions } });
  } catch (error) {
    console.error('获取版本历史失败:', error);
    res.status(500).json({ success: false, message: '获取版本历史失败' });
  }
});

/**
 * 创建版本
 * POST /api/performance/versions
 */
router.post('/', async (req, res) => {
  try {
    const { date, months } = req.body;
    const creatorId = req.headers['x-user-id'] != null
      ? String(req.headers['x-user-id']).trim() || null
      : (req.currentUserId != null ? String(req.currentUserId) : null);
    const shNow = getShanghaiNow();
    const creatorTimeStr = `${shNow.getUTCFullYear()}-${String(shNow.getUTCMonth() + 1).padStart(2, '0')}-${String(
      shNow.getUTCDate()
    ).padStart(2, '0')} ${String(shNow.getUTCHours()).padStart(2, '0')}:${String(shNow.getUTCMinutes()).padStart(
      2,
      '0'
    )}:${String(shNow.getUTCSeconds()).padStart(2, '0')}`;
    
    if (!date || !months || !Array.isArray(months) || months.length === 0) {
      return res.status(400).json({ success: false, message: '日期和月份列表不能为空' });
    }
    
    if (months.length > 6) {
      return res.status(400).json({ success: false, message: '最多只能选择6个月份' });
    }

    const sqlRows = await db.query(
      `SELECT F_Id, interface_name, sql_content, exec_order, sql_layer, external_db_config_id, target_table
       FROM b_sql WHERE F_DeleteMark = 0 ORDER BY exec_order ASC`
    );
    
    const createdVersions = [];
    
    for (const monthDate of months) {
      const dateLockKey = `version_${monthDate}`;
      if (versionCreationLocks.has(dateLockKey)) {
        throw new Error(`日期 ${monthDate} 的版本正在创建中，请稍后重试`);
      }
      versionCreationLocks.add(dateLockKey);
      let version = null;
      try {
        // 先清掉同日期历史失败/中断版本，避免 V02→V04 跳号
        await purgeIncompleteVersionsForDate(monthDate, creatorId);

        const lockConn = await db.getConnection();
        try {
          await lockConn.beginTransaction();
          const [maxVersionRow] = await lockConn.query(
            `SELECT version 
             FROM b_version 
             WHERE DATE(b_date) = ?
               AND F_DeleteMark = 0
             ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC 
             LIMIT 1 FOR UPDATE`,
            [monthDate]
          );
          let newVersionNum = 1;
          if (maxVersionRow.length > 0) {
            newVersionNum = parseVersionNum(maxVersionRow[0].version) + 1;
          }
          version = `${monthDate.replace(/-/g, '')}V${String(newVersionNum).padStart(2, '0')}`;
          const id = await generateId('b_version', lockConn);
          await lockConn.execute(
            `INSERT INTO b_version 
             (F_Id, version, b_date, status, F_CreatorUserId, F_CreatorTime, F_DeleteMark, F_Lock)
             VALUES (?, ?, ?, 'extracting', ?, ?, 0, 0)`,
            [id, version, monthDate, creatorId, creatorTimeStr]
          );
          await lockConn.commit();
        } catch (lockErr) {
          await lockConn.rollback();
          throw lockErr;
        } finally {
          lockConn.release();
        }

        createdVersions.push(version);
        await runVersionPipeline({
          version, monthDate, creatorId, creatorTimeStr, sqlRows
        });
      } catch (err) {
        // 失败则整版软删（含 b_version），下次创建可复用该序号；执行日志保留
        await abortFailedVersion(version, creatorId, err);
        const logs = await listVersionRunLogs(version);
        err.versionRunLogs = logs;
        err.failedVersion = version;
        // 若刚占号后立刻失败，createdVersions 里不要留下无效号
        const idx = createdVersions.indexOf(version);
        if (idx >= 0) createdVersions.splice(idx, 1);
        throw err;
      } finally {
        versionCreationLocks.delete(dateLockKey);
      }
    }

    const runLogs = {};
    for (const v of createdVersions) {
      runLogs[v] = await listVersionRunLogs(v);
    }
    
    res.json({
      success: true,
      message: '版本创建成功',
      data: {
        versions: createdVersions,
        runLogs
      }
    });
  } catch (error) {
    console.error('创建版本失败:', error);
    res.status(500).json({
      success: false,
      message: '创建版本失败: ' + error.message,
      data: {
        version: error.failedVersion || null,
        runLogs: error.versionRunLogs || []
      }
    });
  }
});

/**
 * 查询版本创建执行日志（失败回滚后仍可查）
 * GET /api/performance/versions/:version/logs
 */
router.get('/:version/logs', async (req, res) => {
  try {
    const { version } = req.params;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    const logs = await listVersionRunLogs(version);
    res.json({ success: true, data: { version, logs } });
  } catch (error) {
    console.error('获取版本执行日志失败:', error);
    res.status(500).json({ success: false, message: '获取版本执行日志失败' });
  }
});

/**
 * 锁定/解锁版本
 * PATCH /api/performance/versions/:version/lock
 */
router.patch('/:version/lock', async (req, res) => {
  try {
    const { version } = req.params;
    const { locked } = req.body;
    const userId = req.currentUserId;
    
    if (!version || locked === undefined) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }
    
    // 检查用户权限
    const userRows = await db.query('SELECT role FROM users WHERE F_Id = ?', [userId]);
    const isAdmin = userRows.length > 0 && userRows[0].role === 'admin';
    
    // 获取当前版本状态
    const versionRows = await db.query(
      'SELECT F_Lock FROM b_version WHERE version = ? AND F_DeleteMark = 0',
      [version]
    );
    
    if (versionRows.length === 0) {
      return res.status(404).json({ success: false, message: '版本不存在' });
    }
    
    const currentLock = versionRows[0].F_Lock === 1;
    
    // 普通用户只能锁定，不能解锁
    if (currentLock && !locked && !isAdmin) {
      return res.status(403).json({ success: false, message: '权限不足，无法解锁' });
    }
    
    await db.execute(
      `UPDATE b_version 
       SET F_Lock = ?, F_LastModifyUserId = ?, F_LastModifyTime = NOW()
       WHERE version = ?`,
      [locked ? 1 : 0, userId, version]
    );
    
    res.json({
      success: true,
      message: locked ? '版本已锁定' : '版本已解锁',
      data: {
        version,
        isLocked: locked,
        operator: userId,
        operateTime: new Date()
      }
    });
  } catch (error) {
    console.error('锁定版本失败:', error);
    res.status(500).json({ success: false, message: '锁定版本失败' });
  }
});

/**
 * 删除版本（软删除）
 * DELETE /api/performance/versions/:version
 */
router.delete('/:version', async (req, res) => {
  try {
    const { version } = req.params;
    // 点击删除按钮的用户 id，与 users 表 id 一致
    const deleteUserId = req.headers['x-user-id'] != null
      ? String(req.headers['x-user-id']).trim() || null
      : (req.currentUserId != null ? String(req.currentUserId) : null);
    
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 检查版本是否被锁定
    const versionRows = await db.query(
      'SELECT F_Lock FROM b_version WHERE version = ? AND F_DeleteMark = 0',
      [version]
    );
    
    if (versionRows.length === 0) {
      return res.status(404).json({ success: false, message: '版本不存在' });
    }
    
    if (versionRows[0].F_Lock === 1) {
      return res.status(400).json({ success: false, message: '版本已被锁定，无法删除' });
    }
    
    // 软删除版本及关联数据（F_DeleteMark=1, F_DeleteUserId=操作人, F_DeleteTime=NOW()）
    // 使用事务保护：确保 17 张表要么全部删除成功，要么全部回滚
    const tables = VERSION_DATA_TABLES;
    
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const table of tables) {
        await conn.execute(
          `UPDATE \`${table}\`
           SET F_DeleteMark = 1, F_DeleteUserId = ?, F_DeleteTime = NOW()
           WHERE version = ? AND F_DeleteMark = 0`,
          [deleteUserId, version]
        );
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    
    res.json({
      success: true,
      message: '版本已删除',
      data: {
        version,
        deletedAt: new Date(),
        operator: deleteUserId
      }
    });
  } catch (error) {
    console.error('删除版本失败:', error);
    res.status(500).json({ success: false, message: '删除版本失败' });
  }
});

module.exports = router;

