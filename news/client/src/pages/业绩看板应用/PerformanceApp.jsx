/**
 * 业绩看板应用 - 主应用组件（React版本）
 * 业绩看板应用扩展
 */
import React, { useState, useEffect } from 'react'
import {
  Select, Button, Spin, Message, Modal, Tooltip, Input, Popover
} from '@arco-design/web-react'
import {
  IconBook, IconSettings, IconRefresh, IconShareAlt, IconDownload, IconLock, IconUnlock, IconDelete, IconPlus, IconClose, IconCalendar, IconInfoCircle
} from '@arco-design/web-react/icon'
import axios from '../../utils/axios'
import './PerformanceApp.css'

const { Option } = Select

// 指标标签：当有说明时在右上角显示 info 图标，鼠标悬停显示说明
function IndicatorLabel({ label, desc }) {
  if (!desc || String(desc).trim() === '') {
    return label
  }
  return (
    <span className="perf-indicator-label-wrap">
      {label}
      <Tooltip content={desc} position="top">
        <span className="perf-indicator-desc-icon" onClick={(e) => e.stopPropagation()}>
          <IconInfoCircle />
        </span>
      </Tooltip>
    </span>
  )
}

// 将接口可能返回的字符串转为数字，无效则返回 null
const toNum = (val) => {
  if (val === null || val === undefined) return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

// 工具函数 - 格式化金额（转亿，保留2位小数）
const formatAmount = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return (n / 100000000).toFixed(2)
}

// 工具函数 - 格式化金额（元，千分位，保留2位小数）
const formatAmountYuan = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 工具函数 - 格式化数字（整数）
const formatNumber = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return Math.round(n).toLocaleString()
}

// 工具函数 - 格式化比例（后加x）
const formatRatio = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return n.toFixed(2) + 'x'
}

// 工具函数 - 认缴比例等显示为百分比（保留2位小数）
const formatPercentRatio = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return (Number(n) * 100).toFixed(2) + '%'
}

// 日期显示为 YYYY-MM-DD（投资人名录表头用）
const formatDateOnly = (v) => {
  if (v == null || v === '') return ''
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  return s
}

// 工具函数 - 格式化百分比（NIRR/GIRR）
const formatPercent = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return (n * 100).toFixed(2) + '%'
}

// API 请求函数
const performanceApi = {
  getDates: () => axios.get('/api/performance/versions/dates'),
  getVersions: (date) => axios.get(`/api/performance/versions?date=${date}`),
  getVersionHistory: (date) => axios.get(`/api/performance/versions/history?date=${date}`),
  createVersion: (data) => axios.post('/api/performance/versions', data),
  lockVersion: (version, locked) => axios.patch(`/api/performance/versions/${encodeURIComponent(version)}/lock`, { locked }),
  deleteVersion: (version) => axios.delete(`/api/performance/versions/${encodeURIComponent(version)}`),
  getManagerIndicator: (version) => axios.get(`/api/performance/dashboard/manager?version=${encodeURIComponent(version)}`),
  getManagerFunds: (version) => axios.get(`/api/performance/dashboard/manager-funds?version=${encodeURIComponent(version)}`),
  getFunds: (version) => axios.get(`/api/performance/dashboard/funds?version=${encodeURIComponent(version)}`),
  getInvestors: (version, fund) => axios.get(`/api/performance/dashboard/investors?version=${encodeURIComponent(version)}&fund=${encodeURIComponent(fund)}`),
  getFundPerformance: (version, fund) => axios.get(`/api/performance/dashboard/fund-performance?version=${encodeURIComponent(version)}&fund=${encodeURIComponent(fund)}`),
  getFundPortfolio: (version, fund) => axios.get(`/api/performance/dashboard/fund-portfolio?version=${encodeURIComponent(version)}&fund=${encodeURIComponent(fund)}`),
  getProjectCashflow: (version, fund) => axios.get(`/api/performance/dashboard/project-cashflow?version=${encodeURIComponent(version)}&fund=${encodeURIComponent(fund)}`),
  getPortfolio: (version) => axios.get(`/api/performance/dashboard/portfolio?version=${encodeURIComponent(version)}`),
  getPortfolioDetail: (version) => axios.get(`/api/performance/dashboard/portfolio-detail?version=${encodeURIComponent(version)}`),
  getUnderlying: (version) => axios.get(`/api/performance/dashboard/underlying?version=${encodeURIComponent(version)}`),
  getUnderlyingCompanies: (version, type) => axios.get(`/api/performance/dashboard/underlying-companies?version=${encodeURIComponent(version)}&type=${type}`),
  getIpoCompanies: (version, type) => axios.get(`/api/performance/dashboard/ipo-companies?version=${encodeURIComponent(version)}&type=${type}`),
  getRegionCompanies: (version, type) => axios.get(`/api/performance/dashboard/region-companies?version=${encodeURIComponent(version)}&type=${type}`),
  getIndicators: () => axios.get('/api/performance/config/indicators'),
  updateIndicators: (data) => axios.put('/api/performance/config/indicators', data),
  createShare: (data) => axios.post('/api/performance/share/create', data),
  exportManagerFunds: (version) => axios.post('/api/performance/exports/manager-funds', { version }, { responseType: 'blob' }),
  exportInvestors: (version, fund) => axios.post('/api/performance/exports/investors', { version, fund }, { responseType: 'blob' }),
  exportFundPerformance: (version, fund) => axios.post('/api/performance/exports/fund-performance', { version, fund }, { responseType: 'blob' }),
  exportFundPortfolio: (version, fund) => axios.post('/api/performance/exports/fund-portfolio', { version, fund }, { responseType: 'blob' }),
  exportProjectCashflow: (version, fund) => axios.post('/api/performance/exports/project-cashflow', { version, fund }, { responseType: 'blob' }),
  exportPortfolioDetail: (version) => axios.post('/api/performance/exports/portfolio-detail', { version }, { responseType: 'blob' }),
  exportIpoCompanies: (version, type) => axios.post('/api/performance/exports/ipo-companies', { version, type }, { responseType: 'blob' }),
}

