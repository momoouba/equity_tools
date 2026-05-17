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
const CA_C = require('../../utils/竞品分析/constants');

function clientIpFromReq(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf && typeof xf === 'string') {
    const first = xf.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  if (req.ip) return String(req.ip).slice(0, 64);
  return null;
}

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
      `SELECT id FROM pre_investment_project WHERE delete_mark = 0 AND project_no = ? LIMIT 1`,
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
    if (String(row.creator_user_id || '') !== uid) {
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
    `SELECT id, enterprise_full_name, project_no, creator_user_id, delete_mark
     FROM pre_investment_project WHERE id = ? LIMIT 1`,
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
           id, invested_enterprise_id, user_tags_json, user_narrative_raw, ai_extracted_tags_json, ai_short_summary,
           batch_id, created_by, created_at, updated_at, delete_mark
         ) VALUES (?,?,?,?,?,?,NULL,?,NOW(),NOW(),0)`,
        [
          id,
          String(row.id),
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
          `UPDATE sourcing_competitor_relation SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
           WHERE invested_enterprise_id = ? AND subject_type = 'invested_enterprise' AND delete_mark = 0`,
          [req.psUser?.id || null, String(row.id)]
        );
      }

      const runId = await generateId('sourcing_competitor_run');
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      const msg = '已受理竞品分析，后台召回与打分中，请稍后刷新查看结果';
      await db.execute(
        `INSERT INTO sourcing_competitor_run (
           id, invested_enterprise_id, status, message, triggered_by_user_id, started_at,
           created_at, updated_at, delete_mark
         ) VALUES (?,?,?,?,?,NOW(),NOW(),NOW(),0)`,
        [runId, String(row.id), 'queued', msg, uid]
      );

      enqueueCompetitorAnalysisRun({
        subjectType: 'invested_enterprise',
        runId,
        investedEnterpriseId: String(row.id),
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
           WHERE id = ? AND delete_mark = 0 LIMIT 1`,
          [runId]
        );
        if (!runs.length) {
          return res.status(404).json({ success: false, message: '运行记录不存在' });
        }
        const row = await getInvestedEnterpriseRowForCompetitor(runs[0].invested_enterprise_id);
        assertInvestedEnterpriseCompetitorOwner(req, row);
      } else {
        const runs = await db.query(
          `SELECT p.creator_user_id
           FROM sourcing_pre_investment_competitor_run r
           INNER JOIN pre_investment_project p ON p.id = r.pre_investment_project_id
           WHERE r.id = ? AND r.delete_mark = 0 LIMIT 1`,
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

  /** 竞品关系列表：项目挖掘权限；非 admin 仅本人创建的被投 */
  router.get('/competitor-analysis/relations', requireCompetitorAnalysisAccess, async (req, res) => {
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
          `SELECT id, creator_user_id, delete_mark FROM pre_investment_project WHERE id = ? LIMIT 1`,
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
      const list = ieId
        ? await db.query(
            `SELECT id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
                    data_sources_json, financing_amount_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    created_at
             FROM sourcing_competitor_relation
             WHERE invested_enterprise_id = ? AND delete_mark = 0
               AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             ORDER BY relevance_score DESC, created_at DESC
             LIMIT 200`,
            [ieId]
          )
        : await db.query(
            `SELECT id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
                    data_sources_json, financing_amount_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    created_at
             FROM sourcing_competitor_relation
             WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND delete_mark = 0
             ORDER BY relevance_score DESC, created_at DESC
             LIMIT 200`,
            [pipId]
          );
      const deduped = dedupeRelations(list);
      const hydrated = [];
      for (const row of deduped) {
        hydrated.push(await hydrateRelationRow(row));
      }
      res.json({ success: true, data: { list: hydrated } });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/relations]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
    }
  });

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
          `SELECT id, creator_user_id, delete_mark FROM pre_investment_project WHERE id = ? LIMIT 1`,
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
      });
      res.json({ success: true, data });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/summary]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
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
              `SELECT id, creator_user_id, delete_mark FROM pre_investment_project WHERE id = ? LIMIT 1`,
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
      }

      const buf = await exportCompetitorRelationsToBuffer({
        subjectType,
        investedEnterpriseIds: ieIds,
        preInvestmentProjectIds: pipIds,
        exportAll,
        years,
        psUser: req.psUser,
        isAdmin: isAdminUser(req.psUser),
      });
      const label = isPre ? '投前竞品' : '竞品分析';
      const filename = encodeURIComponent(
        exportAll
          ? `${label}导出_全量_${new Date().toISOString().slice(0, 10)}.xlsx`
          : `${label}导出_${ids.length}项.xlsx`
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
          ? `SELECT COUNT(*) AS c FROM pre_investment_project WHERE delete_mark = 0`
          : `SELECT COUNT(*) AS c FROM pre_investment_project WHERE delete_mark = 0 AND creator_user_id = ?`,
        admin ? [] : [uid]
      );
      const total = Number(countRows[0]?.c || 0);
      const list = await db.query(
        admin
          ? `SELECT id, project_no, enterprise_full_name, unified_credit_code, project_abbreviation, pipeline_status, pipeline_error,
                    qcc_company_intro, ai_product_intro, ai_industry_tags_display, ai_enrich_status, created_at, updated_at, creator_user_id
             FROM pre_investment_project
             WHERE delete_mark = 0
             ORDER BY updated_at DESC
             LIMIT ? OFFSET ?`
          : `SELECT id, project_no, enterprise_full_name, unified_credit_code, project_abbreviation, pipeline_status, pipeline_error,
                    qcc_company_intro, ai_product_intro, ai_industry_tags_display, ai_enrich_status, created_at, updated_at, creator_user_id
             FROM pre_investment_project
             WHERE delete_mark = 0 AND creator_user_id = ?
             ORDER BY updated_at DESC
             LIMIT ? OFFSET ?`,
        admin ? [pageSize, offset] : [uid, pageSize, offset]
      );
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

  /** 新建投前项目（最小字段） */
  router.post('/pre-investment-projects', requireCompetitorAnalysisAccess, async (req, res) => {
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
      await db.execute(
        `INSERT INTO pre_investment_project (
           id, enterprise_full_name, unified_credit_code, project_abbreviation, project_no, pipeline_status,
           data_app_id, data_app_name, creator_user_id, created_at, updated_at, delete_mark
         ) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
        [
          id,
          name,
          credit,
          abbrev,
          projectNo,
          'draft',
          CA_C.COMPETITOR_ANALYSIS_APP_ID,
          CA_C.APP_NAME_COMPETITOR_ANALYSIS,
          uid,
        ]
      );
      res.json({ success: true, data: { id, project_no: projectNo } });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects POST]', e);
      res.status(500).json({ success: false, message: e.message || '创建失败' });
    }
  });

  /** 投前：人工编辑 AI 简介/标签、企查查介绍 */
  router.put('/pre-investment-projects/:id', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      await loadPreInvestmentProjectForWrite(req, id);

      const hasAiIntro = Object.prototype.hasOwnProperty.call(req.body, 'ai_product_intro');
      const hasAiTags = Object.prototype.hasOwnProperty.call(req.body, 'ai_industry_tags');
      const hasQcc = Object.prototype.hasOwnProperty.call(req.body, 'qcc_company_intro');
      if (!hasAiIntro && !hasAiTags && !hasQcc) {
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

      sets.push('updated_at = NOW()');
      if (hasAiIntro || hasAiTags) {
        sets.push('ai_enrich_error = NULL');
      }

      await db.execute(
        `UPDATE pre_investment_project SET ${sets.join(', ')} WHERE id = ? AND delete_mark = 0`,
        [...params, id]
      );

      const refreshed = await db.query(
        `SELECT id, project_no, enterprise_full_name, ai_product_intro, ai_industry_tags_display,
                qcc_company_intro, pipeline_status, ai_enrich_status
         FROM pre_investment_project WHERE id = ? AND delete_mark = 0 LIMIT 1`,
        [id]
      );

      res.json({
        success: true,
        message: '已保存',
        data: refreshed[0] || { id },
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
         SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?, updated_at = NOW()
         WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND delete_mark = 0`,
        [uid, id]
      );

      await db.execute(
        `UPDATE pre_investment_project
         SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?, updated_at = NOW()
         WHERE id = ? AND delete_mark = 0`,
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
        `SELECT id, enterprise_full_name, unified_credit_code, creator_user_id, delete_mark
         FROM pre_investment_project WHERE id = ? LIMIT 1`,
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
           pipeline_status = 'qcc_done', pipeline_error = NULL, updated_at = NOW()
         WHERE id = ? AND delete_mark = 0`,
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
        `SELECT id, enterprise_full_name, unified_credit_code, project_abbreviation, creator_user_id, delete_mark,
                ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro
         FROM pre_investment_project WHERE id = ? LIMIT 1`,
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
          `UPDATE sourcing_competitor_relation SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
           WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND delete_mark = 0`,
          [uid, id]
        );
      }

      const runId = await generateId('sourcing_pre_investment_competitor_run');
      const msg = '已受理投前竞品分析，后台处理中，请稍后刷新查看';
      await db.execute(
        `INSERT INTO sourcing_pre_investment_competitor_run (
           id, pre_investment_project_id, status, message, triggered_by_user_id, started_at,
           created_at, updated_at, delete_mark
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
