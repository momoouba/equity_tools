import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, InputNumber, Switch, Tabs } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import QichachaNewsCategoryList from './QichachaNewsCategoryList'
import './QichachaConfig.css'

const Option = Select.Option
const TabPane = Tabs.TabPane

function QichachaConfig() {
  const [activeSubTab, setActiveSubTab] = useState('config')
  const [configs, setConfigs] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [hasSecretKey, setHasSecretKey] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logConfigId, setLogConfigId] = useState(null)
  const [formData, setFormData] = useState({
    app_id: '',
    qichacha_app_key: '',
    qichacha_secret_key: '',
    qichacha_daily_limit: 100,
    interface_type: '企业信息',
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/qichacha-configs', {
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
      console.error('获取企查查配置列表失败:', error)
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
    setHasSecretKey(false)
    setFormData({
      app_id: '',
      qichacha_app_key: '',
      qichacha_secret_key: '',
      qichacha_daily_limit: 100,
      interface_type: '企业信息',
      is_active: true
    })
    setShowForm(true)
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/qichacha-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasSecretKey(true)
        setFormData({
          app_id: config.app_id,
          qichacha_app_key: config.qichacha_app_key || '',
          qichacha_secret_key: '',
          qichacha_daily_limit: config.qichacha_daily_limit || 100,
          interface_type: config.interface_type || '企业信息',
          is_active: config.is_active === 1
        })
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取企查查配置失败:', error)
      Message.error('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个企查查配置吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/qichacha-config/${id}`)
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
    
    if (name === 'qichacha_secret_key' && value !== '') {
      setHasSecretKey(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.app_id || !formData.qichacha_app_key || (!formData.qichacha_secret_key && !editingConfig)) {
      Message.warning('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.qichacha_secret_key || updateData.qichacha_secret_key.trim() === '' || updateData.qichacha_secret_key === '****') {
          delete updateData.qichacha_secret_key
        }
        response = await axios.put(`/api/system/qichacha-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/qichacha-config', formData)
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
      title: '接口类型',
      dataIndex: 'interface_type',
      width: 150,
      render: (text) => text || '企业信息'
    },
    {
      title: '应用凭证',
      dataIndex: 'qichacha_app_key',
      width: 200,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '每日查询限制',
      dataIndex: 'qichacha_daily_limit',
      width: 150,
      render: (text) => text || 100
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
    <div className="qichacha-config">
      <Tabs activeTab={activeSubTab} onChange={setActiveSubTab} type="line">
        <TabPane key="config" title="企查查接口配置">
          <div className="config-header">
            <h3>企查查接口配置</h3>
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
            title={editingConfig ? '编辑企查查配置' : '新增企查查配置'}
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
                <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置企查查接口的应用'}</p>
              </div>

              <div className="form-group">
                <label>接口类型 *</label>
                <Select
                  value={formData.interface_type}
                  onChange={(value) => handleChange('interface_type', value)}
                  disabled={!!editingConfig}
                >
                  <Option value="企业信息">企业信息</Option>
                  <Option value="新闻舆情">新闻舆情</Option>
                </Select>
                <p className="form-hint">{editingConfig ? '编辑时不能修改接口类型' : '选择企查查接口类型'}</p>
              </div>

              <div className="form-group">
                <label>应用凭证 *</label>
                <Input
                  value={formData.qichacha_app_key}
                  onChange={(value) => handleChange('qichacha_app_key', value)}
                  placeholder="请输入企查查应用凭证"
                />
              </div>

              <div className="form-group">
                <label>密钥 *</label>
                <Input.Password
                  value={hasSecretKey && !formData.qichacha_secret_key ? '****' : formData.qichacha_secret_key}
                  onChange={(value) => handleChange('qichacha_secret_key', value)}
                  onFocus={(e) => {
                    if (hasSecretKey && e.target.value === '****') {
                      setHasSecretKey(false)
                      setFormData({ ...formData, qichacha_secret_key: '' })
                    }
                  }}
                  placeholder={editingConfig ? (hasSecretKey ? '****' : '留空则不更新密钥') : '请输入企查查密钥'}
                />
                <p className="form-hint">{editingConfig ? '留空则不更新密钥' : '请输入企查查密钥'}</p>
              </div>

              <div className="form-group">
                <label>每日查询限制</label>
                <InputNumber
                  value={formData.qichacha_daily_limit}
                  onChange={(value) => handleChange('qichacha_daily_limit', value)}
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

          {/* 日志弹窗 */}
          {showLogModal && (
            <LogModal
              type="qichacha_config"
              id={logConfigId}
              onClose={() => {
                setShowLogModal(false)
                setLogConfigId(null)
              }}
            />
          )}
        </TabPane>

        <TabPane key="category" title="企查查新闻类别">
          <QichachaNewsCategoryList />
        </TabPane>
      </Tabs>
    </div>
  )
}

export default QichachaConfig

