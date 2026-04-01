import React, { useEffect, useState, useCallback } from 'react'
import {
  Table,
  Button,
  Message,
  Space,
  Tabs,
  Modal,
  Form,
  Input,
  Switch,
} from '@arco-design/web-react'
import './ListingProjectProgressPage.css'
import {
  fetchIpoProjectProgressList,
  downloadIpoProjectProgressExport,
  putIpoProjectProgress,
  deleteIpoProjectProgress,
  fetchListingDataChangeLog,
  postListingMatch,
  fetchListingRecipients,
  createListingRecipient,
  updateListingRecipient,
  deleteListingRecipient,
  sendListingRecipientTest,
  getListingProjectProgressShareCurrent,
  createListingProjectProgressShare,
} from '../../api/上市进展'
import CronGenerator from '../../components/CronGenerator'

const TabPane = Tabs.TabPane
const FormItem = Form.Item

function readIsAdmin() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}')
    return u.role === 'admin'
  } catch {
    return false
  }
}

function saveBlobAsCsv(res) {
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `底层项目上市进展_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ListingRecipientsTab() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [showCronModal, setShowCronModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchListingRecipients()
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
    form.resetFields()
    form.setFieldsValue({
      recipient_email: '',
      email_subject: '上市进展通知',
      cron_expression: '0 0 9 * * ? *',
      is_active: true,
    })
    setShowModal(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      recipient_email: record.recipient_email,
      email_subject: record.email_subject || '',
      cron_expression: record.cron_expression || '',
      is_active: record.is_active === 1 || record.is_active === true,
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    try {
      const v = await form.validate()
      const payload = {
        ...v,
        is_active: v.is_active,
      }
      if (editing) {
        await updateListingRecipient(editing.id, payload)
        Message.success('已保存')
      } else {
        await createListingRecipient(payload)
        Message.success('已创建')
      }
      setShowModal(false)
      load()
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const handleDelete = (record) => {
    Modal.confirm({
      title: '确认删除',
      content: '确认删除该收件配置？',
      onOk: async () => {
        try {
          await deleteListingRecipient(record.id)
          Message.success('已删除')
          load()
        } catch (e) {
          Message.error(e.response?.data?.message || '删除失败')
        }
      },
    })
  }

  const handleSendTest = async (record) => {
    try {
      await sendListingRecipientTest(record.id)
      Message.success('测试邮件已发送')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '发送失败')
    }
  }

  const columns = [
    { title: '用户名称', dataIndex: 'user_account', width: 120 },
    { title: '收件人邮箱', dataIndex: 'recipient_email', ellipsis: true },
    { title: '邮件主题', dataIndex: 'email_subject', width: 180, ellipsis: true },
    { title: 'Cron 表达式', dataIndex: 'cron_expression', width: 140, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v) => (v === 1 || v === true ? '启用' : '停用'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '-'),
    },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="primary" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="outline" size="small" onClick={() => handleSendTest(record)}>
            发送邮件
          </Button>
          <Button type="outline" status="danger" size="small" onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={load} loading={loading}>
          刷新
        </Button>
        <Button type="outline" onClick={openAdd}>
          新增
        </Button>
      </Space>
      <Table rowKey="id" loading={loading} columns={columns} data={data} border stripe scroll={{ x: 1100 }} />

      <Modal
        title={editing ? '编辑收件' : '新增收件'}
        visible={showModal}
        onOk={handleSubmit}
        onCancel={() => setShowModal(false)}
        style={{ width: 520 }}
      >
        <Form form={form} layout="vertical">
          <FormItem
            label="收件人邮箱"
            field="recipient_email"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input.TextArea placeholder="多个邮箱用逗号或换行分隔" autoSize={{ minRows: 2, maxRows: 6 }} />
          </FormItem>
          <FormItem label="邮件主题" field="email_subject">
            <Input />
          </FormItem>
          <FormItem
            label="Cron 表达式"
            field="cron_expression"
            extra="与系统配置共用同一套可视化配置（Quartz 7 段）"
          >
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
          <FormItem label="启用" field="is_active" triggerPropName="checked">
            <Switch />
          </FormItem>
        </Form>
      </Modal>

      <CronGenerator
        visible={showCronModal}
        value={form.getFieldValue('cron_expression')}
        onChange={(cron) => {
          form.setFieldValue('cron_expression', cron)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />
    </div>
  )
}

export default function ListingProjectProgressPage() {
  const isAdmin = readIsAdmin()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [rangePreset, setRangePreset] = useState('all')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [ippForm] = Form.useForm()
  const [logOpen, setLogOpen] = useState(false)
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [matching, setMatching] = useState(false)
  const [tableScrollY, setTableScrollY] = useState(520)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareConfig, setShareConfig] = useState({
    enabled: true,
    hasExpiry: false,
    expiryTime: '',
    hasPassword: false,
    password: '',
  })
  const [shareLink, setShareLink] = useState('')

  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 280)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, pageSize, rangePreset: rangePreset === 'all' ? '' : rangePreset }
      const res = await fetchIpoProjectProgressList(params)
      if (res.data?.success) {
        setData(res.data.data?.list || [])
        setTotal(res.data.data?.total || 0)
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, rangePreset])

  useEffect(() => {
    load()
  }, [load])

  const handleExport = async () => {
    try {
      const params = { rangePreset: rangePreset === 'all' ? '' : rangePreset }
      const res = await downloadIpoProjectProgressExport(params)
      saveBlobAsCsv(res)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    }
  }

  const handleMatchAll = async () => {
    setMatching(true)
    try {
      const res = await postListingMatch({})
      if (res.data?.success) {
        const d = res.data.data || {}
        Message.success(`匹配完成：上市信息 ${d.progressCount ?? 0} 条，底层项目 ${d.projectCount ?? 0} 条，新增 ${d.inserted ?? 0} 条`)
        setPage(1)
        load()
      } else {
        Message.error(res.data?.message || '匹配失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '匹配失败')
    } finally {
      setMatching(false)
    }
  }

  const openShareModal = async () => {
    setShareOpen(true)
    try {
      const res = await getListingProjectProgressShareCurrent()
      if (res.data?.success && res.data?.data) {
        const d = res.data.data
        setShareLink(d.shareUrl || '')
        setShareConfig((prev) => ({
          ...prev,
          enabled: true,
          hasExpiry: !!d.hasExpiry,
          expiryTime: d.expiryTime ? String(d.expiryTime).slice(0, 16) : '',
          hasPassword: !!d.hasPassword,
          password: '',
        }))
      }
    } catch {
      // ignore, keep defaults
    }
  }

  const submitShare = async () => {
    if (!shareConfig.enabled) {
      Message.warning('请先开启公共链接分享')
      return
    }
    if (shareConfig.hasExpiry && !shareConfig.expiryTime) {
      Message.warning('请填写过期时间')
      return
    }
    setShareLoading(true)
    try {
      let finalPassword = shareConfig.password
      if (shareConfig.hasPassword && !finalPassword) {
        finalPassword = Math.random().toString(36).slice(-8)
      }
      const res = await createListingProjectProgressShare({
        hasExpiry: shareConfig.hasExpiry,
        expiryTime: shareConfig.hasExpiry ? shareConfig.expiryTime : null,
        hasPassword: shareConfig.hasPassword,
        password: shareConfig.hasPassword ? finalPassword : null,
      })
      if (res.data?.success) {
        const url = res.data.data?.shareUrl || ''
        setShareLink(url)
        const text = shareConfig.hasPassword ? `链接：${url}\n密码：${finalPassword}` : url
        try {
          await navigator.clipboard.writeText(text)
          Message.success('链接已创建并复制')
        } catch {
          Message.success('链接已创建')
        }
        setShareConfig((prev) => ({ ...prev, password: finalPassword || '' }))
      } else {
        Message.error(res.data?.message || '创建失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '创建失败')
    } finally {
      setShareLoading(false)
    }
  }

  const openIppEdit = (record) => {
    setEditing(record)
    ippForm.setFieldsValue({
      fund: record.fund,
      sub: record.sub || '',
      project_name: record.project_name,
      company: record.company,
      inv_amount: record.inv_amount,
      residual_amount: record.residual_amount,
      ratio: record.ratio,
      ct_amount: record.ct_amount,
      ct_residual: record.ct_residual,
      status: record.status,
      board: record.board,
      exchange: record.exchange,
      f_update_time: record.f_update_time || '',
    })
    setEditOpen(true)
  }

  const submitIppEdit = async () => {
    const v = await ippForm.validate()
    try {
      await putIpoProjectProgress(editing.f_id, v)
      Message.success('已保存')
      setEditOpen(false)
      load()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const handleIppDelete = (record) => {
    Modal.confirm({
      title: '确认删除',
      content: '确认删除该条匹配记录？',
      onOk: async () => {
        try {
          await deleteIpoProjectProgress(record.f_id)
          Message.success('已删除')
          load()
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '删除失败')
        }
      },
    })
  }

  const openIppLog = async (record) => {
    setEditing(record)
    setLogOpen(true)
    setLogLoading(true)
    try {
      const res = await fetchListingDataChangeLog({
        tableName: 'ipo_project_progress',
        recordId: String(record.f_id),
      })
      setLogRows(res.data?.success ? res.data.data || [] : [])
    } catch {
      setLogRows([])
    } finally {
      setLogLoading(false)
    }
  }

  const columns = [
    {
      title: '更新日期',
      dataIndex: 'f_update_time',
      width: 120,
      render: (v) => (v ? String(v).slice(0, 10) : '-'),
    },
    { title: '交易所', dataIndex: 'exchange', width: 100 },
    { title: '板块', dataIndex: 'board', width: 100 },
    { title: '审核状态', dataIndex: 'status', width: 120 },
    { title: '归属基金', dataIndex: 'fund', width: 180, ellipsis: true },
    { title: '归属子基金', dataIndex: 'sub', width: 160, ellipsis: true },
    { title: '项目简称', dataIndex: 'project_name', width: 140, ellipsis: true },
    { title: '企业全称', dataIndex: 'company', width: 220, ellipsis: true },
    {
      title: '投资金额',
      dataIndex: 'inv_amount',
      width: 130,
      render: (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    },
    {
      title: '剩余金额',
      dataIndex: 'residual_amount',
      width: 130,
      render: (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    },
    {
      title: '穿透权益占比',
      dataIndex: 'ratio',
      width: 130,
      render: (v) => {
        if (v === null || v === undefined || v === '') return '-'
        const n = Number(v)
        if (!Number.isFinite(n)) return '-'
        return `${(n * 100).toFixed(2)}%`
      },
    },
    {
      title: '穿透投资金额',
      dataIndex: 'ct_amount',
      width: 140,
      render: (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    },
    {
      title: '穿透剩余金额',
      dataIndex: 'ct_residual',
      width: 140,
      render: (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    },
  ]

  if (isAdmin) {
    columns.push({
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="primary" size="small" onClick={() => openIppEdit(record)}>
            编辑
          </Button>
          <Button type="outline" status="success" size="small" onClick={() => openIppLog(record)}>
            日志
          </Button>
          <Button type="outline" status="danger" size="small" onClick={() => handleIppDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    })
  }

  return (
    <div className="listing-project-progress-page" style={{ padding: '0 16px' }}>
      <Tabs defaultActiveTab="progress" type="line" style={{ marginTop: 0, marginBottom: 8 }}>
        <TabPane key="progress" title="底层项目上市进展">
          <div style={{ marginBottom: 8 }}>
            <Space wrap>
              <Button type="primary" onClick={load} loading={loading}>
                刷新
              </Button>
              <Button onClick={handleExport}>导出 CSV</Button>
              <Button type="primary" status="danger" onClick={openShareModal}>
                发布
              </Button>
              <Button type="outline" status="success" onClick={handleMatchAll} loading={matching}>
                匹配数据
              </Button>
              <span>时间范围：</span>
              <Button
                type={rangePreset === 'yesterday' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => {
                  setPage(1)
                  setRangePreset('yesterday')
                }}
              >
                昨日
              </Button>
              <Button
                type={rangePreset === 'week' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => {
                  setPage(1)
                  setRangePreset('week')
                }}
              >
                本周
              </Button>
              <Button
                type={rangePreset === 'month' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => {
                  setPage(1)
                  setRangePreset('month')
                }}
              >
                本月
              </Button>
              <Button
                type={rangePreset === 'all' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => {
                  setPage(1)
                  setRangePreset('all')
                }}
              >
                全部
              </Button>
            </Space>
          </div>
          <Table
            rowKey="f_id"
            loading={loading}
            columns={columns}
            data={data}
            border
            stripe
            scroll={{ x: isAdmin ? 2200 : 2000, y: tableScrollY }}
            pagination={{
              current: page,
              pageSize,
              total,
              sizeCanChange: true,
              pageSizeChangeResetCurrent: true,
              showTotal: true,
              showJumper: true,
              pageSizeOptions: [20, 50, 100, 200],
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
        </TabPane>
        <TabPane key="recipient" title="收件管理">
          <ListingRecipientsTab />
        </TabPane>
      </Tabs>

      <Modal
        title="公共链接分享"
        visible={shareOpen}
        onOk={submitShare}
        onCancel={() => setShareOpen(false)}
        confirmLoading={shareLoading}
        okText={shareLink ? '更新链接' : '创建链接'}
        style={{ width: 520 }}
      >
        <div style={{ marginBottom: 12 }}>
          <Space>
            <span style={{ fontWeight: 500 }}>公共链接分享</span>
            <Switch
              checked={shareConfig.enabled}
              onChange={(checked) => setShareConfig((prev) => ({ ...prev, enabled: checked }))}
            />
          </Space>
        </div>
        {shareLink && (
          <div style={{ marginBottom: 12 }}>
            <Input
              value={shareLink}
              readOnly
              addAfter={
                <Button
                  type="text"
                  size="small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareLink)
                      Message.success('链接已复制')
                    } catch {
                      Message.warning('复制失败，请手动复制')
                    }
                  }}
                >
                  复制链接
                </Button>
              }
            />
          </div>
        )}
        {shareConfig.enabled && (
          <>
            <div style={{ marginBottom: 10 }}>
              <Space>
                <Switch
                  checked={shareConfig.hasExpiry}
                  onChange={(checked) =>
                    setShareConfig((prev) => ({
                      ...prev,
                      hasExpiry: checked,
                      expiryTime: checked ? prev.expiryTime : '',
                    }))
                  }
                />
                <span>有效期</span>
              </Space>
              {shareConfig.hasExpiry && (
                <Input
                  style={{ marginTop: 8 }}
                  type="datetime-local"
                  value={shareConfig.expiryTime}
                  onChange={(v) => setShareConfig((prev) => ({ ...prev, expiryTime: v }))}
                />
              )}
            </div>
            <div>
              <Space>
                <Switch
                  checked={shareConfig.hasPassword}
                  onChange={(checked) =>
                    setShareConfig((prev) => ({
                      ...prev,
                      hasPassword: checked,
                      password: checked ? prev.password : '',
                    }))
                  }
                />
                <span>密码保护</span>
              </Space>
              {shareConfig.hasPassword && (
                <Input.Password
                  style={{ marginTop: 8 }}
                  value={shareConfig.password}
                  onChange={(v) => setShareConfig((prev) => ({ ...prev, password: v }))}
                  placeholder="留空将自动生成密码"
                />
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal
        title="编辑项目上市进展"
        visible={editOpen}
        onOk={submitIppEdit}
        onCancel={() => setEditOpen(false)}
        style={{ width: 560 }}
      >
        <Form form={ippForm} layout="vertical">
          <FormItem label="归属基金" field="fund" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="归属子基金" field="sub">
            <Input />
          </FormItem>
          <FormItem label="项目简称" field="project_name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="企业全称" field="company" rules={[{ required: true }]}>
            <Input.TextArea />
          </FormItem>
          <FormItem label="投资金额" field="inv_amount" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="剩余金额" field="residual_amount" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="穿透权益占比" field="ratio" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="穿透投资金额" field="ct_amount" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="穿透剩余金额" field="ct_residual" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="审核状态" field="status" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="板块" field="board" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="交易所" field="exchange" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="更新日期时间" field="f_update_time" rules={[{ required: true }]}>
            <Input />
          </FormItem>
        </Form>
      </Modal>

      <Modal
        title="变更日志"
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
            rowKey="id"
            columns={[
              { title: '字段', dataIndex: 'changed_field', width: 120 },
              { title: '旧值', dataIndex: 'old_value', ellipsis: true },
              { title: '新值', dataIndex: 'new_value', ellipsis: true },
              { title: '操作人', dataIndex: 'change_user_account', width: 100 },
              { title: '时间', dataIndex: 'change_time', width: 170 },
            ]}
            data={logRows}
            pagination={false}
          />
        )}
      </Modal>
    </div>
  )
}
