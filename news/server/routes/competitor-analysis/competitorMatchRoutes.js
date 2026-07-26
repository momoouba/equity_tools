const {
  applyRelationReview,
  loadRelationRowFull,
} = require('../../utils/competitor-analysis/competitorRelationReviewService');
const { buildEvidenceMeta } = require('../../utils/competitor-analysis/competitorEvidenceUtils');
const { generateId } = require('../../utils/idGenerator');
const db = require('../../db');
const {
  requireAdmin,
  requireCompetitorAnalysisAccess,
  isAdminUser,
} = require('../../utils/competitor-analysis/competitorAnalysisRouteAuth');
const { extractCompetitorSupplementTagsFromNarrative } = require('../../utils/project-sourcing/financingAiEnrichService');
const {
  evaluateInvestedEnterpriseCompetitorReadiness,
  getInvestedEnterpriseRowForCompetitor,
  loadLatestSupplementTags,
} = require('../../utils/competitor-analysis/competitorMatchReadinessService');
const { mergeTagArrays } = require('../../utils/competitor-analysis/competitorMatchUtils');
const { fetchCompanyBriefGetInfo } = require('../../utils/qichachaCompanyBrief');
const { fetchQichachaFuzzyCompanies } = require('../../utils/qichachaFuzzySearch');
const {
  isCrossTableUnifiedCredit,
  normalizeUnifiedCreditCode,
  runUnifiedCreditQccSync,
} = require('../../utils/competitor-analysis/competitorQccCrossTableSync');
const { enqueueManualPreInvestmentProjectAiEnrich } = require('../../utils/competitor-analysis/preInvestmentProjectAiEnrichService');
const {
  enqueueCompetitorAnalysisRun,
  evaluatePreInvestmentReadiness,
  listCompetitorRunStepLogs,
  buildTargetProfile,
} = require('../../utils/competitor-analysis/competitorAnalysisRunner');
const {
  proposeCompetitionLens,
  mergeProposalWithSaved,
  loadSavedCompetitionLens,
  saveCompetitionLensVersion,
} = require('../../utils/competitor-analysis/competitionLensService');
const { attachStrategyToTarget } = require('../../utils/competitor-analysis/industry-strategies');
const {
  exportCompetitorRelationsToBuffer,
  listInvestedEnterpriseYears,
  listPreInvestmentYears,
} = require('../../utils/competitor-analysis/competitorMatchExport');
const {
  buildCompetitorAnalysisSummary,
  dedupeRelations,
  hydrateRelationRow,
} = require('../../utils/competitor-analysis/competitorAnalysisSummaryService');
const {
  upsertComparablePrefForRelation,
} = require('../../utils/competitor-analysis/competitorComparablePrefService');
const {
  listInvestedEnterpriseCompetitorRuns,
  getLatestRunIdForInvestedEnterprise,
  listPreInvestmentCompetitorRuns,
  getLatestRunIdForPreInvestmentProject,
} = require('../../utils/competitor-analysis/competitorRunVersionService');
const CA_C = require('../../utils/competitor-analysis/constants');
const {
  restoreCompetitorDataAfterInsert,
  relinkOrphanCompetitorDataBySubjectMatch,
} = require('../../utils/competitor-analysis/competitorSyncSnapshot');
const { clientIpFromReq } = require('../../utils/competitor-analysis/competitorRouteUtils');
const { normalizeCreditCode, strTrim } = require('../../utils/competitor-analysis/competitorMatchUtils');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureUploadsSubDir } = require('../../utils/uploadsPath');

// BP 文件上传子目录（相对 uploads 根目录），使用 ASCII 避免 MarkItDown 中文路径编码问题
const BP_UPLOAD_SUBDIR = path.join('competitor-analysis', 'bp');
const { processBpFile, extractBpForProject } = require('../../utils/competitor-analysis/bpFileParser');

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
  if (!row) {
    const e = new Error('企业记录不存在');
    e.code = 404;
    throw e;
  }
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

