import React, { useState, useEffect } from 'react'
import { Form, Input, Button, Message, Upload } from '@arco-design/web-react'
import axios from '../utils/axios'
import './BasicSystemConfig.css'

const FormItem = Form.Item

function BasicSystemConfig() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [logoPreview, setLogoPreview] = useState('')
  const [backgroundPreview, setBackgroundPreview] = useState('')

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/system/basic-config')
      if (response.data.success) {
        const config = response.data.data || {}
        form.setFieldsValue({
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

  const handleLogoUpload = async (file) => {
    if (!file.type.startsWith('image/')) {
      Message.error('请上传图片文件')
      return false
    }

    if (file.size > 5 * 1024 * 1024) {
      Message.error('图片大小不能超过5MB')
      return false
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
          system_name: form.getFieldValue('system_name'),
          login_background: form.getFieldValue('login_background'),
          logo: response.data.filename
        }
        form.setFieldsValue({ logo: response.data.filename })
        setLogoPreview(`/api/uploads/${response.data.filename}`)
        await submitConfig(updatedData, 'Logo上传并保存成功', 'Logo保存失败')
      }
    } catch (error) {
      console.error('上传Logo失败:', error)
      Message.error('上传Logo失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
    return false
  }

  const handleBackgroundUpload = async (file) => {
    if (!file.type.startsWith('image/')) {
      Message.error('请上传图片文件')
      return false
    }

    if (file.size > 10 * 1024 * 1024) {
      Message.error('图片大小不能超过10MB')
      return false
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
          system_name: form.getFieldValue('system_name'),
          login_background: response.data.filename,
          logo: form.getFieldValue('logo')
        }
        form.setFieldsValue({ login_background: response.data.filename })
        setBackgroundPreview(`/api/uploads/${response.data.filename}`)
        await submitConfig(updatedData, '登录页底图上传并保存成功', '登录页底图保存失败')
      }
    } catch (error) {
      console.error('上传底图失败:', error)
      Message.error('上传底图失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
    return false
  }

  const handleDeleteLogo = async () => {
    try {
      setLoading(true)
      const updatedData = {
        system_name: form.getFieldValue('system_name'),
        login_background: form.getFieldValue('login_background'),
        logo: ''
      }
      form.setFieldsValue({ logo: '' })
      setLogoPreview('')
      await submitConfig(updatedData, 'Logo删除成功', 'Logo删除失败')
    } catch (error) {
      console.error('删除Logo失败:', error)
      Message.error('删除Logo失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteBackground = async () => {
    try {
      setLoading(true)
      const updatedData = {
        system_name: form.getFieldValue('system_name'),
        login_background: '',
        logo: form.getFieldValue('logo')
      }
      form.setFieldsValue({ login_background: '' })
      setBackgroundPreview('')
      await submitConfig(updatedData, '登录页底图删除成功', '登录页底图删除失败')
    } catch (error) {
      console.error('删除底图失败:', error)
      Message.error('删除底图失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const submitConfig = async (data, successText, errorText) => {
    try {
      const response = await axios.put('/api/system/basic-config', data)
      if (response.data.success) {
        if (successText) {
          Message.success(successText)
        }
        window.dispatchEvent(new CustomEvent('systemConfigUpdated'))
        return true
      }
      throw new Error(response.data.message || '保存失败')
    } catch (error) {
      console.error('保存系统配置失败:', error)
      if (errorText) {
        Message.error(`${errorText}：${error.response?.data?.message || error.message}`)
      }
      return false
    }
  }

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      await submitConfig(values, '系统配置保存成功', '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="basic-system-config">
      <Form
        form={form}
        onSubmit={handleSubmit}
        layout="vertical"
        autoComplete="off"
      >
        <div className="config-section">
          <h3>系统基本信息</h3>
          
          <FormItem
            label="系统名称"
            field="system_name"
          >
            <Input placeholder="请输入系统名称" />
            <div className="form-hint">此名称将显示在页面顶部栏</div>
          </FormItem>

          <FormItem
            label="系统Logo"
            field="logo"
          >
            <div className="upload-preview-container">
              {logoPreview && (
                <div className="preview-image">
                  <img 
                    src={logoPreview} 
                    alt="Logo预览" 
                  />
                  <Button
                    type="text"
                    size="mini"
                    className="delete-image-btn"
                    onClick={handleDeleteLogo}
                    disabled={loading}
                  >
                    ×
                  </Button>
                </div>
              )}
              <Upload
                accept="image/*"
                beforeUpload={handleLogoUpload}
                showUploadList={false}
                disabled={loading}
              >
                <Button type="outline" loading={loading}>
                  上传Logo
                </Button>
              </Upload>
            </div>
            <div className="form-hint">支持JPG、PNG格式，建议尺寸：120x120px，最大5MB</div>
          </FormItem>

          <FormItem
            label="登录页底图"
            field="login_background"
          >
            <div className="upload-preview-container">
              {backgroundPreview && (
                <div className="preview-image background-preview">
                  <img 
                    src={backgroundPreview} 
                    alt="底图预览" 
                  />
                  <Button
                    type="text"
                    size="mini"
                    className="delete-image-btn"
                    onClick={handleDeleteBackground}
                    disabled={loading}
                  >
                    ×
                  </Button>
                </div>
              )}
              <Upload
                accept="image/*"
                beforeUpload={handleBackgroundUpload}
                showUploadList={false}
                disabled={loading}
              >
                <Button type="outline" loading={loading}>
                  上传底图
                </Button>
              </Upload>
            </div>
            <div className="form-hint">支持JPG、PNG格式，建议尺寸：1920x1080px，最大10MB</div>
          </FormItem>
        </div>

        <div className="form-actions">
          <Button type="primary" htmlType="submit" loading={loading}>
            保存配置
          </Button>
        </div>
      </Form>
    </div>
  )
}

export default BasicSystemConfig

