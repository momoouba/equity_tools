import React from 'react'
import { Typography, Empty, InputNumber } from '@arco-design/web-react'
import { fmtNum, fmtPct, fmtWan, fmtWanPlain, fmtYiFromYuan, fmtYuanAsWan } from './valuationUnits'
import { ListTable } from './valuationTable'
import {
  BS_GROUPS,
  BS_INPUT_FIELDS,
  totalAssetsFromBs,
  totalLiabFromBs,
  equityBookFromBs,
} from './valuationBsFields'

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

function meanOf(values) {
  const arr = values.filter((n) => n != null)
  if (!arr.length) return null
  return arr.reduce((s, x) => s + x, 0) / arr.length
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

function eastMoneyMedian(row, kind) {
  const med = finite(row?.[`${kind}_median`])
  if (med != null) return med
  return finite(row?.[`${kind}_latest`])
}

function shownDraftMedian(row, field) {
  const own = finite(row?.[field])
  if (own != null) return own
  return eastMoneyMedian(row, field.startsWith('pe') ? 'pe' : 'ps')
}

function numCol(title, dataIndex, width, render) {
  return {
    title,
    dataIndex,
    width,
    align: 'right',
    className: 'valuation-num-cell',
    render,
  }
}

export function RelativeValuationTable({ rows, editable = false, onOverrideChange }) {
  const source = asArray(rows).filter((r) => !r._summary)
  if (!source.length) return <Empty description="暂无相对估值结果，请先采集/计算" />
  const peVals = source.map((r) => poolUsed(r, 'pe')).filter((n) => n != null)
  const psVals = source.map((r) => poolUsed(r, 'ps')).filter((n) => n != null)
  const peBand = poolBand(peVals)
  const psBand = poolBand(psVals)
  const peAvg = meanOf(peVals)
  const psAvg = meanOf(psVals)
  const peMed = medianOf(peVals)
  const psMed = medianOf(psVals)
  const rowNotes = source.flatMap((r) => {
    const bits = []
    if (r.quality_warning) bits.push(r.quality_warning)
    if (r.pe_usable === false) bits.push('PE 未入统计')
    if (r.ps_usable === false) bits.push('PS 未入统计')
    if (!bits.length) return []
    return [`${r.stock_code || ''} ${r.stock_name || ''}：${bits.join('；')}`.trim()]
  })
  const overrideCol = (title, field) => numCol(title, field, 120, (v, r) => {
    const shown = shownDraftMedian(r, field)
    if (!(editable && onOverrideChange)) return fmtNum(shown, 2)
    return (
      <InputNumber
        hideControl
        precision={2}
        style={{ width: '100%' }}
        value={shown == null ? undefined : shown}
        onChange={(nv) => onOverrideChange(r.stock_code, field, nv == null || nv === '' ? null : nv)}
      />
    )
  })
  const fmtX = (v) => fmtNum(v, 2)
  return (
    <div>
      <ListTable
        rowKey={(r, i) => r.stock_code || String(i)}
        pagination={false}
        size="small"
        scroll={{ x: 2100 }}
        columns={[
          { title: '代码', dataIndex: 'stock_code', width: 96, fixed: 'left', className: 'valuation-nowrap-cell' },
          { title: '名称', dataIndex: 'stock_name', width: 88, ellipsis: true, fixed: 'left' },
          { title: '入池', dataIndex: 'in_pool', width: 52, render: (v) => (v ? '是' : '否') },
          {
            title: '可比',
            dataIndex: 'comparability',
            width: 52,
            render: (v) => ({ strong: '强', medium: '中', weak: '弱' }[v] || '-'),
          },
          { title: '计算截面日', dataIndex: 'valuation_trade_date', width: 108, className: 'valuation-nowrap-cell', render: (v, r) => v || r.asof_trade_date || r.asof_date || '-' },
          numCol('PE TTM', 'pe_ttm', 88, (v, r) => fmtNum(v ?? r.pe_latest, 2)),
          numCol('PS TTM', 'ps_ttm', 88, (v, r) => fmtNum(v ?? r.ps_latest, 2)),
          numCol('PE 近年均', 'pe_mean', 88, (v) => fmtNum(v, 2)),
          numCol('PS 近年均', 'ps_mean', 88, (v) => fmtNum(v, 2)),
          numCol('PE 计算截面', 'pe_latest', 108, (v) => fmtNum(v, 2)),
          numCol('PE 中位', 'pe_median', 88, (v) => fmtNum(v, 2)),
          overrideCol('PE 底稿中位', 'pe_median_override'),
          numCol('PE 取用', 'pe_used', 88, (v, r) => fmtNum(poolUsed(r, 'pe'), 2)),
          numCol('PE σ', 'pe_stdev', 80, (v) => fmtNum(v, 2)),
          numCol('PE −1σ', 'pe_minus_1s', 88, (v) => fmtNum(v, 2)),
          numCol('PE +1σ', 'pe_plus_1s', 88, (v) => fmtNum(v, 2)),
          numCol('PS 计算截面', 'ps_latest', 108, (v) => fmtNum(v, 2)),
          numCol('PS 中位', 'ps_median', 88, (v) => fmtNum(v, 2)),
          overrideCol('PS 底稿中位', 'ps_median_override'),
          numCol('PS 取用', 'ps_used', 88, (v, r) => fmtNum(poolUsed(r, 'ps'), 2)),
          numCol('PS σ', 'ps_stdev', 80, (v) => fmtNum(v, 2)),
          numCol('PS −1σ', 'ps_minus_1s', 88, (v) => fmtNum(v, 2)),
          numCol('PS +1σ', 'ps_plus_1s', 88, (v) => fmtNum(v, 2)),
          { title: '最新取值日', dataIndex: 'latest_trade_date', width: 108, className: 'valuation-nowrap-cell', render: (v) => v || '—' },
          numCol('最新 PE', 'latest_pe', 88, (v) => fmtNum(v, 2)),
          numCol('最新 PS', 'latest_ps', 88, (v) => fmtNum(v, 2)),
        ]}
        data={source}
      />
      <StatsFooter
        lines={[
          `PE 取用 ${fmtStat(fmtX, peBand.high)}　低端 ${fmtStat(fmtX, peBand.low)}　平均数：${fmtStat(fmtX, peAvg)}　中位数 ${fmtStat(fmtX, peMed)}`,
          `PS 取用 ${fmtStat(fmtX, psBand.high)}　低端 ${fmtStat(fmtX, psBand.low)}　平均数：${fmtStat(fmtX, psAvg)}　中位数 ${fmtStat(fmtX, psMed)}`,
          (() => {
            const days = source.map((r) => r.latest_trade_date).filter(Boolean).sort()
            if (!days.length) return '最新交易日倍数：暂无（只读参考，不进市场法结论）'
            if (days[0] === days[days.length - 1]) return `最新交易日倍数取值日 ${days[0]}（只读参考，不进市场法结论）`
            return `最新交易日倍数取值日 ${days[0]} ~ ${days[days.length - 1]}（只读参考，不进市场法结论）`
          })(),
        ]}
      />
      <Typography.Paragraph type="secondary" className="valuation-ratio-formula" style={{ marginTop: 8, marginBottom: 0 }}>
        PE/PS TTM 与计算截面是折现基准日及以前的倍数，进市场法结论。最新 PE/PS 是数据源最新可用交易日，只读参考。取用是高端倍数（取用列中位数），低端是取用 − σ。单家取用：有底稿中位用底稿，否则用历史中位，再否则用计算截面。
      </Typography.Paragraph>
      {rowNotes.length ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
          {rowNotes.join('；')}
        </Typography.Paragraph>
      ) : null}
    </div>
  )
}

