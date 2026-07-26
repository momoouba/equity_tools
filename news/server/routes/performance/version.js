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
  getSqlFirstKeyword
} = require('./config');
const {
  queryExternal,
  getExternalPool,
  createExternalPool,
  closeExternalPool
} = require('../../utils/externalDb');
const { computeAndUpdateTransactionIrr, computeIRR } = require('./transactionIrr');

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

/** 是否为需要写入创建人/修改人时间的 b_ 业务表（排除 b_sql、b_sql_change_log） */
function isBizTableWithAudit(targetTable) {
  return targetTable && typeof targetTable === 'string' &&
    targetTable.startsWith('b_') && targetTable !== 'b_sql' && targetTable !== 'b_sql_change_log';
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
  const useFId = targetTable.startsWith('b_') || targetTable === 'b_sql_change_log';
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

/**
 * 获取日期列表
 * GET /api/performance/versions/dates
 */
router.get('/dates', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT DATE(b_date) as date 
       FROM b_version 
       WHERE F_DeleteMark = 0 
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
        F_DeleteMark
       FROM b_version
       WHERE F_DeleteMark = 0 
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
        F_DeleteTime
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
      deleteTime: row.F_DeleteTime
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
  const connection = await db.getConnection();
  
  try {
    const { date, months } = req.body;
    // 触发生成数据的用户 id，与 users 表 id 一致（前端需在请求头传 X-User-Id）
    const creatorId = req.headers['x-user-id'] != null
      ? String(req.headers['x-user-id']).trim() || null
      : (req.currentUserId != null ? String(req.currentUserId) : null);
    // 统一使用上海时间当前时间，用于 F_CreatorTime（MySQL datetime 格式）
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
    
    await connection.beginTransaction();
    
    const createdVersions = [];
    
    for (const monthDate of months) {
      // 应用层并发锁：防止同日期并发创建导致版本号重复（FOR UPDATE 在空结果集上不获取锁）
      const dateLockKey = `version_${monthDate}`;
      if (versionCreationLocks.has(dateLockKey)) {
        throw new Error(`日期 ${monthDate} 的版本正在创建中，请稍后重试`);
      }
      versionCreationLocks.add(dateLockKey);
      try {
      // 获取当前日期的最大版本号（带锁）
      const [maxVersionRow] = await connection.query(
        `SELECT version 
         FROM b_version 
         WHERE DATE(b_date) = ? 
         ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC 
         LIMIT 1 FOR UPDATE`,
        [monthDate]
      );
      
      // 生成新版本号（fix#19: 使用 parseVersionNum 正则解析，与 SQL SUBSTRING_INDEX 排序逻辑一致）
      let newVersionNum = 1;
      if (maxVersionRow.length > 0) {
        newVersionNum = parseVersionNum(maxVersionRow[0].version) + 1;
      }
      
      const version = `${monthDate.replace(/-/g, '')}V${String(newVersionNum).padStart(2, '0')}`;
      const id = await generateId('b_version', connection);
      
      // 插入版本记录：F_CreatorUserId 为触发生成数据的用户，F_CreatorTime 为触发时间
      await connection.execute(
        `INSERT INTO b_version 
         (F_Id, version, b_date, F_CreatorUserId, F_CreatorTime, F_DeleteMark, F_Lock)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        [id, version, monthDate, creatorId, creatorTimeStr]
      );
      
      createdVersions.push(version);

      // 按数据接口配置顺序执行 SQL，将数据写入各业务表
      const [sqlRows] = await connection.query(
        `SELECT F_Id, interface_name, sql_content, exec_order, external_db_config_id, target_table
         FROM b_sql WHERE F_DeleteMark = 0 ORDER BY exec_order ASC`
      );

      for (const row of sqlRows) {
        let sql = (row.sql_content || '').trim();
        if (!sql) continue;
        sql = replaceDateInSql(sql, monthDate);
        sql = replaceVersionInSql(sql, version);
        const firstKeyword = getSqlFirstKeyword(sql);
        const isInsert = firstKeyword === 'INSERT';
        const externalId = row.external_db_config_id || null;
        const targetTable = row.target_table;

        // b_version 版本元数据只由当前接口维护，若某些数据接口配置了 b_version 作为目标表，避免重复写入
        // 加强校验：trim 后比较，且拒绝包含 schema 限定（含点号）的表名，防止绕过
        const sanitizedTargetTable = targetTable ? String(targetTable).trim() : '';
        if (sanitizedTargetTable && sanitizedTargetTable.toLowerCase() === 'b_version') {
          continue;
        }
        if (sanitizedTargetTable && sanitizedTargetTable.includes('.')) {
          throw new Error(`数据接口「${row.interface_name || row.F_Id}」目标表名包含非法字符（不允许 schema 限定）: ${targetTable}`);
        }

        if (externalId) {
          const ensureExternalPool = async () => {
            if (!getExternalPool(externalId)) {
              const cfgRows = await db.query(
                'SELECT * FROM external_db_config WHERE F_Id = ? AND F_DeleteMark = 0 AND is_active = 1',
                [externalId]
              );
              if (!cfgRows || cfgRows.length === 0) {
                throw new Error(`外部数据源配置不存在或未启用: ${externalId}`);
              }
              await createExternalPool(cfgRows[0]);
            }
          };

          await ensureExternalPool();
          if (isInsert) {
            throw new Error(`数据接口「${row.interface_name || row.F_Id}」使用外部数据源时仅支持 SELECT/WITH，请用 SELECT 取数后由系统写入目标表`);
          }
          let rows;
          try {
            rows = await queryExternal(externalId, sql, []);
          } catch (err) {
            if (
              err &&
              (err.code === 'ECONNRESET' ||
                err.code === 'PROTOCOL_CONNECTION_LOST' ||
                err.errno === -4077)
            ) {
              console.warn(`外部数据库连接重置，将尝试重连后重试一次 (${externalId}):`, err.message);
              await closeExternalPool(externalId);
              await ensureExternalPool();
              rows = await queryExternal(externalId, sql, []);
            } else {
              throw err;
            }
          }
          if (rows.length > 0 && sanitizedTargetTable) {
            const withVersion = rows.map((r) => (typeof r === 'object' && r !== null ? { ...r, version } : { version, value: r }));
            if (isBizTableWithAudit(sanitizedTargetTable)) injectCreatorAndModify(withVersion, creatorId, creatorTimeStr);
            const withIds = await ensureRowIds(withVersion, sanitizedTargetTable, connection);
            // 向下兼容：只写入目标表中实际存在的列
            const filtered = await filterColumnsForInsert(withIds, sanitizedTargetTable, connection);
            const cols = Object.keys(filtered[0]);
            const quotedCols = cols.map((c) => '`' + String(c).replace(/`/g, '``') + '`').join(',');
            const values = filtered.map((r) => cols.map((c) => r[c]));
            await connection.query(
              `INSERT INTO \`${sanitizedTargetTable.replace(/`/g, '``')}\` (${quotedCols}) VALUES ?`,
              [values]
            );
          }
        } else {
          if (isInsert) {
            await connection.execute(sql, []);
          } else {
            const [rows] = await connection.query(sql, []);
            if (rows.length > 0 && sanitizedTargetTable) {
              const withVersion = rows.map((r) => ({ ...r, version }));
              if (isBizTableWithAudit(sanitizedTargetTable)) injectCreatorAndModify(withVersion, creatorId, creatorTimeStr);
              const withIds = await ensureRowIds(withVersion, sanitizedTargetTable, connection);
              // 向下兼容：只写入目标表中实际存在的列
              const filtered = await filterColumnsForInsert(withIds, sanitizedTargetTable, connection);
              const cols = Object.keys(filtered[0]);
              const quotedCols = cols.map((c) => '`' + String(c).replace(/`/g, '``') + '`').join(',');
              const values = filtered.map((r) => cols.map((c) => r[c]));
              await connection.query(
                `INSERT INTO \`${sanitizedTargetTable.replace(/`/g, '``')}\` (${quotedCols}) VALUES ?`,
                [values]
              );
            }
          }
        }
      }

      // b_transaction_indicator 写入完成后，基于 b_transaction 同版本数据计算 Gross IRR / Net IRR 并回写
      await computeAndUpdateTransactionIrr(connection, version);

      // 计算项目级 IRR 并回写 b_investment.irr（区分基金）和 b_investment_sum.irr（不区分基金）
      try {
        // 1. b_investment：按 fund + project 分组计算 IRR
        const [fundCashflows] = await connection.query(
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
          await connection.query(
            `UPDATE b_investment SET irr = ? WHERE version = ? AND fund = ? AND project = ? AND F_DeleteMark = 0`,
            [irr, version, fund, project]
          );
        }

        // 2. b_investment_sum：按 project 分组计算 IRR（不区分基金）
        const [allCashflows] = await connection.query(
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
          await connection.query(
            `UPDATE b_investment_sum SET irr = ? WHERE version = ? AND project = ? AND F_DeleteMark = 0`,
            [irr, version, project]
          );
        }
      } catch (irrErr) {
        console.warn('版本创建时计算项目级IRR失败:', irrErr.message);
      }
      } finally {
        versionCreationLocks.delete(dateLockKey);
      }
    }

    await connection.commit();
    
    res.json({
      success: true,
      message: '版本创建成功',
      data: {
        versions: createdVersions
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('创建版本失败:', error);
    res.status(500).json({ success: false, message: '创建版本失败: ' + error.message });
  } finally {
    connection.release();
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
    const tables = [
      'b_version', 'b_investment_indicator', 'b_investment_sum', 'b_investor_list',
      'b_manage_indicator', 'b_project_all', 'b_transaction_indicator', 'b_all_indicator',
      'b_investment', 'b_investment_spv', 'b_ipo', 'b_manage', 'b_project', 'b_transaction',
      'b_project_a', 'b_region_a', 'b_region', 'b_ipo_a'
    ];
    
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

