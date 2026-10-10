import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, Input, InputNumber, Select, Switch, Message, Space,
  Typography, Alert, Progress, Modal, Checkbox, Tag, DatePicker, Tabs, Tooltip,
} from '@arco-design/web-react'
import { IconClose, IconQuestionCircle } from '@arco-design/web-react/icon'
import {
  fetchValuationCase, fetchValuationDraft, putValuationDraft, patchValuationCase,
  fetchCaseComparables, fetchComparableFinancials,
  patchCaseComparable, postValuationJob, fetchValuationJob,
  postValuationVersion, fetchValuationVersion, postValuationDraftFromVersion, downloadValuationExport,
  fetchIndustryMultiplesStatus,
  fetchSwIndustryNames,
} from '../../api/valuation'
import ValuationDetailModal from './ValuationDetailModal'
import SheetModal, { SheetActions } from '../../components/SheetModal'
import { coercePayloadToYuan, fmtYi, fmtNum, fmtPct, fmtAmountWan, fmtWanPlain, roundWanToFen, wanInputNumberProps, formatChinaDateTime, formatChinaYmd, previewWaccBreakdown } from './valuationUnits'
import ValuationFootballField from './ValuationFootballField'
import ValuationExitPanel, { DcfExitCard } from './ValuationExitPanel'
import { buildCalcStamp, diffCalcStamp, needsRefetch } from './valuationCalcStamp'
import {
  RelativeValuationTable,
  RatiosTables,
  MarketMethodTable,
  DcfProcessTables,
  forecastYearLabel,
} from './valuationSheetTables'
import ComparableFinancialTable from './ComparableFinancialTable'
import { ListTable } from './valuationTable'
import ValuationMethodGuide from './ValuationMethodGuide'
import TargetFinancialImportBar from './TargetFinancialImportBar'
import ComparableCompsPanel from './ComparableCompsPanel'
import ValuationTieOutPanel from './ValuationTieOutPanel'
import {
  BS_INPUT_FIELDS,
  BS_GROUPS,
  currentAssetsFromBs,
  totalAssetsFromBs,
  currentLiabFromBs,
  totalLiabFromBs,
  nwcStockFromBs,
  debtRatioFromBs,
  currentRatioFromBs,
  equityImpliedFromBs,
  equityBookFromBs,
  displayBs,
} from './valuationBsFields'
import VersionComparePanel from './VersionComparePanel'
import ValuationChangeLog from './ValuationChangeLog'
import './valuation.css'

const TabPane = Tabs.TabPane

const NAV_GROUPS = [
  {
    key: 'input',
    label: '用户录入',
    tone: 'input',
    items: [
      { key: 'method', title: '方法配置' },
      { key: 'comps', title: '可比与采集' },
      { key: 'pl', title: '标的利润表' },
      { key: 'bs', title: '标的资产负债表' },
      { key: 'cf', title: '标的现金流量表' },
      { key: 'changelog', title: '变更记录' },
    ],
  },
  {
    key: 'fetch',
    label: '系统取数',
    tone: 'fetch',
    divider: '采集完成后核验',
    items: [
      { key: 'comp_pl', title: '可比利润表' },
      { key: 'comp_bs', title: '可比资产负债表' },
      { key: 'comp_cf', title: '可比现金流量表' },
      { key: 'relative', title: '相对估值' },
      { key: 'ratios', title: '三费/毛利/营运' },
    ],
  },
  {
    key: 'result',
    label: '计算结果',
    tone: 'result',
    divider: '计算输出',
    items: [
      { key: 'result', title: '计算输出' },
    ],
  },
]
const STEPS = NAV_GROUPS.flatMap((g) => g.items)

const PL_RATIO_KEYS = [
  'revenue_growth', 'cogs_ratio', 'surtax_ratio', 'selling_ratio', 'admin_ratio', 'rd_ratio', 'finance_expense_ratio',
  'other_income_ratio', 'other_ratio', 'da_ratio', 'capex_ratio', 'dso', 'dpo', 'dio',
]

function emptyPl() {
  const pl = { years: [], revenue: [], cogs: [], selling: [], admin: [], rd: [], operating_profit: [], net_income: [] }
  for (const k of PL_RATIO_KEYS) pl[k] = []
  return pl
}

const PL_SERIES_KEYS = [
  'revenue', 'cogs', 'surtax', 'gross_profit', 'selling', 'admin', 'rd', 'finance_expense',
  'other_income', 'other', 'da', 'operating_profit', 'net_income', ...PL_RATIO_KEYS,
]

function statementAnchor(ymd) {
  const formatted = formatChinaYmd(ymd)
  const s = String(formatted || ymd || '').slice(0, 10)
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(s)) return null
  return { ymd: s, year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) }
}

function yearNum(y) {
  const m = String(y || '').match(/(20\d{2})/)
  return m ? Number(m[1]) : null
}

function forecastStartYear(ymd) {
  const a = statementAnchor(ymd)
  if (!a) return null
  return a.month === 12 ? a.year + 1 : a.year
}

function currentPlIndex(pl, ymd) {
  const years = pl?.years || []
  const a = statementAnchor(ymd)
  if (a) {
    const i = years.findIndex((y) => yearNum(y) === a.year)
    if (i >= 0) return i
  }
  for (let i = years.length - 1; i >= 0; i -= 1) {
    if (pl?.revenue?.[i] != null && pl.revenue[i] !== '') return i
  }
  return -1
}

const CURRENT_PL_ROWS = [
  { key: 'revenue', name: '营业收入', note: '锚定日当期累计营业收入，元' },
  { key: 'cogs', name: '营业成本', note: '当期利润表' },
  { key: 'surtax', name: '税金及附加', note: '当期利润表。未填按 0。进入税前经营利润' },
  { key: 'selling', name: '销售费用', note: '当期利润表，含已分摊的折旧摊销' },
  { key: 'admin', name: '管理费用', note: '当期利润表，含已分摊的折旧摊销' },
  { key: 'rd', name: '研发费用', note: '当期利润表，含已分摊的折旧摊销' },
  { key: 'finance_expense', name: '财务费用', note: '当期利润表。利息收入大于利息支出时填负数。不进入自由现金流' },
  { key: 'other_income', name: '其他收益', note: '当期利润表。多为政府补助，可为负。未填按 0。进入税前经营利润' },
  { key: 'other', name: '其他', note: '当期利润表。只放经营性项目，可为负。未填按 0。不含投资收益、公允价值变动、减值、营业外收支' },
  { key: 'da', name: '折旧摊销', note: '当期利润表或现金流量表补充资料。固定资产折旧、无形资产摊销、长期待摊费用摊销。未填按 0' },
  { key: 'operating_profit', name: '营业利润', note: '当期利润表' },
  { key: 'net_income', name: '净利润', note: '当期利润表' },
]

const CURRENT_AMOUNT_KEYS = CURRENT_PL_ROWS.map((r) => r.key)

function setPlYearAmount(pl, year, key, value) {
  const label = String(year)
  let next = { ...(pl || {}) }
  let years = [...(next.years || [])].map(String)
  let idx = years.findIndex((y) => yearNum(y) === Number(year))
  if (idx < 0) {
    const ordered = [...years, label].sort((a, b) => (yearNum(a) || 0) - (yearNum(b) || 0))
    next = realignPl(next, ordered)
    years = next.years || []
    idx = years.findIndex((y) => yearNum(y) === Number(year))
  }
  const arr = [...(next[key] || [])]
  arr[idx] = value
  next[key] = arr
  next.years = years
  return next
}

function setCurrentAmount(pl, ymd, key, value) {
  const next = { ...(pl || {}) }
  let years = [...(next.years || [])].map(String)
  let idx = currentPlIndex({ ...next, years }, ymd)
  if (idx < 0) {
    const a = statementAnchor(ymd)
    years = [a ? String(a.year) : '当期', ...years]
    for (const k of [...CURRENT_AMOUNT_KEYS, ...PL_RATIO_KEYS]) {
      if (Array.isArray(next[k])) next[k] = [undefined, ...next[k]]
    }
    idx = 0
  }
  const arr = [...(next[key] || [])]
  arr[idx] = value
  next[key] = arr
  next.years = years
  return next
}

function forecastYearEntries(pl, ymd) {
  const start = forecastStartYear(ymd)
  return (pl?.years || []).map((y, i) => ({ y: String(y), i })).filter(({ y }) => {
    if (start == null) return true
    const n = yearNum(y)
    return n != null && n >= start
  })
}

const RATIO_FILL_KEYS = [
  'revenue_growth', 'cogs_ratio', 'surtax_ratio', 'selling_ratio', 'admin_ratio', 'rd_ratio',
  'finance_expense_ratio', 'other_income_ratio', 'other_ratio', 'da_ratio', 'capex_ratio',
]

function ratioCellBlank(pl, key, index) {
  const v = pl?.[key]?.[index]
  return v == null || v === ''
}

const YEAR_END_AMOUNT_KEYS = [
  'revenue', 'cogs', 'surtax', 'selling', 'admin', 'rd', 'finance_expense',
  'other_income', 'other', 'da', 'capex',
]

function yearEndAmountYear(forecastPl, year, key) {
  const row = forecastPl?.[String(year)]
  if (!row || typeof row !== 'object') return false
  const manual = Array.isArray(row.manual) ? row.manual : []
  const keys = key ? [key] : YEAR_END_AMOUNT_KEYS
  return keys.some((item) => manual.includes(item) && row[item] != null && row[item] !== '')
}

function statementAmountYear(pl, index) {
  return ['revenue', 'cogs', 'selling', 'admin', 'rd'].some((key) => {
    const v = pl?.[key]?.[index]
    return v != null && v !== ''
  })
}

/** 百分比表不含当年年底。那一列是录入的金额，在预测利润表里改。 */
function ratioYearEntries(pl, ymd, forecastPl) {
  const anchor = statementAnchor(ymd)
  return forecastYearEntries(pl, ymd).filter(({ y, i }, idx, list) => {
    const n = yearNum(y)
    if (yearEndAmountYear(forecastPl, n, 'revenue')) return false
    if (anchor && anchor.month === 12) return true
    if (anchor && n === anchor.year) return false
    if (anchor) return true
    const blank = RATIO_FILL_KEYS.every((key) => ratioCellBlank(pl, key, i))
    const laterFilled = list.slice(idx + 1).some((entry) => (
      RATIO_FILL_KEYS.some((key) => !ratioCellBlank(pl, key, entry.i))
    ))
    if (blank && laterFilled && (yearEndAmountYear(forecastPl, n) || statementAmountYear(pl, i))) return false
    return true
  })
}

function realignPl(pl, nextYears) {
  const oldYears = (pl?.years || []).map(String)
  const years = nextYears.map(String)
  const next = { ...(pl || {}), years }
  for (const k of [...CURRENT_AMOUNT_KEYS, ...PL_RATIO_KEYS, 'gross_profit']) {
    const src = Array.isArray(pl?.[k]) ? pl[k] : []
    next[k] = years.map((y) => {
      const i = oldYears.findIndex((oy) => oy === y || yearNum(oy) === yearNum(y))
      return i >= 0 ? src[i] : undefined
    })
  }
  return next
}

function bsAutoValue(name, values, imbalance) {
  if (!values) return null
  if (name === '流动资产合计') return currentAssetsFromBs(values)
  if (name === '资产总计') return totalAssetsFromBs(values)
  if (name === '流动负债合计') return currentLiabFromBs(values)
  if (name === '负债合计' || name === '负债总计') return totalLiabFromBs(values)
  if (name === '所有者权益（反算）') return equityImpliedFromBs(values)
  if (name === '账面所有者权益' || name === '所有者权益总计') return equityBookFromBs(values)
  if (name === '配平差额') {
    if (imbalance != null) return imbalance
    const assets = totalAssetsFromBs(values)
    const liab = totalLiabFromBs(values)
    const book = equityBookFromBs(values)
    if (assets == null || liab == null || book == null) return null
    return roundWanToFen(assets - liab - book)
  }
  if (name === '净负债') return computedNetDebtWan(values)
  if (name === '期末营运资本占用') {
    const n = nwcStockFromBs(values)
    return n == null ? null : roundWanToFen(n)
  }
  if (name === '资产负债率') return debtRatioFromBs(values)
  if (name === '流动比率') return currentRatioFromBs(values)
  return null
}

function forecastBsColumn(actual, pv, yearOverrides) {
  const values = { ...displayBs(actual) }
  const overrides = yearOverrides || {}
  Object.entries(overrides).forEach(([key, value]) => {
    if (value != null && value !== '') values[key] = value
  })
  if (pv && pv.ar_balance != null) {
    if (overrides.accounts_receivable == null || overrides.accounts_receivable === '') values.accounts_receivable = pv.ar_balance
    if (overrides.inventory == null || overrides.inventory === '') values.inventory = pv.inventory_balance
    if (overrides.accounts_payable == null || overrides.accounts_payable === '') values.accounts_payable = pv.ap_balance
    values.ar_is_net = true
    values.ap_is_net = true
  }
  return { values, forecast: Boolean(pv && pv.ar_balance != null) }
}

function defaultForecastYears(ymd, count = 5) {
  const a = statementAnchor(ymd)
  if (!a) return []
  const start = a.month === 12 ? a.year + 1 : a.year
  const n = Math.min(15, Math.max(1, Number(count) || 5))
  return Array.from({ length: n }, (_, i) => String(start + i))
}

function finiteOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function carrySeries(arr) {
  const values = []
  let last = null
  let seen = false
  ;(arr || []).forEach((raw) => {
    const v = finiteOrNull(raw)
    if (v != null) {
      last = v
      seen = true
    }
    values.push(seen ? last : null)
  })
  return values
}

