const db = require('../../db');
const {
  enqueueManualInvestedEnterpriseAiEnrich,
  enqueueBatchInvestedEnterpriseAiEnrich,
} = require('../../utils/competitor-analysis/investedEnterpriseAiEnrichService');
const {
  syncInvestedEnterpriseQccCompanyBrief,
  batchSyncInvestedEnterpriseQccCompanyBrief,
} = require('../../utils/competitor-analysis/investedEnterpriseQccBriefService');
const { requireAdmin } = require('../../utils/competitor-analysis/competitorAnalysisRouteAuth');
const { clientIpFromReq } = require('../../utils/competitor-analysis/competitorRouteUtils');

function registerInvestedEnterpriseAiRoutes(router) {
  router.get('/invested-enterprises/ai-enrich-logs', requireAdmin, async (req, res) => {
    try {
      const rawIds = String(req.query.invested_enterprise_id || '').trim();
      if (!rawIds) {
        return res.status(400).json({ success: false, message: '缺少 invested_enterprise_id' });
      }
      const ieIds = rawIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (!ieIds.length) {
        return res.status(400).json({ success: false, message: '缺少 invested_enterprise_id' });
      }
      const placeholders = ieIds.map(() => '?').join(',');
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 30));
      const offset = (page - 1) * pageSize;

      const countRows = await db.query(
        `SELECT COUNT(*) AS total FROM invested_enterprise_ai_enrich_log WHERE invested_enterprise_id IN (${placeholders})`,
        ieIds
      );
      const total = Number(countRows[0].total || 0);

      const list = await db.query(
        `SELECT F_Id AS id, invested_enterprise_id, trigger_type, execution_status, triggered_at, started_at, finished_at,
                duration_ms, error_message, result_product_intro, result_industry_tags_display, job_trace_id,
                invoke_mode, used_enable_search, search_degraded,
                used_enable_thinking, thinking_degraded
         FROM invested_enterprise_ai_enrich_log
         WHERE invested_enterprise_id IN (${placeholders})
         ORDER BY triggered_at DESC, F_Id DESC
         LIMIT ? OFFSET ?`,
        [...ieIds, pageSize, offset]
      );

      const { attachSearchStatusLabel } = require('../../utils/project-sourcing/financingAiEnrichSearchMeta');
      const rows = attachSearchStatusLabel(
        list.map((r) => ({
          ...r,
          id: r.id != null ? String(r.id) : r.id,
          invested_enterprise_id:
            r.invested_enterprise_id != null ? String(r.invested_enterprise_id) : r.invested_enterprise_id,
        }))
      );

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

  /** 管理员：批量企查查企业简介（须注册在 :id 路由之前，避免被误匹配） */
  router.post('/invested-enterprises/batch-qcc-company-brief', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const raw = body.enterprise_ids ?? body.ids ?? [];
      const ids = Array.isArray(raw) ? raw : [];
      const r = await batchSyncInvestedEnterpriseQccCompanyBrief(ids, {
        gapMs: body.gap_ms != null ? Number(body.gap_ms) : undefined,
      });
      if (!r.ok) {
        return res.status(r.code).json({ success: false, message: r.message });
      }
      const d = r.data;
      res.json({
        success: true,
        message: `企查查批量同步完成：成功 ${d.success} 条，失败 ${d.failed} 条`,
        data: d,
      });
    } catch (e) {
      console.error('[project-sourcing/invested-enterprises/batch-qcc-company-brief]', e);
      res.status(500).json({ success: false, message: e.message || '批量同步失败' });
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

  /** 管理员：单条企查查企业简介写库（同步 HTTP，可能数秒～二十秒） */
  router.post('/invested-enterprises/:id/qcc-company-brief', requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const r = await syncInvestedEnterpriseQccCompanyBrief(id);
      res.json({
        success: true,
        message:
          r.desc_len > 0
            ? `已写入企查查企业简介，共 ${r.desc_len} 字`
            : '企查查返回无简介正文（可能无结果或 VerifyResult=0），已清空本地简介字段',
        data: r,
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/invested-enterprises/qcc-company-brief]', e);
      res.status(code).json({ success: false, message: e.message || '同步失败' });
    }
  });
  /** 管理员：单条被投企业百科查词 */
  router.post('/invested-enterprises/:id/baike-lookup', requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const rows = await db.query(
        `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, qcc_company_intro
         FROM invested_enterprises WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
        [id]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: '被投企业不存在' });
      }
      const row = rows[0];
      const name = String(row.enterprise_full_name || '').trim();
      if (name.length < 2) {
        return res.status(400).json({ success: false, message: '企业名称过短，无法查词' });
      }
      const { fetchBaike } = require('../../utils/project-sourcing/baikeLookupService');
      console.log(`[competitor-analysis/invested-enterprises/baike-lookup] start id=${id} name="${name}"`);
      const baike = fetchBaike(name, 1500);
      const intro = baike && baike.has_lemma ? baike.company_intro || baike.product_intro : null;
      await db.execute(
        `UPDATE invested_enterprises SET qcc_company_intro = COALESCE(?, qcc_company_intro), F_LastModifyTime = NOW()
         WHERE F_Id = ?`,
        [intro, id]
      );
      console.log(
        `[competitor-analysis/invested-enterprises/baike-lookup] done id=${id} has_lemma=${!!baike?.has_lemma} intro_len=${intro ? intro.length : 0}`
      );
      res.json({
        success: true,
        message: intro ? `百科查词完成，已写入简介（${intro.length} 字）` : '百科未命中',
        data: { has_lemma: baike?.has_lemma || false, lemma_status: baike?.lemma_status || 'not_found' },
      });
    } catch (e) {
      console.error('[competitor-analysis/invested-enterprises/baike-lookup]', e);
      res.status(500).json({ success: false, message: e.message || '百科查词失败' });
    }
  });

  /** 管理员：批量被投企业百科查词（后台任务；支持 ids 或 start_date/end_date） */
  router.post('/invested-enterprises/batch-baike-lookup', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const {
        enqueueInvestedEnterpriseBatchBaikeLookup,
      } = require('../../utils/project-sourcing/baikeBatchJobService');
      const r = await enqueueInvestedEnterpriseBatchBaikeLookup({
        ids: body.ids,
        dateFrom: body.start_date,
        dateTo: body.end_date,
        sleepMs: 800,
      });
      if (!r.ok) {
        return res.status(r.code || 500).json({ success: false, message: r.message });
      }
      return res.status(r.code || 200).json({
        success: true,
        message: r.message,
        data: r.data,
      });
    } catch (e) {
      console.error('[competitor-analysis/invested-enterprises/batch-baike-lookup]', e);
      res.status(500).json({ success: false, message: e.message || '批量百科查词失败' });
    }
  });
}

module.exports = { registerInvestedEnterpriseAiRoutes };
