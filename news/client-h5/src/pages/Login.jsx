import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Checkbox, Form, Input, Toast } from 'antd-mobile'
import axios from '../utils/axios'
import { isLoggedIn, setUserSession } from '../utils/auth'

export default function Login() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  useEffect(() => {
    if (isLoggedIn()) navigate('/', { replace: true })
  }, [navigate])

  const onFinish = async (values) => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.post('/api/auth/login', {
        account: values.account,
        password: values.password
      })
      if (res.data?.success) {
        setUserSession(res.data.user, rememberMe)
        Toast.show({ content: '登录成功', position: 'bottom' })
        navigate('/', { replace: true })
      } else {
        setError(res.data?.message || '登录失败')
      }
    } catch (err) {
      const status = err.response?.status
      let message = err.response?.data?.message || '登录失败，请重试'
      if (status === 401) message = '密码输入错误，请重试'
      if (status === 403) message = err.response?.data?.message || '账号已被禁用'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h5-login h5-page--no-tab">
      <h1 className="h5-login__title">舆情查看</h1>
      <p className="h5-login__sub">手机端只读 · 与电脑同一账号</p>
      {error ? <div className="h5-login__error">{error}</div> : null}
      <Form
        layout="vertical"
        onFinish={onFinish}
        footer={
          <Button block type="submit" color="primary" loading={loading} size="large">
            登录
          </Button>
        }
      >
        <Form.Item name="account" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
          <Input clearable placeholder="账号" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input clearable type="password" placeholder="密码" />
        </Form.Item>
      </Form>
      <div style={{ marginTop: 12 }}>
        <Checkbox checked={rememberMe} onChange={setRememberMe}>
          记住我 30 天
        </Checkbox>
      </div>
    </div>
  )
}
