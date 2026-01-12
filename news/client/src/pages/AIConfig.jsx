import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber, Switch, Tabs, Card } from '@arco-design/web-react'
import axios from '../utils/axios'
import PromptConfig from './PromptConfig'
import './AIConfig.css'

const Option = Select.Option
const TabPane = Tabs.TabPane

function AIConfig() {
  const [activeSubTab, setActiveSubTab] = useState('model')
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [currentConfig, setCurrentConfig] = useState(null)
  const [availableModels, setAvailableModels] = useState({})
  const [testLoading, setTestLoading] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0
  })
  const [formData, setFormData] = useState({
    config_name: '',
    provider: 'alibaba',
    model_name: '',
    api_type: 'chat',
    api_key: '',
    api_endpoint: '',
    temperature: 0.7,
    max_tokens: 2000,
    top_p: 1.0,
    application_type: 'news_analysis',
    usage_type: 'content_analysis',
    is_active: 1
  })

  const providers = [
    { value: 'alibaba', label: '阿里云（千问）' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'baidu', label: '百度（文心一言）' },
    { value: 'tencent', label: '腾讯（混元）' }
  ]

  const apiTypes = [
    { value: 'chat', label: 'Chat API' },
    { value: 'completion', label: 'Completion API' },
    { value: 'chat_completion', label: 'Chat Completion API' }
  ]

  const applicationTypes = [
    { value: 'news_analysis', label: '新闻分析' },
    { value: 'general', label: '通用' }
  ]

  const usageTypes = [
    { value: 'content_analysis', label: '情绪分析' },
    { value: 'image_recognition', label: '图片识别' }
  ]

  useEffect(() => {
    fetchConfigs()
    fetchAvailableModels()
  }, [pagination.page, pagination.pageSize])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/ai-config', {
        params: {
          page: pagination.page,
          pageSize: pagination.pageSize
        }
      })
      
      if (response.data.success) {
        setConfigs(response.data.data)
        setPagination(prev => ({
          ...prev,
          total: response.data.total
        }))
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '获取配置列表失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchAvailableModels = async () => {
    try {
      const response = await axios.get('/api/ai-config/models/available')
      if (response.data.success) {
        setAvailableModels(response.data.data)
      }
    } catch (err) {
      console.error('获取可用模型列表失败:', err)
    }
  }

  const handleAdd = () => {
    setCurrentConfig(null)
    setFormData({
      config_name: '',
      provider: 'alibaba',
      model_name: '',
      api_type: 'chat',
      api_key: '',
      api_endpoint: '',
      temperature: 0.7,
      max_tokens: 2000,
      top_p: 1.0,
      application_type: 'news_analysis',
      usage_type: 'content_analysis',
      is_active: 1
    })
    setTestResult(null)
    setShowModal(true)
  }

  const handleEdit = async (config) => {
    try {
      const response = await axios.get(`/api/ai-config/${config.id}`)
      if (response.data.success) {
        setCurrentConfig(config)
        setFormData(response.data.data)
        setTestResult(null)
        setShowModal(true)
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '获取配置详情失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/ai-config/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchConfigs()
          }
        } catch (err) {
          Message.error(err.response?.data?.message || '删除失败')
        }
      }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      let response
      if (currentConfig) {
        response = await axios.put(`/api/ai-config/${currentConfig.id}`, formData)
      } else {
        response = await axios.post('/api/ai-config', formData)
      }

      if (response.data.success) {
        Message.success(currentConfig ? '更新成功' : '创建成功')
        setShowModal(false)
        fetchConfigs()
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async (configId) => {
    setTestLoading(configId)
    setTestResult(null)

    try {
      const response = await axios.post(`/api/ai-config/${configId}/test`)
      
      if (response.data.success) {
        setTestResult({
          success: true,
          message: '测试成功',
          data: response.data.data
        })
        Message.success('测试成功')
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.message || '测试失败'
      })
      Message.error('测试失败：' + (err.response?.data?.message || '未知错误'))
    } finally {
      setTestLoading(null)
    }
  }

  const handleChange = (name, value) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const getDefaultEndpoint = (provider, usageType = 'content_analysis', modelName = '') => {
    const isVisionModel = usageType === 'image_recognition' || 
                         (modelName && (modelName.toLowerCase().includes('vl') || modelName.toLowerCase().includes('vision')))
    
    const endpoints = {
      alibaba: isVisionModel 
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      openai: 'https://api.openai.com/v1/chat/completions',
      baidu: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions',
      tencent: 'https://hunyuan.tencentcloudapi.com/'
    }
    return endpoints[provider] || ''
  }

  const columns = [
    {
      title: '配置名称',
      dataIndex: 'config_name',
      width: 200
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      width: 150,
      render: (text) => providers.find(p => p.value === text)?.label || text
    },
    {
      title: '模型名称',
      dataIndex: 'model_name',
      width: 200
    },
    {
      title: 'API类型',
      dataIndex: 'api_type',
      width: 150,
      render: (text) => apiTypes.find(t => t.value === text)?.label || text
    },
    {
      title: '应用类型',
      dataIndex: 'application_type',
      width: 120,
      render: (text) => applicationTypes.find(t => t.value === text)?.label || text
    },
    {
      title: '使用类型',
      dataIndex: 'usage_type',
      width: 120,
      render: (text) => usageTypes.find(t => t.value === text)?.label || text
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
      title: '操作',
      width: 200,
      render: (_, record) => (
        <Space size={8}>
          <Button
            type="outline"
            size="small"
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="outline"
            size="small"
            status="success"
            loading={testLoading === record.id}
            onClick={() => handleTest(record.id)}
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
    <div className="ai-config">
      <Tabs activeTab={activeSubTab} onChange={setActiveSubTab} type="line">
        <TabPane key="model" title="AI模型配置">
          <div className="config-header">
            <h3>AI模型配置管理</h3>
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

          {pagination.total > 0 && (
            <div className="pagination-wrapper">
              <Pagination
                current={pagination.page}
                total={pagination.total}
                pageSize={pagination.pageSize}
                onChange={(page) => setPagination(prev => ({ ...prev, page }))}
                showTotal
                showJumper
              />
            </div>
          )}

          <Modal
            visible={showModal}
            title={currentConfig ? '编辑AI模型配置' : '新增AI模型配置'}
            onCancel={() => {
              setShowModal(false)
              setCurrentConfig(null)
              setTestResult(null)
            }}
            footer={null}
            style={{ width: 700 }}
          >
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>配置名称 *</label>
                <Input
                  value={formData.config_name}
                  onChange={(value) => handleChange('config_name', value)}
                  placeholder="请输入配置名称"
                />
              </div>

              <div className="form-group">
                <label>提供商 *</label>
                <Select
                  value={formData.provider}
                  onChange={(value) => {
                    handleChange('provider', value)
                    handleChange('api_endpoint', getDefaultEndpoint(value, formData.usage_type, formData.model_name))
                  }}
                >
                  {providers.map(p => (
                    <Option key={p.value} value={p.value}>{p.label}</Option>
                  ))}
                </Select>
              </div>

              <div className="form-group">
                <label>模型名称 *</label>
                <Select
                  value={formData.model_name}
                  onChange={(value) => {
                    handleChange('model_name', value)
                    handleChange('api_endpoint', getDefaultEndpoint(formData.provider, formData.usage_type, value))
                  }}
                  placeholder="请选择模型"
                >
                  {availableModels[formData.provider]?.map(model => (
                    <Option key={model} value={model}>{model}</Option>
                  ))}
                </Select>
              </div>

              <div className="form-group">
                <label>API类型 *</label>
                <Select
                  value={formData.api_type}
                  onChange={(value) => handleChange('api_type', value)}
                >
                  {apiTypes.map(t => (
                    <Option key={t.value} value={t.value}>{t.label}</Option>
                  ))}
                </Select>
              </div>

              <div className="form-group">
                <label>API Key *</label>
                <Input.Password
                  value={formData.api_key}
                  onChange={(value) => handleChange('api_key', value)}
                  placeholder="请输入API Key"
                />
              </div>

              <div className="form-group">
                <label>API端点</label>
                <Input
                  value={formData.api_endpoint}
                  onChange={(value) => handleChange('api_endpoint', value)}
                  placeholder="请输入API端点"
                />
              </div>

              <div className="form-group">
                <label>Temperature</label>
                <InputNumber
                  value={formData.temperature}
                  onChange={(value) => handleChange('temperature', value)}
                  min={0}
                  max={2}
                  step={0.1}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label>Max Tokens</label>
                <InputNumber
                  value={formData.max_tokens}
                  onChange={(value) => handleChange('max_tokens', value)}
                  min={1}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label>Top P</label>
                <InputNumber
                  value={formData.top_p}
                  onChange={(value) => handleChange('top_p', value)}
                  min={0}
                  max={1}
                  step={0.1}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label>应用类型 *</label>
                <Select
                  value={formData.application_type}
                  onChange={(value) => handleChange('application_type', value)}
                >
                  {applicationTypes.map(t => (
                    <Option key={t.value} value={t.value}>{t.label}</Option>
                  ))}
                </Select>
              </div>

              <div className="form-group">
                <label>使用类型 *</label>
                <Select
                  value={formData.usage_type}
                  onChange={(value) => {
                    handleChange('usage_type', value)
                    handleChange('api_endpoint', getDefaultEndpoint(formData.provider, value, formData.model_name))
                  }}
                >
                  {usageTypes.map(t => (
                    <Option key={t.value} value={t.value}>{t.label}</Option>
                  ))}
                </Select>
              </div>

              <div className="form-group">
                <label>
                  <Switch
                    checked={formData.is_active === 1}
                    onChange={(checked) => handleChange('is_active', checked ? 1 : 0)}
                    style={{ marginRight: 8 }}
                  />
                  启用配置
                </label>
              </div>

              {testResult && (
                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                  {testResult.success ? '✓ ' : '✗ '}
                  {testResult.message}
                </div>
              )}

              <div className="form-actions">
                <Button type="secondary" onClick={() => {
                  setShowModal(false)
                  setCurrentConfig(null)
                  setTestResult(null)
                }}>
                  取消
                </Button>
                <Button type="primary" htmlType="submit" loading={loading}>
                  {currentConfig ? '更新' : '创建'}
                </Button>
              </div>
            </form>
          </Modal>
        </TabPane>

        <TabPane key="prompt" title="模型提示词设置">
          <PromptConfig />
        </TabPane>
      </Tabs>
    </div>
  )
}

export default AIConfig

