import React, { useState, useEffect, useMemo, useCallback } from 'react'
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
} from '@arco-design/web-react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import axios from '../utils/axios'
import EnterpriseForm from './EnterpriseForm'
import BatchImportModal from './BatchImportModal'
import LogModal from './LogModal'
import EnterpriseSyncModal from './EnterpriseSyncModal'
import {
  postFinancingSync,
  postInvestedEnterpriseAiEnrich,
  postInvestedEnterpriseBatchAiEnrich,
  fetchInvestedEnterpriseAiEnrichLogs,
  postInvestedEnterpriseQccCompanyBrief,
  postInvestedEnterpriseBatchQccCompanyBrief,
} from '../api/项目挖掘'
import { FINANCING_INTERFACE_TYPE, PROJECT_SOURCING_APP_NAME } from './项目挖掘/financingConstants'
import { formatFinancingYmd, financingNow, formatFinancingDateTime } from './项目挖掘/financingDateUtils'
import { IntroPopoverCell } from './项目挖掘/introPopoverAiCell'
import './EnterpriseManagement.css'

const Option = Select.Option
const InputSearch = Input.Search
const CollapseItem = Collapse.Item
const TabPane = Tabs.TabPane
const FormItem = Form.Item

const DATA_APP_NEWS = '新闻舆情'
const DATA_APP_PROJECT = '项目挖掘'

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

/** 与后端项目挖掘导出列一致（客户端 XLSX） */
function buildInvestedEnterpriseExportRows(list, startSeq = 0) {
  return list.map((row, i) => ({
    序号: startSeq + i + 1,
    项目编号: row.project_number ?? '',
    企业类型: row.entity_type ?? '',
    项目简称: row.project_abbreviation ?? '',
    关联基金: row.fund ?? '',
    被投企业全称: row.enterprise_full_name ?? '',
    投资成本: formatExportMoneyPlain(pickAmountField(row, 'investment_cost')),
    已退出成本: formatExportMoneyPlain(pickAmountField(row, 'exited_cost')),
    剩余成本: formatExportMoneyPlain(pickAmountField(row, 'remaining_cost')),
    剩余价值: formatExportMoneyPlain(pickAmountField(row, 'residual_value')),
    退出状态: row.exit_status || '未退出',
    '产品简介(AI)': row.ai_product_intro ?? '',
    '企业标签(AI)': row.ai_industry_tags_display ?? '',
    AI状态: row.ai_enrich_status ?? '',
    '企业介绍（企查查）': row.qcc_company_intro ?? '',
    创建时间: row.created_at ? new Date(row.created_at) : null,
    更新时间: row.updated_at ? new Date(row.updated_at) : null,
  }))
}

const IE_EXPORT_PAGE_SIZE = 200

