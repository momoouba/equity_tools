const { generateId } = require('../idGenerator');
const db = require('../../db');
const { sanitizeQccCompanyIntroForMatching } = require('./qccCompanyIntroSanitizer');
const {
  evaluateInvestedEnterpriseCompetitorReadiness,
  getInvestedEnterpriseRowForCompetitor,
  parseTagsFromRow,
  loadLatestSupplementTags,
} = require('./competitorMatchReadinessService');
const {
  recallFromIpoProjects,
  recallFromFinancingEvents,
  mergeRecalledCandidates,
} = require('./competitorMatchRecall');
const {
  jaccardSimilarity,
  textOverlapScore,
  l2Similarity,
  computeComprehensiveScore,
  meetsPersistThreshold,
  getCandidateAiPart,
  LLM_HIGH_TRUST_THRESHOLD,
  SCORE_THRESHOLD_PERSIST,
  SCORE_THRESHOLD_HIGH_LLM,
  weightedScore,
  scoreToGrade,
  strTrim,
  mergeTagArrays,
  normalizeCreditCode,
  candidateDedupeKey,
} = require('./competitorMatchUtils');
const {
  scorePairSimilarity,
  discoverWebCompetitors,
  validateCandidate,
} = require('./competitorAnalysisAi');
const {
  logCompetitorRun,
  summarizeCandidates,
} = require('./competitorAnalysisLogger');
const { enrichCompetitorDisplayFields } = require('./competitorRelationEnrichService');
const { buildFinancingEventIndex } = require('./competitorFinancingResolve');
const { loadComparablePrefsForSubject } = require('./competitorComparablePrefService');
const { isComparablePreferred } = require('./competitorCompanyMatch');
const {
  enrichRelationFieldsBeforePersist,
  parseIsListedFromCandidate,
} = require('./competitorRelationPersistEnhance');

const SCORE_THRESHOLD = SCORE_THRESHOLD_PERSIST;
/** 规则分 Top N 进入 LLM 对标 */
const TOP_N_LLM_RULE = 20;
/** 标签相似度 Top N 补充进 LLM 池（与规则 Top 并集去重） */
const TOP_N_LLM_TAG = 15;
/** 掩模/光罩等专业赛道：加大标签通道 LLM 覆盖面 */
const TOP_N_LLM_TAG_NICHE = 28;
const TAG_LLM_MIN = 22;
const TAG_LLM_MIN_NICHE = 16;
const NICHE_TRACK_TAG_RE = /掩模|光罩|mask|photomask/i;
/** 掩模赛道：名称/简介含关键词的候选补充进 LLM 池（与规则 Top 并集） */
const KEYWORD_LLM_CAP = 28;
const TOP_N_VALIDATE = 24;
const AUTO_EXPAND_MIN_COUNT = 3;
const AUTO_EXPAND_MIN_B_PLUS = 1;
const LLM_REQUEST_GAP_MS = Math.max(0, parseInt(process.env.COMPETITOR_LLM_GAP_MS || '650', 10) || 650);
/** 内部源规则分达此值进入校验池 */
const VALIDATE_INTERNAL_MIN = 45;
/** 联网候选进入校验的 AI 初分下限 */
const WEB_VALIDATE_AI_MIN = 55;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNicheTrackTarget(target) {
  const tags = target?.tags || [];
  const intro = [target?.product_intro, target?.qcc_intro_effective].filter(Boolean).join(' ');
  return tags.some((t) => NICHE_TRACK_TAG_RE.test(String(t))) || NICHE_TRACK_TAG_RE.test(intro);
}

/** LLM 对标池 = 规则分 Top + 标签分 Top（并集，掩模赛道扩大标签通道） */
function buildLlmScoringPool(scored, target) {
  const map = new Map();
  const add = (c) => {
    if (!c) return;
    const key = candidateDedupeKey(c);
    if (!key || map.has(key)) return;
    map.set(key, c);
  };
  scored.slice(0, TOP_N_LLM_RULE).forEach(add);
  const niche = isNicheTrackTarget(target);
  const tagMin = niche ? TAG_LLM_MIN_NICHE : TAG_LLM_MIN;
  const tagCap = niche ? TOP_N_LLM_TAG_NICHE : TOP_N_LLM_TAG;
  const byTag = [...scored].sort((a, b) => (b.tagScore || 0) - (a.tagScore || 0));
  let tagAdded = 0;
  for (const c of byTag) {
    if ((c.tagScore || 0) < tagMin) break;
    const before = map.size;
    add(c);
    if (map.size > before) tagAdded += 1;
    if (tagAdded >= tagCap) break;
  }

  let kwAdded = 0;
  if (niche) {
    const textHitsNiche = (c) => {
      const blob = [c.display_name, c.product_intro, c.qcc_intro, ...(c.tags || [])].filter(Boolean).join('\n');
      return NICHE_TRACK_TAG_RE.test(blob);
    };
    const byKw = scored.filter(textHitsNiche).sort((a, b) => (b.internalScore || 0) - (a.internalScore || 0));
    for (const c of byKw) {
      if (kwAdded >= KEYWORD_LLM_CAP) break;
      const before = map.size;
      add(c);
      if (map.size > before) kwAdded += 1;
    }
  }

  return {
    pool: [...map.values()],
    niche,
    tagAdded,
    kwAdded,
    ruleTop: Math.min(TOP_N_LLM_RULE, scored.length),
  };
}

