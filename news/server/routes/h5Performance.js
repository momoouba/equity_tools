/**
 * H5 业绩看板只读：日期列表 / 版本列表 / 看板四板块聚合
 */
const express = require('express');
const db = require('../db');
const { getCurrentUser } = require('../middleware/auth');
const { fetchDashboardData } = require('./performance/dashboardQueries');
const { READY_STATUS_SQL } = require('../utils/performance/sqlLayers');

const router = express.Router();

const PERF_APP_NAMES = ['业绩看板应用', '业绩看板'];

function isAdminUser(user) {
  if (!user) return false;
  if (String(user.role || '').trim().toLowerCase() === 'admin') return true;
  return String(user.account || '').trim().toLowerCase() === 'admin';
}

/** 与 PC /api/performance/permissions 对齐：有会员等级即可查看 */
async function canViewPerformance(user) {
  if (!user) return false;
  if (isAdminUser(user)) return true;

  const appRows = await db.query(
    `SELECT F_Id AS id, app_name FROM applications
     WHERE BINARY app_name IN (?, ?)`,
    PERF_APP_NAMES
  );
  if (!appRows.length) return false;
  const appIds = new Set(appRows.map((r) => String(r.id)));

  const perms = Array.isArray(user.app_permissions) ? user.app_permissions : [];
  const hit = perms.find(
    (p) => p && appIds.has(String(p.app_id)) && p.membership_level_id
  );
  if (hit) return true;

  // 回退：主会员等级（与 PC 一致）
  return !!user.membership_level_id;
}

async function requireH5PerformanceAccess(req, res) {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ success: false, message: '未登录' });
    return null;
  }
  if (!(await canViewPerformance(user))) {
    res.status(403).json({ success: false, message: '无业绩看板查看权限' });
    return null;
  }
  return user;
}

router.use(getCurrentUser);

/**
 * GET /api/h5/performance/dates
 */
router.get('/performance/dates', async (req, res) => {
  try {
    if (!(await requireH5PerformanceAccess(req, res))) return;

    const rows = await db.query(
      `SELECT DISTINCT DATE(b_date) AS date
       FROM b_version
       WHERE F_DeleteMark = 0 AND ${READY_STATUS_SQL}
       ORDER BY date DESC`
    );

    const dates = rows.map((row) => {
      const d = new Date(row.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    return res.json({ success: true, data: { dates } });
  } catch (e) {
    console.error('[h5] performance/dates', e);
    return res.status(500).json({ success: false, message: e.message || '获取日期失败' });
  }
});

/**
 * GET /api/h5/performance/versions?date=YYYY-MM-DD
 */
router.get('/performance/versions', async (req, res) => {
  try {
    if (!(await requireH5PerformanceAccess(req, res))) return;

    const date = String(req.query.date || '').trim();
    if (!date) {
      return res.status(400).json({ success: false, message: '日期参数不能为空' });
    }

    const rows = await db.query(
      `SELECT version, b_date, F_CreatorTime, F_Lock, status
       FROM b_version
       WHERE F_DeleteMark = 0
         AND ${READY_STATUS_SQL}
         AND DATE(b_date) = ?
       ORDER BY CAST(SUBSTRING_INDEX(version, 'V', -1) AS UNSIGNED) DESC`,
      [date]
    );

    const versions = rows.map((row) => ({
      version: row.version,
      bDate: row.b_date
        ? String(row.b_date).slice(0, 10)
        : null,
      createTime: row.F_CreatorTime
        ? String(row.F_CreatorTime).replace('T', ' ').slice(0, 19)
        : null,
      isLocked: row.F_Lock === 1,
    }));

    return res.json({ success: true, data: { versions } });
  } catch (e) {
    console.error('[h5] performance/versions', e);
    return res.status(500).json({ success: false, message: e.message || '获取版本失败' });
  }
});

/**
 * GET /api/h5/performance/board?version=xxx
 * 四板块聚合；H5 去掉管理人基金清单与组合分基金明细以减小包体
 */
router.get('/performance/board', async (req, res) => {
  try {
    if (!(await requireH5PerformanceAccess(req, res))) return;

    const version = String(req.query.version || '').trim();
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }

    const exists = await db.query(
      `SELECT version FROM b_version
       WHERE version = ? AND F_DeleteMark = 0 AND ${READY_STATUS_SQL}
       LIMIT 1`,
      [version]
    );
    if (!exists.length) {
      return res.status(404).json({ success: false, message: '版本不存在或未就绪' });
    }

    const board = await fetchDashboardData(version);
    // 精简：不返回管理人在管清单、组合分基金行（H5 只展示汇总指标）
    if (board.manager) {
      delete board.manager.fundsList;
    }
    if (board.portfolio) {
      board.portfolio = {
        overall: board.portfolio.overall || null,
      };
    }

    return res.json({
      success: true,
      data: {
        version,
        manager: board.manager,
        funds: board.funds,
        portfolio: board.portfolio,
        underlying: board.underlying,
      },
    });
  } catch (e) {
    console.error('[h5] performance/board', e);
    return res.status(500).json({ success: false, message: e.message || '获取看板失败' });
  }
});

module.exports = router;
