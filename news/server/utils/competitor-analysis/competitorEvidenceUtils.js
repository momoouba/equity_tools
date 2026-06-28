const { strTrim, textOverlapScore } = require('./competitorMatchUtils');

const EVIDENCE_SOURCE_LABELS = {
  qcc: '企查查',
  internal_project: '底层项目',
  internal_financing: '融资事件',
  ai_web: '联网发现',
  user_added: '人工新增',
  llm_inference: '模型推断',
};

const EVIDENCE_WEIGHTS = {
  source: 0.35,
  freshness: 0.3,
  consistency: 0.25,
  judgment: 0.1,
};

const LLM_ONLY_CONFIDENCE = 30;

/**
 * 将候选 data_sources + 文本字段映射为证据来源类型。
 */
function buildEvidenceSources(sources, candidate) {
  const out = new Set();
  const srcs = Array.isArray(sources) ? sources.filter(Boolean) : [];
  for (const s of srcs) {
    if (s === 'ipo_project') out.add('internal_project');
    else if (s === 'sourcing_financing_event') out.add('internal_financing');
    else if (s === 'ai_web') out.add('ai_web');
    else if (s === 'user_added') out.add('user_added');
  }
  const qcc = strTrim(candidate?.qcc_intro_effective || candidate?.qcc_intro);
  if (qcc.length >= 20) out.add('qcc');
  if (out.size === 0) out.add('llm_inference');
  return [...out];
}

function parseEventDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthsBetween(fromDate, toDate = new Date()) {
  const ms = toDate.getTime() - fromDate.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / (30.44 * 24 * 3600 * 1000);
}

/** 来源覆盖分 0–100 */
function computeSourceCoverageScore(evidenceSources) {
  const sources = evidenceSources || [];
  if (sources.includes('user_added')) return 95;
  const external = sources.filter((s) => s !== 'llm_inference');
  if (external.length >= 2) return 80;
  if (external.length === 1) return 55;
  return 20;
}

/** 数据新鲜度分 0–100（取候选 event_date 最新值） */
function computeFreshnessScore(candidate) {
  const d = parseEventDate(candidate?.event_date);
  if (!d) return 40;
  const months = monthsBetween(d);
  if (months == null) return 40;
  if (months <= 12) return 100;
  if (months <= 24) return 80;
  if (months <= 36) return 60;
  return 40;
}

function freshnessMonthsAgo(candidate) {
  const d = parseEventDate(candidate?.event_date);
  if (!d) return null;
  const months = monthsBetween(d);
  return months == null ? null : Math.round(months);
}

/** 多源文本一致性 0–100 */
function computeConsistencyScore(candidate) {
  const intro = strTrim(candidate?.product_intro);
  const qcc = strTrim(candidate?.qcc_intro_effective || candidate?.qcc_intro);
  if (intro && qcc) {
    const overlap = textOverlapScore(intro, qcc);
    if (overlap < 0.15 && intro.length >= 20 && qcc.length >= 20) return 25;
    return Math.round(40 + overlap * 60);
  }
  if (intro || qcc) return 55;
  return 50;
}

/** S5 判断强度 0–100（辅助维，不替代新鲜度） */
function computeJudgmentStrengthScore(validation) {
  if (!validation) return 50;
  const vs = Number(validation.validated_score);
  if (Number.isFinite(vs)) return Math.max(0, Math.min(100, Math.round(vs)));
  const dims = validation.dimension_scores;
  if (dims && typeof dims === 'object') {
    const parts = ['substitutability', 'customer_overlap', 'scenario_overlap']
      .map((k) => Number(dims[k]))
      .filter((n) => Number.isFinite(n));
    if (parts.length) {
      const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
      return Math.max(0, Math.min(100, Math.round(avg)));
    }
  }
  return 50;
}

function computeEvidenceConfidence(evidenceSources, breakdown) {
  if (
    evidenceSources?.length === 1 &&
    evidenceSources[0] === 'llm_inference'
  ) {
    return LLM_ONLY_CONFIDENCE;
  }
  const b = breakdown || {};
  let score = Math.round(
    (b.source_coverage_score || 0) * EVIDENCE_WEIGHTS.source +
      (b.freshness_score || 0) * EVIDENCE_WEIGHTS.freshness +
      (b.consistency_score || 0) * EVIDENCE_WEIGHTS.consistency +
      (b.judgment_strength_score || 0) * EVIDENCE_WEIGHTS.judgment
  );
  const externalCount = (evidenceSources || []).filter((s) => s !== 'llm_inference').length;
  if (externalCount >= 2 && (b.consistency_score || 0) < 35) {
    score = Math.min(score, 55);
  }
  if ((b.freshness_score || 0) <= 40) {
    score = Math.min(score, 70);
  }
  return Math.max(20, Math.min(95, score));
}

/** D4-B：允许落库，低可信或矛盾标待复核。 */
function computeNeedsReview(evidenceConfidence, breakdown) {
  const n = Number(evidenceConfidence);
  if (Number.isFinite(n) && n < 60) return 1;
  const b = breakdown || {};
  if ((b.consistency_score || 0) < 35) return 1;
  if ((b.freshness_score || 0) <= 40 && (b.source_coverage_score || 0) < 70) return 1;
  return 0;
}

function evidenceConfidenceLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 80) return '高';
  if (n >= 60) return '中';
  return '低';
}

/** 人工复核选用：高/中/低 → 落库分值 */
const EVIDENCE_TIER_SCORE = {
  high: 85,
  medium: 65,
  low: 45,
};

function normalizeEvidenceTier(tier) {
  const t = String(tier || '').trim().toLowerCase();
  if (t === 'high' || t === '高') return 'high';
  if (t === 'medium' || t === '中') return 'medium';
  if (t === 'low' || t === '低') return 'low';
  return null;
}

function scoreFromEvidenceTier(tier) {
  const key = normalizeEvidenceTier(tier);
  return key ? EVIDENCE_TIER_SCORE[key] : null;
}

function evidenceTierFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'medium';
  if (n >= 80) return 'high';
  if (n >= 60) return 'medium';
  return 'low';
}

function buildEvidenceMeta(sources, candidate, validation = null) {
  const evidenceSources = buildEvidenceSources(sources, candidate);
  const source_coverage_score = computeSourceCoverageScore(evidenceSources);
  const freshness_score = computeFreshnessScore(candidate);
  const consistency_score = computeConsistencyScore(candidate);
  const judgment_strength_score = computeJudgmentStrengthScore(validation);
  const breakdown = {
    source_coverage_score,
    freshness_score,
    consistency_score,
    judgment_strength_score,
    freshness_months_ago: freshnessMonthsAgo(candidate),
    evidence_sources: evidenceSources,
    weights: { ...EVIDENCE_WEIGHTS },
  };
  const evidenceConfidence = computeEvidenceConfidence(evidenceSources, breakdown);
  const needsReview = computeNeedsReview(evidenceConfidence, breakdown);
  return {
    evidenceSources,
    evidenceConfidence,
    needsReview,
    evidenceBreakdown: breakdown,
  };
}

module.exports = {
  EVIDENCE_SOURCE_LABELS,
  EVIDENCE_WEIGHTS,
  buildEvidenceSources,
  computeSourceCoverageScore,
  computeFreshnessScore,
  computeConsistencyScore,
  computeJudgmentStrengthScore,
  computeEvidenceConfidence,
  computeNeedsReview,
  evidenceConfidenceLabel,
  normalizeEvidenceTier,
  scoreFromEvidenceTier,
  evidenceTierFromScore,
  EVIDENCE_TIER_SCORE,
  buildEvidenceMeta,
};
