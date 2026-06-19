import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button, Space, Spin, Progress, Tag, Message } from '@arco-design/web-react'
import { fetchCompetitorAnalysisSummary } from '../../api/competitor-analysis'
import { copyTextToClipboard } from './introPopoverAiCell'

const POLL_MS = 3000

/**
 * 竞品分析说明弹窗：展示流水线日志；任务进行中时轮询进度（约 x%、当前阶段、ETA）。
 * @param {{ visible: boolean, onClose: () => void, summaryParams: object|null, subjectTitle?: string }} props
 */
export default function CompetitorAnalysisSummaryModal({
  visible,
  onClose,
  summaryParams,
  subjectTitle = '',
}) {
  const [loading, setLoading] = useState(false)
  const [summaryData, setSummaryData] = useState(null)
  const pollTimerRef = useRef(null)

  const load = useCallback(
    async (silent = false) => {
      if (!summaryParams) return
      if (!silent) setLoading(true)
      try {
        const res = await fetchCompetitorAnalysisSummary(summaryParams)
        if (res.data?.success) {
          setSummaryData(res.data.data)
        } else if (!silent) {
          Message.error(res.data?.message || '加载说明失败')
        }
      } catch (err) {
        if (!silent) {
          Message.error(err.response?.data?.message || err.message || '加载说明失败')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [summaryParams]
  )

  useEffect(() => {
    if (!visible) {
      setSummaryData(null)
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return undefined
    }
    load(false)
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [visible, load])

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (!visible || !summaryData?.progress?.is_running) return undefined
    pollTimerRef.current = setInterval(() => load(true), POLL_MS)
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [visible, summaryData?.progress?.is_running, load])

  const progress = summaryData?.progress
  const running = !!progress?.is_running

  return (
    <Modal
      title={subjectTitle ? `竞品分析说明 — ${subjectTitle}` : '竞品分析说明'}
      visible={visible}
      style={{ width: 760 }}
      footer={null}
      onCancel={onClose}
    >
      {loading && !summaryData ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : (
        <>
          {running && progress ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Tag color="arcoblue">{progress.status_label || '分析中'}</Tag>
                <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>
                  约 {progress.percent}% · 已完成 {progress.step_done}/{progress.step_total} 步
                </span>
              </div>
              <Progress percent={progress.percent} animation />
              {progress.current_step_label ? (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-1)' }}>
                  当前阶段：{progress.current_step_label}
                </div>
              ) : null}
              {progress.eta_hint ? (
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-3)' }}>
                  {progress.eta_hint}
                </div>
              ) : null}
              {Array.isArray(progress.completed_steps) && progress.completed_steps.length > 0 ? (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    background: 'var(--color-fill-1)',
                    borderRadius: 4,
                    fontSize: 12,
                    maxHeight: 120,
                    overflow: 'auto',
                  }}
                >
                  {progress.completed_steps.map((s) => (
                    <div key={s.code} style={{ marginBottom: 4 }}>
                      <span style={{ color: 'var(--color-text-3)' }}>{s.code}</span> {s.label}
                      {s.message ? ` — ${s.message}` : ''}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <Space style={{ marginBottom: 12 }}>
            <Button
              type="outline"
              size="mini"
              disabled={!summaryData?.full_text}
              onClick={() => copyTextToClipboard(summaryData?.full_text || '')}
            >
              复制全文
            </Button>
            {running ? (
              <Button type="outline" size="mini" loading={loading} onClick={() => load(true)}>
                刷新进度
              </Button>
            ) : null}
          </Space>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13,
              lineHeight: 1.6,
              maxHeight: running ? 400 : 560,
              overflow: 'auto',
              margin: 0,
              padding: 12,
              background: 'var(--color-fill-1)',
              borderRadius: 4,
            }}
          >
            {summaryData?.full_text || '暂无分析记录，请先发起竞品分析。'}
          </pre>
        </>
      )}
    </Modal>
  )
}
