const { generateId, generateSequentialIds } = require('../idGenerator');
const fs = require('fs');
const path = require('path');
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
  recallListedIpoByProductTerms,
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
  getThresholds,
  isPersistValidationPassed,
  LLM_HIGH_TRUST_THRESHOLD,
  SCORE_THRESHOLD_PERSIST,
  SCORE_THRESHOLD_HIGH_LLM,
  VALIDATE_INTERNAL_MIN_DEFAULT,
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
  discoverDomesticListedCompetitors,
  validateCandidate,
} = require('./competitorAnalysisAi');
const {
  logCompetitorRun,
  summarizeCandidates,
} = require('./competitorAnalysisLogger');
const { enrichCompetitorDisplayFields, clearEnrichCache } = require('./competitorRelationEnrichService');
const { clearInternalDisplayCache } = require('./competitorInternalDisplayLoader');
const { buildFinancingEventIndex } = require('./competitorFinancingResolve');
const { loadComparablePrefsForSubject } = require('./competitorComparablePrefService');
const { isComparablePreferred } = require('./competitorCompanyMatch');
const {
  enrichRelationFieldsBeforePersist,
  parseIsListedFromCandidate,
} = require('./competitorRelationPersistEnhance');
const { defaultIncludeInComparable } = require('./competitorTypeUtils');
const { buildEvidenceMeta } = require('./competitorEvidenceUtils');
const {
  loadHumanLockedDedupeKeys,
  relinkHumanLockedRelationsToRun,
} = require('./competitorRelationReviewService');
const {
  MIN_DOMESTIC_LISTED_COMPETITORS,
  isDomesticListedFromIpoPool,
  countDomesticListedInScored,
  countDomesticListedInPersistRows,
  buildListedDomesticDiscoverKeywords,
  mergeWebCandidatesIntoScored,
  listedMandateMeetsThreshold,
  sortDomesticListedCandidates,
} = require('./competitorListedDomestic');
const {
  computeProductPrecisionScores,
  extractCoreProductLines,
} = require('./competitorProductLineUtils');

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
/** 过滤膜/滤芯赛道信号（目标扩池须命中，避免「澄清过滤系统」等装备类误触发） */
const BIO_FILTER_MEMBRANE_SIGNAL_RE =
  /过滤膜|除菌过滤|深层过滤|除病毒过滤|囊式过滤|TFF|切向流|超滤膜|滤芯|膜包|除菌滤|深层滤|膜过滤|微滤膜|纳滤膜|过滤耗材.*膜|生物工艺.*膜/i;
/** 候选赛道命中（膜/滤芯相关，不含泛「过滤系统」） */
const BIO_FILTER_TRACK_RE =
  /生物制药.*过滤膜|制药.*过滤膜|过滤膜|除菌过滤|深层过滤|切向流|TFF|超滤膜|生物工艺.*膜|除病毒过滤|囊式过滤|过滤器材|滤芯|过滤耗材|膜过滤|除菌滤|深层滤|微滤|纳滤|膜包|切向流过滤|除菌级.*滤/i;
/** 血液透析/净化为主业（与生物制药过滤膜形成双赛道边界） */
const DIALYSIS_PRIMARY_RE =
  /血液透析|透析器|腹膜透析|CRRT|血液净化|肾病治疗|肾科|透析耗材|透析设备|空心纤维透析/i;
/** 专业赛道：规则 Top 槽位优先给赛道命中候选（替代盲取 internal Top20） */
const TOP_N_LLM_RULE_TRACK = 28;
/** 掩模赛道：名称/简介含关键词的候选补充进 LLM 池（与规则 Top 并集） */
const KEYWORD_LLM_CAP = 28;
const TOP_N_VALIDATE = 24;
const AUTO_EXPAND_MIN_COUNT = 3;
const AUTO_EXPAND_MIN_B_PLUS = 1;
const LLM_REQUEST_GAP_MS = Math.max(0, parseInt(process.env.COMPETITOR_LLM_GAP_MS || '650', 10) || 650);
/** 联网候选进入校验的 AI 初分下限 */
const WEB_VALIDATE_AI_MIN = 55;
/** 专业赛道：内部池经 S3 对标后进入 S5 的 LLM 分下限（规则分低时仍校验） */
const TRACK_INTERNAL_LLM_VALIDATE_MIN = 45;
/** S3 入池：规则分低于此且未命中标签/赛道豁免则跳过 LLM（0=关闭） */
const LLM_POOL_RULE_MIN = Math.max(
  0,
  parseInt(process.env.COMPETITOR_LLM_RULE_MIN || '15', 10) || 15
);
/** 全池规则分峰值低于此视为弱匹配，缩小 LLM 池上限 */
const LLM_POOL_WEAK_MAX_INTERNAL =
  parseInt(process.env.COMPETITOR_LLM_WEAK_MAX_INTERNAL || '35', 10) || 35;
