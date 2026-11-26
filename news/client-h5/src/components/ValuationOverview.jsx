import { useState } from 'react'
import ValuationFootballField from './ValuationFootballField'
import { fmtYi } from '../utils/valuationFormat'

function fmt2(v) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatMultiple(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Math.round(Number(v) * 100) / 100
  return `${Number(n.toFixed(2))} 倍`
}

function formatGrowth(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Math.round(Number(v) * 10000) / 100
  return `${Number(n.toFixed(2))}%`
}

function formatPctDilution(v) {
  if (v == null || v === '') return '空着按 100%'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function exitMocIrr(capYi, dilution, dealYi, holdingYears) {
  const cap = Number(capYi)
  if (!Number.isFinite(cap)) return { moc: null, irr: null, note: '待计算' }
  const deal = Number(dealYi)
  if (!(deal > 0)) return { moc: null, irr: null, note: '待填写本轮交易估值（投前）' }
  const d = dilution == null || dilution === '' ? 1 : Number(dilution)
  if (!Number.isFinite(d) || d < 0 || d > 1) {
    return { moc: null, irr: null, note: '后续股权稀释需在 0% 到 100%' }
  }
  const moc = Math.round(((cap * d) / deal) * 100) / 100
  if (!(moc > 0)) return { moc, irr: null, note: 'MOC 不为正，无 IRR' }
  const years = Number(holdingYears)
  if (!(years > 0)) return { moc, irr: null, note: null }
  const irr = Math.round((moc ** (1 / years) - 1) * 100 * 100) / 100
  return { moc, irr, note: null }
}

function formatExitRange(view, { includeGordon = true } = {}) {
  const vals = [
    view?.pe?.equity_yi,
    view?.ps?.equity_yi,
    includeGordon ? view?.gordon?.equity_yi : null
  ].filter((v) => v != null && Number.isFinite(Number(v)))
  if (!vals.length) return '—'
  const lo = Math.min(...vals.map(Number))
  const hi = Math.max(...vals.map(Number))
  if (lo === hi) return `${fmt2(lo)} 亿`
  return `${fmt2(lo)} ~ ${fmt2(hi)} 亿`
}

function formatExitLine(kind, side, dealYi, dilution, years) {
  if (!side || side.blocked || side.equity_yi == null) return null
  const marker =
    kind === '永续增长'
      ? `永续增长 ${formatGrowth(side.growth)}`
      : `退出 ${kind} ${formatMultiple(side.multiple)}`
  const head = `${marker} → 股权价值 ${fmt2(side.equity_yi)} 亿；退出市值 ${fmt2(side.cap_yi)} 亿`
  const hold = years == null ? '' : `（持有 ${Number(years).toFixed(2)} 年）`
  const m = exitMocIrr(side.cap_yi, dilution, dealYi, years)
  if (m.note === 'MOC 不为正，无 IRR') {
    return `${head}；退出 MOC ${fmt2(m.moc)}；MOC 不为正，无 IRR${hold}`
  }
  if (m.note) return `${head}；退出 MOC、退出 IRR ${m.note}`
  const irr = m.irr == null ? '—' : `${Number(m.irr).toFixed(1)}%`
  return `${head}；退出 MOC ${fmt2(m.moc)}；退出 IRR ${irr}${hold}`
}

function fmtPctMaybe(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function DcfExitBlock({ primary, secondary, dealYi, dilution }) {
  const [open, setOpen] = useState(false)
  const view = primary?.exit_view
  const other = secondary?.exit_view
  const dual = view?.scenario_mode === 'ma_and_ipo' && other
  if (!view) return null

  const detail = (item) => (
    <>
      <p className="h5-valuation__line">{formatExitLine('P/E', item.pe, dealYi, dilution, item.holding_years)}</p>
      <p className="h5-valuation__line">{formatExitLine('P/S', item.ps, dealYi, dilution, item.holding_years)}</p>
    </>
  )

  return (
    <>
      <div className="h5-valuation-kicker">上次计算</div>
      {dual ? (
        <>
          <p className="h5-valuation__line">并购 {formatExitRange(view, { includeGordon: false })}</p>
          <p className="h5-valuation__line">上市 {formatExitRange(other, { includeGordon: false })}</p>
        </>
      ) : (
        <p className="h5-valuation__line">{formatExitRange(view, { includeGordon: false })}</p>
      )}
      <button type="button" className="h5-valuation-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起明细' : '展开明细'}
      </button>
      {open ? (
        <div className="h5-valuation-detail-body">
          {dual ? (
            <>
              <p className="h5-valuation__sub">并购</p>
              {detail(view)}
              <p className="h5-valuation__sub">上市</p>
              {detail(other)}
            </>
          ) : (
            detail(view)
          )}
        </div>
      ) : null}
    </>
  )
}

function DcfGordonBlock({ primary, secondary, dealYi, dilution }) {
  const [open, setOpen] = useState(false)
  const view = primary?.exit_view
  const other = secondary?.exit_view
  const term = primary?.terminals?.gordon || view?.terminals?.gordon
  const otherTerm = secondary?.terminals?.gordon || other?.terminals?.gordon
  const dual = view?.scenario_mode === 'ma_and_ipo' && other
  if (!view) return null

  const head = (side, prefix) => {
    if (!side || side.blocked || side.equity_yi == null) {
      return <p className="h5-valuation__line">{prefix || ''}未算出</p>
    }
    return (
      <>
        {prefix ? <p className="h5-valuation__sub">{prefix}</p> : null}
        <p className="h5-valuation__line">股权价值 {fmt2(side.equity_yi)} 亿</p>
        <p className="h5-valuation__line">退出市值 {fmt2(side.cap_yi)} 亿</p>
      </>
    )
  }

  const gordonDetail = (side, t, years, prefix) => {
    if (!side || side.blocked || side.equity_yi == null) {
      return (
        <p className="h5-valuation__line">
          {prefix || ''}未算出{t?.blockers?.length ? `：${t.blockers.join('；')}` : ''}
        </p>
      )
    }
    const m = exitMocIrr(side.cap_yi, dilution, dealYi, years)
    const hold = years == null ? '' : `（持有 ${Number(years).toFixed(2)} 年）`
    let mocIrr = ''
    if (m.note === 'MOC 不为正，无 IRR') {
      mocIrr = `退出 MOC ${fmt2(m.moc)}；MOC 不为正，无 IRR${hold}`
    } else if (m.note) {
      mocIrr = `退出 MOC、退出 IRR ${m.note}`
    } else {
      const irr = m.irr == null ? '—' : `${Number(m.irr).toFixed(1)}%`
      mocIrr = `退出 MOC ${fmt2(m.moc)}；退出 IRR ${irr}${hold}`
    }
    const mode = t?.stage_mode === 'three_stage' ? '三阶段' : '两阶段'
    const s1 = `一阶段 ${t?.stage1_years ?? '—'} 年 / ${fmtPctMaybe(t?.stage1_growth)}`
    const s2 =
      t?.stage_mode === 'three_stage'
        ? `；二阶段 ${t?.stage2_years ?? '—'} 年 / ${fmtPctMaybe(t?.stage2_growth)}`
        : ''
    const delta =
      t?.two_stage_compare &&
      !t.two_stage_compare.blocked &&
      t.two_stage_compare.delta_equity_value_yi != null
        ? `；相对两阶段差额 ${fmt2(t.two_stage_compare.delta_equity_value_yi)} 亿`
        : ''
    return (
      <>
        <p className="h5-valuation__line">
          {prefix || ''}永续增长 {formatGrowth(side.growth)}
        </p>
        <p className="h5-valuation__line">{mocIrr}</p>
        <p className="h5-valuation__line">
          {mode}：{s1}
          {s2}
          {delta}
        </p>
      </>
    )
  }

  return (
    <>
      <div className="h5-valuation-kicker">上次计算</div>
      {dual ? (
        <>
          {head(view.gordon, '并购')}
          {head(other.gordon, '上市')}
        </>
      ) : (
        head(view.gordon, '')
      )}
      <button type="button" className="h5-valuation-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起明细' : '展开明细'}
      </button>
      {open ? (
        <div className="h5-valuation-detail-body">
          {dual ? (
            <>
              {gordonDetail(view.gordon, term, view.holding_years, '并购 ')}
              {gordonDetail(other.gordon, otherTerm, other.holding_years, '上市 ')}
            </>
          ) : (
            gordonDetail(view.gordon, term, view.holding_years, '')
          )}
        </div>
      ) : null}
    </>
  )
}

/**
 * PC「计算输出 · 总览」只读版
 */
export default function ValuationOverview({ overview }) {
  const comparison = overview?.comparison
  const primary = overview?.primary
  const secondary = overview?.secondary
  const dealYi = overview?.deal_yi
  const dilution = overview?.dilution

  return (
    <div className="h5-valuation-overview">
      <p className="h5-valuation__hint">
        点估值与区间对照。LFY=上一财年，CFY=当年财年。
      </p>

      {!comparison ? (
        <div className="h5-empty" style={{ padding: 12 }}>
          暂无计算结果，请先在电脑版完成计算
        </div>
      ) : (
        <>
          <div className="h5-valuation-cards">
            <div className="h5-valuation-card">
              <h4>市场法 P/S</h4>
              <p>
                LFY{' '}
                {fmtYi(comparison.market_ps_ttm?.low ?? comparison.market_ps?.low)} ~{' '}
                {fmtYi(comparison.market_ps_ttm?.high ?? comparison.market_ps?.high)}
              </p>
              <p>
                CFY {fmtYi(comparison.market_ps_ntm?.low)} ~{' '}
                {fmtYi(comparison.market_ps_ntm?.high)}
              </p>
            </div>
            <div className="h5-valuation-card">
              <h4>市场法 P/E</h4>
              <p>
                LFY{' '}
                {fmtYi(comparison.market_pe_ttm?.low ?? comparison.market_pe?.low)} ~{' '}
                {fmtYi(comparison.market_pe_ttm?.high ?? comparison.market_pe?.high)}
              </p>
              <p>
                CFY {fmtYi(comparison.market_pe_ntm?.low)} ~{' '}
                {fmtYi(comparison.market_pe_ntm?.high)}
              </p>
            </div>
          </div>

          <div className="h5-valuation-cards">
            <div className="h5-valuation-card">
              <h4>DCF</h4>
              {primary?.exit_view ? (
                <DcfExitBlock
                  primary={primary}
                  secondary={secondary}
                  dealYi={dealYi}
                  dilution={dilution}
                />
              ) : comparison.dcf?.ma ? (
                <>
                  <p>
                    并购 {fmtYi(comparison.dcf.ma.low)} ~ {fmtYi(comparison.dcf.ma.high)}
                  </p>
                  <p>
                    上市 {fmtYi(comparison.dcf.ipo?.low)} ~ {fmtYi(comparison.dcf.ipo?.high)}
                  </p>
                </>
              ) : (
                <p>
                  {fmtYi(comparison.dcf?.low)} ~ {fmtYi(comparison.dcf?.high)}
                </p>
              )}
            </div>
            <div className="h5-valuation-card">
              <h4>DCF 永续</h4>
              {primary?.exit_view ? (
                <DcfGordonBlock
                  primary={primary}
                  secondary={secondary}
                  dealYi={dealYi}
                  dilution={dilution}
                />
              ) : (
                <p>—</p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="h5-valuation-card h5-valuation-card--full">
        <h4>本轮交易估值（投前）</h4>
        <p className="h5-valuation__line">
          {dealYi != null && Number.isFinite(Number(dealYi)) ? `${fmtYi(dealYi)} 亿` : '—'}
        </p>
        <p className="h5-valuation__sub">亿元。对照虚线，并作为退出 MOC、退出 IRR 的分母，不进入股权价值。</p>
        <h4 style={{ marginTop: 12 }}>后续股权稀释</h4>
        <p className="h5-valuation__line">{formatPctDilution(dilution)}</p>
        <p className="h5-valuation__sub">空着按 100%。不进入股权价值。</p>
      </div>

      <div className="h5-valuation-card h5-valuation-card--full">
        <h4>估值区间图</h4>
        <ValuationFootballField
          comparison={comparison}
          primary={primary}
          secondary={secondary}
          dealYi={dealYi}
          height={260}
        />
      </div>
    </div>
  )
}
