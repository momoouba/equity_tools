import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, Table, Button, Message, Space, Select, Checkbox, Modal, Radio } from '@arco-design/web-react'
import axios from '../../utils/axios'
import {
  fetchCompetitorRelations,
  fetchCompetitorAnalysisRuns,
  fetchCompetitorExportYears,
  postCompetitorAnalysisExport,
  patchCompetitorRelationComparable,
  deleteCompetitorRelation,
} from '../../api/竞品分析'
import { IntroPopoverCell } from './introPopoverAiCell'
import CompetitorAnalysisSummaryModal from './CompetitorAnalysisSummaryModal'
import CompetitorRelationManualAddModal from './CompetitorRelationManualAddModal'
import CompetitorRelationDetailBlock from './CompetitorRelationDetailBlock'
import {
  getCompetitorRelationColumns,
  downloadBlob,
  parseExportFilename,
} from './competitorRelationColumns'
import '../EnterpriseManagement.css'

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
/** 展开列 40 + 勾选 48 + 各列 width 之和 */
const POST_INV_MAIN_TABLE_SCROLL_X = 1328

function sortRelationsByComparable(list) {
  return [...(list || [])].sort((a, b) => {
    const ca = Number(a.include_in_comparable) === 1 ? 1 : 0
    const cb = Number(b.include_in_comparable) === 1 ? 1 : 0
    if (cb !== ca) return cb - ca
    const sa = Number(a.relevance_score) || 0
    const sb = Number(b.relevance_score) || 0
    if (sb !== sa) return sb - sa
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
}

/**
 * 竞品分析 — 竞品分析（被投 × 竞品）：主数据来自被投列表，展开查看已落库竞品关系。
 */
export default function ProjectSourcingCompetitorAnalysisPage() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [tableScrollY, setTableScrollY] = useState(520)
  const [expandedKeys, setExpandedKeys] = useState([])
  const [relMap, setRelMap] = useState({})
  const [relLoading, setRelLoading] = useState({})
  const [runMap, setRunMap] = useState({})
  const [selectedRunMap, setSelectedRunMap] = useState({})
  const [latestRunMap, setLatestRunMap] = useState({})
  const [relCacheKey, setRelCacheKey] = useState({})
  const [selectedIds, setSelectedIds] = useState([])
  const [exportYears, setExportYears] = useState([])
  const [yearFilter, setYearFilter] = useState([])
  const [exporting, setExporting] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportBatchMode, setExportBatchMode] = useState('latest')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryParams, setSummaryParams] = useState(null)
  const [summaryTitle, setSummaryTitle] = useState('')
  const [comparableSavingId, setComparableSavingId] = useState(null)
  const [manualAddVisible, setManualAddVisible] = useState(false)
  const [manualAddSubject, setManualAddSubject] = useState(null)
  const [editingRelation, setEditingRelation] = useState(null)

  const handleComparableToggle = useCallback(async (record, checked) => {
    const subjectId = record.invested_enterprise_id
    if (!subjectId || !record.id) return
    if (selectedRunMap[subjectId] && latestRunMap[subjectId] && selectedRunMap[subjectId] !== latestRunMap[subjectId]) {
      Message.warning('历史版本不可修改可比勾选，请切换到最新版本')
      return
    }
    setComparableSavingId(record.id)
    setRelMap((m) => {
      const list = sortRelationsByComparable(
        (m[subjectId] || []).map((r) =>
          r.id === record.id ? { ...r, include_in_comparable: checked ? 1 : 0 } : r
        )
      )
      return { ...m, [subjectId]: list }
    })
    try {
      const res = await patchCompetitorRelationComparable(record.id, checked)
      if (!res.data?.success) {
        throw new Error(res.data?.message || '保存失败')
      }
    } catch (e) {
      setRelMap((m) => {
        const list = sortRelationsByComparable(
          (m[subjectId] || []).map((r) =>
            r.id === record.id ? { ...r, include_in_comparable: checked ? 0 : 1 } : r
          )
        )
        return { ...m, [subjectId]: list }
      })
      Message.error(e.response?.data?.message || e.message || '保存失败')
    } finally {
      setComparableSavingId(null)
    }
  }, [latestRunMap, selectedRunMap])

  const handleEditRelation = useCallback(
    (record) => {
      const subjectId = record.invested_enterprise_id
      if (!subjectId) return
      const row = rows.find((r) => String(r.id) === String(subjectId))
      setEditingRelation(record)
      setManualAddSubject({
        id: subjectId,
        label: row?.enterprise_full_name || row?.project_abbreviation || subjectId,
        type: 'invested_enterprise',
        runId: selectedRunMap[subjectId] || latestRunMap[subjectId],
      })
      setManualAddVisible(true)
    },
    [rows, latestRunMap, selectedRunMap]
  )

  const handleDeleteRelation = useCallback(
    (record) => {
      const subjectId = record.invested_enterprise_id
      if (!subjectId || !record.id) return
      Modal.confirm({
        title: '确认删除',
        content: `确定删除竞品「${record.competitor_display_name || record.id}」？删除后不可恢复。`,
        onOk: async () => {
          try {
            const res = await deleteCompetitorRelation(record.id)
            if (!res.data?.success) {
              throw new Error(res.data?.message || '删除失败')
            }
            Message.success(res.data.message || '已删除')
            await loadRelations(subjectId, selectedRunMap[subjectId] || latestRunMap[subjectId], true)
          } catch (e) {
            Message.error(e.response?.data?.message || e.message || '删除失败')
          }
        },
      })
    },
    [latestRunMap, selectedRunMap]
  )

  const relColumns = useMemo(
    () =>
      getCompetitorRelationColumns({
        onComparableToggle: handleComparableToggle,
        comparableSavingId,
        onEdit: handleEditRelation,
        onDelete: handleDeleteRelation,
      }),
    [handleComparableToggle, comparableSavingId, handleEditRelation, handleDeleteRelation]
  )

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/enterprises', {
        params: {
          page,
          pageSize,
          data_app_name: '竞品分析',
          entity_type: '被投企业',
          has_competitor_analysis: 1,
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

  useEffect(() => {
    const calc = () => {
      setTableScrollY(Math.max(320, window.innerHeight - 320))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const loadRuns = async (enterpriseId) => {
    if (runMap[enterpriseId]?.loaded) {
      const list = runMap[enterpriseId].list || []
      return { list, latestRunId: latestRunMap[enterpriseId] || (list.length ? list[0].id : null) }
    }
    setRunMap((m) => ({ ...m, [enterpriseId]: { ...(m[enterpriseId] || {}), loading: true } }))
    try {
      const res = await fetchCompetitorAnalysisRuns({ invested_enterprise_id: enterpriseId })
      const list = res.data?.success ? res.data.data?.list || [] : []
      const latestRunId = res.data?.data?.latest_run_id || (list.length ? list[0].id : null)
      setRunMap((m) => ({ ...m, [enterpriseId]: { list, loaded: true, loading: false } }))
      setLatestRunMap((m) => ({ ...m, [enterpriseId]: latestRunId }))
      setSelectedRunMap((m) => {
        const prev = m[enterpriseId]
        const valid = new Set(list.map((run) => run.id))
        if (prev && valid.has(prev)) return m
        return { ...m, [enterpriseId]: latestRunId }
      })
      return { list, latestRunId }
    } catch (e) {
      setRunMap((m) => ({ ...m, [enterpriseId]: { list: [], loaded: true, loading: false } }))
      Message.error(e.response?.data?.message || e.message || '加载版本失败')
      return { list: [], latestRunId: null }
    }
  }

  const loadRelations = async (enterpriseId, runId, force = false) => {
    const cacheKey = runId || 'latest'
    if (!force && relCacheKey[enterpriseId] === cacheKey && relMap[enterpriseId]) return
    setRelLoading((m) => ({ ...m, [enterpriseId]: true }))
    try {
      const params = { invested_enterprise_id: enterpriseId }
      if (runId) params.run_id = runId
      const res = await fetchCompetitorRelations(params)
      if (res.data?.success) {
        const list = sortRelationsByComparable(res.data.data?.list || [])
        setRelMap((m) => ({ ...m, [enterpriseId]: list }))
        setRelCacheKey((m) => ({ ...m, [enterpriseId]: cacheKey }))
        const latestRunId = res.data.data?.latest_run_id || null
        if (latestRunId) {
          setLatestRunMap((m) => ({ ...m, [enterpriseId]: latestRunId }))
        }
        if (!runId && res.data.data?.run_id) {
          setSelectedRunMap((m) => ({ ...m, [enterpriseId]: res.data.data.run_id }))
        }
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载竞品失败')
    } finally {
      setRelLoading((m) => ({ ...m, [enterpriseId]: false }))
    }
  }

  const onExpandedRowsChange = async (keys) => {
    setExpandedKeys(keys)
    for (const id of keys) {
      const { latestRunId } = await loadRuns(id)
      const runId = selectedRunMap[id] || latestRunId
      const cacheKey = runId || 'latest'
      if (relCacheKey[id] === cacheKey && relMap[id]) continue
      await loadRelations(id, runId)
    }
  }

  const onVersionChange = async (enterpriseId, runId) => {
    setSelectedRunMap((m) => ({ ...m, [enterpriseId]: runId }))
    await loadRelations(enterpriseId, runId, true)
  }

  const handleRefresh = async () => {
    await fetchList()
    const keys = expandedKeys
    if (keys.length) {
      await Promise.all(
        keys.map(async (id) => {
          setRunMap((m) => {
            const next = { ...m }
            delete next[id]
            return next
          })
          const { latestRunId } = await loadRuns(id)
          const runId = selectedRunMap[id] || latestRunId
          await loadRelations(id, runId, true)
        })
      )
    }
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

  const openSummary = (enterpriseId, row) => {
    setSummaryParams({ invested_enterprise_id: enterpriseId })
    setSummaryTitle(row?.enterprise_full_name || row?.project_abbreviation || '')
    setSummaryOpen(true)
  }

  const runExport = async ({ exportAll, batchMode = 'latest' }) => {
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
        export_batch_mode: exportAll ? 'latest' : batchMode,
      })
      const blob = res.data
      const suffix = !exportAll && batchMode === 'all' ? '_所有批次' : ''
      const name = parseExportFilename(
        res.headers?.['content-disposition'],
        exportAll ? '竞品分析导出_全量.xlsx' : `竞品分析导出_${selectedIds.length}家${suffix}.xlsx`
      )
      downloadBlob(blob, name)
      Message.success('导出成功')
      setExportModalOpen(false)
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

  const openExportModal = () => {
    if (!selectedIds.length) {
      Message.warning('请先勾选要导出的被投企业')
      return
    }
    setExportBatchMode('latest')
    setExportModalOpen(true)
  }

  const allPageSelected = rows.length > 0 && rows.every((r) => selectedIds.includes(r.id))

  const columns = [
    {
      title: (
        <Checkbox
          checked={allPageSelected}
          indeterminate={selectedIds.length > 0 && !allPageSelected}
          onChange={toggleSelectAllPage}
        />
      ),
      width: 48,
      fixed: 'left',
      render: (_, row) => (
        <Checkbox
          checked={selectedIds.includes(row.id)}
          onChange={(checked) => toggleSelect(row.id, checked)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    { title: '项目编号', dataIndex: 'project_number', width: 140, render: (t) => t || '-' },
    { title: '企业全称', dataIndex: 'enterprise_full_name', width: 220, ellipsis: true, tooltip: true },
    { title: '项目简称', dataIndex: 'project_abbreviation', width: 120, ellipsis: true, render: (t) => t || '-' },
    { title: '统一信用代码', dataIndex: 'unified_credit_code', width: 180, render: (t) => t || '-' },
    {
      title: '产品介绍（AI）',
      dataIndex: 'ai_product_intro',
      width: 200,
      render: (t) => <IntroPopoverCell columnTitle="产品介绍（AI）" raw={t} triggerMaxWidth={180} />,
    },
    {
      title: '企业标签（AI）',
      dataIndex: 'ai_industry_tags_display',
      width: 180,
      render: (t) => <IntroPopoverCell columnTitle="企业标签（AI）" raw={t} triggerMaxWidth={160} />,
    },
    {
      title: '企业介绍（企查查）',
      dataIndex: 'qcc_company_intro',
      width: 200,
      render: (t, row) => (
        <IntroPopoverCell
          columnTitle="企业介绍（企查查）"
          raw={t || row.qcc_company_intro}
          triggerMaxWidth={180}
        />
      ),
    },
  ]

  return (
    <div className="pre-inv-sourcing-page" style={{ padding: '16px 24px' }}>
      <Card title="投后-竞品分析（被投企业 × 竞品）" bordered={false}>
        <p style={{ color: 'var(--color-text-2)', marginBottom: 12, fontSize: 13 }}>
          仅展示<strong>已做过竞品分析</strong>且<strong>未退出</strong>的被投企业；展开可查看竞品关系（含产品介绍、企业标签、子基金）。批量发起入口在
          <strong>被投企业</strong>列表左侧勾选 +「竞品分析（多选）」。
        </p>
        <Space wrap style={{ marginBottom: 12 }}>
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
          <Button type="outline" onClick={handleRefresh} loading={loading}>
            刷新
          </Button>
          <Button type="primary" loading={exporting} onClick={openExportModal}>
            导出已选
          </Button>
          <Button type="outline" loading={exporting} onClick={() => runExport({ exportAll: true })}>
            全量导出{yearFilter.length ? `（${yearFilter.join('、')}）` : ''}
          </Button>
        </Space>
        <Table
          className="pre-inv-sourcing-main-table"
          rowKey="id"
          stripe
          loading={loading}
          data={rows}
          columns={columns}
          expandedRowKeys={expandedKeys}
          onExpandedRowsChange={onExpandedRowsChange}
          expandProps={{ width: 40 }}
          expandedRowRender={(row) => {
            const runs = runMap[row.id]?.list || []
            const selectedRunId = selectedRunMap[row.id]
            const latestRunId = latestRunMap[row.id]
            const isHistorical =
              selectedRunId && latestRunId && String(selectedRunId) !== String(latestRunId)
            const detailColumns = isHistorical
              ? getCompetitorRelationColumns({ comparableReadOnly: true, actionReadOnly: true })
              : relColumns

            return (
              <CompetitorRelationDetailBlock
                embedded
                stopPropagation
                aiProductIntro={row.ai_product_intro || row.qcc_company_intro}
                runs={runs}
                selectedRunId={selectedRunId}
                runLoading={!!runMap[row.id]?.loading}
                isHistorical={isHistorical}
                onOpenSummary={() => openSummary(row.id, row)}
                onVersionChange={(v) => onVersionChange(row.id, v)}
                onAdd={() => {
                  setEditingRelation(null)
                  setManualAddSubject({
                    id: row.id,
                    label: row.enterprise_full_name || row.project_abbreviation || row.id,
                    type: 'invested_enterprise',
                    runId: selectedRunId || latestRunId,
                  })
                  setManualAddVisible(true)
                }}
                onRefresh={() => loadRelations(row.id, selectedRunId || latestRunId, true)}
                refreshLoading={!!relLoading[row.id]}
                relationColumns={detailColumns}
                relationData={relMap[row.id] || []}
                relationLoading={!!relLoading[row.id]}
              />
            )
          }}
          scroll={{ x: POST_INV_MAIN_TABLE_SCROLL_X, y: tableScrollY }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showTotal: true,
            showJumper: true,
            sizeCanChange: true,
            pageSizeChangeResetCurrent: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageSizeChange: (ps) => {
              setPageSize(ps)
              setPage(1)
            },
          }}
          border={{ wrapper: true, cell: true }}
        />
      </Card>
      <Modal
        title="导出已选被投企业"
        visible={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={() => runExport({ exportAll: false, batchMode: exportBatchMode })}
        confirmLoading={exporting}
        okText="开始导出"
      >
        <p style={{ marginBottom: 12, color: 'var(--color-text-2)', fontSize: 13 }}>
          将导出当前勾选的 {selectedIds.length} 家被投企业竞品数据。
        </p>
        <Radio.Group value={exportBatchMode} onChange={setExportBatchMode} direction="vertical">
          <Radio value="latest">仅最新批次（当前有效竞品关系）</Radio>
          <Radio value="all">所有批次（含历史分析，Excel 增加「版本号」列）</Radio>
        </Radio.Group>
      </Modal>
      <CompetitorAnalysisSummaryModal
        visible={summaryOpen}
        onClose={() => {
          setSummaryOpen(false)
          setSummaryParams(null)
        }}
        summaryParams={summaryParams}
        subjectTitle={summaryTitle}
      />
      <CompetitorRelationManualAddModal
        visible={manualAddVisible}
        onClose={() => {
          setManualAddVisible(false)
          setManualAddSubject(null)
          setEditingRelation(null)
        }}
        subjectType={manualAddSubject?.type}
        subjectId={manualAddSubject?.id}
        subjectLabel={manualAddSubject?.label}
        editingRecord={editingRelation}
        onSaved={() => {
          if (!manualAddSubject?.id) return
          loadRelations(manualAddSubject.id, manualAddSubject.runId, true)
        }}
      />
    </div>
  )
}
