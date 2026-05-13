const db = require('../../db');
const {
  enqueueManualInvestedEnterpriseAiEnrich,
  enqueueBatchInvestedEnterpriseAiEnrich,
} = require('../../utils/项目挖掘/investedEnterpriseAiEnrichService');
const { requireAdmin } = require('../../utils/项目挖掘/projectSourcingRouteAuth');

function clientIpFromReq(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf && typeof xf === 'string') {
    const first = xf.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  if (req.ip) return String(req.ip).slice(0, 64);
  return null;
}

function registerInvestedEnterpriseAiRoutes(router) {
  router.get('/invested-enterprises/ai-enrich-logs', requireAdmin, async (req, res) => {
    try {
      const ieId = String(req.query.invested_enterprise_id || '').trim();
      if (!ieId) {
        return res.status(400).json({ success: false, message: '缺少 invested_enterprise_id' });
      }
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 30));
      const offset = (page - 1) * pageSize;

      const countRows = await db.query(
        `SELECT COUNT(*) AS total FROM invested_enterprise_ai_enrich_log WHERE invested_enterprise_id = ?`,
        [ieId]
      );
      const total = Number(countRows[0].total || 0);

      const list = await db.query(
        `SELECT id, invested_enterprise_id, trigger_type, execution_status, triggered_at, started_at, finished_at,
                duration_ms, error_message, result_product_intro, result_industry_tags_display, job_trace_id
         FROM invested_enterprise_ai_enrich_log
         WHERE invested_enterprise_id = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [ieId, pageSize, offset]
      );

      const rows = list.map((r) => ({
        ...r,
        id: r.id != null ? String(r.id) : r.id,
        invested_enterprise_id: r.invested_enterprise_id != null ? String(r.invested_enterprise_id) : r.invested_enterprise_id,
      }));

      res.json({
        success: true,
        data: { list: rows, total, page, pageSize },
      });
    } catch (e) {
      console.error('[project-sourcing/invested-enterprises/ai-enrich-logs]', e);
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.post('/invested-enterprises/batch-ai-enrich', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const only_failed =
        body.only_failed === true ||
        body.only_failed === 1 ||
        String(body.only_failed || '').toLowerCase() === 'true';
      const userId = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueBatchInvestedEnterpriseAiEnrich({
        dateFrom: body.start_date,
        dateTo: body.end_date,
        onlyFailed: only_failed,
        triggeredByUserId: userId,
        clientIp: clientIpFromReq(req),
      });
      if (!r.ok) {
        return res.status(r.code).json({ success: false, message: r.message });
      }
      const d = r.data;
      const detail =
        d.only_failed && d.total_in_range != null && d.queued_jobs != null
          ? `创建日期区间内 AI 为 failed 的共 ${d.total_in_range} 条，去重后 ${d.queued_jobs} 次任务`
          : d.total_in_range != null && d.queued_jobs != null
            ? `创建日期区间内共 ${d.total_in_range} 条，去重后 ${d.queued_jobs} 次任务`
            : `已排队 ${d.total || 0} 条`;
      return res.status(202).json({
        success: true,
        message: `${detail}；并发 ${d.concurrency ?? ''}，波次间隔约 ${d.gap_ms}ms，请稍后刷新列表`,
        data: r.data,
      });
    } catch (e) {
      console.error('[project-sourcing/invested-enterprises/batch-ai-enrich]', e);
      res.status(500).json({ success: false, message: e.message || '受理失败' });
    }
  });

  router.post('/invested-enterprises/:id/ai-enrich', requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const userId = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueManualInvestedEnterpriseAiEnrich({
        enterpriseId: id,
        triggeredByUserId: userId,
        clientIp: clientIpFromReq(req),
      });
      if (!r.ok) {
        return res.status(r.code).json({ success: false, message: r.message });
      }
      return res.status(202).json({
        success: true,
        message: '已受理 AI 取数任务，请稍后刷新列表查看结果',
        data: r.data,
      });
    } catch (e) {
      console.error('[project-sourcing/invested-enterprises/ai-enrich]', e);
      res.status(500).json({ success: false, message: e.message || '受理失败' });
    }
  });
}

module.exports = { registerInvestedEnterpriseAiRoutes };
