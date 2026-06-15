const db = require('../../db');
const { rowsToCsv, sendCsv, formatCsvDateYmdSlash } = require('../../utils/上市进展/listingCsv');
const { buildCompetitorAnalysisIpoWhereClause } = require('../../utils/竞品分析/ipoProjectSourcingListFilter');
const {
  requireCompetitorAnalysisAccess,
  requireAdmin,
  isAdminUser,
} = require('../../utils/竞品分析/competitorAnalysisRouteAuth');
const {
  enqueueManualIpoProjectAiEnrich,
  enqueueBatchIpoProjectAiEnrich,
} = require('../../utils/竞品分析/ipoProjectAiEnrichService');
const {
  syncIpoProjectQccCompanyBrief,
  batchSyncIpoProjectQccCompanyBrief,
  syncAllIpoProjectQccCompanyBriefFiltered,
} = require('../../utils/竞品分析/ipoProjectQccBriefService');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../../utils/enterpriseDataApp');
const { IPO_SQL_WRITE_TARGET_COMPETITOR } = require('../../utils/竞品分析/constants');
const { getApplicationIdByAppName, isIpoProjectCompetitorAnalysisApp } = require('../../utils/applicationIdResolve');
const { generateIpoProjectNo } = require('../../utils/上市进展/ipoProjectNumber');
const { generateId } = require('../../utils/idGenerator');
const { queryExternal } = require('../../utils/externalDb');
const {
  assertReadOnlySql,
  ensureExternalPool,
  formatExternalSqlError,
  runIpoProjectSqlSyncForUser,
} = require('../../utils/上市进展/ipoProjectSqlSyncRunner');
const { updateListingScheduledTasks } = require('../../utils/上市进展/scheduledListingTasks');
const { clientIpFromReq } = require('../../utils/竞品分析/competitorRouteUtils');

function ipoListFilterFromReq(req) {
  const keyword = (req.query.keyword || req.body?.keyword || '').trim();
  const creatorUserId = (req.query.creatorUserId || req.body?.creatorUserId || '').trim();
  return buildCompetitorAnalysisIpoWhereClause({
    psUser: req.psUser,
    keyword,
    creatorUserId,
  });
}

async function getCompetitorAnalysisApplicationId() {
  return getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
}

async function loadAccessibleIpoProjectRow(req, fId) {
  const fid = String(fId || '').trim();
  if (!fid) {
    return { row: null, err: { status: 400, message: '无效的底层项目 id' } };
  }
  const psId = await getCompetitorAnalysisApplicationId();
  if (!psId) {
    return { row: null, err: { status: 400, message: '未找到「竞品分析」应用' } };
  }
  const rows = await db.query(
    `SELECT p.* FROM ipo_project p WHERE p.F_Id = ? AND p.F_DeleteMark = 0 LIMIT 1`,
    [fid]
  );
  if (!rows.length) {
    return { row: null, err: { status: 404, message: '记录不存在' } };
  }
  const row = rows[0];
  if (!(await isIpoProjectCompetitorAnalysisApp(row))) {
    return { row: null, err: { status: 400, message: '非竞品分析应用下的底层项目' } };
  }
  const user = req.psUser;
  if (!isAdminUser(user) && String(row.F_CreatorUserId) !== String(user.id)) {
    return { row: null, err: { status: 403, message: '无权操作该记录' } };
  }
  return { row, err: null };
}

