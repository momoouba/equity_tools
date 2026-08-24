import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Card,
  Table,
  Button,
  Message,
  Space,
  Select,
  Checkbox,
  Modal,
  Radio,
  Form,
  Input,
} from '@arco-design/web-react'
import axios from '../../utils/axios'
import {
  fetchCompetitorRelations,
  fetchCompetitorAnalysisRuns,
  fetchCompetitorExportYears,
  postCompetitorAnalysisExport,
  patchCompetitorRelationComparable,
  deleteCompetitorRelation,
  fetchInvestedEnterpriseCompetitorReadiness,
  fetchInvestedCompetitionLensProposal,
  postInvestedEnterpriseCompetitorAnalysisRun,
} from '../../api/competitor-analysis'
import { IntroPopoverCell } from './introPopoverAiCell'
import CompetitorAnalysisSummaryModal from './CompetitorAnalysisSummaryModal'
import CompetitorRelationManualAddModal from './CompetitorRelationManualAddModal'
import CompetitorRelationDetailBlock from './CompetitorRelationDetailBlock'
import CompetitorRelationReviewDrawer from './CompetitorRelationReviewDrawer'
import CompetitionLensConfirmModal from './CompetitionLensConfirmModal'
import CompetitorMatchSupplementModal from './CompetitorMatchSupplementModal'
import CompetitorScheduleTasksModal from './CompetitorScheduleTasksModal'
import {
  getCompetitorRelationColumns,
  downloadBlob,
  parseExportFilename,
  sortRelationsForDisplay,
} from './competitorRelationColumns'
import '../EnterpriseManagement.css'

const FormItem = Form.Item
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
/** 展开列 40 + 勾选 48 + 各列 width 之和 + 操作列 */
const POST_INV_MAIN_TABLE_SCROLL_X = 1508

function rowLabel(row) {
  return row?.enterprise_full_name || row?.project_abbreviation || row?.project_number || row?.id || ''
}

function sortRelationsByComparable(list) {
  return sortRelationsForDisplay(list)
}

/**
 * 竞品分析 — 竞品分析（被投 × 竞品）：主数据来自被投列表，展开查看已落库竞品关系。
 */
