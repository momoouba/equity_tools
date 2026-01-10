import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import './NewsConfig.css'

const Option = Select.Option

function NewsConfig() {
  const [configs, setConfigs] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [syncing, setSyncing] = useState(null)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logConfigId, setLogConfigId] = useState(null)
  const [formData, setFormData] = useState({
    app_id: '',
    interface_type: '新榜',
    request_url: 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
    content_type: 'application/x-www-form-urlencoded;charset=utf-8',
    api_key: '',
    frequency_type: 'day',
    frequency_value: 1,
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  useEffect(() => {
    if (formData.interface_type === '企查查' && !editingConfig) {
      setFormData(prev => ({
        ...prev,
        request_url: prev.request_url || 'https://api.qichacha.com/CompanyNews/SearchNews',
        frequency_type: prev.frequency_type || 'week',
        frequency_value: prev.frequency_value || 1
      }))
    }
  }, [formData.interface_type, editingConfig])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/news-configs', {
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
      console.error('获取新闻接口配置列表失败:', error)
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
      interface_type: '新榜',
      request_url: 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
      content_type: 'application/x-www-form-urlencoded;charset=utf-8',
      api_key: '',
      frequency_type: 'day',
      frequency_value: 1,
      is_active: true
    })
    setShowForm(true)
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/news-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasApiKey(true)
        setFormData({
          app_id: config.app_id,
          interface_type: config.interface_type || '新榜',
          request_url: config.request_url || 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
          content_type: config.content_type || 'application/x-www-form-urlencoded;charset=utf-8',
          api_key: '',
          frequency_type: config.frequency_type || 'day',
          frequency_value: config.frequency_value || 1,
          is_active: config.is_active === 1
        })
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取新闻接口配置失败:', error)
      Message.error('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个新闻接口配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/news-config/${id}`)
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

  const handleSync = async (id) => {
    Modal.confirm({
      title: '确认同步',
      content: '确定要开始同步公众号数据吗？',
      onOk: async () => {
        setSyncing(id)
        try {
          const response = await axios.post('/api/news/sync', { config_id: id })
          if (response.data.success) {
            Message.success(`同步完成：${response.data.message}`)
            fetchConfigs()
          } else {
            Message.error('同步失败：' + (response.data.message || '未知错误'))
          }
        } catch (error) {
          console.error('同步请求失败:', error)
          if (error.code === 'ECONNABORTED') {
            Message.warning('同步超时，但数据可能仍在后台处理中，请稍后查看结果')
          } else {
            Message.error('同步失败：' + (error.response?.data?.message || error.message || '网络错误'))
          }
        } finally {
          setSyncing(null)
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
    
    const isQichacha = formData.interface_type === '企查查'
    
    if (editingConfig) {
      if (!formData.app_id || !formData.request_url || 
          (!isQichacha && !formData.content_type) || 
          !formData.frequency_type || 
          !formData.frequency_value || 
          formData.frequency_value <= 0) {
        Message.warning('请填写所有必填字段')
        return
      }
    } else {
      if (!formData.app_id || !formData.request_url || 
          (!isQichacha && !formData.api_key) || 
          (!isQichacha && !formData.content_type) || 
          !formData.frequency_type || 
          !formData.frequency_value || 
          formData.frequency_value <= 0) {
        Message.warning('请填写所有必填字段')
        return
      }
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.api_key || updateData.api_key.trim() === '' || updateData.api_key === '****') {
          delete updateData.api_key
        }
        if (updateData.frequency_value) {
          updateData.frequency_value = parseInt(updateData.frequency_value, 10)
        }
        updateData.is_active = updateData.is_active === true || updateData.is_active === 1
        response = await axios.put(`/api/system/news-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/news-config', formData)
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

  const getFrequencyName = (type) => {
    const map = {
      'day': '天',
      'week': '周',
      'month': '月'
    }
    return map[type] || type
  }

  const columns = [
    {
      title: '应用',
      dataIndex: 'app_name',
      width: 150,
      render: (text) => text || '-'
    },
    {
      title: '新闻接口类型',
      dataIndex: 'interface_type',
      width: 150,
      render: (text) => text || '新榜'
    },
    {
      title: '请求地址',
      dataIndex: 'request_url',
      width: 300,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '频次类型',
      dataIndex: 'frequency_type',
      width: 100,
      render: (text) => getFrequencyName(text)
    },
    {
      title: '频次值',
      dataIndex: 'frequency_value',
      width: 100
    },
    {
      title: '最后同步时间',
      dataIndex: 'last_sync_time',
      width: 180,
      render: (text) => text ? formatDate(text) : '-'
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
            status="warning"
            loading={syncing === record.id}
            onClick={() => handleSync(record.id)}
          >
            同步
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
    <div className="news-config">
      <div className="config-header">
        <h3>新闻接口配置</h3>
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
        title={editingConfig ? '编辑新闻接口配置' : '新增新闻接口配置'}
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
              {applications.map(app => (
                <Option key={app.id} value={app.id}>
                  {app.app_name}
                </Option>
              ))}
            </Select>
            <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置新闻接口的应用'}</p>
          </div>

          <div className="form-group">
            <label>新闻接口类型 *</label>
            <Select
              value={formData.interface_type}
              onChange={(value) => handleChange('interface_type', value)}
              disabled={!!editingConfig}
            >
              <Option value="新榜">新榜</Option>
              <Option value="企查查">企查查</Option>
            </Select>
            <p className="form-hint">{editingConfig ? '编辑时不能修改接口类型' : '选择新闻接口类型'}</p>
          </div>

          <div className="form-group">
            <label>请求地址 *</label>
            <Input
              value={formData.request_url}
              onChange={(value) => handleChange('request_url', value)}
              placeholder={formData.interface_type === '企查查' 
                ? 'https://api.qichacha.com/CompanyNews/SearchNews' 
                : 'https://api.newrank.cn/api/sync/weixin/account/articles_content'}
            />
            <p className="form-hint">
              {formData.interface_type === '企查查' 
                ? '企查查舆情接口地址' 
                : '新榜接口地址'}
            </p>
          </div>

          <div className="form-group">
            <label>Content-Type {formData.interface_type === '企查查' ? '' : '*'}</label>
            <Input
              value={formData.content_type}
              onChange={(value) => handleChange('content_type', value)}
              placeholder="application/x-www-form-urlencoded;charset=utf-8"
              disabled={formData.interface_type === '企查查'}
            />
            <p className="form-hint">
              {formData.interface_type === '企查查' 
                ? '企查查接口不需要Content-Type字段' 
                : '请求的Content-Type'}
            </p>
          </div>

          <div className="form-group">
            <label>Key {formData.interface_type === '企查查' ? '' : '*'}</label>
            <Input.Password
              value={hasApiKey && !formData.api_key ? '****' : formData.api_key}
              onChange={(value) => handleChange('api_key', value)}
              onFocus={(e) => {
                if (hasApiKey && e.target.value === '****') {
                  setHasApiKey(false)
                  setFormData({ ...formData, api_key: '' })
                }
              }}
              placeholder={editingConfig ? (hasApiKey ? '****' : '留空则不更新密钥') : formData.interface_type === '企查查' ? '企查查接口使用企查查配置中的凭证' : '请输入Key'}
              disabled={formData.interface_type === '企查查'}
            />
            <p className="form-hint">
              {formData.interface_type === '企查查' 
                ? '企查查接口使用"企查查接口配置"中的新闻舆情接口凭证，无需在此填写' 
                : editingConfig 
                  ? '留空则不更新密钥' 
                  : '在控制台获取的Key'}
            </p>
          </div>

          <div className="form-group">
            <label>数据取数频次类型 *</label>
            <Select
              value={formData.frequency_type}
              onChange={(value) => handleChange('frequency_type', value)}
            >
              <Option value="day">天</Option>
              <Option value="week">周</Option>
              <Option value="month">月</Option>
            </Select>
            {formData.interface_type === '企查查' && (
              <p className="form-hint" style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>
                企查查接口频次类型可编辑，编辑后将同步更新到定时任务配置
              </p>
            )}
          </div>

          <div className="form-group">
            <label>数据取数频次值 *</label>
            <InputNumber
              value={formData.frequency_value}
              onChange={(value) => handleChange('frequency_value', value)}
              min={1}
            />
            <p className="form-hint">
              {formData.frequency_type === 'day' 
                ? `X天：从设置保存开始的当天0点到${formData.frequency_value}天后的23:59:59`
                : formData.frequency_type === 'week'
                ? formData.interface_type === '企查查'
                  ? `按周执行：每次同步获取上周周一00:00:00到上周周日23:59:59的数据（企查查接口频次值可编辑）`
                  : `X周：从设置保存开始的当周周一到${formData.frequency_value}周后的周日23:59:59`
                : `X月：从设置保存开始的当月1日0点到当月最后一天23:59:59（月份取整）`}
            </p>
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
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

      {/* 日志弹窗 */}
      {showLogModal && (
        <LogModal
          type="news_config"
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

export default NewsConfig