/** 弱匹配时 LLM 池最多条数 */
const LLM_POOL_WEAK_CAP = Math.max(
  8,
  parseInt(process.env.COMPETITOR_LLM_WEAK_POOL_CAP || '15', 10) || 15
);
/** 赛道命中豁免：internal 下限（避免完全无关仍因关键词进池） */
const LLM_POOL_TRACK_INTERNAL_FLOOR = Math.max(
  0,
  parseInt(process.env.COMPETITOR_LLM_TRACK_INTERNAL_FLOOR || '8', 10) || 8
);
const LLM_POOL_TRACK_PRODUCT_FLOOR = Math.max(
  0,
  parseInt(process.env.COMPETITOR_LLM_TRACK_PRODUCT_FLOOR || '12', 10) || 12
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNicheTrackTarget(target) {
  const tags = target?.tags || [];
  const intro = [target?.product_intro, target?.qcc_intro_effective].filter(Boolean).join(' ');
  return tags.some((t) => NICHE_TRACK_TAG_RE.test(String(t))) || NICHE_TRACK_TAG_RE.test(intro);
}

function isBioFilterTrackTarget(target) {
  const tags = target?.tags || [];
  const intro = [target?.product_intro, target?.qcc_intro_effective, target?.display_name]
    .filter(Boolean)
    .join('\n');
  const membraneInTags = tags.some((t) => BIO_FILTER_MEMBRANE_SIGNAL_RE.test(String(t)));
  const membraneInIntro = BIO_FILTER_MEMBRANE_SIGNAL_RE.test(intro);
  return membraneInTags || membraneInIntro;
}

function isDialysisPrimaryTarget(target) {
  const tags = target?.tags || [];
  const intro = [target?.product_intro, target?.qcc_intro_effective].filter(Boolean).join(' ');
  const blob = [...tags, intro].join('\n');
  return DIALYSIS_PRIMARY_RE.test(blob);
}

/** 从目标画像生成中性 subject_track_hint，供校验 prompt 读取（不写死行业结论） */
function inferSubjectTrackHint(target) {
  const parts = [];
  if (target?.industry_l1) parts.push(`行业一级：${target.industry_l1}`);
  if (target?.industry_l2) parts.push(`行业二级：${target.industry_l2}`);
  const tagStr = (target?.tags || [])
    .map((t) => strTrim(t))
    .filter(Boolean)
    .slice(0, 6)
    .join('、');
  if (tagStr) parts.push(`标签：${tagStr}`);
  const intro = [target?.product_intro, target?.qcc_intro_effective]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  if (intro) parts.push(`业务摘要：${intro}`);
  const coreLines = extractCoreProductLines(target);
  if (coreLines.length) parts.push(`核心产品线：${coreLines.slice(0, 8).join('、')}`);
  return parts.length ? parts.join('；') : null;
}

function trackReForKind(trackKind) {
  if (trackKind === 'niche') return NICHE_TRACK_TAG_RE;
  if (trackKind === 'bio_filter' || trackKind === 'dialysis_dual') return BIO_FILTER_TRACK_RE;
  return null;
}

function getExpandedLlmTrackKind(target) {
  if (isNicheTrackTarget(target)) return 'niche';
  if (isDialysisPrimaryTarget(target) && isBioFilterTrackTarget(target)) return 'dialysis_dual';
  if (isBioFilterTrackTarget(target)) return 'bio_filter';
  return null;
}

/** 从目标简介抽取检索短语（通用，不写死行业词或企业名） */
function extractIntroSearchTerms(intro) {
  const s = String(intro || '').trim();
  if (!s) return [];
  const terms = [];
  const phraseRe =
    /[\u4e00-\u9fff]{2,14}(?:产品|服务|系统|平台|方案|设备|材料|耗材|技术|应用|制造|销售|加工|软件|工具)/g;
  let m;
  while ((m = phraseRe.exec(s)) !== null && terms.length < 8) {
    const t = m[0].trim();
    if (t.length >= 4 && !terms.includes(t)) terms.push(t);
  }
  if (terms.length < 3) {
    for (const seg of s.split(/[，,。；;、\n]/)) {
      const t = seg.trim().slice(0, 24);
      if (t.length >= 4 && !terms.includes(t)) terms.push(t);
      if (terms.length >= 6) break;
    }
  }
  return terms.slice(0, 6);
}

function candidateHitsTrackKeyword(c, trackRe) {
  if (!trackRe) return false;
  const blob = [c.display_name, c.product_intro, c.qcc_intro, ...(c.tags || [])]
    .filter(Boolean)
    .join('\n');
  return trackRe.test(blob);
}

function buildWebDiscoverKeywords(target) {
  const coreLines = target.core_product_lines?.length
    ? target.core_product_lines
    : extractCoreProductLines(target);
  const kw = coreLines.slice(0, 8).map((t) => strTrim(t)).filter(Boolean);
  kw.push(...target.tags.slice(0, 4).map((t) => strTrim(t)).filter(Boolean));
  if (target.industry_l1) kw.push(strTrim(target.industry_l1));
  if (target.industry_l2) kw.push(strTrim(target.industry_l2));
  const introBlob = [target.product_intro, target.qcc_intro_effective].filter(Boolean).join('\n');
  kw.push(...extractIntroSearchTerms(introBlob));
  kw.push('同行业上市公司', 'A股上市公司', '上交所', '深交所', '北交所');
  return [...new Set(kw)].slice(0, 16);
}

function trackRelevanceScore(c) {
  return (
    (c.coreLineScore || 0) * 0.38 +
    (c.productScore || 0) * 0.32 +
    (c.tagScore || 0) * 0.15 +
    (c.internalScore || 0) * 0.15
  );
}

function maxInternalScoreInList(list) {
  if (!list?.length) return 0;
  return list.reduce((m, c) => Math.max(m, c.internalScore || 0), 0);
}

function resolveLlmPoolEffectiveCap(expanded, trackKind, maxInternal) {
  let cap = expanded
    ? trackKind === 'bio_filter' || trackKind === 'dialysis_dual'
      ? TOP_N_LLM_RULE_TRACK
      : TOP_N_LLM_RULE + 8
    : TOP_N_LLM_RULE + TOP_N_LLM_TAG;
  if (maxInternal < LLM_POOL_WEAK_MAX_INTERNAL) {
    cap = Math.min(cap, LLM_POOL_WEAK_CAP);
  }
  return cap;
}

/** S3 入池门槛：规则分/标签分/赛道命中/底层上市公司产品线命中豁免 */
function qualifiesForLlmPool(c, ctx) {
  if (!c) return false;
  if (isDomesticListedFromIpoPool(c) && (c.coreLineScore || 0) >= 10) return true;
  if (LLM_POOL_RULE_MIN <= 0) return true;
  const internal = c.internalScore || 0;
  const tag = c.tagScore || 0;
  const product = c.productScore || 0;
  const tagMin = ctx.tagMin ?? TAG_LLM_MIN;
  if (internal >= LLM_POOL_RULE_MIN) return true;
  if ((c.coreLineScore || 0) >= 15) return true;
  if (tag >= tagMin) return true;
  if (
    ctx.trackRe &&
    candidateHitsTrackKeyword(c, ctx.trackRe) &&
    internal >= LLM_POOL_TRACK_INTERNAL_FLOOR &&
    product >= LLM_POOL_TRACK_PRODUCT_FLOOR
  ) {
    return true;
  }
  return false;
}

/** LLM 对标池 = 规则分 Top + 标签分 Top（并集；专业赛道优先赛道命中候选） */
function buildLlmScoringPool(scored, target) {
  const map = new Map();
  let skippedPreLlm = 0;
  const add = (c) => {
    if (!c) return false;
    const key = candidateDedupeKey(c);
    if (!key || map.has(key)) return false;
    map.set(key, c);
    return true;
  };
  const tryAdd = (c, ctx) => {
    if (!qualifiesForLlmPool(c, ctx)) {
      skippedPreLlm += 1;
      return false;
    }
    return add(c);
  };
  const trackKind = getExpandedLlmTrackKind(target);
  const expanded = trackKind != null;
  const trackRe = trackReForKind(trackKind);
  const tagMin = expanded ? TAG_LLM_MIN_NICHE : TAG_LLM_MIN;
  const poolCtx = { trackRe, tagMin };
  let ruleTop = 0;

  if (expanded && trackRe) {
    const trackMatched = scored.filter((c) => candidateHitsTrackKeyword(c, trackRe));
    const byTrack = [...trackMatched].sort((a, b) => trackRelevanceScore(b) - trackRelevanceScore(a));
    const ruleCap =
      trackKind === 'bio_filter' || trackKind === 'dialysis_dual'
        ? TOP_N_LLM_RULE_TRACK
        : TOP_N_LLM_RULE + 8;
    const llmRuleFloor =
      trackKind === 'bio_filter' || trackKind === 'dialysis_dual'
        ? TOP_N_LLM_RULE_TRACK
        : TOP_N_LLM_RULE;
    for (const c of byTrack) {
      if (ruleTop >= ruleCap) break;
      if (tryAdd(c, poolCtx)) ruleTop += 1;
    }
    for (const c of scored) {
      if (map.size >= llmRuleFloor) break;
      const added = tryAdd(c, poolCtx);
      if (added && ruleTop < llmRuleFloor) ruleTop += 1;
    }
  } else {
    for (const c of scored.slice(0, TOP_N_LLM_RULE)) {
      tryAdd(c, poolCtx);
    }
    ruleTop = Math.min(TOP_N_LLM_RULE, map.size);
  }

  const tagCap = expanded ? TOP_N_LLM_TAG_NICHE : TOP_N_LLM_TAG;
  const byTag = [...scored].sort((a, b) => (b.tagScore || 0) - (a.tagScore || 0));
  let tagAdded = 0;
  for (const c of byTag) {
    if ((c.tagScore || 0) < tagMin) break;
    if (tryAdd(c, poolCtx)) tagAdded += 1;
    if (tagAdded >= tagCap) break;
  }

  let kwAdded = 0;
  if (expanded) {
    const byKw = scored
      .filter((c) => candidateHitsTrackKeyword(c, trackRe))
      .sort((a, b) => trackRelevanceScore(b) - trackRelevanceScore(a));
    for (const c of byKw) {
      if (kwAdded >= KEYWORD_LLM_CAP) break;
      if (tryAdd(c, poolCtx)) kwAdded += 1;
    }
  }

  const listedIpoBoost = [...scored]
    .filter((c) => isDomesticListedFromIpoPool(c))
    .sort(
      (a, b) =>
        (b.coreLineScore || 0) - (a.coreLineScore || 0) ||
        (b.internalScore || 0) - (a.internalScore || 0)
    );
  let listedIpoAdded = 0;
  const LISTED_IPO_POOL_SLOTS = 8;
  for (const c of listedIpoBoost) {
    if (listedIpoAdded >= LISTED_IPO_POOL_SLOTS) break;
    if (add(c)) listedIpoAdded += 1;
  }

  const maxInternal = maxInternalScoreInList(scored);
  const effectiveCap = resolveLlmPoolEffectiveCap(expanded, trackKind, maxInternal);
  let pool = [...map.values()];
  let poolTrimmed = 0;
  if (pool.length > effectiveCap) {
    poolTrimmed = pool.length - effectiveCap;
    pool = pool
      .sort(
        (a, b) =>
          (b.internalScore || 0) - (a.internalScore || 0) ||
          trackRelevanceScore(b) - trackRelevanceScore(a)
      )
      .slice(0, effectiveCap);
  }

  return {
    pool,
    niche: expanded,
    trackKind,
    tagAdded,
    kwAdded,
    listed_ipo_added: listedIpoAdded,
    ruleTop,
    track_rule_top: expanded ? ruleTop : 0,
    skipped_pre_llm: skippedPreLlm,
    pool_trimmed: poolTrimmed,
    max_internal: maxInternal,
    effective_cap: effectiveCap,
  };
}

/** 校验池：全量 scored 中内部达标 / LLM≥80 / 纯联网 AI 达标 / 内部+联网合并且联网 AI 达标 / 赛道内部池补充 */
function buildValidatePool(scored, thresholds, ctx = {}) {
  const validateInternalMin =
    thresholds?.validateInternalMin ?? VALIDATE_INTERNAL_MIN_DEFAULT;
  const { target, llmPoolKeys } = ctx;
  const trackKind = target ? getExpandedLlmTrackKind(target) : null;
  const trackRe = trackReForKind(trackKind);
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
    if (c.internalScore >= validateInternalMin) {
      if ((c.coreLineScore ?? 0) >= 12 || (c.productScore ?? 0) >= 15) add(c);
    } else if (llm != null && llm >= LLM_HIGH_TRUST_THRESHOLD) add(c);
    else if (!c.hasInternal && ai >= WEB_VALIDATE_AI_MIN) add(c);
    else if (c.hasInternal && srcs.includes('ai_web') && ai >= WEB_VALIDATE_AI_MIN) add(c);
    else if (
      trackKind &&
      trackRe &&
      c.hasInternal &&
      llmPoolKeys?.has(candidateDedupeKey(c)) &&
      (llm != null && llm >= TRACK_INTERNAL_LLM_VALIDATE_MIN) &&
      ((c.coreLineScore ?? 0) >= 15 || (c.productScore ?? 0) >= 18) &&
      (candidateHitsTrackKeyword(c, trackRe) ||
        (trackKind === 'dialysis_dual' && candidateHitsTrackKeyword(c, BIO_FILTER_TRACK_RE)) ||
        (c.internalScore || 0) >= 28)
    ) {
      c._trackInternalPeer = true;
      add(c);
    }
  }
  for (const c of sortDomesticListedCandidates(scored).slice(0, 12)) {
    add(c);
  }
  return [...map.values()].slice(0, TOP_N_VALIDATE + 15);
}

