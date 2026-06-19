import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Button, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './CompanyForm.css'

const FormItem = Form.Item

function CompanyForm({ company, onClose, onSubmit }) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (company) {
      form.setFieldsValue({
        enterprise_abbreviation: company.enterprise_abbreviation || '',
        enterprise_full_name: company.enterprise_full_name || '',
        unified_credit_code: company.unified_credit_code || '',
        official_website: company.official_website || '',
        wechat_official_account_id: company.wechat_official_account_id || ''
      })
    } else {
      form.resetFields()
    }
  }, [company, form])

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      if (company) {
        const response = await axios.put(`/api/companies/${company.id}`, values)
        if (response.data.success) {
          Message.success('更新成功')
          onSubmit()
        }
      } else {
        const response = await axios.post('/api/companies', values)
        if (response.data.success) {
          Message.success('创建成功')
          onSubmit()
        }
      }
    } catch (error) {
      Message.error(error.response?.data?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      visible={true}
      title={company ? '编辑企业信息' : '新增企业信息'}
      onCancel={onClose}
      footer={null}
      style={{ width: 600 }}
    >
      <Form
        form={form}
        onSubmit={handleSubmit}
        layout="vertical"
        autoComplete="off"
      >
        <FormItem
          label="企业简称"
          field="enterprise_abbreviation"
          rules={[{ required: true, message: '请输入企业简称' }]}
        >
          <Input placeholder="请输入企业简称" />
        </FormItem>

        <FormItem
          label="企业全称"
          field="enterprise_full_name"
          rules={[{ required: true, message: '请输入企业全称' }]}
        >
          <Input placeholder="请输入企业全称" />
        </FormItem>

        <FormItem
          label="统一信用代码"
          field="unified_credit_code"
        >
          <Input placeholder="请输入统一信用代码" />
        </FormItem>

        <FormItem
          label="公司官网"
          field="official_website"
        >
          <Input placeholder="请输入公司官网" />
        </FormItem>

        <FormItem
          label="微信公众号id"
          field="wechat_official_account_id"
        >
          <Input placeholder="请输入微信公众号id" />
        </FormItem>

        <div className="form-actions">
          <Button type="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            确定
          </Button>
        </div>
      </Form>
    </Modal>
  )
}

export default CompanyForm

