import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DotLoading, InfiniteScroll, SearchBar, Selector, Tabs, Toast } from 'antd-mobile'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasListingPermission } from '../utils/auth'
import { cacheNewShareItem } from '../utils/newShareCache'
import {
  displayEnterpriseName,
  formatAmount,
  formatIssueTotalWan,
  formatMarketCapYiFromYuan,
  formatPercent,
  formatYi
} from '../utils/listingFormat'

const EXCHANGE_OPTIONS = [
  { label: '全部交易所', value: 'all' },
  { label: '上交所', value: '上交所' },
  { label: '深交所', value: '深交所' },
  { label: '北交所', value: '北交所' }
]

export default function NewShareList() {
  const navigate = useNavigate()
  const canListing = hasListingPermission()
  const [listedTab, setListedTab] = useState('listed') // listed | unlisted
  const [exchange, setExchange] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  const isListed = listedTab === 'listed'

  const filterSummary = [
    isListed ? '已上市' : '未上市',
    exchange === 'all' ? '全部交易所' : exchange,
    search ? `搜索·${search}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  const fetchPage = useCallback(
    async (pageNum, replace) => {
      if (!canListing) return
      setLoading(true)
      try {
        const res = await axios.get('/api/listing/new-share', {
          params: {
            page: pageNum,
            pageSize: 20,
            keyword: search || undefined,
            exchange: exchange === 'all' ? undefined : exchange,
            listedStatus: listedTab
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
    [canListing, exchange, search, listedTab]
  )

  useEffect(() => {
    setList([])
    setPage(1)
    setHasMore(true)
    fetchPage(1, true)
  }, [exchange, search, listedTab, fetchPage])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const row of list) {
      const key = isListed
        ? row.public_date || '上市日未知'
        : row.issue_date || '申购日未知'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(row)
    }
    return [...map.entries()]
  }, [list, isListed])

  if (!canListing) {
    return <div className="h5-empty">无「上市进展」应用权限</div>
  }

  if (forbidden) {
    return (
      <div className="h5-empty">
        当前会员档位无打新日历权限
        <br />
        （打新日历需 VIP；配置请用电脑版）
      </div>
    )
  }

  return (
    <div>
      <div className="h5-filters">
        <PageHeader
          title="打新日历"
          subtitle={`只读 · ${isListed ? '按上市日排序' : '按申购日排序'}`}
        />
        <Tabs
          activeKey={listedTab}
          onChange={(key) => setListedTab(key)}
          style={{ marginBottom: 4 }}
        >
          <Tabs.Tab title="已上市" key="listed" />
          <Tabs.Tab title="未上市" key="unlisted" />
        </Tabs>
        <div className="h5-filters__fold-bar">
          <span className="h5-filters__fold-summary">{filterSummary}</span>
          <button type="button" onClick={() => setFilterExpanded((v) => !v)}>
            {filterExpanded ? '收起筛选' : '展开筛选'}
          </button>
        </div>
        {filterExpanded ? (
          <div className="h5-filters__collapsed-panel">
            <div className="h5-filters__label">交易所</div>
            <Selector
              options={EXCHANGE_OPTIONS}
              value={[exchange]}
              onChange={(arr) => {
                if (arr?.[0]) setExchange(arr[0])
              }}
              style={{ marginBottom: 8 }}
            />
            <SearchBar
              placeholder="股票代码 / 简称"
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
        <div className="h5-empty">{isListed ? '暂无已上市数据' : '暂无未上市数据'}</div>
      ) : (
        grouped.map(([date, rows]) => (
          <div key={date}>
            <div className="h5-group-title">
              {isListed ? `上市日 ${date}` : `申购日 ${date}`}
              {!isListed && rows[0]?.issue_weekday ? ` · ${rows[0].issue_weekday}` : ''}
            </div>
            {rows.map((item) => (
              <div
                key={item.id}
                className="h5-news-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  cacheNewShareItem(item)
                  navigate(`/listing/new-share/${item.id}`)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    cacheNewShareItem(item)
                    navigate(`/listing/new-share/${item.id}`)
                  }
                }}
              >
                <h3 className="h5-news-card__title">
                  {item.stock_name || '—'}
                  <span className="h5-code"> {item.stock_code || ''}</span>
                </h3>
                <div className="h5-news-card__meta">
                  <span>{item.exchange || '—'}</span>
                  <span>发行价 {formatAmount(item.issue_price)}</span>
                  <span>募资 {formatYi(item.expected_raise_amount)}</span>
                  {isListed ? (
                    <>
                      <span>首日涨幅 {formatPercent(item.first_day_chg_pct)}</span>
                      <span>市值 {formatMarketCapYiFromYuan(item.first_day_market_cap)}</span>
                    </>
                  ) : null}
                </div>
                <p className="h5-news-card__abstract">
                  {displayEnterpriseName(item)}
                  {' · '}
                  发行 {formatIssueTotalWan(item.issue_total_wan, item.total_issued_shares)} 万股
                  {isListed
                    ? item.issue_date
                      ? ` · 申购 ${item.issue_date}`
                      : ''
                    : item.public_date
                      ? ` · 上市 ${item.public_date}`
                      : ''}
                </p>
              </div>
            ))}
          </div>
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
