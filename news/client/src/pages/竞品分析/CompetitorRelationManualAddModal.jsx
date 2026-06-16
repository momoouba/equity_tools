import React, { useEffect } from 'react'
import { Modal, Form, Input, Select, InputNumber, Checkbox, Message } from '@arco-design/web-react'
import { postCompetitorRelation, putCompetitorRelation } from '../../api/竞品分析'
import { formatCompetitorDataSources } from './competitorRelationColumns'

const FormItem = Form.Item

const GRADE_OPTIONS = [
  { label: 'S', value: 'S' },
  { label: 'A', value: 'A' },
  { label: 'B', value: 'B' },
  { label: 'C', value: 'C' },
]

function buildSubmitBody(values, subjectType, subjectId) {
  const body = {
    competitor_display_name: String(values.competitor_display_name || '').trim(),
    unified_credit_code: String(values.unified_credit_code || '').trim() || undefined,
    is_listed: Number(values.is_listed) === 1 ? 1 : 0,
    confidence_grade: values.confidence_grade || undefined,
    relevance_score: values.relevance_score ?? undefined,
    competitor_product_intro: String(values.competitor_product_intro || '').trim() || undefined,
    competitor_tags_display: String(values.competitor_tags_display || '').trim() || undefined,
    sub_fund_names: String(values.sub_fund_names || '').trim() || undefined,
    financing_history_text: String(values.financing_history_text || '').trim() || undefined,
    include_in_comparable: !!values.include_in_comparable,
  }
  if (subjectType === 'pre_investment_project') {
    body.pre_investment_project_id = subjectId
  } else {
    body.invested_enterprise_id = subjectId
  }
  return body
}

/**
 * 竞品明细 — 手动新增/编辑竞品弹窗。
 */
export default function CompetitorRelationManualAddModal({
  visible,
  onClose,
  subjectType,
  subjectId,
  subjectLabel,
  editingRecord,
  onSaved,
}) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = React.useState(false)
  const isEdit = !!editingRecord?.id

  useEffect(() => {
    if (!visible) return
    if (isEdit) {
      form.setFieldsValue({
        competitor_display_name: editingRecord.competitor_display_name || '',
        unified_credit_code: editingRecord.unified_credit_code || '',
        is_listed: Number(editingRecord.is_listed) === 1 ? 1 : 0,
        confidence_grade: editingRecord.confidence_grade || undefined,
        relevance_score: editingRecord.relevance_score ?? undefined,
        competitor_product_intro: editingRecord.competitor_product_intro || '',
        competitor_tags_display: editingRecord.competitor_tags_display || '',
        sub_fund_names: editingRecord.sub_fund_names || '',
        data_source_display: formatCompetitorDataSources(editingRecord.data_sources_json),
        financing_history_text:
          editingRecord.financing_history_text || editingRecord.financing_amount_text || '',
        include_in_comparable: Number(editingRecord.include_in_comparable) === 1,
      })
      return
    }
    form.resetFields()
    form.setFieldsValue({
      is_listed: 0,
      data_source_display: '用户新增',
      include_in_comparable: true,
    })
  }, [visible, form, isEdit, editingRecord])

  const handleOk = async () => {
    try {
      const values = await form.validate()
      const body = buildSubmitBody(values, subjectType, subjectId)
      setSubmitting(true)
      const res = isEdit
        ? await putCompetitorRelation(editingRecord.id, body)
        : await postCompetitorRelation(body)
      if (!res.data?.success) {
        throw new Error(res.data?.message || (isEdit ? '保存失败' : '新增失败'))
      }
      Message.success(res.data.message || (isEdit ? '已保存' : '已新增竞品'))
      onSaved?.(res.data.data)
      onClose?.()
    } catch (e) {
      if (e?.errorFields) return
      Message.error(e.response?.data?.message || e.message || (isEdit ? '保存失败' : '新增失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const titlePrefix = isEdit ? '编辑竞品' : '新增竞品'

  return (
    <Modal
      title={subjectLabel ? `${titlePrefix} — ${subjectLabel}` : titlePrefix}
      visible={visible}
      style={{ width: 640 }}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      okText="保存"
      unmountOnExit
    >
      <p style={{ fontSize: 13, color: 'var(--color-text-2)', marginBottom: 12 }}>
        {isEdit
          ? '修改用户新增的竞品信息，保存后立即更新列表。'
          : '手动录入竞品公司信息；保存后数据源为「用户新增」，并立即出现在竞品明细列表中。'}
      </p>
      <Form form={form} layout="vertical">
        <FormItem
          label="竞品名称"
          field="competitor_display_name"
          rules={[{ required: true, message: '请输入竞品名称' }]}
        >
          <Input placeholder="竞品公司全称或常用名" maxLength={255} />
        </FormItem>
        <FormItem label="信用代码" field="unified_credit_code">
          <Input placeholder="统一社会信用代码（选填）" maxLength={64} />
        </FormItem>
        <FormItem label="是否上市" field="is_listed">
          <Select
            options={[
              { label: '否', value: 0 },
              { label: '是', value: 1 },
            ]}
          />
        </FormItem>
        <FormItem label="等级" field="confidence_grade">
          <Select allowClear placeholder="选填" options={GRADE_OPTIONS} />
        </FormItem>
        <FormItem label="综合分" field="relevance_score">
          <InputNumber min={0} max={100} precision={0} placeholder="0-100" style={{ width: '100%' }} />
        </FormItem>
        <FormItem label="产品介绍" field="competitor_product_intro">
          <Input.TextArea placeholder="竞品产品介绍" autoSize={{ minRows: 2, maxRows: 6 }} />
        </FormItem>
        <FormItem label="企业标签" field="competitor_tags_display" extra="多个标签可用逗号、顿号或换行分隔">
          <Input.TextArea placeholder="如：工业软件、智能制造" autoSize={{ minRows: 2, maxRows: 4 }} />
        </FormItem>
        <FormItem label="子基金名称" field="sub_fund_names">
          <Input placeholder="选填" maxLength={1000} />
        </FormItem>
        <FormItem label="数据源" field="data_source_display">
          <Input disabled />
        </FormItem>
        <FormItem label="融资" field="financing_history_text" extra="多轮次可用换行分隔，如：2023-02-02 定增 1亿元">
          <Input.TextArea placeholder="融资轮次信息" autoSize={{ minRows: 2, maxRows: 6 }} />
        </FormItem>
        <FormItem style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: 'var(--color-text-2)' }}>是否放入可比公司</span>
            <FormItem field="include_in_comparable" triggerPropName="checked" noStyle>
              <Checkbox />
            </FormItem>
          </div>
        </FormItem>
      </Form>
    </Modal>
  )
}