export function forecastYearLabel(year) {
  const text = String(year ?? '').trim()
  if (!text) return '—'
  if (/e$/i.test(text)) return text.replace(/e$/i, 'E')
  const matched = text.match(/(20\d{2})/)
  return matched ? `${matched[1]}E` : text
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

function fmtStat(format, v) {
  return v == null ? '—' : format(v)
}

function StatsFooter({ avg, median, format, take, low, prefix, lines }) {
  if (lines?.length) {
    return (
      <div className="valuation-stats-footer">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    )
  }
  const bits = []
  if (prefix) bits.push(prefix)
  if (take !== undefined) bits.push(`取用 ${fmtStat(format, take)}`)
  if (low !== undefined) bits.push(`低端 ${fmtStat(format, low)}`)
  bits.push(`平均数：${fmtStat(format, avg)}`)
  bits.push(`中位数 ${fmtStat(format, median)}`)
  return (
    <div className="valuation-stats-footer">
      {bits.join('　')}
    </div>
  )
}

function itemCompanyMedians(companies, key) {
  return asArray(companies)
    .map((c) => finite((c.items || []).find((it) => it.key === key)?.median))
    .filter((n) => n != null)
}

const FEE_SECTIONS = [
  { key: 'selling', name: '销售费用率', medianKey: 'selling_median' },
  { key: 'admin', name: '管理费用率', medianKey: 'admin_median' },
  { key: 'rd', name: '研发费用率', medianKey: 'rd_median' },
]

const WC_SECTIONS = [
  { key: 'dso', name: 'DSO（应收周转天数）', medianKey: 'dso_median' },
  { key: 'dpo', name: 'DPO（应付周转天数）', medianKey: 'dpo_median' },
  { key: 'dio', name: 'DIO（存货周转天数）', medianKey: 'dio_median' },
]

function yearMeanRow(rows, yearKeys, itemKey) {
  const latestAvg = meanOf(rows.map((r) => finite(r.item.latest)).filter((n) => n != null))
  const medianAvg = meanOf(rows.map((r) => finite(r.item.median)).filter((n) => n != null))
  const row = {
    _summary: true,
    _key: `${itemKey}-year-mean`,
    stock_code: '',
    stock_name: '平均数',
    latest: latestAvg,
    median: medianAvg,
  }
  yearKeys.forEach((y) => {
    row[`y_${y}`] = meanOf(rows.map((r) => finite(r.item.by_year?.[y])).filter((n) => n != null))
  })
  return row
}

function MetricOneTable({ companies, itemKey, title, adoptedMedian, format, empty }) {
  const rows = asArray(companies)
    .map((c) => {
      const item = (c.items || []).find((it) => it.key === itemKey)
      if (!item) return null
      return { stock_code: c.stock_code, stock_name: c.stock_name, item }
    })
    .filter(Boolean)
  if (!rows.length && adoptedMedian == null) return <Empty description={empty} />

  const yearKeys = collectItemYears(rows.map((r) => ({ items: [r.item] })))
  const companyMedians = rows.map((r) => finite(r.item.median)).filter((n) => n != null)
  const avg = meanOf(companyMedians)
  const setMedian = adoptedMedian != null ? finite(adoptedMedian) : medianOf(companyMedians)

  const data = rows.map((r) => {
    const row = {
      _key: `${r.stock_code || ''}-${itemKey}`,
      stock_code: r.stock_code,
      stock_name: r.stock_name,
      latest: r.item.latest,
      median: r.item.median,
    }
    yearKeys.forEach((y) => {
      row[`y_${y}`] = r.item.by_year?.[y]
    })
    return row
  })
  if (rows.length) data.push(yearMeanRow(rows, yearKeys, itemKey))

  return (
    <div className="valuation-metric-one">
      {title ? <Typography.Title heading={6} className="valuation-ratio-col-title">{title}</Typography.Title> : null}
      {!data.length ? (
        <Empty description={empty} />
      ) : (
        <>
          <ListTable
            rowKey="_key"
            pagination={false}
            size="small"
            mergeSummaryLead
            scroll={{ x: 360 + yearKeys.length * 76 }}
            columns={[
              { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left' },
              { title: '名称', dataIndex: 'stock_name', width: 96, ellipsis: true, fixed: 'left' },
              { title: '最新', dataIndex: 'latest', width: 76, align: 'right', render: (v) => (v == null ? '—' : format(v)) },
              { title: '中位数', dataIndex: 'median', width: 88, align: 'right', render: (v) => (v == null ? '—' : format(v)) },
              ...yearKeys.map((y) => ({
                title: y,
                dataIndex: `y_${y}`,
                width: 76,
                align: 'right',
                render: (v) => (v == null ? '—' : format(v)),
              })),
            ]}
            data={data}
            rowClassName={(r) => (r._summary ? 'valuation-year-mean-row' : undefined)}
          />
          <StatsFooter avg={avg} median={setMedian} format={format} />
        </>
      )}
    </div>
  )
}

export function FeesTable({ payload }) {
  const companies = asArray(payload?.companies)
  if (!companies.length && payload?.selling_median == null && payload?.admin_median == null && payload?.rd_median == null) {
    return <Empty description="暂无三费结果" />
  }
  return (
    <div className="valuation-metric-stack">
      {FEE_SECTIONS.map((sec) => (
        <MetricOneTable
          key={sec.key}
          companies={companies}
          itemKey={sec.key}
          title={sec.name}
          adoptedMedian={payload?.[sec.medianKey]}
          format={(v) => fmtPct(v, 2)}
          empty={`暂无${sec.name}分年数据，请重新计算`}
        />
      ))}
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
  const companyMedians = companies.map((c) => finite(c.median)).filter((n) => n != null)
  const avg = meanOf(companyMedians)
  const setMedian = payload?.set_median != null ? finite(payload.set_median) : medianOf(companyMedians)
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
  if (companies.length) {
    const meanRow = {
      _summary: true,
      _key: 'gm-year-mean',
      stock_code: '',
      stock_name: '平均数',
      latest: meanOf(companies.map((c) => finite(c.latest)).filter((n) => n != null)),
      median: avg,
    }
    yearKeys.forEach((y) => {
      meanRow[`y_${y}`] = meanOf(companies.map((c) => finite(companyGmByYear(c)[y])).filter((n) => n != null))
    })
    data.push(meanRow)
  }
  return (
    <div>
      <ListTable
        rowKey="_key"
        pagination={false}
        size="small"
        mergeSummaryLead
        scroll={{ x: 384 + yearKeys.length * 76 }}
        columns={[
          { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left' },
          { title: '名称', dataIndex: 'stock_name', width: 80, ellipsis: true, fixed: 'left' },
          { title: '最新', dataIndex: 'latest', width: 76, align: 'right', render: (v) => (v == null ? '—' : fmtPct(v, 2)) },
          { title: '中位数', dataIndex: 'median', width: 76, align: 'right', render: (v) => (v == null ? '—' : fmtPct(v, 2)) },
          ...yearKeys.map((y) => ({
            title: y,
            dataIndex: `y_${y}`,
            width: 76,
            align: 'right',
            render: (v) => (v == null ? '—' : fmtPct(v, 1)),
          })),
        ]}
        data={data}
        rowClassName={(r) => (r._summary ? 'valuation-year-mean-row' : undefined)}
      />
      {companies.length ? (
        <StatsFooter avg={avg} median={setMedian} format={(v) => fmtPct(v, 2)} />
      ) : null}
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
      {payload?.complete_year ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
          取用中位数为 {payload.complete_year} 年报截面中位数（已入池公司）。
        </Typography.Paragraph>
      ) : null}
      {Array.isArray(payload?.dso_prior) && payload.dso_prior.length ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
          前两年 DSO {payload.dso_prior.map((r) => `${r.year}:${fmtNum(r.median, 1)}`).join('，')}
        </Typography.Paragraph>
      ) : null}
      <div className="valuation-metric-stack">
        {WC_SECTIONS.map((sec) => (
          <MetricOneTable
            key={sec.key}
            companies={companies}
            itemKey={sec.key}
            title={sec.name}
            adoptedMedian={payload?.[sec.medianKey]}
            format={(v) => fmtNum(v, 1)}
            empty={`暂无${sec.name}分年数据，请重新计算`}
          />
        ))}
      </div>
    </div>
  )
}

export function ForecastDaysResult({ forecastDays, workingCapital }) {
  const years = asArray(forecastDays?.years)
  const rows = asArray(forecastDays?.rows)
  const wc = workingCapital || {}
  const companies = asArray(wc.companies)
  const fmtDay = (v) => fmtNum(v, 1)
  const footerLines = [
    { key: 'dso', label: 'DSO', medianKey: 'dso_median' },
    { key: 'dpo', label: 'DPO', medianKey: 'dpo_median' },
    { key: 'dio', label: '存货周转天数', medianKey: 'dio_median' },
  ].map((sec) => {
    const row = rows.find((r) => r.key === sec.key)
    const forecastVals = asArray(row?.values).map(finite).filter((n) => n != null)
    const take = forecastVals.length ? forecastVals[0] : finite(wc[sec.medianKey])
    const companyMedians = itemCompanyMedians(companies, sec.key)
    const avg = meanOf(companyMedians)
    const med = finite(wc[sec.medianKey]) ?? medianOf(companyMedians)
    return `${sec.label} 取用 ${fmtStat(fmtDay, take)}　平均数：${fmtStat(fmtDay, avg)}　中位数 ${fmtStat(fmtDay, med)}`
  })
  return (
    <div className="valuation-gm-block">
      <Typography.Title heading={6} className="valuation-ratio-col-title">周转天数预测</Typography.Title>
      <Typography.Paragraph type="secondary" className="valuation-ratio-formula">
        {forecastDays?.fromCalc
          ? '各预测年计算采用的天数。带 E 的是预测年。某一格在计算输出里改过，就用改过的数；没改的用统一默认值，再没有就用可比年报中位数。'
          : '还没有计算结果。下面是按当前填写会采用的天数，计算后改为实际采用的数。'}
      </Typography.Paragraph>
      {!years.length || !rows.length ? (
        <Empty description="请先在标的利润表保留预测年" />
      ) : (
        <>
          <ListTable
            className="valuation-forecast-days"
            rowKey="key"
            pagination={false}
            size="small"
            showSeq={false}
            scroll={{ x: 160 + years.length * 88 }}
            columns={[
              { title: '天数', dataIndex: 'name', width: 140, fixed: 'left', className: 'valuation-nowrap-cell' },
              ...years.map((year, i) => ({
                title: forecastYearLabel(year),
                dataIndex: `y${i}`,
                width: 88,
                align: 'right',
                className: 'valuation-nowrap-cell',
                render: (v) => (v == null || v === '' ? '—' : fmtNum(v, 1)),
              })),
            ]}
            data={rows.map((row) => {
              const item = { key: row.key, name: row.name }
              years.forEach((_, i) => { item[`y${i}`] = row.values?.[i] })
              return item
            })}
          />
          <StatsFooter lines={footerLines} />
        </>
      )}
    </div>
  )
}

export function RatiosTables({ fees, grossMargin, workingCapital, forecastDays }) {
  const hasAny = fees || grossMargin || workingCapital || asArray(forecastDays?.years).length
  if (!hasAny) return <Empty description="暂无计算结果，请先采集/计算" />
  const feePayload = fees?.payload || fees
  const gmPayload = grossMargin?.payload || grossMargin
  const wcPayload = workingCapital?.payload || workingCapital
  return (
    <div className="valuation-sheet-stack">
      <ForecastDaysResult forecastDays={forecastDays} workingCapital={wcPayload} />
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
  if (!payload || (!payload.pe && !payload.ps && !payload.pe_ttm && !payload.ps_ttm)) {
    return <Empty description="暂无市场法结果，请先采集/计算" />
  }
  const peM = payload.pe_multiples || {}
  const psM = payload.ps_multiples || {}
  const peNtmM = payload.pe_ntm_multiples || {}
  const psNtmM = payload.ps_ntm_multiples || {}
  const peTtm = payload.pe_ttm || payload.pe || {}
  const psTtm = payload.ps_ttm || payload.ps || {}
  const peNtm = payload.pe_ntm || {}
  const psNtm = payload.ps_ntm || {}
  return (
    <div>
      <Typography.Paragraph type="secondary" className="valuation-formula-wrap" style={{ fontSize: 12 }}>
        流通权益 = 可比倍数 × 目标公司基数；非流通 = 流通 × (1 − 折扣 {fmtPct(payload.liquidity_discount, 0)})。
        目标 TTM：{payload.ttm_label || (payload.base_year ? `${payload.base_year} 年近似` : '-')}；
        目标 NTM：{payload.ntm_window || '-'}。低端 = 中位数 − σ，高端 = 中位数。
      </Typography.Paragraph>
      <ListTable
        className="valuation-market-result-table"
        rowKey="row"
        pagination={false}
        size="small"
        scroll={{ x: 880 }}
        columns={[
          { title: '项目', dataIndex: 'row', width: 96, className: 'valuation-nowrap-cell' },
          { title: '目标公司基数（元）', dataIndex: 'baseYuan', width: 148, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtWan(v) },
          { title: '低端倍数', dataIndex: 'lowX', width: 96, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtNum(v, 2) },
          { title: '高端倍数', dataIndex: 'highX', width: 96, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtNum(v, 2) },
          { title: '低端非流通权益（亿元）', dataIndex: 'lowYi', width: 168, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtNum(v, 2) },
          { title: '高端非流通权益（亿元）', dataIndex: 'highYi', width: 168, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtNum(v, 2) },
        ]}
        data={[
          {
            row: 'P/S TTM',
            baseYuan: payload.revenue_base_ttm ?? payload.revenue_base,
            lowX: psM.min,
            highX: psM.median,
            lowYi: psTtm.low?.illiquid_yi,
            highYi: psTtm.mid?.illiquid_yi,
          },
          {
            row: 'P/S NTM',
            baseYuan: payload.revenue_base_ntm,
            lowX: psNtmM.min,
            highX: psNtmM.median,
            lowYi: psNtm.low?.illiquid_yi,
            highYi: psNtm.mid?.illiquid_yi,
          },
          {
            row: 'P/E TTM',
            baseYuan: payload.net_income_base_ttm ?? payload.operating_profit_base,
            lowX: peM.min,
            highX: peM.median,
            lowYi: peTtm.low?.illiquid_yi,
            highYi: peTtm.mid?.illiquid_yi,
          },
          {
            row: 'P/E NTM',
            baseYuan: payload.net_income_base_ntm,
            lowX: peNtmM.min,
            highX: peNtmM.median,
            lowYi: peNtm.low?.illiquid_yi,
            highYi: peNtm.mid?.illiquid_yi,
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
  const kind = usePs ? '末期全年营业收入' : '末期全年税后经营利润'
  const multipleName = usePs ? '退出 P/S' : '退出 P/E'
  if (dcf?.exit_multiple == null || dcf?.terminal_base == null) {
    return `退出企业价值 = ${multipleName} × ${kind} + 锚定日净负债`
  }
  const yearBit = year ? `${forecastYearLabel(year)} ` : ''
  return `退出企业价值 = ${fmtNum(dcf.exit_multiple, 2)} × ${yearBit}${kind} ${fmtYuanAsWan(dcf.terminal_base)} + 净负债 ${fmtYuanAsWan(dcf.net_debt)} = ${fmtYuanAsWan(dcf.terminal_value)}`
}

const BRIDGE_ROWS = [
  { key: 'revenue_growth', label: '收入增速', kind: 'pct' },
  { key: 'revenue', label: '营业收入', kind: 'wan' },
  { key: 'cogs', label: '营业成本', kind: 'wan' },
  { key: 'gross_profit', label: '毛利', kind: 'wan' },
  { key: 'surtax', label: '税金及附加', kind: 'wan' },
  { key: 'selling', label: '销售费用', kind: 'wan' },
  { key: 'admin', label: '管理费用', kind: 'wan' },
  { key: 'rd', label: '研发费用', kind: 'wan' },
  { key: 'finance_expense', label: '财务费用', kind: 'wan' },
  { key: 'other_income', label: '其他收益', kind: 'wan' },
  { key: 'other', label: '其他', kind: 'wan' },
  { key: 'da', label: '折旧摊销', kind: 'wan' },
  { key: 'ebitda', label: 'EBITDA', kind: 'wan' },
  { key: 'pretax', label: '税前经营利润', kind: 'wan' },
  { key: 'nopat', label: '税后经营利润', kind: 'wan' },
  { key: 'esop', label: 'ESOP', kind: 'wan' },
  { key: 'capex', label: '资本开支', kind: 'wan' },
  { key: 'ytd_pretax', label: '锚定日累计税前经营利润', kind: 'wan' },
  { key: 'ytd_da', label: '锚定日累计折旧摊销', kind: 'wan' },
  { key: 'ytd_capex', label: '锚定日累计资本开支', kind: 'wan' },
  { key: 'period_nopat', label: '期间税后经营利润', kind: 'wan' },
  { key: 'period_da', label: '期间折旧摊销', kind: 'wan' },
  { key: 'period_esop', label: '期间ESOP', kind: 'wan' },
  { key: 'period_capex', label: '期间资本开支', kind: 'wan' },
  { key: 'fcff_before_nwc', label: '扣营运资本前现金流', kind: 'wan' },
  { key: 'dso', label: 'DSO（天）', kind: 'day' },
  { key: 'dpo', label: 'DPO（天）', kind: 'day' },
  { key: 'dio', label: '存货周转（天）', kind: 'day' },
  { key: 'ar', label: '应收账款', kind: 'wan' },
  { key: 'inventory', label: '存货', kind: 'wan' },
  { key: 'ap', label: '应付账款', kind: 'wan' },
  { key: 'nwc', label: '营运资本', kind: 'wan' },
  { key: 'dnwc', label: 'ΔNWC', kind: 'wan' },
  { key: 'fcf', label: '自由现金流', kind: 'wan' },
]

function bridgeValue(series, pvs, key, index) {
  if (key === 'ar') return pvs[index]?.ar_balance
  if (key === 'inventory') return pvs[index]?.inventory_balance
  if (key === 'ap') return pvs[index]?.ap_balance
  if (key === 'fcf') return pvs[index]?.fcf
  if (key === 'ytd_pretax' || key === 'ytd_da' || key === 'ytd_capex') {
    if (index !== 0 || !series?.anchor_ytd) return null
    if (key === 'ytd_pretax') return series.anchor_ytd.pretax
    if (key === 'ytd_da') return series.anchor_ytd.da
    return series.anchor_ytd.capex
  }
  const arr = series?.[key]
  return Array.isArray(arr) ? arr[index] : null
}

function formatBridge(kind, value) {
  if (kind === 'pct') return fmtPct(value, 1)
  if (kind === 'day') return fmtNum(value, 1)
  if (kind === 'num') return fmtNum(value, 2)
  return fmtYuanAsWan(value)
}

function ForecastBridge({ dcf }) {
  const series = dcf?.series
  const pvs = asArray(dcf?.pvs)
  const years = asArray(series?.years).length ? series.years : pvs.map((p) => p.year)
  if (!years.length || !series) return null
  const rows = BRIDGE_ROWS.map((row) => {
    const item = { key: row.key, label: row.label }
    years.forEach((year, i) => {
      item[`y${i}`] = formatBridge(row.kind, bridgeValue(series, pvs, row.key, i))
    })
    return item
  })
  const openingNwc = fmtYuanAsWan(series.opening_nwc)
  const formulaLines = [
    'EBITDA = 营业收入 − 营业成本 − 税金及附加 − 销售费用 − 管理费用 − 研发费用 + 其他收益 + 其他 + 折旧摊销。',
    '税前经营利润 = EBITDA − 折旧摊销。销售、管理、研发已含分摊的折旧，税前不再扣一次。财务费用不进入。',
    '税后经营利润：税前经营利润大于 0 时，税后 = 税前 ×（1 − 所得税率）；税前小于等于 0 时，税后 = 税前，不退税。',
    '扣营运资本前现金流 = 期间税后经营利润 + 期间折旧摊销 + 期间 ESOP − 期间资本开支。锚定年且不是 12 月时，期间税前 = 年底全年税前 − 锚定日当期利润表累计税前，大于 0 再乘（1 − 所得税率）。当期表没有税金及附加、其他收益、其他时，这三项累计按 0。期间折旧和期间资本开支 = 年底全年 − 现金流量表实际列；实际列空着按 0。ESOP 没有累计数，期间 ESOP = 全年 ESOP ×（12 − 锚定月）/ 12。以后各年的期间数就是全年数。',
    '净应收款：上一年实际 = 应收账款（含票据）− 合同负债。预测年 = DSO / 360 × 当年全年营业收入，不再减合同负债。',
    '净应付款：上一年实际 = 应付账款（含票据）− 预付款项。预测年 = DPO / 360 × 当年营业成本。',
    '存货 = 存货周转天数 / 360 × 当年营业成本。',
    '营运资本 = 净应收款 + 存货 − 净应付款。',
    `ΔNWC = 当年末营运资本 − 上一年末营运资本。第一年的上一年末是实际净营运资本（应收账款含票据 − 合同负债 + 存货 −（应付账款含票据 − 预付款项）），本次为 ${openingNwc} 万元。ΔNWC 用两个时点的余额差。`,
    '自由现金流 = 扣营运资本前现金流 − ΔNWC。',
  ]
  return (
    <div style={{ marginTop: 12 }}>
      <Typography.Title heading={6}>预测计算明细（单位：万元）</Typography.Title>
      <ListTable
        className="valuation-dcf-bridge-table"
        rowKey="key"
        pagination={false}
        size="small"
        showSeq={false}
        scroll={{ x: 160 + years.length * 120 }}
        columns={[
          { title: '项目', dataIndex: 'label', width: 168, fixed: 'left', className: 'valuation-nowrap-cell' },
          ...years.map((year, i) => ({
            title: forecastYearLabel(year),
            dataIndex: `y${i}`,
            width: 120,
            align: 'right',
            className: 'valuation-nowrap-cell',
          })),
        ]}
        data={rows}
      />
      <div className="valuation-formula-wrap" style={{ marginTop: 8 }}>
        {formulaLines.map((line) => (
          <Typography.Paragraph key={line} type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
            {line}
          </Typography.Paragraph>
        ))}
      </div>
    </div>
  )
}

function DcfOne({ title, dcf, terminalType }) {
  if (!dcf) return null
  const pvs = asArray(dcf.pvs)
  const sens = dcf.sensitivity
  return (
    <div style={{ marginBottom: 16 }}>
      {title ? <Typography.Title heading={6}>{title}</Typography.Title> : null}
      <ListTable
        className="valuation-dcf-year-table"
        rowKey={(r, i) => r.year || String(i)}
        pagination={false}
        size="small"
        showSeq={false}
        scroll={{ x: 1180 }}
        columns={[
          { title: '年份', dataIndex: 'year', width: 88, align: 'right', className: 'valuation-nowrap-cell', render: (v) => forecastYearLabel(v) },
          { title: '期数', dataIndex: 'periods', width: 72, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtNum(v, 2) },
          { title: '期间税后经营利润', dataIndex: 'period_nopat', width: 140, align: 'right', className: 'valuation-nowrap-cell', render: (v, row) => fmtYuanAsWan(v ?? row.nopat) },
          { title: '期间折旧摊销', dataIndex: 'period_da', width: 120, align: 'right', className: 'valuation-nowrap-cell', render: (v, row) => fmtYuanAsWan(v ?? row.da) },
          { title: '期间资本开支', dataIndex: 'period_capex', width: 120, align: 'right', className: 'valuation-nowrap-cell', render: (v, row) => fmtYuanAsWan(v ?? row.capex) },
          { title: 'ΔNWC', dataIndex: 'dnwc', width: 110, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtYuanAsWan(v) },
          { title: '自由现金流', dataIndex: 'fcf', width: 120, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtYuanAsWan(v) },
          { title: '折现因子', dataIndex: 'factor', width: 100, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtNum(v, 6) },
          { title: '现值', dataIndex: 'pv', width: 110, align: 'right', className: 'valuation-nowrap-cell', render: (v) => fmtYuanAsWan(v) },
        ]}
        data={pvs}
      />
      <ForecastBridge dcf={dcf} />
      <Typography.Paragraph className="valuation-formula-wrap" style={{ marginTop: 8, fontSize: 13 }}>
        {terminalFormulaText(dcf, terminalType)}；终值现值 {fmtYuanAsWan(dcf.terminal_pv)}；
        企业价值 {fmtYiFromYuan(dcf.enterprise_value)}；净负债 {fmtYuanAsWan(dcf.net_debt)}；
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

function dcfWanTitle(name, fallback) {
  const text = name || fallback
  return text.includes('单位：万元') ? text : `${text}（单位：万元）`
}

export function DcfProcessTables({ payload }) {
  if (!payload?.primary) return <Empty description="暂无 DCF 结果，请先采集/计算" />
  const dual = Boolean(payload.secondary)
  return (
    <div className={dual ? 'valuation-dcf-process-grid' : undefined}>
      <DcfOne title={dcfWanTitle(payload.primary.scenario_name, '基准')} dcf={payload.primary} terminalType={payload.terminal_type} />
      {dual ? <DcfOne title={dcfWanTitle(payload.secondary.scenario_name, '第二情景')} dcf={payload.secondary} terminalType={payload.terminal_type} /> : null}
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
        { title: '年份', dataIndex: 'year', width: 90, render: (v) => forecastYearLabel(v) },
        { title: '营业收入', dataIndex: 'revenue', render: (v) => fmtWanPlain(v) },
        { title: '营业成本', dataIndex: 'cogs', render: (v) => fmtWanPlain(v) },
        { title: '毛利', dataIndex: 'gross_profit', render: (v) => fmtWanPlain(v) },
        { title: '营业利润', dataIndex: 'operating_profit', render: (v) => fmtWanPlain(v) },
        { title: '净利润', dataIndex: 'net_income', render: (v) => fmtWanPlain(v) },
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
  const rows = BS_GROUPS.flatMap((g) => {
    const items = BS_INPUT_FIELDS.filter((f) => f.group === g.key).map((f) => ({
      name: f.label,
      value: payload[f.key],
    }))
    if (g.key === 'noncurrent_assets') items.push({ name: '资产总计', value: totalAssetsFromBs(payload) })
    if (g.key === 'noncurrent_liab') items.push({ name: '负债总计', value: totalLiabFromBs(payload) })
    if (g.key === 'equity') items.push({ name: '所有者权益总计', value: equityBookFromBs(payload) })
    return items
  })
  return (
    <ListTable
      rowKey="name"
      pagination={false}
      size="small"
      columns={[
        { title: '科目', dataIndex: 'name', width: 160 },
        { title: '金额', dataIndex: 'value', render: (v) => fmtWanPlain(v) },
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
          { title: '年份', dataIndex: 'year', width: 90, render: (v) => forecastYearLabel(v) },
          { title: '折旧摊销', dataIndex: 'da', render: (v) => fmtWanPlain(v) },
          { title: '资本性支出', dataIndex: 'capex', render: (v) => fmtWanPlain(v) },
          { title: '营运资本增加', dataIndex: 'dnwc', render: (v) => fmtWanPlain(v) },
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
