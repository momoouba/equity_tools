import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber, Switch } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import './EmailConfig.css'

const Option = Select.Option

function EmailConfig() {
  const [configs, setConfigs] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [testing, setTesting] = useState(null)
  const [testResult, setTestResult] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [hasSmtpPassword, setHasSmtpPassword] = useState(false)
  const [hasPopPassword, setHasPopPassword] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logConfigId, setLogConfigId] = useState(null)
  const [formData, setFormData] = useState({
    app_id: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: '',
    smtp_password: '',
    from_email: '',
    from_name: '',
    pop_host: '',
    pop_port: 110,
    pop_secure: false,
    pop_user: '',
    pop_password: '',
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/email-configs', {
        params: {
          page: currentPage,
          pageSize: pageSize
        }
      })
      if (response.data.success) {
        setConfigs(response.data.data)
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取邮件配置列表失败:', error)
      Message.error('获取配置列表失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchApplications = async () => {
    try {
      const response = await axios.get('/api/system/applications')
      if (response.data.success) {
        setApplications(response.data.data)
      }
    } catch (error) {
      console.error('获取应用列表失败:', error)
    }
  }

  const handleAdd = () => {
    setEditingConfig(null)
    setHasSmtpPassword(false)
    setHasPopPassword(false)
    setFormData({
      app_id: '',
      smtp_host: '',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: '',
      smtp_password: '',
      from_email: '',
      from_name: '',
      pop_host: '',
      pop_port: 110,
      pop_secure: false,
      pop_user: '',
      pop_password: '',
      is_active: true
    })
    setShowForm(true)
    setTestResult('')
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/email-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasSmtpPassword(true)
        setHasPopPassword(!!config.pop_user)
        setFormData({
          app_id: config.app_id,
          smtp_host: config.smtp_host,
          smtp_port: config.smtp_port,
          smtp_secure: config.smtp_secure === 1,
          smtp_user: config.smtp_user,
          smtp_password: '',
          from_email: config.from_email,
          from_name: config.from_name || '',
          pop_host: config.pop_host || '',
          pop_port: config.pop_port || 110,
          pop_secure: config.pop_secure === 1,
          pop_user: config.pop_user || '',
          pop_password: '',
          is_active: config.is_active === 1
        })
        setShowForm(true)
        setTestResult('')
      }
    } catch (error) {
      console.error('获取邮件配置失败:', error)
      Message.error('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个邮件配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/email-config/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchConfigs()
          }
        } catch (error) {
          console.error('删除失败:', error)
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleChange = (name, value) => {
    setFormData({
      ...formData,
      [name]: value
    })
    setTestResult('')
    
    if (name === 'smtp_password' && value !== '') {
      setHasSmtpPassword(false)
    }
    if (name === 'pop_password' && value !== '') {
      setHasPopPassword(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.app_id || !formData.smtp_host || !formData.smtp_user || (!formData.smtp_password && !editingConfig) || !formData.from_email) {
      Message.warning('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.smtp_password || updateData.smtp_password.trim() === '' || updateData.smtp_password === '****') {
          delete updateData.smtp_password
        }
        if (!updateData.pop_password || updateData.pop_password.trim() === '' || updateData.pop_password === '****') {
          delete updateData.pop_password
        }
        response = await axios.put(`/api/system/email-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/email-config', formData)
      }

      if (response.data.success) {
        Message.success(editingConfig ? '更新成功' : '创建成功')
        setShowForm(false)
        setEditingConfig(null)
        fetchConfigs()
      }
    } catch (error) {
      console.error('保存失败:', error)
      Message.error('保存失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleTest = async () => {
    const smtpPassword = (formData.smtp_password === '****' || formData.smtp_password === '') ? '' : formData.smtp_password
    if (!formData.smtp_host || !formData.smtp_port || !formData.smtp_user || !smtpPassword || !formData.from_email) {
      Message.warning('请先填写完整的SMTP配置信息')
      return
    }

    const email = window.prompt('请输入测试邮箱地址：', testEmail || formData.from_email || '')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (email !== null) {
        Message.error('请输入有效的测试邮箱地址')
      }
      return
    }

    setTestEmail(email)
    setTesting('form')
    setTestResult('')

    try {
      if (editingConfig && editingConfig.id) {
        const response = await axios.post(`/api/system/email-config/${editingConfig.id}/test`, {
          test_email: email
        })

        if (response.data.success) {
          setTestResult('success: ' + (response.data.message || '测试成功'))
          Message.success('测试邮件已发送，请查收！\n' + response.data.message)
        } else {
          setTestResult('error: ' + (response.data.message || '测试失败'))
          Message.error('测试失败：' + (response.data.message || '未知错误'))
        }
      } else {
        let smtpPassword = formData.smtp_password
        if (smtpPassword === '****') {
          Message.warning('请先输入SMTP密码才能进行测试')
          setTesting(null)
          return
        }
        
        const testData = {
          smtp_host: formData.smtp_host,
          smtp_port: formData.smtp_port,
          smtp_secure: formData.smtp_secure,
          smtp_user: formData.smtp_user,
          smtp_password: smtpPassword,
          from_email: formData.from_email,
          from_name: formData.from_name,
          test_email: email
        }
        
        const response = await axios.post('/api/system/email-config/test', testData)

        if (response.data.success) {
          setTestResult('success: ' + (response.data.message || '测试成功'))
          Message.success('测试邮件已发送，请查收！\n' + response.data.message)
        } else {
          setTestResult('error: ' + (response.data.message || '测试失败'))
          Message.error('测试失败：' + (response.data.message || '未知错误'))
        }
      }
    } catch (error) {
      console.error('测试失败:', error)
      const errorMsg = error.response?.data?.message || '测试失败'
      setTestResult('error: ' + errorMsg)
      Message.error('测试失败：' + errorMsg)
    } finally {
      setTesting(null)
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

  const columns = [
    {
      title: '应用',
      dataIndex: 'app_name',
      width: 150,
      render: (text) => text || '-'
    },
    {
      title: 'SMTP服务器地址',
      dataIndex: 'smtp_host',
      width: 180,
      render: (text) => text || '-'
    },
    {
      title: 'POP服务器地址',
      dataIndex: 'pop_host',
      width: 180,
      render: (text) => text || '-'
    },
    {
      title: '发件人邮箱',
      dataIndex: 'from_email',
      width: 200
    },
    {
      title: '发件人名称',
      dataIndex: 'from_name',
      width: 150,
      render: (text) => text || '-'
    },
    {
      title: '收件人名称',
      dataIndex: 'pop_user',
      width: 150,
      render: (text) => text || '-'
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
      width: 200,
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
            onClick={() => {
              setLogConfigId(record.id)
              setShowLogModal(true)
            }}
          >
            日志
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
    <div className="email-config">
      <div className="config-header">
        <h3>邮件发送配置</h3>
        <Space>
          <Button
            onClick={fetchConfigs}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            onClick={handleAdd}
          >
            新增配置
          </Button>
        </Space>
      </div>

      <div className="table-container">
        {loading && configs.length === 0 ? (
          <Skeleton
            loading={true}
            animation={true}
            text={{ rows: 8, width: ['100%'] }}
          />
        ) : (
          <Table
            columns={columns}
            data={configs}
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

      {/* 分页 */}
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

      {/* 新增/编辑表单 */}
      <Modal
        visible={showForm}
        title={editingConfig ? '编辑邮件配置' : '新增邮件配置'}
        onCancel={() => {
          setShowForm(false)
          setEditingConfig(null)
          setTestResult('')
        }}
        footer={null}
        style={{ width: 700 }}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>应用 *</label>
            <Select
              value={formData.app_id}
              onChange={(value) => handleChange('app_id', value)}
              placeholder="请选择应用"
              disabled={!!editingConfig}
            >
              {applications.map((app) => (
                <Option key={app.id} value={app.id}>
                  {app.app_name}
                </Option>
              ))}
            </Select>
            <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置邮件的应用'}</p>
          </div>

          <div className="form-group">
            <label>SMTP服务器地址 *</label>
            <Input
              value={formData.smtp_host}
              onChange={(value) => handleChange('smtp_host', value)}
              placeholder="例如：smtp.qq.com"
            />
          </div>

          <div className="form-group">
            <label>SMTP端口 *</label>
            <InputNumber
              value={formData.smtp_port}
              onChange={(value) => handleChange('smtp_port', value)}
              min={1}
              max={65535}
              style={{ width: '100%' }}
            />
            <p className="form-hint">常用端口：25, 465(SSL), 587(TLS)</p>
          </div>

          <div className="form-group">
            <label>
              <Switch
                checked={formData.smtp_secure}
                onChange={(checked) => handleChange('smtp_secure', checked)}
                style={{ marginRight: 8 }}
              />
              使用SSL/TLS
            </label>
            <p className="form-hint">端口465通常需要启用，端口587通常不需要</p>
          </div>

          <div className="form-group">
            <label>SMTP用户名（邮箱地址）*</label>
            <Input
              type="email"
              value={formData.smtp_user}
              onChange={(value) => handleChange('smtp_user', value)}
              placeholder="例如：user@example.com"
            />
          </div>

          <div className="form-group">
            <label>SMTP密码/授权码 *</label>
            <Input.Password
              value={hasSmtpPassword && !formData.smtp_password ? '****' : formData.smtp_password}
              onChange={(value) => handleChange('smtp_password', value)}
              onFocus={(e) => {
                if (hasSmtpPassword && e.target.value === '****') {
                  setHasSmtpPassword(false)
                  setFormData({ ...formData, smtp_password: '' })
                }
              }}
              placeholder={editingConfig ? (hasSmtpPassword ? '****' : '留空则不更新密码') : '请输入SMTP密码或授权码'}
            />
            <p className="form-hint">{editingConfig ? '留空则不更新密码' : '请输入SMTP密码或授权码'}</p>
          </div>

          <div className="form-group">
            <label>发件人邮箱 *</label>
            <Input
              type="email"
              value={formData.from_email}
              onChange={(value) => handleChange('from_email', value)}
              placeholder="例如：noreply@example.com"
            />
          </div>

          <div className="form-group">
            <label>发件人名称</label>
            <Input
              value={formData.from_name}
              onChange={(value) => handleChange('from_name', value)}
              placeholder="例如：系统通知"
            />
          </div>

          <div className="form-section-divider">
            <h4>POP接收配置（可选）</h4>
            <p className="form-hint">用于接收邮件的POP服务器配置，如不需要接收邮件可留空</p>
          </div>

          <div className="form-group">
            <label>POP服务器地址</label>
            <Input
              value={formData.pop_host}
              onChange={(value) => handleChange('pop_host', value)}
              placeholder="例如：pop.qq.com"
            />
          </div>

          <div className="form-group">
            <label>POP端口</label>
            <InputNumber
              value={formData.pop_port}
              onChange={(value) => handleChange('pop_port', value)}
              min={1}
              max={65535}
              style={{ width: '100%' }}
            />
            <p className="form-hint">常用端口：110, 995(SSL)</p>
          </div>

          <div className="form-group">
            <label>
              <Switch
                checked={formData.pop_secure}
                onChange={(checked) => handleChange('pop_secure', checked)}
                style={{ marginRight: 8 }}
              />
              POP使用SSL/TLS
            </label>
            <p className="form-hint">端口995通常需要启用，端口110通常不需要</p>
          </div>

          <div className="form-group">
            <label>POP用户名（邮箱地址）</label>
            <Input
              type="email"
              value={formData.pop_user}
              onChange={(value) => handleChange('pop_user', value)}
              placeholder="例如：user@example.com"
            />
          </div>

          <div className="form-group">
            <label>POP密码/授权码</label>
            <Input.Password
              value={hasPopPassword && !formData.pop_password ? '****' : formData.pop_password}
              onChange={(value) => handleChange('pop_password', value)}
              onFocus={(e) => {
                if (hasPopPassword && e.target.value === '****') {
                  setHasPopPassword(false)
                  setFormData({ ...formData, pop_password: '' })
                }
              }}
              placeholder={editingConfig ? (hasPopPassword ? '****' : '留空则不更新密码') : '请输入POP密码或授权码'}
            />
          </div>

          <div className="form-group">
            <label>
              <Switch
                checked={formData.is_active}
                onChange={(checked) => handleChange('is_active', checked)}
                style={{ marginRight: 8 }}
              />
              启用配置
            </label>
          </div>

          {testResult && (
            <div className={`test-result ${testResult.startsWith('success') ? 'success' : 'error'}`}>
              {testResult.startsWith('success') ? '✓ ' : '✗ '}
              {testResult.replace(/^(success|error):\s*/, '')}
            </div>
          )}

          <div className="form-actions">
            <Button type="secondary" onClick={() => {
              setShowForm(false)
              setEditingConfig(null)
              setTestResult('')
            }}>
              取消
            </Button>
            <Button
              type="outline"
              status="success"
              onClick={handleTest}
              loading={testing === 'form'}
            >
              测试
            </Button>
            <Button type="primary" htmlType="submit">
              {editingConfig ? '更新' : '创建'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* 日志弹窗 */}
      {showLogModal && (
        <LogModal
          type="email_config"
          id={logConfigId}
          onClose={() => {
            setShowLogModal(false)
            setLogConfigId(null)
          }}
        />
      )}
    </div>
  )
}

export default EmailConfig

