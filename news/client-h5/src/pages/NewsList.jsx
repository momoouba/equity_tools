import { useCallback, useEffect, useMemo, useState } from 'react'
import { DotLoading, InfiniteScroll, SearchBar, Selector, Toast } from 'antd-mobile'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasNewsPermission } from '../utils/auth'
import {
  formatNewsSentiment,
  groupNewsByEntity
} from '../utils/newsSentiment'

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

function pickAbstract(item) {
  const raw = item?.news_abstract ?? item?.newsAbstract ?? item?.summary ?? ''
  return String(raw || '').trim()
}

function SentimentBadge({ news }) {
  const { text, tone } = formatNewsSentiment(news)
  return <span className={`h5-senti h5-senti--${tone}`}>{text}</span>
}

function NewsItemBlock({ item }) {
  const abstract = pickAbstract(item)
  return (
    <div className="h5-news-card__item">
      <div className="h5-news-card__headline">{item.title || '无标题'}</div>
      <div className="h5-news-card__senti-row">
        <SentimentBadge news={item} />
      </div>
      <p className={`h5-news-card__abstract${abstract ? '' : ' h5-news-card__abstract--empty'}`}>
        {abstract || '暂无摘要'}
      </p>
      {item.source_url ? (
        <a
          className="h5-news-card__source"
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          原文链接
        </a>
      ) : null}
    </div>
  )
}

export default function NewsList() {
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

  const categoryLabel =
    CATEGORY_OPTIONS.find((o) => o.value === category)?.label || '全部'
  const filterSummary = [
    `分类·${categoryLabel}`,
    search ? `搜索·${search}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const canNews = hasNewsPermission()

  const groups = useMemo(() => groupNewsByEntity(list), [list])

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
            pageSize: 15,
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
        setHasMore(pageNum * 15 < total && rows.length > 0)
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
    fetchPage(1, true)
  }, [timeRange, search, category, fetchPage])

  useEffect(() => {
    if (canNews) loadStats()
  }, [canNews, loadStats])

  if (!canNews) {
    return <div className="h5-empty">无舆情查看权限</div>
  }

  return (
    <div>
      <div className="h5-filters">
        <PageHeader title="舆情信息" subtitle="与我相关 · 只读" />
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
      </div>

      {groups.length === 0 && !loading ? (
        <div className="h5-empty">暂无舆情</div>
      ) : (
        groups.map((group) => (
          <article
            key={group.key}
            className={`h5-news-card${group.header.thirdParty ? ' h5-news-card--third' : ''}`}
          >
            <h3 className="h5-news-card__title h5-news-card__title--short">
              {group.header.primary}
              {group.header.secondary ? (
                <span className="h5-news-card__title-company">{group.header.secondary}</span>
              ) : null}
            </h3>
            {group.items.map((item, idx) => (
              <div key={item.id} className={idx > 0 ? 'h5-news-card__item-wrap' : undefined}>
                {idx > 0 ? <div className="h5-news-card__divider" /> : null}
                <NewsItemBlock item={item} />
              </div>
            ))}
          </article>
        ))
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
