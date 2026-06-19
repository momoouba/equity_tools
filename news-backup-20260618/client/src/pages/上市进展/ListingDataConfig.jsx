import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Message,
  Form,
  Input,
  Select,
  Switch,
  DatePicker,
} from '@arco-design/web-react'
import dayjs from 'dayjs'
import axios from '../../utils/axios'
import {
  postListingConfigSync,
  postListingConfigCopy,
  postListingConfigInitDefaults,
  fetchListingSyncExecutionLog,
} from '../../api/上市进展'
import CronGenerator from '../../components/CronGenerator'

const FormItem = Form.Item
const Option = Select.Option
const LISTING_INTERFACE_SUB_TYPES = [
  { value: 'exchange_ipo', label: '交易所IPO主爬虫' },
  { value: 'new_share', label: '打新日历' },
  { value: 'guidance_progress', label: '证监会辅导备案' },
  { value: 'overseas_filing', label: '境外上市备案审核' },
];
const LISTING_REQUEST_URL_HINTS = {
  exchange_ipo: '交易所IPO主爬虫默认走内置抓取/iFinD能力，无需填写请求地址（可留空）。',
  new_share: '打新日历默认走 AkShare + 港交所网页抓取，无需填写请求地址（可留空）。',
  guidance_progress: '证监会辅导备案为地址型数据源，建议填写官方页面地址（默认已初始化）。',
  overseas_filing: '境外上市备案审核为地址型数据源，请填写线上 Excel/CSV 的 URL。',
};

const emptyForm = {
  name: '',
  interface_type: 'crawler',
  request_url: '',
  min_sync_date: dayjs('2026-01-01'),
  cron_expression: '0 0 8 * * ? *',
  status: 'active',
  is_active: true,
  news_interface_type: '',
  skip_holiday: false,
  ifind_enabled: false,
  ifind_username: '',
  ifind_password: '',
  ifind_token: '',
  ifind_dr_code: 'p04920',
  ifind_query_params: 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
  ifind_fields:
    'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y',
  ifind_format: 'json',
  ifind_fallback_to_hkex: false,
}

const formatYmd = (value, fallback = '-') => {
  if (value == null || value === '') return fallback
  const text = String(value)
  const parsed = dayjs(text)
  if (parsed.isValid()) return parsed.format('YYYY-MM-DD')
  const s = text.replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return fallback
}

