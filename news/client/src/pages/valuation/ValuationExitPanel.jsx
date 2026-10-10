import React, { useState } from 'react'
import { Button, InputNumber, Radio, Select, Typography } from '@arco-design/web-react'

function fmt2(v) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatMultiple(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Math.round(Number(v) * 100) / 100
  return `${Number(n.toFixed(2))} 倍`
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

export function formatExitRange(view) {
  const vals = [view?.pe?.equity_yi, view?.ps?.equity_yi].filter((v) => v != null && Number.isFinite(Number(v)))
  if (!vals.length) return '—'
  const lo = Math.min(...vals.map(Number))
  const hi = Math.max(...vals.map(Number))
  if (lo === hi) return `${fmt2(lo)} 亿`
  return `${fmt2(lo)} ~ ${fmt2(hi)} 亿`
}

export function formatExitLine(kind, side, dealYi, dilution, years) {
  if (!side || side.blocked || side.equity_yi == null) return null
  const head = `退出 ${kind} ${formatMultiple(side.multiple)} → 股权价值 ${fmt2(side.equity_yi)} 亿；退出市值 ${fmt2(side.cap_yi)} 亿`
  const hold = years == null ? '' : `（持有 ${Number(years).toFixed(2)} 年）`
  const m = exitMocIrr(side.cap_yi, dilution, dealYi, years)
  if (m.note === 'MOC 不为正，无 IRR') return `${head}；退出 MOC ${fmt2(m.moc)}；MOC 不为正，无 IRR${hold}`
  if (m.note) return `${head}；退出 MOC、退出 IRR ${m.note}`
  const irr = m.irr == null ? '—' : `${Number(m.irr).toFixed(1)}%`
  return `${head}；退出 MOC ${fmt2(m.moc)}；退出 IRR ${irr}${hold}`
}

function cellText(cell, block, dealYi, dilution, years) {
  if (!cell || cell.blank === 'revenue' || cell.blank === 'other' || cell.blank === 'multiple') return ''
  if (cell.blank === 'nopat') return '税后经营利润小于等于 0'
  if (block === 'equity') return cell.equity_yi == null ? '' : fmt2(cell.equity_yi)
  const m = exitMocIrr(cell.cap_yi, dilution, dealYi, years)
  if (block === 'moc') {
    if (m.moc == null) return m.note || ''
    return fmt2(m.moc)
  }
  if (m.note === 'MOC 不为正，无 IRR') return m.note
  if (m.irr == null) return m.note || ''
  return `${Number(m.irr).toFixed(1)}%`
}

function SensTable({ title, side, block, dealYi, dilution, years }) {
  if (!side || side.blocked || !side.cells) return null
  return (
    <div className="valuation-sens-table-wrap">
      <div className="valuation-sens-table-title">{title}</div>
      <table className="valuation-sens-table">
        <thead>
          <tr>
            <th />
            {(side.col_labels || []).map((label, j) => <th key={`${j}-${label}`}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {(side.row_labels || []).map((label, i) => (
            <tr key={`${label}-${i}`}>
              <th>{label}</th>
              {(side.cells[i] || []).map((cell, j) => {
                const center = i === side.center_row && j === side.center_col
                return (
                  <td key={`${i}-${j}`} className={center ? 'is-center' : undefined}>
                    {cellText(cell, block, dealYi, dilution, years)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Block({ title, subtitle, pe, ps, block, dealYi, dilution, years, axis }) {
  const peTitle = `退出 P/E · ${axis}`
  const psTitle = `退出 P/S · ${axis}`
  if (!pe?.cells && !ps?.cells) return null
  return (
    <div className="valuation-sens-block">
      <div className="valuation-sens-block-title">{title}</div>
      {subtitle ? <div className="valuation-sens-block-sub">{subtitle}</div> : null}
      <div className="valuation-sens-pair">
        <SensTable title={peTitle} side={pe} block={block} dealYi={dealYi} dilution={dilution} years={years} />
        <SensTable title={psTitle} side={ps} block={block} dealYi={dealYi} dilution={dilution} years={years} />
      </div>
    </div>
  )
}

function OneScenario({ view, dealYi, dilution }) {
  if (!view) return <Typography.Text type="secondary">请点「开始采集/计算/保存」后显示敏感性</Typography.Text>
  const axis = view.axes === 'exit_x_wacc'
    ? '折现率 × 退出倍数'
    : (view.axes === 'exit_x_rd_cagr'
      ? '研发费用 CAGR × 退出倍数'
      : (view.axes === 'rev_cagr_x_rd_cagr' ? '营收 CAGR × 研发费用 CAGR' : '营收 CAGR × 退出倍数'))
  const deal = Number(dealYi)
  const d = dilution == null || dilution === '' ? 1 : Number(dilution)
  const showReturn = deal > 0 && Number.isFinite(d) && d >= 0 && d <= 1
  const years = view.holding_years
  const yearText = years == null ? '' : `持有 ${Number(years).toFixed(2)} 年`
  let returnNote = null
  if (!showReturn) {
    returnNote = !(deal > 0) ? '待填写本轮交易估值（投前）' : '后续股权稀释需在 0% 到 100%'
  }
  return (
    <div>
      <Block title="估值" pe={view.pe} ps={view.ps} block="equity" dealYi={dealYi} dilution={dilution} years={years} axis={axis} />
      {showReturn ? (
        <>
          <Block title="退出 MOC" pe={view.pe} ps={view.ps} block="moc" dealYi={dealYi} dilution={dilution} years={years} axis={axis} />
          <Block title="退出 IRR" subtitle={yearText} pe={view.pe} ps={view.ps} block="irr" dealYi={dealYi} dilution={dilution} years={years} axis={axis} />
        </>
      ) : (
        <Typography.Paragraph type="secondary" className="valuation-sens-block-sub">{returnNote}</Typography.Paragraph>
      )}
      {view.wacc_floored ? (
        <div className="valuation-sens-block-sub">折现率低于 1% 的档已按 1% 计算。</div>
      ) : null}
    </div>
  )
}

export function DcfExitCard({ primary, secondary, dealYi, dilution }) {
  const view = primary?.exit_view
  const other = secondary?.exit_view
  const dual = view?.scenario_mode === 'ma_and_ipo' && other
  const lines = (item, prefix) => (
    <>
      <div className={prefix ? 'valuation-exit-line' : 'num'}>{prefix}{formatExitRange(item)}</div>
      <div className="valuation-exit-line">{formatExitLine('P/E', item.pe, dealYi, dilution, item.holding_years)}</div>
      <div className="valuation-exit-line">{formatExitLine('P/S', item.ps, dealYi, dilution, item.holding_years)}</div>
    </>
  )
  if (!view) return null
  return (
    <>
      <div>上次计算</div>
      {dual ? (
        <>
          {lines(view, '并购 ')}
          {lines(other, '上市 ')}
        </>
      ) : lines(view, '')}
    </>
  )
}

const AXIS_OPTIONS = [
  { value: 'exit_x_cagr', label: '营收 CAGR × 退出倍数' },
  { value: 'exit_x_wacc', label: '折现率 × 退出倍数' },
  { value: 'exit_x_rd_cagr', label: '研发费用 CAGR × 退出倍数' },
  { value: 'rev_cagr_x_rd_cagr', label: '营收 CAGR × 研发费用 CAGR' },
]

function shownStep(value, fallback, percent) {
  const n = Number(value)
  const used = Number.isFinite(n) && n > 0 ? n : fallback
  if (!percent) return used
  return Math.round(used * 10000) / 100
}

function StepControl({ label, value, fallback, presets, percent, disabled, onChange }) {
  return (
    <div className="valuation-sens-step">
      <span>{label}</span>
      <InputNumber
        size="small"
        hideControl
        disabled={disabled}
        min={0.01}
        value={shownStep(value, fallback, percent)}
        onChange={(v) => {
          const n = Number(v)
          if (!(n > 0)) return
          onChange(percent ? n / 100 : n)
        }}
      />
      {presets.map((preset) => (
        <Button
          key={preset}
          size="mini"
          type="text"
          disabled={disabled}
          onClick={() => onChange(percent ? preset / 100 : preset)}
        >
          {percent ? `${preset}%` : String(preset)}
        </Button>
      ))}
    </div>
  )
}

export default function ValuationExitPanel({ primary, secondary, dealYi, dilution, method, readOnly, onMethodChange }) {
  const storedDual = primary?.exit_view?.scenario_mode === 'ma_and_ipo' && secondary?.exit_view
  const [which, setWhich] = useState('ma')
  const view = storedDual && which === 'ipo' ? secondary.exit_view : primary?.exit_view
  const axes = method?.sensitivity_axes === 'wacc_x_exit' ? 'exit_x_wacc' : (method?.sensitivity_axes || 'exit_x_cagr')
  const setMethod = (patch) => {
    if (readOnly || !onMethodChange) return
    onMethodChange(patch)
  }
  return (
    <div className="valuation-result-sens">
      <div className="valuation-sens-controls">
        <div className="valuation-sens-step">
          <span>敏感性</span>
          <Select
            size="small"
            style={{ width: 260 }}
            disabled={!!readOnly}
            getPopupContainer={() => document.body}
            value={axes}
            onChange={(v) => setMethod({ sensitivity_axes: v })}
            options={AXIS_OPTIONS}
          />
        </div>
        {axes === 'exit_x_wacc' ? (
          <StepControl label="折现率步长" value={method?.rate_step} fallback={0.02} presets={[2, 4]} percent disabled={!!readOnly} onChange={(v) => setMethod({ rate_step: v })} />
        ) : null}
        {axes === 'exit_x_cagr' || axes === 'rev_cagr_x_rd_cagr' ? (
          <StepControl label="营收 CAGR 步长" value={method?.cagr_step} fallback={0.05} presets={[2.5, 5]} percent disabled={!!readOnly} onChange={(v) => setMethod({ cagr_step: v })} />
        ) : null}
        {axes === 'exit_x_rd_cagr' || axes === 'rev_cagr_x_rd_cagr' ? (
          <StepControl label="研发费用 CAGR 步长" value={method?.rd_cagr_step} fallback={0.05} presets={[2.5, 5]} percent disabled={!!readOnly} onChange={(v) => setMethod({ rd_cagr_step: v })} />
        ) : null}
        {axes === 'rev_cagr_x_rd_cagr' ? null : (
          <>
            <StepControl label="P/E 步长" value={method?.pe_multiple_step} fallback={10} presets={[5, 10]} disabled={!!readOnly} onChange={(v) => setMethod({ pe_multiple_step: v })} />
            <StepControl label="P/S 步长" value={method?.ps_multiple_step} fallback={2} presets={[2, 5]} disabled={!!readOnly} onChange={(v) => setMethod({ ps_multiple_step: v })} />
          </>
        )}
      </div>
      {storedDual ? (
        <Radio.Group
          type="button"
          size="small"
          value={which}
          onChange={setWhich}
          style={{ marginBottom: 8 }}
          options={[
            { label: '并购', value: 'ma' },
            { label: '上市', value: 'ipo' },
          ]}
        />
      ) : null}
      <OneScenario view={view} dealYi={dealYi} dilution={dilution} />
    </div>
  )
}
