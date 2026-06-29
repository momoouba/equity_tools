/**
 * 竞品匹配：标签解析、相似度、等级与得分融合（确定性计算，不依赖会话上下文）。
 */

function strTrim(v) {
  return v != null ? String(v).trim() : '';
}

/** 将 ai_*_tags_json 扁平为中文标签数组（支持数组或 §12.10 对象形态）。 */
function parseTagsFromJson(raw) {
  if (raw == null || raw === '') return [];
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return strTrim(raw)
        .split(/[,，、]/g)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  if (Array.isArray(data)) {
    return data.map((x) => strTrim(x)).filter((x) => x && x.length <= 64);
  }
  if (data && typeof data === 'object') {
    const out = [];
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) {
        for (const t of v) {
          const s = strTrim(t);
          if (s) out.push(s);
        }
      } else {
        const s = strTrim(v);
        if (s) out.push(s);
      }
    }
    return [...new Set(out)];
  }
  return [];
}

function mergeTagArrays(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const t of list || []) {
      const s = strTrim(t);
      if (!s || s.length > 32) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 32) return out;
    }
  }
  return out;
}

function jaccardSimilarity(a, b) {
  const setA = new Set((a || []).map((x) => strTrim(x).toLowerCase()).filter(Boolean));
  const setB = new Set((b || []).map((x) => strTrim(x).toLowerCase()).filter(Boolean));
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

/** 简单文本重叠（0~1），作无 LLM 时的产品相似度代理。 */
function textOverlapScore(a, b) {
  const ta = strTrim(a).toLowerCase();
  const tb = strTrim(b).toLowerCase();
  if (!ta || !tb) return 0;
  if (ta === tb) return 1;
  const shorter = ta.length < tb.length ? ta : tb;
  const longer = ta.length >= tb.length ? ta : tb;
  if (longer.includes(shorter) && shorter.length >= 8) return 0.85;
  const grams = new Set();
  for (let i = 0; i < shorter.length - 1; i++) grams.add(shorter.slice(i, i + 2));
  let hit = 0;
  for (const g of grams) {
    if (longer.includes(g)) hit += 1;
  }
  return grams.size ? hit / grams.size : 0;
}

function l2Similarity(a, b) {
  const x = strTrim(a);
  const y = strTrim(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  return jaccardSimilarity(x.split(/[/\s>]+/), y.split(/[/\s>]+/));
}

function normalizeCreditCode(code) {
  return strTrim(code).replace(/\s+/g, '');
}

function candidateDedupeKey(row) {
  const code = normalizeCreditCode(row.unified_credit_code || row.company_credit_code);
  if (code.length >= 15) return `cc:${code}`;
  const name = strTrim(row.display_name || row.company_name || row.project_name).toLowerCase();
  if (name) return `name:${name}`;
  const id = row.source_id || row.id || row.f_id;
  return id ? `id:${String(id).trim()}` : `unknown:${Date.now()}_${process.pid}`;
}

function scoreToGrade(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 90) return 'S';
  if (n >= 80) return 'A';
  if (n >= 70) return 'B';
  if (n >= 60) return 'C';
  return null;
}

function fuseConfidence(internalScore, aiScore) {
  const internal = Number(internalScore) || 0;
  const ai = Number(aiScore) || 0;
  return Math.round(Math.min(100, Math.max(0, internal * 0.6 + ai * 0.4)));
}

/** 规则分偏低但 LLM 对标≥该值时，提高 AI 权重（与 §3.5.2 默认 6:4 区分）。 */
const LLM_HIGH_TRUST_THRESHOLD = 80;

/**
 * 从候选行取 AI 侧得分（落库综合分用）。
 * S5 校验完成后以 validated_score 为准；无校验结果时回退 S3 llmProductScore。
 */
function getCandidateAiPart(c) {
  if (!c || typeof c !== 'object') return 0;
  const v = c.validation;
  if (
    v &&
    v.ai_failed !== true &&
    v.validated_score != null &&
    Number.isFinite(Number(v.validated_score))
  ) {
    return Number(v.validated_score);
  }
  if (c.llmProductScore != null && Number.isFinite(Number(c.llmProductScore))) {
    return Number(c.llmProductScore);
  }
  return Number(c.productScore) || 0;
}

/**
 * 综合置信度（落库用）。
 * - 有内部源：默认 内部×0.6+AI×0.4；LLM≥80 时用 内部×0.2+AI×0.8。
 * - 专业赛道内部池（_trackInternalPeer）：S5 校验通过且 AI≥52 时综合分=校验分；否则 LLM≥68 时用 内部×0.25+AI×0.75。
 * - 仅 AI 联网源：综合分 = AI 分。
 */
/** 专业赛道内部池：S5 可信但规则分偏低时，避免综合分被 internal 拖死 */
const TRACK_INTERNAL_AI_FLOOR = 68;

/** 专业赛道内部池：S5 校验通过后，落库综合分以校验分为准（避免规则分拖累） */
const TRACK_INTERNAL_PERSIST_AI_MIN = 52;

function computeComprehensiveScore(c) {
  const ai = getCandidateAiPart(c);
  const internal = Number(c.internalScore) || 0;
  const hasInternal = !!c.hasInternal;
  if (!hasInternal) {
    return Math.round(Math.min(100, Math.max(0, ai)));
  }
  if (
    c._trackInternalPeer &&
    ai >= TRACK_INTERNAL_PERSIST_AI_MIN &&
    isPersistValidationPassed(c)
  ) {
    return Math.round(Math.min(100, Math.max(0, ai)));
  }
  if (ai >= LLM_HIGH_TRUST_THRESHOLD) {
    return Math.round(Math.min(100, Math.max(0, internal * 0.2 + ai * 0.8)));
  }
  if (c._trackInternalPeer && ai >= TRACK_INTERNAL_AI_FLOOR) {
    return Math.round(Math.min(100, Math.max(0, internal * 0.25 + ai * 0.75)));
  }
  return fuseConfidence(internal, ai);
}

const SCORE_THRESHOLD_PERSIST = 60;
/** LLM 高信任且校验为竞品时，允许略低于默认阈值的综合分落库 */
const SCORE_THRESHOLD_HIGH_LLM = 55;
const VALIDATE_INTERNAL_MIN_DEFAULT = 45;

/** 落库/校验阈值（投前与投后暂同值，待黄金集验证后再分化 pre 侧）。 */
const THRESHOLDS_BY_SUBJECT = {
  invested_enterprise: {
    persist: SCORE_THRESHOLD_PERSIST,
    highLlm: SCORE_THRESHOLD_HIGH_LLM,
    validateInternalMin: VALIDATE_INTERNAL_MIN_DEFAULT,
  },
  pre_investment_project: {
    persist: SCORE_THRESHOLD_PERSIST,
    highLlm: SCORE_THRESHOLD_HIGH_LLM,
    validateInternalMin: VALIDATE_INTERNAL_MIN_DEFAULT,
  },
};

function getThresholds(subjectType) {
  return THRESHOLDS_BY_SUBJECT[subjectType] || THRESHOLDS_BY_SUBJECT.invested_enterprise;
}

/** 是否已通过 S5 校验且可参与落库（非 ai_failed / 非竞品 / 非上下游）。 */
function isPersistValidationPassed(c) {
  const v = c?.validation;
  if (!v || v.ai_failed) return false;
  const type = v.competitor_type;
  if (type === 'not_competitor' || type === 'upstream_downstream') return false;
  if (v.is_competitor === false) return false;
  if (v.is_upstream_downstream) return false;
  return true;
}

/**
 * 是否达到落库分数门槛。
 * - 默认综合分 ≥ 60；
 * - LLM/校验分 ≥ 80 且校验为直接竞品（非上下游）时，综合分 ≥ 55 即可。
 */
function meetsPersistThreshold(c, finalScore, opts = {}) {
  const th = opts.threshold ?? SCORE_THRESHOLD_PERSIST;
  const thHigh = opts.thresholdHighLlm ?? SCORE_THRESHOLD_HIGH_LLM;
  const score = Number(finalScore);
  const type = c.validation?.competitor_type;
  const coreLine = Number(c.coreLineScore ?? NaN);
  const product = Number(c.productScore ?? NaN);
  const lacksCoreProductOverlap =
    (Number.isFinite(coreLine) ? coreLine : 0) < 15 &&
    (Number.isFinite(product) ? product : 0) < 18;

  if (type === 'same_track') {
    const vs = Number(c.validation?.validated_score);
    if (Number.isFinite(vs) && vs >= 35 && !lacksCoreProductOverlap) return true;
    if (Number.isFinite(vs) && vs >= 42) return true;
  }
  if (['direct', 'indirect', 'substitute'].includes(type) && lacksCoreProductOverlap) {
    return false;
  }
  if (Number.isFinite(score) && score >= th) return true;
  const ai = getCandidateAiPart(c);
  if (
    c._trackInternalPeer &&
    c.validation?.competitor_type === 'direct' &&
    Number.isFinite(ai) &&
    ai >= thHigh &&
    isPersistValidationPassed(c)
  ) {
    return true;
  }
  if (ai < LLM_HIGH_TRUST_THRESHOLD) return false;
  if (c.validation?.is_competitor === false || c.validation?.is_upstream_downstream) return false;
  return Number.isFinite(score) && score >= thHigh;
}

function weightedScore(parts) {
  let sum = 0;
  let w = 0;
  for (const p of parts) {
    sum += (Number(p.value) || 0) * (Number(p.weight) || 0);
    w += Number(p.weight) || 0;
  }
  return w > 0 ? Math.round(sum / w) : 0;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = {
  strTrim,
  parseTagsFromJson,
  mergeTagArrays,
  jaccardSimilarity,
  textOverlapScore,
  l2Similarity,
  normalizeCreditCode,
  candidateDedupeKey,
  scoreToGrade,
  fuseConfidence,
  computeComprehensiveScore,
  meetsPersistThreshold,
  getCandidateAiPart,
  getThresholds,
  isPersistValidationPassed,
  LLM_HIGH_TRUST_THRESHOLD,
  TRACK_INTERNAL_AI_FLOOR,
  TRACK_INTERNAL_PERSIST_AI_MIN,
  SCORE_THRESHOLD_PERSIST,
  SCORE_THRESHOLD_HIGH_LLM,
  VALIDATE_INTERNAL_MIN_DEFAULT,
  weightedScore,
  extractJsonObject,
};
