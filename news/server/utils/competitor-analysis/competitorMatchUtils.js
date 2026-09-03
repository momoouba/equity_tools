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
  return describeComprehensiveScore(c).final_score;
}

/**
 * 综合分实算 + 路径说明（落库 score_breakdown / 前端展示）
 */
function describeComprehensiveScore(c) {
  const ai = getCandidateAiPart(c);
  const internal = Number(c.internalScore) || 0;
  const hasInternal = !!c.hasInternal;
  const gradeHint = '等级门槛：S≥90，A≥80，B≥70，C≥60；低于 60 分不标等级';
  const reasonLines = [];
  const v = c.validation || null;
  const dims = v?.dimension_scores && typeof v.dimension_scores === 'object' ? v.dimension_scores : null;
  const productScore = Number(c.productScore);
  const tagScore = Number(c.tagScore);
  const llmProduct = Number(c.llmProductScore);

  let scoreMode = 'ai_only';
  let finalScore = Math.round(Math.min(100, Math.max(0, ai)));
  let formula = `综合分 = AI ${ai}`;

  const pushAiHighExplain = () => {
    reasonLines.push(
      `【为何综合分能到 ${finalScore}】本条综合分几乎完全来自 AI/S5 对标强度，不是来自证据可信四维，也不是来自产品规则分/标签分。`
    );
    if (dims) {
      reasonLines.push(
        `S5 三维（驱动高分的主要因素）：可替代性 ${dims.substitutability ?? '—'}，客户重叠 ${dims.customer_overlap ?? '—'}，场景重叠 ${dims.scenario_overlap ?? '—'} → 合成校验分/AI 对标分 ${ai}。`
      );
    } else if (Number.isFinite(llmProduct) && Math.round(llmProduct) === Math.round(ai)) {
      reasonLines.push(`AI 对标分 ${ai} 来自 LLM 产品对标分（无单独三维明细）。`);
    } else {
      reasonLines.push(`AI 对标分 ${ai}（优先取 S5 validated_score，否则回退 LLM 产品分）。`);
    }
    if (Number.isFinite(productScore)) {
      reasonLines.push(
        `未计入综合分：产品规则分 ${productScore}${Number.isFinite(tagScore) ? `、标签分 ${tagScore}` : ''}（本路径不参与加权）。`
      );
    }
    reasonLines.push('左侧「系统证据分」只影响证据可信/是否待复核，不会把综合分从 91 拉低或抬高。');
  };

  if (!hasInternal) {
    scoreMode = 'ai_only';
    finalScore = Math.round(Math.min(100, Math.max(0, ai)));
    formula = `综合分 = AI 对标分 ${ai}`;
    reasonLines.push('计分路径：综合分 = AI 对标分（无内部库召回，不按内部规则分加权）。');
    reasonLines.push(
      '触发条件：未命中底层项目/融资事件/上市主池等内部源（仅联网/外部发现）。因此不会走「内部×0.6+AI×0.4」。'
    );
    reasonLines.push(`实算：综合分 = ${ai} → ${finalScore}。`);
    pushAiHighExplain();
    if (Number.isFinite(internal) && internal > 0) {
      reasonLines.push(`内部规则分 ${internal} 仅作参考，本路径不计入综合分。`);
    }
  } else if (
    c._trackInternalPeer &&
    ai >= TRACK_INTERNAL_PERSIST_AI_MIN &&
    isPersistValidationPassed(c)
  ) {
    scoreMode = 'ai_only';
    finalScore = Math.round(Math.min(100, Math.max(0, ai)));
    formula = `综合分 = AI 对标分 ${ai}（专业赛道内部池 peer 特例）`;
    reasonLines.push('计分路径：综合分 = AI 对标分（专业赛道内部池：S5 通过后以校验分为准）。');
    reasonLines.push(
      `触发条件：_trackInternalPeer 且 AI≥${TRACK_INTERNAL_PERSIST_AI_MIN} 且 S5 校验通过。`
    );
    reasonLines.push(`实算：综合分 = ${ai} → ${finalScore}。内部规则分 ${internal} 不计入。`);
    pushAiHighExplain();
  } else if (ai >= LLM_HIGH_TRUST_THRESHOLD) {
    scoreMode = 'internal_0.2_ai_0.8';
    const raw = internal * 0.2 + ai * 0.8;
    finalScore = Math.round(Math.min(100, Math.max(0, raw)));
    formula = `${internal}×0.2 + ${ai}×0.8 = ${raw.toFixed(2)} → ${finalScore}`;
    reasonLines.push('计分路径：综合分 = 内部×0.2 + AI×0.8。');
    reasonLines.push(
      `触发条件：有内部源，且 AI ≥ ${LLM_HIGH_TRUST_THRESHOLD}（LLM 高信任）→ AI 权重大。`
    );
    reasonLines.push(`实算：${formula}。`);
    reasonLines.push(
      `【分数构成】内部规则分贡献约 ${(internal * 0.2).toFixed(1)} 分，AI 对标分贡献约 ${(ai * 0.8).toFixed(1)} 分；高分主要来自 AI 侧 ${ai}。`
    );
    if (dims) {
      reasonLines.push(
        `AI 侧三维：可替代性 ${dims.substitutability ?? '—'}，客户重叠 ${dims.customer_overlap ?? '—'}，场景重叠 ${dims.scenario_overlap ?? '—'}。`
      );
    }
  } else if (c._trackInternalPeer && ai >= TRACK_INTERNAL_AI_FLOOR) {
    scoreMode = 'internal_0.25_ai_0.75';
    const raw = internal * 0.25 + ai * 0.75;
    finalScore = Math.round(Math.min(100, Math.max(0, raw)));
    formula = `${internal}×0.25 + ${ai}×0.75 = ${raw.toFixed(2)} → ${finalScore}`;
    reasonLines.push('计分路径：综合分 = 内部×0.25 + AI×0.75（专业赛道内部池）。');
    reasonLines.push(`实算：${formula}。`);
    reasonLines.push(
      `【分数构成】内部约 ${(internal * 0.25).toFixed(1)} + AI 约 ${(ai * 0.75).toFixed(1)}；高分仍主要看 AI 侧。`
    );
  } else {
    scoreMode = 'internal_0.6_ai_0.4';
    const raw = internal * 0.6 + ai * 0.4;
    finalScore = Math.round(Math.min(100, Math.max(0, raw)));
    formula = `${internal}×0.6 + ${ai}×0.4 = ${raw.toFixed(2)} → ${finalScore}`;
    reasonLines.push('计分路径：综合分 = 内部×0.6 + AI×0.4。');
    reasonLines.push('触发条件：有内部源，且 AI < 80（未触发高信任）。');
    reasonLines.push(`实算：${formula}。`);
    reasonLines.push(
      `【分数构成】内部规则分贡献约 ${(internal * 0.6).toFixed(1)} 分，AI 贡献约 ${(ai * 0.4).toFixed(1)} 分。`
    );
  }

  const grade = scoreToGrade(finalScore);
  if (!grade) {
    reasonLines.push(`综合分 ${finalScore} < 60 → 不标等级。要到 C 至少 ≥60，要到 A 至少 ≥80，要到 S 至少 ≥90。`);
  } else {
    const floors = { S: 90, A: 80, B: 70, C: 60 };
    const next = { C: ['B', 70], B: ['A', 80], A: ['S', 90], S: null };
    let gText = `综合分 ${finalScore} ≥ ${floors[grade]} → 等级 ${grade}。`;
    const up = next[grade];
    if (up) gText += `未到 ${up[0]}：需要 ≥${up[1]}（还差 ${Math.max(0, up[1] - finalScore)} 分）。`;
    else gText += '已是最高档 S。';
    reasonLines.push(gText);
  }
  reasonLines.push(gradeHint);
  reasonLines.push('说明：匹配综合分 ≠ 证据可信四维；也 ≠ 人工认定的证据可信度。');

  return {
    final_score: finalScore,
    score_mode: scoreMode,
    formula,
    internal_score: internal,
    ai_score: ai,
    grade,
    reason_lines: reasonLines,
  };
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
  if (c?._goldStandardNegative) return false;
  const v = c?.validation;
  if (!v || v.ai_failed) return false;
  const type = v.competitor_type;
  if (type === 'not_competitor' || type === 'upstream_downstream') return false;
  if (v.is_competitor === false) return false;
  if (v.is_upstream_downstream) return false;
  // 模态不一致的同赛道：不当作可落库竞品（扩召回/配额补足一并拦截）
  if (type === 'same_track' && v.modality_match === false) return false;
  return true;
}

