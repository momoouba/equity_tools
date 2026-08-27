/**
 * S5 竞品类型与落库策略（Step 2）。
 */

const COMPETITOR_TYPES = [
  'direct',
  'indirect',
  'substitute',
  'upstream_downstream',
  'same_track',
  'not_competitor',
];

const NON_PERSIST_TYPES = new Set(['not_competitor', 'upstream_downstream']);

/** 外资/进口头部品牌在华主体：与本土膜企同业但投资经理常单列 substitute */
const IMPORT_SUBSTITUTE_NAME_RE =
  /颇尔|Pall|赛多利斯|Sartorius|默克|Millipore|思拓凡|Cytiva|丹纳赫|Thermo|沃特曼|Whatman|颇尔过滤/i;

/** 制药装备/平台商（非膜耗材主业） */
const EQUIPMENT_PLATFORM_NAME_RE = /东富龙|楚天科技|迦南科技|新华医疗|冻干系统|智慧药厂|无菌制剂装备/i;

/** 综合生物工艺平台（膜企 subject 下多为人才/履历关联，非膜耗材 direct 同业） */
const TALENT_LINKED_PLATFORM_NAME_RE = /多宁生物|上海多宁/i;

const DIALYSIS_PRIMARY_RE = /血液透析|透析器|腹膜透析|CRRT|血液净化|肾病治疗|肾科|透析耗材|透析设备/i;
const BIO_FILTER_CORE_RE =
  /除菌过滤|除病毒过滤|深层过滤|TFF|超滤膜|生物制药.*过滤|过滤膜耗材|囊式过滤|切向流过滤|微孔滤膜.*除菌/i;
const BIO_PLATFORM_CORE_RE = /细胞培养基|生物反应器|纯化填料|层析介质|一次性生物工艺系统/i;

function isDialysisPrimarySubject(ctx) {
  const hint = strTrim(ctx.subjectTrackHint || '');
  const blob = [ctx.subjectProductIntro, ...(ctx.subjectTags || [])].filter(Boolean).join('\n');
  if (/血液透析|透析器|血液净化为主/i.test(hint)) return true;
  return DIALYSIS_PRIMARY_RE.test(blob);
}

function isBioFilterMembraneSubject(ctx) {
  const hint = strTrim(ctx.subjectTrackHint || '');
  const blob = [ctx.subjectProductIntro, ...(ctx.subjectTags || [])].filter(Boolean).join('\n');
  if (/生物制药过滤膜|过滤器耗材为主/i.test(hint)) return true;
  return BIO_FILTER_CORE_RE.test(blob) && !DIALYSIS_PRIMARY_RE.test(blob);
}

function isBioPharmaFilterCandidate(blob) {
  return BIO_FILTER_CORE_RE.test(blob) && !DIALYSIS_PRIMARY_RE.test(blob.slice(0, 240));
}

function isIntegratedBioPlatform(blob) {
  if (!BIO_PLATFORM_CORE_RE.test(blob)) return false;
  const filterMatch = blob.match(BIO_FILTER_CORE_RE);
  if (!filterMatch) return true;
  const filterIdx = blob.indexOf(filterMatch[0]);
  const platformIdx = blob.search(BIO_PLATFORM_CORE_RE);
  if (filterIdx > platformIdx && /并购|布局|拓展|涉足|子公司/.test(blob)) return true;
  return filterIdx > platformIdx + 20;
}

/** 除菌/深层/除病毒等制药过滤膜 SKU 为明确产品线（非装备集成里的「过滤系统」泛称） */
const EXPLICIT_FILTER_MEMBRANE_SKU_RE =
  /除菌过滤|除菌级|除病毒过滤|深层过滤|过滤膜|滤芯|滤膜|囊式过滤|TFF|切向流.*膜|过滤产品线/i;

function hasExplicitFilterMembraneSku(blob) {
  return EXPLICIT_FILTER_MEMBRANE_SKU_RE.test(blob) && isBioPharmaFilterCandidate(blob);
}

