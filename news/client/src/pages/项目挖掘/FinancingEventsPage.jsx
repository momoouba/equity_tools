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
} from '@arco-design/web-react'
import dayjs from 'dayjs'
import axios from '../../utils/axios'
import { fetchFinancingEvents, postFinancingSync } from '../../api/项目挖掘'
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

/** 列表展示：融资日期仅 yyyy-MM-dd（兼容接口返回 DATE / ISO 字符串） */
function formatEventDate(val) {
  if (val == null || val === '') return '-'
  const s = String(val).trim()
  const head = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (head) return head[1]
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD') : s
}

export default function FinancingEventsPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tableScrollY, setTableScrollY] = useState(520)

  const [syncVisible, setSyncVisible] = useState(false)
  const [syncSubmitting, setSyncSubmitting] = useState(false)
  const [syncForm] = Form.useForm()
  const [financingConfigs, setFinancingConfigs] = useState([])
  const [configsLoading, setConfigsLoading] = useState(false)

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
      render: (v) => formatEventDate(v),
    },
    { title: '项目名称', dataIndex: 'project_name', width: 160, ellipsis: true },
    {
      title: '项目简介',
      dataIndex: 'project_desc',
      width: 220,
      ellipsis: true,
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

  const handleSyncOk = async () => {
    try {
      const v = await syncForm.validate()
      const range = v.date_range
      if (!range || range.length !== 2 || !range[0] || !range[1]) {
        Message.warning('请选择同步日期范围')
        return
      }
      const start = dayjs(range[0]).format('YYYY-MM-DD')
      const end = dayjs(range[1]).format('YYYY-MM-DD')
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
        <Input
          placeholder="开始日期 yyyy-MM-dd"
          style={{ width: 140 }}
          value={dateFrom}
          onChange={setDateFrom}
          allowClear
        />
        <Input
          placeholder="结束日期 yyyy-MM-dd"
          style={{ width: 140 }}
          value={dateTo}
          onChange={setDateTo}
          allowClear
        />
        <Button
          type="primary"
          onClick={() => {
            setPage(1)
            setKwSearch(keyword.trim())
          }}
        >
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword('')
            setKwSearch('')
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
        {isAdmin && (
          <Button
            type="outline"
            status="warning"
            onClick={() => {
              syncForm.setFieldsValue({
                date_range: [dayjs().subtract(1, 'day'), dayjs()],
              })
              setSyncVisible(true)
            }}
          >
            手动同步
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
        scroll={{ x: 2000, y: tableScrollY }}
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
