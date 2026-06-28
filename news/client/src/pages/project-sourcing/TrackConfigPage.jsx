import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Message,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Tree,
  Typography,
} from '@arco-design/web-react'
import {
  createTrack,
  createTrackLv1,
  createTrackLv2,
  createTrackLv3,
  deleteTrack,
  deleteTrackLv1,
  deleteTrackLv2,
  deleteTrackLv3,
  fetchTrackTree,
  getTrackExportExcel,
  getTrackImportTemplate,
  postTrackApplyMatch,
  postTrackImport,
  updateTrack,
  updateTrackLv1,
  updateTrackLv2,
  updateTrackLv3,
} from '../../api/project-sourcing'

const FormItem = Form.Item
const Option = Select.Option

function collectExpandedKeys(tracks) {
  const keys = []
  if (!tracks || !tracks.length) return keys
  for (let ti = 0; ti < tracks.length; ti++) {
    const t = tracks[ti]
    keys.push(`t-${t.id}`)
    const l1list = t.lv1_list || []
    for (let i = 0; i < l1list.length; i++) {
      const l1 = l1list[i]
      keys.push(`l1-${l1.id}`)
      const l2list = l1.lv2_list || []
      for (let j = 0; j < l2list.length; j++) {
        keys.push(`l2-${l2list[j].id}`)
      }
    }
  }
  return keys
}

/** 树节点名称 / 三级关键词模糊过滤（父节点命中则保留整枝） */
function filterTrackTree(tracks, keyword) {
  const k = String(keyword || '').trim().toLowerCase()
  if (!k) return tracks

  function matchName(n) {
    return String(n || '').toLowerCase().includes(k)
  }

  function filtLv3(list) {
    return (list || []).filter((x) => matchName(x.name) || matchName(x.match_keywords))
  }

  function filtLv2(l2) {
    if (matchName(l2.name)) return { ...l2, lv3_list: l2.lv3_list || [] }
    const l3s = filtLv3(l2.lv3_list)
    if (l3s.length) return { ...l2, lv3_list: l3s }
    return null
  }

  function filtLv1(l1) {
    if (matchName(l1.name)) return { ...l1, lv2_list: l1.lv2_list || [] }
    const l2s = (l1.lv2_list || []).map(filtLv2).filter(Boolean)
    if (l2s.length) return { ...l1, lv2_list: l2s }
    return null
  }

  return tracks
    .map((t) => {
      if (matchName(t.name)) return { ...t, lv1_list: t.lv1_list || [] }
      const l1s = (t.lv1_list || []).map(filtLv1).filter(Boolean)
      if (l1s.length) return { ...t, lv1_list: l1s }
      return null
    })
    .filter(Boolean)
}

function nodeBreadcrumb(tree, type, id) {
  if (!tree || !tree.length) return []
  for (let ti = 0; ti < tree.length; ti++) {
    const t = tree[ti]
    if (type === 'track' && t.id === id) return [`赛道：${t.name}`]
    const l1list = t.lv1_list || []
    for (let i = 0; i < l1list.length; i++) {
      const l1 = l1list[i]
      if (type === 'lv1' && l1.id === id) return [`赛道：${t.name}`, `一级：${l1.name}`]
      const l2list = l1.lv2_list || []
      for (let j = 0; j < l2list.length; j++) {
        const l2 = l2list[j]
        if (type === 'lv2' && l2.id === id) {
          return [`赛道：${t.name}`, `一级：${l1.name}`, `二级：${l2.name}`]
        }
        const l3list = l2.lv3_list || []
        for (let h = 0; h < l3list.length; h++) {
          const l3 = l3list[h]
          if (type === 'lv3' && l3.id === id) {
            return [`赛道：${t.name}`, `一级：${l1.name}`, `二级：${l2.name}`, `三级：${l3.name}`]
          }
        }
      }
    }
  }
  return []
}

function buildLv1Options(tree) {
  const opts = []
  if (!tree) return opts
  for (let ti = 0; ti < tree.length; ti++) {
    const t = tree[ti]
    const l1list = t.lv1_list || []
    for (let i = 0; i < l1list.length; i++) {
      const l1 = l1list[i]
      opts.push({ label: `${t.name} / ${l1.name}`, value: l1.id })
    }
  }
  return opts
}