async function loadCompetitorRelationForWrite(req, relationId) {
  const id = String(relationId || '').trim();
  if (!id) {
    const e = new Error('缺少 relationId');
    e.code = 400;
    throw e;
  }
  const rows = await db.query(
    `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id,
            F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark
     FROM sourcing_competitor_relation WHERE F_Id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].delete_mark) !== 0) {
    const e = new Error('竞品记录不存在');
    e.code = 404;
    throw e;
  }
  const rel = rows[0];
  if (rel.invested_enterprise_id) {
    const row = await getInvestedEnterpriseRowForCompetitor(rel.invested_enterprise_id);
    assertInvestedEnterpriseCompetitorOwner(req, row);
  } else if (rel.pre_investment_project_id) {
    await loadPreInvestmentProjectForWrite(req, rel.pre_investment_project_id);
  } else {
    const e = new Error('无效的主体');
    e.code = 400;
    throw e;
  }
  const uid = req.psUser?.id ? String(req.psUser.id) : '';
  if (
    rel.creator_user_id &&
    !isAdminUser(req.psUser) &&
    String(rel.creator_user_id) !== uid
  ) {
    const e = new Error('仅创建人或管理员可编辑或删除');
    e.code = 403;
    throw e;
  }
  return rel;
}

async function loadCompetitorRelationForReview(req, relationId) {
  const rel = await loadRelationRowFull(relationId);
  if (!rel || Number(rel.delete_mark) !== 0) {
    const e = new Error('竞品记录不存在');
    e.code = 404;
    throw e;
  }
  if (rel.invested_enterprise_id) {
    const row = await getInvestedEnterpriseRowForCompetitor(rel.invested_enterprise_id);
    assertInvestedEnterpriseCompetitorOwner(req, row);
  } else if (rel.pre_investment_project_id) {
    await loadPreInvestmentProjectForWrite(req, rel.pre_investment_project_id);
  } else {
    const e = new Error('无效的主体');
    e.code = 400;
    throw e;
  }
  return rel;
}

function parseCompetitionLensBody(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.competition_lens || body.competitionLens || null;
  if (!raw || typeof raw !== 'object') return null;
  return {
    selected_factor_ids: Array.isArray(raw.selected_factor_ids) ? raw.selected_factor_ids : undefined,
    must_align: Array.isArray(raw.must_align) ? raw.must_align : undefined,
    custom_keywords: Array.isArray(raw.custom_keywords)
      ? raw.custom_keywords
      : undefined,
    custom_keywords_text: raw.custom_keywords_text,
    exclude_hints: Array.isArray(raw.exclude_hints) ? raw.exclude_hints : undefined,
    factors: Array.isArray(raw.factors) ? raw.factors : undefined,
    factor_edits: raw.factor_edits && typeof raw.factor_edits === 'object' ? raw.factor_edits : undefined,
    confirmed: raw.confirmed !== false,
    source: 'user',
  };
}

async function buildInvestedLensProposal(enterpriseId) {
  const row = await getInvestedEnterpriseRowForCompetitor(enterpriseId);
  const readiness = await evaluateInvestedEnterpriseCompetitorReadiness(row);
  const supTags = await loadLatestSupplementTags(row.F_Id);
  readiness.tags = mergeTagArrays(readiness.tags || [], supTags);
  const target = buildTargetProfile(row, readiness, 'invested_enterprise');
  await attachStrategyToTarget(target, row);
  const proposal = proposeCompetitionLens(target);
  const saved = await loadSavedCompetitionLens('invested_enterprise', row.F_Id);
  return { row, readiness, proposal: mergeProposalWithSaved(proposal, saved) };
}

async function buildPreInvestmentLensProposal(projectId) {
  const rows = await db.query(
    `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation,
            ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro,
            structured_profile_json, structured_schema_version, F_CreatorUserId AS creator_user_id,
            F_DeleteMark AS delete_mark
     FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
    [projectId]
  );
  if (!rows.length || Number(rows[0].delete_mark) !== 0) {
    const e = new Error('投前项目不存在');
    e.code = 404;
    throw e;
  }
  const row = rows[0];
  const readiness = await evaluatePreInvestmentReadiness(row);
  const target = buildTargetProfile(row, readiness, 'pre_investment_project');
  await attachStrategyToTarget(target, row);
  const proposal = proposeCompetitionLens(target);
  const saved = await loadSavedCompetitionLens('pre_investment_project', row.F_Id);
  return { row, readiness, proposal: mergeProposalWithSaved(proposal, saved) };
}

