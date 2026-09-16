import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Table, Button, Message, Space, Modal, Form, Input, Select, Switch } from '@arco-design/web-react'
import axios from '../../utils/axios'
import CronGenerator from '../../components/CronGenerator'
import SheetModal, { SheetActions, SheetViewer, sheetPopupContainer } from '../../components/SheetModal'
import { ListOpButton, ListOps } from '../../components/listTableOps'
import '../../styles/listTable.css'
import './ListingIpoProjectPage.css'
import './listingTableColumns.css'
import {
  buildListingNumericColumn,
  formatListingAmount,
  formatListingPercent,
  sumColumnWidths,
} from './listingTableColumns'
import {
  fetchIpoProjectList,
  fetchIpoProjectSqlSyncSetting,
  putIpoProjectSqlSyncSetting,
  postIpoProjectSqlSyncPreview,
  postIpoProjectSqlSyncRun,
  downloadIpoProjectExport,
  downloadIpoProjectBatchImportTemplate,
  postIpoProjectBatchImportUpload,
  createIpoProject,
  updateIpoProject,
  deleteIpoProject,
  fetchListingDataChangeLog,
} from '../../api/listing'
import { normalizeRecordList, resolveRecordId } from '../../utils/recordId'
import { getUser } from '../../utils/auth'

const FormItem = Form.Item
const Option = Select.Option

function ListingIpoProjectSheet({ visible, title, form, onClose, onSubmit }) {
  return (
    <SheetModal visible={visible} title={title} onClose={onClose}>
      <Form form={form} layout="vertical" className="enterprise-form enterprise-form--sheet">
        <div className="modal-body enterprise-form-grid">
          <FormItem label="项目简称" field="project_name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="归属基金" field="fund" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="归属子基金" field="sub">
            <Input />
          </FormItem>
          <FormItem label="穿透权益占比" field="ratio" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="企业全称" field="company" rules={[{ required: true }]} className="form-span-2">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </FormItem>
          <FormItem label="投资金额" field="inv_amount" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="剩余金额" field="residual_amount" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="穿透投资金额" field="ct_amount" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="穿透剩余金额" field="ct_residual" rules={[{ required: true }]}>
            <Input />
          </FormItem>
        </div>
        <SheetActions onCancel={onClose} submitLabel="确定" submitType="button" onSubmitClick={onSubmit} />
      </Form>
    </SheetModal>
  )
}

