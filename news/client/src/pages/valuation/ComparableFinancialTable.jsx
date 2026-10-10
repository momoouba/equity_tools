import React, { useEffect, useMemo, useState } from 'react'
import { Radio, Empty, Typography, Alert, Button, Message, Space } from '@arco-design/web-react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { fmtWanPlain } from './valuationUnits'
import { ListTable } from './valuationTable'

const REPORT_LABEL = { annual: '年报', q1: '一季报', interim: '中报', q3: '三季报' }

const TABLE_TITLE = {
  pl: '可比利润表',
  bs: '可比资产负债表',
  cf: '可比现金流量表',
}

const COLS = {
  pl: [
    { key: 'revenue', title: '营业收入' },
    { key: 'cogs', title: '营业成本' },
    { key: 'gross_profit', title: '毛利' },
    { key: 'selling', title: '销售费用' },
    { key: 'admin', title: '管理费用' },
    { key: 'rd', title: '研发费用' },
    { key: 'operating_profit', title: '营业利润' },
    { key: 'net_income', title: '净利润' },
  ],
  bs: [
    { key: 'accounts_receivable', title: '应收账款' },
    { key: 'notes_receivable', title: '应收票据' },
    { key: 'revenue', title: '营业收入' },
    { key: 'inventory', title: '存货' },
    { key: 'accounts_payable', title: '应付账款' },
    { key: 'notes_payable', title: '应付票据' },
    { key: 'cogs', title: '营业成本' },
    { key: 'cash', title: '货币资金' },
    { key: 'short_term_loan', title: '短期借款' },
    { key: 'long_term_loan', title: '长期借款' },
    { key: 'equity', title: '净资产' },
    { key: 'total_assets', title: '资产总计' },
  ],
  cf: [
    { key: 'cfo', title: '经营现金流' },
    { key: 'cfi', title: '投资现金流' },
    { key: 'cff', title: '筹资现金流' },
    { key: 'da', title: '折旧摊销' },
    { key: 'capex', title: '购建长期资产' },
    { key: 'cash_begin', title: '期初现金' },
    { key: 'cash_end', title: '期末现金' },
  ],
}

const HINT = {
  pl: '系统入库近几期公开年报/季报。东方财富利润表一般不提供毛利字段，本表按「营业收入 − 营业成本」计算。市场法用历史 PE/PS，不用当天行情。',
  bs: '金额单位为元。DSO = 360 ×（应收账款 + 应收票据）÷ 同期营业收入，DPO = 360 ×（应付账款 + 应付票据）÷ 同期营业成本，DIO = 360 × 存货 ÷ 同期营业成本。营业收入和营业成本取同一报告期的利润表。',
  cf: '系统入库近几期公开现金流量表。折旧摊销按补充资料加总：固定资产折旧（含油气资产折耗、生产性生物资产折旧，同一金额只计一次）、无形资产摊销、长期待摊费用摊销、使用权资产折旧。标的 DCF 不直接用这些数。',
}

function metricValue(row, key) {
  const raw = row?.[key]
  const n = raw == null || raw === '' ? null : Number(raw)
  if (Number.isFinite(n)) return n
  if (key === 'gross_profit') {
    const rev = Number(row?.revenue)
    const cogs = Number(row?.cogs)
    if (Number.isFinite(rev) && Number.isFinite(cogs)) return rev - cogs
  }
  return null
}

function withComputedMetrics(rows) {
  return (rows || []).map((r) => (
    r?.statement_type === 'pl' ? { ...r, gross_profit: metricValue(r, 'gross_profit') } : r
  ))
}

function attachSamePeriodPl(bsRows, allRows) {
  const plByKey = new Map()
  for (const r of allRows || []) {
    if (r?.statement_type !== 'pl') continue
    plByKey.set(`${r.stock_code}|${r.report_period}|${r.report_type}`, r)
  }
  return (bsRows || []).map((r) => {
    const pl = plByKey.get(`${r.stock_code}|${r.report_period}|${r.report_type}`)
    return {
      ...r,
      revenue: pl ? metricValue(pl, 'revenue') : null,
      cogs: pl ? metricValue(pl, 'cogs') : null,
    }
  })
}

