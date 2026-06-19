import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './EmailManagement.css'

function UserEmailRecords({ activeTab: propActiveTab = 'records' }) {
  const [emailConfigId, setEmailConfigId] = useState('')
  const [activeTab, setActiveTab] = useState(propActiveTab) // 'records' 或 'logs'
  const [records, setRecords] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [logCurrentPage, setLogCurrentPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const pageSize = 10

  useEffect(() => {
    // 获取"新闻舆情"应用的邮件配置
    fetchNewsEmailConfig()
  }, [])

  useEffect(() => {
    setActiveTab(propActiveTab)
  }, [propActiveTab])

  useEffect(() => {
    if (emailConfigId) {
      if (activeTab === 'records') {
        fetchRecords()
      } else {
        fetchLogs()
      }
    }
  }, [emailConfigId, activeTab, currentPage, logCurrentPage])

  const fetchNewsEmailConfig = async () => {
    try {
      const response = await axios.get('/api/system/email-configs', {
        params: { page: 1, pageSize: 100 }
      })
      if (response.data.success) {
        // 查找"新闻舆情"应用的邮件配置
        const newsConfig = response.data.data.find(config => config.app_name === '新闻舆情')
        if (newsConfig) {
          setEmailConfigId(newsConfig.id)
        }
      }
    } catch (error) {
      console.error('获取邮件配置列表失败:', error)
    }
  }

  const fetchRecords = async () => {
    if (!emailConfigId) return
    setLoading(true)
    try {
      const response = await axios.get('/api/email/records', {
        params: {
          email_config_id: emailConfigId,
          page: currentPage,
          pageSize: pageSize
        }
      })
      if (response.data.success) {
        setRecords(response.data.data || [])
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取邮件记录失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async () => {
    if (!emailConfigId) return
    setLoading(true)
    try {
      const response = await axios.get('/api/email/logs', {
        params: {
          email_config_id: emailConfigId,
          page: logCurrentPage,
          pageSize: pageSize
        }
      })
      if (response.data.success) {
        setLogs(response.data.data || [])
        setLogTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取邮件日志失败:', error)
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

  const getStatusBadge = (status) => {
    return status === 'success' ? (
      <span className="status-badge active">成功</span>
    ) : (
      <span className="status-badge inactive">失败</span>
    )
  }

  const getOperationTypeName = (type) => {
    return type === 'send' ? '发送' : '接收'
  }

  if (!emailConfigId) {
    return (
      <div style={{ marginTop: '24px', padding: '20px', background: 'white', borderRadius: '8px' }}>
        <p style={{ color: '#999', textAlign: 'center' }}>未找到"新闻舆情"应用的邮件配置</p>
      </div>
    )
  }

  return (
    <div>
      <div className="email-management-content">
        {activeTab === 'records' ? (
          <div className="records-tab">
            {loading ? (
              <div className="loading">加载中...</div>
            ) : records.length === 0 ? (
              <div className="empty-data">暂无邮件记录</div>
            ) : (
              <>
                <table className="email-table">
                  <thead>
                    <tr>
                      <th>操作类型</th>
                      <th>发件人</th>
                      <th>收件人</th>
                      <th>抄送</th>
                      <th>密送</th>
                      <th>主题</th>
                      <th>状态</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td>{getOperationTypeName(record.operation_type)}</td>
                        <td>{record.from_email || '-'}</td>
                        <td>{record.to_email || '-'}</td>
                        <td>{record.cc_email || '-'}</td>
                        <td>{record.bcc_email || '-'}</td>
                        <td>{record.subject || '-'}</td>
                        <td>{getStatusBadge(record.status)}</td>
                        <td>{formatDate(record.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {total > 0 && (
                  <Pagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(total / pageSize)}
                    onPageChange={setCurrentPage}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          <div className="logs-tab">
            {loading ? (
              <div className="loading">加载中...</div>
            ) : logs.length === 0 ? (
              <div className="empty-data">暂无邮件日志</div>
            ) : (
              <>
                <table className="email-table">
                  <thead>
                    <tr>
                      <th>操作类型</th>
                      <th>发件人</th>
                      <th>收件人</th>
                      <th>主题</th>
                      <th>状态</th>
                      <th>错误信息</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{getOperationTypeName(log.operation_type)}</td>
                        <td>{log.from_email || '-'}</td>
                        <td>{log.to_email || '-'}</td>
                        <td>{log.subject || '-'}</td>
                        <td>{getStatusBadge(log.status)}</td>
                        <td className="error-message">{log.error_message || '-'}</td>
                        <td>{formatDate(log.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {logTotal > 0 && (
                  <Pagination
                    currentPage={logCurrentPage}
                    totalPages={Math.ceil(logTotal / pageSize)}
                    onPageChange={setLogCurrentPage}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default UserEmailRecords

