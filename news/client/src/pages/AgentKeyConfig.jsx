import React, { useEffect, useState } from 'react'
import { Button, Input, Message, Modal, Pagination, Popconfirm, Select, Tabs } from '@arco-design/web-react'
import axios from '../utils/axios'
import AdminListTable, { AdminOps, formatAdminDateTime } from '../components/AdminListTable'
import SheetModal, { SheetActions } from '../components/SheetModal'

const TabPane = Tabs.TabPane
const TextArea = Input.TextArea
const Option = Select.Option

const emptyForm = {
  display_name: '',
  assignee_user_id: '',
  remark: '',
  ip_allowlist: '',
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => Message.success('已复制'),
      () => Message.warning('复制失败，请手动选择复制')
    )
    return
  }
  Message.warning('请手动选择复制')
}

function AgentKeyConfig() {
  const [pane, setPane] = useState('keys')
  const [keys, setKeys] = useState([])
  const [keyOptions, setKeyOptions] = useState([])
  const [keyTotal, setKeyTotal] = useState(0)
  const [keyPage, setKeyPage] = useState(1)
  const [keyLoading, setKeyLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [assignees, setAssignees] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [secret, setSecret] = useState(null)
  const [logs, setLogs] = useState([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logLoading, setLogLoading] = useState(false)
  const [logClientId, setLogClientId] = useState('')

  const loadAssignees = async () => {
    try {
      const res = await axios.get('/api/system/agent/assignees')
      if (res.data?.success) setAssignees(res.data.data || [])
    } catch (err) {
      Message.error(err.response?.data?.message || '加载用户失败')
    }
  }

  const loadKeyOptions = async () => {
    try {
      const res = await axios.get('/api/system/agent/keys', { params: { page: 1, pageSize: 50 } })
      if (res.data?.success) setKeyOptions(res.data.data.list || [])
    } catch {
      setKeyOptions([])
    }
  }

  const loadKeys = async (page = keyPage) => {
    setKeyLoading(true)
    try {
      const res = await axios.get('/api/system/agent/keys', {
        params: { page, pageSize: 20, keyword: keyword.trim() },
      })
      if (res.data?.success) {
        setKeys(res.data.data.list || [])
        setKeyTotal(res.data.data.total || 0)
        setKeyPage(res.data.data.page || page)
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '加载凭证失败')
    } finally {
      setKeyLoading(false)
    }
  }

  const loadLogs = async (page = logPage, clientId = logClientId) => {
    setLogLoading(true)
    try {
      const res = await axios.get('/api/system/agent/logs', {
        params: { page, pageSize: 20, client_id: clientId || undefined },
      })
      if (res.data?.success) {
        setLogs(res.data.data.list || [])
        setLogTotal(res.data.data.total || 0)
        setLogPage(res.data.data.page || page)
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '加载日志失败')
    } finally {
      setLogLoading(false)
    }
  }

  useEffect(() => {
    loadAssignees()
    loadKeys(1)
    loadKeyOptions()
  }, [])

  const openLogs = (clientId) => {
    setLogClientId(clientId || '')
    setPane('logs')
    loadLogs(1, clientId || '')
  }

  const changeStatus = async (row, status) => {
    try {
      const res = await axios.put(`/api/system/agent/keys/${row.id}/status`, { status })
      if (res.data?.success) {
        Message.success(res.data.message || '已更新')
        loadKeys(keyPage)
        loadKeyOptions()
      } else {
        Message.error(res.data?.message || '操作失败')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '操作失败')
    }
  }

  const rotate = async (row) => {
    try {
      const res = await axios.post(`/api/system/agent/keys/${row.id}/rotate`)
      if (res.data?.success) {
        setSecret({
          ...res.data.data,
          assignee_account: row.assignee_account,
          display_name: row.display_name,
        })
        loadKeys(keyPage)
        loadKeyOptions()
      } else {
        Message.error(res.data?.message || '重置失败')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '重置失败')
    }
  }

  const submit = async () => {
    if (!form.display_name.trim()) {
      Message.warning('请填写名称')
      return
    }
    if (!form.assignee_user_id) {
      Message.warning('请选择用户')
      return
    }
    setSaving(true)
    try {
      const res = await axios.post('/api/system/agent/keys', form)
      if (res.data?.success) {
        setShowForm(false)
        setForm(emptyForm)
        setSecret(res.data.data)
        Message.success('已创建，请复制密钥')
        loadKeys(1)
        loadKeyOptions()
      } else {
        Message.error(res.data?.message || '创建失败')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const secretText = secret
    ? `client_id: ${secret.client_id}\nclient_secret: ${secret.client_secret}`
    : ''

  const keyColumns = [
    { title: '名称', dataIndex: 'display_name', width: 160 },
    { title: '发给', dataIndex: 'assignee_account', width: 140, render: (v) => v || '未指定' },
    { title: '调用方 ID', dataIndex: 'client_id', width: 180 },
    {
      title: '密钥前缀',
      dataIndex: 'secret_prefix',
      width: 100,
      render: (v) => (v ? `${v}…` : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => (v === 'active' ? '启用' : '已关闭'),
    },
    {
      title: '最近调用',
      dataIndex: 'last_called_at',
      width: 120,
      render: (v) => formatAdminDateTime(v),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 120,
      render: (v) => formatAdminDateTime(v),
    },
    {
      title: '操作',
      width: 280,
      render: (_, row) => (
        <AdminOps>
          {row.status === 'active' ? (
            <Popconfirm
              title="关闭后这把密钥和已发出的访问令牌会立即失效。"
              onOk={() => changeStatus(row, 'disabled')}
            >
              <Button>关闭</Button>
            </Popconfirm>
          ) : (
            <Button onClick={() => changeStatus(row, 'active')}>启用</Button>
          )}
          <Popconfirm title="重置后旧密钥和旧访问令牌立即失效，新密钥只显示一次。" onOk={() => rotate(row)}>
            <Button>重置密钥</Button>
          </Popconfirm>
          <Button onClick={() => openLogs(row.client_id)}>日志</Button>
        </AdminOps>
      ),
    },
  ]

  const logColumns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 120,
      render: (v) => formatAdminDateTime(v),
    },
    { title: '凭证', dataIndex: 'display_name', width: 140 },
    { title: '用户', dataIndex: 'assignee_account', width: 120, render: (v) => v || '-' },
    { title: '动作', dataIndex: 'action_label', width: 140 },
    { title: '资源', dataIndex: 'resource', width: 180, render: (v) => v || '-' },
    { title: '状态', dataIndex: 'http_status', width: 80, render: (v) => (v == null ? '-' : v) },
    { title: '来源', dataIndex: 'ip', width: 140, render: (v) => v || '-' },
    { title: '请求号', dataIndex: 'request_id', width: 180, render: (v) => v || '-' },
  ]

  return (
    <div>
      <Tabs className="agent-config" activeTab={pane} onChange={(key) => { setPane(key); if (key === 'logs') loadLogs(1, logClientId) }}>
        <TabPane key="keys" title="调用凭证">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Input
              style={{ width: 240 }}
              placeholder="名称、调用方 ID 或账号"
              value={keyword}
              onChange={setKeyword}
              onPressEnter={() => loadKeys(1)}
              allowClear
            />
            <Button onClick={() => loadKeys(1)}>查询</Button>
            <Button type="primary" onClick={() => { setForm(emptyForm); setShowForm(true) }}>新建凭证</Button>
          </div>
          <AdminListTable
            rowKey="id"
            columns={keyColumns}
            data={keys}
            loading={keyLoading}
            page={keyPage}
            pageSize={20}
            pagination={false}
          />
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Pagination
              current={keyPage}
              pageSize={20}
              total={keyTotal}
              onChange={(page) => loadKeys(page)}
              showTotal
            />
          </div>
        </TabPane>
        <TabPane key="logs" title="调用日志">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Select
              style={{ width: 280 }}
              placeholder="全部凭证"
              allowClear
              value={logClientId || undefined}
              onChange={(value) => setLogClientId(value || '')}
            >
              {keyOptions.map((row) => (
                <Option key={row.client_id} value={row.client_id}>
                  {row.display_name}（{row.assignee_account || row.client_id}）
                </Option>
              ))}
            </Select>
            <Button onClick={() => loadLogs(1, logClientId)}>查询</Button>
          </div>
          <AdminListTable
            rowKey="id"
            columns={logColumns}
            data={logs}
            loading={logLoading}
            page={logPage}
            pageSize={20}
            pagination={false}
          />
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Pagination
              current={logPage}
              pageSize={20}
              total={logTotal}
              onChange={(page) => loadLogs(page, logClientId)}
              showTotal
            />
          </div>
        </TabPane>
      </Tabs>

      <SheetModal visible={showForm} title="新建 agent 凭证" onClose={() => !saving && setShowForm(false)}>
        <div className="modal-body" style={{ padding: '8px 20px 0' }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>名称</div>
            <Input
              value={form.display_name}
              maxLength={100}
              placeholder="例如：张三的报告助手"
              onChange={(value) => setForm((prev) => ({ ...prev, display_name: value }))}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>发给用户</div>
            <Select
              placeholder="选择系统用户"
              value={form.assignee_user_id || undefined}
              onChange={(value) => setForm((prev) => ({ ...prev, assignee_user_id: value }))}
              showSearch
            >
              {assignees.map((user) => (
                <Option key={user.id} value={user.id}>
                  {`${user.account}${user.company_name ? `（${user.company_name}）` : ''}`}
                </Option>
              ))}
            </Select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>来源 IP 白名单（可选，逗号分隔）</div>
            <Input
              value={form.ip_allowlist}
              placeholder="不填则不限制来源"
              onChange={(value) => setForm((prev) => ({ ...prev, ip_allowlist: value }))}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>备注</div>
            <TextArea
              value={form.remark}
              maxLength={255}
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={(value) => setForm((prev) => ({ ...prev, remark: value }))}
            />
          </div>
        </div>
        <SheetActions
          onCancel={() => setShowForm(false)}
          submitLabel="创建"
          submitLoading={saving}
          onSubmitClick={submit}
        />
      </SheetModal>

      <Modal
        title="密钥只显示这一次"
        visible={!!secret}
        maskClosable={false}
        onCancel={() => setSecret(null)}
        onOk={() => setSecret(null)}
        okText="我已复制"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <p style={{ marginTop: 0 }}>
          把下面的调用方 ID 和密钥交给{secret?.assignee_account ? ` ${secret.assignee_account}` : '对应用户'}。
          关闭后无法再查看。若泄露，在列表里关闭这把密钥即可。
        </p>
        <TextArea value={secretText} readOnly autoSize={{ minRows: 4, maxRows: 8 }} />
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => copyText(secretText)}>复制</Button>
        </div>
      </Modal>
    </div>
  )
}

export default AgentKeyConfig
