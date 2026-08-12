import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  Empty,
  Grid,
  Message,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from '@arco-design/web-react'
import ReactECharts from 'echarts-for-react'
import {
  fetchMarketOverview,
  fetchMarketOverviewTrackSecondary,
} from '../../api/project-sourcing'
import {
  buildFinancingEventsDrillQuery,
  buildYtdSummaryText,
  defaultYearRange,
  formatInt,
} from './overview/buildYtdSummaryText'
import './ProjectSourcingPage.css'

const { Row, Col } = Grid
const Option = Select.Option

function yearOptions() {
  const y = new Date().getFullYear()
  const list = []
  for (let i = y + 1; i >= 1995; i--) list.push(i)
  return list
}

function formatAmountYi(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)} 万`
  return formatInt(v)
}

function isBlankInvestorLabel(name) {
  const n = String(name || '').trim()
  return !n || n === '[]' || n === '{}' || n === '-' || n === '—'
}

function ProjectSourcingPage() {
  const navigate = useNavigate()
  const defaults = useMemo(() => defaultYearRange(), [])
  const [yearFrom, setYearFrom] = useState(defaults.yearFrom)
  const [yearTo, setYearTo] = useState(defaults.yearTo)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [selectedTrack, setSelectedTrack] = useState('')
  const [trackDetail, setTrackDetail] = useState(null)
  const [trackDetailLoading, setTrackDetailLoading] = useState(false)

  const loadTrackDetail = useCallback(
    async (trackName) => {
      if (!trackName) {
        setTrackDetail(null)
        return
      }
      setTrackDetailLoading(true)
      try {
        const res = await fetchMarketOverviewTrackSecondary({
          year_from: yearFrom,
          year_to: yearTo,
          track_primary: trackName,
        })
        if (res.data?.success) {
          setTrackDetail(res.data.data)
        } else {
          Message.error(res.data?.message || '加载子赛道失败')
        }
      } catch (e) {
        Message.error(e.response?.data?.message || e.message || '加载子赛道失败')
      } finally {
        setTrackDetailLoading(false)
      }
    },
    [yearFrom, yearTo]
  )

  const load = useCallback(async () => {
    if (yearFrom > yearTo) {
      Message.warning('起始年不能大于结束年')
      return
    }
    setLoading(true)
    try {
      const res = await fetchMarketOverview({ year_from: yearFrom, year_to: yearTo })
      if (res.data?.success) {
        const payload = res.data.data || null
        setData(payload)
        const firstTrack =
          (payload?.tracks?.top || []).find((t) => Number(t.count) > 0)?.name ||
          payload?.tracks?.top?.[0]?.name ||
          ''
        setSelectedTrack(firstTrack)
        setTrackDetail(null)
        if (firstTrack) {
          loadTrackDetail(firstTrack)
        }
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [yearFrom, yearTo, loadTrackDetail])

  useEffect(() => {
    load()
  }, [load])

  const drill = useCallback(
    (opts) => {
      const qs = buildFinancingEventsDrillQuery(opts)
      navigate(`/dashboard/project-sourcing-financing-events${qs ? `?${qs}` : ''}`)
    },
    [navigate]
  )

  const windowDates = useMemo(() => {
    if (!data?.meta) return { from: '', to: '' }
    return {
      from: data.meta.window_date_from,
      to: data.meta.window_date_to,
    }
  }, [data])

  const summaryText = useMemo(
    () => buildYtdSummaryText(data?.ytd_summary_facts),
    [data]
  )

  const onSelectTrack = useCallback(
    (name) => {
      setSelectedTrack(name)
      loadTrackDetail(name)
    },
    [loadTrackDetail]
  )

  const yearlyOption = useMemo(() => {
    const trend = data?.yearly_trend || []
    return {
      tooltip: {
        trigger: 'axis',
        formatter(params) {
          const p = params?.[0]
          if (!p) return ''
          const item = trend.find((t) => String(t.year) === String(p.name))
          const cov = item ? Math.round((item.amount_coverage || 0) * 100) : 0
          const amt = formatAmountYi(item?.amount_cny_sum)
          const ytd = item?.is_ytd ? '（截至当日 YTD）' : ''
          return `${p.name}${ytd}<br/>事件数：${formatInt(p.value)}<br/>金额合计(CNY)：${amt}<br/>金额覆盖率：${cov}%`
        },
      },
      grid: { left: 48, right: 24, top: 32, bottom: 32 },
      xAxis: {
        type: 'category',
        data: trend.map((t) => String(t.year)),
      },
      yAxis: {
        type: 'value',
        name: '事件数',
        minInterval: 1,
        axisLabel: { formatter: (v) => formatInt(v) },
      },
      series: [
        {
          type: 'bar',
          name: '事件数',
          data: trend.map((t) => t.event_count),
          itemStyle: { color: '#165DFF' },
          barMaxWidth: 48,
        },
      ],
    }
  }, [data])

  const trackBarOption = useMemo(() => {
    const top = [...(data?.tracks?.top || [])].reverse()
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => formatInt(v),
      },
      grid: { left: 100, right: 32, top: 16, bottom: 24 },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { formatter: (v) => formatInt(v) },
      },
      yAxis: { type: 'category', data: top.map((t) => t.name) },
      series: [
        {
          type: 'bar',
          data: top.map((t) => ({
            value: t.count,
            itemStyle: {
              color: t.name === selectedTrack ? '#165DFF' : '#0FC6C2',
            },
          })),
          barMaxWidth: 28,
        },
      ],
    }
  }, [data, selectedTrack])

  const trackYearOption = useMemo(() => {
    const series = trackDetail?.by_year || []
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 16, top: 24, bottom: 28 },
      xAxis: { type: 'category', data: series.map((t) => String(t.year)) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          type: 'line',
          data: series.map((t) => t.event_count),
          smooth: true,
          itemStyle: { color: '#0FC6C2' },
        },
      ],
    }
  }, [trackDetail])

  const investorYearOption = useMemo(() => {
    const list = (data?.investors?.top10_yearly || []).filter(
      (inv) => !isBlankInvestorLabel(inv?.name)
    )
    const years = (data?.yearly_trend || []).map((t) => String(t.year))
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v) => formatInt(v),
      },
      legend: { type: 'scroll', bottom: 0 },
      grid: { left: 48, right: 16, top: 24, bottom: 56 },
      xAxis: { type: 'category', data: years },
      yAxis: {
        type: 'value',
        minInterval: 1,
        name: '参投数',
        axisLabel: { formatter: (v) => formatInt(v) },
      },
      series: list.map((inv) => ({
        name: inv.name,
        type: 'line',
        data: (inv.series || []).map((s) => s.deal_count),
        smooth: true,
      })),
    }
  }, [data])

  const roundStackOption = useMemo(() => {
    const byYear = data?.rounds?.by_year || []
    const buckets =
      data?.rounds?.window_share?.map((x) => x.bucket) ||
      ['种子/天使', 'Pre-A / A', 'B', 'C', 'D 及以后', '战略/并购及其他', '未识别']
    const colors = ['#165DFF', '#14C9C9', '#F7BA1E', '#9FDB1D', '#722ED1', '#F77234', '#86909C']
    return {
      tooltip: { trigger: 'axis' },
      legend: { type: 'scroll', bottom: 0 },
      grid: { left: 48, right: 16, top: 24, bottom: 56 },
      xAxis: { type: 'category', data: byYear.map((y) => String(y.year)) },
      yAxis: {
        type: 'value',
        minInterval: 1,
        name: '事件数',
        axisLabel: { formatter: (v) => formatInt(v) },
      },
      series: buckets.map((b, i) => ({
        name: b,
        type: 'bar',
        stack: 'rounds',
        barMaxWidth: 40,
        itemStyle: { color: colors[i % colors.length] },
        data: byYear.map((y) => (y.buckets && y.buckets[b]) || 0),
      })),
    }
  }, [data])

  const roundPieOption = useMemo(() => {
    const share = data?.rounds?.window_share || []
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['40%', '68%'],
          data: share
            .filter((s) => s.count > 0)
            .map((s) => ({ name: s.bucket, value: s.count })),
          label: { formatter: '{b}\n{d}%' },
        },
      ],
    }
  }, [data])

  const kpi = data?.kpi
  const untrackedPct = kpi ? Math.round((kpi.untracked_ratio || 0) * 1000) / 10 : 0

  const investorColumns = [
    { title: '排名', dataIndex: 'rank', width: 64 },
    {
      title: '机构',
      dataIndex: 'name',
      ellipsis: true,
      render: (v) => (
        <Button
          type="text"
          style={{ padding: 0 }}
          onClick={() =>
            drill({
              date_from: windowDates.from,
              date_to: windowDates.to,
              investor_keyword: v,
            })
          }
        >
          {v}
        </Button>
      ),
    },
    {
      title: '参投数',
      dataIndex: 'deal_count',
      width: 96,
      render: (v) => formatInt(v),
    },
    {
      title: '占比',
      dataIndex: 'share',
      width: 80,
      render: (v) => `${Math.round((Number(v) || 0) * 1000) / 10}%`,
    },
    {
      title: '金额(CNY)',
      dataIndex: 'amount_cny_sum',
      width: 110,
      render: (v) => formatAmountYi(v),
    },
  ]

  const investorTop20 = useMemo(
    () => (data?.investors?.top20 || []).filter((r) => !isBlankInvestorLabel(r?.name)),
    [data]
  )

  const displayTopInvestor = useMemo(() => {
    const fromKpi = kpi?.top_investor
    if (fromKpi?.name && !isBlankInvestorLabel(fromKpi.name)) return fromKpi
    const first = investorTop20[0]
    if (first) return { name: first.name, count: first.deal_count }
    return { name: '', count: 0 }
  }, [kpi, investorTop20])

  return (
    <div className="ps-overview-page">
      <div className="ps-overview-header">
        <Typography.Title heading={5} style={{ margin: 0 }}>
          融资与市场概览
        </Typography.Title>
        <Space wrap>
          <span className="ps-muted">年份</span>
          <Select
            style={{ width: 100 }}
            value={yearFrom}
            onChange={setYearFrom}
          >
            {yearOptions().map((y) => (
              <Option key={`f-${y}`} value={y}>
                {y}
              </Option>
            ))}
          </Select>
          <span className="ps-muted">至</span>
          <Select style={{ width: 100 }} value={yearTo} onChange={setYearTo}>
            {yearOptions().map((y) => (
              <Option key={`t-${y}`} value={y}>
                {y}
              </Option>
            ))}
          </Select>
          <Button
            onClick={() => {
              const d = defaultYearRange()
              setYearFrom(d.yearFrom)
              setYearTo(d.yearTo)
            }}
          >
            重置近5年
          </Button>
          <Button type="primary" loading={loading} onClick={load}>
            刷新
          </Button>
          <span className="ps-muted">
            数据截至：{data?.meta?.data_max_event_date || '暂无'}
            {data?.meta?.as_of_date ? ` · 统计日 ${data.meta.as_of_date}` : ''}
          </span>
        </Space>
      </div>

      <Spin loading={loading} style={{ display: 'block', width: '100%' }}>
        {!data && !loading ? (
          <Card bordered={false}>
            <Empty description="加载失败，请重试" />
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Button type="primary" onClick={load}>
                重试
              </Button>
            </div>
          </Card>
        ) : null}

        {data && kpi?.window_event_count === 0 ? (
          <Card bordered={false} className="ps-overview-block">
            <Empty description="当前年份范围内暂无融资事件。请先在「融资信息源配置」完成同步，或扩大年份范围。" />
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Space>
                <Button
                  type="primary"
                  onClick={() => navigate('/dashboard/project-sourcing-financing-events')}
                >
                  融资事件列表
                </Button>
              </Space>
            </div>
          </Card>
        ) : null}

        {data && kpi?.window_event_count > 0 ? (
          <>
            <div className="ps-overview-kpi-row">
              <Card
                className="ps-kpi-card"
                bordered={false}
                hoverable
                onClick={() =>
                  drill({ date_from: windowDates.from, date_to: windowDates.to })
                }
              >
                <div className="ps-kpi-label">窗口事件数</div>
                <div className="ps-kpi-value">{formatInt(kpi.window_event_count)}</div>
                <div className="ps-kpi-sub">
                  {data.meta.year_from}–{data.meta.year_to}
                </div>
              </Card>
              <Card
                className="ps-kpi-card"
                bordered={false}
                hoverable
                onClick={() => {
                  const y = new Date().getFullYear()
                  const asOf = data.meta.as_of_date || ''
                  drill({ date_from: `${y}-01-01`, date_to: asOf })
                }}
              >
                <div className="ps-kpi-label">今年融资（同期）</div>
                <div className="ps-kpi-value">{formatInt(kpi.ytd_event_count)}</div>
                <div className="ps-kpi-sub">
                  {kpi.ytd_yoy_pct == null ? (
                    <span title="去年同期无事件">同比 —</span>
                  ) : (
                    <span
                      className={
                        kpi.ytd_yoy_pct > 0
                          ? 'ps-up'
                          : kpi.ytd_yoy_pct < 0
                            ? 'ps-down'
                            : ''
                      }
                    >
                      同比 {kpi.ytd_yoy_pct > 0 ? '+' : ''}
                      {kpi.ytd_yoy_pct}%
                    </span>
                  )}
                </div>
              </Card>
              <Card
                className="ps-kpi-card"
                bordered={false}
                hoverable
                onClick={() => {
                  if (!kpi.top_track?.name) return
                  drill({
                    date_from: windowDates.from,
                    date_to: windowDates.to,
                    track_primary: kpi.top_track.name,
                  })
                }}
              >
                <div className="ps-kpi-label">热门赛道</div>
                <div className="ps-kpi-value ps-kpi-value-sm">
                  {kpi.top_track?.name || '—'}
                </div>
                <div className="ps-kpi-sub">{formatInt(kpi.top_track?.count || 0)} 起</div>
              </Card>
              <Card
                className="ps-kpi-card"
                bordered={false}
                hoverable
                onClick={() => {
                  if (!displayTopInvestor?.name) return
                  drill({
                    date_from: windowDates.from,
                    date_to: windowDates.to,
                    investor_keyword: displayTopInvestor.name,
                  })
                }}
              >
                <div className="ps-kpi-label">最活跃机构</div>
                <div className="ps-kpi-value ps-kpi-value-sm">
                  {displayTopInvestor?.name || '—'}
                </div>
                <div className="ps-kpi-sub">{formatInt(displayTopInvestor?.count || 0)} 起参投</div>
              </Card>
              <Card
                className={`ps-kpi-card ${untrackedPct >= 30 ? 'ps-kpi-warn' : ''}`}
                bordered={false}
                hoverable
                onClick={() =>
                  drill({
                    date_from: windowDates.from,
                    date_to: windowDates.to,
                    track_empty: true,
                  })
                }
              >
                <div className="ps-kpi-label">赛道未分类</div>
                <div className="ps-kpi-value">{untrackedPct}%</div>
                <div className="ps-kpi-sub">
                  {untrackedPct >= 30 ? '请完善赛道配置并执行匹配' : '点击查看未分类事件'}
                </div>
              </Card>
            </div>

            <Card
              className="ps-overview-block"
              bordered={false}
              title="今年市场速览"
              extra={<span className="ps-muted">规则生成 · 非 AI</span>}
            >
              <pre className="ps-summary-text">{summaryText}</pre>
            </Card>

            <Card
              className="ps-overview-block"
              bordered={false}
              title="逐年融资走势"
              extra={<span className="ps-muted">主指标：事件数；金额见 Tooltip</span>}
            >
              <ReactECharts
                option={yearlyOption}
                style={{ height: 320 }}
                onEvents={{
                  click: (params) => {
                    const year = parseInt(params?.name, 10)
                    if (!Number.isFinite(year)) return
                    const isYtd = year === new Date().getFullYear()
                    drill({
                      date_from: `${year}-01-01`,
                      date_to: isYtd
                        ? data.meta.as_of_date
                        : `${year}-12-31`,
                    })
                  },
                }}
              />
            </Card>

            <Card
              className="ps-overview-block"
              bordered={false}
              title="热门赛道"
              extra={
                <span className="ps-track-scope-note">
                  目前仅针对<strong>人工智能</strong>、<strong>半导体</strong>、<strong>生物医药</strong>
                  赛道进行分析
                  {data.tracks?.untracked_count != null ? (
                    <span className="ps-muted">
                      {' '}
                      · 全库未匹配 {formatInt(data.tracks.untracked_count)} 起
                    </span>
                  ) : null}
                </span>
              }
            >
              {(data.tracks?.top || []).length === 0 ? (
                <Empty description="暂无三大赛道数据。请前往「赛道配置」执行匹配。" />
              ) : (
                <Row gutter={16}>
                  <Col xs={24} lg={14}>
                    <ReactECharts
                      option={trackBarOption}
                      style={{ height: 220 }}
                      onEvents={{
                        click: (params) => {
                          const name = params?.name
                          if (!name) return
                          onSelectTrack(name)
                        },
                      }}
                    />
                    <div className="ps-muted" style={{ marginTop: 4 }}>
                      默认选中左侧第一项；点击条形可切换赛道并查看右侧子赛道。
                    </div>
                    {selectedTrack ? (
                      <Button
                        type="outline"
                        size="small"
                        style={{ marginTop: 8 }}
                        onClick={() =>
                          drill({
                            date_from: windowDates.from,
                            date_to: windowDates.to,
                            track_primary: selectedTrack,
                          })
                        }
                      >
                        下钻「{selectedTrack}」事件列表
                      </Button>
                    ) : null}
                  </Col>
                  <Col xs={24} lg={10}>
                    <Spin loading={trackDetailLoading}>
                      {!selectedTrack ? (
                        <Empty description="暂无选中赛道" />
                      ) : (
                        <>
                          <Typography.Text bold>{selectedTrack} · 逐年</Typography.Text>
                          <ReactECharts option={trackYearOption} style={{ height: 180 }} />
                          <Typography.Text bold style={{ display: 'block', marginTop: 8 }}>
                            子赛道 Top5
                          </Typography.Text>
                          {(trackDetail?.secondary_top || []).length === 0 ? (
                            <Empty description="无子赛道数据" />
                          ) : (
                            <Table
                              size="small"
                              rowKey="name"
                              pagination={false}
                              columns={[
                                { title: '子赛道', dataIndex: 'name', ellipsis: true },
                                {
                                  title: '件数',
                                  dataIndex: 'count',
                                  width: 88,
                                  render: (v) => formatInt(v),
                                },
                              ]}
                              data={trackDetail.secondary_top}
                              onRow={(record) => ({
                                onClick: () =>
                                  drill({
                                    date_from: windowDates.from,
                                    date_to: windowDates.to,
                                    track_primary: selectedTrack,
                                    track_secondary: record.name,
                                  }),
                              })}
                            />
                          )}
                        </>
                      )}
                    </Spin>
                  </Col>
                </Row>
              )}
            </Card>

            <Card
              className="ps-overview-block"
              bordered={false}
              title="头部机构动向"
              extra={<span className="ps-muted">仅统计有标记机构（排除个人投资者/未披露等）；Top20 + Top10 逐年</span>}
            >
              {(investorTop20 || []).length === 0 ? (
                <Empty description="事件缺少投资方信息，无法生成机构榜" />
              ) : (
                <Row gutter={16}>
                  <Col xs={24} lg={12}>
                    <Table
                      size="small"
                      rowKey="name"
                      pagination={false}
                      columns={investorColumns}
                      data={investorTop20}
                      scroll={{ y: 360 }}
                    />
                  </Col>
                  <Col xs={24} lg={12}>
                    <ReactECharts option={investorYearOption} style={{ height: 400 }} />
                  </Col>
                </Row>
              )}
            </Card>

            <Card
              className="ps-overview-block"
              bordered={false}
              title="融资轮次结构"
              extra={
                <span className="ps-muted">
                  字段 round · 归并口径 {data.meta?.round_bucket_version || 'v1'}
                </span>
              }
            >
              <Row gutter={16}>
                <Col xs={24} lg={14}>
                  <ReactECharts
                    option={roundStackOption}
                    style={{ height: 360 }}
                    onEvents={{
                      click: (params) => {
                        const year = parseInt(params?.name, 10)
                        const bucket = params?.seriesName
                        if (!Number.isFinite(year) || !bucket) return
                        const isYtd = year === new Date().getFullYear()
                        drill({
                          date_from: `${year}-01-01`,
                          date_to: isYtd
                            ? data.meta.as_of_date
                            : `${year}-12-31`,
                          round_bucket: bucket,
                        })
                      },
                    }}
                  />
                </Col>
                <Col xs={24} lg={10}>
                  <ReactECharts
                    option={roundPieOption}
                    style={{ height: 360 }}
                    onEvents={{
                      click: (params) => {
                        const bucket = params?.name
                        if (!bucket) return
                        drill({
                          date_from: windowDates.from,
                          date_to: windowDates.to,
                          round_bucket: bucket,
                        })
                      },
                    }}
                  />
                </Col>
              </Row>
            </Card>
          </>
        ) : null}
      </Spin>
    </div>
  )
}

export default ProjectSourcingPage
