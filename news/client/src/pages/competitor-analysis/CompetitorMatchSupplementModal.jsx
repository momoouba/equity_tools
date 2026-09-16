import React, { useState } from 'react'
import { Form, Input, Button, Message } from '@arco-design/web-react'
import SheetModal, { SheetActions } from '../../components/SheetModal'
import {
  postCompetitorExtractTagsFromNarrative,
  postInvestedEnterpriseCompetitorSupplement,
} from '../../api/competitor-analysis'

const FormItem = Form.Item

/**
 * 竞品匹配 — 补充业务信息：业务标签 + 可选自由文本（须先 AI 抽标签再保存）。
 */
export default function CompetitorMatchSupplementModal({
  visible,
  onClose,
  investedEnterpriseId,
  enterpriseName,
  onSaved,
}) {
  const [form] = Form.useForm()
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extractedTags, setExtractedTags] = useState([])
  const [shortSummary, setShortSummary] = useState('')

  const handleExtract = async () => {
    const narrative = String(form.getFieldValue('narrative') || '').trim()
    if (!narrative) {
      Message.warning('请先粘贴企业业务/产品介绍')
      return
    }
    setExtracting(true)
    setExtractedTags([])
    setShortSummary('')
    try {
      const res = await postCompetitorExtractTagsFromNarrative({ narrative })
      if (res.data?.success && res.data?.data?.tags) {
        setExtractedTags(res.data.data.tags)
        setShortSummary(res.data.data.short_summary || '')
        Message.success('已抽取标签，请确认后保存')
      } else {
        Message.error(res.data?.message || '抽取失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '抽取失败')
    } finally {
      setExtracting(false)
    }
  }

  const handleOk = async () => {
    const userTagsRaw = form.getFieldValue('user_tags')
    const userTags = Array.isArray(userTagsRaw)
      ? userTagsRaw.map((t) => String(t).trim()).filter(Boolean)
      : String(userTagsRaw || '')
          .split(/[,，、\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
    const narrative = String(form.getFieldValue('narrative') || '').trim()

    if (userTags.length < 1 && extractedTags.length < 1) {
      Message.warning('请录入业务标签，或先完成自由文本的 AI 抽标签')
      return
    }
    if (narrative && extractedTags.length < 1) {
      Message.warning('已填写自由文本时，请先点击「AI 抽标签」')
      return
    }

    setSaving(true)
    try {
      const res = await postInvestedEnterpriseCompetitorSupplement(investedEnterpriseId, {
        user_tags: userTags,
        user_narrative: narrative || undefined,
        ai_extracted_tags: extractedTags.length ? extractedTags : undefined,
        ai_short_summary: shortSummary || undefined,
      })
      if (res.data?.success) {
        Message.success(res.data.message || '已保存')
        form.resetFields()
        setExtractedTags([])
        setShortSummary('')
        onSaved && onSaved(res.data)
        onClose && onClose()
      } else {
        Message.error(res.data?.message || '保存失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    form.resetFields()
    setExtractedTags([])
    setShortSummary('')
    onClose && onClose()
  }

  return (
    <SheetModal
      visible={visible}
      title={`竞品匹配 — 补充业务信息${enterpriseName ? `（${enterpriseName}）` : ''}`}
      onClose={close}
    >
      <Form form={form} layout="vertical" initialValues={{ user_tags: [] }} className="enterprise-form enterprise-form--sheet">
        <div className="modal-body enterprise-form-grid">
          <p className="form-hint form-span-4">
            若缺少产品介绍(AI)、企查查有效业务介绍且无标签，请补充贴近业务的标签，或粘贴企业介绍后先「AI 抽标签」再保存。
          </p>
          <FormItem label="业务标签（回车或逗号分隔）" field="user_tags" className="form-span-2">
            <Input.Tag placeholder="输入后回车添加" allowClear style={{ width: '100%' }} />
          </FormItem>
          <div className="form-group">
            <label>AI 抽标签</label>
            <Button type="outline" loading={extracting} onClick={handleExtract}>
              基于上文抽取
            </Button>
          </div>
          <FormItem label="企业业务 / 产品介绍（可选，最多约 2000 字）" field="narrative" className="form-span-4">
            <Input.TextArea
              placeholder="粘贴一段企业自述…"
              autoSize={{ minRows: 4, maxRows: 8 }}
              maxLength={2000}
              showWordLimit
            />
          </FormItem>
          {extractedTags.length > 0 ? (
            <div className="form-hint form-span-4">
              抽取结果（将一并保存）：{extractedTags.join('、')}
              {shortSummary ? `；摘要：${shortSummary}` : ''}
            </div>
          ) : null}
        </div>
        <SheetActions
          onCancel={close}
          submitLabel="保存并关闭"
          submitType="button"
          onSubmitClick={handleOk}
          submitLoading={saving}
        />
      </Form>
    </SheetModal>
  )
}
