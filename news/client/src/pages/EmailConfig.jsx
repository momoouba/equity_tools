import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import Pagination from '../components/Pagination'
import './EmailConfig.css'

function EmailConfig() {
  const [configs, setConfigs] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [testing, setTesting] = useState(null) // 存储正在测试的配置ID
  const [testResult, setTestResult] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [hasSmtpPassword, setHasSmtpPassword] = useState(false) // 标记SMTP密码是否存在
  const [hasPopPassword, setHasPopPassword] = useState(false) // 标记POP密码是否存在
  const [showLogModal, setShowLogModal] = useState(false)
  const [logConfigId, setLogConfigId] = useState(null)
  const [formData, setFormData] = useState({
    app_id: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: '',
    smtp_password: '',
    from_email: '',
    from_name: '',
    pop_host: '',
    pop_port: 110,
    pop_secure: false,
    pop_user: '',
    pop_password: '',
    is_active: true
  })

  useEffect(() => {
    fetchConfigs()
    fetchApplications()
  }, [currentPage])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/email-configs', {
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
      console.error('获取邮件配置列表失败:', error)
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
    setHasSmtpPassword(false)
    setHasPopPassword(false)
    setFormData({
      app_id: '',
      smtp_host: '',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: '',
      smtp_password: '',
      from_email: '',
      from_name: '',
      pop_host: '',
      pop_port: 110,
      pop_secure: false,
      pop_user: '',
      pop_password: '',
      is_active: true
    })
    setShowForm(true)
    setTestResult('')
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/system/email-config/${id}`)
      if (response.data.success) {
        const config = response.data.data
        setEditingConfig(config)
        // 检查密码是否存在（通过查询数据库或使用特殊标记）
        // 由于后端不返回密码，我们假设如果配置存在，密码也存在
        setHasSmtpPassword(true) // 编辑模式下，假设SMTP密码存在
        setHasPopPassword(!!config.pop_user) // 如果有POP用户，假设POP密码存在
        setFormData({
          app_id: config.app_id,
          smtp_host: config.smtp_host,
          smtp_port: config.smtp_port,
          smtp_secure: config.smtp_secure === 1,
          smtp_user: config.smtp_user,
          smtp_password: '', // 不显示密码，使用占位符
          from_email: config.from_email,
          from_name: config.from_name || '',
          pop_host: config.pop_host || '',
          pop_port: config.pop_port || 110,
          pop_secure: config.pop_secure === 1,
          pop_user: config.pop_user || '',
          pop_password: '', // 不显示密码，使用占位符
          is_active: config.is_active === 1
        })
        setShowForm(true)
        setTestResult('')
      }
    } catch (error) {
      console.error('获取邮件配置失败:', error)
      alert('获取配置失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个邮件配置吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/system/email-config/${id}`)
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
    
    if (!formData.app_id || !formData.smtp_host || !formData.smtp_user || (!formData.smtp_password && !editingConfig) || !formData.from_email) {
      alert('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingConfig) {
        // 如果密码为空或者是占位符，则不更新密码
        const updateData = { ...formData }
        if (!updateData.smtp_password || updateData.smtp_password.trim() === '' || updateData.smtp_password === '****') {
          delete updateData.smtp_password
        }
        if (!updateData.pop_password || updateData.pop_password.trim() === '' || updateData.pop_password === '****') {
          delete updateData.pop_password
        }
        response = await axios.put(`/api/system/email-config/${editingConfig.id}`, updateData)
      } else {
        response = await axios.post('/api/system/email-config', formData)
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
    // 验证必填字段（排除占位符）
    const smtpPassword = (formData.smtp_password === '****' || formData.smtp_password === '') ? '' : formData.smtp_password
    if (!formData.smtp_host || !formData.smtp_port || !formData.smtp_user || !smtpPassword || !formData.from_email) {
      alert('请先填写完整的SMTP配置信息')
      return
    }

    const email = window.prompt('请输入测试邮箱地址：', testEmail || formData.from_email || '')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (email !== null) {
        alert('请输入有效的测试邮箱地址')
      }
      return
    }

    setTestEmail(email)
    setTesting('form')
    setTestResult('')

    try {
      // 如果是编辑模式，使用配置ID测试；如果是新增模式，使用表单数据测试
      if (editingConfig && editingConfig.id) {
        const response = await axios.post(`/api/system/email-config/${editingConfig.id}/test`, {
          test_email: email
        })

        if (response.data.success) {
          setTestResult('success: ' + (response.data.message || '测试成功'))
          alert('测试邮件已发送，请查收！\n' + response.data.message)
        } else {
          setTestResult('error: ' + (response.data.message || '测试失败'))
          alert('测试失败：' + (response.data.message || '未知错误'))
        }
      } else {
        // 新增模式：使用表单数据直接测试
        // 如果密码是占位符，需要从已保存的配置中获取（但后端不返回密码，所以无法测试）
        let smtpPassword = formData.smtp_password
        if (smtpPassword === '****') {
          // 如果是占位符，说明是编辑模式但用户没有输入新密码，无法测试
          alert('请先输入SMTP密码才能进行测试')
          setTesting(null)
          return
        }
        
        const testData = {
          smtp_host: formData.smtp_host,
          smtp_port: formData.smtp_port,
          smtp_secure: formData.smtp_secure,
          smtp_user: formData.smtp_user,
          smtp_password: smtpPassword,
          from_email: formData.from_email,
          from_name: formData.from_name,
          test_email: email
        }
        
        // 调用测试接口（使用表单数据测试）
        const response = await axios.post('/api/system/email-config/test', testData)

        if (response.data.success) {
          setTestResult('success: ' + (response.data.message || '测试成功'))
          alert('测试邮件已发送，请查收！\n' + response.data.message)
        } else {
          setTestResult('error: ' + (response.data.message || '测试失败'))
          alert('测试失败：' + (response.data.message || '未知错误'))
        }
      }
    } catch (error) {
      console.error('测试失败:', error)
      const errorMsg = error.response?.data?.message || '测试失败'
      setTestResult('error: ' + errorMsg)
      alert('测试失败：' + errorMsg)
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
    <div className="email-config">
      <div className="config-header">
        <h3>邮件发送配置</h3>
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
        <div className="empty-data">暂无邮件配置</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              <th>应用</th>
              <th>SMTP服务器地址</th>
              <th>POP服务器地址</th>
              <th>发件人邮箱</th>
              <th>发件人名称</th>
              <th>收件人名称</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr key={config.id}>
                <td>{config.app_name || '-'}</td>
                <td>{config.smtp_host || '-'}</td>
                <td>{config.pop_host || '-'}</td>
                <td>{config.from_email}</td>
                <td>{config.from_name || '-'}</td>
                <td>{config.pop_user || '-'}</td>
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
              <h3>{editingConfig ? '编辑邮件配置' : '新增邮件配置'}</h3>
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
                    className="form-select"
                  >
                    <option value="">请选择应用</option>
                    {applications.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.app_name}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint">{editingConfig ? '编辑时不能修改应用' : '选择要配置邮件的应用'}</p>
                </div>

                <div className="form-group">
                  <label>SMTP服务器地址 *</label>
                  <input
                    type="text"
                    name="smtp_host"
                    value={formData.smtp_host}
                    onChange={handleChange}
                    placeholder="例如：smtp.qq.com"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>SMTP端口 *</label>
                  <input
                    type="number"
                    name="smtp_port"
                    value={formData.smtp_port}
                    onChange={handleChange}
                    min="1"
                    max="65535"
                    required
                  />
                  <p className="form-hint">常用端口：25, 465(SSL), 587(TLS)</p>
                </div>

                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      name="smtp_secure"
                      checked={formData.smtp_secure}
                      onChange={handleChange}
                    />
                    使用SSL/TLS
                  </label>
                  <p className="form-hint">端口465通常需要启用，端口587通常不需要</p>
                </div>

                <div className="form-group">
                  <label>SMTP用户名（邮箱地址）*</label>
                  <input
                    type="email"
                    name="smtp_user"
                    value={formData.smtp_user}
                    onChange={handleChange}
                    placeholder="例如：user@example.com"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>SMTP密码/授权码 *</label>
                  <input
                    type="password"
                    name="smtp_password"
                    value={hasSmtpPassword && !formData.smtp_password ? '****' : formData.smtp_password}
                    onChange={handleChange}
                    onFocus={(e) => {
                      // 如果显示的是占位符，清空以便用户输入
                      if (hasSmtpPassword && e.target.value === '****') {
                        setHasSmtpPassword(false)
                        setFormData({ ...formData, smtp_password: '' })
                        e.target.value = ''
                      }
                    }}
                    placeholder={editingConfig ? (hasSmtpPassword ? '****' : '留空则不更新密码') : '请输入SMTP密码或授权码'}
                    required={!editingConfig}
                  />
                  <p className="form-hint">{editingConfig ? '留空则不更新密码' : '请输入SMTP密码或授权码'}</p>
                </div>

                <div className="form-group">
                  <label>发件人邮箱 *</label>
                  <input
                    type="email"
                    name="from_email"
                    value={formData.from_email}
                    onChange={handleChange}
                    placeholder="例如：noreply@example.com"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>发件人名称</label>
                  <input
                    type="text"
                    name="from_name"
                    value={formData.from_name}
                    onChange={handleChange}
                    placeholder="例如：系统通知"
                  />
                </div>

                <div className="form-section-divider">
                  <h4>POP接收配置（可选）</h4>
                  <p className="form-hint">用于接收邮件的POP服务器配置，如不需要接收邮件可留空</p>
                </div>

                <div className="form-group">
                  <label>POP服务器地址</label>
                  <input
                    type="text"
                    name="pop_host"
                    value={formData.pop_host}
                    onChange={handleChange}
                    placeholder="例如：pop.qq.com"
                  />
                </div>

                <div className="form-group">
                  <label>POP端口</label>
                  <input
                    type="number"
                    name="pop_port"
                    value={formData.pop_port}
                    onChange={handleChange}
                    min="1"
                    max="65535"
                  />
                  <p className="form-hint">常用端口：110, 995(SSL)</p>
                </div>

                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      name="pop_secure"
                      checked={formData.pop_secure}
                      onChange={handleChange}
                    />
                    POP使用SSL/TLS
                  </label>
                  <p className="form-hint">端口995通常需要启用，端口110通常不需要</p>
                </div>

                <div className="form-group">
                  <label>POP用户名（邮箱地址）</label>
                  <input
                    type="email"
                    name="pop_user"
                    value={formData.pop_user}
                    onChange={handleChange}
                    placeholder="例如：user@example.com"
                  />
                </div>

                <div className="form-group">
                  <label>POP密码/授权码</label>
                  <input
                    type="password"
                    name="pop_password"
                    value={hasPopPassword && !formData.pop_password ? '****' : formData.pop_password}
                    onChange={handleChange}
                    onFocus={(e) => {
                      // 如果显示的是占位符，清空以便用户输入
                      if (hasPopPassword && e.target.value === '****') {
                        setHasPopPassword(false)
                        setFormData({ ...formData, pop_password: '' })
                        e.target.value = ''
                      }
                    }}
                    placeholder={editingConfig ? (hasPopPassword ? '****' : '留空则不更新密码') : '请输入POP密码或授权码'}
                  />
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
                    disabled={testing === 'form'}
                  >
                    {testing === 'form' ? '测试中...' : '测试'}
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
          type="email_config"
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

export default EmailConfig

