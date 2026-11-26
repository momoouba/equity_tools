export function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n)
    ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}

export function formatYi(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}亿` : '—'
}

export function formatMarketCapYiFromYuan(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${(n / 1e8).toFixed(2)}亿` : '—'
}

export function formatIssueTotalWan(issueTotalWan, totalIssuedShares) {
  const wan = Number(issueTotalWan)
  if (Number.isFinite(wan) && wan > 0) {
    return wan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const shares = Number(totalIssuedShares)
  if (Number.isFinite(shares) && shares > 0) {
    return (shares / 10000).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
  return '—'
}

export function formatPercent(value, scale100 = false) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const pct = scale100 ? n * 100 : n
  return `${pct.toFixed(2)}%`
}

export function matchSourceLabel(row) {
  const v = Number(row?.matched_progress_valid)
  if (v === 2) return '打新日历'
  if (v === 1) return '有效'
  if (Number(row?.matched_progress_deleted) === 1) return '源行已失效'
  return '无关联源行'
}

export function resolveProgressId(row) {
  if (!row) return ''
  return String(row.f_id ?? row.F_Id ?? row.id ?? '')
}

export function displayEnterpriseName(row) {
  return (
    row?.enterprise_full_name_display ||
    row?.enterprise_full_name_cn ||
    row?.enterprise_full_name_en ||
    '—'
  )
}
