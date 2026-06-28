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

export function formatListingPercent(value, scale100 = false) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const pct = scale100 ? n * 100 : n
  return `${pct.toFixed(2)}%`
}