function forecastStatement(pl, assumptions, forecastPl) {
  const anchor = statementAnchor(assumptions?.valuation_date)
  const entries = forecastYearEntries(pl, assumptions?.valuation_date)
  const years = entries.map(({ y }) => String(yearNum(y) || y))
  if (!anchor || !years.length) return null
  const stub = anchor.month < 12 && yearNum(years[0]) === anchor.year
  const amountYear = stub || yearEndAmountYear(forecastPl, years[0], 'revenue')
  const yearEndRow = (forecastPl && (forecastPl[years[0]] || forecastPl[yearNum(years[0])])) || {}
  const entered = (key) => finiteOrNull(yearEndRow[key])
  const ytd = finiteOrNull(assumptions?.ytd_revenue)
  let base = ytd != null && ytd > 0 ? ytd : null
  if (base == null) {
    const idx = (pl?.years || []).findIndex((y) => yearNum(y) === anchor.year)
    const revenue = finiteOrNull(pl?.revenue?.[idx])
    if (revenue != null && revenue > 0) base = revenue
  }
  const picked = (key) => entries.map(({ i }) => pl?.[key]?.[i])
  const growth = carrySeries(picked('revenue_growth'))
  const revenue = []
  if (amountYear) {
    let prev = entered('revenue')
    growth.forEach((g, i) => {
      if (i === 0) {
        revenue.push(prev)
        return
      }
      if (prev == null || g == null) {
        revenue.push(null)
        prev = null
        return
      }
      const next = prev * (1 + g)
      revenue.push(next)
      prev = next
    })
  } else {
    let prev = base == null ? null : base * 12 / anchor.month
    growth.forEach((g) => {
      if (prev == null || g == null) {
        revenue.push(null)
        prev = null
        return
      }
      const next = prev * (1 + g)
      revenue.push(next)
      prev = next
    })
  }
  const fromRevenue = (ratioKey, amountKey, optional = false) => {
    const seen = picked(ratioKey).some((v) => finiteOrNull(v) != null)
    const rates = seen ? carrySeries(picked(ratioKey)) : years.map(() => (optional ? 0 : null))
    return years.map((_, i) => {
      if (amountYear && i === 0) {
        const v = entered(amountKey)
        if (v != null) return v
        return optional ? 0 : null
      }
      const rate = rates[i]
      if (rate != null && Math.abs(rate) > 10000) return rate
      const rev = revenue[i]
      if (rate == null || rev == null) return null
      return rev * rate
    })
  }
  const cogs = fromRevenue('cogs_ratio', 'cogs')
  const surtax = fromRevenue('surtax_ratio', 'surtax')
  const selling = fromRevenue('selling_ratio', 'selling')
  const admin = fromRevenue('admin_ratio', 'admin')
  const rdRates = carrySeries(picked('rd_ratio'))
  const manualRd = (i) => {
    const row = forecastPl?.[years[i]]
    if (!Array.isArray(row?.manual) || !row.manual.includes('rd')) return null
    return finiteOrNull(row.rd)
  }
  const rd = assumptions?.rd_growth_mode === 'share'
    ? fromRevenue('rd_ratio', 'rd')
    : years.map((_, i) => i).reduce((acc, i) => {
      const rate = rdRates[i]
      const manual = i === 0 && amountYear ? null : manualRd(i)
      let next = null
      if (amountYear && i === 0) {
        next = entered('rd')
      } else if (manual != null) {
        next = manual
      } else if (rate != null && Math.abs(rate) > 10000) {
        next = rate
      } else if (!amountYear && i === 0) {
        const idx = (pl?.years || []).findIndex((y) => yearNum(y) === anchor.year)
        const actual = finiteOrNull(pl?.rd?.[idx])
        next = actual == null || rate == null ? null : actual * (1 + rate)
      } else if (acc.prev == null || rate == null) {
        next = null
      } else {
        next = acc.prev * (1 + rate)
      }
      acc.values.push(next)
      acc.prev = next
      return acc
    }, { values: [], prev: null }).values
  const financeExpense = fromRevenue('finance_expense_ratio', 'finance_expense', true)
  const otherIncome = fromRevenue('other_income_ratio', 'other_income')
  const other = fromRevenue('other_ratio', 'other')
  const da = fromRevenue('da_ratio', 'da')
  const capex = fromRevenue('capex_ratio', 'capex')
  const taxRaw = finiteOrNull(assumptions?.tax_rate)
  const tax = taxRaw == null ? 0.15 : taxRaw
  const gross = revenue.map((rev, i) => (rev == null || cogs[i] == null ? null : rev - cogs[i]))
  const pretax = revenue.map((rev, i) => {
    const parts = [cogs[i], surtax[i], selling[i], admin[i], rd[i], otherIncome[i], other[i]]
    if (rev == null || parts.some((v) => v == null)) return null
    return rev - cogs[i] - surtax[i] - selling[i] - admin[i] - rd[i] + otherIncome[i] + other[i]
  })
  const nopat = pretax.map((p) => (p == null ? null : (p > 0 ? p * (1 - tax) : p)))
  const operatingProfit = revenue.map((rev, i) => {
    const parts = [cogs[i], surtax[i], selling[i], admin[i], rd[i], financeExpense[i], otherIncome[i], other[i]]
    if (rev == null || parts.some((v) => v == null)) return null
    return rev - cogs[i] - surtax[i] - selling[i] - admin[i] - rd[i] - financeExpense[i] + otherIncome[i] + other[i]
  })
  const ebitda = pretax.map((p, i) => (p == null || da[i] == null ? null : p + da[i]))
  return {
    years, revenue, cogs, gross, surtax, selling, admin, rd, financeExpense, otherIncome, other, operatingProfit, da, ebitda, pretax, nopat, capex, tax,
    entries,
  }
}

const FORECAST_PL_DRIVERS = [
  ['revenue', 'revenue'],
  ['cogs', 'cogs'],
  ['surtax', 'surtax'],
  ['selling', 'selling'],
  ['admin', 'admin'],
  ['rd', 'rd'],
  ['financeExpense', 'finance_expense'],
  ['otherIncome', 'other_income'],
  ['other', 'other'],
  ['da', 'da'],
  ['capex', 'capex'],
]

function overlayForecastStatement(statement, forecastPl) {
  if (!statement) return null
  const next = { ...statement }
  FORECAST_PL_DRIVERS.forEach(([clientKey, engineKey]) => {
    next[clientKey] = statement[clientKey].map((formula, i) => {
      const row = forecastPl?.[statement.years[i]]
      const manual = Array.isArray(row?.manual) ? row.manual : []
      if (!manual.includes(engineKey)) return formula
      const stored = finiteOrNull(row?.[engineKey])
      return stored != null ? stored : formula
    })
  })
  next.gross = next.revenue.map((rev, i) => (rev == null || next.cogs[i] == null ? null : rev - next.cogs[i]))
  next.pretax = next.revenue.map((rev, i) => {
    const parts = [next.cogs[i], next.surtax[i], next.selling[i], next.admin[i], next.rd[i], next.otherIncome[i], next.other[i]]
    if (rev == null || parts.some((v) => v == null)) return null
    return rev - next.cogs[i] - next.surtax[i] - next.selling[i] - next.admin[i] - next.rd[i] + next.otherIncome[i] + next.other[i]
  })
  const tax = statement.tax == null ? 0.15 : statement.tax
  next.nopat = next.pretax.map((p) => (p == null ? null : (p > 0 ? p * (1 - tax) : p)))
  next.operatingProfit = next.revenue.map((rev, i) => {
    const parts = [next.cogs[i], next.surtax[i], next.selling[i], next.admin[i], next.rd[i], next.financeExpense[i], next.otherIncome[i], next.other[i]]
    if (rev == null || parts.some((v) => v == null)) return null
    return rev - next.cogs[i] - next.surtax[i] - next.selling[i] - next.admin[i] - next.rd[i] - next.financeExpense[i] + next.otherIncome[i] + next.other[i]
  })
  next.ebitda = next.pretax.map((p, i) => (p == null || next.da[i] == null ? null : p + next.da[i]))
  return next
}

function plAmountAtYear(pl, year, key) {
  const idx = (pl?.years || []).findIndex((y) => yearNum(y) === year)
  if (idx < 0) return null
  return finiteOrNull(pl?.[key]?.[idx])
}

function bsNwcParts(bs) {
  const n = displayBs(bs)
  const num = (v) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }
  const ar = num(n?.accounts_receivable)
  const inv = num(n?.inventory)
  const ap = num(n?.accounts_payable)
  const prepay = num(n?.prepayment)
  const advance = bs?.ar_is_net ? 0 : (num(n?.contract_liability) || 0)
  const prepayCut = bs?.ap_is_net ? 0 : (prepay || 0)
  if (ar == null && inv == null && ap == null && prepay == null && !advance) return null
  return {
    netAr: ar == null && !advance ? null : (ar || 0) - advance,
    inventory: inv,
    netAp: ap == null && !prepayCut ? null : (ap || 0) - prepayCut,
    nwc: nwcStockFromBs(bs),
  }
}

function priorActualStatement(pl, assumptions, bs, firstYear) {
  const year = yearNum(firstYear) - 1
  if (!Number.isFinite(year)) return null
  const amt = (key) => plAmountAtYear(pl, year, key)
  const revenue = amt('revenue')
  const cogs = amt('cogs')
  const surtax = amt('surtax')
  const selling = amt('selling')
  const admin = amt('admin')
  const rd = amt('rd')
  const financeExpense = amt('finance_expense')
  const otherIncome = amt('other_income')
  const other = amt('other')
  const da = amt('da')
  const gross = revenue == null || cogs == null ? null : revenue - cogs
  const storedProfit = amt('operating_profit')
  const operatingProfit = storedProfit != null ? storedProfit : (
    gross == null ? null : gross - (surtax || 0) - (selling || 0) - (admin || 0) - (rd || 0) - (financeExpense || 0) + (otherIncome || 0) + (other || 0)
  )
  const pretax = revenue == null ? null : revenue - (cogs || 0) - (surtax || 0) - (selling || 0) - (admin || 0) - (rd || 0) + (otherIncome || 0) + (other || 0)
  const taxRaw = finiteOrNull(assumptions?.tax_rate)
  const tax = taxRaw == null ? 0.15 : taxRaw
  const nopat = pretax == null ? null : (pretax > 0 ? pretax * (1 - tax) : pretax)
  const ebitda = pretax == null || da == null ? null : pretax + da
  const anchor = statementAnchor(assumptions?.valuation_date)
  const stocks = anchor && anchor.year === year ? bsNwcParts(bs) : null
  return {
    year,
    revenue,
    cogs,
    gross,
    surtax,
    selling,
    admin,
    rd,
    financeExpense,
    otherIncome,
    other,
    operatingProfit,
    da,
    ebitda,
    pretax,
    nopat,
    capex: null,
    netAr: stocks?.netAr ?? null,
    netAp: stocks?.netAp ?? null,
    inventory: stocks?.inventory ?? null,
    nwc: stocks?.nwc ?? null,
    dnwc: null,
  }
}

function withWorkingCapital(statement, pl, assumptions, payload) {
  if (!statement) return null
  const next = { ...statement }
  const wc = payload?.sheets?.working_capital?.payload
  const bs = payload?.targetBs || {}
  const entries = statement.entries || []
  const day = (key, i) => {
    const index = entries[i]?.i
    if (index == null) return null
    const shown = shownForecastDay(pl, assumptions, wc, key, index)
    return shown == null || shown === '' ? null : Number(shown)
  }
  const stock = (flow, days) => flow.map((amount, i) => {
    const d = days[i]
    if (amount == null || d == null) return null
    return (d / 360) * amount
  })
  const dso = next.revenue.map((_, i) => day('dso', i))
  const dpo = next.revenue.map((_, i) => day('dpo', i))
  const dio = next.revenue.map((_, i) => day('dio', i))
  next.netAr = stock(next.revenue, dso)
  next.inventory = stock(next.cogs, dio)
  next.netAp = stock(next.cogs, dpo)
  next.nwc = next.netAr.map((ar, i) => {
    const inv = next.inventory[i]
    const ap = next.netAp[i]
    if (ar == null || inv == null || ap == null) return null
    return ar + inv - ap
  })
  const firstYear = yearNum(next.years?.[0])
  const anchor = statementAnchor(assumptions?.valuation_date)
  const priorYear = Number.isFinite(firstYear) ? firstYear - 1 : null
  const priorStocks = anchor && priorYear != null && anchor.year === priorYear ? bsNwcParts(bs) : null
  const opening = priorStocks?.nwc != null ? priorStocks.nwc : nwcStockFromBs(bs)
  next.dnwc = next.nwc.map((balance, i) => {
    if (balance == null) return null
    const prev = i === 0 ? opening : next.nwc[i - 1]
    if (prev == null) return null
    return balance - prev
  })
  return next
}

function editForecastPl(forecastPl, year, engineKey, value, formula, inputYear = false) {
  const next = { ...(forecastPl || {}) }
  const row = { ...(next[year] || {}) }
  const manual = new Set(Array.isArray(row.manual) ? row.manual : [])
  const stored = finiteOrNull(row[engineKey])
  const formulaN = finiteOrNull(formula)
  const shown = stored != null ? stored : formulaN
  const typed = finiteOrNull(value)
  const cleared = value == null || value === ''
  if (cleared || (!inputYear && formulaN != null && typed === formulaN)) {
    delete row[engineKey]
    manual.delete(engineKey)
  } else if (!inputYear && typed != null && shown != null && typed === shown && !manual.has(engineKey)) {
    return forecastPl || {}
  } else if (typed == null) {
    delete row[engineKey]
    manual.delete(engineKey)
  } else {
    row[engineKey] = typed
    manual.add(engineKey)
  }
  if (manual.size) row.manual = [...manual]
  else delete row.manual
  if (Object.keys(row).some((key) => key !== 'manual')) next[year] = row
  else delete next[year]
  return next
}

function ratiosTouched(pl) {
  return PL_RATIO_KEYS.some((k) => (pl?.[k] || []).some((v) => v != null && v !== ''))
}

const ANCHOR_DATE_HELP = '只能选最近一期报表日：3 月 31 日、6 月 30 日、9 月 30 日或 12 月 31 日。新建时按案件创建日预填，与下载模板相同：1–4 月为上年 12 月 31 日，5–7 月为当年 3 月 31 日，8–10 月为当年 6 月 30 日，11–12 月为当年 9 月 30 日。可以改。市场法倍数、DCF 折现起点和资产负债表实际列都用这一天。'

const FORECAST_RATIO_ROWS = [
  { key: 'revenue_growth', name: '收入增速（较上一年）', note: '较上一年。锚定日不是 12 月 31 日时，当年年底收入在预测利润表填写，本表从下一年起填增速。12 月 31 日时，第一年 = 当年全年收入 ×（1+增速）。空白年份沿用最近一次已填增速，可为负或 0。', min: -500 },
  { key: 'cogs_ratio', name: '营业成本（占营业收入）', note: '占营业收入。95 表示当年收入的 95%。绝对值大于 10000 时按该年实际金额（元），不再乘收入。当年年底金额仍在预测利润表填写。', min: -500 },
  { key: 'surtax_ratio', name: '税金及附加（占营业收入）', note: '占营业收入。绝对值大于 10000 时按该年实际金额。填 0 视为已填，小于 0 会拦截。', min: -100 },
  { key: 'selling_ratio', name: '销售费用（占营业收入）', note: '占营业收入，含已分摊折旧。绝对值大于 10000 时按该年实际金额。', min: -500 },
  { key: 'admin_ratio', name: '管理费用（占营业收入）', note: '占营业收入，含已分摊折旧。绝对值大于 10000 时按该年实际金额。', min: -500 },
  { key: 'rd_ratio', name: '研发费用（较上一年）', note: '较上一年。10 表示增长 10%。绝对值大于 10000 时按该年金额（元）。锚定日不是 12 月 31 日时，第一列年底金额在预测利润表填写。锚定日是 12 月 31 日、第一年填百分数时，用已结年全年实际研发 ×（1+增速）。', min: -500 },
  { key: 'finance_expense_ratio', name: '财务费用（占营业收入）', note: '占营业收入。绝对值大于 10000 时按该年实际金额，可为负。未填按 0。不进入税前经营利润和自由现金流。', min: -500 },
  { key: 'other_income_ratio', name: '其他收益（占营业收入）', note: '占营业收入。多含政府补助。空白年份沿用最近一次比例，终值按最后一年计算，补助会被永久资本化。不可持续时把后续年份改低或改为 0。可为负，填 0 视为已填。', min: -500 },
  { key: 'other_ratio', name: '其他（占营业收入）', note: '占营业收入。只放经营性项目。不含投资收益、公允价值变动、信用减值、资产减值、资产处置、营业外收支。可为负，填 0 视为已填。', min: -500 },
  { key: 'da_ratio', name: '折旧摊销（占营业收入）', note: '占营业收入。填现金流量表补充资料或附注中的折旧摊销合计，不要从三项费用里扣掉再填。绝对值大于 10000 时按该年实际金额。', min: -100 },
  { key: 'capex_ratio', name: '资本开支（占营业收入）', note: '占营业收入。绝对值大于 10000 时按该年实际金额。未填不按 0，会拦截。DCF 不再使用现金流量表上的手填金额。', min: -100 },
]

