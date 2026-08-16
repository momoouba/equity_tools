import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pagination, Typography } from '@arco-design/web-react'
import { fetchValuationChangeLog } from '../../api/valuation'
import { formatChinaDateTime } from './valuationUnits'
import { ListTable } from './valuationTable'

export default function ValuationChangeLog({ caseId }) {
  const [data, setData] = useState({ list: [], total: 0, page: 1, pageSize: 50 })
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (page = 1) => {
    if (!caseId) return
    setLoading(true)
    try {
      const res = await fetchValuationChangeLog(caseId, { page, pageSize: 50 })
      if (res.data?.success) setData(res.data.data || { list: [], total: 0, page, pageSize: 50 })
    } catch {
      setData({ list: [], total: 0, page: 1, pageSize: 50 })
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => { load(1) }, [load])

  return (
    <div className="valuation-change-log">
      <Alert
        type="info"
        style={{ marginBottom: 12 }}
        content="只记录会影响估值区间的关键项：锚定日、折现率、退出倍数、流动性折扣、WACC 分项、方法配置、申万三级、本轮交易估值，以及保存/发起版本。利润表、资产负债、现金流的数字改动不记入本表。"
      />
      <ListTable
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
        columns={[
          {
            title: '时间',
            dataIndex: 'created_at',
            width: 168,
            className: 'valuation-nowrap-cell',
            render: (v) => formatChinaDateTime(v),
          },
          { title: '操作人', dataIndex: 'user_account', width: 120, render: (v) => v || '—' },
          { title: '来源', dataIndex: 'source_label', width: 100 },
          { title: '项目', dataIndex: 'field_label', width: 180 },
          { title: '改前', dataIndex: 'old_value' },
          { title: '改后', dataIndex: 'new_value' },
        ]}
        data={data.list || []}
        noDataElement={<Typography.Text type="secondary">暂无变更。改锚定日、折现率或方法配置并等待自动保存后会出现在这里。</Typography.Text>}
      />
      {data.total > data.pageSize ? (
        <Pagination
          current={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={(p) => load(p)}
          style={{ marginTop: 12, textAlign: 'right' }}
        />
      ) : null}
    </div>
  )
}
