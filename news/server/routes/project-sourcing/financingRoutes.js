const db = require('../../db');
const { syncFinancingDateRange } = require('../../utils/project-sourcing/financingIngestService');
const {
  enqueueManualFinancingAiEnrich,
  enqueueBatchFinancingAiEnrichByDateRange,
} = require('../../utils/project-sourcing/financingAiEnrichService');
const {
  requireProjectSourcingAccess,
  requireAdmin,
} = require('../../utils/project-sourcing/projectSourcingRouteAuth');

/** 脱敏错误消息：避免向前端泄露 SQL、连接字符串等内部信息 */
function safeErrorMessage(err, fallback = '操作失败') {
  const msg = String(err?.message || err || '');
  if (/ER_|SQLSTATE|ECONNREFUSED|ENOTFOUND|mysql|syntax|Duplicate entry|Deadlock/i.test(msg)) return fallback;
  if (/\/[\w.]+|\\[\w.]+/.test(msg) && msg.length > 120) return fallback;
  return msg.slice(0, 200) || fallback;
}

// fix #14: 复用共享工具函数，移除本地重复定义
const { clientIpFromReq } = require('../../utils/competitor-analysis/competitorRouteUtils');

function registerFinancingRoutes(router) {
  router.post('/sync', requireAdmin, async (req, res) => {
    try {
      const { config_id, start_date, end_date } = req.body || {};
      if (!config_id || !start_date || !end_date) {
        return res.status(400).json({
          success: false,
          message: '缺少参数：config_id、start_date、end_date（yyyy-MM-dd）',
        });
      }
      const result = await syncFinancingDateRange(
        String(config_id),
        {
          startDate: String(start_date).slice(0, 10),
          endDate: String(end_date).slice(0, 10),
        },
        {
          executionType: 'manual',
          userId: req.psUser && req.psUser.id ? String(req.psUser.id) : null,
        }
      );
      res.json(result);
    } catch (e) {
      console.error('[project-sourcing/sync]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '同步失败' });
    }
  });

  router.get('/events', requireProjectSourcingAccess, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
      const offset = (page - 1) * pageSize;
      let keyword = req.query.keyword ? String(req.query.keyword).trim() : '';
      if (keyword.length > 200) {
        keyword = keyword.slice(0, 200);
      }
      const dateFrom = req.query.date_from ? String(req.query.date_from).slice(0, 10) : '';
      const dateTo = req.query.date_to ? String(req.query.date_to).slice(0, 10) : '';

      const where = ['F_DeleteMark = 0'];
      const params = [];
      if (keyword) {
        const k = `%${keyword}%`;
        const textCols = [
          'company_name',
          'project_name',
          'project_desc',
          'company_credit_code',
          'latest_round',
          'round',
          'funding_amt_raw',
          'estimated_amt_raw',
          'post_valuation_raw',
          'industry_source_lv1',
          'industry_source_lv2',
          'track_primary',
          'track_secondary',
          'track_keywords',
          'investor_names',
          'lead_investor',
          'funding_status',
          'event_id',
          'ai_product_intro',
          'ai_company_tags_display',
        ];
        const parts = textCols.map((c) => `COALESCE(${c},'') LIKE ?`);
        parts.push(`COALESCE(DATE_FORMAT(event_date, '%Y-%m-%d'),'') LIKE ?`);
        where.push(`(${parts.join(' OR ')})`);
        for (let i = 0; i < textCols.length; i++) {
          params.push(k);
        }
        params.push(k);
      }
      if (dateFrom) {
        where.push('event_date >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        where.push('event_date <= ?');
        params.push(dateTo);
      }

      const sqlWhere = `WHERE ${where.join(' AND ')}`;
      const countRows = await db.query(`SELECT COUNT(*) AS total FROM sourcing_financing_event ${sqlWhere}`, params);
      const total = Number(countRows[0].total || 0);

      const rows = await db.query(
        `SELECT F_Id AS id, source_record_id, event_id, event_date, company_name, company_credit_code,
                project_name, project_desc, latest_round, round,
                funding_amt_raw, estimated_amt_raw, post_valuation_raw,
                industry_source_lv1, industry_source_lv2,
                track_primary, track_secondary, track_keywords,
                investor_names, lead_investor, funding_status,
                classification_status,
                ai_product_intro, ai_company_tags_display, ai_company_tags_json,
                ai_enrich_status, ai_enrich_at, ai_enrich_model, ai_enrich_version, ai_enrich_error,
                F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
         FROM sourcing_financing_event
         ${sqlWhere}
         ORDER BY event_date DESC, F_Id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      const list = rows.map((r) => ({
        ...r,
        id: r.id != null ? String(r.id) : r.id,
        source_record_id: r.source_record_id != null ? String(r.source_record_id) : r.source_record_id,
      }));

      res.json({
        success: true,
        data: { list, total, page, pageSize },
      });
    } catch (e) {
      console.error('[project-sourcing/events]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '查询失败' });
    }
  });

  /** 管理员：融资事件的 AI 增强执行日志（支持单个或多个 financing_event_id，逗号分隔；按 triggered_at 降序） */
  router.get('/ai-enrich-logs', requireAdmin, async (req, res) => {
    try {
      const rawIds = String(req.query.financing_event_id || '').trim();
      if (!rawIds) {
        return res.status(400).json({ success: false, message: '缺少 financing_event_id' });
      }
      const feIds = rawIds
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!feIds.length) {
        return res.status(400).json({ success: false, message: '无效的 financing_event_id' });
      }
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
      const offset = (page - 1) * pageSize;

      const placeholders = feIds.map(() => '?').join(',');
      const countRows = await db.query(
        `SELECT COUNT(*) AS total FROM sourcing_financing_ai_enrich_log WHERE financing_event_id IN (${placeholders})`,
        feIds
      );
      const total = Number(countRows[0].total || 0);

      const list = await db.query(
        `SELECT F_Id AS id, financing_event_id, trigger_type, execution_status, triggered_at, started_at, finished_at,
                duration_ms, error_message, result_product_intro, result_company_tags_display, job_trace_id,
                invoke_mode, used_enable_search, search_degraded,
                used_enable_thinking, thinking_degraded
         FROM sourcing_financing_ai_enrich_log
         WHERE financing_event_id IN (${placeholders})
         ORDER BY triggered_at DESC, F_Id DESC
         LIMIT ? OFFSET ?`,
        [...feIds, pageSize, offset]
      );

      const { attachSearchStatusLabel } = require('../../utils/project-sourcing/financingAiEnrichSearchMeta');
      const rows = attachSearchStatusLabel(
        list.map((r) => ({
          ...r,
          id: r.id != null ? String(r.id) : r.id,
          financing_event_id:
            r.financing_event_id != null ? String(r.financing_event_id) : r.financing_event_id,
        }))
      );

      res.json({
        success: true,
        data: { list: rows, total, page, pageSize },
      });
    } catch (e) {
      console.error('[project-sourcing/ai-enrich-logs]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '查询失败' });
    }
  });

  /** 管理员：按融资日期区间批量 AI 取数（去重后条数多则百炼 Batch File，否则并发 chat）；only_failed 时仅重试 ai_enrich_status=failed */
  router.post('/batch-ai-enrich', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const { start_date, end_date } = body;
      const only_failed =
        body.only_failed === true ||
        body.only_failed === 1 ||
        String(body.only_failed || '').toLowerCase() === 'true';
      const userId = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueBatchFinancingAiEnrichByDateRange({
        dateFrom: start_date,
        dateTo: end_date,
        triggeredByUserId: userId,
        clientIp: clientIpFromReq(req),
        onlyFailed: only_failed,
      });
      if (!r.ok) {
        return res.status(r.code).json({ success: false, message: r.message });
      }
      const d = r.data;
      let detail = '';
      let suffix = '';
      if (d.total_in_range != null && d.queued_jobs != null) {
        if (d.only_failed) {
          detail = `区间内 AI 状态为 failed 的融资记录共 ${d.total_in_range} 条，去重后 ${d.queued_jobs} 次重试任务；同一信用代码下全部融资事件将同步更新简介与标签`;
        } else {
          detail = `区间内共 ${d.total_in_range} 条融资记录，去重后 ${d.queued_jobs} 次 AI；同一信用代码下全部融资事件将同步更新简介与标签`;
        }
      } else {
        detail = `已加入队列 ${d.total} 条`;
      }
      if (d.mode === 'dashscope_batch_file') {
        if (d.batch_file_phase === 'noop') {
          suffix =
            `。去重后超过 ${d.batch_file_threshold ?? 100} 条走 Batch 路径，但本次无需提交百炼任务（均已复用库内 AI 或准备阶段跳过）；无 dashscope_batch_id`;
        } else if (d.dashscope_batch_id) {
          suffix = `。已向百炼创建异步 Batch（dashscope_batch_id=${d.dashscope_batch_id}，本次提交模型任务 ${d.llm_jobs_submitted ?? ''} 条）；结果在服务端后台轮询写库，请勿重复点击`;
        } else {
          suffix = `。去重后超过 ${d.batch_file_threshold ?? 100} 条，百炼 Batch File 处理中，请勿重复点击`;
        }
      } else if (d.mode === 'concurrent_chat') {
        suffix = `。并发度 ${d.concurrency ?? ''}，波次间隔约 ${d.gap_ms}ms，请稍后刷新列表`;
      } else {
        suffix = `。将按顺序执行（条目间隔约 ${d.gap_ms}ms），请稍后刷新列表`;
      }
      return res.status(202).json({
        success: true,
        message: `${detail}${suffix}`,
        data: r.data,
      });
    } catch (e) {
      console.error('[project-sourcing/batch-ai-enrich]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '受理失败' });
    }
  });

  router.post('/events/:id/ai-enrich', requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const userId = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueManualFinancingAiEnrich({
        eventId: id,
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
      console.error('[project-sourcing/events/ai-enrich]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '受理失败' });
    }
  });
  router.post('/events/:id/baike-lookup', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ success: false, message: '无效的融资事件 ID' });
      }
      const rows = await db.query(
        `SELECT F_Id AS id, company_name, company_credit_code, baike_lookup_at
         FROM sourcing_financing_event WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
        [id]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: '融资事件不存在' });
      }
      const row = rows[0];
      if (row.baike_lookup_at) {
        return res.status(400).json({ success: false, message: '该事件已完成百科查词，请勿重复操作' });
      }
      const { fetchBaike, applyBaikeToFinancingFanOut } = require('../../utils/project-sourcing/baikeLookupService');
      const name = String(row.company_name || '').trim();
      if (name.length < 2) {
        return res.status(400).json({ success: false, message: '企业名称过短，无法查词' });
      }
      const baike = fetchBaike(name, 1500);
      if (!baike || !baike.has_lemma) {
        await db.execute(
          `UPDATE sourcing_financing_event SET baike_lemma_status = ?, baike_miss_reason = ?, baike_lookup_at = NOW(), F_LastModifyTime = NOW()
           WHERE F_Id = ?`,
          [baike?.lemma_status || 'not_found', baike?.miss_reason || 'fetch_error', id]
        );
        return res.json({ success: true, message: '百科未命中', data: { lemma_status: baike?.lemma_status || 'not_found' } });
      }
      const result = await applyBaikeToFinancingFanOut(db, { company_name: name, company_credit_code: row.company_credit_code }, baike, { force: false });
      res.json({
        success: true,
        message: `百科查词完成，更新 ${result.updated} 条记录`,
        data: { lemma_status: baike.lemma_status, baike_url: baike.baike_url, updated: result.updated },
      });
    } catch (e) {
      console.error('[project-sourcing/events/baike-lookup]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '百科查词失败' });
    }
  });

  router.post('/batch-baike-lookup', requireAdmin, async (req, res) => {
    try {
      const { start_date, end_date } = req.body || {};
      if (!start_date || !end_date) {
        return res.status(400).json({ success: false, message: '缺少参数：start_date、end_date（yyyy-MM-dd）' });
      }
      const df = String(start_date).slice(0, 10);
      const dt = String(end_date).slice(0, 10);
      if (df > dt) {
        return res.status(400).json({ success: false, message: '开始日期不能晚于结束日期' });
      }
      const rows = await db.query(
        `SELECT F_Id AS id, company_name, project_name, company_credit_code
         FROM sourcing_financing_event
         WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         ORDER BY event_date DESC, F_Id DESC`,
        [df, dt]
      );
      if (!rows.length) {
        return res.json({ success: true, message: '区间内无记录', data: { total: 0 } });
      }
      const { fetchBaike, applyBaikeToFinancingFanOut } = require('../../utils/project-sourcing/baikeLookupService');
      const total = rows.length;
      let updated = 0;
      let found = 0;
      let notFound = 0;
      for (const row of rows) {
        const name = String(row.company_name || row.project_name || '').trim();
        if (name.length < 2) continue;
        try {
          const baike = fetchBaike(name, 800);
          if (baike && baike.has_lemma) {
            const r = await applyBaikeToFinancingFanOut(db, { company_name: name, company_credit_code: row.company_credit_code }, baike, { force: true });
            updated += r.updated || 0;
            found += 1;
          } else {
            await db.execute(
              `UPDATE sourcing_financing_event SET baike_lemma_status = ?, baike_miss_reason = ?, baike_lookup_at = NOW(), F_LastModifyTime = NOW()
               WHERE F_Id = ?`,
              [baike?.lemma_status || 'not_found', baike?.miss_reason || 'fetch_error', row.id]
            );
            notFound += 1;
          }
        } catch (err) {
          console.warn(`[batch-baike-lookup] ${name}:`, err.message);
          notFound += 1;
        }
      }
      res.json({
        success: true,
        message: `批量百科查词完成：共 ${total} 条，命中 ${found} 家，未命中 ${notFound} 家，更新 ${updated} 条记录`,
        data: { total, found, not_found: notFound, updated },
      });
    } catch (e) {
      console.error('[project-sourcing/batch-baike-lookup]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '批量百科查词失败' });
    }
  });
}

module.exports = { registerFinancingRoutes };