function splicePlYear(pl, index) {
  const years = [...(pl.years || [])]
  if (years.length <= 1 || index < 0 || index >= years.length) return pl
  years.splice(index, 1)
  const next = { ...pl, years }
  for (const k of PL_SERIES_KEYS) {
    if (Array.isArray(pl[k])) {
      const arr = [...pl[k]]
      arr.splice(index, 1)
      next[k] = arr
    }
  }
  return next
}

function numOrZero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 系统默认口径：退出 PE × 末期税后经营利润、净利润桥、退出倍数 × 收入 CAGR、个股 POOL */
function isDefaultMethodConfig(method) {
  return method?.terminal_type === 'exit_pe'
    && method?.fcf_method === 'ni_bridge'
    && method?.sensitivity_axes === 'exit_x_cagr'
    && (method?.multiple_source || 'stock_pool') === 'stock_pool'
}

function computedNetDebtWan(bs) {
  if (!bs) return null
  const keys = ['cash', 'short_term_loan', 'current_portion_noncurrent', 'long_term_loan', 'lease_liability']
  if (!keys.some((k) => bs[k] != null && bs[k] !== '')) return null
  return roundWanToFen(
    numOrZero(bs.short_term_loan)
    + numOrZero(bs.current_portion_noncurrent)
    + numOrZero(bs.long_term_loan)
    + numOrZero(bs.lease_liability)
    - numOrZero(bs.cash)
  )
}

function computedNwcWan(bs) {
  if (!bs) return null
  const n = nwcStockFromBs(bs)
  return n == null ? null : roundWanToFen(n)
}

function cfYearsFrom(pl, cf) {
  const fromPl = Array.isArray(pl?.years) ? pl.years.filter((y) => y != null && String(y).trim() !== '') : []
  if (fromPl.length) return fromPl.map(String)
  return (cf?.years || []).map(String).filter(Boolean)
}

function impliedDaView(pl, assumptions) {
  const anchor = statementAnchor(assumptions?.valuation_date)
  const entries = forecastYearEntries(pl, assumptions?.valuation_date)
  if (!anchor || !entries.length) return { actual: undefined, byYear: {} }
  const ytd = Number(assumptions?.ytd_revenue)
  let revenueBase = Number.isFinite(ytd) && ytd > 0 ? ytd : null
  if (revenueBase == null) {
    const idx = (pl?.years || []).findIndex((y) => yearNum(y) === anchor.year)
    const n = Number(pl?.revenue?.[idx])
    if (Number.isFinite(n) && n > 0) revenueBase = n
  }
  if (!(revenueBase > 0)) return { actual: undefined, byYear: {} }
  let ratioLast = null
  let ratioFilled = false
  const ratios = entries.map(({ i }) => {
    const n = Number(pl?.da_ratio?.[i])
    if (Number.isFinite(n)) {
      ratioLast = n
      ratioFilled = true
    }
    return ratioLast
  })
  if (!ratioFilled) return { actual: undefined, byYear: {} }
  if (anchor.month < 12 && yearNum(entries[0].y) === anchor.year) {
    return { actual: revenueBase * (ratios[0] || 0), byYear: {} }
  }
  let growthLast = null
  let growthFilled = false
  const growth = entries.map(({ i }) => {
    const n = Number(pl?.revenue_growth?.[i])
    if (Number.isFinite(n)) {
      growthLast = n
      growthFilled = true
    }
    return growthLast
  })
  const byYear = {}
  if (growthFilled) {
    let prev = revenueBase * 12 / anchor.month
    entries.forEach(({ y }, i) => {
      const rev = prev * (1 + (growth[i] || 0))
      prev = rev
      byYear[yearNum(y)] = rev * (ratios[i] || 0)
    })
  }
  return { actual: revenueBase * (ratios[0] || 0), byYear }
}

function cfValueAtYear(cf, year, key) {
  const years = (cf?.years || []).map(String)
  const i = years.findIndex((y) => yearNum(y) === yearNum(year) || y === String(year))
  if (i < 0) return undefined
  return cf?.[key]?.[i]
}

function patchCfYear(payload, year, key, value) {
  const cf = { ...(payload.targetCf || {}) }
  const oldYears = (cf.years || []).map(String)
  const aligned = cfYearsFrom(payload.targetPl, cf)
  const years = aligned.length ? [...aligned] : [...oldYears]
  if (!years.includes(String(year))) years.push(String(year))
  const fromOld = (arr, y) => {
    const j = oldYears.findIndex((ey) => yearNum(ey) === yearNum(y) || ey === y)
    return j >= 0 ? arr?.[j] : undefined
  }
  ;['da', 'capex', 'dnwc'].forEach((k) => {
    const src = Array.isArray(cf[k]) ? cf[k] : []
    cf[k] = years.map((y) => fromOld(src, y))
  })
  cf.years = years
  const i = years.findIndex((y) => y === String(year))
  cf[key][i] = value == null || value === '' ? null : value
  return { targetCf: cf }
}

function StackedFieldTable({ items, style }) {
  return (
    <ListTable
      className="valuation-pl-stack-table"
      showSeq={false}
      pagination={false}
      size="small"
      scroll={{ x: Math.max(items.length * 168, 480) }}
      rowKey="kind"
      style={style}
      rowClassName={(row) => (row.kind === 'note' ? 'valuation-pl-stack-note-row' : '')}
      columns={items.map((item, i) => ({
        title: item.name,
        dataIndex: `c${i}`,
        width: 168,
        align: 'right',
        className: 'valuation-num-cell',
        render: (value) => value,
      }))}
      data={[
        {
          kind: 'value',
          ...Object.fromEntries(items.map((item, i) => [`c${i}`, item.editor])),
        },
        {
          kind: 'note',
          ...Object.fromEntries(items.map((item, i) => [`c${i}`, item.note])),
        },
      ]}
    />
  )
}

function WanInput({ style, className, ...props }) {
  return (
    <InputNumber
      {...wanInputNumberProps}
      hideControl
      size="small"
      {...props}
      className={['valuation-cell-input', className].filter(Boolean).join(' ')}
      style={{ width: '100%', ...style }}
    />
  )
}

function ratioToPct(v) {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : undefined
}

function MixedRatioInput({ value, onChange, className, style }) {
  const n = finiteOrNull(value)
  const asAmount = n != null && Math.abs(n) > 10000
  return (
    <InputNumber
      hideControl
      size="small"
      className={['valuation-pct-input', className].filter(Boolean).join(' ')}
      style={{ width: '100%', ...style }}
      suffix={asAmount ? undefined : '%'}
      value={asAmount ? n : ratioToPct(n)}
      onChange={(v) => {
        if (v == null || v === '') onChange?.(null)
        else if (Math.abs(Number(v)) > 10000) onChange?.(Number(v))
        else onChange?.(Number(v) / 100)
      }}
    />
  )
}

function PctInput({ value, onChange, className, style, ...props }) {
  return (
    <InputNumber
      hideControl
      size="small"
      step={1}
      min={0}
      max={100}
      {...props}
      className={['valuation-pct-input', className].filter(Boolean).join(' ')}
      style={{ width: '100%', ...style }}
      suffix="%"
      value={ratioToPct(value)}
      onChange={(v) => onChange?.(v == null || v === '' ? null : Number(v) / 100)}
    />
  )
}

function DcfNumInput({ suffix, ...props }) {
  return (
    <InputNumber
      hideControl
      suffix={suffix}
      style={{ width: '100%' }}
      {...props}
    />
  )
}

function scenarioPatch(payload, key, field, v) {
  return {
    scenarios: {
      ...payload.scenarios,
      [key]: { ...(payload.scenarios?.[key] || {}), [field]: v },
    },
  }
}

function mergeRelativeOverrides(rows, comps) {
  const by = new Map((comps || []).map((c) => [String(c.stock_code), c]))
  return (rows || []).map((r) => {
    const c = by.get(String(r.stock_code))
    if (!c) return r
    return {
      ...r,
      pe_median_override: c.pe_median_override !== undefined ? c.pe_median_override : r.pe_median_override,
      ps_median_override: c.ps_median_override !== undefined ? c.ps_median_override : r.ps_median_override,
    }
  })
}

function dualParamsLookSame(method, assumptions, payload) {
  if (method?.scenario_mode !== 'ma_and_ipo') return false
  const ma = payload.scenarios?.ma || {}
  const ipo = payload.scenarios?.ipo || {}
  const n = (v, fb) => Number(v ?? fb)
  const sameRate = n(ma.discount_rate, assumptions.discount_rate) === n(ipo.discount_rate, assumptions.discount_rate)
  const samePe = n(ma.exit_pe, assumptions.exit_pe) === n(ipo.exit_pe, assumptions.exit_pe)
  const samePs = n(ma.exit_ps, assumptions.exit_ps) === n(ipo.exit_ps, assumptions.exit_ps)
  return sameRate && samePe && samePs
}

function patchWacc(assumptions, patchPayload, key, v) {
  patchPayload({
    assumptions: {
      ...assumptions,
      wacc_breakdown: { ...(assumptions.wacc_breakdown || {}), [key]: v == null || v === '' ? null : v },
    },
  })
}

function buildWaccFields({ assumptions, patchPayload }) {
  const w = assumptions.wacc_breakdown || {}
  return [
    {
      label: '无风险利率',
      control: <PctInput value={w.risk_free_rate} onChange={(v) => patchWacc(assumptions, patchPayload, 'risk_free_rate', v)} />,
    },
    {
      label: 'ERP',
      control: <PctInput value={w.erp} onChange={(v) => patchWacc(assumptions, patchPayload, 'erp', v)} />,
    },
    {
      label: 'Beta',
      control: (
        <DcfNumInput precision={2} value={w.beta} onChange={(v) => patchWacc(assumptions, patchPayload, 'beta', v)} />
      ),
    },
    {
      label: 'D/E',
      control: (
        <DcfNumInput precision={4} value={w.debt_equity} onChange={(v) => patchWacc(assumptions, patchPayload, 'debt_equity', v)} />
      ),
    },
    {
      label: '债务成本',
      control: <PctInput value={w.debt_cost} onChange={(v) => patchWacc(assumptions, patchPayload, 'debt_cost', v)} />,
    },
    {
      label: '所得税率',
      control: (
        <PctInput
          value={assumptions.tax_rate}
          onChange={(v) => patchPayload({ assumptions: { ...assumptions, tax_rate: v } })}
        />
      ),
    },
  ]
}

function dayFallback(assumptions, wc, key) {
  const own = assumptions?.[`forecast_${key}`]
  if (own != null && own !== '') return own
  const median = wc?.[`${key}_median`]
  return median == null || median === '' ? null : median
}

function shownForecastDay(pl, assumptions, wc, key, index) {
  const own = pl?.[key]?.[index]
  if (own != null && own !== '') return own
  const fallback = dayFallback(assumptions, wc, key)
  return fallback == null ? undefined : fallback
}

function forecastDaysView(payload) {
  const assumptions = payload?.assumptions || {}
  const pl = payload?.targetPl || {}
  const wc = payload?.sheets?.working_capital?.payload || {}
  const series = payload?.sheets?.dcf?.payload?.primary?.series
  const entries = forecastYearEntries(pl, assumptions.valuation_date)
  const fromCalc = Array.isArray(series?.years) && series.years.length > 0
  const years = fromCalc
    ? series.years.map((year) => String(year))
    : entries.map(({ y }) => String(yearNum(y) || y))
  const rows = [
    { key: 'dso', name: 'DSO' },
    { key: 'dpo', name: 'DPO' },
    { key: 'dio', name: '存货周转天数' },
  ].map((row) => ({
    ...row,
    values: years.map((_, i) => {
      if (fromCalc && series[row.key]?.[i] != null && series[row.key][i] !== '') return series[row.key][i]
      const index = entries[i]?.i
      return index == null ? null : shownForecastDay(pl, assumptions, wc, row.key, index)
    }),
  }))
  return { years, rows, fromCalc }
}

function TurnoverDefaultRow({ assumptions, payload, patchPayload, payloadRef }) {
  const wc = payload?.sheets?.working_capital?.payload || {}
  const pl = payload?.targetPl || {}
  const years = forecastYearEntries(pl, assumptions?.valuation_date)
  const rows = [
    { key: 'dso', name: 'DSO' },
    { key: 'dpo', name: 'DPO' },
    { key: 'dio', name: '存货周转天数' },
  ]
  return (
    <div className="valuation-dcf-param-block valuation-day-default">
      <div className="valuation-dcf-param-head">
        <Typography.Title heading={6} className="valuation-ratio-col-title">周转天数预测默认值</Typography.Title>
        <Tag className="valuation-edit-tag" size="small">可编辑</Tag>
      </div>
      {!years.length ? (
        <Typography.Paragraph className="valuation-dcf-terminal-hint">请先在标的利润表保留预测年。</Typography.Paragraph>
      ) : (
        <ListTable
          className="valuation-forecast-days"
          rowKey="key"
          pagination={false}
          size="small"
          showSeq={false}
          scroll={{ x: 160 + years.length * 112 }}
          columns={[
            { title: '天数', dataIndex: 'name', width: 140, fixed: 'left', className: 'valuation-nowrap-cell' },
            ...years.map(({ y, i }) => ({
              title: forecastYearLabel(y),
              width: 112,
              align: 'right',
              className: 'valuation-num-cell valuation-nowrap-cell',
              render: (_, row) => (
                <InputNumber
                  hideControl
                  size="small"
                  precision={1}
                  style={{ width: '100%' }}
                  value={shownForecastDay(pl, assumptions, wc, row.key, i)}
                  onChange={(nv) => {
                    const base = payloadRef.current || {}
                    const plNow = base.targetPl || pl
                    const arr = [...(plNow[row.key] || [])]
                    const fallback = dayFallback(base.assumptions || assumptions, wc, row.key)
                    const cleared = nv == null || nv === '' || (fallback != null && Number(nv) === Number(fallback))
                    arr[i] = cleared ? null : nv
                    patchPayload({ targetPl: { [row.key]: arr } })
                  }}
                />
              ),
            })),
          ]}
          data={rows}
        />
      )}
      <Typography.Paragraph className="valuation-dcf-terminal-hint">
        按预测年填写，年份后的 E 表示预测。某一格清空后，沿用原来的统一默认值；统一默认也空着时，用可比公司年报截面中位数。填 0 视为已填，并优先于默认值和中位数。
      </Typography.Paragraph>
    </div>
  )
}

function waccHint(assumptions, payload) {
  const w = assumptions.wacc_breakdown || {}
  const preview = previewWaccBreakdown(w, assumptions.discount_rate, assumptions.tax_rate)
  const body = preview.used_breakdown
    ? `Ke = 无风险利率 + Beta × ERP = ${fmtPct(preview.ke, 1)}；WACC = We×Ke + Wd×Kd×(1−t) = ${fmtPct(preview.rate, 1)}。填齐无风险利率、ERP、Beta 后覆盖汇总折现率。D/E、债务成本可空。`
    : 'WACC 分项可空。填齐无风险利率、ERP、Beta 后覆盖汇总折现率，否则用汇总折现率（默认 30%）。'
  const last = payload?.wacc?.used_breakdown ? ` 上次计算：WACC ${fmtPct(payload.wacc.rate, 1)}。` : ''
  return body + last
}

