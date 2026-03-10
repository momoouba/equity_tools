/**
 * 业绩看板应用 - 主路由入口
 * 挂载路径: /api/performance
 */
const express = require('express');
const router = express.Router();

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

module.exports = router;
