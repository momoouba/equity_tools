const { strTrim, textOverlapScore } = require('./competitorMatchUtils');

const EVIDENCE_SOURCE_LABELS = {
  qcc: '企查查',
  internal_project: '底层项目',
  internal_listed: '上市主池',
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
    else if (s === 'ipo_new_share') out.add('internal_listed');
    else if (s === 'sourcing_financing_event') out.add('internal_financing');
    else if (s === 'ai_web') out.add('ai_web');
    else if (s === 'user_added') out.add('user_added');
  }
  const qcc = strTrim(candidate?.qcc_intro_effective || candidate?.qcc_intro);
  if (qcc.length >= 20) out.add('qcc');
  if (out.size === 0) out.add('llm_inference');
  return [...out];
}

function formatEvidenceSourceList(sources) {
  if (!Array.isArray(sources) || !sources.length) return '无明确来源';
  return sources.map((s) => EVIDENCE_SOURCE_LABELS[s] || s).join('、');
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

/** 来源覆盖分 0–100，附带档位与白话依据 */
function computeSourceCoverageScoreDetailed(evidenceSources) {
  const sources = evidenceSources || [];
  const external = sources.filter((s) => s !== 'llm_inference');
  const label = formatEvidenceSourceList(sources);
  const hasInternalPool = sources.some((s) =>
    ['internal_project', 'internal_listed', 'internal_financing'].includes(s)
  );
  const missing = [];
  if (!sources.includes('internal_project')) missing.push('底层项目');
  if (!sources.includes('internal_financing')) missing.push('融资事件');
  if (!sources.includes('internal_listed')) missing.push('上市主池');
  if (!sources.includes('qcc')) missing.push('企查查简介');

  const meaning =
    '本维含义：衡量「证据从哪来、是否多元」，不是单独判断「是否命中融资管理/底层项目」。底层项目、融资事件、上市主池、企查查、联网发现都算证据来源；命中底层/融资会提高档位，但不是唯一条件。';
  const rule =
    '计分规则（互斥固定档）：人工新增 → 95；≥2 个非推理源 → 80；仅 1 个非推理源 → 55；仅模型推断/无源 → 20。';

  let score = 20;
  let tier = 'weak';
  let reasonLines = [];

  if (sources.includes('user_added')) {
    score = 95;
    tier = 'user_added';
    reasonLines = [
      meaning,
      `当前计入来源：${label}（非推理源 ${external.length} 个）。`,
      rule,
      '本次命中「人工新增」→ 固定 95。',
    ];
  } else if (external.length >= 2) {
    score = 80;
    tier = 'multi_external';
    reasonLines = [
      meaning,
      `当前计入来源：${label}（非推理源 ${external.length} 个）。`,
      rule,
      `本次命中「多源」→ 固定 80。${hasInternalPool ? '其中已包含内部库来源（底层/融资/上市）。' : '本次未命中底层项目/融资事件/上市主池，但有 ≥2 个其它非推理源（如联网+企查查）。'}`,
    ];
  } else if (external.length === 1) {
    score = 55;
    tier = 'single_external';
    reasonLines = [
      meaning,
      `当前计入来源：${label}（非推理源仅 1 个：${formatEvidenceSourceList(external)}）。`,
      rule,
      `本次命中「单外部源」→ 固定 55。未到 80：还缺其它独立来源（当前缺少：${missing.join('、') || '更多外部源'}）。不是 0：已有真实外部证据，只是覆盖面窄。`,
    ];
  } else {
    score = 20;
    tier = 'weak';
    reasonLines = [
      meaning,
      `当前计入来源：${label}（无非推理外部源）。`,
      rule,
      '本次命中「弱来源」→ 固定 20。要提高：需命中底层项目/融资事件/上市主池/企查查/联网等至少一类真实来源。',
    ];
  }

  return {
    score,
    tier,
    reason: reasonLines.join('\n'),
    detail: {
      sources: [...sources],
      external_count: external.length,
      has_internal_pool: hasInternalPool,
      missing_preferred: missing,
    },
  };
}

function computeSourceCoverageScore(evidenceSources) {
  return computeSourceCoverageScoreDetailed(evidenceSources).score;
}

/** 数据新鲜度分 0–100（取候选 event_date 最新值） */
function computeFreshnessScoreDetailed(candidate) {
  const rule =
    '计分规则：≤12 个月 → 100；≤24 → 80；≤36 → 60；更早 → 40；无日期 → 40。';
  const d = parseEventDate(candidate?.event_date);
  if (!d) {
    return {
      score: 40,
      tier: 'no_date',
      months_ago: null,
      reason: [
        '本维含义：看候选关联事件日期有多「新」。无日期时无法证明很新，也无法证明已过时。',
        '本次无事件日期 → 固定给保底分 40（不是 0）。',
        '为何不是 0：0 表示「已证实过旧/无效」；缺日期属于信息缺失，系统用中性偏低保底，避免把「未知」等同于「最差」。',
        '计分规则：≤12 个月 → 100；≤24 → 80；≤36 → 60；更早或无日期 → 40。要提高本维：需补到融资/工商等可解析的事件日期。',
      ].join('\n'),
      detail: { event_date: candidate?.event_date || null, months_ago: null },
    };
  }
  const monthsRaw = monthsBetween(d);
  if (monthsRaw == null) {
    return {
      score: 40,
      tier: 'no_date',
      months_ago: null,
      reason: [
        '事件日期无法解析月数 → 固定保底 40（不是 0：未知≠已证实过旧）。',
        '计分规则：≤12 个月 → 100；≤24 → 80；≤36 → 60；更早或无日期 → 40。',
      ].join('\n'),
      detail: { event_date: candidate?.event_date || null, months_ago: null },
    };
  }
  const months = Math.round(monthsRaw);
  let score = 40;
  let tier = 'stale';
  let why = '';
  if (months <= 12) {
    score = 100;
    tier = 'within_12m';
    why = `事件约 ${months} 个月前 → ≤12 月档 → 固定 100。`;
  } else if (months <= 24) {
    score = 80;
    tier = 'within_24m';
    why = `事件约 ${months} 个月前 → ≤24 月档 → 固定 80。未取 100：已超过 12 个月；未取 60：仍在 24 个月内。`;
  } else if (months <= 36) {
    score = 60;
    tier = 'within_36m';
    why = `事件约 ${months} 个月前 → ≤36 月档 → 固定 60。未取 80：已超过 24 个月；未取 40：仍在 36 个月内。`;
  } else {
    score = 40;
    tier = 'stale';
    why = `事件约 ${months} 个月前 → 超过 36 个月 → 固定 40。不是 60：已越过 36 个月档；不是 0：过旧数据仍给保底 40。`;
  }
  return {
    score,
    tier,
    months_ago: months,
    reason: [why, rule].join('\n'),
    detail: { event_date: candidate?.event_date || null, months_ago: months },
  };
}

function computeFreshnessScore(candidate) {
  return computeFreshnessScoreDetailed(candidate).score;
}

function freshnessMonthsAgo(candidate) {
  return computeFreshnessScoreDetailed(candidate).months_ago;
}

/** 多源文本一致性 0–100 */
function computeConsistencyScoreDetailed(candidate) {
  const intro = strTrim(candidate?.product_intro);
  const qcc = strTrim(candidate?.qcc_intro_effective || candidate?.qcc_intro);
  const meaning =
    '本维含义：用「产品介绍」与「企查查公司简介」做交叉核对——两边说法是否互相印证。不是判断它是不是竞品，只看两份文本是否对得上。';
  const rule =
    '计分规则：两侧都有文：重叠很低 → 25；否则按重叠率算分 round(40+重叠×60)。仅一侧有文 → 固定 55（无法交叉验证）。两侧皆空 → 固定 50。';

  if (intro && qcc) {
    const overlap = textOverlapScore(intro, qcc);
    if (overlap < 0.15 && intro.length >= 20 && qcc.length >= 20) {
      return {
        score: 25,
        tier: 'both_low_overlap',
        reason: [
          meaning,
          `两边都有较长简介（产品 ${intro.length} 字 / 企查查 ${qcc.length} 字），但重叠仅 ${(overlap * 100).toFixed(1)}% < 15% → 互相印证弱 → 25 分。`,
          rule,
        ].join('\n'),
        detail: {
          mode: 'both_low_overlap',
          overlap,
          intro_len: intro.length,
          qcc_len: qcc.length,
        },
      };
    }
    const score = Math.round(40 + overlap * 60);
    const pct = Math.round(overlap * 100);
    return {
      score,
      tier: 'both_overlap',
      reason: [
        meaning,
        `两边都有简介（产品 ${intro.length} 字 / 企查查 ${qcc.length} 字），文本重叠约 ${pct}% → round(40+${pct}%×60)=${score}。重叠越高，交叉印证越强。`,
        rule,
      ].join('\n'),
      detail: {
        mode: 'both_overlap',
        overlap,
        intro_len: intro.length,
        qcc_len: qcc.length,
      },
    };
  }
  if (intro || qcc) {
    const side = intro ? '只有产品介绍有文，企查查简介为空' : '只有企查查简介有文，产品介绍为空';
    return {
      score: 55,
      tier: 'one_side',
      reason: [
        meaning,
        `本次：${side}（产品 ${intro.length} 字 / 企查查 ${qcc.length} 字）→ 缺一侧就无法做交叉核对 → 固定 55。`,
        '为何不是更高：没有第二份文本来印证，不能给「高一致」。为何不是 0：并不是「两边打架」，只是信息不全，给中性偏低分。',
        '要提高：补全企查查简介（或产品介绍），使两侧都能比对。',
        rule,
      ].join('\n'),
      detail: {
        mode: 'one_side',
        overlap: null,
        intro_len: intro.length,
        qcc_len: qcc.length,
      },
    };
  }
  return {
    score: 50,
    tier: 'both_empty',
    reason: [
      meaning,
      '本次：产品介绍与企查查简介都空/不足 → 固定 50。无法交叉验证，也谈不上冲突。',
      rule,
    ].join('\n'),
    detail: { mode: 'both_empty', overlap: null, intro_len: 0, qcc_len: 0 },
  };
}

function computeConsistencyScore(candidate) {
  return computeConsistencyScoreDetailed(candidate).score;
}

/** S5 判断强度 0–100（辅助维，不替代新鲜度） */
function computeJudgmentStrengthScoreDetailed(validation) {
  const rule =
    '计分规则：优先 S5 validated_score；否则可替代性/客户重叠/场景重叠三维均值；再无则 50。';
  if (!validation) {
    return {
      score: 50,
      tier: 'default',
      reason: ['本次无 S5 校验结果 → 默认 50。', rule].join('\n'),
      detail: { source: 'default' },
    };
  }
  const vs = Number(validation.validated_score);
  if (Number.isFinite(vs)) {
    const score = Math.max(0, Math.min(100, Math.round(vs)));
    const dims = validation.dimension_scores;
    const lines = [
      `本次取 S5 validated_score=${Math.round(vs)} → 判断强度 ${score}。`,
      rule,
      '该分由模型对「是否竞品/对标强度」的校验给出，不是证据来源或新鲜度加权。',
    ];
    if (dims && typeof dims === 'object') {
      lines.push(
        `参考三维：可替代性 ${dims.substitutability ?? '—'}，客户重叠 ${dims.customer_overlap ?? '—'}，场景重叠 ${dims.scenario_overlap ?? '—'}。`
      );
    }
    return {
      score,
      tier: 'validated_score',
      reason: lines.join('\n'),
      detail: { source: 'validated_score', validated_score: score, dimension_scores: dims || null },
    };
  }
  const dims = validation.dimension_scores;
  if (dims && typeof dims === 'object') {
    const parts = ['substitutability', 'customer_overlap', 'scenario_overlap']
      .map((k) => Number(dims[k]))
      .filter((n) => Number.isFinite(n));
    if (parts.length) {
      const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
      const score = Math.max(0, Math.min(100, Math.round(avg)));
      return {
        score,
        tier: 'dimension_avg',
        reason: [
          `本次无独立 validated_score，改用三维均值：(${parts.join(' + ')}) / ${parts.length} ≈ ${score}。`,
          rule,
        ].join('\n'),
        detail: { source: 'dimension_avg', dimension_scores: dims },
      };
    }
  }
  return {
    score: 50,
    tier: 'default',
    reason: ['本次 S5 无可用校验分/三维 → 默认 50。', rule].join('\n'),
    detail: { source: 'default' },
  };
}

function computeJudgmentStrengthScore(validation) {
  return computeJudgmentStrengthScoreDetailed(validation).score;
}

function computeEvidenceConfidenceDetailed(evidenceSources, breakdown) {
  const b = breakdown || {};
  const src = Number(b.source_coverage_score) || 0;
  const fresh = Number(b.freshness_score) || 0;
  const cons = Number(b.consistency_score) || 0;
  const judg = Number(b.judgment_strength_score) || 0;
  const ws = EVIDENCE_WEIGHTS.source;
  const wf = EVIDENCE_WEIGHTS.freshness;
  const wc = EVIDENCE_WEIGHTS.consistency;
  const wj = EVIDENCE_WEIGHTS.judgment;

  const lines = [];
  const caps = [];

  if (evidenceSources?.length === 1 && evidenceSources[0] === 'llm_inference') {
    lines.push(
      `加权公式：来源×${Math.round(ws * 100)}% + 新鲜度×${Math.round(wf * 100)}% + 一致性×${Math.round(wc * 100)}% + 判断强度×${Math.round(wj * 100)}%`
    );
    lines.push('仅「模型推断」一源 → 证据分固定为 30（覆盖加权结果）。');
    lines.push('档位：30 →「低」（要到「中」至少 ≥60）。');
    return { score: LLM_ONLY_CONFIDENCE, calc_detail_lines: lines, caps_applied: ['llm_only_30'] };
  }

  const raw = src * ws + fresh * wf + cons * wc + judg * wj;
  const rawRounded = Math.round(raw);
  let score = rawRounded;
  lines.push(
    `加权公式：来源×${Math.round(ws * 100)}% + 新鲜度×${Math.round(wf * 100)}% + 一致性×${Math.round(wc * 100)}% + 判断强度×${Math.round(wj * 100)}%`
  );
  lines.push(
    `代入本条：${src}×${ws} + ${fresh}×${wf} + ${cons}×${wc} + ${judg}×${wj} = ${raw.toFixed(2)} → 四舍五入 ${rawRounded}`
  );

  const externalCount = (evidenceSources || []).filter((s) => s !== 'llm_inference').length;
  if (externalCount >= 2 && cons < 35) {
    score = Math.min(score, 55);
    caps.push('multi_source_low_consistency_cap_55');
    lines.push(`封顶：多源（${externalCount}）且一致性 ${cons} < 35 → ≤55；当前 ${score}`);
  }
  if (fresh <= 40) {
    score = Math.min(score, 70);
    caps.push('stale_freshness_cap_70');
    lines.push(`封顶：新鲜度 ${fresh} ≤ 40 → ≤70；当前 ${score}`);
  }
  const beforeClamp = score;
  score = Math.max(20, Math.min(95, score));
  if (score !== beforeClamp) {
    caps.push('clamp_20_95');
    lines.push(`夹紧到 [20, 95]：${beforeClamp} → ${score}`);
  }
  if (!caps.length) {
    lines.push(`本条未触发额外封顶（或仅落在 20–95 内）→ 系统证据分 ${score}`);
  } else {
    lines.push(`系统证据分 ${score}`);
  }

  const tier = score >= 80 ? '高' : score >= 60 ? '中' : '低';
  const tierWhy =
    score >= 80 ? '≥80 → 高' : score >= 60 ? '≥60 且 <80 → 中' : '<60 → 低（要到「中」至少 ≥60）';
  lines.push(
    `为何是 ${score} 而不是 60：加权实算约为 ${rawRounded}；「60」是「中」档门槛，不是四维加权目标分。档位：${score} →「${tier}」（${tierWhy}）。`
  );
  lines.push(
    '待复核触发（满足任一）：证据可信 < 60；或一致性 < 35；或（新鲜度 ≤40 且来源覆盖 <70）。'
  );

  return { score, calc_detail_lines: lines, caps_applied: caps, weighted_raw: raw, weighted_rounded: rawRounded };
}

function computeEvidenceConfidence(evidenceSources, breakdown) {
  return computeEvidenceConfidenceDetailed(evidenceSources, breakdown).score;
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

function explainNeedsReview(evidenceConfidence, breakdown) {
  const reasons = [];
  const n = Number(evidenceConfidence);
  const b = breakdown || {};
  if (Number.isFinite(n) && n < 60) reasons.push(`证据分 ${n} < 60`);
  if ((b.consistency_score || 0) < 35) reasons.push(`一致性 ${b.consistency_score} < 35`);
  if ((b.freshness_score || 0) <= 40 && (b.source_coverage_score || 0) < 70) {
    reasons.push(`新鲜度 ${b.freshness_score}≤40 且来源覆盖 ${b.source_coverage_score}<70`);
  }
  return reasons;
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
  const source = computeSourceCoverageScoreDetailed(evidenceSources);
  const freshness = computeFreshnessScoreDetailed(candidate);
  const consistency = computeConsistencyScoreDetailed(candidate);
  const judgment = computeJudgmentStrengthScoreDetailed(validation);

  const breakdownBase = {
    source_coverage_score: source.score,
    freshness_score: freshness.score,
    consistency_score: consistency.score,
    judgment_strength_score: judgment.score,
    freshness_months_ago: freshness.months_ago,
    evidence_sources: evidenceSources,
    weights: { ...EVIDENCE_WEIGHTS },
    /** 各维原始事实，便于前端精确展示 */
    source_detail: source.detail,
    freshness_detail: freshness.detail,
    consistency_detail: consistency.detail,
    judgment_detail: judgment.detail,
    /** 各维白话依据（跑批时落库，前端优先展示） */
    dimension_reasons: {
      source: source.reason,
      freshness: freshness.reason,
      consistency: consistency.reason,
      judgment: judgment.reason,
    },
    dimension_tiers: {
      source: source.tier,
      freshness: freshness.tier,
      consistency: consistency.tier,
      judgment: judgment.tier,
    },
  };

  const conf = computeEvidenceConfidenceDetailed(evidenceSources, breakdownBase);
  const needsReview = computeNeedsReview(conf.score, breakdownBase);
  const needsReviewReasons = explainNeedsReview(conf.score, breakdownBase);
  const calcLines = [...conf.calc_detail_lines];
  if (needsReview && needsReviewReasons.length) {
    calcLines.push(`本条已标待复核，因为：${needsReviewReasons.join('；')}。`);
  }

  const evidenceBreakdown = {
    ...breakdownBase,
    weighted_raw: conf.weighted_raw,
    weighted_rounded: conf.weighted_rounded,
    caps_applied: conf.caps_applied || [],
    calc_detail_lines: calcLines,
    needs_review_reasons: needsReviewReasons,
  };

  return {
    evidenceSources,
    evidenceConfidence: conf.score,
    needsReview,
    evidenceBreakdown,
  };
}

module.exports = {
  EVIDENCE_SOURCE_LABELS,
  EVIDENCE_WEIGHTS,
  buildEvidenceSources,
  computeSourceCoverageScore,
  computeSourceCoverageScoreDetailed,
  computeFreshnessScore,
  computeFreshnessScoreDetailed,
  computeConsistencyScore,
  computeConsistencyScoreDetailed,
  computeJudgmentStrengthScore,
  computeJudgmentStrengthScoreDetailed,
  computeEvidenceConfidence,
  computeEvidenceConfidenceDetailed,
  computeNeedsReview,
  explainNeedsReview,
  evidenceConfidenceLabel,
  normalizeEvidenceTier,
  scoreFromEvidenceTier,
  evidenceTierFromScore,
  EVIDENCE_TIER_SCORE,
  buildEvidenceMeta,
};
