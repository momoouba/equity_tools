import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  Card,
  Table,
  Button,
  Message,
  Modal,
  Form,
  Input,
  Space,
  Checkbox,
  Select,
  Radio,
  Upload,
} from '@arco-design/web-react'
import {
  fetchPreInvestmentProjects,
  fetchCompetitorRelations,
  fetchCompetitorAnalysisRuns,
  fetchCompetitorExportYears,
  postCompetitorAnalysisExport,
  postPreInvestmentProject,
  putPreInvestmentProject,
  deletePreInvestmentProject,
  postPreInvestmentQccBrief,
  postPreInvestmentBpExtract,
  postPreInvestmentQccFuzzyLookup,
  postPreInvestmentAiEnrich,
  postPreInvestmentCompetitorAnalysisRun,
  patchCompetitorRelationComparable,
  deleteCompetitorRelation,
} from '../../api/competitor-analysis'
import { IntroPopoverCell } from './introPopoverAiCell'
import CompetitorAnalysisSummaryModal from './CompetitorAnalysisSummaryModal'
import CompetitorRelationManualAddModal from './CompetitorRelationManualAddModal'
import CompetitorRelationDetailBlock from './CompetitorRelationDetailBlock'
import CompetitorRelationReviewDrawer from './CompetitorRelationReviewDrawer'
import {
  getCompetitorRelationColumns,
  downloadBlob,
  parseExportFilename,
  sortRelationsForDisplay,
} from './competitorRelationColumns'
import '../EnterpriseManagement.css'
import '../EnterpriseForm.css'

const FormItem = Form.Item
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
const BATCH_GAP_MS = 500
/** 展开列 40 + 勾选 48 + 各列 width 之和 */
const PRE_INV_MAIN_TABLE_SCROLL_X = 1428

function rowLabel(row) {
  return row.enterprise_full_name || row.project_abbreviation || row.project_no || row.id
}

function genPreviewProjectNo() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  return `P${ymd}${String(Math.floor(1000 + Math.random() * 9000))}`
}

function projectYear(projectNo) {
  const s = String(projectNo || '').trim()
  if (s.length >= 5 && s[0] === 'P') return s.slice(1, 5)
  return s.slice(0, 4)
}

function sortRelationsByComparable(list) {
  return sortRelationsForDisplay(list)
}

const AI_ENRICH_POLL_MS = 2500
const AI_ENRICH_WAIT_MAX_MS = 120000

/** 轮询投前项目 AI 取数直至 success/failed（批量操作在 202 后需等待后台任务） */
async function waitForPreInvAiEnrich(projectId) {
  const id = String(projectId || '').trim()
  if (!id) return
  const start = Date.now()
  while (Date.now() - start < AI_ENRICH_WAIT_MAX_MS) {
    await new Promise((r) => setTimeout(r, AI_ENRICH_POLL_MS))
    const res = await fetchPreInvestmentProjects({ page: 1, pageSize: 100 })
    const rows = res.data?.data?.list || []
    const row = rows.find((r) => String(r.id) === id)
    if (!row) continue
    const st = String(row.ai_enrich_status || '').trim()
    if (st === 'running' || st === 'pending' || !st) continue
    if (st === 'failed') {
      throw new Error(row.ai_enrich_error || row.pipeline_error || 'AI 取数失败')
    }
    if (st === 'success') {
      const hasIntro = String(row.ai_product_intro || '').trim().length > 0
      const hasTags = String(row.ai_industry_tags_display || '').trim().length > 0
      if (!hasIntro && !hasTags) {
        throw new Error('AI 取数未生成有效内容（模型返回为空），请核对企业全称或更换模型后重试')
      }
      return
    }
  }
  throw new Error('AI 取数等待超时，请稍后点击「刷新」查看')
}

