import React, { useState, useEffect } from 'react'
import { Modal, Table, Message, Spin } from '@arco-design/web-react'
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
      } else if (type === 'shanghai_international_group_config') {
        apiPath = '/api/system/shanghai-international-group-config'
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
      Message.error('获取日志失败')
    } finally {
      setLoading(false)
    }
  }

  const getFieldName = (field) => {
    const fieldMap = {
      project_abbreviation: '项目简称',
      enterprise_full_name: '企业全称',
      unified_credit_code: '统一信用代码',
      wechat_official_account_id: '微信公众号id',
      official_website: '官网地址',
      exit_status: '退出状态',
      enterprise_abbreviation: '企业简称',
      account_name: '公众号名称',
      wechat_account_id: '账号ID',
      status: '状态',
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
      qichacha_app_key: '应用凭证',
      qichacha_daily_limit: '每日查询限制',
      x_app_id: 'X-App-Id',
      api_key: 'APIkey',
      daily_limit: '每日查询限制',
      request_url: '请求地址',
      content_type: 'Content-Type',
      frequency_type: '频次类型',
      frequency_value: '频次值',
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

  const columns = [
    {
      title: '变更时间',
      dataIndex: 'change_time',
      width: 180,
      render: (text) => formatTime(text)
    },
    {
      title: '操作人',
      dataIndex: 'change_user_account',
      width: 150,
      render: (text) => text || '未知用户'
    },
    {
      title: '变更字段',
      dataIndex: 'changed_field',
      width: 150,
      render: (text) => getFieldName(text)
    },
    {
      title: '旧值',
      dataIndex: 'old_value',
      width: 200,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '(空)'
    },
    {
      title: '新值',
      dataIndex: 'new_value',
      width: 200,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '(空)'
    }
  ]

  return (
    <Modal
      visible={true}
      title="变更日志"
      onCancel={onClose}
      footer={null}
      style={{ width: 900 }}
    >
      <div className="log-content">
        {loading ? (
          <Spin style={{ width: '100%', padding: '40px' }} />
        ) : logs.length === 0 ? (
          <div className="empty-logs">暂无变更记录</div>
        ) : (
          <Table
            columns={columns}
            data={logs}
            pagination={false}
            rowKey="id"
            border={{
              wrapper: true,
              cell: true
            }}
            stripe
          />
        )}
      </div>
    </Modal>
  )
}

export default LogModal

