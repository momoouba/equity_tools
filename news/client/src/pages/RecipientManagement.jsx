import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Form, Input, Select, Switch, Tag, Checkbox } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
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
  const [formData, setFormData] = useState({
    recipient_email: '',
    email_subject: '',
    send_frequency: 'daily',
    send_time: '09:00:00',
    is_active: true,
    qichacha_category_codes: null
  })
  const [showLogModal, setShowLogModal] = useState(false)
  const [logRecipientId, setLogRecipientId] = useState(null)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState([])
  const [categoryMap, setCategoryMap] = useState({})

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

  const handleAdd = () => {
    setEditingRecipient(null)
    setFormData({
      recipient_email: '',
      email_subject: '',
      send_frequency: 'daily',
      send_time: '09:00:00',
      is_active: true,
      qichacha_category_codes: null
    })
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
        
        setFormData({
          recipient_email: recipient.recipient_email || '',
          email_subject: recipient.email_subject || '',
          send_frequency: recipient.send_frequency || 'daily',
          send_time: recipient.send_time || '09:00:00',
          is_active: recipient.is_active === 1,
          qichacha_category_codes: categoryCodes
        })
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
          send_frequency: 'daily',
          send_time: '09:00:00',
          is_active: true,
          qichacha_category_codes: null
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

  const getFrequencyName = (frequency) => {
    const frequencyMap = {
      daily: '每天',
      weekly: '每周',
      monthly: '每月'
    }
    return frequencyMap[frequency] || frequency
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
      title: '发送频率',
      dataIndex: 'send_frequency',
      width: 100,
      render: (text) => getFrequencyName(text)
    },
    {
      title: '发送时间',
      dataIndex: 'send_time',
      width: 120,
      render: (text) => formatTime(text)
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
            label="发送频率"
            field="send_frequency"
            rules={[{ required: true, message: '请选择发送频率' }]}
          >
            <Select>
              <Option value="daily">每天</Option>
              <Option value="weekly">每周</Option>
              <Option value="monthly">每月</Option>
            </Select>
          </FormItem>

          <FormItem
            label="发送时间"
            field="send_time"
            rules={[{ required: true, message: '请选择发送时间' }]}
            extra="格式：HH:mm（例如：09:00）"
          >
            <Input
              type="time"
              value={formData.send_time ? formData.send_time.substring(0, 5) : '09:00'}
              onChange={(value) => {
                setFormData({
                  ...formData,
                  send_time: value + ':00'
                })
              }}
            />
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

