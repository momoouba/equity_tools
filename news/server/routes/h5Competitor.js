/**
 * H5 竞品分析只读：主体列表（含状态）+ 进度/结果摘要
 */
const express = require('express');
const db = require('../db');
const {
  getUserFromHeader,
  isAdminUser,
} = require('../utils/competitor-analysis/competitorAnalysisRouteAuth');
const { checkCompetitorAnalysisPermission } = require('../utils/competitor-analysis/competitorAnalysisPermission');
const { APP_NAME_COMPETITOR_ANALYSIS } = require('../utils/competitor-analysis/constants');
const { getApplicationIdByAppName } = require('../utils/applicationIdResolve');
const { attachPreInvestmentAnalysisStatus } = require('../utils/competitor-analysis/competitorAnalysisStageStatus');
const { buildCompetitorAnalysisSummary } = require('../utils/competitor-analysis/competitorAnalysisSummaryService');
const { computeRunProgress } = require('../utils/competitor-analysis/competitorRunProgress');

const router = express.Router();

async function requireH5CompetitorAccess(req, res) {
  const user = await getUserFromHeader(req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录' });
    return null;
  }
  if (isAdminUser(user)) return user;
  if (await checkCompetitorAnalysisPermission(user.id)) return user;
  res.status(403).json({ success: false, message: '无竞品分析访问权限' });
  return null;
}

function fmtTs(v) {
  if (!v) return null;
  return String(v).replace('T', ' ').slice(0, 19);
}

async function listCompetitorRunStepLogsLite(runId) {
  return db.query(
    `SELECT step_code, status, message, F_CreatorTime AS created_at
     FROM sourcing_competitor_run_step_log
     WHERE run_id = ?
     ORDER BY F_CreatorTime ASC, F_Id ASC`,
    [runId]
  );
}

/**
 * 为主体列表附带最近一次有意义 run 的状态/进度
 * @param {'post'|'pre'} kind
 */
async function attachRunProgressStatus(rows, kind) {
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (row.analysis_status_label == null) row.analysis_status_label = '未分析';
    row.analysis_status = row.analysis_status || '';
    row.progress_percent = row.progress_percent ?? null;
    row.is_running = !!row.is_running;
  }
  const ids = list.map((r) => String(r.id || '')).filter(Boolean);
  if (!ids.length) return list;

  const runs =
    kind === 'pre'
      ? await db.query(
          `SELECT F_Id AS id, pre_investment_project_id AS subject_id, status, message,
                  started_at, finished_at, F_CreatorTime AS created_at
           FROM sourcing_pre_investment_competitor_run
           WHERE pre_investment_project_id IN (?) AND F_DeleteMark = 0
           ORDER BY F_CreatorTime DESC, F_Id DESC`,
          [ids]
        )
      : await db.query(
          `SELECT F_Id AS id, invested_enterprise_id AS subject_id, status, message,
                  started_at, finished_at, F_CreatorTime AS created_at
           FROM sourcing_competitor_run
           WHERE invested_enterprise_id IN (?) AND F_DeleteMark = 0
           ORDER BY F_CreatorTime DESC, F_Id DESC`,
          [ids]
        );

  const latestBySubject = new Map();
  for (const run of runs) {
    const sid = String(run.subject_id || '');
    if (!sid || latestBySubject.has(sid)) continue;
    const st = String(run.status || '').toLowerCase();
    if (!['queued', 'running', 'success', 'failed'].includes(st)) continue;
    latestBySubject.set(sid, run);
  }

  for (const row of list) {
    const run = latestBySubject.get(String(row.id || ''));
    if (!run) continue;
    const st = String(run.status || '').toLowerCase();
    let steps = [];
    if (st === 'queued' || st === 'running') {
      try {
        steps = await listCompetitorRunStepLogsLite(run.id);
      } catch {
        steps = [];
      }
    }
    const progress = computeRunProgress(run, steps);
    row.analysis_status = st;
    row.analysis_status_label = progress.status_label || row.analysis_status_label || st;
    row.progress_percent = progress.percent;
    row.is_running = !!progress.is_running;
    row.current_step_label = progress.current_step_label || '';
    row.latest_run_id = String(run.id);
    row.finished_at = fmtTs(run.finished_at);
  }
  return list;
}

/**
 * GET /api/h5/competitor/subjects?tab=pre|post&page=&pageSize=&keyword=
 */
