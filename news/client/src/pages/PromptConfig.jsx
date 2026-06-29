import React, { useState, useEffect, useMemo } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, Switch, Form } from '@arco-design/web-react'
import axios from '../utils/axios'
import './PromptConfig.css'

const Option = Select.Option
const TextArea = Input.TextArea
const FormItem = Form.Item

function formatAiModelOptionLabel(config, applicationTypeLabels, usageTypeLabels) {
  const app =
    (applicationTypeLabels && applicationTypeLabels[config.application_type]) ||
    config.application_type ||
    '-'
  const usage =
    (usageTypeLabels && usageTypeLabels[config.usage_type]) || config.usage_type || '-'
  return `${config.config_name || config.id}（${app}·${usage}）`
}

/**
 * 大模型下拉须与「接口类型 + 提示词类型」一致，避免项目挖掘误选新闻分析模型（与后端 resolveLlmConfig 语义对齐）。
 */
function filterAiModelConfigsForPrompt(configs, interfaceType, promptType) {
  const list = configs || []
  if (
    interfaceType === '项目挖掘' ||
    promptType === 'project_sourcing_financing_web_enrich'
  ) {
    return list.filter((c) => c.application_type === 'project_sourcing_analysis')
  }
  if (interfaceType === '竞品分析' || String(promptType || '').startsWith('competitor_')) {
    return list.filter(
      (c) =>
        c.application_type === 'competitor_analysis' || c.usage_type === 'competitor_match'
    )
  }
  if (interfaceType === '打新接口' && promptType === 'enterprise_full_name') {
    return list.filter(
      (c) =>
        c.application_type === 'listing_progress_analysis' || c.usage_type === 'listing_data'
    )
  }
  // 新榜 / 企查查 / 上海国际集团 / 打新其它：新闻侧为主，允许 general 兜底
  return list.filter(
    (c) => c.application_type === 'news_analysis' || c.application_type === 'general'
  )
}