export default function ProjectSourcingPreInvestmentPage() {
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createVisible, setCreateVisible] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [bpFile, setBpFile] = useState(null)
  const [bpFileList, setBpFileList] = useState([])
  const [editBpFile, setEditBpFile] = useState(null)
  const [editBpFileList, setEditBpFileList] = useState([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [qccCandidates, setQccCandidates] = useState([])
  const [showQccDropdown, setShowQccDropdown] = useState(false)
  const qccDropdownRef = useRef(null)
  const [projectNoPreview, setProjectNoPreview] = useState('')
  const [tableScrollY, setTableScrollY] = useState(520)
  const [batchBusy, setBatchBusy] = useState(null)
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
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const [editVisible, setEditVisible] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editingRow, setEditingRow] = useState(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryParams, setSummaryParams] = useState(null)
  const [summaryTitle, setSummaryTitle] = useState('')
  const [comparableSavingId, setComparableSavingId] = useState(null)
  const [manualAddVisible, setManualAddVisible] = useState(false)
  const [manualAddSubject, setManualAddSubject] = useState(null)
  const [editingRelation, setEditingRelation] = useState(null)
  const [reviewDrawer, setReviewDrawer] = useState({ visible: false, record: null, readOnly: false })

  const openReviewDrawer = useCallback((record, opts = {}) => {
    setReviewDrawer({ visible: true, record, readOnly: !!opts.readOnly })
  }, [])

  const handleReviewSubmitted = useCallback(
    async (updated, meta) => {
      if (!updated?.id) return
      const subjectId = updated.pre_investment_project_id
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
    },
    [latestRunMap, selectedRunMap]
  )

  const handleComparableToggle = useCallback(async (record, checked) => {
    const subjectId = record.pre_investment_project_id
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
      const subjectId = record.pre_investment_project_id
      if (!subjectId) return
      const row = list.find((r) => String(r.id) === String(subjectId))
      setEditingRelation(record)
      setManualAddSubject({
        id: subjectId,
        label: row ? rowLabel(row) : subjectId,
        type: 'pre_investment_project',
        runId: selectedRunMap[subjectId] || latestRunMap[subjectId],
      })
      setManualAddVisible(true)
    },
    [list, latestRunMap, selectedRunMap]
  )

  const handleDeleteRelation = useCallback(
    (record) => {
      const subjectId = record.pre_investment_project_id
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

  const loadRuns = async (projectId) => {
    if (runMap[projectId]?.loaded) {
      const list = runMap[projectId].list || []
      return { list, latestRunId: latestRunMap[projectId] || (list.length ? list[0].id : null) }
    }
    setRunMap((m) => ({ ...m, [projectId]: { ...(m[projectId] || {}), loading: true } }))
    try {
      const res = await fetchCompetitorAnalysisRuns({ pre_investment_project_id: projectId })
      const list = res.data?.success ? res.data.data?.list || [] : []
      const latestRunId = res.data?.data?.latest_run_id || (list.length ? list[0].id : null)
      setRunMap((m) => ({ ...m, [projectId]: { list, loaded: true, loading: false } }))
      setLatestRunMap((m) => ({ ...m, [projectId]: latestRunId }))
      setSelectedRunMap((m) => {
        const prev = m[projectId]
        const valid = new Set(list.map((run) => run.id))
        if (prev && valid.has(prev)) return m
        return { ...m, [projectId]: latestRunId }
      })
      return { list, latestRunId }
    } catch (e) {
      setRunMap((m) => ({ ...m, [projectId]: { list: [], loaded: true, loading: false } }))
      Message.error(e.response?.data?.message || e.message || '加载版本失败')
      return { list: [], latestRunId: null }
    }
  }

  const loadRelations = async (projectId, runId, force = false) => {
    const cacheKey = runId || 'latest'
    if (!force && relCacheKey[projectId] === cacheKey && relMap[projectId]) return
    setRelLoading((m) => ({ ...m, [projectId]: true }))
    try {
      const params = { pre_investment_project_id: projectId }
      if (runId) params.run_id = runId
      const res = await fetchCompetitorRelations(params)
      if (res.data?.success) {
        const list = sortRelationsByComparable(res.data.data?.list || [])
        setRelMap((m) => ({ ...m, [projectId]: list }))
        setRelCacheKey((m) => ({ ...m, [projectId]: cacheKey }))
        const latestRunId = res.data.data?.latest_run_id || null
        if (latestRunId) {
          setLatestRunMap((m) => ({ ...m, [projectId]: latestRunId }))
        }
        if (!runId && res.data.data?.run_id) {
          setSelectedRunMap((m) => ({ ...m, [projectId]: res.data.data.run_id }))
        }
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载竞品失败')
    } finally {
      setRelLoading((m) => ({ ...m, [projectId]: false }))
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

  const onVersionChange = async (projectId, runId) => {
    setSelectedRunMap((m) => ({ ...m, [projectId]: runId }))
    await loadRelations(projectId, runId, true)
  }

  const invalidateRelations = (projectId) => {
    setRelMap((m) => {
      const next = { ...m }
      delete next[projectId]
      return next
    })
    setRelCacheKey((m) => {
      const next = { ...m }
      delete next[projectId]
      return next
    })
    setRunMap((m) => {
      const next = { ...m }
      delete next[projectId]
      return next
    })
  }

  const handleRefresh = async () => {
    await load()
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

  useEffect(() => {
    const calc = () => {
      setTableScrollY(Math.max(320, window.innerHeight - 320))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (qccDropdownRef.current && !qccDropdownRef.current.contains(event.target)) {
        setShowQccDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const clearQccDropdown = () => {
    setQccCandidates([])
    setShowQccDropdown(false)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchPreInvestmentProjects({ page, pageSize })
      if (res.data?.success) {
        let rows = res.data.data?.list || []
        if (yearFilter.length) {
          rows = rows.filter((r) => yearFilter.includes(projectYear(r.project_no)))
        }
        setList(rows)
        setTotal(res.data.data?.total ?? 0)
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
    load()
  }, [load])

  useEffect(() => {
    fetchCompetitorExportYears({ subject_type: 'pre_investment_project' })
      .then((res) => {
        if (res.data?.success) setExportYears(res.data.data?.years || [])
      })
      .catch(() => {})
  }, [])

  const displayList = useMemo(() => list, [list])
  const selectedRows = useMemo(
    () => displayList.filter((r) => selectedIds.includes(r.id)),
    [displayList, selectedIds]
  )
  const hasSelection = selectedIds.length > 0
  const allPageSelected = displayList.length > 0 && displayList.every((r) => selectedIds.includes(r.id))
  const batchDisabled = !hasSelection || !!batchBusy

  const runSequentialOnSelected = async (actionKey, handler) => {
    if (!selectedRows.length) {
      Message.warning('请先勾选要操作的项目')
      return
    }
    setBatchBusy(actionKey)
    let ok = 0
    let fail = 0
    try {
      for (let i = 0; i < selectedRows.length; i += 1) {
        const row = selectedRows[i]
        try {
          await handler(row, i + 1, selectedRows.length)
          ok += 1
        } catch (e) {
          fail += 1
          Message.error(`${rowLabel(row)}：${e.response?.data?.message || e.message || '失败'}`)
        }
        if (i < selectedRows.length - 1) {
          await new Promise((r) => setTimeout(r, BATCH_GAP_MS))
        }
      }
      if (ok > 0) {
        Message.success(`已完成 ${ok} 项${fail > 0 ? `，失败 ${fail} 项` : ''}`)
        load()
      } else if (fail > 0) {
        Message.error('所选项目均未成功')
      }
    } finally {
      setBatchBusy(null)
    }
  }

  const handleBatchQccBrief = () => {
    if (!hasSelection) {
      Message.warning('请先勾选要操作的项目')
      return
    }
    Modal.confirm({
      title: '企查查简介',
      content: `确认为已选的 ${selectedRows.length} 个投前项目依次同步企查查简介？将逐条调用接口，避免并发堵塞。`,
      onOk: async () => {
        await runSequentialOnSelected('qcc', async (row) => {
          const res = await postPreInvestmentQccBrief(row.id)
          if (!res.data?.success) {
            throw new Error(res.data?.message || '失败')
          }
        })
      },
    })
  }

  const handleBatchAiEnrich = () => {
    if (!hasSelection) {
      Message.warning('请先勾选要操作的项目')
      return
    }
    Modal.confirm({
      title: 'AI 取数',
      content: `确认为已选的 ${selectedRows.length} 个投前项目依次发起 AI 取数？将逐条执行（含联网模型调用，单条约 30–90 秒），完成后自动刷新列表。`,
      onOk: async () => {
        await runSequentialOnSelected('ai', async (row) => {
          const res = await postPreInvestmentAiEnrich(row.id)
          if (!(res.status === 202 || res.data?.success)) {
            throw new Error(res.data?.message || '受理失败')
          }
          await waitForPreInvAiEnrich(row.id)
        })
        load()
      },
    })
  }

  const handleBatchCompetitor = () => {
    if (!hasSelection) {
      Message.warning('请先勾选要操作的项目')
      return
    }
    Modal.confirm({
      title: '竞品分析',
      content: `确认为已选的 ${selectedRows.length} 个投前项目依次发起竞品分析？将逐条提交异步任务。`,
      onOk: async () => {
        await runSequentialOnSelected('competitor', async (row) => {
          const res = await postPreInvestmentCompetitorAnalysisRun(row.id)
          if (!(res.status === 202 || res.data?.success)) {
            throw new Error(res.data?.message || '受理失败')
          }
          invalidateRelations(row.id)
          if (expandedKeys.includes(row.id)) {
            const { latestRunId } = await loadRuns(row.id)
            await loadRelations(row.id, latestRunId, true)
          }
        })
      },
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
    if (checked) setSelectedIds(displayList.map((r) => r.id))
    else setSelectedIds([])
  }

  const runExport = async ({ exportAll, batchMode = 'latest' }) => {
    if (!exportAll && !selectedIds.length) {
      Message.warning('请先勾选要导出的投前项目')
      return
    }
    setExporting(true)
    try {
      const res = await postCompetitorAnalysisExport({
        subject_type: 'pre_investment_project',
        export_all: exportAll,
        pre_investment_project_ids: exportAll ? [] : selectedIds,
        years: yearFilter,
        export_batch_mode: exportAll ? 'latest' : batchMode,
      })
      const blob = res.data
      const suffix = !exportAll && batchMode === 'all' ? '_所有批次' : ''
      const name = parseExportFilename(
        res.headers?.['content-disposition'],
        exportAll ? '投前竞品导出_全量.xlsx' : `投前竞品导出_${selectedIds.length}项${suffix}.xlsx`
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

  const openCreateModal = () => {
    setProjectNoPreview(genPreviewProjectNo())
    form.resetFields()
    clearQccDropdown()
    setBpFile(null)
    setBpFileList([])
    setCreateVisible(true)
  }

  /** 新增成功后：先企查查简介 → BP 提取（如有 BP 文件）→ AI 取数（整合 BP + 企查查信息） */
  const runPostCreatePipeline = async (projectId, projectNo, { hasBpFile = false } = {}) => {
    let qccOk = false
    let bpOk = false
    let aiOk = false
    try {
      const qccRes = await postPreInvestmentQccBrief(projectId)
      if (qccRes.data?.success) {
        qccOk = true
      } else {
        Message.warning(`企查查简介：${qccRes.data?.message || '同步失败'}`)
      }
    } catch (e) {
      Message.warning(`企查查简介：${e.response?.data?.message || e.message || '同步失败'}`)
    }
    await new Promise((r) => setTimeout(r, BATCH_GAP_MS))

    // BP 提取：后端会轮询等待 MarkItDown 转换完成（最多 60 秒）
    if (hasBpFile) {
      try {
        const bpRes = await postPreInvestmentBpExtract(projectId)
        if (bpRes.data?.success && bpRes.data?.data?.extracted) {
          bpOk = true
        }
      } catch (e) {
        Message.warning(`BP 提取：${e.response?.data?.message || e.message || '提取失败'}`)
      }
      await new Promise((r) => setTimeout(r, BATCH_GAP_MS))
    }

    // AI 取数始终运行；如果有 BP 提取内容，后端会将其与企查查信息整合
    try {
      const aiRes = await postPreInvestmentAiEnrich(projectId)
      if (aiRes.status === 202 || aiRes.data?.success) {
        aiOk = true
      } else {
        Message.warning(`AI 取数：${aiRes.data?.message || '受理失败'}`)
      }
    } catch (e) {
      Message.warning(`AI 取数：${e.response?.data?.message || e.message || '受理失败'}`)
    }

    const label = projectNo ? `项目 ${projectNo}` : '新项目'
    if (bpOk && aiOk) {
      Message.success(`${label} 已创建：企查查简介已同步，BP 提取 + AI 取数已受理（已整合 BP 内容），请稍后刷新列表`)
    } else if (qccOk && aiOk) {
      Message.success(`${label} 已创建：企查查简介已同步，AI 取数已受理，请稍后刷新列表`)
    } else if (qccOk || bpOk || aiOk) {
      const parts = []
      if (qccOk) parts.push('企查查简介已同步')
      if (bpOk) parts.push('BP 提取完成')
      if (aiOk) parts.push('AI 取数已受理')
      Message.warning(`${label} 已创建：${parts.join('，')}；部分步骤未成功，请在列表中重试`)
    } else {
      Message.warning(`${label} 已创建，但企查查简介与 AI 取数均未成功，请在列表中手动重试`)
    }
    return { qccOk, bpOk, aiOk }
  }

  const handleSelectQccCandidate = (company) => {
    form.setFieldsValue({
      enterprise_full_name: String(company.enterprise_full_name || '').trim(),
      unified_credit_code: String(company.unified_credit_code || '').trim(),
    })
    clearQccDropdown()
    Message.success('已填入企业全称与统一社会信用代码')
  }

  const openExportModal = () => {
    if (!selectedIds.length) {
      Message.warning('请先勾选要导出的投前项目')
      return
    }
    setExportBatchMode('latest')
    setExportModalOpen(true)
  }

  const openSummary = (projectId, row) => {
    const runId = selectedRunMap[projectId] || latestRunMap[projectId] || undefined
    setSummaryParams({
      pre_investment_project_id: projectId,
      ...(runId ? { run_id: runId } : {}),
    })
    setSummaryTitle(rowLabel(row))
    setSummaryOpen(true)
  }

  const openEditModal = (row) => {
    setEditingRow(row)
    editForm.setFieldsValue({
      ai_product_intro: row.ai_product_intro || '',
      ai_industry_tags: row.ai_industry_tags_display || '',
      qcc_company_intro: row.qcc_company_intro || '',
    })
    setEditBpFile(null)
    setEditBpFileList([])
    setEditVisible(true)
  }

  const handleEditSave = async () => {
    if (!editingRow?.id) return
    try {
      const v = await editForm.validate()
      setEditSubmitting(true)

      const payload = {
        ai_product_intro: v.ai_product_intro,
        ai_industry_tags: v.ai_industry_tags,
        qcc_company_intro: v.qcc_company_intro,
      }

      let res
      if (editBpFile) {
        const fd = new FormData()
        Object.entries(payload).forEach(([k, val]) => fd.append(k, val ?? ''))
        fd.append('bp_file', editBpFile)
        res = await putPreInvestmentProject(editingRow.id, fd)
      } else {
        res = await putPreInvestmentProject(editingRow.id, payload)
      }

      if (res.data?.success) {
        // 如果上传了新 BP，触发 BP 提取 + AI 取数整合
        if (editBpFile) {
          let bpOk = false
          try {
            const bpRes = await postPreInvestmentBpExtract(editingRow.id)
            if (bpRes.data?.success && bpRes.data?.data?.extracted) {
              bpOk = true
            }
          } catch (e) {
            Message.warning(`BP 提取：${e.response?.data?.message || e.message || '提取失败'}`)
          }
          await new Promise((r) => setTimeout(r, BATCH_GAP_MS))
          try {
            const aiRes = await postPreInvestmentAiEnrich(editingRow.id)
            if (aiRes.status === 202 || aiRes.data?.success) {
              Message.success(`已保存：${bpOk ? 'BP 提取 + ' : ''}AI 取数已受理，请稍后刷新查看整合结果`)
            } else {
              Message.warning(`已保存，但 AI 取数受理失败：${aiRes.data?.message || '未知错误'}`)
            }
          } catch (e) {
            Message.warning(`已保存，但 AI 取数受理失败：${e.response?.data?.message || e.message}`)
          }
        } else {
          Message.success('已保存')
        }
        setEditVisible(false)
        setEditingRow(null)
        editForm.resetFields()
        setEditBpFile(null)
        setEditBpFileList([])
        setSelectedIds((prev) => prev.filter((id) => id !== editingRow.id))
        load()
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

  const handleDeleteRow = (row) => {
    Modal.confirm({
      title: '删除投前项目',
      content: `确定删除「${rowLabel(row)}」？删除后列表不再展示，关联竞品关系将一并移除。`,
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        const res = await deletePreInvestmentProject(row.id)
        if (!res.data?.success) {
          throw new Error(res.data?.message || '删除失败')
        }
        Message.success('已删除')
        setSelectedIds((prev) => prev.filter((id) => id !== row.id))
        setExpandedKeys((prev) => prev.filter((id) => id !== row.id))
        load()
      },
    })
  }

  const handleQccLookup = async () => {
    const abbrev = String(form.getFieldValue('project_abbreviation') || '').trim()
    if (abbrev.length < 2) {
      Message.warning('请先填写企业简称（至少 2 字）')
      return
    }
    setLookupLoading(true)
    clearQccDropdown()
    try {
      const res = await postPreInvestmentQccFuzzyLookup({ search_key: abbrev })
      if (!res.data?.success) {
        Message.error(res.data?.message || '查询失败')
        return
      }
      const d = res.data.data || {}
      const candidates = Array.isArray(d.candidates) ? d.candidates : []
      if (candidates.length === 0) {
        Message.warning('未找到相关企业信息，请尝试其它简称或手填全称与信用代码')
        return
      }
      setQccCandidates(candidates)
      setShowQccDropdown(true)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '查询失败')
    } finally {
      setLookupLoading(false)
    }
  }

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
    { title: '项目编号', dataIndex: 'project_no', width: 140, render: (t) => t || '-' },
    { title: '企业全称', dataIndex: 'enterprise_full_name', width: 220, ellipsis: true, tooltip: true },
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
      render: (t) => <IntroPopoverCell columnTitle="企业介绍（企查查）" raw={t} triggerMaxWidth={180} />,
    },
    { title: '状态', dataIndex: 'pipeline_status', width: 100 },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Space size="mini">
          <Button type="text" size="mini" onClick={() => openEditModal(row)}>
            编辑
          </Button>
          <Button type="text" size="mini" status="danger" onClick={() => handleDeleteRow(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div className="pre-inv-sourcing-page" style={{ padding: '16px 24px' }}>
      <Card
        title="投前-竞品分析"
        bordered={false}
        extra={
          <Button type="primary" onClick={openCreateModal}>
            新增
          </Button>
        }
      >
        <p style={{ color: 'var(--color-text-2)', marginBottom: 12, fontSize: 13 }}>
          新增成功后将自动依次同步企查查简介并受理 AI 取数；勾选项目后可在工具栏批量操作；AI 无法取数时可在行内「编辑」人工补充产品介绍、企业标签与企查查介绍。
        </p>
        <Space wrap style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-3)' }}>已选 {selectedIds.length} 项</span>
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
          <Button
            type="outline"
            disabled={batchDisabled}
            loading={batchBusy === 'qcc'}
            onClick={handleBatchQccBrief}
          >
            企查查简介
          </Button>
          <Button
            type="outline"
            disabled={batchDisabled}
            loading={batchBusy === 'ai'}
            onClick={handleBatchAiEnrich}
          >
            AI取数
          </Button>
          <Button
            type="outline"
            disabled={batchDisabled}
            loading={batchBusy === 'competitor'}
            onClick={handleBatchCompetitor}
          >
            竞品分析
          </Button>
        </Space>
        <Table
          className="pre-inv-sourcing-main-table"
          rowKey="id"
          stripe
          loading={loading}
          data={displayList}
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
            const columns = isHistorical
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
                aiProductIntro={row.ai_product_intro}
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
                    label: rowLabel(row),
                    type: 'pre_investment_project',
                    runId: selectedRunId || latestRunId,
                  })
                  setManualAddVisible(true)
                }}
                onRefresh={() => loadRelations(row.id, selectedRunId || latestRunId, true)}
                refreshLoading={!!relLoading[row.id]}
                relationColumns={columns}
                relationData={relMap[row.id] || []}
                relationLoading={!!relLoading[row.id]}
              />
            )
          }}
          scroll={{ x: PRE_INV_MAIN_TABLE_SCROLL_X, y: tableScrollY }}
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
        title={editingRow ? `编辑 — ${rowLabel(editingRow)}` : '编辑投前项目'}
        style={{ width: 640 }}
        visible={editVisible}
        onCancel={() => {
          setEditVisible(false)
          setEditingRow(null)
          editForm.resetFields()
          setEditBpFile(null)
          setEditBpFileList([])
        }}
        onOk={handleEditSave}
        confirmLoading={editSubmitting}
        okText="保存"
      >
        <p style={{ fontSize: 13, color: 'var(--color-text-2)', marginBottom: 12 }}>
          可人工补充或修正以下字段，保存后立即用于竞品分析与列表展示。
        </p>
        <Form form={editForm} layout="vertical">
          <FormItem
            label="上传BP"
            extra={editingRow?.bp_filename && !editBpFile
              ? `当前BP：${editingRow.bp_filename}；重新选择文件将替换原BP并重新提取`
              : editBpFile
                ? '保存后将解析此文件并与现有产品介绍、企业标签整合'
                : '非必填，支持任意格式文件；上传保存后将自动解析并与现有信息整合'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload
                limit={1}
                fileList={editBpFileList}
                autoUpload={false}
                showUploadList={false}
                onChange={(fileList) => {
                  setEditBpFileList(fileList)
                  const item = fileList.length > 0 ? fileList[0] : null
                  const rawFile = item?.originFile || item?.file || null
                  setEditBpFile(rawFile)
                }}
              >
                <Button type="outline" size="small">
                  {editingRow?.bp_filename ? '重新选择文件' : '选择文件'}
                </Button>
              </Upload>
              {editBpFile && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <span style={{ color: 'rgb(var(--primary-6))' }}>{editBpFile.name}</span>
                  <span
                    onClick={() => { setEditBpFile(null); setEditBpFileList([]) }}
                    style={{ cursor: 'pointer', color: 'var(--color-text-3)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                    title="移除文件"
                  >×</span>
                </span>
              )}
            </div>
          </FormItem>
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

      <Modal
        title="新增企业信息"
        style={{ width: 520 }}
        visible={createVisible}
        onCancel={() => {
          setCreateVisible(false)
          form.resetFields()
          clearQccDropdown()
          setBpFile(null)
          setBpFileList([])
        }}
        onOk={async () => {
          try {
            const v = await form.validate()
            setCreateSubmitting(true)
            const payload = {
              enterprise_full_name: v.enterprise_full_name,
              unified_credit_code: v.unified_credit_code || '',
              project_abbreviation: v.project_abbreviation || '',
              project_no: projectNoPreview,
            }
            let res
            if (bpFile) {
              const fd = new FormData()
              Object.entries(payload).forEach(([k, val]) => fd.append(k, val))
              fd.append('bp_file', bpFile)
              res = await postPreInvestmentProject(fd)
            } else {
              res = await postPreInvestmentProject(payload)
            }
            if (res.data?.success) {
              const savedNo = res.data.data?.project_no || projectNoPreview
              const projectId = res.data.data?.id
              if (projectId) {
                await runPostCreatePipeline(projectId, savedNo, { hasBpFile: !!bpFile })
              } else {
                Message.success(`已创建（项目编号 ${savedNo}）`)
              }
              setCreateVisible(false)
              form.resetFields()
              clearQccDropdown()
              setBpFile(null)
              setBpFileList([])
              load()
            } else {
              Message.error(res.data?.message || '创建失败')
              return false
            }
          } catch (e) {
            if (e?.errors) return false
            Message.error(e.response?.data?.message || e.message || '创建失败')
            return false
          } finally {
            setCreateSubmitting(false)
          }
        }}
        confirmLoading={createSubmitting}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if (Object.prototype.hasOwnProperty.call(changed, 'project_abbreviation')) {
              clearQccDropdown()
            }
          }}
        >
          <FormItem label="项目编号">
            <Input value={projectNoPreview} disabled placeholder="自动生成" />
          </FormItem>
          <FormItem label="企业简称">
            <div ref={qccDropdownRef} style={{ position: 'relative', width: '100%' }}>
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <FormItem field="project_abbreviation" noStyle>
                  <Input placeholder="请输入企业简称" style={{ flex: 1 }} />
                </FormItem>
                <Button type="primary" loading={lookupLoading} onClick={handleQccLookup}>
                  查询
                </Button>
              </div>
              {showQccDropdown && qccCandidates.length > 0 && (
                <div className="dropdown-menu" style={{ zIndex: 1100 }}>
                  {qccCandidates.map((company, index) => (
                    <div
                      key={`${company.unified_credit_code || company.enterprise_full_name}-${index}`}
                      className="dropdown-item"
                      onClick={() => handleSelectQccCandidate(company)}
                    >
                      <div className="dropdown-item-main">{company.enterprise_full_name}</div>
                      {company.unified_credit_code ? (
                        <div className="dropdown-item-sub">
                          统一社会信用代码：{company.unified_credit_code}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormItem>
          <FormItem
            label="企业全称"
            field="enterprise_full_name"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="请输入企业全称（查询后请从列表中选择）" />
          </FormItem>
          <FormItem label="统一信用代码" field="unified_credit_code">
            <Input placeholder="请输入统一信用代码（查询后请从列表中选择）" />
          </FormItem>
          <FormItem label="上传BP" extra="非必填，支持任意格式文件">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload
                limit={1}
                fileList={bpFileList}
                autoUpload={false}
                showUploadList={false}
                onChange={(fileList) => {
                  setBpFileList(fileList)
                  const item = fileList.length > 0 ? fileList[0] : null
                  const rawFile = item?.originFile || item?.file || null
                  setBpFile(rawFile)
                }}
              >
                <Button type="outline" size="small">选择文件</Button>
              </Upload>
              {bpFile && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <span style={{ color: 'rgb(var(--primary-6))' }}>{bpFile.name}</span>
                  <span
                    onClick={() => { setBpFile(null); setBpFileList([]) }}
                    style={{ cursor: 'pointer', color: 'var(--color-text-3)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                    title="移除文件"
                  >×</span>
                </span>
              )}
            </div>
          </FormItem>
        </Form>
      </Modal>
      <Modal
        title="导出已选投前项目"
        visible={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={() => runExport({ exportAll: false, batchMode: exportBatchMode })}
        confirmLoading={exporting}
        okText="开始导出"
      >
        <p style={{ marginBottom: 12, color: 'var(--color-text-2)', fontSize: 13 }}>
          将导出当前勾选的 {selectedIds.length} 个投前项目竞品数据。
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
    </div>
  )
}
