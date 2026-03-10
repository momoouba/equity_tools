/**
 * 业绩看板应用 - 系统配置路由
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getCurrentUser } = require('../../middleware/auth');

router.use(getCurrentUser);

/** 允许的 SQL 首词：SELECT、WITH（CTE）、INSERT（INSERT...SELECT 写入目标表） */
const ALLOWED_SQL_STARTS = ['SELECT', 'WITH', 'INSERT'];

/**
 * 去掉字符串字面量和注释，只保留“可解析”的 SQL 骨架，用于检测危险指令（避免把 F_DeleteMark 等标识符误判为 DELETE）
 */
function stripStringsAndComments(sql) {
  let s = (sql || '').replace(/\r\n/g, '\n');
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === "'" || s[i] === '"') {
      const q = s[i];
      out += ' ';
      i++;
      while (i < n && s[i] !== q) {
        if (s[i] === '\\') i++;
        i++;
      }
      if (i < n) i++;
      continue;
    }
    if (s[i] === '-' && s[i + 1] === '-') {
      out += ' ';
      i += 2;
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      out += ' ';
      i += 2;
      while (i < n - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

/** 禁止的语句模式：仅检测“指令”形态，不把 F_DeleteMark、last_update 等标识符算作违规 */
const FORBIDDEN_STATEMENT_PATTERNS = [
  { pattern: /\bDELETE\s+FROM\b/i, name: 'DELETE' },
  { pattern: /\bUPDATE\s+\S+\s+SET\b/i, name: 'UPDATE' },
  { pattern: /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)\b/i, name: 'DROP' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, name: 'TRUNCATE' },
  { pattern: /\bALTER\s+TABLE\b/i, name: 'ALTER' }
];

/**
 * 仅当 SQL 中包含禁止的“语句”（如 DELETE FROM、UPDATE t SET），返回该指令名；否则返回 null。
 * 忽略标识符中的子串（如 F_DeleteMark、WHERE F_DeleteMark = 0）。
 */
function checkForbiddenStatements(sql) {
  const stripped = stripStringsAndComments(sql || '');
  for (const { pattern, name } of FORBIDDEN_STATEMENT_PATTERNS) {
    if (pattern.test(stripped)) return name;
  }
  return null;
}

/**
 * 取 SQL 首词（跳过注释行和块注释），用于校验是否允许执行
 * @param {string} sql
 * @returns {string|null} 首词大写或 null
 */
function getSqlFirstKeyword(sql) {
  let s = (sql || '').trim();
  if (!s) return null;
  // 去掉开头的单行注释
  while (s.startsWith('--')) {
    const idx = s.indexOf('\n');
    if (idx === -1) return null;
    s = s.slice(idx + 1).trim();
  }
  // 去掉开头的块注释
  while (s.startsWith('/*')) {
    const end = s.indexOf('*/');
    if (end === -1) return null;
    s = s.slice(end + 2).trim();
  }
  const match = s.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1].toUpperCase() : null;
}

function isAllowedSql(sql) {
  const first = getSqlFirstKeyword(sql);
  return first && ALLOWED_SQL_STARTS.includes(first);
}

/**
 * 获取指标说明配置
 * GET /api/performance/config/indicators
 */