function mapCandidateToPersistRow(c) {
  const aiPart = getCandidateAiPart(c);
  const finalScore = computeComprehensiveScore(c);
  const v = c.validation || null;
  const sources = c.sources || (c.source ? [c.source] : []);
  const evidenceMeta = buildEvidenceMeta(sources, c, v);
  return {
    display_name: c.display_name,
    unified_credit_code: c.unified_credit_code,
    finalScore,
    grade: scoreToGrade(finalScore),
    sources,
    financing_amount_text: c.financing_amount_text,
    competitorType: v?.competitor_type || null,
    dimensionScores: v?.dimension_scores || null,
    evidenceSummary: v?.evidence_summary || null,
    evidenceConfidence: evidenceMeta.evidenceConfidence,
    needsReview: evidenceMeta.needsReview,
    evidenceBreakdown: evidenceMeta.evidenceBreakdown,
    reviewStatus: evidenceMeta.needsReview ? 'pending' : null,
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
      competitor_type: v?.competitor_type || null,
      dimension_scores: v?.dimension_scores || null,
      evidence_sources: evidenceMeta.evidenceSources,
      evidence_confidence: evidenceMeta.evidenceConfidence,
      evidence_breakdown: evidenceMeta.evidenceBreakdown,
      needs_review: evidenceMeta.needsReview,
      validation: v || null,
    },
  };
}