function DiscountWaccLine({ method, assumptions, payload, patchPayload, singleRow = false }) {
  const fields = [
    ...buildDcfParamFields({ method, assumptions, payload, patchPayload }),
    ...buildWaccFields({ assumptions, patchPayload }),
  ]
  return (
    <div className={singleRow ? 'valuation-dcf-param-line valuation-dcf-param-line-single' : 'valuation-dcf-param-line'}>
      {fields.map((f) => (
        <div key={f.label} className="valuation-dcf-param-item">
          <span title={f.label}>{f.label}</span>
          {f.control}
        </div>
      ))}
    </div>
  )
}

const MARKET_MULTIPLE_KEYS = [
  'ps_low_multiple',
  'ps_median_multiple',
  'pe_low_multiple',
  'pe_median_multiple',
]

function filledMultiple(v) {
  return v != null && v !== ''
}

function marketPoolFallback(payload) {
  const market = payload?.sheets?.market?.payload || {}
  const poolPs = market.pool_ps_multiples || {}
  const poolPe = market.pool_pe_multiples || {}
  const usedPs = market.ps_multiples || {}
  const usedPe = market.pe_multiples || {}
  return {
    ps_low_multiple: poolPs.min ?? usedPs.min,
    ps_median_multiple: poolPs.median ?? usedPs.median,
    pe_low_multiple: poolPe.min ?? usedPe.min,
    pe_median_multiple: poolPe.median ?? usedPe.median,
  }
}

function MarketMultiplesBlock({ assumptions, payload, patchPayload }) {
  const pool = marketPoolFallback(payload)
  const locked = MARKET_MULTIPLE_KEYS.some((k) => filledMultiple(assumptions[k]))
  const shown = {
    ps_low_multiple: filledMultiple(assumptions.ps_low_multiple) ? assumptions.ps_low_multiple : pool.ps_low_multiple,
    ps_median_multiple: filledMultiple(assumptions.ps_median_multiple) ? assumptions.ps_median_multiple : pool.ps_median_multiple,
    pe_low_multiple: filledMultiple(assumptions.pe_low_multiple) ? assumptions.pe_low_multiple : pool.pe_low_multiple,
    pe_median_multiple: filledMultiple(assumptions.pe_median_multiple) ? assumptions.pe_median_multiple : pool.pe_median_multiple,
  }
  const patchOne = (key, v) => {
    const next = {}
    MARKET_MULTIPLE_KEYS.forEach((k) => {
      next[k] = filledMultiple(assumptions[k]) ? assumptions[k] : pool[k]
    })
    next[key] = v
    patchPayload({ assumptions: { ...assumptions, ...next } })
  }
  const followPool = () => {
    patchPayload({
      assumptions: {
        ...assumptions,
        ps_low_multiple: null,
        ps_median_multiple: null,
        pe_low_multiple: null,
        pe_median_multiple: null,
      },
    })
  }
  const rows = [
    { name: 'P/S', low: 'ps_low_multiple', high: 'ps_median_multiple' },
    { name: 'P/E', low: 'pe_low_multiple', high: 'pe_median_multiple' },
  ]
  return (
    <div className="valuation-dcf-param-block">
      <div className="valuation-dcf-param-head">
        <Typography.Title heading={6} className="valuation-ratio-col-title">市场法倍数</Typography.Title>
        <Tag className="valuation-edit-tag" size="small">{locked ? '已锁定' : '跟随 POOL'}</Tag>
        {locked ? (
          <Button size="mini" type="text" onClick={followPool}>跟随 POOL</Button>
        ) : null}
      </div>
      {rows.map((row) => (
        <div key={row.name} className="valuation-dcf-param-grid">
          <div className="valuation-dcf-param-item">
            <span>{row.name} 低端</span>
            <DcfNumInput precision={2} value={shown[row.low]} onChange={(v) => patchOne(row.low, v)} />
          </div>
          <div className="valuation-dcf-param-item">
            <span>{row.name} 高端</span>
            <DcfNumInput precision={2} value={shown[row.high]} onChange={(v) => patchOne(row.high, v)} />
          </div>
        </div>
      ))}
      <Typography.Paragraph className="valuation-dcf-terminal-hint">
        {locked
          ? '已按填写值覆盖 POOL。点「跟随 POOL」后再点「开始采集/计算/保存」，会重新用可比股算出的低端和高端。'
          : 'P/S、P/E 各一行。低端 = POOL 中位数 − σ，高端 = POOL 中位数。改数字会锁定，点「开始采集/计算/保存」时不再跟 POOL。'}
      </Typography.Paragraph>
    </div>
  )
}

function buildDcfParamFields({ method, assumptions, payload, patchPayload }) {
  const waccPreview = previewWaccBreakdown(assumptions.wacc_breakdown, assumptions.discount_rate, assumptions.tax_rate)
  const fields = [
    {
      label: '汇总折现率',
      control: (
        <PctInput
          disabled={waccPreview.used_breakdown}
          value={waccPreview.used_breakdown ? waccPreview.rate : (assumptions.discount_rate ?? 0.3)}
          onChange={(v) => patchPayload({ assumptions: { ...assumptions, discount_rate: v } })}
        />
      ),
    },
  ]
  if (method.scenario_mode !== 'ma_and_ipo') {
    fields.push(
      {
        label: '退出 P/E',
        control: (
          <DcfNumInput
            value={assumptions.exit_pe ?? 40}
            onChange={(v) => patchPayload({ assumptions: { ...assumptions, exit_pe: v } })}
          />
        ),
      },
      {
        label: '退出 P/S',
        control: (
          <DcfNumInput
            value={assumptions.exit_ps ?? 20}
            onChange={(v) => patchPayload({ assumptions: { ...assumptions, exit_ps: v } })}
          />
        ),
      },
    )
  }
  fields.push({
    label: '市场法折扣',
    control: (
      <PctInput
        value={assumptions.liquidity_discount ?? 0.3}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, liquidity_discount: v } })}
      />
    ),
  })
  const dcfLiqApplies = method.scenario_mode === 'ma_and_ipo' || method.fcf_method === 'nopat_fcff'
  if (dcfLiqApplies) {
    fields.push({
      label: method.scenario_mode === 'ma_and_ipo' ? '并购折扣' : 'DCF 折扣',
      control: (
        <PctInput
          value={assumptions.dcf_liquidity_discount ?? assumptions.liquidity_discount ?? 0.3}
          onChange={(v) => patchPayload({ assumptions: { ...assumptions, dcf_liquidity_discount: v } })}
        />
      ),
    })
  }
  const esopField = {
    label: 'ESOP',
    control: (
      <DcfNumInput
        {...wanInputNumberProps}
        value={assumptions.esop ?? 0}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, esop: v ?? 0 } })}
      />
    ),
  }
  if (method.scenario_mode === 'ma_and_ipo') {
    fields.push(
      {
        label: '上市折现率',
        control: (
          <PctInput
            value={payload.scenarios?.ipo?.discount_rate}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ipo', 'discount_rate', v))}
          />
        ),
      },
      {
        label: '并购折现率',
        control: (
          <PctInput
            value={payload.scenarios?.ma?.discount_rate}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ma', 'discount_rate', v))}
          />
        ),
      },
      esopField,
    )
    fields.push(
      {
        label: '上市退出 P/E',
        control: (
          <DcfNumInput
            value={payload.scenarios?.ipo?.exit_pe ?? assumptions.exit_pe ?? 40}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ipo', 'exit_pe', v))}
          />
        ),
      },
      {
        label: '上市退出 P/S',
        control: (
          <DcfNumInput
            value={payload.scenarios?.ipo?.exit_ps ?? assumptions.exit_ps ?? 20}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ipo', 'exit_ps', v))}
          />
        ),
      },
      {
        label: '并购退出 P/E',
        control: (
          <DcfNumInput
            value={payload.scenarios?.ma?.exit_pe ?? assumptions.exit_pe ?? 40}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ma', 'exit_pe', v))}
          />
        ),
      },
      {
        label: '并购退出 P/S',
        control: (
          <DcfNumInput
            value={payload.scenarios?.ma?.exit_ps ?? assumptions.exit_ps ?? 20}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ma', 'exit_ps', v))}
          />
        ),
      },
    )
  } else {
    fields.push(esopField)
  }
  return fields
}

function splitValuationNotices(list) {
  const info = []
  const warn = []
  for (const w of list || []) {
    const m = String(w)
    if (/实时截面超时|东方财富(实时)?行情超时|东方财富接口超时|socket hang up|本次不会写入失败行情|可能不是今日截面|实时截面无效/i.test(m)) {
      continue
    }
    if (m.startsWith('待补：')) continue
    if (/已跳过抓取|仅用库内数据重算|市场法按(锚定日|今天)|折现率已用 WACC|WACC 分项未填齐|行业法：/.test(m)) {
      info.push(m)
      continue
    }
    warn.push(m)
  }
  return { info, warn }
}