function isAiWebOnlyCandidate(c) {
  if (!c || c.hasInternal) return false;
  const srcs = c.sources || (c.source ? [c.source] : []);
  return srcs.includes('ai_web');
}

/**
 * 是否达到落库分数门槛。
 * - 默认综合分 ≥ 60；
 * - LLM/校验分 ≥ 80 且校验为直接竞品（非上下游）时，综合分 ≥ 55 即可；
 * - 联网发现且 S5 已判 direct/indirect/substitute、validated≥55：不因库内产品线分缺失误杀（早期金标常态）。
 */
/** 金标种子：S5 校验通过但候选库内简介稀疏导致综合分偏低时，仍允许落库 */
const GOLD_PERSIST_MIN_FINAL = Math.max(
  10,
  parseInt(process.env.COMPETITOR_GOLD_PERSIST_MIN_SCORE || '15', 10) || 15
);
const GOLD_PERSIST_MIN_VALIDATED = Math.max(
  30,
  parseInt(process.env.COMPETITOR_GOLD_PERSIST_MIN_VALIDATED || '35', 10) || 35
);

function meetsGoldStandardPersistThreshold(c, finalScore) {
  if (!c?._fromGoldStandard || !isPersistValidationPassed(c)) return false;
  const vs = Number(c.validation?.validated_score);
  const score = Number(finalScore);
  if (!Number.isFinite(vs) || vs < GOLD_PERSIST_MIN_VALIDATED) return false;
  if (c.validation?.modality_match === false) return false;
  return Number.isFinite(score) && score >= GOLD_PERSIST_MIN_FINAL;
}