function buildManualRelationFieldValues(body) {
  const displayName = strTrim(body?.competitor_display_name);
  if (!displayName) {
    const e = new Error('竞品名称不能为空');
    e.code = 400;
    throw e;
  }
  const creditCode = normalizeCreditCode(body?.unified_credit_code) || null;
  const weakKey = creditCode ? null : displayName.slice(0, 160);
  const isListed = Number(body?.is_listed) === 1 ? 1 : 0;
  const grade = normConfidenceGrade(body?.confidence_grade);
  const score = nullableIntScore(body?.relevance_score);
  const productIntro = nullableLongText(body?.competitor_product_intro);
  const tagsParsed = parseManualIndustryTagsInput(body?.competitor_tags_display);
  const subFundNames = nullableLongText(body?.sub_fund_names);
  const financingHistory = nullableLongText(body?.financing_history_text);
  const financingAmount = financingHistory
    ? String(financingHistory).split('\n')[0].slice(0, 128)
    : nullableLongText(body?.financing_amount_text);
  const includeComparable = body?.include_in_comparable ? 1 : 0;
  return {
    displayName,
    creditCode,
    weakKey,
    isListed,
    grade,
    score,
    productIntro,
    tagsParsed,
    subFundNames,
    financingHistory,
    financingAmount,
    includeComparable,
  };
}

