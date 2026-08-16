import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Button, Message, Modal, Form, Input, Space, Pagination } from '@arco-design/web-react'
import {
  fetchValuationPreProjects,
  fetchCompetitorPreProjectsForValuation,
  postValuationPreProject,
  postValuationQccFuzzyLookup,
  openValuationCaseFromPreProject,
} from '../../api/valuation'
import './valuation.css'
import { formatChinaDateTime } from './valuationUnits'

const FormItem = Form.Item

function genPreviewProjectNo() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  return `P${ymd}${String(Math.floor(1000 + Math.random() * 9000))}`
}

function fmtRange(conclusion) {
  const yi = conclusion?.display_yi
  if (!yi) return '-'
  const dcf = yi.dcf
  if (dcf?.ma) {
    return `并购 ${fmtN(dcf.ma.low)}~${fmtN(dcf.ma.high)} / 上市 ${fmtN(dcf.ipo.low)}~${fmtN(dcf.ipo.high)}`
  }
  return `${fmtN(dcf?.low)} ~ ${fmtN(dcf?.high)}`
}

function fmtN(v) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '-'
}

export default function ValuationPreProjectsPage() {
  const navigate = useNavigate()
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [createVisible, setCreateVisible] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [pickVisible, setPickVisible] = useState(false)
  const [form] = Form.useForm()
  const [lookupLoading, setLookupLoading] = useState(false)
  const [qccCandidates, setQccCandidates] = useState([])
  const [showQccDropdown, setShowQccDropdown] = useState(false)
  const [projectNoPreview, setProjectNoPreview] = useState('')
  const qccDropdownRef = useRef(null)
  const [caList, setCaList] = useState([])
  const [caTotal, setCaTotal] = useState(0)
  const [caPage, setCaPage] = useState(1)
  const [caKeyword, setCaKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchValuationPreProjects({ page, pageSize, keyword })
      if (res.data?.success) {
        setList(res.data.data.list || [])
        setTotal(res.data.data.total || 0)
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword])

  useEffect(() => { load() }, [load])

  const loadCa = useCallback(async () => {
    try {
      const res = await fetchCompetitorPreProjectsForValuation({ page: caPage, pageSize: 10, keyword: caKeyword })
      if (res.data?.success) {
        setCaList(res.data.data.list || [])
        setCaTotal(res.data.data.total || 0)
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '读取竞品分析投前清单失败')
    }
  }, [caPage, caKeyword])

  useEffect(() => {
    if (pickVisible) loadCa()
  }, [pickVisible, loadCa])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (qccDropdownRef.current && !qccDropdownRef.current.contains(event.target)) {
        setShowQccDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const clearQccDropdown = () => {
    setQccCandidates([])
    setShowQccDropdown(false)
  }

  const openCreateModal = () => {
    setProjectNoPreview(genPreviewProjectNo())
    form.resetFields()
    clearQccDropdown()
    setCreateVisible(true)
  }

  const closeCreateModal = () => {
    setCreateVisible(false)
    form.resetFields()
    clearQccDropdown()
  }

  const handleSelectQccCandidate = (company) => {
    form.setFieldsValue({
      enterprise_full_name: String(company.enterprise_full_name || '').trim(),
      unified_credit_code: String(company.unified_credit_code || '').trim(),
    })
    clearQccDropdown()
    Message.success('已填入企业全称与统一社会信用代码')
  }

  const handleQccLookup = async () => {
    const abbrev = String(form.getFieldValue('project_abbreviation') || '').trim()
    if (abbrev.length < 2) {
      Message.warning('请先填写企业简称（至少 2 字）')
      return
    }
    setLookupLoading(true)
    clearQccDropdown()
    try {
      const res = await postValuationQccFuzzyLookup({ search_key: abbrev })
      if (!res.data?.success) {
        Message.error(res.data?.message || '查询失败')
        return
      }
      const d = res.data.data || {}
      const candidates = Array.isArray(d.candidates) ? d.candidates : []
      if (candidates.length === 0) {
        Message.warning('未找到相关企业信息，请尝试其它简称或手填全称与信用代码')
        return
      }
      setQccCandidates(candidates)
      setShowQccDropdown(true)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '查询失败')
    } finally {
      setLookupLoading(false)
    }
  }

  const handleCreateSubmit = async () => {
    try {
      const values = await form.validate()
      setCreateSubmitting(true)
      const res = await postValuationPreProject({
        enterprise_full_name: values.enterprise_full_name,
        project_abbreviation: values.project_abbreviation || '',
        unified_credit_code: values.unified_credit_code || '',
      })
      if (res.data?.success) {
        Message.success('已创建')
        closeCreateModal()
        load()
        await openCase(res.data.data.id)
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
  }

  const openCase = async (preId) => {
    try {
      const res = await openValuationCaseFromPreProject(preId)
      if (res.data?.success) {
        navigate(`/dashboard/valuation/workbench/${res.data.data.id}`)
      } else {
        Message.error(res.data?.message || '打开案件失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '打开案件失败')
    }
  }

  const columns = [
    { title: '企业名称', dataIndex: 'display_name', width: 162, ellipsis: true, render: (v, r) => (
      <span>
        {v || '-'}
        {r.source_deleted ? <span className="valuation-warn">（竞品分析项目已删，用快照名）</span> : null}
      </span>
    ) },
    { title: '快照名称', dataIndex: 'snapshot_name', width: 162, ellipsis: true, render: (v) => v || '-' },
    {
      title: '关联竞品分析',
      dataIndex: 'competitor_project_no',
      width: 200,
      ellipsis: true,
      render: (v, r) => (r.competitor_pre_project_id ? (v || '-') : '手工新建'),
    },
    { title: '版本数', dataIndex: 'version_count', width: 80, render: (v) => v || 0 },
    { title: '最近估值', dataIndex: 'latest_valued_at', width: 170, render: (v) => formatChinaDateTime(v) },
    { title: '最近区间(亿元)', dataIndex: 'latest_conclusion', width: 220, render: (v) => fmtRange(v) },
    { title: '本轮交易估值', dataIndex: 'round_deal_value_yi', width: 120, render: (v) => fmtN(v) },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Button type="primary" size="small" onClick={() => openCase(r.id)}>进入估值</Button>
      ),
    },
  ]

  return (
    <div className="valuation-page">
      <Card bordered={false}>
        <div className="valuation-page-header">
          <h2>投前项目估值</h2>
          <Space>
            <Input.Search
              allowClear
              placeholder="搜索名称 / 信用代码"
              style={{ width: 260 }}
              onSearch={(v) => { setKeyword(v); setPage(1) }}
            />
            <Button onClick={() => setPickVisible(true)}>从竞品分析选择</Button>
            <Button type="primary" onClick={openCreateModal}>手工新建</Button>
          </Space>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          data={list}
          pagination={false}
          border
          className="valuation-list-table"
          scroll={{ x: 1240 }}
        />
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showTotal
            sizeCanChange
            onChange={(p, s) => { setPage(p); setPageSize(s) }}
          />
        </div>
      </Card>

      <Modal
        title="新增企业信息"
        style={{ width: 520 }}
        visible={createVisible}
        onCancel={closeCreateModal}
        onOk={handleCreateSubmit}
        confirmLoading={createSubmitting}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if (Object.prototype.hasOwnProperty.call(changed, 'project_abbreviation')) {
              clearQccDropdown()
            }
          }}
        >
          <FormItem label="项目编号">
            <Input value={projectNoPreview} disabled placeholder="自动生成" />
          </FormItem>
          <FormItem label="企业简称">
            <div ref={qccDropdownRef} style={{ position: 'relative', width: '100%' }}>
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <FormItem field="project_abbreviation" noStyle>
                  <Input placeholder="请输入企业简称" style={{ flex: 1 }} />
                </FormItem>
                <Button type="primary" loading={lookupLoading} onClick={handleQccLookup}>
                  查询
                </Button>
              </div>
              {showQccDropdown && qccCandidates.length > 0 && (
                <div className="valuation-qcc-dropdown">
                  {qccCandidates.map((company, index) => (
                    <div
                      key={`${company.unified_credit_code || company.enterprise_full_name}-${index}`}
                      className="valuation-qcc-dropdown-item"
                      onClick={() => handleSelectQccCandidate(company)}
                    >
                      <div className="valuation-qcc-dropdown-main">{company.enterprise_full_name}</div>
                      {company.unified_credit_code ? (
                        <div className="valuation-qcc-dropdown-sub">
                          统一社会信用代码：{company.unified_credit_code}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormItem>
          <FormItem
            label="企业全称"
            field="enterprise_full_name"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="请输入企业全称（查询后请从列表中选择）" />
          </FormItem>
          <FormItem label="统一信用代码" field="unified_credit_code">
            <Input placeholder="请输入统一信用代码（查询后请从列表中选择）" />
          </FormItem>
        </Form>
      </Modal>

      <Modal
        title="从竞品分析选择投前项目"
        visible={pickVisible}
        onCancel={() => setPickVisible(false)}
        footer={null}
        style={{ width: 720 }}
      >
        <Input.Search
          allowClear
          placeholder="搜索竞品分析投前项目"
          style={{ marginBottom: 12 }}
          onSearch={(v) => { setCaKeyword(v); setCaPage(1) }}
        />
        <Table
          rowKey="id"
          border
          className="valuation-list-table"
          columns={[
            { title: '项目编号', dataIndex: 'project_no', width: 140 },
            { title: '企业全称', dataIndex: 'enterprise_full_name' },
            { title: '简称', dataIndex: 'project_abbreviation', width: 140 },
            {
              title: '操作',
              width: 100,
              render: (_, r) => (
                <Button
                  type="primary"
                  size="small"
                  onClick={async () => {
                    try {
                      const created = await postValuationPreProject({
                        competitor_pre_project_id: r.id,
                        snapshot_name: r.enterprise_full_name,
                      })
                      if (!created.data?.success) {
                        Message.error(created.data?.message || '创建失败')
                        return
                      }
                      setPickVisible(false)
                      await openCase(created.data.data.id)
                    } catch (e) {
                      Message.error(e.response?.data?.message || e.message || '创建失败')
                    }
                  }}
                >
                  选择
                </Button>
              ),
            },
          ]}
          data={caList}
          pagination={false}
        />
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Pagination current={caPage} pageSize={10} total={caTotal} onChange={setCaPage} />
        </div>
      </Modal>
    </div>
  )
}
