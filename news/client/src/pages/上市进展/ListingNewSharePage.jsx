import React, { useCallback, useEffect, useState } from 'react'
import { Table, Button, Space, Input, Select, Message } from '@arco-design/web-react'
import {
  fetchNewShareList,
  postNewShareSync,
  downloadNewShareExport,
} from '../../api/上市进展'

const Option = Select.Option
const LISTING_PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

function formatPercent(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(2)}%`
}

function formatAmount(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function saveBlobAsCsv(res) {
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `打新日历_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ListingNewSharePage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [exchange, setExchange] = useState('')
  const [tableScrollY, setTableScrollY] = useState(620)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchNewShareList({ page, pageSize, keyword: kwSearch, exchange })
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
  }, [page, pageSize, kwSearch, exchange])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 280)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await postNewShareSync({})
      if (res.data?.success) {
        Message.success(res.data?.data?.message || '同步已完成')
        load()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleExport = async () => {
    try {
      const res = await downloadNewShareExport({ keyword: kwSearch, exchange })
      saveBlobAsCsv(res)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    }
  }

  const columns = [
    { title: '股票代码', dataIndex: 'stock_code', width: 110 },
    { title: '股票简称', dataIndex: 'stock_name', width: 120 },
    { title: '申购日期', dataIndex: 'issue_date', width: 120 },
    { title: '星期', dataIndex: 'issue_weekday', width: 90, render: (v) => v || '-' },
    { title: '发行价', dataIndex: 'issue_price', width: 100, render: (v) => (v ?? '-') },
    { title: '申购上限', dataIndex: 'limit_shares', width: 100, render: (v) => formatAmount(v) },
    { title: '上市日期', dataIndex: 'public_date', width: 120, render: (v) => v || '-' },
    { title: '中签率', dataIndex: 'win_rate', width: 100, render: (v) => formatPercent(v) },
    { title: '上市首日收盘价', dataIndex: 'first_day_close', width: 130, render: (v) => (v ?? '-') },
    { title: '首日涨幅', dataIndex: 'first_day_chg_pct', width: 100, render: (v) => formatPercent(v) },
    { title: '总发行数量', dataIndex: 'total_issued_shares', width: 130, render: (v) => formatAmount(v) },
    { title: '市值', dataIndex: 'first_day_market_cap', width: 140, render: (v) => formatAmount(v) },
    { title: '交易所', dataIndex: 'exchange', width: 120 },
  ]

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>打新日历</div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          style={{ width: 280 }}
          placeholder="股票代码/简称"
          value={keyword}
          onChange={setKeyword}
          onPressEnter={() => {
            setPage(1)
            setKwSearch(keyword.trim())
          }}
        />
        <Select
          style={{ width: 160 }}
          placeholder="交易所"
          allowClear
          value={exchange || undefined}
          onChange={(v) => {
            setPage(1)
            setExchange(v || '')
          }}
        >
          <Option value="上交所">上交所</Option>
          <Option value="深交所">深交所</Option>
          <Option value="北交所">北交所</Option>
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
        <Button onClick={() => {
          setKeyword('')
          setKwSearch('')
          setExchange('')
          setPage(1)
        }}
        >
          重置
        </Button>
        <Button loading={loading} onClick={load}>刷新</Button>
        <Button loading={syncing} onClick={handleSync}>手动同步</Button>
        <Button onClick={handleExport}>导出 CSV</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        data={data}
        stripe
        border
        scroll={{ x: 1600, y: tableScrollY }}
        pagination={{
          current: page,
          pageSize,
          total,
          sizeCanChange: true,
          showTotal: true,
          showJumper: true,
          pageSizeChangeResetCurrent: true,
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
  )
}