/**
 * 落库前补足国内上市公司（上交所/深交所/北交所）至少 MIN 家，优先相似度最高者。
 */
async function ensureMinimumDomesticListedInFinalList({
  target,
  targetSlice,
  scored,
  toPersist,
  persistThresholdOpts,
  logCtx,
}) {
  const minN = MIN_DOMESTIC_LISTED_COMPETITORS;
  let current = countDomesticListedInPersistRows(toPersist);
  if (current >= minN) {
    return { supplemented: 0, domestic_listed_in_persist: current };
  }

  const persistKeys = new Set(
    toPersist.map((row) =>
      candidateDedupeKey({
        unified_credit_code: row.unified_credit_code,
        display_name: row.display_name,
      })
    )
  );

  const candidates = sortDomesticListedCandidates(scored);
  let supplemented = 0;
  let vi = 0;

  for (const c of candidates) {
    if (current >= minN) break;
    const key = candidateDedupeKey(c);
    if (!key || persistKeys.has(key)) continue;

    if (!c.validation || c.validation.ai_failed) {
      if (vi > 0 && LLM_REQUEST_GAP_MS > 0) await sleep(LLM_REQUEST_GAP_MS);
      vi += 1;
      c.validation = await validateCandidate(targetSlice, sliceForLlm(target, c), {
        ...logCtx,
        candidateName: c.display_name,
        ruleProductScore: c.productScore,
        coreLineScore: c.coreLineScore,
        specificTagScore: c.specificTagScore,
      });
      if (c.validation?.is_listed != null && parseIsListedFromCandidate({ is_listed: c.validation.is_listed })) {
        c.is_listed = true;
      }
    }

    if (
      !isPersistValidationPassed(c) &&
      !['direct', 'indirect', 'substitute', 'same_track'].includes(c.validation?.competitor_type)
    ) {
      continue;
    }

    const row = mapCandidateToPersistRow(c);
    if (!listedMandateMeetsThreshold(c, row, persistThresholdOpts)) continue;

    row.breakdown = { ...row.breakdown, listed_mandate: true };
    toPersist.push({ ...row, _candidate: c });
    persistKeys.add(key);
    current += 1;
    supplemented += 1;
  }

  if (current < minN) {
    logCompetitorRun(logCtx.runId, 'S5_listed_mandate', `国内上市公司仅 ${current}/${minN} 家`, {
      required: minN,
      actual: current,
      hint: '请检查联网模型与「联网发现竞品」提示词，或底层 ipo 项目池是否覆盖该赛道',
    });
  }

  return { supplemented, domestic_listed_in_persist: current };
}

