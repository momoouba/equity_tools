import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber, Switch } from '@arco-design/web-react'
import axios from '../utils/axios'
import './DatabaseConfig.css'

const Option = Select.Option

function DatabaseConfig() {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [testing, setTesting] = useState(null)
  const [testResult, setTestResult] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    db_type: 'mysql',
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: '',
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
  }, [currentPage])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/database-configs', {
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
      console.error('获取数据库配置列表失败:', error)
      Message.error('获取配置列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingConfig(null)
    setHasPassword(false)
    setFormData({
      name: '',
      db_type: 'mysql',
      host: '',
      port: 3306,
      user: '',
      password: '',
      database: '',
      is_active: true
    })
    setShowForm(true)
    setTestResult('')
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/database-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasPassword(true)
        setFormData({
          name: config.name,
          db_type: config.db_type || 'mysql',
          host: config.host,
          port: config.port,
          user: config.user,
          password: '',
          database: config.database,
          is_active: config.is_active === 1
        })
        setShowForm(true)
        setTestResult('')
      }
    } catch (error) {
      console.error('获取数据库配置失败:', error)
      Message.error('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个数据库配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/database-config/${id}`)
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
    
    if (name === 'password' && value !== '') {
      setHasPassword(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.name || !formData.host || !formData.user || (!formData.password && !editingConfig) || !formData.database) {
      Message.warning('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.password || updateData.password.trim() === '' || updateData.password === '****') {
          delete updateData.password
        }
        response = await axios.put(`/api/system/database-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/database-config', formData)
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
    const password = (formData.password === '****' || formData.password === '') ? '' : formData.password
    if (!formData.host || !formData.port || !formData.user || !password || !formData.database) {
      Message.warning('请先填写完整的数据库配置信息')
      return
    }

    setTesting('form')
    setTestResult('')

    try {
      if (editingConfig && editingConfig.id) {
        const response = await axios.post(`/api/system/database-config/${editingConfig.id}/test`)

        if (response.data.success) {
          setTestResult('success: ' + (response.data.message || '连接成功'))
          Message.success('数据库连接测试成功！\n' + response.data.message)
        } else {
          setTestResult('error: ' + (response.data.message || '连接失败'))
          Message.error('连接失败：' + (response.data.message || '未知错误'))
        }
      } else {
        let password = formData.password
        if (password === '****') {
          Message.warning('请先输入数据库密码才能进行测试')
          setTesting(null)
          return
        }
        
        const testData = {
          db_type: formData.db_type,
          host: formData.host,
          port: formData.port,
          user: formData.user,
          password: password,
          database: formData.database
        }
        
        const response = await axios.post('/api/system/database-config/test', testData)

        if (response.data.success) {
          setTestResult('success: ' + (response.data.message || '连接成功'))
          Message.success('数据库连接测试成功！\n' + response.data.message)
        } else {
          setTestResult('error: ' + (response.data.message || '连接失败'))
          Message.error('连接失败：' + (response.data.message || '未知错误'))
        }
      }
    } catch (error) {
      console.error('测试失败:', error)
      const errorMsg = error.response?.data?.message || '连接失败'
      setTestResult('error: ' + errorMsg)
      Message.error('连接失败：' + errorMsg)
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
      title: '配置名称',
      dataIndex: 'name',
      width: 150
    },
    {
      title: '数据库类型',
      dataIndex: 'db_type',
      width: 120,
      render: (text) => text?.toUpperCase() || 'MySQL'
    },
    {
      title: '主机地址',
      dataIndex: 'host',
      width: 180
    },
    {
      title: '端口',
      dataIndex: 'port',
      width: 100
    },
    {
      title: '数据库名',
      dataIndex: 'database',
      width: 150
    },
    {
      title: '用户名',
      dataIndex: 'user',
      width: 150
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
            onClick={async () => {
              setTesting(record.id)
              try {
                const response = await axios.post(`/api/system/database-config/${record.id}/test`)
                if (response.data.success) {
                  Message.success('数据库连接测试成功！')
                } else {
                  Message.error('连接失败：' + (response.data.message || '未知错误'))
                }
              } catch (error) {
                Message.error('连接失败：' + (error.response?.data?.message || '未知错误'))
              } finally {
                setTesting(null)
              }
            }}
            loading={testing === record.id}
          >
            测试
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
    <div className="database-config">
      <div className="config-header">
        <h3>数据库连接配置</h3>
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
        title={editingConfig ? '编辑数据库配置' : '新增数据库配置'}
        onCancel={() => {
          setShowForm(false)
          setEditingConfig(null)
          setTestResult('')
        }}
        footer={null}
        style={{ width: 600 }}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>配置名称 *</label>
            <Input
              value={formData.name}
              onChange={(value) => handleChange('name', value)}
              placeholder="请输入配置名称"
            />
          </div>

          <div className="form-group">
            <label>数据库类型 *</label>
            <Select
              value={formData.db_type}
              onChange={(value) => handleChange('db_type', value)}
            >
              <Option value="mysql">MySQL</Option>
              <Option value="postgresql">PostgreSQL</Option>
              <Option value="sqlite">SQLite</Option>
            </Select>
          </div>

          <div className="form-group">
            <label>主机地址 *</label>
            <Input
              value={formData.host}
              onChange={(value) => handleChange('host', value)}
              placeholder="例如：localhost 或 192.168.1.100"
            />
          </div>

          <div className="form-group">
            <label>端口 *</label>
            <InputNumber
              value={formData.port}
              onChange={(value) => handleChange('port', value)}
              min={1}
              max={65535}
              style={{ width: '100%' }}
            />
            <p className="form-hint">MySQL默认3306，PostgreSQL默认5432</p>
          </div>

          <div className="form-group">
            <label>用户名 *</label>
            <Input
              value={formData.user}
              onChange={(value) => handleChange('user', value)}
              placeholder="请输入数据库用户名"
            />
          </div>

          <div className="form-group">
            <label>密码 *</label>
            <Input.Password
              value={hasPassword && !formData.password ? '****' : formData.password}
              onChange={(value) => handleChange('password', value)}
              onFocus={(e) => {
                if (hasPassword && e.target.value === '****') {
                  setHasPassword(false)
                  setFormData({ ...formData, password: '' })
                }
              }}
              placeholder={editingConfig ? (hasPassword ? '****' : '留空则不更新密码') : '请输入数据库密码'}
            />
            <p className="form-hint">{editingConfig ? '留空则不更新密码' : '请输入数据库密码'}</p>
          </div>

          <div className="form-group">
            <label>数据库名 *</label>
            <Input
              value={formData.database}
              onChange={(value) => handleChange('database', value)}
              placeholder="请输入数据库名称"
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
    </div>
  )
}

export default DatabaseConfig