function refineCompetitorTypeFromContext(type, ctx = {}) {
  const name = strTrim(ctx.candidateName || ctx.display_name || '');
  const blob = [name, ctx.candidateProductIntro, ctx.product_intro].filter(Boolean).join('\n');
  let t = strTrim(type).toLowerCase();

  if (
    EQUIPMENT_PLATFORM_NAME_RE.test(name) &&
    !/过滤膜|滤芯|除菌过滤|TFF|超滤膜|膜包|囊式过滤/i.test(blob)
  ) {
    if (t === 'direct' || t === 'indirect' || t === 'substitute') return 'upstream_downstream';
  }

  if (IMPORT_SUBSTITUTE_NAME_RE.test(name) && t === 'direct') {
    return 'substitute';
  }

  if (isDialysisPrimarySubject(ctx) && isBioPharmaFilterCandidate(blob)) {
    if (t === 'direct' || t === 'indirect') return 'same_track';
  }

  if (isBioFilterMembraneSubject(ctx) && isIntegratedBioPlatform(blob)) {
    if (t === 'direct') return 'not_competitor';
    if (t === 'indirect') return 'not_competitor';
  }

  if (isBioFilterMembraneSubject(ctx) && TALENT_LINKED_PLATFORM_NAME_RE.test(name)) {
    if (t === 'direct' || t === 'indirect' || t === 'substitute') return 'not_competitor';
  }

  // 膜企 subject：候选有明确制药过滤膜 SKU（如品善「深层过滤器」），即使另有层析/培养基辅线也为 direct
  if (
    isBioFilterMembraneSubject(ctx) &&
    t === 'indirect' &&
    hasExplicitFilterMembraneSku(blob) &&
    !EQUIPMENT_PLATFORM_NAME_RE.test(name)
  ) {
    return 'direct';
  }

  return t || 'direct';
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, Math.round(x)));
}

function strTrim(v) {
  return v != null ? String(v).trim() : '';
}

function normalizeCompetitorType(raw, legacy = {}) {
  const t = strTrim(raw).toLowerCase();
  if (COMPETITOR_TYPES.includes(t)) return t;
  if (legacy.is_upstream_downstream) return 'upstream_downstream';
  if (legacy.is_competitor === false) return 'not_competitor';
  return 'direct';
}

function normalizeDimensionScores(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    substitutability: clampScore(src.substitutability),
    customer_overlap: clampScore(src.customer_overlap),
    scenario_overlap: clampScore(src.scenario_overlap),
  };
}

function buildEvidenceSummary(validation) {
  const parts = [];
  const rationale = strTrim(validation?.rationale);
  const diff = strTrim(validation?.key_differences);
  if (rationale) parts.push(rationale);
  if (diff && diff !== rationale) parts.push(`核心差异：${diff}`);
  return parts.join('\n').slice(0, 2000) || null;
}

function averageDimensionScore(dimensionScores) {
  const d = normalizeDimensionScores(dimensionScores);
  return clampScore((d.substitutability + d.customer_overlap + d.scenario_overlap) / 3);
}

/**
 * S5 模型已判模态/产品线对齐时，不因 S2 规则分偏低触发「仅大行业相近」降级。
 */
function shouldSkipBroadIndustryDowngrade(validation, context = {}) {
  if (context.fromGoldStandard || context._fromGoldStandard) return true;
  const type = strTrim(validation?.competitor_type).toLowerCase();
  const vs = clampScore(validation?.validated_score);
  const overlap = clampScore(validation?.core_overlap_percent);
  if (!['direct', 'indirect', 'substitute'].includes(type)) return false;
  if (validation?.modality_match === false) return false;
  if (overlap >= 55 && vs >= 60) return true;
  if (vs >= 68) return true;
  const dimAvg = averageDimensionScore(validation?.dimension_scores);
  if (dimAvg >= 72 && vs >= 55) return true;
  return false;
}

