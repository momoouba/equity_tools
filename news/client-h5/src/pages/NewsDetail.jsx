import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, DotLoading, NavBar, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import { readCachedNewsItem, cacheNewsItem } from '../utils/newsCache'
import { formatNewsSentiment, newsCardHeader } from '../utils/newsSentiment'

function SentimentBadge({ news }) {
  const { text, tone } = formatNewsSentiment(news)
  return <span className={`h5-senti h5-senti--${tone}`}>{text}</span>
}

function formatTime(t) {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return String(t)
  return d.toLocaleString('zh-CN', { hour12: false })
}

export default function NewsDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(() => readCachedNewsItem(id))
  const [loading, setLoading] = useState(!readCachedNewsItem(id))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = readCachedNewsItem(id)
      if (cached) {
        setItem(cached)
        setLoading(false)
      }
      try {
        const res = await axios.get(`/api/h5/news/${encodeURIComponent(id)}`)
        if (cancelled) return
        if (res.data?.success && res.data.data) {
          cacheNewsItem(res.data.data)
          setItem(res.data.data)
        } else if (!cached) {
          Toast.show({ content: res.data?.message || '未找到该舆情', position: 'bottom' })
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

  const header = item ? newsCardHeader(item) : null

  return (
    <div className="h5-page--no-tab" style={{ minHeight: '100vh', background: 'var(--h5-bg)' }}>
      <NavBar onBack={() => navigate(-1)}>舆情详情</NavBar>
      {loading && !item ? (
        <div className="h5-empty">
          <DotLoading />
        </div>
      ) : !item ? (
        <div className="h5-empty">暂无数据</div>
      ) : (
        <div className="h5-detail">
          <h1 className="h5-detail__title h5-news-card__title--short">
            {header.primary}
            {header.secondary ? (
              <span className="h5-news-card__title-company">{header.secondary}</span>
            ) : null}
          </h1>
          <div className="h5-news-card__headline" style={{ marginBottom: 8 }}>
            {item.title || '无标题'}
          </div>
          <div className="h5-news-card__senti-row" style={{ marginBottom: 8 }}>
            <SentimentBadge news={item} />
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--h5-muted)' }}>
              {formatTime(item.public_time)}
            </span>
          </div>

          {!header.thirdParty ? (
            <div className="h5-detail__block">
              <h4>公众号</h4>
              <p>{item.account_name || item.wechat_account || '—'}</p>
            </div>
          ) : null}

          {item.entity_type ? (
            <div className="h5-detail__block">
              <h4>主体类型</h4>
              <p>{item.entity_type}</p>
            </div>
          ) : null}

          <div className="h5-detail__block">
            <h4>摘要</h4>
            <p>
              {String(item.news_abstract || item.newsAbstract || item.summary || '').trim() ||
                '暂无摘要'}
            </p>
          </div>

          {item.source_url ? (
            <div style={{ marginTop: 20 }}>
              <Button
                block
                color="primary"
                onClick={() => window.open(item.source_url, '_blank', 'noopener,noreferrer')}
              >
                打开原文
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
