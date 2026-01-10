import React, { useState, useEffect } from 'react'
import { Modal, Table, Pagination, Spin, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './TaskLogModal.css'

function TaskLogModal({ taskId, taskType, onClose }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10

  useEffect(() => {
    if (taskId) {
      fetchTaskLogs()
    }
  }, [taskId, taskType, currentPage])

  const fetchTaskLogs = async () => {
    if (!taskId) return
    setLoading(true)
    try {
      const response = await axios.get(`/api/scheduled-tasks/${taskId}/logs`, {
        params: {
          page: currentPage,
          pageSize: pageSize,
          task_type: taskType === 'email' ? 'email' : 'news_sync'
        }
      })
      if (response.data.success) {
        setLogs(response.data.data || [])
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取定时任务日志失败:', error)
      Message.error('获取定时任务日志失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
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

  const columns = [
    {
      title: '执行时间',
      dataIndex: 'execution_time',
      width: 180,
      render: (text) => formatDate(text)
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => {
        const statusMap = {
          'success': { text: '成功', color: 'green' },
          'failed': { text: '失败', color: 'red' },
          'processing': { text: '执行中', color: 'blue' }
        }
        const statusInfo = statusMap[status] || { text: status, color: 'gray' }
        return (
          <span style={{ color: statusInfo.color, fontWeight: 500 }}>
            {statusInfo.text}
          </span>
        )
      }
    },
    {
      title: '消息',
      dataIndex: 'message',
      width: 300,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      width: 400,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    }
  ]

  return (
    <Modal
      visible={!!taskId}
      title="定时任务日志"
      onCancel={onClose}
      footer={null}
      style={{ width: 900 }}
    >
      <div className="task-log-content">
        {loading && logs.length === 0 ? (
          <Spin style={{ width: '100%', padding: '40px' }} />
        ) : logs.length === 0 ? (
          <div className="empty-logs">暂无日志记录</div>
        ) : (
          <>
            <Table
              columns={columns}
              data={logs}
              loading={loading}
              pagination={false}
              rowKey="id"
              border={{
                wrapper: true,
                cell: true
              }}
              stripe
            />
            {total > 0 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={currentPage}
                  total={total}
                  pageSize={pageSize}
                  onChange={(page) => setCurrentPage(page)}
                  showTotal
                  showJumper
                />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

export default TaskLogModal

