/** 标的三表勾稽：净负债、NWC 占用 vs ΔNWC、FCF 恒等式。金额按万元。 */
import { yuanToWan } from './valuationUnits'
import { BS_INPUT_KEYS, nwcStockFromBs } from './valuationBsFields'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function seriesLooksYuan(values) {
  const abs = (Array.isArray(values) ? values : [values])
    .map(num)
    .filter((n) => n != null && n !== 0)
    .map((n) => Math.abs(n))
  if (!abs.length) return false
  return Math.max(...abs) >= 1e6
}

function toWan(v, asYuan) {
  if (v == null || v === '') return null
  const n = num(v)
  if (n == null) return null
  if (asYuan) {
    const w = yuanToWan(n)
    return w == null ? null : w
  }
  return n
}

function lookup(series, years, year, asYuan) {
  const i = (years || []).findIndex((y) => String(y) === String(year))
  if (i < 0) return null
  const yuan = asYuan == null ? seriesLooksYuan(series) : asYuan
  return toWan(series?.[i], yuan)
}

function cfSeries(cf, overrides, years, key, cfIsYuan) {
  let last = null
  return (years || []).map((year) => {
    const fromYear = lookup(cf?.[key], cf?.years, year, cfIsYuan)
    if (fromYear != null) {
      last = fromYear
      return fromYear
    }
    if (last != null) return last
    if (overrides?.[key] != null && overrides[key] !== '') return toWan(overrides[key], false) ?? 0
    return toWan(cf?.[`${key}_default`], !!cfIsYuan) ?? 0
  })
}

export function buildValuationTieOut(payload) {
  const bs = payload?.targetBs || {}
  const plSheet = payload?.sheets?.target_pl?.payload
  const pl = plSheet?.years?.length ? plSheet : (payload?.targetPl || {})
  const wanUnit = payload?.amount_unit === 'wan'
  const plYuan = !!(plSheet?.years?.length) || (!wanUnit && seriesLooksYuan(pl.net_income || pl.revenue))
  const cfInput = payload?.targetCf
  const cfSheet = payload?.sheets?.target_cf?.payload
  const useCfInput = cfInput && (cfInput.years?.length || cfInput.da || cfInput.capex || cfInput.dnwc)
  const cf = useCfInput ? cfInput : (cfSheet || {})
  const cfYuan = useCfInput
    ? (!wanUnit && seriesLooksYuan([...(cf.da || []), ...(cf.capex || []), ...(cf.dnwc || [])]))
    : !!cfSheet
  const ov = payload?.overrides || {}
  const dcf = payload?.sheets?.dcf?.payload?.primary || {}
  const pvs = Array.isArray(dcf.pvs) ? dcf.pvs : []
  const nopat = payload?.sheets?.dcf?.payload?.fcf_method === 'nopat_fcff'
  const tax = Number(payload?.assumptions?.tax_rate ?? 0.15)
  const bsYuan = !wanUnit && seriesLooksYuan(BS_INPUT_KEYS.map((k) => bs[k]))

  const hasDebt = [bs.cash, bs.short_term_loan, bs.long_term_loan].some((v) => v != null && v !== '')
  const ndBs = hasDebt
    ? (toWan(bs.short_term_loan, bsYuan) || 0) + (toWan(bs.long_term_loan, bsYuan) || 0) - (toWan(bs.cash, bsYuan) || 0)
    : null
  const ndDcf = toWan(dcf.net_debt, true)
  const scaled = {}
  for (const k of BS_INPUT_KEYS) scaled[k] = toWan(bs[k], bsYuan)
  const nwc = nwcStockFromBs(scaled)

  const issues = []
  if (ndBs != null && ndDcf != null && Math.abs(ndBs - ndDcf) > 0.5) {
    issues.push(`净负债：资产负债表 ${ndBs.toFixed(2)} 万，DCF 扣减 ${ndDcf.toFixed(2)} 万`)
  }

  const years = pvs.length ? pvs.map((x) => x.year) : (cf.years || pl.years || [])
  const daList = cfSeries(cf, ov, years, 'da', cfYuan)
  const capexList = cfSeries(cf, ov, years, 'capex', cfYuan)
  const dnwcList = cfSeries(cf, ov, years, 'dnwc', cfYuan)
  const rows = years.map((year, i) => {
    const op = lookup(pl.operating_profit, pl.years, year, plYuan) ?? 0
    const ni = lookup(pl.net_income, pl.years, year, plYuan) ?? 0
    const earn = nopat ? op * (1 - (op > 0 ? tax : 0)) : ni
    const da = daList[i]
    const capex = capexList[i]
    const dnwc = dnwcList[i]
    const expected = earn + da - capex - dnwc
    const actual = pvs[i] ? toWan(pvs[i].fcf, true) : null
    if (nwc != null && Math.abs(dnwc) > Math.abs(nwc) * 3 + 1) {
      issues.push(`${year} 营运资本增加远大于期末占用，请确认填的是增加额而不是余额`)
    }
    if (nwc != null && Math.abs(nwc) > 1 && Math.abs(dnwc - nwc) / Math.abs(nwc) < 0.08) {
      issues.push(`${year} 营运资本增加与期末占用几乎相同，可能把余额当成了增加额`)
    }
    return {
      year,
      earn,
      da,
      capex,
      dnwc,
      expected,
      actual,
      gap: actual == null ? null : expected - actual,
    }
  })

  if (nwc != null && Math.abs(nwc) > 1 && rows.length && rows.every((r) => Math.abs(r.dnwc || 0) < 0.01)) {
    issues.push('资产负债表有营运资本占用，但各年 ΔNWC 为 0。DCF 未扣营运资本增加')
  }

  return {
    ndBs,
    ndDcf,
    nwc,
    rows,
    issues: [...new Set(issues)],
    nopat,
  }
}
