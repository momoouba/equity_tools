import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import './LogModal.css'

function LogModal({ type, id, onClose }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (id) {
      fetchLogs()
    }
  }, [id, type])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      let apiPath
      if (type === 'enterprise') {
        apiPath = '/api/enterprises'
      } else if (type === 'additional_account') {
        apiPath = '/api/additional-accounts'
      } else if (type === 'email_config') {
        apiPath = '/api/system/email-config'
      } else if (type === 'qichacha_config') {
        apiPath = '/api/system/qichacha-config'
      } else if (type === 'news_config') {
        apiPath = '/api/system/news-config'
      } else if (type === 'recipient_management') {
        apiPath = '/api/news/recipients'
      } else {
        apiPath = '/api/companies'
      }
      const response = await axios.get(`${apiPath}/${id}/logs`)
      if (response.data.success) {
        setLogs(response.data.data)
      }
    } catch (error) {
      console.error('获取日志失败:', error)
      alert('获取日志失败')
    } finally {
      setLoading(false)
    }
  }

  const getFieldName = (field) => {
    const fieldMap = {
      // invested_enterprises 字段
      project_abbreviation: '项目简称',
      enterprise_full_name: '企业全称',
      unified_credit_code: '统一信用代码',
      wechat_official_account_id: '微信公众号id',
      official_website: '官网地址',
      exit_status: '退出状态',
      // company 字段
      enterprise_abbreviation: '企业简称',
      // additional_wechat_accounts 字段
      account_name: '公众号名称',
      wechat_account_id: '账号ID',
      status: '状态',
      // email_config 字段
      app_id: '应用',
      smtp_host: 'SMTP服务器地址',
      smtp_port: 'SMTP端口',
      smtp_secure: 'SMTP使用SSL/TLS',
      smtp_user: 'SMTP用户名',
      from_email: '发件人邮箱',
      from_name: '发件人名称',
      pop_host: 'POP服务器地址',
      pop_port: 'POP端口',
      pop_secure: 'POP使用SSL/TLS',
      pop_user: 'POP用户名',
      is_active: '状态',
      // qichacha_config 字段
      qichacha_app_key: '应用凭证',
      qichacha_daily_limit: '每日查询限制',
      // news_interface_config 字段
      request_url: '请求地址',
      content_type: 'Content-Type',
      frequency_type: '频次类型',
      frequency_value: '频次值',
      // recipient_management 字段
      user_id: '用户ID',
      recipient_email: '收件人邮箱',
      email_subject: '邮件主题',
      send_frequency: '发送频率',
      send_time: '发送时间',
      is_deleted: '删除标志',
      deleted_at: '删除时间',
      deleted_by: '删除人'
    }
    return fieldMap[field] || field
  }

  const formatTime = (time) => {
    if (!time) return '-'
    const date = new Date(time)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content log-modal">
        <div className="modal-header">
          <h3>变更日志</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="log-content">
          {loading ? (
            <div className="loading">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="empty-logs">暂无变更记录</div>
          ) : (
            <div className="log-list">
              {logs.map((log, index) => (
                <div key={log.id} className="log-item">
                  <div className="log-header">
                    <span className="log-time">{formatTime(log.change_time)}</span>
                    <span className="log-user">
                      {log.change_user_account || '未知用户'}
                    </span>
                  </div>
                  <div className="log-body">
                    <div className="log-field">
                      <span className="field-name">{getFieldName(log.changed_field)}</span>
                    </div>
                    <div className="log-change">
                      <div className="old-value">
                        <span className="label">旧值：</span>
                        <span className="value">{log.old_value || '(空)'}</span>
                      </div>
                      <div className="arrow">→</div>
                      <div className="new-value">
                        <span className="label">新值：</span>
                        <span className="value">{log.new_value || '(空)'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-close" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

export default LogModal

