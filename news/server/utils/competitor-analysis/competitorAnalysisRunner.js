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
const { buildInternalRecallPool } = require('./competitorMatchRecall');
const { attachStrategyToTarget } = require('./industry-strategies');
const {
  proposeCompetitionLens,
  resolveCompetitionLens,
  applyCompetitionLensToTarget,
  mergePromptAppendix,
  applyLensRuleAdjust,
  applyLensValidationCap,
  isLensSpecializedCleanerMismatch,
  mergeProposalWithSaved,
  loadSavedCompetitionLens,
  saveCompetitionLensVersion,
} = require('./competitionLensService');
const {
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
  describeComprehensiveScore,
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
const {
  enrichCompetitorDisplayFields,
  clearEnrichCache,
  effectiveIntroLen,
  preValidateWebEnrichCandidate,
} = require('./competitorRelationEnrichService');
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
  MIN_UNLISTED_COMPETITORS,
  isDomesticListedFromIpoPool,
  countDomesticListedInScored,
  countDomesticListedInPersistRows,
  countUnlistedInPersistRows,
  buildListedDomesticDiscoverKeywords,
  mergeWebCandidatesIntoScored,
  listedMandateMeetsThreshold,
  unlistedMandateMeetsThreshold,
  sortDomesticListedCandidates,
  sortUnlistedCandidates,
  isDomesticUnlistedCandidate,
} = require('./competitorListedDomestic');
const {
  computeProductPrecisionScores,
  extractCoreProductLines,
  hasStrongOffTargetSignals,
} = require('./competitorProductLineUtils');
const {
  clearDomesticIdentityCache,
  finalizePersistRows,
  isOverseasCompetitorCandidate,
  normalizeDomesticCandidateIdentity,
} = require('./competitorDomesticIdentityUtils');

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
const TOP_N_VALIDATE = 42;
const AUTO_EXPAND_MIN_LISTED = Math.max(
  1,
  parseInt(process.env.COMPETITOR_MIN_DOMESTIC_LISTED || '5', 10) || 5
);
const AUTO_EXPAND_MIN_UNLISTED = Math.max(
  1,
  parseInt(process.env.COMPETITOR_MIN_UNLISTED || '8', 10) || 8
);
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
  12,
  parseInt(process.env.COMPETITOR_LLM_WEAK_POOL_CAP || '22', 10) || 22
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
/** 形态/服务对象对齐高的未上市（多为融资池早期）强制保送 LLM 池槽位 */
const FORM_UNLISTED_LLM_SLOTS = Math.max(
  4,
  parseInt(process.env.COMPETITOR_FORM_UNLISTED_LLM_SLOTS || '12', 10) || 12
);
const FORM_UNLISTED_LLM_MIN_FORM = Math.max(
  15,
  parseInt(process.env.COMPETITOR_FORM_UNLISTED_MIN_FORM || '30', 10) || 30
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

function buildWebDiscoverKeywords(target, discoveryPolicy = null) {
  const {
    isTechBuzzwordTag,
  } = require('./competitorProductLineUtils');
  const { shortenLensAnchors } = require('./competitionLensService');
  const lens = target.competition_lens;
  const kw = [];
  const lensConfirmed = !!(lens?.confirmed || lens?.source === 'user') && lens?.must_align?.length;

  if (lensConfirmed) {
    for (const a of shortenLensAnchors(
      [...(lens.must_align || []), ...(lens.custom_keywords || [])],
      12
    )) {
      kw.push(a);
    }
  } else {
    for (const a of [...(lens?.must_align || []), ...(lens?.custom_keywords || [])]) {
      const t = strTrim(a);
      if (t) kw.push(t);
    }
    const coreLines = target.core_product_lines?.length
      ? target.core_product_lines
      : extractCoreProductLines(target);
    for (const line of coreLines.slice(0, 10)) {
      const t = strTrim(line);
      if (t && !isTechBuzzwordTag(t)) kw.push(t);
    }
    for (const t of (target.tags || []).slice(0, 8)) {
      const s = strTrim(t);
      if (s && !isTechBuzzwordTag(s)) kw.push(s);
    }
    const introBlob = [target.product_intro, target.qcc_intro_effective].filter(Boolean).join('\n');
    kw.push(...extractIntroSearchTerms(introBlob));
  }

  const anchors = discoveryPolicy?.keyword_anchors || [];
  for (const a of anchors) {
    const t = strTrim(a);
    if (t) kw.push(t);
  }
  if (target.industry_l1) kw.push(strTrim(target.industry_l1));
  if (target.industry_l2) kw.push(strTrim(target.industry_l2));
  if (!discoveryPolicy?.drop_listed_keyword_boost) {
    kw.push('同行业上市公司', 'A股上市公司', '上交所', '深交所', '北交所');
  }
  return [...new Set(kw.filter(Boolean))].slice(0, 16);
}

function resolveDiscoveryPolicy(target) {
  const fromStrategy =
    typeof target?.strategy?.getDiscoveryPolicy === 'function'
      ? target.strategy.getDiscoveryPolicy()
      : null;
  return (
    fromStrategy || {
      relax_listed_mandate: false,
      min_domestic_listed: null,
      keyword_anchors: [],
      drop_listed_keyword_boost: false,
    }
  );
}

function resolveMinDomesticListed(discoveryPolicy) {
  if (
    discoveryPolicy &&
    discoveryPolicy.min_domestic_listed != null &&
    Number.isFinite(Number(discoveryPolicy.min_domestic_listed))
  ) {
    return Math.max(0, Math.floor(Number(discoveryPolicy.min_domestic_listed)));
  }
  return MIN_DOMESTIC_LISTED_COMPETITORS;
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
  const ruleMin = ctx?.ruleMin ?? LLM_POOL_RULE_MIN;
  if (ruleMin <= 0) return true;
  const internal = c.internalScore || 0;
  const tag = c.tagScore || 0;
  const product = c.productScore || 0;
  const tagMin = ctx.tagMin ?? TAG_LLM_MIN;
  if (internal >= ruleMin) return true;
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
  const maxInternalPreview = maxInternalScoreInList(scored);
  const weakPool = maxInternalPreview < LLM_POOL_WEAK_MAX_INTERNAL;
  const poolCtx = {
    trackRe,
    tagMin,
    weakPool,
    ruleMin: weakPool ? Math.min(LLM_POOL_RULE_MIN, 10) : LLM_POOL_RULE_MIN,
  };
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
        (b.formCustomerScore || 0) - (a.formCustomerScore || 0) ||
        (b.coreLineScore || 0) - (a.coreLineScore || 0) ||
        (b.internalScore || 0) - (a.internalScore || 0)
    );
  let listedIpoAdded = 0;
  const LISTED_IPO_POOL_SLOTS = 8;
  for (const c of listedIpoBoost) {
    if (listedIpoAdded >= LISTED_IPO_POOL_SLOTS) break;
    if (add(c)) listedIpoAdded += 1;
  }

  // 形态对齐高的未上市（融资池早期）强制保送，不走弱规则分门槛
  const lensConfirmed = !!(
    target?.competition_lens?.confirmed || target?.competition_lens?.source === 'user'
  );
  const formMin = lensConfirmed
    ? Math.max(18, FORM_UNLISTED_LLM_MIN_FORM - 8)
    : FORM_UNLISTED_LLM_MIN_FORM;
  const formUnlistedBoost = [...scored]
    .filter((c) => {
      if (!isDomesticUnlistedCandidate(c)) return false;
      if (hasStrongOffTargetSignals(c)) return false;
      const form = Number(c.formCustomerScore) || 0;
      const core = Number(c.coreLineScore) || 0;
      if (form >= formMin) return true;
      // 形态接近门槛 + 产品线命中：同样保送
      return form >= formMin - 8 && core >= 16;
    })
    .sort(
      (a, b) =>
        (b.formCustomerScore || 0) - (a.formCustomerScore || 0) ||
        (b.coreLineScore || 0) - (a.coreLineScore || 0) ||
        (b.internalScore || 0) - (a.internalScore || 0)
    );
  let formUnlistedAdded = 0;
  for (const c of formUnlistedBoost) {
    if (formUnlistedAdded >= FORM_UNLISTED_LLM_SLOTS) break;
    if (add(c)) {
      c._formUnlistedBoost = true;
      formUnlistedAdded += 1;
    }
  }

  // 确认透镜后：融资池中「短锚点命中」的未上市再保送一轮（应对长句形态分偏低）
  let lensAnchorAdded = 0;
  if (lensConfirmed && target?.competition_lens?.must_align?.length) {
    const { buildLensScoringAnchors } = require('./competitorProductLineUtils');
    const anchors = buildLensScoringAnchors(
      [
        ...(target.competition_lens.must_align || []),
        ...(target.competition_lens.custom_keywords || []),
      ],
      10
    );
    const byLens = scored
      .filter((c) => {
        if (!isDomesticUnlistedCandidate(c)) return false;
        if (hasStrongOffTargetSignals(c)) return false;
        const blob = [c.display_name, c.product_intro, c.qcc_intro, ...(c.tags || [])]
          .filter(Boolean)
          .join('\n');
        if (!blob) return false;
        let hits = 0;
        for (const a of anchors) {
          if (a && blob.includes(a)) hits += 1;
        }
        return hits >= 1 || (Number(c.formCustomerScore) || 0) >= formMin - 5;
      })
      .sort(
        (a, b) =>
          (b.formCustomerScore || 0) - (a.formCustomerScore || 0) ||
          (b.coreLineScore || 0) - (a.coreLineScore || 0)
      );
    for (const c of byLens) {
      if (lensAnchorAdded >= 10) break;
      if (add(c)) {
        c._formUnlistedBoost = true;
        c._lensAnchorBoost = true;
        lensAnchorAdded += 1;
        formUnlistedAdded += 1;
      }
    }
  }

  // 金标种子兜底：已人工标注为竞品的候选直接进 LLM 池，避免 S2 阈值误杀
  let goldStandardAdded = 0;
  for (const c of scored) {
    if (!c._fromGoldStandard) continue;
    const key = candidateDedupeKey(c);
    if (!key || map.has(key)) continue;
    if (add(c)) {
      c._goldStandardBoost = true;
      goldStandardAdded += 1;
    }
  }

  const maxInternal = maxInternalScoreInList(scored);
  // 保送形态未上市 + 金标种子后，弱池上限至少留出保送名额
  let effectiveCap = resolveLlmPoolEffectiveCap(expanded, trackKind, maxInternal);
  effectiveCap = Math.max(
    effectiveCap,
    Math.min(map.size, TOP_N_LLM_RULE + formUnlistedAdded + goldStandardAdded + 4)
  );
  let pool = [...map.values()];
  let poolTrimmed = 0;
  if (pool.length > effectiveCap) {
    poolTrimmed = pool.length - effectiveCap;
    pool = pool
      .sort(
        (a, b) =>
          // 强制保送优先保留
          (b._goldStandardBoost ? 1 : 0) - (a._goldStandardBoost ? 1 : 0) ||
          (b._formUnlistedBoost ? 1 : 0) - (a._formUnlistedBoost ? 1 : 0) ||
          (b.formCustomerScore || 0) - (a.formCustomerScore || 0) ||
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
    form_unlisted_added: formUnlistedAdded,
    gold_standard_added: goldStandardAdded,
    ruleTop,
    track_rule_top: expanded ? ruleTop : 0,
    skipped_pre_llm: skippedPreLlm,
    pool_trimmed: poolTrimmed,
    max_internal: maxInternal,
    effective_cap: effectiveCap,
  };
}

/** 校验池：全量 scored 中内部达标 / LLM≥80 / 纯联网 AI 达标 / 内部+联网合并且联网 AI 达标 / 赛道内部池补充 */
/** S5 校验池：上市/未上市补充槽位须有一定产品/规则相关性，避免泛 IPO 池误进校验 */
function meetsValidatePoolRelevance(c, validateInternalMin) {
  if (!c) return false;
  // 金标种子：已人工标注为竞品，直接允许进入 S5 校验
  if (c._fromGoldStandard) return true;
  const llm = c.llmProductScore != null ? Number(c.llmProductScore) : 0;
  const ai = getCandidateAiPart(c);
  const core = c.coreLineScore ?? 0;
  const prod = c.productScore ?? 0;
  const form = c.formCustomerScore ?? 0;
  const internal = Number(c.internalScore) || 0;
  const srcs = c.sources || (c.source ? [c.source] : []);
  if (srcs.includes('ai_web') && ai >= WEB_VALIDATE_AI_MIN) return true;
  if (llm >= LLM_HIGH_TRUST_THRESHOLD) return true;
  if (c._formUnlistedBoost && (form >= FORM_UNLISTED_LLM_MIN_FORM - 10 || llm >= 35)) return true;
  if (form >= FORM_UNLISTED_LLM_MIN_FORM && (core >= 10 || prod >= 12 || llm >= 40)) return true;
  if (core >= 10 || prod >= 12) return true;
  if (internal >= validateInternalMin && (core >= 8 || prod >= 10)) return true;
  if (c._trackInternalPeer && llm >= TRACK_INTERNAL_LLM_VALIDATE_MIN) return true;
  return false;
}

function buildValidatePool(scored, thresholds, ctx = {}) {
  const validateInternalMin =
    thresholds?.validateInternalMin ?? VALIDATE_INTERNAL_MIN_DEFAULT;
  const { target, llmPoolKeys } = ctx;
  const trackKind = target ? getExpandedLlmTrackKind(target) : null;
  const trackRe = trackReForKind(trackKind);
  const map = new Map();
  const add = (c) => {
    if (!c) return false;
    const key = candidateDedupeKey(c);
    if (!key || map.has(key)) return false;
    map.set(key, c);
    return true;
  };
  // 金标种子直接进 S5 校验池
  for (const c of scored) {
    if (c._fromGoldStandard) add(c);
  }
  for (const c of scored) {
    const llm = c.llmProductScore != null ? Number(c.llmProductScore) : null;
    const ai = getCandidateAiPart(c);
    const srcs = c.sources || (c.source ? [c.source] : []);
    if (srcs.includes('ai_web') && (llm != null && llm >= WEB_VALIDATE_AI_MIN)) add(c);
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
  let listedAdded = 0;
  for (const c of sortDomesticListedCandidates(scored)) {
    if (!meetsValidatePoolRelevance(c, validateInternalMin)) continue;
    if (add(c)) listedAdded += 1;
    if (listedAdded >= 12) break;
  }
  let formUnlistedValidateAdded = 0;
  const byFormUnlisted = [...scored]
    .filter((c) => c._formUnlistedBoost || ((c.formCustomerScore || 0) >= FORM_UNLISTED_LLM_MIN_FORM && isDomesticUnlistedCandidate(c)))
    .sort(
      (a, b) =>
        (b.formCustomerScore || 0) - (a.formCustomerScore || 0) ||
        (b.llmProductScore || 0) - (a.llmProductScore || 0)
    );
  for (const c of byFormUnlisted) {
    if (formUnlistedValidateAdded >= FORM_UNLISTED_LLM_SLOTS) break;
    if (!meetsValidatePoolRelevance(c, validateInternalMin) && (c.llmProductScore || 0) < 35) continue;
    if (add(c)) formUnlistedValidateAdded += 1;
  }
  let unlistedAdded = 0;
  for (const c of sortUnlistedCandidates(scored)) {
    if (!meetsValidatePoolRelevance(c, validateInternalMin)) continue;
    if (add(c)) unlistedAdded += 1;
    if (unlistedAdded >= 16) break;
  }
  return [...map.values()].slice(0, TOP_N_VALIDATE + 28);
}

function mapCandidateToPersistRow(c) {
  const scoreDesc = describeComprehensiveScore(c);
  const aiPart = scoreDesc.ai_score;
  const finalScore = scoreDesc.final_score;
  const v = c.validation || null;
  const sources = c.sources || (c.source ? [c.source] : []);
  const evidenceMeta = buildEvidenceMeta(sources, c, v);
  return {
    display_name: c.display_name,
    unified_credit_code: c.unified_credit_code,
    finalScore,
    grade: scoreDesc.grade || scoreToGrade(finalScore),
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
      score_mode: scoreDesc.score_mode,
      score_formula: scoreDesc.formula,
      score_reason_lines: scoreDesc.reason_lines,
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
 * 落库前补足国内上市公司至少 minN 家（默认 5，供客户筛选）。
 */
async function ensureMinimumDomesticListedInFinalList(args) {
  const minN =
    args?.minN != null && Number.isFinite(Number(args.minN))
      ? Math.max(0, Math.floor(Number(args.minN)))
      : MIN_DOMESTIC_LISTED_COMPETITORS;
  if (minN <= 0) return args?.toPersist || [];
  return supplementPersistByQuota({
    ...args,
    minN,
    sortFn: sortDomesticListedCandidates,
    meetsThresholdFn: listedMandateMeetsThreshold,
    mandateLabel: 'listed_mandate',
    countFn: countDomesticListedInPersistRows,
  });
}

/**
 * 落库前补足未上市竞品至少 minN 家（默认 8，供客户筛选）。
 */
async function ensureMinimumUnlistedInFinalList(args) {
  return supplementPersistByQuota({
    ...args,
    minN: MIN_UNLISTED_COMPETITORS,
    sortFn: sortUnlistedCandidates,
    meetsThresholdFn: unlistedMandateMeetsThreshold,
    mandateLabel: 'unlisted_mandate',
    countFn: countUnlistedInPersistRows,
  });
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
  const { productScore, coreLineScore, specificTagScore, formCustomerScore } = precision;
  // 标签分用加权 specifically（降 buzzword），不再用全量 Jaccard
  const tagScore = specificTagScore;
  let industryScore = 0;
  const scoreParts = [
    { value: productScore, weight: 0.28 },
    { value: coreLineScore, weight: 0.3 },
    { value: formCustomerScore || 0, weight: 0.24 },
    { value: specificTagScore, weight: 0.12 },
  ];
  if (target.industry_l1 && cand.industry_l1) {
    if (target.industry_l1 === cand.industry_l1) industryScore += 50;
    industryScore += Math.round(l2Similarity(target.industry_l2, cand.industry_l2) * 50);
    if (productScore >= 12 || coreLineScore >= 15 || (formCustomerScore || 0) >= 35) {
      scoreParts.push({ value: industryScore, weight: 0.08 });
    }
  }
  let categoryScore = 0;
  if (
    target.industry_category_4 &&
    cand.industry_category_4 &&
    target.industry_category_4 === cand.industry_category_4 &&
    target.industry_category_4 !== 'other'
  ) {
    categoryScore = 70;
    if (productScore >= 10 || coreLineScore >= 12 || (formCustomerScore || 0) >= 30) {
      scoreParts.push({ value: categoryScore, weight: 0.06 });
    }
  }
  let internalScore = weightedScore(scoreParts);
  if (coreLineScore < 15 && productScore < 18 && (formCustomerScore || 0) < 30) {
    internalScore = Math.min(internalScore, 34);
  }
  // 形态对齐高时抬升入池机会
  if ((formCustomerScore || 0) >= 50 && coreLineScore >= 20) {
    internalScore = Math.min(100, internalScore + Math.min(12, Math.round(formCustomerScore * 0.12)));
  }
  const srcs = cand.sources || (cand.source ? [cand.source] : []);
  const fromFinancing = srcs.includes('sourcing_financing_event');
  const listedInternal = srcs.some((s) => s === 'ipo_project' || s === 'ipo_new_share');
  // 融资池未上市 + 形态对齐：抬升规则分，避免被 buzzword 明星挤出 S2 Top
  if (fromFinancing && !listedInternal && (formCustomerScore || 0) >= FORM_UNLISTED_LLM_MIN_FORM) {
    internalScore = Math.min(
      100,
      internalScore + Math.min(20, Math.round((formCustomerScore || 0) * 0.22))
    );
  }
  if (listedInternal && (coreLineScore >= 18 || (formCustomerScore || 0) >= 45)) {
    internalScore = Math.min(
      100,
      internalScore + Math.min(15, Math.round(Math.max(coreLineScore, formCustomerScore || 0) * 0.22))
    );
  }
  let scores = {
    tagScore,
    productScore,
    coreLineScore,
    specificTagScore,
    formCustomerScore: formCustomerScore || 0,
    industryScore,
    categoryScore,
    internalScore,
    onlyBroadIndustry: precision.onlyBroadIndustry,
    hasInternal: srcs.some(
      (s) => s === 'ipo_project' || s === 'ipo_new_share' || s === 'sourcing_financing_event'
    ),
  };
  const strategy = target?.strategy;
  if (strategy && typeof strategy.adjustRuleScore === 'function') {
    scores = strategy.adjustRuleScore({ target, cand, scores });
  }
  if (target?.competition_lens) {
    scores = applyLensRuleAdjust(scores, target.competition_lens, cand);
  }
  return scores;
}

function sliceForLlm(target, cand) {
  const coreLines = extractCoreProductLines(cand);
  const webIntro = strTrim(cand.web_core_products);
  const productIntro = webIntro || cand.product_intro;
  const out = {
    product_intro: productIntro,
    qcc_intro_effective: cand.qcc_intro,
    tags: cand.tags,
    industry_l1: cand.industry_l1,
    industry_l2: cand.industry_l2,
    industry_category_4: cand.industry_category_4 || null,
    sub_track: cand.sub_track || null,
    display_name: cand.display_name,
    core_product_lines: coreLines.length ? coreLines : undefined,
  };
  if (cand.structured_profile && typeof cand.structured_profile === 'object') {
    out.structured_profile = cand.structured_profile;
  }
  return out;
}

/** 为候选（尤其 S4 联网并入）补齐相对目标的规则分字段 */
function applyTargetRuleScores(scored, target) {
  if (!target || !scored?.length) return;
  for (const c of scored) {
    const rs = ruleScoreCandidate(target, c);
    Object.assign(c, rs);
  }
}

function candidateFromAiWeb(c) {
  const srcs = c?.sources || (c?.source ? [c.source] : []);
  return srcs.includes('ai_web');
}

/** S5 校验后结合规则分，纠正联网高信任误判 */
function refreshValidationAfterRuleScores(c) {
  if (!c?.validation || c.validation.ai_failed) return;
  const { refineValidationForTrustedWebDiscovery } = require('./competitorTypeUtils');
  c.validation = refineValidationForTrustedWebDiscovery(c.validation, {
    ruleProductScore: c.productScore,
    coreLineScore: c.coreLineScore,
    specificTagScore: c.specificTagScore,
    fromAiWeb: candidateFromAiWeb(c),
  });
}

async function validateCandidateForPersist(c, target, targetSlice, logCtx) {
  await normalizeDomesticCandidateIdentity(c);
  c.validation = await validateCandidate(targetSlice, sliceForLlm(target, c), {
    ...logCtx,
    candidateName: c.display_name,
    ruleProductScore: c.productScore,
    coreLineScore: c.coreLineScore,
    specificTagScore: c.specificTagScore,
    fromAiWeb: candidateFromAiWeb(c),
    strategyAppendix: mergePromptAppendix(
      target?.strategy?.buildPromptAppendix?.() || null,
      target?.competition_lens
    ),
  });
  if (c.validation?.is_listed != null && parseIsListedFromCandidate({ is_listed: c.validation.is_listed })) {
    c.is_listed = true;
  }
  if (!c.hasInternal && c.validation?.validated_score != null) {
    c.llmProductScore = Number(c.validation.validated_score);
  }
  refreshValidationAfterRuleScores(c);
  c.validation = applyLensValidationCap(c.validation, target?.competition_lens, c);
  if (c.validation?.lens_form_mismatch) {
    c.lens_form_mismatch = c.validation.lens_form_mismatch;
    if (!c.hasInternal && c.validation.validated_score != null) {
      c.llmProductScore = Number(c.validation.validated_score);
    }
  }
}

// ── 校验前定向联网增强：仅对空/短简介候选触发，金标优先，控制联网调用量 ──
// 非金标候选只在简介近乎为空时触发；金标候选放宽到较短简介也补齐（金标标注可信，尽量给其真实业务画像）。
const PRE_ENRICH_SHORT_NON_GOLD = 24;
const PRE_ENRICH_SHORT_GOLD = 160;
const PRE_ENRICH_MAX_CALLS = 16;

async function preValidateEnrichSparseCandidates(validatePool, target, { runId } = {}) {
  if (!validatePool?.length) return { considered: 0, enriched: 0, need: 0 };
  const need = validatePool.filter((c) => {
    const len = effectiveIntroLen(c);
    const th = c._fromGoldStandard ? PRE_ENRICH_SHORT_GOLD : PRE_ENRICH_SHORT_NON_GOLD;
    return len < th;
  });
  if (!need.length) return { considered: 0, enriched: 0, need: 0 };
  // 金标优先，其次按内部/LLM 分排序，确保有限的联网调用先花在金标候选上
  need.sort((a, b) => {
    const ga = a._fromGoldStandard ? 1 : 0;
    const gb = b._fromGoldStandard ? 1 : 0;
    if (ga !== gb) return gb - ga;
    const sa = a.internalScore || a.llmProductScore || 0;
    const sb = b.internalScore || b.llmProductScore || 0;
    return sb - sa;
  });
  const selected = need.slice(0, PRE_ENRICH_MAX_CALLS);
  logCompetitorRun(
    runId,
    'S5_pre_enrich',
    `校验前联网增强：选中 ${selected.length}/${need.length} 个空/短简介候选（金标 ${selected.filter((c) => c._fromGoldStandard).length} 个，上限 ${PRE_ENRICH_MAX_CALLS}）`
  );
  const { hasStrongOffTargetSignals } = require('./competitorProductLineUtils');
  let enriched = 0;
  for (const c of selected) {
    const r = await preValidateWebEnrichCandidate(c, { runId });
    if (r.enriched) {
      enriched += 1;
      // 简介被联网结果升级后重算跑偏标记，避免沿用库内稀疏文本得出的旧结论
      c._hasStrongOffTargetSignals = hasStrongOffTargetSignals(c);
    }
  }
  return { considered: selected.length, enriched, need: need.length };
}

function isMandateEligibleType(c) {
  if (c?.lens_form_mismatch === 'specialized_cleaner' || c?.validation?.lens_form_mismatch === 'specialized_cleaner') {
    return false;
  }
  if (isPersistValidationPassed(c)) return true;
  return ['direct', 'indirect', 'substitute', 'same_track'].includes(c.validation?.competitor_type);
}

/** 配额补足只消费 S5 已校验候选，禁止在此阶段发起新的 LLM 校验 */
function isMandateSupplementCandidate(c) {
  const v = c?.validation;
  if (!v || v.ai_failed) return false;
  refreshValidationAfterRuleScores(c);
  return isMandateEligibleType(c);
}

async function supplementPersistByQuota({
  scored,
  toPersist,
  persistThresholdOpts,
  logCtx,
  minN,
  sortFn,
  meetsThresholdFn,
  mandateLabel,
  countFn,
}) {
  let current = countFn(toPersist);
  if (current >= minN) {
    return { supplemented: 0, actual: current };
  }

  const persistKeys = new Set(
    toPersist.map((row) =>
      candidateDedupeKey({
        unified_credit_code: row.unified_credit_code,
        display_name: row.display_name,
      })
    )
  );

  const mandateScanCap = Math.max(minN * 4, 32);
  const candidates = sortFn(scored)
    .filter(isMandateSupplementCandidate)
    .slice(0, mandateScanCap);
  let supplemented = 0;

  for (const c of candidates) {
    if (current >= minN) break;
    const key = candidateDedupeKey(c);
    if (!key || persistKeys.has(key)) continue;
    if (isOverseasCompetitorCandidate(c)) continue;

    await normalizeDomesticCandidateIdentity(c);
    const { isValidMainlandUscc } = require('./competitorCompanyMatch');
    if (!isValidMainlandUscc(c.unified_credit_code)) continue;

    if (!isMandateEligibleType(c)) continue;

    const row = mapCandidateToPersistRow(c);
    if (!meetsThresholdFn(c, row, persistThresholdOpts)) continue;

    row.breakdown = { ...row.breakdown, [mandateLabel]: true };
    toPersist.push({ ...row, _candidate: c });
    persistKeys.add(key);
    current += 1;
    supplemented += 1;
  }

  if (current < minN) {
    logCompetitorRun(logCtx.runId, mandateLabel, `仅 ${current}/${minN} 家（仅复用已校验候选）`, {
      required: minN,
      actual: current,
      scanned_validated: candidates.length,
    });
  }

  return { supplemented, actual: current };
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

  // #9: 不再清空全局富化缓存——这些是确定性 read-through 缓存，
  //     跨 run 共享安全；clear 会导致并发 run 竞态（R-M7）。

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
    const fieldEnhance = await enrichRelationFieldsBeforePersist(
      {
        displayName: r.display_name,
        unifiedCreditCode: r.unified_credit_code,
        candidate: cand,
      },
      financingIndex
    );
    const creditFinal = fieldEnhance.unified_credit_code || r.unified_credit_code || null;
    const displayNameFinal =
      strTrim(fieldEnhance.display_name) || strTrim(r.display_name) || strTrim(cand.display_name);
    const competitorType = r.competitorType || cand.validation?.competitor_type || null;
    const includeComparable = isComparablePreferred(comparablePrefs, {
      unified_credit_code: creditFinal,
      competitor_display_name: displayNameFinal,
      competitor_weak_key: creditFinal ? null : strTrim(displayNameFinal).slice(0, 160) || null,
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
      displayName: displayNameFinal,
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
 * @param {object|null} [opts.competitionLens] 用户确认的对标焦点（selected_factor_ids / custom_keywords / must_align）
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
    competitionLens: competitionLensInput = null,
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
                ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro,
                structured_profile_json, structured_schema_version
         FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
        [preInvestmentProjectId]
      );
      if (!rows.length) throw new Error('投前项目不存在');
      row = rows[0];
      readiness = await evaluatePreInvestmentReadiness(row);
      if (!readiness.ready) throw new Error('信息不足，请先完成企查查与 AI 取数');
    }

    const target = buildTargetProfile(row, readiness, subjectType);
    await attachStrategyToTarget(target, row);
    let lensProposal = proposeCompetitionLens(target);
    const subjectIdForLens =
      subjectType === 'pre_investment_project' ? preInvestmentProjectId : investedEnterpriseId;
    try {
      const savedLens = await loadSavedCompetitionLens(subjectType, subjectIdForLens);
      lensProposal = mergeProposalWithSaved(lensProposal, savedLens);
    } catch (e) {
      console.warn('[competitorRunner] load saved lens failed', e.message);
    }
    // 无用户提交时：用上次保存勾选/编辑作为自动默认
    const lensInput =
      competitionLensInput ||
      (lensProposal.saved_lens
        ? {
            selected_factor_ids: lensProposal.factors
              .filter((f) => f.default_selected)
              .map((f) => f.id),
            factors: lensProposal.factors.map((f) => ({
              id: f.id,
              text: f.text,
              base_text: f.base_text,
              edited: f.edited,
            })),
            custom_keywords: lensProposal.default_custom_keywords || [],
            confirmed: false,
            source: 'auto',
          }
        : null);
    const resolvedLens = resolveCompetitionLens(lensInput, lensProposal.factors);
    applyCompetitionLensToTarget(target, resolvedLens);
    if (resolvedLens.confirmed && subjectIdForLens) {
      try {
        const savedMeta = await saveCompetitionLensVersion({
          subjectType,
          subjectId: subjectIdForLens,
          lens: resolvedLens,
          userId,
        });
        resolvedLens.version = savedMeta.version;
        resolvedLens.saved_at = savedMeta.saved_at;
        target.competition_lens = resolvedLens;
      } catch (e) {
        console.warn('[competitorRunner] save lens version failed', e.message);
      }
    }
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
        industry_category_4: target.industry_category_4 || null,
        sub_track: target.sub_track || null,
        strategy_id: target.strategy?.id || null,
        category_match_level: target.category_match_level || null,
        competition_lens: {
          source: resolvedLens.source,
          confirmed: resolvedLens.confirmed,
          version: resolvedLens.version || null,
          must_align: resolvedLens.must_align,
          custom_keywords: resolvedLens.custom_keywords,
          selected_factor_ids: resolvedLens.selected_factor_ids,
          resolve_warning: resolvedLens.resolve_warning || null,
        },
      },
    });

    const { getCompetitorRecallSourceFlags } = require('./competitorRecallSourceConfig');
    const { canReadFinancingPoolForUser } = require('./competitorAnalysisRouteAuth');
    const recallFlags = await getCompetitorRecallSourceFlags();
    const canFinancing = userId ? await canReadFinancingPoolForUser(userId) : false;

    const recallPool = await buildInternalRecallPool({
      target,
      recallFlags,
      canFinancing,
    });
    let candidates = recallPool.candidates;

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S1_recall',
      status: 'ok',
      message: `内部源召回 ${candidates.length} 条${
        recallFlags.use_new_share_listed_recall ? '（new_share 主召回）' : ''
      }`,
      detail: {
        ...recallPool.stats,
        recall_flags: recallFlags,
        ab_compare: recallPool.abCompare,
        sample: summarizeCandidates(candidates, 5),
      },
    });

    const scored = candidates.map((c) => {
      const rs = ruleScoreCandidate(target, c);
      return { ...c, ...rs, _hasStrongOffTargetSignals: hasStrongOffTargetSignals(c) };
    });
    scored.sort((a, b) => b.internalScore - a.internalScore);

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S2_rule',
      status: 'ok',
      message: `规则打分完成，共 ${scored.length} 条${
        target.strategy?.id ? `（策略 ${target.strategy.id}）` : ''
      }`,
      detail: {
        top: summarizeCandidates(scored, 10),
        strategy_id: target.strategy?.id || null,
        industry_category_4: target.industry_category_4 || null,
        sub_track: target.sub_track || null,
      },
    });

    const targetSlice = {
      product_intro: target.product_intro,
      qcc_intro_effective: target.qcc_intro_effective,
      tags: target.tags,
      industry_l1: target.industry_l1,
      industry_l2: target.industry_l2,
      industry_category_4: target.industry_category_4 || null,
      sub_track: target.sub_track || null,
      subject_track_hint: target.subject_track_hint,
      core_product_lines: target.core_product_lines,
      structured_profile: target.structured_profile || undefined,
      strategy_id: target.strategy?.id || null,
      competition_lens: target.competition_lens
        ? {
            must_align: target.competition_lens.must_align,
            custom_keywords: target.competition_lens.custom_keywords,
            source: target.competition_lens.source,
          }
        : undefined,
    };
    const strategyAppendix = mergePromptAppendix(
      target.strategy?.buildPromptAppendix?.() || null,
      target.competition_lens
    );
    const discoveryPolicy = resolveDiscoveryPolicy(target);
    const minDomesticListedRequired = resolveMinDomesticListed(discoveryPolicy);

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
      form_unlisted_added: formUnlistedAdded,
      gold_standard_added: goldStandardAdded,
    } = buildLlmScoringPool(scored, target);
    logCompetitorRun(runId, 'S3_llm', `LLM 产品对标开始，池大小 ${llmPool.length}`, {
      rule_top: ruleTop,
      track_rule_top: trackRuleTop,
      tag_supplement: tagAdded,
      keyword_supplement: kwAdded,
      form_unlisted_boost: formUnlistedAdded || 0,
      gold_standard_added: goldStandardAdded || 0,
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
          strategyAppendix,
        });
        c.llmProductScore = typeof simResult === 'object' && simResult !== null ? (simResult.score ?? 0) : simResult;
        if (typeof simResult === 'object' && simResult !== null && simResult.degraded) {
          c.llmProductScoreDegraded = true;
        }
        if (isLensSpecializedCleanerMismatch(target.competition_lens, c)) {
          c.lens_form_mismatch = 'specialized_cleaner';
          c.llmProductScore = Math.min(Number(c.llmProductScore) || 0, 42);
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
      const keywords = buildWebDiscoverKeywords(target, discoveryPolicy);
      const excludeNames = scored.slice(0, 100).map((x) => x.display_name).filter(Boolean);
      const webRes = await discoverWebCompetitors(target, keywords, excludeNames, {
        ...logCtx,
        strategyAppendix,
        relaxListedMandate: !!discoveryPolicy.relax_listed_mandate,
      });
      const webList = Array.isArray(webRes) ? webRes : webRes.candidates || [];
      const webMeta = webRes && !Array.isArray(webRes) ? webRes.meta || {} : {};
      const mergeStats = mergeWebCandidatesIntoScored(scored, webList, {
        parseIsListedFromCandidate,
      });
      webAdded = mergeStats.added;

      let listedAfterWeb = countDomesticListedInScored(scored);
      let listedSupplementAdded = 0;
      if (
        !discoveryPolicy.relax_listed_mandate &&
        minDomesticListedRequired > 0 &&
        listedAfterWeb < minDomesticListedRequired
      ) {
        try {
          const listedKw = buildListedDomesticDiscoverKeywords(target, keywords);
          const listedRes = await discoverDomesticListedCompetitors(
            target,
            listedKw,
            scored.map((x) => x.display_name).filter(Boolean),
            { ...logCtx, strategyAppendix }
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
            message: `A股/北交所上市补充检索，国内上市 ${listedAfterWeb} 家（目标≥${minDomesticListedRequired}）`,
            detail: {
              listed_supplement_added: listedSupplementAdded,
              domestic_listed_count: listedAfterWeb,
              required_min: minDomesticListedRequired,
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
              required_min: minDomesticListedRequired,
            },
          });
        }
      } else if (discoveryPolicy.relax_listed_mandate) {
        await appendStepLog({
          runId,
          subjectType,
          stepCode: 'S4_listed',
          status: 'ok',
          message: '已跳过上市硬配额补充（赛道发现策略 relax_listed_mandate）',
          detail: {
            skipped: 'relax_listed_mandate',
            domestic_listed_count: listedAfterWeb,
            required_min: minDomesticListedRequired,
            discovery_policy: discoveryPolicy,
          },
        });
      }

      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S4_web',
        status: 'ok',
        message: `联网发现 ${webAdded} 条，国内上市 ${listedAfterWeb} 家`,
        detail: {
          web_added: webAdded,
          listed_supplement_added: listedSupplementAdded,
          domestic_listed_count: listedAfterWeb,
          required_min_domestic_listed: minDomesticListedRequired,
          relax_listed_mandate: !!discoveryPolicy.relax_listed_mandate,
          keywords: keywords.slice(0, 12),
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

    applyTargetRuleScores(scored, target);
    for (const c of scored) {
      if (candidateFromAiWeb(c) && !isOverseasCompetitorCandidate(c)) {
        await normalizeDomesticCandidateIdentity(c);
      }
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
    // 校验前定向联网增强：空/短简介候选（金标优先）先联网补齐简介，避免校验因"信息缺失"误杀
    const preEnrichStat = await preValidateEnrichSparseCandidates(validatePool, target, { runId });
    if (preEnrichStat.need > 0) {
      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S5_pre_enrich',
        status: 'ok',
        message: `校验前联网增强：补齐 ${preEnrichStat.enriched}/${preEnrichStat.considered} 条（待补 ${preEnrichStat.need}）`,
        detail: preEnrichStat,
      });
    }
    for (let vi = 0; vi < validatePool.length; vi++) {
      const c = validatePool[vi];
      if (vi > 0 && LLM_REQUEST_GAP_MS > 0) await sleep(LLM_REQUEST_GAP_MS);
      try {
        await validateCandidateForPersist(c, target, targetSlice, { runId });
      } catch (err) {
        const { normalizeCompetitorValidation } = require('./competitorTypeUtils');
        c.validation = normalizeCompetitorValidation({
          is_competitor: true,
          competitor_type: 'same_track',
          validated_score: 30,
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
      accepted_overseas: 0,
    };
    const rejectedSamples = [];
    for (const c of scored) {
      if (c.validation) refreshValidationAfterRuleScores(c);
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
      else if (isOverseasCompetitorCandidate(c)) filterStats.accepted_overseas += 1;
      else filterStats.accepted_ai_only += 1;
      toPersist.push({ ...row, _candidate: c });
    }

    toPersist.sort((a, b) => b.finalScore - a.finalScore);

    await appendStepLog({
      runId,
      subjectType,
      stepCode: 'S5_filter',
      status: 'ok',
      message: `初筛通过 ${toPersist.length} 条（上市 ${countDomesticListedInPersistRows(toPersist)}/${minDomesticListedRequired}，未上市 ${countUnlistedInPersistRows(toPersist)}/${MIN_UNLISTED_COMPETITORS}）`,
      detail: {
        filterStats,
        candidates: summarizeCandidates(toPersist, 20),
        rejected_samples: rejectedSamples,
        domestic_listed_in_persist: countDomesticListedInPersistRows(toPersist),
        unlisted_in_persist: countUnlistedInPersistRows(toPersist),
        required_min_domestic_listed: minDomesticListedRequired,
        required_min_unlisted: MIN_UNLISTED_COMPETITORS,
        relax_listed_mandate: !!discoveryPolicy.relax_listed_mandate,
      },
    });

    let finalList = toPersist;
    if (enableAutoExpand) {
      const listedN = countDomesticListedInPersistRows(toPersist);
      const unlistedN = countUnlistedInPersistRows(toPersist);
      const expandMinListed = Math.min(AUTO_EXPAND_MIN_LISTED, Math.max(minDomesticListedRequired, 0));
      const needExpand =
        listedN < expandMinListed || unlistedN < AUTO_EXPAND_MIN_UNLISTED;
      if (needExpand) {
        logCompetitorRun(runId, 'S5_expand', '触发扩召回', {
          current_total: toPersist.length,
          listed: listedN,
          unlisted: unlistedN,
          min_listed: expandMinListed,
          min_unlisted: AUTO_EXPAND_MIN_UNLISTED,
        });
        const relaxed = scored
          .filter((c) => {
            refreshValidationAfterRuleScores(c);
            if (!isPersistValidationPassed(c)) return false;
            if (
              c.lens_form_mismatch === 'specialized_cleaner' ||
              c.validation?.lens_form_mismatch === 'specialized_cleaner' ||
              isLensSpecializedCleanerMismatch(target.competition_lens, c)
            ) {
              return false;
            }
            const srcs = c.sources || (c.source ? [c.source] : []);
            const ai = getCandidateAiPart(c);
            return (
              (c.hasInternal && c.internalScore >= 40) ||
              (c._trackInternalPeer && (c.llmProductScore ?? 0) >= TRACK_INTERNAL_LLM_VALIDATE_MIN) ||
              (ai >= WEB_VALIDATE_AI_MIN && (!c.hasInternal || srcs.includes('ai_web'))) ||
              (c.llmProductScore ?? 0) >= LLM_HIGH_TRUST_THRESHOLD
            );
          })
          .slice(0, 80)
          .map((c) => {
            const row = mapCandidateToPersistRow(c);
            row.breakdown = { ...row.breakdown, expanded: true };
            row._candidate = c;
            return row;
          })
          .filter(
            (x) =>
              meetsPersistThreshold(x._candidate, x.finalScore, persistThresholdOpts) ||
              listedMandateMeetsThreshold(x._candidate, x, persistThresholdOpts) ||
              unlistedMandateMeetsThreshold(x._candidate, x, persistThresholdOpts)
          );
        const seen = new Set();
        finalList = [];
        for (const x of [...toPersist, ...relaxed]) {
          const k = candidateDedupeKey(x);
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

    await ensureMinimumDomesticListedInFinalList({
      scored,
      toPersist: finalList,
      persistThresholdOpts,
      logCtx,
      minN: minDomesticListedRequired,
    });
    await ensureMinimumUnlistedInFinalList({
      scored,
      toPersist: finalList,
      persistThresholdOpts,
      logCtx,
    });
    finalList.sort((a, b) => b.finalScore - a.finalScore);

    finalList = await finalizePersistRows(finalList, logCtx);
    if (!finalList.length) {
      throw new Error('落库列表无有效竞品（境内须可补齐统一社会信用代码，或保留有效境外竞品名称）');
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
    try {
      await updateRunStatus(runTable, runId, 'failed', e.message || '运行失败');
      await appendStepLog({
        runId,
        subjectType,
        stepCode: 'S6_done',
        status: 'failed',
        message: e.message,
      });
    } catch (cleanupErr) {
      console.error('[competitorRunner] catch cleanup failed:', cleanupErr.message);
    }
    return { ok: false, message: e.message };
  }
}

function enqueueCompetitorAnalysisRun(opts) {
  logCompetitorRun(opts.runId, 'ENQUEUE', '已入队异步执行', {
    subjectType: opts.subjectType,
    investedEnterpriseId: opts.investedEnterpriseId || null,
    preInvestmentProjectId: opts.preInvestmentProjectId || null,
    competition_lens: opts.competitionLens
      ? {
          confirmed: !!opts.competitionLens.confirmed,
          selected_factor_ids: opts.competitionLens.selected_factor_ids || null,
          must_align: opts.competitionLens.must_align || null,
          factors_count: Array.isArray(opts.competitionLens.factors)
            ? opts.competitionLens.factors.length
            : 0,
          custom_keywords: opts.competitionLens.custom_keywords || [],
        }
      : null,
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
  const pool = await buildInternalRecallPool({ target, recallFlags, canFinancing });
  return pool.candidates;
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
            ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro,
            structured_profile_json, structured_schema_version
     FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [preInvestmentProjectId]
  );
  if (!rows.length) throw new Error(`投前项目不存在: ${preInvestmentProjectId}`);
  const row = rows[0];
  const readiness = await evaluatePreInvestmentReadiness(row);
  if (!readiness.ready) throw new Error(`信息不足: ${preInvestmentProjectId} — ${readiness.reasons.join('; ')}`);

  const target = buildTargetProfile(row, readiness, 'pre_investment_project');
  await attachStrategyToTarget(target, row);
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
  buildTargetProfile,
};
