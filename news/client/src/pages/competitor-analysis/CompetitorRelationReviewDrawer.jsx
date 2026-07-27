import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Collapse,
  Descriptions,
  Form,
  Grid,
  Input,
  Message,
  Modal,
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
  formatEvidenceCalcDetail,
  formatEvidenceDimBasis,
  formatMatchScoreBasis,
} from './competitorRelationColumns'

const FormItem = Form.Item
const TextArea = Input.TextArea
const CollapseItem = Collapse.Item
const { Row, Col } = Grid

const DISPOSITION_OPTIONS = [
  { value: 'confirm', label: '确认竞品', hint: '关系成立；请选人工证据可信度' },
  { value: 'corrected', label: '修正类型/简介', hint: '关系成立但需调整类型或简介' },
  { value: 'reject_not_competitor', label: '标为非竞品', hint: '不应作为竞品，默认从可比列表隐藏' },
]

const TYPE_OPTIONS = Object.entries(COMPETITOR_TYPE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}))

const panelStyle = {
  padding: '12px 14px',
  background: 'var(--color-fill-1)',
  borderRadius: 4,
  border: '1px solid var(--color-border-2)',
  height: '100%',
  boxSizing: 'border-box',
}

const dimCardStyle = {
  padding: '10px 12px',
  background: 'var(--color-bg-2)',
  borderRadius: 4,
  border: '1px solid var(--color-border-2)',
  height: '100%',
  boxSizing: 'border-box',
}

function dimScoreText(score) {
  return score == null || score === '' ? '—' : String(score)
}

