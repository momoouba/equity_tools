import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Table, Button, Message, Space, Input, Modal, Form } from '@arco-design/web-react'
import './ListingIpoProgressPage.css'
import {
  fetchIpoProgressList,
  fetchIpoProgressStats,
  downloadIpoProgressExport,
  updateIpoProgress,
  deleteIpoProgress,
  fetchListingDataChangeLog,
} from '../../api/上市进展'

const FormItem = Form.Item

const LISTING_PAGE_SIZE_OPTIONS = [10, 15, 20, 50, 100, 200]

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
  const isAdmin = useMemo(() => readIsAdmin(), [])

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [logOpen, setLogOpen] = useState(false)
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [tableScrollY, setTableScrollY] = useState(520)
  const [stats, setStats] = useState({
    yesterday: '',
    year: new Date().getFullYear(),
    byExchange: {
      深交所: { yesterday: 0, year: 0 },
      上交所: { yesterday: 0, year: 0 },
      北交所: { yesterday: 0, year: 0 },
    },
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchIpoProgressList({ page, pageSize, keyword: kwSearch })
      if (res.data?.success) {
        const d = res.data.data || {}
        setData(d.list || [])
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
  }, [page, pageSize, kwSearch])

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
    const updateTableHeight = () => {
      // 仅让“表头以下数据区”滚动，顶部标题/筛选区保持不动
      const h = Math.max(360, window.innerHeight - 280)
      setTableScrollY(h)
    }
    updateTableHeight()
    window.addEventListener('resize', updateTableHeight)
    return () => window.removeEventListener('resize', updateTableHeight)
  }, [])

  const handleExport = async () => {
    try {
      const res = await downloadIpoProgressExport({ keyword: kwSearch })
      saveBlobAsCsv(res)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    }
  }

  const handleReset = () => {
    setKeyword('')
    setPage(1)
    if (kwSearch) {
      setKwSearch('')
    } else {
      load()
    }
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

  const submitEdit = async () => {
    const v = await form.validate()
    try {
      await updateIpoProgress(editing.f_id, {
        ...v,
        receive_date: v.receive_date || null,
      })
      Message.success('已保存')
      setEditOpen(false)
      load()
      loadStats()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '保存失败')
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

  const columns = [
    {
      title: '更新日期',
      dataIndex: 'f_update_time',
      width: 120,
      render: (v) => (v ? String(v).slice(0, 10) : '-'),
    },
    { title: '项目简称', dataIndex: 'project_name', width: 140 },
    { title: '公司全称', dataIndex: 'company', width: 220, ellipsis: true },
    { title: '审核状态', dataIndex: 'status', width: 150 },
    { title: '交易所', dataIndex: 'exchange', width: 100 },
    { title: '板块', dataIndex: 'board', width: 100 },
    { title: '注册地', dataIndex: 'register_address', width: 140, ellipsis: true },
  ]

  if (isAdmin) {
    columns.push({
      title: '操作',
      width: 180,
      fixed: 'right',
      render: (_, record) => (
        <Space size={8} style={{ padding: '0 10px' }}>
          <Button type="outline" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="outline" status="success" size="small" onClick={() => openLog(record)}>
            日志
          </Button>
          <Button type="outline" status="danger" size="small" onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    })
  }

  return (
    <div className="listing-ipo-progress-page" style={{ padding: '0 16px 16px' }}>
      <div
        style={{
          marginBottom: 8,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
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
          </Space>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {['深交所', '上交所', '北交所'].map((ex) => {
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
      <Table
        rowKey="f_id"
        loading={loading}
        columns={columns}
        data={data}
        scroll={{ x: isAdmin ? 1200 : 1000, y: tableScrollY }}
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
      
      <Modal
        title="编辑上市信息"
        visible={editOpen}
        onOk={submitEdit}
        onCancel={() => setEditOpen(false)}
        style={{ width: 560 }}
      >
        <Form form={form} layout="vertical">
          <FormItem label="证券代码" field="code">
            <Input />
          </FormItem>
          <FormItem label="项目简称" field="project_name" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="审核状态" field="status" rules={[{ required: true }]}>
            <Input />
          </FormItem>
          <FormItem label="注册地" field="register_address">
            <Input />
          </FormItem>
          <FormItem label="受理日期" field="receive_date">
            <Input placeholder="YYYY-MM-DD" />
          </FormItem>
          <FormItem label="公司全称" field="company" rules={[{ required: true }]}>
            <Input.TextArea />
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
        title="变更日志（data_change_log）"
        visible={logOpen}
        footer={null}
        onCancel={() => setLogOpen(false)}
        style={{ width: 720 }}
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
          />
        )}
      </Modal>
    </div>
  )
}
