import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import axios from '../utils/axios'
import './Login.css'

function Login() {
  const [formData, setFormData] = useState({
    account: '',
    password: ''
  })
  const [error, setError] = useState('')
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

  // 监听系统配置更新事件
  useEffect(() => {
    const handleConfigUpdate = () => {
      fetchSystemConfig()
    }
    window.addEventListener('systemConfigUpdated', handleConfigUpdate)
    return () => {
      window.removeEventListener('systemConfigUpdated', handleConfigUpdate)
    }
  }, [])

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await axios.post('/api/auth/login', formData)
      if (response.data.success) {
        // 存储用户信息到localStorage
        localStorage.setItem('user', JSON.stringify(response.data.user))
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.response?.data?.message || '登录失败，请重试')
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
        {/* 装饰性图表元素 */}
        <div className="chart-panel chart-panel-1"></div>
        <div className="chart-panel chart-panel-2"></div>
        <div className="chart-panel chart-panel-3"></div>
      </div>
      
      <div className="login-card">
        <h1 className="login-title">股权投资小工具锦集</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="account">账号</label>
            <input
              type="text"
              id="account"
              name="account"
              value={formData.account}
              onChange={handleChange}
              required
              placeholder="请输入账号"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              placeholder="请输入密码"
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="register-link">
            还没有账号？<Link to="/register">立即注册</Link>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Login

