import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DotLoading, InfiniteScroll, SearchBar, Selector, Toast } from 'antd-mobile'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasNewsPermission } from '../utils/auth'
import { cacheNewsItem } from '../utils/newsCache'

const TIME_OPTIONS = [
  { label: '昨日', value: 'yesterday' },
  { label: '本周', value: 'thisWeek' },
  { label: '上周', value: 'lastWeek' },
  { label: '本月', value: 'thisMonth' },
  { label: '全部', value: 'all' }
]

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '企业', value: 'enterprise' },
  { label: '半导体', value: '半导体' },
  { label: '生物医疗', value: '生物医疗' },
  { label: '人工智能', value: '人工智能' },
  { label: '其他', value: '其他' }
]

function sentimentTag(s) {
  const v = String(s || '')
  if (v.includes('正')) return <span className="h5-tag h5-tag--pos">{v}</span>
  if (v.includes('负')) return <span className="h5-tag h5-tag--neg">{v}</span>
  if (v) return <span className="h5-tag h5-tag--neu">{v}</span>
  return null
}

function formatTime(t) {
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return String(t).slice(0, 16)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pickAbstract(item) {
  const raw = item?.news_abstract ?? item?.newsAbstract ?? item?.summary ?? ''
  return String(raw || '').trim()
}

/** 项目维度主键：优先项目简称，其次企业全称 */
function projectKeyOf(item) {
  const abbr = String(item?.enterprise_abbreviation || '').trim()
  const full = String(item?.enterprise_full_name || '').trim()
  return abbr || full || '__unknown__'
}

function projectNameOf(item) {
  const abbr = String(item?.enterprise_abbreviation || '').trim()
  const full = String(item?.enterprise_full_name || '').trim()
  return abbr || full || '未命名项目'
}

export default function NewsList() {
  const navigate = useNavigate()
  const [timeRange, setTimeRange] = useState('yesterday')
  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  /** null = 项目列表；非 null = 某项目下的新闻 */
  const [selectedProjectKey, setSelectedProjectKey] = useState(null)

  const categoryLabel =
    CATEGORY_OPTIONS.find((o) => o.value === category)?.label || '全部'
  const filterSummary = [
    `分类·${categoryLabel}`,
    search ? `搜索·${search}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const canNews = hasNewsPermission()

  const loadStats = useCallback(async () => {
    try {
      const res = await axios.get('/api/news/user-stats')
      if (res.data?.success) setStats(res.data.data || res.data.stats || res.data)
    } catch {
      /* optional */
    }
  }, [])

  const fetchPage = useCallback(
    async (pageNum, replace) => {
      if (!canNews) return
      setLoading(true)
      try {
        const res = await axios.get('/api/news/user-news', {
          params: {
            page: pageNum,
            pageSize: 30,
            timeRange,
            search: search || undefined,
            h5Category: category || 'all',
            enterpriseFilter: 'all'
          }
        })
        if (!res.data?.success) {
          Toast.show({ content: res.data?.message || '加载失败', position: 'bottom' })
          return
        }
        const rows = res.data.data || []
        const total = Number(res.data.total || 0)
        setList((prev) => (replace ? rows : [...prev, ...rows]))
        setPage(pageNum)
        setHasMore(pageNum * 30 < total && rows.length > 0)
      } catch (err) {
        Toast.show({
          content: err.response?.data?.message || '加载失败',
          position: 'bottom'
        })
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [canNews, search, timeRange, category]
  )

  useEffect(() => {
    setList([])
    setPage(1)
    setHasMore(true)
    setSelectedProjectKey(null)
    fetchPage(1, true)
  }, [timeRange, search, category, fetchPage])

  useEffect(() => {
    if (canNews) loadStats()
  }, [canNews, loadStats])

  const projects = useMemo(() => {
    const map = new Map()
    for (const item of list) {
      const key = projectKeyOf(item)
      const name = projectNameOf(item)
      const full =
        String(item.enterprise_full_name || '').trim() &&
        String(item.enterprise_full_name || '').trim() !== name
          ? String(item.enterprise_full_name).trim()
          : ''
      const existing = map.get(key)
      const t = item.public_time ? new Date(item.public_time).getTime() : 0
      if (!existing) {
        map.set(key, {
          key,
          name,
          fullName: full,
          count: 1,
          latestTime: item.public_time || '',
          latestTs: t
        })
      } else {
        existing.count += 1
        if (t > existing.latestTs) {
          existing.latestTs = t
          existing.latestTime = item.public_time || ''
        }
        if (!existing.fullName && full) existing.fullName = full
      }
    }
    return [...map.values()].sort((a, b) => b.latestTs - a.latestTs)
  }, [list])

  const projectNews = useMemo(() => {
    if (!selectedProjectKey) return []
    return list.filter((item) => projectKeyOf(item) === selectedProjectKey)
  }, [list, selectedProjectKey])

  const selectedProject = useMemo(
    () => projects.find((p) => p.key === selectedProjectKey) || null,
    [projects, selectedProjectKey]
  )

  if (!canNews) {
    return <div className="h5-empty">无舆情查看权限</div>
  }

  const openDetail = (item) => {
    cacheNewsItem(item)
    navigate(`/news/${item.id}`)
  }

  return (
    <div>
      <div className="h5-filters">
        {selectedProjectKey && selectedProject ? (
          <PageHeader
            title={selectedProject.name}
            subtitle={
              selectedProject.fullName
                ? `${selectedProject.fullName} · ${selectedProject.count} 条`
                : `本批已加载 ${selectedProject.count} 条 · 按项目查看`
            }
            onBack={() => setSelectedProjectKey(null)}
          />
        ) : (
          <PageHeader title="舆情信息" subtitle="按项目查看 · 只读" />
        )}
        {!selectedProjectKey ? (
          <>
            <Selector
              options={TIME_OPTIONS}
              value={[timeRange]}
              onChange={(arr) => {
                if (arr?.[0]) setTimeRange(arr[0])
              }}
              style={{ marginBottom: 4 }}
            />
            <div className="h5-filters__fold-bar">
              <span className="h5-filters__fold-summary">{filterSummary}</span>
              <button type="button" onClick={() => setFilterExpanded((v) => !v)}>
                {filterExpanded ? '收起筛选' : '展开筛选'}
              </button>
            </div>
            {filterExpanded ? (
              <div className="h5-filters__collapsed-panel">
                <div className="h5-filters__label">分类</div>
                <Selector
                  options={CATEGORY_OPTIONS}
                  value={[category]}
                  onChange={(arr) => {
                    if (arr?.[0]) setCategory(arr[0])
                  }}
                  style={{ marginBottom: 8 }}
                />
                <SearchBar
                  placeholder="搜索标题 / 企业 / 公众号"
                  value={keyword}
                  onChange={setKeyword}
                  onSearch={(v) => setSearch(String(v || '').trim())}
                  onClear={() => {
                    setKeyword('')
                    setSearch('')
                  }}
                />
                {stats && (stats.yesterdayAccountsCount != null || stats.yesterdayCount != null) ? (
                  <div style={{ fontSize: 12, color: '#8f959e', padding: '8px 4px 4px' }}>
                    昨日账号 {stats.yesterdayAccountsCount ?? '—'} · 昨日新闻{' '}
                    {stats.yesterdayCount ?? '—'}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* 一级：项目列表 */}
      {!selectedProjectKey ? (
        <>
          {projects.length === 0 && !loading ? (
            <div className="h5-empty">暂无舆情</div>
          ) : (
            projects.map((p) => (
              <div
                key={p.key}
                className="h5-news-card h5-project-card"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedProjectKey(p.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelectedProjectKey(p.key)
                }}
              >
                <h3 className="h5-news-card__title h5-news-card__title--project">{p.name}</h3>
                {p.fullName ? (
                  <div className="h5-news-card__project-full">{p.fullName}</div>
                ) : null}
                <div className="h5-news-card__meta">
                  <span>{p.count} 条新闻</span>
                  {p.latestTime ? <span>最新 {formatTime(p.latestTime)}</span> : null}
                </div>
              </div>
            ))
          )}
        </>
      ) : (
        /* 二级：该项目下的新闻（标题 → 点进内容页） */
        <>
          {projectNews.length === 0 && !loading ? (
            <div className="h5-empty">该项目暂无舆情</div>
          ) : (
            projectNews.map((item) => {
              const abstract = pickAbstract(item)
              return (
                <div
                  key={item.id}
                  className="h5-news-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openDetail(item)
                  }}
                >
                  <div className="h5-news-card__project-name">{projectNameOf(item)}</div>
                  <h3 className="h5-news-card__title">{item.title || '无标题'}</h3>
                  <div className="h5-news-card__meta">
                    {sentimentTag(item.news_sentiment)}
                    <span>{formatTime(item.public_time)}</span>
                  </div>
                  <p
                    className={`h5-news-card__abstract${abstract ? '' : ' h5-news-card__abstract--empty'}`}
                  >
                    {abstract || '暂无摘要'}
                  </p>
                </div>
              )
            })
          )}
        </>
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
    </div>
  )
}
