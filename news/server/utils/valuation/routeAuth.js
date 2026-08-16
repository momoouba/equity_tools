const db = require('../../db');
const { checkProjectValuationPermission } = require('./permission');

async function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'] || null;
  if (!userId) return null;
  const rows = await db.query('SELECT F_Id AS id, account, role FROM users WHERE F_Id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0] : null;
}

function isAdminUser(user) {
  if (!user) return false;
  if (String(user.role || '').trim().toLowerCase() === 'admin') return true;
  return String(user.account || '').trim().toLowerCase() === 'admin';
}

async function requireProjectValuationAccess(req, res, next) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (isAdminUser(user)) {
      req.valUser = user;
      return next();
    }
    if (await checkProjectValuationPermission(user.id)) {
      req.valUser = user;
      return next();
    }
    return res.status(403).json({ success: false, message: '无项目估值访问权限' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || '权限校验失败' });
  }
}

function ownerFilterSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `${p}F_CreatorUserId = ?`;
}

module.exports = {
  getUserFromHeader,
  isAdminUser,
  requireProjectValuationAccess,
  ownerFilterSql,
};
