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
  const validatedScore = clampScore(raw.validated_score);
  const dimensionScores = normalizeDimensionScores(raw.dimension_scores);

  const normalized = {
    ...raw,
    competitor_type: competitorType,
    is_competitor: nonPersist ? false : raw.is_competitor !== false,
    is_upstream_downstream: competitorType === 'upstream_downstream' || !!raw.is_upstream_downstream,
    is_listed: !!raw.is_listed,
    industry_match: raw.industry_match !== false,
    core_overlap_percent: clampScore(raw.core_overlap_percent),
    validated_score: validatedScore,
    reject_reason: strTrim(raw.reject_reason).slice(0, 500),
    key_differences: strTrim(raw.key_differences).slice(0, 500),
    rationale: strTrim(raw.rationale).slice(0, 500),
    dimension_scores: dimensionScores,
  };
  normalized.evidence_summary = buildEvidenceSummary(normalized);
  return normalized;
}

function shouldPersistCompetitorType(competitorType) {
  return !NON_PERSIST_TYPES.has(strTrim(competitorType).toLowerCase());
}

/** direct/indirect/substitute 默认进入可比列表；same_track 默认隐藏。 */
function defaultIncludeInComparable(competitorType) {
  const t = strTrim(competitorType).toLowerCase();
  if (t === 'same_track') return false;
  if (t === 'direct' || t === 'indirect' || t === 'substitute') return true;
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
  refineCompetitorTypeFromContext,
  shouldPersistCompetitorType,
  defaultIncludeInComparable,
  buildEvidenceSummary,
};
