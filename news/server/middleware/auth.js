const db = require('../db');

// 简单的认证中间件：从请求头获取用户ID，并加载完整用户信息
async function getCurrentUser(req, res, next) {
  try {
    const userIdHeader = req.headers['x-user-id'];
    const userId = userIdHeader ? String(userIdHeader).trim() : null;

    // 保存原始ID（字符串）和数值ID，兼容旧逻辑
    req.currentUserId = userId ? userId : null;
    req.currentUser = null;

    if (!userId) {
      return next();
    }

    const users = await db.query(
      `SELECT id, account, role, membership_level_id, app_permissions
       FROM users
       WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (users && users.length > 0) {
      const user = users[0];
      let appPermissions = [];
      if (user.app_permissions) {
        try {
          appPermissions = JSON.parse(user.app_permissions);
        } catch (e) {
          appPermissions = [];
        }
      }

      req.currentUser = {
        id: user.id,
        account: user.account,
        role: user.role || 'user',
        membership_level_id: user.membership_level_id || null,
        app_permissions: appPermissions
      };
    }

    next();
  } catch (error) {
    console.error('getCurrentUser 中间件加载用户信息失败:', error);
    // 出错时仍然继续请求，但不设置 currentUser
    next();
  }
}

module.exports = { getCurrentUser };

