import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Form, Input, Select, Switch, Tag, Checkbox } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import CronGenerator from '../components/CronGenerator'
import './RecipientManagement.css'

const Option = Select.Option
const FormItem = Form.Item
const TextArea = Input.TextArea

function RecipientManagement() {
  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingRecipient, setEditingRecipient] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [form] = Form.useForm()
  const [formData, setFormData] = useState({
    recipient_email: '',
    email_subject: '',
    cron_expression: '0 0 9 * * ? *', // 默认每天9点执行
    is_active: true,
    qichacha_category_codes: null,
    entity_type: null
  })
  const [showLogModal, setShowLogModal] = useState(false)
  const [logRecipientId, setLogRecipientId] = useState(null)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState([])
  const [categoryMap, setCategoryMap] = useState({})
  const [showCronModal, setShowCronModal] = useState(false)

  useEffect(() => {
    if (showCategoryModal) {
      if (editingRecipient) {
        let categoryCodes = formData.qichacha_category_codes
        if (categoryCodes === null || categoryCodes === undefined) {
          categoryCodes = []
        } else if (typeof categoryCodes === 'string') {
          try {
            categoryCodes = JSON.parse(categoryCodes)
          } catch (e) {
            console.warn('解析qichacha_category_codes失败:', e)
            categoryCodes = []
          }
        }
        if (!Array.isArray(categoryCodes)) {
          categoryCodes = []
        }
        setSelectedCategories(categoryCodes)
      } else {
        if (formData.qichacha_category_codes && Array.isArray(formData.qichacha_category_codes)) {
          setSelectedCategories(formData.qichacha_category_codes)
        } else {
          setSelectedCategories([])
        }
      }
    }
  }, [showCategoryModal, editingRecipient, formData])

  useEffect(() => {
    let isMounted = true
    
    const userData = localStorage.getItem('user')
    if (userData) {
      try {
        const user = JSON.parse(userData)
        if (isMounted) {
          setIsAdmin(user.role === 'admin')
        }
      } catch (e) {
        console.error('解析用户信息失败:', e)
      }
    }
    
    const loadData = async () => {
      setLoading(true)
      try {
        const response = await axios.get('/api/news/recipients', {
          params: {
            page: currentPage,
            pageSize: pageSize
          }
        })
        if (isMounted && response.data && response.data.success) {
          setRecipients(response.data.data || [])
          setTotal(response.data.total || 0)
        } else if (isMounted) {
          setRecipients([])
          setTotal(0)
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
          if (isMounted) {
            setRecipients([])
            setTotal(0)
          }
          return
        }
        console.error('获取收件管理列表失败:', error)
        if (isMounted && currentPage === 1) {
          Message.error('获取列表失败：' + (error.response?.data?.message || '未知错误'))
        }
        if (isMounted) {
          setRecipients([])
          setTotal(0)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }
    
    const loadCategoryMap = async () => {
      try {
        const response = await axios.get('/api/system/qichacha-news-categories', {
          params: {
            page: 1,
            pageSize: 1000
          }
        })
        if (response.data.success && isMounted) {
          const categories = response.data.data || []
          const map = {}
          categories.forEach(cat => {
            map[cat.category_code] = cat.category_name
          })
          setCategoryMap(map)
        }
      } catch (error) {
        console.error('获取企查查类别映射失败:', error)
        try {
          const fallbackResponse = await axios.get('/api/news/qichacha-categories')
          if (fallbackResponse.data.success && isMounted) {
            setCategoryMap(fallbackResponse.data.data || {})
          }
        } catch (fallbackError) {
          console.error('获取企查查类别映射（后备方案）失败:', fallbackError)
        }
      }
    }
    
    loadData()
    loadCategoryMap()
    
    return () => {
      isMounted = false
    }
  }, [currentPage])

  const fetchRecipients = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/news/recipients', {
        params: {
          page: currentPage,
          pageSize: pageSize
        }
      })
      if (response.data && response.data.success) {
        setRecipients(response.data.data || [])
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        setRecipients([])
        setTotal(0)
        return
      }
      console.error('获取收件管理列表失败:', error)
      Message.error('获取列表失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  // 将旧的 send_frequency 和 send_time 转换为 Cron 表达式
  const convertToCronExpression = (sendFrequency, sendTime) => {
    if (!sendFrequency || !sendTime) {
      return '0 0 9 * * ? *' // 默认每天9点
    }
    
    const [hours, minutes] = sendTime.split(':')
    
    if (sendFrequency === 'daily') {
      return `0 ${minutes} ${hours} * * ? *`
    } else if (sendFrequency === 'weekly') {
      return `0 ${minutes} ${hours} ? * 2 *` // 每周一
    } else if (sendFrequency === 'monthly') {
      return `0 ${minutes} ${hours} 1 * ? *` // 每月1号
    }
    
    return '0 0 9 * * ? *'
  }

  const handleAdd = () => {
    setEditingRecipient(null)
    const defaultData = {
      recipient_email: '',
      email_subject: '',
      cron_expression: '0 0 9 * * ? *', // 默认每天9点执行
      is_active: true,
      qichacha_category_codes: null,
      entity_type: null
    }
    setFormData(defaultData)
    form.setFieldsValue(defaultData)
    setSelectedCategories([])
    setShowForm(true)
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/news/recipients/${id}`)
      if (response.data.success) {
        const recipient = response.data.data
        setEditingRecipient(recipient)
        
        let categoryCodes = recipient.qichacha_category_codes
        if (categoryCodes === null || categoryCodes === undefined) {
          categoryCodes = null
        } else if (typeof categoryCodes === 'string') {
          try {
            categoryCodes = JSON.parse(categoryCodes)
          } catch (e) {
            categoryCodes = null
          }
        }
        if (categoryCodes !== null && !Array.isArray(categoryCodes)) {
          categoryCodes = null
        }
        
        // 处理entity_type（可能是JSON字符串、数组或单个值）
        let entityTypes = recipient.entity_type
        if (entityTypes === null || entityTypes === undefined) {
          entityTypes = null
        } else if (typeof entityTypes === 'string') {
          try {
            entityTypes = JSON.parse(entityTypes)
          } catch (e) {
            // 如果不是JSON，可能是单个值，转换为数组
            entityTypes = entityTypes ? [entityTypes] : null
          }
        }
        if (entityTypes !== null && !Array.isArray(entityTypes)) {
          // 如果是单个值，转换为数组
          entityTypes = [entityTypes]
        }
        
        // 优先使用 cron_expression，如果没有则从 send_frequency 和 send_time 转换
        let cronExpression = recipient.cron_expression
        if (!cronExpression && recipient.send_frequency) {
          cronExpression = convertToCronExpression(recipient.send_frequency, recipient.send_time || '09:00:00')
        }
        if (!cronExpression) {
          cronExpression = '0 0 9 * * ? *' // 默认值
        }
        
        const editData = {
          recipient_email: recipient.recipient_email || '',
          email_subject: recipient.email_subject || '',
          cron_expression: cronExpression,
          is_active: recipient.is_active === 1,
          qichacha_category_codes: categoryCodes,
          entity_type: entityTypes
        }
        setFormData(editData)
        form.setFieldsValue(editData)
        const finalCategories = Array.isArray(categoryCodes) ? categoryCodes : []
        setSelectedCategories(finalCategories)
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取收件管理信息失败:', error)
      Message.error('获取信息失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条收件管理记录吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/news/recipients/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchRecipients()
          }
        } catch (error) {
          console.error('删除失败:', error)
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleSendEmail = async (id) => {
    Modal.confirm({
      title: '确认发送',
      content: '确定要发送邮件吗？将发送前一天的舆情信息。',
      onOk: async () => {
        try {
          const response = await axios.post(`/api/news/recipients/${id}/send-email`)
          if (response.data.success) {
            Message.success('邮件发送成功')
          }
        } catch (error) {
          console.error('发送邮件失败:', error)
          Message.error('发送邮件失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleViewLog = (id) => {
    setLogRecipientId(id)
    setShowLogModal(true)
  }

  const handleSubmit = async (values) => {
    try {
      const categoryCodes = formData.qichacha_category_codes !== undefined 
        ? (formData.qichacha_category_codes && formData.qichacha_category_codes.length > 0 ? formData.qichacha_category_codes : null)
        : (selectedCategories.length > 0 ? selectedCategories : null)
      
      const submitData = {
        ...values,
        cron_expression: formData.cron_expression, // 从 formData 中获取 cron_expression
        qichacha_category_codes: categoryCodes
      }
      
      let response
      if (editingRecipient) {
        response = await axios.put(`/api/news/recipients/${editingRecipient.id}`, submitData)
      } else {
        response = await axios.post('/api/news/recipients', submitData)
      }

      if (response && response.data && response.data.success === true) {
        Message.success(editingRecipient ? '更新成功' : '创建成功')
        setShowForm(false)
        setEditingRecipient(null)
        setFormData({
          recipient_email: '',
          email_subject: '',
          cron_expression: '0 0 9 * * ? *',
          is_active: true,
          qichacha_category_codes: null,
          entity_type: null
        })
        setSelectedCategories([])
        setTimeout(() => {
          fetchRecipients().catch(err => {
            console.error('刷新列表失败:', err)
          })
        }, 100)
      } else {
        const errorMsg = response?.data?.message || '响应格式错误'
        Message.error('保存失败：' + errorMsg)
      }
    } catch (error) {
      console.error('保存失败:', error)
      const errorMsg = error.response?.data?.message || error.message || '未知错误'
      Message.error('保存失败：' + errorMsg)
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
        minute: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  const formatTime = (timeString) => {
    if (!timeString) return '-'
    try {
      const [hours, minutes] = timeString.split(':')
      return `${hours}:${minutes}`
    } catch (e) {
      return timeString
    }
  }

  // 格式化 Cron 表达式显示
  const formatCronExpression = (cron) => {
    if (!cron) return '-'
    // 简化显示：如果是常见的表达式，显示友好文本
    if (cron === '0 0 9 * * ? *') return '每天 09:00:00'
    if (cron === '0 0 9 ? * 2 *') return '每周一 09:00:00'
    if (cron === '0 0 9 1 * ? *') return '每月1号 09:00:00'
    return cron
  }

  const columns = [
    ...(isAdmin ? [{
      title: '用户名称',
      dataIndex: 'user_account',
      width: 150,
      render: (text) => text || '-'
    }] : []),
    {
      title: '收件人邮箱',
      dataIndex: 'recipient_email',
      width: 250,
      render: (text) => text ? (
        <div>
          {text.split(',').map((email, index) => (
            <div key={index} style={{ marginBottom: index < text.split(',').length - 1 ? '4px' : '0' }}>
              {email.trim()}
            </div>
          ))}
        </div>
      ) : '-'
    },
    {
      title: '邮件主题',
      dataIndex: 'email_subject',
      width: 200,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: 'Cron表达式',
      dataIndex: 'cron_expression',
      width: 200,
      render: (text, record) => {
        // 兼容旧数据：如果有 send_frequency，显示旧的格式
        if (record.send_frequency && !text) {
          const typeMap = { 'daily': '每天', 'weekly': '每周', 'monthly': '每月' }
          return `${typeMap[record.send_frequency] || record.send_frequency} - ${formatTime(record.send_time || '')}`
        }
        return formatCronExpression(text)
      }
    },
    {
      title: '企业类型',
      dataIndex: 'entity_type',
      width: 200,
      render: (text) => {
        if (!text) return '全部'
        // 处理JSON字符串或数组
        let types = text
        if (typeof text === 'string') {
          try {
            types = JSON.parse(text)
          } catch (e) {
            // 如果不是JSON，可能是单个值
            types = [text]
          }
        }
        if (!Array.isArray(types)) {
          types = [types]
        }
        return types.length > 0 ? types.join('、') : '全部'
      }
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 100,
      render: (isActive) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (text) => formatDate(text)
    },
    {
      title: '操作',
      width: 320,
      render: (_, record) => (
        <Space size={8}>
          <Button
            type="outline"
            size="small"
            onClick={() => handleEdit(record.id)}
          >
            编辑
          </Button>
          <Button
            type="outline"
            size="small"
            status="success"
            onClick={() => handleViewLog(record.id)}
          >
            日志
          </Button>
          <Button
            type="outline"
            size="small"
            status="warning"
            onClick={() => handleSendEmail(record.id)}
          >
            发送邮件
          </Button>
          <Button
            type="outline"
            size="small"
            status="danger"
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="recipient-management">
      <Card className="management-card" bordered={false}>
        <div className="management-header">
          <h2 className="management-title">收件管理</h2>
          <Space>
            <Button
              onClick={fetchRecipients}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              type="primary"
              onClick={handleAdd}
            >
              新增收件人
            </Button>
          </Space>
        </div>

        <div className="table-container">
          {loading && recipients.length === 0 ? (
            <Skeleton
              loading={true}
              animation={true}
              text={{ rows: 8, width: ['100%'] }}
            />
          ) : (
            <Table
              columns={columns}
              data={recipients}
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
      </Card>

      {/* 新增/编辑表单 */}
      <Modal
        visible={showForm}
        title={editingRecipient ? '编辑收件管理' : '新增收件管理'}
        onCancel={() => {
          setShowForm(false)
          setEditingRecipient(null)
        }}
        footer={null}
        style={{ width: 600 }}
      >
        <Form
          form={form}
          initialValues={formData}
          onSubmit={handleSubmit}
          layout="vertical"
        >
          <FormItem
            label="收件人邮箱"
            field="recipient_email"
            rules={[{ required: true, message: '请输入收件人邮箱' }]}
            extra="支持多个邮箱，可用逗号、分号或换行分隔"
          >
            <TextArea
              placeholder="请输入收件人邮箱，多个邮箱可用逗号、分号或换行分隔"
              rows={4}
            />
          </FormItem>

          <FormItem
            label="邮件主题"
            field="email_subject"
          >
            <Input placeholder="请输入邮件主题" />
          </FormItem>

          <FormItem
            label="定时任务规则"
            field="cron_expression"
            rules={[{ required: true, message: '请配置定时任务规则' }]}
            extra='点击"配置"按钮设置定时任务的执行规则，支持秒/分/时/日/月/周/年7个维度的可视化配置'
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Input
                value={formData.cron_expression}
                readOnly
                placeholder="请配置Cron表达式"
                style={{ flex: 1 }}
              />
              <Button
                type="primary"
                onClick={() => setShowCronModal(true)}
              >
                配置
              </Button>
            </div>
          </FormItem>

          <FormItem
            label="企业类型"
            field="entity_type"
            extra="选择要发送的企业类型数据，可多选，不选择则发送所有类型"
          >
            <Select
              mode="multiple"
              placeholder="请选择企业类型（可多选，不选择则发送所有类型）"
              allowClear
              value={formData.entity_type}
              onChange={(value) => {
                setFormData({
                  ...formData,
                  entity_type: value && value.length > 0 ? value : null
                })
              }}
            >
              <Option value="被投企业">被投企业</Option>
              <Option value="基金">基金</Option>
              <Option value="子基金">子基金</Option>
              <Option value="子基金管理人">子基金管理人</Option>
              <Option value="子基金GP">子基金GP</Option>
            </Select>
          </FormItem>

          <FormItem
            label="启用"
            field="is_active"
          >
            <Switch checked={formData.is_active} />
          </FormItem>

          <FormItem
            label="企查查接口消息类型"
          >
            <Button
              type="outline"
              onClick={() => setShowCategoryModal(true)}
            >
              选择消息类型
            </Button>
            {selectedCategories.length > 0 && (
              <p style={{ marginTop: '8px', fontSize: '12px', color: '#165dff' }}>
                已选择 {selectedCategories.length} 个类别
              </p>
            )}
            {selectedCategories.length === 0 && (
              <p style={{ marginTop: '8px', fontSize: '12px', color: '#86909c' }}>
                未选择时，将使用默认类别（80000系列、40000系列、14004）
              </p>
            )}
          </FormItem>

          <div className="form-actions">
            <Button
              type="secondary"
              onClick={() => {
                setShowForm(false)
                setEditingRecipient(null)
              }}
            >
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              {editingRecipient ? '更新' : '创建'}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* 日志弹窗 */}
      {showLogModal && (
        <LogModal
          type="recipient_management"
          id={logRecipientId}
          onClose={() => {
            setShowLogModal(false)
            setLogRecipientId(null)
          }}
        />
      )}

      {/* Cron表达式配置弹窗 */}
      <CronGenerator
        visible={showCronModal}
        value={formData.cron_expression}
        onChange={(cron) => {
          // 同时更新 formData 和 Form 的值
          setFormData({
            ...formData,
            cron_expression: cron
          })
          form.setFieldValue('cron_expression', cron)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />

      {/* 企查查类别选择弹窗 */}
      <Modal
        visible={showCategoryModal}
        title="选择企查查消息类型"
        onCancel={() => setShowCategoryModal(false)}
        footer={null}
        style={{ width: 800 }}
      >
        <div className="category-selection">
          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
            <Button
              type="outline"
              size="small"
              onClick={() => {
                const allCodes = Object.keys(categoryMap)
                setSelectedCategories(allCodes)
              }}
            >
              全选
            </Button>
            <Button
              type="outline"
              size="small"
              onClick={() => setSelectedCategories([])}
            >
              清空
            </Button>
            <Button
              type="outline"
              size="small"
              onClick={() => {
                const allCodes = Object.keys(categoryMap)
                const defaultCodes = allCodes.filter(code => {
                  if (code === '14004') return true
                  if (code.length === 5 && code.startsWith('4')) return true
                  if (code.length === 5 && code.startsWith('8') && code !== '80008') return true
                  return false
                })
                setSelectedCategories(defaultCodes)
              }}
            >
              使用默认类别
            </Button>
          </div>
          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '1px solid #e5e6eb',
            borderRadius: '4px',
            padding: '8px'
          }}>
            {Object.keys(categoryMap).length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#86909c' }}>
                正在加载类别数据...
              </div>
            ) : (
              Object.entries(categoryMap).map(([code, name]) => (
                <div
                  key={code}
                  style={{
                    padding: '8px',
                    marginBottom: '4px',
                    backgroundColor: selectedCategories.includes(code) ? '#e7f3ff' : 'transparent',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    if (selectedCategories.includes(code)) {
                      setSelectedCategories(selectedCategories.filter(c => c !== code))
                    } else {
                      setSelectedCategories([...selectedCategories, code])
                    }
                  }}
                >
                  <Checkbox
                    checked={selectedCategories.includes(code)}
                    onChange={(checked) => {
                      if (checked) {
                        setSelectedCategories([...selectedCategories, code])
                      } else {
                        setSelectedCategories(selectedCategories.filter(c => c !== code))
                      }
                    }}
                  >
                    <span style={{ fontWeight: 600, marginRight: '8px' }}>{code}</span>
                    <span>{name}</span>
                  </Checkbox>
                </div>
              ))
            )}
          </div>
          <div style={{ marginTop: '16px', fontSize: '14px', color: '#4e5969' }}>
            已选择 {selectedCategories.length} 个类别
          </div>
          <div className="form-actions" style={{ marginTop: '16px' }}>
            <Button
              type="secondary"
              onClick={() => {
                setShowCategoryModal(false)
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setFormData({
                  ...formData,
                  qichacha_category_codes: selectedCategories.length > 0 ? selectedCategories : null
                })
                setShowCategoryModal(false)
              }}
            >
              确定
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default RecipientManagement

