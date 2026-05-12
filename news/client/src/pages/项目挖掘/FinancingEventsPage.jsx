import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
  Popover,
} from '@arco-design/web-react'
import {
  formatFinancingYmd,
  financingNow,
  formatFinancingDateTime,
  formatFinancingEventDate,
} from './financingDateUtils'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import axios from '../../utils/axios'
import {
  fetchFinancingEvents,
  postFinancingSync,
  postFinancingEventAiEnrich,
  postFinancingBatchAiEnrich,
  fetchFinancingAiEnrichLogs,
} from '../../api/项目挖掘'
import { FINANCING_INTERFACE_TYPE, PROJECT_SOURCING_APP_NAME } from './financingConstants'
import './FinancingEventsPage.css'

const Option = Select.Option
const FormItem = Form.Item
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

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

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    Message.success('已复制到剪贴板')
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      Message.success('已复制到剪贴板')
    } catch {
      Message.error('复制失败，请在弹出层内手动选中复制')
    }
  }
}

/**
 * 表格内单行省略；点击后在 Popover 内展示全文，支持鼠标划选与「复制全文」（避免 ellipsis 自带 Tooltip 无法选中）
 */
function IntroPopoverCell({ columnTitle, raw }) {
  const empty = raw == null || String(raw).trim() === ''
  const text = empty ? '' : String(raw)
  if (empty) {
    return <span>-</span>
  }
  const popoverContent = (
    <div className="financing-events-intro-popover-inner">
      <div style={{ marginBottom: 8 }}>
        <Button type="outline" size="mini" onClick={() => copyTextToClipboard(text)}>
          复制全文
        </Button>
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
          下方文本可选中复制
        </span>
      </div>
      <div
        className="financing-events-intro-selectable"
        style={{
          maxWidth: 520,
          maxHeight: 360,
          overflow: 'auto',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
          lineHeight: 1.55,
          padding: '4px 0',
        }}
      >
        {text}
      </div>
    </div>
  )
  return (
    <Popover
      title={columnTitle}
      trigger="click"
      position="top"
      popupClassName="financing-events-intro-popover"
      content={popoverContent}
    >
      <span
        style={{
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          color: 'rgb(var(--primary-6))',
        }}
        title="点击查看全文，可选中或复制"
      >
        {text}
      </span>
    </Popover>
  )
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
    统一社会信用代码: row.company_credit_code ?? '',
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
  }))
}

/** 与后端 GET /events 单页上限一致 */
const FINANCING_EXPORT_PAGE_SIZE = 200

