/**
 * 投后竞品分析 — 定时任务 CRUD / 立即执行 / 企业列表 / 执行日志
 */
const {
  EXIT_STATUS_OPTIONS,
  DEFAULT_EMAIL_BODY,
  listScheduleTasks,
  getScheduleTask,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  listEnterprisesByProjectStatus,
  listScheduleRuns,
  runScheduleTask,
} = require('../../utils/scheduledCompetitorAnalysisTasks');
const { requireCompetitorAnalysisAccess } = require('../../utils/competitor-analysis/competitorAnalysisRouteAuth');

function registerCompetitorScheduleRoutes(router) {
  router.get('/competitor-schedule/status-options', requireCompetitorAnalysisAccess, async (_req, res) => {
    res.json({
      success: true,
      data: { options: EXIT_STATUS_OPTIONS, default_email_body: DEFAULT_EMAIL_BODY },
    });
  });

  router.get('/competitor-schedule/tasks', requireCompetitorAnalysisAccess, async (_req, res) => {
    try {
      const list = await listScheduleTasks();
      res.json({ success: true, data: { list } });
    } catch (e) {
      console.error('[competitor-schedule/tasks GET]', e);
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.get('/competitor-schedule/tasks/:id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const task = await getScheduleTask(req.params.id);
      if (!task) return res.status(404).json({ success: false, message: '任务不存在' });
      res.json({ success: true, data: task });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.post('/competitor-schedule/tasks', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const task = await createScheduleTask(req.body || {}, req.psUser?.id || null);
      res.status(201).json({ success: true, message: '已创建', data: task });
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code).json({ success: false, message: e.message || '创建失败' });
    }
  });

  router.put('/competitor-schedule/tasks/:id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const task = await updateScheduleTask(req.params.id, req.body || {}, req.psUser?.id || null);
      res.json({ success: true, message: '已保存', data: task });
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code).json({ success: false, message: e.message || '保存失败' });
    }
  });

  router.delete('/competitor-schedule/tasks/:id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const ok = await deleteScheduleTask(req.params.id);
      if (!ok) return res.status(404).json({ success: false, message: '任务不存在' });
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '删除失败' });
    }
  });

  router.get('/competitor-schedule/enterprises', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const status = String(req.query.project_status || req.query.status || '').trim();
      if (!status) {
        return res.status(400).json({ success: false, message: '请提供 project_status' });
      }
      const list = await listEnterprisesByProjectStatus(status, req.query.search || '');
      res.json({ success: true, data: { list } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.get('/competitor-schedule/tasks/:id/runs', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const list = await listScheduleRuns(req.params.id, { limit: req.query.limit });
      res.json({ success: true, data: { list } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.post('/competitor-schedule/tasks/:id/run', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const task = await getScheduleTask(req.params.id);
      if (!task) return res.status(404).json({ success: false, message: '任务不存在' });
      // 异步执行，立即返回，避免 HTTP 超时
      setImmediate(() => {
        runScheduleTask(req.params.id, {
          triggerType: 'manual',
          userId: req.psUser?.id || null,
        }).catch((err) => {
          console.error('[competitor-schedule/run]', err);
        });
      });
      res.status(202).json({
        success: true,
        message: '已开始执行，完成后将发送邮件；可在执行日志中查看进度',
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message || '触发失败' });
    }
  });
}

module.exports = { registerCompetitorScheduleRoutes };
