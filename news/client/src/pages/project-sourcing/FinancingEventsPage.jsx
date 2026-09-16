import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Input,
  Message,
  Modal,
  Form,
  Select,
  DatePicker,
  Switch,
  Radio,
  Tag,
} from '@arco-design/web-react'
import dayjs from 'dayjs'
import {
  formatFinancingYmd,
  financingNow,
  formatFinancingDateTime,
  formatFinancingEventDate,
} from './financingDateUtils'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import axios from '../../utils/axios'
import SheetModal, { SheetActions, SheetViewer, sheetPopupContainer } from '../../components/SheetModal'
import {
  fetchFinancingEvents,
  postFinancingSync,
  postFinancingBatchAiEnrich,
  fetchFinancingAiEnrichLogs,
  postFinancingBatchBaikeLookup,
} from '../../api/project-sourcing'
import { FINANCING_INTERFACE_TYPE, PROJECT_SOURCING_APP_NAME } from './financingConstants'
import { IntroPopoverCell } from './introPopoverAiCell'
import { getUser } from '../../utils/auth'
import { ListOpButton, ListOps } from '../../components/listTableOps'
import '../../styles/listTable.css'
import './FinancingEventsPage.css'

const Option = Select.Option
const FormItem = Form.Item
const RadioGroup = Radio.Group
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

function parseUserAdmin() {
  try {
    const u = getUser()
    if (!u) return false
    return String(u.role || '').toLowerCase() === 'admin'
  } catch {
    return false
  }
}

function formatInvestors(raw) {
  if (raw == null || raw === '') return '-'
  if (typeof raw !== 'string') return String(raw)
  const trimmed = raw.trim()
  if (!trimmed) return '-'
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr)) {
        return arr.map((x) => x && x.inv_nm).filter(Boolean).join('、') || '-'
      }
    } catch {
      /* 非合法 JSON 时按纯文本展示 */
    }
  }
  return trimmed
}

/** 与列表列一致的导出行（Excel） */
function buildFinancingExportRows(list) {
  return list.map((row) => ({
    融资日期: formatFinancingEventDate(row.event_date),
    项目名称: row.project_name ?? '',
    项目简介:
      row.project_desc == null || String(row.project_desc).trim() === ''
        ? '-'
        : String(row.project_desc),
    '产品简介(AI)':
      row.ai_product_intro == null || String(row.ai_product_intro).trim() === ''
        ? '-'
        : String(row.ai_product_intro),
    '企业标签(AI)':
      row.ai_company_tags_display == null || String(row.ai_company_tags_display).trim() === ''
        ? '-'
        : String(row.ai_company_tags_display),
    AI状态: row.ai_enrich_status ?? '',
    企业名称: row.company_name ?? '',
    最新轮次: row.latest_round ?? '',
    推测轮次: row.round ?? '',
    获投金额: row.funding_amt_raw ?? '',
    预估金额: row.estimated_amt_raw ?? '',
    '行业(L1)': row.industry_source_lv1 ?? '',
    '行业(L2)': row.industry_source_lv2 ?? '',
    赛道: row.track_primary ?? '',
    子赛道: row.track_secondary ?? '',
    投资方: formatInvestors(row.investor_names),
    事件ID: row.event_id ?? '',
    统一社会信用代码: row.company_credit_code ?? '',
  }))
}

/** 与后端 GET /events 单页上限一致 */
const FINANCING_EXPORT_PAGE_SIZE = 200