function exportComparableSheet({ statementType, rows, filePrefix }) {
  const cols = COLS[statementType] || COLS.pl
  const title = TABLE_TITLE[statementType] || '可比财报'
  const header = ['序号', '代码', '名称', '报告期', '类型', ...cols.map((c) => c.title)]
  const body = (rows || []).map((r, i) => [
    i + 1,
    r.stock_code || '',
    r.stock_name || '',
    r.report_period || '',
    REPORT_LABEL[r.report_type] || r.report_type || '',
    ...cols.map((c) => {
      const n = Number(metricValue(r, c.key))
      return Number.isFinite(n) ? Number(n.toFixed(2)) : null
    }),
  ])
  const aoa = [
    [`${title}（元）`],
    header,
    ...body,
  ]
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }]
  sheet['!cols'] = header.map((h, i) => ({ wch: i < 4 ? 14 : Math.max(12, String(h).length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, title.slice(0, 31))
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const prefix = String(filePrefix || title).replace(/[\\/:*?"<>|]/g, '_')
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${prefix}.xlsx`)
}

export default function ComparableFinancialTable({ statementType, rows, loading, filePrefix }) {
  const [periodFilter, setPeriodFilter] = useState('annual')
  const [page, setPage] = useState(1)
  const cols = COLS[statementType] || COLS.pl
  const title = TABLE_TITLE[statementType] || '可比财报'
  const data = useMemo(() => {
    const source = withComputedMetrics(rows || [])
    let list = source.filter((r) => r.statement_type === statementType)
    if (periodFilter === 'annual') list = list.filter((r) => r.report_type === 'annual')
    if (statementType === 'bs') list = attachSamePeriodPl(list, source)
    return list
  }, [rows, statementType, periodFilter])

  useEffect(() => { setPage(1) }, [periodFilter, statementType])

  const handleExport = () => {
    if (!data.length) {
      Message.warning('当前表无数据可导出')
      return
    }
    exportComparableSheet({
      statementType,
      rows: data,
      filePrefix: filePrefix || title,
    })
    Message.success(`已导出 ${data.length} 条（元）`)
  }

  if (!loading && !(rows || []).some((r) => r.statement_type === statementType)) {
    return (
      <Empty description="暂无入库财报。请先在「可比与采集」勾选公司，再点「开始采集/计算/保存」。" />
    )
  }

  return (
    <div>
      <Alert type="info" content={HINT[statementType]} style={{ marginBottom: 12 }} />
      <Space style={{ marginBottom: 12 }} align="center">
        <Radio.Group
          type="button"
          size="small"
          value={periodFilter}
          onChange={setPeriodFilter}
        >
          <Radio value="annual">仅年报</Radio>
          <Radio value="all">全部报告期</Radio>
        </Radio.Group>
        <Button size="small" onClick={handleExport} disabled={loading || !data.length}>
          导出 Excel
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {data.length} 条
        </Typography.Text>
      </Space>
      <ListTable
        className="valuation-comp-fin-table"
        rowKey={(r, i) => `${r.stock_code}-${r.report_period}-${r.report_type}-${i}`}
        loading={loading}
        page={page}
        pageSize={20}
        pagination={{ pageSize: 20, current: page, onChange: setPage, showTotal: true }}
        scroll={{ x: 48 + 72 + 96 + 112 + 64 + cols.length * 148 }}
        columns={[
          { title: '代码', dataIndex: 'stock_code', width: 72, fixed: 'left', className: 'valuation-nowrap-cell' },
          { title: '名称', dataIndex: 'stock_name', width: 96, fixed: 'left', className: 'valuation-nowrap-cell' },
          { title: '报告期', dataIndex: 'report_period', width: 112, className: 'valuation-nowrap-cell' },
          {
            title: '类型',
            dataIndex: 'report_type',
            width: 64,
            className: 'valuation-nowrap-cell',
            render: (v) => REPORT_LABEL[v] || v || '-',
          },
          ...cols.map((c) => ({
            title: c.title,
            dataIndex: c.key,
            width: 148,
            align: 'right',
            className: 'valuation-comp-fin-num',
            render: (v, r) => fmtWanPlain(metricValue(r, c.key), 2),
          })),
        ]}
        data={data}
      />
    </div>
  )
}
