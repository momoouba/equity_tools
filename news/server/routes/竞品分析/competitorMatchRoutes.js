const { generateId } = require('../../utils/idGenerator');
const db = require('../../db');
const {
  requireAdmin,
  requireCompetitorAnalysisAccess,
  isAdminUser,
} = require('../../utils/竞品分析/competitorAnalysisRouteAuth');
const { extractCompetitorSupplementTagsFromNarrative } = require('../../utils/项目挖掘/financingAiEnrichService');
const {
  evaluateInvestedEnterpriseCompetitorReadiness,
  getInvestedEnterpriseRowForCompetitor,
} = require('../../utils/竞品分析/competitorMatchReadinessService');
const { fetchCompanyBriefGetInfo } = require('../../utils/qichachaCompanyBrief');
const { fetchQichachaFuzzyCompanies } = require('../../utils/qichachaFuzzySearch');
const {
  isCrossTableUnifiedCredit,
  normalizeUnifiedCreditCode,
  runUnifiedCreditQccSync,
} = require('../../utils/竞品分析/competitorQccCrossTableSync');
const { enqueueManualPreInvestmentProjectAiEnrich } = require('../../utils/竞品分析/preInvestmentProjectAiEnrichService');
const {
  enqueueCompetitorAnalysisRun,
  evaluatePreInvestmentReadiness,
  listCompetitorRunStepLogs,
} = require('../../utils/竞品分析/competitorAnalysisRunner');
const {
  exportCompetitorRelationsToBuffer,
  listInvestedEnterpriseYears,
  listPreInvestmentYears,
} = require('../../utils/竞品分析/competitorMatchExport');
const {
  buildCompetitorAnalysisSummary,
  dedupeRelations,
  hydrateRelationRow,
} = require('../../utils/竞品分析/competitorAnalysisSummaryService');
const {
  upsertComparablePrefForRelation,
} = require('../../utils/竞品分析/competitorComparablePrefService');
const {
  listInvestedEnterpriseCompetitorRuns,
  getLatestRunIdForInvestedEnterprise,
  listPreInvestmentCompetitorRuns,
  getLatestRunIdForPreInvestmentProject,
} = require('../../utils/竞品分析/competitorRunVersionService');
const CA_C = require('../../utils/竞品分析/constants');
const {
  restoreCompetitorDataAfterInsert,
  relinkOrphanCompetitorDataBySubjectMatch,
} = require('../../utils/竞品分析/competitorSyncSnapshot');
const { clientIpFromReq } = require('../../utils/竞品分析/competitorRouteUtils');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureUploadsSubDir } = require('../../utils/uploadsPath');

// BP 文件上传子目录（相对 uploads 根目录），使用 ASCII 避免 MarkItDown 中文路径编码问题
const BP_UPLOAD_SUBDIR = path.join('competitor-analysis', 'bp');
const { processBpFile, extractBpForProject } = require('../../utils/竞品分析/bpFileParser');

function normTags(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .filter((s) => s.length <= 32)
    .slice(0, 20);
}

function normPreProjectNo(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  return s.slice(0, 32);
}

async function allocPreProjectNo(preferredRaw) {
  const preferred = normPreProjectNo(preferredRaw);
  const exists = async (no) => {
    const r = await db.query(
      `SELECT F_Id AS id FROM pre_investment_project WHERE F_DeleteMark = 0 AND project_no = ? LIMIT 1`,
      [no]
    );
    return r.length > 0;
  };
  if (preferred && !(await exists(preferred))) return preferred;
  for (let k = 0; k < 16; k++) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const no = `P${ymd}${String(Math.floor(1000 + Math.random() * 9000))}`;
    if (!(await exists(no))) return no;
  }
  return `P${Date.now()}${String(Math.floor(Math.random() * 900 + 100))}`;
}

function assertInvestedEnterpriseCompetitorOwner(req, row) {
  if (!row) return;
  if (!isAdminUser(req.psUser)) {
    const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : '';
    if (String(row.F_CreatorUserId || '') !== uid) {
      const e = new Error('仅管理员或创建人可操作该企业的竞品补录/运行');
      e.code = 403;
      throw e;
    }
  }
}

