import React from 'react'
import { Table } from '@arco-design/web-react'

export function adminSeqColumn({ page = 1, pageSize = 0 } = {}) {
  return {
    title: '序号',
    width: 52,
    align: 'center',
    className: 'admin-seq-col',
    render: (_, __, index) => (pageSize ? (page - 1) * pageSize : 0) + index + 1,
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 时间列：默认两行 YYYY-MM-DD / HH:mm:ss；oneLine 时同一行 */
export function formatAdminDateTime(value, { oneLine = false } = {}) {
  if (value == null || value === '') return '-'
  let s = String(value).trim().replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = `${s} 00:00:00`
  const m = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/)
  let day
  let time
  if (m) {
    time = m[2].length === 5 ? `${m[2]}:00` : m[2]
    const parts = time.split(':')
    time = `${pad2(parts[0])}:${parts[1]}:${parts[2] || '00'}`
    day = m[1]
  } else {
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }
  if (oneLine) return `${day} ${time}`
  return (
    <span className="admin-dt">
      {day}
      <br />
      {time}
    </span>
  )
}

/** 操作列按钮：紧凑排列，超过 3 个时按一行 3 个换行 */
export function AdminOps({ children }) {
  return <div className="admin-ops">{children}</div>
}

/** 管理员设置列表：序号、斑马纹、单元格竖线；列宽与操作按钮样式由 SystemConfig.css 控制 */
export default function AdminListTable({
  columns = [],
  className,
  page,
  pageSize,
  showSeq = true,
  ...rest
}) {
  const cols = showSeq ? [adminSeqColumn({ page, pageSize }), ...columns] : columns
  return (
    <Table
      stripe
      border
      size="small"
      className={['admin-list-table', className].filter(Boolean).join(' ')}
      columns={cols}
      {...rest}
    />
  )
}
