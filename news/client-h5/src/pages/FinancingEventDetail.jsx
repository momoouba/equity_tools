import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DotLoading, NavBar, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import { cacheFinancingItem, readCachedFinancingItem } from '../utils/financingCache'
import {
  displayFundingAmt,
  displayRound,
  displayTrack,
  formatEventDate
} from '../utils/financingFormat'

function Row({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="h5-detail__block">
      <h4>{label}</h4>
      <p>{value}</p>
    </div>
  )
}

export default function FinancingEventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(() => readCachedFinancingItem(id))
  const [loading, setLoading] = useState(!readCachedFinancingItem(id))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = readCachedFinancingItem(id)
      if (cached) {
        setItem(cached)
        setLoading(false)
      }
      try {
        const res = await axios.get(`/api/h5/financing-events/${encodeURIComponent(id)}`)
        if (cancelled) return
        if (res.data?.success && res.data.data) {
          cacheFinancingItem(res.data.data)
          setItem(res.data.data)
        } else if (!cached) {
          Toast.show({ content: res.data?.message || '未找到记录', position: 'bottom' })
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

  const industry = [item?.industry_source_lv1, item?.industry_source_lv2].filter(Boolean).join(' / ')

  return (
    <div className="h5-page--no-tab" style={{ minHeight: '100vh', background: 'var(--h5-bg)' }}>
      <NavBar onBack={() => navigate(-1)}>融资详情</NavBar>
      {loading && !item ? (
        <div className="h5-empty">
          <DotLoading />
        </div>
      ) : !item ? (
        <div className="h5-empty">暂无数据</div>
      ) : (
        <div className="h5-detail">
          <h1 className="h5-detail__title">{item.company_name || item.project_name || '未命名企业'}</h1>
          <div className="h5-news-card__meta" style={{ marginBottom: 8 }}>
            <span>{formatEventDate(item.event_date)}</span>
            <span className="h5-tag h5-tag--neu">{displayRound(item)}</span>
            <span>{displayFundingAmt(item)}</span>
          </div>

          <Row label="项目名称" value={item.project_name || '—'} />
          <Row label="融资轮次" value={displayRound(item)} />
          <Row label="融资金额" value={displayFundingAmt(item)} />
          <Row label="投后估值" value={item.post_valuation_raw || null} />
          <Row label="赛道" value={displayTrack(item)} />
          <Row label="行业" value={industry || null} />
          <Row label="投资方" value={item.investor_names || null} />
          <Row label="领投方" value={item.lead_investor || null} />
          <Row label="融资状态" value={item.funding_status || null} />
          <Row label="统一社会信用代码" value={item.company_credit_code || null} />
          <Row label="事件 ID" value={item.event_id || null} />
          <Row label="产品介绍" value={item.ai_product_intro || null} />
          <Row label="企业标签" value={item.ai_company_tags_display || null} />
          <Row label="项目简介" value={item.project_desc || null} />
        </div>
      )}
    </div>
  )
}