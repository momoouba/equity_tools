import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DotLoading, InfiniteScroll, SearchBar, Selector, Toast } from 'antd-mobile'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasProjectSourcingPermission } from '../utils/auth'
import { cacheFinancingItem } from '../utils/financingCache'
import {
  displayFundingAmt,
  displayIntro,
  displayInvestors,
  displayRound,
  displayTrack,
  formatEventDate,
  rangePresetToDates
} from '../utils/financingFormat'

const RANGE_OPTIONS = [
  { label: '昨日', value: 'yesterday' },
  { label: '近7日', value: 'week' },
  { label: '近30日', value: 'month' },
  { label: '全部', value: 'all' }
]

export default function FinancingEventList() {
  const navigate = useNavigate()
  const canAccess = hasProjectSourcingPermission()
  const [rangePreset, setRangePreset] = useState('week')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  const filterSummary = [
    RANGE_OPTIONS.find((o) => o.value === rangePreset)?.label || '全部',
    search ? `搜索·${search}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const fetchPage = useCallback(
    async (pageNum, replace) => {
      if (!canAccess) return
      setLoading(true)
      try {
        const { date_from, date_to } = rangePresetToDates(rangePreset)
        const res = await axios.get('/api/project-sourcing/events', {
          params: {
            page: pageNum,
            pageSize: 20,
            keyword: search || undefined,
            date_from: date_from || undefined,
            date_to: date_to || undefined
          }
        })
        if (!res.data?.success) {
          Toast.show({ content: res.data?.message || '加载失败', position: 'bottom' })
          return
        }
        setForbidden(false)
        const rows = (res.data.data?.list || []).map((r) => ({
          ...r,
          id: r.id != null ? String(r.id) : r.id,
          event_date: formatEventDate(r.event_date)
        }))
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
    [canAccess, rangePreset, search]
  )

  useEffect(() => {
    setList([])
    setPage(1)
    setHasMore(true)
    fetchPage(1, true)
  }, [rangePreset, search, fetchPage])

  if (!canAccess) {
    return <div className="h5-empty">无「项目挖掘」应用权限</div>
  }

  if (forbidden) {
    return <div className="h5-empty">当前账号无融资事件查看权限</div>
  }

  return (
    <div>
      <div className="h5-filters">
        <PageHeader title="融资事件" subtitle="市场融资 · 只读" />
        <Selector
          options={RANGE_OPTIONS}
          value={[rangePreset]}
          onChange={(arr) => {
            if (arr?.[0]) setRangePreset(arr[0])
          }}
          style={{ marginBottom: 4 }}
        />
        <div className="h5-filters__fold-bar">
          <span className="h5-filters__fold-summary">{filterSummary}</span>
          <button type="button" onClick={() => setFilterExpanded((v) => !v)}>
            {filterExpanded ? '收起搜索' : '展开搜索'}
          </button>
        </div>
        {filterExpanded ? (
          <div className="h5-filters__collapsed-panel">
            <SearchBar
              placeholder="公司 / 项目 / 轮次 / 投资方…"
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

      {list.length === 0 && !loading ? (
        <div className="h5-empty">暂无融资事件</div>
      ) : (
        list.map((item) => {
          const intro = displayIntro(item)
          const shortName = item.project_name || item.company_name || '未命名项目'
          const fullName =
            item.company_name && item.company_name !== shortName ? item.company_name : ''
          const investors = displayInvestors(item)
          return (
            <div
              key={item.id}
              className="h5-news-card"
              role="button"
              tabIndex={0}
              onClick={() => {
                cacheFinancingItem(item)
                navigate(`/financing/${item.id}`)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  cacheFinancingItem(item)
                  navigate(`/financing/${item.id}`)
                }
              }}
            >
              <h3 className="h5-news-card__title h5-news-card__title--short">
                {shortName}
                {fullName ? (
                  <span className="h5-news-card__title-company">{fullName}</span>
                ) : null}
              </h3>
              <div className="h5-news-card__meta">
                <span>{formatEventDate(item.event_date)}</span>
                <span className="h5-tag h5-tag--neu">{displayRound(item)}</span>
                {investors ? <span className="h5-meta-investors">{investors}</span> : null}
                <span>{displayFundingAmt(item)}</span>
                <span>{displayTrack(item)}</span>
              </div>
              {intro ? (
                <p className="h5-news-card__abstract">{intro}</p>
              ) : (
                <p className="h5-news-card__abstract h5-news-card__abstract--empty">暂无简介</p>
              )}
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
    </div>
  )
}
