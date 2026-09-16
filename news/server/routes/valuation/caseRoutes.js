const db = require('../../db');
const { requireProjectValuationAccess } = require('../../utils/valuation/routeAuth');
const {
  createPreProject,
  listPreProjects,
  listCompetitorPreProjects,
  openOrCreateCase,
  getCase,
  listPostCases,
  getDraft,
  saveDraft,
  saveVersion,
  getVersionDetail,
  startDraftFromVersion,
  updateCaseMeta,
  listChangeLog,
} = require('../../utils/valuation/caseService');
const {
  previewComparablesFromCompetitor,
  replaceCaseComparables,
  listCaseComparables,
  addManualComparable,
  listComparableFinancials,
  mergeFromCompetitor,
  patchComparable,
  softDeleteComparable,
} = require('../../utils/valuation/comparableService');
const {
  startRecommendRun,
  listRecommendRuns,
  getRecommendRun,
  getLatestRecommendState,
  applyRecommendRun,
  enrichExistingRun,
} = require('../../utils/valuation/listedIndustryRecommendRunner');
const { enqueueValuationJob, getJob } = require('../../utils/valuation/jobRunner');
const { listSwIndustryNames } = require('../../utils/valuation/financialFetch');
const { buildWorkbookBuffer } = require('../../utils/valuation/exportService');
const { defaultMethodConfig } = require('../../utils/valuation/defaults');
const C = require('../../utils/valuation/constants');
const { fetchQichachaFuzzyCompanies } = require('../../utils/qichachaFuzzySearch');
const {
  parseTargetFinancialWorkbook,
  mergeTargetFinancials,
  buildTargetFinancialTemplateBuffer,
  getIndustryMultiplesStatus,
} = require('../../utils/valuation/targetImport');
const XLSX = require('xlsx');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function paging(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  return { page, pageSize, keyword: String(req.query.keyword || req.query.q || '').trim() };
}

function sendErr(res, e) {
  const code = [400, 403, 404, 409].includes(e.code) ? e.code : 500;
  if (code === 500) console.error('[valuation]', e);
  const body = { success: false, message: e.message || '服务器错误' };
  if (code === 409) body.accepted = false;
  return res.status(code).json(body);
}

