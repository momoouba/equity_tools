import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Select, Typography } from '@arco-design/web-react'
import { fmtYi } from './valuationUnits'
import { ListTable } from './valuationTable'

function bandCells(yi, key) {
  if (key === 'dcf_ma') {
    const b = yi?.dcf?.ma || (yi?.dcf && !yi.dcf.ma && !yi.dcf.ipo ? yi.dcf : null)
    if (!b) return { low: null, increment: null, high: null }
    return { low: b.low, increment: b.increment, high: b.high }
  }
  if (key === 'dcf_ipo') {
    const b = yi?.dcf?.ipo
    if (!b) return { low: null, increment: null, high: null }
    return { low: b.low, increment: b.increment, high: b.high }
  }
  const b = yi?.[key]
  if (!b) return { low: null, increment: null, high: null }
  if (b.ma) {
    return { low: b.ma.low, increment: b.ma.increment, high: b.ma.high }
  }
  return { low: b.low, increment: b.increment, high: b.high }
}

function delta(a, b) {
  if (a == null || b == null) return null
  const n = Number(b) - Number(a)
  return Number.isFinite(n) ? n : null
}

function fmtDelta(v) {
  if (v == null) return '—'
  const sign = v > 0.005 ? '+' : ''
  return `${sign}${fmtYi(v)}`
}

export default function VersionComparePanel({ draftYi, versions }) {
  const options = useMemo(() => {
    const list = [{ key: 'draft', label: '当前草稿', yi: draftYi }]
    for (const v of versions || []) {
      list.push({
        key: v.id,
        label: `v${v.version_no}`,
        yi: v.conclusion?.display_yi || null,
      })
    }
    return list
  }, [draftYi, versions])

  const [leftKey, setLeftKey] = useState('draft')
  const [rightKey, setRightKey] = useState('draft')
  const inited = useRef(false)

  useEffect(() => {
    if (!options.some((o) => o.key === leftKey)) setLeftKey('draft')
    const latest = options.find((o) => o.key !== 'draft')?.key
    if (latest && !inited.current) {
      inited.current = true
      setRightKey(latest)
    }
  }, [options, leftKey])

  if (!(versions || []).length) {
    return (
      <div className="valuation-version-compare">
        <Typography.Title heading={6} className="valuation-ratio-col-title">版本对比</Typography.Title>
        <Typography.Paragraph type="secondary" className="valuation-ratio-formula">
          保存版本后，可把草稿与 vN 的 P/S、P/E、DCF 区间并排对照。
        </Typography.Paragraph>
      </div>
    )
  }

  const left = options.find((o) => o.key === leftKey) || options[0]
  const right = options.find((o) => o.key === rightKey) || options[1] || options[0]
  const dual = left.yi?.dcf?.ma || right.yi?.dcf?.ma
  const keys = [
    { key: 'market_ps', name: '市场法 P/S' },
    { key: 'market_pe', name: '市场法 P/E' },
    ...(dual
      ? [
        { key: 'dcf_ma', name: 'DCF 并购' },
        { key: 'dcf_ipo', name: 'DCF 上市' },
      ]
      : [{ key: 'dcf', name: 'DCF' }]),
  ]
  const rows = keys.flatMap((k) => {
    const a = bandCells(left.yi, k.key)
    const b = bandCells(right.yi, k.key)
    return [
      {
        id: `${k.key}-low`,
        metric: k.name,
        band: '低端',
        left: a.low,
        right: b.low,
        delta: delta(a.low, b.low),
      },
      {
        id: `${k.key}-inc`,
        metric: k.name,
        band: '增量',
        left: a.increment,
        right: b.increment,
        delta: delta(a.increment, b.increment),
      },
      {
        id: `${k.key}-high`,
        metric: k.name,
        band: '高端',
        left: a.high,
        right: b.high,
        delta: delta(a.high, b.high),
      },
    ]
  })

  return (
    <div className="valuation-version-compare">
      <Typography.Title heading={6} className="valuation-ratio-col-title">版本对比（亿元）</Typography.Title>
      <Typography.Paragraph type="secondary" className="valuation-ratio-formula">
        差值 = 右列 − 左列。已冻结版本不受后续抓取影响；草稿随重算变化。
      </Typography.Paragraph>
      <div className="valuation-version-compare-head">
        <span>左</span>
        <Select size="small" value={leftKey} onChange={setLeftKey} style={{ width: 160 }}>
          {options.map((o) => (
            <Select.Option key={o.key} value={o.key}>{o.label}</Select.Option>
          ))}
        </Select>
        <span>右</span>
        <Select size="small" value={rightKey} onChange={setRightKey} style={{ width: 160 }}>
          {options.map((o) => (
            <Select.Option key={o.key} value={o.key}>{o.label}</Select.Option>
          ))}
        </Select>
      </div>
      <ListTable
        rowKey="id"
        pagination={false}
        size="small"
        columns={[
          { title: '方法', dataIndex: 'metric', width: 120 },
          { title: '区间', dataIndex: 'band', width: 72 },
          { title: left.label, dataIndex: 'left', render: (v) => fmtYi(v) },
          { title: right.label, dataIndex: 'right', render: (v) => fmtYi(v) },
          {
            title: '差值',
            dataIndex: 'delta',
            render: (v) => (
              <span className={v > 0.005 ? 'valuation-delta-up' : v < -0.005 ? 'valuation-delta-down' : ''}>
                {fmtDelta(v)}
              </span>
            ),
          },
        ]}
        data={rows}
      />
    </div>
  )
}
