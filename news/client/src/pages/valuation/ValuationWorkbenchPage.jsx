import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, Input, InputNumber, Select, Switch, Message, Space,
  Typography, Alert, Upload, Progress, Modal, Checkbox, Tag, DatePicker, Tabs,
} from '@arco-design/web-react'
import { IconClose } from '@arco-design/web-react/icon'
import {
  fetchValuationCase, fetchValuationDraft, putValuationDraft, patchValuationCase,
  fetchComparablePreview, fetchCaseComparables, fetchComparableFinancials, putCaseComparables, postManualComparable,
  importComparablesExcel, patchCaseComparable, postValuationJob, fetchValuationJob,
  postValuationVersion, fetchValuationVersion, postValuationDraftFromVersion, downloadValuationExport,
  fetchIndustryMultiplesStatus,
  fetchSwIndustryNames,
} from '../../api/valuation'
import ValuationDetailModal from './ValuationDetailModal'
import { coercePayloadToWan, fmtYi, fmtNum, fmtPct, fmtAmountWan, roundWanToFen, wanInputNumberProps, formatChinaDateTime, formatChinaYmd, previewWaccBreakdown } from './valuationUnits'
import ValuationFootballField from './ValuationFootballField'
import {
  RelativeValuationTable,
  RatiosTables,
  MarketMethodTable,
  DcfProcessTables,
} from './valuationSheetTables'
import ComparableFinancialTable from './ComparableFinancialTable'
import { ListTable } from './valuationTable'
import ValuationMethodGuide from './ValuationMethodGuide'
import TargetFinancialImportBar from './TargetFinancialImportBar'
import ValuationTieOutPanel from './ValuationTieOutPanel'
import {
  BS_INPUT_FIELDS,
  BS_GROUPS,
  currentAssetsFromBs,
  totalAssetsFromBs,
  currentLiabFromBs,
  totalLiabFromBs,
  nwcStockFromBs,
  debtRatioFromBs,
  currentRatioFromBs,
  equityImpliedFromBs,
} from './valuationBsFields'
import VersionComparePanel from './VersionComparePanel'
import ValuationChangeLog from './ValuationChangeLog'
import './valuation.css'

const TabPane = Tabs.TabPane

const NAV_GROUPS = [
  {
    key: 'input',
    label: '用户录入',
    tone: 'input',
    items: [
      { key: 'method', title: '方法配置' },
      { key: 'comps', title: '可比与采集' },
      { key: 'pl', title: '标的利润表' },
      { key: 'bs', title: '标的资产负债表' },
      { key: 'cf', title: '标的现金流量表' },
      { key: 'changelog', title: '变更记录' },
    ],
  },
  {
    key: 'fetch',
    label: '系统取数',
    tone: 'fetch',
    divider: '采集完成后核验',
    items: [
      { key: 'comp_pl', title: '可比利润表' },
      { key: 'comp_bs', title: '可比资产负债表' },
      { key: 'comp_cf', title: '可比现金流量表' },
      { key: 'relative', title: '相对估值' },
      { key: 'ratios', title: '三费/毛利/营运' },
    ],
  },
  {
    key: 'result',
    label: '计算结果',
    tone: 'result',
    divider: '计算输出',
    items: [
      { key: 'result', title: '计算输出' },
    ],
  },
]
const STEPS = NAV_GROUPS.flatMap((g) => g.items)

const MARKET_LABEL = { sse: '上交所', szse: '深交所', bse: '北交所', neeq: '新三板' }

function emptyPl() {
  return { years: ['2026', '2027'], revenue: [0, 0], cogs: [], selling: [], admin: [], rd: [], operating_profit: [], net_income: [], revenue_growth: [] }
}

const PL_SERIES_KEYS = [
  'revenue', 'cogs', 'gross_profit', 'selling', 'admin', 'rd',
  'operating_profit', 'net_income', 'revenue_growth',
]

function splicePlYear(pl, index) {
  const years = [...(pl.years || [])]
  if (years.length <= 1 || index < 0 || index >= years.length) return pl
  years.splice(index, 1)
  const next = { ...pl, years }
  for (const k of PL_SERIES_KEYS) {
    if (Array.isArray(pl[k])) {
      const arr = [...pl[k]]
      arr.splice(index, 1)
      next[k] = arr
    }
  }
  return next
}

