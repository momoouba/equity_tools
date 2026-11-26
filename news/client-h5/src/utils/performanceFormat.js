/** 业绩看板 H5 展示格式（与 PC 金额/比率口径对齐） */

export function toNum(val) {
  if (val == null || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

/** 金额转亿元，保留 2 位 */
export function formatAmountYi(val) {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return (n / 100000000).toFixed(2)
}

/** 金额（元）千分位，保留 2 位 */
export function formatAmountYuan(val) {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatNumber(val) {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return Math.round(n).toLocaleString()
}

export function formatRatio(val) {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return `${n.toFixed(2)}x`
}

export function formatPercent(val) {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return `${(n * 100).toFixed(2)}%`
}

export function formatSignedYi(change) {
  const n = toNum(change)
  if (n === null || n === 0) return '-'
  const body = formatAmountYi(Math.abs(n))
  if (body === '-' || body === '/') return '-'
  return `${n > 0 ? '+' : '-'}${body}`
}

export function formatDateOnly(v) {
  if (v == null || v === '') return '-'
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  return s
}
