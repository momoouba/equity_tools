import React from 'react'
import { Table } from '@arco-design/web-react'

/** 估值工作台列表：序号列（窄、不换行） */
export function seqColumn({ page = 1, pageSize = 0, fixed = 'left', mergeSummaryLead = false } = {}) {
  return {
    title: '序号',
    width: 48,
    align: 'center',
    fixed,
    className: 'valuation-seq-col',
    render: (_, record, index) => {
      if (mergeSummaryLead && record?._summary) {
        return {
          children: (
            <span className="valuation-year-mean-label">
              {record._summaryLabel || record.stock_name || '平均数'}
            </span>
          ),
          props: { colSpan: 3 },
        }
      }
      return (pageSize ? (page - 1) * pageSize : 0) + index + 1
    },
  }
}

function withSummaryLeadHide(col) {
  const prev = col.render
  return {
    ...col,
    render: (v, r, idx) => {
      if (r?._summary) return { children: null, props: { colSpan: 0 } }
      return prev ? prev(v, r, idx) : v
    },
  }
}

/** mergeSummaryLead：_summary 行把序号+前两列（代码/名称）合并为左对齐标签 */
export function ListTable({
  columns = [],
  className,
  seqFixed = 'left',
  page,
  pageSize,
  showSeq = true,
  mergeSummaryLead = false,
  ...rest
}) {
  let cols = columns
  if (mergeSummaryLead && columns.length >= 2) {
    cols = [withSummaryLeadHide(columns[0]), withSummaryLeadHide(columns[1]), ...columns.slice(2)]
  }
  if (showSeq) {
    cols = [seqColumn({ fixed: seqFixed, page, pageSize, mergeSummaryLead }), ...cols]
  }
  return (
    <Table
      stripe
      border
      size="small"
      className={['valuation-list-table', className].filter(Boolean).join(' ')}
      columns={cols}
      {...rest}
    />
  )
}
