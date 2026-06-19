import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import './SystemConfig.css'

function BasicSystemConfig() {
  const [formData, setFormData] = useState({
    system_name: '',
    login_background: '',
    logo: ''
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [logoPreview, setLogoPreview] = useState('')
  const [backgroundPreview, setBackgroundPreview] = useState('')

  const submitConfig = async (data, { showLoader = false, successText = '', errorText = '保存失败' } = {}) => {
    if (showLoader) {
      setLoading(true)
    }
    try {
      const response = await axios.put('/api/system/basic-config', data)
      if (response.data.success) {
        if (successText) {
          setMessage({ type: 'success', text: successText })
        }
        window.dispatchEvent(new CustomEvent('systemConfigUpdated'))
        return true
      }
      throw new Error(response.data.message || '保存失败')
    } catch (error) {
      console.error('保存系统配置失败:', error)
      if (errorText) {
        setMessage({ type: 'error', text: `${errorText}：${error.response?.data?.message || error.message}` })
      }
      return false
    } finally {
      if (showLoader) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/system/basic-config')
      if (response.data.success) {
        const config = response.data.data || {}
        setFormData({
          system_name: config.system_name || '',
          login_background: config.login_background || '',
          logo: config.logo || ''
        })
        if (config.logo) {
          setLogoPreview(`/api/uploads/${config.logo}`)
        }
        if (config.login_background) {
          setBackgroundPreview(`/api/uploads/${config.login_background}`)
        }
      }
    } catch (error) {
      console.error('获取系统配置失败:', error)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value
    })
    setMessage({ type: '', text: '' })
  }

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: '请上传图片文件' })
      return
    }

    // 验证文件大小（最大5MB）
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: '图片大小不能超过5MB' })
      return
    }

    const formDataToSend = new FormData()
    formDataToSend.append('file', file)
    formDataToSend.append('type', 'logo')

    try {
      setLoading(true)
      const response = await axios.post('/api/system/upload', formDataToSend, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      if (response.data.success) {
        const updatedData = {
          ...formData,
          logo: response.data.filename
        }
        setFormData(updatedData)
        setLogoPreview(`/api/uploads/${response.data.filename}`)
        await submitConfig(updatedData, {
          successText: 'Logo上传并保存成功',
          errorText: 'Logo保存失败'
        })
      }
    } catch (error) {
      console.error('上传Logo失败:', error)
      setMessage({ type: 'error', text: '上传Logo失败：' + (error.response?.data?.message || '未知错误') })
    } finally {
      setLoading(false)
    }
  }

  const handleBackgroundUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: '请上传图片文件' })
      return
    }

    // 验证文件大小（最大10MB）
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: 'error', text: '图片大小不能超过10MB' })
      return
    }

    const formDataToSend = new FormData()
    formDataToSend.append('file', file)
    formDataToSend.append('type', 'background')

    try {
      setLoading(true)
      const response = await axios.post('/api/system/upload', formDataToSend, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      if (response.data.success) {
        const updatedData = {
          ...formData,
          login_background: response.data.filename
        }
        setFormData(updatedData)
        setBackgroundPreview(`/api/uploads/${response.data.filename}`)
        await submitConfig(updatedData, {
          successText: '登录页底图上传并保存成功',
          errorText: '登录页底图保存失败'
        })
      }
    } catch (error) {
      console.error('上传底图失败:', error)
      setMessage({ type: 'error', text: '上传底图失败：' + (error.response?.data?.message || '未知错误') })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage({ type: '', text: '' })
    await submitConfig(formData, { showLoader: true, successText: '系统配置保存成功' })
  }

  return (
    <div className="config-form">
      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="config-section">
          <h3>系统基本信息</h3>
          
          <div className="form-group">
            <label>系统名称</label>
            <input
              type="text"
              name="system_name"
              value={formData.system_name}
              onChange={handleInputChange}
              placeholder="请输入系统名称"
            />
            <div className="form-hint">此名称将显示在页面顶部栏</div>
          </div>

          <div className="form-group">
            <label>系统Logo</label>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              {logoPreview && (
                <div style={{ 
                  width: '120px', 
                  height: '120px', 
                  border: '1px solid #e0e0e0', 
                  borderRadius: '8px',
                  padding: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#fafafa'
                }}>
                  <img 
                    src={logoPreview} 
                    alt="Logo预览" 
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  disabled={loading}
                  style={{ marginBottom: '8px' }}
                />
                <div className="form-hint">支持JPG、PNG格式，建议尺寸：120x120px，最大5MB</div>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>登录页底图</label>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              {backgroundPreview && (
                <div style={{ 
                  width: '200px', 
                  height: '120px', 
                  border: '1px solid #e0e0e0', 
                  borderRadius: '8px',
                  padding: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#fafafa',
                  overflow: 'hidden'
                }}>
                  <img 
                    src={backgroundPreview} 
                    alt="底图预览" 
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' }}
                  />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleBackgroundUpload}
                  disabled={loading}
                  style={{ marginBottom: '8px' }}
                />
                <div className="form-hint">支持JPG、PNG格式，建议尺寸：1920x1080px，最大10MB</div>
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn-save" disabled={loading}>
            {loading ? '保存中...' : '保存配置'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default BasicSystemConfig