export default function ValuationWorkbenchPage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const [step, setStep] = useState('method')
  const [cse, setCse] = useState(null)
  const [payload, setPayload] = useState(null)
  const [comps, setComps] = useState([])
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [compFinancials, setCompFinancials] = useState([])
  const [compFinLoading, setCompFinLoading] = useState(false)
  const [viewingKey, setViewingKey] = useState('draft')
  const [archiveDealYi, setArchiveDealYi] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportIds, setExportIds] = useState(['draft'])
  const [exporting, setExporting] = useState(false)
  const [industryStatus, setIndustryStatus] = useState({ available: true, message: '' })
  const [industryNames, setIndustryNames] = useState([])
  const [draftYi, setDraftYi] = useState(null)
  const [anchorTipOpen, setAnchorTipOpen] = useState(false)
  const pollRef = useRef(null)
  const saveTimer = useRef(null)
  const payloadRef = useRef(null)
  const viewingKeyRef = useRef('draft')
  viewingKeyRef.current = viewingKey
  const isDraftView = viewingKey === 'draft'
  const archivedVersions = cse?.versions || []

  const method = payload?.methodConfig || {}
  const assumptions = payload?.assumptions || {}
  const enterpriseName = cse?.subject?.enterprise_full_name
    || cse?.subject?.live_name
    || cse?.subject?.display_name
    || cse?.subject_display_name
    || ''

  const refreshIndustryMeta = useCallback(() => {
    fetchIndustryMultiplesStatus().then((r) => {
      if (r.data?.success) setIndustryStatus(r.data.data || { available: true })
    }).catch(() => setIndustryStatus({ available: true, message: '计算时按申万三级现算，抓不到则回退个股 POOL' }))
    fetchSwIndustryNames().then((r) => {
      if (r.data?.success) setIndustryNames(r.data.data || [])
    }).catch(() => {})
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setViewingKey('draft')
    try {
      const [cRes, dRes, cmpRes] = await Promise.all([
        fetchValuationCase(caseId),
        fetchValuationDraft(caseId),
        fetchCaseComparables(caseId),
      ])
      if (!cRes.data?.success) {
        Message.error(cRes.data?.message || '案件不存在')
        return
      }
      setCse(cRes.data.data)
      const raw = dRes.data?.data?.payload || {}
      const next = coercePayloadToYuan(raw)
      setPayload(next)
      setDraftYi(next.comparison?.display_yi || null)
      if (next !== raw && next.amount_unit === 'yuan' && raw.amount_unit !== 'yuan') {
        putValuationDraft(caseId, next).catch(() => {})
      }
      setComps(cmpRes.data?.data?.list || [])
      fetchComparableFinancials(caseId).then((r) => setCompFinancials(r.data?.data?.list || [])).catch(() => {})
      refreshIndustryMeta()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [caseId, refreshIndustryMeta])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (method.multiple_source !== 'sw_industry_median') return undefined
    refreshIndustryMeta()
    return undefined
  }, [method.multiple_source, refreshIndustryMeta])

  const persist = useCallback((next) => {
    const withUnit = { ...(next || {}), amount_unit: 'yuan' }
    payloadRef.current = withUnit
    setPayload(withUnit)
    if (viewingKeyRef.current !== 'draft') return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      putValuationDraft(caseId, withUnit).catch(() => {})
    }, 600)
  }, [caseId])

  useEffect(() => {
    payloadRef.current = payload
  }, [payload])

  const patchPayload = (partial) => {
    const base = payloadRef.current || payload || {}
    const next = { ...base }
    Object.entries(partial || {}).forEach(([key, value]) => {
      const prev = base[key]
      if (key === 'forecastBs' || key === 'forecastPl') {
        next[key] = value
      } else if (
        value && prev
        && typeof value === 'object' && typeof prev === 'object'
        && !Array.isArray(value) && !Array.isArray(prev)
      ) {
        next[key] = { ...prev, ...value }
      } else {
        next[key] = value
      }
    })
    persist(next)
  }

  const adoptImportedPayload = (next, meta) => {
    clearTimeout(saveTimer.current)
    const withUnit = { ...(next || {}), amount_unit: 'yuan' }
    payloadRef.current = withUnit
    setPayload(withUnit)
    if (meta?.case_round_updated) {
      setCse((prev) => ({ ...(prev || {}), round_deal_value_yi: meta.case_round_deal_value_yi }))
    }
  }

  const loadCompFinancials = useCallback(async () => {
    setCompFinLoading(true)
    try {
      const res = await fetchComparableFinancials(caseId)
      setCompFinancials(res.data?.data?.list || [])
    } catch {
      setCompFinancials([])
    } finally {
      setCompFinLoading(false)
    }
  }, [caseId])

  const startPoll = (jobId) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchValuationJob(jobId)
        const j = res.data?.data
        setJob(j)
        if (j?.status === 'success' || j?.status === 'failed') {
          clearInterval(pollRef.current)
          if (j.status === 'success') {
            const dRes = await fetchValuationDraft(caseId)
            const next = coercePayloadToYuan(dRes.data?.data?.payload || {})
            setPayload(next)
            setDraftYi(next.comparison?.display_yi || null)
            loadCompFinancials()
            refreshIndustryMeta()
            Message.success(j.message || '计算完成（已写入草稿）')
            setStep('result')
          } else {
            Message.error(j.message || '任务失败')
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }, 1500)
  }

  useEffect(() => () => {
    clearInterval(pollRef.current)
    clearTimeout(saveTimer.current)
  }, [])

  const runJob = async () => {
    if (!isDraftView) {
      Message.warning('请先切换到当前草稿，或「发起新版本」后再采集/计算')
      return
    }
    if (!method.confirmed) {
      Message.warning('请先在「方法配置」确认后再开跑')
      setStep('method')
      return
    }
    try {
      const focused = document.activeElement
      if (focused && focused !== document.body && typeof focused.blur === 'function') focused.blur()
      await new Promise((resolve) => setTimeout(resolve, 50))
      clearTimeout(saveTimer.current)
      const body = { ...(payloadRef.current || payload), amount_unit: 'yuan' }
      payloadRef.current = body
      setPayload(body)
      await putValuationDraft(caseId, body)
      const currentStamp = buildCalcStamp(body, comps)
      const jobType = !body.calc_stamp || needsRefetch(body.calc_stamp, currentStamp)
        ? 'fetch_and_calc'
        : 'calc_only'
      const res = await postValuationJob(caseId, { job_type: jobType })
      if (res.status === 202 || res.data?.success) {
        const jobId = res.data.data.job_id
        setJob({ id: jobId, status: 'queued', progress: 0, message: res.data.message })
        startPoll(jobId)
      } else {
        Message.error(res.data?.message || '提交失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '提交失败')
    }
  }

  const saveVersion = async () => {
    if (!isDraftView) {
      Message.warning('请切换到当前草稿后再保存版本')
      return
    }
    const staleNow = payload?.calc_stamp
      ? diffCalcStamp(payload.calc_stamp, buildCalcStamp(payload, comps))
      : []
    if (staleNow.length) {
      Message.warning('输入已修改，请先点「开始采集/计算/保存」')
      return
    }
    Modal.confirm({
      title: '保存正式版本',
      content: '将当前草稿冻结为新版本（vN）。已保存版本不受后续抓取影响。',
      onOk: async () => {
        try {
          await putValuationDraft(caseId, payload)
          const res = await postValuationVersion(caseId)
          if (res.data?.success) {
            Message.success(`已保存 v${res.data.data.version_no}`)
            loadAll()
          } else {
            Message.error(res.data?.message || '保存失败')
          }
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '保存失败')
        }
      },
    })
  }

  const switchVersion = async (key) => {
    clearTimeout(saveTimer.current)
    setViewingKey(key)
    setLoading(true)
    try {
      if (key === 'draft') {
        const dRes = await fetchValuationDraft(caseId)
        const next = coercePayloadToYuan(dRes.data?.data?.payload || {})
        setPayload(next)
        setArchiveDealYi(null)
        setDraftYi(next.comparison?.display_yi || draftYi)
      } else {
        const res = await fetchValuationVersion(key)
        if (!res.data?.success) {
          Message.error(res.data?.message || '加载版本失败')
          setViewingKey('draft')
          return
        }
        setArchiveDealYi(res.data.data.round_deal_value_yi)
        setPayload(coercePayloadToYuan(res.data.data.payload || {}))
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载版本失败')
      setViewingKey('draft')
    } finally {
      setLoading(false)
    }
  }

  const startNewVersion = () => {
    if (!archivedVersions.length) {
      Message.warning('请先「保存版本」存档后再发起新版本')
      return
    }
    const fromId = viewingKey === 'draft' ? archivedVersions[0].id : viewingKey
    const fromNo = archivedVersions.find((v) => v.id === fromId)?.version_no
    Modal.confirm({
      title: '发起新版本',
      content: `将以已存档的 v${fromNo} 覆盖当前草稿。之后可继续编辑，再点「保存版本」生成新版本。已存档版本不会被改动。`,
      onOk: async () => {
        try {
          const res = await postValuationDraftFromVersion(caseId, fromId)
          if (!res.data?.success) {
            Message.error(res.data?.message || '发起失败')
            return
          }
          Message.success(`已从 v${fromNo} 生成新草稿，可继续编辑`)
          setViewingKey('draft')
          setPayload(coercePayloadToYuan(res.data.data.payload || {}))
          const cRes = await fetchValuationCase(caseId)
          if (cRes.data?.success) setCse(cRes.data.data)
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '发起失败')
        }
      },
    })
  }

  const triggerDownload = (blob, filename) => {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const openExportModal = () => {
    setExportIds([viewingKey === 'draft' ? 'draft' : viewingKey])
    setExportOpen(true)
  }

  const confirmExport = async () => {
    if (!exportIds.length) {
      Message.warning('请至少选择一个版本')
      return
    }
    setExporting(true)
    try {
      const baseName = cse?.subject?.display_name || '估值'
      for (let i = 0; i < exportIds.length; i += 1) {
        const id = exportIds[i]
        const isDraft = id === 'draft'
        const res = await downloadValuationExport(caseId, isDraft ? undefined : id)
        const ver = archivedVersions.find((v) => v.id === id)
        const filename = isDraft
          ? `${baseName}-草稿.xlsx`
          : `${baseName}-v${ver?.version_no || ''}.xlsx`
        triggerDownload(res.data, filename)
        if (i < exportIds.length - 1) {
          await new Promise((r) => setTimeout(r, 400))
        }
      }
      setExportOpen(false)
      Message.success(exportIds.length > 1 ? `已导出 ${exportIds.length} 个文件` : '已导出')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const comparison = payload?.comparison?.display_yi
  const staleLines = isDraftView && payload?.calc_stamp
    ? diffCalcStamp(payload.calc_stamp, buildCalcStamp(payload, comps))
    : []
  const dealYi = isDraftView ? cse?.round_deal_value_yi : archiveDealYi
  const dilution = payload?.assumptions?.follow_on_dilution
  const liveDraftYi = isDraftView ? (comparison || draftYi) : draftYi
  const notices = splitValuationNotices(payload?.warnings || [])
  const blockerLines = (payload?.warnings || [])
    .map((w) => String(w))
    .filter((w) => w.startsWith('待补：'))
    .map((w) => w.replace(/^待补：/, ''))
  const industrySelectOptions = (() => {
    const opts = industryNames.map((x) => ({
      value: x.name,
      label: x.l1 ? `${x.name}（${x.l1} / ${x.l2}）` : x.name,
    }))
    const cur = String(payload?.sw_industry_l3 || '').trim()
    if (cur && !opts.some((o) => o.value === cur)) {
      opts.unshift({ value: cur, label: `${cur}（不在现行三级，请重选）` })
    }
    return opts
  })()

  const pl = payload?.targetPl || emptyPl()
  const nwcWan = computedNwcWan(payload?.targetBs)

  if (loading || !payload) {
    return <div className="valuation-page">加载中…</div>
  }

  return (
    <div className="valuation-workbench">
      <aside className="valuation-workbench-nav">
        <button type="button" className="valuation-nav-back" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        {NAV_GROUPS.map((group) => (
          <React.Fragment key={group.key}>
            {group.divider ? <div className="valuation-nav-divider">{group.divider}</div> : null}
            <div className={`valuation-nav-group valuation-nav-group-${group.tone}`}>
              <div className="valuation-nav-group-label">{group.label}</div>
              {group.items.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`valuation-step-item${step === s.key ? ' active' : ''}`}
                  onClick={() => {
                    setStep(s.key)
                    if (s.key === 'comp_pl' || s.key === 'comp_bs' || s.key === 'comp_cf') {
                      loadCompFinancials()
                    }
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}
      </aside>
      <main className="valuation-workbench-main">
        <div className="valuation-toolbar">
          <Typography.Title heading={5} style={{ margin: 0, flex: 1 }}>
            {cse?.subject?.display_name || '估值工作台'}
            {cse?.case_type === 'pre_investment' ? ' · 投前' : ' · 投后'}
            {!isDraftView ? <Tag color="orangered" style={{ marginLeft: 8 }}>只读存档</Tag> : null}
          </Typography.Title>
          <Select
            value={viewingKey}
            onChange={switchVersion}
            style={{ width: 240 }}
            size="small"
          >
            <Select.Option value="draft">当前草稿</Select.Option>
            {archivedVersions.map((v) => (
              <Select.Option key={v.id} value={v.id}>
                {`v${v.version_no} · ${formatChinaDateTime(v.created_at)}`}
              </Select.Option>
            ))}
          </Select>
          <Button
            type="primary"
            disabled={!isDraftView || (!!job && (job.status === 'queued' || job.status === 'running'))}
            onMouseDown={() => {
              const focused = document.activeElement
              if (focused && focused !== document.body && typeof focused.blur === 'function') focused.blur()
            }}
            onClick={runJob}
          >
            开始采集/计算/保存
          </Button>
          <Button onClick={() => setDetailOpen(true)} disabled={!payload.sheets}>明细</Button>
          <Button onClick={saveVersion} disabled={!isDraftView || staleLines.length > 0}>保存版本</Button>
          <Button onClick={startNewVersion} disabled={!archivedVersions.length}>发起新版本</Button>
          <Button onClick={openExportModal}>导出 xlsx</Button>
        </div>
        {job && (job.status === 'queued' || job.status === 'running') ? (
          <Progress percent={job.progress || 0} formatText={() => job.message || ''} style={{ marginBottom: 12 }} />
        ) : null}
        {notices.info.length ? <Alert type="info" content={notices.info.join('；')} style={{ marginBottom: 12 }} /> : null}
        {notices.warn.length ? <Alert type="warning" content={notices.warn.join('；')} style={{ marginBottom: 12 }} /> : null}

        {step === 'method' && (
          <Card title="计算前方法配置（未确认不得开跑）" bordered={false}>
            <div className="valuation-method-config-row">
              <div className="valuation-method-field">
                <span>终值</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.terminal_type}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, terminal_type: v, confirmed: false } })}
                  options={[
                    { value: 'exit_pe', label: '退出 P/E × 末期税后经营利润' },
                    { value: 'exit_ps', label: '退出 P/S × 末期收入' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>现金流</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.fcf_method}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, fcf_method: v, confirmed: false } })}
                  options={[
                    { value: 'ni_bridge', label: '净利润桥' },
                    { value: 'nopat_fcff', label: 'NOPAT / FCFF' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>情景</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.scenario_mode}
                  onChange={(v) => {
                    const next = { ...method, scenario_mode: v, confirmed: false }
                    if (v !== 'ma_and_ipo') {
                      patchPayload({ methodConfig: next })
                      return
                    }
                    const seed = (key, name) => ({
                      name,
                      discount_rate: payload.scenarios?.[key]?.discount_rate ?? null,
                      exit_pe: payload.scenarios?.[key]?.exit_pe ?? assumptions.exit_pe ?? 40,
                      exit_ps: payload.scenarios?.[key]?.exit_ps ?? assumptions.exit_ps ?? 20,
                    })
                    patchPayload({
                      methodConfig: next,
                      scenarios: { ma: seed('ma', '并购预期'), ipo: seed('ipo', '上市预期') },
                    })
                  }}
                  options={[
                    { value: 'single', label: '单套' },
                    { value: 'ma_and_ipo', label: '并购 + 上市并排' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>倍数来源</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.multiple_source}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, multiple_source: v, confirmed: false } })}
                  options={[
                    { value: 'stock_pool', label: '个股 POOL' },
                    { value: 'sw_industry_median', label: '申万三级中位数' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span className="valuation-anchor-label">
                  估值锚定日 <span style={{ color: '#f53f3f' }}>*</span>
                  <Tooltip
                    content={ANCHOR_DATE_HELP}
                    position="top"
                    getPopupContainer={() => document.body}
                    popupVisible={(!!payload && !statementAnchor(assumptions.valuation_date)) || anchorTipOpen}
                    onVisibleChange={setAnchorTipOpen}
                  >
                    <IconQuestionCircle className="valuation-help-icon" />
                  </Tooltip>
                </span>
                <DatePicker
                  size="small"
                  style={{ width: '100%' }}
                  allowClear
                  format="YYYY-MM-DD"
                  placeholder="请选择最近一期报表日"
                  getPopupContainer={() => document.body}
                  disabledDate={(current) => {
                    const ymd = formatChinaYmd(current)
                    return !ymd || !/-(03-31|06-30|09-30|12-31)$/.test(ymd)
                  }}
                  status={statementAnchor(assumptions.valuation_date) ? undefined : 'error'}
                  value={assumptions.valuation_date || undefined}
                  onChange={(dateString, date) => {
                    const ymd = formatChinaYmd(date) || formatChinaYmd(dateString) || null
                    const nextPl = { ...(payload.targetPl || emptyPl()) }
                    if (!ratiosTouched(nextPl)) {
                      nextPl.years = defaultForecastYears(ymd, assumptions.forecast_years)
                    }
                    patchPayload({
                      assumptions: { ...assumptions, valuation_date: ymd },
                      methodConfig: { ...method, confirmed: false },
                      targetPl: nextPl,
                    })
                  }}
                />
              </div>
              {method.multiple_source === 'sw_industry_median' ? (
                <>
                  <div className="valuation-method-field">
                    <span>行业统计</span>
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      getPopupContainer={() => document.body}
                      triggerProps={{ autoAlignPopupWidth: true }}
                      value={method.industry_stat_method}
                      onChange={(v) => patchPayload({ methodConfig: { ...method, industry_stat_method: v, confirmed: false } })}
                      options={[
                        { value: 'arithmetic', label: '算术平均' },
                        { value: 'overall', label: '整体法' },
                      ]}
                    />
                  </div>
                  <div className="valuation-method-field valuation-method-field-wide">
                    <span>申万三级</span>
                    <Select
                      size="small"
                      showSearch
                      allowClear
                      style={{ width: '100%' }}
                      getPopupContainer={() => document.body}
                      triggerProps={{ autoAlignPopupWidth: true }}
                      placeholder="搜索并选择申万三级行业"
                      value={payload.sw_industry_l3 || undefined}
                      onChange={(v) => patchPayload({ sw_industry_l3: v || '', methodConfig: { ...method, confirmed: false } })}
                      filterOption={(input, option) => {
                        const q = String(input || '').trim().toLowerCase()
                        if (!q) return true
                        const text = [
                          option?.value,
                          option?.label,
                          option?.props?.value,
                          option?.props?.children,
                        ].filter(Boolean).join(' ')
                        return String(text).toLowerCase().includes(q)
                      }}
                      options={industrySelectOptions}
                    />
                  </div>
                </>
              ) : null}
              <div className="valuation-method-confirm">
                <Button
                  type="primary"
                  size="small"
                  onClick={() => {
                    if (method.multiple_source === 'sw_industry_median' && !String(payload.sw_industry_l3 || '').trim()) {
                      Message.warning('请先选择申万三级行业')
                      return
                    }
                    if (!statementAnchor(assumptions.valuation_date)) {
                      Message.warning('请选择估值锚定日，须为最近一期报表日')
                      return
                    }
                    const next = { ...method, confirmed: true }
                    patchPayload({ methodConfig: next })
                    patchValuationCase(caseId, { method_config: next }).catch(() => {})
                    Message.success('已确认方法配置，可以开跑')
                  }}
                >
                  确认
                </Button>
                <Typography.Text type={method.confirmed ? 'success' : 'warning'}>
                  {method.confirmed ? '已确认' : '尚未确认'}
                </Typography.Text>
              </div>
            </div>
            <div className="valuation-dcf-param-block" style={{ marginTop: 16 }}>
              <div className="valuation-dcf-param-head">
                <Typography.Title heading={6} className="valuation-ratio-col-title">折现、退出与 WACC</Typography.Title>
                <Tag className="valuation-edit-tag" size="small">未填用默认值</Tag>
              </div>
              <DiscountWaccLine method={method} assumptions={assumptions} payload={payload} patchPayload={patchPayload} />
              <Typography.Paragraph className="valuation-dcf-terminal-hint">
                折现率默认 30%，退出 P/E 默认 40，退出 P/S 默认 20，流动性折扣默认 30%，ESOP 默认 0。这里改完，计算输出用同一组数。{waccHint(assumptions, payload)}
              </Typography.Paragraph>
            </div>
            <Typography.Paragraph type="secondary" className="valuation-dcf-terminal-hint">
              退出 P/E 和退出 P/S 都会算一笔终值。结果对比里的 DCF 区间，低端和高端就是这两笔股权价值。明细表按上面「终值」选定的那一套展开。
            </Typography.Paragraph>
            {!isDefaultMethodConfig(method) ? (
              <Alert
                type="warning"
                style={{ marginTop: 12, marginBottom: 12 }}
                content="自由现金流 = 期间税后经营利润 + 期间折旧摊销 + 期间 ESOP − 期间资本开支 − ΔNWC。锚定年且不是 12 月时，期间数 = 年底全年 − 锚定日累计，ESOP 按剩余月。方法里的「净利润桥 / NOPAT」只决定单套情景是否乘 DCF 流动性折扣：选 NOPAT 才乘，选净利润桥不乘。双情景仍只有并购乘。"
              />
            ) : null}
            {method.multiple_source === 'sw_industry_median' ? (
              <Alert type="info" content={industryStatus.message || '计算时按申万三级从东财成分 + 库内历史中位汇总；找不到则回退个股 POOL'} style={{ marginBottom: 12 }} />
            ) : null}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              改锚定日、折现率、流动性折扣或上方选项后，会记入左侧「变更记录」（三表数字不记）。
            </Typography.Paragraph>
            <ValuationMethodGuide />
          </Card>
        )}

        {step === 'comps' && (
          <Card title="可比上市公司" bordered={false}>
            <ComparableCompsPanel
              caseId={caseId}
              isDraftView={isDraftView}
              comps={comps}
              setComps={setComps}
            />
          </Card>
        )}

        {step === 'pl' && (
          <Card title="标的利润表（录入单位：元）" bordered={false}>
            <TargetFinancialImportBar caseId={caseId} valuationDate={assumptions.valuation_date} enterpriseName={enterpriseName} onImported={adoptImportedPayload} />
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              content="上面是锚定日当期金额。锚定日不是 12 月 31 日时，当年年底预估不在这张表里，请填在下面的预测利润表。收入增速按上一年营业收入，10 表示增长 10%。营业成本及后面的科目按当年营业收入的比例，95 表示 95%；填入的绝对值大于 10000 时，当作该年实际金额（元），不再乘收入。改当年年底收入后，按收入比例计算的后面年份会跟着变。财务费用不进入自由现金流。改完点「开始采集/计算/保存」，会先保存再计算。"
            />
            <StackedFieldTable
              style={{ marginBottom: 12 }}
              items={[
                {
                  name: '所得税率',
                  editor: (
                    <PctInput
                      min={0}
                      max={100}
                      value={assumptions.tax_rate}
                      onChange={(v) => patchPayload({ assumptions: { ...assumptions, tax_rate: v } })}
                    />
                  ),
                  note: '直接填数字，15 表示 15%。未填按 15%。已填须在 0 到 100 之间',
                },
                {
                  name: '累计营业收入',
                  editor: (
                    <WanInput
                      value={assumptions.ytd_revenue}
                      onChange={(v) => patchPayload({ assumptions: { ...assumptions, ytd_revenue: v } })}
                    />
                  ),
                  note: '估值锚定日当期累计营业收入，须为正数。锚定日不是 12 月 31 日时，DCF 当年年底收入改在预测利润表填写，不再用这里年化',
                },
                {
                  name: '市场法营业收入',
                  editor: (
                    <WanInput
                      value={assumptions.market_revenue}
                      onChange={(v) => patchPayload({ assumptions: { ...assumptions, market_revenue: v } })}
                    />
                  ),
                  note: '只给市场法 P/S 用，不进入 DCF 预测',
                },
                {
                  name: '市场法净利润',
                  editor: (
                    <WanInput
                      value={assumptions.market_net_income}
                      onChange={(v) => patchPayload({ assumptions: { ...assumptions, market_net_income: v } })}
                    />
                  ),
                  note: '只给市场法 P/E 用，不进入 DCF',
                },
              ]}
            />
            <Typography.Title heading={6}>当期（导入）</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {(() => {
                const anchor = statementAnchor(assumptions.valuation_date)
                return anchor
                  ? `左边是 ${anchor.year - 1}-12-31 上一年年末，右边是 ${anchor.ymd} 当期累计，单位元。改当期营业收入或净利润时，累计营业收入和市场法基数为空会一并带出。`
                  : '请先选择估值锚定日。上一年年末和当期金额都可以导入或手填。'
              })()}
            </Typography.Paragraph>
            <ListTable
              style={{ marginBottom: 16 }}
              rowKey="key"
              pagination={false}
              size="small"
              showSeq={false}
              scroll={{ x: 760 }}
              columns={[
                { title: '科目', dataIndex: 'name', width: 120, fixed: 'left', className: 'valuation-nowrap-cell' },
                {
                  title: (() => {
                    const anchor = statementAnchor(assumptions.valuation_date)
                    return anchor ? `${anchor.year - 1}-12-31` : '上一年年末'
                  })(),
                  width: 160,
                  align: 'right',
                  className: 'valuation-num-cell',
                  render: (_, row) => {
                    const anchor = statementAnchor(assumptions.valuation_date)
                    const year = anchor ? anchor.year - 1 : null
                    const idx = year == null ? -1 : (pl.years || []).findIndex((y) => yearNum(y) === year)
                    return (
                      <WanInput
                        value={idx >= 0 ? pl[row.key]?.[idx] : undefined}
                        onChange={(nv) => {
                          if (year == null) return
                          const base = payloadRef.current || {}
                          const nextPl = setPlYearAmount(base.targetPl || pl, year, row.key, nv)
                          patchPayload({ targetPl: nextPl })
                        }}
                      />
                    )
                  },
                },
                {
                  title: assumptions.valuation_date || '当期',
                  width: 160,
                  align: 'right',
                  className: 'valuation-num-cell',
                  render: (_, row) => (
                    <WanInput
                      value={(() => {
                        const idx = currentPlIndex(pl, assumptions.valuation_date)
                        return idx >= 0 ? pl[row.key]?.[idx] : undefined
                      })()}
                      onChange={(nv) => {
                        const base = payloadRef.current || {}
                        const plNow = base.targetPl || pl
                        const assumptionsNow = base.assumptions || assumptions
                        const beforeYears = (plNow.years || []).join('|')
                        const nextPl = setCurrentAmount(plNow, assumptionsNow.valuation_date, row.key, nv)
                        const yearInserted = (nextPl.years || []).join('|') !== beforeYears
                        const assumptionsPatch = {}
                        if (row.key === 'revenue' && (assumptionsNow.ytd_revenue == null || assumptionsNow.ytd_revenue === '')) {
                          assumptionsPatch.ytd_revenue = nv
                        }
                        if (row.key === 'revenue' && (assumptionsNow.market_revenue == null || assumptionsNow.market_revenue === '')) {
                          assumptionsPatch.market_revenue = nv
                        }
                        if (row.key === 'net_income' && (assumptionsNow.market_net_income == null || assumptionsNow.market_net_income === '')) {
                          assumptionsPatch.market_net_income = nv
                        }
                        patchPayload({
                          targetPl: yearInserted ? nextPl : { years: nextPl.years, [row.key]: nextPl[row.key] },
                          assumptions: assumptionsPatch,
                        })
                      }}
                    />
                  ),
                },
                { title: '说明', dataIndex: 'note', width: 280 },
              ]}
              data={CURRENT_PL_ROWS}
            />
            <ListTable
              rowKey="name"
              pagination={false}
              size="small"
              scroll={{ x: true }}
              columns={[
                { title: '科目', dataIndex: 'name', width: 200, fixed: 'left', className: 'valuation-nowrap-cell' },
                ...ratioYearEntries(pl, assumptions.valuation_date, payload.forecastPl).map(({ y, i }) => ({
                  align: 'right',
                  className: 'valuation-num-cell',
                  title: (
                    <div className="valuation-pl-year-head">
                      <Input
                        size="small"
                        value={y}
                        onChange={(nv) => {
                          const plNow = payloadRef.current?.targetPl || pl
                          const years = [...(plNow.years || [])]
                          years[i] = nv
                          patchPayload({ targetPl: { years } })
                        }}
                        />
                      <span className="valuation-pl-year-e">E</span>
                      {forecastYearEntries(pl, assumptions.valuation_date).length > 1 && i === (pl.years || []).length - 1 ? (
                        <Button
                          className="valuation-pl-year-remove"
                          type="text"
                          status="danger"
                          size="mini"
                          icon={<IconClose />}
                          aria-label={`删除${y}年`}
                          onClick={() => {
                            const plNow = payloadRef.current?.targetPl || pl
                            patchPayload({ targetPl: splicePlYear(plNow, i) })
                          }}
                        />
                      ) : null}
                    </div>
                  ),
                  dataIndex: `y${i}`,
                  width: 132,
                  render: (_, r) => (
                    r.key === 'revenue_growth' ? (
                      <PctInput
                        min={r.min}
                        max={500}
                        value={r.values[i]}
                        onChange={(nv) => r.onChange(i, nv)}
                      />
                    ) : (
                      <MixedRatioInput
                        value={r.values[i]}
                        onChange={(nv) => r.onChange(i, nv)}
                      />
                    )
                  ),
                })),
              ]}
              data={FORECAST_RATIO_ROWS.map((row) => {
                const rdGrowth = assumptions.rd_growth_mode !== 'share'
                const shown = row.key === 'rd_ratio' && !rdGrowth
                  ? {
                    ...row,
                    name: '研发费用（占营业收入）',
                    note: '占营业收入，含已分摊折旧。95 表示当年收入的 95%；10000000 表示该年研发费用 10000000 元。',
                  }
                  : row
                return {
                  key: shown.key,
                  name: shown.name,
                  note: shown.note,
                  min: shown.min,
                  values: pl[shown.key] || [],
                  onChange: (i, nv) => {
                    const plNow = payloadRef.current?.targetPl || pl
                    const arr = [...(plNow[shown.key] || [])]
                    arr[i] = nv
                    const assumptionsPatch = shown.key === 'rd_ratio' ? { rd_growth_mode: 'growth' } : null
                    patchPayload({
                      targetPl: { [shown.key]: arr },
                      ...(assumptionsPatch ? { assumptions: assumptionsPatch } : {}),
                    })
                  },
                }
              })}
            />
            <Space style={{ marginTop: 8 }}>
              <Button
                disabled={forecastYearEntries(pl, assumptions.valuation_date).length >= 15}
                onClick={() => {
                  const base = payloadRef.current || {}
                  const plNow = base.targetPl || pl
                  const assumptionsNow = base.assumptions || assumptions
                  const years = [...(plNow.years || [])]
                  const last = Number(years[years.length - 1])
                  const anchor = statementAnchor(assumptionsNow.valuation_date)
                  const nextYear = Number.isFinite(last)
                    ? last + 1
                    : (anchor ? (anchor.month === 12 ? anchor.year + 1 : anchor.year) : null)
                  if (nextYear == null) {
                    Message.warning('请先选择估值锚定日')
                    return
                  }
                  years.push(String(nextYear))
                  patchPayload({
                    targetPl: { ...plNow, years },
                    assumptions: {
                      forecast_years: forecastYearEntries({ ...plNow, years }, assumptionsNow.valuation_date).length,
                    },
                  })
                }}
              >
                增加一年
              </Button>
              <Button
                onClick={() => {
                  if (!statementAnchor(assumptions.valuation_date)) {
                    Message.warning('请先选择估值锚定日')
                    return
                  }
                  const base = payloadRef.current || {}
                  const plNow = base.targetPl || pl
                  const assumptionsNow = base.assumptions || assumptions
                  const forecast = defaultForecastYears(assumptionsNow.valuation_date, assumptionsNow.forecast_years || 5)
                  const anchor = statementAnchor(assumptionsNow.valuation_date)
                  const current = anchor ? String(anchor.year) : null
                  const prior = anchor ? String(anchor.year - 1) : null
                  const keepPrior = prior && (plNow.years || []).some((y) => yearNum(y) === anchor.year - 1)
                  let years = current && anchor.month === 12
                    ? [current, ...forecast.filter((y) => y !== current)]
                    : [...forecast]
                  if (keepPrior) years = [prior, ...years.filter((y) => yearNum(y) !== anchor.year - 1)]
                  patchPayload({
                    targetPl: realignPl(plNow, years),
                    assumptions: { forecast_years: forecast.length },
                  })
                }}
              >
                按锚定日排年
              </Button>
              <Button
                status="danger"
                disabled={forecastYearEntries(pl, assumptions.valuation_date).length <= 1}
                onClick={() => {
                  const base = payloadRef.current || {}
                  const plNow = base.targetPl || pl
                  const assumptionsNow = base.assumptions || assumptions
                  const next = splicePlYear(plNow, (plNow.years || []).length - 1)
                  patchPayload({
                    targetPl: next,
                    assumptions: {
                      forecast_years: forecastYearEntries(next, assumptionsNow.valuation_date).length,
                    },
                  })
                }}
              >
                删除最后一年
              </Button>
            </Space>
            <Typography.Title heading={6} style={{ marginTop: 16 }}>预测利润表</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              最左一列是上一年实际，不带 E。利润表取该年导入数，营运资本取该年资产负债表。第一年营运资本变动 = 当年预测余额 − 这一列实际余额。后面各年再减上一年预测余额。锚定日不是 12 月 31 日时，第一列预测是当年年底预估，直接填金额。后面各年的收入按上一年收入和增速滚动；营业成本、销售、管理、税金、折旧和资本开支按当年收入乘上面的比例。
              研发费用的百分数是较上一年的增速，下一年 = 上一年研发费用 ×（1+增速）。
              比例格里填大于 10000 的数时，该年直接用这个金额。改当年年底收入后，按收入比例计算的年份会跟着变。手改过的后面年份保持手改，清空后重新按比例算。毛利、营业利润、EBITDA、税前和税后由各行重算。
            </Typography.Paragraph>
            {(() => {
              const formula = forecastStatement(pl, assumptions, payload.forecastPl)
              const prior = formula ? priorActualStatement(pl, assumptions, payload.targetBs, formula.years[0]) : null
              const statement = withWorkingCapital(
                overlayForecastStatement(formula, payload.forecastPl),
                pl,
                assumptions,
                payload,
              )
              const rdGrowth = assumptions.rd_growth_mode !== 'share'
              const noteOf = (key) => {
                if (key === 'rd_ratio' && rdGrowth) {
                  return '较上一年研发费用。10 表示增长 10%。绝对值大于 10000 时按该年金额（元）。锚定日不是 12 月 31 日时，第一列年底金额在预测利润表填写。锚定日是 12 月 31 日、第一年填百分数时，用已结年全年实际研发 ×（1+增速）。'
                }
                return FORECAST_RATIO_ROWS.find((row) => row.key === key)?.note || ''
              }
              const rows = [
                { key: 'revenue', engineKey: 'revenue', name: '营业收入', note: noteOf('revenue_growth'), editable: true },
                { key: 'cogs', engineKey: 'cogs', name: '营业成本', note: noteOf('cogs_ratio'), editable: true },
                { key: 'gross', name: '毛利', note: '营业收入 − 营业成本', total: true },
                { key: 'surtax', engineKey: 'surtax', name: '税金及附加', note: noteOf('surtax_ratio'), editable: true },
                { key: 'selling', engineKey: 'selling', name: '销售费用', note: noteOf('selling_ratio'), editable: true },
                { key: 'admin', engineKey: 'admin', name: '管理费用', note: noteOf('admin_ratio'), editable: true },
                { key: 'rd', engineKey: 'rd', name: rdGrowth ? '研发费用（较上一年）' : '研发费用（占收入）', note: noteOf('rd_ratio'), editable: true },
                { key: 'financeExpense', engineKey: 'finance_expense', name: '财务费用', note: noteOf('finance_expense_ratio'), editable: true },
                { key: 'otherIncome', engineKey: 'other_income', name: '其他收益', note: noteOf('other_income_ratio'), editable: true },
                { key: 'other', engineKey: 'other', name: '其他', note: noteOf('other_ratio'), editable: true },
                { key: 'operatingProfit', name: '营业利润', note: '毛利 − 税金及附加 − 销售 − 管理 − 研发 − 财务费用 + 其他收益 + 其他。', total: true },
                { key: 'da', engineKey: 'da', name: '折旧摊销', note: noteOf('da_ratio'), editable: true },
                { key: 'ebitda', name: 'EBITDA', note: '税前经营利润 + 折旧摊销。财务费用不在里面。', total: true },
                { key: 'pretax', name: '税前经营利润', note: '收入 − 成本 − 税金及附加 − 销售 − 管理 − 研发 + 其他收益 + 其他。折旧已含在三项费用中，这里不再扣。', total: true },
                { key: 'nopat', name: '税后经营利润', note: '税前大于 0 时乘（1 − 所得税率）。税前小于等于 0 时不退税。所得税率未填按 15%。', total: true },
                { key: 'capex', engineKey: 'capex', name: '资本开支', note: noteOf('capex_ratio'), editable: true },
                { key: 'netAr', name: '净应收款', note: '预测年 = DSO / 360 × 当年全年收入，已是净值，不再减合同负债。上一年实际 = 应收账款（含票据）− 合同负债。' },
                { key: 'netAp', name: '净应付款', note: '预测年 = DPO / 360 × 当年营业成本。上一年实际 = 应付账款（含票据）− 预付款项。' },
                { key: 'inventory', name: '存货', note: '存货周转天数 / 360 × 当年营业成本。' },
                { key: 'nwc', name: '营运资本余额', note: '净应收款 + 存货 − 净应付款。', total: true },
                { key: 'dnwc', name: '营运资本变动', note: '当年预测余额 − 上一年余额。第一年的上一年实际 =（应收账款 − 合同负债）+ 存货 −（应付账款 − 预付款项）。估值锚定日要落在这一年，资产负债表填该年实际数。', total: true },
              ]
              if (!statement) {
                return <Typography.Paragraph type="secondary">请先选择估值锚定日，并保留预测年。</Typography.Paragraph>
              }
              return (
                <ListTable
                  className="valuation-forecast-pl"
                  rowKey="key"
                  pagination={false}
                  size="small"
                  showSeq={false}
                  scroll={{ x: 160 + (prior ? 150 : 0) + statement.years.length * 150 + 280 }}
                  rowClassName={(row) => (row.total ? 'valuation-bs-total-row' : '')}
                  columns={[
                    { title: '科目', dataIndex: 'name', width: 120, fixed: 'left', className: 'valuation-nowrap-cell' },
                    ...(prior ? [{
                      title: String(prior.year),
                      width: 150,
                      align: 'right',
                      className: 'valuation-num-cell valuation-nowrap-cell',
                      render: (_, row) => (prior[row.key] == null ? '—' : fmtWanPlain(prior[row.key])),
                    }] : []),
                    ...statement.years.map((year, i) => ({
                      title: `${year}E`,
                      width: 150,
                      align: 'right',
                      className: 'valuation-num-cell valuation-nowrap-cell',
                      render: (_, row) => {
                        const value = statement[row.key]?.[i]
                        if (!row.editable) return value == null ? '—' : fmtWanPlain(value)
                        return (
                          <WanInput
                            value={value == null ? undefined : value}
                            onChange={(v) => {
                              const base = payloadRef.current || {}
                              patchPayload({
                                forecastPl: editForecastPl(
                                  base.forecastPl,
                                  year,
                                  row.engineKey,
                                  v,
                                  formula[row.key]?.[i],
                                  statementAnchor(assumptions.valuation_date)?.month < 12
                                    && yearNum(year) === statementAnchor(assumptions.valuation_date)?.year,
                                ),
                                ...(row.engineKey === 'rd' ? { assumptions: { rd_growth_mode: 'growth' } } : {}),
                              })
                            }}
                          />
                        )
                      },
                    })),
                    { title: '说明', dataIndex: 'note', width: 280 },
                  ]}
                  data={rows}
                />
              )
            })()}
          </Card>
        )}

        {step === 'bs' && (
          <Card title="标的资产负债表（录入单位：元）" bordered={false}>
            <TargetFinancialImportBar caseId={caseId} valuationDate={assumptions.valuation_date} enterpriseName={enterpriseName} onImported={adoptImportedPayload} />
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              content="第一列是锚定日实际数，必须配平。后面带 E 的预测列都可以改。没改过的科目沿用实际列；应收账款、存货、应付账款在计算后按周转天数显示，手改后以手改数为准。预测列的配平差额不是错误。"
            />
            <ListTable
              rowKey={(r) => r.key || r.name}
              pagination={false}
              size="small"
              showSeq={false}
              scroll={{ x: true }}
              rowClassName={(r) => (r.total ? 'valuation-bs-total-row' : '')}
              columns={[
                {
                  title: '科目',
                  dataIndex: 'name',
                  width: 228,
                  className: 'valuation-nowrap-cell',
                  render: (v, r) => (r.section || r.total
                    ? <Typography.Text bold>{v}</Typography.Text>
                    : v),
                },
                {
                  title: assumptions.valuation_date ? `实际 ${assumptions.valuation_date}` : '实际（锚定日）',
                  dataIndex: 'value',
                  width: 168,
                  align: 'right',
                  className: 'valuation-num-cell',
                  render: (_, r) => {
                    if (r.section) return null
                    if (r.ratio) {
                      return <Typography.Text bold>{r.value == null ? '—' : fmtPct(r.value, 1)}</Typography.Text>
                    }
                    if (r.multiple) {
                      return <Typography.Text bold>{r.value == null ? '—' : `${fmtNum(r.value, 2)}x`}</Typography.Text>
                    }
                    if (r.auto) {
                      return <Typography.Text bold>{r.value == null ? '—' : fmtWanPlain(r.value)}</Typography.Text>
                    }
                    return (
                      <WanInput
                        value={displayBs(payload.targetBs)?.[r.key]}
                        onChange={(v) => patchPayload({
                          targetBs: { [r.key]: v },
                          overrides: { net_debt: null },
                        })}
                      />
                    )
                  },
                },
                ...forecastYearEntries(pl, assumptions.valuation_date).map(({ y }) => {
                  const yearKey = String(yearNum(y) || y)
                  const pv = (payload?.sheets?.dcf?.payload?.primary?.pvs || []).find((p) => yearNum(p.year) === yearNum(y))
                  const yearOverrides = payload.forecastBs?.[yearKey]
                  const col = forecastBsColumn(payload.targetBs, pv, yearOverrides)
                  return {
                    title: `${yearKey}E`,
                    width: 148,
                    align: 'right',
                    className: 'valuation-num-cell',
                    render: (_, r) => {
                      if (r.section) return null
                      if (r.auto || r.ratio || r.multiple) {
                        const v = bsAutoValue(r.name, col.values, null)
                        if (r.ratio) return v == null ? '—' : fmtPct(v, 1)
                        if (r.multiple) return v == null ? '—' : `${fmtNum(v, 2)}x`
                        return v == null || v === '' ? '—' : fmtWanPlain(v)
                      }
                      const shown = col.values?.[r.key]
                      return (
                        <WanInput
                          value={shown}
                          onChange={(v) => {
                            const base = payloadRef.current || {}
                            const forecastBs = { ...(base.forecastBs || {}) }
                            const row = { ...(forecastBs[yearKey] || {}) }
                            const fallback = forecastBsColumn(base.targetBs, pv, {}).values?.[r.key]
                            const unchanged = v == null || v === '' || Number(v) === Number(fallback)
                            if (unchanged) delete row[r.key]
                            else row[r.key] = v
                            if (Object.keys(row).length) forecastBs[yearKey] = row
                            else delete forecastBs[yearKey]
                            patchPayload({ forecastBs })
                          }}
                        />
                      )
                    },
                  }
                }),
                { title: '说明', dataIndex: 'note' },
              ]}
              data={[
                ...BS_GROUPS.flatMap((g) => {
                  const rows = [
                    { section: true, name: g.label },
                    ...BS_INPUT_FIELDS.filter((f) => f.group === g.key).map((f) => ({
                      key: f.key,
                      name: f.label,
                      note: f.note,
                    })),
                  ]
                  if (g.key === 'noncurrent_assets') {
                    rows.push({
                      auto: true,
                      total: true,
                      name: '资产总计',
                      value: totalAssetsFromBs(payload.targetBs),
                      note: '流动资产 + 非流动资产。与负债总计、所有者权益总计核对',
                    })
                  }
                  if (g.key === 'noncurrent_liab') {
                    rows.push({
                      auto: true,
                      total: true,
                      name: '负债总计',
                      value: totalLiabFromBs(payload.targetBs),
                      note: '流动负债 + 非流动负债',
                    })
                  }
                  if (g.key === 'equity') {
                    rows.push({
                      auto: true,
                      total: true,
                      name: '所有者权益总计',
                      value: equityBookFromBs(payload.targetBs),
                      note: '实收资本 + 资本公积 + 盈余公积 + 未分配利润',
                    })
                  }
                  return rows
                }),
                { section: true, name: '自动计算' },
                { auto: true, name: '流动资产合计', value: currentAssetsFromBs(payload.targetBs), note: '预计一年内变现或耗用的资产合计' },
                { auto: true, name: '流动负债合计', value: currentLiabFromBs(payload.targetBs), note: '预计一年内偿还的负债合计' },
                {
                  auto: true,
                  name: '所有者权益（反算）',
                  value: equityImpliedFromBs(payload.targetBs),
                  note: '资产总计减负债总计。与所有者权益总计的差就是配平差额',
                },
                {
                  auto: true,
                  name: '配平差额',
                  value: (() => {
                    const assets = totalAssetsFromBs(payload.targetBs)
                    const liab = totalLiabFromBs(payload.targetBs)
                    const book = equityBookFromBs(payload.targetBs)
                    if (assets == null || liab == null || book == null) return null
                    return roundWanToFen(assets - liab - book)
                  })(),
                  note: '实际列不为 0 时 DCF 不计算。预测列这一行是累计营运资本变动，不是错误',
                },
                {
                  auto: true,
                  name: '净负债',
                  value: computedNetDebtWan(payload.targetBs),
                  note: '短期借款 + 一年内到期的非流动负债 + 长期借款 + 租赁负债 − 货币资金。预计负债和递延收益不计入',
                },
                {
                  auto: true,
                  name: '期末营运资本占用',
                  value: computedNwcWan(payload.targetBs),
                  note: '净应收 = 应收账款（含票据）− 合同负债。净应付 = 应付账款（含票据）− 预付款项。营运资本 = 净应收 + 存货 − 净应付。第一笔 ΔNWC 用这个净值',
                },
                {
                  auto: true,
                  ratio: true,
                  name: '资产负债率',
                  value: debtRatioFromBs(payload.targetBs),
                  note: '负债占资产的比重',
                },
                {
                  auto: true,
                  multiple: true,
                  name: '流动比率',
                  value: currentRatioFromBs(payload.targetBs),
                  note: '流动资产对流动负债的覆盖倍数',
                },
              ]}
            />
            <Typography.Title heading={6} style={{ marginTop: 16 }}>周转天数</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {(() => {
                const wc = payload?.sheets?.working_capital?.payload
                const prior = (key) => (wc?.[`${key}_prior`] || [])
                  .map((row) => `${row.year} ${row.median == null ? '—' : fmtNum(row.median, 1)}`)
                  .join('，')
                if (!wc?.complete_year) return '计算后在这里看到最近一个完整会计年度年报的中位数。没有中位数时，下面各年都要手填，填 0 视为已填。存货周转天数和 DSO、DPO 一样，可以直接改。'
                return (
                  <>
                    默认用 {wc.complete_year} 年报截面中位数：
                    <span className="valuation-adopted">
                      DSO {fmtNum(wc.dso_median, 1)}，DPO {fmtNum(wc.dpo_median, 1)}，存货 {fmtNum(wc.dio_median, 1)} 天
                    </span>
                    。前两年只读，不写入预测：DSO {prior('dso') || '—'}；DPO {prior('dpo') || '—'}；存货 {prior('dio') || '—'}。
                  </>
                )
              })()}
            </Typography.Paragraph>
            <ListTable
              rowKey="key"
              pagination={false}
              size="small"
              scroll={{ x: true }}
              columns={[
                { title: '天数', dataIndex: 'name', width: 140, fixed: 'left' },
                ...forecastYearEntries(pl, assumptions.valuation_date).map(({ y, i }) => ({
                  title: forecastYearLabel(y),
                  width: 112,
                  align: 'right',
                  className: 'valuation-num-cell',
                  render: (_, r) => (
                    <InputNumber
                      hideControl
                      size="small"
                      precision={1}
                      style={{ width: '100%' }}
                      value={shownForecastDay(pl, assumptions, payload?.sheets?.working_capital?.payload, r.key, i)}
                      onChange={(nv) => {
                        const base = payloadRef.current || {}
                        const plNow = base.targetPl || pl
                        const arr = [...(plNow[r.key] || [])]
                        const fallback = dayFallback(base.assumptions || assumptions, base.sheets?.working_capital?.payload, r.key)
                        const cleared = nv == null || nv === '' || (fallback != null && Number(nv) === Number(fallback))
                        arr[i] = cleared ? null : nv
                        patchPayload({ targetPl: { [r.key]: arr } })
                      }}
                    />
                  ),
                })),
              ]}
              data={[
                { key: 'dso', name: 'DSO' },
                { key: 'dpo', name: 'DPO' },
                { key: 'dio', name: '存货周转天数' },
              ]}
            />
            <ValuationTieOutPanel payload={payload} />
          </Card>
        )}

        {step === 'cf' && (
          <Card title="标的现金流量表 / DCF 联动项（录入单位：元）" bordered={false}>
            <TargetFinancialImportBar caseId={caseId} valuationDate={assumptions.valuation_date} enterpriseName={enterpriseName} onImported={adoptImportedPayload} />
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              content="第一列是实际数，后面带 E 的是预测年，三项都可以改。模板没有现金流量表时，折旧摊销按预测里的占收入比例和营业收入算出默认金额。开始采集/计算/保存完成后，预测年再按本次 DCF 结果覆盖。实际列里已有的数不会被盖掉。"
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              自由现金流 = 税后经营利润 + 折旧摊销 + ESOP − 资本开支 − ΔNWC。
              {nwcWan != null
                ? ` 锚定日营运资本占用 ${fmtWanPlain(nwcWan)}（应收账款含票据 − 合同负债 + 存货 −（应付账款含票据 − 预付款项））。`
                : ' 请先在资产负债表填写应收账款、存货或应付账款。'}
            </Typography.Paragraph>
            <ListTable
              rowKey="key"
              pagination={false}
              size="small"
              scroll={{ x: true }}
              columns={[
                { title: '科目', dataIndex: 'field', width: 140, fixed: 'left', className: 'valuation-nowrap-cell' },
                { title: '对应现金流量表科目', dataIndex: 'cf', width: 280 },
                { title: 'DCF', dataIndex: 'dcf', width: 70 },
                {
                  title: assumptions.valuation_date ? `实际 ${assumptions.valuation_date}` : '实际',
                  width: 148,
                  align: 'right',
                  className: 'valuation-num-cell',
                  render: (_, r) => (
                    <WanInput
                      value={(() => {
                        const stored = payload.overrides?.[r.key]
                        if (stored != null && stored !== '') return stored
                        if (r.key !== 'da') return undefined
                        return impliedDaView(pl, assumptions).actual
                      })()}
                      onChange={(v) => patchPayload({ overrides: { [r.key]: v } })}
                    />
                  ),
                },
                ...forecastYearEntries(pl, assumptions.valuation_date).map(({ y }) => ({
                  title: `${yearNum(y) || y}E`,
                  width: 148,
                  align: 'right',
                  className: 'valuation-num-cell',
                  render: (_, r) => (
                    <WanInput
                      value={(() => {
                        const stored = cfValueAtYear(payload.targetCf, y, r.key)
                        if (stored != null && stored !== '') return stored
                        if (r.key !== 'da') return undefined
                        return impliedDaView(pl, assumptions).byYear[yearNum(y)]
                      })()}
                      onChange={(v) => {
                        const base = payloadRef.current || payload
                        patchPayload(patchCfYear(base, y, r.key, v))
                      }}
                    />
                  ),
                })),
              ]}
              data={[
                { key: 'da', field: '折旧摊销', cf: '固定资产折旧 + 无形资产摊销 + 长期待摊费用摊销（间接法加回）', dcf: '加回' },
                { key: 'capex', field: '资本性支出', cf: '购建固定资产、无形资产和其他长期资产支付的现金', dcf: '扣除' },
                { key: 'dnwc', field: '营运资本增加', cf: '存货增加 + 经营性应收增加 − 经营性应付增加。不是期末余额', dcf: '扣除' },
              ]}
            />
            <ValuationTieOutPanel payload={payload} />
          </Card>
        )}

        {step === 'changelog' && (
          <Card title="变更记录" bordered={false}>
            <ValuationChangeLog caseId={caseId} />
          </Card>
        )}

        {(step === 'comp_pl' || step === 'comp_bs' || step === 'comp_cf') && (
          <Card title={`${STEPS.find((s) => s.key === step)?.title}（元）`} bordered={false}>
            <ComparableFinancialTable
              statementType={step === 'comp_pl' ? 'pl' : step === 'comp_bs' ? 'bs' : 'cf'}
              rows={compFinancials}
              loading={compFinLoading}
              filePrefix={`${cse?.subject?.display_name || '估值'}-${STEPS.find((s) => s.key === step)?.title}`}
            />
          </Card>
        )}

        {(step === 'relative' || step === 'ratios') && (
          <Card title={STEPS.find((s) => s.key === step)?.title} bordered={false}>
            <Typography.Paragraph>
              点击「开始采集/计算/保存」后，本页展示过程表。也可打开「明细」查看全部 Tab 与公式说明。
            </Typography.Paragraph>
            {step === 'relative' ? (
              <>
                <Alert
                  type="info"
                  style={{ marginBottom: 12 }}
                  content="最下面一行是取用结果：单家有底稿中位用底稿，否则用历史中位，再否则用锚定截面。取用列是这些数的中位数（高端倍数），−1σ 列是低端倍数。贴完底稿请点「开始采集/计算/保存」刷新市场法。可比强度不参与计算。"
                />
                <RelativeValuationTable
                  rows={mergeRelativeOverrides(payload.sheets?.relative?.payload, comps)}
                  editable={isDraftView}
                  onOverrideChange={(stockCode, field, value) => {
                    const c = comps.find((x) => String(x.stock_code) === String(stockCode))
                    if (!c?.id) {
                      Message.warning('未找到对应可比公司，请先在「可比与采集」确认名单')
                      return
                    }
                    patchCaseComparable(caseId, c.id, { [field]: value }).then(() => {
                      setComps((prev) => prev.map((x) => (x.id === c.id ? { ...x, [field]: value } : x)))
                    }).catch((e) => Message.error(e.response?.data?.message || '保存底稿中位失败'))
                  }}
                />
              </>
            ) : null}
            {step === 'ratios' ? (
              <RatiosTables
                fees={payload.sheets?.fees}
                grossMargin={payload.sheets?.gross_margin}
                workingCapital={payload.sheets?.working_capital}
                forecastDays={forecastDaysView(payload)}
              />
            ) : null}
          </Card>
        )}

        {(step === 'result' || step === 'market' || step === 'dcf') && (
          <Card bordered={false} className="valuation-output-card">
            <Tabs type="line" size="small" defaultActiveTab="present" className="valuation-output-page-tabs">
              <TabPane key="present" title="结果呈现">
                <div className="valuation-output-page">
                  {blockerLines.length ? (
                    <Alert
                      type="error"
                      style={{ marginBottom: 12 }}
                      title="计算未完成，请补下面这些"
                      content={(
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {blockerLines.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                      )}
                    />
                  ) : null}
                  <section className="valuation-output-section">
                    <Typography.Title heading={6} className="valuation-ratio-col-title">结果对比（亿元）</Typography.Title>
                    <Typography.Paragraph type="secondary" className="valuation-ratio-formula">
                      {(() => {
                        const preview = previewWaccBreakdown(assumptions.wacc_breakdown, assumptions.discount_rate, assumptions.tax_rate)
                        const shownRate = preview.used_breakdown ? preview.rate : (assumptions.discount_rate ?? 0.3)
                        const exitLabel = `退出 P/E ${assumptions.exit_pe ?? 40}，退出 P/S ${assumptions.exit_ps ?? 20}`
                        const liq = assumptions.liquidity_discount ?? 0.3
                        const dcfLiq = assumptions.dcf_liquidity_discount ?? assumptions.liquidity_discount ?? 0.3
                        const dcfOn = method.scenario_mode === 'ma_and_ipo' || method.fcf_method === 'nopat_fcff'
                        return `本次参数：折现率 ${(shownRate * 100).toFixed(1)}%，${exitLabel}，市场法流动性折扣 ${(liq * 100).toFixed(1)}%${dcfOn ? `，DCF 流动性折扣 ${(dcfLiq * 100).toFixed(1)}%` : ''}，ESOP ${assumptions.esop ?? 0} 元。与方法配置是同一组数。`
                      })()}
                    </Typography.Paragraph>
                    <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title="市场法用已实现最近一年的营收与净利润。低端为中位数减 σ，高端为中位数。">
                      市场法用已实现最近一年营收/净利润。P/E 用可比公司的市盈率，P/S 用可比公司的市销率，两套倍数互不相通，也不使用上面的退出 P/E、退出 P/S。低端 = 中位数 − σ，高端 = 中位数。
                      DCF 区间的两端是退出 P/E 和退出 P/S 各自算出的股权价值。
                      {method.scenario_mode === 'ma_and_ipo' ? ' 并购 + 上市并排时市场法仍这一套（只用市场法折扣）；DCF 分两列，每列仍是该情景的两套退出终值（并购用并购折扣，上市不扣）。' : ''}
                    </Typography.Paragraph>
                    {!isDefaultMethodConfig(method) ? (
                      <Alert
                        type="warning"
                        style={{ marginBottom: 12 }}
                        content="本次 DCF 不是系统默认口径。默认是退出 P/E × 末期税后经营利润、净利润桥、营收 CAGR × 退出倍数；当前若是退出 P/S + NOPAT + 折现率轴，区间口径会不同。"
                      />
                    ) : null}
                    {staleLines.length ? (
                      <Alert
                        type="warning"
                        style={{ marginBottom: 12 }}
                        title="输入已修改，需要重新计算"
                        content={(
                          <div>
                            <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
                              {staleLines.map((line) => <li key={line}>{line}</li>)}
                            </ul>
                            <div>请点「开始采集/计算/保存」。</div>
                          </div>
                        )}
                      />
                    ) : null}
                    <div className="valuation-result-top">
                      <div className="valuation-result-left">
                        <div className="valuation-result-grid">
                          {comparison ? (
                            <>
                              <div className="valuation-result-card">
                                <h4>市场法 P/S</h4>
                                <div className="num">{fmtYi(comparison.market_ps?.low)} ~ {fmtYi(comparison.market_ps?.high)}</div>
                                <div>增量 {fmtYi(comparison.market_ps?.increment)}</div>
                              </div>
                              <div className="valuation-result-card">
                                <h4>市场法 P/E</h4>
                                <div className="num">{fmtYi(comparison.market_pe?.low)} ~ {fmtYi(comparison.market_pe?.high)}</div>
                                <div>增量 {fmtYi(comparison.market_pe?.increment)}</div>
                              </div>
                              <div className="valuation-result-card">
                                <h4>DCF</h4>
                                {payload.sheets?.dcf?.payload?.primary?.exit_view ? (
                                  <DcfExitCard
                                    primary={payload.sheets.dcf.payload.primary}
                                    secondary={payload.sheets.dcf.payload.secondary}
                                    dealYi={dealYi}
                                    dilution={dilution}
                                  />
                                ) : comparison.dcf?.ma ? (
                                  <>
                                    <div>并购 {fmtYi(comparison.dcf.ma.low)} ~ {fmtYi(comparison.dcf.ma.high)}</div>
                                    <div>上市 {fmtYi(comparison.dcf.ipo.low)} ~ {fmtYi(comparison.dcf.ipo.high)}</div>
                                  </>
                                ) : (
                                  <div className="num">{fmtYi(comparison.dcf?.low)} ~ {fmtYi(comparison.dcf?.high)}</div>
                                )}
                              </div>
                            </>
                          ) : (
                            <Typography.Text type="secondary">请先确认方法配置并开跑计算</Typography.Text>
                          )}
                          <div className="valuation-result-card valuation-result-card-edit">
                            <div className="valuation-result-card-head">
                              <h4>本轮交易估值（投前）</h4>
                              {isDraftView ? <Tag className="valuation-edit-tag" size="small">可输入</Tag> : null}
                            </div>
                            <InputNumber
                              className="valuation-result-card-input"
                              placeholder="输入对照值"
                              disabled={!isDraftView}
                              value={dealYi}
                              onChange={(v) => {
                                if (!isDraftView) return
                                setCse((prev) => ({ ...prev, round_deal_value_yi: v }))
                                patchValuationCase(caseId, { round_deal_value_yi: v })
                              }}
                            />
                            <div>亿元。对照虚线，并作为退出 MOC、退出 IRR 的分母，不进入股权价值。</div>
                            <div style={{ marginTop: 8 }}>后续股权稀释</div>
                            <PctInput
                              disabled={!isDraftView}
                              value={dilution}
                              onChange={(v) => patchPayload({ assumptions: { ...assumptions, follow_on_dilution: v } })}
                            />
                            <div>空着按 100%。不进入股权价值。</div>
                          </div>
                        </div>
                        <ValuationFootballField
                          comparison={comparison}
                          dealYi={dealYi}
                        />
                      </div>
                      <ValuationExitPanel
                        primary={payload.sheets?.dcf?.payload?.primary}
                        secondary={payload.sheets?.dcf?.payload?.secondary}
                        dealYi={dealYi}
                        dilution={dilution}
                        method={method}
                        readOnly={!isDraftView}
                        onMethodChange={(patch) => patchPayload({ methodConfig: { ...method, ...patch } })}
                      />
                    </div>
                  </section>

                  <div className="valuation-output-stack">
                    <section className="valuation-output-section">
                      <Typography.Title heading={6} className="valuation-ratio-col-title">市场法</Typography.Title>
                      <div className="valuation-market-output-row">
                        <div>
                          {payload.sheets?.market?.formula ? (
                            <Typography.Paragraph type="secondary" className="valuation-ratio-formula valuation-formula-wrap">
                              {payload.sheets.market.formula}
                            </Typography.Paragraph>
                          ) : null}
                          <MarketMultiplesBlock
                            assumptions={assumptions}
                            payload={payload}
                            patchPayload={patchPayload}
                          />
                        </div>
                        <div className="valuation-market-output-side">
                          <MarketMethodTable payload={payload.sheets?.market?.payload} />
                        </div>
                      </div>
                    </section>

                    <section className="valuation-output-section valuation-output-dcf">
                      <Typography.Title heading={6} className="valuation-ratio-col-title">DCF</Typography.Title>
                      <div className="valuation-dcf-param-block">
                        <div className="valuation-dcf-param-head">
                          <Typography.Title heading={6} className="valuation-ratio-col-title">可调整参数</Typography.Title>
                          <Tag className="valuation-edit-tag" size="small">可编辑</Tag>
                        </div>
                        <DiscountWaccLine singleRow method={method} assumptions={assumptions} payload={payload} patchPayload={patchPayload} />
                        <Typography.Paragraph className="valuation-dcf-terminal-hint">
                          {method.terminal_type === 'exit_ps'
                            ? '当前终值 = 退出 P/S × 末期全年营业收入 + 锚定日净负债，再折现。终值会加回净负债。'
                            : '当前终值 = 退出 P/E × 末期全年税后经营利润 + 锚定日净负债，再折现。终值会加回净负债。'}
                          {waccHint(assumptions, payload)}
                        </Typography.Paragraph>
                        {method.scenario_mode === 'ma_and_ipo' ? (
                          <Alert
                            type="info"
                            style={{ marginTop: 8 }}
                            content={dualParamsLookSame(method, assumptions, payload)
                              ? '折现率、退出倍数目前相同。两套 DCF 仍会不同：并购用「并购 DCF 流动性折扣」，上市不扣。改市场法折扣不会动 DCF。并购/上市折现率有数会覆盖 WACC 分项。'
                              : '并购 DCF 用「并购流动性折扣」，上市不扣。市场法 P/S、P/E 只用「市场法流动性折扣」。并购/上市折现率有数会覆盖 WACC 分项。'}
                          />
                        ) : null}
                      </div>
                      <TurnoverDefaultRow assumptions={assumptions} payload={payload} patchPayload={patchPayload} payloadRef={payloadRef} />
                      {payload.sheets?.dcf?.formula ? (
                        <Typography.Paragraph type="secondary" className="valuation-ratio-formula valuation-formula-wrap">
                          {payload.sheets.dcf.formula}
                        </Typography.Paragraph>
                      ) : null}
                      <DcfProcessTables payload={payload.sheets?.dcf?.payload} />
                    </section>
                  </div>
                </div>
              </TabPane>
              <TabPane key="version" title="版本对比">
                <VersionComparePanel draftYi={liveDraftYi} versions={archivedVersions} />
              </TabPane>
              <TabPane key="tieout" title="三表勾稽">
                <ValuationTieOutPanel payload={payload} />
              </TabPane>
            </Tabs>
          </Card>
        )}
      </main>
      <ValuationDetailModal
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        sheets={payload.sheets}
        unsaved={isDraftView}
        warnings={[...notices.info, ...notices.warn]}
      />
      <SheetModal
        visible={exportOpen}
        title="导出 Excel"
        onClose={() => setExportOpen(false)}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body">
            <p className="form-hint">
              可多选。每个版本（含草稿）各导出一个 xlsx。过程表含 Excel 公式。
            </p>
            <Checkbox.Group
              value={exportIds}
              onChange={setExportIds}
              direction="vertical"
            >
              <Checkbox value="draft">当前草稿</Checkbox>
              {archivedVersions.map((v) => (
                <Checkbox key={v.id} value={v.id}>
                  {`v${v.version_no} · ${formatChinaDateTime(v.created_at)}`}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
          <SheetActions
            onCancel={() => setExportOpen(false)}
            submitLabel="导出"
            submitType="button"
            onSubmitClick={confirmExport}
            submitLoading={exporting}
          />
        </div>
      </SheetModal>
    </div>
  )
}
