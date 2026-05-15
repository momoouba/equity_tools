import React, { useEffect, useState, useCallback } from 'react'
import { Card, Table, Button, Message, Collapse, Space, Select, Checkbox, Modal, Spin } from '@arco-design/web-react'
import axios from '../../utils/axios'
import {
  fetchCompetitorRelations,
  fetchCompetitorExportYears,
  postCompetitorAnalysisExport,
  fetchCompetitorAnalysisSummary,
} from '../../api/项目挖掘'
import { IntroPopoverCell, copyTextToClipboard } from './introPopoverAiCell'

const CollapseItem = Collapse.Item

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

function parseExportFilename(contentDisposition, fallback) {
  if (!contentDisposition) return fallback
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(contentDisposition)
  const raw = m?.[1] || m?.[2]
  if (!raw) return fallback
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * 项目挖掘 — 竞品分析（被投 × 竞品）：主数据来自被投列表，展开查看已落库竞品关系。
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
  const [selectedIds, setSelectedIds] = useState([])
  const [exportYears, setExportYears] = useState([])
  const [yearFilter, setYearFilter] = useState([])
  const [exporting, setExporting] = useState(false)
  const [summaryVisible, setSummaryVisible] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryData, setSummaryData] = useState(null)

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
        let list = (res.data.data || []).filter((r) => String(r.exit_status || '').trim() !== '已退出')
        if (yearFilter.length) {
          list = list.filter((r) => yearFilter.includes(String(r.project_number || '').slice(0, 4)))
        }
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
  }, [page, pageSize, yearFilter])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    fetchCompetitorExportYears()
      .then((res) => {
        if (res.data?.success) setExportYears(res.data.data?.years || [])
      })
      .catch(() => {})
  }, [])

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

  const toggleSelect = (id, checked) => {
    setSelectedIds((prev) => {
      const set = new Set(prev)
      if (checked) set.add(id)
      else set.delete(id)
      return [...set]
    })
  }

  const toggleSelectAllPage = (checked) => {
    if (checked) setSelectedIds(rows.map((r) => r.id))
    else setSelectedIds([])
  }

  const openSummary = async (enterpriseId, e) => {
    e?.stopPropagation?.()
    setSummaryVisible(true)
    setSummaryLoading(true)
    setSummaryData(null)
    try {
      const res = await fetchCompetitorAnalysisSummary({ invested_enterprise_id: enterpriseId })
      if (res.data?.success) {
        setSummaryData(res.data.data)
      } else {
        Message.error(res.data?.message || '加载说明失败')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || err.message || '加载说明失败')
    } finally {
      setSummaryLoading(false)
    }
  }

  const runExport = async ({ exportAll }) => {
    if (!exportAll && !selectedIds.length) {
      Message.warning('请先勾选要导出的被投企业')
      return
    }
    setExporting(true)
    try {
      const res = await postCompetitorAnalysisExport({
        export_all: exportAll,
        invested_enterprise_ids: exportAll ? [] : selectedIds,
        years: yearFilter,
      })
      const blob = res.data
      const name = parseExportFilename(
        res.headers?.['content-disposition'],
        exportAll ? '竞品分析导出_全量.xlsx' : `竞品分析导出_${selectedIds.length}家.xlsx`
      )
      downloadBlob(blob, name)
      Message.success('导出成功')
    } catch (e) {
      if (e.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text()
          const j = JSON.parse(text)
          Message.error(j.message || '导出失败')
        } catch {
          Message.error('导出失败')
        }
      } else {
        Message.error(e.response?.data?.message || e.message || '导出失败')
      }
    } finally {
      setExporting(false)
    }
  }

  const relColumns = [
    { title: '竞品名称', dataIndex: 'competitor_display_name', width: 140, ellipsis: true, render: (t) => t || '-' },
    { title: '信用代码', dataIndex: 'unified_credit_code', width: 150, render: (t) => t || '-' },
    { title: '等级', dataIndex: 'confidence_grade', width: 56, render: (t) => t || '-' },
    { title: '综合分', dataIndex: 'relevance_score', width: 64, render: (v) => (v == null ? '-' : String(v)) },
    {
      title: '产品介绍',
      dataIndex: 'competitor_product_intro',
      width: 200,
      render: (t) => <IntroPopoverCell columnTitle="产品介绍" raw={t} triggerMaxWidth={480} />,
    },
    {
      title: '企业标签',
      dataIndex: 'competitor_tags_display',
      width: 160,
      render: (t) => <IntroPopoverCell columnTitle="企业标签" raw={t} triggerMaxWidth={480} />,
    },
    {
      title: '子基金名称',
      dataIndex: 'sub_fund_names',
      width: 120,
      ellipsis: true,
      render: (t) => t || '-',
    },
    {
      title: '数据源',
      dataIndex: 'data_sources_json',
      width: 100,
      ellipsis: true,
      render: (v) => {
        if (!v) return '-'
        try {
          const arr = typeof v === 'string' ? JSON.parse(v) : v
          if (Array.isArray(arr)) {
            const labels = { ipo_project: '底层', sourcing_financing_event: '融资', ai_web: '联网' }
            return arr.map((x) => labels[x] || x).join('、') || '-'
          }
        } catch {
          /* ignore */
        }
        return '-'
      },
    },
    { title: '融资', dataIndex: 'financing_amount_text', width: 90, ellipsis: true, render: (t) => t || '-' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '-'),
    },
  ]

  const allPageSelected = rows.length > 0 && rows.every((r) => selectedIds.includes(r.id))

  return (
    <div className="page-scope" style={{ padding: '16px 24px' }}>
      <Card title="竞品分析（被投企业 × 竞品）" bordered={false}>
        <p style={{ color: 'var(--color-text-2)', marginBottom: 16, fontSize: 13 }}>
          展示项目挖掘下<strong>未退出</strong>被投企业；展开可查看竞品关系（含产品介绍、企业标签、子基金）。批量发起入口在
          <strong>被投企业</strong>列表左侧勾选 +「竞品分析（多选）」。
        </p>
        <Space wrap style={{ marginBottom: 12 }}>
          <Checkbox
            checked={allPageSelected}
            indeterminate={selectedIds.length > 0 && !allPageSelected}
            onChange={toggleSelectAllPage}
          >
            全选本页
          </Checkbox>
          <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>已选 {selectedIds.length} 家</span>
          <Select
            mode="multiple"
            allowClear
            placeholder="按项目年度筛选列表"
            style={{ minWidth: 220 }}
            value={yearFilter}
            onChange={setYearFilter}
            options={exportYears.map((y) => ({ label: y, value: y }))}
          />
          <Button type="outline" onClick={fetchList} loading={loading}>
            刷新
          </Button>
          <Button type="primary" loading={exporting} onClick={() => runExport({ exportAll: false })}>
            导出已选
          </Button>
          <Button type="outline" loading={exporting} onClick={() => runExport({ exportAll: true })}>
            全量导出{yearFilter.length ? `（${yearFilter.join('、')}）` : ''}
          </Button>
        </Space>
        <Collapse activeKey={activeKeys} onChange={onCollapseChange}>
          {rows.map((r) => (
            <CollapseItem
              key={r.id}
              name={r.id}
              header={
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    gap: 12,
                  }}
                >
                  <Space>
                    <Checkbox
                      checked={selectedIds.includes(r.id)}
                      onChange={(checked) => toggleSelect(r.id, checked)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span style={{ fontWeight: 500 }}>{r.enterprise_full_name || r.project_abbreviation || r.id}</span>
                    <span style={{ color: 'var(--color-text-3)', fontSize: 12 }}>
                      项目简称：{r.project_abbreviation || '—'}
                    </span>
                    {r.project_number ? (
                      <span style={{ color: 'var(--color-text-3)', fontSize: 12 }}>编号：{r.project_number}</span>
                    ) : null}
                  </Space>
                  <Button type="outline" size="mini" onClick={(e) => openSummary(r.id, e)}>
                    竞品分析说明
                  </Button>
                </div>
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
                scroll={{ x: 1200 }}
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
      <Modal
        title="竞品分析说明"
        visible={summaryVisible}
        style={{ width: 720 }}
        footer={null}
        onCancel={() => setSummaryVisible(false)}
      >
        {summaryLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : (
          <>
            <Space style={{ marginBottom: 12 }}>
              <Button
                type="outline"
                size="mini"
                disabled={!summaryData?.full_text}
                onClick={() => copyTextToClipboard(summaryData?.full_text || '')}
              >
                复制全文
              </Button>
            </Space>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 13,
                lineHeight: 1.6,
                maxHeight: 480,
                overflow: 'auto',
                margin: 0,
                padding: 12,
                background: 'var(--color-fill-1)',
                borderRadius: 4,
              }}
            >
              {summaryData?.full_text || '暂无分析记录，请先在「被投企业」列表发起竞品分析。'}
            </pre>
          </>
        )}
      </Modal>
    </div>
  )
}
