import React from 'react'
import { Modal, Tabs, Typography, Alert } from '@arco-design/web-react'
import { SheetByKey } from './valuationSheetTables'

const TabPane = Tabs.TabPane

const TAB_ORDER = [
  ['result_compare', '结果对比'],
  ['dcf', 'DCF'],
  ['market', '市场法'],
  ['relative', '相对估值'],
  ['fees', '三费'],
  ['gross_margin', '毛利'],
  ['working_capital', '营运'],
  ['target_pl', '标的利润表'],
  ['target_bs', '标的资产负债表'],
  ['target_cf', '标的现金流量表'],
  ['tie_out', '三表勾稽'],
  ['industry', '行业倍数'],
]

export default function ValuationDetailModal({ visible, onClose, sheets, unsaved, warnings }) {
  const sheetMap = sheets || {}
  return (
    <Modal
      title={unsaved ? '估值明细（当前草稿，未保存版本）' : '估值明细'}
      visible={visible}
      onCancel={onClose}
      footer={null}
      style={{ width: '90vw', maxWidth: 1100 }}
    >
      {(warnings || []).length ? (
        <Alert type="warning" content={(warnings || []).join('；')} style={{ marginBottom: 12 }} />
      ) : null}
      <Tabs type="card">
        {TAB_ORDER.filter(([k]) => sheetMap[k] || k === 'result_compare').map(([k, title]) => {
          const sheet = sheetMap[k]
          if (!sheet && k !== 'result_compare') return null
          return (
            <TabPane key={k} title={sheet?.title || title}>
              {sheet?.formula ? (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  公式：{sheet.formula}
                </Typography.Paragraph>
              ) : null}
              <SheetByKey sheetKey={k} sheet={sheet} />
            </TabPane>
          )
        })}
      </Tabs>
    </Modal>
  )
}
