import { useCallback, useEffect, useMemo, useState } from 'react'
import { DotLoading, Picker, Tabs, Toast } from 'antd-mobile'
import { DownOutline, LoopOutline, RightOutline } from 'antd-mobile-icons'
import PageHeader from '../components/PageHeader'
import PerformanceDrillPopup from '../components/PerformanceDrillPopup'
import axios from '../utils/axios'
import { hasPerformancePermission } from '../utils/auth'
import {
  formatAmountYi,
  formatNumber,
  formatPercent,
  formatRatio,
  formatSignedYi
} from '../utils/performanceFormat'

const SECTION_TABS = [
  { key: 'manager', title: '管理人' },
  { key: 'funds', title: '基金产品' },
  { key: 'portfolio', title: '投资组合' },
  { key: 'underlying', title: '底层资产' }
]

function MetricGrid({ items, onItemClick }) {
  return (
    <div className="h5-perf__grid">
      {items.map((item) => {
        const clickable = !!(item.drill && onItemClick)
        return (
          <button
            key={item.label}
            type="button"
            className={`h5-perf__metric${clickable ? ' h5-perf__metric--clickable' : ''}`}
            onClick={clickable ? () => onItemClick(item.drill) : undefined}
            disabled={!clickable}
          >
            <div className="h5-perf__metric-label">
              {item.label}
              {clickable ? <RightOutline fontSize={12} className="h5-perf__metric-chevron" /> : null}
            </div>
            <div className={`h5-perf__metric-value${item.accent ? ' h5-perf__metric-value--accent' : ''}`}>
              {item.value}
            </div>
            {item.sub ? <div className="h5-perf__metric-sub">{item.sub}</div> : null}
          </button>
        )
      })}
    </div>
  )
}

function SectionPanel({ title, action, hint, children }) {
  return (
    <div className="h5-detail__block h5-perf__section">
      <div className="h5-perf__section-head">
        <h4>{title}</h4>
        {action || null}
      </div>
      {hint ? <p className="h5-perf__section-hint">{hint}</p> : null}
      {children}
    </div>
  )
}

function SelectField({ label, value, placeholder, onClick, disabled }) {
  return (
    <button
      type="button"
      className="h5-perf__select"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="h5-perf__select-label">{label}</span>
      <span className={`h5-perf__select-value${!value ? ' h5-perf__select-value--placeholder' : ''}`}>
        {value || placeholder}
      </span>
      <DownOutline fontSize={14} className="h5-perf__select-arrow" />
    </button>
  )
}

