import { useEffect, useMemo, useState } from 'react'
import { DotLoading, Popup, Toast } from 'antd-mobile'
import { CloseOutline } from 'antd-mobile-icons'
import axios from '../utils/axios'
import {
  formatAmountYuan,
  formatDateOnly,
  formatPercent,
  formatRatio
} from '../utils/performanceFormat'

const TITLE_MAP = {
  managerFunds: '在管产品清单',
  investors: '投资人名录',
  fundPerformance: '基金业绩及现金流',
  fundPortfolio: '基金投资组合明细',
  projectCashflow: '项目现金流及业绩',
  portfolioDetail: '整体投资组合明细',
  spvDetail: 'SPV投资组合明细',
  underlyingCompanies: '底层企业明细',
  ipoCompanies: '上市企业明细',
  listedEnterprises: '上市进展企业明细',
  regionCompanies: '区域企业明细'
}

function DrillCard({ title, rows }) {
  return (
    <div className="h5-perf-drill__card">
      {title ? <div className="h5-perf-drill__card-title">{title}</div> : null}
      <div className="h5-perf-drill__rows">
        {rows.map((r) => (
          <div key={r.label} className="h5-perf-drill__row">
            <span className="h5-perf-drill__k">{r.label}</span>
            <span className="h5-perf-drill__v">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildCards(type, modalType, data) {
  if (!data) return []

  if (type === 'managerFunds') {
    const ALLOWED = ['母基金', '直投基金', '内部备案SPV']
    return (data.list || [])
      .filter((r) => ALLOWED.includes(r.fund_type))
      .map((r, i) => ({
        key: `${r.fund}-${i}`,
        title: r.fund || `产品 ${i + 1}`,
        rows: [
          { label: '类型', value: r.fund_type || '-' },
          { label: '认缴规模', value: formatAmountYuan(r.sub_amount) },
          { label: '实缴规模', value: formatAmountYuan(r.paid_in_amount) },
          { label: '累计分配', value: formatAmountYuan(r.dis_amount) },
          { label: '备案编号', value: r.ba_num || '-' },
          { label: '备案时间', value: formatDateOnly(r.ba_date) }
        ]
      }))
  }

  if (type === 'investors') {
    return (data.list || []).map((r, i) => ({
      key: `${r.lp}-${i}`,
      title: r.lp || `投资人 ${i + 1}`,
      rows: [
        { label: '类型', value: r.lp_type || '-' },
        { label: '认缴金额', value: formatAmountYuan(r.subscription_amount) },
        { label: '实缴', value: formatAmountYuan(r.paidin) },
        { label: '分配', value: formatAmountYuan(r.distribution) }
      ]
    }))
  }

  if (type === 'fundPerformance') {
    const cards = []
    const ind = Array.isArray(data.indicator) ? data.indicator[0] : data.indicator
    if (ind) {
      cards.push({
        key: 'indicator',
        title: '业绩指标',
        rows: [
          { label: '认缴', value: formatAmountYuan(ind.lp_sub) },
          { label: '实缴', value: formatAmountYuan(ind.paidin) },
          { label: '分配', value: formatAmountYuan(ind.distribution) },
          { label: 'TVPI', value: formatRatio(ind.tvpi) },
          { label: 'DPI', value: formatRatio(ind.dpi) },
          { label: 'RVPI', value: formatRatio(ind.rvpi) },
          { label: 'NIRR', value: formatPercent(ind.nirr) }
        ]
      })
    }
    ;(data.cashflow || []).forEach((r, i) => {
      cards.push({
        key: `cf-${i}`,
        title: r.lp || `流水 ${i + 1}`,
        rows: [
          { label: '类型', value: r.transaction_type || '-' },
          { label: '日期', value: formatDateOnly(r.transaction_date) },
          { label: '金额', value: formatAmountYuan(r.transaction_amount) }
        ]
      })
    })
    return cards
  }

  if (type === 'fundPortfolio' || type === 'portfolioDetail') {
    let list = data.list || []
    if (type === 'portfolioDetail' && modalType === 'directOnly') {
      list = list.filter((r) => r.transaction_type === '直投项目')
    }
    return list.map((r, i) => ({
      key: `${r.project}-${i}`,
      title: r.project || `项目 ${i + 1}`,
      rows: [
        { label: '类别', value: r.transaction_type || '-' },
        { label: '首次日期', value: formatDateOnly(r.first_date) },
        { label: '累计实缴', value: formatAmountYuan(r.acc_paidin) },
        { label: '累计回款', value: formatAmountYuan(r.acc_receive) },
        { label: '总价值', value: formatAmountYuan(r.total_value) },
        { label: 'MOC', value: formatRatio(r.moc) },
        { label: 'DPI', value: formatRatio(r.dpi) }
      ]
    }))
  }

  if (type === 'projectCashflow') {
    const cards = []
    const ind = Array.isArray(data.indicator) ? data.indicator[0] : data.indicator
    if (ind) {
      cards.push({
        key: 'indicator',
        title: '项目业绩',
        rows: [
          { label: '认缴投资', value: formatAmountYuan(ind.sub_amount) },
          { label: '实缴投资', value: formatAmountYuan(ind.inv_amount) },
          { label: '退出金额', value: formatAmountYuan(ind.exit_amount) },
          { label: 'GIRR', value: formatPercent(ind.girr) },
          { label: 'MOC', value: formatRatio(ind.moc) }
        ]
      })
    }
    ;(data.cashflow || []).forEach((r, i) => {
      cards.push({
        key: `pc-${i}`,
        title: r.company || r.sub_fund || r.spv || `流水 ${i + 1}`,
        rows: [
          { label: '类型', value: r.transaction_type || '-' },
          { label: '日期', value: formatDateOnly(r.transaction_date) },
          { label: '金额', value: formatAmountYuan(r.transaction_amount) }
        ]
      })
    })
    return cards
  }

  if (type === 'spvDetail') {
    return (data.list || []).map((r, i) => ({
      key: `${r.fund}-${r.project}-${i}`,
      title: r.project || `SPV ${i + 1}`,
      rows: [
        { label: '基金', value: r.fund || '-' },
        { label: '类型', value: r.fund_type || '-' },
        { label: '类别', value: r.transaction_type || '-' },
        { label: '累计实缴', value: formatAmountYuan(r.acc_paidin) },
        { label: '累计回款', value: formatAmountYuan(r.acc_receive) },
        { label: 'LP实缴', value: formatAmountYuan(r.lp_paid) }
      ]
    }))
  }

  if (type === 'underlyingCompanies') {
    return (data.list || []).map((r, i) => ({
      key: `${r.fund}-${i}`,
      title: r.fund || `基金 ${i + 1}`,
      rows: [
        { label: '项目数', value: r.project_num ?? '-' },
        { label: '企业数', value: r.company_num ?? '-' },
        { label: '投资金额', value: formatAmountYuan(r.total_amount) },
        { label: '穿透成本', value: formatAmountYuan(r.project_amount) },
        { label: '上市数', value: r.ipo_num ?? '-' },
        { label: '上市成本', value: formatAmountYuan(r.ipo_amount) }
      ]
    }))
  }

  if (type === 'ipoCompanies') {
    return (data.list || []).map((r, i) => ({
      key: `${r.project}-${i}`,
      title: r.project || `企业 ${i + 1}`,
      rows: [
        { label: '基金', value: r.fund || '-' },
        { label: '上市日', value: formatDateOnly(r.ipo_date) },
        { label: '金额', value: formatAmountYuan(r.amount) }
      ]
    }))
  }

  if (type === 'regionCompanies') {
    return (data.list || []).map((r, i) => ({
      key: `${r.fund || i}`,
      title: r.fund || `基金 ${i + 1}`,
      rows: [
        { label: '长三角企业数', value: r.csj_num ?? '-' },
        { label: '长三角金额', value: formatAmountYuan(r.csj_amount) },
        { label: '上海企业数', value: r.sh_num ?? '-' },
        { label: '上海金额', value: formatAmountYuan(r.sh_amount) },
        { label: '浦东企业数', value: r.pd_num ?? '-' },
        { label: '浦东金额', value: formatAmountYuan(r.pd_amount) }
      ]
    }))
  }

  if (type === 'listedEnterprises') {
    return (data.list || []).map((r, i) => ({
      key: `${r.fund}-${r.project}-${i}`,
      title: r.project || `企业 ${i + 1}`,
      rows: [
        { label: '基金', value: r.fund || '-' },
        { label: '代码', value: r.ticker || '-' },
        { label: '进展', value: r.ipo_progress || '-' },
        { label: '上市日', value: formatDateOnly(r.ipo_date) },
        { label: '实缴', value: formatAmountYuan(r.paid_amount) },
        { label: '总价值', value: formatAmountYuan(r.total_value) },
        { label: 'MOC', value: formatRatio(r.moc) },
        { label: 'DPI', value: formatRatio(r.dpi) }
      ]
    }))
  }

  return []
}

async function fetchDrill({ type, version, fund, modalType }) {
  const enc = encodeURIComponent
  switch (type) {
    case 'managerFunds':
      return axios.get(`/api/performance/dashboard/manager-funds?version=${enc(version)}`)
    case 'investors':
      return axios.get(
        `/api/performance/dashboard/investors?version=${enc(version)}&fund=${enc(fund)}`
      )
    case 'fundPerformance':
      return axios.get(
        `/api/performance/dashboard/fund-performance?version=${enc(version)}&fund=${enc(fund)}`
      )
    case 'fundPortfolio':
      return axios.get(
        `/api/performance/dashboard/fund-portfolio?version=${enc(version)}&fund=${enc(fund)}`
      )
    case 'projectCashflow':
      return axios.get(
        `/api/performance/dashboard/project-cashflow?version=${enc(version)}&fund=${enc(fund)}`
      )
    case 'portfolioDetail':
      return modalType === 'externalSf'
        ? axios.get(`/api/performance/dashboard/portfolio-detail-sf?version=${enc(version)}`)
        : axios.get(`/api/performance/dashboard/portfolio-detail?version=${enc(version)}`)
    case 'spvDetail':
      return axios.get(`/api/performance/dashboard/spv-detail?version=${enc(version)}`)
    case 'underlyingCompanies':
      return axios.get(
        `/api/performance/dashboard/underlying-companies?version=${enc(version)}&type=${enc(modalType || 'cumulative')}`
      )
    case 'ipoCompanies':
      return axios.get(
        `/api/performance/dashboard/ipo-companies?version=${enc(version)}&type=${enc(modalType || 'cumulative')}`
      )
    case 'listedEnterprises':
      return axios.get(
        `/api/performance/dashboard/listed-enterprises?version=${enc(version)}&status=${enc(modalType || '已上市')}`
      )
    case 'regionCompanies':
      return axios.get(
        `/api/performance/dashboard/region-companies?version=${enc(version)}&type=${enc(modalType || 'cumulative')}`
      )
    default:
      throw new Error('未知下钻类型')
  }
}

export default function PerformanceDrillPopup({
  visible,
  type,
  fund,
  modalType,
  version,
  onClose
}) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!visible || !type || !version) return undefined
    let cancelled = false
    setLoading(true)
    setData(null)
    fetchDrill({ type, version, fund, modalType })
      .then((res) => {
        if (cancelled) return
        const body = res.data
        if (body?.success) setData(body.data || {})
        else {
          Toast.show({ content: body?.message || '加载明细失败', position: 'bottom' })
          setData({ list: [] })
        }
      })
      .catch((err) => {
        if (cancelled) return
        Toast.show({
          content: err.response?.data?.message || '加载明细失败',
          position: 'bottom'
        })
        setData({ list: [] })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, type, fund, modalType, version])

  const title = useMemo(() => {
    if (type === 'investors' || type === 'fundPerformance' || type === 'fundPortfolio' || type === 'projectCashflow') {
      return fund ? `${fund} · ${TITLE_MAP[type]}` : TITLE_MAP[type]
    }
    if (type === 'portfolioDetail') {
      if (modalType === 'directOnly') return '整体组合明细 · 直投项目'
      if (modalType === 'externalSf') return '整体组合明细 · 外部子基金'
      return TITLE_MAP.portfolioDetail
    }
    if (type === 'underlyingCompanies' || type === 'ipoCompanies' || type === 'regionCompanies') {
      const tag = modalType === 'current' ? '当前' : '累计'
      return `${TITLE_MAP[type]}【${tag}】`
    }
    if (type === 'listedEnterprises') {
      return ({ 已上市: '已上市企业明细', 已受理: '已受理企业明细', 辅导备案: '已辅导企业明细' })[
        modalType
      ] || TITLE_MAP.listedEnterprises
    }
    return TITLE_MAP[type] || '明细'
  }, [type, fund, modalType])

  const cards = useMemo(() => buildCards(type, modalType, data), [type, modalType, data])

  return (
    <Popup
      visible={visible}
      onMaskClick={onClose}
      onClose={onClose}
      position="bottom"
      bodyStyle={{
        height: '88vh',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div className="h5-perf-drill__head">
        <div className="h5-perf-drill__head-text">
          <h3>{title}</h3>
          <p>单位：元 · {version} · 只读</p>
        </div>
        <button type="button" className="h5-perf-drill__close" onClick={onClose} aria-label="关闭">
          <CloseOutline fontSize={20} />
        </button>
      </div>
      <div className="h5-perf-drill__body">
        {loading ? (
          <div className="h5-empty">
            <DotLoading /> 加载明细…
          </div>
        ) : null}
        {!loading && cards.length === 0 ? <div className="h5-empty">暂无明细数据</div> : null}
        {!loading
          ? cards.map((c) => <DrillCard key={c.key} title={c.title} rows={c.rows} />)
          : null}
      </div>
    </Popup>
  )
}
