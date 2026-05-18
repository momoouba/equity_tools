import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Table,
  Button,
  Space,
  Input,
  Message,
  Modal,
  Form,
  DatePicker,
  Select,
  Switch,
  Card,
  Collapse,
} from '@arco-design/web-react'
import dayjs from 'dayjs'
import { saveAs } from 'file-saver'
import axios from '../../utils/axios'
import CronGenerator from '../../components/CronGenerator'
import {
  formatFinancingYmd,
  financingNow,
  formatFinancingDateTime,
} from './financingDateUtils'
import {
  fetchCompetitorAnalysisIpoProjects,
  getCompetitorAnalysisIpoProjectsExport,
  postIpoProjectAiEnrich,
  postIpoProjectBatchAiEnrich,
  fetchIpoProjectAiEnrichLogs,
  postIpoProjectBatchQccCompanyBrief,
  fetchCompetitorAnalysisIpoProjectSqlSyncSetting,
  putCompetitorAnalysisIpoProjectSqlSyncSetting,
  postCompetitorAnalysisIpoProjectSqlSyncPreview,
  postCompetitorAnalysisIpoProjectSqlSyncRun,
  postIpoProjectQccCompanyBriefSyncAllFiltered,
  postCompetitorAnalysisIpoProject,
  putCompetitorAnalysisIpoProject,
  deleteCompetitorAnalysisIpoProject,
  fetchCompetitorAnalysisIpoProjectChangeLog,
} from '../../api/竞品分析'
import BatchImportModal from '../BatchImportModal'
import { IntroPopoverCell } from './introPopoverAiCell'
import '../EnterpriseManagement.css'
import '../EnterpriseForm.css'
import '../项目挖掘/FinancingEventsPage.css'

const FormItem = Form.Item
const Option = Select.Option
const CollapseItem = Collapse.Item
const PAGE_SIZE_OPTIONS = [20, 50, 100]

function csvCell(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadIpoProjectsCurrentPageCsv(rows) {
  const head = [
    '项目编号',
    '归属基金',
    '归属子基金',
    '项目简称',
    '企业全称',
    '产品简介(AI)',
    '企业标签(AI)',
    '企业介绍(企查查)',
    '统一社会信用代码',
    'data_app_id',
    'AI状态',
    '投资金额',
    '剩余金额',
    '穿透权益占比',
    '穿透投资金额',
    '穿透剩余金额',
    '创建时间',
    '创建人',
  ]
  const lines = [head.join(',')]
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.project_no),
        csvCell(r.fund),
        csvCell(r.sub),
        csvCell(r.project_name),
        csvCell(r.company),
        csvCell(r.ai_product_intro),
        csvCell(r.ai_industry_tags_display),
        csvCell(r.qcc_company_intro),
        csvCell(r.unified_credit_code),
        csvCell(r.data_app_id),
        csvCell(r.ai_enrich_status),
        csvCell(r.inv_amount),
        csvCell(r.residual_amount),
        csvCell(r.ratio),
        csvCell(r.ct_amount),
        csvCell(r.ct_residual),
        csvCell(formatFinancingDateTime(r.F_CreatorTime)),
        csvCell(r.creator_account),
      ].join(',')
    )
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const name = `底层项目_当前页_${financingNow().format('YYYY-MM-DD_HHmmss')}.csv`
  saveAs(blob, name)
}

function parseUserAdmin() {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return false
    const u = JSON.parse(raw)
    return String(u.role || '').toLowerCase() === 'admin'
  } catch {
    return false
  }
}

function parseUserId() {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return ''
    const u = JSON.parse(raw)
    return u.id != null ? String(u.id) : ''
  } catch {
    return ''
  }
}

function formatIpoAmount(value) {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n)
    ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '-'
}

export default function ProjectSourcingIpoProjectsPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [creatorUserId, setCreatorUserId] = useState('')
  const [creatorSearch, setCreatorSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [aiEnrichSubmitting, setAiEnrichSubmitting] = useState(false)
  const [aiLogVisible, setAiLogVisible] = useState(false)
  const [aiLogLoading, setAiLogLoading] = useState(false)
  const [aiLogRows, setAiLogRows] = useState([])
  const [aiLogFid, setAiLogFid] = useState('')
  const [batchAiVisible, setBatchAiVisible] = useState(false)
  const [batchAiSubmitting, setBatchAiSubmitting] = useState(false)
  const [retryFailedVisible, setRetryFailedVisible] = useState(false)
  const [retryFailedSubmitting, setRetryFailedSubmitting] = useState(false)
  const [batchAiForm] = Form.useForm()
  const [retryFailedForm] = Form.useForm()
  const [batchQccSubmitting, setBatchQccSubmitting] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [dbList, setDbList] = useState([])
  const [sqlForm] = Form.useForm()
  const [sqlSaving, setSqlSaving] = useState(false)
  const [sqlPreviewing, setSqlPreviewing] = useState(false)
  const [sqlRunning, setSqlRunning] = useState(false)
  const [showCronModal, setShowCronModal] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState(false)
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [qccAllSubmitting, setQccAllSubmitting] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [newForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(false)

  const isAdmin = useMemo(() => parseUserAdmin(), [])
  const currentUserId = useMemo(() => parseUserId(), [])

  /** 表体纵向滚动高度：由下方 flex 区域实测，避免整页再出现纵向滚动条 */
  const tableScrollAreaRef = useRef(null)
  const [tableScrollY, setTableScrollY] = useState(360)

  useLayoutEffect(() => {
    const el = tableScrollAreaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      const h = el.clientHeight
      if (h < 80) return
      // 表头 + 分页 + 边框余量（scroll.y 仅作用于表体）
      setTableScrollY(Math.max(200, Math.floor(h - 118)))
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [filterCollapsed])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchCompetitorAnalysisIpoProjects({
        page,
        pageSize,
        keyword: kwSearch || undefined,
        creatorUserId: isAdmin && creatorSearch.trim() ? creatorSearch.trim() : undefined,
      })
      if (res.data?.success) {
        const d = res.data.data || {}
        setData(d.list || [])
        setTotal(Number(d.total || 0))
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, kwSearch, creatorSearch, isAdmin])

  useEffect(() => {
    load()
  }, [load])

  const canMutateRow = useCallback(
    (row) => isAdmin || String(row.F_CreatorUserId || '') === currentUserId,
    [isAdmin, currentUserId]
  )

  const openEdit = useCallback(
    (record) => {
      setEditing(record)
      editForm.setFieldsValue({
        project_name: record.project_name,
        company: record.company,
        unified_credit_code: record.unified_credit_code || '',
        inv_amount: record.inv_amount,
        residual_amount: record.residual_amount,
        ratio: record.ratio,
        ct_amount: record.ct_amount,
        ct_residual: record.ct_residual,
        fund: record.fund,
        sub: record.sub || '',
      })
      setEditOpen(true)
    },
    [editForm]
  )

  const submitNew = useCallback(async () => {
    try {
      const v = await newForm.validate()
      const res = await postCompetitorAnalysisIpoProject(v)
      if (res.data?.success) {
        Message.success('已创建')
        setNewOpen(false)
        load()
      } else {
        Message.error(res.data?.message || '创建失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '创建失败')
    }
  }, [newForm, load])

  const submitEdit = useCallback(async () => {
    if (!editing?.f_id) return
    try {
      const v = await editForm.validate()
      const res = await putCompetitorAnalysisIpoProject(String(editing.f_id), v)
      if (res.data?.success) {
        Message.success('已保存')
        setEditOpen(false)
        load()
      } else {
        Message.error(res.data?.message || '保存失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }, [editForm, editing, load])

  const handleDeleteRow = useCallback(
    (record) => {
      if (!record?.f_id) return
      Modal.confirm({
        title: '确认删除',
        content: '确认删除该底层项目？',
        onOk: async () => {
          try {
            const res = await deleteCompetitorAnalysisIpoProject(String(record.f_id))
            if (res.data?.success) {
              Message.success('已删除')
              load()
            } else {
              Message.error(res.data?.message || '删除失败')
            }
          } catch (e) {
            Message.error(e.response?.data?.message || e.message || '删除失败')
          }
        },
      })
    },
    [load]
  )

  const openRowLog = useCallback(
    async (record) => {
      if (!record?.f_id) return
      setEditing(record)
      setLogOpen(true)
      setLogLoading(true)
      try {
        const res = await fetchCompetitorAnalysisIpoProjectChangeLog(String(record.f_id))
        setLogRows(res.data?.success ? res.data.data || [] : [])
      } catch {
        setLogRows([])
      } finally {
        setLogLoading(false)
      }
    },
    []
  )

  const columns = useMemo(
    () => [
      { title: '项目编号', dataIndex: 'project_no', key: 'project_no', width: 140, ellipsis: true },
      { title: '归属基金', dataIndex: 'fund', key: 'fund', width: 140, ellipsis: true },
      { title: '归属子基金/SPV', dataIndex: 'sub', key: 'sub', width: 140, ellipsis: true },
      { title: '项目简称', dataIndex: 'project_name', key: 'project_name', width: 120, ellipsis: true },
      { title: '企业全称', dataIndex: 'company', key: 'company', width: 200, ellipsis: true },
      {
        title: '产品简介(AI)',
        dataIndex: 'ai_product_intro',
        key: 'ai_product_intro',
        width: 200,
        render: (_, row) => (
          <IntroPopoverCell columnTitle="产品简介(AI)" raw={row.ai_product_intro} triggerMaxWidth={200} />
        ),
      },
      {
        title: '企业标签(AI)',
        dataIndex: 'ai_industry_tags_display',
        key: 'ai_industry_tags_display',
        width: 160,
        render: (_, row) => (
          <IntroPopoverCell
            columnTitle="企业标签(AI)"
            raw={row.ai_industry_tags_display}
            triggerMaxWidth={160}
          />
        ),
      },
      {
        title: '企业介绍（企查查）',
        dataIndex: 'qcc_company_intro',
        key: 'qcc_company_intro',
        width: 200,
        render: (_, row) => (
          <IntroPopoverCell columnTitle="企业介绍（企查查）" raw={row.qcc_company_intro} triggerMaxWidth={200} />
        ),
      },
      {
        title: '统一社会信用代码',
        dataIndex: 'unified_credit_code',
        key: 'unified_credit_code',
        width: 180,
        ellipsis: true,
      },
      {
        title: '投资成本',
        dataIndex: 'inv_amount',
        key: 'inv_amount',
        width: 120,
        render: (v) => formatIpoAmount(v),
      },
      {
        title: '剩余成本',
        dataIndex: 'residual_amount',
        key: 'residual_amount',
        width: 120,
        render: (v) => formatIpoAmount(v),
      },
      {
        title: '穿透权益占比',
        dataIndex: 'ratio',
        key: 'ratio',
        width: 110,
        render: (v) => {
          if (v === null || v === undefined || v === '') return '-'
          const n = Number(v)
          if (!Number.isFinite(n)) return '-'
          return `${(n * 100).toFixed(2)}%`
        },
      },
      {
        title: '穿透投资成本',
        dataIndex: 'ct_amount',
        key: 'ct_amount',
        width: 120,
        render: (v) => formatIpoAmount(v),
      },
      {
        title: '穿透剩余成本',
        dataIndex: 'ct_residual',
        key: 'ct_residual',
        width: 120,
        render: (v) => formatIpoAmount(v),
      },
      {
        title: 'AI状态',
        dataIndex: 'ai_enrich_status',
        key: 'ai_enrich_status',
        width: 96,
        render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
      },
      {
        title: '创建时间',
        dataIndex: 'F_CreatorTime',
        key: 'F_CreatorTime',
        width: 168,
        render: (v) => formatFinancingDateTime(v),
      },
      { title: '创建人', dataIndex: 'creator_account', key: 'creator_account', width: 100, ellipsis: true },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        render: (_, row) => {
          const canEdit = canMutateRow(row)
          if (!canEdit) return <span style={{ color: 'var(--color-text-3)' }}>-</span>
          return (
            <Space size={6} wrap={false}>
              <Button type="primary" size="mini" onClick={() => openEdit(row)}>
                编辑
              </Button>
              <Button type="outline" size="mini" status="success" onClick={() => openRowLog(row)}>
                日志
              </Button>
              <Button type="outline" size="mini" status="danger" onClick={() => handleDeleteRow(row)}>
                删除
              </Button>
            </Space>
          )
        },
      },
    ],
    [canMutateRow, openEdit, openRowLog, handleDeleteRow]
  )

  const handleExportCsv = useCallback(async () => {
    setExporting(true)
    try {
      const res = await getCompetitorAnalysisIpoProjectsExport({
        keyword: kwSearch || undefined,
        creatorUserId: isAdmin && creatorSearch.trim() ? creatorSearch.trim() : undefined,
      })
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
      const name = `底层项目_竞品分析_${financingNow().format('YYYY-MM-DD_HHmmss')}.csv`
      saveAs(blob, name)
      Message.success('已导出 CSV')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }, [kwSearch, creatorSearch, isAdmin])

  const handleBatchAiOk = async () => {
    try {
      const v = await batchAiForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择创建日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setBatchAiSubmitting(true)
      const res = await postIpoProjectBatchAiEnrich({ start_date: start, end_date: end })
      if (res.status === 202 && res.data?.success) {
        Message.success(res.data.message || '已加入队列')
        setBatchAiVisible(false)
        load()
      } else if (res.data?.success) {
        Message.success(res.data.message || '已受理')
        setBatchAiVisible(false)
        load()
      } else {
        Message.error(res.data?.message || '受理失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '受理失败')
    } finally {
      setBatchAiSubmitting(false)
    }
  }

  const handleRetryFailedAiOk = async () => {
    try {
      const v = await retryFailedForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择创建日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setRetryFailedSubmitting(true)
      const res = await postIpoProjectBatchAiEnrich({
        start_date: start,
        end_date: end,
        only_failed: true,
      })
      if (res.status === 202 && res.data?.success) {
        Message.success(res.data.message || '已加入失败重试队列')
        setRetryFailedVisible(false)
        load()
      } else if (res.data?.success) {
        Message.success(res.data.message || '已受理')
        setRetryFailedVisible(false)
        load()
      } else {
        Message.error(res.data?.message || '受理失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '受理失败')
    } finally {
      setRetryFailedSubmitting(false)
    }
  }

  const loadSqlSettingByDb = async (externalDbConfigId) => {
    if (!externalDbConfigId) {
      sqlForm.setFieldsValue({
        external_db_config_id: '',
        sql_text: '',
        is_enabled: true,
        cron_expression: '',
        qcc_brief_after_sync_enabled: false,
      })
      return
    }
    try {
      const res = await fetchCompetitorAnalysisIpoProjectSqlSyncSetting(externalDbConfigId)
      const d = res.data?.data || {}
      sqlForm.setFieldsValue({
        external_db_config_id: externalDbConfigId,
        sql_text: d.sql_text || '',
        is_enabled: d.is_enabled !== 0,
        cron_expression: d.cron_expression || '',
        qcc_brief_after_sync_enabled: Number(d.qcc_brief_after_sync_enabled) === 1,
      })
    } catch {
      sqlForm.setFieldsValue({
        external_db_config_id: externalDbConfigId,
        sql_text: '',
        is_enabled: true,
        cron_expression: '',
        qcc_brief_after_sync_enabled: false,
      })
    }
  }

  const openSqlModal = async () => {
    setSqlModalOpen(true)
    const dbs = await (async () => {
      try {
        const res = await axios.get('/api/system/database-configs', { params: { page: 1, pageSize: 100 } })
        if (res.data?.success) {
          const list = (res.data.data || []).filter((d) => d.is_active === 1 || d.is_active === true)
          setDbList(list)
          return list
        }
      } catch {
        /* ignore */
      }
      setDbList([])
      return []
    })()
    try {
      const res = await fetchCompetitorAnalysisIpoProjectSqlSyncSetting()
      const d = res.data?.data || {}
      const selectedDb = d.external_db_config_id || dbs[0]?.id || ''
      await loadSqlSettingByDb(selectedDb)
    } catch {
      const selectedDb = dbs[0]?.id || ''
      await loadSqlSettingByDb(selectedDb)
    }
  }

  const handleSaveSqlSetting = async () => {
    let v
    try {
      v = await sqlForm.validate()
    } catch {
      return
    }
    setSqlSaving(true)
    try {
      const res = await putCompetitorAnalysisIpoProjectSqlSyncSetting({
        external_db_config_id: v.external_db_config_id || null,
        sql_text: (v.sql_text || '').trim(),
        is_enabled: v.is_enabled ? 1 : 0,
        cron_expression: (v.cron_expression || '').trim() || null,
        qcc_brief_after_sync_enabled: v.qcc_brief_after_sync_enabled ? 1 : 0,
      })
      if (res.data?.success) {
        Message.success('已保存')
        setSqlModalOpen(false)
      } else {
        Message.error(res.data?.message || '保存失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '保存失败')
    } finally {
      setSqlSaving(false)
    }
  }

  const handleSqlPreview = async () => {
    let v
    try {
      v = await sqlForm.validate(['external_db_config_id', 'sql_text'])
    } catch {
      return
    }
    setSqlPreviewing(true)
    try {
      const res = await postCompetitorAnalysisIpoProjectSqlSyncPreview({
        external_db_config_id: v.external_db_config_id,
        sql_text: (v.sql_text || '').trim(),
      })
      if (res.data?.success) {
        const sample = res.data.data?.sample || []
        Message.info(`共 ${res.data.data?.rowCount ?? 0} 行，预览前 ${sample.length} 条已输出到控制台`)
        console.log('[竞品分析 底层项目 SQL 预览]', sample)
      } else {
        Message.error(res.data?.message || '预览失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '预览失败')
    } finally {
      setSqlPreviewing(false)
    }
  }

  const handleRunSqlSync = async () => {
    let v
    try {
      v = await sqlForm.validate()
    } catch {
      return
    }
    setSqlRunning(true)
    try {
      const res = await postCompetitorAnalysisIpoProjectSqlSyncRun({
        external_db_config_id: v.external_db_config_id,
        sql_text: (v.sql_text || '').trim(),
        is_enabled: v.is_enabled ? 1 : 0,
        qcc_brief_after_sync_enabled: v.qcc_brief_after_sync_enabled ? 1 : 0,
      })
      if (res.data?.success) {
        const d = res.data.data || {}
        const snap =
          d.ai_snapshot_saved != null || d.ai_snapshot_restored != null
            ? `；快照 ${d.ai_snapshot_saved ?? 0} 条，回填 ${d.ai_snapshot_restored ?? 0} 行`
            : ''
        const qcc =
          d.qcc_post_sync && d.qcc_post_sync.ok !== false
            ? `；企查查后处理 去重查询=${d.qcc_post_sync.unique_queries ?? 0} 跳过无效统一码=${d.qcc_post_sync.skipped_invalid_credit ?? 0}`
            : d.qcc_post_sync && d.qcc_post_sync.error
              ? `；企查查后处理失败：${d.qcc_post_sync.error}`
              : ''
        Message.success(
          `同步完成：新增 ${d.inserted ?? 0}，更新 ${d.updated ?? 0}，跳过 ${d.skipped ?? 0}${snap}${qcc}（写入应用：竞品分析）`
        )
        setSqlModalOpen(false)
        load()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '同步失败')
    } finally {
      setSqlRunning(false)
    }
  }

  return (
    <div
      className="enterprise-management financing-events-page"
      style={{
        boxSizing: 'border-box',
        height: 'calc(100vh - 72px)',
        padding: '16px 24px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Card
        className="management-card"
        bordered={false}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        bodyStyle={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="management-header">
          <h2 className="management-title">底层项目</h2>
          <Space wrap>
            <Button onClick={load} loading={loading}>
              刷新
            </Button>
            <Button type="outline" onClick={() => setShowBatchImport(true)}>
              批量导入
            </Button>
            <Button type="outline" onClick={openSqlModal}>
              定时更新
            </Button>
            <Button
              type="outline"
              onClick={() => {
                if (!data.length) {
                  Message.warning('当前页无数据')
                  return
                }
                downloadIpoProjectsCurrentPageCsv(data)
                Message.success('已导出当前页 CSV')
              }}
              disabled={loading || !data.length}
            >
              导出当前页
            </Button>
            <Button type="outline" loading={exporting} onClick={handleExportCsv} disabled={loading}>
              导出全部
            </Button>
            {isAdmin ? (
              <>
                <Button
                  type="outline"
                  loading={aiEnrichSubmitting}
                  disabled={!selectedRowKeys.length}
                  onClick={async () => {
                    const id = selectedRowKeys[0]
                    if (!id) {
                      Message.warning('请先勾选一行')
                      return
                    }
                    setAiEnrichSubmitting(true)
                    try {
                      const res = await postIpoProjectAiEnrich(String(id))
                      if (res.status === 202 && res.data?.success) {
                        Message.success(res.data.message || '已受理 AI 取数，请稍后刷新查看')
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
                      setAiEnrichSubmitting(false)
                    }
                  }}
                >
                  手动AI取数
                </Button>
                <Button
                  type="outline"
                  loading={batchQccSubmitting}
                  disabled={!selectedRowKeys.length}
                  onClick={async () => {
                    if (!selectedRowKeys.length) {
                      Message.warning('请勾选至少一行')
                      return
                    }
                    setBatchQccSubmitting(true)
                    try {
                      const res = await postIpoProjectBatchQccCompanyBrief({ f_ids: selectedRowKeys.map(String) })
                      if (res.data?.success) {
                        Message.success(res.data.message || '企查查同步（勾选行）完成')
                        load()
                      } else {
                        Message.error(res.data?.message || '失败')
                      }
                    } catch (e) {
                      Message.error(e.response?.data?.message || e.message || '失败')
                    } finally {
                      setBatchQccSubmitting(false)
                    }
                  }}
                >
                  企查查同步（勾选行）
                </Button>
                <Button
                  type="outline"
                  loading={qccAllSubmitting}
                  disabled={loading}
                  onClick={() => {
                    Modal.confirm({
                      title: '企查查全部同步',
                      content: (
                        <div>
                          <p>
                            将按当前<strong>筛选条件</strong>（关键词、创建人）拉取列表中的<strong>全部</strong>
                            底层项目（最多 5 万行），按<strong>统一社会信用代码</strong>（无有效代码时按企业全称）去重后依次调用企查查并写回所有相同代码的行；每条去重键间隔约
                            400ms，数据量大时可能需较长时间。
                          </p>
                        </div>
                      ),
                      onOk: () =>
                        (async () => {
                          setQccAllSubmitting(true)
                          try {
                            const res = await postIpoProjectQccCompanyBriefSyncAllFiltered({
                              keyword: kwSearch || undefined,
                              creatorUserId: isAdmin && creatorSearch.trim() ? creatorSearch.trim() : undefined,
                            })
                            if (res.data?.success) {
                              const d = res.data.data || {}
                              Message.success(
                                res.data.message ||
                                  `完成：成功 ${d.success ?? 0} 行，失败 ${d.failed ?? 0} 行（调用 ${d.unique_queries ?? 0} 次）`
                              )
                              load()
                            } else {
                              Message.error(res.data?.message || '同步失败')
                            }
                          } catch (e) {
                            Message.error(e.response?.data?.message || e.message || '同步失败')
                          } finally {
                            setQccAllSubmitting(false)
                          }
                        })(),
                    })
                  }}
                >
                  企查查全部同步
                </Button>
                <Button
                  type="outline"
                  disabled={!selectedRowKeys.length}
                  loading={aiLogLoading}
                  onClick={async () => {
                    const id = selectedRowKeys[0]
                    if (!id) {
                      Message.warning('请先勾选一行')
                      return
                    }
                    setAiLogFid(String(id))
                    setAiLogVisible(true)
                    setAiLogLoading(true)
                    try {
                      const res = await fetchIpoProjectAiEnrichLogs({
                        ipo_project_f_id: String(id),
                        page: 1,
                        pageSize: 50,
                      })
                      if (res.data?.success) {
                        setAiLogRows(res.data.data?.list || [])
                      } else {
                        setAiLogRows([])
                        Message.error(res.data?.message || '加载日志失败')
                      }
                    } catch (e) {
                      setAiLogRows([])
                      Message.error(e.response?.data?.message || e.message || '加载日志失败')
                    } finally {
                      setAiLogLoading(false)
                    }
                  }}
                >
                  AI执行日志
                </Button>
                <Button
                  type="outline"
                  status="success"
                  onClick={() => {
                    batchAiForm.setFieldsValue({
                      date_range: [dayjs().subtract(7, 'day'), dayjs()],
                    })
                    setBatchAiVisible(true)
                  }}
                >
                  批量AI取数
                </Button>
                <Button
                  type="outline"
                  status="danger"
                  onClick={() => {
                    retryFailedForm.setFieldsValue({
                      date_range: [dayjs().subtract(7, 'day'), dayjs()],
                    })
                    setRetryFailedVisible(true)
                  }}
                >
                  重试失败AI
                </Button>
              </>
            ) : null}
            <Button
              type="primary"
              onClick={() => {
                newForm.resetFields()
                newForm.setFieldsValue({ sub: '' })
                setNewOpen(true)
              }}
            >
              新增
            </Button>
          </Space>
        </div>

        <Collapse
          activeKey={filterCollapsed ? [] : ['filters']}
          onChange={(_key, activeKeys) => setFilterCollapsed(activeKeys.length === 0)}
          className="filter-collapse"
        >
          <CollapseItem header="筛选条件" name="filters">
            <div className="filter-content">
              <div className="filter-row">
                <div className="filter-item">
                  <label>关键词</label>
                  <Input
                    placeholder="编号、基金、项目、企业、金额、信用代码、AI、企查查等"
                    style={{ width: 420 }}
                    value={keyword}
                    onChange={setKeyword}
                    allowClear
                  />
                </div>
                {isAdmin ? (
                  <div className="filter-item">
                    <label>筛选创建人 users.id（可选）</label>
                    <Input
                      placeholder="仅管理员"
                      style={{ width: 220 }}
                      value={creatorUserId}
                      onChange={setCreatorUserId}
                      allowClear
                    />
                  </div>
                ) : null}
                <div className="filter-actions">
                  <Button
                    type="primary"
                    onClick={() => {
                      setPage(1)
                      setKwSearch(keyword.trim())
                      setCreatorSearch(creatorUserId.trim())
                    }}
                  >
                    查询
                  </Button>
                  <Button
                    onClick={() => {
                      setKeyword('')
                      setKwSearch('')
                      setCreatorUserId('')
                      setCreatorSearch('')
                      setPage(1)
                    }}
                  >
                    重置
                  </Button>
                </div>
              </div>
            </div>
          </CollapseItem>
        </Collapse>

        <div
          ref={tableScrollAreaRef}
          style={{
            flex: 1,
            minHeight: 0,
            marginTop: 16,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div className="table-container" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Table
            rowKey="f_id"
            loading={loading}
            data={data}
            columns={columns}
            border={{
              wrapper: true,
              cell: true,
            }}
            stripe
            scroll={{ x: 2480, y: tableScrollY }}
            rowSelection={
              isAdmin
                ? {
                    type: 'checkbox',
                    selectedRowKeys,
                    onChange: setSelectedRowKeys,
                  }
                : undefined
            }
            pagination={{
              current: page,
              pageSize,
              total,
              sizeCanChange: true,
              pageSizeChangeResetCurrent: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              onChange: (p, ps) => {
                setPage(p)
                setPageSize(ps)
              },
              showTotal: (t) => `共 ${t} 条`,
            }}
          />
          </div>
        </div>
      </Card>

      {showBatchImport ? (
        <BatchImportModal
          dataAppName="竞品分析"
          onClose={() => setShowBatchImport(false)}
          onSuccess={() => {
            setShowBatchImport(false)
            Message.success('导入完成')
          }}
        />
      ) : null}

      {newOpen && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewOpen(false)
          }}
        >
          <div className="modal-content" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新增底层项目</h3>
              <button type="button" className="close-button" aria-label="关闭" onClick={() => setNewOpen(false)}>
                ×
              </button>
            </div>
            <div className="enterprise-form">
              <div className="form-group">
                <label>项目编号</label>
                <input type="text" readOnly className="readonly-input" value="保存后由系统自动生成" />
              </div>
              <Form form={newForm} layout="vertical" style={{ width: '100%' }}>
                <FormItem label="项目简称" field="project_name" rules={[{ required: true, message: '请填写项目简称' }]}>
                  <Input placeholder="请输入项目简称" />
                </FormItem>
                <FormItem label="企业全称" field="company" rules={[{ required: true, message: '请填写企业全称' }]}>
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="请输入企业全称" />
                </FormItem>
                <FormItem label="统一社会信用代码" field="unified_credit_code">
                  <Input placeholder="可选" allowClear />
                </FormItem>
                <FormItem label="归属基金" field="fund" rules={[{ required: true, message: '请填写归属基金' }]}>
                  <Input placeholder="请输入归属基金" />
                </FormItem>
                <FormItem label="归属子基金" field="sub">
                  <Input placeholder="可选" allowClear />
                </FormItem>
                <FormItem label="投资成本" field="inv_amount" rules={[{ required: true, message: '请填写投资成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
                <FormItem label="剩余成本" field="residual_amount" rules={[{ required: true, message: '请填写剩余成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
                <FormItem label="穿透权益占比" field="ratio" rules={[{ required: true, message: '请填写穿透权益占比' }]}>
                  <Input placeholder="小数，如 0.05 表示 5%" />
                </FormItem>
                <FormItem label="穿透投资成本" field="ct_amount" rules={[{ required: true, message: '请填写穿透投资成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
                <FormItem label="穿透剩余成本" field="ct_residual" rules={[{ required: true, message: '请填写穿透剩余成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
              </Form>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setNewOpen(false)}>
                  取消
                </button>
                <button type="button" className="btn-confirm" onClick={submitNew}>
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditOpen(false)
          }}
        >
          <div className="modal-content" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>编辑底层项目</h3>
              <button type="button" className="close-button" aria-label="关闭" onClick={() => setEditOpen(false)}>
                ×
              </button>
            </div>
            <div className="enterprise-form">
              <div className="form-group">
                <label>项目编号</label>
                <input type="text" readOnly className="readonly-input" value={editing?.project_no || ''} />
              </div>
              <Form form={editForm} layout="vertical" style={{ width: '100%' }}>
                <FormItem label="项目简称" field="project_name" rules={[{ required: true, message: '请填写项目简称' }]}>
                  <Input placeholder="请输入项目简称" />
                </FormItem>
                <FormItem label="企业全称" field="company" rules={[{ required: true, message: '请填写企业全称' }]}>
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="请输入企业全称" />
                </FormItem>
                <FormItem label="统一社会信用代码" field="unified_credit_code">
                  <Input placeholder="可选" allowClear />
                </FormItem>
                <FormItem label="归属基金" field="fund" rules={[{ required: true, message: '请填写归属基金' }]}>
                  <Input placeholder="请输入归属基金" />
                </FormItem>
                <FormItem label="归属子基金" field="sub">
                  <Input placeholder="可选" allowClear />
                </FormItem>
                <FormItem label="投资成本" field="inv_amount" rules={[{ required: true, message: '请填写投资成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
                <FormItem label="剩余成本" field="residual_amount" rules={[{ required: true, message: '请填写剩余成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
                <FormItem label="穿透权益占比" field="ratio" rules={[{ required: true, message: '请填写穿透权益占比' }]}>
                  <Input placeholder="小数，如 0.05 表示 5%" />
                </FormItem>
                <FormItem label="穿透投资成本" field="ct_amount" rules={[{ required: true, message: '请填写穿透投资成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
                <FormItem label="穿透剩余成本" field="ct_residual" rules={[{ required: true, message: '请填写穿透剩余成本' }]}>
                  <Input placeholder="数字" />
                </FormItem>
              </Form>
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setEditOpen(false)}>
                  取消
                </button>
                <button type="button" className="btn-confirm" onClick={submitEdit}>
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        title={editing?.f_id != null ? `变更日志（f_id=${editing.f_id}）` : '变更日志'}
        visible={logOpen}
        footer={null}
        onCancel={() => setLogOpen(false)}
        style={{ width: 720 }}
      >
        {logLoading ? (
          <div>加载中…</div>
        ) : logRows.length === 0 ? (
          <div>暂无变更记录</div>
        ) : (
          <Table
            size="small"
            rowKey={(r, idx) => (r.id != null ? String(r.id) : `log-${idx}`)}
            columns={[
              { title: '字段', dataIndex: 'changed_field', width: 120 },
              { title: '旧值', dataIndex: 'old_value', ellipsis: true },
              { title: '新值', dataIndex: 'new_value', ellipsis: true },
              { title: '操作人', dataIndex: 'change_user_account', width: 100 },
              { title: '时间', dataIndex: 'change_time', width: 170 },
            ]}
            data={logRows}
            pagination={false}
            scroll={{ y: 360 }}
          />
        )}
      </Modal>

      <Modal
        title="业务库 SQL 同步（竞品分析 · 底层项目）"
        visible={sqlModalOpen}
        onCancel={() => setSqlModalOpen(false)}
        style={{ width: 720 }}
        footer={
          <Space>
            <Button onClick={() => setSqlModalOpen(false)}>关闭</Button>
            <Button onClick={handleSaveSqlSetting} loading={sqlSaving}>
              保存配置
            </Button>
            <Button onClick={handleSqlPreview} loading={sqlPreviewing}>
              预览结果
            </Button>
            <Button type="primary" onClick={handleRunSqlSync} loading={sqlRunning}>
              执行同步
            </Button>
          </Space>
        }
      >
        <p style={{ marginBottom: 12, color: 'var(--color-text-2)', fontSize: 13 }}>
          与「上市进展 → 底层项目表」的 SQL 同步规则相同（仅只读 SELECT/WITH，字段映射一致）。差异：同步结果写入{' '}
          <strong>ipo_project.data_app_id = 竞品分析</strong>
          ，且仅清空/覆盖<strong>当前用户</strong>在该应用下的底层项目行，不影响上市进展菜单中的底层项目数据。请在 SQL 中尽量提供{' '}
          <strong>unified_credit_code</strong>
          （统一社会信用代码），以便同步后自动回填本次清空前已存在的 AI 与企查查简介。若开启「同步后企查查简介」，写入完成后仅对<strong>18 位有效</strong>统一码自动拉取企查查企业简介，错误或非标准长度代码会跳过。
        </p>
        <p style={{ marginBottom: 12, color: 'var(--color-text-3)', fontSize: 12 }}>
          字段：project_name、company、unified_credit_code（可选，用于回填 AI/企查查）、fund、sub（可选）、inv_amount、residual_amount、ratio、ct_amount、ct_residual。
        </p>
        <Form form={sqlForm} layout="vertical">
          <FormItem
            label="业务数据库连接"
            field="external_db_config_id"
            rules={[{ required: true, message: '请选择连接' }]}
          >
            <Select
              placeholder="请选择"
              allowClear
              showSearch
              onChange={(v) => {
                loadSqlSettingByDb(v || '')
              }}
            >
              {dbList.map((d) => (
                <Option key={d.id} value={d.id}>
                  {d.name} ({d.host})
                </Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label="只读 SQL" field="sql_text" rules={[{ required: true, message: '请填写 SQL' }]}>
            <Input.TextArea
              placeholder="仅支持 SELECT / WITH"
              autoSize={{ minRows: 6, maxRows: 16 }}
            />
          </FormItem>
          <FormItem label="是否启用" field="is_enabled" triggerPropName="checked">
            <Switch checkedText="启用" uncheckedText="禁用" />
          </FormItem>
          <FormItem
            label="同步后企查查简介"
            field="qcc_brief_after_sync_enabled"
            triggerPropName="checked"
            extra="每次 SQL 全量写入并提交成功后，对本用户在竞品分析下的底层项目中「18 位有效统一社会信用代码」按码去重调用企查查 CompanyBrief 并写回简介；无效码跳过。与定时任务共用本开关。"
          >
            <Switch checkedText="启用" uncheckedText="关闭" />
          </FormItem>
          <FormItem
            label="底层项目同步 Cron（可选）"
            field="cron_expression"
            extra="定时任务将本配置的外部库数据同步至 ipo_project（data_app_id=竞品分析），与上市进展侧 SQL 定时任务独立。"
          >
            <Input
              placeholder="点击右侧按钮配置 Cron（Quartz）"
              readOnly
              addAfter={
                <Button type="text" size="small" onClick={() => setShowCronModal(true)}>
                  配置
                </Button>
              }
            />
          </FormItem>
        </Form>
      </Modal>

      <CronGenerator
        visible={showCronModal}
        value={sqlForm.getFieldValue('cron_expression')}
        onChange={(cron) => {
          sqlForm.setFieldValue('cron_expression', cron)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />

      <Modal
        title="批量AI取数（按底层项目创建日期）"
        visible={batchAiVisible}
        onCancel={() => setBatchAiVisible(false)}
        onOk={handleBatchAiOk}
        confirmLoading={batchAiSubmitting}
        unmountOnExit
      >
        <Form form={batchAiForm} layout="vertical">
          <FormItem
            label="创建日期范围"
            field="date_range"
            rules={[{ required: true, message: '请选择日期范围' }]}
          >
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </FormItem>
          <div style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            仅处理 data_app_id 为「竞品分析」的底层项目；按<strong>统一社会信用代码</strong>去重（无有效代码时按企业全称）；模型成功后同源代码的多行会一并写入。
          </div>
        </Form>
      </Modal>

      <Modal
        title="重试失败AI"
        visible={retryFailedVisible}
        onCancel={() => setRetryFailedVisible(false)}
        onOk={handleRetryFailedAiOk}
        confirmLoading={retryFailedSubmitting}
        unmountOnExit
      >
        <Form form={retryFailedForm} layout="vertical">
          <FormItem
            label="创建日期范围"
            field="date_range"
            rules={[{ required: true, message: '请选择日期范围' }]}
          >
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </FormItem>
          <div style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
            仅 ai_enrich_status = failed 的记录；去重规则与「批量AI取数」一致（统一社会信用代码优先，否则企业全称）。
          </div>
        </Form>
      </Modal>

      <Modal
        title={`AI 执行日志（f_id=${aiLogFid}）`}
        visible={aiLogVisible}
        onCancel={() => setAiLogVisible(false)}
        footer={
          <Button type="primary" onClick={() => setAiLogVisible(false)}>
            关闭
          </Button>
        }
        style={{ width: 900 }}
        unmountOnExit
      >
        <Table
          rowKey="id"
          loading={aiLogLoading}
          data={aiLogRows}
          pagination={false}
          scroll={{ y: 360 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 72 },
            { title: '状态', dataIndex: 'execution_status', width: 88 },
            {
              title: '联网状态',
              dataIndex: 'search_status_label',
              width: 168,
              render: (v) => v || '—',
            },
            { title: '触发类型', dataIndex: 'trigger_type', width: 200, ellipsis: true },
            { title: '触发时间', dataIndex: 'triggered_at', width: 168, render: (v) => formatFinancingDateTime(v) },
            { title: '开始', dataIndex: 'started_at', width: 168, render: (v) => formatFinancingDateTime(v) },
            { title: '结束', dataIndex: 'finished_at', width: 168, render: (v) => formatFinancingDateTime(v) },
            { title: '耗时ms', dataIndex: 'duration_ms', width: 88 },
            {
              title: '错误',
              dataIndex: 'error_message',
              ellipsis: true,
              render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
            },
          ]}
        />
      </Modal>
    </div>
  )
}