export default function FinancingEventsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  /** 查询栏展示的融资日期范围（点「查询」后才写入 dateFrom/dateTo 参与接口） */
  const [financingDateRange, setFinancingDateRange] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [trackPrimary, setTrackPrimary] = useState('')
  const [trackSecondary, setTrackSecondary] = useState('')
  const [investorKeyword, setInvestorKeyword] = useState('')
  const [roundBucket, setRoundBucket] = useState('')
  const [trackEmpty, setTrackEmpty] = useState(false)
  const [filtersReady, setFiltersReady] = useState(false)
  const [tableScrollY, setTableScrollY] = useState(520)

  const [syncVisible, setSyncVisible] = useState(false)
  const [syncSubmitting, setSyncSubmitting] = useState(false)
  const [syncForm] = Form.useForm()
  const [financingConfigs, setFinancingConfigs] = useState([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [exportingAll, setExportingAll] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [aiLogVisible, setAiLogVisible] = useState(false)
  const [aiLogLoading, setAiLogLoading] = useState(false)
  const [aiLogRows, setAiLogRows] = useState([])
  const [aiLogFinancingId, setAiLogFinancingId] = useState('')
  const [batchAiVisible, setBatchAiVisible] = useState(false)
  const [batchAiSubmitting, setBatchAiSubmitting] = useState(false)
  const [retryFailedVisible, setRetryFailedVisible] = useState(false)
  const [retryFailedSubmitting, setRetryFailedSubmitting] = useState(false)
  const [batchAiForm] = Form.useForm()
  const [retryFailedForm] = Form.useForm()
  const [batchBaikeVisible, setBatchBaikeVisible] = useState(false)
  const [batchBaikeSubmitting, setBatchBaikeSubmitting] = useState(false)
  const [batchBaikeForm] = Form.useForm()

  const isAdmin = useMemo(() => parseUserAdmin(), [])

  useEffect(() => {
    const df = searchParams.get('date_from') || ''
    const dt = searchParams.get('date_to') || ''
    const tp = searchParams.get('track_primary') || ''
    const ts = searchParams.get('track_secondary') || ''
    const ik = searchParams.get('investor_keyword') || ''
    const rb = searchParams.get('round_bucket') || ''
    const te =
      searchParams.get('track_empty') === '1' ||
      String(searchParams.get('track_empty') || '').toLowerCase() === 'true'
    if (df && dt) {
      setDateFrom(df.slice(0, 10))
      setDateTo(dt.slice(0, 10))
      setFinancingDateRange([dayjs(df.slice(0, 10)), dayjs(dt.slice(0, 10))])
    }
    setTrackPrimary(tp)
    setTrackSecondary(ts)
    setInvestorKeyword(ik)
    setRoundBucket(rb)
    setTrackEmpty(te)
    setFiltersReady(true)
    // 仅首屏从 URL 灌入；后续改筛选用本页状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 280)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const eventQueryFilters = useMemo(
    () => ({
      keyword: kwSearch || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      track_primary: trackEmpty ? undefined : trackPrimary || undefined,
      track_secondary: trackSecondary || undefined,
      investor_keyword: investorKeyword || undefined,
      round_bucket: roundBucket || undefined,
      track_empty: trackEmpty ? '1' : undefined,
    }),
    [
      kwSearch,
      dateFrom,
      dateTo,
      trackPrimary,
      trackSecondary,
      investorKeyword,
      roundBucket,
      trackEmpty,
    ]
  )
  const loadConfigsForSync = useCallback(async () => {
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
      const list = (cfgRes.data.data || []).filter(
        (c) => c.interface_type === FINANCING_INTERFACE_TYPE
      )
      setFinancingConfigs(list)
      if (list.length === 1) {
        syncForm.setFieldsValue({ config_id: list[0].id })
      }
    } catch (e) {
      console.error(e)
      setFinancingConfigs([])
    } finally {
      setConfigsLoading(false)
    }
  }, [syncForm])

  useEffect(() => {
    if (syncVisible && isAdmin) {
      loadConfigsForSync()
    }
  }, [syncVisible, isAdmin, loadConfigsForSync])

  const load = useCallback(async () => {
    if (!filtersReady) return
    setLoading(true)
    try {
      const res = await fetchFinancingEvents({
        page,
        pageSize,
        ...eventQueryFilters,
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
  }, [page, pageSize, eventQueryFilters, filtersReady])

  useEffect(() => {
    load()
  }, [load])
  const columns = [
    {
      title: '融资日期',
      dataIndex: 'event_date',
      width: 120,
      render: (v) => formatFinancingEventDate(v),
    },
    { title: '项目名称', dataIndex: 'project_name', width: 160, ellipsis: true },
    {
      title: '项目简介',
      dataIndex: 'project_desc',
      width: 220,
      render: (_, row) => <IntroPopoverCell columnTitle="项目简介" raw={row.project_desc} />,
    },
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
      dataIndex: 'ai_company_tags_display',
      width: 160,
      render: (_, row) => (
        <IntroPopoverCell
          columnTitle="企业标签(AI)"
          raw={row.ai_company_tags_display}
          triggerMaxWidth={160}
        />
      ),
    },
    {
      title: 'AI状态',
      dataIndex: 'ai_enrich_status',
      width: 96,
      render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
    },
    { title: '企业名称', dataIndex: 'company_name', width: 200, ellipsis: true },
    { title: '最新轮次', dataIndex: 'latest_round', width: 100 },
    { title: '推测轮次', dataIndex: 'round', width: 100 },
    { title: '获投金额', dataIndex: 'funding_amt_raw', width: 120 },
    { title: '预估金额', dataIndex: 'estimated_amt_raw', width: 120 },
    { title: '行业(L1)', dataIndex: 'industry_source_lv1', width: 110 },
    { title: '行业(L2)', dataIndex: 'industry_source_lv2', width: 110 },
    { title: '赛道', dataIndex: 'track_primary', width: 110, ellipsis: true },
    { title: '子赛道', dataIndex: 'track_secondary', width: 160, ellipsis: true },
    {
      title: '投资方',
      dataIndex: 'investor_names',
      width: 220,
      ellipsis: true,
      render: (_, row) => formatInvestors(row.investor_names),
    },
    { title: '事件ID', dataIndex: 'event_id', width: 100 },
    { title: '统一社会信用代码', dataIndex: 'company_credit_code', width: 190, ellipsis: true },
    {
      title: '操作',
      width: 88,
      fixed: 'right',
      className: 'list-ops-col',
      render: (_, row) => (
        <ListOps>
          <ListOpButton
            name="详情"
            onClick={() => {
              Modal.info({
                title: '融资事件详情',
                style: { width: 720 },
                content: (
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 480, overflow: 'auto' }}>
                    {JSON.stringify(row, null, 2)}
                  </pre>
                ),
              })
            }}
          />
        </ListOps>
      ),
    },
  ]

  const handleExportCurrentPage = useCallback(() => {
    if (!data.length) {
      Message.warning('当前列表无数据可导出')
      return
    }
    const rows = buildFinancingExportRows(data)
    const sheet = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '融资时间')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const name = `融资时间列表_第${page}页_${financingNow().format('YYYY-MM-DD_HHmmss')}.xlsx`
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), name)
    Message.success(`已导出 ${rows.length} 条`)
  }, [data, page])

  const fetchAllAndExport = useCallback(async () => {
    setExportingAll(true)
    try {
      const paramsBase = {
        pageSize: FINANCING_EXPORT_PAGE_SIZE,
        ...eventQueryFilters,
      }
      const first = await fetchFinancingEvents({ page: 1, ...paramsBase })
      if (!first.data?.success) {
        Message.error(first.data?.message || '获取数据失败')
        return
      }
      const d0 = first.data.data || {}
      const totalCount = Number(d0.total || 0)
      if (totalCount === 0) {
        Message.warning('当前筛选条件下无数据可导出')
        return
      }
      const merged = [...(d0.list || [])]
      const pages = Math.ceil(totalCount / FINANCING_EXPORT_PAGE_SIZE)
      for (let p = 2; p <= pages; p++) {
        const res = await fetchFinancingEvents({ page: p, ...paramsBase })
        if (!res.data?.success) {
          Message.error(res.data?.message || `第 ${p} 页获取失败`)
          return
        }
        merged.push(...(res.data.data.list || []))
      }
      const rows = buildFinancingExportRows(merged)
      const sheet = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, '融资时间')
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const name = `融资时间列表_全部${rows.length}条_${financingNow().format('YYYY-MM-DD_HHmmss')}.xlsx`
      saveAs(new Blob([buf], { type: 'application/octet-stream' }), name)
      Message.success(`已导出 ${rows.length} 条`)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    } finally {
      setExportingAll(false)
    }
  }, [eventQueryFilters, total])

  const handleExportAllClick = useCallback(() => {
    Modal.confirm({
      title: '导出全部',
      content: (
        <div>
          <p>将按当前筛选条件（关键词、日期、赛道、投资方、轮次桶等）分页拉取全部数据并导出为 Excel；日期按融资日期过滤且包含首尾两天，与列表一致。</p>
          {total > 0 ? (
            <p style={{ marginTop: 8, color: 'var(--color-text-2)' }}>最近一次加载的合计：{total} 条（若刚改条件请先点「查询」）。</p>
          ) : null}
          <p style={{ marginTop: 8, color: 'var(--color-text-3)', fontSize: 12 }}>数据量大时会多次请求接口，请稍候。</p>
        </div>
      ),
      onOk: fetchAllAndExport,
    })
  }, [total, fetchAllAndExport])

  const handleRetryFailedAiOk = async () => {
    try {
      const v = await retryFailedForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择融资日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setRetryFailedSubmitting(true)
      const res = await postFinancingBatchAiEnrich({
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

  const handleBatchAiOk = async () => {
    try {
      const v = await batchAiForm.validate()
      const mode = v.mode || 'date_range'
      setBatchAiSubmitting(true)
      let payload
      if (mode === 'selected') {
        if (!selectedRowKeys.length) {
          Message.warning('请先在列表中勾选融资事件')
          return
        }
        payload = {
          mode: 'selected',
          financing_event_ids: selectedRowKeys.map((k) => String(k)),
          force_refresh: v.force_refresh !== false,
        }
      } else {
        const range = v.date_range
        if (!range || range.length !== 2 || !range[0] || !range[1]) {
          Message.warning('请选择融资日期范围')
          return
        }
        payload = {
          mode: 'date_range',
          start_date: formatFinancingYmd(range[0]),
          end_date: formatFinancingYmd(range[1]),
        }
      }
      const res = await postFinancingBatchAiEnrich(payload)
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

  const handleSyncOk = async () => {
    try {
      const v = await syncForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择同步日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setSyncSubmitting(true)
      const res = await postFinancingSync({
        config_id: v.config_id,
        start_date: start,
        end_date: end,
      })
      if (res.data?.success) {
        Message.success(res.data.message || '同步完成')
        setSyncVisible(false)
        load()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '同步失败')
    } finally {
      setSyncSubmitting(false)
    }
  }

  return (
    <div className="financing-events-page list-table-page" style={{ padding: '4px 24px 0' }}>
      <Space direction="vertical" size={8} style={{ marginBottom: 8, width: '100%' }}>
        <Space wrap>
          <Input
            placeholder="模糊搜索：日期、企业、项目、简介、信用代码、轮次、金额、行业、赛道、投资方、事件ID等"
            style={{ width: 420 }}
            value={keyword}
            onChange={setKeyword}
            allowClear
          />
          <span style={{ color: 'var(--color-text-2)', whiteSpace: 'nowrap' }}>
            融资日期
          </span>
          <DatePicker.RangePicker
            style={{ width: 280 }}
            allowClear
            placeholder={['开始日期', '结束日期']}
            value={financingDateRange}
            onChange={setFinancingDateRange}
          />
          <Button
            type="primary"
            onClick={() => {
              setPage(1)
              setKwSearch(keyword.trim())
              if (financingDateRange?.[0] && financingDateRange?.[1]) {
                setDateFrom(formatFinancingYmd(financingDateRange[0]))
                setDateTo(formatFinancingYmd(financingDateRange[1]))
              } else {
                setDateFrom('')
                setDateTo('')
              }
            }}
          >
            查询
          </Button>
          <Button
            onClick={() => {
              setKeyword('')
              setKwSearch('')
              setFinancingDateRange(null)
              setDateFrom('')
              setDateTo('')
              setTrackPrimary('')
              setTrackSecondary('')
              setInvestorKeyword('')
              setRoundBucket('')
              setTrackEmpty(false)
              setPage(1)
              setSearchParams({})
            }}
          >
            重置
          </Button>
          <Button loading={loading} onClick={load}>
            刷新
          </Button>
        </Space>
        {(trackPrimary ||
          trackSecondary ||
          investorKeyword ||
          roundBucket ||
          trackEmpty) && (
          <Space wrap size={8}>
            <span style={{ color: 'var(--color-text-2)', fontSize: 12 }}>精确筛选（来自概览下钻）</span>
            {trackEmpty ? (
              <Tag
                closable
                onClose={() => {
                  setTrackEmpty(false)
                  setPage(1)
                }}
              >
                赛道未分类
              </Tag>
            ) : null}
            {trackPrimary && !trackEmpty ? (
              <Tag
                closable
                onClose={() => {
                  setTrackPrimary('')
                  setPage(1)
                }}
              >
                主赛道：{trackPrimary}
              </Tag>
            ) : null}
            {trackSecondary ? (
              <Tag
                closable
                onClose={() => {
                  setTrackSecondary('')
                  setPage(1)
                }}
              >
                子赛道：{trackSecondary}
              </Tag>
            ) : null}
            {investorKeyword ? (
              <Tag
                closable
                onClose={() => {
                  setInvestorKeyword('')
                  setPage(1)
                }}
              >
                投资方：{investorKeyword}
              </Tag>
            ) : null}
            {roundBucket ? (
              <Tag
                closable
                onClose={() => {
                  setRoundBucket('')
                  setPage(1)
                }}
              >
                轮次桶：{roundBucket}
              </Tag>
            ) : null}
          </Space>
        )}
        <Space wrap>
          <Button type="outline" onClick={handleExportCurrentPage} disabled={loading || exportingAll || !data.length}>
            导出当前页
          </Button>
          <Button
            type="outline"
            loading={exportingAll}
            onClick={handleExportAllClick}
            disabled={loading || exportingAll}
          >
            导出全部
          </Button>
          {isAdmin && (
            <Button
              type="outline"
              status="warning"
              onClick={() => {
                syncForm.setFieldsValue({
                  date_range: [financingNow().subtract(1, 'day'), financingNow()],
                })
                setSyncVisible(true)
              }}
            >
              手动同步
            </Button>
          )}
          {isAdmin && (
            <Button
              type="outline"
              disabled={!selectedRowKeys.length}
              loading={aiLogLoading}
              onClick={async () => {
                const ids = selectedRowKeys.map((k) => String(k))
                setAiLogFinancingId(ids.join(','))
                setAiLogVisible(true)
                setAiLogLoading(true)
                try {
                  const res = await fetchFinancingAiEnrichLogs({
                    financing_event_id: ids.join(','),
                    page: 1,
                    pageSize: 200,
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
          )}
          {isAdmin && (
            <Button
              type="outline"
              status="success"
              onClick={() => {
                const defaultRange =
                  financingDateRange?.[0] && financingDateRange?.[1]
                    ? financingDateRange
                    : [financingNow().subtract(7, 'day'), financingNow()]
                batchAiForm.setFieldsValue({
                  mode: selectedRowKeys.length ? 'selected' : 'date_range',
                  date_range: defaultRange,
                  force_refresh: true,
                })
                setBatchAiVisible(true)
              }}
            >
              批量AI取数
            </Button>
          )}
          {isAdmin && (
            <Button
              type="outline"
              status="danger"
              loading={retryFailedSubmitting}
              onClick={() => {
                const defaultRange =
                  dateFrom && dateTo
                    ? [dayjs(dateFrom, 'YYYY-MM-DD'), dayjs(dateTo, 'YYYY-MM-DD')]
                    : financingDateRange?.[0] && financingDateRange?.[1]
                      ? financingDateRange
                      : [financingNow().subtract(7, 'day'), financingNow()]
                retryFailedForm.setFieldsValue({ date_range: defaultRange })
                setRetryFailedVisible(true)
              }}
            >
              重试失败AI
            </Button>
          )}
          {isAdmin && (
            <Button
              type="outline"
              status="success"
              onClick={() => {
                batchBaikeForm.setFieldsValue({
                  date_range:
                    financingDateRange?.[0] && financingDateRange?.[1]
                      ? financingDateRange
                      : [financingNow().subtract(7, 'day'), financingNow()],
                  force: false,
                })
                setBatchBaikeVisible(true)
              }}
            >
              批量百科查词
            </Button>
          )}
        </Space>
      </Space>

      <Table
        className="list-table"
        rowKey="id"
        loading={loading}
        columns={columns}
        data={data}
        stripe
        border
        rowSelection={
          isAdmin
            ? {
                type: 'checkbox',
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
              }
            : undefined
        }
        scroll={{ x: 2480, y: tableScrollY }}
        pagination={{
          current: page,
          pageSize,
          total,
          sizeCanChange: true,
          showTotal: true,
          showJumper: true,
          pageSizeChangeResetCurrent: true,
          sizeOptions: PAGE_SIZE_OPTIONS,
          onChange: (p, ps) => {
            setPage(p)
            if (ps !== pageSize) setPageSize(ps)
          },
          onPageSizeChange: (ps) => {
            setPage(1)
            setPageSize(ps)
          },
        }}
      />

      <SheetViewer
        visible={aiLogVisible}
        title={`AI 增强执行日志（已选 ${selectedRowKeys.length} 条融资事件，按时间降序）`}
        onClose={() => setAiLogVisible(false)}
      >
        <p className="form-hint">
          成功任务会在下列表中展示「产品简介」「企业标签」快照；失败任务仅显示错误摘要。
        </p>
        <Table
          className="list-table"
          rowKey="id"
          loading={aiLogLoading}
          data={aiLogRows}
          stripe
          border
          scroll={{ x: 1000, y: 320 }}
          columns={[
            { title: '融资事件ID', dataIndex: 'financing_event_id', width: 120 },
            { title: '触发时间', dataIndex: 'triggered_at', width: 168, render: formatFinancingDateTime },
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
              render: (v) => <IntroPopoverCell columnTitle="产品简介(AI)（日志快照）" raw={v} />,
            },
            {
              title: '企业标签(结果)',
              dataIndex: 'result_company_tags_display',
              width: 160,
              render: (v) => <IntroPopoverCell columnTitle="企业标签(AI)（日志快照）" raw={v} />,
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
      </SheetViewer>

      <SheetModal
        visible={retryFailedVisible}
        title="重试失败 AI（仅 failed）"
        onClose={() => setRetryFailedVisible(false)}
      >
        <Form form={retryFailedForm} layout="vertical" className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <FormItem
              label="融资日期范围（含首尾两天，仅筛选 AI 状态为 failed 的事件）"
              field="date_range"
              rules={[{ required: true, message: '请选择日期范围' }]}
              className="form-span-2"
            >
              <DatePicker.RangePicker style={{ width: '100%' }} getPopupContainer={sheetPopupContainer} />
            </FormItem>
            <p className="form-hint form-span-4">
              仅对 ai_enrich_status = failed 的融资事件重新排队；去重规则与「批量AI取数」相同。执行方式与批量 AI 一致，日志触发类型为 batch_retry_failed。
            </p>
          </div>
          <SheetActions
            onCancel={() => setRetryFailedVisible(false)}
            submitLabel="加入重试队列"
            submitType="button"
            onSubmitClick={handleRetryFailedAiOk}
            submitLoading={retryFailedSubmitting}
          />
        </Form>
      </SheetModal>

      <SheetModal
        visible={batchAiVisible}
        title="批量 AI 取数"
        onClose={() => setBatchAiVisible(false)}
      >
        <Form form={batchAiForm} layout="vertical" initialValues={{ mode: 'date_range', force_refresh: true }} className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <FormItem label="取数范围" field="mode" rules={[{ required: true }]} className="form-span-2">
              <RadioGroup>
                <Radio value="selected" disabled={!selectedRowKeys.length}>
                  按选中行（已选 {selectedRowKeys.length} 条）
                </Radio>
                <Radio value="date_range">按融资日期区间</Radio>
              </RadioGroup>
            </FormItem>
            <Form.Item shouldUpdate noStyle>
              {(values) =>
                values.mode === 'selected' ? (
                  <FormItem label="强制重新取数" field="force_refresh" triggerPropName="checked">
                    <Switch />
                  </FormItem>
                ) : (
                  <FormItem
                    label="融资日期范围（含首尾两天）"
                    field="date_range"
                    rules={[{ required: true, message: '请选择日期范围' }]}
                    className="form-span-2"
                  >
                    <DatePicker.RangePicker style={{ width: '100%' }} getPopupContainer={sheetPopupContainer} />
                  </FormItem>
                )
              }
            </Form.Item>
            <p className="form-hint form-span-4">
              先按统一社会信用代码或企业全称去重，每个主体最多调用一次模型。按选中行默认强制重新取数。
            </p>
          </div>
          <SheetActions
            onCancel={() => setBatchAiVisible(false)}
            submitLabel="加入队列"
            submitType="button"
            onSubmitClick={handleBatchAiOk}
            submitLoading={batchAiSubmitting}
          />
        </Form>
      </SheetModal>

      <SheetModal
        visible={syncVisible}
        title="投融资数据同步（queryByDate）"
        onClose={() => setSyncVisible(false)}
      >
        <Form form={syncForm} layout="vertical" className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <FormItem
              label="接口配置"
              field="config_id"
              rules={[{ required: true, message: '请选择配置' }]}
              className="form-span-2"
            >
              <Select
                placeholder="请选择融资信息源接口配置"
                loading={configsLoading}
                allowClear={false}
                getPopupContainer={sheetPopupContainer}
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
              className="form-span-2"
            >
              <DatePicker.RangePicker style={{ width: '100%' }} getPopupContainer={sheetPopupContainer} />
            </FormItem>
            <p className="form-hint form-span-4">
              使用「系统配置 → 融资信息源配置」中已启用的投融资接口；凭证取自对应应用的「上海国际集团接口配置」。
            </p>
          </div>
          <SheetActions
            onCancel={() => setSyncVisible(false)}
            submitLabel="确定"
            submitType="button"
            onSubmitClick={handleSyncOk}
            submitLoading={syncSubmitting}
          />
        </Form>
      </SheetModal>

      <SheetModal
        visible={batchBaikeVisible}
        title="批量百科查词"
        onClose={() => setBatchBaikeVisible(false)}
      >
        <Form form={batchBaikeForm} layout="vertical" className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <FormItem
              label="融资日期范围（按 event_date 筛选）"
              field="date_range"
              rules={[{ required: true, message: '请选择日期范围' }]}
              className="form-span-2"
            >
              <DatePicker.RangePicker style={{ width: '100%' }} getPopupContainer={sheetPopupContainer} />
            </FormItem>
            <FormItem label="强制重跑（覆盖已查词）" field="force" triggerPropName="checked">
              <Switch />
            </FormItem>
            <p className="form-hint form-span-4">
              按企业名称调用百度百科查词。默认跳过已查词；开启「强制重跑」会覆盖简介。任务后台执行，请稍后刷新。
            </p>
          </div>
          <SheetActions
            onCancel={() => setBatchBaikeVisible(false)}
            submitLabel="确定"
            submitType="button"
            onSubmitClick={async () => {
              const values = await batchBaikeForm.validate()
              const [d0, d1] = values.date_range || []
              if (!d0 || !d1) {
                Message.warning('请选择日期范围')
                return
              }
              setBatchBaikeSubmitting(true)
              try {
                const res = await postFinancingBatchBaikeLookup({
                  start_date: dayjs(d0).format('YYYY-MM-DD'),
                  end_date: dayjs(d1).format('YYYY-MM-DD'),
                  force: Boolean(values.force),
                })
                if (res.data?.success) {
                  Message.success(res.data.message || '已受理百科批量查词，请稍后刷新列表')
                  load()
                } else {
                  Message.error(res.data?.message || '批量查词失败')
                }
              } catch (e) {
                Message.error(e.response?.data?.message || e.message || '批量查词失败')
              } finally {
                setBatchBaikeSubmitting(false)
                setBatchBaikeVisible(false)
              }
            }}
            submitLoading={batchBaikeSubmitting}
          />
        </Form>
      </SheetModal>
    </div>
  )
}