/** 校验池：全量 scored 中内部达标 / LLM≥80 / 纯联网 AI 达标 / 内部+联网合并且联网 AI 达标 */
function buildValidatePool(scored) {
  const map = new Map();
  const add = (c) => {
    if (!c) return;
    const key = candidateDedupeKey(c);
    if (!key || map.has(key)) return;
    map.set(key, c);
  };
  for (const c of scored) {
    const llm = c.llmProductScore != null ? Number(c.llmProductScore) : null;
    const ai = getCandidateAiPart(c);
    const srcs = c.sources || (c.source ? [c.source] : []);
    if (c.internalScore >= VALIDATE_INTERNAL_MIN) add(c);
    else if (llm != null && llm >= LLM_HIGH_TRUST_THRESHOLD) add(c);
    else if (!c.hasInternal && ai >= WEB_VALIDATE_AI_MIN) add(c);
    else if (c.hasInternal && srcs.includes('ai_web') && ai >= WEB_VALIDATE_AI_MIN) add(c);
  }
  return [...map.values()].slice(0, TOP_N_VALIDATE + 15);
}

function mapCandidateToPersistRow(c) {
  const aiPart = getCandidateAiPart(c);
  const finalScore = computeComprehensiveScore(c);
  return {
    display_name: c.display_name,
    unified_credit_code: c.unified_credit_code,
    finalScore,
    grade: scoreToGrade(finalScore),
    sources: c.sources || [c.source],
    financing_amount_text: c.financing_amount_text,
    breakdown: {
      internal_score: c.internalScore,
      ai_score: aiPart,
      final_score: finalScore,
      score_mode: !c.hasInternal
        ? 'ai_only'
        : aiPart >= LLM_HIGH_TRUST_THRESHOLD
          ? 'internal_0.2_ai_0.8'
          : 'internal_0.6_ai_0.4',
      tag_score: c.tagScore,
      product_score: c.productScore,
      industry_score: c.industryScore,
      llm_product_score: c.llmProductScore,
      validation: c.validation || null,
    },
  };
}

async function appendStepLog({ runId, subjectType, stepCode, status, message, detail }) {
  logCompetitorRun(runId, stepCode, `[${status || 'ok'}] ${message || ''}`, detail);
  try {
    const id = await generateId('sourcing_competitor_run_step_log');
    await db.execute(
      `INSERT INTO sourcing_competitor_run_step_log (
         id, run_id, subject_type, step_code, status, message, detail_json, created_at
       ) VALUES (?,?,?,?,?,?,?,NOW())`,
      [
        id,
        runId,
        subjectType,
        stepCode,
        status,
        message ? String(message).slice(0, 500) : null,
        detail ? JSON.stringify(detail) : null,
      ]
    );
  } catch (e) {
    console.warn('[competitorRunner] step log failed', stepCode, e.message);
  }
}

function buildTargetProfile(row, readiness, subjectType) {
  const qccSan = readiness?.sanitizedQcc || sanitizeQccCompanyIntroForMatching(row.qcc_company_intro);
  const tags =
    readiness?.tags ||
    mergeTagArrays(parseTagsFromRow(row), []);
  return {
    subject_type: subjectType,
    display_name: strTrim(row.enterprise_full_name) || strTrim(row.project_abbreviation),
    unified_credit_code: normalizeCreditCode(row.unified_credit_code),
    product_intro: strTrim(row.ai_product_intro),
    qcc_intro_effective: qccSan.effectiveText || '',
    tags,
    industry_l1: strTrim(row.industry_std_lv1) || null,
    industry_l2: strTrim(row.industry_std_lv2) || null,
  };
}

