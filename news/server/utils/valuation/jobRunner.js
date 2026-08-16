const db = require('../../db');
const { generateId } = require('../idGenerator');
const C = require('./constants');
const { runValuationEngine, computeComparableStats } = require('./engine');
const { defaultMethodConfig, defaultAssumptions, defaultScenarioSet, seedDcfLiquidityDiscount } = require('./defaults');
const { prepareAmountsForEngine, resolveValuationDate } = require('./marketUtils');
const { listCaseComparables } = require('./comparableService');
const {
  ensureComparablesFetched,
  loadCompanyFinancialBundle,
  fetchIndustryMultiples,
} = require('./financialFetch');
const { getDraft, saveDraft } = require('./caseService');
const { loadWorkspace } = require('./workspaceStore');

const running = new Set();

async function enqueueValuationJob({ caseId, userId, jobType = 'fetch_and_calc' }) {
  const id = await generateId('valuation_job');
  await db.execute(
    `INSERT INTO valuation_job (
       F_Id, case_id, job_type, status, progress, message, F_CreatorUserId, started_at, F_CreatorTime, F_LastModifyTime
     ) VALUES (?,?,?,?,?,?,?,NOW(),NOW(),NOW())`,
    [id, caseId, jobType, C.JOB_STATUS.QUEUED, 0, '已受理，后台采集与计算中', userId || null]
  );
  setImmediate(() => {
    runJob(id).catch((e) => console.error('[valuation job]', id, e));
  });
  return id;
}

async function updateJob(id, patch) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (!sets.length) return;
  params.push(id);
  await db.execute(`UPDATE valuation_job SET ${sets.join(', ')}, F_LastModifyTime = NOW() WHERE F_Id = ?`, params);
}

