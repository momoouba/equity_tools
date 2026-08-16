import React from 'react'
import { Table } from '@arco-design/web-react'

/** 估值工作台列表：序号列（窄、不换行） */
export function seqColumn({ page = 1, pageSize = 0, fixed = 'left' } = {}) {
  return {
    title: '序号',
    width: 48,
    align: 'center',
    fixed,
    className: 'valuation-seq-col',
    render: (_, __, index) => (pageSize ? (page - 1) * pageSize : 0) + index + 1,
  }
}

export function ListTable({ columns = [], className, seqFixed = 'left', page, pageSize, showSeq = true, ...rest }) {
  const cols = showSeq ? [seqColumn({ fixed: seqFixed, page, pageSize }), ...columns] : columns
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
