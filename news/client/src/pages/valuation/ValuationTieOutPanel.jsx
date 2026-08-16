import React from 'react'
import { Alert, Typography } from '@arco-design/web-react'
import { fmtAmountWan } from './valuationUnits'
import { ListTable } from './valuationTable'
import { buildValuationTieOut } from './valuationTieOut'

export default function ValuationTieOutPanel({ payload }) {
  const t = buildValuationTieOut(payload)
  const hasAny = t.ndBs != null || t.nwc != null || t.rows.length
  if (!hasAny) return null
  return (
    <div className="valuation-tieout">
      <Typography.Title heading={6} className="valuation-ratio-col-title">三表勾稽</Typography.Title>
      <Typography.Paragraph type="secondary" className="valuation-ratio-formula">
        净负债 = 短贷 + 长贷 − 货币资金。营运资本占用 = (应收票据+应收账款+预付款项+存货) − (应付票据+应付账款+预收款项)。
        自由现金流 = {t.nopat ? 'NOPAT' : '净利润'} + 折旧摊销 − 资本性支出 − 营运资本增加。ΔNWC 是当年增加额，不是期末占用。
      </Typography.Paragraph>
      {t.issues.length ? (
        <Alert type="warning" style={{ marginBottom: 12 }} content={t.issues.join('；')} />
      ) : (
        <Alert type="success" style={{ marginBottom: 12 }} content="净负债与 ΔNWC 未发现明显串科目。差额列应接近 0。" />
      )}
      <ListTable
        rowKey="name"
        pagination={false}
        size="small"
        columns={[
          { title: '项目', dataIndex: 'name', width: 200 },
          { title: '金额（万元）', dataIndex: 'value', width: 140, render: (v) => (v == null ? '—' : fmtAmountWan(v)) },
          { title: '说明', dataIndex: 'note' },
        ]}
        data={[
          {
            name: '净负债（资产负债表）',
            value: t.ndBs,
            note: '短贷 + 长贷 − 货币资金，DCF 扣减项',
          },
          {
            name: '净负债（DCF）',
            value: t.ndDcf,
            note: t.ndBs != null && t.ndDcf != null && Math.abs(t.ndBs - t.ndDcf) > 0.5 ? '与资产负债表不一致' : '应与上一行一致',
          },
          {
            name: '期末营运资本占用',
            value: t.nwc,
            note: '时点余额，不是现金流量表「营运资本增加」',
          },
        ]}
      />
      {t.rows.length ? (
        <ListTable
          rowKey="year"
          pagination={false}
          size="small"
          style={{ marginTop: 12 }}
          columns={[
            { title: '年份', dataIndex: 'year', width: 88 },
            { title: t.nopat ? 'NOPAT（万元）' : '净利润（万元）', dataIndex: 'earn', render: (v) => fmtAmountWan(v) },
            { title: '折旧摊销', dataIndex: 'da', render: (v) => fmtAmountWan(v) },
            { title: '资本性支出', dataIndex: 'capex', render: (v) => fmtAmountWan(v) },
            { title: 'ΔNWC', dataIndex: 'dnwc', render: (v) => fmtAmountWan(v) },
            { title: 'FCF 勾稽', dataIndex: 'expected', render: (v) => fmtAmountWan(v) },
            { title: 'FCF（DCF）', dataIndex: 'actual', render: (v) => (v == null ? '—' : fmtAmountWan(v)) },
            { title: '差额', dataIndex: 'gap', render: (v) => (v == null ? '—' : fmtAmountWan(v)) },
          ]}
          data={t.rows}
        />
      ) : null}
    </div>
  )
}