async function getJob(id) {
  const rows = await db.query(
    `SELECT F_Id AS id, case_id, job_type, status, progress, message,
            F_CreatorUserId AS creator_user_id, started_at, finished_at, F_CreatorTime AS created_at
     FROM valuation_job WHERE F_Id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  let result = null;
  if (row.status === C.JOB_STATUS.SUCCESS) {
    const ws = await loadWorkspace(row.case_id, '0');
    result = { warnings: ws.warnings, comparison: ws.comparison };
  }
  return { ...row, result };
}

async function runJob(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    const job = await getJob(jobId);
    if (!job) return;
    await updateJob(jobId, { status: C.JOB_STATUS.RUNNING, progress: 5, message: '读取案件与可比…' });
    const draft = await getDraft(job.case_id);
    const payload = draft.payload || {};
    const methodConfig = { ...(payload.methodConfig || defaultMethodConfig()) };
    if (!methodConfig.confirmed) {
      await updateJob(jobId, {
        status: C.JOB_STATUS.FAILED,
        progress: 100,
        message: '请先确认计算前方法配置',
        finished_at: new Date(),
      });
      return;
    }
    const asOfDate = resolveValuationDate(payload.assumptions?.valuation_date);
    payload.assumptions = { ...(payload.assumptions || {}), valuation_date: asOfDate };
    let industryNote = '';
    if (methodConfig.multiple_source === C.MULTIPLE_INDUSTRY) {
      await updateJob(jobId, { progress: 12, message: `汇总申万行业「${payload.sw_industry_l3 || ''}」倍数…` });
      const industry = await fetchIndustryMultiples(
        payload.sw_industry_l3,
        methodConfig.industry_stat_method,
        asOfDate,
        (msg) => updateJob(jobId, { progress: 12, message: msg }).catch(() => {})
      );
      if (industry?.unavailable) {
        methodConfig.multiple_source = C.MULTIPLE_POOL;
        payload.industryUnavailable = industry.message;
        payload.industryMultiples = null;
      } else {
        payload.industryMultiples = industry;
        industryNote = `行业法：${industry.sw_industry_l3} 成分 ${industry.constituent_count || 0} 家，PE 样本 ${industry.pe_sample || 0}、PS 样本 ${industry.ps_sample || 0}`;
      }
    }

    const comps = (await listCaseComparables(job.case_id)).filter((c) => Number(c.selected) === 1 && c.stock_code);
    await updateJob(jobId, { progress: 15, message: `检查库内财报（${comps.length} 家）…` });
    let fetchWarnings = [];
    let fetchNotes = industryNote ? [industryNote] : [];
    let skippedCount = 0;
    let fetchedCount = 0;
    if (job.job_type !== 'calc_only') {
      const fetched = await ensureComparablesFetched(comps, { case_id: job.case_id, job_id: jobId }, (i, n, code) => {
        const p = 15 + Math.round((i / Math.max(n, 1)) * 50);
        updateJob(jobId, { progress: p, message: `核验/采集 ${code}（${i}/${n}）` }).catch(() => {});
      });
      fetchWarnings = fetched.warnings || [];
      fetchNotes = industryNote
        ? [industryNote, ...(fetched.notes || [])]
        : (fetched.notes || []);
      skippedCount = fetched.skippedCount || 0;
      fetchedCount = fetched.fetchedCount || 0;
    }

    await updateJob(jobId, { progress: 70, message: '计算可比比率与估值…' });
    const bundles = [];
    for (const c of comps) {
      const bundle = await loadCompanyFinancialBundle(c.stock_code);
      bundles.push({
        ...bundle,
        stock_code: c.stock_code,
        stock_name: c.stock_name,
        in_pool: Number(c.in_pool) === 1,
        pe_median_override: c.pe_median_override,
        ps_median_override: c.ps_median_override,
      });
    }
    const compStats = computeComparableStats(bundles, {
      asOfDate,
    });
    const assumptions = seedDcfLiquidityDiscount({
      ...(defaultAssumptions()),
      ...(payload.assumptions || {}),
      valuation_date: asOfDate,
    });
    const amounts = prepareAmountsForEngine({ ...payload, assumptions });
    const engineOut = runValuationEngine({
      methodConfig,
      assumptions: amounts.assumptions,
      scenarios: payload.scenarios || defaultScenarioSet(),
      targetPl: amounts.targetPl || {},
      targetBs: amounts.targetBs || {},
      targetCf: amounts.targetCf || {},
      overrides: amounts.overrides || {},
      compStats,
      industryMultiples: payload.industryMultiples,
      warnings: [
        ...(payload.industryUnavailable ? [payload.industryUnavailable] : []),
        ...fetchWarnings,
      ],
    });

    const nextPayload = {
      ...payload,
      methodConfig,
      assumptions,
      sheets: engineOut.sheets,
      comparison: engineOut.comparison,
      warnings: [...fetchNotes, ...(engineOut.warnings || [])],
      wacc: engineOut.wacc,
      net_debt: engineOut.net_debt,
      last_job_id: jobId,
    };
    await saveDraft(job.case_id, nextPayload, job.creator_user_id, { source: 'compute' });
    const doneMsg = skippedCount && !fetchedCount
      ? `计算完成（${skippedCount} 家用库内数据，未再抓取）`
      : skippedCount
        ? `计算完成（${skippedCount} 家跳过抓取，${fetchedCount} 家补采）`
        : '计算完成（草稿未保存版本）';
    await updateJob(jobId, {
      status: C.JOB_STATUS.SUCCESS,
      progress: 100,
      message: doneMsg,
      finished_at: new Date(),
    });
  } catch (e) {
    console.error('[valuation job failed]', jobId, e);
    await updateJob(jobId, {
      status: C.JOB_STATUS.FAILED,
      progress: 100,
      message: e.message || '计算失败',
      finished_at: new Date(),
    }).catch(() => {});
  } finally {
    running.delete(jobId);
  }
}

module.exports = {
  enqueueValuationJob,
  getJob,
};
