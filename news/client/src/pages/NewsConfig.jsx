import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import CronGenerator from '../components/CronGenerator'
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
    cron_expression: '0 0 0 * * ? *', // 默认每天0点执行
    is_active: true,
    entity_type: []
  })
  const [showCronModal, setShowCronModal] = useState(false)

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  useEffect(() => {
    if (formData.interface_type === '企查查' && !editingConfig) {
      setFormData(prev => ({
        ...prev,
        request_url: prev.request_url || 'https://api.qichacha.com/CompanyNews/SearchNews',
        cron_expression: prev.cron_expression || '0 0 0 ? * 1 *' // 默认每周一0点执行
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
      cron_expression: '0 0 0 * * ? *', // 默认每天0点执行
      is_active: true,
      entity_type: []
    })
    setShowForm(true)
  }

  // 将旧的 frequency_type 和 frequency_value 转换为 Cron 表达式
  const convertToCronExpression = (frequencyType, frequencyValue) => {
    if (!frequencyType || !frequencyValue) {
      return '0 0 0 * * ? *' // 默认每天0点
    }
    
    if (frequencyType === 'day') {
      // 每天执行：0 0 0 * * ? *
      return '0 0 0 * * ? *'
    } else if (frequencyType === 'week') {
      // 每周执行：每周一0点，0 0 0 ? * 1 *
      return '0 0 0 ? * 1 *'
    } else if (frequencyType === 'month') {
      // 每月执行：每月1号0点，0 0 0 1 * ? *
      return '0 0 0 1 * ? *'
    }
    
    return '0 0 0 * * ? *'
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/news-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasApiKey(true)
        // 处理 entity_type 字段（可能是JSON字符串或数组）
        let entityType = config.entity_type || [];
        if (typeof entityType === 'string') {
          try {
            entityType = JSON.parse(entityType);
          } catch (e) {
            entityType = [];
          }
        }
        if (!Array.isArray(entityType)) {
          entityType = [];
        }
        
        // 优先使用 cron_expression，如果没有则从 frequency_type 和 frequency_value 转换
        let cronExpression = config.cron_expression
        if (!cronExpression && config.frequency_type) {
          cronExpression = convertToCronExpression(config.frequency_type, config.frequency_value)
        }
        if (!cronExpression) {
          cronExpression = '0 0 0 * * ? *' // 默认值
        }
        
        setFormData({
          app_id: config.app_id,
          interface_type: config.interface_type || '新榜',
          request_url: config.request_url || 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
          content_type: config.content_type || 'application/x-www-form-urlencoded;charset=utf-8',
          api_key: '',
          cron_expression: cronExpression,
          is_active: config.is_active === 1,
          entity_type: entityType
        })
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取新闻接口配置失败:', error)
      Message.error('获取配置失败')
    }
  }

  const handleCopy = async (id) => {
    try {
      const response = await axios.get(`/api/system/news-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        // 复制模式：editingConfig 为 null，表示新增
        setEditingConfig(null)
        setHasApiKey(false)
        // 处理 entity_type 字段（可能是JSON字符串或数组）
        let entityType = config.entity_type || [];
        if (typeof entityType === 'string') {
          try {
            entityType = JSON.parse(entityType);
          } catch (e) {
            entityType = [];
          }
        }
        if (!Array.isArray(entityType)) {
          entityType = [];
        }
        
        // 优先使用 cron_expression，如果没有则从 frequency_type 和 frequency_value 转换
        let cronExpression = config.cron_expression
        if (!cronExpression && config.frequency_type) {
          cronExpression = convertToCronExpression(config.frequency_type, config.frequency_value)
        }
        if (!cronExpression) {
          cronExpression = '0 0 0 * * ? *' // 默认值
        }
        
        // 复制所有配置，但 api_key 需要重新输入（安全考虑）
        setFormData({
          app_id: config.app_id,
          interface_type: config.interface_type || '新榜',
          request_url: config.request_url || 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
          content_type: config.content_type || 'application/x-www-form-urlencoded;charset=utf-8',
          api_key: '', // 复制时不包含 api_key，需要用户重新输入
          cron_expression: cronExpression,
          is_active: config.is_active === 1,
          entity_type: entityType
        })
        setShowForm(true)
        Message.success('已复制配置，请检查并保存')
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
    // 如果切换接口类型为"企查查"，自动清除"额外公众号"选项
    if (name === 'interface_type' && value === '企查查') {
      const currentEntityTypes = formData.entity_type || []
      const filteredEntityTypes = currentEntityTypes.filter(type => type !== '额外公众号')
      setFormData({
        ...formData,
        [name]: value,
        entity_type: filteredEntityTypes
      })
    } else {
      setFormData({
        ...formData,
        [name]: value
      })
    }
    
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
          !formData.cron_expression) {
        Message.warning('请填写所有必填字段')
        return
      }
    } else {
      if (!formData.app_id || !formData.request_url || 
          (!isQichacha && !formData.api_key) || 
          (!isQichacha && !formData.content_type) || 
          !formData.cron_expression) {
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

  // 格式化 Cron 表达式显示
  const formatCronExpression = (cron) => {
    if (!cron) return '-'
    // 简化显示：如果是常见的表达式，显示友好文本
    if (cron === '0 0 0 * * ? *') return '每天 00:00:00'
    if (cron === '0 0 0 ? * 1 *') return '每周一 00:00:00'
    if (cron === '0 0 0 1 * ? *') return '每月1号 00:00:00'
    return cron
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
      title: 'Cron表达式',
      dataIndex: 'cron_expression',
      width: 200,
      render: (text, record) => {
        // 兼容旧数据：如果有 frequency_type，显示旧的格式
        if (record.frequency_type && !text) {
          const typeMap = { 'day': '天', 'week': '周', 'month': '月' }
          return `${typeMap[record.frequency_type] || record.frequency_type} - ${record.frequency_value || '-'}`
        }
        return formatCronExpression(text)
      }
    },
    {
      title: '企业类型',
      dataIndex: 'entity_type',
      width: 200,
      render: (entityType) => {
        if (!entityType) return '-';
        let types = entityType;
        if (typeof types === 'string') {
          try {
            types = JSON.parse(types);
          } catch (e) {
            return entityType;
          }
        }
        if (!Array.isArray(types) || types.length === 0) return '-';
        return types.join('、');
      }
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
      width: 380,
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
            onClick={() => handleCopy(record.id)}
          >
            复制
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
            <label>定时任务规则 *</label>
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
            <p className="form-hint">
              点击"配置"按钮设置定时任务的执行规则，支持秒/分/时/日/月/周/年7个维度的可视化配置
              {formData.interface_type === '企查查' && (
                <span style={{ display: 'block', marginTop: '4px' }}>
                  企查查接口定时规则可编辑，编辑后将同步更新到定时任务配置
                </span>
              )}
            </p>
          </div>

          <div className="form-group">
            <label>企业类型</label>
            <Select
              mode="multiple"
              value={formData.entity_type}
              onChange={(value) => handleChange('entity_type', value)}
              placeholder="请选择企业类型（可多选）"
              allowClear
            >
              <Option value="被投企业">被投企业</Option>
              <Option value="基金">基金</Option>
              <Option value="子基金">子基金</Option>
              <Option value="子基金管理人">子基金管理人</Option>
              <Option value="子基金GP">子基金GP</Option>
              {formData.interface_type === '新榜' && (
                <Option value="额外公众号">额外公众号</Option>
              )}
            </Select>
            <p className="form-hint">
              {formData.interface_type === '新榜' ? (
                <>
                  根据 invested_enterprises 表中 unified_credit_code 去重后的 entity_type 进行匹配，确定需要抓取哪些类型的企业信息。
                  <br />
                  <strong>额外公众号</strong>：选择此项将只抓取 additional_wechat_accounts 表中状态为 active 的额外公众号数据。
                  <br />
                  留空表示抓取所有类型（包括企业公众号和额外公众号）。
                </>
              ) : (
                '根据 invested_enterprises 表中 unified_credit_code 去重后的 entity_type 进行匹配，确定需要抓取哪些类型的企业信息。留空表示抓取所有类型。'
              )}
            </p>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 0 }}>
              <span>启用配置</span>
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
                style={{ margin: 0, cursor: 'pointer', width: 'auto', flexShrink: 0 }}
              />
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

      {/* Cron表达式配置弹窗 */}
      <CronGenerator
        visible={showCronModal}
        value={formData.cron_expression}
        onChange={(cron) => {
          handleChange('cron_expression', cron)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />

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

