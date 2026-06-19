import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './DatabaseConfig.css'

function DatabaseConfig() {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [testing, setTesting] = useState(null)
  const [testResult, setTestResult] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    db_type: 'mysql',
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: '',
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
  }, [currentPage])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/database-configs', {
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
      console.error('获取数据库配置列表失败:', error)
      alert('获取配置列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingConfig(null)
    setHasPassword(false)
    setFormData({
      name: '',
      db_type: 'mysql',
      host: '',
      port: 3306,
      user: '',
      password: '',
      database: '',
      is_active: true
    })
    setShowForm(true)
    setTestResult('')
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/database-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        setHasPassword(true)
        setFormData({
          name: config.name,
          db_type: config.db_type || 'mysql',
          host: config.host,
          port: config.port,
          user: config.user,
          password: '',
          database: config.database,
          is_active: config.is_active === 1
        })
        setShowForm(true)
        setTestResult('')
      }
    } catch (error) {
      console.error('获取数据库配置失败:', error)
      alert('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个数据库配置吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/system/database-config/${id}`)
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
    setTestResult('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.name || !formData.host || !formData.user || (!formData.password && !editingConfig) || !formData.database) {
      alert('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        const updateData = { ...formData }
        if (!updateData.password || updateData.password.trim() === '' || updateData.password === '****') {
          delete updateData.password
        }
        response = await axios.put(`/api/system/database-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/database-config', formData)
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

  const handleTest = async () => {
    const password = (formData.password === '****' || formData.password === '') ? '' : formData.password
    if (!formData.host || !formData.port || !formData.user || !password || !formData.database) {
      alert('请先填写完整的数据库配置信息')
      return
    }

    setTesting(editingConfig ? editingConfig.id : 'form')
    setTestResult('')

    try {
      const testData = {
        db_type: formData.db_type,
        host: formData.host,
        port: formData.port,
        user: formData.user,
        password: password,
        database: formData.database
      }

      let response
      if (editingConfig && editingConfig.id) {
        response = await axios.post(`/api/system/database-config/${editingConfig.id}/test`, {})
      } else {
        response = await axios.post('/api/system/database-config/test', testData)
      }

      if (response.data.success) {
        setTestResult('success: ' + (response.data.message || '连接测试成功'))
        alert('连接测试成功！\n' + response.data.message)
      } else {
        setTestResult('error: ' + (response.data.message || '连接测试失败'))
        alert('连接测试失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('测试失败:', error)
      const errorMsg = error.response?.data?.message || '连接测试失败'
      setTestResult('error: ' + errorMsg)
      alert('连接测试失败：' + errorMsg)
    } finally {
      setTesting(null)
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
    <div className="database-config">
      <div className="config-header">
        <h3>数据库连接配置</h3>
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
        <div className="empty-data">暂无数据库配置</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              <th>配置名称</th>
              <th>数据库类型</th>
              <th>主机地址</th>
              <th>端口</th>
              <th>数据库名</th>
              <th>用户名</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr key={config.id}>
                <td>{config.name}</td>
                <td>{config.db_type || 'mysql'}</td>
                <td>{config.host}</td>
                <td>{config.port}</td>
                <td>{config.database}</td>
                <td>{config.user}</td>
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
                      onClick={async () => {
                        try {
                          setTesting(config.id)
                          setTestResult('')
                          const response = await axios.post(`/api/system/database-config/${config.id}/test`, {})
                          if (response.data.success) {
                            alert('连接测试成功！\n' + response.data.message)
                          } else {
                            alert('连接测试失败：' + (response.data.message || '未知错误'))
                          }
                        } catch (error) {
                          const errorMsg = error.response?.data?.message || '连接测试失败'
                          alert('连接测试失败：' + errorMsg)
                        } finally {
                          setTesting(null)
                        }
                      }}
                      disabled={testing === config.id}
                    >
                      {testing === config.id ? '测试中...' : '测试'}
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
              <h3>{editingConfig ? '编辑数据库配置' : '新增数据库配置'}</h3>
              <button className="close-btn" onClick={() => {
                setShowForm(false)
                setEditingConfig(null)
              }}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>配置名称 *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="例如：生产数据库"
                    required
                    disabled={!!editingConfig}
                  />
                  <p className="form-hint">{editingConfig ? '编辑时不能修改配置名称' : '为这个数据库连接起一个便于识别的名称'}</p>
                </div>

                <div className="form-group">
                  <label>数据库类型 *</label>
                  <select
                    name="db_type"
                    value={formData.db_type}
                    onChange={handleChange}
                    required
                    disabled={!!editingConfig}
                  >
                    <option value="mysql">MySQL</option>
                  </select>
                  <p className="form-hint">{editingConfig ? '编辑时不能修改数据库类型' : '当前仅支持MySQL数据库'}</p>
                </div>

                <div className="form-group">
                  <label>主机地址 *</label>
                  <input
                    type="text"
                    name="host"
                    value={formData.host}
                    onChange={handleChange}
                    placeholder="例如：localhost 或 192.168.1.100"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>端口 *</label>
                  <input
                    type="number"
                    name="port"
                    value={formData.port}
                    onChange={handleChange}
                    min="1"
                    max="65535"
                    required
                  />
                  <p className="form-hint">MySQL默认端口：3306</p>
                </div>

                <div className="form-group">
                  <label>数据库名 *</label>
                  <input
                    type="text"
                    name="database"
                    value={formData.database}
                    onChange={handleChange}
                    placeholder="例如：mydb"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>用户名 *</label>
                  <input
                    type="text"
                    name="user"
                    value={formData.user}
                    onChange={handleChange}
                    placeholder="例如：root"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>密码 *</label>
                  <input
                    type="password"
                    name="password"
                    value={hasPassword && !formData.password ? '****' : formData.password}
                    onChange={handleChange}
                    onFocus={(e) => {
                      if (hasPassword && e.target.value === '****') {
                        setHasPassword(false)
                        setFormData({ ...formData, password: '' })
                        e.target.value = ''
                      }
                    }}
                    placeholder={editingConfig ? (hasPassword ? '****' : '留空则不更新密码') : '请输入数据库密码'}
                    required={!editingConfig}
                  />
                  <p className="form-hint">{editingConfig ? '留空则不更新密码' : '请输入数据库密码'}</p>
                </div>

                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={handleChange}
                    />
                    启用此配置
                  </label>
                </div>

                {testResult && (
                  <div className={`test-result ${testResult.startsWith('success') ? 'success' : 'error'}`}>
                    {testResult.startsWith('success') ? '✓ ' : '✗ '}
                    {testResult.replace(/^(success|error):\s*/, '')}
                  </div>
                )}

                <div className="form-actions">
                  <button type="button" onClick={() => {
                    setShowForm(false)
                    setEditingConfig(null)
                    setTestResult('')
                  }}>
                    取消
                  </button>
                  <button 
                    type="button" 
                    className="btn-test"
                    onClick={handleTest}
                    disabled={testing === (editingConfig ? editingConfig.id : 'form')}
                  >
                    {testing === (editingConfig ? editingConfig.id : 'form') ? '测试中...' : '测试连接'}
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
    </div>
  )
}

export default DatabaseConfig