function buildLv2Options(tree) {
  const opts = []
  if (!tree) return opts
  for (let ti = 0; ti < tree.length; ti++) {
    const t = tree[ti]
    const l1list = t.lv1_list || []
    for (let i = 0; i < l1list.length; i++) {
      const l1 = l1list[i]
      const l2list = l1.lv2_list || []
      for (let j = 0; j < l2list.length; j++) {
        const l2 = l2list[j]
        opts.push({ label: `${t.name} / ${l1.name} / ${l2.name}`, value: l2.id })
      }
    }
  }
  return opts
}

/** 与 Excel 导入列一致，对应表 sourcing_track_lv3 */
function buildLv3RuleSummary(l3) {
  const sort = l3.sort_order ?? 0
  const pri = l3.match_priority ?? 0
  const i1 = String(l3.match_industry_lv1 || '').trim()
  const i2 = String(l3.match_industry_lv2 || '').trim()
  const kw = String(l3.match_keywords || '').trim()
  const parts = [`排序 ${sort}`]
  if (i1 || i2) {
    parts.push(`行业 ${(i1 || '—') + ' / ' + (i2 || '—')}`)
  }
  if (kw) {
    parts.push(`关键词 ${kw}`)
  }
  parts.push(`优先级 ${pri}`)
  const full = parts.join(' · ')
  const max = 96
  const short = full.length > max ? `${full.slice(0, max)}…` : full
  return { full, short, hasRule: !!(i1 || i2 || kw) }
}

