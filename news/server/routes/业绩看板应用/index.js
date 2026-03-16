/**
 * 业绩看板应用 - 主路由入口
 * 挂载路径: /api/performance
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { getCurrentUser } = require('../../middleware/auth');

// 引入子路由
const versionRoutes = require('./version');
const dashboardRoutes = require('./dashboard');
const exportRoutes = require('./export');
const configRoutes = require('./config');
const shareRoutes = require('./share');
const scheduledRoutes = require('./scheduled');

// 注册子路由
router.use('/versions', versionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/exports', exportRoutes);
router.use('/config', configRoutes);
router.use('/share', shareRoutes);
router.use('/scheduled-tasks', scheduledRoutes);

// 获取当前用户在“业绩看板应用”中的会员权限
router.get('/permissions', getCurrentUser, async (req, res) => {
  try {
    const user = req.currentUser;
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    // admin 账号拥有全部权限
    if (user.role === 'admin') {
      return res.json({
        success: true,
        data: {
          levelName: '管理员',
          canView: true,
          canConfig: true,
          canOpenModal: true,
          canExport: true
        }
      });
    }

    // 通过应用名找到业绩看板应用的 app_id
    const appRows = await db.query(
      `SELECT id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
      ['业绩看板应用']
    );
    if (!appRows || appRows.length === 0) {
      return res.json({
        success: true,
        data: {
          levelName: null,
          canView: false,
          canConfig: false,
          canOpenModal: false,
          canExport: false
        }
      });
    }
    const performanceAppId = appRows[0].id;

    // 1）优先从用户的应用会员配置(app_permissions)中查找业绩看板的等级
    let levelName = null;
    let levelId = null;
    if (user.app_permissions && Array.isArray(user.app_permissions)) {
      const perfPerm = user.app_permissions.find(p => p.app_id === performanceAppId);
      if (perfPerm && perfPerm.membership_level_id) {
        const rows = await db.query(
          `SELECT level_name FROM membership_levels WHERE id = ? LIMIT 1`,
          [perfPerm.membership_level_id]
        );
        if (rows && rows.length > 0) {
          levelName = rows[0].level_name;
          levelId = perfPerm.membership_level_id;
        }
      }
    }

    // 2）如果没有单独配置应用会员等级，则回退到主会员等级（membership_level_id）
    if (!levelName) {
      if (user.membership_level_id) {
        const rows = await db.query(
          `SELECT level_name FROM membership_levels WHERE id = ? LIMIT 1`,
          [user.membership_level_id]
        );
        if (rows && rows.length > 0) {
          levelName = rows[0].level_name;
          levelId = user.membership_level_id;
        }
      }
    }

    // 未配置任何等级：不开放业绩看板权限
    if (!levelName) {
      return res.json({
        success: true,
        data: {
          levelName: null,
          canView: false,
          canConfig: false,
          canOpenModal: false,
          canExport: false
        }
      });
    }

    // 根据会员等级名称定义权限矩阵
    let canView = true;
    let canConfig = true;
    let canOpenModal = false;
    let canExport = false;

    if (levelName === '普通会员') {
      // 普通会员：看看板、配置看板，不能弹窗、不能导出
      canOpenModal = false;
      canExport = false;
    } else if (levelName === '高级会员') {
      // 高级会员：看看板、配置看板、可弹窗，不能导出
      canOpenModal = true;
      canExport = false;
    } else if (levelName === 'VIP会员') {
      // VIP会员：看看板、可弹窗、可导出
      canOpenModal = true;
      canExport = true;
    } else {
      // 其他未知等级：只允许查看，不允许配置/弹窗/导出
      canConfig = false;
      canOpenModal = false;
      canExport = false;
    }

    res.json({
      success: true,
      data: {
        levelId,
        levelName,
        canView,
        canConfig,
        canOpenModal,
        canExport
      }
    });
  } catch (error) {
    console.error('[业绩看板] 获取权限失败：', error);
    res.status(500).json({ success: false, message: '获取权限失败' });
  }
});

module.exports = router;
