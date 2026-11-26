import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, DotLoading, NavBar, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import { readCachedNewsItem, cacheNewsItem } from '../utils/newsCache'

function sentimentTag(s) {
  const v = String(s || '')
  if (v.includes('正')) return <span className="h5-tag h5-tag--pos">{v}</span>
  if (v.includes('负')) return <span className="h5-tag h5-tag--neg">{v}</span>
  if (v) return <span className="h5-tag h5-tag--neu">{v}</span>
  return null
}

function formatTime(t) {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return String(t)
  return d.toLocaleString('zh-CN', { hour12: false })
}

function projectNameOf(item) {
  const abbr = String(item?.enterprise_abbreviation || '').trim()
  const full = String(item?.enterprise_full_name || '').trim()
  return abbr || full || '未命名项目'
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

  const projectName = item ? projectNameOf(item) : ''
  const fullName = item
    ? String(item.enterprise_full_name || '').trim()
    : ''
  const showFull =
    fullName && fullName !== projectName ? fullName : ''

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
          {/* 项目名 → 换行标题 → 再内容 */}
          <div className="h5-detail__project">{projectName}</div>
          {showFull ? <div className="h5-detail__project-full">{showFull}</div> : null}
          <h1 className="h5-detail__title">{item.title || '无标题'}</h1>
          <div className="h5-news-card__meta" style={{ marginBottom: 8 }}>
            {sentimentTag(item.news_sentiment)}
            <span>{formatTime(item.public_time)}</span>
          </div>

          <div className="h5-detail__block">
            <h4>公众号</h4>
            <p>{item.account_name || item.wechat_account || '—'}</p>
          </div>

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
