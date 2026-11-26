import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DotLoading, NavBar, ProgressBar, Toast } from 'antd-mobile'
import { LoopOutline } from 'antd-mobile-icons'
import axios from '../utils/axios'
import { formatPercent, formatScore } from '../utils/competitorFormat'

export default function CompetitorDetail() {
  const { tab = 'post', id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async ({ silent } = {}) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        const res = await axios.get('/api/h5/competitor/summary', {
          params: { tab, id }
        })
        if (res.data?.success && res.data.data) {
          setData(res.data.data)
        } else if (!silent) {
          Toast.show({ content: res.data?.message || '加载失败', position: 'bottom' })
        }
      } catch (err) {
        if (!silent) {
          Toast.show({
            content: err.response?.data?.message || '加载失败',
            position: 'bottom'
          })
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [tab, id]
  )

  useEffect(() => {
    load()
  }, [load])

  const progress = data?.progress
  const isRunning = !!progress?.is_running

  useEffect(() => {
    if (!isRunning) return undefined
    const timer = setInterval(() => {
      load({ silent: true })
    }, 3000)
    return () => clearInterval(timer)
  }, [isRunning, load])

  const subject = data?.subject || {}
  const title =
    subject.project_abbreviation ||
    subject.enterprise_full_name ||
    subject.project_no ||
    subject.project_number ||
    '竞品详情'
  const fullName =
    subject.enterprise_full_name && subject.enterprise_full_name !== title
      ? subject.enterprise_full_name
      : ''
  const pct = formatPercent(progress?.percent)
  const retained = data?.retained || []
  const completedSteps = progress?.completed_steps || []

  return (
    <div className="h5-page--no-tab" style={{ minHeight: '100vh', background: 'var(--h5-bg)' }}>
      <NavBar
        onBack={() => navigate(-1)}
        right={
          <button
            type="button"
            className="h5-nav-refresh"
            onClick={() => load({ silent: true }).then(() => Toast.show({ content: '已刷新', position: 'bottom' }))}
            disabled={refreshing}
          >
            <LoopOutline fontSize={18} />
          </button>
        }
      >
        竞品详情
      </NavBar>

      {loading && !data ? (
        <div className="h5-empty">
          <DotLoading />
        </div>
      ) : !data ? (
        <div className="h5-empty">暂无数据</div>
      ) : (
        <div className="h5-detail">
          <h1 className="h5-detail__title h5-news-card__title--short">
            {title}
            {fullName ? <span className="h5-news-card__title-company">{fullName}</span> : null}
          </h1>
          <div className="h5-news-card__meta" style={{ marginBottom: 12 }}>
            <span className="h5-tag h5-tag--neu">{tab === 'pre' ? '投前' : '投后'}</span>
            <span className="h5-tag h5-tag--neu">
              {progress?.status_label || data.run_status || '未分析'}
            </span>
            {subject.unified_credit_code ? <span>{subject.unified_credit_code}</span> : null}
          </div>

          <div className="h5-detail__block">
            <h4>分析进度</h4>
            {pct != null ? (
              <div className="h5-competitor-progress">
                <ProgressBar percent={pct} text={`${pct}%`} />
              </div>
            ) : (
              <p className="h5-valuation__sub">暂无进度信息</p>
            )}
            {progress?.current_step_label ? (
              <p className="h5-valuation__line">当前：{progress.current_step_label}</p>
            ) : null}
            {progress?.eta_hint ? (
              <p className="h5-valuation__sub">{progress.eta_hint}</p>
            ) : null}
            {data.run_message ? (
              <p className="h5-valuation__sub">{data.run_message}</p>
            ) : null}
            {isRunning ? (
              <p className="h5-valuation__sub">进行中，约每 3 秒自动刷新；也可点右上角刷新。</p>
            ) : null}

            {completedSteps.length ? (
              <div className="h5-competitor-steps">
                {completedSteps.map((s) => (
                  <div key={`${s.code}-${s.label}`} className="h5-competitor-step">
                    <span className={`h5-competitor-step__dot h5-competitor-step__dot--${s.status === 'failed' ? 'fail' : 'ok'}`} />
                    <div>
                      <div className="h5-competitor-step__label">{s.label || s.code}</div>
                      {s.message ? <div className="h5-competitor-step__msg">{s.message}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="h5-detail__block">
            <h4>最终保留竞品</h4>
            {!retained.length ? (
              <p className="h5-news-card__abstract--empty">
                {isRunning ? '分析进行中，完成后将展示保留竞品' : '暂无落库竞品'}
              </p>
            ) : (
              retained.map((item, idx) => (
                <div key={`${item.competitor_display_name}-${idx}`} className="h5-competitor-result">
                  <div className="h5-competitor-result__head">
                    <strong>{item.competitor_display_name || '—'}</strong>
                    <span>
                      {item.confidence_grade || '—'}级 · {formatScore(item.relevance_score)}分
                    </span>
                  </div>
                  {item.data_sources?.length ? (
                    <p className="h5-valuation__sub">来源：{item.data_sources.join('、')}</p>
                  ) : null}
                  {item.retain_reason ? (
                    <p className="h5-valuation__line">{item.retain_reason}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {data.why_text ? (
            <div className="h5-detail__block">
              <h4>结果说明</h4>
              <p className="h5-valuation__line" style={{ whiteSpace: 'pre-wrap' }}>
                {data.why_text}
              </p>
            </div>
          ) : null}

          {data.process_text ? (
            <div className="h5-detail__block">
              <h4>过程摘要</h4>
              <p className="h5-valuation__line" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {data.process_text}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