function refineValidationByProductOverlap(validation, context = {}) {
  if (!validation || validation.ai_failed) return validation;
  const productScore = Number(context.ruleProductScore ?? context.productScore ?? NaN);
  const coreLineScore = Number(context.coreLineScore ?? NaN);
  const specificTagScore = Number(context.specificTagScore ?? NaN);
  const hasMetrics =
    Number.isFinite(productScore) || Number.isFinite(coreLineScore) || Number.isFinite(specificTagScore);
  if (!hasMetrics) return validation;

  const lowCoreOverlap =
    (Number.isFinite(coreLineScore) ? coreLineScore : 0) < 18 &&
    (Number.isFinite(productScore) ? productScore : 0) < 22 &&
    (Number.isFinite(specificTagScore) ? specificTagScore : 0) < 20;
  const onlyBroad =
    lowCoreOverlap && (validation.industry_match !== false || (Number.isFinite(productScore) && productScore < 15));

  let type = validation.competitor_type;
  let validatedScore = validation.validated_score;
  let rationale = validation.rationale;
  let rejectReason = validation.reject_reason;
  let isCompetitor = validation.is_competitor;

  if (onlyBroad && !shouldSkipBroadIndustryDowngrade(validation, context) && ['direct', 'indirect', 'substitute'].includes(type)) {
    type = 'same_track';
    isCompetitor = true;
    validatedScore = Math.min(clampScore(validatedScore), 42);
    rationale = strTrim(
      `${rationale ? `${rationale}；` : ''}仅大行业或客户类型相近，核心产品线/装备耗材品类未重合，降为同赛道`
    ).slice(0, 500);
    rejectReason = '';
  } else if (onlyBroad && type === 'same_track') {
    validatedScore = Math.min(clampScore(validatedScore), 40);
  } else if (
    lowCoreOverlap &&
    type === 'same_track' &&
    validatedScore >= 55 &&
    (Number.isFinite(coreLineScore) ? coreLineScore : 0) < 10 &&
    !(context.fromAiWeb && validatedScore >= 78)
  ) {
    type = 'not_competitor';
    isCompetitor = false;
    validatedScore = Math.min(clampScore(validatedScore), 28);
    rejectReason =
      rejectReason ||
      strTrim('与目标仅同属大行业或概念标签相近，核心产品线与客户采购场景无实质重叠').slice(0, 500);
    rationale = strTrim(
      `${rationale ? `${rationale}；` : ''}核心产品线未对齐，判为非竞品`
    ).slice(0, 500);
  }

  return {
    ...validation,
    competitor_type: type,
    is_competitor: isCompetitor,
    validated_score: validatedScore,
    reject_reason: rejectReason,
    rationale,
    is_upstream_downstream: type === 'upstream_downstream',
  };
}

/** 联网发现 + 高校验分但被误判为非竞品时，按产品线信号纠正 */
function refineValidationForTrustedWebDiscovery(validation, context = {}) {
  if (!validation || validation.ai_failed) return validation;
  const vs = clampScore(validation.validated_score);
  if (vs < 75) return validation;

  const coreLine = Number(context.coreLineScore ?? NaN);
  const product = Number(context.productScore ?? NaN);
  const hasCoreSignal =
    (Number.isFinite(coreLine) && coreLine >= 18) ||
    (Number.isFinite(product) && product >= 18);
  const fromWeb = context.fromAiWeb === true;
  const type = validation.competitor_type;

  if (
    type === 'not_competitor' &&
    (fromWeb || hasCoreSignal) &&
    (vs >= 80 || (hasCoreSignal && vs >= 75))
  ) {
    const nextType = (Number.isFinite(coreLine) && coreLine >= 22) || (Number.isFinite(product) && product >= 22)
      ? 'direct'
      : 'indirect';
    return {
      ...validation,
      competitor_type: nextType,
      is_competitor: true,
      is_upstream_downstream: false,
      validated_score: vs,
      reject_reason: '',
      rationale: strTrim(
        `${validation.rationale ? `${validation.rationale}；` : ''}核心产品线/联网检索高度重合，更正为${nextType === 'direct' ? '直接' : '间接'}竞品`
      ).slice(0, 500),
    };
  }

  if (type === 'not_competitor' && validation.is_competitor === false && hasCoreSignal && vs >= 72) {
    return {
      ...validation,
      competitor_type: 'indirect',
      is_competitor: true,
      is_upstream_downstream: false,
      reject_reason: '',
      rationale: strTrim(
        `${validation.rationale ? `${validation.rationale}；` : ''}产品线部分重合，更正为间接竞品`
      ).slice(0, 500),
    };
  }

  return validation;
}

