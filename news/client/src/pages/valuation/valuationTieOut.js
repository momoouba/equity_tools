/** 标的三表勾稽：净负债、NWC 占用 vs ΔNWC、FCF 恒等式。金额按元。 */
import { BS_INPUT_KEYS, nwcStockFromBs } from './valuationBsFields'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asYuan(v) {
  if (v == null || v === '') return null
  return num(v)
}

function lookup(series, years, year) {
  const i = (years || []).findIndex((y) => String(y) === String(year))
  if (i < 0) return null
  return asYuan(series?.[i])
}

function cfSeries(cf, overrides, years, key) {
  let last = null
  return (years || []).map((year) => {
    const fromYear = lookup(cf?.[key], cf?.years, year)
    if (fromYear != null) {
      last = fromYear
      return fromYear
    }
    if (last != null) return last
    if (overrides?.[key] != null && overrides[key] !== '') return asYuan(overrides[key]) ?? 0
    return asYuan(cf?.[`${key}_default`]) ?? 0
  })
}

export function buildValuationTieOut(payload) {
  const bs = payload?.targetBs || {}
  const plSheet = payload?.sheets?.target_pl?.payload
  const pl = plSheet?.years?.length ? plSheet : (payload?.targetPl || {})
  const cfInput = payload?.targetCf
  const cfSheet = payload?.sheets?.target_cf?.payload
  const useCfInput = cfInput && (cfInput.years?.length || cfInput.da || cfInput.capex || cfInput.dnwc)
  const cf = useCfInput ? cfInput : (cfSheet || {})
  const ov = payload?.overrides || {}
  const dcf = payload?.sheets?.dcf?.payload?.primary || {}
  const pvs = Array.isArray(dcf.pvs) ? dcf.pvs : []
  const nopat = payload?.sheets?.dcf?.payload?.fcf_method === 'nopat_fcff'
  const tax = Number(payload?.assumptions?.tax_rate ?? 0.15)

  const hasDebt = ['cash', 'short_term_loan', 'current_portion_noncurrent', 'long_term_loan', 'lease_liability']
    .some((k) => bs[k] != null && bs[k] !== '')
  const ndBs = hasDebt
    ? (asYuan(bs.short_term_loan) || 0)
      + (asYuan(bs.current_portion_noncurrent) || 0)
      + (asYuan(bs.long_term_loan) || 0)
      + (asYuan(bs.lease_liability) || 0)
      - (asYuan(bs.cash) || 0)
    : null
  const ndDcf = asYuan(dcf.net_debt)
  const scaled = {}
  for (const k of BS_INPUT_KEYS) scaled[k] = asYuan(bs[k])
  const nwc = nwcStockFromBs(scaled)

  const issues = []
  if (ndBs != null && ndDcf != null && Math.abs(ndBs - ndDcf) > 5000) {
    issues.push(`净负债：资产负债表 ${ndBs.toFixed(2)} 元，DCF 扣减 ${ndDcf.toFixed(2)} 元`)
  }
  const modern = pvs.some((p) => p && (p.nopat != null || p.dnwc != null))
  if (modern) {
    return { ndBs, ndDcf, nwc, rows: [], issues: [...new Set(issues)], nopat: true }
  }

  const years = pvs.length ? pvs.map((x) => x.year) : (cf.years || pl.years || [])
  const daList = cfSeries(cf, ov, years, 'da')
  const capexList = cfSeries(cf, ov, years, 'capex')
  const dnwcList = cfSeries(cf, ov, years, 'dnwc')
  const rows = years.map((year, i) => {
    const op = lookup(pl.operating_profit, pl.years, year) ?? 0
    const ni = lookup(pl.net_income, pl.years, year) ?? 0
    const earn = nopat ? op * (1 - (op > 0 ? tax : 0)) : ni
    const da = daList[i]
    const capex = capexList[i]
    const dnwc = dnwcList[i]
    const expected = earn + da - capex - dnwc
    const actual = pvs[i] ? asYuan(pvs[i].fcf) : null
    if (nwc != null && Math.abs(dnwc) > Math.abs(nwc) * 3 + 10000) {
      issues.push(`${year} 营运资本增加远大于期末占用，请确认填的是增加额而不是余额`)
    }
    if (nwc != null && Math.abs(nwc) > 10000 && Math.abs(dnwc - nwc) / Math.abs(nwc) < 0.08) {
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

  if (nwc != null && Math.abs(nwc) > 10000 && rows.length && rows.every((r) => Math.abs(r.dnwc || 0) < 100)) {
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
