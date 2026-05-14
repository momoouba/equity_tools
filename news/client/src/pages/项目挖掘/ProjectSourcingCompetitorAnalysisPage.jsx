import React, { useEffect, useState, useCallback } from 'react'
import { Card, Table, Button, Message, Collapse, Space } from '@arco-design/web-react'
import axios from '../../utils/axios'
import { fetchCompetitorRelations } from '../../api/项目挖掘'
import { IntroPopoverCell } from './introPopoverAiCell'

const CollapseItem = Collapse.Item

/**
 * 项目挖掘 — 竞品分析（被投 × 竞品）：主数据来自被投列表，展开拉取已落库竞品关系（MVP 多为空）。
 */
export default function ProjectSourcingCompetitorAnalysisPage() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [activeKeys, setActiveKeys] = useState([])
  const [relMap, setRelMap] = useState({})
  const [relLoading, setRelLoading] = useState({})

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/enterprises', {
        params: {
          page,
          pageSize,
          data_app_name: '项目挖掘',
          entity_type: '被投企业',
        },
      })
      if (res.data?.success) {
        const list = (res.data.data || []).filter((r) => String(r.exit_status || '').trim() !== '已退出')
        setRows(list)
        setTotal(res.data.total ?? list.length)
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const loadRelations = async (enterpriseId) => {
    if (relMap[enterpriseId]) return
    setRelLoading((m) => ({ ...m, [enterpriseId]: true }))
    try {
      const res = await fetchCompetitorRelations({ invested_enterprise_id: enterpriseId })
      if (res.data?.success) {
        setRelMap((m) => ({ ...m, [enterpriseId]: res.data.data?.list || [] }))
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载竞品失败')
    } finally {
      setRelLoading((m) => ({ ...m, [enterpriseId]: false }))
    }
  }

  const onCollapseChange = (_key, keys) => {
    setActiveKeys(keys)
    keys.forEach((id) => {
      if (!relMap[id]) loadRelations(id)
    })
  }

  const relColumns = [
    { title: '竞品名称', dataIndex: 'competitor_display_name', ellipsis: true, render: (t) => t || '-' },
    { title: '信用代码', dataIndex: 'unified_credit_code', width: 160, render: (t) => t || '-' },
    { title: '相关性', dataIndex: 'relevance_score', width: 88, render: (v) => (v == null ? '-' : String(v)) },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 168,
      render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '-'),
    },
  ]

  return (
    <div style={{ padding: '16px 24px' }}>
      <Card title="竞品分析（被投企业 × 竞品）" bordered={false}>
        <p style={{ color: 'var(--color-text-2)', marginBottom: 16, fontSize: 13 }}>
          展示项目挖掘下<strong>未退出</strong>被投企业；展开可查看已落库竞品关系（全量召回与 LLM 打分接入后自动填充）。批量发起入口在
          <strong>被投企业</strong>列表左侧勾选 +「竞品分析（多选）」。
        </p>
        <Space style={{ marginBottom: 12 }}>
          <Button type="outline" onClick={fetchList} loading={loading}>
            刷新
          </Button>
        </Space>
        <Collapse activeKey={activeKeys} onChange={onCollapseChange}>
          {rows.map((r) => (
            <CollapseItem
              key={r.id}
              name={r.id}
              header={
                <Space>
                  <span style={{ fontWeight: 500 }}>{r.enterprise_full_name || r.project_abbreviation || r.id}</span>
                  <span style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
                    项目简称：{r.project_abbreviation || '—'}
                  </span>
                </Space>
              }
            >
              <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-2)' }}>产品介绍（AI）摘要：</div>
              <IntroPopoverCell columnTitle="产品介绍(AI)" raw={r.ai_product_intro} triggerMaxWidth={720} />
              <div style={{ marginTop: 16, marginBottom: 8, fontSize: 13, fontWeight: 500 }}>竞品明细</div>
              <Table
                rowKey="id"
                loading={!!relLoading[r.id]}
                data={relMap[r.id] || []}
                columns={relColumns}
                pagination={false}
                border={{ wrapper: true, cell: true }}
                scroll={{ x: 800 }}
              />
            </CollapseItem>
          ))}
        </Collapse>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>
            本页 {rows.length} 条（接口 total: {total}）
          </span>
          <Button type="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <Button type="outline" disabled={rows.length < pageSize} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      </Card>
    </div>
  )
}