export default function TrackConfigPage() {
  const [loading, setLoading] = useState(false)
  const [tree, setTree] = useState([])
  const [filterKw, setFilterKw] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [expandedKeys, setExpandedKeys] = useState([])
  const [matchSubmitting, setMatchSubmitting] = useState(false)

  const [importVisible, setImportVisible] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importErrors, setImportErrors] = useState([])

  const [trackModalVisible, setTrackModalVisible] = useState(false)
  const [trackEditing, setTrackEditing] = useState(null)
  const [trackForm] = Form.useForm()

  const [lv1ModalVisible, setLv1ModalVisible] = useState(false)
  const [lv1Editing, setLv1Editing] = useState(null)
  const [lv1ParentTrackId, setLv1ParentTrackId] = useState(null)
  const [lv1Form] = Form.useForm()

  const [lv2ModalVisible, setLv2ModalVisible] = useState(false)
  const [lv2Editing, setLv2Editing] = useState(null)
  const [lv2ParentLv1Id, setLv2ParentLv1Id] = useState(null)
  const [lv2Form] = Form.useForm()

  const [lv3ModalVisible, setLv3ModalVisible] = useState(false)
  const [lv3Editing, setLv3Editing] = useState(null)
  const [lv3ParentLv2Id, setLv3ParentLv2Id] = useState(null)
  const [lv3Form] = Form.useForm()

  const filteredTree = useMemo(() => filterTrackTree(tree, appliedFilter), [tree, appliedFilter])

  const lv1Options = useMemo(() => buildLv1Options(tree), [tree])
  const lv2Options = useMemo(() => buildLv2Options(tree), [tree])

  const loadTree = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchTrackTree()
      if (res.data?.success) {
        setTree(res.data.data || [])
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  useEffect(() => {
    setExpandedKeys(collectExpandedKeys(filteredTree))
  }, [filteredTree])

  const hierarchyHint = (parts) =>
    parts.length ? (
      <div
        style={{
          marginBottom: 12,
          padding: '8px 10px',
          background: 'var(--color-fill-2)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--color-text-2)',
          lineHeight: 1.5,
        }}
      >
        <Typography.Text type="secondary">当前层级：</Typography.Text>
        {parts.join(' → ')}
      </div>
    ) : null

  const openTrackModal = (row) => {
    setTrackEditing(row || null)
    trackForm.resetFields()
    if (row) {
      trackForm.setFieldsValue({ name: row.name, sort_order: row.sort_order ?? 0 })
    } else {
      trackForm.setFieldsValue({ name: '', sort_order: 0 })
    }
    setTrackModalVisible(true)
  }

  const submitTrack = async () => {
    try {
      const v = await trackForm.validate()
      if (trackEditing) {
        await updateTrack(trackEditing.id, v)
        Message.success('已保存')
      } else {
        await createTrack(v)
        Message.success('已新增赛道')
      }
      setTrackModalVisible(false)
      await loadTree()
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const openLv1Modal = (row, parentTrackId) => {
    const tid = row ? row.track_id : parentTrackId
    if (!tid) {
      Message.warning('无法确定所属赛道')
      return
    }
    setLv1Editing(row || null)
    setLv1ParentTrackId(tid)
    lv1Form.resetFields()
    if (row) {
      lv1Form.setFieldsValue({
        name: row.name,
        sort_order: row.sort_order ?? 0,
        track_id: row.track_id ?? tid,
      })
    } else {
      lv1Form.setFieldsValue({ name: '', sort_order: 0 })
    }
    setLv1ModalVisible(true)
  }

  const submitLv1 = async () => {
    try {
      const v = await lv1Form.validate()
      if (lv1Editing) {
        await updateTrackLv1(lv1Editing.id, {
          name: v.name,
          sort_order: v.sort_order,
          track_id: v.track_id,
        })
        Message.success('已保存')
      } else {
        await createTrackLv1({ name: v.name, sort_order: v.sort_order, track_id: lv1ParentTrackId })
        Message.success('已新增一级分类')
      }
      setLv1ModalVisible(false)
      await loadTree()
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const openLv2Modal = (row, parentLv1Id) => {
    const pid = row ? row.lv1_id : parentLv1Id
    if (!pid) {
      Message.warning('无法确定所属一级分类')
      return
    }
    setLv2Editing(row || null)
    setLv2ParentLv1Id(pid)
    lv2Form.resetFields()
    if (row) {
      lv2Form.setFieldsValue({
        name: row.name,
        sort_order: row.sort_order ?? 0,
        lv1_id: row.lv1_id ?? pid,
      })
    } else {
      lv2Form.setFieldsValue({ name: '', sort_order: 0 })
    }
    setLv2ModalVisible(true)
  }

  const submitLv2 = async () => {
    try {
      const v = await lv2Form.validate()
      if (lv2Editing) {
        await updateTrackLv2(lv2Editing.id, {
          name: v.name,
          sort_order: v.sort_order,
          lv1_id: v.lv1_id,
        })
        Message.success('已保存')
      } else {
        await createTrackLv2({ name: v.name, sort_order: v.sort_order, lv1_id: lv2ParentLv1Id })
        Message.success('已新增二级分类')
      }
      setLv2ModalVisible(false)
      await loadTree()
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const openLv3Modal = (row, parentLv2Id) => {
    const pid = row ? row.lv2_id : parentLv2Id
    if (!pid) {
      Message.warning('无法确定所属二级分类')
      return
    }
    setLv3Editing(row || null)
    setLv3ParentLv2Id(pid)
    lv3Form.resetFields()
    if (row) {
      lv3Form.setFieldsValue({
        name: row.name,
        sort_order: row.sort_order ?? 0,
        lv2_id: row.lv2_id ?? pid,
        match_industry_lv1: row.match_industry_lv1 || '',
        match_industry_lv2: row.match_industry_lv2 || '',
        match_keywords: row.match_keywords || '',
        match_priority: row.match_priority ?? 0,
      })
    } else {
      lv3Form.setFieldsValue({
        name: '',
        sort_order: 0,
        match_industry_lv1: '',
        match_industry_lv2: '',
        match_keywords: '',
        match_priority: 0,
      })
    }
    setLv3ModalVisible(true)
  }

  const submitLv3 = async () => {
    try {
      const v = await lv3Form.validate()
      const trimmed = {
        name: v.name,
        sort_order: v.sort_order,
        match_industry_lv1: v.match_industry_lv1?.trim() ? v.match_industry_lv1.trim() : null,
        match_industry_lv2: v.match_industry_lv2?.trim() ? v.match_industry_lv2.trim() : null,
        match_keywords: v.match_keywords?.trim() ? v.match_keywords.trim() : null,
        match_priority: v.match_priority ?? 0,
      }
      if (lv3Editing) {
        await updateTrackLv3(lv3Editing.id, { ...trimmed, lv2_id: v.lv2_id })
        Message.success('已保存')
      } else {
        await createTrackLv3({ ...trimmed, lv2_id: lv3ParentLv2Id })
        Message.success('已新增三级（匹配规则）')
      }
      setLv3ModalVisible(false)
      await loadTree()
    } catch (e) {
      if (e?.errors) return
      Message.error(e.response?.data?.message || e.message || '保存失败')
    }
  }

  const handleDeleteTrack = (row) => {
    Modal.confirm({
      title: '删除赛道',
      content: `确定删除「${row.name}」及其下全部层级？`,
      onOk: async () => {
        await deleteTrack(row.id)
        Message.success('已删除')
        await loadTree()
      },
    })
  }

  const handleDeleteLv1 = (row) => {
    Modal.confirm({
      title: '删除一级分类',
      content: `确定删除「${row.name}」及其下二级、三级？`,
      onOk: async () => {
        await deleteTrackLv1(row.id)
        Message.success('已删除')
        await loadTree()
      },
    })
  }

  const handleDeleteLv2 = (row) => {
    Modal.confirm({
      title: '删除二级分类',
      content: `确定删除「${row.name}」及其下全部三级规则？`,
      onOk: async () => {
        await deleteTrackLv2(row.id)
        Message.success('已删除')
        await loadTree()
      },
    })
  }

  const handleDeleteLv3 = (row) => {
    Modal.confirm({
      title: '删除三级分类',
      content: `确定删除「${row.name}」？`,
      onOk: async () => {
        await deleteTrackLv3(row.id)
        Message.success('已删除')
        await loadTree()
      },
    })
  }

  const runMatch = async (mode) => {
    setMatchSubmitting(true)
    try {
      const res = await postTrackApplyMatch({ mode, limit: 8000, offset: 0 })
      if (res.data?.success) {
        const d = res.data.data || {}
        Message.success(`扫描 ${d.scanned || 0} 条，写入 ${d.matched || 0} 条${d.message ? `（${d.message}）` : ''}`)
      } else {
        Message.error(res.data?.message || '执行失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '执行失败')
    } finally {
      setMatchSubmitting(false)
    }
  }

  const downloadImportTemplate = async () => {
    try {
      const response = await getTrackImportTemplate()
      if (response.data instanceof Blob) {
        const url = window.URL.createObjectURL(response.data)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', '项目挖掘-赛道配置导入模板.xlsx')
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
      }
    } catch (error) {
      Message.error(error.response?.data?.message || '模板下载失败')
    }
  }

  const downloadTrackExport = async () => {
    try {
      const response = await getTrackExportExcel()
      if (response.data instanceof Blob) {
        const url = window.URL.createObjectURL(response.data)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', '项目挖掘-赛道配置导出.xlsx')
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
        Message.success('导出完成（列与导入模板一致，可直接修改后再导入）')
      }
    } catch (error) {
      Message.error(error.response?.data?.message || error.message || '导出失败')
    }
  }

  const handleImportUpload = async () => {
    if (!importFile) {
      Message.warning('请选择 Excel 文件')
      return
    }
    const fd = new FormData()
    fd.append('file', importFile)
    setImportLoading(true)
    setImportErrors([])
    try {
      const res = await postTrackImport(fd)
      setImportErrors(res.data?.errors || [])
      Message.info(res.data?.message || '导入结束')
      if (res.data?.success) {
        setImportVisible(false)
        setImportFile(null)
        await loadTree()
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导入失败')
    } finally {
      setImportLoading(false)
    }
  }

  const titleBar = (kindTag, name, extra) => (
    <span className="track-tree-title">
      {kindTag}
      <span className="track-tree-name">{name}</span>
      <span className="track-tree-actions" onClick={(e) => e.stopPropagation()}>
        {extra}
      </span>
    </span>
  )

  const treeData = filteredTree.map((t) => ({
    key: `t-${t.id}`,
    title: titleBar(
      <Tag color="arcoblue" size="small">
        赛道
      </Tag>,
      t.name,
      <Space size={4}>
        <Button type="text" size="mini" onClick={() => openLv1Modal(null, t.id)}>
          添加一级
        </Button>
        <Button type="text" size="mini" onClick={() => openTrackModal(t)}>
          编辑
        </Button>
        <Button type="text" size="mini" status="danger" onClick={() => handleDeleteTrack(t)}>
          删除
        </Button>
      </Space>
    ),
    children: (t.lv1_list || []).map((l1) => ({
      key: `l1-${l1.id}`,
      title: titleBar(
        <Tag color="cyan" size="small">
          一级
        </Tag>,
        l1.name,
        <Space size={4}>
          <Button type="text" size="mini" onClick={() => openLv2Modal(null, l1.id)}>
            添加二级
          </Button>
          <Button type="text" size="mini" onClick={() => openLv1Modal({ ...l1, track_id: t.id })}>
            编辑
          </Button>
          <Button type="text" size="mini" status="danger" onClick={() => handleDeleteLv1(l1)}>
            删除
          </Button>
        </Space>
      ),
      children: (l1.lv2_list || []).map((l2) => ({
        key: `l2-${l2.id}`,
        title: titleBar(
          <Tag color="gold" size="small">
            二级
          </Tag>,
          l2.name,
          <Space size={4}>
            <Button type="text" size="mini" onClick={() => openLv3Modal(null, l2.id)}>
              添加三级
            </Button>
            <Button type="text" size="mini" onClick={() => openLv2Modal({ ...l2, lv1_id: l1.id })}>
              编辑
            </Button>
            <Button type="text" size="mini" status="danger" onClick={() => handleDeleteLv2(l2)}>
              删除
            </Button>
          </Space>
        ),
        children: (l2.lv3_list || []).map((l3) => {
          const { full, short, hasRule } = buildLv3RuleSummary(l3)
          const metaText = hasRule
            ? short
            : `${short} · （未配行业/关键词时：三级名称仅在行业标签与项目简介中非严格匹配）`
          return {
            key: `l3-${l3.id}`,
            title: (
              <span className="track-tree-title track-tree-lv3-wrap">
                <span className="track-tree-title-row">
                  <Tag color="green" size="small">
                    三级·规则
                  </Tag>
                  <span className="track-tree-name">{l3.name}</span>
                  <span className="track-tree-actions" onClick={(e) => e.stopPropagation()}>
                    <Space size={4}>
                      <Button type="text" size="mini" onClick={() => openLv3Modal({ ...l3, lv2_id: l2.id })}>
                        编辑
                      </Button>
                      <Button type="text" size="mini" status="danger" onClick={() => handleDeleteLv3(l3)}>
                        删除
                      </Button>
                    </Space>
                  </span>
                </span>
                <Tooltip
                  content={
                    <div style={{ maxWidth: 420, whiteSpace: 'pre-wrap', fontSize: 12 }}>{full}</div>
                  }
                >
                  <div className="track-tree-lv3-meta">{metaText}</div>
                </Tooltip>
              </span>
            ),
          }
        }),
      })),
    })),
  }))

  return (
    <div
      style={{
        height: 'calc(100vh - 128px)',
        maxWidth: '100%',
        padding: '8px 12px 12px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <Typography.Title heading={5} style={{ marginTop: 0, marginBottom: 8 }}>
          赛道配置
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12, lineHeight: 1.55 }}>
          树状维护「赛道 → 一级 → 二级 → 三级」。三级节点数据存于数据库表{' '}
          <Typography.Text code>sourcing_track_lv3</Typography.Text>
          （排序、匹配行业、关键词、优先级与导入模板一致）。可使用「导出 Excel」下载当前配置（列与导入模板一致），修改后再导入。树下灰色行为规则摘要，悬停可看全文；点「编辑」可修改全部字段。
        </Typography.Paragraph>

        <Space wrap style={{ width: '100%', alignItems: 'center' }}>
          <Input.Search
            placeholder="筛选树：名称或三级关键词"
            style={{ width: 260 }}
            value={filterKw}
            onChange={setFilterKw}
            onSearch={(v) => setAppliedFilter(v.trim())}
            allowClear
          />
          <Button type="primary" onClick={() => openTrackModal(null)}>
            新增赛道
          </Button>
          <Button onClick={() => setImportVisible(true)}>Excel 导入</Button>
          <Button onClick={downloadTrackExport}>导出 Excel</Button>
          <Button onClick={loadTree} loading={loading}>
            刷新
          </Button>
          <Button loading={matchSubmitting} onClick={() => runMatch('fill_empty')}>
            执行匹配（仅补空）
          </Button>
          <Button loading={matchSubmitting} status="warning" onClick={() => runMatch('all')}>
            全量重算匹配
          </Button>
        </Space>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          border: '1px solid var(--color-border-2)',
          borderRadius: 4,
          padding: '10px 8px',
          background: 'var(--color-bg-2)',
        }}
      >
        {filteredTree.length === 0 && !loading ? (
          <Typography.Paragraph type="secondary" style={{ margin: 8 }}>
            {tree.length === 0 ? '暂无赛道，请点击「新增赛道」或 Excel 导入。' : '无匹配节点，请调整筛选关键词。'}
          </Typography.Paragraph>
        ) : (
          <Tree blockNode expandedKeys={expandedKeys} onExpand={setExpandedKeys} treeData={treeData} />
        )}
      </div>

      <style>{`
        .track-tree-title {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-width: 0;
          padding-right: 8px;
        }
        .track-tree-lv3-wrap {
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
        }
        .track-tree-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-width: 0;
          padding-right: 8px;
        }
        .track-tree-lv3-meta {
          font-size: 11px;
          line-height: 1.45;
          color: var(--color-text-3);
          padding-left: 2px;
          word-break: break-word;
          cursor: default;
        }
        .track-tree-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .track-tree-actions {
          flex-shrink: 0;
        }
      `}</style>

      <Modal
        title="Excel 导入赛道配置"
        visible={importVisible}
        onCancel={() => {
          setImportVisible(false)
          setImportFile(null)
          setImportErrors([])
        }}
        footer={
          <Space>
            <Button onClick={() => setImportVisible(false)}>关闭</Button>
            <Button type="primary" loading={importLoading} onClick={handleImportUpload}>
              上传导入
            </Button>
          </Space>
        }
        style={{ width: 560 }}
      >
        <Typography.Paragraph style={{ fontSize: 13 }}>
          1. 下载模板（表头固定，勿改列顺序）；每行表示<strong>一条三级匹配节点</strong>及其完整路径，缺失的赛道/一级/二级将自动创建。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ fontSize: 13 }}>
          2. 同一「二级 + 三级名称」已存在时将<strong>更新</strong>排序与匹配字段。
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button type="outline" onClick={downloadImportTemplate}>
            下载导入模板
          </Button>
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setImportFile(e.target.files?.[0] || null)
              setImportErrors([])
            }}
          />
          {importFile && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已选择：{importFile.name}
            </Typography.Text>
          )}
        </Space>
        {importErrors.length > 0 && (
          <div style={{ marginTop: 12, maxHeight: 180, overflow: 'auto', fontSize: 12 }}>
            <Typography.Text type="secondary">失败行：</Typography.Text>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {importErrors.slice(0, 50).map((err, idx) => (
                <li key={idx}>
                  第 {err.row} 行：{err.message}
                </li>
              ))}
              {importErrors.length > 50 && <li>…共 {importErrors.length} 条</li>}
            </ul>
          </div>
        )}
      </Modal>

      <Modal title={trackEditing ? '编辑赛道' : '新增赛道'} visible={trackModalVisible} onOk={submitTrack} onCancel={() => setTrackModalVisible(false)}>
        {trackEditing ? hierarchyHint(nodeBreadcrumb(tree, 'track', trackEditing.id)) : null}
        <Form form={trackForm} layout="vertical">
          <FormItem label="名称" field="name" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="赛道名称" maxLength={100} />
          </FormItem>
          <FormItem label="排序" field="sort_order" initialValue={0}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </FormItem>
        </Form>
      </Modal>

      <Modal title={lv1Editing ? '编辑一级分类' : '新增一级分类'} visible={lv1ModalVisible} onOk={submitLv1} onCancel={() => setLv1ModalVisible(false)}>
        {lv1Editing ? hierarchyHint(nodeBreadcrumb(tree, 'lv1', lv1Editing.id)) : null}
        <Form form={lv1Form} layout="vertical">
          {lv1Editing ? (
            <FormItem label="归属赛道（可调整挂错位置）" field="track_id" rules={[{ required: true, message: '必选' }]}>
              <Select placeholder="选择赛道" allowClear={false}>
                {tree.map((tn) => (
                  <Option key={tn.id} value={tn.id}>
                    {tn.name}
                  </Option>
                ))}
              </Select>
            </FormItem>
          ) : null}
          <FormItem label="名称" field="name" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="一级分类名称" maxLength={100} />
          </FormItem>
          <FormItem label="排序" field="sort_order" initialValue={0}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </FormItem>
        </Form>
      </Modal>

      <Modal title={lv2Editing ? '编辑二级分类' : '新增二级分类'} visible={lv2ModalVisible} onOk={submitLv2} onCancel={() => setLv2ModalVisible(false)}>
        {lv2Editing ? hierarchyHint(nodeBreadcrumb(tree, 'lv2', lv2Editing.id)) : null}
        <Form form={lv2Form} layout="vertical">
          {lv2Editing ? (
            <FormItem label="归属一级（可调整挂错位置）" field="lv1_id" rules={[{ required: true, message: '必选' }]}>
              <Select placeholder="选择一级分类" allowClear={false} showSearch optionFilterProp="label">
                {lv1Options.map((o) => (
                  <Option key={o.value} value={o.value}>
                    {o.label}
                  </Option>
                ))}
              </Select>
            </FormItem>
          ) : null}
          <FormItem label="名称" field="name" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="二级分组名称" maxLength={100} />
          </FormItem>
          <FormItem label="排序" field="sort_order" initialValue={0}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </FormItem>
        </Form>
      </Modal>

      <Modal
        title={lv3Editing ? '编辑三级（匹配规则）' : '新增三级（匹配规则）'}
        style={{ width: 560 }}
        visible={lv3ModalVisible}
        onOk={submitLv3}
        onCancel={() => setLv3ModalVisible(false)}
      >
        {lv3Editing ? hierarchyHint(nodeBreadcrumb(tree, 'lv3', lv3Editing.id)) : null}
        <Form form={lv3Form} layout="vertical">
          {lv3Editing ? (
            <FormItem label="归属二级（可调整挂错位置）" field="lv2_id" rules={[{ required: true, message: '必选' }]}>
              <Select placeholder="选择二级分类" allowClear={false} showSearch optionFilterProp="label">
                {lv2Options.map((o) => (
                  <Option key={o.value} value={o.value}>
                    {o.label}
                  </Option>
                ))}
              </Select>
            </FormItem>
          ) : null}
          <FormItem label="名称" field="name" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="三级节点名称" maxLength={100} />
          </FormItem>
          <FormItem label="排序" field="sort_order" initialValue={0}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </FormItem>
          <FormItem label="匹配行业（一级）" field="match_industry_lv1">
            <Input placeholder="与融资事件来源/标准一级行业精确相等" maxLength={100} />
          </FormItem>
          <FormItem label="匹配行业（二级）" field="match_industry_lv2">
            <Input placeholder="与融资事件来源/标准二级行业精确相等" maxLength={100} />
          </FormItem>
          <FormItem label="关键词" field="match_keywords">
            <Input
              placeholder="逗号/分号分隔；任一命中即可。仅在行业（L1/L2 来源与标准标签文案）与项目简介中做非严格匹配，不含企业名与项目名称"
              maxLength={500}
            />
          </FormItem>
          <FormItem label="优先级" field="match_priority" initialValue={0}>
            <InputNumber min={0} max={9999} step={1} style={{ width: '100%' }} />
          </FormItem>
        </Form>
      </Modal>
    </div>
  )
}