router.get('/indicators', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM b_indicator_describe WHERE F_DeleteMark = 0 LIMIT 1'
    );
    
    if (rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    
    const config = rows[0];
    res.json({
      success: true,
      data: {
        systemName: config.system_name,
        manualUrl: config.manual_url,
        redirectUrl: config.redirect_url,
        fofNumDesc: config.fof_num_desc,
        directNumDesc: config.direct_num_desc,
        subAmountDesc: config.sub_amount_desc,
        paidInAmountDesc: config.paid_in_amount_desc,
        disAmountDesc: config.dis_amount_desc,
        lpSubDesc: config.lp_sub_desc,
        paidinDesc: config.paidin_desc,
        distributionDesc: config.distribution_desc,
        tvpiDesc: config.tvpi_desc,
        dpiDesc: config.dpi_desc,
        rvpiDesc: config.rvpi_desc,
        nirrDesc: config.nirr_desc,
        subAmountInvDesc: config.sub_amount_inv_desc,
        invAmountDesc: config.inv_amount_desc,
        exitAmountDesc: config.exit_amount_desc,
        girrDesc: config.girr_desc,
        mocDesc: config.moc_desc,
        fundInvExitDesc: config.fund_inv_exit_desc,
        fundSubExitDesc: config.fund_sub_exit_desc,
        fundPaidinReceiveDesc: config.fund_paidin_receive_desc,
        projectInvExitDesc: config.project_inv_exit_desc,
        projectPaidinReceiveDesc: config.project_paidin_receive_desc,
        fundInvAccDesc: config.fund_inv_acc_desc,
        fundSubAccDesc: config.fund_sub_acc_desc,
        fundPaidinAccDesc: config.fund_paidin_acc_desc,
        fundExitAccDesc: config.fund_exit_acc_desc,
        fundExitAmountAccDesc: config.fund_exit_amount_acc_desc,
        fundReceiveAccDesc: config.fund_receive_acc_desc,
        projectInvAccDesc: config.project_inv_acc_desc,
        projectPaidinAccDesc: config.project_paidin_acc_desc,
        projectExitAccDesc: config.project_exit_acc_desc,
        projectExitAmountAccDesc: config.project_exit_amount_acc_desc,
        projectReceiveAccDesc: config.project_receive_acc_desc,
        projectNumADesc: config.project_num_a_desc,
        totalAmountADesc: config.total_amount_a_desc,
        ipoNumADesc: config.ipo_num_a_desc,
        shNumADesc: config.sh_num_a_desc,
        projectNumDesc: config.project_num_desc,
        totalAmountDesc: config.total_amount_desc,
        ipoNumDesc: config.ipo_num_desc,
        shNumDesc: config.sh_num_desc
      }
    });
  } catch (error) {
    console.error('获取指标说明配置失败:', error);
    res.status(500).json({ success: false, message: '获取指标说明配置失败' });
  }
});

/**
 * 更新指标说明配置
 * PUT /api/performance/config/indicators
 */