function registerValuationRoutes(router) {
  router.get('/pre-projects', requireProjectValuationAccess, async (req, res) => {
    try {
      const data = await listPreProjects(req, paging(req));
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/competitor-pre-projects', requireProjectValuationAccess, async (req, res) => {
    try {
      const data = await listCompetitorPreProjects(req, paging(req));
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/qcc-fuzzy-lookup', requireProjectValuationAccess, async (req, res) => {
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
      if (code === 500) console.error('[valuation/qcc-fuzzy-lookup]', e);
      return res.status(code).json({ success: false, message: e.message || '企查查查询失败' });
    }
  });

  router.post('/pre-projects', requireProjectValuationAccess, async (req, res) => {
    try {
      const row = await createPreProject(req, req.body || {});
      res.json({ success: true, data: row });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/pre-projects/:id/open-case', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await openOrCreateCase(req, {
        caseType: C.CASE_TYPE_PRE,
        preProjectId: req.params.id,
      });
      res.json({ success: true, data: cse });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/invested-enterprises/:id/open-case', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await openOrCreateCase(req, {
        caseType: C.CASE_TYPE_POST,
        investedEnterpriseId: req.params.id,
      });
      res.json({ success: true, data: cse });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/post-cases', requireProjectValuationAccess, async (req, res) => {
    try {
      const data = await listPostCases(req, paging(req));
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await getCase(req, req.params.id);
      if (!cse) return res.status(404).json({ success: false, message: '案件不存在' });
      res.json({ success: true, data: cse });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.patch('/cases/:id', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await updateCaseMeta(req, req.params.id, req.body || {});
      res.json({ success: true, data: cse });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/change-log', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const data = await listChangeLog(req.params.id, paging(req));
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/draft', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const draft = await getDraft(req.params.id);
      res.json({ success: true, data: draft });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.put('/cases/:id/draft', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const draft = await saveDraft(req.params.id, req.body?.payload || req.body, req.valUser.id);
      res.json({ success: true, data: draft });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/comparables/preview', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await getCase(req, req.params.id);
      const data = await previewComparablesFromCompetitor({
        caseType: cse.case_type,
        investedEnterpriseId: cse.invested_enterprise_id,
        competitorPreProjectId: cse.subject?.competitor_pre_project_id,
        creditCode: cse.subject?.unified_credit_code,
        fullName: cse.subject?.enterprise_full_name || cse.subject?.display_name,
      });
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/comparables', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const list = await listCaseComparables(req.params.id);
      res.json({ success: true, data: { list } });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/comparables/financials', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const data = await listComparableFinancials(req.params.id);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.put('/cases/:id/comparables', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const rows = Array.isArray(req.body?.list) ? req.body.list : [];
      const saved = await replaceCaseComparables(req.params.id, rows);
      res.json({ success: true, data: { list: saved } });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/comparables/from-competitor', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await getCase(req, req.params.id);
      if (!cse) return res.status(404).json({ success: false, message: '案件不存在' });
      const data = await mergeFromCompetitor(cse);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/comparables/recommend/runs', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await getCase(req, req.params.id);
      if (!cse) return res.status(404).json({ success: false, message: '案件不存在' });
      const data = await startRecommendRun(req, cse, req.body || {});
      res.status(202).json({ success: true, accepted: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/comparables/recommend/runs', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const list = await listRecommendRuns(req.params.id);
      res.json({ success: true, data: { list } });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/comparables/recommend/runs/latest', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const data = await getLatestRecommendState(req.params.id);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/comparables/recommend/runs/:runId', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const data = await getRecommendRun(req.params.id, req.params.runId);
      if (!data) return res.status(404).json({ success: false, message: '推荐版本不存在' });
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/comparables/recommend/runs/:runId/apply', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const codes = Array.isArray(req.body?.stock_codes) ? req.body.stock_codes : [];
      const data = await applyRecommendRun(req.params.id, req.params.runId, codes);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/comparables/recommend/ai-enrich', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const runId = req.body?.run_id || req.body?.runId;
      if (!runId) return res.status(400).json({ success: false, message: '缺少 run_id' });
      const data = await enrichExistingRun(req.params.id, runId);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/comparables/manual', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const row = await addManualComparable(req.params.id, {
        stockCode: req.body?.stock_code,
        stockName: req.body?.stock_name,
        source: 'manual',
      });
      res.json({ success: true, data: row });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post(
    '/cases/:id/comparables/import',
    requireProjectValuationAccess,
    upload.single('file'),
    async (req, res) => {
      try {
        await getCase(req, req.params.id);
        if (!req.file?.buffer) {
          return res.status(400).json({ success: false, message: '请上传 Excel 文件' });
        }
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const added = [];
        const skipped = [];
        for (let i = 0; i < aoa.length; i += 1) {
          const cell = String(aoa[i][0] || '').trim();
          if (!cell || /代码|code/i.test(cell)) continue;
          try {
            const row = await addManualComparable(req.params.id, {
              stockCode: cell,
              stockName: String(aoa[i][1] || '').trim() || undefined,
              source: 'excel',
            });
            added.push(row);
          } catch (err) {
            skipped.push({ row: i + 1, code: cell, reason: err.message });
          }
        }
        res.json({ success: true, data: { added, skipped } });
      } catch (e) {
        sendErr(res, e);
      }
    }
  );

  router.get('/industry-multiples/status', requireProjectValuationAccess, async (_req, res) => {
    try {
      const data = await getIndustryMultiplesStatus(db);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/industry-multiples/industries', requireProjectValuationAccess, async (_req, res) => {
    try {
      const data = await listSwIndustryNames();
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/target-financials/template', requireProjectValuationAccess, async (_req, res) => {
    try {
      const buf = buildTargetFinancialTemplateBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E6%A0%87%E7%9A%84%E4%B8%89%E8%A1%A8%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
      res.send(buf);
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/target-financials/template', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const draft = await getDraft(req.params.id);
      const buf = buildTargetFinancialTemplateBuffer(draft.payload);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E6%A0%87%E7%9A%84%E4%B8%89%E8%A1%A8%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
      res.send(buf);
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post(
    '/cases/:id/target-financials/import',
    requireProjectValuationAccess,
    upload.single('file'),
    async (req, res) => {
      try {
        await getCase(req, req.params.id);
        if (!req.file?.buffer) {
          return res.status(400).json({ success: false, message: '请上传 Excel 文件' });
        }
        const parsed = parseTargetFinancialWorkbook(req.file.buffer);
        if (!parsed.targetPl && !parsed.targetBs && !parsed.targetCf) {
          return res.status(400).json({
            success: false,
            message: parsed.warnings[0] || '未能识别三表科目',
          });
        }
        const draft = await getDraft(req.params.id);
        const payload = mergeTargetFinancials(draft.payload, parsed);
        const saved = await saveDraft(req.params.id, payload, req.valUser.id);
        res.json({
          success: true,
          data: {
            payload: saved.payload,
            warnings: parsed.warnings,
            sheets: parsed.sheets,
          },
        });
      } catch (e) {
        sendErr(res, e);
      }
    }
  );

  router.patch('/cases/:id/comparables/:cid', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const data = await patchComparable(req.params.id, req.params.cid, req.body || {});
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.delete('/cases/:id/comparables/:cid', requireProjectValuationAccess, async (req, res) => {
    try {
      await getCase(req, req.params.id);
      const data = await softDeleteComparable(req.params.id, req.params.cid);
      res.json({ success: true, data });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/jobs', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await getCase(req, req.params.id);
      const draft = await getDraft(req.params.id);
      const method = draft.payload?.methodConfig || cse.method_config || defaultMethodConfig();
      if (!method.confirmed) {
        return res.status(400).json({ success: false, message: '请先确认计算前方法配置后再开跑' });
      }
      const jobType = req.body?.job_type === 'calc_only' ? 'calc_only' : 'fetch_and_calc';
      const jobId = await enqueueValuationJob({
        caseId: req.params.id,
        userId: req.valUser.id,
        jobType,
      });
      res.status(202).json({
        success: true,
        message: '已受理采集与计算任务',
        data: { job_id: jobId },
      });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/jobs/:jobId', requireProjectValuationAccess, async (req, res) => {
    try {
      const job = await getJob(req.params.jobId);
      if (!job) return res.status(404).json({ success: false, message: '任务不存在' });
      await getCase(req, job.case_id);
      res.json({ success: true, data: job });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/versions', requireProjectValuationAccess, async (req, res) => {
    try {
      const ver = await saveVersion(req, req.params.id, { remark: req.body?.remark });
      res.json({ success: true, data: ver });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post('/cases/:id/draft/from-version', requireProjectValuationAccess, async (req, res) => {
    try {
      const draft = await startDraftFromVersion(req, req.params.id, req.body?.from_version_id);
      res.json({ success: true, data: draft });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/versions/:versionId', requireProjectValuationAccess, async (req, res) => {
    try {
      const ver = await getVersionDetail(req, req.params.versionId);
      if (!ver) return res.status(404).json({ success: false, message: '版本不存在' });
      res.json({ success: true, data: ver });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/cases/:id/export', requireProjectValuationAccess, async (req, res) => {
    try {
      const cse = await getCase(req, req.params.id);
      const versionId = String(req.query.version_id || '').trim();
      let sheets;
      let payload;
      let title = cse.subject?.display_name || '项目估值';
      if (versionId) {
        const ver = await getVersionDetail(req, versionId);
        if (!ver || ver.case_id !== cse.id) {
          return res.status(404).json({ success: false, message: '版本不存在' });
        }
        sheets = ver.sheets;
        payload = ver.payload;
        title = `${title}-v${ver.version_no}`;
      } else {
        const draft = await getDraft(req.params.id);
        sheets = draft.payload?.sheets || {};
        payload = draft.payload;
        title = `${title}-草稿`;
      }
      const buf = buildWorkbookBuffer({ title, sheets, payload });
      const filename = encodeURIComponent(`${title}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buf);
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get('/defaults', requireProjectValuationAccess, async (_req, res) => {
    res.json({
      success: true,
      data: {
        method_config: defaultMethodConfig(),
        allowed_markets: C.ALLOWED_LISTING_MARKETS,
        market_labels: C.MARKET_LABELS,
      },
    });
  });
}

module.exports = { registerValuationRoutes };
