const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
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
    
    // 查询新闻舆情应用的普通会员等级，作为新用户的默认会员等级
    let membershipLevelId = null;
    try {
      const levelRows = await db.query(
        `SELECT ml.id FROM membership_levels ml
         JOIN applications a ON ml.app_id = a.id
         WHERE a.app_name = '新闻舆情'
         AND ml.level_name = '普通会员'
         LIMIT 1`
      );
      if (levelRows.length > 0) {
        membershipLevelId = levelRows[0].id;
        console.log(`  ✓ 新用户将注册为：新闻舆情 - 普通会员 (ID: ${membershipLevelId})`);
      } else {
        console.warn('警告：未找到"新闻舆情-普通会员"等级，用户将注册为无会员等级');
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

    // 注册时生成 API Token 并写入 user 表（用于对外接口鉴权）
    const apiToken = crypto.randomBytes(32).toString('hex');
    await db.execute(
      'UPDATE users SET api_token = ?, api_token_updated_at = NOW() WHERE id = ?',
      [apiToken, userId]
    );

    res.json({
      success: true,
      message: '注册成功',
      user: {
        id: userId,
        account,
        phone,
        email,
        company_name: company_name || '',
        api_token: apiToken
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

    // 登录时若该用户尚无 API Token，则生成并写入 user 表（后续不自动更新）
    if (!user.api_token) {
      const apiToken = crypto.randomBytes(32).toString('hex');
      await db.execute(
        'UPDATE users SET api_token = ?, api_token_updated_at = NOW() WHERE id = ?',
        [apiToken, user.id]
      );
      user.api_token = apiToken;
    }

    // 获取用户的应用权限（通过 membership_levels 关联 applications）
    const appPermissions = [];
    if (user.app_id && user.app_name) {
      appPermissions.push({
        app_id: user.app_id,
        app_name: user.app_name,
        membership_level_id: user.membership_level_id || null
      });
    }

    // 如果 app_permissions 字段有值，也解析它（JSON 格式），并补全 app_name
    if (user.app_permissions) {
      try {
        const parsedPermissions = JSON.parse(user.app_permissions);
        if (Array.isArray(parsedPermissions)) {
          const missingName = parsedPermissions.filter(
            p => p.membership_level_id && !p.app_name
          );
          let levelRows = [];
          if (missingName.length > 0) {
            const levelIds = missingName.map(p => p.membership_level_id);
            levelRows = await db.query(
              `SELECT ml.id AS membership_level_id, a.id AS app_id, a.app_name
               FROM membership_levels ml
               JOIN applications a ON ml.app_id = a.id
               WHERE ml.id IN (${levelIds.map(() => '?').join(',')})`,
              levelIds
            );
          }

          parsedPermissions.forEach(perm => {
            let enriched = { ...perm };
            if (perm.membership_level_id && !perm.app_name && levelRows.length) {
              const match = levelRows.find(
                r => r.membership_level_id === perm.membership_level_id
              );
              if (match) {
                enriched.app_name = match.app_name;
                enriched.app_id = match.app_id;
              }
            }
            if (
              enriched.app_id &&
              !appPermissions.find(p => p.app_id === enriched.app_id)
            ) {
              appPermissions.push(enriched);
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

// 获取当前登录用户最新信息（含应用会员权限）
// 需在请求头携带 x-user-id，由前端 axios 拦截器自动注入
router.get('/me', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    const users = await db.query(
      `SELECT u.*, ml.level_name, ml.validity_days, ml.app_id, a.app_name, a.id as application_id
       FROM users u 
       LEFT JOIN membership_levels ml ON u.membership_level_id = ml.id 
       LEFT JOIN applications a ON ml.app_id = a.id
       WHERE u.id = ?`,
      [userId]
    );

    if (!users.length) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const user = users[0];
    if (user.account_status !== 'active') {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }

    const appPermissions = [];
    if (user.app_id && user.app_name) {
      appPermissions.push({
        app_id: user.app_id,
        app_name: user.app_name,
        membership_level_id: user.membership_level_id || null
      });
    }

    if (user.app_permissions) {
      try {
        const parsedPermissions = JSON.parse(user.app_permissions);
        if (Array.isArray(parsedPermissions)) {
          const missingName = parsedPermissions.filter(
            p => p.membership_level_id && !p.app_name
          );
          let levelRows = [];
          if (missingName.length > 0) {
            const levelIds = missingName.map(p => p.membership_level_id);
            levelRows = await db.query(
              `SELECT ml.id AS membership_level_id, a.id AS app_id, a.app_name
               FROM membership_levels ml
               JOIN applications a ON ml.app_id = a.id
               WHERE ml.id IN (${levelIds.map(() => '?').join(',')})`,
              levelIds
            );
          }

          parsedPermissions.forEach(perm => {
            let enriched = { ...perm };
            if (perm.membership_level_id && !perm.app_name && levelRows.length) {
              const match = levelRows.find(
                r => r.membership_level_id === perm.membership_level_id
              );
              if (match) {
                enriched.app_name = match.app_name;
                enriched.app_id = match.app_id;
              }
            }
            if (
              enriched.app_id &&
              !appPermissions.find(p => p.app_id === enriched.app_id)
            ) {
              appPermissions.push(enriched);
            }
          });
        }
      } catch (e) {
        console.warn('解析app_permissions失败:', e);
      }
    }

    const { password, app_id, app_name, application_id, ...userInfo } = user;
    return res.json({
      success: true,
      user: {
        ...userInfo,
        app_permissions: appPermissions
      }
    });
  } catch (error) {
    console.error('获取当前用户信息失败：', error);
    return res.status(500).json({ success: false, message: '获取当前用户信息失败' });
  }
});

// 查询当前用户的 API Token（用于对外接口鉴权，如 /api/news-detail）
// Token 已在注册时生成、登录时若无则补生成，后续不自动更新。本接口用于查询或兼容历史无 token 用户
// 需已登录（请求头带 x-user-id）
router.get('/api-token', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录，请先登录后获取 API Token' });
    }
    const users = await db.query(
      'SELECT id, account, api_token, account_status FROM users WHERE id = ?',
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const user = users[0];
    if (user.account_status !== 'active') {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }
    let token = user.api_token;
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      await db.execute(
        'UPDATE users SET api_token = ?, api_token_updated_at = NOW() WHERE id = ?',
        [token, userId]
      );
    }
    return res.json({
      success: true,
      message: 'API Token 获取成功，请妥善保管。调用对外接口时在请求头添加：Authorization: Bearer <token> 或 X-Api-Token: <token>',
      token
    });
  } catch (error) {
    console.error('获取 API Token 失败：', error);
    return res.status(500).json({ success: false, message: '获取 API Token 失败' });
  }
});

// 重新生成 API Token（旧 token 立即失效）
router.post('/api-token/regenerate', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    const users = await db.query(
      'SELECT id, account_status FROM users WHERE id = ?',
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (users[0].account_status !== 'active') {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    await db.execute(
      'UPDATE users SET api_token = ?, api_token_updated_at = NOW() WHERE id = ?',
      [token, userId]
    );
    return res.json({
      success: true,
      message: 'API Token 已重新生成，旧 Token 已失效',
      token
    });
  } catch (error) {
    console.error('重新生成 API Token 失败：', error);
    return res.status(500).json({ success: false, message: '重新生成 API Token 失败' });
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

// 获取当前用户信息
router.get('/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    const users = await db.query(
      `SELECT u.id, u.account, u.phone, u.email, u.company_name,
              u.membership_level_id, ml.level_name AS main_membership_level,
              u.app_permissions, u.account_status
       FROM users u
       LEFT JOIN membership_levels ml ON u.membership_level_id = ml.id
       WHERE u.id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const user = users[0];

    // 解析应用会员配置，拼出「应用名称 + 会员等级名称」
    let appMemberships = [];
    if (user.app_permissions) {
      try {
        const parsed = JSON.parse(user.app_permissions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const levelIds = parsed
            .map(p => p.membership_level_id)
            .filter(Boolean);
          if (levelIds.length > 0) {
            const levelRows = await db.query(
              `SELECT ml.id AS membership_level_id, ml.level_name, a.id AS app_id, a.app_name
               FROM membership_levels ml
               JOIN applications a ON ml.app_id = a.id
               WHERE ml.id IN (${levelIds.map(() => '?').join(',')})`,
              levelIds
            );
            appMemberships = parsed.map(p => {
              const match = levelRows.find(r => r.membership_level_id === p.membership_level_id);
              return {
                app_id: match?.app_id || p.app_id,
                app_name: match?.app_name || p.app_id,
                level_name: match?.level_name || ''
              };
            });
          }
        }
      } catch (e) {
        console.warn('解析用户 app_permissions 失败：', e);
      }
    }

    res.json({
      success: true,
      data: {
        ...user,
        app_memberships: appMemberships
      }
    });
  } catch (error) {
    console.error('获取用户信息失败：', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

// 更新当前用户信息
router.put('/profile', [
  body('phone').matches(/^1[3-9]\d{9}$/).withMessage('手机号格式不正确'),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('邮箱格式不正确'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    const { phone, email } = req.body;

    // 检查手机号是否已被其他用户使用
    const existingUsers = await db.query(
      'SELECT id FROM users WHERE phone = ? AND id != ?',
      [phone, userId]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: '手机号已被使用' });
    }

    // 如果提供了邮箱，检查邮箱是否已被其他用户使用
    if (email) {
      const existingEmailUsers = await db.query(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, userId]
      );

      if (existingEmailUsers.length > 0) {
        return res.status(400).json({ success: false, message: '邮箱已被使用' });
      }
    }

    // 更新用户信息
    if (email) {
      await db.execute(
        'UPDATE users SET phone = ?, email = ? WHERE id = ?',
        [phone, email, userId]
      );
    } else {
      await db.execute(
        'UPDATE users SET phone = ? WHERE id = ?',
        [phone, userId]
      );
    }

    res.json({
      success: true,
      message: '个人信息更新成功'
    });
  } catch (error) {
    console.error('更新用户信息失败：', error);
    res.status(500).json({ success: false, message: '更新用户信息失败：' + error.message });
  }
});

// 修改密码
router.put('/change-password', [
  body('oldPassword').notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isLength({ min: 6 }).withMessage('新密码至少6位'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    const { oldPassword, newPassword } = req.body;

    // 获取用户信息
    const users = await db.query('SELECT id, password FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const user = users[0];

    // 验证旧密码
    const isValidPassword = await bcrypt.compare(oldPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ success: false, message: '旧密码错误' });
    }

    // 检查新旧密码是否相同
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ success: false, message: '新密码不能与旧密码相同' });
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码失败：', error);
    res.status(500).json({ success: false, message: '修改密码失败：' + error.message });
  }
});

// 管理员重置用户密码（仅admin可用）
router.put('/users/:id/reset-password', async (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'user';
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: '无权访问' });
    }

    const { id } = req.params;

    // 检查用户是否存在
    const users = await db.query('SELECT id, account FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    // 重置密码为 123456
    const defaultPassword = '123456';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 更新密码
    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, id]
    );

    res.json({
      success: true,
      message: '密码重置成功'
    });
  } catch (error) {
    console.error('重置密码失败：', error);
    res.status(500).json({ success: false, message: '重置密码失败：' + error.message });
  }
});

module.exports = router;

