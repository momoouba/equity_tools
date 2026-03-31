import React, { useState, useEffect, useCallback } from 'react'
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
import { postListingConfigSync, postListingConfigCopy } from '../../api/上市进展'

const FormItem = Form.Item
const Option = Select.Option

const emptyForm = {
  name: '',
  interface_type: 'crawler',
  request_url: '',
  cron_expression: '0 0 8 * * ? *',
  status: 'active',
  is_active: true,
  news_interface_type: '',
  skip_holiday: false,
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
  const [syncing, setSyncing] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logRecord, setLogRecord] = useState(null)

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
      cron_expression: record.cron_expression || '',
      status: record.status || 'active',
      is_active: record.is_active === 1 || record.is_active === true,
      news_interface_type: record.news_interface_type || '',
      skip_holiday: record.skip_holiday === 1 || record.skip_holiday === true,
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    try {
      const v = await form.validate()
      const payload = {
        ...v,
        is_active: v.is_active ? 1 : 0,
        skip_holiday: v.skip_holiday ? 1 : 0,
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
    setSyncRange([dayjs().subtract(1, 'day'), dayjs()])
    setSyncOpen(true)
  }

  const runSync = async () => {
    if (!syncRow?.id) return
    // RangePicker onChange 可能为原生 Date，需用 dayjs 再 format
    const toYmd = (d) => {
      if (d == null || d === '') return ''
      const x = dayjs(d)
      return x.isValid() ? x.format('YYYY-MM-DD') : ''
    }
    const startDate = toYmd(syncRange[0])
    const endDate = toYmd(syncRange[1])
    if (!startDate || !endDate) {
      Message.warning('请选择开始与结束日期')
      return
    }
    setSyncing(true)
    try {
      const res = await postListingConfigSync(syncRow.id, { startDate, endDate })
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
      setSyncing(false)
    }
  }

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
    { title: '请求地址', dataIndex: 'request_url', ellipsis: true },
    { title: 'Cron', dataIndex: 'cron_expression', width: 140 },
    {
      title: '跳过节假日',
      dataIndex: 'skip_holiday',
      width: 100,
      render: (v) => (v === 1 || v === true ? '是' : '否'),
    },
    {
      title: '最后同步',
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
        <Button onClick={load} loading={loading}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        data={data}
        scroll={{ x: 1200 }}
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
            <Input placeholder="可选，数据接口时填写" />
          </FormItem>
          <FormItem label="Cron 表达式" field="cron_expression">
            <Input placeholder="如 0 0 8 * * ? *" />
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
            <Select allowClear placeholder="上海国际集团 / 企查查 / 其他">
              <Option value="上海国际集团">上海国际集团</Option>
              <Option value="企查查">企查查</Option>
              <Option value="其他">其他</Option>
            </Select>
          </FormItem>
          <FormItem label="启用" field="is_active" triggerPropName="checked">
            <Switch />
          </FormItem>
        </Form>
      </Modal>

      <Modal
        title="上市数据同步 — 时间范围"
        visible={syncOpen}
        onOk={runSync}
        onCancel={() => setSyncOpen(false)}
        confirmLoading={syncing}
        style={{ width: 480 }}
      >
        <p style={{ marginBottom: 12, color: 'var(--color-text-2)' }}>
          与新闻接口配置一致：选择闭区间日期。爬虫类型将按「更新日期」落在该区间内，从深交所、上交所、北交所公开接口抓取并入库；数据接口类型将提示尚未接入。
        </p>
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