function subScoreText(score) {
  return score == null || score === '' ? '—' : String(score)
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
  const dimBasis = useMemo(() => formatEvidenceDimBasis(active), [active])
  const calcDetail = useMemo(() => formatEvidenceCalcDetail(active), [active])
  const matchBasis = useMemo(() => formatMatchScoreBasis(active), [active])
  const hasRuleSubs =
    matchBasis && (matchBasis.productScore != null || matchBasis.tagScore != null)

  const footer = readOnly ? (
    <Button onClick={onClose}>关闭</Button>
  ) : (
    <Space>
      <Button onClick={onClose}>取消</Button>
      <Button type="outline" loading={refreshing} onClick={handleRefreshEvidence}>
        刷新证据
      </Button>
      <Button type="primary" loading={submitting} onClick={handleSubmit}>
        提交复核
      </Button>
    </Space>
  )

  return (
    <Modal
      title={`竞品复核 · ${active?.competitor_display_name || ''}`}
      visible={visible}
      onCancel={onClose}
      unmountOnExit
      footer={footer}
      style={{ width: 1040 }}
      className="cr-rel-review-modal"
    >
      {active ? (
        <div
          style={{
            maxHeight: 'calc(100vh - 180px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: 2,
          }}
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions
              column={4}
              size="small"
              tableLayout="fixed"
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
                        <Tag
                          size="small"
                          color={confLabel === '高' ? 'green' : confLabel === '中' ? 'arcoblue' : 'orangered'}
                        >
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

            {active.evidence_summary ? (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  判断依据
                </Typography.Text>
                <Typography.Paragraph
                  style={{ marginTop: 2, marginBottom: 0, fontSize: 13, lineHeight: '20px' }}
                  ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                >
                  {active.evidence_summary}
                </Typography.Paragraph>
              </div>
            ) : null}

            <Row gutter={14} align="stretch">
              <Col span={14}>
                <div style={panelStyle}>
                  <Row justify="space-between" align="center" style={{ marginBottom: 10 }}>
                    <Typography.Text style={{ fontWeight: 600, fontSize: 14 }}>
                      证据可信 · 四维子分
                    </Typography.Text>
                    {active.evidence_confidence != null ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        系统证据分 {active.evidence_confidence} · {confLabel || '—'}
                      </Typography.Text>
                    ) : null}
                  </Row>
                  {dimBasis ? (
                    <>
                      <Row gutter={[10, 10]}>
                        {dimBasis.map((dim) => (
                          <Col key={dim.key} span={12}>
                            <div style={dimCardStyle}>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'baseline',
                                  marginBottom: 6,
                                }}
                              >
                                <Typography.Text style={{ fontWeight: 600 }}>{dim.label}</Typography.Text>
                                <Typography.Text style={{ fontWeight: 700, fontSize: 18 }}>
                                  {dimScoreText(dim.score)}
                                </Typography.Text>
                              </div>
                              <Typography.Paragraph
                                type="secondary"
                                style={{
                                  fontSize: 12,
                                  marginBottom: 0,
                                  lineHeight: '18px',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {dim.basis}
                              </Typography.Paragraph>
                            </div>
                          </Col>
                        ))}
                      </Row>
                      {calcDetail?.length ? (
                        <>
                          <Typography.Paragraph
                            style={{
                              fontSize: 12,
                              marginTop: 10,
                              marginBottom: 0,
                              lineHeight: '18px',
                              whiteSpace: 'pre-wrap',
                              color: 'var(--color-text-2)',
                            }}
                          >
                            {[calcDetail[1], calcDetail[2], calcDetail[3]].filter(Boolean).join('\n')}
                          </Typography.Paragraph>
                          <Collapse
                            bordered={false}
                            style={{ marginTop: 4, background: 'transparent' }}
                            defaultActiveKey={[]}
                          >
                            <CollapseItem
                              header={
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  更多计算细节（权重说明 / 待复核条件）
                                </Typography.Text>
                              }
                              name="calc"
                            >
                              {calcDetail.map((line) => (
                                <Typography.Paragraph
                                  key={line}
                                  type="secondary"
                                  style={{ fontSize: 12, marginBottom: 4, whiteSpace: 'pre-wrap' }}
                                >
                                  {line}
                                </Typography.Paragraph>
                              ))}
                            </CollapseItem>
                          </Collapse>
                        </>
                      ) : null}
                    </>
                  ) : tip ? (
                    <Typography.Paragraph
                      type="secondary"
                      style={{ whiteSpace: 'pre-wrap', marginBottom: 0, fontSize: 12 }}
                    >
                      {tip}
                    </Typography.Paragraph>
                  ) : (
                    <Typography.Text type="secondary">暂无证据四维明细</Typography.Text>
                  )}
                </div>
              </Col>

              <Col span={10}>
                <div style={panelStyle}>
                  <Typography.Text style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 10 }}>
                    匹配综合得分
                  </Typography.Text>
                  <Space size={10} align="center" style={{ marginBottom: 10 }}>
                    <Typography.Text style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                      {active.relevance_score ?? '-'}
                    </Typography.Text>
                    {active.confidence_grade ? (
                      <Tag size="small" color="arcoblue">
                        {active.confidence_grade}
                      </Tag>
                    ) : null}
                  </Space>
                  {matchBasis ? (
                    <>
                      <Typography.Paragraph
                        style={{
                          marginBottom: 8,
                          fontSize: 12,
                          lineHeight: '18px',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {(matchBasis.pathLines || [matchBasis.pathText]).join('\n')}
                      </Typography.Paragraph>
                      {matchBasis.dimensionScores ? (
                        <div
                          style={{
                            padding: '8px 10px',
                            marginBottom: 8,
                            background: 'var(--color-fill-2)',
                            borderRadius: 4,
                          }}
                        >
                          <Typography.Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            高分主因 · S5 三维
                          </Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            可替代性 {subScoreText(matchBasis.dimensionScores.substitutability)}
                            {' · '}
                            客户重叠 {subScoreText(matchBasis.dimensionScores.customer_overlap)}
                            {' · '}
                            场景重叠 {subScoreText(matchBasis.dimensionScores.scenario_overlap)}
                            {matchBasis.aiScore != null ? ` → AI 对标 ${matchBasis.aiScore}` : ''}
                          </Typography.Text>
                        </div>
                      ) : null}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '8px 12px',
                          marginBottom: 8,
                        }}
                      >
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {matchBasis.scoreMode === 'ai_only'
                            ? `内部规则分：${subScoreText(matchBasis.internalScore)}（未计入）`
                            : `内部规则分：${subScoreText(matchBasis.internalScore)}`}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          AI 对标分：{subScoreText(matchBasis.aiScore)}
                          {matchBasis.scoreMode === 'ai_only' ? '（已计入）' : ''}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          LLM 产品对标：{subScoreText(matchBasis.llmProductScore)}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {matchBasis.gradeHint}
                        </Typography.Text>
                      </div>
                      {hasRuleSubs ? (
                        <Collapse
                          bordered={false}
                          style={{ marginTop: 0, background: 'transparent' }}
                          defaultActiveKey={[]}
                        >
                          <CollapseItem
                            header={
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                其它规则子分（默认不计入 ai_only 综合分）
                              </Typography.Text>
                            }
                            name="subscores"
                          >
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              {matchBasis.productScore != null ? (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  产品规则分：{matchBasis.productScore}
                                </Typography.Text>
                              ) : null}
                              {matchBasis.tagScore != null ? (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  标签分：{matchBasis.tagScore}
                                </Typography.Text>
                              ) : null}
                            </Space>
                          </CollapseItem>
                        </Collapse>
                      ) : null}
                    </>
                  ) : (
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                      综合得分是竞品匹配最终判定，与证据可信不是同一指标。
                    </Typography.Paragraph>
                  )}
                </div>
              </Col>
            </Row>

            {!readOnly ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 12px',
                  background: 'var(--color-fill-2)',
                  borderRadius: 4,
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1, lineHeight: '18px' }}>
                  数据偏旧或仅「联网」来源时，可先刷新企查查/底层数据并重算可信度。
                </Typography.Text>
                <Button size="small" type="primary" status="warning" loading={refreshing} onClick={handleRefreshEvidence}>
                  刷新证据
                </Button>
              </div>
            ) : null}

            {!readOnly ? (
              <Form form={form} layout="vertical" style={{ marginBottom: 0 }} className="cr-rel-review-form">
                <Row gutter={16}>
                  <Col span={disposition === 'confirm' || disposition === 'corrected' ? 14 : 24}>
                    <FormItem
                      label="复核结论"
                      field="disposition"
                      rules={[{ required: true, message: '请选择复核结论' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Radio.Group>
                        {DISPOSITION_OPTIONS.map((opt) => (
                          <Radio key={opt.value} value={opt.value}>
                            {opt.label}
                          </Radio>
                        ))}
                      </Radio.Group>
                    </FormItem>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: -4 }}>
                      {DISPOSITION_OPTIONS.find((o) => o.value === disposition)?.hint}
                    </Typography.Text>
                  </Col>
                  {disposition === 'confirm' ? (
                    <Col span={10}>
                      <FormItem
                        label="人工认定证据可信度"
                        field="evidence_confidence_tier"
                        rules={[{ required: true, message: '请选择证据可信度' }]}
                        style={{ marginBottom: 8 }}
                        extra={
                          active?.evidence_confidence != null ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              系统测算「{evidenceConfidenceLabel(active.evidence_confidence) || '-'}」（
                              {active.evidence_confidence} 分），与匹配综合分不同。
                            </Typography.Text>
                          ) : null
                        }
                      >
                        <Radio.Group options={EVIDENCE_TIER_OPTIONS} type="button" />
                      </FormItem>
                    </Col>
                  ) : null}
                  {disposition === 'corrected' ? (
                    <Col span={10}>
                      <FormItem
                        label="竞品类型"
                        field="competitor_type"
                        rules={[{ required: true, message: '请选择类型' }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Select options={TYPE_OPTIONS} />
                      </FormItem>
                    </Col>
                  ) : null}
                </Row>

                {disposition === 'corrected' ? (
                  <FormItem label="产品介绍（可选修正）" field="competitor_product_intro" style={{ marginBottom: 8 }}>
                    <TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
                  </FormItem>
                ) : null}

                <FormItem label="复核备注" field="note" style={{ marginBottom: 0 }}>
                  <TextArea placeholder="可选：说明确认/驳回理由" autoSize={{ minRows: 1, maxRows: 3 }} />
                </FormItem>
              </Form>
            ) : null}
          </Space>
        </div>
      ) : null}
    </Modal>
  )
}