function registerIpoProjectSourcingRoutes(router) {
  router.get('/ipo-projects/sql-sync-setting', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const user = req.psUser;
      const configId = (req.query?.external_db_config_id || '').trim();
      const rows = configId
        ? await db.query(
            `SELECT F_Id AS id, user_id, write_target, external_db_config_id, sql_text, is_enabled, cron_expression,
                    COALESCE(qcc_brief_after_sync_enabled, 0) AS qcc_brief_after_sync_enabled,
                    column_map, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
             FROM ipo_project_sql_sync_setting
             WHERE user_id = ? AND external_db_config_id = ? AND write_target = ?
             LIMIT 1`,
            [user.id, configId, IPO_SQL_WRITE_TARGET_COMPETITOR]
          )
        : await db.query(
            `SELECT F_Id AS id, user_id, write_target, external_db_config_id, sql_text, is_enabled, cron_expression,
                    COALESCE(qcc_brief_after_sync_enabled, 0) AS qcc_brief_after_sync_enabled,
                    column_map, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
             FROM ipo_project_sql_sync_setting
             WHERE user_id = ? AND write_target = ?
             ORDER BY F_LastModifyTime DESC
             LIMIT 1`,
            [user.id, IPO_SQL_WRITE_TARGET_COMPETITOR]
          );
      if (!rows.length) {
        return res.json({
          success: true,
          data: {
            external_db_config_id: '',
            sql_text: '',
            is_enabled: 1,
            cron_expression: '',
            qcc_brief_after_sync_enabled: 0,
            write_target: IPO_SQL_WRITE_TARGET_COMPETITOR,
          },
        });
      }
      const row = rows[0];
      return res.json({
        success: true,
        data: {
          ...row,
          is_enabled: row.is_enabled === 0 ? 0 : 1,
          qcc_brief_after_sync_enabled: Number(row.qcc_brief_after_sync_enabled) === 1 ? 1 : 0,
        },
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/sql-sync-setting GET]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.put('/ipo-projects/sql-sync-setting', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const user = req.psUser;
      const body = req.body || {};
      const external_db_config_id = body.external_db_config_id || null;
      const sql_text = (body.sql_text || '').trim();
      const cron_expression = (body.cron_expression || '').trim();
      const is_enabled =
        body.is_enabled === false || body.is_enabled === 0 || body.is_enabled === '0' ? 0 : 1;
      const qcc_brief_after_sync_enabled =
        body.qcc_brief_after_sync_enabled === false ||
        body.qcc_brief_after_sync_enabled === 0 ||
        body.qcc_brief_after_sync_enabled === '0'
          ? 0
          : 1;

      if (sql_text) assertReadOnlySql(sql_text);

      if (!external_db_config_id) {
        return res.status(400).json({ success: false, message: '请选择业务数据库连接' });
      }

      const existing = await db.query(
        `SELECT F_Id AS id FROM ipo_project_sql_sync_setting WHERE user_id = ? AND external_db_config_id = ? AND write_target = ? LIMIT 1`,
        [user.id, external_db_config_id, IPO_SQL_WRITE_TARGET_COMPETITOR]
      );

      if (existing.length) {
        await db.execute(
          `UPDATE ipo_project_sql_sync_setting SET
            external_db_config_id = ?, sql_text = ?, is_enabled = ?, cron_expression = ?, qcc_brief_after_sync_enabled = ?
           WHERE user_id = ? AND external_db_config_id = ? AND write_target = ?`,
          [
            external_db_config_id,
            sql_text || null,
            is_enabled,
            cron_expression || null,
            qcc_brief_after_sync_enabled,
            user.id,
            external_db_config_id,
            IPO_SQL_WRITE_TARGET_COMPETITOR,
          ]
        );
      } else {
        const id = await generateId('ipo_project_sql_sync_setting');
        await db.execute(
          `INSERT INTO ipo_project_sql_sync_setting (F_Id, user_id, write_target, external_db_config_id, sql_text, is_enabled, cron_expression, qcc_brief_after_sync_enabled, column_map)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            user.id,
            IPO_SQL_WRITE_TARGET_COMPETITOR,
            external_db_config_id,
            sql_text || null,
            is_enabled,
            cron_expression || null,
            qcc_brief_after_sync_enabled,
            JSON.stringify({}),
          ]
        );
      }

      const saved = await db.query(
        `SELECT *, F_Id AS id FROM ipo_project_sql_sync_setting WHERE user_id = ? AND external_db_config_id = ? AND write_target = ? LIMIT 1`,
        [user.id, external_db_config_id, IPO_SQL_WRITE_TARGET_COMPETITOR]
      );
      await updateListingScheduledTasks();
      return res.json({ success: true, data: saved[0] });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/sql-sync-setting PUT]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.post('/ipo-projects/sql-sync-preview', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const body = req.body || {};
      const configId = body.external_db_config_id;
      const sql_text = (body.sql_text || '').trim();
      if (!configId) return res.status(400).json({ success: false, message: '请选择业务数据库连接' });
      if (!sql_text) return res.status(400).json({ success: false, message: '请填写 SQL' });
      assertReadOnlySql(sql_text);

      await ensureExternalPool(configId);
      const rows = await queryExternal(configId, sql_text, []);
      const sample = Array.isArray(rows) ? rows.slice(0, 30) : [];
      return res.json({
        success: true,
        data: { rowCount: Array.isArray(rows) ? rows.length : 0, sample },
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/sql-sync-preview]', e);
      return res.status(400).json({
        success: false,
        message: `SQL 预览失败：${formatExternalSqlError(e)}`,
      });
    }
  });

  router.post('/ipo-projects/sql-sync-run', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const user = req.psUser;
      const body = req.body || {};
      let external_db_config_id = body.external_db_config_id;
      let sql_text = (body.sql_text || '').trim();
      let is_enabled = body.is_enabled;
      let qcc_brief_after_sync_enabled = body.qcc_brief_after_sync_enabled;

      if (!external_db_config_id || !sql_text || is_enabled === undefined || qcc_brief_after_sync_enabled === undefined) {
        const saved = await db.query(
          `SELECT *, F_Id AS id FROM ipo_project_sql_sync_setting
           WHERE user_id = ? AND external_db_config_id = ? AND write_target = ?
           LIMIT 1`,
          [user.id, external_db_config_id, IPO_SQL_WRITE_TARGET_COMPETITOR]
        );
        if (saved.length) {
          const s = saved[0];
          if (!external_db_config_id) external_db_config_id = s.external_db_config_id;
          if (!sql_text) sql_text = (s.sql_text || '').trim();
          if (is_enabled === undefined) is_enabled = s.is_enabled;
          if (qcc_brief_after_sync_enabled === undefined) {
            qcc_brief_after_sync_enabled = s.qcc_brief_after_sync_enabled;
          }
        }
      }
      const result = await runIpoProjectSqlSyncForUser({
        userId: user.id,
        external_db_config_id,
        sql_text,
        is_enabled,
        writeTarget: IPO_SQL_WRITE_TARGET_COMPETITOR,
        qccBriefAfterSync:
          qcc_brief_after_sync_enabled === 1 ||
          qcc_brief_after_sync_enabled === true ||
          qcc_brief_after_sync_enabled === '1',
      });
      return res.json({
        success: true,
        data: result,
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/sql-sync-run]', e);
      return res.status(400).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.get('/ipo-projects/ai-enrich-logs', requireAdmin, async (req, res) => {
    try {
      const fid = String(req.query.ipo_project_f_id || '').trim();
      if (!fid) {
        return res.status(400).json({ success: false, message: '缺少 ipo_project_f_id' });
      }
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 30));
      const offset = (page - 1) * pageSize;

      const countRows = await db.query(
        `SELECT COUNT(*) AS total FROM invested_enterprise_ai_enrich_log WHERE ipo_project_f_id = ?`,
        [fid]
      );
      const total = Number(countRows[0].total || 0);

      const list = await db.query(
        `SELECT F_Id AS id, ipo_project_f_id, invested_enterprise_id, trigger_type, execution_status, triggered_at, started_at, finished_at,
                duration_ms, error_message, result_product_intro, result_industry_tags_display, job_trace_id,
                invoke_mode, used_enable_search, search_degraded,
                used_enable_thinking, thinking_degraded
         FROM invested_enterprise_ai_enrich_log
         WHERE ipo_project_f_id = ?
         ORDER BY F_Id DESC
         LIMIT ? OFFSET ?`,
        [fid, pageSize, offset]
      );

      const { attachSearchStatusLabel } = require('../../utils/项目挖掘/financingAiEnrichSearchMeta');
      const rows = attachSearchStatusLabel(
        list.map((r) => ({
          ...r,
          id: r.id != null ? String(r.id) : r.id,
          ipo_project_f_id: r.ipo_project_f_id != null ? String(r.ipo_project_f_id) : r.ipo_project_f_id,
          invested_enterprise_id:
            r.invested_enterprise_id != null ? String(r.invested_enterprise_id) : r.invested_enterprise_id,
        }))
      );

      res.json({
        success: true,
        data: { list: rows, total, page, pageSize },
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/ai-enrich-logs]', e);
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.post('/ipo-projects/batch-ai-enrich', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const only_failed =
        body.only_failed === true ||
        body.only_failed === 1 ||
        String(body.only_failed || '').toLowerCase() === 'true';
      const userId = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueBatchIpoProjectAiEnrich({
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
      console.error('[project-sourcing/ipo-projects/batch-ai-enrich]', e);
      res.status(500).json({ success: false, message: e.message || '受理失败' });
    }
  });

  router.post('/ipo-projects/batch-qcc-company-brief', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const raw = body.f_ids ?? body.ids ?? [];
      const ids = Array.isArray(raw) ? raw : [];
      const r = await batchSyncIpoProjectQccCompanyBrief(ids, {
        gapMs: body.gap_ms != null ? Number(body.gap_ms) : undefined,
      });
      if (!r.ok) {
        return res.status(r.code).json({ success: false, message: r.message });
      }
      const d = r.data;
      res.json({
        success: true,
        message: `企查查批量同步完成：成功 ${d.success} 行，失败 ${d.failed} 行（去重后调用 ${d.unique_queries} 次）`,
        data: d,
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/batch-qcc-company-brief]', e);
      res.status(500).json({ success: false, message: e.message || '批量同步失败' });
    }
  });

  router.post('/ipo-projects/qcc-company-brief-sync-all-filtered', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const r = await syncAllIpoProjectQccCompanyBriefFiltered({
        psUser: req.psUser,
        keyword: String(body.keyword ?? req.query.keyword ?? '').trim(),
        creatorUserId: String(body.creatorUserId ?? req.query.creatorUserId ?? '').trim(),
        gapMs: body.gap_ms != null ? Number(body.gap_ms) : undefined,
      });
      if (!r.ok) {
        return res.status(r.code).json({ success: false, message: r.message });
      }
      const d = r.data;
      res.json({
        success: true,
        message: `企查查全部同步完成：成功 ${d.success} 行，失败 ${d.failed} 行（去重后调用 ${d.unique_queries} 次）`,
        data: d,
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/qcc-company-brief-sync-all-filtered]', e);
      res.status(500).json({ success: false, message: e.message || '同步失败' });
    }
  });

  router.get('/ipo-projects/export', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const { whereSql, params } = await ipoListFilterFromReq(req);
      const rows = await db.query(
        `SELECT p.*, u.account AS creator_account
         FROM ipo_project p
         LEFT JOIN users u ON u.F_Id = p.F_CreatorUserId
         ${whereSql}
         ORDER BY p.F_CreatorTime DESC
         LIMIT 50000`,
        params
      );

      const csv = rowsToCsv(rows, [
        { label: '项目编号', key: 'project_no' },
        { label: 'data_app_id', key: 'data_app_id' },
        { label: '归属基金', key: 'fund' },
        { label: '归属子基金', key: 'sub' },
        { label: '项目简称', key: 'project_name' },
        { label: '企业全称', key: 'company' },
        { label: '产品介绍(AI)', key: 'ai_product_intro' },
        { label: '行业标签(AI)', key: 'ai_industry_tags_display' },
        { label: '企业介绍(企查查)', key: 'qcc_company_intro' },
        { label: '统一社会信用代码', key: 'unified_credit_code' },
        { label: 'AI状态', key: 'ai_enrich_status' },
        { label: '投资金额', key: 'inv_amount' },
        { label: '剩余金额', key: 'residual_amount' },
        { label: '穿透权益占比', key: 'ratio' },
        { label: '穿透投资金额', key: 'ct_amount' },
        { label: '穿透剩余金额', key: 'ct_residual' },
        { label: '业务更新', key: 'biz_update_time', get: (r) => formatCsvDateYmdSlash(r.biz_update_time) },
        { label: '创建时间', key: 'F_CreatorTime', get: (r) => formatCsvDateYmdSlash(r.F_CreatorTime) },
        { label: '创建用户', key: 'creator_account' },
      ]);
      sendCsv(res, `底层项目_竞品分析_${Date.now()}.csv`, csv);
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/export]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.get('/ipo-projects', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

      const { whereSql, params } = await ipoListFilterFromReq(req);

      const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_project p ${whereSql}`, params);
      const total = countRows[0].total;

      const offset = (page - 1) * pageSize;
      const list = await db.query(
        `SELECT p.*, u.account AS creator_account
         FROM ipo_project p
         LEFT JOIN users u ON u.F_Id = p.F_CreatorUserId
         ${whereSql}
         ORDER BY p.F_CreatorTime DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      res.json({
        success: true,
        data: { list, total, page, pageSize },
      });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.post('/ipo-projects', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const user = req.psUser;
      const body = req.body || {};
      const psId = await getCompetitorAnalysisApplicationId();
      if (!psId) {
        return res.status(400).json({ success: false, message: '未找到「竞品分析」应用' });
      }
      const checks = [
        ['project_name', '项目简称'],
        ['company', '企业全称'],
        ['fund', '归属基金'],
        ['inv_amount', '投资成本'],
        ['residual_amount', '剩余成本'],
        ['ratio', '穿透权益占比'],
        ['ct_amount', '穿透投资成本'],
        ['ct_residual', '穿透剩余成本'],
      ];
      for (const [key, label] of checks) {
        if (body[key] === undefined || body[key] === null || String(body[key]).trim() === '') {
          return res.status(400).json({ success: false, message: `请填写${label}` });
        }
      }
      const uccRaw =
        body.unified_credit_code != null ? String(body.unified_credit_code).replace(/\s+/g, '').trim() : '';
      const unified_credit_code = uccRaw || null;
      const project_no = await generateIpoProjectNo();
      const now = new Date();
      await db.execute(
        `INSERT INTO ipo_project (
          project_no, biz_update_time, F_CreatorTime, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime,
          project_name, company, unified_credit_code, inv_amount, residual_amount, ratio, ct_amount, ct_residual, fund, sub,
          data_app_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project_no,
          body.biz_update_time || now,
          now,
          user.id,
          user.id,
          now,
          String(body.project_name).trim(),
          String(body.company).trim(),
          unified_credit_code,
          body.inv_amount,
          body.residual_amount,
          body.ratio,
          body.ct_amount,
          body.ct_residual,
          String(body.fund).trim(),
          body.sub != null && String(body.sub).trim() !== '' ? String(body.sub).trim() : null,
          psId,
        ]
      );
      const inserted = await db.query(`SELECT *, F_Id AS id FROM ipo_project WHERE project_no = ? LIMIT 1`, [project_no]);
      const row = inserted[0];
      const urows = await db.query(`SELECT account AS creator_account FROM users WHERE F_Id = ? LIMIT 1`, [user.id]);
      row.creator_account = urows.length ? urows[0].creator_account : null;
      return res.json({ success: true, data: row });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects POST]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.put('/ipo-projects/:f_id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const fid = String(req.params.f_id || '').trim();
      const { err } = await loadAccessibleIpoProjectRow(req, fid);
      if (err) return res.status(err.status).json({ success: false, message: err.message });
      const body = req.body || {};
      const checks = [
        ['project_name', '项目简称'],
        ['company', '企业全称'],
        ['fund', '归属基金'],
        ['inv_amount', '投资成本'],
        ['residual_amount', '剩余成本'],
        ['ratio', '穿透权益占比'],
        ['ct_amount', '穿透投资成本'],
        ['ct_residual', '穿透剩余成本'],
      ];
      for (const [key, label] of checks) {
        if (body[key] === undefined || body[key] === null || String(body[key]).trim() === '') {
          return res.status(400).json({ success: false, message: `请填写${label}` });
        }
      }
      const uccRaw =
        body.unified_credit_code != null ? String(body.unified_credit_code).replace(/\s+/g, '').trim() : '';
      const unified_credit_code = uccRaw || null;
      const user = req.psUser;
      const now = new Date();
      await db.execute(
        `UPDATE ipo_project SET
          project_name = ?, company = ?, unified_credit_code = ?,
          inv_amount = ?, residual_amount = ?, ratio = ?,
          ct_amount = ?, ct_residual = ?, fund = ?, sub = ?,
          biz_update_time = COALESCE(?, biz_update_time),
          F_LastModifyUserId = ?, F_LastModifyTime = ?
         WHERE F_Id = ? AND F_DeleteMark = 0`,
        [
          String(body.project_name).trim(),
          String(body.company).trim(),
          unified_credit_code,
          body.inv_amount,
          body.residual_amount,
          body.ratio,
          body.ct_amount,
          body.ct_residual,
          String(body.fund).trim(),
          body.sub != null && String(body.sub).trim() !== '' ? String(body.sub).trim() : null,
          body.biz_update_time || null,
          user.id,
          now,
          fid,
        ]
      );
      const updated = await db.query(
        `SELECT p.*, u.account AS creator_account
         FROM ipo_project p
         LEFT JOIN users u ON u.F_Id = p.F_CreatorUserId
         WHERE p.F_Id = ? LIMIT 1`,
        [fid]
      );
      return res.json({ success: true, data: updated[0] });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects PUT]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.delete('/ipo-projects/:f_id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const fid = String(req.params.f_id || '').trim();
      const { err } = await loadAccessibleIpoProjectRow(req, fid);
      if (err) return res.status(err.status).json({ success: false, message: err.message });
      const user = req.psUser;
      const now = new Date();
      await db.execute(
        `UPDATE ipo_project SET F_DeleteMark = 1, F_DeleteTime = ?, F_DeleteUserId = ? WHERE F_Id = ?`,
        [now, user.id, fid]
      );
      return res.json({ success: true, message: '已删除' });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects DELETE]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.get('/ipo-projects/:f_id/change-log', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const fid = String(req.params.f_id || '').trim();
      const { err } = await loadAccessibleIpoProjectRow(req, fid);
      if (err) return res.status(err.status).json({ success: false, message: err.message });
      const rows = await db.query(
        `SELECT d.*, u.account AS change_user_account
         FROM data_change_log d
         LEFT JOIN users u ON u.F_Id = d.F_CreatorUserId
         WHERE d.table_name = 'ipo_project' AND d.record_id = ?
         ORDER BY d.F_CreatorTime DESC
         LIMIT 500`,
        [fid]
      );
      return res.json({ success: true, data: rows });
    } catch (e) {
      console.error('[project-sourcing/ipo-projects/change-log]', e);
      res.status(500).json({ success: false, message: e.message || '服务器错误' });
    }
  });

  router.post('/ipo-projects/:f_id/ai-enrich', requireAdmin, async (req, res) => {
    try {
      const fid = String(req.params.f_id || '').trim();
      const userId = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueManualIpoProjectAiEnrich({
        fId: fid,
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
      console.error('[project-sourcing/ipo-projects/ai-enrich]', e);
      res.status(500).json({ success: false, message: e.message || '受理失败' });
    }
  });

  router.post('/ipo-projects/:f_id/qcc-company-brief', requireAdmin, async (req, res) => {
    try {
      const fid = String(req.params.f_id || '').trim();
      const r = await syncIpoProjectQccCompanyBrief(fid);
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
      console.error('[project-sourcing/ipo-projects/qcc-company-brief]', e);
      res.status(code).json({ success: false, message: e.message || '同步失败' });
    }
  });
}

module.exports = { registerIpoProjectSourcingRoutes };