// 下载文件工具
const downloadFile = (blobResponse, filename) => {
  const url = window.URL.createObjectURL(new Blob([blobResponse]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// 版本日期格式化
const formatVersionDate = (version) => {
  if (!version) return ''
  const d = version.substring(0, 8)
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`
}

// 根据月份值（Date 或 'YYYY-MM'）得到该月最后一天的日期字符串 'YYYY-MM-DD'
const getLastDayOfMonth = (monthValue) => {
  if (!monthValue) return null
  let year, month
  if (monthValue instanceof Date) {
    year = monthValue.getFullYear()
    month = monthValue.getMonth() + 1
  } else if (typeof monthValue === 'string') {
    const parts = monthValue.split('-').map(Number)
    if (parts.length >= 2) {
      year = parts[0]
      month = parts[1]
    } else return null
  } else return null
  const lastDay = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

/** 选择年月：顶部年份 + 12 个月网格（参考飞书/图2） */
function MonthYearPicker({ value, onChange, placeholder = '选择年月', style }) {
  const [visible, setVisible] = useState(false)
  const [year, setYear] = useState(() => value ? value.getFullYear() : new Date().getFullYear())

  useEffect(() => {
    if (visible) setYear(value ? value.getFullYear() : new Date().getFullYear())
  }, [visible, value])

  const open = () => setVisible(true)

  const selectMonth = (monthIndex) => {
    onChange(new Date(year, monthIndex, 1))
    setVisible(false)
  }

  const display = value
    ? `${value.getFullYear()}年${value.getMonth() + 1}月`
    : ''

  const content = (
    <div className="perf-month-year-picker">
      <div className="perf-month-year-header">
        <span className="perf-month-year-nav" onClick={() => setYear((y) => y - 1)}>«</span>
        <span className="perf-month-year-title">{year} 年</span>
        <span className="perf-month-year-nav" onClick={() => setYear((y) => y + 1)}>»</span>
      </div>
      <div className="perf-month-year-grid">
        {MONTH_NAMES.map((name, i) => (
          <button
            key={i}
            type="button"
            className={`perf-month-year-cell ${value && value.getFullYear() === year && value.getMonth() === i ? 'active' : ''}`}
            onClick={() => selectMonth(i)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <Popover
      trigger="click"
      position="bottom"
      popupVisible={visible}
      onVisibleChange={(v) => setVisible(v)}
      content={content}
    >
      <Input
        readOnly
        value={display}
        placeholder={placeholder}
        style={{ width: 160, cursor: 'pointer', ...style }}
        prefix={<IconCalendar />}
        onClick={open}
      />
    </Popover>
  )
}

// 模态框头部信息组件
function ModalInfo({ version, unit = '人民币' }) {
  return (
    <div className="perf-modal-header">
      <span>单位：{unit}</span>
      <span>数据截至日期：{formatVersionDate(version)}</span>
      <span>版本号：{version}</span>
    </div>
  )
}

// 管理人指标卡（参考设计图：5 张卡片，母/直投下显示「自XX年起」，认缴/实缴/累计分配下显示「较上月增加」）
function ManagerCard({ data, config, onClick }) {
  const items = [
    { label: '母基金数量', value: formatNumber(data?.fofNum), sub: (data?.fofSinceYear != null && data?.fofSinceYear !== '') ? `自${data.fofSinceYear}年起` : (config?.fofNumDesc || ''), descKey: 'fofNumDesc' },
    { label: '直投基金数量', value: formatNumber(data?.directNum), sub: (data?.directSinceYear != null && data?.directSinceYear !== '') ? `自${data.directSinceYear}年起` : (config?.directNumDesc || ''), descKey: 'directNumDesc' },
    { label: '认缴管理规模', value: formatAmount(data?.subAmount), change: data?.subAdd, subLabel: '较上月增加', valueRed: true, descKey: 'subAmountDesc' },
    { label: '实缴管理规模', value: formatAmount(data?.paidInAmount), change: data?.paidInAdd, subLabel: '较上月增加', valueRed: true, descKey: 'paidInAmountDesc' },
    { label: '累计分配总额', value: formatAmount(data?.disAmount), change: data?.disAdd, subLabel: '较上月增加', valueRed: true, descKey: 'disAmountDesc' },
  ]

  return (
    <div className="perf-section perf-clickable" onClick={onClick}>
      <div className="perf-section-title">管理人指标</div>
      <div className="perf-indicator-grid perf-indicator-grid-5">
        {items.map((item, idx) => (
          <div key={idx} className="perf-indicator-item">
            <div className="perf-indicator-label">
              {config && item.sub && !item.subLabel ? (
                <Tooltip content={item.sub}><span>{item.label}</span></Tooltip>
              ) : (
                <IndicatorLabel label={item.label} desc={item.descKey ? config?.[item.descKey] : null} />
              )}
            </div>
            <div className={`perf-indicator-value ${item.change != null && item.change > 0 ? 'positive' : item.change != null && item.change < 0 ? 'negative' : ''} ${item.valueRed ? 'perf-indicator-value-red' : ''}`}>
              {item.value}
            </div>
            {(item.subLabel || item.sub) && (
              <div className="perf-indicator-sub">
                {item.subLabel ? `较上月增加: ${item.change != null && item.change !== 0 ? formatAmount(item.change) : '-'}` : item.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// 投资组合板块（参考设计图：左侧子基金/直投项目区隔指标块，每基金拆成投/退两列；整体组合左侧色块+子基金/直投项目区隔）
function PortfolioSection({ funds, portfolioFunds, overall, config, onFundPortfolio, onPortfolioDetail }) {
  const fundMap = (portfolioFunds || []).reduce((acc, r) => { acc[r.fund] = r; return acc }, {})

  const subFundRows = [
    { label: '投/退数量', keyInvest: 'fund_inv', keyExit: 'fund_exit', fmt: formatNumber, descKey: 'fundInvExitDesc' },
    { label: '认缴/退出', keyInvest: 'fund_sub', keyExit: 'fund_exit_amount', fmt: formatAmount, descKey: 'fundSubExitDesc' },
    { label: '实缴/回款', keyInvest: 'fund_paidin', keyExit: 'fund_receive', fmt: formatAmount, descKey: 'fundPaidinReceiveDesc' },
  ]
  const directRows = [
    { label: '投/退数量', keyInvest: 'project_inv', keyExit: 'project_exit', fmt: formatNumber, descKey: 'projectInvExitDesc' },
    { label: '实缴/回款', keyInvest: 'project_paidin', keyExit: 'project_receive', fmt: formatAmount, descKey: 'projectPaidinReceiveDesc' },
  ]

  return (
    <div className="perf-section">
      <div className="perf-section-title">投资组合</div>
      {/* 各基金：左侧子基金/直投项目标签区隔，每基金投/退两列 */}
      {funds && funds.length > 0 && (
        <div className="perf-fund-table-wrap perf-portfolio-wrap" style={{ marginBottom: 24 }}>
          <table className="perf-fund-table perf-portfolio-table">
            <thead>
              <tr>
                <th className="perf-portfolio-label-col perf-sticky-col" rowSpan={2}>指标</th>
                {funds.map(fund => (
                  <th key={fund} colSpan={2} className="perf-portfolio-fund-th">{fund}</th>
                ))}
              </tr>
              <tr>
                {funds.flatMap(fund => [
                  <th key={`${fund}-投`} className="perf-portfolio-invest-th">投</th>,
                  <th key={`${fund}-退`} className="perf-portfolio-exit-th">退</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr className="perf-portfolio-group-row">
                <td className="perf-portfolio-group-label perf-sticky-col">子基金</td>
                {funds.map((f, i) => <td key={`empty-sf-${i}`} className="perf-portfolio-empty" colSpan={2} />)}
              </tr>
              {subFundRows.map((s, ri) => (
                <tr key={`sf-${ri}`}>
                  <td className="perf-portfolio-metric-label perf-sticky-col">
                    <IndicatorLabel label={s.label} desc={config?.[s.descKey]} />
                  </td>
                  {funds.flatMap(fund => {
                    const row = fundMap[fund]
                    return [
                      <td key={`${fund}-投`} className="perf-clickable-cell perf-invest-cell" onClick={() => onFundPortfolio(fund)}>{row ? s.fmt(row[s.keyInvest]) : '-'}</td>,
                      <td key={`${fund}-退`} className="perf-clickable-cell perf-exit-cell" onClick={() => onFundPortfolio(fund)}>{row ? s.fmt(row[s.keyExit]) : '-'}</td>,
                    ]
                  })}
                </tr>
              ))}
              <tr className="perf-portfolio-group-row">
                <td className="perf-portfolio-group-label perf-sticky-col">直投项目</td>
                {funds.flatMap((f, i) => [<td key={`e2-${f}-${i}`} className="perf-portfolio-empty" colSpan={2} />])}
              </tr>
              {directRows.map((s, ri) => (
                <tr key={`dp-${ri}`}>
                  <td className="perf-portfolio-metric-label perf-sticky-col">
                    <IndicatorLabel label={s.label} desc={config?.[s.descKey]} />
                  </td>
                  {funds.flatMap(fund => {
                    const row = fundMap[fund]
                    return [
                      <td key={`${fund}-投`} className="perf-clickable-cell perf-invest-cell" onClick={() => onFundPortfolio(fund)}>{row ? s.fmt(row[s.keyInvest]) : '-'}</td>,
                      <td key={`${fund}-退`} className="perf-clickable-cell perf-exit-cell" onClick={() => onFundPortfolio(fund)}>{row ? s.fmt(row[s.keyExit]) : '-'}</td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* 整体组合：左侧色块 + 子基金/直投项目标签区隔指标块 */}
      {overall && (
        <div className="perf-portfolio-overall-block">
          <div className="perf-portfolio-overall-bar">
            <div className="perf-portfolio-overall-bar-text">
              {'整体组合'.split('').map((char, i) => <span key={i}>{char}</span>)}
            </div>
          </div>
          <div className="perf-portfolio-overall-content">
            <div className="perf-portfolio-block">
              <div className="perf-portfolio-block-title">子基金</div>
              <div className="perf-portfolio-block-cards">
              <div className="perf-indicator-grid perf-indicator-grid-6">
                {[
                  { label: '累计投资数量', value: formatNumber(overall.fund_inv), change: overall.fund_inv_change, descKey: 'fundInvAccDesc' },
                  { label: '累计认缴金额', value: formatAmount(overall.fund_sub), change: overall.fund_sub_change, descKey: 'fundSubAccDesc' },
                  { label: '累计实缴金额', value: formatAmount(overall.fund_paidin), change: overall.fund_paidin_change, descKey: 'fundPaidinAccDesc' },
                  { label: '累计退出数量', value: formatNumber(overall.fund_exit), change: overall.fund_exit_change, isExit: true, descKey: 'fundExitAccDesc' },
                  { label: '累计退出金额', value: formatAmount(overall.fund_exit_amount), change: overall.fund_exit_amount_change, isExit: true, descKey: 'fundExitAmountAccDesc' },
                  { label: '累计回款金额', value: formatAmount(overall.fund_receive), change: overall.fund_receive_change, isExit: true, descKey: 'fundReceiveAccDesc' },
                ].map((item, idx) => (
                  <div key={idx} className="perf-indicator-item perf-clickable" onClick={onPortfolioDetail}>
                    <div className="perf-indicator-label">
                      <IndicatorLabel label={item.label} desc={config?.[item.descKey]} />
                    </div>
                    <div className={`perf-indicator-value ${item.isExit ? 'perf-exit-value' : ''}`}>{item.value}</div>
                    <div className="perf-indicator-sub">较上月末{item.change != null && toNum(item.change) !== 0 ? (toNum(item.change) > 0 ? '+' : '') + formatAmount(item.change) : '-'}</div>
                  </div>
                ))}
              </div>
              </div>
            </div>
            <div className="perf-portfolio-block">
              <div className="perf-portfolio-block-title">直投项目</div>
              <div className="perf-portfolio-block-cards">
              <div className="perf-indicator-grid perf-indicator-grid-4">
                {[
                  { label: '累计投资数量', value: formatNumber(overall.project_inv), change: overall.project_inv_change, descKey: 'projectInvAccDesc' },
                  { label: '累计投资金额', value: formatAmount(overall.project_paidin), change: overall.project_paidin_change, descKey: 'projectPaidinAccDesc' },
                  { label: '累计退出数量', value: formatNumber(overall.project_exit), change: overall.project_exit_change, isExit: true, descKey: 'projectExitAccDesc' },
                  { label: '累计回款金额', value: formatAmount(overall.project_receive), change: overall.project_receive_change, isExit: true, descKey: 'projectReceiveAccDesc' },
                ].map((item, idx) => (
                  <div key={idx} className="perf-indicator-item perf-clickable" onClick={onPortfolioDetail}>
                    <div className="perf-indicator-label">
                      <IndicatorLabel label={item.label} desc={config?.[item.descKey]} />
                    </div>
                    <div className={`perf-indicator-value ${item.isExit ? 'perf-exit-value' : ''}`}>{item.value}</div>
                    <div className="perf-indicator-sub">较上月末{item.change != null && toNum(item.change) !== 0 ? (toNum(item.change) > 0 ? '+' : '') + formatAmount(item.change) : '-'}</div>
                  </div>
                ))}
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 底层资产板块（参考设计图：两行排布，左侧累计/当前组合色块，右侧四张指标卡，紧凑布局）
function UnderlyingSection({ data, config, onCompanies, onIpo, onRegion }) {
  const cumulative = data?.cumulative
  const current = data?.current

  const renderCard = (label, val1, sub1, val2, sub2, onClick, key, desc) => (
    <div key={key} className="perf-underlying-item perf-clickable" onClick={onClick}>
      <div className="perf-underlying-item-label">
        <IndicatorLabel label={label} desc={desc} />
      </div>
      <div className="perf-underlying-values">
        <div className="perf-underlying-metric">
          <div className="perf-underlying-val perf-underlying-val-main">{val1}</div>
          {sub1 && <div className="perf-underlying-sub">{sub1}</div>}
        </div>
        {val2 != null && (
          <div className="perf-underlying-metric">
            <div className="perf-underlying-val perf-underlying-val-secondary">{val2}</div>
            {sub2 && <div className="perf-underlying-sub">{sub2}</div>}
          </div>
        )}
      </div>
    </div>
  )

  const cumulativeCards = [
    { label: '底层资产/数量', v1: formatNumber(cumulative?.project_num_a), s1: '项目数量', v2: formatNumber(cumulative?.company_num_a), s2: '企业数量', onClick: () => onCompanies('cumulative'), descKey: 'projectNumADesc' },
    { label: '底层资产/金额', v1: formatAmount(cumulative?.total_amount_a), s1: '投资金额', v2: formatAmount(cumulative?.ct_amount_a), s2: '穿透成本', onClick: () => onCompanies('cumulative'), descKey: 'totalAmountADesc' },
    { label: '上市企业', v1: formatNumber(cumulative?.ipo_num_a), s1: '数量', v2: formatAmount(cumulative?.ipo_amount_a), s2: '投资金额', onClick: () => onIpo('cumulative'), descKey: 'ipoNumADesc' },
    { label: '上海地区企业', v1: formatNumber(cumulative?.sh_num_a), s1: '数量', v2: formatAmount(cumulative?.sh_amount_a), s2: '投资金额', onClick: () => onRegion('cumulative'), descKey: 'shNumADesc' },
  ]
  const currentCards = [
    { label: '底层资产/数量', v1: formatNumber(current?.project_num), s1: '项目数量', v2: formatNumber(current?.company_num), s2: '企业数量', onClick: () => onCompanies('current'), descKey: 'projectNumDesc' },
    { label: '底层资产/金额', v1: formatAmount(current?.total_amount), s1: '投资金额', v2: formatAmount(current?.ct_amount), s2: '穿透成本', onClick: () => onCompanies('current'), descKey: 'totalAmountDesc' },
    { label: '上市企业', v1: formatNumber(current?.ipo_num), s1: '数量', v2: formatAmount(current?.ipo_amount), s2: '投资金额', onClick: () => onIpo('current'), descKey: 'ipoNumDesc' },
    { label: '上海地区企业', v1: formatNumber(current?.sh_num), s1: '数量', v2: formatAmount(current?.sh_amount), s2: '投资金额', onClick: () => onRegion('current'), descKey: 'shNumDesc' },
  ]

  return (
    <div className="perf-section">
      <div className="perf-section-title">底层资产</div>
      <div className="perf-underlying-rows">
        <div className="perf-underlying-row">
          <div className="perf-underlying-label perf-underlying-label-cumulative">累计组合</div>
          <div className="perf-underlying-cards">
            {cumulativeCards.map((c, i) => renderCard(c.label, c.v1, c.s1, c.v2, c.s2, c.onClick, `cum-${i}`, config?.[c.descKey]))}
          </div>
        </div>
        <div className="perf-underlying-row">
          <div className="perf-underlying-label perf-underlying-label-current">当前组合</div>
          <div className="perf-underlying-cards">
            {currentCards.map((c, i) => renderCard(c.label, c.v1, c.s1, c.v2, c.s2, c.onClick, `cur-${i}`, config?.[c.descKey]))}
          </div>
        </div>
      </div>
      <div className="perf-underlying-footnote">
        注：底层资产与穿透数据为上月数据源，所显示数据为回顾时点数据较上月末数据。
      </div>
    </div>
  )
}

// 主应用组件
function PerformanceApp() {
  const [dates, setDates] = useState([])
  const [versions, setVersions] = useState([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedVersion, setSelectedVersion] = useState('')
  const [loading, setLoading] = useState(false)
  const [systemConfig, setSystemConfig] = useState({})

  // 数据状态
  const [managerData, setManagerData] = useState(null)
  const [fundsData, setFundsData] = useState({ funds: [], indicators: {} })
  const [portfolioData, setPortfolioData] = useState({ funds: [], overall: null })
  const [underlyingData, setUnderlyingData] = useState({ cumulative: null, current: null })

  // 弹窗状态
  const [modal, setModal] = useState({ type: null, fund: null, modalType: null })
  const [modalData, setModalData] = useState(null)
  const [modalLoading, setModalLoading] = useState(false)

  // 数据版本更新弹窗：月份选择（每项为 Date 或 null，表示该月）
  const [versionUpdateMonths, setVersionUpdateMonths] = useState([{ value: new Date() }])
  const [versionUpdateExisting, setVersionUpdateExisting] = useState({})
  const [versionUpdateSubmitting, setVersionUpdateSubmitting] = useState(false)
  const [permissions, setPermissions] = useState({
    levelName: null,
    canView: false,
    canConfig: false,
    canOpenModal: false,
    canExport: false
  })

  const openModal = (type, fund = null, modalType = null) => {
    // 数据版本更新、分享等配置类弹窗不受 canOpenModal 限制
    const configTypes = ['versionUpdate', 'share']
    if (!configTypes.includes(type) && !permissions.canOpenModal) {
      Message.warning('当前会员等级不可查看业绩明细弹窗，如需查看请升级会员')
      return
    }
    setModal({ type, fund, modalType })
    setModalData(
      type === 'investors' ? { list: [] } :
      type === 'fundPerformance' ? { indicator: [], cashflow: [] } :
      null
    )
    if (type === 'versionUpdate') {
      setVersionUpdateMonths([{ value: new Date() }])
      setVersionUpdateExisting({})
    }
  }

  const closeModal = () => {
    setModal({ type: null, fund: null, modalType: null })
    setModalData(null)
  }

  // 加载日期列表（防御：保证 dates 始终为数组）
  const loadDates = async () => {
    try {
      const res = await performanceApi.getDates()
      if (res.data?.success) {
        const dateList = Array.isArray(res.data.data?.dates) ? res.data.data.dates : []
        setDates(dateList)
        if (dateList.length > 0) {
          setSelectedDate(dateList[0])
        }
      }
    } catch (error) {
      console.error('加载日期失败:', error)
      setDates([])
    }
  }

  // 加载版本列表（防御：保证 versions 始终为数组，避免白屏）
  const loadVersions = async (date) => {
    if (!date) return
    try {
      const res = await performanceApi.getVersions(date)
      if (res.data?.success) {
        const versionList = Array.isArray(res.data.data?.versions) ? res.data.data.versions : []
        setVersions(versionList)
        setSelectedVersion(versionList[0]?.version ?? '')
      } else {
        setVersions([])
        setSelectedVersion('')
      }
    } catch (error) {
      console.error('加载版本失败:', error)
      setVersions([])
      setSelectedVersion('')
    }
  }

  // 加载系统配置
  const loadSystemConfig = async () => {
    try {
      const res = await performanceApi.getIndicators()
      if (res.data.success) {
        setSystemConfig(res.data.data || {})
      }
    } catch (error) {
      console.error('加载系统配置失败:', error)
    }
  }

  // 加载当前用户在业绩看板中的权限
  const loadPermissions = async () => {
    try {
      const res = await axios.get('/api/performance/permissions')
      if (res.data?.success && res.data.data) {
        setPermissions(res.data.data)
      }
    } catch (error) {
      console.error('加载业绩看板权限失败:', error)
    }
  }

  // 加载看板数据
  const loadDashboardData = async (version) => {
    if (!version) return
    setLoading(true)
    try {
      const [managerRes, fundsRes, portfolioRes, underlyingRes] = await Promise.all([
        performanceApi.getManagerIndicator(version),
        performanceApi.getFunds(version),
        performanceApi.getPortfolio(version),
        performanceApi.getUnderlying(version),
      ])
      if (managerRes.data?.success) setManagerData(managerRes.data.data ?? null)
      if (fundsRes.data?.success) {
        const fd = fundsRes.data.data
        setFundsData(fd && Array.isArray(fd.funds) ? { funds: fd.funds, indicators: fd.indicators ?? {} } : { funds: [], indicators: {} })
      }
      if (portfolioRes.data?.success) {
        const pd = portfolioRes.data.data
        setPortfolioData(pd && (Array.isArray(pd.funds) || pd.overall != null) ? { funds: pd.funds ?? [], overall: pd.overall ?? null } : { funds: [], overall: null })
      }
      if (underlyingRes.data?.success) {
        const ud = underlyingRes.data.data
        setUnderlyingData(ud ? { cumulative: ud.cumulative ?? null, current: ud.current ?? null } : { cumulative: null, current: null })
      }
    } catch (error) {
      console.error('加载看板数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 加载弹窗数据
  useEffect(() => {
    if (!modal.type || !selectedVersion) return
    if (['investors', 'fundPerformance', 'fundPortfolio', 'projectCashflow'].includes(modal.type) && !modal.fund) return
    setModalLoading(true)
    
    const loadModalData = async () => {
      try {
        let res
        switch (modal.type) {
          case 'managerFunds':
            res = await performanceApi.getManagerFunds(selectedVersion)
            break
          case 'investors':
            res = await performanceApi.getInvestors(selectedVersion, modal.fund)
            break
          case 'fundPerformance':
            res = await performanceApi.getFundPerformance(selectedVersion, modal.fund)
            break
          case 'fundPortfolio':
            res = await performanceApi.getFundPortfolio(selectedVersion, modal.fund)
            break
          case 'projectCashflow':
            res = await performanceApi.getProjectCashflow(selectedVersion, modal.fund)
            break
          case 'portfolioDetail':
            res = await performanceApi.getPortfolioDetail(selectedVersion)
            break
          case 'underlyingCompanies':
            res = await performanceApi.getUnderlyingCompanies(selectedVersion, modal.modalType)
            break
          case 'ipoCompanies':
            res = await performanceApi.getIpoCompanies(selectedVersion, modal.modalType)
            break
          case 'regionCompanies':
            res = await performanceApi.getRegionCompanies(selectedVersion, modal.modalType)
            break
          default:
            return
        }
        if (res && res.data?.success && res.data?.data != null) {
          setModalData(res.data.data)
        } else if (modal.type === 'investors') {
          setModalData({ list: res?.data?.data?.list ?? [] })
        } else if (modal.type === 'fundPerformance') {
          setModalData({ indicator: res?.data?.data?.indicator ?? [], cashflow: res?.data?.data?.cashflow ?? [] })
        }
      } catch (error) {
        console.error('加载弹窗数据失败:', error)
        if (modal.type === 'investors') setModalData({ list: [] })
        if (modal.type === 'fundPerformance') setModalData({ indicator: [], cashflow: [] })
        if (modal.type === 'portfolioDetail') setModalData({ list: [] })
      } finally {
        setModalLoading(false)
      }
    }
    
    loadModalData()
  }, [modal, selectedVersion])

  useEffect(() => {
    loadDates()
    loadSystemConfig()
    loadPermissions()
  }, [])

  useEffect(() => {
    if (selectedDate) {
      loadVersions(selectedDate)
    }
  }, [selectedDate])

  useEffect(() => {
    if (selectedVersion) {
      loadDashboardData(selectedVersion)
    }
  }, [selectedVersion])

  // 数据版本更新弹窗：根据已选月份拉取已有版本，用于预览下一版本号
  useEffect(() => {
    if (modal.type !== 'versionUpdate') return
    const dates = versionUpdateMonths
      .map((item) => getLastDayOfMonth(item.value))
      .filter(Boolean)
    if (dates.length === 0) {
      setVersionUpdateExisting({})
      return
    }
    const next = {}
    let done = 0
    const maybeFinish = () => {
      done += 1
      if (done === dates.length) setVersionUpdateExisting({ ...next })
    }
    dates.forEach((date) => {
      performanceApi.getVersions(date).then((res) => {
        if (res.data.success && res.data.data.versions && res.data.data.versions.length > 0) {
          next[date] = { maxVersion: res.data.data.versions[0].version }
        }
        maybeFinish()
      }).catch(maybeFinish)
    })
  }, [modal.type, versionUpdateMonths])

  // 导出文件
  const handleExport = async (type, fund) => {
  if (!permissions.canExport) {
    Message.warning('当前会员等级不支持导出业绩看板数据，如需导出请升级为 VIP 会员')
    return
  }
    try {
      let res
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '')
      let filename
      
      switch (type) {
        case 'managerFunds':
          res = await performanceApi.exportManagerFunds(selectedVersion)
          filename = `${selectedVersion}-在管产品清单-${date}.xlsx`
          break
        case 'investors':
          res = await performanceApi.exportInvestors(selectedVersion, fund)
          filename = `${selectedVersion}-${fund}-投资人名录-${date}.xlsx`
          break
        case 'fundPerformance':
          res = await performanceApi.exportFundPerformance(selectedVersion, fund)
          filename = `${selectedVersion}-${fund}-基金业绩指标及现金流底表-${date}.xlsx`
          break
        case 'fundPortfolio':
          res = await performanceApi.exportFundPortfolio(selectedVersion, fund)
          filename = `${selectedVersion}-${fund}-基金投资组合明细-${date}.xlsx`
          break
        case 'projectCashflow':
          res = await performanceApi.exportProjectCashflow(selectedVersion, fund)
          filename = `${selectedVersion}-${fund}-项目现金流及业绩指标-${date}.xlsx`
          break
        case 'portfolioDetail':
          res = await performanceApi.exportPortfolioDetail(selectedVersion)
          filename = `${selectedVersion}-基金投资组合明细-${date}.xlsx`
          break
        case 'ipoCompanies':
          res = await performanceApi.exportIpoCompanies(selectedVersion, modal.modalType)
          filename = `${selectedVersion}-上市企业明细-${date}.xlsx`
          break
        default:
          return
      }
      
      downloadFile(res.data, filename)
      Message.success('导出成功')
    } catch (error) {
      console.error('导出失败:', error)
      Message.error('导出失败')
    }
  }

  // 渲染弹窗内容
  const renderModalContent = () => {
    if (modalLoading) return <Spin />
    if (!modalData) return <div>暂无数据</div>
    
    switch (modal.type) {
      case 'managerFunds':
        return (
          <>
            <div className="perf-modal-header perf-modal-header-with-action">
              <span>单位：人民币元</span>
              <span>数据截至日期：{formatVersionDate(selectedVersion)}</span>
              <span>版本号：{selectedVersion}</span>
              <Button
                type="primary"
                className="perf-export-btn"
                icon={<IconDownload />}
                onClick={() => handleExport('managerFunds', null)}
                style={{ marginLeft: 'auto' }}
              >
                导出底稿
              </Button>
            </div>
            <table className="perf-table perf-table-bordered">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>基金名称</th>
                  <th>基金类型</th>
                  <th>认缴规模</th>
                  <th>本年新增认缴</th>
                  <th>实缴规模</th>
                  <th>本年新增实缴</th>
                  <th>累计分配金额</th>
                  <th>本年新增分配</th>
                </tr>
              </thead>
              <tbody>
                {(modalData.list || []).map((row, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{row.fund}</td><td>{row.fund_type}</td>
                    <td>{formatAmountYuan(row.sub_amount)}</td><td>{formatAmountYuan(row.sub_add)}</td>
                    <td>{formatAmountYuan(row.paid_in_amount)}</td><td>{formatAmountYuan(row.paid_in_add)}</td>
                    <td>{formatAmountYuan(row.dis_amount)}</td><td>{formatAmountYuan(row.dis_add)}</td>
                  </tr>
                ))}
                {(() => {
                  const list = modalData.list || []
                  const sum = { sub_amount: 0, sub_add: 0, paid_in_amount: 0, paid_in_add: 0, dis_amount: 0, dis_add: 0 }
                  list.forEach((r) => {
                    sum.sub_amount += toNum(r.sub_amount) || 0
                    sum.sub_add += toNum(r.sub_add) || 0
                    sum.paid_in_amount += toNum(r.paid_in_amount) || 0
                    sum.paid_in_add += toNum(r.paid_in_add) || 0
                    sum.dis_amount += toNum(r.dis_amount) || 0
                    sum.dis_add += toNum(r.dis_add) || 0
                  })
                  return list.length > 0 ? (
                    <tr className="perf-table-summary">
                      <td>合计</td>
                      <td>-</td>
                      <td>-</td>
                      <td>{formatAmountYuan(sum.sub_amount)}</td>
                      <td>{formatAmountYuan(sum.sub_add)}</td>
                      <td>{formatAmountYuan(sum.paid_in_amount)}</td>
                      <td>{formatAmountYuan(sum.paid_in_add)}</td>
                      <td>{formatAmountYuan(sum.dis_amount)}</td>
                      <td>{formatAmountYuan(sum.dis_add)}</td>
                    </tr>
                  ) : null
                })()}
              </tbody>
            </table>
          </>
        )
      case 'investors': {
        const invList = modalData.list || []
        const firstRow = invList[0]
        const d1 = formatDateOnly(firstRow?.first_date)
        const d2 = formatDateOnly(firstRow?.second_date)
        const d3 = formatDateOnly(firstRow?.third_date)
        const invSum = { subscription_amount: 0, paidin: 0, distribution: 0, first_amount: 0, second_amount: 0, third_amount: 0 }
        invList.forEach((r) => {
          invSum.subscription_amount += toNum(r.subscription_amount) || 0
          invSum.paidin += toNum(r.paidin) || 0
          invSum.distribution += toNum(r.distribution) || 0
          invSum.first_amount += toNum(r.first_amount) || 0
          invSum.second_amount += toNum(r.second_amount) || 0
          invSum.third_amount += toNum(r.third_amount) || 0
        })
        return (
          <div className="perf-modal-investors-wrap">
            <div className="perf-modal-header perf-modal-header-with-action">
              <span>单位：人民币元</span>
              <span>数据截至日期：{formatVersionDate(selectedVersion)}</span>
              <span>版本号：{selectedVersion}</span>
              <Button
                type="primary"
                icon={<IconDownload />}
                className="perf-export-btn"
                onClick={() => handleExport('investors', modal.fund)}
                style={{ marginLeft: 'auto' }}
              >
                导出底稿
              </Button>
            </div>
            <div className="perf-modal-investors-scroll">
              <table className="perf-table perf-table-bordered perf-table-investors">
                <thead>
                  <tr>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-index">序号</th>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-fund">基金名称</th>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-lp-type">合伙人类型</th>
                    <th rowSpan={2} className="perf-th-lp">投资人名称</th>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-num">认缴金额</th>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-num">认缴比例</th>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-num">累计实缴金额</th>
                    <th rowSpan={2} className="perf-th-nowrap perf-col-num">累计分配金额</th>
                    <th colSpan={3} className="perf-th-nowrap perf-col-num">最近三次分配</th>
                  </tr>
                  <tr>
                    <th className="perf-th-nowrap">{d1 || '-'}</th>
                    <th className="perf-th-nowrap">{d2 || '-'}</th>
                    <th className="perf-th-nowrap">{d3 || '-'}</th>
                  </tr>
                </thead>
                <tbody>
                  {invList.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-td-nowrap perf-col-index">{i + 1}</td>
                      <td className="perf-td-nowrap perf-col-fund" title={row.fund ?? modal.fund}>{row.fund ?? modal.fund}</td>
                      <td className="perf-td-nowrap perf-col-lp-type">{row.lp_type}</td>
                      <td className="perf-td-lp" title={row.lp || ''}>{row.lp}</td>
                      <td>{formatAmountYuan(row.subscription_amount)}</td>
                      <td>{formatPercentRatio(row.subscription_ratio)}</td>
                      <td>{formatAmountYuan(row.paidin)}</td>
                      <td>{formatAmountYuan(row.distribution)}</td>
                      <td>{formatAmountYuan(row.first_amount)}</td>
                      <td>{formatAmountYuan(row.second_amount)}</td>
                      <td>{formatAmountYuan(row.third_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {invList.length > 0 && (
                  <tfoot>
                    <tr className="perf-table-summary">
                      <td className="perf-col-index">合计</td>
                      <td className="perf-col-fund">-</td>
                      <td className="perf-col-lp-type">-</td>
                      <td className="perf-td-lp">-</td>
                      <td>{formatAmountYuan(invSum.subscription_amount)}</td>
                      <td>-</td>
                      <td>{formatAmountYuan(invSum.paidin)}</td>
                      <td>{formatAmountYuan(invSum.distribution)}</td>
                      <td>{formatAmountYuan(invSum.first_amount)}</td>
                      <td>{formatAmountYuan(invSum.second_amount)}</td>
                      <td>{formatAmountYuan(invSum.third_amount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      }
      case 'fundPerformance': {
        const indList = modalData.indicator || []
        const cashList = modalData.cashflow || []
        return (
          <div className="perf-modal-fundperf-wrap">
            <div className="perf-modal-header perf-modal-header-with-action">
              <span>单位：人民币元</span>
              <span>数据截至日期：{formatVersionDate(selectedVersion)}</span>
              <span>版本号：{selectedVersion}</span>
              <Button
                type="primary"
                className="perf-export-btn"
                icon={<IconDownload />}
                onClick={() => handleExport('fundPerformance', modal.fund)}
                style={{ marginLeft: 'auto' }}
              >
                导出底稿
              </Button>
            </div>
            {/* 上半部分：基金业绩指标，不参与滚动 */}
            <div className="perf-modal-fundperf-inner">
              <div className="perf-fundperf-section-title">基金业绩指标</div>
              <table className="perf-table perf-table-bordered perf-table-fundperf">
                <thead>
                  <tr>
                    <th className="perf-col-index">序号</th>
                    <th>基金名称</th>
                    <th>投资人认缴</th>
                    <th>投资人实缴</th>
                    <th>投资人分配</th>
                    <th>TVPI</th>
                    <th>DPI</th>
                    <th>RVPI</th>
                    <th>NIRR</th>
                  </tr>
                </thead>
                <tbody>
                  {indList.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-col-index">{i + 1}</td>
                      <td>{row.fund}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.lp_sub)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.paidin)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.distribution)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(row.tvpi)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(row.dpi)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(row.rvpi)}</td>
                      <td className="perf-td-num">{formatPercent(row.nirr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 下半部分：现金流明细表，单独滚动，表头固定 */}
            <div className="perf-fundperf-section-title">现金流明细表</div>
            <div className="perf-modal-fundperf-scroll-cashflow">
              <table className="perf-table perf-table-bordered perf-table-fundperf perf-table-fundperf-cashflow">
                <thead>
                  <tr>
                    <th className="perf-col-index">序号</th>
                    <th>基金名称</th>
                    <th className="perf-th-lp">投资人名称</th>
                    <th className="perf-td-center">交易类型</th>
                    <th>交易时间</th>
                    <th>交易金额</th>
                  </tr>
                </thead>
                <tbody>
                  {cashList.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-col-index">{i + 1}</td>
                      <td>{row.fund}</td>
                      <td className="perf-td-lp" title={row.lp || ''}>{row.lp}</td>
                      <td className="perf-td-center">{row.transaction_type}</td>
                      <td>{row.transaction_date ? String(row.transaction_date).substring(0, 10) : ''}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.transaction_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
      case 'fundPortfolio': {
        const list = modalData.list || []
        const subFundRows = list.filter(r => r.transaction_type === '子基金')
        const directRows = list.filter(r => r.transaction_type === '直投项目')

        const sumGroup = (rows) => {
          const sum = {
            acc_sub: 0,
            change_sub: 0,
            acc_paidin: 0,
            change_paidin: 0,
            acc_exit: 0,
            change_exit: 0,
            acc_receive: 0,
            change_receive: 0,
            unrealized: 0,
            change_unrealized: 0,
            total_value: 0,
          }
          rows.forEach((r) => {
            sum.acc_sub += toNum(r.acc_sub) || 0
            sum.change_sub += toNum(r.change_sub) || 0
            sum.acc_paidin += toNum(r.acc_paidin) || 0
            sum.change_paidin += toNum(r.change_paidin) || 0
            sum.acc_exit += toNum(r.acc_exit) || 0
            sum.change_exit += toNum(r.change_exit) || 0
            sum.acc_receive += toNum(r.acc_receive) || 0
            sum.change_receive += toNum(r.change_receive) || 0
            sum.unrealized += toNum(r.unrealized) || 0
            sum.change_unrealized += toNum(r.change_unrealized) || 0
            sum.total_value += toNum(r.total_value) || 0
          })
          const moc = sum.acc_paidin ? sum.total_value / sum.acc_paidin : null
          const dpi = sum.acc_paidin ? sum.acc_receive / sum.acc_paidin : null
          return { ...sum, moc, dpi }
        }

        const subFundSum = sumGroup(subFundRows)
        const directSum = sumGroup(directRows)
        const allSum = sumGroup(list)
        allSum.moc = allSum.acc_paidin ? allSum.total_value / allSum.acc_paidin : null
        allSum.dpi = allSum.acc_paidin ? allSum.acc_receive / allSum.acc_paidin : null

        const renderDataRow = (row, index) => (
          <tr key={`${row.transaction_type || ''}-${row.project || ''}-${index}`}>
            <td className="perf-col-index">{index}</td>
            <td className="perf-col-type">{row.transaction_type}</td>
            <td className="perf-col-project">{row.project}</td>
            <td className="perf-col-date">{row.first_date ? String(row.first_date).substring(0, 10) : ''}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_sub)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_sub)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_paidin)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_paidin)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_exit)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_exit)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_receive)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_receive)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.unrealized)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_unrealized)}</td>
            <td className="perf-td-num perf-col-total-value">{formatAmountYuan(row.total_value)}</td>
            <td className="perf-td-num perf-col-ratio">{formatRatio(row.moc)}</td>
            <td className="perf-td-num perf-col-ratio">{formatRatio(row.dpi)}</td>
          </tr>
        )

        return (
          <div className="perf-modal-fundperf-wrap">
            <div className="perf-modal-header perf-modal-header-with-action">
              <span>单位：人民币元</span>
              <span>数据截至日期：{formatVersionDate(selectedVersion)}</span>
              <span>版本号：{selectedVersion}</span>
              <Button
                type="primary"
                className="perf-export-btn"
                icon={<IconDownload />}
                onClick={() => handleExport('fundPortfolio', modal.fund)}
                style={{ marginLeft: 'auto' }}
              >
                导出底稿
              </Button>
            </div>
            <div className="perf-fundperf-section-title">基金投资组合明细</div>
            <div className="perf-modal-fundperf-scroll">
              <table className="perf-table perf-table-bordered perf-table-fundperf perf-table-fundportfolio">
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 60 }} /><col style={{ width: 60 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="perf-col-index" rowSpan={2}>序号</th>
                    <th className="perf-col-type" rowSpan={2}>投资类别</th>
                    <th className="perf-col-project" rowSpan={2}>项目名称</th>
                    <th className="perf-col-date" rowSpan={2}>投资时间</th>
                    <th colSpan={2} className="perf-col-amount">认缴金额</th>
                    <th colSpan={2} className="perf-col-amount">实缴金额</th>
                    <th colSpan={2} className="perf-col-amount">退出金额</th>
                    <th colSpan={2} className="perf-col-amount">回款金额</th>
                    <th colSpan={2} className="perf-col-amount">未实现价值</th>
                    <th className="perf-col-total-value" rowSpan={2}>总价值</th>
                    <th className="perf-col-ratio" rowSpan={2}>MOC</th>
                    <th className="perf-col-ratio" rowSpan={2}>DPI</th>
                  </tr>
                  <tr>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 子基金明细 + 小计 */}
                  {subFundRows.length > 0 && (
                    <>
                      {subFundRows.map((row, idx) => renderDataRow(row, idx + 1))}
                      <tr className="perf-table-summary">
                        <td className="perf-col-index" colSpan={2}>小计（子基金）</td>
                        <td className="perf-col-project">{`子基金个数：${subFundRows.length} 个`}</td>
                        <td className="perf-col-date" />
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.unrealized)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_unrealized)}</td>
                        <td className="perf-td-num perf-col-total-value">{formatAmountYuan(subFundSum.total_value)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(subFundSum.moc)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(subFundSum.dpi)}</td>
                      </tr>
                    </>
                  )}

                  {/* 直投项目明细 + 小计（序号重新从 1 开始） */}
                  {directRows.length > 0 && (
                    <>
                      {directRows.map((row, idx) => renderDataRow(row, idx + 1))}
                      <tr className="perf-table-summary">
                        <td className="perf-col-index" colSpan={2}>小计（直投项目）</td>
                        <td className="perf-col-project">{`直投项目个数：${directRows.length} 个`}</td>
                        <td className="perf-col-date" />
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.unrealized)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_unrealized)}</td>
                        <td className="perf-td-num perf-col-total-value">{formatAmountYuan(directSum.total_value)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(directSum.moc)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(directSum.dpi)}</td>
                      </tr>
                    </>
                  )}

                  {/* 总合计 */}
                  {list.length > 0 && (
                    <tr className="perf-table-summary">
                      <td className="perf-col-index" colSpan={2}>合计</td>
                      <td className="perf-col-project">{`总项目个数：${list.length} 个`}</td>
                      <td className="perf-col-date" />
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_sub)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_sub)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_paidin)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_paidin)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_exit)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_exit)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_receive)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_receive)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.unrealized)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_unrealized)}</td>
                      <td className="perf-td-num perf-col-total-value">{formatAmountYuan(allSum.total_value)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(allSum.moc)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(allSum.dpi)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
      case 'portfolioDetail': {
        const list = modalData.list || []
        const subFundRows = list.filter(r => r.transaction_type === '子基金')
        const directRows = list.filter(r => r.transaction_type === '直投项目')

        const sumGroup = (rows) => {
          const sum = {
            acc_sub: 0,
            change_sub: 0,
            acc_paidin: 0,
            change_paidin: 0,
            acc_exit: 0,
            change_exit: 0,
            acc_receive: 0,
            change_receive: 0,
            unrealized: 0,
            change_unrealized: 0,
            total_value: 0,
          }
          rows.forEach((r) => {
            sum.acc_sub += toNum(r.acc_sub) || 0
            sum.change_sub += toNum(r.change_sub) || 0
            sum.acc_paidin += toNum(r.acc_paidin) || 0
            sum.change_paidin += toNum(r.change_paidin) || 0
            sum.acc_exit += toNum(r.acc_exit) || 0
            sum.change_exit += toNum(r.change_exit) || 0
            sum.acc_receive += toNum(r.acc_receive) || 0
            sum.change_receive += toNum(r.change_receive) || 0
            sum.unrealized += toNum(r.unrealized) || 0
            sum.change_unrealized += toNum(r.change_unrealized) || 0
            sum.total_value += toNum(r.total_value) || 0
          })
          const moc = sum.acc_paidin ? sum.total_value / sum.acc_paidin : null
          const dpi = sum.acc_paidin ? sum.acc_receive / sum.acc_paidin : null
          return { ...sum, moc, dpi }
        }

        const subFundSum = sumGroup(subFundRows)
        const directSum = sumGroup(directRows)
        const allSum = sumGroup(list)
        allSum.moc = allSum.acc_paidin ? allSum.total_value / allSum.acc_paidin : null
        allSum.dpi = allSum.acc_paidin ? allSum.acc_receive / allSum.acc_paidin : null

        const renderDataRow = (row, index) => (
          <tr key={`${row.transaction_type || ''}-${row.project || ''}-${index}`}>
            <td className="perf-col-index">{index}</td>
            <td>{row.transaction_type}</td>
            <td>{row.project}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_sub)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_sub)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_paidin)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_paidin)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_exit)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_exit)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.acc_receive)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_receive)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.unrealized)}</td>
            <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.change_unrealized)}</td>
            <td className="perf-td-num perf-col-total-value">{formatAmountYuan(row.total_value)}</td>
            <td className="perf-td-num perf-col-ratio">{formatRatio(row.moc)}</td>
            <td className="perf-td-num perf-col-ratio">{formatRatio(row.dpi)}</td>
          </tr>
        )

        return (
          <div className="perf-modal-fundperf-wrap">
            <div className="perf-modal-header perf-modal-header-with-action">
              <span>单位：人民币元</span>
              <span>数据截至日期：{formatVersionDate(selectedVersion)}</span>
              <span>版本号：{selectedVersion}</span>
              <Button
                type="primary"
                className="perf-export-btn"
                icon={<IconDownload />}
                onClick={() => handleExport('portfolioDetail', null)}
                style={{ marginLeft: 'auto' }}
              >
                导出底稿
              </Button>
            </div>
            <div className="perf-fundperf-section-title">整体基金投资组合明细</div>
            <div className="perf-modal-fundperf-scroll">
              <table className="perf-table perf-table-bordered perf-table-fundperf perf-table-fundportfolio perf-table-portfolio-detail">
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 120 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 60 }} /><col style={{ width: 60 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="perf-col-index" rowSpan={2}>序号</th>
                    <th className="perf-col-type" rowSpan={2}>投资类别</th>
                    <th className="perf-col-project" rowSpan={2}>项目名称</th>
                    <th colSpan={2} className="perf-col-amount">认缴金额</th>
                    <th colSpan={2} className="perf-col-amount">实缴金额</th>
                    <th colSpan={2} className="perf-col-amount">退出金额</th>
                    <th colSpan={2} className="perf-col-amount">回款金额</th>
                    <th colSpan={2} className="perf-col-amount">未实现价值</th>
                    <th className="perf-col-total-value" rowSpan={2}>总价值</th>
                    <th className="perf-col-ratio" rowSpan={2}>MOC</th>
                    <th className="perf-col-ratio" rowSpan={2}>DPI</th>
                  </tr>
                  <tr>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                    <th className="perf-col-amount">累计值</th>
                    <th className="perf-col-amount">本月变动</th>
                  </tr>
                </thead>
                <tbody>
                  {subFundRows.length > 0 && (
                    <>
                      {subFundRows.map((row, idx) => renderDataRow(row, idx + 1))}
                      <tr className="perf-table-summary">
                        <td className="perf-col-index" colSpan={2}>小计（子基金）</td>
                        <td className="perf-col-project">{`子基金个数：${subFundRows.length} 个`}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.acc_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.unrealized)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(subFundSum.change_unrealized)}</td>
                        <td className="perf-td-num perf-col-total-value">{formatAmountYuan(subFundSum.total_value)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(subFundSum.moc)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(subFundSum.dpi)}</td>
                      </tr>
                    </>
                  )}
                  {directRows.length > 0 && (
                    <>
                      {directRows.map((row, idx) => renderDataRow(row, idx + 1))}
                      <tr className="perf-table-summary">
                        <td className="perf-col-index" colSpan={2}>小计（直投项目）</td>
                        <td className="perf-col-project">{`直投项目个数：${directRows.length} 个`}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_sub)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_paidin)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_exit)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.acc_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_receive)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.unrealized)}</td>
                        <td className="perf-td-num perf-col-amount">{formatAmountYuan(directSum.change_unrealized)}</td>
                        <td className="perf-td-num perf-col-total-value">{formatAmountYuan(directSum.total_value)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(directSum.moc)}</td>
                        <td className="perf-td-num perf-col-ratio">{formatRatio(directSum.dpi)}</td>
                      </tr>
                    </>
                  )}
                  {list.length > 0 && (
                    <tr className="perf-table-summary">
                      <td className="perf-col-index" colSpan={2}>合计</td>
                      <td className="perf-col-project">{`总项目个数：${list.length} 个`}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_sub)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_sub)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_paidin)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_paidin)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_exit)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_exit)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.acc_receive)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_receive)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.unrealized)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(allSum.change_unrealized)}</td>
                      <td className="perf-td-num perf-col-total-value">{formatAmountYuan(allSum.total_value)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(allSum.moc)}</td>
                      <td className="perf-td-num perf-col-ratio">{formatRatio(allSum.dpi)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
      case 'projectCashflow': {
        const indicator = modalData.indicator || null
        const list = modalData.cashflow || []
        return (
          <div className="perf-modal-fundperf-wrap">
            <div className="perf-modal-header perf-modal-header-with-action">
              <span>单位：人民币元</span>
              <span>数据截至日期：{formatVersionDate(selectedVersion)}</span>
              <span>版本号：{selectedVersion}</span>
              <Button
                type="primary"
                className="perf-export-btn"
                icon={<IconDownload />}
                onClick={() => handleExport('projectCashflow', modal.fund)}
                style={{ marginLeft: 'auto' }}
              >
                导出底稿
              </Button>
            </div>
            {/* 上半部分指标表不参与滚动 */}
            <div>
              <div className="perf-fundperf-section-title">项目现金流及业绩指标</div>
              <table className="perf-table perf-table-bordered perf-table-fundperf">
                <thead>
                  <tr>
                    <th className="perf-col-index">序号</th>
                    <th>基金名称</th>
                    <th>投资金额认缴</th>
                    <th>投资金额实缴</th>
                    <th>项目分配</th>
                    <th>GIRR</th>
                    <th>MOC</th>
                  </tr>
                </thead>
                <tbody>
                  {indicator ? (
                    <tr>
                      <td className="perf-col-index">1</td>
                      <td>{indicator.fund}</td>
                      <td className="perf-td-num">{formatAmountYuan(indicator.sub_amount)}</td>
                      <td className="perf-td-num">{formatAmountYuan(indicator.inv_amount)}</td>
                      <td className="perf-td-num">{formatAmountYuan(indicator.exit_amount)}</td>
                      <td className="perf-td-num">{formatPercent(indicator.girr)}</td>
                      <td className="perf-td-num">{formatRatio(indicator.moc)}</td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center' }}>暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 下半部分现金流明细表独立滚动，从第一条数据开始 */}
            <div className="perf-fundperf-section-title">现金流明细表</div>
            <div className="perf-modal-fundperf-scroll-cashflow">
              <table className="perf-table perf-table-bordered perf-table-fundperf perf-table-fundperf-cashflow">
                <thead>
                  <tr>
                    <th className="perf-col-index">序号</th>
                    <th>基金名称</th>
                    <th>SPV名称</th>
                    <th>子基金名称</th>
                    <th>被投企业名称</th>
                    <th className="perf-td-center">交易类型</th>
                    <th>交易时间</th>
                    <th>交易金额</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-col-index">{i + 1}</td>
                      <td>{row.fund}</td>
                      <td>{row.spv}</td>
                      <td>{row.sub_fund}</td>
                      <td>{row.company}</td>
                      <td className="perf-td-center">{row.transaction_type}</td>
                      <td>{row.transaction_date ? String(row.transaction_date).substring(0, 10) : ''}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.transaction_amount)}</td>
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center' }}>暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
      case 'ipoCompanies': {
        const list = modalData.list || []
        const totalAmount = list.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
        return (
          <div className="perf-modal-investors-wrap perf-ipo-wrap">
            <ModalInfo version={selectedVersion} unit="人民币元" />
            <div className="perf-modal-ipo-scroll">
              <table className="perf-table perf-table-bordered perf-table-ipo">
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 140 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="perf-col-index">序号</th>
                    <th className="perf-col-project">项目简称</th>
                    <th>上市时间</th>
                    <th>所属基金</th>
                    <th className="perf-col-amount">投资金额</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-col-index">{i + 1}</td>
                      <td className="perf-col-project">{row.project}</td>
                      <td>{formatDateOnly(row.ipo_date)}</td>
                      <td>{row.fund}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {list.length > 0 && (
                  <tfoot>
                    <tr className="perf-table-summary perf-table-ipo-summary-row">
                      <td className="perf-col-index" colSpan={2}>合计</td>
                      <td colSpan={2} style={{ textAlign: 'center' }}>-</td>
                      <td className="perf-td-num perf-col-amount">{formatAmountYuan(totalAmount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      }
      case 'underlyingCompanies': {
        const list = modalData.list || []
        const sumTotal = list.length ? list.reduce((acc, r) => ({
          project_num: (acc.project_num || 0) + (Number(r.project_num) || 0),
          company_num: (acc.company_num || 0) + (Number(r.company_num) || 0),
          total_amount: (acc.total_amount || 0) + (Number(r.total_amount) || 0),
          project_amount: (acc.project_amount || 0) + (Number(r.project_amount) || 0),
          ipo_num: (acc.ipo_num || 0) + (Number(r.ipo_num) || 0),
          ipo_amount: (acc.ipo_amount || 0) + (Number(r.ipo_amount) || 0),
        }), {}) : null
        const sumDedup = modalData.summary?.totalDedup || null
        return (
          <div className="perf-modal-fundperf-wrap">
            <ModalInfo version={selectedVersion} unit="人民币亿元" />
            <div className="perf-modal-fundperf-scroll">
              <table className="perf-table perf-table-bordered perf-table-underlying">
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} />
                  <col style={{ width: 100 }} /><col style={{ width: 110 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="perf-col-index" rowSpan={2}>序号</th>
                    <th className="perf-col-fund" rowSpan={2}>所属基金名称</th>
                    <th colSpan={4} className="perf-col-group">底层项目</th>
                    <th colSpan={2} className="perf-col-group">上市企业</th>
                  </tr>
                  <tr>
                    <th className="perf-col-amount">项目数量</th>
                    <th className="perf-col-amount">企业数量</th>
                    <th className="perf-col-amount">投资金额</th>
                    <th className="perf-col-amount">穿透金额</th>
                    <th className="perf-col-amount">数量</th>
                    <th className="perf-col-amount">穿透金额</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-col-index">{i + 1}</td>
                      <td className="perf-col-fund">{row.fund}</td>
                      <td className="perf-td-num perf-col-amount">{row.project_num}</td>
                      <td className="perf-td-num perf-col-amount">{row.company_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(row.total_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(row.project_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{row.ipo_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(row.ipo_amount)}</td>
                    </tr>
                  ))}
                  {sumTotal && (
                    <tr className="perf-table-summary">
                      <td className="perf-col-index" colSpan={2}>合计</td>
                      <td className="perf-td-num perf-col-amount">{sumTotal.project_num}</td>
                      <td className="perf-td-num perf-col-amount">{sumTotal.company_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumTotal.total_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumTotal.project_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{sumTotal.ipo_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumTotal.ipo_amount)}</td>
                    </tr>
                  )}
                  {sumDedup && (
                    <tr className="perf-table-summary">
                      <td className="perf-col-index" colSpan={2}>合计(去重)</td>
                      <td className="perf-td-num perf-col-amount">{sumDedup.project_num}</td>
                      <td className="perf-td-num perf-col-amount">{sumDedup.company_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumDedup.total_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumDedup.project_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{sumDedup.ipo_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumDedup.ipo_amount)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {systemConfig.redirectUrl && (
              <div className="perf-modal-link">
                底层穿透表链接：<a href={systemConfig.redirectUrl} target="_blank" rel="noreferrer">{systemConfig.redirectUrl}</a>
              </div>
            )}
          </div>
        )
      }
      case 'regionCompanies': {
        const list = modalData.list || []
        const sumTotal = list.length > 0 ? list.reduce((acc, row) => ({
          csj_num: (acc.csj_num || 0) + (Number(row.csj_num) || 0),
          csj_amount: (acc.csj_amount || 0) + (Number(row.csj_amount) || 0),
          sh_num: (acc.sh_num || 0) + (Number(row.sh_num) || 0),
          sh_amount: (acc.sh_amount || 0) + (Number(row.sh_amount) || 0),
          pd_num: (acc.pd_num || 0) + (Number(row.pd_num) || 0),
          pd_amount: (acc.pd_amount || 0) + (Number(row.pd_amount) || 0)
        }), {}) : null
        const sumDedup = modalData.summary?.totalDedup || null
        return (
          <div className="perf-modal-fundperf-wrap">
            <ModalInfo version={selectedVersion} unit="人民币亿元" />
            <div className="perf-modal-fundperf-scroll">
              <table className="perf-table perf-table-bordered perf-table-region">
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 80 }} /><col style={{ width: 100 }} />
                  <col style={{ width: 80 }} /><col style={{ width: 100 }} />
                  <col style={{ width: 80 }} /><col style={{ width: 100 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="perf-col-index" rowSpan={2}>序号</th>
                    <th className="perf-col-fund" rowSpan={2}>所属基金名称</th>
                    <th colSpan={2} className="perf-col-group">长三角地区企业</th>
                    <th colSpan={2} className="perf-col-group">上海地区企业</th>
                    <th colSpan={2} className="perf-col-group">浦东地区企业</th>
                  </tr>
                  <tr>
                    <th className="perf-col-amount">数量</th>
                    <th className="perf-col-amount">金额</th>
                    <th className="perf-col-amount">数量</th>
                    <th className="perf-col-amount">金额</th>
                    <th className="perf-col-amount">数量</th>
                    <th className="perf-col-amount">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row, i) => (
                    <tr key={i}>
                      <td className="perf-col-index">{i + 1}</td>
                      <td className="perf-col-fund">{row.fund}</td>
                      <td className="perf-td-num perf-col-amount">{row.csj_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(row.csj_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{row.sh_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(row.sh_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{row.pd_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(row.pd_amount)}</td>
                    </tr>
                  ))}
                  {sumTotal && (
                    <tr className="perf-table-summary">
                      <td className="perf-col-index" colSpan={2}>合计</td>
                      <td className="perf-td-num perf-col-amount">{sumTotal.csj_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumTotal.csj_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{sumTotal.sh_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumTotal.sh_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{sumTotal.pd_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumTotal.pd_amount)}</td>
                    </tr>
                  )}
                  {sumDedup && (
                    <tr className="perf-table-summary">
                      <td className="perf-col-index" colSpan={2}>合计(去重)</td>
                      <td className="perf-td-num perf-col-amount">{sumDedup.csj_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumDedup.csj_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{sumDedup.sh_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumDedup.sh_amount)}</td>
                      <td className="perf-td-num perf-col-amount">{sumDedup.pd_num}</td>
                      <td className="perf-td-num perf-col-amount">{formatAmount(sumDedup.pd_amount)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {systemConfig.redirectUrl && (
              <div className="perf-modal-link">
                底层穿透表链接：<a href={systemConfig.redirectUrl} target="_blank" rel="noreferrer">{systemConfig.redirectUrl}</a>
              </div>
            )}
          </div>
        )
      }
      default:
        return <div>暂无数据</div>
    }
  }

  const getModalTitle = () => {
    const typeMap = {
      managerFunds: '在管产品清单',
      investors: `${modal.fund} - 投资人名录`,
      fundPerformance: `${modal.fund} - 基金业绩指标及现金流底表`,
      fundPortfolio: `${modal.fund} - 基金投资组合明细`,
      projectCashflow: `${modal.fund} - 项目现金流及业绩指标`,
      portfolioDetail: '整体基金投资组合明细',
      underlyingCompanies: `底层企业明细【${modal.modalType === 'cumulative' ? '累计' : '当前'}】`,
      ipoCompanies: `上市企业明细【${modal.modalType === 'cumulative' ? '累计' : '当前'}】`,
      regionCompanies: `区域企业明细【${modal.modalType === 'cumulative' ? '累计' : '当前'}】`,
    }
    return typeMap[modal.type] || ''
  }

  const exportableModals = ['managerFunds', 'investors', 'fundPerformance']

  return (
    <div className="perf-app">
      {/* 工具栏 */}
      <div className="perf-toolbar">
        <div className="perf-toolbar-left">
          <Select
            value={selectedDate}
            onChange={(val) => setSelectedDate(val)}
            placeholder="选择日期"
            style={{ width: 150 }}
          >
            {(dates || []).map(date => <Option key={date} value={date}>{date}</Option>)}
          </Select>
          <Select
            value={selectedVersion}
            onChange={(val) => setSelectedVersion(val)}
            placeholder="选择版本"
            style={{ width: 180, marginLeft: 12 }}
          >
            {(versions || []).map(v => <Option key={v.version} value={v.version}>{v.version}</Option>)}
          </Select>
        </div>
        <div className="perf-toolbar-right">
          <Button
            type="text"
            icon={<IconBook />}
            onClick={() => {
              if (systemConfig.manualUrl) window.open(systemConfig.manualUrl, '_blank')
              else Message.warning('未配置操作手册地址')
            }}
          >操作手册</Button>
          <span className="perf-toolbar-desc">
            {systemConfig.dataGenDesc || '每月于每月28日生成或上月28日数据源，于每月28日或最近工作日完成'}
          </span>
          <Button type="primary" icon={<IconRefresh />} onClick={() => openModal('versionUpdate')}>
            数据版本更新
          </Button>
          <Button type="primary" status="danger" icon={<IconShareAlt />} onClick={() => openModal('share')}>
            分享
          </Button>
        </div>
      </div>

      {/* 系统名称（参考设计图：主标题蓝色、副标题截至日期与金额单位） */}
      <div className="perf-system-header">
        <h1 className="perf-system-name">{systemConfig.systemName || '业绩看板'}</h1>
        <div className="perf-system-info">截至{selectedDate} 金额单位：亿元</div>
      </div>

      {loading ? <Spin style={{ display: 'block', margin: '100px auto' }} /> : (
        <>
          {/* 管理人指标卡 */}
          <ManagerCard
            data={managerData}
            config={systemConfig}
            onClick={() => openModal('managerFunds')}
          />

          {/* 基金产品指标块 */}
          <div className="perf-section">
            <div className="perf-section-title">基金产品</div>
            <div className="perf-fund-table-wrap">
              <table className="perf-fund-table">
                <thead>
                  <tr>
                    <th className="perf-sticky-col">指标</th>
                    {(fundsData.funds || []).map(fund => <th key={fund}>{fund}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '投资人认缴', key: 'lp_sub', fmt: formatAmount, click: 'investors', rowGroup: 1, descKey: 'lpSubDesc' },
                    { label: '投资人实缴', key: 'paidin', fmt: formatAmount, click: 'investors', rowGroup: 1, descKey: 'paidinDesc' },
                    { label: '投资人分配', key: 'distribution', fmt: formatAmount, click: 'investors', rowGroup: 1, descKey: 'distributionDesc' },
                    { label: 'TVPI', key: 'tvpi', fmt: formatRatio, click: 'fundPerformance', rowGroup: 2, descKey: 'tvpiDesc' },
                    { label: 'DPI', key: 'dpi', fmt: formatRatio, click: 'fundPerformance', rowGroup: 2, descKey: 'dpiDesc' },
                    { label: 'RVPI', key: 'rvpi', fmt: formatRatio, click: 'fundPerformance', rowGroup: 2, descKey: 'rvpiDesc' },
                    { label: 'NIRR', key: 'nirr', fmt: formatPercent, click: 'fundPerformance', rowGroup: 2, descKey: 'nirrDesc' },
                    { label: '投资金额认缴', key: 'sub_amount', fmt: formatAmount, click: 'fundPortfolio', rowGroup: 3, descKey: 'subAmountInvDesc' },
                    { label: '投资金额实缴', key: 'inv_amount', fmt: formatAmount, click: 'fundPortfolio', rowGroup: 3, descKey: 'invAmountDesc' },
                    { label: '退出金额', key: 'exit_amount', fmt: formatAmount, click: 'fundPortfolio', rowGroup: 3, descKey: 'exitAmountDesc' },
                    { label: 'GIRR', key: 'girr', fmt: formatPercent, click: 'projectCashflow', rowGroup: 4, descKey: 'girrDesc' },
                    { label: 'MOC', key: 'moc', fmt: formatRatio, click: 'projectCashflow', rowGroup: 4, descKey: 'mocDesc' },
                  ].map(row => (
                    <tr key={row.key} className={`perf-indicator-row perf-row-group-${row.rowGroup}`}>
                      <td className="perf-sticky-col">
                        <IndicatorLabel label={row.label} desc={systemConfig?.[row.descKey]} />
                      </td>
                      {(fundsData.funds || []).map(fund => (
                        <td
                          key={fund}
                          className="perf-clickable-cell"
                          onClick={() => openModal(row.click, fund)}
                        >
                          {row.fmt(fundsData.indicators[fund]?.[row.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 投资组合 */}
          <PortfolioSection
            funds={fundsData.funds || []}
            portfolioFunds={portfolioData.funds || []}
            overall={portfolioData.overall}
            config={systemConfig}
            onFundPortfolio={(fund) => openModal('fundPortfolio', fund)}
            onPortfolioDetail={() => openModal('portfolioDetail')}
          />

          {/* 底层资产 */}
          <UnderlyingSection
            data={underlyingData}
            config={systemConfig}
            onCompanies={(type) => openModal('underlyingCompanies', null, type)}
            onIpo={(type) => openModal('ipoCompanies', null, type)}
            onRegion={(type) => openModal('regionCompanies', null, type)}
          />
        </>
      )}

      {/* 数据弹窗 */}
      {modal.type && !['versionUpdate', 'share'].includes(modal.type) && (
        <Modal
          className="perf-data-modal"
          title={
            ['underlyingCompanies', 'ipoCompanies', 'regionCompanies'].includes(modal.type) && systemConfig.redirectUrl ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingRight: 8 }}>
                <span>{getModalTitle()}</span>
                <a href={systemConfig.redirectUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-6)', fontSize: 14 }}>详细报表</a>
              </div>
            ) : getModalTitle()
          }
          visible={!!modal.type}
          onCancel={closeModal}
          footer={null}
          style={{
            width: ['managerFunds', 'investors', 'fundPerformance', 'fundPortfolio', 'portfolioDetail', 'projectCashflow', 'underlyingCompanies', 'ipoCompanies', 'regionCompanies'].includes(modal.type) ? 1125 : 900,
            ...(['investors', 'fundPerformance', 'fundPortfolio', 'portfolioDetail', 'projectCashflow', 'underlyingCompanies', 'ipoCompanies', 'regionCompanies'].includes(modal.type) ? { maxHeight: '75vh', paddingBottom: 0, overflow: 'hidden' } : {})
          }}
          bodyStyle={['investors', 'fundPerformance', 'fundPortfolio', 'portfolioDetail', 'projectCashflow', 'underlyingCompanies', 'ipoCompanies', 'regionCompanies'].includes(modal.type)
            ? { height: 'calc(75vh - 56px)', maxHeight: 'calc(75vh - 56px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: 0, minHeight: 0 }
            : undefined}
        >
          {renderModalContent()}
          {exportableModals.includes(modal.type) && !['managerFunds', 'investors', 'fundPerformance'].includes(modal.type) && (
            <div className="perf-modal-footer">
              <Button
                type="primary"
                className="perf-export-btn"
                icon={<IconDownload />}
                onClick={() => handleExport(modal.type, modal.fund)}
              >
                导出底稿
              </Button>
            </div>
          )}
        </Modal>
      )}

      {/* 数据版本更新弹窗：选择月份、预览版本、更新数据 */}
      {modal.type === 'versionUpdate' && (
        <Modal
          className="perf-data-modal"
          title="数据版本更新"
          visible
          onCancel={closeModal}
          footer={null}
          style={{ width: 640 }}
          afterClose={() => setVersionUpdateMonths([{ value: new Date() }])}
        >
          <div style={{ padding: '16px 0' }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, color: '#1d2129', fontWeight: 500 }}>选择月份</div>
              {versionUpdateMonths.map((item, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <MonthYearPicker
                    value={item.value}
                    onChange={(v) => {
                      const next = versionUpdateMonths.map((m, i) =>
                        i === index ? { value: v || null } : m
                      )
                      setVersionUpdateMonths(next)
                    }}
                    placeholder="选择年月"
                  />
                  {versionUpdateMonths.length > 1 && (
                    <Button type="text" status="danger" icon={<IconDelete />} onClick={() => setVersionUpdateMonths(versionUpdateMonths.filter((_, i) => i !== index))} />
                  )}
                </div>
              ))}
              {versionUpdateMonths.length < 6 && (
                <Button type="dashed" long onClick={() => setVersionUpdateMonths([...versionUpdateMonths, { value: null }])}>
                  <IconPlus style={{ marginRight: 6 }} />
                  添加月份
                </Button>
              )}
            </div>
            {(() => {
              const previewList = versionUpdateMonths
                .map((item) => getLastDayOfMonth(item.value))
                .filter(Boolean)
                .map((dateStr) => {
                  const existing = versionUpdateExisting[dateStr]
                  let versionNum = '01'
                  if (existing && existing.maxVersion) {
                    const match = existing.maxVersion.match(/V(\d+)$/)
                    if (match) versionNum = String(parseInt(match[1], 10) + 1).padStart(2, '0')
                  }
                  const version = `${dateStr.replace(/-/g, '')}V${versionNum}`
                  return { date: dateStr, version, existing: !!existing }
                })
              if (previewList.length === 0) return null
              return (
                <div style={{ background: '#f7f8fa', borderRadius: 6, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontWeight: 500, color: '#1d2129', marginBottom: 12 }}>即将生成的版本：</div>
                  {previewList.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: i < previewList.length - 1 ? '1px solid #e5e6eb' : 'none' }}>
                      <span style={{ color: '#4e5969', width: 120 }}>{p.date}</span>
                      <span style={{ fontWeight: 500, color: '#165dff' }}>{p.version}</span>
                      {p.existing && <span style={{ color: '#86909c', fontSize: 13 }}>（已有版本，将生成新版本）</span>}
                    </div>
                  ))}
                </div>
              )
            })()}
            <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={closeModal}>取消</Button>
              <Button
                type="primary"
                loading={versionUpdateSubmitting}
                onClick={async () => {
                  const months = versionUpdateMonths
                    .map((item) => getLastDayOfMonth(item.value))
                    .filter(Boolean)
                  if (months.length === 0) {
                    Message.warning('请至少选择一个月份')
                    return
                  }
                  setVersionUpdateSubmitting(true)
                  try {
                    const res = await performanceApi.createVersion({ date: months[0], months })
                    if (res.data.success) {
                      Message.success('版本创建成功')
                      loadDates()
                      closeModal()
                    } else {
                      Message.error(res.data.message || '版本创建失败')
                    }
                  } catch (e) {
                    console.error(e)
                    Message.error('版本创建失败')
                  } finally {
                    setVersionUpdateSubmitting(false)
                  }
                }}
              >
                更新数据
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 分享弹窗（简化版） */}
      {modal.type === 'share' && (
        <Modal
          className="perf-data-modal"
          title="分享业绩看板"
          visible
          onCancel={closeModal}
          onOk={async () => {
            try {
              const res = await performanceApi.createShare({ version: selectedVersion })
              if (res.data.success) {
                const shareUrl = window.location.origin + res.data.data.shareUrl
                navigator.clipboard.writeText(shareUrl)
                Message.success('分享链接已复制：' + shareUrl)
                closeModal()
              }
            } catch (error) {
              Message.error('创建分享链接失败')
            }
          }}
          style={{ width: 500 }}
        >
          <p>将当前版本 <strong>{selectedVersion}</strong> 的业绩看板分享给第三方查看。</p>
          <p>点击确定将生成分享链接并复制到剪贴板。</p>
        </Modal>
      )}
    </div>
  )
}

export default PerformanceApp
