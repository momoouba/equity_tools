import React from 'react'
import { Button, Message, Space, Upload } from '@arco-design/web-react'
import { importTargetFinancialsExcel, downloadTargetFinancialsTemplate } from '../../api/valuation'
import { coercePayloadToWan } from './valuationUnits'

export default function TargetFinancialImportBar({ caseId, onImported }) {
  return (
    <Space style={{ marginBottom: 12 }} wrap>
      <Upload
        accept=".xlsx,.xls"
        showUploadList={false}
        customRequest={async ({ file }) => {
          try {
            const res = await importTargetFinancialsExcel(caseId, file)
            if (!res.data?.success) {
              Message.error(res.data?.message || '导入失败')
              return
            }
            const payload = coercePayloadToWan(res.data.data?.payload || {})
            onImported?.(payload)
            const sheets = (res.data.data?.sheets || []).join('、')
            Message.success(sheets ? `已导入：${sheets}` : '已导入标的三表')
          } catch (e) {
            Message.error(e.response?.data?.message || e.message || '导入失败')
          }
        }}
      >
        <Button type="secondary">导入 Excel</Button>
      </Upload>
      <Button
        onClick={async () => {
          try {
            const res = await downloadTargetFinancialsTemplate(caseId)
            const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = '标的三表导入模板.xlsx'
            a.click()
            window.URL.revokeObjectURL(url)
          } catch (e) {
            Message.error(e.response?.data?.message || e.message || '模板下载失败')
          }
        }}
      >
        下载模板
      </Button>
    </Space>
  )
}
