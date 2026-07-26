/**
 * 竞品迁移定时任务配置路由
 * GET  /competitor-migration/config  — 获取配置
 * PUT  /competitor-migration/config  — 更新 cron / 开关
 * POST /competitor-migration/run     — 手动触发一次迁移
 */
const {
  getMigrationConfig,
  updateMigrationCronConfig,
  runCompetitorMigration,
} = require('../../utils/scheduledCompetitorMigrationTasks');
const { requireAdmin } = require('../../utils/competitor-analysis/competitorAnalysisRouteAuth');

function registerCompetitorMigrationRoutes(router) {
  // 获取迁移配置
  router.get('/competitor-migration/config', requireAdmin, async (req, res) => {
    try {
      const config = await getMigrationConfig();
      res.json({ success: true, data: config });
    } catch (err) {
      console.error('[competitor-migration/config] GET 失败:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 更新迁移配置（cron 表达式 / 启用状态）
  router.put('/competitor-migration/config', requireAdmin, async (req, res) => {
    try {
      const { cron_expression, active } = req.body;
      if (cron_expression === undefined && active === undefined) {
        return res.status(400).json({ success: false, message: '请提供 cron_expression 或 active' });
      }
      await updateMigrationCronConfig({
        cronExpression: cron_expression,
        active,
      });
      const config = await getMigrationConfig();
      res.json({ success: true, message: '配置已更新', data: config });
    } catch (err) {
      console.error('[competitor-migration/config] PUT 失败:', err);
      res.status(400).json({ success: false, message: err.message });
    }
  });

  // 手动触发一次迁移
  router.post('/competitor-migration/run', requireAdmin, async (req, res) => {
    try {
      const stats = await runCompetitorMigration();
      res.json({
        success: true,
        message: `迁移完成：匹配 ${stats.matched}，同步 ${stats.synced}，跳过 ${stats.skipped}`,
        data: stats,
      });
    } catch (err) {
      console.error('[competitor-migration/run] POST 失败:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });
}

module.exports = { registerCompetitorMigrationRoutes };
