import { Button, Checkbox, Space, Tag, Tooltip } from '@arco-design/web-react'

import { IntroPopoverCell } from './introPopoverAiCell'
import { formatFinancingDateTime } from './financingDateUtils'
import { isReviewPending } from './competitorRelationDisplayUtils'

const SOURCE_LABELS = { ipo_project: '底层', sourcing_financing_event: '融资', ai_web: '联网', user_added: '用户新增' }

export function evidenceConfidenceLabel(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 80) return '高'
  if (n >= 60) return '中'
  return '低'
}

/** 与后端 evidenceTierFromScore 一致，供复核表单默认值 */
export function evidenceTierFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return 'medium'
  if (n >= 80) return 'high'
  if (n >= 60) return 'medium'
  return 'low'
}

export const EVIDENCE_TIER_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

function parseEvidenceBreakdown(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

/** 证据可信 Tooltip：来源 / 新鲜度 / 一致性 / 判断强度 */
export function formatEvidenceBreakdownTooltip(record) {
  const bd =
    parseEvidenceBreakdown(record?.evidence_breakdown_json) ||
    parseEvidenceBreakdown(record?.score_breakdown_json?.evidence_breakdown)
  if (!bd) return null
  const months = bd.freshness_months_ago
  const freshnessHint =
    months == null ? '日期未知' : months <= 12 ? `${months} 月前` : `${months} 月前（可能滞后）`
  return [
    `来源覆盖：${bd.source_coverage_score ?? '—'}`,
    `数据新鲜度：${bd.freshness_score ?? '—'}（${freshnessHint}）`,
    `多源一致性：${bd.consistency_score ?? '—'}`,
    `判断强度：${bd.judgment_strength_score ?? '—'}`,
  ].join('\n')
}

/** 与后端 competitorEvidenceUtils.EVIDENCE_SOURCE_LABELS 对齐 */
const EVIDENCE_SOURCE_LABELS = {
  qcc: '企查查',
  internal_project: '底层项目',
  internal_listed: '上市主池',
  internal_financing: '融资事件',
  ai_web: '联网发现',
  user_added: '人工新增',
  llm_inference: '模型推断',
}

function formatEvidenceSourceList(sources) {
  if (!Array.isArray(sources) || !sources.length) return '无明确来源'
  return sources.map((s) => EVIDENCE_SOURCE_LABELS[s] || s).join('、')
}

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 来源覆盖：证据来源是否多元（底层/融资/上市/企查查/联网等） */
function sourceCoverageBasis(bd) {
  const sources = Array.isArray(bd.evidence_sources) ? bd.evidence_sources : []
  const label = formatEvidenceSourceList(sources)
  const score = numOrNull(bd.source_coverage_score)
  const external = sources.filter((s) => s !== 'llm_inference')
  const missing = []
  if (!sources.includes('internal_project')) missing.push('底层项目')
  if (!sources.includes('internal_financing')) missing.push('融资事件')
  if (!sources.includes('internal_listed')) missing.push('上市主池')
  if (!sources.includes('qcc')) missing.push('企查查简介')
  const lines = [
    '本维含义：衡量证据从哪来、是否多元。底层项目/融资事件/上市主池/企查查/联网都算来源；不是「有没有融资管理」这一题的是非题。',
    `当前计入来源：${label}（非推理源 ${external.length} 个）。`,
    '计分规则：人工新增 → 95；≥2 个非推理源 → 80；仅 1 个 → 55；仅模型推断 → 20。',
  ]
  if (score === 95 || sources.includes('user_added')) {
    lines.push('本次命中「人工新增」→ 固定 95。')
  } else if (score === 80 || external.length >= 2) {
    lines.push('本次命中「多源」→ 固定 80。')
  } else if (score === 55 || external.length === 1) {
    lines.push(
      `本次命中「单外部源」→ 固定 55。未到 80：还缺其它独立来源（当前缺少：${missing.join('、') || '更多外部源'}）。不是 0：已有真实外部证据，只是覆盖面窄。`
    )
  } else {
    lines.push('本次命中「弱来源」→ 固定 20。要提高需命中底层/融资/上市/企查查/联网等。')
  }
  return lines.join('\n')
}

/** 新鲜度：无日期给保底 40，不是 0 */
function freshnessBasis(bd) {
  const months = bd.freshness_months_ago
  const score = numOrNull(bd.freshness_score)
  if (months == null || !Number.isFinite(Number(months))) {
    return [
      '本维含义：看关联事件日期有多新。无日期时既不能证明很新，也不能证明已过时。',
      `本次无事件日期 → 固定保底 ${score ?? 40} 分（不是 0）。`,
      '为何不是 0：0 表示「已证实过旧/无效」；缺日期是信息缺失，用中性偏低保底，避免把「未知」当成「最差」。',
      '规则：≤12 月→100；≤24→80；≤36→60；更早或无日期→40。要提高需补可解析的事件日期。',
    ].join('\n')
  }
  const m = Math.round(Number(months))
  const lines = ['计分规则：≤12 月→100；≤24→80；≤36→60；更早→40。']
  if (m <= 12) lines.push(`事件约 ${m} 个月前 → 100。`)
  else if (m <= 24) lines.push(`事件约 ${m} 个月前 → 80。未取 100：已超过 12 个月。`)
  else if (m <= 36) lines.push(`事件约 ${m} 个月前 → 60。未取 80：已超过 24 个月。`)
  else lines.push(`事件约 ${m} 个月前 → 超过 36 个月 → ${score ?? 40}（保底，不是 0）。`)
  return lines.join('\n')
}

/** 一致性：产品介绍 vs 企查查简介交叉印证 */
function consistencyBasis(bd) {
  const detail = bd.consistency_detail
  const score = numOrNull(bd.consistency_score)
  const meaning =
    '本维含义：用「产品介绍」与「企查查公司简介」交叉核对是否互相印证。不是判断是不是竞品，只看两份文本是否对得上。'
  const rule =
    '规则：两侧都有文则按重叠计分（重叠很低→25）；仅一侧有文→固定 55（无法交叉验证）；两侧皆空→50。'
  if (detail?.mode === 'one_side' || score === 55) {
    return [
      meaning,
      `本次：只有一侧有文（产品 ${detail?.intro_len ?? '—'} 字 / 企查查 ${detail?.qcc_len ?? '—'} 字）→ 无法交叉核对 → 固定 55。`,
      '为何不是更高：没有第二份文本印证。为何不是 0：不是「两边打架」，只是信息不全。要提高：补全企查查简介。',
      rule,
    ].join('\n')
  }
  if (detail?.mode === 'both_empty' || score === 50) {
    return [meaning, '本次两侧皆空 → 固定 50。', rule].join('\n')
  }
  if (detail?.mode === 'both_low_overlap' || (Number.isFinite(score) && score <= 25)) {
    const pct = detail?.overlap != null ? (Number(detail.overlap) * 100).toFixed(1) : '—'
    return [meaning, `两侧都有文但重叠仅 ${pct}% → 25 分（印证弱）。`, rule].join('\n')
  }
  if (detail?.mode === 'both_overlap' || Number.isFinite(score)) {
    const pct = detail?.overlap != null ? Math.round(Number(detail.overlap) * 100) : '—'
    return [
      meaning,
      `两侧都有简介（产品 ${detail?.intro_len ?? '—'} 字 / 企查查 ${detail?.qcc_len ?? '—'} 字），重叠约 ${pct}% → ${score} 分。`,
      rule,
    ].join('\n')
  }
  return [meaning, '本次一致性未测算。', rule].join('\n')
}

/** 判断强度：优先 validated_score，否则三维均值，否则 50 */
function judgmentStrengthBasis(bd, scoreBreakdown) {
  const score = numOrNull(bd.judgment_strength_score)
  const validation = scoreBreakdown?.validation
  const validated = numOrNull(validation?.validated_score)
  const dims = scoreBreakdown?.dimension_scores || validation?.dimension_scores
  const lines = [
    '计分规则：优先 S5 validated_score；否则可替代性/客户重叠/场景重叠三维均值；再无则 50。',
  ]
  if (Number.isFinite(validated) && Number.isFinite(score) && Math.round(validated) === Math.round(score)) {
    lines.push(
      `本次取 S5 validated_score=${Math.round(validated)} → 判断强度 ${Math.round(score)}。这是模型对竞品对标强度的校验分，不是来源/新鲜度加权。`
    )
    if (dims && typeof dims === 'object') {
      lines.push(
        `参考三维：可替代性 ${dims.substitutability ?? '—'}，客户重叠 ${dims.customer_overlap ?? '—'}，场景重叠 ${dims.scenario_overlap ?? '—'}（已优先用 validated_score）。`
      )
    }
    return lines.join('\n')
  }
  if (dims && typeof dims === 'object') {
    const parts = ['substitutability', 'customer_overlap', 'scenario_overlap']
      .map((k) => numOrNull(dims[k]))
      .filter((n) => n != null)
    if (parts.length) {
      const avg = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
      lines.push(
        `本次改用三维均值：(${parts.join(' + ')}) / ${parts.length} ≈ ${avg} → 判断强度 ${score ?? avg}。`
      )
      return lines.join('\n')
    }
  }
  if (Number.isFinite(score)) {
    lines.push(`本次判断强度 ${score}（细节字段缺失时按已落库分展示）。`)
  } else {
    lines.push('本次未测算，按默认档 50。')
  }
  return lines.join('\n')
}

function resolveEvidenceBreakdown(record) {
  const fromEvidence = parseEvidenceBreakdown(record?.evidence_breakdown_json)
  if (fromEvidence) return fromEvidence
  const scoreBd = parseScoreBreakdown(record?.score_breakdown_json)
  return parseEvidenceBreakdown(scoreBd?.evidence_breakdown)
}

/**
 * 证据四维：分数 + 白话依据（前端按结构化字段重算，保证文案可读；不依赖旧版落库短句）
 */
export function formatEvidenceDimBasis(record) {
  const bd = resolveEvidenceBreakdown(record)
  if (!bd) return null
  const scoreBd = parseScoreBreakdown(record?.score_breakdown_json)
  return [
    {
      key: 'source',
      label: '来源覆盖',
      score: bd.source_coverage_score ?? null,
      basis: sourceCoverageBasis(bd),
    },
    {
      key: 'freshness',
      label: '新鲜度',
      score: bd.freshness_score ?? null,
      basis: freshnessBasis(bd),
    },
    {
      key: 'consistency',
      label: '一致性',
      score: bd.consistency_score ?? null,
      basis: consistencyBasis(bd),
    },
    {
      key: 'judgment',
      label: '判断强度',
      score: bd.judgment_strength_score ?? null,
      basis: judgmentStrengthBasis(bd, scoreBd),
    },
  ]
}

/** 证据加权实算（优先用落库 calc_detail_lines） */
export function formatEvidenceCalcDetail(record) {
  const bd = resolveEvidenceBreakdown(record)
  if (!bd) return null
  if (Array.isArray(bd.calc_detail_lines) && bd.calc_detail_lines.length) {
    return bd.calc_detail_lines
  }
  const w = bd.weights || { source: 0.35, freshness: 0.3, consistency: 0.25, judgment: 0.1 }
  const src = numOrNull(bd.source_coverage_score) ?? 0
  const fresh = numOrNull(bd.freshness_score) ?? 0
  const cons = numOrNull(bd.consistency_score) ?? 0
  const judg = numOrNull(bd.judgment_strength_score) ?? 0
  const ws = w.source ?? 0.35
  const wf = w.freshness ?? 0.3
  const wc = w.consistency ?? 0.25
  const wj = w.judgment ?? 0.1
  const raw = src * ws + fresh * wf + cons * wc + judg * wj
  const rawRounded = Math.round(raw)
  const sources = Array.isArray(bd.evidence_sources) ? bd.evidence_sources : []
  const externalCount = sources.filter((s) => s !== 'llm_inference').length
  const onlyLlm = sources.length === 1 && sources[0] === 'llm_inference'

  const caps = []
  let afterCap = rawRounded
  if (onlyLlm) {
    afterCap = 30
    caps.push('仅「模型推断」一源 → 证据分固定 30（覆盖加权结果）')
  } else {
    if (externalCount >= 2 && cons < 35) {
      afterCap = Math.min(afterCap, 55)
      caps.push(`多源（${externalCount}）且一致性 ${cons} < 35 → 封顶 ≤55`)
    }
    if (fresh <= 40) {
      afterCap = Math.min(afterCap, 70)
      caps.push(`新鲜度 ${fresh} ≤ 40 → 封顶 ≤70`)
    }
    const clamped = Math.max(20, Math.min(95, afterCap))
    if (clamped !== afterCap) {
      caps.push(`夹紧到 [20, 95]：${afterCap} → ${clamped}`)
      afterCap = clamped
    }
  }

  const finalScore = numOrNull(record?.evidence_confidence) ?? afterCap
  const tier = finalScore >= 80 ? '高' : finalScore >= 60 ? '中' : '低'
  const tierWhy =
    finalScore >= 80
      ? '≥80 → 高'
      : finalScore >= 60
        ? '≥60 且 <80 → 中'
        : '<60 → 低（要到「中」至少需要证据分 ≥60）'

  const lines = [
    `加权公式：来源×${Math.round(ws * 100)}% + 新鲜度×${Math.round(wf * 100)}% + 一致性×${Math.round(wc * 100)}% + 判断强度×${Math.round(wj * 100)}%`,
    `代入本条：${src}×${ws} + ${fresh}×${wf} + ${cons}×${wc} + ${judg}×${wj} = ${raw.toFixed(2)} → 四舍五入 ${rawRounded}`,
  ]
  if (caps.length) {
    lines.push(`封顶/夹紧：${caps.join('；')} → 得到 ${afterCap}；系统证据分（落库） ${finalScore}`)
  } else {
    lines.push(`本条未触发额外封顶（或仅落在 20–95 内）→ 系统证据分 ${finalScore}`)
  }
  lines.push(
    `为何是 ${finalScore} 而不是 60：加权实算约为 ${rawRounded}；「60」是「中」档门槛，不是四维加权的目标分。档位：${finalScore} →「${tier}」（${tierWhy}）。`
  )
  lines.push(
    '待复核触发（满足任一）：证据可信 < 60；或一致性 < 35；或（新鲜度 ≤40 且来源覆盖 <70）。'
  )
  if (Number(record?.needs_review) === 1) {
    const reasons = Array.isArray(bd.needs_review_reasons) ? bd.needs_review_reasons : []
    if (reasons.length) {
      lines.push(`本条已标待复核，因为：${reasons.join('；')}。`)
    } else {
      const inferred = []
      if (finalScore < 60) inferred.push(`证据分 ${finalScore} < 60`)
      if (cons < 35) inferred.push(`一致性 ${cons} < 35`)
      if (fresh <= 40 && src < 70) inferred.push(`新鲜度 ${fresh}≤40 且来源覆盖 ${src}<70`)
      if (inferred.length) lines.push(`本条已标待复核，因为：${inferred.join('；')}。`)
    }
  }
  return lines
}

function parseScoreBreakdown(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

const SCORE_MODE_META = {
  ai_only: {
    short: '综合分 = AI 对标分（本路径不按内部分加权）',
    when: '无内部源，或内部 peer 轨道且 AI 足够高并通过 S5',
  },
  'internal_0.2_ai_0.8': {
    short: '综合分 = 内部×0.2 + AI×0.8',
    when: '有内部源，且 AI 对标分 ≥ 80（LLM 高信任）',
  },
  'internal_0.25_ai_0.75': {
    short: '综合分 = 内部×0.25 + AI×0.75',
    when: '专业赛道内部池 peer，且 AI≥68',
  },
  'internal_0.6_ai_0.4': {
    short: '综合分 = 内部×0.6 + AI×0.4',
    when: '有内部源，且未走高信任/peer 特例',
  },
}

/** 综合分 → 等级（与后端 competitorMatchUtils.scoreToGrade 一致） */
export function scoreToConfidenceGrade(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 90) return 'S'
  if (n >= 80) return 'A'
  if (n >= 70) return 'B'
  if (n >= 60) return 'C'
  return null
}

export const GRADE_SCORE_RELATION_HINT =
  '等级门槛：S≥90，A≥80，B≥70，C≥60；低于 60 分不标等级'

function explainGrade(score, grade) {
  const n = numOrNull(score)
  const g = grade || scoreToConfidenceGrade(n)
  if (!Number.isFinite(n)) return '暂无综合分，无法解释等级。'
  if (!g) {
    return `综合分 ${n} < 60 → 不标等级。要到 C 至少 ≥60，要到 A 至少 ≥80。`
  }
  const floors = { S: 90, A: 80, B: 70, C: 60 }
  const next = { C: ['B', 70], B: ['A', 80], A: ['S', 90], S: null }
  const floor = floors[g]
  let text = `综合分 ${n} ≥ ${floor} → 等级 ${g}。`
  const up = next[g]
  if (up) {
    text += `未到 ${up[0]}：需要 ≥${up[1]}（还差 ${Math.max(0, up[1] - n)} 分）。`
  } else {
    text += '已是最高档 S。'
  }
  return text
}

/**
 * 匹配综合得分依据（按结构化字段重算，突出「高分来自哪」）
 */
export function formatMatchScoreBasis(record) {
  const bd = parseScoreBreakdown(record?.score_breakdown_json)
  if (!bd && record?.relevance_score == null) return null

  const finalScore = numOrNull(bd?.final_score ?? record?.relevance_score)
  const internal = numOrNull(bd?.internal_score)
  const ai = numOrNull(bd?.ai_score)
  const llm = numOrNull(bd?.llm_product_score)
  const mode = bd?.score_mode
  const meta = SCORE_MODE_META[mode]
  const grade = record?.confidence_grade || scoreToConfidenceGrade(finalScore)
  const dims = bd?.dimension_scores || bd?.validation?.dimension_scores || null
  const productScore = bd?.product_score ?? null
  const tagScore = bd?.tag_score ?? null

  const pathLines = []
  if (meta) {
    pathLines.push(`计分路径：${meta.short}`)
    pathLines.push(`触发条件：${meta.when}。`)
  } else if (bd) {
    pathLines.push('计分路径：由内部规则分与 AI 对标分按落库 score_mode 加权。')
  } else {
    pathLines.push('计分路径：综合分为竞品匹配最终判定分。')
  }

  if (mode === 'ai_only' || (!mode && Number.isFinite(ai) && (!Number.isFinite(internal) || internal === 0))) {
    pathLines.push(`实算：综合分 = AI 对标分 ${ai ?? finalScore} → ${finalScore ?? ai}。`)
    pathLines.push(
      `【为何能到 ${finalScore ?? ai}】本条综合分几乎完全来自 AI/S5 对标强度，不是证据可信四维，也不是产品规则分。`
    )
    if (dims) {
      pathLines.push(
        `高分主因（S5 三维）：可替代性 ${dims.substitutability ?? '—'}，客户重叠 ${dims.customer_overlap ?? '—'}，场景重叠 ${dims.scenario_overlap ?? '—'} → 合成约 ${ai ?? finalScore}。`
      )
    }
    if (productScore != null || tagScore != null) {
      pathLines.push(
        `未计入综合分：产品规则分 ${productScore ?? '—'}、标签分 ${tagScore ?? '—'}（本路径不参与加权）。`
      )
    }
    if (Number.isFinite(internal) && internal > 0) {
      pathLines.push(`内部规则分 ${internal} 仅参考，本路径不计入。`)
    }
    pathLines.push('左侧系统证据分只影响证据可信/待复核，不会把综合分拉低或抬高。')
  } else if (mode === 'internal_0.2_ai_0.8' && Number.isFinite(internal) && Number.isFinite(ai)) {
    const calc = internal * 0.2 + ai * 0.8
    pathLines.push(`实算：${internal}×0.2 + ${ai}×0.8 = ${calc.toFixed(2)} → ${Math.round(calc)}。`)
    pathLines.push(
      `【分数构成】内部约 ${(internal * 0.2).toFixed(1)} 分 + AI 约 ${(ai * 0.8).toFixed(1)} 分；高分主要来自 AI 侧。`
    )
    if (dims) {
      pathLines.push(
        `AI 三维：可替代性 ${dims.substitutability ?? '—'}，客户重叠 ${dims.customer_overlap ?? '—'}，场景重叠 ${dims.scenario_overlap ?? '—'}。`
      )
    }
  } else if (mode === 'internal_0.25_ai_0.75' && Number.isFinite(internal) && Number.isFinite(ai)) {
    const calc = internal * 0.25 + ai * 0.75
    pathLines.push(`实算：${internal}×0.25 + ${ai}×0.75 = ${calc.toFixed(2)} → ${Math.round(calc)}。`)
  } else if (mode === 'internal_0.6_ai_0.4' && Number.isFinite(internal) && Number.isFinite(ai)) {
    const calc = internal * 0.6 + ai * 0.4
    pathLines.push(`实算：${internal}×0.6 + ${ai}×0.4 = ${calc.toFixed(2)} → ${Math.round(calc)}。`)
    pathLines.push(
      `【分数构成】内部约 ${(internal * 0.6).toFixed(1)} 分 + AI 约 ${(ai * 0.4).toFixed(1)} 分。`
    )
  } else if (Number.isFinite(finalScore)) {
    pathLines.push(`落库综合分 ${finalScore}。`)
  }

  pathLines.push(explainGrade(finalScore, grade))
  pathLines.push('说明：匹配综合分 ≠ 证据可信四维；也 ≠ 人工认定的证据可信度。')

  return {
    pathText: meta?.short || pathLines[0] || '综合分为竞品匹配最终判定分',
    pathLines,
    scoreMode: mode || null,
    internalScore: internal,
    aiScore: ai,
    llmProductScore: llm,
    productScore,
    tagScore,
    dimensionScores: dims,
    gradeHint: GRADE_SCORE_RELATION_HINT,
    gradeExplain: explainGrade(finalScore, grade),
  }
}

/** 竞品明细：长文本列（除竞品名称外）左对齐；竞品名称表头居中、内容左对齐由 cr-rel-col-name 控制 */
const LEFT_ALIGN_FIELDS = new Set([
  'competitor_product_intro',
  'competitor_tags_display',
])

/** 各列 width 之和，供 Table scroll.x 使用 */
export function sumCompetitorRelationColumnWidths(columns) {
  return (columns || []).reduce((sum, col) => sum + (Number(col.width) || 0), 0)
}

/** 嵌入主表展开行：去掉 fixed 列；操作/可比列宽锁定，其余按容器等比收窄 */
export function adaptCompetitorRelationColumnsForEmbedded(columns, containerWidth) {
  const base = (columns || []).map(({ fixed: _fixed, ...col }) => ({ ...col }))

  const isLockedCol = (col) =>
    col.dataIndex === 'include_in_comparable' || (col.title === '操作' && !col.dataIndex)

  const lockedWidth = (col) => {
    if (col.dataIndex === 'include_in_comparable') return CR_REL_COL_WIDTH.comparable.col
    if (col.title === '操作' && !col.dataIndex) return CR_REL_COL_WIDTH.action.col
    return Number(col.width) || 80
  }

  const withLocked = base.map((col) => (isLockedCol(col) ? { ...col, width: lockedWidth(col) } : col))

  if (!containerWidth || containerWidth <= 0) return withLocked

  const lockedTotal = withLocked.filter(isLockedCol).reduce((s, c) => s + lockedWidth(c), 0)
  const scalable = withLocked.filter((c) => !isLockedCol(c))
  const scalableTotal = sumCompetitorRelationColumnWidths(scalable)
  const budget = containerWidth - lockedTotal

  if (scalableTotal <= budget) return withLocked

  const scale = budget / scalableTotal
  return withLocked.map((col) => {
    if (isLockedCol(col)) return { ...col, width: lockedWidth(col) }
    const baseW = Number(col.width) || 80
    const minW = col.dataIndex === 'competitor_display_name' ? 118 : 32
    return { ...col, width: Math.max(minW, Math.floor(baseW * scale)) }
  })
}

export const COMPETITOR_TYPE_META = {
  direct: { label: '直接竞品', color: 'red' },
  indirect: { label: '间接竞品', color: 'orangered' },
  substitute: { label: '替代品', color: 'gold' },
  same_track: { label: '同赛道', color: 'arcoblue' },
  upstream_downstream: { label: '上下游', color: 'purple' },
  not_competitor: { label: '非竞品', color: 'gray' },
}

/** 默认列表是否展示该行：仅用户勾选「可比公司」后显示；同赛道默认隐藏（可点「显示全部」） */
export function isDefaultComparableVisible(row) {
  const type = String(row?.competitor_type || '').trim().toLowerCase()
  if (type === 'same_track') return false
  return Number(row?.include_in_comparable) === 1
}

/** 列表排序：已纳入可比公司置顶，组内按综合分降序；其余按综合分降序 */
export function sortRelationsForDisplay(list) {
  return [...(list || [])].sort((a, b) => {
    const ca = Number(a.include_in_comparable) === 1 ? 1 : 0
    const cb = Number(b.include_in_comparable) === 1 ? 1 : 0
    if (cb !== ca) return cb - ca
    const sa = Number(a.relevance_score) || 0
    const sb = Number(b.relevance_score) || 0
    if (sb !== sa) return sb - sa
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
}

function renderCompetitorTypeTag(type) {
  const key = String(type || '').trim().toLowerCase()
  const meta = COMPETITOR_TYPE_META[key]
  if (!meta) return '-'
  return (
    <Tag color={meta.color} size="small">
      {meta.label}
    </Tag>
  )
}

/** 长文本 Popover 触发区最大宽度（px），与列宽 - 左右 padding 对齐 */
export const CR_REL_COL_WIDTH = {
  name: { col: 132 },
  product: { col: 120, inner: 96 },
  tags: { col: 120, inner: 96 },
  credit: { col: 106 },
  financing: { col: 68, inner: 52 },
  comparable: { col: 50 },
  action: { col: 132 },
}

/** 竞品明细独立样式前缀（cr-rel-*），避免通用表格样式干扰 */
export const CR_REL_CSS = {
  scope: 'cr-rel-scope',
  scopeEmbedded: 'cr-rel-scope--embedded',
  table: 'cr-rel-table',
  colProduct: 'cr-rel-col-product',
  colTags: 'cr-rel-col-tags',
  colName: 'cr-rel-col-name',
  colComparable: 'cr-rel-col-comparable',
  colFinancing: 'cr-rel-col-financing',
  colCredit: 'cr-rel-col-credit',
  colActions: 'cr-rel-col-actions',
  actionCell: 'cr-rel-action-cell',
  cellMono: 'cr-rel-cell-mono',
  nameText: 'cr-rel-name-text',
  createdAt: 'cr-rel-created-at',
  introCell: 'cr-rel-intro-cell',
  sourceText: 'cr-rel-source-text',
  colNumeric: 'cr-rel-col-numeric',
  rowComparable: 'cr-rel-row-comparable',
}

function renderMonoEllipsis(raw, empty = '-') {
  const text = raw || empty
  if (text === empty) {
    return <span>{empty}</span>
  }
  return (
    <Tooltip content={text}>
      <span className={CR_REL_CSS.cellMono} translate="no" tabIndex={0}>
        {text}
      </span>
    </Tooltip>
  )
}

function renderCreatedAtTwoLines(value) {
  const formatted = formatFinancingDateTime(value)
  if (formatted === '-') return '-'
  const [datePart, timePart] = formatted.split(' ')
  if (!timePart) return formatted
  return (
    <div className={CR_REL_CSS.createdAt}>
      <div>{datePart}</div>
      <div>{timePart}</div>
    </div>
  )
}



export function formatCompetitorDataSources(v) {

  if (!v) return '-'

  try {

    const arr = typeof v === 'string' ? JSON.parse(v) : v

    if (Array.isArray(arr)) {

      return arr.map((x) => SOURCE_LABELS[x] || x).join('、') || '-'

    }

  } catch {

    /* ignore */

  }

  return '-'

}



/**

 * @param {object} [opts]

 * @param {(record: object) => void} [opts.onReview]

 * @param {string|null} [opts.comparableSavingId]
 * @param {boolean} [opts.comparableReadOnly]
 * @param {(record: object) => void} [opts.onEdit]
 * @param {(record: object) => void} [opts.onDelete]
 * @param {boolean} [opts.actionReadOnly]
 */
export function getCompetitorRelationColumns(opts = {}) {
  const {
    onComparableToggle,
    comparableSavingId,
    comparableReadOnly,
    onEdit,
    onDelete,
    onReview,
    actionReadOnly,
  } = opts

  return [

    {
      title: '竞品名称',
      dataIndex: 'competitor_display_name',
      width: CR_REL_COL_WIDTH.name.col,
      className: CR_REL_CSS.colName,
      ellipsis: false,
      render: (t) => <div className={CR_REL_CSS.nameText}>{t || '-'}</div>,
    },

    {
      title: '信用代码',
      dataIndex: 'unified_credit_code',
      width: CR_REL_COL_WIDTH.credit.col,
      className: CR_REL_CSS.colCredit,
      render: (t) => renderMonoEllipsis(t),
    },

    {
      title: '上市',
      dataIndex: 'is_listed',
      width: 52,
      render: (v) => (Number(v) === 1 ? '是' : '否'),
    },

    { title: '等级', dataIndex: 'confidence_grade', width: 52, render: (t) => t || '-' },

    {
      title: '竞品类型',
      dataIndex: 'competitor_type',
      width: 80,
      render: (t) => renderCompetitorTypeTag(t),
    },

    { title: '综合分', dataIndex: 'relevance_score', width: 64, className: CR_REL_CSS.colNumeric, render: (v) => (v == null ? '-' : String(v)) },

    {
      title: '判断依据',
      dataIndex: 'evidence_summary',
      width: 100,
      render: (t) => (
        <div className={CR_REL_CSS.introCell}>
          <IntroPopoverCell columnTitle="判断依据" raw={t} triggerMaxWidth={96} />
        </div>
      ),
    },

    {

      title: '产品介绍',

      dataIndex: 'competitor_product_intro',

      width: CR_REL_COL_WIDTH.product.col,

      className: CR_REL_CSS.colProduct,

      render: (t) => (
        <div className={CR_REL_CSS.introCell}>
          <IntroPopoverCell
            columnTitle="产品介绍"
            raw={t}
            triggerMaxWidth={CR_REL_COL_WIDTH.product.inner}
          />
        </div>
      ),

    },

    {

      title: '企业标签',

      dataIndex: 'competitor_tags_display',

      width: CR_REL_COL_WIDTH.tags.col,

      className: CR_REL_CSS.colTags,

      render: (t) => (
        <div className={CR_REL_CSS.introCell}>
          <IntroPopoverCell
            columnTitle="企业标签"
            raw={t}
            triggerMaxWidth={CR_REL_COL_WIDTH.tags.inner}
          />
        </div>
      ),

    },

    {
      title: '子基金名称',
      dataIndex: 'sub_fund_names',
      width: 88,
      ellipsis: true,
      render: (t) => t || '-',
    },

    {
      title: '数据源',
      dataIndex: 'data_sources_json',
      width: 60,
      render: (v) => {
        const text = formatCompetitorDataSources(v)
        if (text === '-') return '-'
        return (
          <Tooltip content={text}>
            <span className={CR_REL_CSS.sourceText} tabIndex={0}>
              {text}
            </span>
          </Tooltip>
        )
      },
    },

    {
      title: '证据可信',
      dataIndex: 'evidence_confidence',
      width: 108,
      ellipsis: false,
      render: (v, record) => {
        const label = evidenceConfidenceLabel(v)
        if (!label) return '-'
        const needsReview = Number(record?.needs_review) === 1 || isReviewPending(record)
        const tip = formatEvidenceBreakdownTooltip(record)
        const body = (
          <Space size={4} wrap={false} style={{ whiteSpace: 'nowrap' }}>
            <Tag size="small" color={label === '高' ? 'green' : label === '中' ? 'arcoblue' : 'orangered'}>
              {label}
            </Tag>
            {needsReview ? (
              onReview ? (
                <Tag
                  size="small"
                  color="red"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReview(record)
                  }}
                >
                  待复核
                </Tag>
              ) : (
                <Tag size="small" color="red">
                  待复核
                </Tag>
              )
            ) : null}
            {record.review_status === 'confirmed' || record.review_status === 'corrected' ? (
              <Tag size="small" color="green">
                已确认
              </Tag>
            ) : null}
          </Space>
        )
        if (!tip) return body
        return (
          <Tooltip content={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tip}</pre>}>
            <span tabIndex={0}>{body}</span>
          </Tooltip>
        )
      },
    },

    {

      title: '融资',

      dataIndex: 'financing_history_text',

      width: CR_REL_COL_WIDTH.financing.col,

      className: CR_REL_CSS.colFinancing,

      render: (t, record) => {

        const text = t || record.financing_amount_text

        return (
          <div className={CR_REL_CSS.introCell}>
            <IntroPopoverCell
              columnTitle="融资"
              raw={text}
              triggerMaxWidth={CR_REL_COL_WIDTH.financing.inner}
            />
          </div>
        )

      },

    },

    {

      title: '创建时间',

      dataIndex: 'created_at',

      width: 80,

      render: (t) => renderCreatedAtTwoLines(t),

    },

    {

      title: '可比公司',

      dataIndex: 'include_in_comparable',

      width: CR_REL_COL_WIDTH.comparable.col,
      align: 'center',
      className: CR_REL_CSS.colComparable,

      render: (v, record) => (

        <Checkbox
          aria-label={`${record.competitor_display_name || '竞品'}可比公司`}
          checked={Number(v) === 1}
          disabled={comparableReadOnly || comparableSavingId === record.id}
          onChange={(checked) => onComparableToggle?.(record, checked)}
        />

      ),

    },

    {
      title: '操作',
      width: CR_REL_COL_WIDTH.action.col,
      className: CR_REL_CSS.colActions,
      render: (_, record) => {
        if (actionReadOnly) {
          return (
            <div className={CR_REL_CSS.actionCell}>
              {onReview ? (
                <Button type="outline" size="small" onClick={() => onReview(record, { readOnly: true })}>
                  查看
                </Button>
              ) : (
                '-'
              )}
            </div>
          )
        }
        const pending = isReviewPending(record)
        return (
          <div className={CR_REL_CSS.actionCell}>
            {onReview ? (
              <Button
                type={pending ? 'primary' : 'outline'}
                size="small"
                onClick={() => onReview(record)}
              >
                复核
              </Button>
            ) : null}
            {onEdit ? (
              <Button type="outline" size="small" onClick={() => onEdit(record)}>
                编辑
              </Button>
            ) : null}
            {onDelete ? (
              <Button type="outline" size="small" status="danger" onClick={() => onDelete(record)}>
                删除
              </Button>
            ) : null}
          </div>
        )
      },
    },

  ].map((col) => {
    if (LEFT_ALIGN_FIELDS.has(col.dataIndex)) {
      return { ...col, align: 'left' }
    }
    return col
  })

}

/** 默认列宽之和（与主表 scroll 宽度对齐，避免展开区出现横向滚动条） */
export const COMPETITOR_RELATION_TABLE_SCROLL_X = sumCompetitorRelationColumnWidths(
  getCompetitorRelationColumns()
)



export function downloadBlob(blob, filename) {

  const url = window.URL.createObjectURL(blob)

  const a = document.createElement('a')

  a.href = url

  a.download = filename

  document.body.appendChild(a)

  a.click()

  a.remove()

  window.URL.revokeObjectURL(url)

}



export function parseExportFilename(contentDisposition, fallback) {

  if (!contentDisposition) return fallback

  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(contentDisposition)

  const raw = m?.[1] || m?.[2]

  if (!raw) return fallback

  try {

    return decodeURIComponent(raw)

  } catch {

    return raw

  }

}


