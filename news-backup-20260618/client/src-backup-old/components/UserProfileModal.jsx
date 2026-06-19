import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import './UserProfileModal.css'

function UserProfileModal({ isOpen, onClose, onUpdateUser }) {
  const [userInfo, setUserInfo] = useState({
    account: '',
    phone: '',
    email: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchUserInfo()
    }
  }, [isOpen])

  const fetchUserInfo = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/auth/profile')
      if (response.data.success) {
        setUserInfo({
          account: response.data.data.account || '',
          phone: response.data.data.phone || '',
          email: response.data.data.email || ''
        })
      }
    } catch (error) {
      console.error('获取用户信息失败:', error)
      setError('获取用户信息失败')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    setUserInfo({
      ...userInfo,
      [e.target.name]: e.target.value
    })
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      // 验证手机号格式
      const phoneRegex = /^1[3-9]\d{9}$/
      if (!phoneRegex.test(userInfo.phone)) {
        setError('手机号格式不正确')
        setLoading(false)
        return
      }

      // 验证邮箱格式（如果填写了邮箱）
      if (userInfo.email && userInfo.email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(userInfo.email)) {
          setError('邮箱格式不正确')
          setLoading(false)
          return
        }
      }

      const response = await axios.put('/api/auth/profile', {
        phone: userInfo.phone,
        email: userInfo.email || null
      })

      if (response.data.success) {
        setSuccess('个人信息更新成功')
        // 更新localStorage中的用户信息
        const userData = localStorage.getItem('user')
        if (userData) {
          const user = JSON.parse(userData)
          user.phone = userInfo.phone
          user.email = userInfo.email
          localStorage.setItem('user', JSON.stringify(user))
          if (onUpdateUser) {
            onUpdateUser(user)
          }
        }
        // 2秒后关闭弹窗
        setTimeout(() => {
          onClose()
        }, 2000)
      }
    } catch (error) {
      setError(error.response?.data?.message || '更新失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      <div className="user-profile-modal-overlay">
        <div className="user-profile-modal-content">
          <div className="user-profile-modal-header">
            <h3>个人信息</h3>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="user-profile-modal-body">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>用户名</label>
                <input
                  type="text"
                  value={userInfo.account}
                  disabled
                  className="form-input disabled"
                />
              </div>

              <div className="form-group">
                <label>手机号</label>
                <input
                  type="text"
                  name="phone"
                  value={userInfo.phone}
                  onChange={handleChange}
                  className="form-input"
                  placeholder="请输入手机号"
                  required
                />
              </div>

              <div className="form-group">
                <label>邮箱</label>
                <input
                  type="email"
                  name="email"
                  value={userInfo.email}
                  onChange={handleChange}
                  className="form-input"
                  placeholder="请输入邮箱（可选）"
                />
              </div>

              {error && <div className="error-message">{error}</div>}
              {success && <div className="success-message">{success}</div>}

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-change-password"
                  onClick={() => setShowChangePassword(true)}
                >
                  修改密码
                </button>
                <button
                  type="button"
                  className="btn-forgot-password"
                  onClick={() => setShowForgotPassword(true)}
                >
                  忘记密码
                </button>
              </div>

              <div className="form-buttons">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={onClose}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={loading}
                >
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordModal
          isOpen={showChangePassword}
          onClose={() => setShowChangePassword(false)}
        />
      )}

      {showForgotPassword && (
        <ForgotPasswordModal
          isOpen={showForgotPassword}
          onClose={() => setShowForgotPassword(false)}
        />
      )}
    </>
  )
}

// 修改密码弹窗组件
function ChangePasswordModal({ isOpen, onClose }) {
  const [formData, setFormData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!isOpen) {
      // 重置表单
      setFormData({
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      })
      setError('')
      setSuccess('')
    }
  }, [isOpen])

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    // 验证新密码长度
    if (formData.newPassword.length < 6) {
      setError('新密码至少6位')
      return
    }

    // 验证两次密码是否一致
    if (formData.newPassword !== formData.confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    // 验证新旧密码是否相同
    if (formData.oldPassword === formData.newPassword) {
      setError('新密码不能与旧密码相同')
      return
    }

    setLoading(true)

    try {
      const response = await axios.put('/api/auth/change-password', {
        oldPassword: formData.oldPassword,
        newPassword: formData.newPassword
      })

      if (response.data.success) {
        setSuccess('密码修改成功')
        setTimeout(() => {
          onClose()
        }, 2000)
      }
    } catch (error) {
      setError(error.response?.data?.message || '密码修改失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="user-profile-modal-overlay">
      <div className="user-profile-modal-content">
        <div className="user-profile-modal-header">
          <h3>修改密码</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="user-profile-modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>旧密码</label>
              <input
                type="password"
                name="oldPassword"
                value={formData.oldPassword}
                onChange={handleChange}
                className="form-input"
                placeholder="请输入旧密码"
                required
              />
            </div>

            <div className="form-group">
              <label>新密码</label>
              <input
                type="password"
                name="newPassword"
                value={formData.newPassword}
                onChange={handleChange}
                className="form-input"
                placeholder="请输入新密码（至少6位）"
                required
              />
            </div>

            <div className="form-group">
              <label>确认新密码</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="form-input"
                placeholder="请再次输入新密码"
                required
              />
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <div className="form-buttons">
              <button
                type="button"
                className="btn-cancel"
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn-submit"
                disabled={loading}
              >
                {loading ? '修改中...' : '确认修改'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// 忘记密码提示弹窗组件
function ForgotPasswordModal({ isOpen, onClose }) {
  if (!isOpen) return null

  return (
    <div className="user-profile-modal-overlay">
      <div className="user-profile-modal-content">
        <div className="user-profile-modal-header">
          <h3>忘记密码</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="user-profile-modal-body">
          <div className="forgot-password-content">
            <p>如需重置密码，请联系管理员处理。</p>
            <div className="form-buttons">
              <button
                type="button"
                className="btn-submit"
                onClick={onClose}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserProfileModal

