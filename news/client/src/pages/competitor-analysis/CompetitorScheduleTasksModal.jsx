import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Table,
  Button,
  Space,
  Message,
  Form,
  Input,
  Select,
  Switch,
  Checkbox,
  Tag,
} from '@arco-design/web-react'
import CronGenerator from '../../components/CronGenerator'
import {
  fetchCompetitorScheduleStatusOptions,
  fetchCompetitorScheduleTasks,
  postCompetitorScheduleTask,
  putCompetitorScheduleTask,
  deleteCompetitorScheduleTask,
  fetchCompetitorScheduleEnterprises,
  fetchCompetitorScheduleRuns,
  postCompetitorScheduleTaskRun,
} from '../../api/competitor-analysis'

const FormItem = Form.Item
const DEFAULT_CRON = '0 0 9 * * ? *'
const DEFAULT_BODY = '本次竞品分析的结果详见附件。'

function formatCronExpression(cronStr) {
  if (!cronStr) return '-'
  const parts = String(cronStr).trim().split(/\s+/)
  if (parts.length === 7) {
    const [, minute, hour, day, , weekday] = parts
    if (day === '*' && (weekday === '?' || weekday === '*')) {
      return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    }
  }
  return cronStr
}

function formatDate(v) {
  if (!v) return '-'
  try {
    return new Date(v).toLocaleString('zh-CN')
  } catch {
    return String(v)
  }
}

function recipientsPreview(emails) {
  const list = String(emails || '')
    .split(/[,;，；]/)
    .map((e) => e.trim())
    .filter(Boolean)
  if (!list.length) return '-'
  if (list.length <= 2) return list.join('、')
  return `${list.slice(0, 2).join('、')} 等${list.length}人`
}

/**
 * 投后-竞品分析 · 定时任务列表 / 编辑 / 项目排除 / 执行日志
 */