async function appendStepLog({ runId, subjectType, stepCode, status, message, detail }) {
  logCompetitorRun(runId, stepCode, `[${status || 'ok'}] ${message || ''}`, detail);
  try {
    const id = await generateId('sourcing_competitor_run_step_log');
    await db.execute(
      `INSERT INTO sourcing_competitor_run_step_log (
         F_Id, run_id, subject_type, step_code, status, message, detail_json, F_CreatorTime
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
  const profile = {
    subject_type: subjectType,
    display_name: strTrim(row.enterprise_full_name) || strTrim(row.project_abbreviation),
    unified_credit_code: normalizeCreditCode(row.unified_credit_code),
    product_intro: strTrim(row.ai_product_intro),
    qcc_intro_effective: qccSan.effectiveText || '',
    tags,
    industry_l1: strTrim(row.industry_std_lv1) || null,
    industry_l2: strTrim(row.industry_std_lv2) || null,
  };
  profile.subject_track_hint = inferSubjectTrackHint(profile);
  profile.core_product_lines = extractCoreProductLines(profile);
  return profile;
}

function ruleScoreCandidate(target, cand) {
  const precision = computeProductPrecisionScores(target, cand);
  const tagScore = Math.round(jaccardSimilarity(target.tags, cand.tags) * 100);
  const { productScore, coreLineScore, specificTagScore } = precision;
  let industryScore = 0;
  const scoreParts = [
    { value: productScore, weight: 0.36 },
    { value: coreLineScore, weight: 0.34 },
    { value: specificTagScore, weight: 0.18 },
  ];
  if (target.industry_l1 && cand.industry_l1) {
    if (target.industry_l1 === cand.industry_l1) industryScore += 50;
    industryScore += Math.round(l2Similarity(target.industry_l2, cand.industry_l2) * 50);
    if (productScore >= 12 || coreLineScore >= 15) {
      scoreParts.push({ value: industryScore, weight: 0.12 });
    }
  }
  let internalScore = weightedScore(scoreParts);
  if (coreLineScore < 15 && productScore < 18) {
    internalScore = Math.min(internalScore, 34);
  }
  if ((cand.sources || []).includes('ipo_project') && coreLineScore >= 18) {
    internalScore = Math.min(100, internalScore + Math.min(15, Math.round(coreLineScore * 0.22)));
  }
  return {
    tagScore,
    productScore,
    coreLineScore,
    specificTagScore,
    industryScore,
    internalScore,
    onlyBroadIndustry: precision.onlyBroadIndustry,
    hasInternal: (cand.sources || []).some((s) => s === 'ipo_project' || s === 'sourcing_financing_event'),
  };
}

function sliceForLlm(target, cand) {
  const coreLines = extractCoreProductLines(cand);
  return {
    product_intro: cand.product_intro,
    qcc_intro_effective: cand.qcc_intro,
    tags: cand.tags,
    industry_l1: cand.industry_l1,
    industry_l2: cand.industry_l2,
    display_name: cand.display_name,
    core_product_lines: coreLines.length ? coreLines : undefined,
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
    `UPDATE ${runTable} SET status = ?, message = ?, finished_at = NOW(), F_LastModifyTime = NOW() WHERE F_Id = ?`,
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
       SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
       WHERE invested_enterprise_id = ? AND F_DeleteMark = 0 AND F_CreatorUserId IS NULL
         AND COALESCE(human_locked, 0) = 0`,
      [uid, investedEnterpriseId]
    );
  } else if (subjectType === 'pre_investment_project' && preInvestmentProjectId) {
    await dbExec(
      `UPDATE sourcing_competitor_relation
       SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
       WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project'
         AND F_DeleteMark = 0 AND F_CreatorUserId IS NULL
         AND COALESCE(human_locked, 0) = 0`,
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
  const lockedKeys = await loadHumanLockedDedupeKeys({
    subjectType,
    investedEnterpriseId,
    preInvestmentProjectId,
  });
  const rowsToPersist = rows.filter((r) => {
    const key = candidateDedupeKey({
      unified_credit_code: r.unified_credit_code,
      display_name: r.display_name,
    });
    return !lockedKeys.has(key);
  });

  if (!rowsToPersist.length) {
    console.log(
      '[persistRelations] 无新竞品可落库，跳过归档，保留上一版本数据',
      JSON.stringify({
        subjectType,
        investedEnterpriseId: investedEnterpriseId || null,
        preInvestmentProjectId: preInvestmentProjectId || null,
        runId,
        preInvestmentRunId: preInvestmentRunId || null,
        inputRows: rows.length,
      })
    );
    return 0;
  }

  // ── 预先准备好所有待写入的数据（在事务外完成，减少事务持有时间）──

  // #9: 清空运行级富化缓存，避免跨批次脏读
  clearEnrichCache();
  clearInternalDisplayCache();

  // 预生成所有 relId（批量连续序列，避免同秒多次 MAX+1 得到相同 ID）
  const relIds = await generateSequentialIds('sourcing_competitor_relation', rowsToPersist.length);

  // #9: 并行富化——enrichCompetitorDisplayFields 内部有 withFinancingAiConcurrency
  // 信号量（默认 4 路）控制 LLM 并发，其余字段补齐为纯本地计算
  const preparedRows = await Promise.all(rowsToPersist.map(async (r, idx) => {
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
    const competitorType = r.competitorType || cand.validation?.competitor_type || null;
    const includeComparable = isComparablePreferred(comparablePrefs, {
      unified_credit_code: creditFinal,
      competitor_display_name: r.display_name,
      competitor_weak_key: creditFinal ? null : strTrim(r.display_name).slice(0, 160) || null,
    })
      ? 1
      : defaultIncludeInComparable(competitorType)
        ? 1
        : 0;
    const relId = relIds[idx];

    return {
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
      competitorType,
      dimensionScoresJson: r.dimensionScores ? JSON.stringify(r.dimensionScores) : null,
      evidenceSummary: r.evidenceSummary || null,
      evidenceConfidence: r.evidenceConfidence ?? null,
      needsReview: r.needsReview ? 1 : 0,
      evidenceBreakdownJson: r.evidenceBreakdown ? JSON.stringify(r.evidenceBreakdown) : null,
      reviewStatus: r.reviewStatus || (r.needsReview ? 'pending' : null),
    };
  }));

  // ── 在事务中原子执行：归档旧数据 + 写入新数据 ──
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 保留各 run_id 下的历史批次，供版本下拉切换（不再软删旧 run 关系）

    // 批量插入新关系（事务内）
    let n = 0;
    for (const p of preparedRows) {
      await conn.execute(
        `INSERT INTO sourcing_competitor_relation (
           F_Id, subject_type, invested_enterprise_id, pre_investment_project_id,
           run_id, pre_investment_run_id, subject_display_name,
           competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
           relevance_score, confidence_grade, score_breakdown_json,
           competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
           evidence_breakdown_json, review_status,
           data_sources_json, financing_amount_text, financing_history_text,
           competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
           include_in_comparable, F_CreatorTime, F_LastModifyTime, F_DeleteMark
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
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
          p.competitorType,
          p.dimensionScoresJson,
          p.evidenceSummary,
          p.evidenceConfidence,
          p.needsReview,
          p.evidenceBreakdownJson,
          p.reviewStatus,
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

    await relinkHumanLockedRelationsToRun({
      subjectType,
      investedEnterpriseId,
      preInvestmentProjectId,
      runId,
      preInvestmentRunId,
    });

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
  const thresholds = getThresholds(subjectType);
  const persistThresholdOpts = {
    threshold: thresholds.persist,
    thresholdHighLlm: thresholds.highLlm,
  };

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
    scoreThreshold: thresholds.persist,
    scoreThresholdHighLlm: thresholds.highLlm,
    validateInternalMin: thresholds.validateInternalMin,
    llmHighTrust: LLM_HIGH_TRUST_THRESHOLD,
    llmGapMs: LLM_REQUEST_GAP_MS,
    persistAiWebOnly: true,
  });

  try {
    await db.execute(
      `UPDATE ${runTable} SET status = 'running', started_at = COALESCE(started_at, NOW()), F_LastModifyTime = NOW() WHERE F_Id = ?`,
      [runId]
    );

    let row;
    let readiness;
    if (subjectType === 'invested_enterprise') {
      row = await getInvestedEnterpriseRowForCompetitor(investedEnterpriseId);
      const supTags = await loadLatestSupplementTags(row.F_Id);
      readiness = await evaluateInvestedEnterpriseCompetitorReadiness(row);
      readiness.tags = mergeTagArrays(readiness.tags, supTags);
      if (!readiness.ready) {
        throw new Error('信息不足，无法运行竞品分析');
      }
    } else {
      const rows = await db.query(
        `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation,
                ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro
         FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
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
        core_product_lines: target.core_product_lines?.slice(0, 10) || [],
        product_intro_len: (target.product_intro || '').length,
        qcc_len: (target.qcc_intro_effective || '').length,
      },
    });

    const { getCompetitorRecallSourceFlags } = require('./competitorRecallSourceConfig');
    const { canReadFinancingPoolForUser } = require('./competitorAnalysisRouteAuth');
    const recallFlags = await getCompetitorRecallSourceFlags();
    const canFinancing = userId ? await canReadFinancingPoolForUser(userId) : false;

    let ipoList = [];
    let ipoProductList = [];
    if (recallFlags.enable_ipo_project) {
      ipoList = await recallFromIpoProjects(target.unified_credit_code, target.display_name);
      ipoProductList = await recallListedIpoByProductTerms(
        target,
        target.unified_credit_code,
        target.display_name
      );
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
    let candidates = mergeRecalledCandidates(
      mergeRecalledCandidates(ipoList, ipoProductList),
      finList
    );

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S1_recall',
      status: 'ok',
      message: `内部源召回 ${candidates.length} 条`,
      detail: {
        ipo: ipoList.length,
        ipo_product_terms: ipoProductList.length,
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
      industry_l1: target.industry_l1,
      industry_l2: target.industry_l2,
      subject_track_hint: target.subject_track_hint,
      core_product_lines: target.core_product_lines,
    };

    const {
      pool: llmPool,
      niche: nicheTrack,
      trackKind,
      tagAdded,
      kwAdded,
      ruleTop,
      track_rule_top: trackRuleTop,
      skipped_pre_llm: skippedPreLlm,
      pool_trimmed: poolTrimmed,
      max_internal: maxInternalScored,
      effective_cap: llmPoolCap,
    } = buildLlmScoringPool(scored, target);
    logCompetitorRun(runId, 'S3_llm', `LLM 产品对标开始，池大小 ${llmPool.length}`, {
      rule_top: ruleTop,
      track_rule_top: trackRuleTop,
      tag_supplement: tagAdded,
      keyword_supplement: kwAdded,
      niche_track: nicheTrack,
      track_kind: trackKind,
      skipped_pre_llm: skippedPreLlm,
      pool_trimmed: poolTrimmed,
      max_internal: maxInternalScored,
      effective_cap: llmPoolCap,
      llm_rule_min: LLM_POOL_RULE_MIN,
    });
    for (let i = 0; i < llmPool.length; i++) {
      const c = llmPool[i];
      if (i > 0 && LLM_REQUEST_GAP_MS > 0) await sleep(LLM_REQUEST_GAP_MS);
      try {
        const simResult = await scorePairSimilarity(targetSlice, sliceForLlm(target, c), {
          runId,
          candidateName: c.display_name,
        });
        c.llmProductScore = typeof simResult === 'object' && simResult !== null ? simResult.score : simResult;
        if (typeof simResult === 'object' && simResult !== null && simResult.degraded) {
          c.llmProductScoreDegraded = true;
        }
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
      message: `LLM 对标完成 ${llmPool.length} 条（规则Top${ruleTop}${trackRuleTop ? `，赛道优先${trackRuleTop}` : ''}+标签${tagAdded}+关键词${kwAdded}${nicheTrack ? `，${trackKind === 'bio_filter' ? '生物过滤膜赛道' : '专业赛道'}` : ''}）`,
        detail: {
        pool_size: llmPool.length,
        niche_track: nicheTrack,
        track_kind: trackKind,
        track_rule_top: trackRuleTop,
        tag_supplement: tagAdded,
        keyword_supplement: kwAdded,
        skipped_pre_llm: skippedPreLlm,
        pool_trimmed: poolTrimmed,
        max_internal: maxInternalScored,
        effective_cap: llmPoolCap,
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
      const keywords = buildWebDiscoverKeywords(target);
      const excludeNames = scored.slice(0, 30).map((x) => x.display_name).filter(Boolean);
      const webRes = await discoverWebCompetitors(target, keywords, excludeNames, logCtx);
      const webList = Array.isArray(webRes) ? webRes : webRes.candidates || [];
      const webMeta = webRes && !Array.isArray(webRes) ? webRes.meta || {} : {};
      const mergeStats = mergeWebCandidatesIntoScored(scored, webList, {
        parseIsListedFromCandidate,
      });
      webAdded = mergeStats.added;

      let listedAfterWeb = countDomesticListedInScored(scored);
      let listedSupplementAdded = 0;
      if (listedAfterWeb < MIN_DOMESTIC_LISTED_COMPETITORS) {
        try {
          const listedKw = buildListedDomesticDiscoverKeywords(target, keywords);
          const listedRes = await discoverDomesticListedCompetitors(
            target,
            listedKw,
            scored.map((x) => x.display_name).filter(Boolean),
            logCtx
          );
          const listedList = listedRes?.candidates || [];
          const listedMerge = mergeWebCandidatesIntoScored(scored, listedList, {
            parseIsListedFromCandidate,
          });
          listedSupplementAdded = listedMerge.added + listedMerge.merged;
          listedAfterWeb = countDomesticListedInScored(scored);
          await appendStepLog({
            runId,
            subjectType,
            stepCode: 'S4_listed',
            status: 'ok',
            message: `A股/北交所上市补充检索，国内上市 ${listedAfterWeb} 家（目标≥${MIN_DOMESTIC_LISTED_COMPETITORS}）`,
            detail: {
              listed_supplement_added: listedSupplementAdded,
              domestic_listed_count: listedAfterWeb,
              required_min: MIN_DOMESTIC_LISTED_COMPETITORS,
              search_degraded: listedRes?.meta?.search_degraded === true,
            },
          });
        } catch (listedErr) {
          await appendStepLog({
            runId,
            subjectType,
            stepCode: 'S4_listed',
            status: 'warn',
            message: listedErr.message,
            detail: {
              domestic_listed_count: listedAfterWeb,
              required_min: MIN_DOMESTIC_LISTED_COMPETITORS,
            },
          });
        }
      }

      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S4_web',
        status: 'ok',
        message: `联网发现 ${webAdded} 条，国内上市 ${listedAfterWeb} 家`,
        detail: {
          web_added: webAdded,
          domestic_listed_count: listedAfterWeb,
          required_min_domestic_listed: MIN_DOMESTIC_LISTED_COMPETITORS,
          listed_supplement_added: listedSupplementAdded,
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

    const llmPoolKeys = new Set(llmPool.map((c) => candidateDedupeKey(c)).filter(Boolean));
    const validatePool = buildValidatePool(scored, thresholds, { target, llmPoolKeys });
    const validateReasons = {
      by_internal_rule: scored.filter((c) => c.internalScore >= thresholds.validateInternalMin).length,
      by_high_llm: scored.filter(
        (c) =>
          c.internalScore < thresholds.validateInternalMin &&
          (c.llmProductScore ?? 0) >= LLM_HIGH_TRUST_THRESHOLD
      ).length,
      by_ai_web: scored.filter((c) => {
        const srcs = c.sources || (c.source ? [c.source] : []);
        return srcs.includes('ai_web') && getCandidateAiPart(c) >= WEB_VALIDATE_AI_MIN;
      }).length,
      by_track_internal_peer: scored.filter((c) => c._trackInternalPeer).length,
    };
    logCompetitorRun(runId, 'S5_validate', `竞品校验开始，池大小 ${validatePool.length}`, validateReasons);
    for (let vi = 0; vi < validatePool.length; vi++) {
      const c = validatePool[vi];
      if (vi > 0 && LLM_REQUEST_GAP_MS > 0) await sleep(LLM_REQUEST_GAP_MS);
      try {
        c.validation = await validateCandidate(targetSlice, sliceForLlm(target, c), {
          runId,
          candidateName: c.display_name,
          ruleProductScore: c.productScore,
          coreLineScore: c.coreLineScore,
          specificTagScore: c.specificTagScore,
        });
        if (c.validation?.is_listed != null && parseIsListedFromCandidate({ is_listed: c.validation.is_listed })) {
          c.is_listed = true;
        }
        if (!c.hasInternal && c.validation?.validated_score != null) {
          c.llmProductScore = Number(c.validation.validated_score);
        }
      } catch (err) {
        const { normalizeCompetitorValidation } = require('./competitorTypeUtils');
        c.validation = normalizeCompetitorValidation({
          is_competitor: true,
          competitor_type: 'direct',
          validated_score: 50,
          is_upstream_downstream: false,
        });
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
        passed: validatePool.filter((c) => isPersistValidationPassed(c)).length,
        rejected: validatePool.filter((c) => c.validation && !isPersistValidationPassed(c)).length,
        by_type: validatePool.reduce((acc, c) => {
          const t = c.validation?.competitor_type || 'unknown';
          acc[t] = (acc[t] || 0) + 1;
          return acc;
        }, {}),
      },
    });

    const toPersist = [];
    const filterStats = {
      total_scored: scored.length,
      skip_no_validation: 0,
      skip_not_competitor: 0,
      skip_upstream_downstream: 0,
      skip_low_score: 0,
      accepted_internal: 0,
      accepted_ai_only: 0,
    };
    const rejectedSamples = [];
    for (const c of scored) {
      if (!isPersistValidationPassed(c)) {
        if (!c.validation || c.validation.ai_failed) {
          filterStats.skip_no_validation += 1;
          if (rejectedSamples.length < 30) {
            rejectedSamples.push({
              name: c.display_name,
              credit: c.unified_credit_code || null,
              internal: c.internalScore,
              llm: c.llmProductScore,
              reason: c.validation?.ai_failed
                ? '校验失败或未通过 S5'
                : '未进入 S5 校验或校验未通过',
              sources: c.sources || (c.source ? [c.source] : []),
            });
          }
        } else if (
          c.validation.competitor_type === 'not_competitor' ||
          c.validation.is_competitor === false
        ) {
          filterStats.skip_not_competitor += 1;
          if (rejectedSamples.length < 30) {
            rejectedSamples.push({
              name: c.display_name,
              credit: c.unified_credit_code || null,
              internal: c.internalScore,
              llm: c.llmProductScore,
              reason: `校验判定：非竞品（${c.validation.competitor_type || 'not_competitor'}）`,
              sources: c.sources || (c.source ? [c.source] : []),
            });
          }
        } else if (
          c.validation.competitor_type === 'upstream_downstream' ||
          c.validation.is_upstream_downstream
        ) {
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
        }
        continue;
      }

      const row = mapCandidateToPersistRow(c);
      if (!meetsPersistThreshold(c, row.finalScore, persistThresholdOpts)) {
        filterStats.skip_low_score += 1;
        if (rejectedSamples.length < 30) {
          rejectedSamples.push({
            name: c.display_name,
            credit: c.unified_credit_code || null,
            internal: c.internalScore,
            llm: c.llmProductScore,
            final: row.finalScore,
            reason: `综合分 ${row.finalScore} 未达落库阈值（常规≥${thresholds.persist}，高信任竞品≥${thresholds.highLlm}）`,
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

    const listedMandateResult = await ensureMinimumDomesticListedInFinalList({
      target,
      targetSlice,
      scored,
      toPersist,
      persistThresholdOpts,
      logCtx,
    });
    if (listedMandateResult.supplemented > 0) {
      toPersist.sort((a, b) => b.finalScore - a.finalScore);
    }

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S5_filter',
      status: 'ok',
      message: `初筛通过 ${toPersist.length} 条（国内上市 ${listedMandateResult.domestic_listed_in_persist}/${MIN_DOMESTIC_LISTED_COMPETITORS}）`,
      detail: {
        filterStats,
        candidates: summarizeCandidates(toPersist, 15),
        rejected_samples: rejectedSamples,
        domestic_listed_in_persist: listedMandateResult.domestic_listed_in_persist,
        domestic_listed_supplemented: listedMandateResult.supplemented,
        required_min_domestic_listed: MIN_DOMESTIC_LISTED_COMPETITORS,
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
            if (!isPersistValidationPassed(c)) return false;
            const srcs = c.sources || (c.source ? [c.source] : []);
            const ai = getCandidateAiPart(c);
            return (
              (c.hasInternal && c.internalScore >= 40) ||
              (c._trackInternalPeer && (c.llmProductScore ?? 0) >= TRACK_INTERNAL_LLM_VALIDATE_MIN) ||
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
          .filter((x) => meetsPersistThreshold(x._candidate, x.finalScore, persistThresholdOpts));
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

    if (saved === 0) {
      throw new Error(
        '未生成有效竞品数据（模型未返回或均未达落库阈值），已保留上一版本数据，请检查 AI 模型配置后重试'
      );
    }

    const msg = `竞品分析完成：召回 ${candidates.length}，落库 ${saved} 条（≥${thresholds.persist} / 高信任≥${thresholds.highLlm}；LLM 池规则+标签+关键词；联网发现失败或模型不支持联网时会自动降级重试）`;
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
    `SELECT F_Id, run_id, subject_type, step_code, status, message, detail_json, F_CreatorTime
     FROM sourcing_competitor_run_step_log
     WHERE run_id = ?
     ORDER BY F_CreatorTime ASC`,
    [id]
  );
}

function buildEmbedDocument(profile) {
  const tagLine = (profile.tags || []).slice(0, 16).join('、');
  return [profile.display_name, profile.product_intro, profile.qcc_intro_effective, tagLine]
    .map((x) => strTrim(x))
    .filter(Boolean)
    .join('\n');
}

function matchCandidateLabelKeyword(displayName, keywords) {
  const n = String(displayName || '');
  for (const kw of keywords || []) {
    if (kw && n.includes(kw)) return kw;
  }
  return null;
}

async function recallCandidatesForPoc(target, userId) {
  const { getCompetitorRecallSourceFlags } = require('./competitorRecallSourceConfig');
  const { canReadFinancingPoolForUser } = require('./competitorAnalysisRouteAuth');
  const recallFlags = await getCompetitorRecallSourceFlags();
  const canFinancing = userId ? await canReadFinancingPoolForUser(userId) : true;

  let ipoList = [];
  let ipoProductList = [];
  if (recallFlags.enable_ipo_project) {
    ipoList = await recallFromIpoProjects(target.unified_credit_code, target.display_name);
    ipoProductList = await recallListedIpoByProductTerms(
      target,
      target.unified_credit_code,
      target.display_name
    );
  }
  let finList = [];
  if (recallFlags.enable_financing_event && canFinancing) {
    finList = await recallFromFinancingEvents(target.unified_credit_code, target.display_name);
  }
  return mergeRecalledCandidates(mergeRecalledCandidates(ipoList, ipoProductList), finList);
}

/**
 * Step 4 Embedding POC：导出 S1 池 + S2 规则分 + LLM 池成员（不调 LLM）
 * @param {object} opts
 * @param {string} opts.preInvestmentProjectId
 * @param {string|null} [opts.userId]
 * @param {object} opts.labelKeywords
 * @param {string} [opts.sampleId]
 */
async function buildEmbeddingPocSnapshot({ preInvestmentProjectId, userId, labelKeywords, sampleId }) {
  const rows = await db.query(
    `SELECT F_Id, enterprise_full_name, unified_credit_code, project_abbreviation,
            ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro
     FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [preInvestmentProjectId]
  );
  if (!rows.length) throw new Error(`投前项目不存在: ${preInvestmentProjectId}`);
  const row = rows[0];
  const readiness = await evaluatePreInvestmentReadiness(row);
  if (!readiness.ready) throw new Error(`信息不足: ${preInvestmentProjectId} — ${readiness.reasons.join('; ')}`);

  const target = buildTargetProfile(row, readiness, 'pre_investment_project');
  const candidates = await recallCandidatesForPoc(target, userId);
  const scored = candidates
    .map((c) => ({ ...c, ...ruleScoreCandidate(target, c) }))
    .sort((a, b) => b.internalScore - a.internalScore);
  const { pool: llmPool, ruleTop, tagAdded, kwAdded, trackKind } = buildLlmScoringPool(scored, target);

  const llmKeys = new Set(llmPool.map((c) => candidateDedupeKey(c)));
  const ruleTopList = scored.slice(0, TOP_N_LLM_RULE);
  const ruleKeys = new Set(ruleTopList.map((c) => candidateDedupeKey(c)));
  const allKeywords = [
    ...(labelKeywords?.direct || []),
    ...(labelKeywords?.same_track || []),
    ...(labelKeywords?.not_competitor || []),
  ];
  const positiveKeywords = [
    ...(labelKeywords?.direct || []),
    ...(labelKeywords?.same_track || []),
  ];

  const candidatesOut = scored.map((c, idx) => {
    const key = candidateDedupeKey(c);
    return {
      rank_rule: idx + 1,
      key,
      display_name: c.display_name,
      unified_credit_code: c.unified_credit_code,
      internal_score: c.internalScore,
      tag_score: c.tagScore,
      product_score: c.productScore,
      document: buildEmbedDocument(c),
      label_keyword: matchCandidateLabelKeyword(c.display_name, allKeywords),
      is_positive: positiveKeywords.some((kw) => String(c.display_name || '').includes(kw)),
      in_rule_top20: ruleKeys.has(key),
      in_llm_pool: llmKeys.has(key),
    };
  });

  return {
    sample_id: sampleId || null,
    subject_id: preInvestmentProjectId,
    subject_display_name: target.display_name,
    label_keywords: labelKeywords,
    positive_keywords: positiveKeywords,
    target_document: buildEmbedDocument(target),
    candidate_count: scored.length,
    llm_pool_size: llmPool.length,
    rule_top_n: TOP_N_LLM_RULE,
    llm_pool_meta: { ruleTop, tagAdded, kwAdded, trackKind },
    candidates: candidatesOut,
  };
}

/**
 * 批量导出黄金集 Embedding POC 数据（JSON）
 */
async function exportGoldenEmbeddingPoc({ userId, subjectIds, goldenPath, outPath }) {
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const samples = subjectIds?.length
    ? golden.filter((s) => subjectIds.includes(s.subject_id))
    : golden;
  const subjects = [];
  for (const s of samples) {
    subjects.push(
      await buildEmbeddingPocSnapshot({
        preInvestmentProjectId: s.subject_id,
        userId,
        labelKeywords: s.label_keywords,
        sampleId: s.id,
      })
    );
  }
  const payload = {
    exported_at: new Date().toISOString(),
    top_k: TOP_N_LLM_RULE,
    subjects,
  };
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  }
  return payload;
}

module.exports = {
  executeCompetitorAnalysisRun,
  enqueueCompetitorAnalysisRun,
  evaluatePreInvestmentReadiness,
  listCompetitorRunStepLogs,
  buildEmbeddingPocSnapshot,
  exportGoldenEmbeddingPoc,
};