async function loadPreInvestmentProjectForWrite(req, projectId) {
  const id = String(projectId || '').trim();
  if (!id) {
    const e = new Error('无效的项目 id');
    e.code = 400;
    throw e;
  }
  const rows = await db.query(
    `SELECT F_Id AS id, enterprise_full_name, project_no, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark
     FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].delete_mark) !== 0) {
    const e = new Error('投前项目不存在或已删除');
    e.code = 404;
    throw e;
  }
  const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : '';
  if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id || '') !== uid) {
    const e = new Error('仅创建人或管理员可编辑/删除');
    e.code = 403;
    throw e;
  }
  return rows[0];
}

function parseManualIndustryTagsInput(input) {
  const s = String(input ?? '').trim();
  if (!s) return { display: null, json: null };
  const tags = s
    .split(/[,，、\n]/g)
    .map((t) => t.trim())
    .filter((t) => t && t.length <= 32)
    .slice(0, 24);
  if (!tags.length) return { display: null, json: null };
  return { display: tags.join('、'), json: JSON.stringify(tags) };
}

function nullableLongText(v) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function registerCompetitorMatchRoutes(router) {
  /** 竞品匹配就绪校验：项目挖掘权限；非 admin 仅本人创建的被投 */
  router.get('/invested-enterprises/:id/competitor-readiness', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const row = await getInvestedEnterpriseRowForCompetitor(req.params.id);
      assertInvestedEnterpriseCompetitorOwner(req, row);
      const ev = await evaluateInvestedEnterpriseCompetitorReadiness(row);
      res.json({
        success: true,
        data: {
          ...ev,
          enterprise_full_name: row.enterprise_full_name,
        },
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-readiness]', e);
      res.status(code).json({ success: false, message: e.message || '校验失败' });
    }
  });

  /** 管理员：从自由文本抽取标签（不落库） */
  router.post('/competitor-match/extract-tags-from-narrative', requireAdmin, async (req, res) => {
    try {
      const narrative = req.body?.narrative ?? req.body?.text ?? '';
      const out = await extractCompetitorSupplementTagsFromNarrative(narrative);
      res.json({ success: true, data: out });
    } catch (e) {
      console.error('[project-sourcing/extract-tags-from-narrative]', e);
      res.status(500).json({ success: false, message: e.message || '抽取失败' });
    }
  });

  /** 管理员：写入竞品补录（标签与/或自由文本+AI 抽标签结果） */
  router.post('/invested-enterprises/:id/competitor-supplement', requireAdmin, async (req, res) => {
    try {
      const row = await getInvestedEnterpriseRowForCompetitor(req.params.id);
      const userTags = normTags(req.body?.user_tags ?? req.body?.tags);
      const narrative = String(req.body?.user_narrative ?? req.body?.narrative ?? '').trim().slice(0, 2000);
      const aiTags = normTags(req.body?.ai_extracted_tags);
      const aiSummary = String(req.body?.ai_short_summary ?? '').trim().slice(0, 500);

      if (userTags.length < 1 && aiTags.length < 1) {
        return res.status(400).json({
          success: false,
          message: '请至少录入一个业务标签，或先完成自由文本的「AI 抽标签」后再保存',
        });
      }
      if (narrative && aiTags.length < 1) {
        return res.status(400).json({
          success: false,
          message: '已填写自由文本时，须先调用「AI 抽标签」并将抽取结果一并提交',
        });
      }

      const id = await generateId('competitor_match_supplement');
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      await db.execute(
        `INSERT INTO competitor_match_supplement (
           F_Id, invested_enterprise_id, user_tags_json, user_narrative_raw, ai_extracted_tags_json, ai_short_summary,
           batch_id, F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
         ) VALUES (?,?,?,?,?,?,NULL,?,NOW(),NOW(),0)`,
        [
          id,
          String(row.F_Id),
          userTags.length ? JSON.stringify(userTags) : null,
          narrative || null,
          aiTags.length ? JSON.stringify(aiTags) : null,
          aiSummary || null,
          uid,
        ]
      );
      const ev = await evaluateInvestedEnterpriseCompetitorReadiness(row);
      res.json({
        success: true,
        message: '已保存补充信息',
        data: { supplement_id: id, readiness: ev },
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-supplement]', e);
      res.status(code).json({ success: false, message: e.message || '保存失败' });
    }
  });

  /** 发起竞品分析：项目挖掘权限；非 admin 仅本人创建的被投；异步跑批 */
  router.post('/invested-enterprises/:id/competitor-analysis-run', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const row = await getInvestedEnterpriseRowForCompetitor(req.params.id);
      assertInvestedEnterpriseCompetitorOwner(req, row);
      const exit = String(row.exit_status || '').trim();
      if (exit === '已退出') {
        return res.status(400).json({ success: false, message: '已退出企业不参与竞品分析' });
      }
      const ev = await evaluateInvestedEnterpriseCompetitorReadiness(row);
      if (!ev.ready) {
        return res.status(400).json({
          success: false,
          message: '信息不足，请先完成「竞品匹配—补充业务信息」',
          data: { readiness: ev },
        });
      }

      const force = req.body?.force === true || req.query.force === '1';
      const priorRunId = String(req.body?.prior_run_id || req.query.prior_run_id || '').trim();
      if (force && !req.body?.confirm_force) {
        return res.status(400).json({
          success: false,
          message: '覆盖重跑须传 confirm_force: true',
        });
      }
      if (force) {
        await db.execute(
          `UPDATE sourcing_competitor_relation SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
           WHERE invested_enterprise_id = ? AND subject_type = 'invested_enterprise' AND F_DeleteMark = 0`,
          [req.psUser?.id || null, String(row.F_Id)]
        );
      }

      const runId = await generateId('sourcing_competitor_run');
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const msg = '已受理竞品分析，后台召回与打分中，请稍后刷新查看结果';
      await db.execute(
        `INSERT INTO sourcing_competitor_run (
           F_Id, invested_enterprise_id, status, message, triggered_by_user_id, started_at,
           F_CreatorTime, F_LastModifyTime, F_DeleteMark
         ) VALUES (?,?,?,?,?,NOW(),NOW(),NOW(),0)`,
        [runId, String(row.F_Id), 'queued', msg, uid]
      );

      enqueueCompetitorAnalysisRun({
        subjectType: 'invested_enterprise',
        runId,
        investedEnterpriseId: String(row.F_Id),
        userId: uid,
        enableAutoExpand: req.body?.enable_auto_expand !== false,
      });

      res.status(202).json({
        success: true,
        message: msg,
        data: { run_id: runId, prior_run_id: priorRunId || null, client_ip: clientIpFromReq(req) },
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis-run]', e);
      res.status(code).json({ success: false, message: e.message || '受理失败' });
    }
  });

  /** 竞品分析步骤日志（库表，与控制台 [competitorRunner] 双写） */
  router.get('/competitor-analysis/runs/:runId/step-logs', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const runId = String(req.params.runId || '').trim();
      if (!runId) {
        return res.status(400).json({ success: false, message: '缺少 runId' });
      }
      const subjectType = String(req.query.subject_type || 'invested_enterprise').trim();
      if (subjectType === 'invested_enterprise') {
        const runs = await db.query(
          `SELECT invested_enterprise_id FROM sourcing_competitor_run
           WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
          [runId]
        );
        if (!runs.length) {
          return res.status(404).json({ success: false, message: '运行记录不存在' });
        }
        const row = await getInvestedEnterpriseRowForCompetitor(runs[0].invested_enterprise_id);
        assertInvestedEnterpriseCompetitorOwner(req, row);
      } else {
        const runs = await db.query(
          `SELECT p.F_CreatorUserId AS creator_user_id
           FROM sourcing_pre_investment_competitor_run r
           INNER JOIN pre_investment_project p ON p.F_Id = r.pre_investment_project_id
           WHERE r.F_Id = ? AND r.F_DeleteMark = 0 LIMIT 1`,
          [runId]
        );
        if (!runs.length) {
          return res.status(404).json({ success: false, message: '运行记录不存在' });
        }
        const uid = req.psUser?.id ? String(req.psUser.id) : '';
        if (!isAdminUser(req.psUser) && String(runs[0].creator_user_id) !== uid) {
          return res.status(403).json({ success: false, message: '仅创建人或管理员可查看' });
        }
      }
      const list = await listCompetitorRunStepLogs(runId);
      res.json({ success: true, data: { list } });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/step-logs]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
    }
  });

  /** 竞品分析 run 版本列表（被投企业或投前项目） */
  router.get('/competitor-analysis/runs', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const ieId = String(req.query.invested_enterprise_id || '').trim();
      const pipId = String(req.query.pre_investment_project_id || '').trim();
      if (!ieId && !pipId) {
        return res.status(400).json({
          success: false,
          message: '缺少 invested_enterprise_id 或 pre_investment_project_id',
        });
      }
      if (ieId && pipId) {
        return res.status(400).json({ success: false, message: '不能同时传 invested_enterprise_id 与 pre_investment_project_id' });
      }
      if (ieId) {
        const row = await getInvestedEnterpriseRowForCompetitor(ieId);
        assertInvestedEnterpriseCompetitorOwner(req, row);
        const list = await listInvestedEnterpriseCompetitorRuns(ieId);
        const latestRunId = await getLatestRunIdForInvestedEnterprise(ieId);
        return res.json({ success: true, data: { list, latest_run_id: latestRunId } });
      }
      const rows = await db.query(
        `SELECT F_Id AS id, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
        [pipId]
      );
      if (!rows.length || Number(rows[0].delete_mark) !== 0) {
        return res.status(404).json({ success: false, message: '投前项目不存在' });
      }
      const uid = req.psUser?.id ? String(req.psUser.id) : '';
      if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id) !== uid) {
        return res.status(403).json({ success: false, message: '仅创建人或管理员可查看' });
      }
      const list = await listPreInvestmentCompetitorRuns(pipId);
      const latestRunId = await getLatestRunIdForPreInvestmentProject(pipId);
      res.json({ success: true, data: { list, latest_run_id: latestRunId } });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/runs]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
    }
  });

  /** 竞品关系列表：项目挖掘权限；非 admin 仅本人创建的被投 */
  router.get('/competitor-analysis/relations', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const ieId = String(req.query.invested_enterprise_id || '').trim();
      const pipId = String(req.query.pre_investment_project_id || '').trim();
      const runId = String(req.query.run_id || '').trim();
      if (!ieId && !pipId) {
        return res.status(400).json({
          success: false,
          message: '缺少 invested_enterprise_id 或 pre_investment_project_id',
        });
      }
      if (ieId) {
        const row = await getInvestedEnterpriseRowForCompetitor(ieId);
        assertInvestedEnterpriseCompetitorOwner(req, row);
      } else {
        const rows = await db.query(
          `SELECT F_Id AS id, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
          [pipId]
        );
        if (!rows.length || Number(rows[0].delete_mark) !== 0) {
          const e = new Error('投前项目不存在');
          e.code = 404;
          throw e;
        }
        const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : '';
        if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id) !== uid) {
          const e = new Error('仅创建人或管理员可查看');
          e.code = 403;
          throw e;
        }
      }

      let list;
      if (ieId) {
        if (runId) {
          list = await db.query(
            `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
                    data_sources_json, financing_amount_text, financing_history_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    include_in_comparable, F_CreatorTime AS created_at
             FROM sourcing_competitor_relation
             WHERE invested_enterprise_id = ? AND run_id = ?
               AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
             LIMIT 200`,
            [ieId, runId]
          );
        } else {
          list = await db.query(
            `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
                    data_sources_json, financing_amount_text, financing_history_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    include_in_comparable, F_CreatorTime AS created_at
             FROM sourcing_competitor_relation
             WHERE invested_enterprise_id = ? AND F_DeleteMark = 0
               AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
             LIMIT 200`,
            [ieId]
          );
        }
      } else if (runId) {
        list = await db.query(
          `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                  pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                  relevance_score, confidence_grade, score_breakdown_json,
                  data_sources_json, financing_amount_text, financing_history_text,
                  competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                  include_in_comparable, F_CreatorTime AS created_at
           FROM sourcing_competitor_relation
           WHERE pre_investment_project_id = ? AND pre_investment_run_id = ?
             AND subject_type = 'pre_investment_project'
           ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
           LIMIT 200`,
          [pipId, runId]
        );
      } else {
        list = await db.query(
          `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                  pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                  relevance_score, confidence_grade, score_breakdown_json,
                  data_sources_json, financing_amount_text, financing_history_text,
                  competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                  include_in_comparable, F_CreatorTime AS created_at
           FROM sourcing_competitor_relation
           WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0
           ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
           LIMIT 200`,
          [pipId]
        );
      }
      const deduped = dedupeRelations(list);
      const hydrated = [];
      for (const row of deduped) {
        hydrated.push(await hydrateRelationRow(row));
      }
      const latestRunId = ieId
        ? await getLatestRunIdForInvestedEnterprise(ieId)
        : await getLatestRunIdForPreInvestmentProject(pipId);
      res.json({
        success: true,
        data: {
          list: hydrated,
          run_id: runId || latestRunId,
          latest_run_id: latestRunId,
        },
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/relations]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
    }
  });

  router.patch(
    '/competitor-analysis/relations/:relationId/comparable',
    requireCompetitorAnalysisAccess,
    async (req, res) => {
      try {
        const relationId = String(req.params.relationId || '').trim();
        const includeInComparable = !!req.body?.include_in_comparable;
        if (!relationId) {
          return res.status(400).json({ success: false, message: '缺少 relationId' });
        }
        const relRows = await db.query(
          `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id,
                  competitor_display_name, unified_credit_code, competitor_weak_key, F_DeleteMark AS delete_mark
           FROM sourcing_competitor_relation WHERE F_Id = ? LIMIT 1`,
          [relationId]
        );
        if (!relRows.length || Number(relRows[0].delete_mark) !== 0) {
          return res.status(404).json({ success: false, message: '竞品记录不存在' });
        }
        const rel = relRows[0];
        const userId = req.psUser?.id ? String(req.psUser.id) : null;
        const prefResult = await upsertComparablePrefForRelation(rel, includeInComparable, userId);
        await db.execute(
          `UPDATE sourcing_competitor_relation
           SET include_in_comparable = ?, F_LastModifyTime = NOW()
           WHERE F_Id = ? AND F_DeleteMark = 0`,
          [includeInComparable ? 1 : 0, relationId]
        );
        res.json({
          success: true,
          data: {
            id: relationId,
            include_in_comparable: includeInComparable ? 1 : 0,
            competitor_key: prefResult.competitor_key,
          },
        });
      } catch (e) {
        const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
        console.error('[competitor-analysis/relations/comparable]', e);
        res.status(code).json({ success: false, message: e.message || '更新失败' });
      }
    }
  );

  /** 竞品分析说明：流水线步骤 + 最终保留竞品及原因 */
  router.get('/competitor-analysis/summary', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const ieId = String(req.query.invested_enterprise_id || '').trim();
      const pipId = String(req.query.pre_investment_project_id || '').trim();
      if (!ieId && !pipId) {
        return res.status(400).json({
          success: false,
          message: '缺少 invested_enterprise_id 或 pre_investment_project_id',
        });
      }
      if (ieId) {
        const row = await getInvestedEnterpriseRowForCompetitor(ieId);
        assertInvestedEnterpriseCompetitorOwner(req, row);
      } else {
        const rows = await db.query(
          `SELECT F_Id AS id, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
          [pipId]
        );
        if (!rows.length || Number(rows[0].delete_mark) !== 0) {
          const e = new Error('投前项目不存在');
          e.code = 404;
          throw e;
        }
        const uid = req.psUser?.id ? String(req.psUser.id) : '';
        if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id) !== uid) {
          const e = new Error('仅创建人或管理员可查看');
          e.code = 403;
          throw e;
        }
      }
      const data = await buildCompetitorAnalysisSummary({
        subjectType: ieId ? 'invested_enterprise' : 'pre_investment_project',
        investedEnterpriseId: ieId || null,
        preInvestmentProjectId: pipId || null,
        runId: String(req.query.run_id || '').trim() || null,
      });
      res.json({ success: true, data });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/summary]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
    }
  });

  /** 管理员：按统一社会信用代码/名称将库内孤儿竞品数据 UPDATE 到当前被投 id */
  router.post('/competitor-analysis/relink-by-credit-code', requireAdmin, async (req, res) => {
    try {
      const creatorUserId = String(
        req.body?.creator_user_id || req.query.creator_user_id || ''
      ).trim();
      const dryRun =
        req.body?.dry_run === true ||
        req.query.dry_run === '1' ||
        req.query.dry_run === 'true';
      const stats = await relinkOrphanCompetitorDataBySubjectMatch({
        creatorUserId: creatorUserId || undefined,
        dryRun,
      });
      res.json({
        success: true,
        message: dryRun
          ? `预检：可重挂 ${stats.relinked} 组（孤儿旧 id ${stats.orphan_old_ids} 个，未解析 ${stats.unresolved}）`
          : `已重挂 ${stats.relinked} 组竞品数据到当前被投（未解析 ${stats.unresolved}）`,
        data: stats,
      });
    } catch (e) {
      console.error('[competitor-analysis/relink-by-credit-code]', e);
      res.status(500).json({ success: false, message: e.message || '重挂失败' });
    }
  });

  /** 管理员：按同步快照 batch_id 将竞品数据挂回当前被投（信用代码/名称/简称匹配） */
  router.post('/competitor-analysis/restore-sync-snapshot', requireAdmin, async (req, res) => {
    try {
      const batchId = String(req.body?.batch_id || req.query.batch_id || '').trim();
      const creatorUserId = String(
        req.body?.creator_user_id || req.psUser?.id || ''
      ).trim();
      if (!batchId) {
        return res.status(400).json({ success: false, message: '缺少 batch_id' });
      }
      if (!creatorUserId) {
        return res.status(400).json({ success: false, message: '缺少 creator_user_id' });
      }
      const restored = await restoreCompetitorDataAfterInsert(
        batchId,
        creatorUserId,
        CA_C.APP_NAME_COMPETITOR_ANALYSIS
      );
      res.json({
        success: true,
        message: `已恢复 ${restored.subjects || 0} 家主体的竞品数据（关系 ${restored.relations || 0} 条）`,
        data: restored,
      });
    } catch (e) {
      console.error('[competitor-analysis/restore-sync-snapshot]', e);
      res.status(500).json({ success: false, message: e.message || '恢复失败' });
    }
  });

  /** 竞品导出可选年度（项目编号前四位） */
  router.get('/competitor-analysis/export/years', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const subjectType = String(req.query.subject_type || 'invested_enterprise').trim();
      const years =
        subjectType === 'pre_investment_project'
          ? await listPreInvestmentYears(req.psUser, isAdminUser(req.psUser))
          : await listInvestedEnterpriseYears(req.psUser, isAdminUser(req.psUser));
      res.json({ success: true, data: { years } });
    } catch (e) {
      console.error('[project-sourcing/competitor-analysis/export/years]', e);
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  /** 竞品明细 Excel 导出：多选被投或全量；按项目简称分 Sheet */
  router.post('/competitor-analysis/export', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const subjectType = String(req.body?.subject_type || 'invested_enterprise').trim();
      const exportAll = req.body?.export_all === true || req.body?.exportAll === true;
      const exportBatchMode = String(req.body?.export_batch_mode || req.body?.exportBatchMode || 'latest').trim();
      const batchModeAll = exportBatchMode === 'all';
      const ieIds = Array.isArray(req.body?.invested_enterprise_ids)
        ? req.body.invested_enterprise_ids.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const pipIds = Array.isArray(req.body?.pre_investment_project_ids)
        ? req.body.pre_investment_project_ids.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const years = Array.isArray(req.body?.years)
        ? req.body.years.map((x) => String(x).trim()).filter((y) => /^\d{4}$/.test(y))
        : String(req.body?.years || '')
            .split(/[,，]/)
            .map((x) => x.trim())
            .filter((y) => /^\d{4}$/.test(y));

      const isPre = subjectType === 'pre_investment_project';
      const ids = isPre ? pipIds : ieIds;

      if (!exportAll && !ids.length) {
        return res.status(400).json({
          success: false,
          message: isPre ? '请勾选投前项目或选择全量导出' : '请勾选被投企业或选择全量导出',
        });
      }

      if (!exportAll) {
        if (isPre) {
          const uid = req.psUser?.id ? String(req.psUser.id) : '';
          for (const pipId of pipIds) {
            const rows = await db.query(
              `SELECT F_Id AS id, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
              [pipId]
            );
            if (!rows.length || Number(rows[0].delete_mark) !== 0) {
              const e = new Error('投前项目不存在');
              e.code = 404;
              throw e;
            }
            if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id) !== uid) {
              const e = new Error('仅创建人或管理员可导出');
              e.code = 403;
              throw e;
            }
          }
        } else {
          for (const ieId of ieIds) {
            const row = await getInvestedEnterpriseRowForCompetitor(ieId);
            assertInvestedEnterpriseCompetitorOwner(req, row);
          }
        }
      } else if (!isAdminUser(req.psUser)) {
        const e = new Error('全量导出仅限管理员操作；非管理员请勾选具体项目后导出');
        e.code = 403;
        throw e;
      }

      const buf = await exportCompetitorRelationsToBuffer({
        subjectType,
        investedEnterpriseIds: ieIds,
        preInvestmentProjectIds: pipIds,
        exportAll,
        exportBatchMode: batchModeAll ? 'all' : 'latest',
        years,
        psUser: req.psUser,
        isAdmin: isAdminUser(req.psUser),
      });
      const label = isPre ? '投前竞品' : '竞品分析';
      const batchSuffix = !exportAll && batchModeAll ? '_所有批次' : '';
      const filename = encodeURIComponent(
        exportAll
          ? `${label}导出_全量_${new Date().toISOString().slice(0, 10)}.xlsx`
          : `${label}导出_${ids.length}项${batchSuffix}.xlsx`
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"; filename*=UTF-8''${filename}`
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.send(buf);
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/export]', e);
      res.status(code).json({ success: false, message: e.message || '导出失败' });
    }
  });

  /** 投前项目列表：项目挖掘权限；admin 看全部，其余仅看自己创建 */
  router.get('/pre-investment-projects', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
      const offset = (page - 1) * pageSize;
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const admin = isAdminUser(req.psUser);
      const countRows = await db.query(
        admin
          ? `SELECT COUNT(*) AS c FROM pre_investment_project WHERE F_DeleteMark = 0`
          : `SELECT COUNT(*) AS c FROM pre_investment_project WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?`,
        admin ? [] : [uid]
      );
      const total = Number(countRows[0]?.c || 0);
      const list = await db.query(
        admin
          ? `SELECT F_Id AS id, project_no, enterprise_full_name, unified_credit_code, project_abbreviation, pipeline_status, pipeline_error,
                    qcc_company_intro, ai_product_intro, ai_industry_tags_display, ai_enrich_status, bp_filename, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at, F_CreatorUserId AS creator_user_id
             FROM pre_investment_project
             WHERE F_DeleteMark = 0
             ORDER BY F_LastModifyTime DESC
             LIMIT ? OFFSET ?`
          : `SELECT F_Id AS id, project_no, enterprise_full_name, unified_credit_code, project_abbreviation, pipeline_status, pipeline_error,
                    qcc_company_intro, ai_product_intro, ai_industry_tags_display, ai_enrich_status, bp_filename, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at, F_CreatorUserId AS creator_user_id
             FROM pre_investment_project
             WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?
             ORDER BY F_LastModifyTime DESC
             LIMIT ? OFFSET ?`,
        admin ? [pageSize, offset] : [uid, pageSize, offset]
      );
      // 修复 bp_filename 中文编码（历史数据可能因 Windows multer Latin-1 解析导致乱码）
      for (const row of list) {
        if (row.bp_filename) {
          try {
            const fixed = Buffer.from(row.bp_filename, 'latin1').toString('utf-8');
            if (fixed !== row.bp_filename && /[\u4e00-\u9fff]/.test(fixed)) {
              row.bp_filename = fixed;
            }
          } catch { /* keep original */ }
        }
      }
      res.json({ success: true, data: { list, total, page, pageSize } });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects GET]', e);
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });

  /** 投前：按简称/关键词调企查查模糊搜索，回填企业全称与统一社会信用代码（不落库） */
  router.post('/pre-investment-projects/qcc-fuzzy-lookup', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const kw = String(req.body?.search_key ?? req.body?.keyword ?? '').trim();
      if (kw.length < 2) {
        return res.status(400).json({ success: false, message: '搜索关键词至少 2 个字符' });
      }
      const out = await fetchQichachaFuzzyCompanies(kw, { pageIndex: 1 });
      const first = out.companies[0];
      const candidates = out.companies.slice(0, 10).map((c) => ({
        enterprise_full_name: String(c.name || '').trim(),
        unified_credit_code: String(c.creditCode || '')
          .replace(/\s+/g, '')
          .trim(),
      }));
      res.json({
        success: true,
        data: {
          enterprise_full_name: first ? String(first.name || '').trim() : '',
          unified_credit_code: first
            ? String(first.creditCode || '')
                .replace(/\s+/g, '')
                .trim()
            : '',
          total: out.companies.length,
          candidates,
        },
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 'NO_CONFIG' ? 400 : 500;
      console.error('[project-sourcing/pre-investment-projects/qcc-fuzzy-lookup]', e);
      res.status(code).json({ success: false, message: e.message || '企查查查询失败' });
    }
  });

  /**
   * 修复 multer originalname 在 Windows 上的编码问题。
   * Windows 下 multer 以 Latin-1 解析 multipart header 中的 UTF-8 字节，导致中文文件名乱码。
   */
  function fixMulterOriginalName(raw) {
    if (!raw || typeof raw !== 'string') return raw || 'bp';
    try {
      return Buffer.from(raw, 'latin1').toString('utf-8');
    } catch {
      return raw;
    }
  }

  /** 新建投前项目（最小字段，支持上传 BP 文件） */
  const bpUpload = multer({ storage: multer.memoryStorage() });
  router.post('/pre-investment-projects', requireCompetitorAnalysisAccess, bpUpload.single('bp_file'), async (req, res) => {
    try {
      const name = String(req.body?.enterprise_full_name || '').trim();
      if (!name || name.length < 2) {
        return res.status(400).json({ success: false, message: '请填写企业全称（至少2字）' });
      }
      const credit = String(req.body?.unified_credit_code || '').trim() || null;
      const abbrev = String(req.body?.project_abbreviation || '').trim() || null;
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      if (!uid) {
        return res.status(401).json({ success: false, message: '未登录' });
      }
      const projectNo = await allocPreProjectNo(req.body?.project_no);
      const id = await generateId('pre_investment_project');

      // 处理 BP 文件上传
      let bpFilename = null;
      let bpFilePath = null;
      let bpAbsoluteDiskPath = null;
      if (req.file && req.file.buffer && req.file.buffer.length > 0) {
        const bpDir = ensureUploadsSubDir(BP_UPLOAD_SUBDIR);
        const originalName = fixMulterOriginalName(req.file.originalname);
        // 磁盘文件名仅保留 ASCII 字符（扩展名），避免中文路径导致 MarkItDown 子进程编码问题
        const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
        const diskName = `${projectNo}_${Date.now()}${ext}`;
        const fullPath = path.join(bpDir, diskName);
        fs.writeFileSync(fullPath, req.file.buffer);
        bpFilename = originalName;
        bpFilePath = path.join(BP_UPLOAD_SUBDIR, diskName);
        bpAbsoluteDiskPath = fullPath;
      }

      await db.execute(
        `INSERT INTO pre_investment_project (
           F_Id, enterprise_full_name, unified_credit_code, project_abbreviation, project_no, pipeline_status,
           bp_filename, bp_file_path,
           data_app_id, data_app_name, F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
        [
          id,
          name,
          credit,
          abbrev,
          projectNo,
          'draft',
          bpFilename,
          bpFilePath,
          CA_C.COMPETITOR_ANALYSIS_APP_ID,
          CA_C.APP_NAME_COMPETITOR_ANALYSIS,
          uid,
        ]
      );

      // 异步调用 MarkItDown 转换 BP 文件（不阻塞响应）
      if (bpAbsoluteDiskPath) {
        setImmediate(() => {
          processBpFile({ absolutePath: bpAbsoluteDiskPath, projectId: id })
            .then((result) => {
              if (result.success) {
                console.log(`[bpFileParser] MarkItDown 转换完成: ${bpFilename} → ${result.markdownText?.length || 0} 字符`);
              } else {
                console.warn(`[bpFileParser] MarkItDown 转换失败: ${bpFilename} - ${result.error}`);
              }
            })
            .catch((err) => {
              console.error(`[bpFileParser] MarkItDown 转换异常: ${bpFilename}`, err);
            });
        });
      }

      res.json({ success: true, data: { id, project_no: projectNo } });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects POST]', e);
      res.status(500).json({ success: false, message: e.message || '创建失败' });
    }
  });

  /** 投前：人工编辑 AI 简介/标签、企查查介绍，支持上传 BP 文件 */
  const editBpUpload = multer({ storage: multer.memoryStorage() });
  router.put('/pre-investment-projects/:id', requireCompetitorAnalysisAccess, editBpUpload.single('bp_file'), async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      await loadPreInvestmentProjectForWrite(req, id);

      const hasAiIntro = Object.prototype.hasOwnProperty.call(req.body, 'ai_product_intro');
      const hasAiTags = Object.prototype.hasOwnProperty.call(req.body, 'ai_industry_tags');
      const hasQcc = Object.prototype.hasOwnProperty.call(req.body, 'qcc_company_intro');
      const hasBpFile = !!(req.file && req.file.buffer && req.file.buffer.length > 0);
      if (!hasAiIntro && !hasAiTags && !hasQcc && !hasBpFile) {
        return res.status(400).json({ success: false, message: '请至少提交一个可编辑字段' });
      }

      const sets = [];
      const params = [];

      if (hasAiIntro) {
        sets.push('ai_product_intro = ?');
        params.push(nullableLongText(req.body.ai_product_intro));
      }
      if (hasAiTags) {
        const { display, json } = parseManualIndustryTagsInput(req.body.ai_industry_tags);
        sets.push('ai_industry_tags_display = ?', 'ai_industry_tags_json = ?');
        params.push(display, json);
      }
      if (hasQcc) {
        sets.push('qcc_company_intro = ?', 'qcc_sync_error = NULL');
        params.push(nullableLongText(req.body.qcc_company_intro));
      }

      // 处理 BP 文件上传（编辑模式）
      let bpAbsoluteDiskPath = null;
      if (hasBpFile) {
        const existingRow = await db.query(
          `SELECT project_no FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
          [id]
        );
        const projectNo = existingRow[0]?.project_no || 'P00000000';
        const bpDir = ensureUploadsSubDir(BP_UPLOAD_SUBDIR);
        const originalName = fixMulterOriginalName(req.file.originalname);
        const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
        const diskName = `${projectNo}_${Date.now()}${ext}`;
        const fullPath = path.join(bpDir, diskName);
        fs.writeFileSync(fullPath, req.file.buffer);
        bpAbsoluteDiskPath = fullPath;
        sets.push('bp_filename = ?', 'bp_file_path = ?');
        params.push(originalName, path.join(BP_UPLOAD_SUBDIR, diskName));
      }

      sets.push('F_LastModifyTime = NOW()');
      if (hasAiIntro || hasAiTags) {
        sets.push('ai_enrich_error = NULL');
      }

      await db.execute(
        `UPDATE pre_investment_project SET ${sets.join(', ')} WHERE F_Id = ? AND F_DeleteMark = 0`,
        [...params, id]
      );

      // 异步调用 MarkItDown 转换 BP 文件（不阻塞响应）
      if (bpAbsoluteDiskPath) {
        const bpFileName = fixMulterOriginalName(req.file.originalname);
        setImmediate(() => {
          processBpFile({ absolutePath: bpAbsoluteDiskPath, projectId: id })
            .then((result) => {
              if (result.success) {
                console.log(`[bpFileParser/edit] MarkItDown 转换完成: ${bpFileName} → ${result.markdownText?.length || 0} 字符`);
              } else {
                console.warn(`[bpFileParser/edit] MarkItDown 转换失败: ${bpFileName} - ${result.error}`);
              }
            })
            .catch((err) => {
              console.error(`[bpFileParser/edit] MarkItDown 转换异常: ${bpFileName}`, err);
            });
        });
      }

      const refreshed = await db.query(
        `SELECT F_Id AS id, project_no, enterprise_full_name, ai_product_intro, ai_industry_tags_display,
                qcc_company_intro, pipeline_status, ai_enrich_status, bp_filename
         FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
        [id]
      );

      // 修复 bp_filename 编码（返回给前端前统一处理）
      const respData = refreshed[0] || { id };
      if (respData.bp_filename) {
        try {
          const fixed = Buffer.from(respData.bp_filename, 'latin1').toString('utf-8');
          if (fixed !== respData.bp_filename && /[\u4e00-\u9fff]/.test(fixed)) {
            respData.bp_filename = fixed;
          }
        } catch { /* keep original */ }
      }

      res.json({
        success: true,
        message: '已保存',
        data: respData,
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/pre-investment-projects PUT]', e);
      res.status(code).json({ success: false, message: e.message || '保存失败' });
    }
  });

  /** 投前：逻辑删除 */
  router.delete('/pre-investment-projects/:id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      await loadPreInvestmentProjectForWrite(req, id);
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;

      await db.execute(
        `UPDATE sourcing_competitor_relation
         SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
         WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0`,
        [uid, id]
      );

      await db.execute(
        `UPDATE pre_investment_project
         SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ? AND F_DeleteMark = 0`,
        [uid, id]
      );

      res.json({ success: true, message: '已删除' });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/pre-investment-projects DELETE]', e);
      res.status(code).json({ success: false, message: e.message || '删除失败' });
    }
  });

  /** 投前：企查查简介写库 */
  router.post('/pre-investment-projects/:id/qcc-company-brief', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const rows = await db.query(
        `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark
         FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length || Number(rows[0].delete_mark) !== 0) {
        return res.status(404).json({ success: false, message: '记录不存在' });
      }
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id) !== String(uid)) {
        return res.status(403).json({ success: false, message: '仅创建人或管理员可同步' });
      }
      const creditNorm = normalizeUnifiedCreditCode(rows[0].unified_credit_code);
      const name = rows[0].enterprise_full_name != null ? String(rows[0].enterprise_full_name).trim() : '';
      const searchKey =
        creditNorm.length >= 2 ? creditNorm : name.length >= 2 ? name : '';
      if (!searchKey) {
        return res.status(400).json({ success: false, message: '须填写统一社会信用代码或企业全称以便查询' });
      }
      if (isCrossTableUnifiedCredit(creditNorm)) {
        const one = await runUnifiedCreditQccSync(creditNorm);
        return res.json({
          success: true,
          message: one.desc_len
            ? `已写入企查查简介（三表对齐），共 ${one.desc_len} 字`
            : '企查查无简介正文（三表已对齐）',
          data: { desc_len: one.desc_len, sync_source: one.source },
        });
      }
      const r = await fetchCompanyBriefGetInfo(searchKey);
      const desc = r.desc;
      const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;
      await db.execute(
        `UPDATE pre_investment_project SET qcc_company_intro = ?, qcc_sync_at = NOW(), qcc_sync_error = NULL,
           pipeline_status = 'qcc_done', pipeline_error = NULL, F_LastModifyTime = NOW()
         WHERE F_Id = ? AND F_DeleteMark = 0`,
        [intro, id]
      );
      res.json({
        success: true,
        message: intro ? `已写入企查查简介，共 ${intro.length} 字` : '企查查无简介正文',
        data: { desc_len: intro ? intro.length : 0 },
      });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects/qcc]', e);
      res.status(500).json({ success: false, message: e.message || '同步失败' });
    }
  });

  /** 投前：从 BP 文件提取产品介绍和企业标签（同步，用于创建后 pipeline） */
  router.post('/pre-investment-projects/:id/bp-extract', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, message: '缺少项目 ID' });
      }
      const result = await extractBpForProject(id);
      res.json({ success: true, data: result });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects/bp-extract]', e);
      res.status(500).json({ success: false, message: e.message || 'BP 提取失败' });
    }
  });

  /** 投前：手动 AI 取数（产品介绍 / 行业标签，异步） */
  router.post('/pre-investment-projects/:id/ai-enrich', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const r = await enqueueManualPreInvestmentProjectAiEnrich({
        preProjectId: id,
        triggeredByUserId: uid,
        clientIp: clientIpFromReq(req),
        psUser: req.psUser,
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
      console.error('[project-sourcing/pre-investment-projects/ai-enrich]', e);
      res.status(500).json({ success: false, message: e.message || '受理失败' });
    }
  });

  /** 投前：发起竞品分析（异步跑批，落库 sourcing_competitor_relation） */
  router.post('/pre-investment-projects/:id/competitor-analysis-run', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const rows = await db.query(
        `SELECT F_Id AS id, enterprise_full_name, unified_credit_code, project_abbreviation, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark,
                ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro
         FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length || Number(rows[0].delete_mark) !== 0) {
        return res.status(404).json({ success: false, message: '记录不存在' });
      }
      const row = rows[0];
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      if (!isAdminUser(req.psUser) && String(row.creator_user_id) !== String(uid)) {
        return res.status(403).json({ success: false, message: '仅创建人或管理员可发起竞品分析' });
      }
      const ev = await evaluatePreInvestmentReadiness(row);
      if (!ev.ready) {
        return res.status(400).json({
          success: false,
          message: '信息不足，请先完成企查查同步与 AI 取数',
          data: { readiness: ev },
        });
      }
      const force = req.body?.force === true;
      if (force && !req.body?.confirm_force) {
        return res.status(400).json({
          success: false,
          message: '覆盖重跑须传 confirm_force: true',
        });
      }
      if (force) {
        await db.execute(
          `UPDATE sourcing_competitor_relation SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
           WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0`,
          [uid, id]
        );
      }

      const runId = await generateId('sourcing_pre_investment_competitor_run');
      const msg = '已受理投前竞品分析，后台处理中，请稍后刷新查看';
      await db.execute(
        `INSERT INTO sourcing_pre_investment_competitor_run (
           F_Id, pre_investment_project_id, status, message, triggered_by_user_id, started_at,
           F_CreatorTime, F_LastModifyTime, F_DeleteMark
         ) VALUES (?,?,?,?,?,NOW(),NOW(),NOW(),0)`,
        [runId, id, 'queued', msg, uid]
      );

      enqueueCompetitorAnalysisRun({
        subjectType: 'pre_investment_project',
        runId,
        preInvestmentProjectId: id,
        preInvestmentRunId: runId,
        userId: uid,
        enableAutoExpand: req.body?.enable_auto_expand !== false,
      });

      res.status(202).json({
        success: true,
        message: msg,
        data: { run_id: runId, client_ip: clientIpFromReq(req) },
      });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects/competitor-analysis-run]', e);
      res.status(500).json({ success: false, message: e.message || '受理失败' });
    }
  });
}

module.exports = { registerCompetitorMatchRoutes };
