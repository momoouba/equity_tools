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

function formatGrowth(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Math.round(Number(v) * 10000) / 100
  return `${Number(n.toFixed(2))}%`
}

export function formatExitRange(view, { includeGordon = true } = {}) {
  const vals = [
    view?.pe?.equity_yi,
    view?.ps?.equity_yi,
    includeGordon ? view?.gordon?.equity_yi : null,
  ].filter((v) => v != null && Number.isFinite(Number(v)))
  if (!vals.length) return '—'
  const lo = Math.min(...vals.map(Number))
  const hi = Math.max(...vals.map(Number))
  if (lo === hi) return `${fmt2(lo)} 亿`
  return `${fmt2(lo)} ~ ${fmt2(hi)} 亿`
}

export function formatExitLine(kind, side, dealYi, dilution, years) {
  if (!side || side.blocked || side.equity_yi == null) return null
  const marker = kind === '永续增长'
    ? `永续增长 ${formatGrowth(side.growth)}`
    : `退出 ${kind} ${formatMultiple(side.multiple)}`
  const head = `${marker} → 股权价值 ${fmt2(side.equity_yi)} 亿；退出市值 ${fmt2(side.cap_yi)} 亿`
  const hold = years == null ? '' : `（持有 ${Number(years).toFixed(2)} 年）`
  const m = exitMocIrr(side.cap_yi, dilution, dealYi, years)
  if (m.note === 'MOC 不为正，无 IRR') return `${head}；退出 MOC ${fmt2(m.moc)}；MOC 不为正，无 IRR${hold}`
  if (m.note) return `${head}；退出 MOC、退出 IRR ${m.note}`
  const irr = m.irr == null ? '—' : `${Number(m.irr).toFixed(1)}%`
  return `${head}；退出 MOC ${fmt2(m.moc)}；退出 IRR ${irr}${hold}`
}

function cellText(cell, block, dealYi, dilution, years) {
  if (!cell || cell.blank === 'revenue' || cell.blank === 'other' || cell.blank === 'multiple') return '—'
  if (cell.blank === 'nopat' || cell.blank === 'gordon') return '—'
  if (block === 'equity') return cell.equity_yi == null ? '—' : fmt2(cell.equity_yi)
  const m = exitMocIrr(cell.cap_yi, dilution, dealYi, years)
  if (block === 'moc') {
    if (m.moc == null) return '—'
    return fmt2(m.moc)
  }
  if (m.note === 'MOC 不为正，无 IRR') return '—'
  if (m.irr == null) return '—'
  return `${Number(m.irr).toFixed(1)}%`
}

