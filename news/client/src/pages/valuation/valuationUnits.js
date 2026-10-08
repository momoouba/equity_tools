/** 界面、草稿、库表都是元。YUAN_PER_WAN 只把旧的万元草稿换回元。 */
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

function wanNumberToYuan(v) {
  if (v == null || v === '') return v
  const n = Number(v)
  return Number.isFinite(n) ? n * YUAN_PER_WAN : v
}

function mapWanToYuan(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj || {}
  const out = { ...obj }
  for (const k of keys) {
    if (Array.isArray(out[k])) out[k] = out[k].map(wanNumberToYuan)
    else if (out[k] != null && out[k] !== '') out[k] = wanNumberToYuan(out[k])
  }
  return out
}

/** 旧草稿 amount_unit 为万元时，把金额乘 10000。已经是元则不动。 */
export function coercePayloadToYuan(payload) {
  if (!payload || payload.amount_unit === 'yuan') return payload
  const assumptions = { ...(payload.assumptions || {}) }
  for (const key of ['esop', 'ytd_revenue', 'market_revenue', 'market_net_income']) {
    assumptions[key] = wanNumberToYuan(assumptions[key])
  }
  return {
    ...payload,
    amount_unit: 'yuan',
    assumptions,
    targetPl: mapWanToYuan(payload.targetPl || {}, ['revenue', 'cogs', 'selling', 'admin', 'rd', 'operating_profit', 'net_income']),
    targetBs: mapWanToYuan(payload.targetBs || {}, BS_INPUT_KEYS),
    targetCf: mapWanToYuan(payload.targetCf || {}, ['da', 'capex', 'dnwc']),
    overrides: mapWanToYuan(payload.overrides || {}, ['da', 'capex', 'dnwc', 'net_debt']),
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

/** 列表金额显示：元，保留 2 位小数，千分位 */
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
  const text = n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${text}元`
}

export function wanNumberFromYuan(yuan, digits = WAN_DECIMALS) {
  const w = yuanToWan(yuan)
  if (w == null) return null
  return Number(w.toFixed(digits))
}

/** 库内仍是元。计算输出的基准表按万元显示，不带单位后缀。 */
export function fmtYuanAsWan(yuan, digits = WAN_DECIMALS) {
  const w = yuanToWan(yuan)
  if (w == null || !Number.isFinite(w)) return '-'
  return w.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtWanPlain(yuan, digits = WAN_DECIMALS) {
  if (yuan == null || yuan === '') return '-'
  const n = Number(yuan)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtWan(yuan, digits = WAN_DECIMALS) {
  return fmtAmountWan(yuan, digits)
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

function chinaInstant(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const wall = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/)
  const d = new Date(wall ? `${wall[1]}T${wall[2].length === 5 ? `${wall[2]}:00` : wall[2]}+08:00` : raw)
  return Number.isFinite(d.getTime()) ? d : null
}

/** 时间转为北京时间：YYYY-MM-DD HH:mm:ss。无时区的日期时间按北京墙钟。无效值返回 -。 */
export function formatChinaDateTime(value) {
  if (value == null || value === '') return '-'
  const d = chinaInstant(value)
  if (!d) return '-'
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')
}

/** 日期按北京时间取 YYYY-MM-DD。纯日期原样保留。日期选择器的日历日用其自身格式。无效值返回空字符串。 */
export function formatChinaYmd(value) {
  if (value == null || value === '') return ''
  if (typeof value?.format === 'function') {
    try {
      const f = value.format('YYYY-MM-DD')
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f
    } catch { /* ignore */ }
  }
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const wall = raw.match(/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}/)
  if (wall) return wall[1]
  const d = chinaInstant(value)
  if (!d) return ''
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}