export default function PerformanceBoard() {
  const canAccess = hasPerformancePermission()
  const [dates, setDates] = useState([])
  const [versions, setVersions] = useState([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedVersion, setSelectedVersion] = useState('')
  const [board, setBoard] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingBoard, setLoadingBoard] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [datePickerVisible, setDatePickerVisible] = useState(false)
  const [versionPickerVisible, setVersionPickerVisible] = useState(false)
  const [sectionTab, setSectionTab] = useState('manager')
  const [underlyingTab, setUnderlyingTab] = useState('cumulative')
  const [portfolioTab, setPortfolioTab] = useState('project')
  const [canOpenModal, setCanOpenModal] = useState(true)
  const [drill, setDrill] = useState({ type: null, fund: null, modalType: null })

  const loadPermissions = useCallback(async () => {
    try {
      const res = await axios.get('/api/performance/permissions')
      if (res.data?.success && res.data.data && res.data.data.canOpenModal != null) {
        setCanOpenModal(!!res.data.data.canOpenModal)
      }
    } catch {
      /* 权限接口失败时仍允许尝试下钻 */
    }
  }, [])

  const loadDates = useCallback(async () => {
    if (!canAccess) return
    setLoadingMeta(true)
    try {
      const res = await axios.get('/api/h5/performance/dates')
      if (!res.data?.success) {
        Toast.show({ content: res.data?.message || '加载日期失败', position: 'bottom' })
        return
      }
      setForbidden(false)
      const list = res.data.data?.dates || []
      setDates(list)
      setSelectedDate((prev) => prev || list[0] || '')
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true)
      else {
        Toast.show({
          content: err.response?.data?.message || '加载日期失败',
          position: 'bottom'
        })
      }
    } finally {
      setLoadingMeta(false)
    }
  }, [canAccess])

  const loadVersions = useCallback(
    async (date) => {
      if (!canAccess || !date) {
        setVersions([])
        setSelectedVersion('')
        return
      }
      setLoadingMeta(true)
      try {
        const res = await axios.get('/api/h5/performance/versions', { params: { date } })
        if (!res.data?.success) {
          Toast.show({ content: res.data?.message || '加载版本失败', position: 'bottom' })
          return
        }
        const list = res.data.data?.versions || []
        setVersions(list)
        setSelectedVersion(list[0]?.version || '')
      } catch (err) {
        if (err.response?.status === 403) setForbidden(true)
        else {
          Toast.show({
            content: err.response?.data?.message || '加载版本失败',
            position: 'bottom'
          })
        }
        setVersions([])
        setSelectedVersion('')
      } finally {
        setLoadingMeta(false)
      }
    },
    [canAccess]
  )

  const loadBoard = useCallback(
    async (version) => {
      if (!canAccess || !version) {
        setBoard(null)
        return
      }
      setLoadingBoard(true)
      try {
        const res = await axios.get('/api/h5/performance/board', { params: { version } })
        if (!res.data?.success) {
          Toast.show({ content: res.data?.message || '加载看板失败', position: 'bottom' })
          setBoard(null)
          return
        }
        setForbidden(false)
        setBoard(res.data.data || null)
      } catch (err) {
        if (err.response?.status === 403) setForbidden(true)
        else {
          Toast.show({
            content: err.response?.data?.message || '加载看板失败',
            position: 'bottom'
          })
        }
        setBoard(null)
      } finally {
        setLoadingBoard(false)
      }
    },
    [canAccess]
  )

  useEffect(() => {
    loadDates()
    loadPermissions()
  }, [loadDates, loadPermissions])

  useEffect(() => {
    if (selectedDate) loadVersions(selectedDate)
  }, [selectedDate, loadVersions])

  useEffect(() => {
    if (selectedVersion) loadBoard(selectedVersion)
  }, [selectedVersion, loadBoard])

  const dateColumns = useMemo(
    () => [dates.map((d) => ({ label: d, value: d }))],
    [dates]
  )
  const versionColumns = useMemo(
    () => [versions.map((v) => ({ label: v.version, value: v.version }))],
    [versions]
  )

  const openDrill = useCallback(
    (type, fund = null, modalType = null) => {
      if (!canOpenModal) {
        Toast.show({
          content: '当前会员等级不可查看明细，如需查看请升级会员',
          position: 'bottom'
        })
        return
      }
      if (!selectedVersion) {
        Toast.show({ content: '请先选择版本', position: 'bottom' })
        return
      }
      setDrill({ type, fund, modalType })
    },
    [canOpenModal, selectedVersion]
  )

  const closeDrill = () => setDrill({ type: null, fund: null, modalType: null })

  const manager = board?.manager
  const funds = board?.funds
  const overall = board?.portfolio?.overall
  const underlying = board?.underlying

  const managerItems = useMemo(() => {
    if (!manager) return []
    return [
      {
        label: '母基金数量',
        value: formatNumber(manager.fofNum),
        sub: manager.fofSinceYear != null ? `自${manager.fofSinceYear}年起` : null,
        drill: { type: 'managerFunds' }
      },
      {
        label: '直投基金数量',
        value: formatNumber(manager.directNum),
        sub: manager.directSinceYear != null ? `自${manager.directSinceYear}年起` : null,
        drill: { type: 'managerFunds' }
      },
      { label: '备案SPV数量', value: formatNumber(manager.spvNum), drill: { type: 'managerFunds' } },
      {
        label: '认缴管理规模(亿)',
        value: formatAmountYi(manager.subAmount),
        sub: `较上月 ${formatSignedYi(manager.subAdd)}`,
        accent: true,
        drill: { type: 'managerFunds' }
      },
      {
        label: '实缴管理规模(亿)',
        value: formatAmountYi(manager.paidInAmount),
        sub: `较上月 ${formatSignedYi(manager.paidInAdd)}`,
        accent: true,
        drill: { type: 'managerFunds' }
      },
      {
        label: '累计分配总额(亿)',
        value: formatAmountYi(manager.disAmount),
        sub: `较上月 ${formatSignedYi(manager.disAdd)}`,
        accent: true,
        drill: { type: 'managerFunds' }
      }
    ]
  }, [manager])

  /**
   * 基金产品列表层两组指标（与 PC 下钻对齐）：
   * 投资人相关 → 投资人名录 / 基金业绩；项目相关 → 投资组合 / 项目现金流
   */
  const fundCards = useMemo(() => {
    const names = funds?.funds || []
    const indicators = funds?.indicators || {}
    return names.map((name) => {
      const row = indicators[name] || {}
      return {
        name,
        groups: [
          {
            key: 'investor',
            title: '投资人相关',
            primaryDrill: { type: 'investors', fund: name },
            primaryLabel: '投资人名录',
            metrics: [
              {
                label: '投资人认缴',
                value: formatAmountYi(row.lp_sub),
                unit: '亿',
                drill: { type: 'investors', fund: name }
              },
              {
                label: '投资人实缴',
                value: formatAmountYi(row.paidin),
                unit: '亿',
                drill: { type: 'investors', fund: name }
              },
              {
                label: '投资人分配',
                value: formatAmountYi(row.distribution),
                unit: '亿',
                drill: { type: 'investors', fund: name }
              },
              {
                label: 'TVPI',
                value: formatRatio(row.tvpi),
                drill: { type: 'fundPerformance', fund: name }
              },
              {
                label: 'DPI',
                value: formatRatio(row.dpi),
                drill: { type: 'fundPerformance', fund: name }
              },
              {
                label: 'RVPI',
                value: formatRatio(row.rvpi),
                drill: { type: 'fundPerformance', fund: name }
              },
              {
                label: 'NIRR',
                value: formatPercent(row.nirr),
                drill: { type: 'fundPerformance', fund: name }
              }
            ]
          },
          {
            key: 'project',
            title: '项目相关',
            primaryDrill: { type: 'fundPortfolio', fund: name },
            primaryLabel: '基金投资组合',
            metrics: [
              {
                label: '投资金额/认缴',
                value: formatAmountYi(row.sub_amount),
                unit: '亿',
                drill: { type: 'fundPortfolio', fund: name }
              },
              {
                label: '投资金额/实缴',
                value: formatAmountYi(row.inv_amount),
                unit: '亿',
                drill: { type: 'fundPortfolio', fund: name }
              },
              {
                label: '退出金额',
                value: formatAmountYi(row.exit_amount),
                unit: '亿',
                drill: { type: 'fundPortfolio', fund: name }
              },
              {
                label: 'GIRR',
                value: formatPercent(row.girr),
                drill: { type: 'projectCashflow', fund: name }
              },
              {
                label: 'MOC',
                value: formatRatio(row.moc),
                drill: { type: 'projectCashflow', fund: name }
              }
            ]
          }
        ]
      }
    })
  }, [funds])

  const projectItems = useMemo(() => {
    if (!overall) return []
    return [
      {
        label: '累计投资项目数',
        value: formatNumber(overall.project_inv),
        sub: `较上月 ${formatNumber(overall.project_inv_change)}`,
        drill: { type: 'portfolioDetail', modalType: 'directOnly' }
      },
      {
        label: '累计退出项目数',
        value: formatNumber(overall.project_exit),
        sub: `较上月 ${formatNumber(overall.project_exit_change)}`,
        drill: { type: 'portfolioDetail', modalType: 'directOnly' }
      },
      {
        label: '累计投资金额(亿)',
        value: formatAmountYi(overall.project_paidin),
        sub: `较上月 ${formatSignedYi(overall.project_paidin_change)}`,
        accent: true,
        drill: { type: 'portfolioDetail', modalType: 'directOnly' }
      },
      {
        label: 'SPV累计投资(亿)',
        value: formatAmountYi(overall.spv_paidin),
        sub: `较上月 ${formatSignedYi(overall.spv_paidin_change)}`,
        drill: { type: 'spvDetail' }
      },
      {
        label: '累计回款金额(亿)',
        value: formatAmountYi(overall.project_receive),
        sub: `较上月 ${formatSignedYi(overall.project_receive_change)}`,
        accent: true,
        drill: { type: 'portfolioDetail', modalType: 'directOnly' }
      },
      {
        label: '在持剩余成本(亿)',
        value: formatAmountYi(overall.rest_cost_h),
        sub: `较上月 ${formatSignedYi(overall.rest_cost_h_change)}`,
        drill: { type: 'portfolioDetail', modalType: 'directOnly' }
      },
      {
        label: '在持剩余价值(亿)',
        value: formatAmountYi(overall.unrealized_h),
        sub: `较上月 ${formatSignedYi(overall.unrealized_h_change)}`,
        drill: { type: 'portfolioDetail', modalType: 'directOnly' }
      },
      {
        label: '已上市企业',
        value: formatNumber(overall.ipo_num),
        sub: `成本 ${formatAmountYi(overall.ipo_cost)} 亿`,
        drill: { type: 'listedEnterprises', modalType: '已上市' }
      },
      {
        label: '已受理企业',
        value: formatNumber(overall.sl_num),
        sub: `成本 ${formatAmountYi(overall.sl_cost)} 亿`,
        drill: { type: 'listedEnterprises', modalType: '已受理' }
      },
      {
        label: '已辅导企业',
        value: formatNumber(overall.fd_num),
        sub: `成本 ${formatAmountYi(overall.fd_cost)} 亿`,
        drill: { type: 'listedEnterprises', modalType: '辅导备案' }
      }
    ]
  }, [overall])

  const fundPortfolioItems = useMemo(() => {
    if (!overall) return []
    return [
      {
        label: '累计认缴(亿)',
        value: formatAmountYi(overall.fund_sub),
        sub: `较上月 ${formatSignedYi(overall.fund_sub_change)}`,
        accent: true,
        drill: { type: 'portfolioDetail' }
      },
      {
        label: '累计实缴(亿)',
        value: formatAmountYi(overall.fund_paidin),
        sub: `较上月 ${formatSignedYi(overall.fund_paidin_change)}`,
        accent: true,
        drill: { type: 'portfolioDetail' }
      },
      {
        label: '累计投资数',
        value: formatNumber(overall.fund_inv),
        sub: `较上月 ${formatNumber(overall.fund_inv_change)}`,
        drill: { type: 'portfolioDetail' }
      },
      {
        label: '累计退出金额(亿)',
        value: formatAmountYi(overall.fund_exit_amount),
        sub: `较上月 ${formatSignedYi(overall.fund_exit_amount_change)}`,
        drill: { type: 'portfolioDetail' }
      },
      {
        label: '累计回款(亿)',
        value: formatAmountYi(overall.fund_receive),
        sub: `较上月 ${formatSignedYi(overall.fund_receive_change)}`,
        drill: { type: 'portfolioDetail' }
      },
      {
        label: '外部认缴(亿)',
        value: formatAmountYi(overall.fund_sub_w),
        sub: `较上月 ${formatSignedYi(overall.fund_sub_change_w)}`,
        drill: { type: 'portfolioDetail', modalType: 'externalSf' }
      },
      {
        label: '外部实缴(亿)',
        value: formatAmountYi(overall.fund_paidin_w),
        sub: `较上月 ${formatSignedYi(overall.fund_paidin_change_w)}`,
        drill: { type: 'portfolioDetail', modalType: 'externalSf' }
      },
      {
        label: '外部回款(亿)',
        value: formatAmountYi(overall.fund_receive_w),
        sub: `较上月 ${formatSignedYi(overall.fund_receive_change_w)}`,
        drill: { type: 'portfolioDetail', modalType: 'externalSf' }
      }
    ]
  }, [overall])

  const underlyingItems = useMemo(() => {
    const src =
      underlyingTab === 'cumulative' ? underlying?.cumulative : underlying?.current
    if (!src) return []
    const t = underlyingTab
    if (t === 'cumulative') {
      return [
        {
          label: '项目数量',
          value: formatNumber(src.project_num_a),
          drill: { type: 'underlyingCompanies', modalType: t }
        },
        {
          label: '企业数量',
          value: formatNumber(src.company_num_a),
          drill: { type: 'underlyingCompanies', modalType: t }
        },
        {
          label: '投资金额(亿)',
          value: formatAmountYi(src.total_amount_a),
          accent: true,
          drill: { type: 'underlyingCompanies', modalType: t }
        },
        {
          label: '穿透成本(亿)',
          value: formatAmountYi(src.ct_amount_a),
          accent: true,
          drill: { type: 'underlyingCompanies', modalType: t }
        },
        {
          label: '上市企业数',
          value: formatNumber(src.ipo_num_a),
          drill: { type: 'ipoCompanies', modalType: t }
        },
        {
          label: '上市穿透成本(亿)',
          value: formatAmountYi(src.ipo_amount_a),
          drill: { type: 'ipoCompanies', modalType: t }
        },
        {
          label: '上海企业数',
          value: formatNumber(src.sh_num_a),
          drill: { type: 'regionCompanies', modalType: t }
        },
        {
          label: '上海投资金额(亿)',
          value: formatAmountYi(src.sh_amount_a),
          drill: { type: 'regionCompanies', modalType: t }
        }
      ]
    }
    return [
      {
        label: '项目数量',
        value: formatNumber(src.project_num),
        drill: { type: 'underlyingCompanies', modalType: t }
      },
      {
        label: '企业数量',
        value: formatNumber(src.company_num),
        drill: { type: 'underlyingCompanies', modalType: t }
      },
      {
        label: '投资金额(亿)',
        value: formatAmountYi(src.total_amount),
        accent: true,
        drill: { type: 'underlyingCompanies', modalType: t }
      },
      {
        label: '穿透成本(亿)',
        value: formatAmountYi(src.ct_amount),
        accent: true,
        drill: { type: 'underlyingCompanies', modalType: t }
      },
      {
        label: '上市企业数',
        value: formatNumber(src.ipo_num),
        drill: { type: 'ipoCompanies', modalType: t }
      },
      {
        label: '上市穿透成本(亿)',
        value: formatAmountYi(src.ipo_amount),
        drill: { type: 'ipoCompanies', modalType: t }
      },
      {
        label: '上海企业数',
        value: formatNumber(src.sh_num),
        drill: { type: 'regionCompanies', modalType: t }
      },
      {
        label: '上海投资金额(亿)',
        value: formatAmountYi(src.sh_amount),
        drill: { type: 'regionCompanies', modalType: t }
      }
    ]
  }, [underlying, underlyingTab])

  const onRefresh = async () => {
    if (selectedVersion) {
      await loadBoard(selectedVersion)
      Toast.show({ content: '已刷新', position: 'bottom' })
    } else {
      await loadDates()
    }
  }

  const handleDrillClick = (d) => {
    if (!d?.type) return
    openDrill(d.type, d.fund || null, d.modalType || null)
  }

  if (!canAccess) {
    return <div className="h5-empty">无「业绩看板」应用权限</div>
  }

  if (forbidden) {
    return <div className="h5-empty">当前账号无业绩看板查看权限</div>
  }

  return (
    <div>
      <div className="h5-filters h5-perf__sticky">
        <PageHeader title="业绩看板" subtitle="分板块查看 · 点指标下钻" />
        <div className="h5-filters__fold-bar" style={{ marginTop: 0 }}>
          <span className="h5-filters__fold-summary">
            {[selectedDate, selectedVersion].filter(Boolean).join(' · ') || '选择日期与版本'}
          </span>
          <div className="h5-perf__fold-actions">
            <button type="button" onClick={() => setFilterExpanded((v) => !v)}>
              {filterExpanded ? '收起' : '切换'}
            </button>
            <button type="button" onClick={onRefresh} disabled={loadingBoard || loadingMeta}>
              <LoopOutline fontSize={16} /> {loadingBoard ? '刷新中' : '刷新'}
            </button>
          </div>
        </div>

        {filterExpanded ? (
          <div className="h5-filters__collapsed-panel h5-perf__filter-panel">
            <SelectField
              label="数据日期"
              value={selectedDate}
              placeholder={loadingMeta ? '加载中…' : '请选择日期'}
              disabled={!dates.length}
              onClick={() => dates.length && setDatePickerVisible(true)}
            />
            <SelectField
              label="版本"
              value={selectedVersion}
              placeholder={
                loadingMeta ? '加载中…' : selectedDate ? '请选择版本' : '请先选日期'
              }
              disabled={!versions.length}
              onClick={() => versions.length && setVersionPickerVisible(true)}
            />
          </div>
        ) : null}

        {board ? (
          <Tabs
            className="h5-perf__section-tabs"
            activeKey={sectionTab}
            onChange={setSectionTab}
          >
            {SECTION_TABS.map((t) => (
              <Tabs.Tab title={t.title} key={t.key} />
            ))}
          </Tabs>
        ) : null}
      </div>

      <Picker
        columns={dateColumns}
        visible={datePickerVisible}
        value={selectedDate ? [selectedDate] : []}
        onClose={() => setDatePickerVisible(false)}
        onConfirm={(val) => {
          const next = val?.[0]
          if (next) setSelectedDate(next)
          setDatePickerVisible(false)
          setFilterExpanded(false)
        }}
      />
      <Picker
        columns={versionColumns}
        visible={versionPickerVisible}
        value={selectedVersion ? [selectedVersion] : []}
        onClose={() => setVersionPickerVisible(false)}
        onConfirm={(val) => {
          const next = val?.[0]
          if (next) setSelectedVersion(next)
          setVersionPickerVisible(false)
          setFilterExpanded(false)
        }}
      />

      <div className="h5-detail" style={{ paddingTop: 8 }}>
        {loadingBoard && !board ? (
          <div className="h5-empty">
            <DotLoading /> 加载看板…
          </div>
        ) : null}

        {!loadingBoard && selectedVersion && !board ? (
          <div className="h5-empty">该版本暂无看板数据</div>
        ) : null}

        {board ? (
          <>
            {sectionTab === 'manager' ? (
              <SectionPanel
                title="管理人指标"
                hint="点击指标查看在管产品清单"
                action={
                  <button
                    type="button"
                    className="h5-perf__section-action"
                    onClick={() => openDrill('managerFunds')}
                  >
                    明细
                  </button>
                }
              >
                <MetricGrid items={managerItems} onItemClick={handleDrillClick} />
              </SectionPanel>
            ) : null}

            {sectionTab === 'funds' ? (
              <SectionPanel title="基金产品" hint="投资人相关 / 项目相关；点指标下钻对应明细">
                {fundCards.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--h5-muted)', fontSize: 13 }}>暂无基金产品数据</p>
                ) : (
                  <div className="h5-perf__fund-list">
                    {fundCards.map((card) => (
                      <div key={card.name} className="h5-perf__fund-card-block">
                        <div className="h5-perf__fund-card-head">
                          <div className="h5-perf__fund-row-name">{card.name}</div>
                        </div>
                        {card.groups.map((group) => (
                          <div key={group.key} className="h5-perf__fund-group-block">
                            <div className="h5-perf__fund-group-block-head">
                              <span>{group.title}</span>
                              <button
                                type="button"
                                className="h5-perf__section-action"
                                onClick={() => handleDrillClick(group.primaryDrill)}
                              >
                                {group.primaryLabel}
                                <RightOutline fontSize={12} />
                              </button>
                            </div>
                            <div className="h5-perf__grid">
                              {group.metrics.map((m) => (
                                <button
                                  key={m.label}
                                  type="button"
                                  className="h5-perf__metric h5-perf__metric--clickable"
                                  onClick={() => handleDrillClick(m.drill)}
                                >
                                  <div className="h5-perf__metric-label">
                                    {m.label}
                                    <RightOutline fontSize={12} className="h5-perf__metric-chevron" />
                                  </div>
                                  <div className="h5-perf__metric-value">
                                    {m.value}
                                    {m.unit ? (
                                      <span className="h5-perf__metric-unit">{m.unit}</span>
                                    ) : null}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </SectionPanel>
            ) : null}

            {sectionTab === 'portfolio' ? (
              <SectionPanel title="投资组合" hint="点击指标查看组合明细">
                <Tabs activeKey={portfolioTab} onChange={setPortfolioTab}>
                  <Tabs.Tab title="直投项目" key="project" />
                  <Tabs.Tab title="子基金组合" key="fund" />
                </Tabs>
                <div style={{ marginTop: 10 }}>
                  <MetricGrid
                    items={portfolioTab === 'project' ? projectItems : fundPortfolioItems}
                    onItemClick={handleDrillClick}
                  />
                </div>
              </SectionPanel>
            ) : null}

            {sectionTab === 'underlying' ? (
              <SectionPanel title="底层资产" hint="点击指标查看企业明细 · 金额单位亿元">
                <Tabs activeKey={underlyingTab} onChange={setUnderlyingTab}>
                  <Tabs.Tab title="累计组合" key="cumulative" />
                  <Tabs.Tab title="当前组合" key="current" />
                </Tabs>
                <div style={{ marginTop: 10 }}>
                  <MetricGrid items={underlyingItems} onItemClick={handleDrillClick} />
                </div>
              </SectionPanel>
            ) : null}
          </>
        ) : null}
      </div>

      <PerformanceDrillPopup
        visible={!!drill.type}
        type={drill.type}
        fund={drill.fund}
        modalType={drill.modalType}
        version={selectedVersion}
        onClose={closeDrill}
      />
    </div>
  )
}
