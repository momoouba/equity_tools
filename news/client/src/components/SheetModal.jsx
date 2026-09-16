import React from 'react'
import '../pages/EnterpriseForm.css'

export const sheetPopupContainer = () => document.body

export default function SheetModal({ visible, title, onClose, children, className = '', nested = false }) {
  if (!visible) return null
  return (
    <div
      className={`modal-overlay${nested ? ' modal-overlay--nested' : ''}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`modal-content modal-content--sheet modal-content-wide ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="close-button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function SheetActions({
  onCancel,
  submitLabel,
  extra,
  submitDisabled,
  submitLoading,
  cancelLabel = '取消',
  submitType = 'submit',
  onSubmitClick,
}) {
  return (
    <div className="form-actions">
      <button type="button" className="btn-cancel" onClick={onCancel} disabled={submitLoading}>
        {cancelLabel}
      </button>
      {extra}
      {submitLabel ? (
        <button
          type={submitType}
          className="btn-confirm"
          disabled={submitDisabled || submitLoading}
          onClick={onSubmitClick}
        >
          {submitLoading ? '处理中...' : submitLabel}
        </button>
      ) : null}
    </div>
  )
}

export function SheetViewer({
  visible,
  title,
  onClose,
  children,
  extra,
  submitLabel,
  onSubmitClick,
  submitLoading,
  className = '',
  nested = false,
}) {
  return (
    <SheetModal visible={visible} title={title} onClose={onClose} className={className} nested={nested}>
      <div className="enterprise-form enterprise-form--sheet">
        <div className="modal-body">{children}</div>
        <SheetActions
          onCancel={onClose}
          cancelLabel="关闭"
          extra={extra}
          submitLabel={submitLabel || ''}
          submitType="button"
          onSubmitClick={onSubmitClick}
          submitLoading={submitLoading}
        />
      </div>
    </SheetModal>
  )
}