export default function ProjectSourcingCompetitorAnalysisPage({ embedded = false }) {
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
  const [reviewDrawer, setReviewDrawer] = useState({ visible: false, record: null, readOnly: false })
  const [editForm] = Form.useForm()
  const [editVisible, setEditVisible] = useState(false)
  const [editingRow, setEditingRow] = useState(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [competitorRunSubmitting, setCompetitorRunSubmitting] = useState(false)
  const [lensModal, setLensModal] = useState({
    visible: false,
    loading: false,
    confirming: false,
    enterpriseId: '',
    enterpriseName: '',
    proposal: null,
  })
  const [competitorSupplementModal, setCompetitorSupplementModal] = useState({
    visible: false,
    enterpriseId: '',
    enterpriseName: '',
  })
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)

  const openReviewDrawer = useCallback((record, opts = {}) => {
    setReviewDrawer({ visible: true, record, readOnly: !!opts.readOnly })
  }, [])

  const handleReviewSubmitted = useCallback(async (updated, meta) => {
    if (!updated?.id) return
    const subjectId = updated.invested_enterprise_id
    if (!subjectId) return
    if (meta?.refreshOnly) {
      setRelMap((m) => ({
        ...m,
        [subjectId]: (m[subjectId] || []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      }))
      setReviewDrawer((d) => ({ ...d, record: updated }))
      return
    }
    await loadRelations(subjectId, selectedRunMap[subjectId] || latestRunMap[subjectId], true)
  }, [latestRunMap, selectedRunMap])

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
        onReview: openReviewDrawer,
      }),
    [handleComparableToggle, comparableSavingId, handleEditRelation, handleDeleteRelation, openReviewDrawer]
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

  const openEditModal = (row) => {
    setEditingRow(row)
    editForm.setFieldsValue({
      ai_product_intro: row.ai_product_intro || '',
      ai_industry_tags: row.ai_industry_tags_display || '',
      qcc_company_intro: row.qcc_company_intro || '',
    })
    setEditVisible(true)
  }

  const handleEditSave = async () => {
    if (!editingRow?.id) return
    try {
      const v = await editForm.validate()
      setEditSubmitting(true)
      const tagsRaw = String(v.ai_industry_tags || '').trim()
      const res = await axios.put(`/api/enterprises/${editingRow.id}`, {
        project_abbreviation: editingRow.project_abbreviation || '',
        enterprise_full_name: editingRow.enterprise_full_name,
        unified_credit_code: editingRow.unified_credit_code || '',
        wechat_official_account_id: editingRow.wechat_official_account_id || '',
        official_website: editingRow.official_website || '',
        entity_type: editingRow.entity_type || '被投企业',
        exit_status: editingRow.exit_status || '未退出',
        ai_product_intro: v.ai_product_intro,
        ai_industry_tags_display: tagsRaw,
        qcc_company_intro: v.qcc_company_intro,
      })
      if (res.data?.success) {
        Message.success('已保存')
        setEditVisible(false)
        setEditingRow(null)
        editForm.resetFields()
        fetchList()
      } else {
        Message.error(res.data?.message || '保存失败')
      }
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    } finally {
      setEditSubmitting(false)
    }
  }

  const runCompetitorFlowForEnterprise = useCallback(async (enterpriseId, displayName) => {
    const res = await fetchInvestedEnterpriseCompetitorReadiness(enterpriseId)
    if (!res.data?.success) {
      Message.error(res.data?.message || '就绪校验失败')
      return
    }
    const d = res.data.data || {}
    if (d.needSupplement) {
      setCompetitorSupplementModal({
        visible: true,
        enterpriseId,
        enterpriseName: displayName || '',
      })
      return
    }
    setLensModal({
      visible: true,
      loading: true,
      confirming: false,
      enterpriseId,
      enterpriseName: displayName || '',
      proposal: null,
    })
    try {
      const pRes = await fetchInvestedCompetitionLensProposal(enterpriseId)
      if (!pRes.data?.success) {
        throw new Error(pRes.data?.message || '提取对标因素失败')
      }
      setLensModal((prev) => ({
        ...prev,
        loading: false,
        proposal: pRes.data.data,
      }))
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '提取对标因素失败')
      setLensModal({
        visible: false,
        loading: false,
        confirming: false,
        enterpriseId: '',
        enterpriseName: '',
        proposal: null,
      })
    }
  }, [])

  const handleInvestedLensConfirm = async (competitionLens) => {
    const { enterpriseId, enterpriseName } = lensModal
    if (!enterpriseId) return
    setLensModal((prev) => ({ ...prev, confirming: true }))
    try {
      const r2 = await postInvestedEnterpriseCompetitorAnalysisRun(enterpriseId, {
        competition_lens: competitionLens,
      })
      if (r2.status === 202 && r2.data?.success) {
        Message.success(r2.data.message || '已受理')
      } else if (r2.data?.success) {
        Message.success(r2.data.message || '已受理')
      } else {
        Message.error(r2.data?.message || '受理失败')
        setLensModal((prev) => ({ ...prev, confirming: false }))
        return
      }
      setLensModal({
        visible: false,
        loading: false,
        confirming: false,
        enterpriseId: '',
        enterpriseName: '',
        proposal: null,
      })
      if (expandedKeys.includes(enterpriseId)) {
        setRunMap((m) => {
          const next = { ...m }
          delete next[enterpriseId]
          return next
        })
        const { latestRunId } = await loadRuns(enterpriseId)
        await loadRelations(enterpriseId, latestRunId, true)
      }
    } catch (e) {
      Message.error(
        e.response?.data?.message || e.message || `「${enterpriseName || enterpriseId}」受理失败`
      )
      setLensModal((prev) => ({ ...prev, confirming: false }))
    }
  }

  const handleBatchCompetitor = useCallback(async () => {
    if (!selectedIds.length) {
      Message.warning('请先勾选要分析的被投企业')
      return
    }
    if (selectedIds.length === 1) {
      const id = selectedIds[0]
      const row = rows.find((e) => e.id === id)
      await runCompetitorFlowForEnterprise(id, rowLabel(row) || id)
      return
    }
    setCompetitorRunSubmitting(true)
    try {
      for (const id of selectedIds) {
        const row = rows.find((e) => e.id === id)
        const name = rowLabel(row) || id
        const res = await fetchInvestedEnterpriseCompetitorReadiness(id)
        if (!res.data?.success) {
          Message.error(res.data?.message || `「${name}」就绪校验失败`)
          return
        }
        if (res.data.data?.needSupplement) {
          Message.warning(`「${name}」需先补充业务信息（已打开补录窗口）`)
          setCompetitorSupplementModal({ visible: true, enterpriseId: id, enterpriseName: name })
          return
        }
      }
      await new Promise((resolve) => {
        Modal.confirm({
          title: '竞品分析（批量）',
          content: `将对已勾选的 ${selectedIds.length} 家被投企业依次发起新一轮竞品分析（按各企业系统默认对标焦点；精细勾选请每次只选 1 家）。是否继续？`,
          onOk: async () => {
            for (const id of selectedIds) {
              const row = rows.find((e) => e.id === id)
              const name = rowLabel(row) || id
              try {
                const r2 = await postInvestedEnterpriseCompetitorAnalysisRun(id)
                if (!r2.data?.success) {
                  Message.error(`「${name}」：${r2.data?.message || '失败'}`)
                  return
                }
              } catch (e) {
                Message.error(`「${name}」：${e.response?.data?.message || e.message || '失败'}`)
                return
              }
            }
            Message.success('批量任务已提交')
            resolve()
          },
          onCancel: () => resolve(),
        })
      })
    } finally {
      setCompetitorRunSubmitting(false)
    }
  }, [selectedIds, rows, runCompetitorFlowForEnterprise])

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
      title: '项目状态',
      dataIndex: 'exit_status',
      width: 100,
      render: (t) => t || '-',
    },
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
    {
      title: '操作',
      width: 80,
      fixed: 'right',
      render: (_, row) => (
        <Button type="text" size="mini" onClick={() => openEditModal(row)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <div className="pre-inv-sourcing-page" style={embedded ? undefined : { padding: '16px 24px' }}>
      <Card title={embedded ? undefined : '投后-竞品分析（被投企业 × 竞品）'} bordered={false}>
        <p style={{ color: 'var(--color-text-2)', marginBottom: 12, fontSize: 13 }}>
          仅展示<strong>已做过竞品分析</strong>且<strong>未退出</strong>的被投企业；展开可查看竞品关系（含产品介绍、企业标签、子基金）。勾选后可发起新一轮竞品分析；行内「编辑」可补充产品介绍、企业标签与企查查介绍。
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
          <Button type="outline" onClick={() => setScheduleModalOpen(true)}>
            定时任务
          </Button>
          <Button
            type="outline"
            disabled={!selectedIds.length}
            loading={competitorRunSubmitting}
            onClick={handleBatchCompetitor}
          >
            竞品分析
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
              ? getCompetitorRelationColumns({
                  comparableReadOnly: true,
                  actionReadOnly: true,
                  onReview: (record) => openReviewDrawer(record, { readOnly: true }),
                })
              : relColumns

            return (
              <CompetitorRelationDetailBlock
                embedded
                stopPropagation
                aiProductIntro={row.ai_product_intro || row.qcc_company_intro}
                industryTags={row.ai_industry_tags_display}
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
          scroll={{
            x: POST_INV_MAIN_TABLE_SCROLL_X,
            // 嵌入标签页时顶部多出 tab 头，压缩表体高度避免整页滚动
            y: embedded ? Math.max(300, tableScrollY - 96) : tableScrollY,
          }}
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
      <CompetitorRelationReviewDrawer
        visible={reviewDrawer.visible}
        record={reviewDrawer.record}
        readOnly={reviewDrawer.readOnly}
        onClose={() => setReviewDrawer({ visible: false, record: null, readOnly: false })}
        onSubmitted={handleReviewSubmitted}
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
        runId={manualAddSubject?.runId}
        editingRecord={editingRelation}
        onSaved={() => {
          if (!manualAddSubject?.id) return
          loadRelations(manualAddSubject.id, manualAddSubject.runId, true)
        }}
      />
      <Modal
        title={editingRow ? `编辑 — ${rowLabel(editingRow)}` : '编辑被投企业'}
        style={{ width: 640 }}
        visible={editVisible}
        onCancel={() => {
          setEditVisible(false)
          setEditingRow(null)
          editForm.resetFields()
        }}
        onOk={handleEditSave}
        confirmLoading={editSubmitting}
        okText="保存"
      >
        <p style={{ fontSize: 13, color: 'var(--color-text-2)', marginBottom: 12 }}>
          可人工补充或修正以下字段，保存后立即用于竞品分析与列表展示。
        </p>
        <Form form={editForm} layout="vertical">
          <FormItem label="产品介绍（AI）" field="ai_product_intro">
            <Input.TextArea
              placeholder="请输入或粘贴产品介绍"
              autoSize={{ minRows: 4, maxRows: 12 }}
              maxLength={8000}
              showWordLimit
            />
          </FormItem>
          <FormItem
            label="企业标签（AI）"
            field="ai_industry_tags"
            extra="多个标签请用中文逗号、英文逗号或顿号分隔"
          >
            <Input placeholder="例如：半导体、光刻胶、先进封装" />
          </FormItem>
          <FormItem label="企业介绍（企查查）" field="qcc_company_intro">
            <Input.TextArea
              placeholder="请输入企查查企业介绍正文"
              autoSize={{ minRows: 4, maxRows: 12 }}
              maxLength={16000}
              showWordLimit
            />
          </FormItem>
        </Form>
      </Modal>
      <CompetitorMatchSupplementModal
        visible={competitorSupplementModal.visible}
        investedEnterpriseId={competitorSupplementModal.enterpriseId}
        enterpriseName={competitorSupplementModal.enterpriseName}
        onClose={() => setCompetitorSupplementModal((s) => ({ ...s, visible: false }))}
        onSaved={() => {
          fetchList()
          setCompetitorSupplementModal((s) => ({ ...s, visible: false }))
        }}
      />
      <CompetitionLensConfirmModal
        visible={lensModal.visible}
        onClose={() =>
          setLensModal({
            visible: false,
            loading: false,
            confirming: false,
            enterpriseId: '',
            enterpriseName: '',
            proposal: null,
          })
        }
        subjectTitle={lensModal.enterpriseName}
        loadingProposal={lensModal.loading}
        proposal={lensModal.proposal}
        confirming={lensModal.confirming}
        onConfirm={handleInvestedLensConfirm}
      />
      <CompetitorScheduleTasksModal
        visible={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
      />
    </div>
  )
}
