import React from 'react'
import { Typography, Empty, InputNumber } from '@arco-design/web-react'
import { fmtNum, fmtPct, fmtWan, fmtYiFromYuan } from './valuationUnits'
import { ListTable } from './valuationTable'
import { BS_LABELS, BS_INPUT_KEYS } from './valuationBsFields'

function asArray(data) {
  return Array.isArray(data) ? data : []
}

function finite(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function medianOf(values) {
  const arr = values.filter((n) => n != null).sort((a, b) => a - b)
  if (!arr.length) return null
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

function stdevOf(values) {
  const arr = values.filter((n) => n != null)
  if (arr.length < 2) return null
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(v)
}

/** 与引擎 POOL 一致：底稿中位，否则历史中位，否则锚定截面。可比强度不参与。 */
function poolUsed(r, kind) {
  if (!r?.in_pool || r._summary) return null
  const ov = finite(r[`${kind}_median_override`])
  if (ov != null) return ov
  const med = finite(r[`${kind}_median`])
  const latest = finite(r[`${kind}_latest`])
  const v = med != null ? med : latest
  if (v == null) return null
  if (kind === 'pe' && (v === 0 || Math.abs(v) > 500)) return null
  if (kind === 'ps' && (v <= 0 || v > 80)) return null
  return v
}

function poolBand(values) {
  const mid = medianOf(values)
  if (mid == null) return { high: null, low: null }
  const capped = mid > 0
    ? values.map((v) => {
      if (v > mid * 3) return mid * 3
      if (v > 0 && v < mid / 3) return mid / 3
      return v
    })
    : values
  const sd = stdevOf(capped)
  let low = sd == null ? mid : mid - sd
  if (low != null && low <= 0) low = 0.01
  return { high: mid, low }
}

export function RelativeValuationTable({ rows, editable = false, onOverrideChange }) {
  const source = asArray(rows).filter((r) => !r._summary)
  if (!source.length) return <Empty description="暂无相对估值结果，请先采集/计算" />
  const peBand = poolBand(source.map((r) => poolUsed(r, 'pe')).filter((n) => n != null))
  const psBand = poolBand(source.map((r) => poolUsed(r, 'ps')).filter((n) => n != null))
  const data = [
    ...source,
    {
      _summary: true,
      stock_code: '',
      stock_name: '取用结果',
      pe_used: peBand.high,
      pe_minus_1s: peBand.low,
      ps_used: psBand.high,
      ps_minus_1s: psBand.low,
      quality_warning: '取用列=高端倍数，−1σ列=低端倍数。单家：底稿中位，否则历史中位，否则锚定截面',
    },
  ]
  const overrideCol = (title, field) => ({
    title,
    dataIndex: field,
    width: 108,
    render: (v, r) => (editable && onOverrideChange && !r._summary ? (
      <InputNumber
        hideControl
        precision={2}
        style={{ width: 96 }}
        placeholder="东财"
        value={v == null || v === '' ? undefined : v}
        onChange={(nv) => onOverrideChange(r.stock_code, field, nv == null || nv === '' ? null : nv)}
      />
    ) : fmtNum(v, 2)),
  })
  return (
    <ListTable
      rowKey={(r, i) => (r._summary ? 'pool-take' : (r.stock_code || String(i)))}
      pagination={false}
      size="small"
      scroll={{ x: 1900 }}
      columns={[
        { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left' },
        { title: '名称', dataIndex: 'stock_name', width: 88, ellipsis: true, fixed: 'left' },
        { title: '入池', dataIndex: 'in_pool', width: 52, render: (v, r) => (r._summary ? '—' : (v ? '是' : '否')) },
        {
          title: '可比',
          dataIndex: 'comparability',
          width: 52,
          render: (v) => ({ strong: '强', medium: '中', weak: '弱' }[v] || '-'),
        },
        { title: '截面日', dataIndex: 'asof_trade_date', width: 96, render: (v, r) => v || r.asof_date || '-' },
        { title: 'PE 锚定截面', dataIndex: 'pe_latest', width: 96, render: (v) => fmtNum(v, 2) },
        { title: 'PE 中位', dataIndex: 'pe_median', width: 80, render: (v) => fmtNum(v, 2) },
        overrideCol('PE 底稿中位', 'pe_median_override'),
        {
          title: 'PE 取用',
          dataIndex: 'pe_used',
          width: 80,
          render: (v, r) => fmtNum(r._summary ? v : poolUsed(r, 'pe'), 2),
        },
        { title: 'PE σ', dataIndex: 'pe_stdev', width: 72, render: (v) => fmtNum(v, 2) },
        { title: 'PE −1σ', dataIndex: 'pe_minus_1s', width: 80, render: (v) => fmtNum(v, 2) },
        { title: 'PE +1σ', dataIndex: 'pe_plus_1s', width: 80, render: (v) => fmtNum(v, 2) },
        { title: 'PS 锚定截面', dataIndex: 'ps_latest', width: 96, render: (v) => fmtNum(v, 2) },
        { title: 'PS 中位', dataIndex: 'ps_median', width: 80, render: (v) => fmtNum(v, 2) },
        overrideCol('PS 底稿中位', 'ps_median_override'),
        {
          title: 'PS 取用',
          dataIndex: 'ps_used',
          width: 80,
          render: (v, r) => fmtNum(r._summary ? v : poolUsed(r, 'ps'), 2),
        },
        { title: 'PS σ', dataIndex: 'ps_stdev', width: 72, render: (v) => fmtNum(v, 2) },
        { title: 'PS −1σ', dataIndex: 'ps_minus_1s', width: 80, render: (v) => fmtNum(v, 2) },
        { title: 'PS +1σ', dataIndex: 'ps_plus_1s', width: 80, render: (v) => fmtNum(v, 2) },
        {
          title: '提示',
          dataIndex: 'quality_warning',
          width: 220,
          render: (v, r) => {
            const bits = [v]
            if (r.pe_usable === false) bits.push('PE 未入统计')
            if (r.ps_usable === false) bits.push('PS 未入统计')
            return bits.filter(Boolean).join('；') || '-'
          },
        },
      ]}
      data={data}
    />
  )
}

function collectItemYears(companies) {
  const set = new Set()
  for (const c of companies) {
    for (const item of c.items || []) {
      Object.keys(item.by_year || {}).forEach((y) => set.add(String(y)))
    }
  }
  return [...set].filter((y) => /^\d{4}/.test(y)).sort()
}

function MetricYearTable({ companies, format, empty }) {
  const list = asArray(companies)
  if (!list.length) return <Empty description={empty} />
  const yearKeys = collectItemYears(list)
  const data = []
  list.forEach((c) => {
    (c.items || []).forEach((item) => {
      const row = {
        _key: `${c.stock_code || ''}-${item.key}`,
        stock_code: c.stock_code,
        stock_name: c.stock_name,
        item: item.name,
        latest: item.latest,
        median: item.median,
      }
      yearKeys.forEach((y) => {
        row[`y_${y}`] = item.by_year?.[y]
      })
      data.push(row)
    })
  })
  if (!data.length) return <Empty description={empty} />
  return (
    <ListTable
      rowKey="_key"
      pagination={false}
      size="small"
      scroll={{ x: 520 + yearKeys.length * 76 }}
      columns={[
        { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left' },
        { title: '名称', dataIndex: 'stock_name', width: 80, ellipsis: true, fixed: 'left' },
        { title: '项目', dataIndex: 'item', width: 168, fixed: 'left' },
        { title: '最新', dataIndex: 'latest', width: 76, align: 'right', render: (v) => format(v) },
        { title: '中位数', dataIndex: 'median', width: 76, align: 'right', render: (v) => format(v) },
        ...yearKeys.map((y) => ({
          title: y,
          dataIndex: `y_${y}`,
          width: 76,
          align: 'right',
          render: (v) => (v == null ? '—' : format(v)),
        })),
      ]}
      data={data}
    />
  )
}

export function FeesTable({ payload }) {
  const companies = asArray(payload?.companies)
  if (!companies.length && payload?.selling_median == null && payload?.admin_median == null && payload?.rd_median == null) {
    return <Empty description="暂无三费结果" />
  }
  return (
    <div>
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        可比集中位数：销售费用率 {fmtPct(payload?.selling_median, 2)}，管理费用率 {fmtPct(payload?.admin_median, 2)}，研发费用率 {fmtPct(payload?.rd_median, 2)}
      </Typography.Paragraph>
      <MetricYearTable companies={companies} format={(v) => fmtPct(v, 2)} empty="暂无三费分年数据，请重新计算" />
    </div>
  )
}

function companyGmByYear(company) {
  if (company?.by_year && typeof company.by_year === 'object' && Object.keys(company.by_year).length) {
    return company.by_year
  }
  const out = {}
  const arr = asArray(company?.gross_margins)
  arr.forEach((item, i) => {
    if (item != null && typeof item === 'object' && item.year) {
      out[String(item.year)] = item.value
    } else if (item != null && typeof item !== 'object') {
      out[`第${i + 1}期`] = item
    }
  })
  return out
}

function collectGmYearKeys(companies) {
  const set = new Set()
  for (const c of companies) {
    Object.keys(companyGmByYear(c)).forEach((y) => set.add(y))
  }
  const years = [...set].filter((y) => /^\d{4}/.test(y)).sort()
  const others = [...set].filter((y) => !/^\d{4}/.test(y)).sort()
  return [...years, ...others]
}

export function GrossMarginTable({ payload }) {
  const companies = asArray(payload?.companies)
  if (!companies.length && payload?.set_median == null) return <Empty description="暂无毛利结果" />
  const yearKeys = collectGmYearKeys(companies)
  const data = companies.map((c, i) => {
    const byYear = companyGmByYear(c)
    const row = {
      ...c,
      _key: c.stock_code || String(i),
    }
    yearKeys.forEach((y) => {
      row[`y_${y}`] = byYear[y]
    })
    return row
  })
  return (
    <div>
      {payload?.set_median != null ? (
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          可比集毛利率中位数：{fmtPct(payload.set_median, 2)}
        </Typography.Paragraph>
      ) : null}
      <ListTable
        rowKey="_key"
        pagination={false}
        size="small"
        scroll={{ x: 384 + yearKeys.length * 76 }}
        columns={[
          { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left' },
          { title: '名称', dataIndex: 'stock_name', width: 80, ellipsis: true, fixed: 'left' },
          { title: '最新', dataIndex: 'latest', width: 76, align: 'right', render: (v) => fmtPct(v, 2) },
          { title: '中位数', dataIndex: 'median', width: 76, align: 'right', render: (v) => fmtPct(v, 2) },
          ...yearKeys.map((y) => ({
            title: y,
            dataIndex: `y_${y}`,
            width: 76,
            align: 'right',
            render: (v) => (v == null ? '—' : fmtPct(v, 1)),
          })),
        ]}
        data={data}
      />
    </div>
  )
}

export function WorkingCapitalTable({ payload }) {
  const companies = asArray(payload?.companies)
  if (!companies.length && payload?.dso_median == null && payload?.dpo_median == null && payload?.dio_median == null) {
    return <Empty description="暂无营运天数结果" />
  }
  return (
    <div>
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        可比集中位数：DSO {fmtNum(payload?.dso_median, 1)} 天，DPO {fmtNum(payload?.dpo_median, 1)} 天，DIO {fmtNum(payload?.dio_median, 1)} 天
      </Typography.Paragraph>
      <MetricYearTable companies={companies} format={(v) => fmtNum(v, 1)} empty="暂无营运分年数据，请重新计算" />
    </div>
  )
}

export function RatiosTables({ fees, grossMargin, workingCapital }) {
  const hasAny = fees || grossMargin || workingCapital
  if (!hasAny) return <Empty description="暂无计算结果，请先采集/计算" />
  const feePayload = fees?.payload || fees
  const gmPayload = grossMargin?.payload || grossMargin
  const wcPayload = workingCapital?.payload || workingCapital
  return (
    <div className="valuation-sheet-stack">
      <div className="valuation-gm-block">
        <Typography.Title heading={6} className="valuation-ratio-col-title">三费</Typography.Title>
        {fees?.formula ? (
          <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title={fees.formula}>
            {fees.formula}
          </Typography.Paragraph>
        ) : null}
        <FeesTable payload={feePayload} />
      </div>
      <div className="valuation-gm-block">
        <Typography.Title heading={6} className="valuation-ratio-col-title">毛利率</Typography.Title>
        {grossMargin?.formula ? (
          <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title={grossMargin.formula}>
            {grossMargin.formula}
          </Typography.Paragraph>
        ) : null}
        <GrossMarginTable payload={gmPayload} />
      </div>
      <div className="valuation-gm-block">
        <Typography.Title heading={6} className="valuation-ratio-col-title">营运天数</Typography.Title>
        {workingCapital?.formula ? (
          <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title={workingCapital.formula}>
            {workingCapital.formula}
          </Typography.Paragraph>
        ) : null}
        <WorkingCapitalTable payload={wcPayload} />
      </div>
    </div>
  )
}

export function MarketMethodTable({ payload }) {
  if (!payload || (!payload.pe && !payload.ps)) return <Empty description="暂无市场法结果，请先采集/计算" />
  const peM = payload.pe_multiples || {}
  const psM = payload.ps_multiples || {}
  return (
    <div>
      <Typography.Paragraph type="secondary" className="valuation-formula-wrap" style={{ fontSize: 12 }}>
        基数年份 {payload.base_year || '-'}；营业收入 {fmtWan(payload.revenue_base)}；P/E 基数（净利润） {fmtWan(payload.operating_profit_base)}；
        市场法流动性折扣 {fmtPct(payload.liquidity_discount, 0)}。P/S、P/E 各一行：低端 = 中位数 − σ，高端 = 中位数。
      </Typography.Paragraph>
      <ListTable
        rowKey="row"
        pagination={false}
        size="small"
        columns={[
          { title: '项目', dataIndex: 'row', width: 88 },
          { title: '低端倍数', dataIndex: 'lowX', render: (v) => fmtNum(v, 2) },
          { title: '高端倍数', dataIndex: 'highX', render: (v) => fmtNum(v, 2) },
          { title: '低端非流通权益（亿元）', dataIndex: 'lowYi', render: (v) => fmtNum(v, 2) },
          { title: '高端非流通权益（亿元）', dataIndex: 'highYi', render: (v) => fmtNum(v, 2) },
        ]}
        data={[
          {
            row: 'P/S',
            lowX: psM.min,
            highX: psM.median,
            lowYi: payload.ps?.low?.illiquid_yi,
            highYi: payload.ps?.mid?.illiquid_yi,
          },
          {
            row: 'P/E',
            lowX: peM.min,
            highX: peM.median,
            lowYi: payload.pe?.low?.illiquid_yi,
            highYi: payload.pe?.mid?.illiquid_yi,
          },
        ]}
      />
    </div>
  )
}

function fmtAxis(kind, v) {
  if (v == null || v === '') return '-'
  if (kind === 'cagr' || kind === 'wacc') return fmtPct(v, 1)
  return fmtNum(v, 2)
}

function terminalFormulaText(dcf, terminalType) {
  const usePs = (dcf?.terminal_base_kind || (terminalType === 'exit_ps' ? 'revenue' : 'net_income')) === 'revenue'
  const year = dcf?.terminal_year || (asArray(dcf?.pvs).slice(-1)[0]?.year) || ''
  const kind = usePs ? '末期收入' : '末期净利润'
  const multipleName = usePs ? '退出 P/S' : '退出 P/E'
  if (dcf?.exit_multiple == null || dcf?.terminal_base == null) {
    return `终值 = ${multipleName} × ${kind}`
  }
  const yearBit = year ? `${year}年` : ''
  return `终值 = ${fmtNum(dcf.exit_multiple, 2)} × ${yearBit}${kind} ${fmtWan(dcf.terminal_base)} = ${fmtWan(dcf.terminal_value)}`
}

function DcfOne({ title, dcf, terminalType }) {
  if (!dcf) return null
  const pvs = asArray(dcf.pvs)
  const sens = dcf.sensitivity
  return (
    <div style={{ marginBottom: 16 }}>
      {title ? <Typography.Title heading={6}>{title}</Typography.Title> : null}
      <ListTable
        rowKey={(r, i) => r.year || String(i)}
        pagination={false}
        size="small"
        showSeq={false}
        columns={[
          { title: '年份', dataIndex: 'year' },
          { title: '自由现金流（万元）', dataIndex: 'fcf', render: (v) => fmtWan(v) },
          { title: '折现因子', dataIndex: 'factor', render: (v) => fmtNum(v, 6) },
          { title: '现值（万元）', dataIndex: 'pv', render: (v) => fmtWan(v) },
        ]}
        data={pvs}
      />
      <Typography.Paragraph className="valuation-formula-wrap" style={{ marginTop: 8, fontSize: 13 }}>
        {terminalFormulaText(dcf, terminalType)}；终值现值 {fmtWan(dcf.terminal_pv)}；
        企业价值 {fmtYiFromYuan(dcf.enterprise_value)}；净负债 {fmtWan(dcf.net_debt)}；
        股权价值 {fmtNum(dcf.equity_value_yi, 2)} 亿元
        {dcf.apply_liquidity
          ? `（已扣并购流动性折扣 ${fmtPct(dcf.liquidity_discount ?? 0.3, 0)}）`
          : ''}
      </Typography.Paragraph>
      {sens?.grid ? (
        <ListTable
          style={{ marginTop: 8 }}
          pagination={false}
          size="small"
          showSeq={false}
          rowKey={(_, i) => String(i)}
          columns={[
            { title: `${sens.row_kind} \\ ${sens.col_kind}（亿元）`, dataIndex: 'label', render: (v) => fmtAxis(sens.row_kind, v) },
            ...(sens.col_labels || []).map((c, j) => ({
              title: fmtAxis(sens.col_kind, c),
              dataIndex: `c${j}`,
              render: (v) => fmtYiFromYuan(v),
            })),
          ]}
          data={(sens.grid || []).map((row, i) => {
            const o = { label: sens.row_labels[i] }
            row.forEach((v, j) => { o[`c${j}`] = v })
            return o
          })}
        />
      ) : null}
    </div>
  )
}

export function DcfProcessTables({ payload }) {
  if (!payload?.primary) return <Empty description="暂无 DCF 结果，请先采集/计算" />
  const dual = Boolean(payload.secondary)
  return (
    <div className={dual ? 'valuation-dcf-process-grid' : undefined}>
      <DcfOne title={payload.primary.scenario_name || '基准'} dcf={payload.primary} terminalType={payload.terminal_type} />
      {dual ? <DcfOne title={payload.secondary.scenario_name || '第二情景'} dcf={payload.secondary} terminalType={payload.terminal_type} /> : null}
    </div>
  )
}

export function TargetPlReadTable({ payload }) {
  const years = asArray(payload?.years)
  if (!years.length) return <Empty description="暂无外推利润表" />
  return (
    <ListTable
      rowKey="year"
      pagination={false}
      size="small"
      columns={[
        { title: '年份', dataIndex: 'year', width: 90 },
        { title: '营业收入（万元）', dataIndex: 'revenue', render: (v) => fmtWan(v) },
        { title: '营业成本（万元）', dataIndex: 'cogs', render: (v) => fmtWan(v) },
        { title: '毛利（万元）', dataIndex: 'gross_profit', render: (v) => fmtWan(v) },
        { title: '营业利润（万元）', dataIndex: 'operating_profit', render: (v) => fmtWan(v) },
        { title: '净利润（万元）', dataIndex: 'net_income', render: (v) => fmtWan(v) },
        { title: '收入增速', dataIndex: 'revenue_growth', render: (v) => fmtPct(v, 1) },
      ]}
      data={years.map((year, i) => ({
        year,
        revenue: payload.revenue?.[i],
        cogs: payload.cogs?.[i],
        gross_profit: payload.gross_profit?.[i],
        operating_profit: payload.operating_profit?.[i],
        net_income: payload.net_income?.[i],
        revenue_growth: payload.revenue_growth?.[i],
      }))}
    />
  )
}

export function TargetBsReadTable({ payload }) {
  if (!payload || !Object.keys(payload).length) return <Empty description="暂无资产负债表" />
  const rows = BS_INPUT_KEYS.map((k) => ({ name: BS_LABELS[k] || k, value: payload[k] }))
  return (
    <ListTable
      rowKey="name"
      pagination={false}
      size="small"
      columns={[
        { title: '科目', dataIndex: 'name', width: 160 },
        { title: '金额（万元）', dataIndex: 'value', render: (v) => fmtWan(v) },
      ]}
      data={rows}
    />
  )
}

export function TargetCfReadTable({ payload }) {
  if (!payload || !Object.keys(payload).length) return <Empty description="暂无现金流量表" />
  const years = asArray(payload.years)
  if (years.length || Array.isArray(payload.da) || Array.isArray(payload.capex)) {
    const n = Math.max(years.length, asArray(payload.da).length, asArray(payload.capex).length, asArray(payload.dnwc).length)
    if (!n) return <Empty description="暂无现金流量表" />
    return (
      <ListTable
        rowKey={(_, i) => String(i)}
        pagination={false}
        size="small"
        columns={[
          { title: '年份', dataIndex: 'year', width: 90 },
          { title: '折旧摊销（万元）', dataIndex: 'da', render: (v) => fmtWan(v) },
          { title: '资本性支出（万元）', dataIndex: 'capex', render: (v) => fmtWan(v) },
          { title: '营运资本增加（万元）', dataIndex: 'dnwc', render: (v) => fmtWan(v) },
        ]}
        data={Array.from({ length: n }, (_, i) => ({
          year: years[i] || `T${i + 1}`,
          da: payload.da?.[i],
          capex: payload.capex?.[i],
          dnwc: payload.dnwc?.[i],
        }))}
      />
    )
  }
  return (
    <ListTable
      rowKey="k"
      pagination={false}
      size="small"
      columns={[
        { title: '字段', dataIndex: 'k', width: 160 },
        { title: '值', dataIndex: 'v', render: (v) => (typeof v === 'object' ? JSON.stringify(v) : fmtNum(v)) },
      ]}
      data={Object.entries(payload).map(([k, v]) => ({ k, v }))}
    />
  )
}

export function ResultCompareTable({ payload }) {
  const yi = payload?.display_yi
  if (!yi) return <Empty description="暂无结果对比" />
  const dcfDual = yi.dcf?.ma
  const rows = [
    { name: '低端', ps: yi.market_ps?.low, pe: yi.market_pe?.low, dcf: dcfDual ? yi.dcf.ma.low : yi.dcf?.low, dcf2: dcfDual ? yi.dcf.ipo.low : null },
    { name: '增量', ps: yi.market_ps?.increment, pe: yi.market_pe?.increment, dcf: dcfDual ? yi.dcf.ma.increment : yi.dcf?.increment, dcf2: dcfDual ? yi.dcf.ipo.increment : null },
    { name: '高端', ps: yi.market_ps?.high, pe: yi.market_pe?.high, dcf: dcfDual ? yi.dcf.ma.high : yi.dcf?.high, dcf2: dcfDual ? yi.dcf.ipo.high : null },
  ]
  const cols = [
    { title: '区间', dataIndex: 'name', width: 80 },
    { title: '市场法 P/S（亿元）', dataIndex: 'ps', render: (v) => fmtNum(v, 2) },
    { title: '市场法 P/E（亿元）', dataIndex: 'pe', render: (v) => fmtNum(v, 2) },
    { title: dcfDual ? 'DCF 并购预期（亿元）' : 'DCF（亿元）', dataIndex: 'dcf', render: (v) => fmtNum(v, 2) },
  ]
  if (dcfDual) cols.push({ title: 'DCF 上市预期（亿元）', dataIndex: 'dcf2', render: (v) => fmtNum(v, 2) })
  return <ListTable rowKey="name" pagination={false} columns={cols} data={rows} />
}

export function SheetByKey({ sheetKey, sheet }) {
  const payload = sheet?.payload
  if (sheetKey === 'result_compare') return <ResultCompareTable payload={payload} />
  if (sheetKey === 'dcf') return <DcfProcessTables payload={payload} />
  if (sheetKey === 'market') return <MarketMethodTable payload={payload} />
  if (sheetKey === 'relative') return <RelativeValuationTable rows={payload} />
  if (sheetKey === 'fees') return <FeesTable payload={payload} />
  if (sheetKey === 'gross_margin') return <GrossMarginTable payload={payload} />
  if (sheetKey === 'working_capital') return <WorkingCapitalTable payload={payload} />
  if (sheetKey === 'target_pl') return <TargetPlReadTable payload={payload} />
  if (sheetKey === 'target_bs') return <TargetBsReadTable payload={payload} />
  if (sheetKey === 'target_cf') return <TargetCfReadTable payload={payload} />
  if (payload == null) return <Empty description="暂无数据" />
  if (Array.isArray(payload)) return <RelativeValuationTable rows={payload} />
  return (
    <ListTable
      pagination={false}
      size="small"
      columns={[
        { title: '字段', dataIndex: 'k', width: 220 },
        { title: '值', dataIndex: 'v', render: (v) => (typeof v === 'object' ? JSON.stringify(v) : fmtNum(v)) },
      ]}
      data={Object.entries(payload).map(([k, v]) => ({ k, v }))}
    />
  )
}