function sortPersistRowsWithGoldPriority(rows) {
  return [...rows].sort((a, b) => {
    const ga = a._candidate?._fromGoldStandard ? 1 : 0;
    const gb = b._candidate?._fromGoldStandard ? 1 : 0;
    if (ga !== gb) return gb - ga;
    return (b.finalScore || 0) - (a.finalScore || 0);
  });
}

function candidateHasRadiopharmaSignal(c) {
  const { RADIOPHARMA_TRACK_RE } = require('./industry-strategies/baseStrategy');
  const blob = [
    c?.display_name,
    c?.product_intro,
    c?.qcc_intro,
    c?.web_core_products,
    ...(c?.tags || []),
    ...(c?.core_product_lines || []),
    c?.validation?.rationale,
    c?.validation?.key_differences,
  ]
    .filter(Boolean)
    .join('\n');
  return RADIOPHARMA_TRACK_RE.test(blob);
}

function meetsPersistThreshold(c, finalScore, opts = {}) {
  const hasOffTarget =
    c._hasStrongOffTargetSignals ??
    require('./competitorProductLineUtils').hasStrongOffTargetSignals(c);
  const type = c.validation?.competitor_type;
  const vs = Number(c.validation?.validated_score);
  const radiopharmaPeerPersist =
    !!opts.radiopharmaTrackTarget &&
    candidateHasRadiopharmaSignal(c) &&
    ['direct', 'indirect', 'substitute', 'same_track'].includes(type) &&
    Number.isFinite(vs) &&
    vs >= 32 &&
    isPersistValidationPassed(c);
  if (hasOffTarget && Number(c?.validation?.validated_score) < 60 && !radiopharmaPeerPersist) {
    return false;
  }
  if (radiopharmaPeerPersist) return true;
  const th = opts.threshold ?? SCORE_THRESHOLD_PERSIST;
  const thHigh = opts.thresholdHighLlm ?? SCORE_THRESHOLD_HIGH_LLM;
  const score = Number(finalScore);
  const coreLine = Number(c.coreLineScore ?? NaN);
  const product = Number(c.productScore ?? NaN);
  const lacksCoreProductOverlap =
    (Number.isFinite(coreLine) ? coreLine : 0) < 15 &&
    (Number.isFinite(product) ? product : 0) < 18;
  const ai = getCandidateAiPart(c);
  // 金标种子：只要 S5 校验为直接/间接/同赛道/替代竞品且分数达标，不因 S2 分缺失误杀
  if (c._fromGoldStandard && isPersistValidationPassed(c)) {
    if (Number.isFinite(vs) && vs >= thHigh) return true;
    if (meetsGoldStandardPersistThreshold(c, score)) return true;
  }
  const fromAiWeb = isAiWebOnlyCandidate(c) || (c.sources || []).includes('ai_web');
  const webHighTrust =
    fromAiWeb &&
    Number.isFinite(vs) &&
    vs >= 78 &&
    ['direct', 'indirect', 'substitute'].includes(type);
  // 联网已校验为竞品且分达高信任线：允许综合分≥55（覆盖若伴类早期同形态，不必等到 78）
  const webValidatedPeer =
    fromAiWeb &&
    Number.isFinite(vs) &&
    vs >= thHigh &&
    ['direct', 'indirect', 'substitute'].includes(type) &&
    isPersistValidationPassed(c);

  if (type === 'same_track') {
    if (Number.isFinite(vs) && vs >= 35 && !lacksCoreProductOverlap) return true;
    if (Number.isFinite(vs) && vs >= 42) return true;
  }
  if (['direct', 'indirect', 'substitute'].includes(type) && lacksCoreProductOverlap) {
    if (webHighTrust || webValidatedPeer) {
      return Number.isFinite(score) && score >= thHigh;
    }
    if (Number.isFinite(ai) && ai >= LLM_HIGH_TRUST_THRESHOLD && type === 'direct') {
      return Number.isFinite(score) && score >= thHigh;
    }
    return false;
  }
  if (Number.isFinite(score) && score >= th) return true;
  if (
    c._trackInternalPeer &&
    c.validation?.competitor_type === 'direct' &&
    Number.isFinite(ai) &&
    ai >= thHigh &&
    isPersistValidationPassed(c)
  ) {
    return true;
  }
  if ((webHighTrust || webValidatedPeer) && Number.isFinite(score) && score >= thHigh) return true;
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
  describeComprehensiveScore,
  meetsPersistThreshold,
  meetsGoldStandardPersistThreshold,
  sortPersistRowsWithGoldPriority,
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