router.put('/indicators', async (req, res) => {
  try {
    const userId = req.currentUserId;
    const {
      systemName, manualUrl, redirectUrl,
      fofNumDesc, directNumDesc, subAmountDesc, paidInAmountDesc, disAmountDesc,
      lpSubDesc, paidinDesc, distributionDesc, tvpiDesc, dpiDesc, rvpiDesc, nirrDesc,
      subAmountInvDesc, invAmountDesc, exitAmountDesc, girrDesc, mocDesc,
      fundInvExitDesc, fundSubExitDesc, fundPaidinReceiveDesc,
      projectInvExitDesc, projectPaidinReceiveDesc,
      fundInvAccDesc, fundSubAccDesc, fundPaidinAccDesc, fundExitAccDesc,
      fundExitAmountAccDesc, fundReceiveAccDesc,
      projectInvAccDesc, projectPaidinAccDesc, projectExitAccDesc,
      projectExitAmountAccDesc, projectReceiveAccDesc,
      projectNumADesc, totalAmountADesc, ipoNumADesc, shNumADesc,
      projectNumDesc, totalAmountDesc, ipoNumDesc, shNumDesc
    } = req.body;
    
    // 检查是否已有配置
    const existingRows = await db.query(
      'SELECT F_Id FROM b_indicator_describe WHERE F_DeleteMark = 0 LIMIT 1'
    );
    
    if (existingRows.length > 0) {
      // 更新
      await db.execute(
        `UPDATE b_indicator_describe SET
          system_name = ?, manual_url = ?, redirect_url = ?,
          fof_num_desc = ?, direct_num_desc = ?, sub_amount_desc = ?, paid_in_amount_desc = ?, dis_amount_desc = ?,
          lp_sub_desc = ?, paidin_desc = ?, distribution_desc = ?, tvpi_desc = ?, dpi_desc = ?, rvpi_desc = ?, nirr_desc = ?,
          sub_amount_inv_desc = ?, inv_amount_desc = ?, exit_amount_desc = ?, girr_desc = ?, moc_desc = ?,
          fund_inv_exit_desc = ?, fund_sub_exit_desc = ?, fund_paidin_receive_desc = ?,
          project_inv_exit_desc = ?, project_paidin_receive_desc = ?,
          fund_inv_acc_desc = ?, fund_sub_acc_desc = ?, fund_paidin_acc_desc = ?, fund_exit_acc_desc = ?,
          fund_exit_amount_acc_desc = ?, fund_receive_acc_desc = ?,
          project_inv_acc_desc = ?, project_paidin_acc_desc = ?, project_exit_acc_desc = ?,
          project_exit_amount_acc_desc = ?, project_receive_acc_desc = ?,
          project_num_a_desc = ?, total_amount_a_desc = ?, ipo_num_a_desc = ?, sh_num_a_desc = ?,
          project_num_desc = ?, total_amount_desc = ?, ipo_num_desc = ?, sh_num_desc = ?,
          F_LastModifyUserId = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ?`,
        [
          systemName, manualUrl, redirectUrl,
          fofNumDesc, directNumDesc, subAmountDesc, paidInAmountDesc, disAmountDesc,
          lpSubDesc, paidinDesc, distributionDesc, tvpiDesc, dpiDesc, rvpiDesc, nirrDesc,
          subAmountInvDesc, invAmountDesc, exitAmountDesc, girrDesc, mocDesc,
          fundInvExitDesc, fundSubExitDesc, fundPaidinReceiveDesc,
          projectInvExitDesc, projectPaidinReceiveDesc,
          fundInvAccDesc, fundSubAccDesc, fundPaidinAccDesc, fundExitAccDesc,
          fundExitAmountAccDesc, fundReceiveAccDesc,
          projectInvAccDesc, projectPaidinAccDesc, projectExitAccDesc,
          projectExitAmountAccDesc, projectReceiveAccDesc,
          projectNumADesc, totalAmountADesc, ipoNumADesc, shNumADesc,
          projectNumDesc, totalAmountDesc, ipoNumDesc, shNumDesc,
          userId, existingRows[0].F_Id
        ]
      );
    } else {
      // 新建
      const id = await generateId('b_indicator_describe');
      await db.execute(
        `INSERT INTO b_indicator_describe
         (F_Id, system_name, manual_url, redirect_url,
          fof_num_desc, direct_num_desc, sub_amount_desc, paid_in_amount_desc, dis_amount_desc,
          lp_sub_desc, paidin_desc, distribution_desc, tvpi_desc, dpi_desc, rvpi_desc, nirr_desc,
          sub_amount_inv_desc, inv_amount_desc, exit_amount_desc, girr_desc, moc_desc,
          fund_inv_exit_desc, fund_sub_exit_desc, fund_paidin_receive_desc,
          project_inv_exit_desc, project_paidin_receive_desc,
          fund_inv_acc_desc, fund_sub_acc_desc, fund_paidin_acc_desc, fund_exit_acc_desc,
          fund_exit_amount_acc_desc, fund_receive_acc_desc,
          project_inv_acc_desc, project_paidin_acc_desc, project_exit_acc_desc,
          project_exit_amount_acc_desc, project_receive_acc_desc,
          project_num_a_desc, total_amount_a_desc, ipo_num_a_desc, sh_num_a_desc,
          project_num_desc, total_amount_desc, ipo_num_desc, sh_num_desc,
          F_CreatorUserId, F_CreatorTime, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 0)`,
        [
          id, systemName, manualUrl, redirectUrl,
          fofNumDesc, directNumDesc, subAmountDesc, paidInAmountDesc, disAmountDesc,
          lpSubDesc, paidinDesc, distributionDesc, tvpiDesc, dpiDesc, rvpiDesc, nirrDesc,
          subAmountInvDesc, invAmountDesc, exitAmountDesc, girrDesc, mocDesc,
          fundInvExitDesc, fundSubExitDesc, fundPaidinReceiveDesc,
          projectInvExitDesc, projectPaidinReceiveDesc,
          fundInvAccDesc, fundSubAccDesc, fundPaidinAccDesc, fundExitAccDesc,
          fundExitAmountAccDesc, fundReceiveAccDesc,
          projectInvAccDesc, projectPaidinAccDesc, projectExitAccDesc,
          projectExitAmountAccDesc, projectReceiveAccDesc,
          projectNumADesc, totalAmountADesc, ipoNumADesc, shNumADesc,
          projectNumDesc, totalAmountDesc, ipoNumDesc, shNumDesc,
          userId, null, null
        ]
      );
    }
    
    res.json({ success: true, message: '配置已保存' });
  } catch (error) {
    console.error('保存指标说明配置失败:', error);
    res.status(500).json({ success: false, message: '保存配置失败' });
  }
});

