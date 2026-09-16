import React from 'react'
import { Button } from '@arco-design/web-react'

/** 操作列同名按钮共用一种颜色 */
export const LIST_OP_KIND = {
  详情: 'view',
  查看: 'view',
  正文: 'view',
  进入估值: 'view',
  进行估值: 'view',
  选择: 'add',
  编辑: 'edit',
  修改: 'edit',
  复制: 'add',
  同步: 'run',
  删除: 'delete',
  新增: 'add',
  添加: 'add',
  添加一级: 'add',
  添加二级: 'add',
  添加三级: 'add',
  日志: 'log',
  变更日志: 'log',
  AI日志: 'log',
  执行日志: 'log',
  复核: 'review',
  立即执行: 'run',
  发送邮件: 'run',
  测试: 'run',
  启用: 'add',
  禁用: 'review',
  停用: 'review',
  重置密码: 'review',
  编辑Cron: 'edit',
  手动同步: 'run',
  竞品: 'analyze',
}

export function listOpKind(label) {
  const key = String(label || '').trim()
  if (LIST_OP_KIND[key]) return LIST_OP_KIND[key]
  if (key.startsWith('添加')) return 'add'
  return 'view'
}

export function listOpButtonProps(label) {
  const kind = listOpKind(label)
  return {
    size: 'small',
    type: 'outline',
    className: `list-op-btn list-op-btn--${kind}`,
    status: kind === 'delete' ? 'danger' : undefined,
  }
}

export function ListOps({ children, className = '' }) {
  return <div className={['list-ops', className].filter(Boolean).join(' ')}>{children}</div>
}

export function ListOpButton({ name, children, className = '', ...rest }) {
  const label = name || (typeof children === 'string' ? children : '')
  const preset = listOpButtonProps(label)
  return (
    <Button
      {...preset}
      {...rest}
      className={[preset.className, className].filter(Boolean).join(' ')}
    >
      {children ?? name}
    </Button>
  )
}