async function selectHydratedRelation(relationId) {
  const rows = await db.query(
    `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
            pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
            relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
            data_sources_json, financing_amount_text, financing_history_text,
            competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
            include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
     FROM sourcing_competitor_relation WHERE F_Id = ? LIMIT 1`,
    [relationId]
  );
  return rows.length ? hydrateRelationRow(rows[0]) : null;
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
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function nullableIntScore(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normConfidenceGrade(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return null;
  if (['S', 'A', 'B', 'C'].includes(s)) return s;
  return null;
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

  /** 被投：对标焦点提案（发起竞品分析前确认） */
  router.get(
    '/invested-enterprises/:id/competition-lens-proposal',
    requireCompetitorAnalysisAccess,
    async (req, res) => {
      try {
        const row = await getInvestedEnterpriseRowForCompetitor(req.params.id);
        assertInvestedEnterpriseCompetitorOwner(req, row);
        const { proposal, readiness } = await buildInvestedLensProposal(row.F_Id);
        res.json({
          success: true,
          data: {
            ...proposal,
            ready: !!readiness?.ready,
            readiness_reasons: readiness?.reasons || [],
          },
        });
      } catch (e) {
        const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
        console.error('[competition-lens-proposal/invested]', e);
        res.status(code).json({ success: false, message: e.message || '提案失败' });
      }
    }
  );

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

      const force = req.body?.force === true;
      const priorRunId = String(req.body?.prior_run_id || req.query.prior_run_id || '').trim();

      /* ── 并发守卫：同一企业已有运行中/排队中的分析则拒绝 ── */
      if (!force) {
        const runningRows = await db.query(
          `SELECT F_Id, status, started_at FROM sourcing_competitor_run
           WHERE invested_enterprise_id = ? AND status IN ('running','queued') AND F_DeleteMark = 0
           LIMIT 1`,
          [String(row.F_Id)]
        );
        if (runningRows.length) {
          return res.status(409).json({
            success: false,
            message: `已有运行中的竞品分析（${runningRows[0].status}），请等待完成或使用 force 覆盖`,
            data: { existing_run_id: runningRows[0].F_Id, status: runningRows[0].status },
          });
        }
      }

      if (force && !req.body?.confirm_force) {
        return res.status(400).json({
          success: false,
          message: '覆盖重跑须传 confirm_force: true',
        });
      }
      if (force) {
        await db.execute(
          `UPDATE sourcing_competitor_relation SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
           WHERE invested_enterprise_id = ? AND subject_type = 'invested_enterprise' AND F_DeleteMark = 0
             AND COALESCE(human_locked, 0) = 0`,
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
        competitionLens: parseCompetitionLensBody(req.body),
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

      const latestRunId = ieId
        ? await getLatestRunIdForInvestedEnterprise(ieId)
        : await getLatestRunIdForPreInvestmentProject(pipId);
      /** 新跑批会软删旧批次关系；查历史版本须包含该 run 下已归档行 */
      const isHistoricalView = !!(runId && latestRunId && runId !== latestRunId);

      /* ── 分页参数 ── */
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(10, parseInt(req.query.page_size) || 200));
      const offset = (page - 1) * pageSize;

      let list;
      if (ieId) {
        if (isHistoricalView) {
          list = await db.query(
            `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                    data_sources_json, financing_amount_text, financing_history_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
             FROM sourcing_competitor_relation
             WHERE invested_enterprise_id = ?
               AND run_id = ?
               AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
             LIMIT ? OFFSET ?`,
            [ieId, runId, pageSize, offset]
          );
        } else if (runId) {
          list = await db.query(
            `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                    data_sources_json, financing_amount_text, financing_history_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
             FROM sourcing_competitor_relation
             WHERE invested_enterprise_id = ? AND F_DeleteMark = 0
               AND (run_id = ? OR F_CreatorUserId IS NOT NULL OR COALESCE(human_locked, 0) = 1)
               AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
             LIMIT ? OFFSET ?`,
            [ieId, runId, pageSize, offset]
          );
        } else {
          list = await db.query(
            `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                    competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                    relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                    data_sources_json, financing_amount_text, financing_history_text,
                    competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                    include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
             FROM sourcing_competitor_relation
             WHERE invested_enterprise_id = ? AND F_DeleteMark = 0
               AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
             ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
             LIMIT ? OFFSET ?`,
            [ieId, pageSize, offset]
          );
        }
      } else if (isHistoricalView) {
        list = await db.query(
          `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                  pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                  relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                  data_sources_json, financing_amount_text, financing_history_text,
                  competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                  include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
           FROM sourcing_competitor_relation
           WHERE pre_investment_project_id = ?
             AND subject_type = 'pre_investment_project'
             AND pre_investment_run_id = ?
           ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
           LIMIT ? OFFSET ?`,
          [pipId, runId, pageSize, offset]
        );
      } else if (runId) {
        list = await db.query(
          `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                  pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                  relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                  data_sources_json, financing_amount_text, financing_history_text,
                  competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                  include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
           FROM sourcing_competitor_relation
           WHERE pre_investment_project_id = ? AND F_DeleteMark = 0
             AND subject_type = 'pre_investment_project'
             AND (pre_investment_run_id = ? OR F_CreatorUserId IS NOT NULL OR COALESCE(human_locked, 0) = 1)
           ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
           LIMIT ? OFFSET ?`,
          [pipId, runId, pageSize, offset]
        );
      } else {
        list = await db.query(
          `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                  pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                  relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                  data_sources_json, financing_amount_text, financing_history_text,
                  competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                  include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
           FROM sourcing_competitor_relation
           WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0
           ORDER BY include_in_comparable DESC, relevance_score DESC, F_CreatorTime DESC
           LIMIT ? OFFSET ?`,
          [pipId, pageSize, offset]
        );
      }
      const deduped = dedupeRelations(list);
      const hydrated = [];
      for (const row of deduped) {
        hydrated.push(await hydrateRelationRow(row));
      }
      res.json({
        success: true,
        data: {
          list: hydrated,
          run_id: runId || latestRunId,
          latest_run_id: latestRunId,
          is_historical_view: isHistoricalView,
          page,
          page_size: pageSize,
          offset,
        },
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[project-sourcing/competitor-analysis/relations]', e);
      res.status(code).json({ success: false, message: e.message || '查询失败' });
    }
  });

  /** 手动新增竞品关系（用户创建，F_CreatorUserId 非空；数据源默认 user_added） */
  router.post('/competitor-analysis/relations', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const ieId = String(req.body?.invested_enterprise_id || '').trim();
      const pipId = String(req.body?.pre_investment_project_id || '').trim();
      if (!ieId && !pipId) {
        return res.status(400).json({
          success: false,
          message: '缺少 invested_enterprise_id 或 pre_investment_project_id',
        });
      }
      if (ieId && pipId) {
        return res.status(400).json({ success: false, message: '不能同时指定被投企业与投前项目' });
      }

      const displayName = strTrim(req.body?.competitor_display_name);
      if (!displayName) {
        return res.status(400).json({ success: false, message: '竞品名称不能为空' });
      }

      const userId = req.psUser?.id ? String(req.psUser.id) : null;
      if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' });
      }

      let subjectType;
      let subjectDisplayName = null;
      let runId = null;
      let preInvestmentRunId = null;

      const bodySubjectType = strTrim(req.body?.subject_type);
      const bodySubjectDisplayName = strTrim(req.body?.subject_display_name);
      const bodyRunId = strTrim(req.body?.run_id);
      const bodyPreInvRunId = strTrim(req.body?.pre_investment_run_id || req.body?.run_id);

      if (ieId) {
        const row = await getInvestedEnterpriseRowForCompetitor(ieId);
        assertInvestedEnterpriseCompetitorOwner(req, row);
        if (bodySubjectType && bodySubjectType !== 'invested_enterprise') {
          return res.status(400).json({ success: false, message: 'subject_type 与被投企业主体不一致' });
        }
        subjectType = 'invested_enterprise';
        subjectDisplayName =
          bodySubjectDisplayName ||
          strTrim(row.enterprise_full_name || row.project_abbreviation) ||
          null;
        runId = bodyRunId || (await getLatestRunIdForInvestedEnterprise(ieId));
      } else {
        const project = await loadPreInvestmentProjectForWrite(req, pipId);
        if (bodySubjectType && bodySubjectType !== 'pre_investment_project') {
          return res.status(400).json({ success: false, message: 'subject_type 与投前项目主体不一致' });
        }
        subjectType = 'pre_investment_project';
        subjectDisplayName =
          bodySubjectDisplayName ||
          strTrim(project.enterprise_full_name || project.project_abbreviation || project.project_no) ||
          null;
        preInvestmentRunId = bodyPreInvRunId || (await getLatestRunIdForPreInvestmentProject(pipId));
      }

      const creditCode = normalizeCreditCode(req.body?.unified_credit_code) || null;
      const weakKey = creditCode ? null : displayName.slice(0, 160);
      const isListed = Number(req.body?.is_listed) === 1 ? 1 : 0;
      const grade = normConfidenceGrade(req.body?.confidence_grade);
      const score = nullableIntScore(req.body?.relevance_score);
      const productIntro = nullableLongText(req.body?.competitor_product_intro);
      const tagsParsed = parseManualIndustryTagsInput(req.body?.competitor_tags_display);
      const subFundNames = nullableLongText(req.body?.sub_fund_names);
      const financingHistory = nullableLongText(req.body?.financing_history_text);
      const financingAmount = financingHistory
        ? String(financingHistory).split('\n')[0].slice(0, 128)
        : nullableLongText(req.body?.financing_amount_text);
      const includeComparable = req.body?.include_in_comparable ? 1 : 0;
      const dataSourcesJson = JSON.stringify(['user_added']);
      const manualEvidence = buildEvidenceMeta(['user_added'], { event_date: new Date() }, null);

      const relId = await generateId('sourcing_competitor_relation');
      await db.execute(
        `INSERT INTO sourcing_competitor_relation (
           F_Id, subject_type, invested_enterprise_id, pre_investment_project_id,
           run_id, pre_investment_run_id, subject_display_name,
           competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
           relevance_score, confidence_grade,
           evidence_confidence, needs_review, evidence_breakdown_json,
           data_sources_json, financing_amount_text, financing_history_text,
           competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
           include_in_comparable, F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
        [
          relId,
          subjectType,
          ieId || null,
          pipId || null,
          runId,
          preInvestmentRunId,
          subjectDisplayName,
          displayName,
          creditCode,
          isListed,
          weakKey,
          score,
          grade,
          manualEvidence.evidenceConfidence,
          manualEvidence.needsReview,
          manualEvidence.evidenceBreakdown
            ? JSON.stringify(manualEvidence.evidenceBreakdown)
            : null,
          dataSourcesJson,
          financingAmount,
          financingHistory,
          productIntro,
          tagsParsed.display,
          tagsParsed.json,
          subFundNames,
          includeComparable,
          userId,
        ]
      );

      if (includeComparable === 1) {
        const rel = {
          subject_type: subjectType,
          invested_enterprise_id: ieId || null,
          pre_investment_project_id: pipId || null,
          competitor_display_name: displayName,
          unified_credit_code: creditCode,
          competitor_weak_key: weakKey,
        };
        await upsertComparablePrefForRelation(rel, true, userId);
      }

      const rows = await db.query(
        `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
                pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
                relevance_score, confidence_grade, score_breakdown_json,
            competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
                data_sources_json, financing_amount_text, financing_history_text,
                competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
         FROM sourcing_competitor_relation WHERE F_Id = ? LIMIT 1`,
        [relId]
      );
      const hydrated = rows.length ? await hydrateRelationRow(rows[0]) : null;
      res.json({ success: true, data: hydrated, message: '已新增竞品' });
    } catch (e) {
      const code = e.code === 400 || e.code === 401 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[competitor-analysis/relations POST]', e);
      res.status(code).json({ success: false, message: e.message || '新增失败' });
    }
  });

  /** 竞品关系复核闭环（确认 / 驳回 / 修正 / 刷新证据） */
  router.patch('/competitor-analysis/relations/:relationId/review', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const relationId = String(req.params.relationId || '').trim();
      await loadCompetitorRelationForReview(req, relationId);
      const userId = req.psUser?.id ? String(req.psUser.id) : null;
      const disposition = String(req.body?.disposition || '').trim();
      const note = req.body?.note;
      const competitorType = req.body?.competitor_type;
      const competitorProductIntro = req.body?.competitor_product_intro;
      const evidenceConfidenceTier = req.body?.evidence_confidence_tier;

      await applyRelationReview({
        relationId,
        userId,
        disposition,
        note,
        competitorType,
        competitorProductIntro,
        evidenceConfidenceTier,
      });

      const rel = await loadRelationRowFull(relationId);
      if (disposition === 'reject_not_competitor' || disposition === 'corrected') {
        await upsertComparablePrefForRelation(
          {
            subject_type: rel.subject_type,
            invested_enterprise_id: rel.invested_enterprise_id,
            pre_investment_project_id: rel.pre_investment_project_id,
            competitor_display_name: rel.competitor_display_name,
            unified_credit_code: rel.unified_credit_code,
            competitor_weak_key: rel.competitor_weak_key,
          },
          Number(rel.include_in_comparable) === 1,
          userId
        );
      }

      const hydrated = await selectHydratedRelation(relationId);
      res.json({
        success: true,
        data: hydrated,
        message:
          disposition === 'refresh_evidence'
            ? '证据已刷新'
            : disposition === 'confirm'
              ? '已确认竞品关系'
              : disposition === 'reject_not_competitor'
                ? '已标为非竞品'
                : '复核结果已保存',
      });
    } catch (e) {
      const code = e.code === 400 || e.code === 401 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[competitor-analysis/relations/review PATCH]', e);
      res.status(code).json({ success: false, message: e.message || '复核失败' });
    }
  });

  /** 编辑竞品关系（含 AI/系统生成与用户新增） */
  router.put('/competitor-analysis/relations/:relationId', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const relationId = String(req.params.relationId || '').trim();
      const rel = await loadCompetitorRelationForWrite(req, relationId);
      const userId = req.psUser?.id ? String(req.psUser.id) : null;
      const fields = buildManualRelationFieldValues(req.body);
      await db.execute(
        `UPDATE sourcing_competitor_relation SET
           competitor_display_name = ?, unified_credit_code = ?, is_listed = ?, competitor_weak_key = ?,
           relevance_score = ?, confidence_grade = ?,
           financing_amount_text = ?, financing_history_text = ?,
           competitor_product_intro = ?, competitor_tags_display = ?, competitor_tags_json = ?, sub_fund_names = ?,
           include_in_comparable = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ? AND F_DeleteMark = 0`,
        [
          fields.displayName,
          fields.creditCode,
          fields.isListed,
          fields.weakKey,
          fields.score,
          fields.grade,
          fields.financingAmount,
          fields.financingHistory,
          fields.productIntro,
          fields.tagsParsed.display,
          fields.tagsParsed.json,
          fields.subFundNames,
          fields.includeComparable,
          relationId,
        ]
      );
      await upsertComparablePrefForRelation(
        {
          subject_type: rel.subject_type,
          invested_enterprise_id: rel.invested_enterprise_id,
          pre_investment_project_id: rel.pre_investment_project_id,
          competitor_display_name: fields.displayName,
          unified_credit_code: fields.creditCode,
          competitor_weak_key: fields.weakKey,
        },
        fields.includeComparable === 1,
        userId
      );
      const hydrated = await selectHydratedRelation(relationId);
      res.json({ success: true, data: hydrated, message: '已保存' });
    } catch (e) {
      const code = e.code === 400 || e.code === 401 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[competitor-analysis/relations PUT]', e);
      res.status(code).json({ success: false, message: e.message || '保存失败' });
    }
  });

  /** 删除竞品关系（软删除，含 AI/系统生成与用户新增） */
  router.delete('/competitor-analysis/relations/:relationId', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const relationId = String(req.params.relationId || '').trim();
      await loadCompetitorRelationForWrite(req, relationId);
      const userId = req.psUser?.id ? String(req.psUser.id) : null;
      await db.execute(
        `UPDATE sourcing_competitor_relation
         SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ? AND F_DeleteMark = 0`,
        [userId, relationId]
      );
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      const code = e.code === 400 || e.code === 401 || e.code === 403 || e.code === 404 ? e.code : 500;
      console.error('[competitor-analysis/relations DELETE]', e);
      res.status(code).json({ success: false, message: e.message || '删除失败' });
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
                  competitor_display_name, unified_credit_code, competitor_weak_key,
                  competitor_type, subject_display_name, F_DeleteMark AS delete_mark
           FROM sourcing_competitor_relation WHERE F_Id = ? LIMIT 1`,
          [relationId]
        );
        if (!relRows.length || Number(relRows[0].delete_mark) !== 0) {
          return res.status(404).json({ success: false, message: '竞品记录不存在' });
        }
        const rel = relRows[0];
        const userId = req.psUser?.id ? String(req.psUser.id) : null;
        /* ── 归属校验：仅管理员或父主体创建人可操作 ── */
        if (!isAdminUser(req.psUser)) {
          if (rel.invested_enterprise_id) {
            const ieRows = await db.query(
              'SELECT F_CreatorUserId AS creator_user_id FROM invested_enterprises WHERE F_Id = ? LIMIT 1',
              [rel.invested_enterprise_id]
            );
            if (ieRows.length && String(ieRows[0].creator_user_id || '') !== userId) {
              return res.status(403).json({ success: false, message: '仅管理员或创建人可操作' });
            }
          } else if (rel.pre_investment_project_id) {
            const pipRows = await db.query(
              'SELECT F_CreatorUserId AS creator_user_id FROM pre_investment_project WHERE F_Id = ? LIMIT 1',
              [rel.pre_investment_project_id]
            );
            if (pipRows.length && String(pipRows[0].creator_user_id || '') !== userId) {
              return res.status(403).json({ success: false, message: '仅管理员或创建人可操作' });
            }
          }
        }
        const prefResult = await upsertComparablePrefForRelation(rel, includeInComparable, userId);
        await db.execute(
          `UPDATE sourcing_competitor_relation
           SET include_in_comparable = ?, F_LastModifyTime = NOW()
           WHERE F_Id = ? AND F_DeleteMark = 0`,
          [includeInComparable ? 1 : 0, relationId]
        );

        /* ── Fix-14: 标记可比时自动写入金标准 ── */
        if (includeInComparable) {
          try {
            let targetName = rel.subject_display_name || null;
            let targetCredit = null;
            let targetSource = rel.subject_type || 'invested_enterprise';
            let targetRefId = null;
            if (rel.invested_enterprise_id) {
              const ieRows = await db.query(
                'SELECT enterprise_full_name, unified_credit_code, F_Id AS id FROM invested_enterprises WHERE F_Id = ? LIMIT 1',
                [rel.invested_enterprise_id]
              );
              if (ieRows.length) {
                targetName = targetName || ieRows[0].enterprise_full_name;
                targetCredit = ieRows[0].unified_credit_code || null;
                targetRefId = ieRows[0].id;
              }
            } else if (rel.pre_investment_project_id) {
              const pipRows = await db.query(
                'SELECT enterprise_full_name, unified_credit_code, F_Id AS id FROM pre_investment_project WHERE F_Id = ? LIMIT 1',
                [rel.pre_investment_project_id]
              );
              if (pipRows.length) {
                targetName = targetName || pipRows[0].enterprise_full_name;
                targetCredit = pipRows[0].unified_credit_code || null;
                targetRefId = pipRows[0].id;
              }
              targetSource = 'pre_investment';
            }
            const candCredit = rel.unified_credit_code || null;
            const candName = rel.competitor_display_name || null;
            if (targetName && (candCredit || candName)) {
              const existing = await db.query(
                `SELECT F_Id FROM competitor_gold_standard_pair
                 WHERE target_credit_code <=> ? AND candidate_credit_code <=> ?
                   AND F_DeleteMark = 0 LIMIT 1`,
                [targetCredit, candCredit]
              );
              if (existing.length) {
                await db.execute(
                  `UPDATE competitor_gold_standard_pair
                   SET final_is_competitor = 1, final_type = ?,
                       annotator_1_is_competitor = 1, annotator_1_type = ?,
                       status = 'done', F_LastModifyTime = NOW()
                   WHERE F_Id = ?`,
                  [rel.competitor_type || null, rel.competitor_type || null, existing[0].F_Id]
                );
              } else {
                await db.execute(
                  `INSERT INTO competitor_gold_standard_pair (
                    category_4, target_source, target_ref_id, target_display_name, target_credit_code,
                    candidate_display_name, candidate_credit_code,
                    annotator_1_is_competitor, annotator_1_type,
                    final_is_competitor, final_type, status, F_DeleteMark
                  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
                  [
                    'other', targetSource, targetRefId, targetName, targetCredit,
                    candName, candCredit,
                    1, rel.competitor_type || null,
                    1, rel.competitor_type || null, 'done',
                  ]
                );
              }
            }
          } catch (gsErr) {
            console.warn('[competitor-analysis/relations/comparable] gold standard auto-write:', gsErr.message);
          }
        }

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

  /** 投前：从 BP 文件提取产品介绍和企业标签（异步，大文件可能需数分钟） */
  router.post('/pre-investment-projects/:id/bp-extract', requireCompetitorAnalysisAccess, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, message: '缺少项目 ID' });
      }
      const rows = await db.query(
        'SELECT bp_filename, F_CreatorUserId AS creator_user_id FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0',
        [id]
      );
      if (!rows.length) {
        return res.status(404).json({ success: false, message: '投前项目不存在' });
      }
      const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
      if (!isAdminUser(req.psUser) && String(rows[0].creator_user_id || '') !== uid) {
        return res.status(403).json({ success: false, message: '仅创建人或管理员可操作' });
      }
      if (!rows[0].bp_filename) {
        return res.json({ success: true, data: { extracted: false }, message: '该项目无 BP 文件' });
      }
      setImmediate(() => {
        extractBpForProject(id)
          .then((result) => {
            if (result.success && result.extracted) {
              console.log(`[bpFileParser] 异步 BP 提取完成: ${id}`);
            } else if (!result.success) {
              console.warn(`[bpFileParser] 异步 BP 提取失败 (${id}): ${result.error}`);
            }
          })
          .catch((err) => {
            console.error(`[bpFileParser] 异步 BP 提取异常 (${id}):`, err);
          });
      });
      return res.status(202).json({
        success: true,
        message: '已受理 BP 提取任务，大文件可能需要数分钟，请稍后刷新列表查看结果',
        data: { pre_investment_project_id: id, accepted: true },
      });
    } catch (e) {
      console.error('[project-sourcing/pre-investment-projects/bp-extract]', e);
      res.status(500).json({ success: false, message: e.message || 'BP 提取受理失败' });
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

  /** 投前：对标焦点提案 */
  router.get(
    '/pre-investment-projects/:id/competition-lens-proposal',
    requireCompetitorAnalysisAccess,
    async (req, res) => {
      try {
        const id = String(req.params.id || '').trim();
        /* ── 鉴权前置：先校验归属再执行提案构建 ── */
        const checkRows = await db.query(
          'SELECT F_CreatorUserId AS creator_user_id FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1',
          [id]
        );
        if (!checkRows.length) {
          return res.status(404).json({ success: false, message: '记录不存在' });
        }
        const uid = req.psUser && req.psUser.id ? String(req.psUser.id) : null;
        if (!isAdminUser(req.psUser) && String(checkRows[0].creator_user_id || '') !== uid) {
          return res.status(403).json({ success: false, message: '仅创建人或管理员可查看' });
        }
        const { row, proposal, readiness } = await buildPreInvestmentLensProposal(id);
        res.json({
          success: true,
          data: {
            ...proposal,
            ready: !!readiness?.ready,
            readiness_reasons: readiness?.reasons || [],
          },
        });
      } catch (e) {
        const code = e.code === 400 || e.code === 403 || e.code === 404 ? e.code : 500;
        console.error('[competition-lens-proposal/pre]', e);
        res.status(code).json({ success: false, message: e.message || '提案失败' });
      }
    }
  );

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

      /* ── 并发守卫：同一项目已有运行中/排队中的分析则拒绝 ── */
      if (!force) {
        const runningRows = await db.query(
          `SELECT F_Id, status, started_at FROM sourcing_pre_investment_competitor_run
           WHERE pre_investment_project_id = ? AND status IN ('running','queued') AND F_DeleteMark = 0
           LIMIT 1`,
          [id]
        );
        if (runningRows.length) {
          return res.status(409).json({
            success: false,
            message: `已有运行中的竞品分析（${runningRows[0].status}），请等待完成或使用 force 覆盖`,
            data: { existing_run_id: runningRows[0].F_Id, status: runningRows[0].status },
          });
        }
      }

      if (force && !req.body?.confirm_force) {
        return res.status(400).json({
          success: false,
          message: '覆盖重跑须传 confirm_force: true',
        });
      }
      if (force) {
        await db.execute(
          `UPDATE sourcing_competitor_relation SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
           WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0
             AND COALESCE(human_locked, 0) = 0`,
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
        competitionLens: parseCompetitionLensBody(req.body),
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