/**
 * 获取 SQL 配置列表
 * GET /api/performance/config/sql-list
 */
router.get('/sql-list', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT F_Id as id, database_name, interface_name, sql_content, exec_order,
              external_db_config_id, target_table, remark,
              F_CreatorUserId, F_CreatorTime, F_LastModifyUserId, F_LastModifyTime
       FROM b_sql
       WHERE F_DeleteMark = 0
       ORDER BY exec_order ASC`
    );
    
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取 SQL 配置列表失败:', error);
    res.status(500).json({ success: false, message: '获取 SQL 配置列表失败' });
  }
});

/**
 * 获取 SQL 配置详情
 * GET /api/performance/config/sql/:id
 */
router.get('/sql/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const rows = await db.query(
      `SELECT F_Id as id, database_name, interface_name, sql_content, exec_order,
              external_db_config_id, target_table, remark,
              F_CreatorUserId, F_CreatorTime, F_LastModifyUserId, F_LastModifyTime
       FROM b_sql WHERE F_Id = ? AND F_DeleteMark = 0`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('获取 SQL 配置详情失败:', error);
    res.status(500).json({ success: false, message: '获取 SQL 配置详情失败' });
  }
});

/**
 * 创建SQL配置
 * POST /api/performance/config/sql
 */
router.post('/sql', async (req, res) => {
  try {
    // 当前登录用户 id，与 users 表 id 一致（请求头 x-user-id 或 currentUserId）
    const creatorId = req.headers['x-user-id'] != null
      ? String(req.headers['x-user-id']).trim() || null
      : (req.currentUserId != null ? String(req.currentUserId) : null);
    const {
      databaseName, interfaceName, sqlContent, execOrder,
      externalDbConfigId, targetTable
    } = req.body;
    
    if (!interfaceName || !sqlContent || !targetTable) {
      return res.status(400).json({ success: false, message: '接口名称、SQL内容和目标表不能为空' });
    }
    
    // SQL 安全检查：仅允许 SELECT / WITH（CTE）/ INSERT（INSERT...SELECT）
    if (!isAllowedSql(sqlContent)) {
      return res.status(400).json({
        success: false,
        message: '仅允许 SELECT、WITH（CTE）或 INSERT 开头的语句；禁止 UPDATE/DELETE/DROP/TRUNCATE/ALTER'
      });
    }
    const forbidden = checkForbiddenStatements(sqlContent);
    if (forbidden) {
      return res.status(400).json({ success: false, message: `SQL 中包含禁止的指令: ${forbidden}` });
    }
    
    const id = await generateId('b_sql');
    
    await db.execute(
      `INSERT INTO b_sql
       (F_Id, database_name, interface_name, sql_content, exec_order,
        external_db_config_id, target_table,
        F_CreatorUserId, F_CreatorTime, F_DeleteMark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [id, databaseName, interfaceName, sqlContent, execOrder || 0, externalDbConfigId, targetTable, creatorId]
    );
    
    res.json({ success: true, message: 'SQL配置已创建', data: { id } });
  } catch (error) {
    console.error('创建SQL配置失败:', error);
    res.status(500).json({ success: false, message: '创建SQL配置失败' });
  }
});

