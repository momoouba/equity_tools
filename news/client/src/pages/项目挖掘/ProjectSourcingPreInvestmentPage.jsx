import React, { useEffect, useState, useCallback } from 'react'
import { Card, Table, Button, Message, Modal, Form, Input, Space } from '@arco-design/web-react'
import {
  fetchPreInvestmentProjects,
  fetchCompetitorRelations,
  postPreInvestmentProject,
  postPreInvestmentQccBrief,
  postPreInvestmentQccFuzzyLookup,
  postPreInvestmentAiEnrich,
  postPreInvestmentCompetitorAnalysisRun,
} from '../../api/项目挖掘'
import { IntroPopoverCell } from './introPopoverAiCell'
import '../EnterpriseManagement.css'

const FormItem = Form.Item

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

function genPreviewProjectNo() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  return `P${ymd}${String(Math.floor(1000 + Math.random() * 9000))}`
}

export default function ProjectSourcingPreInvestmentPage() {
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createVisible, setCreateVisible] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [projectNoPreview, setProjectNoPreview] = useState('')
  const [tableScrollY, setTableScrollY] = useState(520)
  const [aiLoadingId, setAiLoadingId] = useState(null)
  const [competitorLoadingId, setCompetitorLoadingId] = useState(null)
  const [expandedKeys, setExpandedKeys] = useState([])
  const [relMap, setRelMap] = useState({})
  const [relLoading, setRelLoading] = useState({})
  const [form] = Form.useForm()

  const loadRelations = async (projectId) => {
    if (relMap[projectId]) return
    setRelLoading((m) => ({ ...m, [projectId]: true }))
    try {
      const res = await fetchCompetitorRelations({ pre_investment_project_id: projectId })
      if (res.data?.success) {
        setRelMap((m) => ({ ...m, [projectId]: res.data.data?.list || [] }))
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载竞品失败')
    } finally {
      setRelLoading((m) => ({ ...m, [projectId]: false }))
    }
  }

  useEffect(() => {
    const calc = () => {
      setTableScrollY(Math.max(320, window.innerHeight - 280))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchPreInvestmentProjects({ page, pageSize })
      if (res.data?.success) {
        setList(res.data.data?.list || [])
        setTotal(res.data.data?.total ?? 0)
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  const openCreateModal = () => {
    setProjectNoPreview(genPreviewProjectNo())
    form.resetFields()
    setCreateVisible(true)
  }

  const handleQccLookup = async () => {
    const abbrev = String(form.getFieldValue('project_abbreviation') || '').trim()
    if (abbrev.length < 2) {
      Message.warning('请先填写企业简称（至少 2 字）')
      return
    }
    setLookupLoading(true)
    try {
      const res = await postPreInvestmentQccFuzzyLookup({ search_key: abbrev })
      if (!res.data?.success) {
        Message.error(res.data?.message || '查询失败')
        return
      }
      const d = res.data.data || {}
      const name = String(d.enterprise_full_name || '').trim()
      const credit = String(d.unified_credit_code || '').trim()
      if (!name && !credit) {
        Message.warning('企查查未返回匹配企业，请尝试其它简称或手填全称与信用代码')
        return
      }
      form.setFieldsValue({
        enterprise_full_name: name || form.getFieldValue('enterprise_full_name'),
        unified_credit_code: credit || form.getFieldValue('unified_credit_code'),
      })
      if (Number(d.total) > 1) {
        Message.info(`企查查返回 ${d.total} 条结果，已填入首条，请核对全称与统一社会信用代码`)
      } else {
        Message.success('已回填企业全称与统一社会信用代码')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '查询失败')
    } finally {
      setLookupLoading(false)
    }
  }

  const columns = [
    { title: '项目编号', dataIndex: 'project_no', width: 140, render: (t) => t || '-' },
    { title: '企业全称', dataIndex: 'enterprise_full_name', width: 220, ellipsis: true, tooltip: true },
    { title: '统一信用代码', dataIndex: 'unified_credit_code', width: 180, render: (t) => t || '-' },
    {
      title: '产品介绍（AI）',
      dataIndex: 'ai_product_intro',
      width: 200,
      render: (t) => (
        <IntroPopoverCell columnTitle="产品介绍（AI）" raw={t} triggerMaxWidth={180} />
      ),
    },
    {
      title: '企业标签（AI）',
      dataIndex: 'ai_industry_tags_display',
      width: 180,
      render: (t) => (
        <IntroPopoverCell columnTitle="企业标签（AI）" raw={t} triggerMaxWidth={160} />
      ),
    },
    {
      title: '企业介绍（企查查）',
      dataIndex: 'qcc_company_intro',
      width: 200,
      render: (t) => (
        <IntroPopoverCell columnTitle="企业介绍（企查查）" raw={t} triggerMaxWidth={180} />
      ),
    },
    { title: '状态', dataIndex: 'pipeline_status', width: 100 },
    {
      title: '操作',
      width: 300,
      fixed: 'right',
      render: (_, row) => (
        <Space size={8} wrap style={{ padding: '0 10px' }}>
          <Button
            type="outline"
            size="small"
            onClick={async () => {
              try {
                const res = await postPreInvestmentQccBrief(row.id)
                if (res.data?.success) {
                  Message.success(res.data.message || '同步完成')
                  load()
                } else {
                  Message.error(res.data?.message || '失败')
                }
              } catch (e) {
                Message.error(e.response?.data?.message || e.message || '失败')
              }
            }}
          >
            企查查简介
          </Button>
          <Button
            type="outline"
            size="small"
            loading={aiLoadingId === row.id}
            onClick={() => {
              const name = row.enterprise_full_name || row.project_abbreviation || row.project_no || row.id
              Modal.confirm({
                title: 'AI 取数',
                content: `确认对「${name}」发起手动 AI 取数？将联网生成「产品介绍」「企业标签」并写回本条投前项目（异步，完成后请刷新列表）。`,
                onOk: async () => {
                  setAiLoadingId(row.id)
                  try {
                    const res = await postPreInvestmentAiEnrich(row.id)
                    if (res.status === 202 && res.data?.success) {
                      Message.success(res.data.message || '已受理')
                      load()
                    } else if (res.data?.success) {
                      Message.success(res.data.message || '已受理')
                      load()
                    } else {
                      Message.error(res.data?.message || '受理失败')
                    }
                  } catch (e) {
                    Message.error(e.response?.data?.message || e.message || '受理失败')
                  } finally {
                    setAiLoadingId(null)
                  }
                },
              })
            }}
          >
            AI取数
          </Button>
          <Button
            type="outline"
            size="small"
            loading={competitorLoadingId === row.id}
            onClick={() => {
              const name = row.enterprise_full_name || row.project_abbreviation || row.project_no || row.id
              Modal.confirm({
                title: '竞品分析',
                content: `确认对「${name}」发起竞品分析？系统将异步召回融资池/底层项目候选并打分落库。`,
                onOk: async () => {
                  setCompetitorLoadingId(row.id)
                  try {
                    const res = await postPreInvestmentCompetitorAnalysisRun(row.id)
                    if (res.status === 202 && res.data?.success) {
                      Message.success(res.data.message || '已受理')
                    } else if (res.data?.success) {
                      Message.success(res.data.message || '已受理')
                    } else {
                      Message.error(res.data?.message || '受理失败')
                    }
                  } catch (e) {
                    Message.error(e.response?.data?.message || e.message || '受理失败')
                  } finally {
                    setCompetitorLoadingId(null)
                  }
                },
              })
            }}
          >
            竞品分析
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div className="pre-inv-sourcing-page" style={{ padding: '16px 24px' }}>
      <Card
        title="投前项目"
        bordered={false}
        extra={
          <Button type="primary" onClick={openCreateModal}>
            新增
          </Button>
        }
      >
        <p style={{ color: 'var(--color-text-2)', marginBottom: 12, fontSize: 13 }}>
          录入投前跟踪主体：企业简称旁点「查询」可调企查查模糊搜索并回填企业全称与统一社会信用代码；保存后写入列表。操作列可手动同步企查查简介、发起
          AI 取数（异步完善产品介绍与标签）或发起竞品分析（异步召回与打分，结果写入竞品关系表）。
        </p>
        <Table
          rowKey="id"
          stripe
          loading={loading}
          data={list}
          columns={columns}
          expandedRowKeys={expandedKeys}
          onExpandedRowsChange={(keys) => {
            setExpandedKeys(keys)
            keys.forEach((id) => loadRelations(id))
          }}
          expandedRowRender={(row) => (
            <Table
              rowKey="id"
              size="small"
              loading={!!relLoading[row.id]}
              data={relMap[row.id] || []}
              pagination={false}
              border={{ wrapper: true, cell: true }}
              columns={[
                { title: '竞品', dataIndex: 'competitor_display_name', ellipsis: true },
                { title: '等级', dataIndex: 'confidence_grade', width: 64 },
                { title: '综合分', dataIndex: 'relevance_score', width: 72 },
                { title: '融资', dataIndex: 'financing_amount_text', width: 100, ellipsis: true },
              ]}
            />
          )}
          scroll={{ x: 1780, y: tableScrollY }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showTotal: true,
            showJumper: true,
            sizeCanChange: true,
            pageSizeChangeResetCurrent: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageSizeChange: (ps) => {
              setPageSize(ps)
              setPage(1)
            },
          }}
          border={{ wrapper: true, cell: true }}
        />
      </Card>

      <Modal
        title="新增企业信息"
        style={{ width: 520 }}
        visible={createVisible}
        onCancel={() => {
          setCreateVisible(false)
          form.resetFields()
        }}
        onOk={async () => {
          try {
            const v = await form.validate()
            setCreateSubmitting(true)
            const res = await postPreInvestmentProject({
              enterprise_full_name: v.enterprise_full_name,
              unified_credit_code: v.unified_credit_code || undefined,
              project_abbreviation: v.project_abbreviation || undefined,
              project_no: projectNoPreview,
            })
            if (res.data?.success) {
              const savedNo = res.data.data?.project_no || projectNoPreview
              Message.success(`已创建（项目编号 ${savedNo}）`)
              setCreateVisible(false)
              form.resetFields()
              load()
            } else {
              Message.error(res.data?.message || '创建失败')
              return false
            }
          } catch (e) {
            if (e?.errors) return false
            Message.error(e.response?.data?.message || e.message || '创建失败')
            return false
          } finally {
            setCreateSubmitting(false)
          }
        }}
        confirmLoading={createSubmitting}
      >
        <Form form={form} layout="vertical">
          <FormItem label="项目编号">
            <Input value={projectNoPreview} disabled placeholder="自动生成" />
          </FormItem>
          <FormItem label="企业简称">
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <FormItem field="project_abbreviation" noStyle>
                <Input placeholder="请输入企业简称" style={{ flex: 1 }} />
              </FormItem>
              <Button type="primary" loading={lookupLoading} onClick={handleQccLookup}>
                查询
              </Button>
            </div>
          </FormItem>
          <FormItem
            label="企业全称"
            field="enterprise_full_name"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="请输入企业全称（可先点查询由企查查回填）" />
          </FormItem>
          <FormItem label="统一信用代码" field="unified_credit_code">
            <Input placeholder="请输入统一信用代码（可先点查询由企查查回填）" />
          </FormItem>
        </Form>
      </Modal>
    </div>
  )
}