function readIsAdmin() {
  try {
    const u = getUser() || {}
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
  a.download = `底层项目表_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** responseType 为 blob 时，服务端 JSON 错误需从 Blob 解析 message */
async function messageFromAxiosError(e, fallback = '请求失败') {
  const d = e?.response?.data
  if (d instanceof Blob) {
    try {
      const text = await d.text()
      try {
        const j = JSON.parse(text)
        if (j && typeof j.message === 'string') return j.message
      } catch {
        if (text && text.trim()) return text.trim()
      }
    } catch {
      /* ignore */
    }
  }
  if (d && typeof d === 'object' && typeof d.message === 'string') return d.message
  return e?.message || fallback
}

export default function ListingIpoProjectPage() {
  const isAdmin = useMemo(() => readIsAdmin(), [])
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [creatorUserId, setCreatorUserId] = useState('')
  const [userOptions, setUserOptions] = useState([])
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [dbList, setDbList] = useState([])
  const [sqlForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [showCronModal, setShowCronModal] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [newForm] = Form.useForm()
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm] = Form.useForm()
  const [logOpen, setLogOpen] = useState(false)
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [tableScrollY, setTableScrollY] = useState(520)

  const formatAmount = formatListingAmount

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page,
        pageSize,
        keyword: kwSearch || undefined,
        creatorUserId: isAdmin && creatorUserId ? creatorUserId : undefined,
      }
      const res = await fetchIpoProjectList(params)
      if (res.data?.success) {
        setData(normalizeRecordList(res.data.data?.list || []))
        setTotal(res.data.data?.total || 0)
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, kwSearch, creatorUserId, isAdmin])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!isAdmin) return
    (async () => {
      try {
        const res = await axios.get('/api/auth/users', { params: { page: 1, pageSize: 500 } })
        if (res.data?.success) {
          setUserOptions(res.data.data || [])
        }
      } catch {
        setUserOptions([])
      }
    })()
  }, [isAdmin])

  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 290)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const loadSqlSettingByDb = async (externalDbConfigId) => {
    if (!externalDbConfigId) {
      sqlForm.setFieldsValue({
        external_db_config_id: '',
        sql_text: '',
        is_enabled: true,
        cron_expression: '',
      })
      return
    }
    try {
      const res = await fetchIpoProjectSqlSyncSetting(externalDbConfigId)
      const d = res.data?.data || {}
      sqlForm.setFieldsValue({
        external_db_config_id: externalDbConfigId,
        sql_text: d.sql_text || '',
        is_enabled: d.is_enabled !== 0,
        cron_expression: d.cron_expression || '',
      })
    } catch {
      sqlForm.setFieldsValue({
        external_db_config_id: externalDbConfigId,
        sql_text: '',
        is_enabled: true,
        cron_expression: '',
      })
    }
  }

  const openSqlModal = async () => {
    setSqlModalOpen(true)
    const dbs = await (async () => {
      try {
        const res = await axios.get('/api/system/database-configs', { params: { page: 1, pageSize: 100 } })
        if (res.data?.success) {
          const list = (res.data.data || []).filter((d) => d.is_active === 1 || d.is_active === true)
          setDbList(list)
          return list
        }
      } catch {
        /* ignore */
      }
      setDbList([])
      return []
    })()
    try {
      const res = await fetchIpoProjectSqlSyncSetting()
      const d = res.data?.data || {}
      const selectedDb = d.external_db_config_id || dbs[0]?.id || ''
      await loadSqlSettingByDb(selectedDb)
    } catch {
      const selectedDb = dbs[0]?.id || ''
      await loadSqlSettingByDb(selectedDb)
    }
  }

  const handleSaveSetting = async () => {
    let v
    try {
      v = await sqlForm.validate()
    } catch {
      return
    }
    setSaving(true)
    try {
      await putIpoProjectSqlSyncSetting({
        external_db_config_id: v.external_db_config_id || null,
        sql_text: (v.sql_text || '').trim(),
        is_enabled: v.is_enabled ? 1 : 0,
        cron_expression: (v.cron_expression || '').trim() || null,
      })
      Message.success('已保存')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async () => {
    let v
    try {
      v = await sqlForm.validate(['external_db_config_id', 'sql_text'])
    } catch {
      return
    }
    setPreviewing(true)
    try {
      const res = await postIpoProjectSqlSyncPreview({
        external_db_config_id: v.external_db_config_id,
        sql_text: (v.sql_text || '').trim(),
      })
      if (res.data?.success) {
        const sample = res.data.data?.sample || []
        Message.info(`共 ${res.data.data?.rowCount ?? 0} 行，预览前 ${sample.length} 条已输出到控制台`)
        console.log('[上市进展 SQL 预览]', sample)
      } else {
        Message.error(res.data?.message || '预览失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  const handleRunSync = async () => {
    let v
    try {
      v = await sqlForm.validate()
    } catch {
      return
    }
    setRunning(true)
    try {
      const res = await postIpoProjectSqlSyncRun({
        external_db_config_id: v.external_db_config_id,
        sql_text: (v.sql_text || '').trim(),
        is_enabled: v.is_enabled ? 1 : 0,
      })
      if (res.data?.success) {
        const d = res.data.data || {}
        const snap =
          d.ai_snapshot_saved != null || d.ai_snapshot_restored != null
            ? `；快照 ${d.ai_snapshot_saved ?? 0} 条，回填 ${d.ai_snapshot_restored ?? 0} 行`
            : ''
        Message.success(
          `同步完成：新增 ${d.inserted ?? 0}，更新 ${d.updated ?? 0}，跳过 ${d.skipped ?? 0}${snap}`
        )
        setSqlModalOpen(false)
        load()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '同步失败')
    } finally {
      setRunning(false)
    }
  }

  const handleExport = async () => {
    try {
      const res = await downloadIpoProjectExport({
        keyword: kwSearch || undefined,
        creatorUserId: isAdmin && creatorUserId ? creatorUserId : undefined,
      })
      saveBlobAsCsv(res)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(await messageFromAxiosError(e, '导出失败'))
    }
  }

  const handleDownloadImportTemplate = async () => {
    try {
      const res = await downloadIpoProjectBatchImportTemplate()
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '底层项目批量导入模板.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(await messageFromAxiosError(e, '模板下载失败'))
    }
  }

  const submitNew = async () => {
    const v = await newForm.validate()
    try {
      await createIpoProject(v)
      Message.success('已创建')
      setNewOpen(false)
      load()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '创建失败')
    }
  }

  const submitImport = async () => {
    if (!importFile) {
      Message.error('请先选择 Excel 文件')
      return
    }
    const formData = new FormData()
    formData.append('file', importFile)
    setImporting(true)
    try {
      const res = await postIpoProjectBatchImportUpload(formData)
      if (res.data?.success) {
        Message.success(res.data?.message || `已导入 ${res.data.data?.inserted ?? 0} 条`)
        setImportOpen(false)
        setImportFile(null)
        load()
      } else {
        Message.error(res.data?.message || '导入失败')
      }
    } catch (e) {
      Message.error(await messageFromAxiosError(e, '导入失败'))
    } finally {
      setImporting(false)
    }
  }

  const openEdit = (record) => {
    setEditing(record)
    editForm.setFieldsValue({
      project_name: record.project_name,
      company: record.company,
      inv_amount: record.inv_amount,
      residual_amount: record.residual_amount,
      ratio: record.ratio,
      ct_amount: record.ct_amount,
      ct_residual: record.ct_residual,
      fund: record.fund,
      sub: record.sub || '',
    })
    setEditOpen(true)
  }

  const submitEdit = async () => {
    const v = await editForm.validate()
    try {
      await updateIpoProject(editing.f_id, v)
      Message.success('已保存')
      setEditOpen(false)
      load()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const handleDelete = (record) => {
    Modal.confirm({
      title: '确认删除',
      content: '确认删除该底层项目？',
      onOk: async () => {
        try {
          await deleteIpoProject(record.f_id)
          Message.success('已删除')
          load()
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '删除失败')
        }
      },
    })
  }

  const openLog = async (record) => {
    setEditing(record)
    setLogOpen(true)
    setLogLoading(true)
    try {
      const res = await fetchListingDataChangeLog({
        tableName: 'ipo_project',
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
      title: '项目编号',
      dataIndex: 'project_no',
      key: 'project_no',
      width: 160,
      fixed: 'left',
      ellipsis: true,
      tooltip: true,
    },
    {
      title: '归属基金',
      dataIndex: 'fund',
      key: 'fund',
      width: 200,
      fixed: 'left',
      ellipsis: true,
      tooltip: true,
    },
    {
      title: '归属子基金/SPV',
      dataIndex: 'sub',
      key: 'sub',
      width: 220,
      fixed: 'left',
      ellipsis: true,
      tooltip: true,
    },
    {
      title: '项目简称',
      dataIndex: 'project_name',
      key: 'project_name',
      width: 120,
      fixed: 'left',
      ellipsis: true,
      tooltip: true,
    },
    { title: '企业全称', dataIndex: 'company', key: 'company', width: 260, ellipsis: true, tooltip: true },
    buildListingNumericColumn('投资成本', 'inv_amount', 140, (v) => formatAmount(v)),
    buildListingNumericColumn('剩余投资成本', 'residual_amount', 150, (v) => formatAmount(v)),
    {
      title: '穿透权益占比',
      dataIndex: 'ratio',
      key: 'ratio',
      width: 130,
      render: (v) => formatListingPercent(v, true),
    },
    buildListingNumericColumn('穿透投资成本', 'ct_amount', 140, (v) => formatAmount(v)),
    buildListingNumericColumn('穿透剩余成本', 'ct_residual', 150, (v) => formatAmount(v)),
    {
      title: '创建用户',
      dataIndex: 'creator_account',
      key: 'creator_account',
      width: 100,
      ellipsis: true,
      tooltip: true,
    },
    {
      title: '创建时间',
      dataIndex: 'F_CreatorTime',
      key: 'F_CreatorTime',
      width: 120,
      render: (v) => (v ? String(v).slice(0, 10) : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 168,
      fixed: 'right',
      className: 'list-ops-col',
      render: (_, record) => (
        <ListOps>
          <ListOpButton name="编辑" onClick={() => openEdit(record)} />
          <ListOpButton name="日志" onClick={() => openLog(record)} />
          <ListOpButton name="删除" onClick={() => handleDelete(record)} />
        </ListOps>
      ),
    },
  ]

  const tableScrollX = useMemo(() => sumColumnWidths(columns), [columns])

  return (
    <div
      className="listing-ipo-project-page list-table-page"
      style={{ padding: '4px 16px 16px', '--list-ops-col-width': '168px' }}
    >
      <div className="listing-page-header" style={{ marginBottom: 8, fontSize: 18, fontWeight: 600 }}>
        底层项目
      </div>
      <div className="listing-page-header" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            style={{ width: 200 }}
            placeholder="关键词"
            value={keyword}
            onChange={setKeyword}
            onPressEnter={() => {
              setPage(1)
              setKwSearch(keyword.trim())
            }}
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
          {isAdmin && (
            <Select
              style={{ width: 200 }}
              placeholder="按创建用户筛选"
              allowClear
              value={creatorUserId || undefined}
              onChange={(v) => {
                setCreatorUserId(v || '')
                setPage(1)
              }}
            >
              {userOptions.map((u) => (
                <Option key={u.id} value={u.id}>
                  {u.account}
                </Option>
              ))}
            </Select>
          )}
          <Button onClick={load} loading={loading}>
            刷新
          </Button>
          <Button onClick={handleExport}>导出 CSV</Button>
          <Button type="outline" onClick={() => setNewOpen(true)}>
            新增
          </Button>
          <Button type="outline" onClick={() => setImportOpen(true)}>
            批量导入
          </Button>
          <Button onClick={openSqlModal}>定时更新（业务库 SQL）</Button>
        </Space>
      </div>
      <Table
        rowKey={resolveRecordId}
        loading={loading}
        columns={columns}
        data={data}
        className="list-table"
        border
        stripe
        scroll={{ x: tableScrollX, y: tableScrollY }}
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

      <ListingIpoProjectSheet
        visible={newOpen}
        title="新增底层项目"
        form={newForm}
        onClose={() => setNewOpen(false)}
        onSubmit={submitNew}
      />

      <SheetModal
        visible={importOpen}
        title="批量导入底层项目"
        onClose={() => {
          setImportOpen(false)
          setImportFile(null)
        }}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <div className="form-group form-span-2">
              <label>1. 下载模板</label>
              <p className="form-hint">请先下载模板，按表头填写后再上传，表头不可修改。</p>
              <Button type="outline" size="small" onClick={handleDownloadImportTemplate}>
                下载模板
              </Button>
            </div>
            <div className="form-group form-span-2">
              <label>2. 上传文件</label>
              <p className="form-hint">选择填写好的 Excel 文件导入，仅支持 .xlsx / .xls。</p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  setImportFile(file)
                }}
              />
              {importFile ? (
                <p className="form-hint">已选择：{importFile.name}</p>
              ) : null}
            </div>
            <p className="form-hint form-span-4">
              注意：列表页「导出 CSV」与导入模板字段不同，不能直接用于回传导入。
            </p>
          </div>
          <SheetActions
            onCancel={() => {
              setImportOpen(false)
              setImportFile(null)
            }}
            submitLabel="导入"
            submitType="button"
            onSubmitClick={submitImport}
            submitLoading={importing}
          />
        </div>
      </SheetModal>

      <ListingIpoProjectSheet
        visible={editOpen}
        title="编辑底层项目"
        form={editForm}
        onClose={() => setEditOpen(false)}
        onSubmit={submitEdit}
      />

      <SheetViewer visible={logOpen} title="变更日志" onClose={() => setLogOpen(false)}>
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
            scroll={{ y: 360 }}
          />
        )}
      </SheetViewer>

      <SheetModal
        visible={sqlModalOpen}
        title="业务库 SQL 同步（底层项目表）"
        onClose={() => setSqlModalOpen(false)}
      >
        <Form form={sqlForm} layout="vertical" className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <p className="form-hint form-span-4">
              仅支持只读 SQL（SELECT / WITH）。字段名需与下列名称一致（顺序可不同）：project_name、company、
              unified_credit_code（可选）、fund、sub（可选）、inv_amount、residual_amount、ratio、ct_amount、ct_residual。去重键：归属基金
              + 归属子基金 + 企业全称（当前用户范围内）。
            </p>
            <FormItem
              label="业务数据库连接"
              field="external_db_config_id"
              rules={[{ required: true, message: '请选择连接' }]}
              className="form-span-2"
            >
              <Select
                placeholder="请选择"
                allowClear
                showSearch
                getPopupContainer={sheetPopupContainer}
                onChange={(v) => {
                  loadSqlSettingByDb(v || '')
                }}
              >
                {dbList.map((d) => (
                  <Option key={d.id} value={d.id}>
                    {d.name} ({d.host})
                  </Option>
                ))}
              </Select>
            </FormItem>
            <FormItem label="是否启用" field="is_enabled" triggerPropName="checked">
              <Switch checkedText="启用" uncheckedText="禁用" />
            </FormItem>
            <FormItem
              label="底层项目同步 Cron（可选）"
              field="cron_expression"
              extra="独立定时任务，与「系统设置 → 上市数据配置」中的交易所爬虫互不干扰。"
            >
              <Input
                placeholder="点击右侧按钮配置 Cron（Quartz）"
                readOnly
                addAfter={
                  <Button type="text" size="small" onClick={() => setShowCronModal(true)}>
                    配置
                  </Button>
                }
              />
            </FormItem>
            <FormItem
              label="只读 SQL"
              field="sql_text"
              rules={[{ required: true, message: '请填写 SQL' }]}
              className="form-span-4"
            >
              <Input.TextArea
                placeholder="仅支持 SELECT / WITH"
                autoSize={{ minRows: 5, maxRows: 8 }}
              />
            </FormItem>
          </div>
          <SheetActions
            onCancel={() => setSqlModalOpen(false)}
            cancelLabel="关闭"
            extra={
              <>
                <button type="button" className="btn-test" onClick={handleSaveSetting} disabled={saving}>
                  {saving ? '处理中...' : '保存配置'}
                </button>
                <button type="button" className="btn-test" onClick={handlePreview} disabled={previewing}>
                  {previewing ? '处理中...' : '预览结果'}
                </button>
              </>
            }
            submitLabel="执行同步"
            submitType="button"
            onSubmitClick={handleRunSync}
            submitLoading={running}
          />
        </Form>
      </SheetModal>

      <CronGenerator
        visible={showCronModal}
        value={sqlForm.getFieldValue('cron_expression')}
        onChange={(cron) => {
          sqlForm.setFieldValue('cron_expression', cron)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />
    </div>
  )
}
