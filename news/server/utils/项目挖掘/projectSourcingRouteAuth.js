const db = require('../../db');
const { checkProjectSourcingPermission } = require('./projectSourcingPermission');

async function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'] || null;
  if (!userId) return null;
  const rows = await db.query('SELECT id, account, role FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0] : null;
}

function isAdminUser(user) {
  if (!user) return false;
  if (String(user.role || '').trim().toLowerCase() === 'admin') return true;
  return String(user.account || '').trim().toLowerCase() === 'admin';
}

async function requireProjectSourcingAccess(req, res, next) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (isAdminUser(user)) {
      req.psUser = user;
      return next();
    }
    if (await checkProjectSourcingPermission(user.id)) {
      req.psUser = user;
      return next();
    }
    return res.status(403).json({ success: false, message: '无项目挖掘访问权限' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || '权限校验失败' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, message: '仅管理员可执行同步' });
    }
    req.psUser = user;
    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || '权限校验失败' });
  }
}

module.exports = {
  getUserFromHeader,
  requireProjectSourcingAccess,
  requireAdmin,
  isAdminUser,
};