function ruleScoreCandidate(target, cand) {
  const tagScore = Math.round(jaccardSimilarity(target.tags, cand.tags) * 100);
  const introA = [target.product_intro, target.qcc_intro_effective].filter(Boolean).join('\n');
  const introB = [cand.product_intro, cand.qcc_intro].filter(Boolean).join('\n');
  const productScore = Math.round(textOverlapScore(introA, introB) * 100);
  let industryScore = 0;
  if (target.industry_l1 && cand.industry_l1) {
    if (target.industry_l1 === cand.industry_l1) industryScore += 50;
    industryScore += Math.round(l2Similarity(target.industry_l2, cand.industry_l2) * 50);
  } else {
    industryScore = Math.round(jaccardSimilarity(target.tags, cand.tags) * 80);
  }
  const internalScore = weightedScore([
    { value: tagScore, weight: 0.35 },
    { value: productScore, weight: 0.4 },
    { value: industryScore, weight: 0.25 },
  ]);
  return {
    tagScore,
    productScore,
    industryScore,
    internalScore,
    hasInternal: (cand.sources || []).some((s) => s === 'ipo_project' || s === 'sourcing_financing_event'),
  };
}

function sliceForLlm(target, cand) {
  return {
    product_intro: cand.product_intro,
    qcc_intro_effective: cand.qcc_intro,
    tags: cand.tags,
    industry_l1: cand.industry_l1,
    industry_l2: cand.industry_l2,
    display_name: cand.display_name,
  };
}

async function evaluatePreInvestmentReadiness(row) {
  const productIntro = strTrim(row.ai_product_intro);
  const qccSan = sanitizeQccCompanyIntroForMatching(row.qcc_company_intro);
  const tags = parseTagsFromRow(row);
  const hasProduct = productIntro.length > 0;
  const hasEffectiveQcc = qccSan.effectiveText.length >= 20;
  const hasTags = tags.length >= 1;
  const reasons = [];
  if (!hasProduct) reasons.push('缺少产品介绍(AI)');
  if (!hasEffectiveQcc && !strTrim(row.qcc_company_intro)) reasons.push('无有效企查查业务介绍');
  else if (!hasEffectiveQcc) reasons.push('企查查企业介绍过短或不足以作业务语义');
  if (!hasTags) reasons.push('无可用企业标签');
  const needSupplement = !hasProduct && !hasEffectiveQcc && !hasTags;
  return {
    ready: !needSupplement,
    needSupplement,
    reasons,
    sanitizedQcc: qccSan,
    tags,
  };
}

async function updateRunStatus(runTable, runId, status, message) {
  await db.execute(
    `UPDATE ${runTable} SET status = ?, message = ?, finished_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [status, message ? String(message).slice(0, 500) : null, runId]
  );
}

async function archivePriorCompetitorRelations({
  subjectType,
  investedEnterpriseId,
  preInvestmentProjectId,
  userId,
  executor,
}) {
  const dbExec = executor || db.execute.bind(db);
  const uid = userId ? String(userId) : null;
  if (subjectType === 'invested_enterprise' && investedEnterpriseId) {
    await dbExec(
      `UPDATE sourcing_competitor_relation
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?, updated_at = NOW()
       WHERE invested_enterprise_id = ? AND delete_mark = 0`,
      [uid, investedEnterpriseId]
    );
  } else if (subjectType === 'pre_investment_project' && preInvestmentProjectId) {
    await dbExec(
      `UPDATE sourcing_competitor_relation
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?, updated_at = NOW()
       WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project' AND delete_mark = 0`,
      [uid, preInvestmentProjectId]
    );
  }
}