const SQL_FIELD_LABELS = {
  database_name: '数据库',
  interface_name: '接口名称',
  sql_content: 'SQL内容',
  exec_order: '执行顺序',
  external_db_config_id: '数据库选择',
  target_table: '目标表',
  remark: '备注'
};

function strVal(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * 更新SQL配置（记录修改人、修改时间，并写入修改日志）
 * PUT /api/performance/config/sql/:id
 */
router.put('/sql/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const modifyUserId = req.headers['x-user-id'] != null
      ? String(req.headers['x-user-id']).trim() || null
      : (req.currentUserId != null ? String(req.currentUserId) : null);
    const {
      databaseName, interfaceName, sqlContent, execOrder,
      externalDbConfigId, targetTable, remark
    } = req.body;
    
    // SQL 安全检查：仅允许 SELECT / WITH / INSERT
    if (sqlContent) {
      if (!isAllowedSql(sqlContent)) {
        return res.status(400).json({
          success: false,
          message: '仅允许 SELECT、WITH（CTE）或 INSERT 开头的语句'
        });
      }
      const forbidden = checkForbiddenStatements(sqlContent);
      if (forbidden) {
        return res.status(400).json({ success: false, message: `SQL 中包含禁止的指令: ${forbidden}` });
      }
    }
    
    const newVals = {
      database_name: databaseName,
      interface_name: interfaceName,
      sql_content: sqlContent,
      exec_order: execOrder == null ? 0 : execOrder,
      external_db_config_id: externalDbConfigId || null,
      target_table: targetTable,
      remark: remark || null
    };
    
    const currentRows = await db.query(
      'SELECT database_name, interface_name, sql_content, exec_order, external_db_config_id, target_table, remark FROM b_sql WHERE F_Id = ? AND F_DeleteMark = 0',
      [id]
    );
    if (!currentRows || currentRows.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const old = currentRows[0];
    
    const changes = [];
    const fields = ['database_name', 'interface_name', 'sql_content', 'exec_order', 'external_db_config_id', 'target_table', 'remark'];
    for (const field of fields) {
      const oldV = strVal(old[field]);
      const newV = strVal(newVals[field]);
      if (oldV !== newV) {
        changes.push({
          field,
          fieldLabel: SQL_FIELD_LABELS[field] || field,
          oldVal: oldV || '(空)',
          newVal: newV || '(空)'
        });
      }
    }
    
    if (changes.length > 0) {
      const logId = await generateId('b_sql_change_log');
      await db.execute(
        'INSERT INTO b_sql_change_log (F_Id, b_sql_id, modify_time, modify_user_id, changes_json) VALUES (?, ?, NOW(), ?, ?)',
        [logId, id, modifyUserId, JSON.stringify(changes)]
      );
    }
    
    await db.execute(
      `UPDATE b_sql SET
        database_name = ?, interface_name = ?, sql_content = ?, exec_order = ?,
        external_db_config_id = ?, target_table = ?, remark = ?,
        F_LastModifyUserId = ?, F_LastModifyTime = NOW()
       WHERE F_Id = ? AND F_DeleteMark = 0`,
      [newVals.database_name, newVals.interface_name, newVals.sql_content, newVals.exec_order, newVals.external_db_config_id, newVals.target_table, newVals.remark, modifyUserId, id]
    );
    
    res.json({ success: true, message: 'SQL配置已更新' });
  } catch (error) {
    console.error('更新SQL配置失败:', error);
    res.status(500).json({ success: false, message: '更新SQL配置失败' });
  }
});

