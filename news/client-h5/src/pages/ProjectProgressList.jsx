import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DotLoading, InfiniteScroll, SearchBar, Selector, Toast } from 'antd-mobile'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasListingPermission } from '../utils/auth'
import { cacheProgressItem } from '../utils/progressCache'
import {
  formatAmount,
  formatPercent,
  resolveProgressId
} from '../utils/listingFormat'

const RANGE_OPTIONS = [
  { label: '昨日', value: 'yesterday' },
  { label: '近7日', value: 'week' },
  { label: '近30日', value: 'month' },
  { label: '全部', value: 'all' }
]

export default function ProjectProgressList() {
  const navigate = useNavigate()
  const canListing = hasListingPermission()
  const [rangePreset, setRangePreset] = useState('all')
  const [fundInput, setFundInput] = useState('')
  const [fund, setFund] = useState('')
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  const filterSummary = [
    RANGE_OPTIONS.find((o) => o.value === rangePreset)?.label || '全部',
    fund ? `基金·${fund}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const fetchPage = useCallback(
    async (pageNum, replace) => {
      if (!canListing) return
      setLoading(true)
      try {
        const res = await axios.get('/api/listing/ipo-project-progress', {
          params: {
            page: pageNum,
            pageSize: 20,
            rangePreset,
            fund: fund || undefined
          }
        })
        if (!res.data?.success) {
          Toast.show({ content: res.data?.message || '加载失败', position: 'bottom' })
          return
        }
        setForbidden(false)
        const rows = (res.data.data?.list || []).map((r) => ({
          ...r,
          id: resolveProgressId(r)
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
    [canListing, rangePreset, fund]
  )

  useEffect(() => {
    setList([])
    setPage(1)
    setHasMore(true)
    fetchPage(1, true)
  }, [rangePreset, fund, fetchPage])

  if (!canListing) {
    return <div className="h5-empty">无「上市进展」应用权限</div>
  }

  if (forbidden) {
    return (
      <div className="h5-empty">
        当前会员档位无底层项目上市进展权限
        <br />
        （通常需高级/VIP；配置请用电脑版）
      </div>
    )
  }

  return (
    <div>
      <div className="h5-filters">
        <PageHeader title="上市进展" subtitle="底层项目 · 只读" />
        <Selector
          options={RANGE_OPTIONS}
          value={[rangePreset]}
          onChange={(arr) => {
            if (arr?.[0]) setRangePreset(arr[0])
          }}
          style={{ marginBottom: 8 }}
        />
        <SearchBar
          placeholder="按基金名称筛选"
          value={fundInput}
          onChange={setFundInput}
          onSearch={(v) => setFund(String(v || '').trim())}
          onClear={() => {
            setFundInput('')
            setFund('')
          }}
        />
        <div className="h5-filters__fold-bar" style={{ marginTop: 4 }}>
          <span className="h5-filters__fold-summary">{filterSummary}</span>
        </div>
      </div>

      {list.length === 0 && !loading ? (
        <div className="h5-empty">暂无进展数据</div>
      ) : (
        list.map((item) => {
          const id = resolveProgressId(item)
          const updateDay = item.f_update_time ? String(item.f_update_time).slice(0, 10) : '—'
          const shortName = item.project_name || '未命名项目'
          const company = item.company && item.company !== shortName ? item.company : ''
          return (
            <div
              key={id}
              className="h5-news-card"
              role="button"
              tabIndex={0}
              onClick={() => {
                cacheProgressItem(item)
                navigate(`/listing/progress/${id}`)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  cacheProgressItem(item)
                  navigate(`/listing/progress/${id}`)
                }
              }}
            >
              <h3 className="h5-news-card__title">
                {shortName}
                {company ? (
                  <span className="h5-news-card__title-company">{company}</span>
                ) : null}
              </h3>
              <div className="h5-news-card__meta">
                <span className="h5-tag h5-tag--neu">{item.status || '—'}</span>
                <span>{item.exchange || '—'}</span>
                {item.board ? <span>{item.board}</span> : null}
                <span>{updateDay}</span>
              </div>
              <p className="h5-news-card__abstract" style={{ marginBottom: 0 }}>
                {item.fund || '—'}
                {item.sub ? ` / ${item.sub}` : ''}
                {' · '}
                投资 {formatAmount(item.inv_amount)}
              </p>
              <p className="h5-news-card__abstract" style={{ marginTop: 4 }}>
                剩余 {formatAmount(item.residual_amount)}
                {' · '}
                穿透 {formatPercent(item.ratio, true)}
              </p>
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
