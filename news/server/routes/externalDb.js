const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const {
  testExternalConnection,
  initializeExternalDatabases,
  closeExternalPool
} = require('../utils/externalDb');

const router = express.Router();

// 权限检查中间件
const checkAdminPermission = (req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'user';
  const userId = req.headers['x-user-id'] || null;

  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  if (userRole !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足，只有管理员可以管理外部数据库配置' });
  }

  req.currentUserId = userId;
  next();
};

// 获取所有外部数据库配置
router.get('/', checkAdminPermission, async (req, res) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const configs = await db.query(
      `SELECT id, name, db_type, host, port, user, database, is_active, is_deleted, 
              created_at, updated_at, created_by, updated_by
       FROM external_db_config 
       WHERE is_deleted = 0
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [parseInt(pageSize), offset]
    );

    // 隐藏密码字段
    const safeConfigs = configs.map(config => ({
      ...config,
      password: '***' // 不返回真实密码
    }));

    const [totalResult] = await db.query('SELECT COUNT(*) as total FROM external_db_config WHERE is_deleted = 0');
    const total = totalResult.total || 0;

    res.json({
      success: true,
      data: safeConfigs,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取外部数据库配置列表失败：', error);
    res.status(500).json({ success: false, message: '获取外部数据库配置列表失败：' + error.message });
  }
});

// 获取单个外部数据库配置
router.get('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    const configs = await db.query(
      'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '外部数据库配置不存在' });
    }

    const config = configs[0];
    // 隐藏密码字段
    config.password = '***';

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('获取外部数据库配置失败：', error);
    res.status(500).json({ success: false, message: '获取外部数据库配置失败：' + error.message });
  }
});

// 新增外部数据库配置
router.post('/', [
  checkAdminPermission,
  body('name').notEmpty().withMessage('配置名称不能为空'),
  body('db_type').isIn(['mysql', 'postgresql']).withMessage('数据库类型必须是mysql或postgresql'),
  body('host').notEmpty().withMessage('数据库主机不能为空'),
  body('port').isInt({ min: 1, max: 65535 }).withMessage('端口号必须在1-65535之间'),
  body('user').notEmpty().withMessage('数据库用户名不能为空'),
  body('password').notEmpty().withMessage('数据库密码不能为空'),
  body('database').notEmpty().withMessage('数据库名称不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, db_type = 'mysql', host, port, user, password, database, is_active = true } = req.body;

    // 检查配置名称是否重复
    const existing = await db.query(
      'SELECT id FROM external_db_config WHERE name = ? AND is_deleted = 0',
      [name]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '配置名称已存在' });
    }

    const configId = await generateId('external_db_config');

    await db.execute(
      `INSERT INTO external_db_config 
       (id, name, db_type, host, port, user, password, database, is_active, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [configId, name, db_type, host, port, user, password, database, is_active ? 1 : 0, req.currentUserId]
    );

    // 如果配置是启用状态，立即初始化连接
    if (is_active) {
      const configs = await db.query(
        'SELECT * FROM external_db_config WHERE is_deleted = 0 AND is_active = 1'
      );
      await initializeExternalDatabases(configs);
    }

    res.json({
      success: true,
      message: '外部数据库配置创建成功',
      data: { id: configId }
    });
  } catch (error) {
    console.error('创建外部数据库配置失败：', error);
    res.status(500).json({ success: false, message: '创建外部数据库配置失败：' + error.message });
  }
});