/** 早期目标 vs 成熟/晚期候选：强制 stage_comparable=false，避免自动勾选可比 */
const LATE_STAGE_RE =
  /([ED]轮|Pre-IPO|IPO|上市|商业化成熟|年营收|亿欧元|亿美元|亿人民币|龙头|成熟商业化)/i;
const EARLY_STAGE_RE =
  /(天使轮|种子轮|Pre-A|Pre-B|A轮|早期初创|初创期|临床前)/i;

function refineStageComparableByScaleGap(validation, context = {}) {
  if (!validation || validation.ai_failed) return validation;
  if (validation.stage_comparable === false) return validation;

  const candText = [
    context.display_name,
    context.candidateDisplayName,
    context.candidateProductIntro,
    context.candidateFinancingText,
    context.candidateLatestRound,
    validation.is_listed ? '上市' : '',
  ]
    .filter(Boolean)
    .join('\n');
  const subjectText = [
    context.subjectProductIntro,
    context.subjectFinancingText,
    context.subjectLatestRound,
  ]
    .filter(Boolean)
    .join('\n');

  const candidateLate =
    !!validation.is_listed ||
    LATE_STAGE_RE.test(candText) ||
    /E轮|D轮|Pre-IPO/i.test(String(context.candidateLatestRound || '')) ||
    /\d+(\.\d+)?\s*亿/.test(String(context.candidateFinancingText || ''));
  const subjectLate =
    LATE_STAGE_RE.test(subjectText) ||
    /E轮|D轮|Pre-IPO|上市/i.test(String(context.subjectLatestRound || '')) ||
    /\d+(\.\d+)?\s*亿/.test(String(context.subjectFinancingText || ''));

  // 候选显著成熟/晚期，而目标未同属晚期 → 不可比
  if (candidateLate && !subjectLate) {
    return {
      ...validation,
      stage_comparable: false,
      stage_reason:
        strTrim(validation.stage_reason) ||
        '量级/阶段不可比：候选为成熟或晚期主体，目标为早期阶段，不建议纳入可比公司',
    };
  }
  return validation;
}