router.get('/competitor/subjects', async (req, res) => {
  try {
    const user = await requireH5CompetitorAccess(req, res);
    if (!user) return;
    req.caUser = user;
    req.psUser = user;

    const tab = String(req.query.tab || 'post').trim() === 'pre' ? 'pre' : 'post';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const keyword = String(req.query.keyword || '').trim().slice(0, 100);
    const like = keyword ? `%${keyword}%` : null;
    const admin = isAdminUser(user);
    const uid = String(user.id);

    if (tab === 'pre') {
      const where = ['F_DeleteMark = 0'];
      const params = [];
      if (!admin) {
        where.push('F_CreatorUserId = ?');
        params.push(uid);
      }
      if (like) {
        where.push(
          '(enterprise_full_name LIKE ? OR project_abbreviation LIKE ? OR project_no LIKE ? OR unified_credit_code LIKE ?)'
        );
        params.push(like, like, like, like);
      }
      const whereSql = where.join(' AND ');
      const countRows = await db.query(
        `SELECT COUNT(*) AS c FROM pre_investment_project WHERE ${whereSql}`,
        params
      );
      const total = Number(countRows[0]?.c || 0);
      const list = await db.query(
        `SELECT F_Id AS id, project_no, enterprise_full_name, unified_credit_code, project_abbreviation,
                pipeline_status, ai_product_intro, ai_industry_tags_display,
                F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
         FROM pre_investment_project
         WHERE ${whereSql}
         ORDER BY F_LastModifyTime DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );
      await attachPreInvestmentAnalysisStatus(list);
      await attachRunProgressStatus(list, 'pre');
      for (const row of list) {
        row.tab = 'pre';
        row.subject_type = 'pre_investment_project';
      }
      return res.json({
        success: true,
        data: { list, total, page, pageSize, tab },
      });
    }

    // post: 竞品分析应用下的被投企业
    const appId = await getApplicationIdByAppName(APP_NAME_COMPETITOR_ANALYSIS);
    if (!appId) {
      return res.status(500).json({ success: false, message: '未配置竞品分析应用' });
    }
    const where = ['F_DeleteMark = 0', 'data_app_id <=> ?'];
    const params = [appId];
    if (!admin) {
      where.push('F_CreatorUserId = ?');
      params.push(uid);
    }
    where.push("(TRIM(COALESCE(entity_type, '')) = '被投企业' OR TRIM(COALESCE(entity_type, '')) = '')");
    if (like) {
      where.push(
        '(enterprise_full_name LIKE ? OR project_abbreviation LIKE ? OR project_number LIKE ? OR unified_credit_code LIKE ?)'
      );
      params.push(like, like, like, like);
    }
    const whereSql = where.join(' AND ');
    const countRows = await db.query(
      `SELECT COUNT(*) AS c FROM invested_enterprises WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.c || 0);
    const list = await db.query(
      `SELECT F_Id AS id, project_number, project_abbreviation, enterprise_full_name, unified_credit_code,
              exit_status, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
       FROM invested_enterprises
       WHERE ${whereSql}
       ORDER BY F_LastModifyTime DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    await attachRunProgressStatus(list, 'post');
    for (const row of list) {
      row.tab = 'post';
      row.subject_type = 'invested_enterprise';
    }
    return res.json({
      success: true,
      data: { list, total, page, pageSize, tab },
    });
  } catch (e) {
    console.error('[h5] competitor subjects', e);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

/**
 * GET /api/h5/competitor/summary?tab=pre|post&id=&run_id=
 */
router.get('/competitor/summary', async (req, res) => {
  try {
    const user = await requireH5CompetitorAccess(req, res);
    if (!user) return;
    req.caUser = user;
    req.psUser = user;

    const tab = String(req.query.tab || 'post').trim() === 'pre' ? 'pre' : 'post';
    const id = String(req.query.id || '').trim();
    const runId = String(req.query.run_id || '').trim() || null;
    if (!id) {
      return res.status(400).json({ success: false, message: '缺少 id' });
    }

    if (tab === 'post') {
      const rows = await db.query(
        `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, project_number, unified_credit_code,
                F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark
         FROM invested_enterprises WHERE F_Id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length || Number(rows[0].delete_mark) !== 0) {
        return res.status(404).json({ success: false, message: '被投企业不存在' });
      }
      if (!isAdminUser(user) && String(rows[0].creator_user_id) !== String(user.id)) {
        return res.status(403).json({ success: false, message: '仅创建人或管理员可查看' });
      }
      const summary = await buildCompetitorAnalysisSummary({
        subjectType: 'invested_enterprise',
        investedEnterpriseId: id,
        runId,
      });
      return res.json({
        success: true,
        data: {
          tab: 'post',
          subject: {
            id: String(rows[0].id),
            enterprise_full_name: rows[0].enterprise_full_name,
            project_abbreviation: rows[0].project_abbreviation,
            project_number: rows[0].project_number,
            unified_credit_code: rows[0].unified_credit_code,
          },
          ...summary,
        },
      });
    }

    const rows = await db.query(
      `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, project_no, unified_credit_code,
              F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark
       FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length || Number(rows[0].delete_mark) !== 0) {
      return res.status(404).json({ success: false, message: '投前项目不存在' });
    }
    if (!isAdminUser(user) && String(rows[0].creator_user_id) !== String(user.id)) {
      return res.status(403).json({ success: false, message: '仅创建人或管理员可查看' });
    }
    const summary = await buildCompetitorAnalysisSummary({
      subjectType: 'pre_investment_project',
      preInvestmentProjectId: id,
      runId,
    });
    return res.json({
      success: true,
      data: {
        tab: 'pre',
        subject: {
          id: String(rows[0].id),
          enterprise_full_name: rows[0].enterprise_full_name,
          project_abbreviation: rows[0].project_abbreviation,
          project_no: rows[0].project_no,
          unified_credit_code: rows[0].unified_credit_code,
        },
        ...summary,
      },
    });
  } catch (e) {
    const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
    if (code === 500) console.error('[h5] competitor summary', e);
    return res.status(code).json({ success: false, message: e.message || '查询失败' });
  }
});

module.exports = router;
