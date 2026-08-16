import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react'
import {
  Table,
  Button,
  Space,
  Pagination,
  Modal,
  Message,
  Skeleton,
  Card,
  Collapse,
  Select,
  Input,
  Tabs,
  Form,
  DatePicker,
  Checkbox,
} from '@arco-design/web-react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { useNavigate } from 'react-router-dom'
import axios from '../utils/axios'
import { getUser } from '../utils/auth'
import EnterpriseForm from './EnterpriseForm'
import BatchImportModal from './BatchImportModal'
import LogModal from './LogModal'
import EnterpriseSyncModal from './EnterpriseSyncModal'
import {
  postInvestedEnterpriseBatchAiEnrich,
  fetchInvestedEnterpriseAiEnrichLogs,
  postInvestedEnterpriseBatchQccCompanyBrief,
  fetchInvestedEnterpriseCompetitorReadiness,
  postInvestedEnterpriseCompetitorAnalysisRun,
  fetchInvestedCompetitionLensProposal,
  postInvestedEnterpriseBatchBaikeLookup,
} from '../api/competitor-analysis'
import { formatFinancingYmd, financingNow, formatFinancingDateTime } from './competitor-analysis/financingDateUtils'
import { openValuationCaseFromInvested } from '../api/valuation'
import { IntroPopoverCell } from './competitor-analysis/introPopoverAiCell'
import CompetitorMatchSupplementModal from './competitor-analysis/CompetitorMatchSupplementModal'
import CompetitionLensConfirmModal from './competitor-analysis/CompetitionLensConfirmModal'
import './EnterpriseManagement.css'

const Option = Select.Option
const InputSearch = Input.Search
const CollapseItem = Collapse.Item
const TabPane = Tabs.TabPane
const FormItem = Form.Item

const DATA_APP_NEWS = '新闻舆情'
const DATA_APP_PROJECT = '竞品分析'
const DATA_APP_VALUATION = '项目估值'
const IE_ROW_SELECTION_WIDTH = 52
const IE_NUM_COL_CLASS = 'invested-enterprises-num-col'

/** 金额列：表头居中、内容右对齐 */
function buildIeNumericColumn(title, dataIndex, width, render) {
  return {
    title,
    dataIndex,
    key: dataIndex,
    width,
    className: IE_NUM_COL_CLASS,
    align: 'right',
    headerCellClassName: IE_NUM_COL_CLASS,
    bodyCellClassName: IE_NUM_COL_CLASS,
    headerCellStyle: { textAlign: 'center' },
    bodyCellStyle: { textAlign: 'right' },
    render,
  }
}

/** 从行数据取金额（兼容 snake_case / camelCase；避免仅依赖 Table render 的第一个参数） */
function pickAmountField(record, snakeKey) {
  if (!record) return undefined
  const camelKey = snakeKey.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())
  const v = record[snakeKey] ?? record[camelKey]
  return v
}