function cellTitle(cell, block, dealYi, dilution, years) {
  if (!cell) return ''
  if (cell.blank === 'nopat') return '税后经营利润小于等于 0'
  if (cell.blank === 'gordon') return 'g ≥ r 或现金流非正'
  if (cell.blank === 'revenue' || cell.blank === 'other' || cell.blank === 'multiple') return '无效'
  if (block === 'equity') return ''
  const m = exitMocIrr(cell.cap_yi, dilution, dealYi, years)
  return m.note || ''
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
                const inBand = side.center_row != null
                  && side.center_col != null
                  && Math.abs(i - side.center_row) <= 1
                  && Math.abs(j - side.center_col) <= 1
                  && cell?.equity_yi != null
                  && Number.isFinite(Number(cell.equity_yi))
                const center = i === side.center_row && j === side.center_col
                const cls = inBand ? (center ? 'is-center is-band' : 'is-band') : undefined
                return (
                  <td key={`${i}-${j}`} className={cls} title={cellTitle(cell, block, dealYi, dilution, years)}>
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

function Block({ title, subtitle, pe, ps, gordon, block, dealYi, dilution, years, axis }) {
  const peTitle = `退出 P/E · ${axis}`
  const psTitle = `退出 P/S · ${axis}`
  const gTitle = viewAxisForGordon(axis)
  if (!pe?.cells && !ps?.cells && !gordon?.cells) return null
  return (
    <div className="valuation-sens-block">
      <div className="valuation-sens-block-title">{title}</div>
      {subtitle ? <div className="valuation-sens-block-sub">{subtitle}</div> : null}
      <div className="valuation-sens-pair">
        <SensTable title={peTitle} side={pe} block={block} dealYi={dealYi} dilution={dilution} years={years} />
        <SensTable title={psTitle} side={ps} block={block} dealYi={dealYi} dilution={dilution} years={years} />
        <SensTable title={gTitle} side={gordon} block={block} dealYi={dealYi} dilution={dilution} years={years} />
      </div>
    </div>
  )
}

function viewAxisForGordon(axis) {
  if (!axis) return '永续增长'
  if (axis.includes('退出倍数')) return axis.replace('退出倍数', '永续增长率')
  return `永续增长 · ${axis}`
}

function axisTitle(view) {
  if (view?.axis_title) return view.axis_title
  if (view?.axes === 'exit_x_wacc') return '折现率 × 退出倍数'
  if (view?.axes === 'rate_x_g') return '折现率 × 永续增长率'
  if (view?.axes === 'exit_x_rd_cagr') return '研发费用 CAGR × 退出倍数'
  if (view?.axes === 'rev_cagr_x_rd_cagr') return '营收 CAGR × 研发费用 CAGR'
  if (view?.axes === 'univariate') return '单变量试算'
  if (view?.axes === 'custom') return '自定义'
  return '营收 CAGR × 退出倍数'
}

function OneScenario({ view, dealYi, dilution }) {
  if (!view) return <Typography.Text type="secondary">请点「刷新敏感性」或「开始采集/计算/保存」后显示敏感性</Typography.Text>
  const axis = axisTitle(view)
  const deal = Number(dealYi)
  const d = dilution == null || dilution === '' ? 1 : Number(dilution)
  const showReturn = deal > 0 && Number.isFinite(d) && d >= 0 && d <= 1
  const years = view.holding_years
  const yearText = years == null ? '' : `持有 ${Number(years).toFixed(2)} 年`
  let returnNote = null
  if (!showReturn) {
    returnNote = !(deal > 0) ? '待填写本轮交易估值（投前）后显示退出 MOC / IRR' : '后续股权稀释需在 0% 到 100%'
  }
  return (
    <div>
      {!showReturn ? (
        <Typography.Paragraph type="secondary" className="valuation-sens-block-sub">{returnNote}</Typography.Paragraph>
      ) : null}
      <Block title="估值" pe={view.pe} ps={view.ps} gordon={view.gordon} block="equity" dealYi={dealYi} dilution={dilution} years={years} axis={axis} />
      {showReturn ? (
        <>
          <Block title="退出 MOC" pe={view.pe} ps={view.ps} gordon={view.gordon} block="moc" dealYi={dealYi} dilution={dilution} years={years} axis={axis} />
          <Block title="退出 IRR" subtitle={yearText} pe={view.pe} ps={view.ps} gordon={view.gordon} block="irr" dealYi={dealYi} dilution={dilution} years={years} axis={axis} />
        </>
      ) : null}
      {view.wacc_floored ? (
        <div className="valuation-sens-block-sub">折现率低于 1% 的档已按 1% 计算。</div>
      ) : null}
    </div>
  )
}

export function DcfExitCard({ primary, secondary, dealYi, dilution, mode = 'exits' }) {
  const [open, setOpen] = useState(false)
  const view = primary?.exit_view
  const other = secondary?.exit_view
  const dual = view?.scenario_mode === 'ma_and_ipo' && other
  const showExits = mode === 'exits' || mode === 'all'
  const showGordon = mode === 'gordon' || mode === 'all'
  const summary = (item, prefix) => (
    <div className={prefix ? 'valuation-exit-line' : 'num'}>
      {prefix}{formatExitRange(item, { includeGordon: showGordon })}
    </div>
  )
  const detail = (item) => (
    <>
      {showExits ? (
        <>
          <div className="valuation-exit-line">{formatExitLine('P/E', item.pe, dealYi, dilution, item.holding_years)}</div>
          <div className="valuation-exit-line">{formatExitLine('P/S', item.ps, dealYi, dilution, item.holding_years)}</div>
        </>
      ) : null}
      {showGordon ? (
        <div className="valuation-exit-line">
          {formatExitLine('永续增长', item.gordon, dealYi, dilution, item.holding_years)}
        </div>
      ) : null}
    </>
  )
  if (!view) return null
  return (
    <>
      <div className="valuation-card-kicker">上次计算</div>
      {dual ? (
        <>
          {summary(view, '并购 ')}
          {summary(other, '上市 ')}
        </>
      ) : summary(view, '')}
      <button type="button" className="valuation-card-detail-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起明细' : '展开明细'}
      </button>
      {open ? (
        <div className="valuation-card-detail-body">
          {dual ? (
            <>
              <div className="valuation-exit-line">并购</div>
              {detail(view)}
              <div className="valuation-exit-line">上市</div>
              {detail(other)}
            </>
          ) : detail(view)}
        </div>
      ) : null}
    </>
  )
}

function gordonDetailLines(side, term, dealYi, dilution, years, prefix) {
  if (!side || side.blocked || side.equity_yi == null) {
    return (
      <div className="valuation-exit-line">
        {prefix || ''}未算出{term?.blockers?.length ? `：${term.blockers.join('；')}` : ''}
      </div>
    )
  }
  const m = exitMocIrr(side.cap_yi, dilution, dealYi, years)
  const hold = years == null ? '' : `（持有 ${Number(years).toFixed(2)} 年）`
  let mocIrr = ''
  if (m.note === 'MOC 不为正，无 IRR') mocIrr = `退出 MOC ${fmt2(m.moc)}；MOC 不为正，无 IRR${hold}`
  else if (m.note) mocIrr = `退出 MOC、退出 IRR ${m.note}`
  else {
    const irr = m.irr == null ? '—' : `${Number(m.irr).toFixed(1)}%`
    mocIrr = `退出 MOC ${fmt2(m.moc)}；退出 IRR ${irr}${hold}`
  }
  const mode = term?.stage_mode === 'three_stage' ? '三阶段' : '两阶段'
  const s1 = `一阶段 ${term?.stage1_years ?? '—'} 年 / ${fmtPctMaybe(term?.stage1_growth)}`
  const s2 = term?.stage_mode === 'three_stage'
    ? `；二阶段 ${term?.stage2_years ?? '—'} 年 / ${fmtPctMaybe(term?.stage2_growth)}`
    : ''
  const delta = term?.two_stage_compare && !term.two_stage_compare.blocked && term.two_stage_compare.delta_equity_value_yi != null
    ? `；相对两阶段差额 ${fmt2(term.two_stage_compare.delta_equity_value_yi)} 亿`
    : ''
  return (
    <>
      <div className="valuation-exit-line">{prefix || ''}永续增长 {formatGrowth(side.growth)}</div>
      <div className="valuation-exit-line">{mocIrr}</div>
      <div className="valuation-exit-line">{mode}：{s1}{s2}{delta}</div>
    </>
  )
}

export function DcfGordonCard({ primary, secondary, dealYi, dilution }) {
  const [open, setOpen] = useState(false)
  const view = primary?.exit_view
  const other = secondary?.exit_view
  const term = primary?.terminals?.gordon || view?.terminals?.gordon
  const otherTerm = secondary?.terminals?.gordon || other?.terminals?.gordon
  const dual = view?.scenario_mode === 'ma_and_ipo' && other
  if (!view) return null
  const head = (side, prefix) => {
    if (!side || side.blocked || side.equity_yi == null) {
      return <div className="valuation-exit-line">{prefix || ''}未算出</div>
    }
    return (
      <>
        {prefix ? <div className="valuation-exit-line">{prefix}</div> : null}
        <div className="valuation-gordon-metrics">
          <div className="num">股权价值 {fmt2(side.equity_yi)} 亿</div>
          <div className="num">退出市值 {fmt2(side.cap_yi)} 亿</div>
        </div>
      </>
    )
  }
  return (
    <>
      <div className="valuation-card-kicker">上次计算</div>
      {dual ? (
        <>
          {head(view.gordon, '并购')}
          {head(other.gordon, '上市')}
        </>
      ) : head(view.gordon, '')}
      <button type="button" className="valuation-card-detail-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起明细' : '展开明细'}
      </button>
      {open ? (
        <div className="valuation-card-detail-body">
          {dual ? (
            <>
              {gordonDetailLines(view.gordon, term, dealYi, dilution, view.holding_years, '并购 ')}
              {gordonDetailLines(other.gordon, otherTerm, dealYi, dilution, other.holding_years, '上市 ')}
            </>
          ) : (
            gordonDetailLines(view.gordon, term, dealYi, dilution, view.holding_years, '')
          )}
        </div>
      ) : null}
    </>
  )
}

function fmtPctMaybe(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

const AXIS_OPTIONS = [
  { value: 'exit_x_cagr', label: '营收 CAGR × 退出倍数' },
  { value: 'exit_x_wacc', label: '折现率 × 退出倍数' },
  { value: 'rate_x_g', label: '折现率 × 永续增长率' },
  { value: 'exit_x_rd_cagr', label: '研发费用 CAGR × 退出倍数' },
  { value: 'rev_cagr_x_rd_cagr', label: '营收 CAGR × 研发费用 CAGR' },
  { value: 'univariate', label: '单变量试算' },
  { value: 'custom', label: '自定义' },
]

const PARAM_OPTIONS = [
  { value: 'rev_cagr', label: '营收 CAGR' },
  { value: 'rd_cagr', label: '研发费用 CAGR' },
  { value: 'rate', label: '折现率' },
  { value: 'exit_multiple', label: '退出倍数' },
  { value: 'perp_growth', label: '永续增长率' },
  { value: 'gross_margin', label: '毛利率' },
  { value: 'selling_ratio', label: '销售费用率' },
  { value: 'admin_ratio', label: '管理费用率' },
  { value: 'rd_ratio', label: '研发费用率' },
  { value: 'capex_ratio', label: '资本开支率' },
  { value: 'dso', label: 'DSO' },
  { value: 'dio', label: '存货周转天数' },
  { value: 'dpo', label: 'DPO' },
]

const PCT_PARAMS = new Set(['rev_cagr', 'rd_cagr', 'rate', 'perp_growth', 'gross_margin', 'selling_ratio', 'admin_ratio', 'rd_ratio', 'capex_ratio'])

function parseLevelsInput(text, percent) {
  const parts = String(text || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)
  const out = []
  for (const p of parts) {
    const n = Number(String(p).replace(/%/g, ''))
    if (!Number.isFinite(n)) continue
    out.push(percent ? n / 100 : n)
  }
  return out
}

function formatLevelsInput(levels, percent) {
  if (!Array.isArray(levels) || !levels.length) return ''
  return levels.map((n) => {
    if (percent) return String(Math.round(Number(n) * 10000) / 100)
    return String(n)
  }).join(', ')
}

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

export default function ValuationExitPanel({
  primary, secondary, dealYi, dilution, method, readOnly, onMethodChange, onRefresh, refreshing,
}) {
  const storedDual = primary?.exit_view?.scenario_mode === 'ma_and_ipo' && secondary?.exit_view
  const [which, setWhich] = useState('ma')
  const view = storedDual && which === 'ipo' ? secondary.exit_view : primary?.exit_view
  const axes = method?.sensitivity_axes === 'wacc_x_exit' ? 'exit_x_wacc' : (method?.sensitivity_axes || 'exit_x_cagr')
  const setMethod = (patch) => {
    if (readOnly || !onMethodChange) return
    onMethodChange(patch)
  }
  const quickAxes = [
    { value: 'exit_x_cagr', label: '营收×退出' },
    { value: 'exit_x_wacc', label: '折现×退出' },
    { value: 'rate_x_g', label: '折现×永续' },
    { value: 'rev_cagr_x_rd_cagr', label: '营收×研发' },
  ]
  return (
    <div className="valuation-result-sens">
      <div className="valuation-sens-controls">
        <div className="valuation-sens-step">
          <span>敏感性</span>
          <Select
            size="small"
            style={{ width: 220 }}
            disabled={!!readOnly}
            getPopupContainer={() => document.body}
            value={axes}
            onChange={(v) => setMethod({ sensitivity_axes: v })}
            options={AXIS_OPTIONS}
          />
        </div>
        <div className="valuation-sens-quick">
          {quickAxes.map((q) => (
            <Button
              key={q.value}
              size="mini"
              type={axes === q.value ? 'primary' : 'outline'}
              disabled={!!readOnly}
              onClick={() => setMethod({ sensitivity_axes: q.value })}
            >
              {q.label}
            </Button>
          ))}
        </div>
        {onRefresh ? (
          <Button
            type="primary"
            size="small"
            loading={!!refreshing}
            disabled={!!readOnly || !!refreshing}
            onClick={() => onRefresh()}
          >
            刷新敏感性
          </Button>
        ) : null}
      </div>
      <div className="valuation-sens-controls valuation-sens-controls-steps">
        {axes === 'exit_x_wacc' || axes === 'rate_x_g' ? (
          <StepControl label="折现率步长" value={method?.rate_step} fallback={0.02} presets={[2, 4]} percent disabled={!!readOnly} onChange={(v) => setMethod({ rate_step: v })} />
        ) : null}
        {axes === 'rate_x_g' || axes === 'exit_x_cagr' || axes === 'exit_x_wacc' || axes === 'exit_x_rd_cagr' ? (
          <StepControl label="永续增长率步长" value={method?.growth_step} fallback={0.005} presets={[0.5, 1]} percent disabled={!!readOnly} onChange={(v) => setMethod({ growth_step: v })} />
        ) : null}
        {axes === 'exit_x_cagr' || axes === 'rev_cagr_x_rd_cagr' ? (
          <StepControl label="营收 CAGR 步长" value={method?.cagr_step} fallback={0.05} presets={[2.5, 5]} percent disabled={!!readOnly} onChange={(v) => setMethod({ cagr_step: v })} />
        ) : null}
        {axes === 'exit_x_rd_cagr' || axes === 'rev_cagr_x_rd_cagr' ? (
          <StepControl label="研发费用 CAGR 步长" value={method?.rd_cagr_step} fallback={0.05} presets={[2.5, 5]} percent disabled={!!readOnly} onChange={(v) => setMethod({ rd_cagr_step: v })} />
        ) : null}
        {axes === 'rev_cagr_x_rd_cagr' || axes === 'univariate' || axes === 'custom' ? null : (
          <>
            <StepControl label="P/E 步长" value={method?.pe_multiple_step} fallback={10} presets={[5, 10]} disabled={!!readOnly} onChange={(v) => setMethod({ pe_multiple_step: v })} />
            <StepControl label="P/S 步长" value={method?.ps_multiple_step} fallback={2} presets={[2, 5]} disabled={!!readOnly} onChange={(v) => setMethod({ ps_multiple_step: v })} />
          </>
        )}
        {axes === 'univariate' || axes === 'custom' ? (
          <>
            <div className="valuation-sens-step">
              <span>{axes === 'univariate' ? '参数' : '纵轴'}</span>
              <Select
                size="small"
                style={{ width: 160 }}
                disabled={!!readOnly}
                getPopupContainer={() => document.body}
                value={method?.sensitivity_row_param || 'rev_cagr'}
                onChange={(v) => setMethod({ sensitivity_row_param: v })}
                options={PARAM_OPTIONS}
              />
            </div>
            {axes === 'custom' ? (
              <div className="valuation-sens-step">
                <span>横轴</span>
                <Select
                  size="small"
                  style={{ width: 160 }}
                  disabled={!!readOnly}
                  getPopupContainer={() => document.body}
                  value={method?.sensitivity_col_param || 'exit_multiple'}
                  onChange={(v) => setMethod({ sensitivity_col_param: v })}
                  options={PARAM_OPTIONS}
                />
              </div>
            ) : null}
            <div className="valuation-sens-step">
              <span>纵轴模式</span>
              <Select
                size="small"
                style={{ width: 100 }}
                disabled={!!readOnly}
                getPopupContainer={() => document.body}
                value={method?.sensitivity_row_mode || 'step'}
                onChange={(v) => setMethod({ sensitivity_row_mode: v })}
                options={[
                  { value: 'step', label: '步长' },
                  { value: 'levels', label: '档位 Δ' },
                ]}
              />
            </div>
            {(method?.sensitivity_row_mode || 'step') === 'step' ? (
              <StepControl
                label="纵轴步长"
                value={method?.sensitivity_row_step}
                fallback={PCT_PARAMS.has(method?.sensitivity_row_param || 'rev_cagr') ? 0.05 : 5}
                presets={PCT_PARAMS.has(method?.sensitivity_row_param || 'rev_cagr') ? [2.5, 5] : [5, 10]}
                percent={PCT_PARAMS.has(method?.sensitivity_row_param || 'rev_cagr')}
                disabled={!!readOnly}
                onChange={(v) => setMethod({ sensitivity_row_step: v })}
              />
            ) : (
              <div className="valuation-sens-step">
                <span>纵轴 Δ</span>
                <input
                  className="arco-input arco-input-size-small"
                  style={{ width: 180 }}
                  disabled={!!readOnly}
                  placeholder={PCT_PARAMS.has(method?.sensitivity_row_param || 'rev_cagr') ? '-5, 0, 5' : '-10, 0, 10'}
                  defaultValue={formatLevelsInput(method?.sensitivity_row_levels, PCT_PARAMS.has(method?.sensitivity_row_param || 'rev_cagr'))}
                  onBlur={(e) => setMethod({
                    sensitivity_row_levels: parseLevelsInput(e.target.value, PCT_PARAMS.has(method?.sensitivity_row_param || 'rev_cagr')),
                  })}
                />
              </div>
            )}
            {axes === 'custom' ? (
              <>
                <div className="valuation-sens-step">
                  <span>横轴模式</span>
                  <Select
                    size="small"
                    style={{ width: 100 }}
                    disabled={!!readOnly}
                    getPopupContainer={() => document.body}
                    value={method?.sensitivity_col_mode || 'step'}
                    onChange={(v) => setMethod({ sensitivity_col_mode: v })}
                    options={[
                      { value: 'step', label: '步长' },
                      { value: 'levels', label: '档位 Δ' },
                    ]}
                  />
                </div>
                {(method?.sensitivity_col_mode || 'step') === 'step' ? (
                  <StepControl
                    label="横轴步长"
                    value={method?.sensitivity_col_step}
                    fallback={PCT_PARAMS.has(method?.sensitivity_col_param || 'exit_multiple') ? 0.05 : 5}
                    presets={PCT_PARAMS.has(method?.sensitivity_col_param || 'exit_multiple') ? [2.5, 5] : [5, 10]}
                    percent={PCT_PARAMS.has(method?.sensitivity_col_param || 'exit_multiple')}
                    disabled={!!readOnly}
                    onChange={(v) => setMethod({ sensitivity_col_step: v })}
                  />
                ) : (
                  <div className="valuation-sens-step">
                    <span>横轴 Δ</span>
                    <input
                      className="arco-input arco-input-size-small"
                      style={{ width: 180 }}
                      disabled={!!readOnly}
                      placeholder="-5, 0, 5"
                      defaultValue={formatLevelsInput(method?.sensitivity_col_levels, PCT_PARAMS.has(method?.sensitivity_col_param || 'exit_multiple'))}
                      onBlur={(e) => setMethod({
                        sensitivity_col_levels: parseLevelsInput(e.target.value, PCT_PARAMS.has(method?.sensitivity_col_param || 'exit_multiple')),
                      })}
                    />
                  </div>
                )}
              </>
            ) : null}
            {(method?.sensitivity_row_param === 'exit_multiple' || method?.sensitivity_col_param === 'exit_multiple' || (!method?.sensitivity_col_param && axes === 'custom')) ? (
              <>
                <StepControl label="P/E 步长" value={method?.pe_multiple_step} fallback={10} presets={[5, 10]} disabled={!!readOnly} onChange={(v) => setMethod({ pe_multiple_step: v })} />
                <StepControl label="P/S 步长" value={method?.ps_multiple_step} fallback={2} presets={[2, 5]} disabled={!!readOnly} onChange={(v) => setMethod({ ps_multiple_step: v })} />
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <Typography.Paragraph type="secondary" className="valuation-sens-block-sub" style={{ marginBottom: 8 }}>
        改轴或步长后点「刷新敏感性」才会按新参数重算表格。P/E、P/S、永续三套并排显示。
      </Typography.Paragraph>
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
