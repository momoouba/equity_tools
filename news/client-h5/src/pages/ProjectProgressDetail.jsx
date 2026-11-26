import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DotLoading, NavBar, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import { cacheProgressItem, readCachedProgressItem } from '../utils/progressCache'
import { formatAmount, formatPercent } from '../utils/listingFormat'

function Row({ label, value }) {
  return (
    <div className="h5-detail__block">
      <h4>{label}</h4>
      <p>{value ?? '—'}</p>
    </div>
  )
}

export default function ProjectProgressDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(() => readCachedProgressItem(id))
  const [loading, setLoading] = useState(!readCachedProgressItem(id))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = readCachedProgressItem(id)
      if (cached) {
        setItem(cached)
        setLoading(false)
      }
      try {
        const res = await axios.get(
          `/api/h5/listing/ipo-project-progress/${encodeURIComponent(id)}`
        )
        if (cancelled) return
        if (res.data?.success && res.data.data) {
          cacheProgressItem(res.data.data)
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
      <NavBar onBack={() => navigate(-1)}>进展详情</NavBar>
      {loading && !item ? (
        <div className="h5-empty">
          <DotLoading />
        </div>
      ) : !item ? (
        <div className="h5-empty">暂无数据</div>
      ) : (
        <div className="h5-detail">
          <h1 className="h5-detail__title">{item.project_name || item.company || '未命名项目'}</h1>
          <div className="h5-news-card__meta" style={{ marginBottom: 8 }}>
            <span className="h5-tag h5-tag--neu">{item.status || '—'}</span>
            <span>{item.exchange || '—'}</span>
            {item.board ? <span>{item.board}</span> : null}
          </div>

          <Row label="企业全称" value={item.company || '—'} />
          <Row label="项目简称" value={item.project_name || '—'} />
          <Row label="归属基金" value={item.fund || '—'} />
          <Row label="归属子基金" value={item.sub || '—'} />
          <Row label="审核状态" value={item.status || '—'} />
          <Row label="交易所" value={item.exchange || '—'} />
          <Row label="板块" value={item.board || '—'} />
          <Row label="更新日期" value={item.f_update_time || '—'} />
          <Row label="投资金额" value={formatAmount(item.inv_amount)} />
          <Row label="剩余金额" value={formatAmount(item.residual_amount)} />
          <Row label="穿透权益占比" value={formatPercent(item.ratio, true)} />
          <Row label="穿透投资金额" value={formatAmount(item.ct_amount)} />
          <Row label="穿透剩余金额" value={formatAmount(item.ct_residual)} />
          <Row
            label="匹配公开公司名"
            value={item.matched_progress_company || item.matched_progress_project_name || '—'}
          />
        </div>
      )}
    </div>
  )
}
