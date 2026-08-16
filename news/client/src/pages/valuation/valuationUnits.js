/** 与服务端 constants.YUAN_PER_WAN 对齐：界面与草稿用万元，引擎再换成元 */
import { BS_INPUT_KEYS } from './valuationBsFields'

export const YUAN_PER_WAN = 10000

export function yuanToWan(v) {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n / YUAN_PER_WAN : undefined
}

export function wanToYuan(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n * YUAN_PER_WAN : null
}

function coerceNumberToWan(v) {
  if (v == null || v === '') return v
  let n = Number(v)
  if (!Number.isFinite(n)) return v
  if (n === 0) return 0
  while (n >= 1e12) n /= YUAN_PER_WAN
  if (n >= 1e7) n /= YUAN_PER_WAN
  return n
}

function mapToWan(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj || {}
  const out = { ...obj }
  for (const k of keys) {
    if (Array.isArray(out[k])) out[k] = out[k].map(coerceNumberToWan)
    else if (out[k] != null && out[k] !== '') out[k] = coerceNumberToWan(out[k])
  }
  return out
}

/** 旧草稿按元存储；纠正「元数字填进万元框」后的多余 0，统一成万元。 */
export function coercePayloadToWan(payload) {
  if (!payload || payload.amount_unit === 'wan') return payload
  const assumptions = { ...(payload.assumptions || {}) }
  if (assumptions.esop != null && assumptions.esop !== '') {
    assumptions.esop = coerceNumberToWan(assumptions.esop)
  }
  return {
    ...payload,
    amount_unit: 'wan',
    assumptions,
    targetPl: mapToWan(payload.targetPl || {}, ['revenue', 'cogs', 'selling', 'admin', 'rd', 'operating_profit', 'net_income']),
    targetBs: mapToWan(payload.targetBs || {}, BS_INPUT_KEYS),
    targetCf: mapToWan(payload.targetCf || {}, ['da', 'capex', 'dnwc']),
    overrides: mapToWan(payload.overrides || {}, ['da', 'capex', 'dnwc', 'net_debt']),
  }
}

export function fmtNum(v, digits = 2) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(v, digits = 2) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  return Number.isFinite(n)
    ? `${(n * 100).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
    : '-'
}

/** 列表金额显示：万元保留 2 位小数，千分位 */
export const WAN_DECIMALS = 2

export function roundWanToFen(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Number(n.toFixed(WAN_DECIMALS))
}

export function fmtAmountWan(v, digits = WAN_DECIMALS) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function wanNumberFromYuan(yuan, digits = WAN_DECIMALS) {
  const w = yuanToWan(yuan)
  if (w == null) return null
  return Number(w.toFixed(digits))
}

export function fmtWanPlain(yuan, digits = WAN_DECIMALS) {
  const w = wanNumberFromYuan(yuan, digits)
  return w == null ? '-' : fmtAmountWan(w, digits)
}

export function fmtWan(yuan, digits = WAN_DECIMALS) {
  const w = yuanToWan(yuan)
  return w == null ? '-' : `${fmtAmountWan(w, digits)} 万`
}

export function fmtYiFromYuan(yuan, digits = 2) {
  if (yuan == null || yuan === '') return '-'
  const n = Number(yuan)
  if (!Number.isFinite(n)) return '-'
  return `${(n / 1e8).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })} 亿`
}

export function fmtYi(v, digits = 2) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })} 亿`
}

/** 与 server engine.waccFromBreakdown 对齐：Ke 三项齐才用分项，否则回退汇总折现率 */
export function previewWaccBreakdown(breakdown, fallbackRate, incomeTaxRate) {
  const n = (v) => {
    if (v == null || v === '') return null
    const x = Number(String(v).replace(/,/g, '').replace(/%/g, ''))
    return Number.isFinite(x) ? x : null
  }
  const b = breakdown || {}
  const rf = n(b.risk_free_rate)
  const erp = n(b.erp)
  const beta = n(b.beta)
  const deIn = n(b.debt_equity)
  const kdIn = n(b.debt_cost)
  const any = [rf, erp, beta, deIn, kdIn].some((x) => x != null)
  if (rf == null || erp == null || beta == null) {
    return { rate: n(fallbackRate) ?? 0.3, used_breakdown: false, incomplete: any }
  }
  const de = deIn == null ? 0 : deIn
  const kd = kdIn == null ? 0 : kdIn
  const tax = n(b.tax_rate) ?? n(incomeTaxRate) ?? 0.15
  const ke = rf + beta * erp
  const we = 1 / (1 + de)
  const wd = de / (1 + de)
  return {
    rate: we * ke + wd * kd * (1 - tax),
    used_breakdown: true,
    incomplete: false,
    ke,
    we,
    wd,
    tax,
  }
}

export const wanInputNumberProps = {
  precision: WAN_DECIMALS,
  formatter: (value) => {
    if (value === '' || value == null) return ''
    const str = String(value)
    const neg = str.startsWith('-')
    const [a, b] = str.replace('-', '').split('.')
    const grouped = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const body = b != null ? `${grouped}.${b}` : grouped
    return neg ? `-${body}` : body
  },
  parser: (value) => String(value || '').replace(/,/g, ''),
}

/** ISO/UTC 时间转为中国时区 datetime：YYYY-MM-DD HH:mm:ss */
export function formatChinaDateTime(value) {
  if (value == null || value === '') return '-'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')
}

export function formatChinaYmd(value) {
  if (value == null || value === '') return ''
  if (typeof value?.format === 'function') {
    try {
      const f = value.format('YYYY-MM-DD')
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f
    } catch { /* ignore */ }
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  }
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) return raw.slice(0, 10)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}
