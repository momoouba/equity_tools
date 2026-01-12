import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Form, Input, Button, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './Register.css'

const FormItem = Form.Item

function Register() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (values) => {
    if (values.password !== values.confirmPassword) {
      Message.error('两次输入的密码不一致')
      return
    }

    if (values.password.length < 6) {
      Message.error('密码至少需要6位')
      return
    }

    setLoading(true)
    try {
      const { confirmPassword, ...registerData } = values
      const response = await axios.post('/api/auth/register', registerData)
      if (response.data.success) {
        Message.success('注册成功！请登录')
        navigate('/login')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || '注册失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="register-container">
      <div className="register-card">
        <h1 className="register-title">注册账号</h1>
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
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入正确的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱地址" />
          </FormItem>

          <FormItem
            label="密码"
            field="password"
            rules={[
              { required: true, message: '请输入密码' },
              { minLength: 6, message: '密码至少需要6位' }
            ]}
          >
            <Input.Password placeholder="至少6位密码" />
          </FormItem>

          <FormItem
            label="确认密码"
            field="confirmPassword"
            rules={[
              { required: true, message: '请再次输入密码' },
              {
                validator: (value, callback) => {
                  if (value !== form.getFieldValue('password')) {
                    callback('两次输入的密码不一致')
                  }
                }
              }
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </FormItem>

          <FormItem
            label="公司名称"
            field="company_name"
          >
            <Input placeholder="请输入公司名称（可选）" />
          </FormItem>

          <FormItem>
            <Button
              type="primary"
              htmlType="submit"
              long
              loading={loading}
            >
              {loading ? '注册中...' : '注册'}
            </Button>
          </FormItem>

          <div className="login-link">
            已有账号？<Link to="/login">立即登录</Link>
          </div>
        </Form>
      </div>
    </div>
  )
}

export default Register