/** 规范化 S5 validate JSON，补全 competitor_type 与兼容字段。 */
function normalizeCompetitorValidation(raw, context = null) {
  if (!raw || typeof raw !== 'object') {
    return {
      is_competitor: false,
      is_listed: false,
      industry_match: false,
      core_overlap_percent: 0,
      is_upstream_downstream: false,
      validated_score: 0,
      modality_match: false,
      stage_comparable: true,
      stage_reason: '',
      reject_reason: '无效校验结果',
      competitor_type: 'not_competitor',
      dimension_scores: normalizeDimensionScores(null),
      key_differences: '',
      rationale: '',
      evidence_summary: null,
      ai_failed: true,
    };
  }

  let competitorType = normalizeCompetitorType(raw.competitor_type, raw);
  if (context) {
    competitorType = refineCompetitorTypeFromContext(competitorType, context);
  }
  const nonPersist = NON_PERSIST_TYPES.has(competitorType);
  const dimensionScores = normalizeDimensionScores(raw.dimension_scores);
  const dimensionAverage = averageDimensionScore(dimensionScores);
  const validatedScore = clampScore(
    raw.validated_score != null && raw.validated_score !== ''
      ? raw.validated_score
      : dimensionAverage
  );
  const coreOverlapPercent = clampScore(
    raw.core_overlap_percent != null && raw.core_overlap_percent !== ''
      ? raw.core_overlap_percent
      : dimensionAverage
  );

  const normalized = {
    ...raw,
    competitor_type: competitorType,
    is_competitor: nonPersist ? false : raw.is_competitor !== false,
    is_upstream_downstream: competitorType === 'upstream_downstream' || !!raw.is_upstream_downstream,
    is_listed: !!raw.is_listed,
    industry_match: raw.industry_match !== false,
    core_overlap_percent: coreOverlapPercent,
    validated_score: validatedScore,
    modality_match: raw.modality_match !== false,
    stage_comparable: raw.stage_comparable !== false,
    stage_reason: strTrim(raw.stage_reason).slice(0, 500),
    reject_reason: strTrim(raw.reject_reason).slice(0, 500),
    key_differences: strTrim(raw.key_differences).slice(0, 500),
    rationale: strTrim(raw.rationale).slice(0, 500),
    dimension_scores: dimensionScores,
  };
  normalized.evidence_summary = buildEvidenceSummary(normalized);
  if (context) {
    const afterOverlap = refineValidationByProductOverlap(normalized, context);
    const afterWeb = refineValidationForTrustedWebDiscovery(afterOverlap, context);
    return refineStageComparableByScaleGap(afterWeb, context);
  }
  return refineStageComparableByScaleGap(normalized, context || {});
}

function shouldPersistCompetitorType(competitorType) {
  return !NON_PERSIST_TYPES.has(strTrim(competitorType).toLowerCase());
}

/**
 * 金标类型护栏：正样本优先采用标注 final_type；负样本强制 same_track/not_competitor。
 */
function applyGoldStandardTypeGuard(validation, candidate = {}) {
  if (!validation || validation.ai_failed) return validation;
  const goldType = normalizeCompetitorType(candidate._goldStandardType, validation);
  const hasGold =
    candidate._fromGoldStandard ||
    candidate._goldStandardNegative ||
    candidate._goldStandardType;
  if (!hasGold) return validation;

  if (candidate._goldStandardIsCompetitor === false || candidate._goldStandardNegative) {
    const nextType =
      goldType === 'not_competitor' ? 'not_competitor' : 'same_track';
    return {
      ...validation,
      competitor_type: nextType,
      // 负样本不得以 is_competitor=true 进入落库/扩召回（same_track 仅作标注语义）
      is_competitor: false,
      is_upstream_downstream: false,
      modality_match: false,
      stage_comparable: false,
      validated_score: Math.min(clampScore(validation.validated_score), nextType === 'same_track' ? 40 : 20),
      reject_reason:
        strTrim(validation.reject_reason) ||
        (nextType === 'not_competitor' ? '金标标注：非竞品/模态不同' : '金标标注：同赛道不可比（负样本）'),
      rationale: strTrim(
        `${validation.rationale ? `${validation.rationale}；` : ''}金标负样本护栏：采用标注类型 ${nextType}，不作为竞品落库`
      ).slice(0, 500),
    };
  }

  if (!goldType || !['direct', 'indirect', 'substitute', 'same_track'].includes(goldType)) {
    return validation;
  }
  if (validation.is_competitor === false && validation.competitor_type === 'not_competitor') {
    // 信息缺失被误杀时，金标正样本抬回标注类型（低分待复核）
    return {
      ...validation,
      competitor_type: goldType,
      is_competitor: true,
      is_upstream_downstream: false,
      validated_score: Math.max(clampScore(validation.validated_score), goldType === 'direct' ? 70 : 55),
      reject_reason: '',
      rationale: strTrim(
        `${validation.rationale ? `${validation.rationale}；` : ''}金标正样本护栏：信息不足时采用标注类型 ${goldType}`
      ).slice(0, 500),
    };
  }
  if (validation.competitor_type !== goldType) {
    return {
      ...validation,
      competitor_type: goldType,
      is_competitor: true,
      is_upstream_downstream: false,
      rationale: strTrim(
        `${validation.rationale ? `${validation.rationale}；` : ''}金标类型护栏：采用标注类型 ${goldType}`
      ).slice(0, 500),
    };
  }
  return validation;
}

