import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DotLoading, NavBar, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import { cacheNewShareItem, readCachedNewShareItem } from '../utils/newShareCache'
import {
  displayEnterpriseName,
  formatAmount,
  formatIssueTotalWan,
  formatMarketCapYiFromYuan,
  formatPercent,
  formatYi
} from '../utils/listingFormat'

function Row({ label, value }) {
  return (
    <div className="h5-detail__block">
      <h4>{label}</h4>
      <p>{value ?? '—'}</p>
    </div>
  )
}

export default function NewShareDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(() => readCachedNewShareItem(id))
  const [loading, setLoading] = useState(!readCachedNewShareItem(id))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = readCachedNewShareItem(id)
      if (cached) {
        setItem(cached)
        setLoading(false)
      }
      try {
        const res = await axios.get(`/api/h5/listing/new-share/${encodeURIComponent(id)}`)
        if (cancelled) return
        if (res.data?.success && res.data.data) {
          cacheNewShareItem(res.data.data)
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

  return (
    <div className="h5-page--no-tab" style={{ minHeight: '100vh', background: 'var(--h5-bg)' }}>
      <NavBar onBack={() => navigate(-1)}>打新详情</NavBar>
      {loading && !item ? (
        <div className="h5-empty">
          <DotLoading />
        </div>
      ) : !item ? (
        <div className="h5-empty">暂无数据</div>
      ) : (
        <div className="h5-detail">
          <h1 className="h5-detail__title">
            {item.stock_name || '—'}
            <span className="h5-code"> {item.stock_code || ''}</span>
          </h1>
          <div className="h5-news-card__meta" style={{ marginBottom: 8 }}>
            <span>{item.exchange || '—'}</span>
            <span>
              申购 {item.issue_date || '—'}
              {item.issue_weekday ? `（${item.issue_weekday}）` : ''}
            </span>
          </div>

          <Row label="企业全称" value={displayEnterpriseName(item)} />
          <Row label="发行价" value={formatAmount(item.issue_price)} />
          <Row label="发行市盈率" value={formatAmount(item.offer_pe)} />
          <Row label="申购上限" value={formatAmount(item.limit_shares)} />
          <Row
            label="总发行数量（万股）"
            value={formatIssueTotalWan(item.issue_total_wan, item.total_issued_shares)}
          />
          <Row label="预计募资规模" value={formatYi(item.expected_raise_amount)} />
          <Row label="上市日期" value={item.public_date || '—'} />
          <Row label="中签率" value={formatPercent(item.win_rate)} />
          <Row label="上市首日收盘价" value={formatAmount(item.first_day_close)} />
          <Row label="首日涨幅" value={formatPercent(item.first_day_chg_pct)} />
          <Row label="市值" value={formatMarketCapYiFromYuan(item.first_day_market_cap)} />
        </div>
      )}
    </div>
  )
}
