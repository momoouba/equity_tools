import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import Pagination from '../components/Pagination'
import './EmailConfig.css'

function QichachaConfig() {
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
      alert('获取配置列表失败')
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
          qichacha_secret_key: '', // 不显示密钥
          qichacha_daily_limit: config.qichacha_daily_limit || 100,
          interface_type: config.interface_type || '企业信息',
          is_active: config.is_active === 1
        })
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取企查查配置失败:', error)
      alert('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个企查查配置吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/system/qichacha-config/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchConfigs()
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : (type === 'number' ? parseInt(value, 10) : value)
    })
    
    // 如果用户开始输入密钥，清除"已有密钥"标记
    if (name === 'qichacha_secret_key' && value !== '') {
      setHasSecretKey(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.app_id || !formData.qichacha_app_key || (!formData.qichacha_secret_key && !editingConfig)) {
      alert('请填写所有必填字段')
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
        alert(editingConfig ? '更新成功' : '创建成功')
        setShowForm(false)
        setEditingConfig(null)
        fetchConfigs()
      }
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败：' + (error.response?.data?.message || '未知错误'))
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

  return (
    <div className="email-config">
      <div className="config-header">
        <h3>企查查接口配置</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={fetchConfigs} title="刷新列表">
            刷新
          </button>
          <button className="btn-primary" onClick={handleAdd}>
            新增配置
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : configs.length === 0 ? (
        <div className="empty-data">暂无企查查配置</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              <th>应用</th>
              <th>应用凭证</th>
              <th>接口类型</th>
              <th>每日查询限制</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr key={config.id}>
                <td>{config.app_name || '-'}</td>
                <td>{config.qichacha_app_key || '-'}</td>
                <td>{config.interface_type || '企业信息'}</td>
                <td>{config.qichacha_daily_limit || 100}</td>
                <td>
                  <span className={`status-badge ${config.is_active ? 'active' : 'inactive'}`}>
                    {config.is_active ? '启用' : '禁用'}
                  </span>
                </td>
                <td>{formatDate(config.created_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(config.id)}
                    >
                      编辑
                    </button>
                    <button
                      className="btn-log"
                      onClick={() => {
                        setLogConfigId(config.id)
                        setShowLogModal(true)
                      }}
                    >
                      日志
                    </button>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(config.id)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 分页 */}
      {total > 0 && (() => {
        const totalPages = Math.ceil(total / pageSize)
        return totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )
      })()}

      {/* 新增/编辑表单 */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingConfig ? '编辑企查查配置' : '新增企查查配置'}</h3>
              <button className="close-btn" onClick={() => {
                setShowForm(false)
                setEditingConfig(null)
              }}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>应用 *</label>
                  <select
                    name="app_id"
                    value={formData.app_id}
                    onChange={handleChange}
                    required
                    disabled={!!editingConfig}
                  >
                    <option value="">请选择应用</option>
                    {applications.map(app => (
                      <option key={app.id} value={app.id}>
                        {app.app_name}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置企查查的应用'}</p>
                </div>

                <div className="form-group">
                  <label>应用凭证 *</label>
                  <input
                    type="text"
                    name="qichacha_app_key"
                    value={formData.qichacha_app_key}
                    onChange={handleChange}
                    placeholder="请输入企查查应用凭证"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>凭证秘钥 *</label>
                  <input
                    type="password"
                    name="qichacha_secret_key"
                    value={hasSecretKey && !formData.qichacha_secret_key ? '****' : formData.qichacha_secret_key}
                    onChange={handleChange}
                    onFocus={(e) => {
                      if (hasSecretKey && e.target.value === '****') {
                        setHasSecretKey(false)
                        setFormData({ ...formData, qichacha_secret_key: '' })
                        e.target.value = ''
                      }
                    }}
                    placeholder={editingConfig ? (hasSecretKey ? '****' : '留空则不更新密钥') : '请输入企查查凭证秘钥'}
                    required={!editingConfig}
                  />
                  <p className="form-hint">{editingConfig ? '留空则不更新密钥' : '请输入企查查凭证秘钥'}</p>
                </div>

                <div className="form-group">
                  <label>接口类型 *</label>
                  <select
                    name="interface_type"
                    value={formData.interface_type}
                    onChange={handleChange}
                    required
                  >
                    <option value="企业信息">企业信息</option>
                    <option value="新闻舆情">新闻舆情</option>
                  </select>
                  <p className="form-hint">选择该配置用于企业信息查询还是新闻舆情查询</p>
                </div>

                <div className="form-group">
                  <label>每日查询限制次数 *</label>
                  <input
                    type="number"
                    name="qichacha_daily_limit"
                    value={formData.qichacha_daily_limit}
                    onChange={handleChange}
                    min="0"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={handleChange}
                    />
                    启用配置
                  </label>
                </div>

                <div className="form-actions">
                  <button type="button" onClick={() => {
                    setShowForm(false)
                    setEditingConfig(null)
                  }}>
                    取消
                  </button>
                  <button type="submit">
                    {editingConfig ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
    </div>
  )
}

export default QichachaConfig

