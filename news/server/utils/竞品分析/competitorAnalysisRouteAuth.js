const db = require('../../db');
const { checkCompetitorAnalysisPermission } = require('./competitorAnalysisPermission');
const { checkProjectSourcingPermission } = require('../项目挖掘/projectSourcingPermission');

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

async function requireCompetitorAnalysisAccess(req, res, next) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (isAdminUser(user)) {
      req.caUser = user;
      req.psUser = user;
      return next();
    }
    if (await checkCompetitorAnalysisPermission(user.id)) {
      req.caUser = user;
      req.psUser = user;
      return next();
    }
    return res.status(403).json({ success: false, message: '无竞品分析访问权限' });
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
      return res.status(403).json({ success: false, message: '仅管理员可执行此操作' });
    }
    req.caUser = user;
    req.psUser = user;
    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || '权限校验失败' });
  }
}

/** 竞品流水线是否可读融资事件池：三源配置开启且用户具备项目挖掘权限 */
async function canReadFinancingPoolForUser(userId) {
  if (!userId) return false;
  const { getCompetitorRecallSourceFlags } = require('./competitorRecallSourceConfig');
  const flags = await getCompetitorRecallSourceFlags();
  if (!flags.enable_financing_event) return false;
  if (await checkProjectSourcingPermission(userId)) return true;
  const user = await db.query('SELECT role, account FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!user.length) return false;
  const u = user[0];
  if (String(u.role || '').trim().toLowerCase() === 'admin') return true;
  return String(u.account || '').trim().toLowerCase() === 'admin';
}

module.exports = {
  getUserFromHeader,
  requireCompetitorAnalysisAccess,
  requireAdmin,
  isAdminUser,
  canReadFinancingPoolForUser,
};