function numOrZero(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 系统默认口径：退出 PE × 末期净利润、净利润桥、退出倍数 × 收入 CAGR、个股 POOL */
function isDefaultMethodConfig(method) {
  return method?.terminal_type === 'exit_pe'
    && method?.fcf_method === 'ni_bridge'
    && method?.sensitivity_axes === 'exit_x_cagr'
    && (method?.multiple_source || 'stock_pool') === 'stock_pool'
}

function hasBsDebtInputs(bs) {
  if (!bs) return false
  return [bs.cash, bs.short_term_loan, bs.long_term_loan].some((v) => v != null && v !== '')
}

function computedNetDebtWan(bs) {
  if (!hasBsDebtInputs(bs)) return null
  return roundWanToFen(numOrZero(bs.short_term_loan) + numOrZero(bs.long_term_loan) - numOrZero(bs.cash))
}

function computedNwcWan(bs) {
  if (!bs) return null
  const n = nwcStockFromBs(bs)
  return n == null ? null : roundWanToFen(n)
}

function cfYearsFrom(pl, cf) {
  const fromPl = Array.isArray(pl?.years) ? pl.years.filter((y) => y != null && String(y).trim() !== '') : []
  if (fromPl.length) return fromPl.map(String)
  return (cf?.years || []).map(String).filter(Boolean)
}

function cfValueAtYear(cf, year, key) {
  const years = (cf?.years || []).map(String)
  const i = years.findIndex((y) => y === String(year))
  if (i < 0) return undefined
  return cf?.[key]?.[i]
}

function patchCfYear(payload, year, key, value) {
  const cf = { ...(payload.targetCf || {}) }
  const oldYears = (cf.years || []).map(String)
  const aligned = cfYearsFrom(payload.targetPl, cf)
  const years = aligned.length ? [...aligned] : [...oldYears]
  if (!years.includes(String(year))) years.push(String(year))
  const fromOld = (arr, y) => {
    const j = oldYears.findIndex((ey) => ey === y)
    return j >= 0 ? arr?.[j] : undefined
  }
  ;['da', 'capex', 'dnwc'].forEach((k) => {
    const src = Array.isArray(cf[k]) ? cf[k] : []
    cf[k] = years.map((y) => fromOld(src, y))
  })
  cf.years = years
  const i = years.findIndex((y) => y === String(year))
  cf[key][i] = value == null || value === '' ? null : value
  return { targetCf: cf }
}

function WanInput(props) {
  return <InputNumber {...wanInputNumberProps} {...props} />
}

function ratioToPct(v) {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : undefined
}

function PctInput({ value, onChange, ...props }) {
  return (
    <InputNumber
      hideControl
      min={0}
      max={100}
      step={1}
      suffix="%"
      style={{ width: '100%' }}
      value={ratioToPct(value)}
      onChange={(v) => onChange(v == null || v === '' ? v : Number(v) / 100)}
      {...props}
    />
  )
}

function DcfNumInput({ suffix, ...props }) {
  return (
    <InputNumber
      hideControl
      suffix={suffix}
      style={{ width: '100%' }}
      {...props}
    />
  )
}

function scenarioPatch(payload, key, field, v) {
  return {
    scenarios: {
      ...payload.scenarios,
      [key]: { ...(payload.scenarios?.[key] || {}), [field]: v },
    },
  }
}

function mergeRelativeOverrides(rows, comps) {
  const by = new Map((comps || []).map((c) => [String(c.stock_code), c]))
  return (rows || []).map((r) => {
    const c = by.get(String(r.stock_code))
    if (!c) return r
    return {
      ...r,
      pe_median_override: c.pe_median_override !== undefined ? c.pe_median_override : r.pe_median_override,
      ps_median_override: c.ps_median_override !== undefined ? c.ps_median_override : r.ps_median_override,
    }
  })
}

function dualParamsLookSame(method, assumptions, payload) {
  if (method?.scenario_mode !== 'ma_and_ipo') return false
  const ma = payload.scenarios?.ma || {}
  const ipo = payload.scenarios?.ipo || {}
  const n = (v, fb) => Number(v ?? fb)
  const sameRate = n(ma.discount_rate, assumptions.discount_rate) === n(ipo.discount_rate, assumptions.discount_rate)
  const samePe = n(ma.exit_pe, assumptions.exit_pe) === n(ipo.exit_pe, assumptions.exit_pe)
  const samePs = n(ma.exit_ps, assumptions.exit_ps) === n(ipo.exit_ps, assumptions.exit_ps)
  return sameRate && samePe && samePs
}

function patchWacc(assumptions, patchPayload, key, v) {
  patchPayload({
    assumptions: {
      ...assumptions,
      wacc_breakdown: { ...(assumptions.wacc_breakdown || {}), [key]: v == null || v === '' ? null : v },
    },
  })
}

function WaccBreakdownBlock({ assumptions, payload, patchPayload }) {
  const w = assumptions.wacc_breakdown || {}
  const preview = previewWaccBreakdown(w, assumptions.discount_rate, assumptions.tax_rate)
  return (
    <div className="valuation-wacc-block">
      <div className="valuation-dcf-param-head">
        <Typography.Title heading={6} className="valuation-ratio-col-title">WACC 分项</Typography.Title>
        <Tag size="small">{preview.used_breakdown ? '已覆盖汇总折现率' : '可空'}</Tag>
      </div>
      <div className="valuation-dcf-param-grid">
        <div className="valuation-dcf-param-item">
          <span>无风险利率</span>
          <PctInput value={w.risk_free_rate} onChange={(v) => patchWacc(assumptions, patchPayload, 'risk_free_rate', v)} />
        </div>
        <div className="valuation-dcf-param-item">
          <span>ERP</span>
          <PctInput value={w.erp} onChange={(v) => patchWacc(assumptions, patchPayload, 'erp', v)} />
        </div>
        <div className="valuation-dcf-param-item">
          <span>Beta</span>
          <DcfNumInput
            precision={2}
            value={w.beta}
            onChange={(v) => patchWacc(assumptions, patchPayload, 'beta', v)}
          />
        </div>
        <div className="valuation-dcf-param-item">
          <span>D/E（债务/权益）</span>
          <DcfNumInput
            precision={4}
            value={w.debt_equity}
            onChange={(v) => patchWacc(assumptions, patchPayload, 'debt_equity', v)}
          />
        </div>
        <div className="valuation-dcf-param-item">
          <span>债务成本</span>
          <PctInput value={w.debt_cost} onChange={(v) => patchWacc(assumptions, patchPayload, 'debt_cost', v)} />
        </div>
        <div className="valuation-dcf-param-item">
          <span>所得税率（税盾）</span>
          <PctInput
            value={assumptions.tax_rate}
            onChange={(v) => patchPayload({ assumptions: { ...assumptions, tax_rate: v } })}
          />
        </div>
      </div>
      <Typography.Paragraph className="valuation-dcf-terminal-hint">
        {preview.used_breakdown
          ? `Ke = 无风险利率 + Beta × ERP = ${fmtPct(preview.ke, 1)}；WACC = We×Ke + Wd×Kd×(1−t) = ${fmtPct(preview.rate, 1)}。只计算后 DCF 用这个折现率。D/E、债务成本可空，空则按全权益（WACC=Ke）。`
          : preview.incomplete
            ? '请填齐无风险利率、ERP、Beta，才会用分项 WACC；只填一部分仍用上面的汇总折现率。'
            : '三项都空则用汇总折现率（默认 30%）。填齐无风险利率、ERP、Beta 后覆盖汇总折现率。'}
        {payload?.wacc?.used_breakdown ? ` 上次计算：WACC ${fmtPct(payload.wacc.rate, 1)}。` : ''}
      </Typography.Paragraph>
    </div>
  )
}

function buildDcfParamFields({ method, assumptions, payload, patchPayload }) {
  const usePs = method.terminal_type === 'exit_ps'
  const waccPreview = previewWaccBreakdown(assumptions.wacc_breakdown, assumptions.discount_rate, assumptions.tax_rate)
  const fields = [
    {
      label: waccPreview.used_breakdown ? '汇总折现率（已由 WACC 分项计算）' : '汇总折现率（默认 30%）',
      control: (
        <PctInput
          disabled={waccPreview.used_breakdown}
          value={waccPreview.used_breakdown ? waccPreview.rate : assumptions.discount_rate}
          onChange={(v) => patchPayload({ assumptions: { ...assumptions, discount_rate: v } })}
        />
      ),
    },
  ]
  if (method.scenario_mode !== 'ma_and_ipo') {
    fields.push(usePs
      ? {
        label: '退出 P/S（终值用此项 × 末期收入）',
        control: (
          <DcfNumInput
            value={assumptions.exit_ps}
            onChange={(v) => patchPayload({ assumptions: { ...assumptions, exit_ps: v } })}
          />
        ),
      }
      : {
        label: '退出 P/E（终值用此项 × 末期净利润）',
        control: (
          <DcfNumInput
            value={assumptions.exit_pe}
            onChange={(v) => patchPayload({ assumptions: { ...assumptions, exit_pe: v } })}
          />
        ),
      })
  }
  fields.push({
    label: '市场法流动性折扣',
    control: (
      <PctInput
        value={assumptions.liquidity_discount}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, liquidity_discount: v } })}
      />
    ),
  })
  fields.push({
    label: 'P/S 低端倍数（空=POOL −1σ）',
    control: (
      <DcfNumInput
        value={assumptions.ps_low_multiple}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, ps_low_multiple: v } })}
      />
    ),
  })
  fields.push({
    label: 'P/S 中位倍数（空=POOL 中位）',
    control: (
      <DcfNumInput
        value={assumptions.ps_median_multiple}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, ps_median_multiple: v } })}
      />
    ),
  })
  fields.push({
    label: 'P/E 低端倍数（空=POOL −1σ）',
    control: (
      <DcfNumInput
        value={assumptions.pe_low_multiple}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, pe_low_multiple: v } })}
      />
    ),
  })
  fields.push({
    label: 'P/E 中位倍数（空=POOL 中位）',
    control: (
      <DcfNumInput
        value={assumptions.pe_median_multiple}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, pe_median_multiple: v } })}
      />
    ),
  })
  const dcfLiqApplies = method.scenario_mode === 'ma_and_ipo' || method.fcf_method === 'nopat_fcff'
  if (dcfLiqApplies) {
    fields.push({
      label: method.scenario_mode === 'ma_and_ipo' ? '并购 DCF 流动性折扣' : 'DCF 流动性折扣',
      control: (
        <PctInput
          value={assumptions.dcf_liquidity_discount ?? assumptions.liquidity_discount}
          onChange={(v) => patchPayload({ assumptions: { ...assumptions, dcf_liquidity_discount: v } })}
        />
      ),
    })
  }
  const esopField = {
    label: 'ESOP',
    control: (
      <DcfNumInput
        {...wanInputNumberProps}
        suffix="万元"
        value={assumptions.esop}
        onChange={(v) => patchPayload({ assumptions: { ...assumptions, esop: v ?? 0 } })}
      />
    ),
  }
  if (method.scenario_mode === 'ma_and_ipo') {
    fields.push(
      {
        label: '上市折现率',
        control: (
          <PctInput
            value={payload.scenarios?.ipo?.discount_rate ?? assumptions.discount_rate}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ipo', 'discount_rate', v))}
          />
        ),
      },
      {
        label: '并购折现率',
        control: (
          <PctInput
            value={payload.scenarios?.ma?.discount_rate ?? assumptions.discount_rate}
            onChange={(v) => patchPayload(scenarioPatch(payload, 'ma', 'discount_rate', v))}
          />
        ),
      },
      esopField,
    )
    if (method.terminal_type === 'exit_ps') {
      fields.push(
        {
          label: '上市退出 P/S（终值 × 末期收入）',
          control: (
            <DcfNumInput
              value={payload.scenarios?.ipo?.exit_ps ?? assumptions.exit_ps}
              onChange={(v) => patchPayload(scenarioPatch(payload, 'ipo', 'exit_ps', v))}
            />
          ),
        },
        {
          label: '并购退出 P/S（终值 × 末期收入）',
          control: (
            <DcfNumInput
              value={payload.scenarios?.ma?.exit_ps ?? assumptions.exit_ps}
              onChange={(v) => patchPayload(scenarioPatch(payload, 'ma', 'exit_ps', v))}
            />
          ),
        },
      )
    } else {
      fields.push(
        {
          label: '上市退出 P/E（终值 × 末期净利润）',
          control: (
            <DcfNumInput
              value={payload.scenarios?.ipo?.exit_pe ?? assumptions.exit_pe}
              onChange={(v) => patchPayload(scenarioPatch(payload, 'ipo', 'exit_pe', v))}
            />
          ),
        },
        {
          label: '并购退出 P/E（终值 × 末期净利润）',
          control: (
            <DcfNumInput
              value={payload.scenarios?.ma?.exit_pe ?? assumptions.exit_pe}
              onChange={(v) => patchPayload(scenarioPatch(payload, 'ma', 'exit_pe', v))}
            />
          ),
        },
      )
    }
  } else {
    fields.push(esopField)
  }
  return fields
}

