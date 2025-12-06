const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');

const router = express.Router();

// 注册接口
router.post('/register', [
  body('account').notEmpty().withMessage('账号不能为空'),
  body('phone').matches(/^1[3-9]\d{9}$/).withMessage('手机号格式不正确'),
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6位'),
  body('company_name').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { account, phone, email, password, company_name } = req.body;

    const accountRows = await db.query('SELECT id FROM users WHERE account = ?', [account]);
    if (accountRows.length > 0) {
      return res.status(400).json({ success: false, message: '账号已存在' });
    }

    const phoneRows = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (phoneRows.length > 0) {
      return res.status(400).json({ success: false, message: '手机号已存在' });
    }

    const emailRows = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (emailRows.length > 0) {
      return res.status(400).json({ success: false, message: '邮箱已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 查询普通会员等级，如果不存在则使用null（允许注册）
    let membershipLevelId = null;
    try {
      const levelRows = await db.query('SELECT id FROM membership_levels WHERE level_name = ? LIMIT 1', ['普通会员']);
      if (levelRows.length > 0) {
        membershipLevelId = levelRows[0].id;
      } else {
        console.warn('警告：未找到"普通会员"等级，用户将注册为无会员等级');
      }
    } catch (err) {
      console.warn('查询会员等级时出错（将使用null）：', err.message);
    }

    // 生成用户ID
    const userId = await generateId('users');

    await db.execute(
      'INSERT INTO users (id, account, phone, email, password, company_name, membership_level_id, account_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, account, phone, email, hashedPassword, company_name || '', membershipLevelId, 'active']
    );

    res.json({
      success: true,
      message: '注册成功',
      user: {
        id: userId,
        account,
        phone,
        email,
        company_name: company_name || ''
      }
    });
  } catch (error) {
    console.error('注册错误：', error);
    console.error('错误详情：', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.message.includes('email')) {
        return res.status(400).json({ success: false, message: '邮箱已存在' });
      }
      if (error.message.includes('account')) {
        return res.status(400).json({ success: false, message: '账号已存在' });
      }
      if (error.message.includes('phone')) {
        return res.status(400).json({ success: false, message: '手机号已存在' });
      }
    }
    
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
      return res.status(400).json({ success: false, message: '会员等级不存在，请联系管理员' });
    }
    
    res.status(500).json({ 
      success: false, 
      message: '服务器错误：' + (error.message || '未知错误'),
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 登录接口
router.post('/login', [
  body('account').notEmpty().withMessage('账号不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { account, password } = req.body;

    const users = await db.query(
      `SELECT u.*, ml.level_name, ml.validity_days, ml.app_id, a.app_name, a.id as application_id
       FROM users u 
       LEFT JOIN membership_levels ml ON u.membership_level_id = ml.id 
       LEFT JOIN applications a ON ml.app_id = a.id
       WHERE u.account = ?`,
      [account]
    );

    if (!users.length) {
      return res.status(401).json({ success: false, message: '账号或密码错误' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: '账号或密码错误' });
    }

    if (user.account_status !== 'active') {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }

    // 获取用户的应用权限（通过membership_levels关联applications）
    const appPermissions = [];
    if (user.app_id && user.app_name) {
      appPermissions.push({
        app_id: user.app_id,
        app_name: user.app_name
      });
    }

    // 如果app_permissions字段有值，也解析它（JSON格式）
    if (user.app_permissions) {
      try {
        const parsedPermissions = JSON.parse(user.app_permissions);
        if (Array.isArray(parsedPermissions)) {
          parsedPermissions.forEach(perm => {
            if (perm.app_id && !appPermissions.find(p => p.app_id === perm.app_id)) {
              appPermissions.push(perm);
            }
          });
        }
      } catch (e) {
        console.warn('解析app_permissions失败:', e);
      }
    }

    const { password: _, app_id, app_name, application_id, ...userInfo } = user;
    res.json({
      success: true,
      message: '登录成功',
      user: {
        ...userInfo,
        app_permissions: appPermissions
      }
    });
  } catch (error) {
    console.error('登录错误：', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取用户列表（仅admin可用，包含会员等级和应用信息）
router.get('/users', async (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'user';
    const { page = 1, pageSize = 10 } = req.query;
    
    // 只有admin可以获取用户列表
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: '无权访问' });
    }

    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    // 获取总数
    const [totalResult] = await db.query('SELECT COUNT(*) as total FROM users');
    const total = totalResult.total || 0;

    // 获取用户列表，包含会员等级和应用信息
    const users = await db.query(
      `SELECT u.id, u.account, u.phone, u.email, u.company_name, u.account_status, 
              u.membership_level_id, u.app_permissions, u.created_at,
              ml.level_name as membership_level_name, ml.app_id as membership_app_id,
              a.app_name as membership_app_name
       FROM users u
       LEFT JOIN membership_levels ml ON u.membership_level_id = ml.id
       LEFT JOIN applications a ON ml.app_id = a.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [parseInt(pageSize), offset]
    );

    // 解析app_permissions JSON字段
    const usersWithPermissions = users.map(user => {
      let appPermissions = [];
      if (user.app_permissions) {
        try {
          appPermissions = JSON.parse(user.app_permissions);
        } catch (e) {
          console.warn(`解析用户 ${user.id} 的app_permissions失败:`, e);
        }
      }
      return {
        ...user,
        app_permissions: appPermissions
      };
    });

    res.json({
      success: true,
      data: usersWithPermissions,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取用户列表失败：', error);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// 获取所有应用列表
router.get('/applications', async (req, res) => {
  try {
    const applications = await db.query('SELECT id, app_name FROM applications ORDER BY app_name');
    res.json({
      success: true,
      data: applications
    });
  } catch (error) {
    console.error('获取应用列表失败：', error);
    res.status(500).json({ success: false, message: '获取应用列表失败' });
  }
});

// 获取指定应用的所有会员等级
router.get('/membership-levels/:appId', async (req, res) => {
  try {
    const { appId } = req.params;
    const levels = await db.query(
      'SELECT id, level_name, validity_days, app_id FROM membership_levels WHERE app_id = ? ORDER BY level_name',
      [appId]
    );
    res.json({
      success: true,
      data: levels
    });
  } catch (error) {
    console.error('获取会员等级列表失败：', error);
    res.status(500).json({ success: false, message: '获取会员等级列表失败' });
  }
});

// 批量更新用户的应用会员等级配置
router.put('/users/:id/memberships', [
  body('memberships').isArray().withMessage('memberships必须是数组'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userRole = req.headers['x-user-role'] || 'user';
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: '无权访问' });
    }

    const { id } = req.params;
    const { memberships } = req.body; // [{app_id, membership_level_id}, ...]

    // 检查用户是否存在
    const users = await db.query('SELECT id, app_permissions FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const user = users[0];

    // 解析现有的app_permissions
    let appPermissions = [];
    if (user.app_permissions) {
      try {
        appPermissions = JSON.parse(user.app_permissions);
      } catch (e) {
        appPermissions = [];
      }
    }

    // 构建新的配置映射
    const newConfigMap = {};
    memberships.forEach(m => {
      if (m.app_id && m.membership_level_id) {
        newConfigMap[m.app_id] = m.membership_level_id;
      }
    });

    // 更新app_permissions
    const updatedPermissions = [];
    
    // 保留不在新配置中的应用（如果有其他配置）
    appPermissions.forEach(perm => {
      if (newConfigMap.hasOwnProperty(perm.app_id)) {
        // 更新该应用的配置
        updatedPermissions.push({
          app_id: perm.app_id,
          membership_level_id: newConfigMap[perm.app_id]
        });
        delete newConfigMap[perm.app_id];
      }
    });

    // 添加新的应用配置
    Object.keys(newConfigMap).forEach(appId => {
      updatedPermissions.push({
        app_id: appId,
        membership_level_id: newConfigMap[appId]
      });
    });

    // 更新数据库
    await db.execute(
      'UPDATE users SET app_permissions = ? WHERE id = ?',
      [JSON.stringify(updatedPermissions), id]
    );

    res.json({
      success: true,
      message: '用户会员等级配置更新成功'
    });
  } catch (error) {
    console.error('更新用户会员等级失败：', error);
    res.status(500).json({ success: false, message: '更新用户会员等级失败：' + error.message });
  }
});

// 更新用户的主会员等级（membership_level_id）
router.put('/users/:id/main-membership', [
  body('membership_level_id').optional(),
], async (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'user';
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: '无权访问' });
    }

    const { id } = req.params;
    const { membership_level_id } = req.body;

    // 检查用户是否存在
    const users = await db.query('SELECT id FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 更新主会员等级
    await db.execute(
      'UPDATE users SET membership_level_id = ? WHERE id = ?',
      [membership_level_id || null, id]
    );

    res.json({
      success: true,
      message: '用户主会员等级更新成功'
    });
  } catch (error) {
    console.error('更新用户主会员等级失败：', error);
    res.status(500).json({ success: false, message: '更新用户主会员等级失败：' + error.message });
  }
});

module.exports = router;

