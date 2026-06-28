export const LISTING_NUM_COL_CLASS = 'listing-num-col'

/** 数字列：表头居中、内容右对齐 */
export function buildListingNumericColumn(title, dataIndex, width, render) {
  return {
    title,
    dataIndex,
    key: dataIndex,
    width,
    className: LISTING_NUM_COL_CLASS,
    align: 'right',
    headerCellClassName: LISTING_NUM_COL_CLASS,
    bodyCellClassName: LISTING_NUM_COL_CLASS,
    headerCellStyle: { textAlign: 'center' },
    bodyCellStyle: { textAlign: 'right' },
    render,
  }
}

export function sumColumnWidths(columns) {
  return columns.reduce((sum, col) => sum + (Number(col.width) || 0), 0)
}

export function formatListingAmount(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n)
    ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '-'
}

/** 金额以亿元展示（库内已存亿元，保留 2 位小数） */
export function formatListingYi(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)}亿` : '-'
}

/** 首日市值：库内为元，列表以亿元展示 */
export function formatMarketCapYiFromYuan(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${(n / 1e8).toFixed(2)}亿` : '-'
}

/** 总发行数量：库内 issue_total_wan 为万股，缺失时由 total_issued_shares（股）换算 */
export function formatIssueTotalWanDisplay(issueTotalWan, totalIssuedShares) {
  const wan = Number(issueTotalWan)
  if (Number.isFinite(wan) && wan > 0) {
    return wan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const shares = Number(totalIssuedShares)
  if (Number.isFinite(shares) && shares > 0) {
    const derived = shares / 10000
    return derived.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return '-'
}

export function formatListingPercent(value, scale100 = false) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const pct = scale100 ? n * 100 : n
  return `${pct.toFixed(2)}%`
}