function splitValuationNotices(list) {
  const info = []
  const warn = []
  for (const w of list || []) {
    const m = String(w)
    if (/实时截面超时|东方财富(实时)?行情超时|东方财富接口超时|socket hang up|本次不会写入失败行情|可能不是今日截面|实时截面无效/i.test(m)) {
      continue
    }
    if (/已跳过抓取|仅用库内数据重算|市场法按(锚定日|今天)|折现率已用 WACC|WACC 分项未填齐|行业法：/.test(m)) {
      info.push(m)
      continue
    }
    warn.push(m)
  }
  return { info, warn }
}

export default function ValuationWorkbenchPage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const [step, setStep] = useState('method')
  const [cse, setCse] = useState(null)
  const [payload, setPayload] = useState(null)
  const [comps, setComps] = useState([])
  const [previewMsg, setPreviewMsg] = useState('')
  const [refreshBlocked, setRefreshBlocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [compFinancials, setCompFinancials] = useState([])
  const [compFinLoading, setCompFinLoading] = useState(false)
  const [viewingKey, setViewingKey] = useState('draft')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportIds, setExportIds] = useState(['draft'])
  const [exporting, setExporting] = useState(false)
  const [industryStatus, setIndustryStatus] = useState({ available: true, message: '' })
  const [industryNames, setIndustryNames] = useState([])
  const [draftYi, setDraftYi] = useState(null)
  const pollRef = useRef(null)
  const saveTimer = useRef(null)
  const viewingKeyRef = useRef('draft')
  viewingKeyRef.current = viewingKey
  const isDraftView = viewingKey === 'draft'
  const archivedVersions = cse?.versions || []

  const method = payload?.methodConfig || {}
  const assumptions = payload?.assumptions || {}

  const refreshIndustryMeta = useCallback(() => {
    fetchIndustryMultiplesStatus().then((r) => {
      if (r.data?.success) setIndustryStatus(r.data.data || { available: true })
    }).catch(() => setIndustryStatus({ available: true, message: '计算时按申万三级现算，抓不到则回退个股 POOL' }))
    fetchSwIndustryNames().then((r) => {
      if (r.data?.success) setIndustryNames(r.data.data || [])
    }).catch(() => {})
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setViewingKey('draft')
    try {
      const [cRes, dRes, cmpRes] = await Promise.all([
        fetchValuationCase(caseId),
        fetchValuationDraft(caseId),
        fetchCaseComparables(caseId),
      ])
      if (!cRes.data?.success) {
        Message.error(cRes.data?.message || '案件不存在')
        return
      }
      setCse(cRes.data.data)
      const raw = dRes.data?.data?.payload || {}
      const next = coercePayloadToWan(raw)
      const created = formatChinaYmd(cRes.data.data?.created_at)
      const stored = String(next.assumptions?.valuation_date || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stored) && created) {
        next.assumptions = { ...(next.assumptions || {}), valuation_date: created }
        putValuationDraft(caseId, { ...next, amount_unit: 'wan' }).catch(() => {})
      }
      setPayload(next)
      setDraftYi(next.comparison?.display_yi || null)
      if (next !== raw && next.amount_unit === 'wan' && raw.amount_unit !== 'wan') {
        putValuationDraft(caseId, next).catch(() => {})
      }
      setComps(cmpRes.data?.data?.list || [])
      fetchComparableFinancials(caseId).then((r) => setCompFinancials(r.data?.data?.list || [])).catch(() => {})
      refreshIndustryMeta()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [caseId, refreshIndustryMeta])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (method.multiple_source !== 'sw_industry_median') return undefined
    refreshIndustryMeta()
    return undefined
  }, [method.multiple_source, refreshIndustryMeta])

  const persist = useCallback((next) => {
    const withUnit = { ...(next || {}), amount_unit: 'wan' }
    setPayload(withUnit)
    if (viewingKeyRef.current !== 'draft') return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      putValuationDraft(caseId, withUnit).catch(() => {})
    }, 600)
  }, [caseId])

  const patchPayload = (partial) => persist({ ...(payload || {}), ...partial })

  const loadCompFinancials = useCallback(async () => {
    setCompFinLoading(true)
    try {
      const res = await fetchComparableFinancials(caseId)
      setCompFinancials(res.data?.data?.list || [])
    } catch {
      setCompFinancials([])
    } finally {
      setCompFinLoading(false)
    }
  }, [caseId])

  const loadPreview = async () => {
    try {
      const res = await fetchComparablePreview(caseId)
      if (!res.data?.success) return
      const d = res.data.data
      setPreviewMsg(d.message || '')
      setRefreshBlocked(!!d.refresh_blocked || !!d.source_missing)
      if (d.list?.length) {
        const selected = d.list.filter((x) => x.selectable)
        await putCaseComparables(caseId, selected.map((x) => ({ ...x, selected: 1 })))
        const saved = await fetchCaseComparables(caseId)
        setComps(saved.data?.data?.list || [])
        Message.success(`已写入 ${selected.length} 家境内可比（港股/美股已排除）`)
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载可比失败')
    }
  }

  const startPoll = (jobId) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchValuationJob(jobId)
        const j = res.data?.data
        setJob(j)
        if (j?.status === 'success' || j?.status === 'failed') {
          clearInterval(pollRef.current)
          if (j.status === 'success') {
            const dRes = await fetchValuationDraft(caseId)
            const next = coercePayloadToWan(dRes.data?.data?.payload || {})
            setPayload(next)
            setDraftYi(next.comparison?.display_yi || null)
            loadCompFinancials()
            refreshIndustryMeta()
            Message.success(j.message || '计算完成（已写入草稿）')
            setStep('result')
          } else {
            Message.error(j.message || '任务失败')
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }, 1500)
  }

  useEffect(() => () => {
    clearInterval(pollRef.current)
    clearTimeout(saveTimer.current)
  }, [])

  const runJob = async () => {
    if (!isDraftView) {
      Message.warning('请先切换到当前草稿，或「发起新版本」后再采集/计算')
      return
    }
    if (!method.confirmed) {
      Message.warning('请先在「方法配置」确认后再开跑')
      setStep('method')
      return
    }
    try {
      await putValuationDraft(caseId, payload)
      const res = await postValuationJob(caseId, { job_type: 'fetch_and_calc' })
      if (res.status === 202 || res.data?.success) {
        const jobId = res.data.data.job_id
        setJob({ id: jobId, status: 'queued', progress: 0, message: res.data.message })
        startPoll(jobId)
      } else {
        Message.error(res.data?.message || '提交失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '提交失败')
    }
  }

  const saveVersion = async () => {
    if (!isDraftView) {
      Message.warning('请切换到当前草稿后再保存版本')
      return
    }
    Modal.confirm({
      title: '保存正式版本',
      content: '将当前草稿冻结为新版本（vN）。已保存版本不受后续抓取影响。',
      onOk: async () => {
        try {
          await putValuationDraft(caseId, payload)
          const res = await postValuationVersion(caseId)
          if (res.data?.success) {
            Message.success(`已保存 v${res.data.data.version_no}`)
            loadAll()
          } else {
            Message.error(res.data?.message || '保存失败')
          }
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '保存失败')
        }
      },
    })
  }

  const switchVersion = async (key) => {
    clearTimeout(saveTimer.current)
    setViewingKey(key)
    setLoading(true)
    try {
      if (key === 'draft') {
        const dRes = await fetchValuationDraft(caseId)
        const next = coercePayloadToWan(dRes.data?.data?.payload || {})
        setPayload(next)
        setDraftYi(next.comparison?.display_yi || draftYi)
      } else {
        const res = await fetchValuationVersion(key)
        if (!res.data?.success) {
          Message.error(res.data?.message || '加载版本失败')
          setViewingKey('draft')
          return
        }
        setPayload(coercePayloadToWan(res.data.data.payload || {}))
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载版本失败')
      setViewingKey('draft')
    } finally {
      setLoading(false)
    }
  }

  const startNewVersion = () => {
    if (!archivedVersions.length) {
      Message.warning('请先「保存版本」存档后再发起新版本')
      return
    }
    const fromId = viewingKey === 'draft' ? archivedVersions[0].id : viewingKey
    const fromNo = archivedVersions.find((v) => v.id === fromId)?.version_no
    Modal.confirm({
      title: '发起新版本',
      content: `将以已存档的 v${fromNo} 覆盖当前草稿。之后可继续编辑，再点「保存版本」生成新版本。已存档版本不会被改动。`,
      onOk: async () => {
        try {
          const res = await postValuationDraftFromVersion(caseId, fromId)
          if (!res.data?.success) {
            Message.error(res.data?.message || '发起失败')
            return
          }
          Message.success(`已从 v${fromNo} 生成新草稿，可继续编辑`)
          setViewingKey('draft')
          setPayload(coercePayloadToWan(res.data.data.payload || {}))
          const cRes = await fetchValuationCase(caseId)
          if (cRes.data?.success) setCse(cRes.data.data)
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '发起失败')
        }
      },
    })
  }

  const triggerDownload = (blob, filename) => {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const openExportModal = () => {
    setExportIds([viewingKey === 'draft' ? 'draft' : viewingKey])
    setExportOpen(true)
  }

  const confirmExport = async () => {
    if (!exportIds.length) {
      Message.warning('请至少选择一个版本')
      return
    }
    setExporting(true)
    try {
      const baseName = cse?.subject?.display_name || '估值'
      for (let i = 0; i < exportIds.length; i += 1) {
        const id = exportIds[i]
        const isDraft = id === 'draft'
        const res = await downloadValuationExport(caseId, isDraft ? undefined : id)
        const ver = archivedVersions.find((v) => v.id === id)
        const filename = isDraft
          ? `${baseName}-草稿.xlsx`
          : `${baseName}-v${ver?.version_no || ''}.xlsx`
        triggerDownload(res.data, filename)
        if (i < exportIds.length - 1) {
          await new Promise((r) => setTimeout(r, 400))
        }
      }
      setExportOpen(false)
      Message.success(exportIds.length > 1 ? `已导出 ${exportIds.length} 个文件` : '已导出')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const comparison = payload?.comparison?.display_yi
  const liveDraftYi = isDraftView ? (comparison || draftYi) : draftYi
  const notices = splitValuationNotices(payload?.warnings || [])
  const industrySelectOptions = (() => {
    const opts = industryNames.map((x) => ({
      value: x.name,
      label: x.l1 ? `${x.name}（${x.l1} / ${x.l2}）` : x.name,
    }))
    const cur = String(payload?.sw_industry_l3 || '').trim()
    if (cur && !opts.some((o) => o.value === cur)) {
      opts.unshift({ value: cur, label: `${cur}（不在现行三级，请重选）` })
    }
    return opts
  })()

  const pl = payload?.targetPl || emptyPl()
  const nwcWan = computedNwcWan(payload?.targetBs)

  if (loading || !payload) {
    return <div className="valuation-page">加载中…</div>
  }

  return (
    <div className="valuation-workbench">
      <aside className="valuation-workbench-nav">
        <button type="button" className="valuation-nav-back" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        {NAV_GROUPS.map((group) => (
          <React.Fragment key={group.key}>
            {group.divider ? <div className="valuation-nav-divider">{group.divider}</div> : null}
            <div className={`valuation-nav-group valuation-nav-group-${group.tone}`}>
              <div className="valuation-nav-group-label">{group.label}</div>
              {group.items.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`valuation-step-item${step === s.key ? ' active' : ''}`}
                  onClick={() => {
                    setStep(s.key)
                    if (s.key === 'comp_pl' || s.key === 'comp_bs' || s.key === 'comp_cf') {
                      loadCompFinancials()
                    }
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}
      </aside>
      <main className="valuation-workbench-main">
        <div className="valuation-toolbar">
          <Typography.Title heading={5} style={{ margin: 0, flex: 1 }}>
            {cse?.subject?.display_name || '估值工作台'}
            {cse?.case_type === 'pre_investment' ? ' · 投前' : ' · 投后'}
            {!isDraftView ? <Tag color="orangered" style={{ marginLeft: 8 }}>只读存档</Tag> : null}
          </Typography.Title>
          <Select
            value={viewingKey}
            onChange={switchVersion}
            style={{ width: 240 }}
            size="small"
          >
            <Select.Option value="draft">当前草稿</Select.Option>
            {archivedVersions.map((v) => (
              <Select.Option key={v.id} value={v.id}>
                {`v${v.version_no} · ${formatChinaDateTime(v.created_at)}`}
              </Select.Option>
            ))}
          </Select>
          <Button type="primary" onClick={runJob} disabled={!isDraftView || (!!job && (job.status === 'queued' || job.status === 'running'))}>
            开始采集/计算
          </Button>
          <Button onClick={() => setDetailOpen(true)} disabled={!payload.sheets}>明细</Button>
          <Button onClick={saveVersion} disabled={!isDraftView}>保存版本</Button>
          <Button onClick={startNewVersion} disabled={!archivedVersions.length}>发起新版本</Button>
          <Button onClick={openExportModal}>导出 xlsx</Button>
        </div>
        {job && (job.status === 'queued' || job.status === 'running') ? (
          <Progress percent={job.progress || 0} formatText={() => job.message || ''} style={{ marginBottom: 12 }} />
        ) : null}
        {notices.info.length ? <Alert type="info" content={notices.info.join('；')} style={{ marginBottom: 12 }} /> : null}
        {notices.warn.length ? <Alert type="warning" content={notices.warn.join('；')} style={{ marginBottom: 12 }} /> : null}

        {step === 'method' && (
          <Card title="计算前方法配置（未确认不得开跑）" bordered={false}>
            <div className="valuation-method-config-row">
              <div className="valuation-method-field">
                <span>终值</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.terminal_type}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, terminal_type: v, confirmed: false } })}
                  options={[
                    { value: 'exit_pe', label: '退出 P/E × 末期净利润' },
                    { value: 'exit_ps', label: '退出 P/S × 末期收入' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>现金流</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.fcf_method}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, fcf_method: v, confirmed: false } })}
                  options={[
                    { value: 'ni_bridge', label: '净利润桥' },
                    { value: 'nopat_fcff', label: 'NOPAT / FCFF' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>敏感性</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.sensitivity_axes}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, sensitivity_axes: v, confirmed: false } })}
                  options={[
                    { value: 'exit_x_cagr', label: '退出倍数 × 收入 CAGR' },
                    { value: 'exit_x_wacc', label: '退出倍数 × 折现率' },
                    { value: 'wacc_x_exit', label: '折现率 × 退出倍数' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>情景</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.scenario_mode}
                  onChange={(v) => {
                    const next = { ...method, scenario_mode: v, confirmed: false }
                    if (v !== 'ma_and_ipo') {
                      patchPayload({ methodConfig: next })
                      return
                    }
                    const seed = (key, name) => ({
                      name,
                      discount_rate: payload.scenarios?.[key]?.discount_rate ?? assumptions.discount_rate ?? 0.3,
                      exit_pe: payload.scenarios?.[key]?.exit_pe ?? assumptions.exit_pe ?? 40,
                      exit_ps: payload.scenarios?.[key]?.exit_ps ?? assumptions.exit_ps ?? 20,
                    })
                    patchPayload({
                      methodConfig: next,
                      scenarios: { ma: seed('ma', '并购预期'), ipo: seed('ipo', '上市预期') },
                    })
                  }}
                  options={[
                    { value: 'single', label: '单套' },
                    { value: 'ma_and_ipo', label: '并购 + 上市并排' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>倍数来源</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  getPopupContainer={() => document.body}
                  triggerProps={{ autoAlignPopupWidth: true }}
                  value={method.multiple_source}
                  onChange={(v) => patchPayload({ methodConfig: { ...method, multiple_source: v, confirmed: false } })}
                  options={[
                    { value: 'stock_pool', label: '个股 POOL' },
                    { value: 'sw_industry_median', label: '申万三级中位数' },
                  ]}
                />
              </div>
              <div className="valuation-method-field">
                <span>市场法锚定日</span>
                <DatePicker
                  size="small"
                  style={{ width: '100%' }}
                  allowClear
                  format="YYYY-MM-DD"
                  placeholder="默认案件创建日"
                  getPopupContainer={() => document.body}
                  value={assumptions.valuation_date || undefined}
                  onChange={(dateString, date) => {
                    const ymd = formatChinaYmd(date)
                      || formatChinaYmd(dateString)
                      || formatChinaYmd(cse?.created_at)
                      || null
                    patchPayload({
                      assumptions: { ...assumptions, valuation_date: ymd },
                      methodConfig: { ...method, confirmed: false },
                    })
                  }}
                />
              </div>
              {method.multiple_source === 'sw_industry_median' ? (
                <>
                  <div className="valuation-method-field">
                    <span>行业统计</span>
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      getPopupContainer={() => document.body}
                      triggerProps={{ autoAlignPopupWidth: true }}
                      value={method.industry_stat_method}
                      onChange={(v) => patchPayload({ methodConfig: { ...method, industry_stat_method: v, confirmed: false } })}
                      options={[
                        { value: 'arithmetic', label: '算术平均' },
                        { value: 'overall', label: '整体法' },
                      ]}
                    />
                  </div>
                  <div className="valuation-method-field valuation-method-field-wide">
                    <span>申万三级</span>
                    <Select
                      size="small"
                      showSearch
                      allowClear
                      style={{ width: '100%' }}
                      getPopupContainer={() => document.body}
                      triggerProps={{ autoAlignPopupWidth: true }}
                      placeholder="搜索并选择申万三级行业"
                      value={payload.sw_industry_l3 || undefined}
                      onChange={(v) => patchPayload({ sw_industry_l3: v || '', methodConfig: { ...method, confirmed: false } })}
                      filterOption={(input, option) => {
                        const q = String(input || '').trim().toLowerCase()
                        if (!q) return true
                        const text = [
                          option?.value,
                          option?.label,
                          option?.props?.value,
                          option?.props?.children,
                        ].filter(Boolean).join(' ')
                        return String(text).toLowerCase().includes(q)
                      }}
                      options={industrySelectOptions}
                    />
                  </div>
                </>
              ) : null}
              <div className="valuation-method-confirm">
                <Button
                  type="primary"
                  size="small"
                  onClick={() => {
                    const filled = formatChinaYmd(assumptions.valuation_date) || formatChinaYmd(cse?.created_at)
                    if (method.multiple_source === 'sw_industry_median' && !String(payload.sw_industry_l3 || '').trim()) {
                      Message.warning('请先选择申万三级行业')
                      return
                    }
                    const next = { ...method, confirmed: true }
                    patchPayload({
                      methodConfig: next,
                      assumptions: { ...assumptions, valuation_date: filled },
                    })
                    patchValuationCase(caseId, { method_config: next }).catch(() => {})
                    Message.success('已确认方法配置，可以开跑')
                  }}
                >
                  确认
                </Button>
                <Typography.Text type={method.confirmed ? 'success' : 'warning'}>
                  {method.confirmed ? '已确认' : '尚未确认'}
                </Typography.Text>
              </div>
            </div>
            <Typography.Paragraph type="secondary" className="valuation-dcf-terminal-hint">
              {method.terminal_type === 'exit_ps'
                ? 'DCF 终值只用退出 P/S × 末期营业收入；计算输出里不会出现退出 P/E。要用默认口径请改回「退出 P/E × 末期净利润」。'
                : 'DCF 终值只用退出 P/E × 末期净利润；计算输出里不会出现退出 P/S。'}
            </Typography.Paragraph>
            {!isDefaultMethodConfig(method) ? (
              <Alert
                type="warning"
                style={{ marginTop: 12, marginBottom: 12 }}
                content="当前不是系统默认口径（退出 P/E × 末期净利润、净利润桥、退出倍数 × 收入 CAGR、个股 POOL）。要用默认口径请改回这三项后再确认并计算。"
              />
            ) : null}
            {method.multiple_source === 'sw_industry_median' ? (
              <Alert type="info" content={industryStatus.message || '计算时按申万三级从东财成分 + 库内历史中位汇总；找不到则回退个股 POOL'} style={{ marginBottom: 12 }} />
            ) : null}
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              改锚定日、折现率、流动性折扣或上方选项后，会记入左侧「变更记录」（三表数字不记）。
            </Typography.Paragraph>
            <ValuationMethodGuide />
          </Card>
        )}

        {step === 'comps' && (
          <Card title="可比上市公司" bordered={false}>
            {previewMsg ? <Alert type="info" content={previewMsg} style={{ marginBottom: 12 }} /> : null}
            {refreshBlocked ? (
              <Alert type="warning" content="竞品分析来源已删除，无法刷新可比，仅可使用已勾选快照或手工导入" style={{ marginBottom: 12 }} />
            ) : null}
            <Space style={{ marginBottom: 12 }} wrap>
              <Button disabled={refreshBlocked} onClick={loadPreview}>从最新成功竞品分析加载</Button>
              <Input
                value={manualCode}
                placeholder="手工股票代码"
                style={{ width: 140 }}
                onChange={setManualCode}
              />
              <Button
                onClick={async () => {
                  try {
                    const res = await postManualComparable(caseId, { stock_code: manualCode })
                    if (res.data?.success) {
                      setManualCode('')
                      const saved = await fetchCaseComparables(caseId)
                      setComps(saved.data?.data?.list || [])
                    } else Message.error(res.data?.message || '添加失败')
                  } catch (e) {
                    Message.error(e.response?.data?.message || e.message || '添加失败')
                  }
                }}
              >
                添加
              </Button>
              <Upload
                accept=".xlsx,.xls"
                showUploadList={false}
                customRequest={async ({ file }) => {
                  try {
                    const res = await importComparablesExcel(caseId, file)
                    const skipped = res.data?.data?.skipped || []
                    Message.success(`导入 ${res.data?.data?.added?.length || 0} 条${skipped.length ? `，跳过 ${skipped.length}` : ''}`)
                    const saved = await fetchCaseComparables(caseId)
                    setComps(saved.data?.data?.list || [])
                  } catch (e) {
                    Message.error(e.response?.data?.message || e.message || '导入失败')
                  }
                }}
              >
                <Button>Excel 导入代码</Button>
              </Upload>
            </Space>
            <ListTable
              rowKey="id"
              pagination={false}
              columns={[
                {
                  title: '勾选',
                  width: 52,
                  render: (_, r) => (
                    <Checkbox
                      checked={!!r.selected}
                      disabled={!!r.disabled_reason}
                      onChange={(v) => {
                        patchCaseComparable(caseId, r.id, { selected: v }).then(() => {
                          setComps((prev) => prev.map((x) => (x.id === r.id ? { ...x, selected: v ? 1 : 0 } : x)))
                        })
                      }}
                    />
                  ),
                },
                { title: '代码', dataIndex: 'stock_code', width: 72 },
                { title: '名称', dataIndex: 'stock_name', width: 80, ellipsis: true },
                { title: '市场', dataIndex: 'listing_market', width: 72, render: (v) => MARKET_LABEL[v] || v || '-' },
                {
                  title: '综合分',
                  dataIndex: 'relevance_score',
                  width: 72,
                  align: 'right',
                  render: (v) => (v == null || v === '' ? '-' : fmtNum(v, 2)),
                },
                {
                  title: '可比程度',
                  dataIndex: 'comparability',
                  width: 88,
                  render: (v, r) => (
                    <Select
                      size="mini"
                      value={v}
                      style={{ width: 72 }}
                      options={[
                        { value: 'strong', label: '强' },
                        { value: 'medium', label: '中' },
                        { value: 'weak', label: '弱' },
                      ]}
                      onChange={(nv) => {
                        const inPool = nv === 'strong' || nv === 'medium'
                        patchCaseComparable(caseId, r.id, { comparability: nv, in_pool: inPool }).then(() => {
                          setComps((prev) => prev.map((x) => (x.id === r.id ? { ...x, comparability: nv, in_pool: inPool ? 1 : 0 } : x)))
                        })
                      }}
                    />
                  ),
                },
                {
                  title: 'POOL',
                  dataIndex: 'in_pool',
                  width: 56,
                  render: (v, r) => (
                    <Switch
                      size="small"
                      checked={!!v}
                      onChange={(nv) => {
                        patchCaseComparable(caseId, r.id, { in_pool: nv }).then(() => {
                          setComps((prev) => prev.map((x) => (x.id === r.id ? { ...x, in_pool: nv ? 1 : 0 } : x)))
                        })
                      }}
                    />
                  ),
                },
                { title: '说明', dataIndex: 'disabled_reason', width: 240, ellipsis: true, render: (v) => v || '-' },
              ]}
              data={comps}
            />
          </Card>
        )}

        {step === 'pl' && (
          <Card title="标的利润表（录入单位：万元）" bordered={false}>
            <TargetFinancialImportBar caseId={caseId} onImported={setPayload} />
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              content="录入哪些年：① 已实现最近一年（如 2025）——市场法 P/S 用该年营业收入，P/E 用该年净利润；② 预测前两年（如 2026E、2027E）——DCF 起点。后面年份按收入增速外推到「预测年数」（默认 5 年）。中间空列（全空或全 0）会跳过，不会当成 0 再往后外推。可用「导入 Excel」一次写入利润表/资产负债/现金流，或先下载模板。"
            />
            <ListTable
              rowKey="name"
              pagination={false}
              size="small"
              style={{ marginBottom: 12 }}
              columns={[
                { title: '项目', dataIndex: 'name', width: 120 },
                {
                  title: '数值',
                  dataIndex: 'value',
                  width: 160,
                  render: (_, r) => r.editor,
                },
                { title: '说明', dataIndex: 'note' },
              ]}
              data={[
                {
                  name: '所得税率',
                  editor: (
                    <InputNumber
                      min={0}
                      max={1}
                      step={0.01}
                      style={{ width: 140 }}
                      value={assumptions.tax_rate}
                      onChange={(v) => patchPayload({ assumptions: { ...assumptions, tax_rate: v } })}
                    />
                  ),
                  note: '小数，如 0.15 表示 15%',
                },
                {
                  name: '预测年数',
                  editor: (
                    <InputNumber
                      min={1}
                      max={10}
                      style={{ width: 140 }}
                      value={assumptions.forecast_years}
                      onChange={(v) => patchPayload({ assumptions: { ...assumptions, forecast_years: v } })}
                    />
                  ),
                  note: '默认 5 年；本表可只填前 2 年，其后按收入增速外推。空年跳过，不按 0 占位',
                },
              ]}
            />
            <ListTable
              rowKey="name"
              pagination={false}
              size="small"
              scroll={{ x: true }}
              columns={[
                { title: '科目', dataIndex: 'name', width: 120, fixed: 'left' },
                { title: '说明', dataIndex: 'note', width: 220 },
                ...(pl.years?.length ? pl.years : ['2026', '2027']).map((y, i) => ({
                  title: (
                    <div className="valuation-pl-year-head">
                      <Input
                        size="small"
                        value={y}
                        onChange={(nv) => {
                          const years = [...(pl.years || [])]
                          years[i] = nv
                          patchPayload({ targetPl: { ...pl, years } })
                        }}
                      />
                      {(pl.years || []).length > 1 ? (
                        <Button
                          className="valuation-pl-year-remove"
                          type="text"
                          status="danger"
                          size="mini"
                          icon={<IconClose />}
                          aria-label={`删除${y}年`}
                          onClick={() => patchPayload({ targetPl: splicePlYear(pl, i) })}
                        />
                      ) : null}
                    </div>
                  ),
                  dataIndex: `y${i}`,
                  width: 132,
                  render: (_, r) => (
                    r.computed ? (
                      <span>{r.values[i] == null || r.values[i] === '' ? '—' : fmtAmountWan(r.values[i])}</span>
                    ) : (
                      <WanInput
                        style={{ width: 168 }}
                        value={r.values[i]}
                        onChange={(nv) => r.onChange(i, nv)}
                      />
                    )
                  ),
                })),
              ]}
              data={[
                {
                  name: '营业收入',
                  note: '利润表「营业收入」合计，万元',
                  values: pl.revenue || [],
                  onChange: (i, nv) => {
                    const revenue = [...(pl.revenue || [])]
                    revenue[i] = nv
                    patchPayload({ targetPl: { ...pl, revenue } })
                  },
                },
                {
                  name: '营业利润',
                  note: '利润表「营业利润」；市场法 P/E 用锚定年净利润',
                  values: pl.operating_profit || [],
                  onChange: (i, nv) => {
                    const operating_profit = [...(pl.operating_profit || [])]
                    operating_profit[i] = nv
                    patchPayload({ targetPl: { ...pl, operating_profit } })
                  },
                },
                {
                  name: '净利润',
                  note: '利润表「净利润」。市场法 P/E 优先用锚定日所在年；预测年是 DCF 净利润桥起点',
                  values: pl.net_income || [],
                  onChange: (i, nv) => {
                    const net_income = [...(pl.net_income || [])]
                    net_income[i] = nv
                    patchPayload({ targetPl: { ...pl, net_income } })
                  },
                },
              ]}
            />
            <Space style={{ marginTop: 8 }}>
              <Button
                onClick={() => {
                  const years = [...(pl.years || []), String(Number(pl.years?.[pl.years.length - 1] || 2026) + 1)]
                  patchPayload({ targetPl: { ...pl, years } })
                }}
              >
                增加一年
              </Button>
              <Button
                status="danger"
                disabled={(pl.years || []).length <= 1}
                onClick={() => patchPayload({ targetPl: splicePlYear(pl, (pl.years || []).length - 1) })}
              >
                删除最后一年
              </Button>
            </Space>
          </Card>
        )}

        {step === 'bs' && (
          <Card title="标的资产负债表（录入单位：万元）" bordered={false}>
            <TargetFinancialImportBar caseId={caseId} onImported={setPayload} />
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              content="录入哪个时点：估值时点最近一期已实现资产负债表（不是按年预测表）。核心科目包括货币资金、应收/预付、存货、固资/在建/无形、短贷/长贷、应付/预收。净负债 = 短贷 + 长贷 − 货币资金。单位万元。"
            />
            <ListTable
              rowKey={(r) => r.key || r.name}
              pagination={false}
              size="small"
              showSeq={false}
              columns={[
                {
                  title: '科目',
                  dataIndex: 'name',
                  width: 228,
                  className: 'valuation-nowrap-cell',
                  render: (v, r) => (r.section
                    ? <Typography.Text bold>{v}</Typography.Text>
                    : v),
                },
                {
                  title: '金额（万元）',
                  dataIndex: 'value',
                  width: 180,
                  render: (_, r) => {
                    if (r.section) return null
                    if (r.ratio) {
                      return <Typography.Text bold>{r.value == null ? '—' : fmtPct(r.value, 1)}</Typography.Text>
                    }
                    if (r.multiple) {
                      return <Typography.Text bold>{r.value == null ? '—' : `${fmtNum(r.value, 2)}x`}</Typography.Text>
                    }
                    if (r.auto) {
                      return <Typography.Text bold>{r.value == null ? '—' : fmtAmountWan(r.value)}</Typography.Text>
                    }
                    return (
                      <WanInput
                        style={{ width: 176 }}
                        value={payload.targetBs?.[r.key]}
                        onChange={(v) => patchPayload({
                          targetBs: { ...(payload.targetBs || {}), [r.key]: v },
                          overrides: { ...(payload.overrides || {}), net_debt: null },
                        })}
                      />
                    )
                  },
                },
                { title: '说明', dataIndex: 'note' },
              ]}
              data={[
                ...BS_GROUPS.flatMap((g) => [
                  { section: true, name: g.label },
                  ...BS_INPUT_FIELDS.filter((f) => f.group === g.key).map((f) => ({
                    key: f.key,
                    name: f.label,
                    note: f.note,
                  })),
                ]),
                { section: true, name: '自动计算' },
                { auto: true, name: '流动资产合计', value: currentAssetsFromBs(payload.targetBs), note: '预计一年内变现或耗用的资产合计' },
                { auto: true, name: '资产总计', value: totalAssetsFromBs(payload.targetBs), note: '企业拥有或控制的全部资产' },
                { auto: true, name: '流动负债合计', value: currentLiabFromBs(payload.targetBs), note: '预计一年内偿还的负债合计' },
                { auto: true, name: '负债合计', value: totalLiabFromBs(payload.targetBs), note: '企业承担的全部负债' },
                {
                  auto: true,
                  name: '所有者权益（反算）',
                  value: equityImpliedFromBs(payload.targetBs),
                  note: payload.targetBs?.equity != null && payload.targetBs?.equity !== ''
                    ? `净资产（资产 − 负债）。已填所有者权益 ${fmtAmountWan(payload.targetBs.equity)}`
                    : '净资产，等于资产减去负债',
                },
                {
                  auto: true,
                  name: '净负债',
                  value: computedNetDebtWan(payload.targetBs),
                  note: hasBsDebtInputs(payload.targetBs)
                    ? `有息负债减去货币资金。短期借款 ${fmtAmountWan(numOrZero(payload.targetBs?.short_term_loan))} + 长期借款 ${fmtAmountWan(numOrZero(payload.targetBs?.long_term_loan))} − 货币资金 ${fmtAmountWan(numOrZero(payload.targetBs?.cash))}`
                    : '有息负债减去货币资金；填入货币资金或借款后自动计算',
                },
                {
                  auto: true,
                  name: '期末营运资本占用',
                  value: computedNwcWan(payload.targetBs),
                  note: '经营性流动资产减去经营性流动负债的时点余额，不是现金流量表「营运资本增加」',
                },
                {
                  auto: true,
                  ratio: true,
                  name: '资产负债率',
                  value: debtRatioFromBs(payload.targetBs),
                  note: '负债占资产的比重',
                },
                {
                  auto: true,
                  multiple: true,
                  name: '流动比率',
                  value: currentRatioFromBs(payload.targetBs),
                  note: '流动资产对流动负债的覆盖倍数',
                },
              ]}
            />
            <ValuationTieOutPanel payload={payload} />
          </Card>
        )}

        {step === 'cf' && (
          <Card title="标的现金流量表 / DCF 联动项（录入单位：万元）" bordered={false}>
            <TargetFinancialImportBar caseId={caseId} onImported={setPayload} />
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              content="录入哪些年：与标的利润表预测期对齐（已实现年不参与 DCF；默认从 2026E 起共 5 年）。按年名对齐，缺年不拿错列。后面未填年份沿用最后已填年的折旧/资本支出/营运资本增加，不再按 0。"
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              自由现金流 = 净利润 + 折旧摊销 − 资本性支出 − 营运资本增加。
              {nwcWan != null
                ? ` 资产负债表期末营运资本占用 ${fmtAmountWan(nwcWan)} 万元（应收票据+应收账款+预付款项+存货 − 应付票据+应付账款+预收款项），下面填的是每年增加额。`
                : ' 请先在「标的资产负债表」填写应收/预付、存货或应付/预收，占用额会按该页自动带出。下面填的是每年增加额。'}
            </Typography.Paragraph>
            <ListTable
              rowKey="key"
              pagination={false}
              size="small"
              columns={[
                { title: '科目', dataIndex: 'field', width: 220, className: 'valuation-nowrap-cell' },
                { title: '对应现金流量表科目', dataIndex: 'cf' },
                { title: 'DCF', dataIndex: 'dcf', width: 70 },
                {
                  title: '金额（万元/年）',
                  dataIndex: 'key',
                  width: 200,
                  render: (_, r) => (
                    <WanInput
                      style={{ width: 176 }}
                      value={payload.overrides?.[r.key]}
                      onChange={(v) => patchPayload({ overrides: { ...(payload.overrides || {}), [r.key]: v } })}
                    />
                  ),
                },
              ]}
              data={[
                { key: 'da', field: '折旧摊销（缺年沿用）', cf: '固定资产折旧 + 无形资产摊销 + 长期待摊费用摊销（间接法加回）', dcf: '加回' },
                { key: 'capex', field: '资本性支出（缺年沿用）', cf: '购建固定资产、无形资产和其他长期资产支付的现金', dcf: '扣除' },
                { key: 'dnwc', field: '营运资本增加 ΔNWC（缺年沿用）', cf: '存货增加 + 经营性应收增加 − 经营性应付增加。不是期末余额', dcf: '扣除' },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '12px 0 8px' }}>
              按年明细（万元）。有数的年份优先生效；中间空年沿用上一已填年；再空着的（含开头几年）才用上面的缺年沿用。
            </Typography.Paragraph>
            <ListTable
              rowKey="year"
              pagination={false}
              size="small"
              scroll={{ x: true }}
              columns={[
                { title: '年份', dataIndex: 'year', width: 88, className: 'valuation-nowrap-cell' },
                {
                  title: '折旧摊销',
                  dataIndex: 'da',
                  width: 160,
                  render: (_, r) => (
                    <WanInput
                      style={{ width: 144 }}
                      value={cfValueAtYear(payload.targetCf, r.year, 'da')}
                      onChange={(v) => patchPayload(patchCfYear(payload, r.year, 'da', v))}
                    />
                  ),
                },
                {
                  title: '资本性支出',
                  dataIndex: 'capex',
                  width: 160,
                  render: (_, r) => (
                    <WanInput
                      style={{ width: 144 }}
                      value={cfValueAtYear(payload.targetCf, r.year, 'capex')}
                      onChange={(v) => patchPayload(patchCfYear(payload, r.year, 'capex', v))}
                    />
                  ),
                },
                {
                  title: '营运资本增加',
                  dataIndex: 'dnwc',
                  width: 160,
                  render: (_, r) => (
                    <WanInput
                      style={{ width: 144 }}
                      value={cfValueAtYear(payload.targetCf, r.year, 'dnwc')}
                      onChange={(v) => patchPayload(patchCfYear(payload, r.year, 'dnwc', v))}
                    />
                  ),
                },
              ]}
              data={cfYearsFrom(pl, payload.targetCf).map((year) => ({ year }))}
            />
            <ValuationTieOutPanel payload={payload} />
          </Card>
        )}

        {step === 'changelog' && (
          <Card title="变更记录" bordered={false}>
            <ValuationChangeLog caseId={caseId} />
          </Card>
        )}

        {(step === 'comp_pl' || step === 'comp_bs' || step === 'comp_cf') && (
          <Card title={`${STEPS.find((s) => s.key === step)?.title}（万元）`} bordered={false}>
            <ComparableFinancialTable
              statementType={step === 'comp_pl' ? 'pl' : step === 'comp_bs' ? 'bs' : 'cf'}
              rows={compFinancials}
              loading={compFinLoading}
              filePrefix={`${cse?.subject?.display_name || '估值'}-${STEPS.find((s) => s.key === step)?.title}`}
            />
          </Card>
        )}

        {(step === 'relative' || step === 'ratios') && (
          <Card title={STEPS.find((s) => s.key === step)?.title} bordered={false}>
            <Typography.Paragraph>
              点击「开始采集/计算」后，本页展示过程表。也可打开「明细」查看全部 Tab 与公式说明。
            </Typography.Paragraph>
            {step === 'relative' ? (
              <>
                <Alert
                  type="info"
                  style={{ marginBottom: 12 }}
                  content="PE/PS 中位是东财历史中位。底稿中位有数的公司用该数进 POOL，空着仍用东财。贴完请点「只计算」刷新市场法。"
                />
                <RelativeValuationTable
                  rows={mergeRelativeOverrides(payload.sheets?.relative?.payload, comps)}
                  editable={isDraftView}
                  onOverrideChange={(stockCode, field, value) => {
                    const c = comps.find((x) => String(x.stock_code) === String(stockCode))
                    if (!c?.id) {
                      Message.warning('未找到对应可比公司，请先在「可比与采集」确认名单')
                      return
                    }
                    patchCaseComparable(caseId, c.id, { [field]: value }).then(() => {
                      setComps((prev) => prev.map((x) => (x.id === c.id ? { ...x, [field]: value } : x)))
                    }).catch((e) => Message.error(e.response?.data?.message || '保存底稿中位失败'))
                  }}
                />
              </>
            ) : null}
            {step === 'ratios' ? (
              <RatiosTables
                fees={payload.sheets?.fees}
                grossMargin={payload.sheets?.gross_margin}
                workingCapital={payload.sheets?.working_capital}
              />
            ) : null}
          </Card>
        )}

        {(step === 'result' || step === 'market' || step === 'dcf') && (
          <Card bordered={false} className="valuation-output-card">
            <Tabs type="line" size="small" defaultActiveTab="present" className="valuation-output-page-tabs">
              <TabPane key="present" title="结果呈现">
                <div className="valuation-output-page">
                  <section className="valuation-output-section">
                    <Typography.Title heading={6} className="valuation-ratio-col-title">结果对比（亿元）</Typography.Title>
                    <Typography.Paragraph type="secondary" className="valuation-ratio-formula" title="市场法用已实现最近一年的营收与净利润。低端为 POOL −1σ、高端为中位数。">
                      市场法用已实现最近一年营收/净利润。倍数取锚定日及以前各股历史中位，低端=POOL −1σ、高端=中位。
                      {method.scenario_mode === 'ma_and_ipo' ? ' 并购 + 上市并排时 P/S、P/E 仍这一套（只用市场法折扣）；仅 DCF 分两列（并购用并购折扣，上市不扣）。' : ''}
                    </Typography.Paragraph>
                    {!isDefaultMethodConfig(method) ? (
                      <Alert
                        type="warning"
                        style={{ marginBottom: 12 }}
                        content="本次 DCF 不是系统默认口径。默认是退出 P/E × 末期净利润、净利润桥、退出倍数 × 收入 CAGR；当前若是退出 P/S + NOPAT + 折现率轴，区间口径会不同。"
                      />
                    ) : null}
                    <div className="valuation-result-top">
                      <div className="valuation-result-grid">
                        {comparison ? (
                          <>
                            <div className="valuation-result-card">
                              <h4>市场法 P/S</h4>
                              <div className="num">{fmtYi(comparison.market_ps?.low)} ~ {fmtYi(comparison.market_ps?.high)}</div>
                              <div>增量 {fmtYi(comparison.market_ps?.increment)}</div>
                            </div>
                            <div className="valuation-result-card">
                              <h4>市场法 P/E</h4>
                              <div className="num">{fmtYi(comparison.market_pe?.low)} ~ {fmtYi(comparison.market_pe?.high)}</div>
                              <div>增量 {fmtYi(comparison.market_pe?.increment)}</div>
                            </div>
                            <div className="valuation-result-card">
                              <h4>DCF</h4>
                              {comparison.dcf?.ma ? (
                                <>
                                  <div>并购 {fmtYi(comparison.dcf.ma.low)} ~ {fmtYi(comparison.dcf.ma.high)}</div>
                                  <div>上市 {fmtYi(comparison.dcf.ipo.low)} ~ {fmtYi(comparison.dcf.ipo.high)}</div>
                                </>
                              ) : (
                                <>
                                  <div className="num">{fmtYi(comparison.dcf?.low)} ~ {fmtYi(comparison.dcf?.high)}</div>
                                  <div>增量 {fmtYi(comparison.dcf?.increment)}</div>
                                </>
                              )}
                            </div>
                          </>
                        ) : (
                          <Typography.Text type="secondary">请先确认方法配置并开跑计算</Typography.Text>
                        )}
                        <div className="valuation-result-card valuation-result-card-edit">
                          <div className="valuation-result-card-head">
                            <h4>本轮交易估值</h4>
                            <Tag className="valuation-edit-tag" size="small">可输入</Tag>
                          </div>
                          <InputNumber
                            className="valuation-result-card-input"
                            placeholder="输入对照值"
                            value={cse?.round_deal_value_yi}
                            onChange={(v) => {
                              setCse((prev) => ({ ...prev, round_deal_value_yi: v }))
                              patchValuationCase(caseId, { round_deal_value_yi: v })
                            }}
                          />
                          <div>亿元，只对照，不参与计算</div>
                        </div>
                      </div>
                      <ValuationFootballField
                        comparison={comparison}
                        dealYi={cse?.round_deal_value_yi}
                      />
                    </div>
                  </section>

                  <div className="valuation-output-split">
                    <section className="valuation-output-section">
                      <Typography.Title heading={6} className="valuation-ratio-col-title">市场法</Typography.Title>
                      {payload.sheets?.market?.formula ? (
                        <Typography.Paragraph type="secondary" className="valuation-ratio-formula valuation-formula-wrap">
                          {payload.sheets.market.formula}
                        </Typography.Paragraph>
                      ) : null}
                      <MarketMethodTable payload={payload.sheets?.market?.payload} />
                    </section>

                    <section className="valuation-output-section valuation-output-dcf">
                      <Typography.Title heading={6} className="valuation-ratio-col-title">DCF</Typography.Title>
                      <div className="valuation-dcf-param-block">
                        <div className="valuation-dcf-param-head">
                          <Typography.Title heading={6} className="valuation-ratio-col-title">可调整参数</Typography.Title>
                          <Tag className="valuation-edit-tag" size="small">可编辑</Tag>
                        </div>
                        <div className="valuation-dcf-param-grid">
                          {buildDcfParamFields({ method, assumptions, payload, patchPayload }).map((f) => (
                            <div key={f.label} className="valuation-dcf-param-item">
                              <span>{f.label}</span>
                              {f.control}
                            </div>
                          ))}
                        </div>
                        <Typography.Paragraph className="valuation-dcf-terminal-hint">
                          {method.terminal_type === 'exit_ps'
                            ? '当前终值 = 退出 P/S × 末期营业收入。退出 P/E 不参与 DCF。要用默认口径：方法配置改成「退出 P/E × 末期净利润」后确认并计算。'
                            : '当前终值 = 退出 P/E × 末期净利润。退出 P/S 不参与 DCF 终值。'}
                        </Typography.Paragraph>
                        <WaccBreakdownBlock assumptions={assumptions} payload={payload} patchPayload={patchPayload} />
                        {method.scenario_mode === 'ma_and_ipo' ? (
                          <Alert
                            type="info"
                            style={{ marginTop: 8 }}
                            content={dualParamsLookSame(method, assumptions, payload)
                              ? '折现率、退出倍数目前相同。两套 DCF 仍会不同：并购用「并购 DCF 流动性折扣」，上市不扣。改市场法折扣不会动 DCF。并购/上市折现率有数会覆盖 WACC 分项。'
                              : '并购 DCF 用「并购流动性折扣」，上市不扣。市场法 P/S、P/E 只用「市场法流动性折扣」。并购/上市折现率有数会覆盖 WACC 分项。'}
                          />
                        ) : null}
                      </div>
                      {payload.sheets?.dcf?.formula ? (
                        <Typography.Paragraph type="secondary" className="valuation-ratio-formula valuation-formula-wrap">
                          {payload.sheets.dcf.formula}
                        </Typography.Paragraph>
                      ) : null}
                      <DcfProcessTables payload={payload.sheets?.dcf?.payload} />
                    </section>
                  </div>
                </div>
              </TabPane>
              <TabPane key="version" title="版本对比">
                <VersionComparePanel draftYi={liveDraftYi} versions={archivedVersions} />
              </TabPane>
              <TabPane key="tieout" title="三表勾稽">
                <ValuationTieOutPanel payload={payload} />
              </TabPane>
            </Tabs>
          </Card>
        )}
      </main>
      <ValuationDetailModal
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        sheets={payload.sheets}
        unsaved={isDraftView}
        warnings={[...notices.info, ...notices.warn]}
      />
      <Modal
        title="导出 Excel"
        visible={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={confirmExport}
        confirmLoading={exporting}
        okText="导出"
        unmountOnExit
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          可多选。每个版本（含草稿）各导出一个 xlsx。过程表含 Excel 公式：相对估值 ±1σ、市场法非流通权益、DCF 折现因子/现值/终值、结果对比增量。
        </Typography.Paragraph>
        <Checkbox.Group
          value={exportIds}
          onChange={setExportIds}
          direction="vertical"
        >
          <Checkbox value="draft">当前草稿</Checkbox>
          {archivedVersions.map((v) => (
            <Checkbox key={v.id} value={v.id}>
              {`v${v.version_no} · ${formatChinaDateTime(v.created_at)}`}
            </Checkbox>
          ))}
        </Checkbox.Group>
      </Modal>
    </div>
  )
}
