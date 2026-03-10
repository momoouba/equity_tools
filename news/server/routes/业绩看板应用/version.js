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
const { computeAndUpdateTransactionIrr } = require('./transactionIrr');

// 业绩看板 b_* 表主键为 F_Id，插入时若结果中无则需生成
const ID_COLUMN = 'F_Id';

// 统一使用中国上海时间（UTC+8）
function getShanghaiNow() {
  const now = new Date();
  const shanghaiOffsetMinutes = -8 * 60; // UTC+8
  const localOffsetMinutes = now.getTimezoneOffset(); // 本地相对 UTC 的偏移（分钟，西区为正）
  const diffMs = (localOffsetMinutes - shanghaiOffsetMinutes) * 60 * 1000;
  return new Date(now.getTime() + diffMs);
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
    const creatorTimeStr = `${shNow.getFullYear()}-${String(shNow.getMonth() + 1).padStart(2, '0')}-${String(
      shNow.getDate()
    ).padStart(2, '0')} ${String(shNow.getHours()).padStart(2, '0')}:${String(shNow.getMinutes()).padStart(
      2,
      '0'
    )}:${String(shNow.getSeconds()).padStart(2, '0')}`;
    
    if (!date || !months || !Array.isArray(months) || months.length === 0) {
      return res.status(400).json({ success: false, message: '日期和月份列表不能为空' });
    }
    
    if (months.length > 6) {
      return res.status(400).json({ success: false, message: '最多只能选择6个月份' });
    }
    
    await connection.beginTransaction();
    
    const createdVersions = [];
    
    for (const monthDate of months) {
      // 获取当前日期的最大版本号（带锁）
      const [maxVersionRow] = await connection.query(
        `SELECT version 
         FROM b_version 
         WHERE DATE(b_date) = ? 
         ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC 
         LIMIT 1 FOR UPDATE`,
        [monthDate]
      );
      
      // 生成新版本号
      let newVersionNum = 1;
      if (maxVersionRow.length > 0) {
        const maxVersion = maxVersionRow[0].version;
        const match = maxVersion.match(/V(\d+)$/);
        if (match) {
          newVersionNum = parseInt(match[1]) + 1;
        }
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
        if (targetTable && String(targetTable).toLowerCase() === 'b_version') {
          continue;
        }

        if (externalId) {
          const ensureExternalPool = async () => {
            if (!getExternalPool(externalId)) {
              const cfgRows = await db.query(
                'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0 AND is_active = 1',
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
          if (rows.length > 0 && targetTable) {
            const withVersion = rows.map((r) => (typeof r === 'object' && r !== null ? { ...r, version } : { version, value: r }));
            if (isBizTableWithAudit(targetTable)) injectCreatorAndModify(withVersion, creatorId, creatorTimeStr);
            const withIds = await ensureRowIds(withVersion, targetTable, connection);
            const cols = Object.keys(withIds[0]);
            const quotedCols = cols.map((c) => '`' + String(c).replace(/`/g, '``') + '`').join(',');
            const values = withIds.map((r) => cols.map((c) => r[c]));
            await connection.query(
              `INSERT INTO \`${String(targetTable).replace(/`/g, '``')}\` (${quotedCols}) VALUES ?`,
              [values]
            );
          }
        } else {
          if (isInsert) {
            await connection.execute(sql, []);
          } else {
            const [rows] = await connection.query(sql, []);
            if (rows.length > 0 && targetTable) {
              const withVersion = rows.map((r) => ({ ...r, version }));
              if (isBizTableWithAudit(targetTable)) injectCreatorAndModify(withVersion, creatorId, creatorTimeStr);
              const withIds = await ensureRowIds(withVersion, targetTable, connection);
              const cols = Object.keys(withIds[0]);
              const quotedCols = cols.map((c) => '`' + String(c).replace(/`/g, '``') + '`').join(',');
              const values = withIds.map((r) => cols.map((c) => r[c]));
              await connection.query(
                `INSERT INTO \`${String(targetTable).replace(/`/g, '``')}\` (${quotedCols}) VALUES ?`,
                [values]
              );
            }
          }
        }
      }

      // b_transaction_indicator 写入完成后，基于 b_transaction 同版本数据计算 Gross IRR / Net IRR 并回写
      await computeAndUpdateTransactionIrr(connection, version);
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
    const userRows = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
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
    const tables = [
      'b_version', 'b_investment_indicator', 'b_investment_sum', 'b_investor_list',
      'b_manage_indicator', 'b_project_all', 'b_transaction_indicator', 'b_all_indicator',
      'b_investment', 'b_ipo', 'b_manage', 'b_project', 'b_transaction',
      'b_project_a', 'b_region_a', 'b_region', 'b_ipo_a'
    ];
    
    for (const table of tables) {
      await db.execute(
        `UPDATE \`${table}\`
         SET F_DeleteMark = 1, F_DeleteUserId = ?, F_DeleteTime = NOW()
         WHERE version = ? AND F_DeleteMark = 0`,
        [deleteUserId, version]
      );
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