export default function CompetitorScheduleTasksModal({ visible, onClose }) {
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState([])
  const [statusOptions, setStatusOptions] = useState([])
  const [defaultBody, setDefaultBody] = useState(DEFAULT_BODY)

  const [editVisible, setEditVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [cronModalOpen, setCronModalOpen] = useState(false)
  const [cronValue, setCronValue] = useState(DEFAULT_CRON)

  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerList, setPickerList] = useState([])
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerChecked, setPickerChecked] = useState([])
  const [excludedIds, setExcludedIds] = useState([])

  const [logsVisible, setLogsVisible] = useState(false)
  const [logsTask, setLogsTask] = useState(null)
  const [logs, setLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchCompetitorScheduleTasks()
      if (res.data?.success) setTasks(res.data.data?.list || [])
      else Message.error(res.data?.message || '加载失败')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    loadTasks()
    fetchCompetitorScheduleStatusOptions()
      .then((res) => {
        if (res.data?.success) {
          setStatusOptions(res.data.data?.options || [])
          if (res.data.data?.default_email_body) {
            setDefaultBody(res.data.data.default_email_body)
          }
        }
      })
      .catch(() => {})
  }, [visible, loadTasks])

  const openCreate = () => {
    setEditing(null)
    setExcludedIds([])
    setCronValue(DEFAULT_CRON)
    form.setFieldsValue({
      recipient_emails: '',
      email_subject: '投后竞品分析定时结果',
      email_body: defaultBody,
      cron_expression: DEFAULT_CRON,
      project_status: statusOptions[0] || '未退出',
      is_active: true,
    })
    setEditVisible(true)
  }

  const openEdit = (row) => {
    setEditing(row)
    setExcludedIds(row.excluded_enterprise_ids || [])
    setCronValue(row.cron_expression || DEFAULT_CRON)
    form.setFieldsValue({
      recipient_emails: row.recipient_emails || '',
      email_subject: row.email_subject || '',
      email_body: row.email_body || defaultBody,
      cron_expression: row.cron_expression || DEFAULT_CRON,
      project_status: row.project_status || '未退出',
      is_active: !!row.is_active,
    })
    setEditVisible(true)
  }

  const handleSave = async () => {
    try {
      const v = await form.validate()
      setSaving(true)
      const payload = {
        recipient_emails: v.recipient_emails,
        email_subject: v.email_subject,
        email_body: v.email_body,
        cron_expression: v.cron_expression || cronValue,
        project_status: v.project_status,
        excluded_enterprise_ids: excludedIds,
        is_active: !!v.is_active,
      }
      let res
      if (editing?.id) {
        res = await putCompetitorScheduleTask(editing.id, payload)
      } else {
        res = await postCompetitorScheduleTask(payload)
      }
      if (res.data?.success) {
        Message.success(res.data.message || '已保存')
        setEditVisible(false)
        loadTasks()
      } else {
        Message.error(res.data?.message || '保存失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (row, checked) => {
    try {
      const res = await putCompetitorScheduleTask(row.id, { is_active: checked })
      if (res.data?.success) {
        Message.success(checked ? '已启用' : '已停用')
        loadTasks()
      } else {
        Message.error(res.data?.message || '操作失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '操作失败')
    }
  }

  const handleDelete = (row) => {
    Modal.confirm({
      title: '删除定时任务',
      content: `确定删除「${row.email_subject || row.id}」？`,
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        const res = await deleteCompetitorScheduleTask(row.id)
        if (!res.data?.success) throw new Error(res.data?.message || '删除失败')
        Message.success('已删除')
        loadTasks()
      },
    })
  }

  const handleRunNow = async (row) => {
    try {
      const res = await postCompetitorScheduleTaskRun(row.id)
      if (res.status === 202 || res.data?.success) {
        Message.success(res.data?.message || '已开始执行')
        loadTasks()
      } else {
        Message.error(res.data?.message || '触发失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '触发失败')
    }
  }

  const openLogs = async (row) => {
    setLogsTask(row)
    setLogsVisible(true)
    setLogsLoading(true)
    try {
      const res = await fetchCompetitorScheduleRuns(row.id, { limit: 30 })
      if (res.data?.success) setLogs(res.data.data?.list || [])
      else Message.error(res.data?.message || '加载日志失败')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载日志失败')
    } finally {
      setLogsLoading(false)
    }
  }

  const openProjectPicker = async () => {
    const status = form.getFieldValue('project_status')
    if (!status) {
      Message.warning('请先选择项目状态')
      return
    }
    setProjectPickerOpen(true)
    setPickerSearch('')
    setPickerLoading(true)
    try {
      const res = await fetchCompetitorScheduleEnterprises({ project_status: status })
      const list = res.data?.success ? res.data.data?.list || [] : []
      setPickerList(list)
      // 默认全选 = 全部纳入（排除名单为空时全选；有排除则勾选未排除的）
      const excl = new Set(excludedIds.map(String))
      const checked = list.filter((r) => !excl.has(String(r.id))).map((r) => r.id)
      setPickerChecked(checked)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载项目失败')
      setPickerList([])
      setPickerChecked([])
    } finally {
      setPickerLoading(false)
    }
  }

  const confirmProjectPicker = () => {
    const allIds = pickerList.map((r) => String(r.id))
    const checkedSet = new Set(pickerChecked.map(String))
    const excluded = allIds.filter((id) => !checkedSet.has(id))
    setExcludedIds(excluded)
    setProjectPickerOpen(false)
    Message.success(
      excluded.length
        ? `已排除 ${excluded.length} 家，其余将动态纳入`
        : '未排除任何项目，该状态下全部企业将动态纳入'
    )
  }

  const filteredPicker = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    if (!q) return pickerList
    return pickerList.filter((r) => {
      const ab = String(r.project_abbreviation || '').toLowerCase()
      const full = String(r.enterprise_full_name || '').toLowerCase()
      return ab.includes(q) || full.includes(q)
    })
  }, [pickerList, pickerSearch])

  const columns = [
    {
      title: '收件人',
      dataIndex: 'recipient_emails',
      width: 180,
      ellipsis: true,
      render: (t) => recipientsPreview(t),
    },
    {
      title: '主题',
      dataIndex: 'email_subject',
      width: 160,
      ellipsis: true,
    },
    {
      title: '定时规则',
      dataIndex: 'cron_expression',
      width: 140,
      render: (t) => formatCronExpression(t),
    },
    {
      title: '项目状态',
      dataIndex: 'project_status',
      width: 100,
    },
    {
      title: '排除数',
      dataIndex: 'excluded_count',
      width: 80,
      render: (n) => n || 0,
    },
    {
      title: '启用',
      dataIndex: 'is_active',
      width: 80,
      render: (v, row) => (
        <Switch checked={!!v} onChange={(c) => handleToggleActive(row, c)} size="small" />
      ),
    },
    {
      title: '最近执行',
      width: 200,
      render: (_, row) => (
        <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
          {formatDate(row.last_run_at)}
          {row.last_run_status ? (
            <Tag size="small" style={{ marginLeft: 6 }}>
              {row.last_run_status}
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, row) => (
        <Space size="mini" wrap>
          <Button type="text" size="mini" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button type="text" size="mini" onClick={() => handleRunNow(row)}>
            立即执行
          </Button>
          <Button type="text" size="mini" onClick={() => openLogs(row)}>
            日志
          </Button>
          <Button type="text" size="mini" status="danger" onClick={() => handleDelete(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const logColumns = [
    { title: '时间', dataIndex: 'started_at', width: 160, render: (t) => formatDate(t) },
    { title: '触发', dataIndex: 'trigger_type', width: 70 },
    { title: '状态', dataIndex: 'status', width: 90 },
    {
      title: '成功/失败',
      width: 100,
      render: (_, r) => `${r.success_count || 0} / ${r.fail_count || 0}`,
    },
    { title: '摘要', dataIndex: 'message', ellipsis: true },
  ]

  return (
    <>
      <Modal
        title="投后竞品分析 · 定时任务"
        visible={visible}
        onCancel={onClose}
        footer={null}
        style={{ width: 1100 }}
        unmountOnExit
      >
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={openCreate}>
            新增定时任务
          </Button>
          <Button onClick={loadTasks} loading={loading}>
            刷新
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          data={tasks}
          scroll={{ x: 1200, y: 420 }}
          pagination={false}
          border={{ wrapper: true, cell: true }}
        />
      </Modal>

      <Modal
        title={editing ? '编辑定时任务' : '新增定时任务'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        style={{ width: 640 }}
        unmountOnExit
      >
        <Form form={form} layout="vertical">
          <FormItem
            label="收件人邮箱"
            field="recipient_emails"
            rules={[{ required: true, message: '请填写收件人' }]}
            extra="多个邮箱用逗号或分号分隔"
          >
            <Input.TextArea
              placeholder="例如：a@example.com, b@example.com"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </FormItem>
          <FormItem
            label="邮件主题"
            field="email_subject"
            rules={[{ required: true, message: '请填写主题' }]}
          >
            <Input placeholder="邮件主题" />
          </FormItem>
          <FormItem label="邮件正文" field="email_body">
            <Input.TextArea
              placeholder={DEFAULT_BODY}
              autoSize={{ minRows: 3, maxRows: 8 }}
            />
          </FormItem>
          <FormItem
            label="定时规则"
            field="cron_expression"
            rules={[{ required: true, message: '请配置定时规则' }]}
          >
            <Space>
              <Input style={{ width: 280 }} value={cronValue} readOnly />
              <Button
                type="outline"
                onClick={() => {
                  setCronValue(form.getFieldValue('cron_expression') || cronValue)
                  setCronModalOpen(true)
                }}
              >
                配置 Cron
              </Button>
              <span style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
                {formatCronExpression(cronValue)}
              </span>
            </Space>
          </FormItem>
          <FormItem
            label="项目状态"
            field="project_status"
            rules={[{ required: true, message: '请选择项目状态' }]}
            extra="改状态将清空已保存的排除名单"
          >
            <Select
              options={statusOptions.map((s) => ({ label: s, value: s }))}
              onChange={() => setExcludedIds([])}
            />
          </FormItem>
          <FormItem label="项目列表">
            <Space>
              <Button type="outline" onClick={openProjectPicker}>
                选择项目
              </Button>
              <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>
                {excludedIds.length
                  ? `已排除 ${excludedIds.length} 家（其余动态纳入）`
                  : '未排除（该状态下全部动态纳入）'}
              </span>
            </Space>
          </FormItem>
          <FormItem label="是否启用" field="is_active" triggerPropName="checked">
            <Switch />
          </FormItem>
        </Form>
      </Modal>

      <CronGenerator
        visible={cronModalOpen}
        value={cronValue}
        onChange={(cron) => {
          setCronValue(cron)
          form.setFieldValue('cron_expression', cron)
          setCronModalOpen(false)
        }}
        onCancel={() => setCronModalOpen(false)}
      />

      <Modal
        title="选择项目（默认全选，取消勾选即长期排除）"
        visible={projectPickerOpen}
        onCancel={() => setProjectPickerOpen(false)}
        onOk={confirmProjectPicker}
        style={{ width: 560 }}
        unmountOnExit
      >
        <Input.Search
          allowClear
          placeholder="搜索项目简称 / 企业全称"
          value={pickerSearch}
          onChange={setPickerSearch}
          style={{ marginBottom: 12 }}
        />
        <div style={{ marginBottom: 8 }}>
          <Checkbox
            checked={
              filteredPicker.length > 0 &&
              filteredPicker.every((r) => pickerChecked.includes(r.id))
            }
            indeterminate={
              filteredPicker.some((r) => pickerChecked.includes(r.id)) &&
              !filteredPicker.every((r) => pickerChecked.includes(r.id))
            }
            onChange={(checked) => {
              const ids = filteredPicker.map((r) => r.id)
              if (checked) {
                setPickerChecked((prev) => [...new Set([...prev, ...ids])])
              } else {
                const drop = new Set(ids.map(String))
                setPickerChecked((prev) => prev.filter((id) => !drop.has(String(id))))
              }
            }}
          >
            全选当前列表
          </Checkbox>
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {pickerLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-3)' }}>
              加载中…
            </div>
          ) : filteredPicker.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-3)' }}>
              该状态下暂无企业
            </div>
          ) : (
            filteredPicker.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--color-border-2)',
                }}
              >
                <Checkbox
                  checked={pickerChecked.includes(r.id)}
                  onChange={(checked) => {
                    setPickerChecked((prev) =>
                      checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
                    )
                  }}
                />
                <div style={{ marginLeft: 8, minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>
                    {r.project_abbreviation || r.enterprise_full_name || r.id}
                  </div>
                  {r.project_abbreviation && r.enterprise_full_name ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.enterprise_full_name}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal
        title={logsTask ? `执行日志 — ${logsTask.email_subject || logsTask.id}` : '执行日志'}
        visible={logsVisible}
        onCancel={() => setLogsVisible(false)}
        footer={null}
        style={{ width: 800 }}
        unmountOnExit
      >
        <Table
          rowKey="id"
          loading={logsLoading}
          columns={logColumns}
          data={logs}
          pagination={false}
          scroll={{ y: 400 }}
          border={{ wrapper: true, cell: true }}
        />
      </Modal>
    </>
  )
}
