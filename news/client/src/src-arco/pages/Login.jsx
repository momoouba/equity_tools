import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Form, Input, Button, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './Login.css'

const FormItem = Form.Item

function Login() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [backgroundImage, setBackgroundImage] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchSystemConfig()
  }, [])

  const fetchSystemConfig = async () => {
    try {
      const response = await axios.get('/api/system/basic-config')
      if (response.data.success && response.data.data.login_background) {
        setBackgroundImage(`/api/uploads/${response.data.data.login_background}`)
      }
    } catch (error) {
      console.error('获取系统配置失败:', error)
    }
  }

  useEffect(() => {
    const handleConfigUpdate = () => {
      fetchSystemConfig()
    }
    window.addEventListener('systemConfigUpdated', handleConfigUpdate)
    return () => {
      window.removeEventListener('systemConfigUpdated', handleConfigUpdate)
    }
  }, [])

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      const response = await axios.post('/api/auth/login', values)
      if (response.data.success) {
        localStorage.setItem('user', JSON.stringify(response.data.user))
        Message.success('登录成功')
        navigate('/dashboard')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container" style={backgroundImage ? {
      backgroundImage: `url(${backgroundImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    } : {}}>
      <div className="login-background" style={backgroundImage ? { display: 'none' } : {}}>
        <div className="chart-panel chart-panel-1"></div>
        <div className="chart-panel chart-panel-2"></div>
        <div className="chart-panel chart-panel-3"></div>
      </div>
      
      <div className="login-card">
        <h1 className="login-title">股权投资小工具锦集</h1>
        <Form
          form={form}
          onSubmit={handleSubmit}
          layout="vertical"
          autoComplete="off"
        >
          <FormItem
            label="账号"
            field="account"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input placeholder="请输入账号" />
          </FormItem>
          
          <FormItem
            label="密码"
            field="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </FormItem>

          <FormItem>
            <Button
              type="primary"
              htmlType="submit"
              long
              loading={loading}
            >
              {loading ? '登录中...' : '登录'}
            </Button>
          </FormItem>

          <div className="register-link">
            还没有账号？<Link to="/register">立即注册</Link>
          </div>
        </Form>
      </div>
    </div>
  )
}

export default Login