async function persistRelations({
  subjectType,
  investedEnterpriseId,
  preInvestmentProjectId,
  runId,
  preInvestmentRunId,
  subjectDisplayName,
  rows,
  userId,
  candidateByKey,
}) {
  const comparablePrefs = await loadComparablePrefsForSubject({
    subjectType,
    investedEnterpriseId,
    preInvestmentProjectId,
  });
  const financingIndex = await buildFinancingEventIndex();

  // ── 预先准备好所有待写入的数据（在事务外完成，减少事务持有时间）──
  const preparedRows = [];
  for (const r of rows) {
    const key = candidateDedupeKey({
      unified_credit_code: r.unified_credit_code,
      display_name: r.display_name,
    });
    const cand = (candidateByKey && candidateByKey.get(key)) || r._candidate || r;
    const displayFields = await enrichCompetitorDisplayFields(cand, { runId });
    const fieldEnhance = enrichRelationFieldsBeforePersist(
      {
        displayName: r.display_name,
        unifiedCreditCode: r.unified_credit_code,
        candidate: cand,
      },
      financingIndex
    );
    const creditFinal = fieldEnhance.unified_credit_code || r.unified_credit_code || null;
    const includeComparable = isComparablePreferred(comparablePrefs, {
      unified_credit_code: creditFinal,
      competitor_display_name: r.display_name,
      competitor_weak_key: creditFinal ? null : strTrim(r.display_name).slice(0, 160) || null,
    })
      ? 1
      : 0;
    const relId = await generateId('sourcing_competitor_relation');

    preparedRows.push({
      relId,
      subjectType,
      investedEnterpriseId: investedEnterpriseId || null,
      preInvestmentProjectId: preInvestmentProjectId || null,
      runIdValue: subjectType === 'invested_enterprise' ? runId : null,
      preInvestmentRunId: preInvestmentRunId || null,
      subjectDisplayName,
      displayName: r.display_name,
      creditFinal,
      isListed: fieldEnhance.is_listed ? 1 : 0,
      weakKey: creditFinal ? null : strTrim(r.display_name).slice(0, 160) || null,
      finalScore: r.finalScore,
      grade: r.grade,
      breakdownJson: JSON.stringify(r.breakdown),
      sourcesJson: JSON.stringify(r.sources || []),
      financingAmountText: fieldEnhance.financing_history_text
        ? String(fieldEnhance.financing_history_text).split('\n')[0].slice(0, 128)
        : r.financing_amount_text || null,
      financingHistoryText: fieldEnhance.financing_history_text || null,
      competitorProductIntro: displayFields.competitor_product_intro,
      competitorTagsDisplay: displayFields.competitor_tags_display,
      competitorTagsJson: displayFields.competitor_tags_json,
      subFundNames: displayFields.sub_fund_names,
      includeComparable,
    });
  }

  // ── 在事务中原子执行：归档旧数据 + 写入新数据 ──
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 归档旧竞品关系（事务内）
    await archivePriorCompetitorRelations({
      subjectType,
      investedEnterpriseId,
      preInvestmentProjectId,
      userId,
      executor: (sql, params) => conn.execute(sql, params),
    });

    // 批量插入新关系（事务内）
    let n = 0;
    for (const p of preparedRows) {
      await conn.execute(
        `INSERT INTO sourcing_competitor_relation (
           id, subject_type, invested_enterprise_id, pre_investment_project_id,
           run_id, pre_investment_run_id, subject_display_name,
           competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
           relevance_score, confidence_grade, score_breakdown_json,
           data_sources_json, financing_amount_text, financing_history_text,
           competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
           include_in_comparable, created_at, updated_at, delete_mark
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
        [
          p.relId,
          p.subjectType,
          p.investedEnterpriseId,
          p.preInvestmentProjectId,
          p.runIdValue,
          p.preInvestmentRunId,
          p.subjectDisplayName,
          p.displayName,
          p.creditFinal,
          p.isListed,
          p.weakKey,
          p.finalScore,
          p.grade,
          p.breakdownJson,
          p.sourcesJson,
          p.financingAmountText,
          p.financingHistoryText,
          p.competitorProductIntro,
          p.competitorTagsDisplay,
          p.competitorTagsJson,
          p.subFundNames,
          p.includeComparable,
        ]
      );
      n += 1;
    }

    await conn.commit();
    return n;
  } catch (txErr) {
    // 事务回滚：归档操作和新数据写入全部撤销，旧竞品数据安全保留
    if (conn) {
      try {
        await conn.rollback();
        console.log('[persistRelations] 事务已回滚，旧竞品关系数据已恢复');
      } catch (rbErr) {
        console.error('[persistRelations] 事务回滚失败:', rbErr.message);
      }
    }
    throw txErr;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * @param {object} opts
 * @param {'invested_enterprise'|'pre_investment_project'} opts.subjectType
 * @param {string} opts.runId
 * @param {string} [opts.investedEnterpriseId]
 * @param {string} [opts.preInvestmentProjectId]
 * @param {string} [opts.preInvestmentRunId]
 * @param {string|null} opts.userId
 * @param {boolean} [opts.enableAutoExpand]
 */
async function executeCompetitorAnalysisRun(opts) {
  const {
    subjectType,
    runId,
    investedEnterpriseId,
    preInvestmentProjectId,
    preInvestmentRunId,
    userId,
    enableAutoExpand = true,
  } = opts;
  const runTable =
    subjectType === 'pre_investment_project'
      ? 'sourcing_pre_investment_competitor_run'
      : 'sourcing_competitor_run';

  const logCtx = { runId };
  logCompetitorRun(runId, 'START', '竞品分析任务开始', {
    subjectType,
    investedEnterpriseId: investedEnterpriseId || null,
    preInvestmentProjectId: preInvestmentProjectId || null,
    enableAutoExpand,
    userId: userId || null,
    topN_llm_rule: TOP_N_LLM_RULE,
    topN_llm_tag: TOP_N_LLM_TAG,
    topN_validate: TOP_N_VALIDATE,
    scoreThreshold: SCORE_THRESHOLD,
    scoreThresholdHighLlm: SCORE_THRESHOLD_HIGH_LLM,
    llmHighTrust: LLM_HIGH_TRUST_THRESHOLD,
    llmGapMs: LLM_REQUEST_GAP_MS,
    persistAiWebOnly: true,
  });

  try {
    await db.execute(
      `UPDATE ${runTable} SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = ?`,
      [runId]
    );

    let row;
    let readiness;
    if (subjectType === 'invested_enterprise') {
      row = await getInvestedEnterpriseRowForCompetitor(investedEnterpriseId);
      const supTags = await loadLatestSupplementTags(row.id);
      readiness = await evaluateInvestedEnterpriseCompetitorReadiness(row);
      readiness.tags = mergeTagArrays(readiness.tags, supTags);
      if (!readiness.ready) {
        throw new Error('信息不足，无法运行竞品分析');
      }
    } else {
      const rows = await db.query(
        `SELECT id, enterprise_full_name, unified_credit_code, project_abbreviation,
                ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro
         FROM pre_investment_project WHERE id = ? AND delete_mark = 0 LIMIT 1`,
        [preInvestmentProjectId]
      );
      if (!rows.length) throw new Error('投前项目不存在');
      row = rows[0];
      readiness = await evaluatePreInvestmentReadiness(row);
      if (!readiness.ready) throw new Error('信息不足，请先完成企查查与 AI 取数');
    }

    const target = buildTargetProfile(row, readiness, subjectType);
    const subjectDisplayName = target.display_name;

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S0_profile',
      status: 'ok',
      message: '目标画像就绪',
      detail: {
        display_name: subjectDisplayName,
        unified_credit_code: target.unified_credit_code || null,
        tag_count: target.tags.length,
        tags: target.tags.slice(0, 12),
        product_intro_len: (target.product_intro || '').length,
        qcc_len: (target.qcc_intro_effective || '').length,
      },
    });

    const { getCompetitorRecallSourceFlags } = require('./competitorRecallSourceConfig');
    const { canReadFinancingPoolForUser } = require('./competitorAnalysisRouteAuth');
    const recallFlags = await getCompetitorRecallSourceFlags();
    const canFinancing = userId ? await canReadFinancingPoolForUser(userId) : false;

    let ipoList = [];
    if (recallFlags.enable_ipo_project) {
      ipoList = await recallFromIpoProjects(target.unified_credit_code, target.display_name);
    }
    let finList = [];
    let financingSkipReason = null;
    if (!recallFlags.enable_financing_event) {
      financingSkipReason = 'config_disabled';
    } else if (!canFinancing) {
      financingSkipReason = 'no_project_sourcing_permission';
    } else {
      finList = await recallFromFinancingEvents(target.unified_credit_code, target.display_name);
    }
    let candidates = mergeRecalledCandidates(ipoList, finList);

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S1_recall',
      status: 'ok',
      message: `内部源召回 ${candidates.length} 条`,
      detail: {
        ipo: ipoList.length,
        financing: finList.length,
        financing_skipped: financingSkipReason,
        recall_flags: recallFlags,
        merged: candidates.length,
        sample: summarizeCandidates(candidates, 5),
      },
    });

    const scored = candidates.map((c) => {
      const rs = ruleScoreCandidate(target, c);
      return { ...c, ...rs };
    });
    scored.sort((a, b) => b.internalScore - a.internalScore);

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S2_rule',
      status: 'ok',
      message: `规则打分完成，共 ${scored.length} 条`,
      detail: { top: summarizeCandidates(scored, 10) },
    });

    const targetSlice = {
      product_intro: target.product_intro,
      qcc_intro_effective: target.qcc_intro_effective,
      tags: target.tags,
    };

    const { pool: llmPool, niche: nicheTrack, tagAdded, kwAdded, ruleTop } = buildLlmScoringPool(scored, target);
    logCompetitorRun(runId, 'S3_llm', `LLM 产品对标开始，池大小 ${llmPool.length}`, {
      rule_top: ruleTop,
      tag_supplement: tagAdded,
      keyword_supplement: kwAdded,
      niche_track: nicheTrack,
    });
    for (let i = 0; i < llmPool.length; i++) {
      const c = llmPool[i];
      if (i > 0 && LLM_REQUEST_GAP_MS > 0) await sleep(LLM_REQUEST_GAP_MS);
      try {
        c.llmProductScore = await scorePairSimilarity(targetSlice, sliceForLlm(target, c), {
          runId,
          candidateName: c.display_name,
        });
      } catch (err) {
        c.llmProductScore = c.productScore;
        logCompetitorRun(runId, 'S3_llm', `对标异常 ${c.display_name}: ${err.message}`);
      }
    }
    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S3_llm',
      status: 'ok',
      message: `LLM 对标完成 ${llmPool.length} 条（规则Top${ruleTop}+标签${tagAdded}+关键词${kwAdded}${nicheTrack ? '，掩模赛道' : ''}）`,
      detail: {
        pool_size: llmPool.length,
        niche_track: nicheTrack,
        tag_supplement: tagAdded,
        keyword_supplement: kwAdded,
        top: summarizeCandidates(
          [...scored].sort((a, b) => (b.llmProductScore ?? 0) - (a.llmProductScore ?? 0)),
          12
        ),
        high_llm_count: scored.filter((c) => (c.llmProductScore ?? 0) >= LLM_HIGH_TRUST_THRESHOLD).length,
      },
    });

    let webAdded = 0;
    if (!recallFlags.enable_ai_web) {
      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S4_web',
        status: 'ok',
        message: '联网发现已关闭（配置）',
        detail: { web_added: 0, skipped: 'config_disabled' },
      });
    } else try {
      const keywords = target.tags.slice(0, 8);
      const excludeNames = scored.slice(0, 30).map((x) => x.display_name).filter(Boolean);
      const webRes = await discoverWebCompetitors(target, keywords, excludeNames, logCtx);
      const webList = Array.isArray(webRes) ? webRes : webRes.candidates || [];
      const webMeta = webRes && !Array.isArray(webRes) ? webRes.meta || {} : {};
      for (const w of webList) {
        const name = strTrim(w.company_name);
        if (!name) continue;
        const key = normalizeCreditCode(w.unified_credit_code) || name.toLowerCase();
        const dupIdx = scored.findIndex(
          (x) => (x.unified_credit_code && x.unified_credit_code === key) || x.display_name === name
        );
        if (dupIdx >= 0) {
          const x = scored[dupIdx];
          const srcs = x.sources || (x.source ? [x.source] : []);
          if (!srcs.includes('ai_web')) {
            x.sources = [...srcs, 'ai_web'];
          }
          const rawRel = Number(w.ai_relevance_score);
          const rel = Number.isFinite(rawRel) ? Math.min(100, Math.max(0, rawRel)) : 0;
          const webAi = Math.max(WEB_VALIDATE_AI_MIN, rel) || WEB_VALIDATE_AI_MIN;
          const prevLlm = x.llmProductScore != null ? Number(x.llmProductScore) : 0;
          x.llmProductScore = Math.max(Number.isFinite(prevLlm) ? prevLlm : 0, webAi);
          if (w.is_listed != null && parseIsListedFromCandidate({ is_listed: w.is_listed })) {
            x.is_listed = true;
          }
          if (w.unified_credit_code && !x.unified_credit_code) {
            x.unified_credit_code = normalizeCreditCode(w.unified_credit_code) || null;
          }
          continue;
        }
        const rawRel = Number(w.ai_relevance_score);
        const rel = Number.isFinite(rawRel) ? Math.min(100, Math.max(0, rawRel)) : 0;
        /** 联网初分若低于校验池下限，仍保底进入 S5（避免模型给 40～54 导致 by_ai_web=0） */
        const webAi = Math.max(WEB_VALIDATE_AI_MIN, rel) || WEB_VALIDATE_AI_MIN;
        scored.push({
          source: 'ai_web',
          sources: ['ai_web'],
          display_name: name,
          unified_credit_code: normalizeCreditCode(w.unified_credit_code) || null,
          is_listed: parseIsListedFromCandidate({ is_listed: w.is_listed }) === 1,
          product_intro: strTrim(w.core_products),
          tags: [],
          internalScore: 0,
          hasInternal: false,
          llmProductScore: webAi,
          financing_amount_text: null,
        });
        webAdded += 1;
      }
      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S4_web',
        status: 'ok',
        message: `联网发现 ${webAdded} 条`,
        detail: {
          web_added: webAdded,
          used_enable_search: webMeta.used_enable_search === true,
          search_degraded: webMeta.search_degraded === true,
          model_name: webMeta.model_name || null,
        },
      });
    } catch (e) {
      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S4_web',
        status: 'warn',
        message: e.message,
        detail: {
          hint:
            '若含 timeout：降级无联网后单次请求超时，可调高 COMPETITOR_WEB_NO_SEARCH_TIMEOUT_MS；若需真正联网请换支持 enable_search 的模型（见 S4_web 成功时的 used_enable_search）。',
        },
      });
    }

    const validatePool = buildValidatePool(scored);
    const validateReasons = {
      by_internal_rule: scored.filter((c) => c.internalScore >= VALIDATE_INTERNAL_MIN).length,
      by_high_llm: scored.filter(
        (c) =>
          c.internalScore < VALIDATE_INTERNAL_MIN &&
          (c.llmProductScore ?? 0) >= LLM_HIGH_TRUST_THRESHOLD
      ).length,
      by_ai_web: scored.filter((c) => {
        const srcs = c.sources || (c.source ? [c.source] : []);
        return srcs.includes('ai_web') && getCandidateAiPart(c) >= WEB_VALIDATE_AI_MIN;
      }).length,
    };
    logCompetitorRun(runId, 'S5_validate', `竞品校验开始，池大小 ${validatePool.length}`, validateReasons);
    for (let vi = 0; vi < validatePool.length; vi++) {
      const c = validatePool[vi];
      if (vi > 0 && LLM_REQUEST_GAP_MS > 0) await sleep(LLM_REQUEST_GAP_MS);
      try {
        c.validation = await validateCandidate(targetSlice, sliceForLlm(target, c), {
          runId,
          candidateName: c.display_name,
        });
        if (c.validation?.is_listed != null && parseIsListedFromCandidate({ is_listed: c.validation.is_listed })) {
          c.is_listed = true;
        }
        if (!c.hasInternal && c.validation?.validated_score != null) {
          c.llmProductScore = Number(c.validation.validated_score);
        }
      } catch (err) {
        c.validation = { is_competitor: true, validated_score: 50, is_upstream_downstream: false };
        logCompetitorRun(runId, 'S5_validate', `校验异常 ${c.display_name}: ${err.message}`);
      }
    }
    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S5_validate',
      status: 'ok',
      message: `校验完成 ${validatePool.length} 条`,
      detail: {
        validateReasons,
        passed: validatePool.filter((c) => c.validation?.is_competitor !== false).length,
        rejected: validatePool.filter((c) => c.validation?.is_competitor === false).length,
        upstream_downstream: validatePool.filter((c) => c.validation?.is_upstream_downstream).length,
      },
    });

    const toPersist = [];
    const filterStats = {
      total_scored: scored.length,
      skip_not_competitor: 0,
      skip_upstream_downstream: 0,
      skip_low_score: 0,
      accepted_internal: 0,
      accepted_ai_only: 0,
    };
    const rejectedSamples = [];
    for (const c of scored) {
      if (c.validation && c.validation.is_competitor === false) {
        filterStats.skip_not_competitor += 1;
        if (rejectedSamples.length < 30) {
          rejectedSamples.push({
            name: c.display_name,
            credit: c.unified_credit_code || null,
            internal: c.internalScore,
            llm: c.llmProductScore,
            reason: '校验判定：非竞品',
            sources: c.sources || (c.source ? [c.source] : []),
          });
        }
        continue;
      }
      if (c.validation && c.validation.is_upstream_downstream) {
        filterStats.skip_upstream_downstream += 1;
        if (rejectedSamples.length < 30) {
          rejectedSamples.push({
            name: c.display_name,
            credit: c.unified_credit_code || null,
            internal: c.internalScore,
            llm: c.llmProductScore,
            reason: '校验判定：上下游关系',
            sources: c.sources || (c.source ? [c.source] : []),
          });
        }
        continue;
      }

      const row = mapCandidateToPersistRow(c);
      if (!meetsPersistThreshold(c, row.finalScore)) {
        filterStats.skip_low_score += 1;
        if (rejectedSamples.length < 30) {
          rejectedSamples.push({
            name: c.display_name,
            credit: c.unified_credit_code || null,
            internal: c.internalScore,
            llm: c.llmProductScore,
            final: row.finalScore,
            reason: `综合分 ${row.finalScore} 未达落库阈值（常规≥${SCORE_THRESHOLD}，高信任竞品≥${SCORE_THRESHOLD_HIGH_LLM}）`,
            sources: c.sources || (c.source ? [c.source] : []),
          });
        }
        continue;
      }

      if (c.hasInternal) filterStats.accepted_internal += 1;
      else filterStats.accepted_ai_only += 1;
      toPersist.push({ ...row, _candidate: c });
    }

    toPersist.sort((a, b) => b.finalScore - a.finalScore);

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S5_filter',
      status: 'ok',
      message: `初筛通过 ${toPersist.length} 条（≥${SCORE_THRESHOLD}；高信任竞品≥${SCORE_THRESHOLD_HIGH_LLM}）`,
      detail: {
        filterStats,
        candidates: summarizeCandidates(toPersist, 15),
        rejected_samples: rejectedSamples,
      },
    });

    let finalList = toPersist;
    if (enableAutoExpand) {
      const bPlus = toPersist.filter((x) => ['S', 'A', 'B'].includes(x.grade));
      if (toPersist.length < AUTO_EXPAND_MIN_COUNT || bPlus.length < AUTO_EXPAND_MIN_B_PLUS) {
        logCompetitorRun(runId, 'S5_expand', '触发扩召回', {
          current: toPersist.length,
          b_plus: bPlus.length,
          min_count: AUTO_EXPAND_MIN_COUNT,
          min_b_plus: AUTO_EXPAND_MIN_B_PLUS,
        });
        const relaxed = scored
          .filter((c) => {
            const srcs = c.sources || (c.source ? [c.source] : []);
            const ai = getCandidateAiPart(c);
            return (
              (c.hasInternal && c.internalScore >= 40) ||
              (ai >= WEB_VALIDATE_AI_MIN && (!c.hasInternal || srcs.includes('ai_web'))) ||
              (c.llmProductScore ?? 0) >= LLM_HIGH_TRUST_THRESHOLD
            );
          })
          .slice(0, 50)
          .map((c) => {
            const row = mapCandidateToPersistRow(c);
            row.breakdown = { ...row.breakdown, expanded: true };
            row._candidate = c;
            return row;
          })
          .filter((x) => meetsPersistThreshold(x._candidate, x.finalScore));
        const seen = new Set();
        finalList = [];
        for (const x of [...toPersist, ...relaxed]) {
          const k = x.unified_credit_code || x.display_name;
          if (seen.has(k)) continue;
          seen.add(k);
          finalList.push(x);
        }
        finalList.sort((a, b) => b.finalScore - a.finalScore);
        await appendStepLog({
          runId,
          subjectType,
          stepCode: 'S5_expand',
          status: 'ok',
          message: `扩召回后 ${finalList.length} 条`,
          detail: { candidates: summarizeCandidates(finalList, 15) },
        });
      }
    }

    logCompetitorRun(runId, 'S6_persist', `准备落库 ${finalList.length} 条`, summarizeCandidates(finalList, 20));

    const candidateByKey = new Map();
    for (const c of scored) {
      candidateByKey.set(
        candidateDedupeKey({
          unified_credit_code: c.unified_credit_code,
          display_name: c.display_name,
        }),
        c
      );
    }

    const saved = await persistRelations({
      subjectType,
      investedEnterpriseId: subjectType === 'invested_enterprise' ? investedEnterpriseId : null,
      preInvestmentProjectId: subjectType === 'pre_investment_project' ? preInvestmentProjectId : null,
      runId,
      preInvestmentRunId,
      subjectDisplayName,
      rows: finalList,
      userId,
      candidateByKey,
    });

    const msg = `竞品分析完成：召回 ${candidates.length}，落库 ${saved} 条（≥${SCORE_THRESHOLD} / 高信任≥${SCORE_THRESHOLD_HIGH_LLM}；LLM 池规则+标签+关键词；联网发现失败或模型不支持联网时会自动降级重试）`;
    await updateRunStatus(runTable, runId, 'success', msg);
    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S6_done',
      status: 'ok',
      message: msg,
      detail: { saved },
    });
    return { ok: true, saved, message: msg };
  } catch (e) {
    logCompetitorRun(runId, 'FAILED', e.message || '运行失败', {
      stack: e.stack ? String(e.stack).split('\n').slice(0, 5) : undefined,
    });
    console.error('[competitorRunner]', runId, e);
    const runTable =
      subjectType === 'pre_investment_project'
        ? 'sourcing_pre_investment_competitor_run'
        : 'sourcing_competitor_run';
    await updateRunStatus(runTable, runId, 'failed', e.message || '运行失败');
    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S6_done',
      status: 'failed',
      message: e.message,
    });
    return { ok: false, message: e.message };
  }
}

function enqueueCompetitorAnalysisRun(opts) {
  logCompetitorRun(opts.runId, 'ENQUEUE', '已入队异步执行', {
    subjectType: opts.subjectType,
    investedEnterpriseId: opts.investedEnterpriseId || null,
    preInvestmentProjectId: opts.preInvestmentProjectId || null,
  });
  setImmediate(() => {
    executeCompetitorAnalysisRun(opts).catch((err) => {
      logCompetitorRun(opts.runId, 'UNHANDLED', err.message || String(err));
      console.error('[competitorRunner] unhandled', err);
    });
  });
}

/** 查询某次运行的步骤日志（库表 + 与控制台同结构） */
async function listCompetitorRunStepLogs(runId) {
  const id = String(runId || '').trim();
  if (!id) return [];
  return db.query(
    `SELECT id, run_id, subject_type, step_code, status, message, detail_json, created_at
     FROM sourcing_competitor_run_step_log
     WHERE run_id = ?
     ORDER BY created_at ASC`,
    [id]
  );
}

module.exports = {
  executeCompetitorAnalysisRun,
  enqueueCompetitorAnalysisRun,
  evaluatePreInvestmentReadiness,
  listCompetitorRunStepLogs,
};
