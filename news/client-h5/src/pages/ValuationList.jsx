import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DotLoading, InfiniteScroll, SearchBar, Tabs, Toast } from 'antd-mobile'
import PageHeader from '../components/PageHeader'
import axios from '../utils/axios'
import { hasValuationPermission } from '../utils/auth'
import { cacheValuationCase } from '../utils/valuationCache'
import {
  displayValuationFullName,
  displayValuationTitle,
  formatConclusionRange,
  formatValuedAt,
  fmtYi,
  resolveCaseId
} from '../utils/valuationFormat'

export default function ValuationList() {
  const navigate = useNavigate()
  const canAccess = hasValuationPermission()
  const [tab, setTab] = useState('pre') // pre | post
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)

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
        const url =
          tab === 'pre' ? '/api/valuation/pre-projects' : '/api/valuation/post-cases'
        const res = await axios.get(url, {
          params: {
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

  if (!canAccess) {
    return <div className="h5-empty">无「项目估值」应用权限</div>
  }

  if (forbidden) {
    return <div className="h5-empty">当前账号无项目估值查看权限</div>
  }

  return (
    <div>
      <div className="h5-filters">
        <PageHeader title="项目估值" subtitle="草稿与已保存结果 · 只读" />
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key)}
          style={{ marginBottom: 4 }}
        >
          <Tabs.Tab title="投前" key="pre" />
          <Tabs.Tab title="投后" key="post" />
        </Tabs>
        <div className="h5-filters__fold-bar">
          <span className="h5-filters__fold-summary">{filterSummary}</span>
          <button type="button" onClick={() => setFilterExpanded((v) => !v)}>
            {filterExpanded ? '收起搜索' : '展开搜索'}
          </button>
        </div>
        {filterExpanded ? (
          <div className="h5-filters__collapsed-panel">
            <SearchBar
              placeholder={tab === 'pre' ? '项目 / 企业 / 信用代码' : '企业 / 简称'}
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
        <div className="h5-empty">{tab === 'pre' ? '暂无投前估值' : '暂无投后估值'}</div>
      ) : (
        list.map((item) => {
          const caseId = resolveCaseId(item, tab)
          const shortName = displayValuationTitle(item, tab)
          const fullName = displayValuationFullName(item, tab)
          const range = formatConclusionRange(item.latest_conclusion)
          const versionCount = Number(item.version_count || 0)
          const key = caseId || `${tab}-${item.id}`
          return (
            <div
              key={key}
              className={`h5-news-card${caseId ? '' : ' h5-news-card--disabled'}`}
              role={caseId ? 'button' : undefined}
              tabIndex={caseId ? 0 : undefined}
              onClick={() => {
                if (!caseId) {
                  Toast.show({ content: '尚未创建估值案件，请用电脑版打开', position: 'bottom' })
                  return
                }
                cacheValuationCase({
                  id: caseId,
                  tab,
                  project_abbreviation: item.project_abbreviation,
                  enterprise_full_name: item.enterprise_full_name || item.display_name,
                  subject_display_name: item.subject_display_name,
                  latest_conclusion: item.latest_conclusion,
                  version_count: versionCount
                })
                navigate(`/valuation/${caseId}`)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && caseId) {
                  navigate(`/valuation/${caseId}`)
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
                <span className="h5-tag h5-tag--neu">
                  {versionCount > 0 ? `已存 ${versionCount} 版` : '仅草稿'}
                </span>
                {item.round_deal_value_yi != null && item.round_deal_value_yi !== '' ? (
                  <span>交易估值 {fmtYi(item.round_deal_value_yi)} 亿</span>
                ) : null}
                {item.latest_valued_at ? (
                  <span>{formatValuedAt(item.latest_valued_at)}</span>
                ) : null}
              </div>
              {range ? (
                <p className="h5-news-card__abstract">最近区间 · {range} 亿</p>
              ) : (
                <p className="h5-news-card__abstract h5-news-card__abstract--empty">
                  {caseId ? '暂无已保存结论（可进详情看草稿）' : '尚未建案'}
                </p>
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
