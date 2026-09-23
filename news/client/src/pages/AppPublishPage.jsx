import React, { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { Button, Card, Input, Message, Spin } from '@arco-design/web-react'
import axios from '../utils/axios'
import { clearPublishSession, setPublishSession } from '../utils/auth'
import './AppPublishPage.css'

export class PublishErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-publish-gate">
          <div className="app-publish-fallback">
            <h2>页面加载失败</h2>
            <p>{this.state.error.message || '嵌入页面出错'}</p>
            <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * 免登录发布页。校验令牌后写入发布人会话，子路由渲染对应应用页面。
 * 布局按新闻分享页：用文档流撑开高度，避免菜单 iframe 里 100vh 被算成 0 后整页空白。
 */
export default function AppPublishPage() {
  const { token } = useParams()
  const [phase, setPhase] = useState('loading')
  const [appName, setAppName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorText, setErrorText] = useState('')

  const applyVerified = (data, pwd) => {
    setPublishSession({
      token,
      password: pwd || '',
      appName: data.appName,
      user: data.publisher,
    })
    setAppName(data.appName || '')
    setPhase('ready')
  }

  const verify = async (pwd) => {
    const res = await axios.get('/api/app-publish/verify', {
      params: { token, password: pwd || undefined },
    })
    return res.data
  }

  useEffect(() => {
    document.documentElement.classList.add('app-publish-root')
    return () => document.documentElement.classList.remove('app-publish-root')
  }, [])

  useEffect(() => {
    let cancelled = false
    clearPublishSession()
    setPhase('loading')
    setErrorText('')
    ;(async () => {
      try {
        const body = await verify('')
        if (cancelled) return
        if (!body?.success) {
          setErrorText(body?.message || '发布链接无效')
          setPhase('error')
          return
        }
        if (body.data?.needPassword) {
          setAppName(body.data.appName || '')
          setPhase('password')
          return
        }
        applyVerified(body.data, '')
      } catch (e) {
        if (cancelled) return
        setErrorText(e.response?.data?.message || e.message || '发布链接无效')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
      clearPublishSession()
    }
  }, [token])

  const submitPassword = async () => {
    if (!password) {
      Message.warning('请输入访问密码')
      return
    }
    setSubmitting(true)
    try {
      const body = await verify(password)
      if (!body?.success) {
        Message.error(body?.message || '验证失败')
        return
      }
      if (body.data?.needPassword) {
        Message.error('密码错误')
        return
      }
      applyVerified(body.data, password)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '验证失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'loading') {
    return (
      <div className="app-publish-gate">
        <Spin />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="app-publish-gate">
        <Card title="无法打开发布页" style={{ width: 420 }}>
          {errorText}
        </Card>
      </div>
    )
  }

  if (phase === 'password') {
    return (
      <div className="app-publish-gate">
        <Card title={appName ? `访问${appName}` : '访问发布页'} style={{ width: 420 }}>
          <Input.Password
            placeholder="请输入访问密码"
            value={password}
            onChange={setPassword}
            onPressEnter={submitPassword}
          />
          <Button type="primary" long style={{ marginTop: 16 }} loading={submitting} onClick={submitPassword}>
            进入
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="app-publish-shell">
      <Outlet context={{ appName }} />
    </div>
  )
}
