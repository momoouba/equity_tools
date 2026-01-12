import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, Tabs, Card, Form } from '@arco-design/web-react'
import axios from '../utils/axios'
import './EmailManagement.css'

const Option = Select.Option
const TabPane = Tabs.TabPane
const TextArea = Input.TextArea
const FormItem = Form.Item

function EmailManagement() {
  const [emailConfigs, setEmailConfigs] = useState([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [activeTab, setActiveTab] = useState('records')
  const [records, setRecords] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [logCurrentPage, setLogCurrentPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const pageSize = 10
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
      Message.error('获取邮件配置列表失败：' + (error.response?.data?.message || '未知错误'))
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
      Message.error('获取邮件记录失败：' + (error.response?.data?.message || '未知错误'))
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
      Message.error('获取邮件日志失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleSendEmail = async (values) => {
    if (!selectedConfigId) {
      Message.warning('请先选择邮件配置')
      return
    }

    setLoading(true)
    try {
      const response = await axios.post('/api/email/send', {
        email_config_id: selectedConfigId,
        ...values
      })
      if (response.data.success) {
        Message.success('邮件发送成功')
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
      }
    } catch (error) {
      console.error('发送邮件失败:', error)
      Message.error('发送邮件失败：' + (error.response?.data?.message || '未知错误'))
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

  const recordsColumns = [
    {
      title: '操作类型',
      dataIndex: 'operation_type',
      width: 120,
      render: (type) => type === 'send' ? '发送' : '接收'
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
      render: (type) => type === 'send' ? '发送' : '接收'
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

  return (
    <div className="email-management">
      <Card className="management-card" bordered={false}>
        <div className="email-management-header">
          <h2>邮件收发管理</h2>
          <Space>
            <div className="config-selector">
              <label>选择邮件配置：</label>
              <Select
                value={selectedConfigId}
                onChange={(value) => {
                  setSelectedConfigId(value)
                  setCurrentPage(1)
                  setLogCurrentPage(1)
                }}
                placeholder="请选择邮件配置"
                style={{ width: 300 }}
              >
                {emailConfigs.map(config => (
                  <Option key={config.id} value={config.id}>
                    {config.app_name || config.id} - {config.from_email}
                  </Option>
                ))}
              </Select>
            </div>
            {selectedConfigId && activeTab === 'records' && (
              <Button
                type="primary"
                onClick={() => setShowSendForm(true)}
              >
                发送邮件
              </Button>
            )}
          </Space>
        </div>

        {selectedConfigId && (
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
        )}

        {!selectedConfigId && (
          <div className="empty-state">
            <p>请先选择邮件配置</p>
          </div>
        )}
      </Card>

      <Modal
        visible={showSendForm}
        title="发送邮件"
        onCancel={() => {
          setShowSendForm(false)
          setSendFormData({
            to_email: '',
            cc_email: '',
            bcc_email: '',
            subject: '',
            content: ''
          })
        }}
        footer={null}
        style={{ width: 600 }}
      >
        <Form
          initialValues={sendFormData}
          onSubmit={handleSendEmail}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="收件人邮箱"
            field="to_email"
            rules={[{ required: true, message: '请输入收件人邮箱' }]}
          >
            <Input placeholder="多个邮箱用逗号分隔" />
          </Form.Item>

          <Form.Item
            label="抄送邮箱"
            field="cc_email"
          >
            <Input placeholder="多个邮箱用逗号分隔" />
          </Form.Item>

          <Form.Item
            label="密送邮箱"
            field="bcc_email"
          >
            <Input placeholder="多个邮箱用逗号分隔" />
          </Form.Item>

          <Form.Item
            label="邮件主题"
            field="subject"
            rules={[{ required: true, message: '请输入邮件主题' }]}
          >
            <Input placeholder="请输入邮件主题" />
          </Form.Item>

          <Form.Item
            label="邮件内容"
            field="content"
            rules={[{ required: true, message: '请输入邮件内容' }]}
          >
            <TextArea
              placeholder="请输入邮件内容"
              rows={10}
            />
          </Form.Item>

          <div className="form-actions">
            <Button
              type="secondary"
              onClick={() => {
                setShowSendForm(false)
                setSendFormData({
                  to_email: '',
                  cc_email: '',
                  bcc_email: '',
                  subject: '',
                  content: ''
                })
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
            >
              发送
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default EmailManagement