function EnterpriseManagement({
  dataAppName = DATA_APP_NEWS,
  pageTitle = '舆情监控对象',
  hideEntityTabs = false,
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

  const [exportingAll, setExportingAll] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [aiEnrichSubmitting, setAiEnrichSubmitting] = useState(false)
  const [ieAiLogVisible, setIeAiLogVisible] = useState(false)
  const [ieAiLogLoading, setIeAiLogLoading] = useState(false)
  const [ieAiLogRows, setIeAiLogRows] = useState([])
  const [ieAiLogEnterpriseId, setIeAiLogEnterpriseId] = useState('')
  const [batchIeAiVisible, setBatchIeAiVisible] = useState(false)
  const [batchIeAiSubmitting, setBatchIeAiSubmitting] = useState(false)
  const [retryFailedIeAiVisible, setRetryFailedIeAiVisible] = useState(false)
  const [retryFailedIeAiSubmitting, setRetryFailedIeAiSubmitting] = useState(false)
  const [qccBriefSubmitting, setQccBriefSubmitting] = useState(false)
  const [qccBriefPageSubmitting, setQccBriefPageSubmitting] = useState(false)
  const [financingSyncVisible, setFinancingSyncVisible] = useState(false)
  const [financingSyncSubmitting, setFinancingSyncSubmitting] = useState(false)
  const [financingConfigs, setFinancingConfigs] = useState([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [financingSyncForm] = Form.useForm()
  const [batchIeAiForm] = Form.useForm()
  const [retryFailedIeAiForm] = Form.useForm()

  useEffect(() => {
    if (hideEntityTabs) {
      setActiveTab('invested')
    }
  }, [hideEntityTabs])

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      try {
        const user = JSON.parse(userData)
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
      const userData = localStorage.getItem('user')
      let currentIsAdmin = isAdmin
      if (userData) {
        try {
          const user = JSON.parse(userData)
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

  const loadConfigsForFinancingSync = useCallback(async () => {
    setConfigsLoading(true)
    try {
      const appsRes = await axios.get('/api/system/applications')
      if (!appsRes.data?.success) {
        setFinancingConfigs([])
        return
      }
      const apps = appsRes.data.data || []
      const ps = apps.find((a) => a.app_name === PROJECT_SOURCING_APP_NAME)
      if (!ps?.id) {
        setFinancingConfigs([])
        return
      }
      const cfgRes = await axios.get('/api/system/news-configs', {
        params: { page: 1, pageSize: 100, app_id: ps.id },
      })
      if (!cfgRes.data?.success) {
        setFinancingConfigs([])
        return
      }
      const list = (cfgRes.data.data || []).filter((c) => c.interface_type === FINANCING_INTERFACE_TYPE)
      setFinancingConfigs(list)
      if (list.length === 1) {
        financingSyncForm.setFieldsValue({ config_id: list[0].id })
      }
    } catch (e) {
      console.error(e)
      setFinancingConfigs([])
    } finally {
      setConfigsLoading(false)
    }
  }, [financingSyncForm])

  useEffect(() => {
    if (financingSyncVisible && isAdmin && showInvestedEnterpriseAi) {
      loadConfigsForFinancingSync()
    }
  }, [financingSyncVisible, isAdmin, showInvestedEnterpriseAi, loadConfigsForFinancingSync])

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

  const handleFinancingSyncOk = async () => {
    try {
      const v = await financingSyncForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择同步日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setFinancingSyncSubmitting(true)
      const res = await postFinancingSync({
        config_id: v.config_id,
        start_date: start,
        end_date: end,
      })
      if (res.data?.success) {
        Message.success(res.data.message || '同步完成')
        setFinancingSyncVisible(false)
        fetchEnterprises()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '同步失败')
    } finally {
      setFinancingSyncSubmitting(false)
    }
  }

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

  const columns = useMemo(() => {
    const indexCol = {
      title: '序号',
      width: 80,
      align: 'center',
      render: (_, record, index) => (currentPage - 1) * pageSize + index + 1
    }
    const actionCol = {
      title: '操作',
      width: 220,
      align: 'left',
      render: (_, record) => (
        <Space size={8}>
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
      const base = [
        indexCol,
        {
          title: '项目编号',
          dataIndex: 'project_number',
          ellipsis: true,
          tooltip: true
        },
        {
          title: '企业类型',
          dataIndex: 'entity_type',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-'
        },
        {
          title: '项目简称',
          dataIndex: 'project_abbreviation',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-'
        },
        {
          title: '关联基金',
          dataIndex: 'fund',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-'
        },
        {
          title: '被投企业全称',
          dataIndex: 'enterprise_full_name',
          ellipsis: true,
          tooltip: true
        },
        {
          title: '投资成本',
          dataIndex: 'investment_cost',
          ellipsis: true,
          tooltip: true,
          render: (_, record) => formatTableAmount(pickAmountField(record, 'investment_cost'))
        },
        {
          title: '已退出成本',
          dataIndex: 'exited_cost',
          ellipsis: true,
          tooltip: true,
          render: (_, record) => formatTableAmount(pickAmountField(record, 'exited_cost'))
        },
        {
          title: '剩余成本',
          dataIndex: 'remaining_cost',
          ellipsis: true,
          tooltip: true,
          render: (_, record) => formatTableAmount(pickAmountField(record, 'remaining_cost'))
        },
        {
          title: '剩余价值',
          dataIndex: 'residual_value',
          ellipsis: true,
          tooltip: true,
          render: (_, record) => formatTableAmount(pickAmountField(record, 'residual_value'))
        },
        {
          title: '退出状态',
          dataIndex: 'exit_status',
          ellipsis: true,
          tooltip: true,
          render: (text) => text || '-'
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
            title: 'AI状态',
            dataIndex: 'ai_enrich_status',
            width: 96,
            render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
          }
        )
      }
      base.push(actionCol)
      return base
    }

    return [
      indexCol,
      {
        title: '项目编号',
        dataIndex: 'project_number',
        ellipsis: true,
        tooltip: true
      },
      {
        title: '企业类型',
        dataIndex: 'entity_type',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '项目简称',
        dataIndex: 'project_abbreviation',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '关联基金',
        dataIndex: 'fund',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '关联子基金',
        dataIndex: 'sub_fund',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '被投企业全称',
        dataIndex: 'enterprise_full_name',
        ellipsis: true,
        tooltip: true
      },
      {
        title: '统一信用代码',
        dataIndex: 'unified_credit_code',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '企业公众号id',
        dataIndex: 'wechat_official_account_id',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      {
        title: '企业官网',
        dataIndex: 'official_website',
        ellipsis: true,
        tooltip: true,
        render: (text) => text ? (
          <a href={text} target="_blank" rel="noopener noreferrer">
            {text}
          </a>
        ) : '-'
      },
      {
        title: '退出状态',
        dataIndex: 'exit_status',
        ellipsis: true,
        tooltip: true,
        render: (text) => text || '-'
      },
      actionCol
    ]
  }, [dataAppName, currentPage, pageSize, showInvestedEnterpriseAi])

  return (
    <div className="enterprise-management">
      <Card className="management-card" bordered={false}>
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
                    status="warning"
                    onClick={() => {
                      financingSyncForm.setFieldsValue({
                        date_range: [financingNow().subtract(1, 'day'), financingNow()],
                      })
                      setFinancingSyncVisible(true)
                    }}
                  >
                    手动同步
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    loading={aiEnrichSubmitting}
                    disabled={!selectedRowKeys.length}
                    onClick={async () => {
                      const id = selectedRowKeys[0]
                      if (!id) {
                        Message.warning('请先勾选一行被投企业')
                        return
                      }
                      setAiEnrichSubmitting(true)
                      try {
                        const res = await postInvestedEnterpriseAiEnrich(id)
                        if (res.status === 202 && res.data?.success) {
                          Message.success(res.data.message || '已受理 AI 取数，请稍后刷新查看')
                          fetchEnterprises()
                        } else if (res.data?.success) {
                          Message.success(res.data.message || '已受理')
                          fetchEnterprises()
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
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    loading={qccBriefSubmitting}
                    disabled={!selectedRowKeys.length}
                    onClick={async () => {
                      const id = selectedRowKeys[0]
                      if (!id) {
                        Message.warning('请先勾选一行被投企业')
                        return
                      }
                      setQccBriefSubmitting(true)
                      try {
                        const res = await postInvestedEnterpriseQccCompanyBrief(id)
                        if (res.data?.success) {
                          Message.success(res.data.message || '企查查同步完成')
                          fetchEnterprises()
                        } else {
                          Message.error(res.data?.message || '同步失败')
                        }
                      } catch (e) {
                        Message.error(e.response?.data?.message || e.message || '同步失败')
                      } finally {
                        setQccBriefSubmitting(false)
                      }
                    }}
                  >
                    企查查同步
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    loading={qccBriefPageSubmitting}
                    disabled={!enterprises.length}
                    onClick={() => {
                      Modal.confirm({
                        title: '企查查同步当前页',
                        content: (
                          <div>
                            <p>
                              将对当前页最多 {Math.min(enterprises.length, 80)} 条被投企业顺序调用企查查「企业简介」接口并写库，每条间隔约
                              400ms，整页可能需数十秒～数分钟；请确认已配置企查查「企业信息」接口且账号有剩余额度。
                            </p>
                          </div>
                        ),
                        onOk: async () => {
                          const ids = enterprises.map((r) => r.id).filter(Boolean).slice(0, 80)
                          setQccBriefPageSubmitting(true)
                          try {
                            const res = await postInvestedEnterpriseBatchQccCompanyBrief({
                              enterprise_ids: ids,
                            })
                            if (res.data?.success) {
                              const d = res.data.data || {}
                              Message.success(
                                res.data.message ||
                                  `完成：成功 ${d.success ?? 0}，失败 ${d.failed ?? 0}`
                              )
                              fetchEnterprises()
                            } else {
                              Message.error(res.data?.message || '批量同步失败')
                            }
                          } catch (e) {
                            Message.error(e.response?.data?.message || e.message || '批量同步失败')
                          } finally {
                            setQccBriefPageSubmitting(false)
                          }
                        },
                      })
                    }}
                  >
                    企查查同步当前页
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="outline"
                    disabled={!selectedRowKeys.length}
                    loading={ieAiLogLoading}
                    onClick={async () => {
                      const id = selectedRowKeys[0]
                      if (!id) {
                        Message.warning('请先勾选一行被投企业')
                        return
                      }
                      setIeAiLogEnterpriseId(String(id))
                      setIeAiLogVisible(true)
                      setIeAiLogLoading(true)
                      try {
                        const res = await fetchInvestedEnterpriseAiEnrichLogs({
                          invested_enterprise_id: id,
                          page: 1,
                          pageSize: 50,
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
          onChange={(keys) => setFilterCollapsed(keys.length === 0)}
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

        <div className="table-container">
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
              rowSelection={
                showInvestedEnterpriseAi && isAdmin
                  ? {
                      type: 'radio',
                      selectedRowKeys,
                      onChange: (keys) => setSelectedRowKeys(keys),
                    }
                  : undefined
              }
              border={{
                wrapper: true,
                cell: true
              }}
              stripe
              scroll={{
                x: showInvestedEnterpriseAi ? 2480 : 'max-content'
              }}
            />
          )}
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

      {showInvestedEnterpriseAi && (
        <>
          <Modal
            title={`AI 增强执行日志（被投企业 id=${ieAiLogEnterpriseId || '—'}）`}
            visible={ieAiLogVisible}
            footer={null}
            onCancel={() => setIeAiLogVisible(false)}
            style={{ width: 960 }}
            unmountOnExit
          >
            <p style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
              成功任务展示「产品简介」「企业标签」快照；失败任务显示错误摘要。大模型提示词与配置与融资事件联网 AI 一致，按被投企业全称（及模板内信用代码、项目简称占位）执行。
            </p>
            <Table
              rowKey="id"
              loading={ieAiLogLoading}
              data={ieAiLogRows}
              stripe
              border
              scroll={{ x: 900, y: 420 }}
              columns={[
                {
                  title: '触发时间',
                  dataIndex: 'triggered_at',
                  width: 168,
                  render: formatFinancingDateTime,
                },
                { title: '状态', dataIndex: 'execution_status', width: 88 },
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
            title="投融资数据同步（queryByDate）"
            visible={financingSyncVisible}
            onOk={handleFinancingSyncOk}
            confirmLoading={financingSyncSubmitting}
            onCancel={() => setFinancingSyncVisible(false)}
            style={{ width: 520 }}
          >
            <Form form={financingSyncForm} layout="vertical">
              <FormItem
                label="接口配置"
                field="config_id"
                rules={[{ required: true, message: '请选择配置' }]}
              >
                <Select
                  placeholder="请选择融资信息源接口配置"
                  loading={configsLoading}
                  allowClear={false}
                >
                  {financingConfigs.map((c) => (
                    <Option key={c.id} value={c.id}>
                      {c.id} · {c.request_url?.slice(0, 48) || '—'}…
                    </Option>
                  ))}
                </Select>
              </FormItem>
              <FormItem
                label="日期范围（按融资日期 queryByDate，逐日请求）"
                field="date_range"
                rules={[{ required: true, message: '请选择日期范围' }]}
              >
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </FormItem>
            </Form>
            <p style={{ color: 'var(--color-text-3)', fontSize: 12, marginTop: 8 }}>
              与「融资事件列表」手动同步一致：使用「系统配置 → 融资信息源配置」中已启用的投融资接口。
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

