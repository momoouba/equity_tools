import React from 'react'
import { Button, Message, Popover } from '@arco-design/web-react'
import './introPopoverAiCell.css'

/**
 * Popover 内「复制全文」
 */
export async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    Message.success('已复制到剪贴板')
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      Message.success('已复制到剪贴板')
    } catch {
      Message.error('复制失败，请在弹出层内手动选中复制')
    }
  }
}

/**
 * 表格内单行省略；点击后在 Popover 内展示全文，支持鼠标划选与「复制全文」（避免 ellipsis 自带 Tooltip 无法选中）。
 * 融资事件列表、被投企业列表共用。
 *
 * @param {string} columnTitle Popover 标题
 * @param {unknown} raw 原始文本
 * @param {number} [triggerMaxWidth] 触发区域最大宽度（px）；被投企业页在 table-layout:auto 下需传入列宽以免整段撑开列
 */
export function IntroPopoverCell({ columnTitle, raw, triggerMaxWidth }) {
  const empty = raw == null || String(raw).trim() === ''
  const text = empty ? '' : String(raw)
  if (empty) {
    return <span>-</span>
  }
  const popoverContent = (
    <div className="financing-events-intro-popover-inner">
      <div style={{ marginBottom: 8 }}>
        <Button type="outline" size="mini" onClick={() => copyTextToClipboard(text)}>
          复制全文
        </Button>
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
          下方文本可选中复制
        </span>
      </div>
      <div
        className="financing-events-intro-selectable"
        style={{
          maxWidth: 520,
          maxHeight: 360,
          overflow: 'auto',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
          lineHeight: 1.55,
          padding: '4px 0',
        }}
      >
        {text}
      </div>
    </div>
  )
  const popoverNode = (
    <Popover
      title={columnTitle}
      trigger="click"
      position="top"
      popupClassName="financing-events-intro-popover"
      content={popoverContent}
    >
      <span
        style={{
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          color: 'rgb(var(--primary-6))',
        }}
        title="点击查看全文，可选中或复制"
      >
        {text}
      </span>
    </Popover>
  )

  if (triggerMaxWidth != null && Number.isFinite(Number(triggerMaxWidth))) {
    const w = Math.max(60, Number(triggerMaxWidth))
    return (
      <div className="intro-popover-ai-cell-wrap" style={{ maxWidth: w, width: '100%', minWidth: 0 }}>
        {popoverNode}
      </div>
    )
  }
  return popoverNode
}