/** direct/indirect/substitute 等默认不纳入可比；仅用户勾选或历史 pref 恢复时为 1。 */
function defaultIncludeInComparable(_competitorType) {
  return false;
}

/** 自动建议纳入可比的竞品类型（须与 stage_comparable/modality_match 同时满足） */
const AUTO_COMPARABLE_TYPES = new Set(['direct', 'indirect']);

/**
 * P8：stage_comparable 自动建议放入可比（默认关闭，COMPETITOR_AUTO_INCLUDE_COMPARABLE=1 开启）
 * 仅当竞品类型为 direct/indirect、模态一致、阶段/量级可比时建议纳入；
 * 默认要求校验分≥70，且来自内部池/金标正样本，或联网高分（≥80）。
 */
function autoSuggestIncludeInComparable(validation, competitorType, opts = {}) {
  if (process.env.COMPETITOR_AUTO_INCLUDE_COMPARABLE !== '1') return false;
  const type = strTrim(competitorType || validation?.competitor_type).toLowerCase();
  if (!AUTO_COMPARABLE_TYPES.has(type)) return false;
  if (!validation) return false;
  if (validation.modality_match === false) return false;
  if (validation.stage_comparable === false) return false;
  const stageReason = strTrim(validation.stage_reason);
  if (/不可比|量级悬殊|成熟龙头|阶段差异/.test(stageReason)) return false;

  const minScore = parseInt(process.env.COMPETITOR_AUTO_COMPARABLE_MIN_SCORE || '70', 10) || 70;
  const vs = clampScore(validation.validated_score);
  if (vs < minScore) return false;

  const trustedOnly = String(process.env.COMPETITOR_AUTO_COMPARABLE_TRUSTED_ONLY || '1').trim() !== '0';
  if (trustedOnly) {
    const trusted =
      opts.hasInternal === true ||
      (opts.fromGoldStandard === true && opts.goldNegative !== true);
    // 默认不再因「联网高分」自动勾选，避免博锐创合等 web 新进误入可比
    const allowHighWeb =
      String(process.env.COMPETITOR_AUTO_COMPARABLE_ALLOW_HIGH_WEB || '0').trim() === '1';
    const highWeb = allowHighWeb && opts.fromAiWeb === true && vs >= 80;
    if (!trusted && !highWeb) return false;
  }
  if (opts.goldComparableExclude === true) return false;
  return true;
}

const COMPETITOR_TYPE_LABELS = {
  direct: '直接竞品',
  indirect: '间接竞品',
  substitute: '替代品',
  upstream_downstream: '上下游',
  same_track: '同赛道',
  not_competitor: '非竞品',
};

module.exports = {
  COMPETITOR_TYPES,
  NON_PERSIST_TYPES,
  COMPETITOR_TYPE_LABELS,
  normalizeCompetitorValidation,
  refineValidationByProductOverlap,
  refineValidationForTrustedWebDiscovery,
  shouldSkipBroadIndustryDowngrade,
  refineCompetitorTypeFromContext,
  shouldPersistCompetitorType,
  defaultIncludeInComparable,
  autoSuggestIncludeInComparable,
  refineStageComparableByScaleGap,
  applyGoldStandardTypeGuard,
  buildEvidenceSummary,
};
