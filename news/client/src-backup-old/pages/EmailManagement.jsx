import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './EmailManagement.css'

function EmailManagement() {
  const [emailConfigs, setEmailConfigs] = useState([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [activeTab, setActiveTab] = useState('records') // 'records' 或 'logs'
  const [records, setRecords] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [logCurrentPage, setLogCurrentPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const pageSize = 10

  // 发送邮件表单
  const [showSendForm, setShowSendForm] = useState(false)
  const [sendFormData, setSendFormData] = useState({
    to_email: '',
    cc_email: '',
    bcc_email: '',
    subject: '',
    content: ''
  })

  useEffect(() => {
    fetchEmailConfigs()
  }, [])

  useEffect(() => {
    if (selectedConfigId) {
      if (activeTab === 'records') {
        fetchRecords()
      } else {
        fetchLogs()
      }
    }
  }, [selectedConfigId, activeTab, currentPage, logCurrentPage])

  const fetchEmailConfigs = async () => {
    try {
      const response = await axios.get('/api/system/email-configs', {
        params: { page: 1, pageSize: 100 }
      })
      if (response.data.success) {
        setEmailConfigs(response.data.data || [])
        if (response.data.data && response.data.data.length > 0 && !selectedConfigId) {
          setSelectedConfigId(response.data.data[0].id)
        }
      }
    } catch (error) {
      console.error('获取邮件配置列表失败:', error)
      alert('获取邮件配置列表失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const fetchRecords = async () => {
    if (!selectedConfigId) return
    setLoading(true)
    try {
      const response = await axios.get('/api/email/records', {
        params: {
          email_config_id: selectedConfigId,
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
      alert('获取邮件记录失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async () => {
    if (!selectedConfigId) return
    setLoading(true)
    try {
      const response = await axios.get('/api/email/logs', {
        params: {
          email_config_id: selectedConfigId,
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
      alert('获取邮件日志失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleSendEmail = async (e) => {
    e.preventDefault()
    if (!selectedConfigId) {
      alert('请先选择邮件配置')
      return
    }
    if (!sendFormData.to_email) {
      alert('请输入收件人邮箱')
      return
    }
    if (!sendFormData.subject) {
      alert('请输入邮件主题')
      return
    }
    if (!sendFormData.content) {
      alert('请输入邮件内容')
      return
    }

    setLoading(true)
    try {
      const response = await axios.post('/api/email/send', {
        email_config_id: selectedConfigId,
        ...sendFormData
      })
      if (response.data.success) {
        alert('邮件发送成功')
        setShowSendForm(false)
        setSendFormData({
          to_email: '',
          cc_email: '',
          bcc_email: '',
          subject: '',
          content: ''
        })
        if (activeTab === 'records') {
          fetchRecords()
        } else {
          fetchLogs()
        }
      } else {
        alert('邮件发送失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('发送邮件失败:', error)
      alert('发送邮件失败：' + (error.response?.data?.message || '未知错误'))
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

  return (
    <div className="email-management">
      <div className="email-management-header">
        <h2>邮件收发管理</h2>
        <div className="header-controls">
          <div className="config-selector">
            <label>选择邮件配置：</label>
            <select
              value={selectedConfigId}
              onChange={(e) => {
                setSelectedConfigId(e.target.value)
                setCurrentPage(1)
                setLogCurrentPage(1)
              }}
              className="config-select"
            >
              <option value="">请选择邮件配置</option>
              {emailConfigs.map(config => (
                <option key={config.id} value={config.id}>
                  {config.app_name || config.id} - {config.from_email}
                </option>
              ))}
            </select>
          </div>
          {selectedConfigId && activeTab === 'records' && (
            <button className="btn-primary" onClick={() => setShowSendForm(true)}>
              发送邮件
            </button>
          )}
        </div>
      </div>

      {selectedConfigId && (
        <div className="email-management-tabs">
          <button
            className={`tab-button ${activeTab === 'records' ? 'active' : ''}`}
            onClick={() => setActiveTab('records')}
          >
            收发记录
          </button>
          <button
            className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            邮件日志
          </button>
        </div>
      )}

      {selectedConfigId ? (
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
      ) : (
        <div className="empty-state">
          <p>请先选择邮件配置</p>
        </div>
      )}

      {/* 发送邮件表单 */}
      {showSendForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>发送邮件</h3>
              <button className="close-btn" onClick={() => setShowSendForm(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSendEmail}>
                <div className="form-group">
                  <label>收件人邮箱 *</label>
                  <input
                    type="text"
                    value={sendFormData.to_email}
                    onChange={(e) => setSendFormData({ ...sendFormData, to_email: e.target.value })}
                    placeholder="多个邮箱用逗号分隔"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>抄送邮箱</label>
                  <input
                    type="text"
                    value={sendFormData.cc_email}
                    onChange={(e) => setSendFormData({ ...sendFormData, cc_email: e.target.value })}
                    placeholder="多个邮箱用逗号分隔"
                  />
                </div>
                <div className="form-group">
                  <label>密送邮箱</label>
                  <input
                    type="text"
                    value={sendFormData.bcc_email}
                    onChange={(e) => setSendFormData({ ...sendFormData, bcc_email: e.target.value })}
                    placeholder="多个邮箱用逗号分隔"
                  />
                </div>
                <div className="form-group">
                  <label>邮件主题 *</label>
                  <input
                    type="text"
                    value={sendFormData.subject}
                    onChange={(e) => setSendFormData({ ...sendFormData, subject: e.target.value })}
                    placeholder="请输入邮件主题"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>邮件内容 *</label>
                  <textarea
                    value={sendFormData.content}
                    onChange={(e) => setSendFormData({ ...sendFormData, content: e.target.value })}
                    placeholder="请输入邮件内容"
                    rows={10}
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => setShowSendForm(false)}>取消</button>
                  <button type="submit" disabled={loading}>
                    {loading ? '发送中...' : '发送'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EmailManagement

