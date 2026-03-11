/**
 * 业绩看板应用 - 分享页面（与主页面完全一致）
 * 业绩看板应用扩展
 * 复用 PerformanceApp 的完整结构和样式
 */
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from '../utils/axios'
import { Spin, Card, Typography, Message, Button, Input, Tooltip } from '@arco-design/web-react'
import { IconDownload, IconLock, IconRefresh } from '@arco-design/web-react/icon'
import '../pages/业绩看板应用/PerformanceApp.css'

const { Title, Text } = Typography

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

// 工具函数 - 格式化百分比（NIRR/GIRR）
const formatPercent = (val) => {
  const n = toNum(val)
  if (n === null) return '/'
  if (n === 0) return '-'
  return (n * 100).toFixed(2) + '%'
}

// 版本日期格式化
const formatVersionDate = (version) => {
  if (!version) return ''
  const d = version.substring(0, 8)
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`
}

// 指标标签：当有说明时在右上角显示 info 图标
function IndicatorLabel({ label, desc }) {
  if (!desc || String(desc).trim() === '') {
    return label
  }
  return (
    <span className="perf-indicator-label-wrap">
      {label}
      <Tooltip content={desc} position="top">
        <span className="perf-indicator-desc-icon">
          <span style={{ fontSize: 12, color: '#86909c' }}>ⓘ</span>
        </span>
      </Tooltip>
    </span>
  )
}

// 管理人指标卡
function ManagerCard({ data, config }) {
  const items = [
    { label: '母基金数量', value: formatNumber(data?.fofNum), sub: (data?.fofSinceYear != null && data?.fofSinceYear !== '') ? `自${data.fofSinceYear}年起` : (config?.fofNumDesc || ''), descKey: 'fofNumDesc' },
    { label: '直投基金数量', value: formatNumber(data?.directNum), sub: (data?.directSinceYear != null && data?.directSinceYear !== '') ? `自${data.directSinceYear}年起` : (config?.directNumDesc || ''), descKey: 'directNumDesc' },
    { label: '认缴管理规模', value: formatAmount(data?.subAmount), change: data?.subAdd, subLabel: '较上月增加', valueRed: true, descKey: 'subAmountDesc' },
    { label: '实缴管理规模', value: formatAmount(data?.paidInAmount), change: data?.paidInAdd, subLabel: '较上月增加', valueRed: true, descKey: 'paidInAmountDesc' },
    { label: '累计分配总额', value: formatAmount(data?.disAmount), change: data?.disAdd, subLabel: '较上月增加', valueRed: true, descKey: 'disAmountDesc' },
  ]

  return (
    <div className="perf-section">
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

// 投资组合板块
function PortfolioSection({ funds, portfolioFunds, overall, config }) {
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
                      <td key={`${fund}-投`} className="perf-invest-cell">{row ? s.fmt(row[s.keyInvest]) : '-'}</td>,
                      <td key={`${fund}-退`} className="perf-exit-cell">{row ? s.fmt(row[s.keyExit]) : '-'}</td>,
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
                      <td key={`${fund}-投`} className="perf-invest-cell">{row ? s.fmt(row[s.keyInvest]) : '-'}</td>,
                      <td key={`${fund}-退`} className="perf-exit-cell">{row ? s.fmt(row[s.keyExit]) : '-'}</td>,
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
                  <div key={idx} className="perf-indicator-item">
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
                  <div key={idx} className="perf-indicator-item">
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

// 底层资产板块
function UnderlyingSection({ data, config }) {
  const cumulative = data?.cumulative
  const current = data?.current

  const renderCard = (label, val1, sub1, val2, sub2, key, desc) => (
    <div key={key} className="perf-underlying-item">
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
    { label: '底层资产/数量', v1: formatNumber(cumulative?.project_num_a), s1: '项目数量', v2: formatNumber(cumulative?.company_num_a), s2: '企业数量', descKey: 'projectNumADesc' },
    { label: '底层资产/金额', v1: formatAmount(cumulative?.total_amount_a), s1: '投资金额', v2: formatAmount(cumulative?.ct_amount_a), s2: '穿透成本', descKey: 'totalAmountADesc' },
    { label: '上市企业', v1: formatNumber(cumulative?.ipo_num_a), s1: '数量', v2: formatAmount(cumulative?.ipo_amount_a), s2: '投资金额', descKey: 'ipoNumADesc' },
    { label: '上海地区企业', v1: formatNumber(cumulative?.sh_num_a), s1: '数量', v2: formatAmount(cumulative?.sh_amount_a), s2: '投资金额', descKey: 'shNumADesc' },
  ]
  const currentCards = [
    { label: '底层资产/数量', v1: formatNumber(current?.project_num), s1: '项目数量', v2: formatNumber(current?.company_num), s2: '企业数量', descKey: 'projectNumDesc' },
    { label: '底层资产/金额', v1: formatAmount(current?.total_amount), s1: '投资金额', v2: formatAmount(current?.ct_amount), s2: '穿透成本', descKey: 'totalAmountDesc' },
    { label: '上市企业', v1: formatNumber(current?.ipo_num), s1: '数量', v2: formatAmount(current?.ipo_amount), s2: '投资金额', descKey: 'ipoNumDesc' },
    { label: '上海地区企业', v1: formatNumber(current?.sh_num), s1: '数量', v2: formatAmount(current?.sh_amount), s2: '投资金额', descKey: 'shNumDesc' },
  ]

  return (
    <div className="perf-section">
      <div className="perf-section-title">底层资产</div>
      <div className="perf-underlying-rows">
        <div className="perf-underlying-row">
          <div className="perf-underlying-label perf-underlying-label-cumulative">累计组合</div>
          <div className="perf-underlying-cards">
            {cumulativeCards.map((c, i) => renderCard(c.label, c.v1, c.s1, c.v2, c.s2, `cum-${i}`, config?.[c.descKey]))}
          </div>
        </div>
        <div className="perf-underlying-row">
          <div className="perf-underlying-label perf-underlying-label-current">当前组合</div>
          <div className="perf-underlying-cards">
            {currentCards.map((c, i) => renderCard(c.label, c.v1, c.s1, c.v2, c.s2, `cur-${i}`, config?.[c.descKey]))}
          </div>
        </div>
      </div>
      <div className="perf-underlying-footnote">
        注：底层资产与穿透数据为上月数据源，所显示数据为回顾时点数据较上月末数据。
      </div>
    </div>
  )
}

// API 请求函数
const performanceApi = {
  getManagerIndicator: (version) => axios.get(`/api/performance/dashboard/manager?version=${encodeURIComponent(version)}`),
  getFunds: (version) => axios.get(`/api/performance/dashboard/funds?version=${encodeURIComponent(version)}`),
  getPortfolio: (version) => axios.get(`/api/performance/dashboard/portfolio?version=${encodeURIComponent(version)}`),
  getUnderlying: (version) => axios.get(`/api/performance/dashboard/underlying?version=${encodeURIComponent(version)}`),
  getIndicators: () => axios.get('/api/performance/config/indicators'),
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

function PerformanceSharePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')

  // 分享信息
  const [shareInfo, setShareInfo] = useState(null)

  // 业绩看板数据
  const [managerData, setManagerData] = useState(null)
  const [fundsData, setFundsData] = useState({ funds: [], indicators: {} })
  const [portfolioData, setPortfolioData] = useState({ funds: [], overall: null })
  const [underlyingData, setUnderlyingData] = useState({ cumulative: null, current: null })
  const [systemConfig, setSystemConfig] = useState({})

  // 密码验证状态
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // 验证分享链接
  useEffect(() => {
    verifyShareToken(token)
  }, [token])

  const verifyShareToken = async (shareToken, pwd) => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ token: shareToken })
      if (pwd) params.set('password', pwd)
      const res = await axios.get(`/api/performance/share/verify?${params.toString()}`)

      if (res.data.success) {
        const info = res.data.data
        setShareInfo(info)

        if (info.hasPassword && !pwd) {
          setShowPasswordModal(true)
        } else {
          loadDashboardData(info.version)
        }
      } else {
        setError(res.data.message || '分享链接无效或已过期')
      }
    } catch (err) {
      console.error('验证分享链接失败:', err)
      setError('分享链接验证失败：' + (err.message || '网络错误'))
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordSubmit = async () => {
    if (!password.trim()) {
      setPasswordError('请输入密码')
      return
    }

    try {
      const res = await axios.get(
        `/api/performance/share/verify?${new URLSearchParams({ token, password }).toString()}`
      )
      if (res.data.success) {
        setShowPasswordModal(false)
        setVerified(true)
        loadDashboardData(shareInfo.version)
      } else {
        setPasswordError(res.data.message || '密码错误')
      }
    } catch (err) {
      setPasswordError('密码验证失败')
    }
  }

  const loadDashboardData = async (version) => {
    try {
      setLoading(true)

      // 加载系统配置
      const configRes = await performanceApi.getIndicators()
      if (configRes.data?.success) {
        setSystemConfig(configRes.data.data || {})
      }

      // 加载管理人指标
      const managerRes = await performanceApi.getManagerIndicator(version)
      if (managerRes.data?.success) {
        setManagerData(managerRes.data.data)
      }

      // 加载基金列表
      const fundsRes = await performanceApi.getFunds(version)
      if (fundsRes.data?.success) {
        setFundsData(fundsRes.data.data || { funds: [], indicators: {} })
      }

      // 加载投资组合
      const portfolioRes = await performanceApi.getPortfolio(version)
      if (portfolioRes.data?.success) {
        setPortfolioData(portfolioRes.data.data || { funds: [], overall: null })
      }

      // 加载底层资产
      const underlyingRes = await performanceApi.getUnderlying(version)
      if (underlyingRes.data?.success) {
        setUnderlyingData(underlyingRes.data.data || { cumulative: null, current: null })
      }

      setVerified(true)
    } catch (err) {
      console.error('加载业绩看板数据失败:', err)
      setError('加载数据失败：' + (err.message || '网络错误'))
    } finally {
      setLoading(false)
    }
  }

  // 刷新数据版本
  const handleRefresh = () => {
    if (shareInfo?.version) {
      Message.loading('正在刷新数据...')
      loadDashboardData(shareInfo.version).then(() => {
        Message.success('数据已刷新')
      }).catch(() => {
        Message.error('刷新失败')
      })
    }
  }

  // 导出功能
  const handleExport = async (type) => {
    if (!shareInfo?.canExport) {
      Message.error('当前分享链接未开启导出权限')
      return
    }
    try {
      Message.loading('正在生成导出文件...')
      const version = shareInfo.version
      let res, filename
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '')

      switch (type) {
        case 'managerFunds':
          res = await performanceApi.exportManagerFunds(version)
          filename = `${version}-在管产品清单-${date}.xlsx`
          break
        case 'portfolioDetail':
          res = await performanceApi.exportPortfolioDetail(version)
          filename = `${version}-整体基金投资组合明细-${date}.xlsx`
          break
        case 'ipoCompanies':
          res = await performanceApi.exportIpoCompanies(version, 'cumulative')
          filename = `${version}-上市企业明细-${date}.xlsx`
          break
        default:
          Message.error('未知导出类型')
          return
      }
      downloadFile(res.data, filename)
      Message.success('导出成功')
    } catch (err) {
      console.error('导出失败:', err)
      Message.error('导出失败：' + (err.message || '请重试'))
    }
  }

  if (loading && !verified) {
    return (
      <div className="perf-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="perf-app" style={{ padding: 40 }}>
        <Card style={{ maxWidth: 600, margin: '0 auto' }}>
          <Title heading={3} style={{ color: '#f53f3f' }}>❌ 访问失败</Title>
          <Text type="danger">{error}</Text>
          <div style={{ marginTop: 20 }}>
            <Button type="primary" onClick={() => navigate('/login')}>返回首页</Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!verified && showPasswordModal) {
    return (
      <div className="perf-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Card style={{ width: 400 }}>
          <Title heading={4}>🔐 需要密码</Title>
          <Text type="secondary">该分享链接设置了访问密码，请输入密码继续。</Text>

          <div style={{ marginTop: 20 }}>
            <Input.Password
              placeholder="请输入密码"
              value={password}
              onChange={(v) => setPassword(v)}
              onPressEnter={handlePasswordSubmit}
              style={{ marginBottom: passwordError ? 8 : 0 }}
            />
            {passwordError && <Text type="danger" style={{ fontSize: 12 }}>{passwordError}</Text>}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <Button type="primary" block onClick={handlePasswordSubmit}>确定</Button>
              <Button block onClick={() => navigate('/login')}>取消</Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="perf-app">
      {/* 系统标题 */}
      <div className="perf-system-header">
        <h1 className="perf-system-name">{systemConfig.systemName || '业绩看板'}</h1>
        <div className="perf-system-info">
          截至：{formatVersionDate(shareInfo?.version)} 金额单位：亿元
        </div>
      </div>

      {/* 工具栏 */}
      <div className="perf-toolbar">
        <div className="perf-toolbar-left">
          <span className="perf-toolbar-desc">
            数据版本：{shareInfo?.version}
          </span>
        </div>
        <div className="perf-toolbar-right">
          <Button
            type="primary"
            icon={<IconRefresh />}
            onClick={handleRefresh}
          >
            刷新数据
          </Button>
          {shareInfo?.canExport && (
            <Button
              type="primary"
              icon={<IconDownload />}
              onClick={() => handleExport('managerFunds')}
            >
              导出在管产品清单
            </Button>
          )}
          {shareInfo?.canExport && (
            <Button
              type="primary"
              icon={<IconDownload />}
              onClick={() => handleExport('portfolioDetail')}
            >
              导出投资组合
            </Button>
          )}
          <Button onClick={() => window.close()}>关闭页面</Button>
        </div>
      </div>

      {/* 管理人指标卡 */}
      {managerData && (
        <ManagerCard data={managerData} config={systemConfig} />
      )}

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
                { label: '投资人认缴', key: 'lp_sub', fmt: formatAmount, rowGroup: 1, descKey: 'lpSubDesc' },
                { label: '投资人实缴', key: 'paidin', fmt: formatAmount, rowGroup: 1, descKey: 'paidinDesc' },
                { label: '投资人分配', key: 'distribution', fmt: formatAmount, rowGroup: 1, descKey: 'distributionDesc' },
                { label: 'TVPI', key: 'tvpi', fmt: formatRatio, rowGroup: 2, descKey: 'tvpiDesc' },
                { label: 'DPI', key: 'dpi', fmt: formatRatio, rowGroup: 2, descKey: 'dpiDesc' },
                { label: 'RVPI', key: 'rvpi', fmt: formatRatio, rowGroup: 2, descKey: 'rvpiDesc' },
                { label: 'NIRR', key: 'nirr', fmt: formatPercent, rowGroup: 2, descKey: 'nirrDesc' },
                { label: '投资金额认缴', key: 'sub_amount', fmt: formatAmount, rowGroup: 3, descKey: 'subAmountInvDesc' },
                { label: '投资金额实缴', key: 'inv_amount', fmt: formatAmount, rowGroup: 3, descKey: 'invAmountDesc' },
                { label: '退出金额', key: 'exit_amount', fmt: formatAmount, rowGroup: 3, descKey: 'exitAmountDesc' },
                { label: 'GIRR', key: 'girr', fmt: formatPercent, rowGroup: 4, descKey: 'girrDesc' },
                { label: 'MOC', key: 'moc', fmt: formatRatio, rowGroup: 4, descKey: 'mocDesc' },
              ].map(row => (
                <tr key={row.key} className={`perf-indicator-row perf-row-group-${row.rowGroup}`}>
                  <td className="perf-sticky-col">
                    <IndicatorLabel label={row.label} desc={systemConfig?.[row.descKey]} />
                  </td>
                  {(fundsData.funds || []).map(fund => (
                    <td key={fund}>
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
      />

      {/* 底层资产 */}
      <UnderlyingSection
        data={underlyingData}
        config={systemConfig}
      />

      {/* 提示信息 */}
      <Card style={{ marginTop: 24, background: '#e6f7ff', border: '1px solid #91d5ff' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          ℹ️ 本页面为分享页面，数据版本：{shareInfo?.version}。如需查看完整功能，请联系管理员获取系统访问权限。
        </Text>
      </Card>
    </div>
  )
}

export default PerformanceSharePage