// 更新外部数据库配置
router.put('/:id', [
  checkAdminPermission,
  body('name').optional().notEmpty().withMessage('配置名称不能为空'),
  body('db_type').optional().isIn(['mysql', 'postgresql']).withMessage('数据库类型必须是mysql或postgresql'),
  body('host').optional().notEmpty().withMessage('数据库主机不能为空'),
  body('port').optional().isInt({ min: 1, max: 65535 }).withMessage('端口号必须在1-65535之间'),
  body('user').optional().notEmpty().withMessage('数据库用户名不能为空'),
  body('database').optional().notEmpty().withMessage('数据库名称不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { name, db_type, host, port, user, password, database, is_active } = req.body;

    // 检查配置是否存在
    const existing = await db.query(
      'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '外部数据库配置不存在' });
    }

    // 如果修改了配置名称，检查是否重复
    if (name && name !== existing[0].name) {
      const duplicate = await db.query(
        'SELECT id FROM external_db_config WHERE name = ? AND id != ? AND is_deleted = 0',
        [name, id]
      );

      if (duplicate.length > 0) {
        return res.status(400).json({ success: false, message: '配置名称已存在' });
      }
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (db_type !== undefined) {
      updateFields.push('db_type = ?');
      updateValues.push(db_type);
    }
    if (host !== undefined) {
      updateFields.push('host = ?');
      updateValues.push(host);
    }
    if (port !== undefined) {
      updateFields.push('port = ?');
      updateValues.push(port);
    }
    if (user !== undefined) {
      updateFields.push('user = ?');
      updateValues.push(user);
    }
    if (password !== undefined) {
      updateFields.push('password = ?');
      updateValues.push(password);
    }
    if (database !== undefined) {
      updateFields.push('database = ?');
      updateValues.push(database);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(is_active ? 1 : 0);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_by = ?');
      updateValues.push(req.currentUserId);
      updateValues.push(id);

      await db.execute(
        `UPDATE external_db_config SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      // 重新初始化所有启用的外部数据库连接
      const configs = await db.query(
        'SELECT * FROM external_db_config WHERE is_deleted = 0 AND is_active = 1'
      );
      await initializeExternalDatabases(configs);
    }

    res.json({
      success: true,
      message: '外部数据库配置更新成功'
    });
  } catch (error) {
    console.error('更新外部数据库配置失败：', error);
    res.status(500).json({ success: false, message: '更新外部数据库配置失败：' + error.message });
  }
});

// 删除外部数据库配置（软删除）
router.delete('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      'SELECT id FROM external_db_config WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '外部数据库配置不存在' });
    }

    await db.execute(
      'UPDATE external_db_config SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [req.currentUserId, id]
    );

    // 关闭该配置的连接
    await closeExternalPool(id);

    res.json({
      success: true,
      message: '外部数据库配置删除成功'
    });
  } catch (error) {
    console.error('删除外部数据库配置失败：', error);
    res.status(500).json({ success: false, message: '删除外部数据库配置失败：' + error.message });
  }
});

// 测试外部数据库连接
router.post('/:id/test', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    const configs = await db.query(
      'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '外部数据库配置不存在' });
    }

    const config = configs[0];
    const result = await testExternalConnection(config);

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('测试外部数据库连接失败：', error);
    res.status(500).json({ success: false, message: '测试连接失败：' + error.message });
  }
});

// 测试新配置的连接（不保存）
router.post('/test', [
  checkAdminPermission,
  body('db_type').isIn(['mysql', 'postgresql']).withMessage('数据库类型必须是mysql或postgresql'),
  body('host').notEmpty().withMessage('数据库主机不能为空'),
  body('port').isInt({ min: 1, max: 65535 }).withMessage('端口号必须在1-65535之间'),
  body('user').notEmpty().withMessage('数据库用户名不能为空'),
  body('password').notEmpty().withMessage('数据库密码不能为空'),
  body('database').notEmpty().withMessage('数据库名称不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { db_type = 'mysql', host, port, user, password, database } = req.body;
    const result = await testExternalConnection({ db_type, host, port, user, password, database });

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('测试外部数据库连接失败：', error);
    res.status(500).json({ success: false, message: '测试连接失败：' + error.message });
  }
});

// 查询外部数据库（通用查询接口）
router.post('/:id/query', [
  checkAdminPermission,
  body('sql').notEmpty().withMessage('SQL语句不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { sql, params = [] } = req.body;

    // 安全检查：只允许SELECT查询
    const trimmedSql = sql.trim().toUpperCase();
    if (!trimmedSql.startsWith('SELECT')) {
      return res.status(400).json({ success: false, message: '只允许执行SELECT查询语句' });
    }

    const { queryExternal } = require('../utils/externalDb');
    const result = await queryExternal(id, sql, params);

    res.json({
      success: true,
      data: result,
      count: result.length
    });
  } catch (error) {
    console.error('查询外部数据库失败：', error);
    res.status(500).json({ success: false, message: '查询失败：' + error.message });
  }
});

module.exports = router;

