import React, { useEffect, useState, useCallback, useMemo, useLayoutEffect, useRef } from 'react'
import { Table, Button, Message, Space, Input, Modal, Form, Select } from '@arco-design/web-react'
import SheetModal, { SheetActions, SheetViewer } from '../../components/SheetModal'
import { ListOpButton, ListOps } from '../../components/listTableOps'
import '../../styles/listTable.css'
import './ListingIpoProgressPage.css'
import {
  fetchIpoProgressList,
  fetchIpoProgressFilterOptions,
  fetchIpoProgressStats,
  fetchIpoProgressRecheck,
  downloadIpoProgressExport,
  createIpoProgress,
  updateIpoProgress,
  deleteIpoProgress,
  fetchListingDataChangeLog,
} from '../../api/listing'
import { normalizeRecordList, resolveRecordId } from '../../utils/recordId'
import { getUser } from '../../utils/auth'

const FormItem = Form.Item
const Option = Select.Option

const LISTING_PAGE_SIZE_OPTIONS = [10, 15, 20, 50, 100, 200]

function readIsAdmin() {
  try {
    const u = getUser() || {}
    return u.role === 'admin'
  } catch {
    return false
  }
}

function formatLocalDateTimeForInput() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function saveBlobAsCsv(res) {
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `上市信息表_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ListingIpoProgressPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [sourceCategory, setSourceCategory] = useState('')
  const [exchange, setExchange] = useState('')
  const [board, setBoard] = useState('')
  const [status, setStatus] = useState('')
  const [timelineConfirmed, setTimelineConfirmed] = useState('')
  const isAdmin = useMemo(() => readIsAdmin(), [])

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [logOpen, setLogOpen] = useState(false)
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmDetail, setConfirmDetail] = useState(null)
  const [tableScrollY, setTableScrollY] = useState(360)
  const tableScrollAreaRef = useRef(null)
  const [stats, setStats] = useState({
    yesterday: '',
    year: new Date().getFullYear(),
    byExchange: {
      深交所: { yesterday: 0, year: 0 },
      上交所: { yesterday: 0, year: 0 },
      北交所: { yesterday: 0, year: 0 },
      港交所: { yesterday: 0, year: 0 },
    },
  })
  const [filterOptions, setFilterOptions] = useState({ exchanges: [], boards: [], statuses: [] })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchIpoProgressList({
        page,
        pageSize,
        keyword: kwSearch,
        sourceCategory,
        exchange,
        board,
        status,
        timelineConfirmed,
      })
      if (res.data?.success) {
        const d = res.data.data || {}
        setData(normalizeRecordList(d.list || []))
        setTotal(d.total || 0)
        if (d.pageSize != null) setPageSize(Number(d.pageSize))
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, kwSearch, sourceCategory, exchange, board, status, timelineConfirmed])

  useEffect(() => {
    load()
  }, [load])

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchIpoProgressStats()
      if (res.data?.success && res.data?.data) {
        setStats(res.data.data)
      }
    } catch {
      // 统计卡失败不阻断主列表
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchIpoProgressFilterOptions()
        if (cancelled || !res.data?.success) return
        const d = res.data.data || {}
        const exchanges = Array.isArray(d.exchanges) ? d.exchanges : []
        const boards = Array.isArray(d.boards) ? d.boards : []
        const statuses = Array.isArray(d.statuses) ? d.statuses : []
        setFilterOptions({ exchanges, boards, statuses })
        setExchange((prev) => (prev && !exchanges.includes(prev) ? '' : prev))
        setBoard((prev) => (prev && !boards.includes(prev) ? '' : prev))
        setStatus((prev) => (prev && !statuses.includes(prev) ? '' : prev))
      } catch {
        /* 下拉失败不阻断列表；选项为空时仍可关键词检索 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    const el = tableScrollAreaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      const h = el.clientHeight
      if (h < 120) return
      // scroll.y 只作用于表体；需预留表头 + 底部分页高度，避免整页滚动
      setTableScrollY(Math.max(200, Math.floor(h - 108)))
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleExport = async () => {
    try {
      const res = await downloadIpoProgressExport({ keyword: kwSearch, sourceCategory, exchange, board, status, timelineConfirmed })
      saveBlobAsCsv(res)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    }
  }

  const handleReset = () => {
    setKeyword('')
    setSourceCategory('')
    setExchange('')
    setBoard('')
    setStatus('')
    setTimelineConfirmed('')
    setPage(1)
    if (kwSearch) {
      setKwSearch('')
    } else {
      load()
    }
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      code: '',
      project_name: '',
      status: '',
      register_address: '',
      receive_date: '',
      company: '',
      board: '',
      exchange: '',
      f_update_time: formatLocalDateTimeForInput(),
    })
    setEditOpen(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      code: record.code || '',
      project_name: record.project_name,
      status: record.status,
      register_address: record.register_address || '',
      receive_date: record.receive_date || '',
      company: record.company,
      board: record.board,
      exchange: record.exchange,
      f_update_time: record.f_update_time || '',
    })
    setEditOpen(true)
  }

  const submitSave = async () => {
    const v = await form.validate()
    const payload = {
      ...v,
      receive_date: v.receive_date || null,
    }
    try {
      if (editing) {
        await updateIpoProgress(editing.f_id, payload)
        Message.success('已保存')
      } else {
        await createIpoProgress(payload)
        Message.success('已新增')
      }
      setEditOpen(false)
      load()
      loadStats()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || (editing ? '保存失败' : '新增失败'))
    }
  }

  const handleDelete = (record) => {
    Modal.confirm({
      title: '确认删除',
      content: '确认软删除该条上市信息？',
      onOk: async () => {
        try {
          await deleteIpoProgress(record.f_id)
          Message.success('已删除')
          load()
          loadStats()
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
        tableName: 'ipo_progress',
        recordId: String(record.f_id),
      })
      if (res.data?.success) {
        setLogRows(res.data.data || [])
      } else {
        setLogRows([])
      }
    } catch {
      setLogRows([])
    } finally {
      setLogLoading(false)
    }
  }

  const openConfirmDetail = async (record) => {
    const ex = String(record?.exchange || '').trim()
    if (ex === '港交所' || ex === '香港联交所') {
      Message.info('港交所数据无需详情确认')
      return
    }
    setEditing(record)
    setConfirmOpen(true)
    setConfirmLoading(true)
    setConfirmDetail(null)
    try {
      const res = await fetchIpoProgressRecheck(record.f_id)
      if (res.data?.success) setConfirmDetail(res.data.data)
    } catch {
      setConfirmDetail({ row: record, recheck: [] })
    } finally {
      setConfirmLoading(false)
    }
  }

  const columns = [
    {
      title: '更新日期',
      dataIndex: 'f_update_time',
      width: 120,
      render: (v) => (v ? String(v).slice(0, 10) : '-'),
    },
    { title: '项目简称', dataIndex: 'project_name', width: 140, render: (v, r) => v || r.company || '-' },
    { title: '公司全称', dataIndex: 'company', width: 220, ellipsis: true },
    { title: '审核状态', dataIndex: 'status', width: 150, render: (v) => v || '-' },
    { title: '交易所', dataIndex: 'exchange', width: 140, render: (v) => v || '-' },
    { title: '板块', dataIndex: 'board', width: 120, render: (v) => v || '-' },
    { title: '注册地', dataIndex: 'register_address', width: 140, ellipsis: true, render: (v) => v || '-' },
    {
      title: '详情确认',
      dataIndex: 'timeline_confirmed',
      width: 110,
      render: (v, record) => {
        const ex = String(record?.exchange || '').trim()
        if (ex === '港交所' || ex === '香港联交所') {
          return '不适用'
        }
        const confirmed = Number(v) === 1
        const label = confirmed ? '已确认' : '待确认'
        if (confirmed) return label
        return (
          <Button type="text" size="mini" onClick={() => openConfirmDetail(record)}>
            {label}
          </Button>
        )
      },
    },
  ]

  if (isAdmin) {
    columns.push({
      title: '操作',
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
    })
  }

  return (
    <div
      className="listing-ipo-progress-page list-table-page"
      style={{
        boxSizing: 'border-box',
        height: 'calc(100vh - 68px)',
        maxHeight: 'calc(100vh - 68px)',
        padding: '4px 16px 0',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        '--list-ops-col-width': isAdmin ? '168px' : undefined,
      }}
    >
      <div
        className="listing-page-header"
        style={{
          marginBottom: 8,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>IPO审核进展</div>
          <Space wrap>
            <Input
              style={{ width: 440 }}
              placeholder="关键词（公司/项目/状态/交易所等）"
              value={keyword}
              onChange={setKeyword}
              onPressEnter={() => {
                setPage(1)
                setKwSearch(keyword.trim())
              }}
            />
            <Select
              style={{ width: 200 }}
              allowClear
              placeholder="来源筛选"
              value={sourceCategory || undefined}
              onChange={(v) => {
                setPage(1)
                setSourceCategory(v || '')
              }}
            >
              <Option value="exchange_ipo">交易所IPO</Option>
              <Option value="guidance_record">证监会辅导备案</Option>
              <Option value="overseas_filing">境外上市备案</Option>
            </Select>
            <Select
              style={{ width: 160 }}
              allowClear
              showSearch
              placeholder="交易所"
              filterOption={(input, option) =>
                String(option.props.children || '')
                  .toLowerCase()
                  .includes(String(input || '').trim().toLowerCase())
              }
              value={exchange || undefined}
              onChange={(v) => {
                setPage(1)
                setExchange(v || '')
              }}
            >
              {filterOptions.exchanges.map((x) => (
                <Option key={x} value={x}>
                  {x}
                </Option>
              ))}
            </Select>
            <Select
              style={{ width: 160 }}
              allowClear
              showSearch
              placeholder="板块"
              filterOption={(input, option) =>
                String(option.props.children || '')
                  .toLowerCase()
                  .includes(String(input || '').trim().toLowerCase())
              }
              value={board || undefined}
              onChange={(v) => {
                setPage(1)
                setBoard(v || '')
              }}
            >
              {filterOptions.boards.map((x) => (
                <Option key={x} value={x}>
                  {x}
                </Option>
              ))}
            </Select>
            <Select
              style={{ width: 200 }}
              allowClear
              showSearch
              placeholder="审核状态"
              filterOption={(input, option) =>
                String(option.props.children || '')
                  .toLowerCase()
                  .includes(String(input || '').trim().toLowerCase())
              }
              value={status || undefined}
              onChange={(v) => {
                setPage(1)
                setStatus(v || '')
              }}
            >
              {filterOptions.statuses.map((x) => (
                <Option key={x} value={x}>
                  {x}
                </Option>
              ))}
            </Select>
            <Select
              style={{ width: 140 }}
              allowClear
              placeholder="详情确认"
              value={timelineConfirmed || undefined}
              onChange={(v) => {
                setPage(1)
                setTimelineConfirmed(v || '')
              }}
            >
              <Option value="">全部</Option>
              <Option value="1">已确认</Option>
              <Option value="0">待确认</Option>
            </Select>
            <Button
              type="primary"
              onClick={() => {
                setPage(1)
                setKwSearch(keyword.trim())
              }}
            >
              查询
            </Button>
            <Button onClick={handleReset}>重置</Button>
            <Button onClick={load} loading={loading}>
              刷新
            </Button>
            <Button onClick={handleExport}>导出 CSV</Button>
            {isAdmin ? (
              <Button type="primary" onClick={openCreate}>
                新增
              </Button>
            ) : null}
          </Space>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {['深交所', '上交所', '北交所', '港交所'].map((ex) => {
            const s = stats.byExchange?.[ex] || { yesterday: 0, year: 0 }
            return (
              <div
                key={ex}
                style={{
                  border: '1px solid #dbe2f0',
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
                  boxShadow: '0 2px 8px rgba(31, 35, 41, 0.06)',
                  padding: '10px 12px',
                  minWidth: 210,
                  minHeight: 78,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#1d2129' }}>{ex}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1677ff', lineHeight: 1.1 }}>
                      {s.yesterday ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: '#86909c', marginTop: 2 }}>昨日新增</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#00b42a', lineHeight: 1.1 }}>
                      {s.year ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: '#86909c', marginTop: 2 }}>{stats.year}累计</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div
        ref={tableScrollAreaRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Table
          rowKey={resolveRecordId}
          loading={loading}
          columns={columns}
          data={data}
          className="list-table"
          scroll={{ x: isAdmin ? 1400 : 1200, y: tableScrollY }}
          stripe
          pagination={{
            current: page,
            pageSize: Number(pageSize),
            defaultPageSize: 15,
            total,
            sizeCanChange: true,
            pageSizeChangeResetCurrent: true,
            showTotal: true,
            showJumper: true,
            sizeOptions: LISTING_PAGE_SIZE_OPTIONS,
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
      </div>
      
      <SheetModal
        visible={editOpen}
        title={editing ? '编辑上市信息' : '新增上市信息'}
        onClose={() => setEditOpen(false)}
      >
        <Form form={form} layout="vertical" className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <FormItem label="证券代码" field="code">
              <Input />
            </FormItem>
            <FormItem label="项目简称" field="project_name" rules={[{ required: true }]}>
              <Input />
            </FormItem>
            <FormItem label="审核状态" field="status" rules={[{ required: true }]}>
              <Input />
            </FormItem>
            <FormItem label="交易所" field="exchange" rules={[{ required: true }]}>
              <Input />
            </FormItem>
            <FormItem label="板块" field="board">
              <Input placeholder="选填" />
            </FormItem>
            <FormItem label="注册地" field="register_address">
              <Input />
            </FormItem>
            <FormItem label="受理日期" field="receive_date">
              <Input placeholder="YYYY-MM-DD" />
            </FormItem>
            <FormItem label="更新日期时间" field="f_update_time" rules={[{ required: true }]}>
              <Input />
            </FormItem>
            <FormItem label="公司全称" field="company" rules={[{ required: true }]} className="form-span-2">
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
            </FormItem>
          </div>
          <SheetActions
            onCancel={() => setEditOpen(false)}
            submitLabel="确定"
            submitType="button"
            onSubmitClick={submitSave}
          />
        </Form>
      </SheetModal>

      <SheetViewer
        visible={confirmOpen}
        title="详情确认 / 待复核"
        onClose={() => setConfirmOpen(false)}
      >
        {confirmLoading ? (
          <div>加载中…</div>
        ) : (
          <div>
            <p>
              <strong>审核状态：</strong>
              {confirmDetail?.row?.status || editing?.status || '-'}
            </p>
            <p>
              <strong>列表更新日期：</strong>
              {confirmDetail?.row?.f_update_time || editing?.f_update_time || '-'}
            </p>
            <p>
              <strong>事件日（receive_date）：</strong>
              {confirmDetail?.row?.receive_date || '（空）'}
            </p>
            {Array.isArray(confirmDetail?.recheck) && confirmDetail.recheck.length > 0 ? (
              <Table
                size="small"
                rowKey={(r, i) => `${r.reason}-${i}`}
                pagination={false}
                columns={[
                  { title: '原因', dataIndex: 'reason', width: 160 },
                  { title: '次数', render: (_, r) => `${r.attempts}/${r.max_attempts}` },
                  { title: '下次复核', dataIndex: 'next_recheck_at', width: 160 },
                  { title: '最近错误', dataIndex: 'last_error', ellipsis: true },
                ]}
                data={confirmDetail.recheck}
              />
            ) : (
              <div style={{ color: '#86909c' }}>暂无 recheck 队列记录</div>
            )}
          </div>
        )}
      </SheetViewer>

      <SheetViewer
        visible={logOpen}
        title="变更日志（data_change_log）"
        onClose={() => setLogOpen(false)}
      >
        {logLoading ? (
          <div>加载中…</div>
        ) : logRows.length === 0 ? (
          <div>暂无变更记录（若从未写入 data_change_log 则为空）</div>
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
    </div>
  )
}