export default function ListingDataConfig() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncRow, setSyncRow] = useState(null)
  const [syncRange, setSyncRange] = useState([dayjs().subtract(1, 'day'), dayjs()])
  const [syncSingleDate, setSyncSingleDate] = useState(() => dayjs())
  const [syncing, setSyncing] = useState(false)
  const [syncLiveLog, setSyncLiveLog] = useState('')
  const [syncLiveStatus, setSyncLiveStatus] = useState('')
  const [syncLiveStartedAt, setSyncLiveStartedAt] = useState('')
  const syncPollTimerRef = useRef(null)
  const [logOpen, setLogOpen] = useState(false)
  const [logRecord, setLogRecord] = useState(null)
  const [showCronModal, setShowCronModal] = useState(false)
  const watchNewsSubType = Form.useWatch('news_interface_type', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/listing/listing-config')
      if (res.data?.success) {
        setData(res.data.data || [])
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setEditing(null)
    form.setFieldsValue({ ...emptyForm })
    setShowModal(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      interface_type: record.interface_type || 'crawler',
      request_url: record.request_url || '',
      min_sync_date: dayjs(record.min_sync_date || '2026-01-01'),
      cron_expression: record.cron_expression || '',
      status: record.status || 'active',
      is_active: record.is_active === 1 || record.is_active === true,
      news_interface_type: record.news_interface_type || '',
      skip_holiday: record.skip_holiday === 1 || record.skip_holiday === true,
      ifind_enabled: record.ifind_enabled === 1 || record.ifind_enabled === true,
      ifind_username: record.ifind_username || '',
      ifind_password: '',
      ifind_token: '',
      ifind_username_configured: !!record.ifind_username,
      ifind_password_configured: !!record.ifind_password,
      ifind_token_configured: !!record.ifind_token,
      ifind_dr_code: record.ifind_dr_code || 'p04920',
      ifind_query_params: record.ifind_query_params || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
      ifind_fields:
        record.ifind_fields ||
        'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y',
      ifind_format: record.ifind_format || 'json',
      ifind_fallback_to_hkex: record.ifind_fallback_to_hkex === 1 || record.ifind_fallback_to_hkex === true,
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    try {
      const v = await form.validate()
      const payload = {
        ...v,
        min_sync_date: v.min_sync_date ? dayjs(v.min_sync_date).format('YYYY-MM-DD') : '2026-01-01',
        is_active: v.is_active ? 1 : 0,
        skip_holiday: v.skip_holiday ? 1 : 0,
        ifind_enabled: v.ifind_enabled ? 1 : 0,
        ifind_fallback_to_hkex: v.ifind_fallback_to_hkex ? 1 : 0,
      }
      if (editing && !v.ifind_username && editing.ifind_username_configured) {
        delete payload.ifind_username
      }
      if (editing && !v.ifind_password && editing.ifind_password_configured) {
        delete payload.ifind_password
      }
      if (editing && !v.ifind_token && editing.ifind_token_configured) {
        delete payload.ifind_token
      }
      if (editing) {
        await axios.put(`/api/listing/listing-config/${editing.id}`, payload)
        Message.success('已保存')
      } else {
        await axios.post('/api/listing/listing-config', payload)
        Message.success('已创建')
      }
      setShowModal(false)
      load()
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const openSync = (record) => {
    setSyncRow(record)
    setSyncLiveLog('')
    setSyncLiveStatus('')
    setSyncLiveStartedAt('')
    if (record.news_interface_type === 'new_share') {
      setSyncSingleDate(dayjs())
    } else {
      setSyncRange([dayjs().subtract(1, 'day'), dayjs()])
    }
    setSyncOpen(true)
  }

  const stopSyncPolling = useCallback(() => {
    if (syncPollTimerRef.current) {
      clearInterval(syncPollTimerRef.current)
      syncPollTimerRef.current = null
    }
  }, [])

  const pollLatestSyncLog = useCallback(async (configId) => {
    if (!configId) return
    try {
      const res = await fetchListingSyncExecutionLog({
        configId,
        page: 1,
        pageSize: 1,
      })
      const row = res.data?.data?.list?.[0]
      if (!row) return
      setSyncLiveStatus(row.status || '')
      setSyncLiveStartedAt(row.started_at || '')
      setSyncLiveLog(row.progress_log || row.error_message || '')
      if (row.status && row.status !== 'running') {
        stopSyncPolling()
      }
    } catch (_) {
      // ignore polling errors to avoid interrupting manual sync
    }
  }, [stopSyncPolling])

  const startSyncPolling = useCallback((configId) => {
    stopSyncPolling()
    pollLatestSyncLog(configId)
    syncPollTimerRef.current = setInterval(() => {
      pollLatestSyncLog(configId)
    }, 2000)
  }, [pollLatestSyncLog, stopSyncPolling])

  const runSync = async () => {
    if (!syncRow?.id) return
    // RangePicker onChange 可能为原生 Date，需用 dayjs 再 format
    const toYmd = (d) => {
      if (d == null || d === '') return ''
      const x = dayjs(d)
      return x.isValid() ? x.format('YYYY-MM-DD') : ''
    }
    const isNewShare = syncRow?.news_interface_type === 'new_share'
    let payload
    const confirmAutoAdjustStartDate = (fromDate, minDate) =>
      new Promise((resolve) => {
        Modal.confirm({
          title: '同步区间将按配置自动调整',
          content: `你选择的开始日期 ${fromDate} 早于配置最早同步日期 ${minDate}。确认后将自动按 ${minDate} 继续同步。`,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
    let latestMinSyncDate = String(syncRow?.min_sync_date || '').slice(0, 10)
    try {
      // 同步前拉一次最新配置，避免使用到表格中的旧缓存
      const cfgRes = await axios.get('/api/listing/listing-config')
      const latestList = cfgRes?.data?.data || []
      const latestRow = latestList.find((x) => String(x.id) === String(syncRow.id))
      if (latestRow?.min_sync_date) latestMinSyncDate = String(latestRow.min_sync_date).slice(0, 10)
      if (latestRow) setSyncRow((prev) => ({ ...(prev || {}), ...latestRow }))
    } catch (_) {
      // 拉取失败时走现有 syncRow，避免阻断用户手动同步
    }
    if (isNewShare) {
      let startDate = toYmd(syncSingleDate)
      if (!startDate) {
        Message.warning('请选择开始日期')
        return
      }
      if (latestMinSyncDate && startDate < latestMinSyncDate) {
        const ok = await confirmAutoAdjustStartDate(startDate, latestMinSyncDate)
        if (!ok) return
        startDate = latestMinSyncDate
      }
      payload = { startDate }
    } else {
      let startDate = toYmd(syncRange[0])
      const endDate = toYmd(syncRange[1])
      if (!startDate || !endDate) {
        Message.warning('请选择开始与结束日期')
        return
      }
      if (latestMinSyncDate && endDate < latestMinSyncDate) {
        Message.warning(`结束日期早于当前配置最早同步日期（${latestMinSyncDate}），请调整区间`)
        return
      }
      if (latestMinSyncDate && startDate < latestMinSyncDate) {
        const ok = await confirmAutoAdjustStartDate(startDate, latestMinSyncDate)
        if (!ok) return
        startDate = latestMinSyncDate
      }
      payload = { startDate, endDate }
    }
    setSyncing(true)
    setSyncLiveLog('正在触发同步任务...')
    setSyncLiveStatus('running')
    startSyncPolling(syncRow.id)
    try {
      const res = await postListingConfigSync(syncRow.id, payload)
      await pollLatestSyncLog(syncRow.id)
      if (res.data?.success) {
        Message.success(res.data.message || '同步完成')
        setSyncOpen(false)
        load()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      const msg = e.response?.data?.message || e.message || '同步失败'
      Message.error(msg)
    } finally {
      stopSyncPolling()
      setSyncing(false)
    }
  }

  useEffect(() => () => stopSyncPolling(), [stopSyncPolling])

  const handleCopy = async (record) => {
    try {
      const res = await postListingConfigCopy(record.id)
      if (res.data?.success) {
        Message.success('已复制配置')
        load()
      } else {
        Message.error(res.data?.message || '复制失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '复制失败')
    }
  }

  const handleInitDefaults = async () => {
    try {
      const res = await postListingConfigInitDefaults()
      if (res.data?.success) {
        const n = Number(res.data?.data?.createdCount || 0)
        Message.success(n > 0 ? `已初始化 ${n} 条默认接口配置` : '默认接口配置已存在，无需新增')
        load()
      } else {
        Message.error(res.data?.message || '初始化失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '初始化失败')
    }
  }

  const openLog = (record) => {
    setLogRecord(record)
    setLogOpen(true)
  }

  const handleDelete = (record) => {
    Modal.confirm({
      title: '确认删除',
      content: `确认删除「${record.name}」？`,
      onOk: async () => {
        try {
          await axios.delete(`/api/listing/listing-config/${record.id}`)
          Message.success('已删除')
          load()
        } catch (e) {
          Message.error(e.response?.data?.message || '删除失败')
        }
      },
    })
  }

  const columns = [
    { title: '配置名称', dataIndex: 'name', width: 160 },
    { title: '接口类型', dataIndex: 'interface_type', width: 100 },
    {
      title: '接口子类型',
      dataIndex: 'news_interface_type',
      width: 170,
      render: (v) => LISTING_INTERFACE_SUB_TYPES.find((x) => x.value === v)?.label || v || '-',
    },
    {
      title: 'iFinD',
      width: 140,
      render: (_, record) =>
        record.ifind_enabled === 1 || record.ifind_enabled === true
          ? (record.ifind_username_configured && record.ifind_password_configured) || record.ifind_token_configured
            ? '已启用(已配置)'
            : '已启用(缺凭证)'
          : '未启用',
    },
    { title: '请求地址', dataIndex: 'request_url', ellipsis: true },
    {
      title: '最早同步日期',
      dataIndex: 'min_sync_date',
      width: 140,
      render: (t) => formatYmd(t, '2026-01-01'),
    },
    { title: 'Cron', dataIndex: 'cron_expression', width: 140 },
    {
      title: '跳过节假日',
      dataIndex: 'skip_holiday',
      width: 100,
      render: (v) => (v === 1 || v === true ? '是' : '否'),
    },
    {
      title: '最后同步时间',
      dataIndex: 'last_sync_time',
      width: 170,
      render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '-'),
    },
    { title: '状态', dataIndex: 'status', width: 100 },
    {
      title: '启用',
      dataIndex: 'is_active',
      width: 80,
      render: (v) => (v === 1 || v === true ? '是' : '否'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '-'),
    },
    {
      title: '操作',
      width: 340,
      render: (_, record) => (
        <Space>
          <Button type="text" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="text" size="small" onClick={() => handleCopy(record)}>
            复制
          </Button>
          <Button type="text" size="small" onClick={() => openSync(record)}>
            同步
          </Button>
          <Button type="text" size="small" onClick={() => openLog(record)}>
            日志
          </Button>
          <Button type="text" size="small" status="danger" onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div className="listing-data-config" style={{ padding: 8 }}>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={openAdd}>
          新增配置
        </Button>
        <Button onClick={handleInitDefaults}>初始化默认接口</Button>
        <Button onClick={load} loading={loading}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        data={data}
        scroll={{ x: 1600 }}
      />

      <Modal
        title={editing ? '编辑配置' : '新增配置'}
        visible={showModal}
        onOk={handleSubmit}
        onCancel={() => setShowModal(false)}
        style={{ width: 560 }}
      >
        <Form form={form} layout="vertical">
          <FormItem label="配置名称" field="name" rules={[{ required: true }]}>
            <Input placeholder="请输入" />
          </FormItem>
          <FormItem label="接口类型" field="interface_type" rules={[{ required: true }]}>
            <Select>
              <Option value="crawler">爬虫</Option>
              <Option value="api">数据接口</Option>
            </Select>
          </FormItem>
          <FormItem label="请求地址" field="request_url">
            <Input
              placeholder={
                watchNewsSubType === 'guidance_progress' || watchNewsSubType === 'overseas_filing'
                  ? '地址型数据源请填写 URL'
                  : '当前子类型可留空'
              }
            />
          </FormItem>
          <FormItem
            label="最早同步日期"
            field="min_sync_date"
            rules={[{ required: true, message: '请选择最早同步日期' }]}
            extra="该日期之前的数据将不会同步；建议所有上市接口统一设置。"
          >
            <DatePicker style={{ width: '100%' }} />
          </FormItem>
          {watchNewsSubType ? (
            <div style={{ marginTop: -4, marginBottom: 12, color: 'var(--color-text-2)', fontSize: 12 }}>
              {LISTING_REQUEST_URL_HINTS[watchNewsSubType] || '请按当前接口子类型填写配置。'}
            </div>
          ) : null}
          <FormItem label="Cron 表达式" field="cron_expression" extra="与新闻接口、收件管理等共用同一套可视化配置（Quartz 7 段），保存后由服务端转为 node-cron 调度">
            <Input
              placeholder="点击右侧「配置」打开系统 Cron 配置器"
              readOnly
              addAfter={
                <Button type="text" size="small" onClick={() => setShowCronModal(true)}>
                  配置
                </Button>
              }
            />
          </FormItem>
          <FormItem
            label="跳过节假日"
            field="skip_holiday"
            triggerPropName="checked"
            extra="开启后：法定节假日不执行定时任务；下一工作日按「上次同步结束日」补抓至昨日（与新闻同步逻辑一致）"
          >
            <Switch />
          </FormItem>
          <FormItem label="状态" field="status">
            <Input placeholder="如 active" />
          </FormItem>
          <FormItem label="接口子类型（数据接口时）" field="news_interface_type">
            <Select allowClear placeholder="请选择上市进展接口子类型">
              {LISTING_INTERFACE_SUB_TYPES.map((x) => (
                <Option key={x.value} value={x.value}>
                  {x.label}
                </Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label="启用 iFinD 港交所" field="ifind_enabled" triggerPropName="checked">
            <Switch />
          </FormItem>
          <FormItem
            label="iFinD 用户名"
            field="ifind_username"
            extra="Windows 环境填写用户名密码；留空不修改"
          >
            <Input placeholder="同花顺用户名/手机号" />
          </FormItem>
          <FormItem
            label="iFinD 密码"
            field="ifind_password"
            extra="Windows 环境用；留空不修改"
          >
            <Input.Password placeholder="密码（加密存储）" />
          </FormItem>
          <FormItem
            label="iFinD Token"
            field="ifind_token"
            extra="Linux 生产环境用；留空不修改"
          >
            <Input.Password placeholder="Token（加密存储）" />
          </FormItem>
          <FormItem label="THS_DR 数据集编码" field="ifind_dr_code">
            <Input placeholder="默认 p04920" />
          </FormItem>
          <FormItem label="THS_DR 入参" field="ifind_query_params">
            <Input placeholder="iv_sfss=0;iv_sqlx=0;iv_sqzt=0" />
          </FormItem>
          <FormItem label="THS_DR 字段" field="ifind_fields">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </FormItem>
          <FormItem label="THS_DR 格式" field="ifind_format">
            <Select>
              <Option value="json">json</Option>
              <Option value="dataframe">dataframe</Option>
              <Option value="list">list</Option>
            </Select>
          </FormItem>
          <FormItem
            label="iFinD 失败时回退港交所网页"
            field="ifind_fallback_to_hkex"
            triggerPropName="checked"
            extra="默认关闭：优先使用 iFinD；开启后若 iFinD 无数据或失败，会继续执行港交所网页回退同步。"
          >
            <Switch />
          </FormItem>
          <FormItem label="启用" field="is_active" triggerPropName="checked">
            <Switch />
          </FormItem>
        </Form>
      </Modal>

      <CronGenerator
        visible={showCronModal}
        value={form.getFieldValue('cron_expression')}
        skipHoliday={form.getFieldValue('skip_holiday')}
        onChange={(cron, isSkipHoliday) => {
          form.setFieldValue('cron_expression', cron)
          if (isSkipHoliday !== undefined) {
            form.setFieldValue('skip_holiday', isSkipHoliday)
          }
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />

      <Modal
        title="上市数据同步 — 时间范围"
        visible={syncOpen}
        onOk={runSync}
        onCancel={() => {
          stopSyncPolling()
          setSyncOpen(false)
        }}
        confirmLoading={syncing}
        style={{ width: 700 }}
      >
        <p style={{ marginBottom: 12, color: 'var(--color-text-2)' }}>
          {syncRow?.news_interface_type === 'new_share'
            ? '打新日历：只需选择「开始日期」（含当日）。将同步 A 股申购日 / 港股上市日从该日起的数据；已入库记录按字段比对更新。未传结束日时服务端上界为远期。'
            : '与新闻接口配置一致：选择闭区间日期。爬虫类型将按「更新日期」落在该区间内抓取深交所、上交所、北交所；若启用 iFinD，则同步港交所上市申请（失败可按配置回退网页抓取）。'}
        </p>
        <p style={{ marginBottom: 10, color: 'var(--color-text-2)', fontSize: 12 }}>
          当前配置最早同步日期：{formatYmd(syncRow?.min_sync_date, '2026-01-01')}
        </p>
        {syncRow?.news_interface_type === 'new_share' ? (
          <DatePicker
            style={{ width: '100%' }}
            value={syncSingleDate}
            onChange={(v) => setSyncSingleDate(v ? dayjs(v) : dayjs())}
            allowClear={false}
          />
        ) : (
          <DatePicker.RangePicker
            style={{ width: '100%' }}
            value={syncRange}
            onChange={(v) => {
              if (!v || !v.length) {
                setSyncRange([])
                return
              }
              setSyncRange([dayjs(v[0]), dayjs(v[1])])
            }}
            allowClear={false}
          />
        )}
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6, color: 'var(--color-text-2)', fontSize: 12 }}>
            {syncLiveStartedAt ? `任务开始：${String(syncLiveStartedAt).replace('T', ' ').slice(0, 19)}；` : ''}
            {syncLiveStatus ? `状态：${syncLiveStatus}` : ''}
          </div>
          <Input.TextArea
            value={syncLiveLog || (syncing ? '正在获取执行日志...' : '点击“同步”后将显示实时执行日志')}
            readOnly
            autoSize={{ minRows: 10, maxRows: 16 }}
          />
        </div>
      </Modal>

      <Modal
        title="同步说明（日志）"
        visible={logOpen}
        footer={null}
        onCancel={() => setLogOpen(false)}
        style={{ width: 520 }}
      >
        {logRecord && (
          <div style={{ lineHeight: 1.8 }}>
            <p>
              <strong>配置名称：</strong>
              {logRecord.name}
            </p>
            <p>
              <strong>最后同步时间：</strong>
              {logRecord.last_sync_time
                ? String(logRecord.last_sync_time).replace('T', ' ').slice(0, 19)
                : '—'}
            </p>
            <p>
              <strong>上次同步区间结束日：</strong>
              {logRecord.last_sync_range_end || '—'}
            </p>
            <p style={{ color: 'var(--color-text-2)', fontSize: 13 }}>
              详细执行日志与新闻侧「同步日志」策略对齐；后续可接入独立执行表。当前可在服务器控制台查看「上市进展定时」关键字日志。
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
