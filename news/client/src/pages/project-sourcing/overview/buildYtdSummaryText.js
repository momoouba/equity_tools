/** 今年市场速览：规则模板（非 AI） */

/** 整数千分位（zh-CN） */
export function formatInt(n) {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return Math.round(v).toLocaleString('zh-CN')
}

function formatPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return null
  const v = Number(n)
  const abs = Math.abs(v)
  const s = abs % 1 === 0 ? String(abs) : abs.toFixed(1)
  return s
}

function isBlankName(name) {
  const n = String(name || '').trim()
  return !n || n === '[]' || n === '{}' || n === '-' || n === '—'
}

/**
 * @param {object|null|undefined} facts ytd_summary_facts
 * @returns {string}
 */
export function buildYtdSummaryText(facts) {
  if (!facts) return '暂无今年融资数据。'
  const lines = []
  const mm = facts.as_of_month
  const dd = facts.as_of_day
  const n = Number(facts.event_count || 0)
  const n0 = Number(facts.base_count || 0)
  const yoy = facts.yoy_pct

  if (facts.year_outside_window) {
    lines.push('（说明：今年不在当前筛选年份内，以下仍按自然年今年至今统计。）')
  }

  let line1 = `截至 ${mm}月${dd}日，今年共发生融资事件 ${formatInt(n)} 起`
  if (yoy == null || !Number.isFinite(Number(yoy))) {
    line1 += n0 <= 0 ? '（去年同期无事件，同比暂缺）。' : '。'
  } else {
    const abs = formatPct(yoy)
    let dir = '持平'
    if (Number(yoy) > 0) dir = '上升'
    else if (Number(yoy) < 0) dir = '下降'
    if (dir === '持平') line1 += `，较去年同期持平（去年同期 ${formatInt(n0)} 起）。`
    else line1 += `，较去年同期${dir} ${abs}%（去年同期 ${formatInt(n0)} 起）。`
  }
  lines.push(line1)

  const tracks = Array.isArray(facts.top_tracks) ? facts.top_tracks : []
  if (tracks.length) {
    const part = tracks
      .slice(0, 3)
      .map((t) => `${t.name}（${formatInt(t.count)}）`)
      .join('、')
    lines.push(`事件数居前的主赛道为：${part}。`)
  }

  const invs = (Array.isArray(facts.top_investors) ? facts.top_investors : []).filter(
    (t) => !isBlankName(t?.name)
  )
  if (invs.length) {
    const part = invs
      .slice(0, 3)
      .map((t) => `${t.name}（${formatInt(t.count)} 起）`)
      .join('、')
    lines.push(`参投最活跃的机构为：${part}。`)
  }

  const rb = facts.top_round_bucket
  if (rb && rb.name && n > 0) {
    lines.push(
      `轮次结构上，占比最高为「${rb.name}」（${rb.pct}%），早期（种子/天使+Pre-A/A）合计占比 ${facts.early_stage_pct ?? 0}%。`
    )
  }

  const up = Number(facts.untracked_pct || 0)
  let untrackedLine = `赛道未分类 ${up}%。`
  if (up >= 30) {
    untrackedLine += '建议检查赛道配置与匹配任务。'
  }
  if (n > 0) lines.push(untrackedLine)

  return lines.join('\n')
}

export function defaultYearRange() {
  const y = new Date().getFullYear()
  return { yearFrom: y - 4, yearTo: y }
}

/**
 * 构建融资事件列表下钻 URL query
 */
export function buildFinancingEventsDrillQuery(opts) {
  const q = new URLSearchParams()
  if (opts.date_from) q.set('date_from', opts.date_from)
  if (opts.date_to) q.set('date_to', opts.date_to)
  if (opts.track_primary) q.set('track_primary', opts.track_primary)
  if (opts.track_secondary) q.set('track_secondary', opts.track_secondary)
  if (opts.investor_keyword) q.set('investor_keyword', opts.investor_keyword)
  if (opts.round_bucket) q.set('round_bucket', opts.round_bucket)
  if (opts.track_empty) q.set('track_empty', '1')
  return q.toString()
}
