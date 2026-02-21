import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import CronGenerator from '../components/CronGenerator'
import dayjs from 'dayjs'
import './NewsConfig.css'

const Option = Select.Option

// 默认同步时间范围：前一天 00:00:00 至 今天 23:59:59
function getDefaultSyncRange() {
  const yesterdayStart = dayjs().subtract(1, 'day').startOf('day')
  const todayEnd = dayjs().endOf('day')
  return {
    start: yesterdayStart.format('YYYY-MM-DD HH:mm:ss'),
    end: todayEnd.format('YYYY-MM-DD HH:mm:ss')
  }
}

// datetime-local 的 value 格式为 "YYYY-MM-DDTHH:mm"，转为 "YYYY-MM-DD HH:mm:ss"
function toApiFormat(datetimeLocalValue) {
  if (!datetimeLocalValue || typeof datetimeLocalValue !== 'string') return ''
  const s = datetimeLocalValue.trim().replace('T', ' ')
  if (!s) return ''
  return s.length === 16 ? s + ':00' : s
}

// "YYYY-MM-DD HH:mm:ss" 转为 datetime-local 的 "YYYY-MM-DDTHH:mm"
function toDatetimeLocalValue(apiValue) {
  if (!apiValue || typeof apiValue !== 'string') return ''
  const s = apiValue.trim()
  if (!s) return ''
  const base = s.replace(/\s+/, 'T').substring(0, 16)
  return base.length >= 16 ? base : s
}

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
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [syncConfigId, setSyncConfigId] = useState(null)
  const [syncStartTime, setSyncStartTime] = useState('')
  const [syncEndTime, setSyncEndTime] = useState('')
  const [formData, setFormData] = useState({
    app_id: '',
    interface_type: '新榜',
    news_type: '新闻舆情',
    request_url: 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
    content_type: 'application/x-www-form-urlencoded;charset=utf-8',
    api_key: '',
    cron_expression: '0 0 0 * * ? *', // 默认每天0点执行
    skip_holiday: false,
    is_active: true,
    entity_type: []
  })
  const [newsTypeOptions, setNewsTypeOptions] = useState([])
  const [showCronModal, setShowCronModal] = useState(false)

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  useEffect(() => {
    if (formData.interface_type === '企查查' && !editingConfig) {
      setFormData(prev => ({
        ...prev,
        news_type: '新闻舆情',
        request_url: prev.request_url || 'https://api.qichacha.com/CompanyNews/SearchNews',
        cron_expression: prev.cron_expression || '0 0 0 ? * 1 *' // 默认每周一0点执行
      }))
    }
    if (formData.interface_type === '上海国际集团' && !editingConfig) {
      setFormData(prev => ({
        ...prev,
        news_type: '新闻舆情',
        request_url: prev.request_url || 'http://114.141.181.181:8000/dofp/v2/ipaas/query/newsAndPubnote',
        cron_expression: prev.cron_expression || '0 0 0 ? * 1 *' // 默认每周一0点执行
      }))
    }
  }, [formData.interface_type, editingConfig])

  useEffect(() => {
    const fetchNewsTypeOptions = async () => {
      try {
        const response = await axios.get('/api/system/news-type-options', {
          params: { interface_type: formData.interface_type }
        })
        if (response.data.success) {
          setNewsTypeOptions(response.data.data || [])
        }
      } catch (e) {
        console.error('获取新闻类型选项失败:', e)
        setNewsTypeOptions([])
      }
    }
    if (showForm) {
      fetchNewsTypeOptions()
    }
  }, [formData.interface_type, showForm])

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
      news_type: '新闻舆情',
      request_url: 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
      content_type: 'application/x-www-form-urlencoded;charset=utf-8',
      api_key: '',
      cron_expression: '0 0 0 * * ? *', // 默认每天0点执行
      skip_holiday: false,
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
          news_type: config.news_type || '新闻舆情',
          request_url: config.request_url || 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
          content_type: config.content_type || 'application/x-www-form-urlencoded;charset=utf-8',
          api_key: '',
          cron_expression: cronExpression,
          skip_holiday: config.skip_holiday === 1,
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
          news_type: config.news_type || '新闻舆情',
          request_url: config.request_url || 'https://api.newrank.cn/api/sync/weixin/account/articles_content',
          content_type: config.content_type || 'application/x-www-form-urlencoded;charset=utf-8',
          api_key: '', // 复制时不包含 api_key，需要用户重新输入
          cron_expression: cronExpression,
          skip_holiday: config.skip_holiday === 1,
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

  const handleSync = (id) => {
    const def = getDefaultSyncRange()
    setSyncConfigId(id)
    setSyncStartTime(def.start)
    setSyncEndTime(def.end)
    setShowSyncModal(true)
  }

  useEffect(() => {
    if (showSyncModal) {
      console.log('[NewsConfig] 同步弹窗已打开 (v2-native，若看到此日志说明当前运行的是新前端)')
    }
  }, [showSyncModal])

  const handleSyncConfirm = async () => {
    if (!syncConfigId) return
    const start = (syncStartTime || '').trim()
    const end = (syncEndTime || '').trim()
    if (!start || !end) {
      Message.warning('请填写开始时间和结束时间')
      return
    }
    if (dayjs(start).isAfter(dayjs(end))) {
      Message.warning('开始时间不能晚于结束时间')
      return
    }
    setSyncing(syncConfigId)
    try {
      // 同步可能较久（如裁判文书、舆情按企业逐个请求），使用 10 分钟超时，避免提前断开
      const response = await axios.post(
        '/api/news/sync',
        {
          config_id: syncConfigId,
          start_time: start,
          end_time: end
        },
        { timeout: 600000 }
      )
      if (response.data.success) {
        Message.success(`同步完成：${response.data.message}`)
        setShowSyncModal(false)
        setSyncConfigId(null)
        fetchConfigs()
      } else {
        Message.error('同步失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('同步请求失败:', error)
      if (error.code === 'ECONNABORTED') {
        Message.warning('同步请求已超时，任务可能仍在后台执行，请稍后在「日志」中查看结果')
        setShowSyncModal(false)
        setSyncConfigId(null)
        fetchConfigs()
      } else {
        Message.error('同步失败：' + (error.response?.data?.message || error.message || '网络错误'))
      }
    } finally {
      setSyncing(null)
    }
  }

  const handleChange = (name, value) => {
    if (name === 'interface_type') {
      const currentEntityTypes = formData.entity_type || []
      const filteredEntityTypes = (value === '企查查' || value === '上海国际集团') ? currentEntityTypes.filter(type => type !== '额外公众号') : currentEntityTypes
      setFormData(prev => ({
        ...prev,
        [name]: value,
        news_type: '新闻舆情',
        entity_type: filteredEntityTypes
      }))
    } else if (name === 'news_type' && value === '同花顺订阅') {
      // 同花顺订阅：企业类型默认为空，不参与接口参数
      setFormData(prev => ({ ...prev, [name]: value, entity_type: [] }))
    } else if (name === 'entity_type' && (formData.interface_type === '企查查' || formData.interface_type === '上海国际集团')) {
      const currentEntityTypes = value || []
      const filteredEntityTypes = Array.isArray(currentEntityTypes) ? currentEntityTypes.filter(type => type !== '额外公众号') : []
      setFormData(prev => ({ ...prev, [name]: filteredEntityTypes }))
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }
    if (name === 'api_key' && value !== '') {
      setHasApiKey(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    const isQichacha = formData.interface_type === '企查查'
    const isShanghaiInternationalGroup = formData.interface_type === '上海国际集团'
    const useGroupConfig = isQichacha || isShanghaiInternationalGroup
    
    if (editingConfig) {
      if (!formData.app_id || !formData.request_url || 
          (!useGroupConfig && !formData.content_type) || 
          !formData.cron_expression) {
        Message.warning('请填写所有必填字段')
        return
      }
    } else {
      if (!formData.app_id || !formData.request_url || 
          (!useGroupConfig && !formData.api_key) || 
          (!useGroupConfig && !formData.content_type) || 
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
      width: 130,
      render: (text) => text || '新榜'
    },
    {
      title: '新闻类型',
      dataIndex: 'news_type',
      width: 120,
      render: (text) => text || '新闻舆情'
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
              <Option value="上海国际集团">上海国际集团</Option>
            </Select>
            <p className="form-hint">{editingConfig ? '编辑时不能修改接口类型' : '选择新闻接口类型'}</p>
          </div>

          <div className="form-group">
            <label>新闻类型 *</label>
            <Select
              value={formData.news_type}
              onChange={(value) => handleChange('news_type', value)}
              placeholder="请选择新闻类型"
            >
              {newsTypeOptions.map((opt) => (
                <Option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                  {opt.disabled && <span style={{ marginLeft: 8, color: '#86909c', fontSize: 12 }}>（未开发）</span>}
                </Option>
              ))}
              {newsTypeOptions.length === 0 && (
                <Option value="新闻舆情">新闻舆情</Option>
              )}
            </Select>
            <p className="form-hint">
              {formData.interface_type === '新榜'
                ? '新榜接口仅支持新闻舆情类型'
                : '灰色选项为尚未开发的类型，后续开发完成后可选用'}
            </p>
          </div>

          <div className="form-group">
            <label>请求地址 *</label>
            <Input
              value={formData.request_url}
              onChange={(value) => handleChange('request_url', value)}
              placeholder={
                formData.interface_type === '企查查'
                  ? 'https://api.qichacha.com/CompanyNews/SearchNews'
                  : formData.interface_type === '上海国际集团'
                    ? 'http://114.141.181.181:8000/dofp/v2/ipaas/query/newsAndPubnote'
                    : 'https://api.newrank.cn/api/sync/weixin/account/articles_content'
              }
            />
            <p className="form-hint">
              {formData.interface_type === '企查查'
                ? '企查查舆情接口地址'
                : formData.interface_type === '上海国际集团'
                  ? '上海国际集团舆情和公司公告查询接口地址'
                  : '新榜接口地址'}
            </p>
          </div>

          <div className="form-group">
            <label>Content-Type {(formData.interface_type === '企查查' || formData.interface_type === '上海国际集团') ? '' : '*'}</label>
            <Input
              value={formData.content_type}
              onChange={(value) => handleChange('content_type', value)}
              placeholder="application/x-www-form-urlencoded;charset=utf-8"
              disabled={formData.interface_type === '企查查' || formData.interface_type === '上海国际集团'}
            />
            <p className="form-hint">
              {(formData.interface_type === '企查查' || formData.interface_type === '上海国际集团')
                ? '该接口类型使用application/json，无需单独配置Content-Type'
                : '请求的Content-Type'}
            </p>
          </div>

          <div className="form-group">
            <label>Key {(formData.interface_type === '企查查' || formData.interface_type === '上海国际集团') ? '' : '*'}</label>
            <Input.Password
              value={hasApiKey && !formData.api_key ? '****' : formData.api_key}
              onChange={(value) => handleChange('api_key', value)}
              onFocus={(e) => {
                if (hasApiKey && e.target.value === '****') {
                  setHasApiKey(false)
                  setFormData({ ...formData, api_key: '' })
                }
              }}
              placeholder={
                editingConfig
                  ? (hasApiKey ? '****' : '留空则不更新密钥')
                  : formData.interface_type === '企查查'
                    ? '企查查接口使用企查查配置中的凭证'
                    : formData.interface_type === '上海国际集团'
                      ? '上海国际集团接口使用上海国际集团配置中的凭证'
                      : '请输入Key'
              }
              disabled={formData.interface_type === '企查查' || formData.interface_type === '上海国际集团'}
            />
            <p className="form-hint">
              {formData.interface_type === '企查查'
                ? '企查查接口使用"企查查接口配置"中的新闻舆情接口凭证，无需在此填写'
                : formData.interface_type === '上海国际集团'
                  ? '上海国际集团接口使用"上海国际集团接口配置"中的X-App-Id、APIkey等凭证，无需在此填写'
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
              {(formData.interface_type === '企查查' || formData.interface_type === '上海国际集团') && (
                <span style={{ display: 'block', marginTop: '4px' }}>
                  该接口定时规则可编辑，编辑后将同步更新到定时任务配置
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
              placeholder={
                formData.news_type === '同花顺订阅'
                  ? '同花顺订阅不需要传企业类型，可不选'
                  : '请选择企业类型（可多选）'
              }
              allowClear
              disabled={formData.news_type === '同花顺订阅'}
            >
              <Option value="被投企业">被投企业</Option>
              <Option value="基金相关主体">基金相关主体</Option>
              <Option value="子基金">子基金</Option>
              <Option value="子基金管理人">子基金管理人</Option>
              <Option value="子基金GP">子基金GP</Option>
              {(formData.interface_type === '新榜') && (
                <Option value="额外公众号">额外公众号</Option>
              )}
            </Select>
            <p className="form-hint">
              {formData.news_type === '同花顺订阅' ? (
                '同花顺订阅接口按 company 表 updated_at 筛选企业，不传企业类型参数，此处可不选。'
              ) : formData.interface_type === '新榜' ? (
                <>
                  根据 invested_enterprises 表中 unified_credit_code 去重后的 entity_type 进行匹配，确定需要抓取哪些类型的企业信息。
                  <br />
                  <strong>额外公众号</strong>：选择此项将只抓取 additional_wechat_accounts 表中状态为 active 的额外公众号数据。
                  <br />
                  留空表示抓取所有类型（包括企业公众号和额外公众号）。
                </>
              ) : (
                '根据 invested_enterprises 表中 unified_credit_code 去重后的 entity_type 进行匹配，确定需要抓取哪些类型的企业信息。留空表示抓取所有类型。（企查查、上海国际集团接口不支持"额外公众号"）'
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

      {/* Cron表达式配置弹窗：回传 cron 与「跳过节假日」，便于保存到新闻接口配置 */}
      <CronGenerator
        visible={showCronModal}
        value={formData.cron_expression}
        skipHoliday={formData.skip_holiday}
        onChange={(cron, isSkipHoliday) => {
          handleChange('cron_expression', cron)
          if (isSkipHoliday !== undefined) handleChange('skip_holiday', isSkipHoliday)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />

      {/* 同步时间范围弹窗：完全独立实现，不使用 Arco Modal/Button；所有元素带 news-config-sync- 前缀。data-sync-modal-version 用于排查是否加载到新代码 */}
      {showSyncModal && (
        <div
          className="news-config-sync-modal-overlay"
          id="news-config-sync-modal-overlay"
          data-sync-modal-version="v2-native"
          role="dialog"
          aria-modal="true"
          aria-labelledby="news-config-sync-modal-title"
          onClick={(e) => {
            if (e.target.id === 'news-config-sync-modal-overlay') {
              setShowSyncModal(false)
              setSyncConfigId(null)
            }
          }}
        >
          <div
            className="news-config-sync-modal-box"
            id="news-config-sync-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="news-config-sync-modal-header">
              <h2 id="news-config-sync-modal-title" className="news-config-sync-modal-title">同步时间范围</h2>
            </div>
            <p className="news-config-sync-modal-desc">
              设置本次同步的查询时间范围，将作为参数传入接口（默认：前一天 0 点至今天 23:59:59）。
            </p>
            <div className="news-config-sync-modal-field">
              <label htmlFor="news-config-sync-start-time" className="news-config-sync-modal-label">开始时间</label>
              <input
                id="news-config-sync-start-time"
                name="news-config-sync-start-time"
                type="datetime-local"
                className="news-config-sync-modal-input"
                value={toDatetimeLocalValue(syncStartTime)}
                onChange={(e) => {
                  const localTimeString = e.target.value
                  const apiFormattedTime = toApiFormat(localTimeString)
                  setSyncStartTime(apiFormattedTime)
                }}
              />
            </div>
            <div className="news-config-sync-modal-field">
              <label htmlFor="news-config-sync-end-time" className="news-config-sync-modal-label">结束时间</label>
              <input
                id="news-config-sync-end-time"
                name="news-config-sync-end-time"
                type="datetime-local"
                className="news-config-sync-modal-input"
                value={toDatetimeLocalValue(syncEndTime)}
                onChange={(e) => {
                  const localTimeString = e.target.value
                  const apiFormattedTime = toApiFormat(localTimeString)
                  setSyncEndTime(apiFormattedTime)
                }}
              />
            </div>
            <div className="news-config-sync-modal-footer">
              <button
                type="button"
                className="news-config-sync-modal-btn news-config-sync-modal-btn-cancel"
                id="news-config-sync-modal-cancel"
                onClick={() => {
                  setShowSyncModal(false)
                  setSyncConfigId(null)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="news-config-sync-modal-btn news-config-sync-modal-btn-ok"
                id="news-config-sync-modal-ok"
                disabled={syncing !== null}
                onClick={() => handleSyncConfirm()}
              >
                {syncing !== null ? '处理中...' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

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

