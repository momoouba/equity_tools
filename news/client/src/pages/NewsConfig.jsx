import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import Pagination from '../components/Pagination'
import './EmailConfig.css'

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
  const [syncing, setSyncing] = useState(false)
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

  // 当接口类型切换为企查查时，自动设置默认值（仅在新增时，编辑时保持原有值）
  useEffect(() => {
    if (formData.interface_type === '企查查' && !editingConfig) {
      setFormData(prev => ({
        ...prev,
        request_url: prev.request_url || 'https://api.qichacha.com/CompanyNews/SearchNews',
        frequency_type: prev.frequency_type || 'week', // 企查查接口默认按周执行，但可编辑
        frequency_value: prev.frequency_value || 1 // 企查查接口默认1周，但可编辑
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

  // 当接口类型切换为企查查时，自动设置默认值
  useEffect(() => {
    if (formData.interface_type === '企查查' && !editingConfig) {
      setFormData(prev => ({
        ...prev,
        request_url: 'https://api.qichacha.com/CompanyNews/SearchNews',
        frequency_type: 'week', // 企查查接口默认按周执行
        frequency_value: 1
      }))
    }
  }, [formData.interface_type, editingConfig])

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
          api_key: '', // 不显示密钥
          frequency_type: config.frequency_type || 'day',
          frequency_value: config.frequency_value || 1,
          is_active: config.is_active === 1
        })
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取新闻接口配置失败:', error)
      alert('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个新闻接口配置吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/system/news-config/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchConfigs()
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleSync = async (id) => {
    if (!window.confirm('确定要开始同步公众号数据吗？')) {
      return
    }

    setSyncing(true)
    try {
      const response = await axios.post('/api/news/sync', { config_id: id })
      if (response.data.success) {
        alert(`同步完成：${response.data.message}`)
        fetchConfigs()
      } else {
        alert('同步失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('同步请求失败:', error)
      if (error.code === 'ECONNABORTED') {
        alert('同步超时，但数据可能仍在后台处理中，请稍后查看结果')
      } else {
        alert('同步失败：' + (error.response?.data?.message || error.message || '网络错误'))
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : (type === 'number' ? parseInt(value, 10) : value)
    })
    
    // 如果用户开始输入密钥，清除"已有密钥"标记
    if (name === 'api_key' && value !== '') {
      setHasApiKey(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    // 企查查接口不需要api_key，从qichacha_config获取
    const isQichacha = formData.interface_type === '企查查'
    if (!formData.app_id || !formData.request_url || (!isQichacha && !formData.api_key) || !formData.frequency_type || !formData.frequency_value) {
      alert('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.api_key || updateData.api_key.trim() === '' || updateData.api_key === '****') {
          delete updateData.api_key
        }
        response = await axios.put(`/api/system/news-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/news-config', formData)
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
        <h3>新闻接口配置</h3>
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
        <div className="empty-data">暂无新闻接口配置</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              <th>应用</th>
              <th>新闻接口类型</th>
              <th>请求地址</th>
              <th>频次类型</th>
              <th>频次值</th>
              <th>最后同步时间</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr key={config.id}>
                <td>{config.app_name || '-'}</td>
                <td>{config.interface_type || '新榜'}</td>
                <td>{config.request_url || '-'}</td>
                <td>
                  {config.frequency_type === 'day' ? '天' : 
                   config.frequency_type === 'week' ? '周' : '月'}
                </td>
                <td>{config.frequency_value}</td>
                <td>{config.last_sync_time ? formatDate(config.last_sync_time) : '-'}</td>
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
                      className="btn-test"
                      onClick={() => handleSync(config.id)}
                      disabled={syncing}
                    >
                      {syncing ? '同步中...' : '同步'}
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
              <h3>{editingConfig ? '编辑新闻接口配置' : '新增新闻接口配置'}</h3>
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
                  <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置新闻接口的应用'}</p>
                </div>

                <div className="form-group">
                  <label>新闻接口类型 *</label>
                  <select
                    name="interface_type"
                    value={formData.interface_type}
                    onChange={handleChange}
                    required
                    disabled={!!editingConfig}
                  >
                    <option value="新榜">新榜</option>
                    <option value="企查查">企查查</option>
                  </select>
                  <p className="form-hint">{editingConfig ? '编辑时不能修改接口类型' : '选择新闻接口类型'}</p>
                </div>

                <div className="form-group">
                  <label>请求地址 *</label>
                  <input
                    type="text"
                    name="request_url"
                    value={formData.request_url}
                    onChange={handleChange}
                    placeholder={formData.interface_type === '企查查' 
                      ? 'https://api.qichacha.com/CompanyNews/SearchNews' 
                      : 'https://api.newrank.cn/api/sync/weixin/account/articles_content'}
                    required
                  />
                  <p className="form-hint">
                    {formData.interface_type === '企查查' 
                      ? '企查查舆情接口地址' 
                      : '新榜接口地址'}
                  </p>
                </div>

                <div className="form-group">
                  <label>Content-Type {formData.interface_type === '企查查' ? '' : '*'}</label>
                  <input
                    type="text"
                    name="content_type"
                    value={formData.content_type}
                    onChange={handleChange}
                    placeholder="application/x-www-form-urlencoded;charset=utf-8"
                    required={formData.interface_type !== '企查查'}
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
                  <input
                    type="password"
                    name="api_key"
                    value={hasApiKey && !formData.api_key ? '****' : formData.api_key}
                    onChange={handleChange}
                    onFocus={(e) => {
                      if (hasApiKey && e.target.value === '****') {
                        setHasApiKey(false)
                        setFormData({ ...formData, api_key: '' })
                        e.target.value = ''
                      }
                    }}
                    placeholder={editingConfig ? (hasApiKey ? '****' : '留空则不更新密钥') : formData.interface_type === '企查查' ? '企查查接口使用企查查配置中的凭证' : '请输入Key'}
                    required={!editingConfig && formData.interface_type !== '企查查'}
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
                  <select
                    name="frequency_type"
                    value={formData.frequency_type}
                    onChange={handleChange}
                    required
                  >
                    <option value="day">天</option>
                    <option value="week">周</option>
                    <option value="month">月</option>
                  </select>
                  {formData.interface_type === '企查查' && (
                    <p className="form-hint" style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>
                      企查查接口频次类型可编辑，编辑后将同步更新到定时任务配置
                    </p>
                  )}
                </div>

                <div className="form-group">
                  <label>数据取数频次值 *</label>
                  <input
                    type="number"
                    name="frequency_value"
                    value={formData.frequency_value}
                    onChange={handleChange}
                    min="1"
                    required
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

