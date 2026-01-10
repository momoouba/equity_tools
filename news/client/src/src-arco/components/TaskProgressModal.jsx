import React, { useState, useEffect, useRef } from 'react'
import { Modal, Table, Progress, Spin, Button, Tag } from '@arco-design/web-react'
import axios from '../utils/axios'
import './TaskProgressModal.css'

function TaskProgressModal({ taskId, taskType, onClose }) {
  const [progress, setProgress] = useState({
    status: 'processing',
    message: '任务执行中...',
    details: [],
    startTime: new Date(),
    endTime: null,
    duration: null
  })
  const pollingIntervalRef = useRef(null)
  const maxPollingTime = 10 * 60 * 1000
  const startPollingTime = useRef(Date.now())

  useEffect(() => {
    startPolling()
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [taskId, taskType])

  const startPolling = async () => {
    await fetchProgress()
    pollingIntervalRef.current = setInterval(async () => {
      if (Date.now() - startPollingTime.current > maxPollingTime) {
        stopPolling()
        setProgress(prev => ({
          ...prev,
          status: 'failed',
          message: '任务执行超时，请查看日志了解详情'
        }))
        return
      }
      await fetchProgress()
    }, 2000)
  }

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }

  const fetchProgress = async () => {
    try {
      const response = await axios.get(`/api/scheduled-tasks/${taskId}/logs`, {
        params: {
          page: 1,
          pageSize: 1,
          task_type: taskType
        }
      })

      if (response.data.success && response.data.data && response.data.data.length > 0) {
        const latestLog = response.data.data[0]
        
        if (taskType === 'email') {
          const emailLog = latestLog
          const isSuccess = emailLog.status === 'success'
          const isFailed = emailLog.status === 'failed' || (emailLog.error_message && emailLog.error_message.trim() !== '')
          
          const logTime = new Date(emailLog.created_at).getTime()
          const now = Date.now()
          const timeDiff = now - logTime
          const isRecentLog = timeDiff < 60000
          
          if (isSuccess || (isFailed && isRecentLog)) {
            stopPolling()
            setProgress({
              status: isSuccess ? 'success' : 'failed',
              message: isSuccess 
                ? '邮件发送成功' 
                : `邮件发送失败: ${emailLog.error_message || '未知错误'}`,
              details: [
                { label: '发件人', value: emailLog.from_email || '-' },
                { label: '收件人', value: emailLog.to_email || '-' },
                { label: '主题', value: emailLog.subject || '-' },
                { label: '状态', value: emailLog.status === 'success' ? '成功' : '失败' },
                { label: '时间', value: formatDate(emailLog.created_at) }
              ],
              startTime: new Date(emailLog.created_at),
              endTime: new Date(emailLog.created_at),
              duration: null
            })
          } else {
            const elapsed = Math.round((Date.now() - startPollingTime.current) / 1000)
            setProgress(prev => ({
              ...prev,
              message: `正在发送邮件... (已等待 ${elapsed} 秒)`,
              details: [
                { label: '状态', value: '执行中' },
                { label: '已等待时间', value: `${elapsed} 秒` },
                { label: '提示', value: '邮件发送可能需要一些时间，请稍候...' }
              ]
            }))
          }
        } else if (taskType === 'news_sync') {
          const syncLog = latestLog
          const isSuccess = syncLog.status === 'success'
          const isFailed = syncLog.status === 'failed'
          const isProcessing = syncLog.status === 'processing' || (!syncLog.end_time && syncLog.start_time)
          
          if (isSuccess || isFailed) {
            stopPolling()
            const startTime = new Date(syncLog.start_time)
            const endTime = syncLog.end_time ? new Date(syncLog.end_time) : new Date()
            const duration = syncLog.duration_seconds || Math.round((endTime - startTime) / 1000)
            
            setProgress({
              status: isSuccess ? 'success' : 'failed',
              message: isSuccess 
                ? `同步完成: 成功同步 ${syncLog.synced_count || 0} 条数据` 
                : `同步失败: ${syncLog.error_message || '未知错误'}`,
              details: [
                { label: '执行类型', value: syncLog.execution_type === 'manual' ? '手动触发' : '定时任务' },
                { label: '开始时间', value: formatDate(syncLog.start_time) },
                { label: '结束时间', value: syncLog.end_time ? formatDate(syncLog.end_time) : '-' },
                { label: '耗时', value: `${duration} 秒` },
                { label: '同步数量', value: syncLog.synced_count || 0 },
                { label: '企业/公众号总数', value: syncLog.total_enterprises || 0 },
                { label: '处理数量', value: syncLog.processed_enterprises || 0 },
                { label: '错误数量', value: syncLog.error_count || 0 },
                { label: '状态', value: isSuccess ? '成功' : '失败' }
              ],
              startTime: startTime,
              endTime: endTime,
              duration: duration
            })
          } else if (isProcessing) {
            const startTime = new Date(syncLog.start_time)
            const elapsed = Math.round((Date.now() - startTime.getTime()) / 1000)
            
            setProgress(prev => ({
              ...prev,
              message: `正在同步数据... (已执行 ${elapsed} 秒)`,
              details: [
                { label: '执行类型', value: syncLog.execution_type === 'manual' ? '手动触发' : '定时任务' },
                { label: '开始时间', value: formatDate(syncLog.start_time) },
                { label: '已执行时间', value: `${elapsed} 秒` },
                { label: '同步数量', value: syncLog.synced_count || 0 },
                { label: '企业/公众号总数', value: syncLog.total_enterprises || 0 },
                { label: '处理数量', value: syncLog.processed_enterprises || 0 },
                { label: '错误数量', value: syncLog.error_count || 0 },
                { label: '状态', value: '执行中' }
              ],
              startTime: startTime
            }))
          }
        }
      } else {
        const elapsed = Math.round((Date.now() - startPollingTime.current) / 1000)
        setProgress(prev => ({
          ...prev,
          message: `任务已启动，等待执行... (已等待 ${elapsed} 秒)`,
          details: [
            { label: '状态', value: '等待中' },
            { label: '已等待时间', value: `${elapsed} 秒` },
            { label: '提示', value: taskType === 'email' 
              ? '邮件任务正在准备数据，请稍候...' 
              : '新闻同步任务正在初始化，请稍候...' }
          ]
        }))
      }
    } catch (error) {
      console.error('获取执行进度失败:', error)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  const detailColumns = [
    {
      title: '项目',
      dataIndex: 'label',
      width: 150
    },
    {
      title: '值',
      dataIndex: 'value',
      width: 300
    }
  ]

  return (
    <Modal
      visible={!!taskId}
      title="任务执行进度"
      onCancel={progress.status !== 'processing' ? onClose : undefined}
      footer={progress.status !== 'processing' ? (
        <Button type="primary" onClick={onClose}>
          关闭
        </Button>
      ) : null}
      style={{ width: 600 }}
      closable={progress.status !== 'processing'}
    >
      <div className="task-progress-content">
        <div className="progress-status">
          {progress.status === 'processing' && (
            <Spin style={{ marginRight: 8 }} />
          )}
          {progress.status === 'success' && (
            <Tag color="green" style={{ marginRight: 8 }}>成功</Tag>
          )}
          {progress.status === 'failed' && (
            <Tag color="red" style={{ marginRight: 8 }}>失败</Tag>
          )}
          <span className="status-message">{progress.message}</span>
        </div>
        
        {progress.details && progress.details.length > 0 && (
          <div className="progress-details">
            <Table
              columns={detailColumns}
              data={progress.details}
              pagination={false}
              rowKey="label"
              border={{
                wrapper: true,
                cell: true
              }}
            />
          </div>
        )}

        {progress.status === 'processing' && (
          <div className="progress-hint">
            <p>任务正在执行中，请稍候...</p>
            <p style={{ fontSize: '12px', color: '#86909c', marginTop: '8px' }}>
              此窗口将自动更新进度，任务完成后可以关闭
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default TaskProgressModal