export default function FinancingEventsPage() {
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
  const [tableScrollY, setTableScrollY] = useState(520)

  const [syncVisible, setSyncVisible] = useState(false)
  const [syncSubmitting, setSyncSubmitting] = useState(false)
  const [syncForm] = Form.useForm()
  const [financingConfigs, setFinancingConfigs] = useState([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [exportingAll, setExportingAll] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [aiEnrichSubmitting, setAiEnrichSubmitting] = useState(false)
  const [aiLogVisible, setAiLogVisible] = useState(false)
  const [aiLogLoading, setAiLogLoading] = useState(false)
  const [aiLogRows, setAiLogRows] = useState([])
  const [aiLogFinancingId, setAiLogFinancingId] = useState('')
  const [batchAiVisible, setBatchAiVisible] = useState(false)
  const [batchAiSubmitting, setBatchAiSubmitting] = useState(false)
  const [batchAiForm] = Form.useForm()

  const isAdmin = useMemo(() => parseUserAdmin(), [])

  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 280)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

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
    setLoading(true)
    try {
      const res = await fetchFinancingEvents({
        page,
        pageSize,
        keyword: kwSearch || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
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
  }, [page, pageSize, kwSearch, dateFrom, dateTo])

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
      render: (_, row) => <IntroPopoverCell columnTitle="产品简介(AI)" raw={row.ai_product_intro} />,
    },
    {
      title: '企业标签(AI)',
      dataIndex: 'ai_company_tags_display',
      width: 160,
      render: (_, row) => (
        <IntroPopoverCell columnTitle="企业标签(AI)" raw={row.ai_company_tags_display} />
      ),
    },
    {
      title: 'AI状态',
      dataIndex: 'ai_enrich_status',
      width: 96,
      render: (v) => (v == null || String(v).trim() === '' ? '-' : String(v)),
    },
    { title: '企业名称', dataIndex: 'company_name', width: 200, ellipsis: true },
    { title: '统一社会信用代码', dataIndex: 'company_credit_code', width: 190 },
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
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_, row) => (
        <Space size={8} style={{ padding: '0 10px' }}>
          <Button
            type="outline"
            size="small"
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
          >
            详情
          </Button>
        </Space>
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
        keyword: kwSearch || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
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
  }, [kwSearch, dateFrom, dateTo])

  const handleExportAllClick = useCallback(() => {
    Modal.confirm({
      title: '导出全部',
      content: (
        <div>
          <p>将按当前筛选条件（模糊关键词、融资日期起止）分页拉取全部数据并导出为 Excel；日期按融资日期过滤且包含首尾两天，与点击「查询」后的列表一致。</p>
          {total > 0 ? (
            <p style={{ marginTop: 8, color: 'var(--color-text-2)' }}>最近一次加载的合计：{total} 条（若刚改条件请先点「查询」）。</p>
          ) : null}
          <p style={{ marginTop: 8, color: 'var(--color-text-3)', fontSize: 12 }}>数据量大时会多次请求接口，请稍候。</p>
        </div>
      ),
      onOk: fetchAllAndExport,
    })
  }, [total, fetchAllAndExport])

  const handleBatchAiOk = async () => {
    try {
      const v = await batchAiForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择融资日期范围')
        return
      }
      const start = formatFinancingYmd(range[0])
      const end = formatFinancingYmd(range[1])
      setBatchAiSubmitting(true)
      const res = await postFinancingBatchAiEnrich({ start_date: start, end_date: end })
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
    <div className="financing-events-page" style={{ padding: '16px 24px' }}>
      <Space style={{ marginBottom: 8 }} wrap>
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
            setPage(1)
          }}
        >
          重置
        </Button>
        <Button loading={loading} onClick={load}>
          刷新
        </Button>
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
            loading={aiEnrichSubmitting}
            disabled={!selectedRowKeys.length}
            onClick={async () => {
              const id = selectedRowKeys[0]
              if (!id) {
                Message.warning('请先勾选一行融资记录')
                return
              }
              setAiEnrichSubmitting(true)
              try {
                const res = await postFinancingEventAiEnrich(id)
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
        )}
        {isAdmin && (
          <Button
            type="outline"
            disabled={!selectedRowKeys.length}
            loading={aiLogLoading}
            onClick={async () => {
              const id = selectedRowKeys[0]
              if (!id) {
                Message.warning('请先勾选一行融资记录')
                return
              }
              setAiLogFinancingId(String(id))
              setAiLogVisible(true)
              setAiLogLoading(true)
              try {
                const res = await fetchFinancingAiEnrichLogs({
                  financing_event_id: id,
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
        )}
        {isAdmin && (
          <Button
            type="outline"
            status="success"
            onClick={() => {
              batchAiForm.setFieldsValue({
                date_range:
                  financingDateRange?.[0] && financingDateRange?.[1]
                    ? financingDateRange
                    : [financingNow().subtract(7, 'day'), financingNow()],
              })
              setBatchAiVisible(true)
            }}
          >
            批量AI取数
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        data={data}
        stripe
        border
        rowSelection={
          isAdmin
            ? {
                type: 'radio',
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

      <Modal
        title={`AI 增强执行日志（融资事件 id=${aiLogFinancingId || '—'}）`}
        visible={aiLogVisible}
        footer={null}
        onCancel={() => setAiLogVisible(false)}
        style={{ width: 960 }}
        unmountOnExit
      >
        <p style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
          成功任务会在下列表中展示「产品简介」「企业标签」快照，与服务端控制台 success 日志一致；失败任务仅显示错误摘要。
        </p>
        <Table
          rowKey="id"
          loading={aiLogLoading}
          data={aiLogRows}
          stripe
          border
          scroll={{ x: 880, y: 420 }}
          columns={[
            { title: '触发时间', dataIndex: 'triggered_at', width: 168, render: formatFinancingDateTime },
            { title: '状态', dataIndex: 'execution_status', width: 88 },
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
      </Modal>

      <Modal
        title="批量 AI 取数（按融资日期）"
        visible={batchAiVisible}
        onOk={handleBatchAiOk}
        confirmLoading={batchAiSubmitting}
        onCancel={() => setBatchAiVisible(false)}
        style={{ width: 520 }}
        okText="加入队列"
      >
        <Form form={batchAiForm} layout="vertical">
          <FormItem
            label="融资日期范围（含首尾两天，筛选 sourcing_financing_event.event_date）"
            field="date_range"
            rules={[{ required: true, message: '请选择日期范围' }]}
          >
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </FormItem>
        </Form>
        <p style={{ color: 'var(--color-text-3)', fontSize: 12, marginTop: 8 }}>
          先按<strong>统一社会信用代码</strong>（有则优先）或<strong>企业全称</strong>在区间内<strong>去重</strong>，每个主体在当次任务里<strong>最多调用一次模型</strong>；若库内已有可复用的 AI 简介/标签则会直接复用，不重复请求。写入成功后，会按信用代码（无代码则按企业全称）<strong>扇出同步</strong>到该企业在本库内的多条融资记录。同一主体在短时间窗口内若已有进行中的 AI 任务，会<strong>拒绝重复提交</strong>。
        </p>
        <p style={{ color: 'var(--color-text-3)', fontSize: 12, marginTop: 4 }}>
          <strong>服务端执行方式</strong>（与去重后的企业数有关，默认阈值 100，可由环境变量
          FINANCING_AI_BATCH_FILE_THRESHOLD 调整）：超过阈值时走<strong>百炼 Batch File</strong>——接口会先完成上传与创建
          Batch，HTTP 202 响应里会带上 <code>dashscope_batch_id</code>，随后在后台轮询结果并写库；不超过阈值时走<strong>并发
          chat 请求</strong>（并发度 FINANCING_AI_CONCURRENCY，默认 4），波次之间间隔 FINANCING_AI_BATCH_GAP_MS（默认
          500ms，下限 500ms）。手动单条「AI 取数」与上述并发共用同一并发上限。
        </p>
      </Modal>

      <Modal
        title="投融资数据同步（queryByDate）"
        visible={syncVisible}
        onOk={handleSyncOk}
        confirmLoading={syncSubmitting}
        onCancel={() => setSyncVisible(false)}
        style={{ width: 520 }}
      >
        <Form form={syncForm} layout="vertical">
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
          使用「系统配置 → 融资信息源配置」中已启用的投融资接口；凭证取自对应应用的「上海国际集团接口配置」。
        </p>
      </Modal>
    </div>
  )
}
