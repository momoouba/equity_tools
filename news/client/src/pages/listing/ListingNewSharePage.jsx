import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Input, Select, Message } from '@arco-design/web-react'
import {
  fetchNewShareList,
  postNewShareSync,
  postNewShareAiName,
  downloadNewShareExport,
} from '../../api/listing'
import './listingTableColumns.css'
import {
  buildListingNumericColumn,
  formatListingAmount,
  sumColumnWidths,
} from './listingTableColumns'

const Option = Select.Option
const LISTING_PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
const ROW_SELECTION_WIDTH = 48

function formatPercent(v) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(2)}%`
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
  const [aiNaming, setAiNaming] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [exchange, setExchange] = useState('')
  const [tableScrollY, setTableScrollY] = useState(620)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchNewShareList({ page, pageSize, keyword: kwSearch, exchange })
      if (res.data?.success) {
        const d = res.data.data || {}
        setData(d.list || [])
        setTotal(Number(d.total || 0))
        setSelectedRowKeys((prev) => prev.filter((id) => (d.list || []).some((row) => row.id === id)))
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

  const handleAiName = async () => {
    if (!selectedRowKeys.length) {
      Message.warning('请先勾选需要AI查名的数据')
      return
    }
    setAiNaming(true)
    try {
      const res = await postNewShareAiName({ ids: selectedRowKeys })
      if (res.data?.success) {
        const result = res.data?.data || {}
        Message.success(`AI查名完成：更新${Number(result.updated || 0)}条，跳过${Number(result.skipped || 0)}条，失败${Number(result.failed || 0)}条`)
        setSelectedRowKeys([])
        load()
      } else {
        Message.error(res.data?.message || 'AI查名失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || 'AI查名失败')
    } finally {
      setAiNaming(false)
    }
  }

  const columns = useMemo(
    () => [
      { title: '股票代码', dataIndex: 'stock_code', key: 'stock_code', width: 110 },
      { title: '股票简称', dataIndex: 'stock_name', key: 'stock_name', width: 120 },
      {
        title: '企业全称（中/英）',
        dataIndex: 'enterprise_full_name_display',
        key: 'enterprise_full_name_display',
        width: 280,
        ellipsis: true,
        tooltip: true,
        render: (v) => (
          <span
            title={v || '-'}
            style={{
              display: 'inline-block',
              width: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {v || '-'}
          </span>
        ),
      },
      { title: '申购日期', dataIndex: 'issue_date', key: 'issue_date', width: 120 },
      { title: '星期', dataIndex: 'issue_weekday', key: 'issue_weekday', width: 90, render: (v) => v || '-' },
      buildListingNumericColumn('发行价', 'issue_price', 100, (v) => formatListingAmount(v)),
      buildListingNumericColumn('申购上限', 'limit_shares', 110, (v) => formatListingAmount(v)),
      { title: '上市日期', dataIndex: 'public_date', key: 'public_date', width: 120, render: (v) => v || '-' },
      buildListingNumericColumn('中签率', 'win_rate', 100, (v) => formatPercent(v)),
      buildListingNumericColumn('上市首日收盘价', 'first_day_close', 140, (v) => formatListingAmount(v)),
      buildListingNumericColumn('首日涨幅', 'first_day_chg_pct', 100, (v) => formatPercent(v)),
      buildListingNumericColumn('总发行数量', 'total_issued_shares', 130, (v) => formatListingAmount(v)),
      buildListingNumericColumn('市值', 'first_day_market_cap', 140, (v) => formatListingAmount(v)),
      { title: '交易所', dataIndex: 'exchange', key: 'exchange', width: 120 },
    ],
    []
  )

  const tableScrollX = useMemo(() => sumColumnWidths(columns) + ROW_SELECTION_WIDTH, [columns])

  return (
    <div className="listing-new-share-page" style={{ padding: '0 16px 16px' }}>
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
        <Button
          type="primary"
          status="success"
          loading={aiNaming}
          disabled={!selectedRowKeys.length}
          onClick={handleAiName}
        >
          AI查名
        </Button>
        <Button onClick={handleExport}>导出 CSV</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        data={data}
        rowSelection={{
          type: 'checkbox',
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        stripe
        border={{
          wrapper: true,
          cell: true,
        }}
        scroll={{ x: tableScrollX, y: tableScrollY }}
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

