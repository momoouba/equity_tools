import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Button, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './UserProfileModal.css'

const FormItem = Form.Item

function UserProfileModal({ isOpen, onClose, onUpdateUser }) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [appMemberships, setAppMemberships] = useState([])

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
        const profile = response.data.data || {}
        const memberships = Array.isArray(profile.app_memberships) ? profile.app_memberships : []
        setAppMemberships(memberships)

        form.setFieldsValue({
          account: profile.account || '',
          phone: profile.phone || '',
          email: profile.email || '',
          main_membership_level: profile.main_membership_level || '—'
        })
      }
    } catch (error) {
      console.error('获取用户信息失败:', error)
      Message.error('获取用户信息失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      const phoneRegex = /^1[3-9]\d{9}$/
      if (!phoneRegex.test(values.phone)) {
        Message.error('手机号格式不正确')
        setLoading(false)
        return
      }

      if (values.email && values.email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(values.email)) {
          Message.error('邮箱格式不正确')
          setLoading(false)
          return
        }
      }

      const response = await axios.put('/api/auth/profile', {
        phone: values.phone,
        email: values.email || null
      })

      if (response.data.success) {
        Message.success('个人信息更新成功')
        const userData = localStorage.getItem('user')
        if (userData) {
          const user = JSON.parse(userData)
          user.phone = values.phone
          user.email = values.email
          localStorage.setItem('user', JSON.stringify(user))
          if (onUpdateUser) {
            onUpdateUser(user)
          }
        }
        setTimeout(() => {
          onClose()
        }, 2000)
      }
    } catch (error) {
      Message.error(error.response?.data?.message || '更新失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      <Modal
        visible={isOpen}
        title="个人信息"
        onCancel={onClose}
        footer={null}
        style={{ width: 500 }}
      >
        <Form
          form={form}
          onSubmit={handleSubmit}
          layout="vertical"
          autoComplete="off"
        >
          <FormItem
            label="用户名"
            field="account"
          >
            <Input disabled />
          </FormItem>

          <FormItem
            label="主会员等级"
            field="main_membership_level"
          >
            <Input disabled />
          </FormItem>

          <FormItem label="应用名称和会员等级（只读）">
            {appMemberships && appMemberships.length > 0 ? (
              <div style={{ border: '1px solid #e5e6eb', borderRadius: 4, padding: 0 }}>
                {appMemberships.map((m, idx) => (
                  <div
                    key={`${m.app_id || m.app_name || idx}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      padding: '6px 12px',
                      borderTop: idx === 0 ? 'none' : '1px solid #e5e6eb'
                    }}
                  >
                    <span style={{ flex: 1 }}>{m.app_name || m.app_id || '-'}</span>
                    <span
                      style={{
                        flexBasis: 100,
                        textAlign: 'right',
                        color: '#4e5969',
                        borderLeft: '1px solid #e5e6eb',
                        paddingLeft: 12,
                        marginLeft: 12
                      }}
                    >
                      {m.level_name || '无会员等级'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#86909c', fontSize: 13 }}>当前账号尚未配置任何应用会员等级</div>
            )}
          </FormItem>

          <FormItem
            label="手机号"
            field="phone"
            rules={[
              { required: true, message: '请输入手机号' },
              { match: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' }
            ]}
          >
            <Input placeholder="请输入手机号" />
          </FormItem>

          <FormItem
            label="邮箱"
            field="email"
            rules={[
              { type: 'email', message: '请输入正确的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱（可选）" />
          </FormItem>

          <div className="form-actions">
            <Button
              type="outline"
              onClick={() => setShowChangePassword(true)}
            >
              修改密码
            </Button>
            <Button
              type="text"
              onClick={() => {
                Modal.info({
                  title: '忘记密码',
                  content: '如需重置密码，请联系管理员处理。'
                })
              }}
            >
              忘记密码
            </Button>
          </div>

          <div className="form-buttons">
            <Button type="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
          </div>
        </Form>
      </Modal>

      {showChangePassword && (
        <ChangePasswordModal
          isOpen={showChangePassword}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </>
  )
}

function ChangePasswordModal({ isOpen, onClose }) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      form.resetFields()
    }
  }, [isOpen, form])

  const handleSubmit = async (values) => {
    if (values.newPassword.length < 6) {
      Message.error('新密码至少6位')
      return
    }

    if (values.newPassword !== values.confirmPassword) {
      Message.error('两次输入的密码不一致')
      return
    }

    if (values.oldPassword === values.newPassword) {
      Message.error('新密码不能与旧密码相同')
      return
    }

    setLoading(true)
    try {
      const response = await axios.put('/api/auth/change-password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      })

      if (response.data.success) {
        Message.success('密码修改成功')
        setTimeout(() => {
          onClose()
        }, 2000)
      }
    } catch (error) {
      Message.error(error.response?.data?.message || '密码修改失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <Modal
      visible={isOpen}
      title="修改密码"
      onCancel={onClose}
      footer={null}
      style={{ width: 500 }}
    >
      <Form
        form={form}
        onSubmit={handleSubmit}
        layout="vertical"
        autoComplete="off"
      >
        <FormItem
          label="旧密码"
          field="oldPassword"
          rules={[{ required: true, message: '请输入旧密码' }]}
        >
          <Input.Password placeholder="请输入旧密码" />
        </FormItem>

        <FormItem
          label="新密码"
          field="newPassword"
          rules={[
            { required: true, message: '请输入新密码' },
            { minLength: 6, message: '新密码至少6位' }
          ]}
        >
          <Input.Password placeholder="请输入新密码（至少6位）" />
        </FormItem>

        <FormItem
          label="确认新密码"
          field="confirmPassword"
          rules={[
            { required: true, message: '请再次输入新密码' },
            {
              validator: (value, callback) => {
                if (value !== form.getFieldValue('newPassword')) {
                  callback('两次输入的密码不一致')
                }
              }
            }
          ]}
        >
          <Input.Password placeholder="请再次输入新密码" />
        </FormItem>

        <div className="form-buttons">
          <Button type="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            确认修改
          </Button>
        </div>
      </Form>
    </Modal>
  )
}

export default UserProfileModal

