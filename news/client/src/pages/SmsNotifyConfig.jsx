import React, { useEffect, useState } from 'react'
import { Form, Input, Button, Message, Select, Switch } from '@arco-design/web-react'
import axios from '../utils/axios'
import './BasicSystemConfig.css'

const FormItem = Form.Item

function SmsNotifyConfig() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [hasSecret, setHasSecret] = useState(false)
  const provider = Form.useWatch('provider', form)

  const fetchConfig = async () => {
    try {
      const response = await axios.get('/api/system/sms-notify-config', {
        params: { _t: Date.now() },
      })
      if (response.data.success) {
        const config = response.data.data || {}
        setHasSecret(!!config.has_secret)
        form.setFieldsValue({
          provider: config.provider || 'aliyun',
          access_key_id: config.access_key_id || '',
          access_key_secret: '',
          sign_name: config.sign_name || '',
          template_code: config.template_code || '',
          sdk_app_id: config.sdk_app_id || '',
          is_active: config.is_active !== false,
        })
      }
    } catch (error) {
      console.error('获取短信通知配置失败:', error)
      Message.error(error.response?.data?.message || '获取短信通知配置失败')
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  const handleSave = async () => {
    let values
    try {
      values = await form.validate()
    } catch {
      return
    }
    setLoading(true)
    try {
      const response = await axios.put('/api/system/sms-notify-config', {
        provider: values.provider,
        access_key_id: values.access_key_id,
        access_key_secret: values.access_key_secret || '',
        sign_name: values.sign_name,
        template_code: values.template_code,
        sdk_app_id: values.sdk_app_id || '',
        is_active: values.is_active !== false,
      })
      if (response.data.success) {
        Message.success(response.data.message || '短信通知配置已保存')
        form.setFieldValue('access_key_secret', '')
        setHasSecret(true)
      } else {
        Message.error(response.data.message || '保存失败')
      }
    } catch (error) {
      Message.error(error.response?.data?.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="basic-system-config">
      <Form form={form} layout="vertical" autoComplete="off" style={{ maxWidth: 640 }}>
        <div className="config-section">
          <h3>短信通知</h3>
          <div className="form-hint" style={{ marginBottom: 16 }}>
            用于竞品分析完成后的通知短信。模板变量 name 填入本次分析企业的企业全称。阿里云模板示例：您发起的
            {'${name}'}
            项目竞品分析已完成，请登录系统查看。腾讯云请把企业全称配成模板的第一个变量，并填写短信应用编号。
          </div>

          <FormItem label="启用" field="is_active" triggerPropName="checked">
            <Switch />
          </FormItem>

          <FormItem
            label="短信厂家"
            field="provider"
            rules={[{ required: true, message: '请选择短信厂家' }]}
          >
            <Select placeholder="请选择短信厂家">
              <Select.Option value="aliyun">阿里云</Select.Option>
              <Select.Option value="tencent">腾讯云</Select.Option>
            </Select>
          </FormItem>

          <FormItem
            label="用户编号"
            field="access_key_id"
            rules={[{ required: true, message: '请填写用户编号' }]}
          >
            <Input placeholder="阿里云 AccessKey Id，或腾讯云 SecretId" allowClear />
          </FormItem>

          <FormItem label="用户密钥" field="access_key_secret">
            <Input.Password
              placeholder={hasSecret ? '已保存，留空则不修改' : '阿里云 AccessKey Secret，或腾讯云 SecretKey'}
              autoComplete="new-password"
            />
          </FormItem>

          <FormItem
            label="签名内容"
            field="sign_name"
            extra="填写签名正文，不需要带【】"
            rules={[{ required: true, message: '请填写签名内容' }]}
          >
            <Input placeholder="如：上海国际股权投资基金" allowClear />
          </FormItem>

          <FormItem
            label="模板编号"
            field="template_code"
            rules={[{ required: true, message: '请填写模板编号' }]}
          >
            <Input placeholder="如：SMS_512631192" allowClear />
          </FormItem>

          {provider === 'tencent' ? (
            <FormItem
              label="短信应用编号"
              field="sdk_app_id"
              rules={[{ required: true, message: '腾讯云请填写短信应用编号' }]}
            >
              <Input placeholder="腾讯云 SmsSdkAppId" allowClear />
            </FormItem>
          ) : null}

          <Button type="primary" loading={loading} disabled={!ready} onClick={handleSave}>
            保存
          </Button>
        </div>
      </Form>
    </div>
  )
}

export default SmsNotifyConfig
