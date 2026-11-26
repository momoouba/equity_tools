import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmt1(v) {
  if (v == null) return ''
  return Number(v).toFixed(1)
}

function band(name, low, high) {
  const a = num(low)
  const b = num(high)
  if (a == null || b == null) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return { name, low: lo, high: hi, span: hi - lo }
}

function pushBand(list, name, low, high) {
  const row = band(name, low, high)
  if (row) list.push(row)
}

function sideBand(side) {
  if (!side || side.blocked) return { low: null, high: null }
  const low = side.band_low_yi != null ? side.band_low_yi : side.equity_yi
  const high = side.band_high_yi != null ? side.band_high_yi : side.equity_yi
  return { low, high }
}

/**
 * H5 估值区间图（足球场），口径对齐 PC ValuationFootballField
 */
export default function ValuationFootballField({
  comparison,
  primary,
  secondary,
  dealYi,
  height = 280
}) {
  const rows = useMemo(() => {
    if (!comparison) return []
    const list = []
    const peView = primary?.exit_view?.pe
    const psView = primary?.exit_view?.ps
    const gordonView = primary?.exit_view?.gordon
    const peBand = sideBand(peView)
    const psBand = sideBand(psView)
    const gordonBand = sideBand(gordonView)
    const dual = primary?.exit_view?.scenario_mode === 'ma_and_ipo' && secondary?.exit_view

    if (dual) {
      pushBand(list, 'DCF 并购 P/E', sideBand(primary.exit_view?.pe).low, sideBand(primary.exit_view?.pe).high)
      pushBand(list, 'DCF 并购 P/S', sideBand(primary.exit_view?.ps).low, sideBand(primary.exit_view?.ps).high)
      pushBand(list, 'DCF 并购永续', sideBand(primary.exit_view?.gordon).low, sideBand(primary.exit_view?.gordon).high)
      pushBand(list, 'DCF 上市 P/E', sideBand(secondary.exit_view?.pe).low, sideBand(secondary.exit_view?.pe).high)
      pushBand(list, 'DCF 上市 P/S', sideBand(secondary.exit_view?.ps).low, sideBand(secondary.exit_view?.ps).high)
      pushBand(list, 'DCF 上市永续', sideBand(secondary.exit_view?.gordon).low, sideBand(secondary.exit_view?.gordon).high)
    } else if (peView || psView || gordonView) {
      pushBand(list, 'DCF P/E', peBand.low, peBand.high)
      pushBand(list, 'DCF P/S', psBand.low, psBand.high)
      pushBand(list, 'DCF 永续增长', gordonBand.low, gordonBand.high)
    } else {
      const dcf = comparison.dcf || {}
      if (dcf.ma) {
        pushBand(list, 'DCF 并购', dcf.ma.low, dcf.ma.high)
        pushBand(list, 'DCF 上市', dcf.ipo?.low, dcf.ipo?.high)
      } else {
        pushBand(list, 'DCF', dcf.low, dcf.high)
      }
    }

    pushBand(
      list,
      '市场法 P/E LFY',
      comparison.market_pe_ttm?.low ?? comparison.market_pe?.low,
      comparison.market_pe_ttm?.high ?? comparison.market_pe?.high
    )
    pushBand(list, '市场法 P/E CFY', comparison.market_pe_ntm?.low, comparison.market_pe_ntm?.high)
    pushBand(
      list,
      '市场法 P/S LFY',
      comparison.market_ps_ttm?.low ?? comparison.market_ps?.low,
      comparison.market_ps_ttm?.high ?? comparison.market_ps?.high
    )
    pushBand(list, '市场法 P/S CFY', comparison.market_ps_ntm?.low, comparison.market_ps_ntm?.high)
    return list
  }, [comparison, primary, secondary])

  const option = useMemo(() => {
    if (!rows.length) return null
    const deal = num(dealYi)
    const lows = rows.map((r) => r.low)
    const highs = rows.map((r) => r.high)
    const dataMin = Math.min(...lows, 0)
    const dataMax = Math.max(...highs, deal != null && deal > 0 ? deal : 0, 0)
    const xMin = dataMin < 0 ? Math.floor(dataMin / 5) * 5 : 0
    const xMax = Math.max(5, Math.ceil((dataMax * 1.12) / 5) * 5)
    const ordered = [...rows].reverse()
    const chartH = Math.max(height, 48 + rows.length * 32)
    return {
      animation: false,
      grid: { left: 28, right: 32, top: 8, bottom: 24 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        confine: true,
        formatter: (items) => {
          const i = items?.[0]?.dataIndex
          const row = ordered[i]
          if (!row) return ''
          return `${row.name}<br/>低端 ${fmt1(row.low)} 亿<br/>高端 ${fmt1(row.high)} 亿`
        }
      },
      xAxis: {
        type: 'value',
        min: xMin,
        max: xMax,
        axisLabel: { color: '#86909c', fontSize: 10, formatter: (v) => Number(v).toFixed(0) },
        splitLine: { lineStyle: { color: '#e5e6eb' } },
        axisLine: { lineStyle: { color: '#c9cdd4' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'category',
        data: ordered.map((r) => r.name),
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      },
      series: [
        {
          type: 'bar',
          stack: 'range',
          silent: true,
          barWidth: 12,
          data: ordered.map((r) => r.low),
          itemStyle: { color: 'transparent' },
          label: {
            show: true,
            position: 'left',
            color: '#1d2129',
            fontSize: 10,
            formatter: (p) => fmt1(ordered[p.dataIndex]?.low)
          }
        },
        {
          type: 'bar',
          stack: 'range',
          barWidth: 12,
          data: ordered.map((r) => r.span),
          itemStyle: { color: '#5B8FF9', borderRadius: 1 },
          label: {
            show: true,
            position: 'right',
            color: '#1d2129',
            fontSize: 10,
            formatter: (p) => fmt1(ordered[p.dataIndex]?.high)
          },
          markLine:
            deal == null || deal <= 0
              ? undefined
              : {
                  symbol: 'none',
                  silent: true,
                  label: { show: false },
                  lineStyle: { color: '#c41d1d', type: 'dashed', width: 2 },
                  data: [{ xAxis: deal }]
                }
        }
      ],
      _chartH: chartH
    }
  }, [rows, dealYi, height])

  if (!option) {
    return <div className="h5-empty" style={{ padding: 16 }}>暂无估值区间</div>
  }

  const chartH = option._chartH || height
  return (
    <div className="h5-valuation-football">
      <div className="h5-valuation-football__body">
        <div
          className="h5-valuation-football__labels"
          style={{ paddingTop: 8, paddingBottom: 24 }}
        >
          {rows.map((r) => (
            <div key={r.name} className="h5-valuation-football__label">
              {r.name}
            </div>
          ))}
        </div>
        <div className="h5-valuation-football__chart">
          <ReactECharts
            option={option}
            style={{ height: chartH, width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        </div>
      </div>
      {num(dealYi) != null && num(dealYi) > 0 ? (
        <div className="h5-valuation-football__legend">
          红色虚线为本轮交易估值（投前） {fmt1(dealYi)} 亿
        </div>
      ) : (
        <div className="h5-valuation-football__legend">暂无本轮交易估值对照线</div>
      )}
    </div>
  )
}
