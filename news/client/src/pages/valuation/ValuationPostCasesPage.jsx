import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Button, Input, Pagination, Message } from '@arco-design/web-react'
import { fetchValuationPostCases } from '../../api/valuation'
import './valuation.css'
import { formatChinaDateTime } from './valuationUnits'

function fmtN(v) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '-'
}

function fmtRange(conclusion) {
  const yi = conclusion?.display_yi
  if (!yi) return '-'
  const dcf = yi.dcf
  if (dcf?.ma) {
    return `并购 ${fmtN(dcf.ma.low)}~${fmtN(dcf.ma.high)} / 上市 ${fmtN(dcf.ipo.low)}~${fmtN(dcf.ipo.high)}`
  }
  return `${fmtN(yi.market_ps?.low)} / ${fmtN(yi.market_pe?.low)} / ${fmtN(dcf?.low)}  ~  ${fmtN(yi.market_ps?.high)} / ${fmtN(yi.market_pe?.high)} / ${fmtN(dcf?.high)}`
}

export default function ValuationPostCasesPage({ embedded = false }) {
  const navigate = useNavigate()
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchValuationPostCases({ page, pageSize, keyword })
      if (res.data?.success) {
        setList(res.data.data.list || [])
        setTotal(res.data.data.total || 0)
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, keyword])

  useEffect(() => { load() }, [load])

  const columns = [
    { title: '企业名称', dataIndex: 'enterprise_full_name', width: 180, ellipsis: true, render: (v, r) => v || r.subject_display_name || '-' },
    { title: '简称', dataIndex: 'project_abbreviation', width: 140, render: (v) => v || '-' },
    { title: '版本数', dataIndex: 'version_count', width: 80, render: (v) => v || 0 },
    { title: '最近低/增量/高(亿元)', dataIndex: 'latest_conclusion', width: 280, render: (v) => fmtRange(v) },
    { title: '本轮交易估值', dataIndex: 'round_deal_value_yi', width: 120, render: (v) => fmtN(v) },
    { title: '状态', dataIndex: 'status', width: 90 },
    { title: '最近估值时间', dataIndex: 'latest_valued_at', width: 170, render: (v) => formatChinaDateTime(v) },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Button type="primary" size="small" onClick={() => navigate(`/dashboard/valuation/workbench/${r.id}`)}>
          进入估值
        </Button>
      ),
    },
  ]

  return (
    <div className={embedded ? undefined : 'valuation-page'}>
      <Card bordered={false}>
        <div className="valuation-page-header">
          {!embedded && <h2>投后项目估值</h2>}
          <Input.Search
            allowClear
            placeholder="按企业筛选"
            style={{ width: 260 }}
            onSearch={(v) => { setKeyword(v); setPage(1) }}
          />
        </div>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          data={list}
          pagination={false}
          border
          className="valuation-list-table"
          scroll={{ x: 1140 }}
        />
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showTotal
            sizeCanChange
            onChange={(p, s) => { setPage(p); setPageSize(s) }}
          />
        </div>
      </Card>
    </div>
  )
}
