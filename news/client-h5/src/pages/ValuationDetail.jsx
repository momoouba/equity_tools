import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DotLoading, NavBar, Selector, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import ValuationOverview from '../components/ValuationOverview'
import { cacheValuationCase, readCachedValuationCase } from '../utils/valuationCache'
import { formatValuedAt, fmtYi } from '../utils/valuationFormat'

export default function ValuationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(() => readCachedValuationCase(id))
  const [loading, setLoading] = useState(!readCachedValuationCase(id)?.versions)
  const [viewKey, setViewKey] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = readCachedValuationCase(id)
      if (cached?.versions) {
        setItem(cached)
        setLoading(false)
      }
      try {
        const res = await axios.get(`/api/h5/valuation/cases/${encodeURIComponent(id)}`)
        if (cancelled) return
        if (res.data?.success && res.data.data) {
          cacheValuationCase(res.data.data)
          setItem(res.data.data)
        } else if (!cached) {
          Toast.show({ content: res.data?.message || '未找到案件', position: 'bottom' })
        }
      } catch (err) {
        if (!cancelled && !cached) {
          Toast.show({
            content: err.response?.data?.message || '加载失败',
            position: 'bottom'
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const viewOptions = useMemo(() => {
    if (!item) return []
    const opts = [{ label: '当前草稿', value: 'draft' }]
    for (const v of item.versions || []) {
      opts.push({ label: `v${v.version_no}`, value: String(v.id) })
    }
    return opts
  }, [item])

  useEffect(() => {
    if (!item || viewKey) return
    if (item.versions?.length) {
      setViewKey(String(item.versions[0].id))
    } else {
      setViewKey('draft')
    }
  }, [item, viewKey])

  const overview = useMemo(() => {
    if (!item || !viewKey) return null
    if (viewKey === 'draft') return item.draft?.overview || item.draft?.football || null
    const ver = (item.versions || []).find((v) => String(v.id) === viewKey)
    return ver?.overview || ver?.football || null
  }, [item, viewKey])

  const shortName =
    item?.project_abbreviation ||
    item?.subject_display_name ||
    item?.enterprise_full_name ||
    '估值详情'
  const fullName =
    item?.enterprise_full_name && item.enterprise_full_name !== shortName
      ? item.enterprise_full_name
      : item?.subject_display_name && item.subject_display_name !== shortName
        ? item.subject_display_name
        : ''
  const caseTypeLabel =
    item?.case_type === 'post_investment'
      ? '投后'
      : item?.case_type === 'pre_investment'
        ? '投前'
        : ''

  return (
    <div className="h5-page--no-tab" style={{ minHeight: '100vh', background: 'var(--h5-bg)' }}>
      <NavBar onBack={() => navigate(-1)}>估值详情</NavBar>
      {loading && !item ? (
        <div className="h5-empty">
          <DotLoading />
        </div>
      ) : !item ? (
        <div className="h5-empty">暂无数据</div>
      ) : (
        <div className="h5-detail">
          <h1 className="h5-detail__title h5-news-card__title--short">
            {shortName}
            {fullName ? (
              <span className="h5-news-card__title-company">{fullName}</span>
            ) : null}
          </h1>
          <div className="h5-news-card__meta" style={{ marginBottom: 12 }}>
            {caseTypeLabel ? <span className="h5-tag h5-tag--neu">{caseTypeLabel}</span> : null}
            {item.round_deal_value_yi != null && item.round_deal_value_yi !== '' ? (
              <span>交易估值 {fmtYi(item.round_deal_value_yi)} 亿</span>
            ) : null}
            {item.unified_credit_code ? <span>{item.unified_credit_code}</span> : null}
          </div>

          <div className="h5-detail__block">
            <h4>计算输出 · 总览</h4>
            {viewOptions.length > 1 ? (
              <Selector
                options={viewOptions}
                value={viewKey ? [viewKey] : []}
                onChange={(arr) => {
                  if (arr?.[0]) setViewKey(arr[0])
                }}
                style={{ marginBottom: 10 }}
              />
            ) : null}
            <ValuationOverview overview={overview} />
          </div>

          {(item.versions || []).length ? (
            <div className="h5-detail__block">
              <h4>已保存版本</h4>
              {item.versions.map((v) => (
                <div key={v.id} className="h5-valuation__version">
                  <div className="h5-valuation__version-head">
                    <button
                      type="button"
                      className="h5-valuation-version-link"
                      onClick={() => setViewKey(String(v.id))}
                    >
                      v{v.version_no}
                    </button>
                    <span>{formatValuedAt(v.created_at) || '—'}</span>
                  </div>
                  {v.remark ? <p className="h5-valuation__sub">备注：{v.remark}</p> : null}
                  {v.round_deal_value_yi != null && v.round_deal_value_yi !== '' ? (
                    <p className="h5-valuation__sub">
                      交易估值 {fmtYi(v.round_deal_value_yi)} 亿
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
