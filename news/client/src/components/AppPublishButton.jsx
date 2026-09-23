import React, { useEffect, useState } from 'react'
import { Button, DatePicker, Form, Input, Message, Modal, Radio, Space } from '@arco-design/web-react'
import { IconShareAlt } from '@arco-design/web-react/icon'
import axios from '../utils/axios'

const FormItem = Form.Item

/** 当前页是 HTTPS 时，把同主机的 http 链接升成 https，避免嵌入页被混合内容拦截。 */
function toEmbeddableUrl(url) {
  if (!url || typeof window === 'undefined') return url
  try {
    const parsed = new URL(url, window.location.origin)
    if (
      window.location.protocol === 'https:' &&
      parsed.protocol === 'http:' &&
      parsed.hostname === window.location.hostname
    ) {
      parsed.protocol = 'https:'
      return parsed.toString()
    }
  } catch {
    return url
  }
  return url
}

function toExpiryPayload(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * 与业绩看板分享按钮一致：生成可嵌入的免登录链接，访问时沿用当前用户鉴权。
 * appName 为 applications.app_name（竞品分析 / 项目估值）。
 */
export default function AppPublishButton({ appName }) {
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [hasExisting, setHasExisting] = useState(false)
  const [form] = Form.useForm()

  const loadCurrent = async () => {
    try {
      const res = await axios.get('/api/app-publish/current', { params: { appName } })
      const data = res.data?.data
      if (res.data?.success && data?.shareUrl) {
        setShareUrl(toEmbeddableUrl(data.shareUrl))
        setHasExisting(true)
        form.setFieldsValue({
          hasExpiry: !!data.hasExpiry,
          expiryTime: data.expiryTime || null,
          hasPassword: !!data.hasPassword,
          password: '',
        })
      } else {
        setShareUrl('')
        setHasExisting(false)
        form.setFieldsValue({
          hasExpiry: false,
          expiryTime: null,
          hasPassword: false,
          password: '',
        })
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '读取发布信息失败')
    }
  }

  useEffect(() => {
    if (visible) loadCurrent()
  }, [visible])

  const submit = async (rotateToken) => {
    let values
    try {
      values = await form.validate()
    } catch {
      return
    }
    if (values.hasPassword && !values.password && !hasExisting) {
      Message.warning('请输入访问密码')
      return
    }
    if (values.hasExpiry && !values.expiryTime) {
      Message.warning('请选择过期时间')
      return
    }
    setLoading(true)
    try {
      const res = await axios.post('/api/app-publish/create', {
        appName,
        hasExpiry: !!values.hasExpiry,
        expiryTime: values.hasExpiry ? toExpiryPayload(values.expiryTime) : null,
        hasPassword: !!values.hasPassword,
        password: values.password || '',
        rotateToken: !!rotateToken,
      })
      if (res.data?.success) {
        setShareUrl(toEmbeddableUrl(res.data.data.shareUrl))
        setHasExisting(true)
        Message.success(rotateToken ? '已重新生成发布链接' : '发布链接已生成')
      } else {
        Message.error(res.data?.message || '发布失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '发布失败')
    } finally {
      setLoading(false)
    }
  }

  const copyUrl = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      Message.success('链接已复制')
    } catch {
      Message.warning('复制失败，请手动选择链接')
    }
  }

  const closePublish = () => {
    Modal.confirm({
      title: '关闭发布',
      content: '关闭后，已嵌入其他系统的链接将立即失效。',
      onOk: async () => {
        const res = await axios.post('/api/app-publish/close', { appName })
        if (res.data?.success) {
          setShareUrl('')
          setHasExisting(false)
          Message.success('发布已关闭')
        } else {
          Message.error(res.data?.message || '关闭失败')
        }
      },
    })
  }

  return (
    <>
      <Button type="primary" status="danger" icon={<IconShareAlt />} onClick={() => setVisible(true)}>
        发布
      </Button>
      <Modal
        title={`发布${appName}`}
        visible={visible}
        onCancel={() => setVisible(false)}
        footer={
          <Space>
            {hasExisting ? (
              <Button status="danger" onClick={closePublish}>
                关闭发布
              </Button>
            ) : null}
            {hasExisting ? (
              <Button loading={loading} onClick={() => submit(true)}>
                重新生成链接
              </Button>
            ) : null}
            <Button type="primary" loading={loading} onClick={() => submit(false)}>
              {hasExisting ? '更新发布' : '生成链接'}
            </Button>
          </Space>
        }
        style={{ width: 520 }}
        unmountOnExit
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ hasExpiry: false, hasPassword: false, password: '' }}
        >
          <FormItem label="有效期" field="hasExpiry">
            <Radio.Group>
              <Radio value={false}>永久有效</Radio>
              <Radio value={true}>设置有效期</Radio>
            </Radio.Group>
          </FormItem>
          <Form.Item shouldUpdate noStyle>
            {(values) => values.hasExpiry ? (
              <FormItem field="expiryTime" label="过期时间">
                <DatePicker showTime style={{ width: '100%' }} placeholder="选择过期时间" />
              </FormItem>
            ) : null}
          </Form.Item>
          <FormItem label="访问密码" field="hasPassword">
            <Radio.Group>
              <Radio value={false}>无需密码</Radio>
              <Radio value={true}>设置密码</Radio>
            </Radio.Group>
          </FormItem>
          <Form.Item shouldUpdate noStyle>
            {(values) => values.hasPassword ? (
              <FormItem field="password" label="密码" extra={hasExisting ? '留空则保持原密码' : undefined}>
                <Input.Password placeholder={hasExisting ? '留空保持原密码' : '请输入访问密码'} />
              </FormItem>
            ) : null}
          </Form.Item>
        </Form>
        {shareUrl ? (
          <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid #e5e6eb' }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>发布链接（可嵌入其他系统，无需登录）</div>
            <Input
              readOnly
              value={shareUrl}
              addAfter={<Button onClick={copyUrl}>复制</Button>}
            />
          </div>
        ) : null}
      </Modal>
    </>
  )
}
