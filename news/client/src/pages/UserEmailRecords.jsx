import React, { useState, useEffect } from 'react'
import { Table, Button, Pagination, Message, Skeleton, Card, Tabs, Tag } from '@arco-design/web-react'
import axios from '../utils/axios'
import './UserEmailRecords.css'

const TabPane = Tabs.TabPane

function UserEmailRecords({ activeTab: propActiveTab = 'records' }) {
  const [emailConfigId, setEmailConfigId] = useState('')
  const [activeTab, setActiveTab] = useState(propActiveTab)
  const [records, setRecords] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [logCurrentPage, setLogCurrentPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const pageSize = 10

  useEffect(() => {
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
      Message.error('获取邮件记录失败')
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
      Message.error('获取邮件日志失败')
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

  const getOperationTypeName = (type) => {
    return type === 'send' ? '发送' : '接收'
  }

  const recordsColumns = [
    {
      title: '操作类型',
      dataIndex: 'operation_type',
      width: 120,
      render: (type) => getOperationTypeName(type)
    },
    {
      title: '发件人',
      dataIndex: 'from_email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '收件人',
      dataIndex: 'to_email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '抄送',
      dataIndex: 'cc_email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '密送',
      dataIndex: 'bcc_email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '主题',
      dataIndex: 'subject',
      width: 250,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'success' ? 'green' : 'red'}>
          {status === 'success' ? '成功' : '失败'}
        </Tag>
      )
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 180,
      render: (text) => formatDate(text)
    }
  ]

  const logsColumns = [
    {
      title: '操作类型',
      dataIndex: 'operation_type',
      width: 120,
      render: (type) => getOperationTypeName(type)
    },
    {
      title: '发件人',
      dataIndex: 'from_email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '收件人',
      dataIndex: 'to_email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '主题',
      dataIndex: 'subject',
      width: 250,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'success' ? 'green' : 'red'}>
          {status === 'success' ? '成功' : '失败'}
        </Tag>
      )
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      width: 300,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 180,
      render: (text) => formatDate(text)
    }
  ]

  if (!emailConfigId) {
    return (
      <Card className="empty-card">
        <p style={{ color: '#86909c', textAlign: 'center', margin: 0 }}>
          未找到"新闻舆情"应用的邮件配置
        </p>
      </Card>
    )
  }

  return (
    <div className="user-email-records">
      <Card className="management-card" bordered={false}>
        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          type="line"
          className="email-tabs"
        >
          <TabPane key="records" title="收发记录">
            <div className="table-container">
              {loading && records.length === 0 ? (
                <Skeleton
                  loading={true}
                  animation={true}
                  text={{ rows: 8, width: ['100%'] }}
                />
              ) : (
                <Table
                  columns={recordsColumns}
                  data={records}
                  loading={loading}
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
          </TabPane>

          <TabPane key="logs" title="邮件日志">
            <div className="table-container">
              {loading && logs.length === 0 ? (
                <Skeleton
                  loading={true}
                  animation={true}
                  text={{ rows: 8, width: ['100%'] }}
                />
              ) : (
                <Table
                  columns={logsColumns}
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
              )}
            </div>

            {logTotal > 0 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={logCurrentPage}
                  total={logTotal}
                  pageSize={pageSize}
                  onChange={(page) => setLogCurrentPage(page)}
                  showTotal
                  showJumper
                />
              </div>
            )}
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}

export default UserEmailRecords

