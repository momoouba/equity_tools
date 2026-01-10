import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Button, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './UserProfileModal.css'

const FormItem = Form.Item

function UserProfileModal({ isOpen, onClose, onUpdateUser }) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)

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
        form.setFieldsValue({
          account: response.data.data.account || '',
          phone: response.data.data.phone || '',
          email: response.data.data.email || ''
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

