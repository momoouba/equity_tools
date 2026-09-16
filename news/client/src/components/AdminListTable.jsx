import React from 'react'
import { Table, Button } from '@arco-design/web-react'
import { ListOps, ListOpButton } from './listTableOps'
import '../styles/listTable.css'

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

/** 时间列：默认两行 YYYY-MM-DD / HH:mm:ss（北京时间）；oneLine 时同一行 */
export function formatAdminDateTime(value, { oneLine = false } = {}) {
  if (value == null || value === '') return '-'
  const raw = String(value).trim()
  const hasTz = /T/.test(raw) || /[zZ]$/.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)
  if (hasTz) {
    const d = value instanceof Date ? value : new Date(value)
    if (!Number.isNaN(d.getTime())) {
      const beijing = d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')
      const day = beijing.slice(0, 10)
      const time = beijing.slice(11, 19)
      if (oneLine) return `${day} ${time}`
      return (
        <span className="admin-dt">
          {day}
          <br />
          {time}
        </span>
      )
    }
  }
  let s = raw.replace('T', ' ')
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

function extractButtonLabel(node) {
  const ch = node?.props?.children
  if (typeof ch === 'string') return ch.trim()
  if (Array.isArray(ch)) {
    return ch.filter((c) => typeof c === 'string').join('').trim()
  }
  return String(node?.props?.name || '').trim()
}

function isArcoButton(type) {
  if (type === Button) return true
  if (!type) return false
  const name = type.displayName || type.name || ''
  return name === 'Button'
}

function shouldUnwrapOpWrapper(type) {
  if (type === React.Fragment) return true
  if (!type) return false
  const name = type.displayName || type.name || ''
  // forwardRef 组件名可能带 memo/forwardRef 前缀
  return /Popconfirm|Tooltip|Trigger/i.test(name)
}

/** 把 AdminOps 内的 Button 自动换成 ListOpButton；勿递归进 Switch 等非包裹组件 */
function enhanceAdminOpNode(node) {
  if (!React.isValidElement(node)) return node
  if (isArcoButton(node.type)) {
    const label = extractButtonLabel(node)
    const { status, type: _t, size: _s, className, children, ...rest } = node.props
    return (
      <ListOpButton name={label || '查看'} className={className} {...rest}>
        {children}
      </ListOpButton>
    )
  }
  if (shouldUnwrapOpWrapper(node.type) && node.props?.children != null) {
    const enhanced = React.Children.map(node.props.children, enhanceAdminOpNode)
    // Popconfirm/Tooltip 必须是单个可持 ref 的子节点，不能传数组
    const arr = React.Children.toArray(enhanced)
    const nextChild = arr.length === 1 ? arr[0] : enhanced
    return React.cloneElement(node, { children: nextChild })
  }
  return node
}

/** 操作列：统一 ListOps 同色按钮 */
export function AdminOps({ children, className = '' }) {
  return (
    <ListOps className={['admin-ops', className].filter(Boolean).join(' ')}>
      {React.Children.map(children, enhanceAdminOpNode)}
    </ListOps>
  )
}

function withFixedOpsColumn(col) {
  if (!col || typeof col !== 'object') return col
  const title = col.title
  const isOps =
    title === '操作' ||
    col.key === 'actions' ||
    (typeof col.className === 'string' && col.className.includes('admin-ops-col'))
  if (!isOps) return col
  return {
    ...col,
    fixed: col.fixed || 'right',
    className: [col.className, 'list-ops-col'].filter(Boolean).join(' '),
  }
}

/** 管理员设置列表：浅蓝表头、斑马纹、操作列右侧固定、同名按钮同色 */
export default function AdminListTable({
  columns = [],
  className,
  page,
  pageSize,
  showSeq = true,
  scroll,
  /** 为 false 时不自动 fixed 操作列（双表/单选等特殊布局避免白屏） */
  fixOps = true,
  ...rest
}) {
  const cols = (showSeq ? [adminSeqColumn({ page, pageSize }), ...columns] : columns).map((col) =>
    fixOps ? withFixedOpsColumn(col) : col
  )
  const hasFixed = cols.some((c) => c && c.fixed)
  const hasScrollY = scroll != null && scroll.y != null
  // 有固定列时需要横向 scroll；默认表体高度偏保守，避免嵌套 Tab 撑出整页滚动条
  const defaultY =
    typeof window !== 'undefined' ? Math.max(200, window.innerHeight - 380) : 280
  const mergedScroll = {
    ...(hasFixed ? { x: true } : {}),
    ...(hasFixed && !hasScrollY ? { y: defaultY } : {}),
    ...(scroll || {}),
  }
  const scrollProp = Object.keys(mergedScroll).length ? mergedScroll : undefined

  return (
    <Table
      stripe
      border
      size="small"
      className={['admin-list-table', 'list-table', className].filter(Boolean).join(' ')}
      columns={cols}
      {...rest}
      scroll={scrollProp}
    />
  )
}
