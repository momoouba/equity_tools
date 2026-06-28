import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Message,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { patchCompetitorRelationReview } from '../../api/competitor-analysis'
import {
  COMPETITOR_TYPE_META,
  EVIDENCE_TIER_OPTIONS,
  evidenceConfidenceLabel,
  evidenceTierFromScore,
  formatCompetitorDataSources,
  formatEvidenceBreakdownTooltip,
} from './competitorRelationColumns'

const FormItem = Form.Item
const TextArea = Input.TextArea

const DISPOSITION_OPTIONS = [
  { value: 'confirm', label: '确认竞品', hint: '关系成立；请选择人工认定的证据可信度（高/中/低）' },
  {
    value: 'corrected',
    label: '修正类型/简介',
    hint: '关系成立但需调整竞品类型或补充说明',
  },
  { value: 'reject_not_competitor', label: '标为非竞品', hint: '不应作为竞品，默认从可比列表隐藏' },
]

const TYPE_OPTIONS = Object.entries(COMPETITOR_TYPE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}))

function parseBreakdown(record) {
  const raw = record?.evidence_breakdown_json
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

export default function CompetitorRelationReviewDrawer({
  visible,
  record,
  onClose,
  onSubmitted,
  readOnly = false,
}) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [localRecord, setLocalRecord] = useState(record)

  useEffect(() => {
    if (!visible) return
    setLocalRecord(record)
    form.setFieldsValue({
      disposition: 'confirm',
      note: '',
      competitor_type: record?.competitor_type || 'direct',
      competitor_product_intro: record?.competitor_product_intro || '',
      evidence_confidence_tier: evidenceTierFromScore(record?.evidence_confidence),
    })
  }, [visible, record, form])

  const active = localRecord || record
  const disposition = Form.useWatch('disposition', form)

  const handleRefreshEvidence = async () => {
    if (!active?.id || readOnly) return
    setRefreshing(true)
    try {
      const res = await patchCompetitorRelationReview(active.id, {
        disposition: 'refresh_evidence',
      })
      if (!res.data?.success) throw new Error(res.data?.message || '刷新失败')
      Message.success(res.data.message || '证据已刷新')
      const next = res.data.data || active
      setLocalRecord(next)
      onSubmitted?.(next, { refreshOnly: true })
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSubmit = async () => {
    if (!active?.id || readOnly) return
    const values = await form.validate()
    setSubmitting(true)
    try {
      const body = {
        disposition: values.disposition,
        note: values.note || undefined,
      }
      if (values.disposition === 'corrected') {
        body.competitor_type = values.competitor_type
        body.competitor_product_intro = values.competitor_product_intro || undefined
      }
      if (values.disposition === 'confirm') {
        body.evidence_confidence_tier = values.evidence_confidence_tier
      }
      const res = await patchCompetitorRelationReview(active.id, body)
      if (!res.data?.success) throw new Error(res.data?.message || '提交失败')
      Message.success(res.data.message || '复核已保存')
      onSubmitted?.(res.data.data)
      onClose?.()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const confLabel = evidenceConfidenceLabel(active?.evidence_confidence)
  const tip = formatEvidenceBreakdownTooltip(active)
  const breakdown = useMemo(() => parseBreakdown(active), [active])

  return (
    <Drawer
      width={480}
      title={`竞品复核 · ${active?.competitor_display_name || ''}`}
      visible={visible}
      onCancel={onClose}
      placement="right"
      unmountOnExit
      footer={
        readOnly ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>关闭</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="outline" loading={refreshing} onClick={handleRefreshEvidence}>
              刷新证据
            </Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              提交复核
            </Button>
          </div>
        )
      }
    >
      {active ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions
            column={1}
            size="small"
            data={[
              {
                label: '竞品类型',
                value: COMPETITOR_TYPE_META[active.competitor_type]?.label || active.competitor_type || '-',
              },
              { label: '数据源', value: formatCompetitorDataSources(active.data_sources_json) },
              {
                label: '证据可信',
                value: (
                  <Space size={4}>
                    {confLabel ? (
                      <Tag size="small" color={confLabel === '高' ? 'green' : confLabel === '中' ? 'arcoblue' : 'orangered'}>
                        {confLabel}
                      </Tag>
                    ) : (
                      '-'
                    )}
                    {Number(active.needs_review) === 1 ? (
                      <Tag size="small" color="red">
                        待复核
                      </Tag>
                    ) : null}
                    {active.review_status === 'confirmed' || active.review_status === 'corrected' ? (
                      <Tag size="small" color="green">
                        已确认
                      </Tag>
                    ) : null}
                    {active.review_status === 'dismissed' ? (
                      <Tag size="small" color="gray">
                        已驳回
                      </Tag>
                    ) : null}
                  </Space>
                ),
              },
              {
                label: '系统证据分',
                value:
                  active.evidence_confidence != null
                    ? `${evidenceConfidenceLabel(active.evidence_confidence) || '-'}（${active.evidence_confidence} 分）`
                    : '-',
              },
            ]}
          />

          {!breakdown && tip ? (
            <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {tip}
            </Typography.Paragraph>
          ) : null}

          {active.evidence_summary ? (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                判断依据
              </Typography.Text>
              <Typography.Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
                {active.evidence_summary}
              </Typography.Paragraph>
            </div>
          ) : null}

          {breakdown ? (
            <>
              <Descriptions
                column={2}
                size="small"
                title="证据可信 · 四维子分"
                data={[
                  { label: '来源覆盖', value: breakdown.source_coverage_score ?? '—' },
                  { label: '新鲜度', value: breakdown.freshness_score ?? '—' },
                  { label: '一致性', value: breakdown.consistency_score ?? '—' },
                  { label: '判断强度', value: breakdown.judgment_strength_score ?? '—' },
                ]}
              />
              <Descriptions
                column={1}
                size="small"
                title="匹配综合得分"
                data={[
                  {
                    label: '综合得分',
                    value: (
                      <Space size={8}>
                        <Typography.Text style={{ fontSize: 16, fontWeight: 600 }}>
                          {active.relevance_score ?? '-'}
                        </Typography.Text>
                        {active.confidence_grade ? (
                          <Tag size="small" color="arcoblue">
                            {active.confidence_grade}
                          </Tag>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8, marginBottom: 0 }}>
                综合得分是竞品匹配最终判定（内部/AI 加权 + S5），与上方证据四维及「人工认定证据可信度」不是同一指标。
              </Typography.Paragraph>
            </>
          ) : (
            <Descriptions
              column={1}
              size="small"
              title="匹配综合得分"
              data={[
                {
                  label: '综合得分',
                  value: active.relevance_score ?? '-',
                },
              ]}
            />
          )}

          {!readOnly ? (
            <div
              className="cr-rel-review-refresh-bar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                background: 'var(--color-fill-2)',
                borderRadius: 4,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, lineHeight: '20px' }}>
                数据偏旧或仅「联网」来源时，可先刷新企查查/底层数据并重算可信度，再提交复核结论。
              </Typography.Text>
              <Button type="primary" status="warning" loading={refreshing} onClick={handleRefreshEvidence}>
                刷新证据
              </Button>
            </div>
          ) : null}

          {!readOnly ? (
            <Form form={form} layout="vertical">
              <FormItem label="复核结论" field="disposition" rules={[{ required: true, message: '请选择复核结论' }]}>
                <Radio.Group direction="vertical">
                  {DISPOSITION_OPTIONS.map((opt) => (
                    <Radio key={opt.value} value={opt.value}>
                      <Space direction="vertical" size={0}>
                        <span>{opt.label}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {opt.hint}
                        </Typography.Text>
                      </Space>
                    </Radio>
                  ))}
                </Radio.Group>
              </FormItem>

              {disposition === 'confirm' ? (
                <FormItem
                  label="人工认定证据可信度"
                  field="evidence_confidence_tier"
                  rules={[{ required: true, message: '请选择证据可信度' }]}
                  extra={
                    active?.evidence_confidence != null ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        系统证据测算「{evidenceConfidenceLabel(active.evidence_confidence) || '-'}」（
                        {active.evidence_confidence} 分）。下方「匹配综合得分」为竞品匹配分，二者勿混淆。
                      </Typography.Text>
                    ) : null
                  }
                >
                  <Radio.Group options={EVIDENCE_TIER_OPTIONS} type="button" />
                </FormItem>
              ) : null}

              {disposition === 'corrected' ? (
                <>
                  <FormItem label="竞品类型" field="competitor_type" rules={[{ required: true, message: '请选择类型' }]}>
                    <Select options={TYPE_OPTIONS} />
                  </FormItem>
                  <FormItem label="产品介绍（可选修正）" field="competitor_product_intro">
                    <TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                  </FormItem>
                </>
              ) : null}

              <FormItem label="复核备注" field="note">
                <TextArea placeholder="可选：说明确认/驳回理由，便于后续追溯" autoSize={{ minRows: 2, maxRows: 5 }} />
              </FormItem>
            </Form>
          ) : null}
        </Space>
      ) : null}
    </Drawer>
  )
}
