import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, Switch, Form } from '@arco-design/web-react'
import axios from '../utils/axios'
import './PromptConfig.css'

const Option = Select.Option
const TextArea = Input.TextArea
const FormItem = Form.Item

function PromptConfig() {
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [currentPrompt, setCurrentPrompt] = useState(null)
  const [aiModelConfigs, setAiModelConfigs] = useState([])
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0
  })
  const [formData, setFormData] = useState({
    prompt_name: '',
    interface_type: '新榜',
    prompt_type: 'sentiment_analysis',
    prompt_content: '',
    ai_model_config_id: '',
    is_active: 1
  })

  const interfaceTypes = [
    { value: '新榜', label: '新榜接口' },
    { value: '企查查', label: '企查查接口' }
  ]

  const promptTypes = [
    { value: 'sentiment_analysis', label: '情绪分析' },
    { value: 'enterprise_relevance', label: '企业关联分析' },
    { value: 'validation', label: '关联验证' }
  ]

  useEffect(() => {
    fetchPrompts()
    fetchAiModelConfigs()
  }, [pagination.page, pagination.pageSize])

  const fetchAiModelConfigs = async () => {
    try {
      const response = await axios.get('/api/ai-config/active')
      if (response.data.success) {
        setAiModelConfigs(response.data.data || [])
      }
    } catch (err) {
      console.error('获取AI模型配置列表失败:', err)
    }
  }

  const fetchPrompts = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/ai-prompt-config', {
        params: {
          page: pagination.page,
          pageSize: pagination.pageSize
        }
      })
      
      if (response.data.success) {
        setPrompts(response.data.data || [])
        setPagination(prev => ({
          ...prev,
          total: response.data.total || 0
        }))
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '获取提示词列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setCurrentPrompt(null)
    setFormData({
      prompt_name: '',
      interface_type: '新榜',
      prompt_type: 'sentiment_analysis',
      prompt_content: '',
      ai_model_config_id: '',
      is_active: 1
    })
    setShowModal(true)
  }

  const handleEdit = async (prompt) => {
    try {
      const response = await axios.get(`/api/ai-prompt-config/${prompt.id}`)
      if (response.data.success) {
        setCurrentPrompt(prompt)
        setFormData(response.data.data)
        setShowModal(true)
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '获取提示词详情失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个提示词配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/ai-prompt-config/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchPrompts()
          }
        } catch (err) {
          Message.error(err.response?.data?.message || '删除失败')
        }
      }
    })
  }

  const handleToggleActive = async (id) => {
    try {
      const response = await axios.patch(`/api/ai-prompt-config/${id}/toggle-active`)
      if (response.data.success) {
        Message.success('操作成功')
        fetchPrompts()
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '操作失败')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      let response
      if (currentPrompt) {
        response = await axios.put(`/api/ai-prompt-config/${currentPrompt.id}`, formData)
      } else {
        response = await axios.post('/api/ai-prompt-config', formData)
      }

      if (response.data.success) {
        Message.success(currentPrompt ? '更新成功' : '创建成功')
        setShowModal(false)
        fetchPrompts()
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (name, value) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const getPromptTypeLabel = (type) => {
    return promptTypes.find(t => t.value === type)?.label || type
  }

  const getInterfaceTypeLabel = (type) => {
    return interfaceTypes.find(t => t.value === type)?.label || type
  }

  const columns = [
    {
      title: '提示词名称',
      dataIndex: 'prompt_name',
      width: 200
    },
    {
      title: '接口类型',
      dataIndex: 'interface_type',
      width: 120,
      render: (text) => getInterfaceTypeLabel(text)
    },
    {
      title: '提示词类型',
      dataIndex: 'prompt_type',
      width: 150,
      render: (text) => getPromptTypeLabel(text)
    },
    {
      title: '大模型配置',
      dataIndex: 'ai_model_config_name',
      width: 200,
      render: (text, record) => text || <span style={{ color: '#86909c' }}>未配置</span>
    },
    {
      title: '提示词内容预览',
      dataIndex: 'prompt_content',
      width: 300,
      ellipsis: true,
      tooltip: true,
      render: (text) => {
        const preview = text || ''
        return preview.length > 100 ? preview.substring(0, 100) + '...' : preview
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
      render: (text) => new Date(text).toLocaleString()
    },
    {
      title: '操作',
      width: 250,
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
            status={record.is_active ? 'warning' : 'success'}
            onClick={() => handleToggleActive(record.id)}
          >
            {record.is_active ? '禁用' : '启用'}
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
    <div className="prompt-config">
      <div className="config-header">
        <h3>模型提示词设置</h3>
        <Space>
          <Button
            onClick={fetchPrompts}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            onClick={handleAdd}
          >
            新增提示词
          </Button>
        </Space>
      </div>

      <div className="table-container">
        {loading && prompts.length === 0 ? (
          <Skeleton
            loading={true}
            animation={true}
            text={{ rows: 8, width: ['100%'] }}
          />
        ) : (
          <Table
            columns={columns}
            data={prompts}
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
        title={currentPrompt ? '编辑提示词配置' : '新增提示词配置'}
        onCancel={() => {
          setShowModal(false)
          setCurrentPrompt(null)
        }}
        footer={null}
        style={{ width: 700 }}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>提示词名称 *</label>
            <Input
              value={formData.prompt_name}
              onChange={(value) => handleChange('prompt_name', value)}
              placeholder="请输入提示词名称"
            />
          </div>

          <div className="form-group">
            <label>接口类型 *</label>
            <Select
              value={formData.interface_type}
              onChange={(value) => handleChange('interface_type', value)}
            >
              {interfaceTypes.map(t => (
                <Option key={t.value} value={t.value}>{t.label}</Option>
              ))}
            </Select>
          </div>

          <div className="form-group">
            <label>提示词类型 *</label>
            <Select
              value={formData.prompt_type}
              onChange={(value) => handleChange('prompt_type', value)}
            >
              {promptTypes.map(t => (
                <Option key={t.value} value={t.value}>{t.label}</Option>
              ))}
            </Select>
          </div>

          <div className="form-group">
            <label>大模型配置</label>
            <Select
              value={formData.ai_model_config_id}
              onChange={(value) => handleChange('ai_model_config_id', value)}
              placeholder="请选择大模型配置（可选）"
              allowClear
            >
              {aiModelConfigs.map(config => (
                <Option key={config.id} value={config.id}>
                  {config.config_name}
                </Option>
              ))}
            </Select>
          </div>

          <div className="form-group">
            <label>提示词内容 *</label>
            <TextArea
              value={formData.prompt_content}
              onChange={(value) => handleChange('prompt_content', value)}
              placeholder="请输入提示词内容"
              rows={8}
            />
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

          <div className="form-actions">
            <Button type="secondary" onClick={() => {
              setShowModal(false)
              setCurrentPrompt(null)
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {currentPrompt ? '更新' : '创建'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default PromptConfig