function PromptConfig() {
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [currentPrompt, setCurrentPrompt] = useState(null)
  const [aiModelConfigs, setAiModelConfigs] = useState([])
  const [applicationTypeLabels, setApplicationTypeLabels] = useState({})
  const [usageTypeLabels, setUsageTypeLabels] = useState({})
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
    { value: '企查查', label: '企查查接口' },
    { value: '上海国际集团', label: '上海国际集团接口' },
    { value: '打新接口', label: '打新接口' },
    { value: '项目挖掘', label: '项目挖掘' },
    { value: '竞品分析', label: '竞品分析' },
  ]

  const promptTypes = [
    { value: 'sentiment_analysis', label: '情绪分析' },
    { value: 'enterprise_relevance', label: '企业关联分析' },
    { value: 'validation', label: '关联验证' },
    { value: 'enterprise_full_name', label: '企业全称补齐' },
    {
      value: 'project_sourcing_financing_web_enrich',
      label: '融资联网 AI 增强（项目挖掘）',
    },
    {
      value: 'competitor_web_discover',
      label: '联网发现竞品（竞品分析）',
    },
    {
      value: 'competitor_pair_similarity',
      label: '产品相似度对标（竞品分析）',
    },
    {
      value: 'competitor_validate',
      label: '竞品关系校验（竞品分析）',
    },
  ]

  const competitorPromptPlaceholderHelp = {
    competitor_web_discover:
      '格式：---SYSTEM---\\n系统提示词\\n---USER---\\n用户模板。USER 可用占位符：{{TARGET_PROFILE_JSON}}、{{KEYWORDS_JSON}}、{{EXCLUDE_NAMES_JSON}}。联网发现步骤会启用模型 web_search。',
    competitor_pair_similarity:
      '格式：---SYSTEM--- / ---USER---。USER 占位符：{{TARGET_JSON}}、{{CANDIDATE_JSON}}。',
    competitor_validate:
      '格式：---SYSTEM--- / ---USER---。USER 占位符：{{TARGET_JSON}}、{{CANDIDATE_JSON}}。',
  }

  const filteredAiModelConfigs = useMemo(
    () => filterAiModelConfigsForPrompt(aiModelConfigs, formData.interface_type, formData.prompt_type),
    [aiModelConfigs, formData.interface_type, formData.prompt_type]
  )

  const fetchAiMetaLabels = async () => {
    try {
      const response = await axios.get('/api/ai-config/meta/options')
      if (response.data.success) {
        const data = response.data.data || {}
        const appMap = {}
        const usageMap = {}
        for (const o of data.applicationTypes || []) {
          if (o?.value) appMap[o.value] = o.label || o.value
        }
        for (const o of data.usageTypes || []) {
          if (o?.value) usageMap[o.value] = o.label || o.value
        }
        setApplicationTypeLabels(appMap)
        setUsageTypeLabels(usageMap)
      }
    } catch (err) {
      console.error('获取应用/使用类型字典失败:', err)
    }
  }

  useEffect(() => {
    fetchPrompts()
    fetchAiModelConfigs()
    fetchAiMetaLabels()
  }, [pagination.page, pagination.pageSize])

  useEffect(() => {
    if (showModal) {
      fetchAiModelConfigs()
      fetchAiMetaLabels()
    }
  }, [showModal])

  /** 切换接口/任务类型后，若当前已选模型不在筛选结果内则清空，避免保存了新闻模型却用于项目挖掘 */
  useEffect(() => {
    if (!showModal) return
    const ok = new Set(filteredAiModelConfigs.map((c) => String(c.id)))
    const cur =
      formData.ai_model_config_id != null && formData.ai_model_config_id !== ''
        ? String(formData.ai_model_config_id)
        : ''
    if (cur && !ok.has(cur)) {
      setFormData((prev) => ({ ...prev, ai_model_config_id: '' }))
    }
  }, [showModal, filteredAiModelConfigs, formData.ai_model_config_id])

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
      dataIndex: 'prompt_content_preview',
      width: 300,
      ellipsis: true,
      tooltip: true,
      render: (text, record) => {
        const preview = text || record.prompt_content || ''
        return preview.length > 100 ? `${preview.substring(0, 100)}...` : preview
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
      dataIndex: 'F_CreatorTime',
      width: 180,
      render: (text, record) => {
        const raw = text || record.created_at || record.F_CreatorTime
        if (!raw) return '-'
        const date = new Date(raw)
        return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
      }
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
              {filteredAiModelConfigs.map((config) => (
                <Option key={String(config.id)} value={String(config.id)}>
                  {formatAiModelOptionLabel(config, applicationTypeLabels, usageTypeLabels)}
                </Option>
              ))}
            </Select>
            {filteredAiModelConfigs.length === 0 ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
                {formData.interface_type === '项目挖掘' ||
                formData.prompt_type === 'project_sourcing_financing_web_enrich'
                  ? '暂无「应用类型 = 项目挖掘分析」的启用模型。请先到「AI模型配置」页新增一条（与融资/被投企业联网 AI 一致），再回到此处绑定。'
                  : formData.interface_type === '竞品分析' ||
                      String(formData.prompt_type || '').startsWith('competitor_')
                    ? '暂无「竞品分析 / 竞品匹配」用途的启用模型，请先在「AI模型配置」中新增「项目挖掘-竞品」类配置。'
                    : formData.interface_type === '打新接口' &&
                      formData.prompt_type === 'enterprise_full_name'
                    ? '暂无「上市进展分析 / 上市数据」用途的启用模型，请先在「AI模型配置」中新增。'
                    : '暂无与当前接口类型匹配的启用模型（新闻分析或通用）。'}
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-3)' }}>
                已按当前「接口类型 + 提示词类型」筛选可选模型，与后端任务实际使用的 application_type 一致。
              </div>
            )}
          </div>

          <div className="form-group">
            <label>提示词内容 *</label>
            {competitorPromptPlaceholderHelp[formData.prompt_type] ? (
              <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-3)', lineHeight: 1.6 }}>
                {competitorPromptPlaceholderHelp[formData.prompt_type]}
              </div>
            ) : formData.prompt_type === 'project_sourcing_financing_web_enrich' ? (
              <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-3)', lineHeight: 1.6 }}>
                格式：---SYSTEM--- / ---USER---；USER 段占位符：{'{{COMPANY_NAME}}'}、{'{{CREDIT_CODE}}'}、{'{{PROJECT_NAME}}'}、{'{{QCC_COMPANY_INTRO}}'}
              </div>
            ) : null}
            <TextArea
              value={formData.prompt_content}
              onChange={(value) => handleChange('prompt_content', value)}
              placeholder="请输入提示词内容（竞品分析请使用 ---SYSTEM--- 与 ---USER--- 分段）"
              rows={14}
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

