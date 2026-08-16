import React, { useMemo } from 'react'
import { Empty } from '@arco-design/web-react'
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

export default function ValuationFootballField({ comparison, dealYi, height = 248 }) {
  const rows = useMemo(() => {
    if (!comparison) return []
    const list = []
    const dcf = comparison.dcf || {}
    if (dcf.ma) {
      const ma = band('DCF 并购', dcf.ma.low, dcf.ma.high)
      const ipo = band('DCF 上市', dcf.ipo?.low, dcf.ipo?.high)
      if (ma) list.push(ma)
      if (ipo) list.push(ipo)
    } else {
      const one = band('DCF', dcf.low, dcf.high)
      if (one) list.push(one)
    }
    const pe = band('市场法 P/E', comparison.market_pe?.low, comparison.market_pe?.high)
    const ps = band('市场法 P/S', comparison.market_ps?.low, comparison.market_ps?.high)
    if (pe) list.push(pe)
    if (ps) list.push(ps)
    return list
  }, [comparison])

  const option = useMemo(() => {
    if (!rows.length) return null
    const deal = num(dealYi)
    const maxVal = Math.max(...rows.map((r) => r.high), deal != null && deal > 0 ? deal : 0, 0)
    const xMax = Math.max(5, Math.ceil((maxVal * 1.12) / 5) * 5)
    const ordered = [...rows].reverse()
    return {
      animation: false,
      grid: { left: 36, right: 40, top: 12, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        confine: true,
        formatter: (items) => {
          const i = items?.[0]?.dataIndex
          const row = ordered[i]
          if (!row) return ''
          return `${row.name}<br/>低端 ${fmt1(row.low)} 亿<br/>高端 ${fmt1(row.high)} 亿`
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: xMax,
        interval: 5,
        axisLabel: { color: '#86909c', fontSize: 11, formatter: (v) => Number(v).toFixed(1) },
        splitLine: { lineStyle: { color: '#e5e6eb' } },
        axisLine: { lineStyle: { color: '#c9cdd4' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: ordered.map((r) => r.name),
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      series: [
        {
          type: 'bar',
          stack: 'range',
          silent: true,
          barWidth: 16,
          data: ordered.map((r) => r.low),
          itemStyle: { color: 'transparent' },
          label: {
            show: true,
            position: 'left',
            color: '#1d2129',
            fontSize: 11,
            formatter: (p) => fmt1(ordered[p.dataIndex]?.low),
          },
        },
        {
          type: 'bar',
          stack: 'range',
          barWidth: 16,
          data: ordered.map((r) => r.span),
          itemStyle: { color: '#5B8FF9', borderRadius: 1 },
          label: {
            show: true,
            position: 'right',
            color: '#1d2129',
            fontSize: 11,
            formatter: (p) => fmt1(ordered[p.dataIndex]?.high),
          },
          markLine: deal == null || deal <= 0 ? undefined : {
            symbol: 'none',
            silent: true,
            label: { show: false },
            lineStyle: { color: '#c41d1d', type: 'dashed', width: 2 },
            data: [{ xAxis: deal }],
          },
        },
      ],
    }
  }, [rows, dealYi])

  if (!option) return <Empty description="暂无估值区间" />
  return (
    <div className="valuation-football">
      <div className="valuation-football-body">
        <div className="valuation-football-labels" style={{ paddingTop: 12, paddingBottom: 28 }}>
          {rows.map((r) => (
            <div key={r.name} className="valuation-football-label">{r.name}</div>
          ))}
        </div>
        <div className="valuation-football-chart">
          <ReactECharts
            option={option}
            style={{ height, width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        </div>
      </div>
      {num(dealYi) != null && num(dealYi) > 0 ? (
        <div className="valuation-football-legend">红色虚线为本轮交易估值 {fmt1(dealYi)} 亿</div>
      ) : (
        <div className="valuation-football-legend">录入本轮交易估值后显示对照虚线</div>
      )}
    </div>
  )
}
