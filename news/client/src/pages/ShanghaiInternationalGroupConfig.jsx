import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber, Switch } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import './ShanghaiInternationalGroupConfig.css'

const Option = Select.Option

function ShanghaiInternationalGroupConfig() {
  const [configs, setConfigs] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logConfigId, setLogConfigId] = useState(null)
  const [testingConfigId, setTestingConfigId] = useState(null)
  const [formData, setFormData] = useState({
    app_id: '',
    x_app_id: '',
    api_key: '',
    daily_limit: 100,
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/shanghai-international-group-configs', {
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
      console.error('获取上海国际集团配置列表失败:', error)
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
    setHasApiKey(false)
    setFormData({
      app_id: '',
      x_app_id: '',
      api_key: '',
      daily_limit: 100,
      is_active: true
    })
    setShowForm(true)
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/shanghai-international-group-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasApiKey(true)
        setFormData({
          app_id: config.app_id,
          x_app_id: config.x_app_id || '',
          api_key: '',
          daily_limit: config.daily_limit || 100,
          is_active: config.is_active === 1
        })
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取上海国际集团配置失败:', error)
      Message.error('获取配置失败')
    }
  }

  const handleTest = async (id) => {
    setTestingConfigId(id)
    try {
      const response = await axios.post(`/api/system/shanghai-international-group-config/${id}/test`)
      if (response.data.success) {
        Message.success(response.data.message || '接口连接成功')
      } else {
        Message.error(response.data.message || '接口测试失败')
      }
    } catch (error) {
      Message.error(error.response?.data?.message || '接口测试失败')
    } finally {
      setTestingConfigId(null)
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个上海国际集团配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/shanghai-international-group-config/${id}`)
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
    if (name === 'api_key' && value !== '') {
      setHasApiKey(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.app_id || !formData.x_app_id || (!formData.api_key && !editingConfig)) {
      Message.warning('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.api_key || updateData.api_key.trim() === '' || updateData.api_key === '****') {
          delete updateData.api_key
        }
        response = await axios.put(`/api/system/shanghai-international-group-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/shanghai-international-group-config', formData)
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
      title: 'X-App-Id',
      dataIndex: 'x_app_id',
      width: 200,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '每日查询限制',
      dataIndex: 'daily_limit',
      width: 150,
      render: (text) => text ?? 100
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
      width: 260,
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
            status="warning"
            loading={testingConfigId === record.id}
            onClick={() => handleTest(record.id)}
          >
            测试
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
    <div className="shanghai-international-group-config">
      <div className="config-header">
        <h3>上海国际集团接口配置</h3>
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

      <Modal
        visible={showForm}
        title={editingConfig ? '编辑上海国际集团配置' : '新增上海国际集团配置'}
        onCancel={() => {
          setShowForm(false)
          setEditingConfig(null)
        }}
        footer={null}
        style={{ width: 600 }}
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
            <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置上海国际集团接口的应用'}</p>
          </div>

          <div className="form-group">
            <label>X-App-Id *</label>
            <Input
              value={formData.x_app_id}
              onChange={(value) => handleChange('x_app_id', value)}
              placeholder="请输入Ipass平台授权的消费方标识"
            />
            <p className="form-hint">Ipass平台授权的消费方标识，固定值</p>
          </div>

          <div className="form-group">
            <label>APIkey *</label>
            <Input.Password
              value={hasApiKey && !formData.api_key ? '****' : formData.api_key}
              onChange={(value) => handleChange('api_key', value)}
              onFocus={(e) => {
                if (hasApiKey && e.target.value === '****') {
                  setHasApiKey(false)
                  setFormData({ ...formData, api_key: '' })
                }
              }}
              placeholder={editingConfig ? (hasApiKey ? '****' : '留空则不更新APIkey') : '请输入消费方认证APIkey'}
            />
            <p className="form-hint">{editingConfig ? '留空则不更新APIkey' : '消费方认证，固定值'}</p>
          </div>

          <div className="form-group">
            <label>每日查询限制</label>
            <InputNumber
              value={formData.daily_limit}
              onChange={(value) => handleChange('daily_limit', value)}
              min={1}
              style={{ width: '100%' }}
            />
            <p className="form-hint">设置每日最大查询次数，默认100次</p>
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

          <div className="form-actions">
            <Button type="secondary" onClick={() => {
              setShowForm(false)
              setEditingConfig(null)
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              {editingConfig ? '更新' : '创建'}
            </Button>
          </div>
        </form>
      </Modal>

      {showLogModal && (
        <LogModal
          type="shanghai_international_group_config"
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

export default ShanghaiInternationalGroupConfig