function formatTableAmount(value) {
  if (value == null || value === '') return '-'
  if (typeof value === 'bigint') {
    const bn = Number(value)
    if (!Number.isFinite(bn)) return '-'
    return bn.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const cleaned = String(value).replace(/,/g, '').replace(/\s/g, '').trim()
  if (cleaned === '') return '-'
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatExportMoneyPlain(v) {
  if (v == null || v === '') return ''
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : ''
}

/** 被投企业列表：企查查简介最近一次写入来源（与 invested_enterprises.qcc_sync_via 一致） */
function formatQccSyncViaLabel(v) {
  const s = String(v || '').trim()
  if (!s) return <span title="尚无同步记录或历史数据未写入该字段">-</span>
  const map = {
    qcc_api: '接口拉取',
    cross_table_propagate: '跨表补全',
    legacy_api: '接口(单条)',
  }
  const label = map[s] || s
  const title =
    s === 'qcc_api'
      ? '最近一次写入调用了企查查 CompanyBrief/GetInfo（统一信用码≥8 时三表对齐，同一信用码一次调用写回多表）'
      : s === 'cross_table_propagate'
        ? '最近一次写入来自三表对齐：用其他表已有简介补全本行，本轮未单独请求企查查接口'
        : s === 'legacy_api'
          ? '最近一次为按企业全称或短信用码单条调用企查查接口写入'
          : ''
  return <span title={title}>{label}</span>
}

function summarizeInvestedEnterpriseQccBatchResults(results) {
  if (!Array.isArray(results)) return ''
  let api = 0
  let prop = 0
  let leg = 0
  for (const r of results) {
    if (!r || !r.success) continue
    const src = r.sync_source
    if (src === 'qcc_api') api += 1
    else if (src === 'cross_table_propagate') prop += 1
    else if (src === 'legacy_api') leg += 1
  }
  const parts = []
  if (api) parts.push(`接口拉取 ${api} 条`)
  if (prop) parts.push(`跨表补全 ${prop} 条`)
  if (leg) parts.push(`单条接口 ${leg} 条`)
  return parts.length ? `（${parts.join('；')}）` : ''
}

/** 与列表列顺序一致（客户端 XLSX） */
function buildInvestedEnterpriseExportRows(list, startSeq = 0) {
  return list.map((row, i) => ({
    序号: startSeq + i + 1,
    项目编号: row.project_number ?? '',
    企业类型: row.entity_type ?? '',
    项目简称: row.project_abbreviation ?? '',
    关联基金: row.fund ?? '',
    被投企业全称: row.enterprise_full_name ?? '',
    '产品简介(AI)': row.ai_product_intro ?? '',
    '企业标签(AI)': row.ai_industry_tags_display ?? '',
    '企业介绍（企查查）': row.qcc_company_intro ?? '',
    企查查来源: row.qcc_sync_via ?? '',
    企查查同步时间: row.qcc_sync_at ?? '',
    投资成本: formatExportMoneyPlain(pickAmountField(row, 'investment_cost')),
    已退出成本: formatExportMoneyPlain(pickAmountField(row, 'exited_cost')),
    剩余成本: formatExportMoneyPlain(pickAmountField(row, 'remaining_cost')),
    剩余价值: formatExportMoneyPlain(pickAmountField(row, 'residual_value')),
    退出状态: row.exit_status || '未退出',
    AI状态: row.ai_enrich_status ?? '',
    创建时间: row.created_at ? new Date(row.created_at) : null,
    更新时间: row.updated_at ? new Date(row.updated_at) : null,
  }))
}

const IE_EXPORT_PAGE_SIZE = 200

function EnterpriseManagement({
  dataAppName = DATA_APP_NEWS,
  pageTitle = '舆情监控对象',
  hideEntityTabs = false,
  /** 为 true 时：页面高度锁在视口内，仅表体纵向滚动（用于项目挖掘-被投企业） */
  viewportBoundTable = false,
  onValuationClick,
}) {
  const [enterprises, setEnterprises] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingEnterprise, setEditingEnterprise] = useState(null)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logEnterpriseId, setLogEnterpriseId] = useState(null)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [allEnterprises, setAllEnterprises] = useState([])
  const [allTotal, setAllTotal] = useState(0)

  const showInvestedEnterpriseAi = dataAppName === DATA_APP_PROJECT && hideEntityTabs
  const showValuationAction = dataAppName === DATA_APP_VALUATION && hideEntityTabs
  const navigate = useNavigate()

  const tableScrollAreaRef = useRef(null)
  const [tableScrollY, setTableScrollY] = useState(360)

  useLayoutEffect(() => {
    if (!viewportBoundTable) return undefined
    const el = tableScrollAreaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      const h = el.clientHeight
      if (h < 80) return
      // scroll.y 仅作用于表体；分页在表格外，此处高度已不含分页区
      setTableScrollY(Math.max(200, Math.floor(h - 52)))
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewportBoundTable, filterCollapsed, activeTab, hideEntityTabs])

  const [exportingAll, setExportingAll] = useState(false)
  const [ieAiLogVisible, setIeAiLogVisible] = useState(false)
  const [ieAiLogLoading, setIeAiLogLoading] = useState(false)
  const [ieAiLogRows, setIeAiLogRows] = useState([])
  const [ieAiLogEnterpriseId, setIeAiLogEnterpriseId] = useState('')
  const [batchIeAiVisible, setBatchIeAiVisible] = useState(false)
  const [batchIeAiSubmitting, setBatchIeAiSubmitting] = useState(false)
  const [retryFailedIeAiVisible, setRetryFailedIeAiVisible] = useState(false)
  const [retryFailedIeAiSubmitting, setRetryFailedIeAiSubmitting] = useState(false)
  const [qccBriefSubmitting, setQccBriefSubmitting] = useState(false)
  const [batchIeAiForm] = Form.useForm()
  const [retryFailedIeAiForm] = Form.useForm()
  const [batchIeBaikeVisible, setBatchIeBaikeVisible] = useState(false)
  const [batchIeBaikeSubmitting, setBatchIeBaikeSubmitting] = useState(false)
  const [batchIeBaikeForm] = Form.useForm()

  const [competitorSelectedKeys, setCompetitorSelectedKeys] = useState([])
  const [competitorSupplementModal, setCompetitorSupplementModal] = useState({
    visible: false,
    enterpriseId: '',
    enterpriseName: '',
  })
  const [competitorRunSubmitting, setCompetitorRunSubmitting] = useState(false)
  const [lensModal, setLensModal] = useState({
    visible: false,
    loading: false,
    confirming: false,
    enterpriseId: '',
    enterpriseName: '',
    proposal: null,
  })

  useEffect(() => {
    if (hideEntityTabs) {
      setActiveTab('invested')
    }
  }, [hideEntityTabs])

  useEffect(() => {
    const user = getUser()
    if (user) {
      try {
        setIsAdmin(user.role === 'admin')
        if (user.role === 'admin') {
          fetchUsers()
        }
      } catch (e) {
        console.error('解析用户信息失败:', e)
      }
    }
  }, [])

  useEffect(() => {
    fetchEnterprises()
  }, [currentPage, selectedUserId, isAdmin, searchKeyword, pageSize, activeTab, dataAppName])

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/auth/users')
      if (response.data.success) {
        setUsers(response.data.data || [])
      }
    } catch (error) {
      console.error('获取用户列表失败:', error)
    }
  }

  const fetchEnterprises = async () => {
    setLoading(true)
    try {
      const user = getUser()
      let currentIsAdmin = isAdmin
      if (user) {
        try {
          currentIsAdmin = user.role === 'admin'
        } catch (e) {
          console.error('解析用户信息失败:', e)
        }
      }

      const params = {
        page: currentPage,
        pageSize,
        data_app_name: dataAppName,
      }
      if (currentIsAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }
      // 根据选中的tab添加企业类型筛选参数（项目挖掘被投企业页固定为被投企业）
      if (hideEntityTabs) {
        params.entity_type = '被投企业'
      } else if (activeTab === 'invested') {
        // 被投企业
        params.entity_type = '被投企业'
      } else if (activeTab === 'main_fund') {
        // 基金相关主体
        params.entity_type = '基金相关主体'
      } else if (activeTab === 'fund') {
        // 子基金
        params.entity_type = '子基金'
      } else if (activeTab === 'manager') {
        // 子基金管理人及GP（后端会处理为OR条件）
        params.entity_type = 'manager'
      }
      // activeTab === 'all' 时不传entity_type，显示所有数据
      
      const response = await axios.get('/api/enterprises', { params })
      if (response.data.success) {
        setEnterprises(response.data.data)
        setTotal(response.data.total)
        // 保存所有数据用于统计（如果需要）
        setAllEnterprises(response.data.data)
        setAllTotal(response.data.total)
      }
    } catch (error) {
      console.error('获取企业列表失败:', error)
      Message.error('获取企业列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingEnterprise(null)
    setShowForm(true)
  }

  const handleEdit = (enterprise) => {
    setEditingEnterprise(enterprise)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/enterprises/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchEnterprises()
          }
        } catch (error) {
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingEnterprise(null)
  }

  const handleFormSubmit = () => {
    fetchEnterprises()
    handleFormClose()
  }

  const buildEnterpriseListParams = useCallback(
    (page, ps) => {
      const params = {
        page,
        pageSize: ps,
        data_app_name: dataAppName,
        entity_type: '被投企业',
      }
      if (isAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }
      return params
    },
    [dataAppName, isAdmin, selectedUserId, searchKeyword]
  )

  const handleExportCurrentPageIe = useCallback(() => {
    if (!enterprises.length) {
      Message.warning('当前列表无数据可导出')
      return
    }
    const startSeq = (currentPage - 1) * pageSize
    const rows = buildInvestedEnterpriseExportRows(enterprises, startSeq)
    const sheet = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '被投企业')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const name = `被投企业列表_第${currentPage}页_${financingNow().format('YYYY-MM-DD_HHmmss')}.xlsx`
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), name)
    Message.success(`已导出 ${rows.length} 条`)
  }, [enterprises, currentPage, pageSize])

  const fetchAllAndExportIe = useCallback(async () => {
    setExportingAll(true)
    try {
      const paramsBase = buildEnterpriseListParams(1, IE_EXPORT_PAGE_SIZE)
      const first = await axios.get('/api/enterprises', { params: paramsBase })
      if (!first.data?.success) {
        Message.error(first.data?.message || '获取数据失败')
        return
      }
      const totalCount = Number(first.data.total || 0)
      if (totalCount === 0) {
        Message.warning('当前筛选条件下无数据可导出')
        return
      }
      const merged = [...(first.data.data || [])]
      const pages = Math.ceil(totalCount / IE_EXPORT_PAGE_SIZE)
      for (let p = 2; p <= pages; p++) {
        const res = await axios.get('/api/enterprises', {
          params: buildEnterpriseListParams(p, IE_EXPORT_PAGE_SIZE),
        })
        if (!res.data?.success) {
          Message.error(res.data?.message || `第 ${p} 页获取失败`)
          return
        }
        merged.push(...(res.data.data || []))
      }
      const rows = buildInvestedEnterpriseExportRows(merged, 0)
      const sheet = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, '被投企业')
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const name = `被投企业列表_全部${rows.length}条_${financingNow().format('YYYY-MM-DD_HHmmss')}.xlsx`
      saveAs(new Blob([buf], { type: 'application/octet-stream' }), name)
      Message.success(`已导出 ${rows.length} 条`)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    } finally {
      setExportingAll(false)
    }
  }, [buildEnterpriseListParams])

  const handleExportAllClickIe = useCallback(() => {
    Modal.confirm({
      title: '导出全部',
      content: (
        <div>
          <p>
            将按当前筛选条件（关键词、筛选用户）分页拉取全部「项目挖掘 ·
            被投企业」数据并导出为 Excel，列与融资事件侧客户端导出风格一致。
          </p>
          {total > 0 ? (
            <p style={{ marginTop: 8, color: 'var(--color-text-2)' }}>当前列表合计：{total} 条。</p>
          ) : null}
          <p style={{ marginTop: 8, color: 'var(--color-text-3)', fontSize: 12 }}>
            数据量大时会多次请求接口，请稍候。
          </p>
        </div>
      ),
      onOk: fetchAllAndExportIe,
    })
  }, [total, fetchAllAndExportIe])

  const handleBatchIeAiOk = async () => {
    try {
      const v = await batchIeAiForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择创建日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setBatchIeAiSubmitting(true)
      const res = await postInvestedEnterpriseBatchAiEnrich({ start_date: start, end_date: end })
      if (res.status === 202 && res.data?.success) {
        Message.success(res.data.message || '已加入队列')
        setBatchIeAiVisible(false)
        fetchEnterprises()
      } else if (res.data?.success) {
        Message.success(res.data.message || '已受理')
        setBatchIeAiVisible(false)
        fetchEnterprises()
      } else {
        Message.error(res.data?.message || '受理失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '受理失败')
    } finally {
      setBatchIeAiSubmitting(false)
    }
  }

  const handleRetryFailedIeAiOk = async () => {
    try {
      const v = await retryFailedIeAiForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择创建日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setRetryFailedIeAiSubmitting(true)
      const res = await postInvestedEnterpriseBatchAiEnrich({
        start_date: start,
        end_date: end,
        only_failed: true,
      })
      if (res.status === 202 && res.data?.success) {
        Message.success(res.data.message || '已加入失败重试队列')
        setRetryFailedIeAiVisible(false)
        fetchEnterprises()
      } else if (res.data?.success) {
        Message.success(res.data.message || '已受理')
        setRetryFailedIeAiVisible(false)
        fetchEnterprises()
      } else {
        Message.error(res.data?.message || '受理失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '受理失败')
    } finally {
      setRetryFailedIeAiSubmitting(false)
    }
  }

  const handleBatchIeBaikeOk = async () => {
    try {
      const v = await batchIeBaikeForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择创建日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setBatchIeBaikeSubmitting(true)
      const res = await postInvestedEnterpriseBatchBaikeLookup({ start_date: start, end_date: end })
      if (res.data?.success) {
        Message.success(res.data.message || '已受理百科批量查词，请稍后刷新列表')
        setBatchIeBaikeVisible(false)
        fetchEnterprises()
      } else {
        Message.error(res.data?.message || '查词失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '查词失败')
    } finally {
      setBatchIeBaikeSubmitting(false)
    }
  }

  const handleExport = async () => {
    try {
      const params = { data_app_name: dataAppName }
      if (isAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }

      const response = await axios.get('/api/enterprises/export', {
        params,
        responseType: 'blob'
      })

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      const contentDisposition = response.headers['content-disposition']
      let fileName = '被投企业数据.xlsx'
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = decodeURIComponent(fileNameMatch[1].replace(/['"]/g, ''))
        }
      }
      
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      Message.success('导出成功！')
    } catch (error) {
      console.error('导出失败：', error)
      if (error.response?.data) {
        const blob = error.response.data
        if (blob instanceof Blob) {
          blob.text().then(text => {
            try {
              const errorData = JSON.parse(text)
              Message.error('导出失败：' + (errorData.message || '未知错误'))
            } catch {
              Message.error('导出失败：服务器错误')
            }
          })
        } else {
          Message.error('导出失败：' + (error.response.data.message || '未知错误'))
        }
      } else {
        Message.error('导出失败：' + (error.message || '未知错误'))
      }
    }
  }

  const handleSearch = () => {
    setCurrentPage(1)
    fetchEnterprises()
  }

  const handleReset = () => {
    setSearchKeyword('')
    setSelectedUserId('')
    setCurrentPage(1)
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setCurrentPage(1) // 切换tab时重置到第一页
  }

  const runCompetitorFlowForEnterprise = useCallback(
    async (enterpriseId, displayName) => {
      const res = await fetchInvestedEnterpriseCompetitorReadiness(enterpriseId)
      if (!res.data?.success) {
        Message.error(res.data?.message || '就绪校验失败')
        return
      }
      const d = res.data.data || {}
      if (d.needSupplement) {
        setCompetitorSupplementModal({
          visible: true,
          enterpriseId,
          enterpriseName: displayName || '',
        })
        return
      }
      setLensModal({
        visible: true,
        loading: true,
        confirming: false,
        enterpriseId,
        enterpriseName: displayName || '',
        proposal: null,
      })
      try {
        const pRes = await fetchInvestedCompetitionLensProposal(enterpriseId)
        if (!pRes.data?.success) {
          throw new Error(pRes.data?.message || '提取对标因素失败')
        }
        setLensModal((prev) => ({
          ...prev,
          loading: false,
          proposal: pRes.data.data,
        }))
      } catch (e) {
        Message.error(e.response?.data?.message || e.message || '提取对标因素失败')
        setLensModal({
          visible: false,
          loading: false,
          confirming: false,
          enterpriseId: '',
          enterpriseName: '',
          proposal: null,
        })
      }
    },
    []
  )

  const handleInvestedLensConfirm = async (competitionLens) => {
    const { enterpriseId, enterpriseName } = lensModal
    if (!enterpriseId) return
    setLensModal((prev) => ({ ...prev, confirming: true }))
    try {
      const r2 = await postInvestedEnterpriseCompetitorAnalysisRun(enterpriseId, {
        competition_lens: competitionLens,
      })
      if (r2.status === 202 && r2.data?.success) {
        Message.success(r2.data.message || '已受理')
      } else if (r2.data?.success) {
        Message.success(r2.data.message || '已受理')
      } else {
        Message.error(r2.data?.message || '受理失败')
        setLensModal((prev) => ({ ...prev, confirming: false }))
        return
      }
      setLensModal({
        visible: false,
        loading: false,
        confirming: false,
        enterpriseId: '',
        enterpriseName: '',
        proposal: null,
      })
    } catch (e) {
      Message.error(
        e.response?.data?.message || e.message || `「${enterpriseName || enterpriseId}」受理失败`
      )
      setLensModal((prev) => ({ ...prev, confirming: false }))
    }
  }

  const handleCompetitorBatchClick = useCallback(async () => {
    if (!competitorSelectedKeys.length) {
      Message.warning('请先在表格左侧勾选至少一家被投企业')
      return
    }
    if (competitorSelectedKeys.length === 1) {
      const id = competitorSelectedKeys[0]
      const row = enterprises.find((e) => e.id === id)
      const name = row?.enterprise_full_name || row?.project_abbreviation || id
      await runCompetitorFlowForEnterprise(id, name)
      return
    }
    setCompetitorRunSubmitting(true)
    try {
      for (const id of competitorSelectedKeys) {
        const row = enterprises.find((e) => e.id === id)
        const name = row?.enterprise_full_name || row?.project_abbreviation || id
        const res = await fetchInvestedEnterpriseCompetitorReadiness(id)
        if (!res.data?.success) {
          Message.error(res.data?.message || `「${name}」就绪校验失败`)
          return
        }
        if (res.data.data?.needSupplement) {
          Message.warning(`「${name}」需先补充业务信息（已打开补录窗口）`)
          setCompetitorSupplementModal({ visible: true, enterpriseId: id, enterpriseName: name })
          return
        }
      }
      await new Promise((resolve) => {
        Modal.confirm({
          title: '竞品分析（批量）',
          content: `将对已勾选的 ${competitorSelectedKeys.length} 家企业依次发起竞品分析（按各企业系统默认对标焦点；精细勾选请每次只选 1 家）。是否继续？`,
          onOk: async () => {
            for (const id of competitorSelectedKeys) {
              const row = enterprises.find((e) => e.id === id)
              const name = row?.enterprise_full_name || id
              try {
                const r2 = await postInvestedEnterpriseCompetitorAnalysisRun(id)
                if (!r2.data?.success) {
                  Message.error(`「${name}」：${r2.data?.message || '失败'}`)
                  return
                }
              } catch (e) {
                Message.error(`「${name}」：${e.response?.data?.message || e.message || '失败'}`)
                return
              }
            }
            Message.success('批量任务已提交')
            resolve()
          },
          onCancel: () => resolve(),
        })
      })
    } finally {
      setCompetitorRunSubmitting(false)
    }
  }, [competitorSelectedKeys, enterprises, runCompetitorFlowForEnterprise])

  const columns = useMemo(() => {
    const indexCol = {
      title: '序号',
      width: 80,
      align: 'center',
      render: (_, record, index) => (currentPage - 1) * pageSize + index + 1
    }
    const actionCol = {
      title: '操作',
      width: showInvestedEnterpriseAi && isAdmin ? 340 : showValuationAction ? 280 : 220,
      fixed: showInvestedEnterpriseAi ? 'right' : undefined,
      align: 'left',
      render: (_, record) => (
        <Space size={8} wrap={false}>
          {showValuationAction ? (
            <Button
              type="primary"
              size="small"
              onClick={async () => {
                try {
                  const res = await openValuationCaseFromInvested(record.id)
                  if (res.data?.success) {
                    const cid = res.data.data.id
                    if (onValuationClick) onValuationClick(cid)
                    else navigate(`/dashboard/valuation/workbench/${cid}`)
                  } else {
                    Message.error(res.data?.message || '打开估值案件失败')
                  }
                } catch (e) {
                  Message.error(e.response?.data?.message || e.message || '打开估值案件失败')
                }
              }}
            >
              进行估值
            </Button>
          ) : null}
          {showInvestedEnterpriseAi && isAdmin ? (
            <Button
              type="outline"
              size="small"
              onClick={() =>
                runCompetitorFlowForEnterprise(
                  record.id,
                  record.enterprise_full_name || record.project_abbreviation
                )
              }
            >
              竞品
            </Button>
          ) : null}
          <Button
            type="outline"
            size="small"
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="outline"
            size="small"
            status="success"
            onClick={() => {
              setLogEnterpriseId(record.id)
              setShowLogModal(true)
            }}
          >
            日志
          </Button>
          <Button
            type="outline"
            size="small"
            status="danger"
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }

    if (dataAppName === DATA_APP_PROJECT) {
      const competitorSelectCol =
        showInvestedEnterpriseAi && isAdmin
          ? [
              {
                title: (
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Checkbox
                      checked={
                        enterprises.length > 0 &&
                        competitorSelectedKeys.length > 0 &&
                        enterprises.every((e) => competitorSelectedKeys.includes(e.id))
                      }
                      indeterminate={
                        competitorSelectedKeys.length > 0 &&
                        enterprises.some((e) => competitorSelectedKeys.includes(e.id)) &&
                        !enterprises.every((e) => competitorSelectedKeys.includes(e.id))
                      }
                      onChange={(checked) => {
                        if (checked) setCompetitorSelectedKeys(enterprises.map((e) => e.id))
                        else setCompetitorSelectedKeys([])
                      }}
                    />
                  </div>
                ),
                width: IE_ROW_SELECTION_WIDTH,
                fixed: 'left',
                align: 'center',
                headerCellStyle: { textAlign: 'center' },
                bodyCellStyle: { textAlign: 'center' },
                render: (_, record) => (
                  <Checkbox
                    checked={competitorSelectedKeys.includes(record.id)}
                    onChange={(c) => {
                      const checked = !!c
                      setCompetitorSelectedKeys((prev) => {
                        if (checked) return prev.includes(record.id) ? prev : [...prev, record.id]
                        return prev.filter((x) => x !== record.id)
                      })
                    }}
                  />
                ),
              },
            ]
          : []
      const base = [
        ...competitorSelectCol,
        {
          ...indexCol,
          width: 80,
          fixed: 'left',
        },
        {
          title: '项目编号',
          dataIndex: 'project_number',
          width: 140,
          fixed: 'left',
          ellipsis: true,
          tooltip: true,
        },
        {
          title: '企业类型',
          dataIndex: 'entity_type',
          width: 100,
          fixed: 'left',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-',
        },
        {
          title: '项目简称',
          dataIndex: 'project_abbreviation',
          width: 120,
          fixed: 'left',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-',
        },
        {
          title: '关联基金',
          dataIndex: 'fund',
          width: 140,
          fixed: 'left',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-',
        },
        {
          title: '被投企业全称',
          dataIndex: 'enterprise_full_name',
          width: 220,
          ellipsis: true,
          tooltip: true,
        },
      ]
      if (showInvestedEnterpriseAi) {
        base.push(
          {
            title: '产品简介(AI)',
            dataIndex: 'ai_product_intro',
            width: 200,
            render: (_, row) => (
              <IntroPopoverCell
                columnTitle="产品简介(AI)"
                raw={row.ai_product_intro}
                triggerMaxWidth={200}
              />
            ),
          },
          {
            title: '企业标签(AI)',
            dataIndex: 'ai_industry_tags_display',
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
            width: 200,
            render: (_, row) => (
              <IntroPopoverCell
                columnTitle="企业介绍（企查查）"
                raw={row.qcc_company_intro}
                triggerMaxWidth={200}
              />
            ),
          },
          {
            title: '企查查来源',
            dataIndex: 'qcc_sync_via',
            width: 112,
            align: 'center',
            render: (v) => formatQccSyncViaLabel(v),
          },
          {
            title: '企查查同步时间',
            dataIndex: 'qcc_sync_at',
            width: 172,
            render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
          }
        )
      }
      base.push(
        buildIeNumericColumn('投资成本', 'investment_cost', 120, (_, record) =>
          formatTableAmount(pickAmountField(record, 'investment_cost'))
        ),
        buildIeNumericColumn('已退出成本', 'exited_cost', 120, (_, record) =>
          formatTableAmount(pickAmountField(record, 'exited_cost'))
        ),
        buildIeNumericColumn('剩余成本', 'remaining_cost', 120, (_, record) =>
          formatTableAmount(pickAmountField(record, 'remaining_cost'))
        ),
        buildIeNumericColumn('剩余价值', 'residual_value', 120, (_, record) =>
          formatTableAmount(pickAmountField(record, 'residual_value'))
        ),
        {
          title: '退出状态',
          dataIndex: 'exit_status',
          width: 100,
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-',
        }
      )
      if (showInvestedEnterpriseAi) {
        base.push({
          title: 'AI状态',
          dataIndex: 'ai_enrich_status',
          width: 96,
          render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
        })
      }
      base.push(actionCol)
      return base
    }

    const vw = (n) => (showValuationAction ? n : undefined)
    const cols = [
      { ...indexCol, width: showValuationAction ? 64 : indexCol.width },
      {
        title: '项目编号',
        dataIndex: 'project_number',
        width: vw(140),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-',
      },
      {
        title: '企业类型',
        dataIndex: 'entity_type',
        width: vw(100),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '项目简称',
        dataIndex: 'project_abbreviation',
        width: vw(120),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '关联基金',
        dataIndex: 'fund',
        width: vw(140),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
    ]
    if (!showValuationAction) {
      cols.push({
        title: '关联子基金',
        dataIndex: 'sub_fund',
        width: vw(140),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      })
    }
    cols.push(
      {
        title: showValuationAction ? '企业名称' : '被投企业全称',
        dataIndex: 'enterprise_full_name',
        width: vw(200),
        ellipsis: true,
        tooltip: true
      },
      {
        title: '统一信用代码',
        dataIndex: 'unified_credit_code',
        width: vw(170),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      }
    )
    if (!showValuationAction) {
      cols.push(
        {
          title: '企业公众号id',
          dataIndex: 'wechat_official_account_id',
          width: vw(140),
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-'
        },
        {
          title: '企业官网',
          dataIndex: 'official_website',
          width: vw(180),
          ellipsis: true,
          tooltip: true,
          render: (text) => text ? (
            <a href={text} target="_blank" rel="noopener noreferrer">
              {text}
            </a>
          ) : '-'
        }
      )
    }
    cols.push(
      {
        title: '退出状态',
        dataIndex: 'exit_status',
        width: vw(100),
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      actionCol
    )
    return cols
  }, [
    dataAppName,
    currentPage,
    pageSize,
    showInvestedEnterpriseAi,
    showValuationAction,
    isAdmin,
    enterprises,
    competitorSelectedKeys,
    runCompetitorFlowForEnterprise,
    onValuationClick,
    navigate,
  ])

  const investedEnterpriseTableScrollX = useMemo(() => {
    if (!showInvestedEnterpriseAi && !showValuationAction) return 'max-content'
    return columns.reduce((sum, col) => sum + (Number(col.width) || 0), 0)
  }, [columns, showInvestedEnterpriseAi, showValuationAction])

  return (
    <div
      className={`enterprise-management${showInvestedEnterpriseAi && viewportBoundTable ? ' invested-enterprises-table-page' : ''}${showValuationAction ? ' valuation-invested-page' : ''}`}
      style={
        viewportBoundTable
          ? {
              boxSizing: 'border-box',
              height: 'calc(100vh - 72px)',
              padding: '16px 24px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            }
          : undefined
      }
    >
      <Card
        className="management-card"
        bordered={false}
        style={
          viewportBoundTable
            ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
            : undefined
        }
        bodyStyle={
          viewportBoundTable
            ? {
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }
            : undefined
        }
      >
        <div className="management-header">
          <h2 className="management-title">{pageTitle}</h2>
          <Space wrap>
            <Button onClick={fetchEnterprises} loading={loading}>
              刷新
            </Button>
            <Button type="outline" onClick={() => setShowBatchModal(true)}>
              批量导入
            </Button>
            <Button type="outline" onClick={() => setShowSyncModal(true)}>
              定时更新
            </Button>
            {showInvestedEnterpriseAi ? (
              <>
                <Button
                  type="outline"
                  onClick={handleExportCurrentPageIe}
                  disabled={loading || exportingAll || !enterprises.length}
                >
                  导出当前页
                </Button>
                <Button
                  type="outline"
                  loading={exportingAll}
                  onClick={handleExportAllClickIe}
                  disabled={loading || exportingAll}
                >
                  导出全部
                </Button>
                {isAdmin && (
                  <Button
                    type="outline"
                    loading={qccBriefSubmitting}
                    disabled={!competitorSelectedKeys.length}
                    onClick={() => {
                      if (!competitorSelectedKeys.length) {
                        Message.warning('请先在表格左侧勾选至少一家被投企业')
                        return
                      }
                      const ids = competitorSelectedKeys.map(String).filter(Boolean).slice(0, 80)
                      if (competitorSelectedKeys.length > 80) {
                        Message.warning('单次最多同步 80 条，已自动截取前 80 条')
                      }
                      Modal.confirm({
                        title: '企查查同步（已勾选）',
                        content: (
                          <div>
                            <p>
                              将对已勾选的 <strong>{ids.length}</strong> 家被投企业批量同步企查查「企业简介」并写库；统一社会信用代码有效时与底层项目、投前项目三表对齐、按代码去重调用。每条间隔约
                              400ms，请确认已配置企查查「企业信息」接口。
                            </p>
                          </div>
                        ),
                        onOk: async () => {
                          setQccBriefSubmitting(true)
                          try {
                            const res = await postInvestedEnterpriseBatchQccCompanyBrief({
                              enterprise_ids: ids,
                            })
                            if (res.data?.success) {
                              const d = res.data.data || {}
                              const hint = summarizeInvestedEnterpriseQccBatchResults(d.results)
                              Message.success(
                                (res.data.message ||
                                  `完成：成功 ${d.success ?? 0}，失败 ${d.failed ?? 0}`) + hint
                              )
                              fetchEnterprises()
                            } else {
                              Message.error(res.data?.message || '同步失败')
                            }
                          } catch (e) {
                            Message.error(e.response?.data?.message || e.message || '同步失败')
                          } finally {
                            setQccBriefSubmitting(false)
                          }
                        },
                      })
                    }}
                  >
                    企查查同步
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    loading={competitorRunSubmitting}
                    disabled={!competitorSelectedKeys.length}
                    onClick={handleCompetitorBatchClick}
                  >
                    竞品分析（多选）
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    disabled={!competitorSelectedKeys.length}
                    loading={ieAiLogLoading}
                    onClick={async () => {
                      if (!competitorSelectedKeys.length) {
                        Message.warning('请先勾选被投企业')
                        return
                      }
                      const ids = competitorSelectedKeys.map((k) => String(k)).filter(Boolean)
                      setIeAiLogEnterpriseId(ids.join(','))
                      setIeAiLogVisible(true)
                      setIeAiLogLoading(true)
                      try {
                        const res = await fetchInvestedEnterpriseAiEnrichLogs({
                          invested_enterprise_id: ids.join(','),
                          page: 1,
                          pageSize: 200,
                        })
                        if (res.data?.success) {
                          setIeAiLogRows(res.data.data?.list || [])
                        } else {
                          setIeAiLogRows([])
                          Message.error(res.data?.message || '加载日志失败')
                        }
                      } catch (e) {
                        setIeAiLogRows([])
                        Message.error(e.response?.data?.message || e.message || '加载日志失败')
                      } finally {
                        setIeAiLogLoading(false)
                      }
                    }}
                  >
                    AI执行日志
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    status="success"
                    onClick={() => {
                      batchIeAiForm.setFieldsValue({
                        date_range: [financingNow().subtract(7, 'day'), financingNow()],
                      })
                      setBatchIeAiVisible(true)
                    }}
                  >
                    批量AI取数
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    status="danger"
                    loading={retryFailedIeAiSubmitting}
                    onClick={() => {
                      retryFailedIeAiForm.setFieldsValue({
                        date_range: [financingNow().subtract(7, 'day'), financingNow()],
                      })
                      setRetryFailedIeAiVisible(true)
                    }}
                  >
                    重试失败AI
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    status="success"
                    onClick={() => setBatchIeBaikeVisible(true)}
                  >
                    批量百科查词
                  </Button>
                )}
              </>
            ) : (
              <Button type="outline" onClick={handleExport}>
                导出
              </Button>
            )}
            <Button type="primary" onClick={handleAdd}>
              新增
            </Button>
          </Space>
        </div>

        {/* Tab页签（项目挖掘被投企业页不展示多类型 Tab，仅被投企业） */}
        {!hideEntityTabs && (
        <Tabs
          activeTab={activeTab}
          onChange={handleTabChange}
          type="line"
          className="entity-type-tabs"
          style={{ marginBottom: 16 }}
        >
          <TabPane key="all" title="全部" />
          <TabPane key="invested" title="被投企业" />
          <TabPane key="main_fund" title="基金相关主体" />
          <TabPane key="fund" title="子基金" />
          <TabPane key="manager" title="子基金管理人及GP" />
        </Tabs>
        )}

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
                  <InputSearch
                    value={searchKeyword}
                    onChange={(value) => setSearchKeyword(value)}
                    placeholder={
                      showInvestedEnterpriseAi
                        ? '搜索项目编号、简称、企业全称、退出状态、产品简介(AI)、企业标签(AI)、企查查企业介绍…'
                        : dataAppName === DATA_APP_PROJECT
                          ? '搜索项目编号、简称、企业全称、退出状态…'
                          : '搜索项目编号、简称、企业全称、统一信用代码、公众号ID、官网、退出状态…'
                    }
                    style={{ width: 400 }}
                    allowClear
                    onSearch={handleSearch}
                  />
                </div>
                {isAdmin && (
                  <div className="filter-item">
                    <label>筛选用户</label>
                    <Select
                      value={selectedUserId}
                      onChange={(value) => {
                        setSelectedUserId(value)
                        setCurrentPage(1)
                      }}
                      placeholder="全部用户"
                      style={{ width: 200 }}
                      allowClear
                    >
                      {users.map(user => (
                        <Option key={user.id} value={user.id}>
                          {user.account}
                        </Option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="filter-actions">
                  <Button type="primary" onClick={handleSearch}>
                    查询
                  </Button>
                  <Button type="outline" onClick={handleReset}>
                    重置
                  </Button>
                </div>
              </div>
            </div>
          </CollapseItem>
        </Collapse>

        <div
          ref={viewportBoundTable ? tableScrollAreaRef : undefined}
          style={
            viewportBoundTable
              ? {
                  flex: 1,
                  minHeight: 0,
                  marginTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }
              : undefined
          }
        >
          <div
            className={`table-container${
              showInvestedEnterpriseAi && !viewportBoundTable ? ' invested-enterprises-horizontal-scroll' : ''
            }${showInvestedEnterpriseAi && viewportBoundTable ? ' invested-enterprises-table-container' : ''}`}
            style={
              viewportBoundTable
                ? {
                    flex: 1,
                    minHeight: 0,
                    overflow: 'hidden',
                    marginBottom: 0,
                  }
                : undefined
            }
          >
          {loading && enterprises.length === 0 ? (
            <Skeleton
              loading={true}
              animation={true}
              text={{ rows: 8, width: ['100%'] }}
            />
          ) : (
            <Table
              columns={columns}
              data={enterprises}
              loading={loading}
              pagination={false}
              rowKey="id"
              className={showValuationAction ? 'valuation-list-table' : undefined}
              border={{
                wrapper: true,
                cell: true
              }}
              stripe
              scroll={{
                x: investedEnterpriseTableScrollX,
                ...(viewportBoundTable ? { y: tableScrollY } : {}),
              }}
            />
          )}
          </div>
        </div>

        <div className="pagination-wrapper">
          <div className="page-size-selector">
            <span className="page-size-label">每页显示：</span>
            <Select
              value={pageSize}
              onChange={(value) => {
                setPageSize(value)
                setCurrentPage(1)
              }}
              style={{ width: 100 }}
            >
              <Option value={10}>10</Option>
              <Option value={20}>20</Option>
              <Option value={50}>50</Option>
              <Option value={100}>100</Option>
            </Select>
            <span className="page-size-unit">条</span>
          </div>
          <Pagination
            current={currentPage}
            total={total}
            pageSize={pageSize}
            onChange={(page) => setCurrentPage(page)}
            showTotal
            showJumper
          />
        </div>
      </Card>

      {showForm && (
        <EnterpriseForm
          enterprise={editingEnterprise}
          dataAppName={dataAppName}
          competitorInvestedForm={showInvestedEnterpriseAi}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
        />
      )}

      {showBatchModal && (
        <BatchImportModal
          dataAppName={dataAppName}
          onClose={() => setShowBatchModal(false)}
          onSuccess={() => {
            fetchEnterprises()
            setShowBatchModal(false)
          }}
        />
      )}

      {showLogModal && (
        <LogModal
          type="enterprise"
          id={logEnterpriseId}
          onClose={() => {
            setShowLogModal(false)
            setLogEnterpriseId(null)
          }}
        />
      )}

      <CompetitorMatchSupplementModal
        visible={competitorSupplementModal.visible}
        investedEnterpriseId={competitorSupplementModal.enterpriseId}
        enterpriseName={competitorSupplementModal.enterpriseName}
        onClose={() => setCompetitorSupplementModal((s) => ({ ...s, visible: false }))}
        onSaved={() => {
          fetchEnterprises()
          setCompetitorSupplementModal((s) => ({ ...s, visible: false }))
        }}
      />

      <CompetitionLensConfirmModal
        visible={lensModal.visible}
        onClose={() =>
          setLensModal({
            visible: false,
            loading: false,
            confirming: false,
            enterpriseId: '',
            enterpriseName: '',
            proposal: null,
          })
        }
        subjectTitle={lensModal.enterpriseName}
        loadingProposal={lensModal.loading}
        proposal={lensModal.proposal}
        confirming={lensModal.confirming}
        onConfirm={handleInvestedLensConfirm}
      />

      {showInvestedEnterpriseAi && (
        <>
          <Modal
            title={`AI 增强执行日志（已选 ${ieAiLogEnterpriseId ? ieAiLogEnterpriseId.split(',').length : 0} 条被投企业，按时间降序）`}
            visible={ieAiLogVisible}
            footer={null}
            onCancel={() => setIeAiLogVisible(false)}
            style={{ width: 1060 }}
            unmountOnExit
          >
            <p style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
              成功任务展示「产品简介」「企业标签」快照及「联网状态」；失败任务显示错误摘要。大模型提示词与融资事件联网 AI 一致。
            </p>
            <Table
              rowKey="id"
              loading={ieAiLogLoading}
              data={ieAiLogRows}
              stripe
              border
              scroll={{ x: 1060, y: 420 }}
              columns={[
                {
                  title: '被投企业ID',
                  dataIndex: 'invested_enterprise_id',
                  width: 120,
                },
                {
                  title: '触发时间',
                  dataIndex: 'triggered_at',
                  width: 168,
                  render: formatFinancingDateTime,
                },
                { title: '状态', dataIndex: 'execution_status', width: 88 },
                {
                  title: '联网状态',
                  dataIndex: 'search_status_label',
                  width: 168,
                  render: (v) => v || '—',
                },
                { title: '耗时(ms)', dataIndex: 'duration_ms', width: 88 },
                {
                  title: '产品简介(结果)',
                  dataIndex: 'result_product_intro',
                  width: 220,
                  render: (v) => (
                    <IntroPopoverCell columnTitle="产品简介(AI)（日志快照）" raw={v} />
                  ),
                },
                {
                  title: '企业标签(结果)',
                  dataIndex: 'result_industry_tags_display',
                  width: 160,
                  render: (v) => (
                    <IntroPopoverCell columnTitle="企业标签(AI)（日志快照）" raw={v} />
                  ),
                },
                {
                  title: '失败原因',
                  dataIndex: 'error_message',
                  width: 180,
                  ellipsis: true,
                  render: (v) =>
                    v == null || String(v).trim() === '' ? (
                      '-'
                    ) : (
                      <IntroPopoverCell columnTitle="失败原因" raw={v} />
                    ),
                },
                { title: '触发方式', dataIndex: 'trigger_type', width: 100 },
              ]}
              pagination={false}
            />
          </Modal>

          <Modal
            title="重试失败 AI（仅 failed）"
            visible={retryFailedIeAiVisible}
            onOk={handleRetryFailedIeAiOk}
            confirmLoading={retryFailedIeAiSubmitting}
            onCancel={() => setRetryFailedIeAiVisible(false)}
            style={{ width: 520 }}
            okText="加入重试队列"
          >
            <Form form={retryFailedIeAiForm} layout="vertical">
              <FormItem
                label="创建日期范围（含首尾两天，仅筛选 ai_enrich_status = failed 的 invested_enterprises）"
                field="date_range"
                rules={[{ required: true, message: '请选择日期范围' }]}
              >
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </FormItem>
            </Form>
            <p style={{ color: 'var(--color-text-3)', fontSize: 12, marginTop: 8 }}>
              仅对区间内创建且 AI 状态为 failed 的被投企业重新排队；去重规则与「批量AI取数」一致（按企业全称）。
            </p>
          </Modal>

          <Modal
            title="批量 AI 取数（按创建日期）"
            visible={batchIeAiVisible}
            onOk={handleBatchIeAiOk}
            confirmLoading={batchIeAiSubmitting}
            onCancel={() => setBatchIeAiVisible(false)}
            style={{ width: 520 }}
            okText="加入队列"
          >
            <Form form={batchIeAiForm} layout="vertical">
              <FormItem
                label="创建日期范围（含首尾两天，筛选 invested_enterprises.created_at 的日历日）"
                field="date_range"
                rules={[{ required: true, message: '请选择日期范围' }]}
              >
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </FormItem>
            </Form>
            <p style={{ color: 'var(--color-text-3)', fontSize: 12, marginTop: 8 }}>
              与融资事件使用同一套联网大模型提示词与模型配置；任务以<strong>被投企业全称</strong>为主键参与去重与模板填充。
            </p>
          </Modal>

          <Modal
            title="批量百科查词（按创建日期）"
            visible={batchIeBaikeVisible}
            onOk={handleBatchIeBaikeOk}
            confirmLoading={batchIeBaikeSubmitting}
            onCancel={() => setBatchIeBaikeVisible(false)}
            style={{ width: 520 }}
            okText="开始查词"
          >
            <Form form={batchIeBaikeForm} layout="vertical">
              <FormItem
                label="创建日期范围（含首尾两天，仅筛选 qcc_company_intro 为空的被投企业）"
                field="date_range"
                rules={[{ required: true, message: '请选择日期范围' }]}
              >
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </FormItem>
            </Form>
            <p style={{ color: 'var(--color-text-3)', fontSize: 12, marginTop: 8 }}>
              对区间内创建且尚未查词的被投企业，后台批量查询百度百科（HTTP + Playwright）。单次上限 200 条；请稍后刷新列表，进度见服务器日志。
            </p>
          </Modal>
        </>
      )}

      {showSyncModal && (
        <EnterpriseSyncModal
          dataAppName={dataAppName}
          onClose={() => setShowSyncModal(false)}
          onSuccess={() => {
            fetchEnterprises()
          }}
        />
      )}
    </div>
  )
}

export default EnterpriseManagement