/**
 * 删除SQL配置
 * DELETE /api/performance/config/sql/:id
 */
router.delete('/sql/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteUserId = req.headers['x-user-id'] != null
      ? String(req.headers['x-user-id']).trim() || null
      : (req.currentUserId != null ? String(req.currentUserId) : null);
    
    await db.execute(
      `UPDATE b_sql SET F_DeleteMark = 1, F_DeleteUserId = ?, F_DeleteTime = NOW()
       WHERE F_Id = ?`,
      [deleteUserId, id]
    );
    
    res.json({ success: true, message: 'SQL配置已删除' });
  } catch (error) {
    console.error('删除SQL配置失败:', error);
    res.status(500).json({ success: false, message: '删除SQL配置失败' });
  }
});

/**
 * 获取数据接口配置修改日志
 * GET /api/performance/config/sql/:id/log
 */
router.get('/sql/:id/log', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db.query(
      `SELECT F_Id as id, b_sql_id, modify_time, modify_user_id, changes_json
       FROM b_sql_change_log WHERE b_sql_id = ? ORDER BY modify_time DESC`,
      [id]
    );
    const list = rows.map(r => ({
      id: r.id,
      modifyTime: r.modify_time,
      modifyUserId: r.modify_user_id,
      modifyUserName: null,
      changes: (() => {
        try {
          return r.changes_json ? JSON.parse(r.changes_json) : [];
        } catch (e) {
          return [];
        }
      })()
    }));
    const userIds = [...new Set(list.map(l => l.modifyUserId).filter(Boolean))];
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      const users = await db.query(`SELECT id, account FROM users WHERE id IN (${placeholders})`, userIds);
      const userMap = {};
      users.forEach(u => { userMap[String(u.id)] = u.account || u.id; });
      list.forEach(l => { l.modifyUserName = l.modifyUserId ? (userMap[String(l.modifyUserId)] || l.modifyUserId) : '未知'; });
    } else {
      list.forEach(l => { l.modifyUserName = l.modifyUserId ? l.modifyUserId : '未知'; });
    }
    res.json({ success: true, data: { list } });
  } catch (error) {
    console.error('获取SQL配置日志失败:', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

const DATE_PLACEHOLDER = "'${date}'";
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/**
 * 将 SQL 中所有 '${date}' 替换为传入的日期（格式 'YYYY-MM-DD'），用于执行
 * @param {string} sql - 原始 SQL
 * @param {string} dateStr - 日期字符串，仅允许 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss
 * @returns {string} 替换后的 SQL
 */
function replaceDateInSql(sql, dateStr) {
  if (!dateStr || !DATE_REGEX.test(dateStr.trim())) {
    return sql;
  }
  const safeDate = dateStr.trim().substring(0, 10);
  const replacement = `'${safeDate}'`;
  return sql.split(DATE_PLACEHOLDER).join(replacement);
}

const VERSION_PLACEHOLDER = "'${version}'";

function replaceVersionInSql(sql, versionStr) {
  if (!versionStr || typeof versionStr !== 'string') return sql;
  const safe = String(versionStr).trim();
  if (!safe) return sql;
  return sql.split(VERSION_PLACEHOLDER).join(`'${safe.replace(/'/g, "''")}'`);
}

/**
 * 测试SQL配置（执行 SELECT，支持日期参数 '${date}'）
 * POST /api/performance/config/sql/:id/test
 * body: { date: 'YYYY-MM-DD' }
 * 说明：SQL 中的 '${date}' 会被整体替换为传入的日期，格式如 '2025-06-30'；多处 '${date}' 均替换为同一日期。
 */
router.post('/sql/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.body;
    
    if (!date) {
      return res.status(400).json({ success: false, message: '测试日期不能为空' });
    }
    if (!DATE_REGEX.test(date.trim())) {
      return res.status(400).json({ success: false, message: '日期格式须为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss' });
    }
    
    const configRows = await db.query(
      'SELECT * FROM b_sql WHERE F_Id = ? AND F_DeleteMark = 0',
      [id]
    );
    
    if (configRows.length === 0) {
      return res.status(404).json({ success: false, message: 'SQL配置不存在' });
    }
    
    const config = configRows[0];
    let sqlContent = (config.sql_content || '').trim();
    if (!isAllowedSql(sqlContent)) {
      return res.status(400).json({
        success: false,
        message: '仅允许 SELECT、WITH（CTE）或 INSERT 开头的语句'
      });
    }

    const hasDatePlaceholder = sqlContent.includes(DATE_PLACEHOLDER);
    if (hasDatePlaceholder) {
      sqlContent = replaceDateInSql(sqlContent, date);
    }

    const firstKeyword = getSqlFirstKeyword(sqlContent);
    const isInsert = firstKeyword === 'INSERT';

    const start = Date.now();
    let rows = [];
    let rowCount = 0;
    try {
      if (config.external_db_config_id) {
        const { queryExternal, executeExternal, getExternalPool, createExternalPool } = require('../../utils/externalDb');
        if (!getExternalPool(config.external_db_config_id)) {
          const cfgRows = await db.query('SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0 AND is_active = 1', [config.external_db_config_id]);
          if (cfgRows && cfgRows.length > 0) {
            await createExternalPool(cfgRows[0]);
          }
        }
        if (!getExternalPool(config.external_db_config_id)) {
          return res.status(500).json({ success: false, message: '外部数据库连接不可用，请检查系统配置中的数据库连接' });
        }
        if (isInsert) {
          const execResult = await executeExternal(config.external_db_config_id, sqlContent, []);
          rowCount = execResult.affectedRows != null ? execResult.affectedRows : (execResult.rowCount ?? 0);
        } else {
          rows = await queryExternal(config.external_db_config_id, sqlContent, []);
          rowCount = Array.isArray(rows) ? rows.length : 0;
        }
      } else {
        if (isInsert) {
          const result = await db.execute(sqlContent, []);
          rowCount = result && result.affectedRows != null ? result.affectedRows : 0;
        } else {
          rows = await db.query(sqlContent, []);
          rows = Array.isArray(rows) ? rows : [];
          rowCount = rows.length;
        }
      }
    } catch (execErr) {
      const duration = Date.now() - start;
      return res.json({
        success: false,
        message: execErr.message || 'SQL 执行失败',
        data: { duration, rowCount: 0, rows: [] }
      });
    }

    const duration = Date.now() - start;
    const dateReplacement = hasDatePlaceholder ? `'${date.trim().substring(0, 10)}'` : null;
    res.json({
      success: true,
      message: '执行成功',
      data: {
        rowCount,
        rows: Array.isArray(rows) ? rows : [],
        duration,
        testDate: date,
        dateReplacement,
        isInsert: isInsert ? true : undefined
      }
    });
  } catch (error) {
    console.error('测试SQL配置失败:', error);
    res.status(500).json({ success: false, message: '测试SQL配置失败' });
  }
});

/**
 * 获取外部数据库配置列表
 * GET /api/performance/config/databases
 */
router.get('/databases', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, name, db_type, host, port, \`database\` AS database_name, is_active
       FROM external_db_config
       WHERE is_deleted = 0 AND is_active = 1`
    );
    
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取数据库配置列表失败:', error);
    res.status(500).json({ success: false, message: '获取数据库配置列表失败' });
  }
});

module.exports = router;
module.exports.replaceDateInSql = replaceDateInSql;
module.exports.replaceVersionInSql = replaceVersionInSql;
module.exports.DATE_PLACEHOLDER = DATE_PLACEHOLDER;
module.exports.getSqlFirstKeyword = getSqlFirstKeyword;
