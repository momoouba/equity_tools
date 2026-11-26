import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DotLoading, InfiniteScroll, ProgressBar, PullToRefresh, SearchBar, Tabs, Toast } from 'antd-mobile'
import { LoopOutline } from 'antd-mobile-icons'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasCompetitorPermission } from '../utils/auth'
import {
  displayCompetitorFullName,
  displayCompetitorTitle,
  formatPercent,
  statusTone
} from '../utils/competitorFormat'

export default function CompetitorList() {
  const navigate = useNavigate()
  const canAccess = hasCompetitorPermission()
  const [tab, setTab] = useState('post') // post | pre
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const filterSummary = [
    tab === 'pre' ? '投前' : '投后',
    search ? `搜索·${search}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const fetchPage = useCallback(
    async (pageNum, replace) => {
      if (!canAccess) return
      setLoading(true)
      try {
        const res = await axios.get('/api/h5/competitor/subjects', {
          params: {
            tab,
            page: pageNum,
            pageSize: 20,
            keyword: search || undefined
          }
        })
        if (!res.data?.success) {
          Toast.show({ content: res.data?.message || '加载失败', position: 'bottom' })
          return
        }
        setForbidden(false)
        const rows = res.data.data?.list || []
        const total = Number(res.data.data?.total || 0)
        setList((prev) => (replace ? rows : [...prev, ...rows]))
        setPage(pageNum)
        setHasMore(pageNum * 20 < total && rows.length > 0)
      } catch (err) {
        if (err.response?.status === 403) {
          setForbidden(true)
          setList([])
          setHasMore(false)
        } else {
          Toast.show({
            content: err.response?.data?.message || '加载失败',
            position: 'bottom'
          })
          setHasMore(false)
        }
      } finally {
        setLoading(false)
      }
    },
    [canAccess, tab, search]
  )

  useEffect(() => {
    setList([])
    setPage(1)
    setHasMore(true)
    fetchPage(1, true)
  }, [tab, search, fetchPage])

  // 有进行中任务时轻量轮询列表状态
  useEffect(() => {
    const running = list.some((r) => r.is_running)
    if (!running || !canAccess) return undefined
    const timer = setInterval(() => {
      fetchPage(1, true)
    }, 5000)
    return () => clearInterval(timer)
  }, [list, canAccess, fetchPage])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchPage(1, true)
      Toast.show({ content: '已刷新', position: 'bottom' })
    } finally {
      setRefreshing(false)
    }
  }

  if (!canAccess) {
    return <div className="h5-empty">无「竞品分析」应用权限</div>
  }

  if (forbidden) {
    return <div className="h5-empty">当前账号无竞品分析查看权限</div>
  }

  return (
    <div>
      <div className="h5-filters">
        <PageHeader title="竞品分析" subtitle="进度与结果 · 只读" />
        <div className="h5-filters__fold-bar" style={{ marginTop: 0 }}>
          <span className="h5-filters__fold-summary">{filterSummary}</span>
          <button type="button" onClick={onRefresh} disabled={refreshing || loading}>
            <LoopOutline fontSize={16} /> {refreshing ? '刷新中' : '刷新'}
          </button>
        </div>
        <Tabs activeKey={tab} onChange={(key) => setTab(key)} style={{ marginBottom: 4 }}>
          <Tabs.Tab title="投后" key="post" />
          <Tabs.Tab title="投前" key="pre" />
        </Tabs>
        <div className="h5-filters__fold-bar">
          <span className="h5-filters__fold-summary">
            {search ? `搜索·${search}` : '全部主体'}
          </span>
          <button type="button" onClick={() => setFilterExpanded((v) => !v)}>
            {filterExpanded ? '收起搜索' : '展开搜索'}
          </button>
        </div>
        {filterExpanded ? (
          <div className="h5-filters__collapsed-panel">
            <SearchBar
              placeholder="企业 / 简称 / 编号"
              value={keyword}
              onChange={setKeyword}
              onSearch={(v) => setSearch(String(v || '').trim())}
              onClear={() => {
                setKeyword('')
                setSearch('')
              }}
            />
          </div>
        ) : null}
      </div>

      <PullToRefresh onRefresh={onRefresh}>
        {list.length === 0 && !loading ? (
          <div className="h5-empty">{tab === 'pre' ? '暂无投前项目' : '暂无投后企业'}</div>
        ) : (
          list.map((item) => {
            const shortName = displayCompetitorTitle(item)
            const fullName = displayCompetitorFullName(item)
            const pct = formatPercent(item.progress_percent)
            const tone = statusTone(item.analysis_status, item.is_running, item.analysis_status_label)
            return (
              <div
                key={`${tab}-${item.id}`}
                className="h5-news-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/competitor/${tab}/${item.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(`/competitor/${tab}/${item.id}`)
                }}
              >
                <h3 className="h5-news-card__title h5-news-card__title--short">
                  {shortName}
                  {fullName ? (
                    <span className="h5-news-card__title-company">{fullName}</span>
                  ) : null}
                </h3>
                <div className="h5-news-card__meta">
                  <span className={`h5-tag h5-tag--${tone === 'ok' ? 'pos' : tone === 'fail' ? 'neg' : tone === 'run' ? 'run' : 'neu'}`}>
                    {item.analysis_status_label || '未分析'}
                  </span>
                  {item.current_step_label ? <span>{item.current_step_label}</span> : null}
                  {item.finished_at ? <span>{String(item.finished_at).slice(0, 16)}</span> : null}
                </div>
                {item.is_running && pct != null ? (
                  <div className="h5-competitor-progress">
                    <ProgressBar percent={pct} text={`${pct}%`} />
                  </div>
                ) : null}
              </div>
            )
          })
        )}

        {loading && list.length === 0 ? (
          <div className="h5-empty">
            <DotLoading />
          </div>
        ) : null}

        <InfiniteScroll
          loadMore={async () => {
            if (!hasMore || loading) return
            await fetchPage(page + 1, false)
          }}
          hasMore={hasMore}
        />
      </PullToRefresh>
    </div>
  )
}
