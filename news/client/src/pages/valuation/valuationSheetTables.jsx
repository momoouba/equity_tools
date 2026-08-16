import React from 'react'
import { Typography, Empty, InputNumber } from '@arco-design/web-react'
import { fmtNum, fmtPct, fmtWan, fmtYiFromYuan } from './valuationUnits'
import { ListTable } from './valuationTable'
import { BS_LABELS, BS_INPUT_KEYS } from './valuationBsFields'

function asArray(data) {
  return Array.isArray(data) ? data : []
}

export function RelativeValuationTable({ rows, editable = false, onOverrideChange }) {
  const data = asArray(rows)
  if (!data.length) return <Empty description="暂无相对估值结果，请先采集/计算" />
  const overrideCol = (title, field) => ({
    title,
    dataIndex: field,
    width: 108,
    render: (v, r) => (editable && onOverrideChange ? (
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
      rowKey={(r, i) => r.stock_code || String(i)}
      pagination={false}
      size="small"
      scroll={{ x: 1680 }}
      columns={[
        { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left' },
        { title: '名称', dataIndex: 'stock_name', width: 88, ellipsis: true, fixed: 'left' },
        { title: '入池', dataIndex: 'in_pool', width: 52, render: (v) => (v ? '是' : '否') },
        { title: '截面日', dataIndex: 'asof_trade_date', width: 96, render: (v, r) => v || r.asof_date || '-' },
        { title: 'PE 锚定截面', dataIndex: 'pe_latest', width: 96, render: (v) => fmtNum(v, 2) },
        { title: 'PE 中位', dataIndex: 'pe_median', width: 80, render: (v) => fmtNum(v, 2) },
        overrideCol('PE 底稿中位', 'pe_median_override'),
        { title: 'PE σ', dataIndex: 'pe_stdev', width: 72, render: (v) => fmtNum(v, 2) },
        { title: 'PE −1σ', dataIndex: 'pe_minus_1s', width: 80, render: (v) => fmtNum(v, 2) },
        { title: 'PE +1σ', dataIndex: 'pe_plus_1s', width: 80, render: (v) => fmtNum(v, 2) },
        { title: 'PS 锚定截面', dataIndex: 'ps_latest', width: 96, render: (v) => fmtNum(v, 2) },
        { title: 'PS 中位', dataIndex: 'ps_median', width: 80, render: (v) => fmtNum(v, 2) },
        overrideCol('PS 底稿中位', 'ps_median_override'),
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

export function FeesTable({ payload }) {
  if (!payload || (payload.selling_median == null && payload.admin_median == null && payload.rd_median == null)) {
    return <Empty description="暂无三费结果" />
  }
  return (
    <ListTable
      className="valuation-ratio-table"
      rowKey="name"
      pagination={false}
      size="small"
      columns={[
        { title: '项目', dataIndex: 'name', width: 132 },
        { title: '可比集中位数', dataIndex: 'value', className: 'valuation-ratio-num', align: 'right', render: (v) => fmtPct(v, 2) },
      ]}
      data={[
        { name: '销售费用率', value: payload.selling_median },
        { name: '管理费用率', value: payload.admin_median },
        { name: '研发费用率', value: payload.rd_median },
      ]}
    />
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
  if (!payload || (payload.dso_median == null && payload.dpo_median == null && payload.dio_median == null)) {
    return <Empty description="暂无营运天数结果" />
  }
  return (
    <ListTable
      className="valuation-ratio-table"
      rowKey="name"
      pagination={false}
      size="small"
      columns={[
        { title: '项目', dataIndex: 'name', width: 168 },
        { title: '可比集中位数（天）', dataIndex: 'value', className: 'valuation-ratio-num', align: 'right', render: (v) => fmtNum(v, 1) },
      ]}
      data={[
        { name: 'DSO（应收周转天数）', value: payload.dso_median },
        { name: 'DPO（应付周转天数）', value: payload.dpo_median },
        { name: 'DIO（存货周转天数）', value: payload.dio_median },
      ]}
    />
  )
}

export function RatiosTables({ fees, grossMargin, workingCapital }) {
  const hasAny = fees || grossMargin || workingCapital
  if (!hasAny) return <Empty description="暂无计算结果，请先采集/计算" />
  return (
    <div className="valuation-sheet-stack">
      <div className="valuation-ratio-top">
        <div className="valuation-ratio-col">
          <Typography.Title heading={6} className="valuation-ratio-col-title">三费</Typography.Title>
          {fees?.formula ? (
            <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title={fees.formula}>
              {fees.formula}
            </Typography.Paragraph>
          ) : null}
          <FeesTable payload={fees?.payload || fees} />
        </div>
        <div className="valuation-ratio-col">
          <Typography.Title heading={6} className="valuation-ratio-col-title">营运天数</Typography.Title>
          {workingCapital?.formula ? (
            <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title={workingCapital.formula}>
              {workingCapital.formula}
            </Typography.Paragraph>
          ) : null}
          <WorkingCapitalTable payload={workingCapital?.payload || workingCapital} />
        </div>
      </div>
      <div className="valuation-gm-block">
        <Typography.Title heading={6} className="valuation-ratio-col-title">毛利率</Typography.Title>
        {grossMargin?.formula ? (
          <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title={grossMargin.formula}>
            {grossMargin.formula}
          </Typography.Paragraph>
        ) : null}
        <GrossMarginTable payload={grossMargin?.payload || grossMargin} />
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
        市场法流动性折扣 {fmtPct(payload.liquidity_discount, 0)}
      </Typography.Paragraph>
      <ListTable
        rowKey="row"
        pagination={false}
        size="small"
        columns={[
          { title: '项目', dataIndex: 'row', width: 180 },
          { title: '−1σ', dataIndex: 'low', render: (v, r) => (r.kind === 'yi' ? fmtNum(v, 2) : fmtNum(v, 2)) },
          { title: '中位', dataIndex: 'mid', render: (v) => fmtNum(v, 2) },
          { title: '+1σ', dataIndex: 'high', render: (v) => fmtNum(v, 2) },
        ]}
        data={[
          { row: 'P/S 倍数', kind: 'x', low: psM.min, mid: psM.median, high: psM.max },
          { row: 'P/S 非流通权益（亿元）', kind: 'yi', low: payload.ps?.low?.illiquid_yi, mid: payload.ps?.mid?.illiquid_yi, high: payload.ps?.high?.illiquid_yi },
          { row: 'P/E 倍数', kind: 'x', low: peM.min, mid: peM.median, high: peM.max },
          { row: 'P/E 非流通权益（亿元）', kind: 'yi', low: payload.pe?.low?.illiquid_yi, mid: payload.pe?.mid?.illiquid_yi, high: payload.pe?.high?.illiquid_yi },
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
