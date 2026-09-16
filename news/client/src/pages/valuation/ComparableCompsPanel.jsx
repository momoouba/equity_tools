import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, Input, Message, Popconfirm, Select, Space, Switch, Tooltip, Typography, Upload,
} from '@arco-design/web-react'
import {
  fetchCaseComparables, postManualComparable, importComparablesExcel, patchCaseComparable,
  deleteCaseComparable, postComparablesFromCompetitor, postComparableRecommendRun,
  fetchComparableRecommendLatest, fetchComparableRecommendRun, fetchComparableRecommendRuns,
  applyComparableRecommendRun,
} from '../../api/valuation'
import { ListTable } from './valuationTable'
import { fmtNum } from './valuationUnits'
import SheetModal, { SheetActions, sheetPopupContainer } from '../../components/SheetModal'

const MARKET_LABEL = { sse: '上交所', szse: '深交所', bse: '北交所', neeq: '新三板' }
const CATEGORY_LABEL = { ai: '人工智能', bio: '生物医药', semi_mfg: '半导体/先进制造', other: '其他' }
const STATUS_LABEL = { on_list: '已在名单', was_deleted: '曾删除', can_add: '可新增' }

function ReasonCell({ text, extra }) {
  const full = [text, extra].filter(Boolean).join('\n')
  if (!full) return <span>—</span>
  return (
    <Tooltip content={<div className="valuation-reason-tooltip">{full}</div>}>
      <div className="valuation-reason-clamp">{text || '—'}</div>
    </Tooltip>
  )
}

export default function ComparableCompsPanel({ caseId, isDraftView, comps, setComps }) {
  const [previewMsg, setPreviewMsg] = useState('')
  const [refreshBlocked, setRefreshBlocked] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [includeNeeq, setIncludeNeeq] = useState(false)
  const [relax, setRelax] = useState(false)
  const [buttonState, setButtonState] = useState('idle')
  const [latestSuccessId, setLatestSuccessId] = useState(null)
  const [progressOpen, setProgressOpen] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  const [runDetail, setRunDetail] = useState(null)
  const [runList, setRunList] = useState([])
  const [checkedCodes, setCheckedCodes] = useState([])
  const [editRow, setEditRow] = useState(null)
  const [editCode, setEditCode] = useState('')
  const [editComparability, setEditComparability] = useState('medium')
  const [editInPool, setEditInPool] = useState(true)
  const [editSelected, setEditSelected] = useState(true)
  const pollRef = useRef(null)

  const reloadComps = useCallback(async () => {
    const saved = await fetchCaseComparables(caseId)
    setComps(saved.data?.data?.list || [])
  }, [caseId, setComps])

  const refreshLatest = useCallback(async () => {
    try {
      const res = await fetchComparableRecommendLatest(caseId)
      const d = res.data?.data
      setButtonState(d?.button || 'idle')
      setLatestSuccessId(d?.latest_success?.id || null)
      return d
    } catch {
      return null
    }
  }, [caseId])

  useEffect(() => {
    refreshLatest()
    return () => clearInterval(pollRef.current)
  }, [refreshLatest])

  const stopPoll = () => {
    clearInterval(pollRef.current)
    pollRef.current = null
  }

  const startPoll = () => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      const d = await refreshLatest()
      if (d?.button === 'running') return
      stopPoll()
      setProgressOpen(false)
      if (d?.button === 'success') {
        Message.success('推荐已完成，可查看结果')
      } else if (d?.latest_failed) {
        Message.error(d.latest_failed.error_message || '推荐失败')
      }
    }, 2000)
  }

  const draftGuard = () => {
    if (isDraftView) return true
    Message.warning('请先切换到当前草稿，或发起新版本后再推荐')
    return false
  }

  const onRecommend = async () => {
    if (!draftGuard()) return
    if (buttonState === 'running') {
      setProgressOpen(true)
      return
    }
    try {
      const res = await postComparableRecommendRun(caseId, { relax, include_neeq: includeNeeq })
      if (res.status === 202 || res.data?.accepted || res.data?.success) {
        setButtonState('running')
        setProgressOpen(true)
        startPoll()
      } else {
        Message.warning(res.data?.message || '无法发起推荐')
      }
    } catch (e) {
      const msg = e.response?.data?.message || e.message || '无法发起推荐'
      if (e.response?.status === 409) Message.warning(msg)
      else Message.error(msg)
    }
  }

  const openRun = async (runId) => {
    try {
      const [detailRes, listRes] = await Promise.all([
        fetchComparableRecommendRun(caseId, runId),
        fetchComparableRecommendRuns(caseId),
      ])
      const detail = detailRes.data?.data
      if (detail?.status !== 'success') {
        Message.warning('推荐尚未完成，请稍后再查看')
        return
      }
      setRunDetail(detail)
      setRunList((listRes.data?.data?.list || []).filter((r) => r.status === 'success'))
      setCheckedCodes(detail.result?.default_checked || [])
      setResultOpen(true)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载推荐结果失败')
    }
  }

  const onViewLatest = async () => {
    const d = await refreshLatest()
    if (!d?.latest_success?.id) {
      Message.info('暂无已完成的推荐结果')
      return
    }
    openRun(d.latest_success.id)
  }

  const onApply = async () => {
    if (!draftGuard()) return
    if (!runDetail?.id) return
    try {
      const res = await applyComparableRecommendRun(caseId, runDetail.id, checkedCodes)
      const applied = res.data?.data?.applied?.length || 0
      const skipped = res.data?.data?.skipped || []
      await reloadComps()
      setResultOpen(false)
      Message.success(`已加入名单并勾选采集（${applied} 家）${skipped.length ? `，跳过 ${skipped.length}` : ''}`)
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加入名单失败')
    }
  }

  const loadFromCompetitor = async () => {
    try {
      const res = await postComparablesFromCompetitor(caseId)
      if (!res.data?.success) return
      const d = res.data.data
      setPreviewMsg(d.message || '')
      setRefreshBlocked(!!d.refresh_blocked || !!d.source_missing)
      setComps(d.list || [])
      const n = d.inserted_count || 0
      Message.success(n ? `已从竞品分析合并 ${n} 家境内可比（已在名单的未覆盖，已删除的不加回）` : (d.message || '没有可新增的境内可比'))
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载可比失败')
    }
  }

  const saveEdit = async () => {
    if (!editRow) return
    const codeChanged = String(editCode || '').trim() !== String(editRow.stock_code || '')
    const doPatch = async () => {
      try {
        await patchCaseComparable(caseId, editRow.id, {
          stock_code: editCode,
          comparability: editComparability,
          in_pool: editInPool,
          selected: editSelected,
        })
        await reloadComps()
        setEditRow(null)
        Message.success('已保存')
      } catch (e) {
        Message.error(e.response?.data?.message || e.message || '保存失败')
      }
    }
    if (codeChanged) {
      Modal.confirm({
        title: '改代码将清除底稿覆盖',
        content: '保存后将清空该行 PE/PS 底稿中位覆盖，名称与市场按上市主档回填。',
        onOk: doPatch,
      })
      return
    }
    doPatch()
  }

  const recommendBtnProps = buttonState === 'running'
    ? { status: 'danger' }
    : buttonState === 'success'
      ? { status: 'success' }
      : { type: 'primary' }

  const candidates = runDetail?.result?.candidates || []
  const profile = runDetail?.profile || runDetail?.result?.profile

  return (
    <CardLike>
      {!comps.length ? (
        <Alert
          type="info"
          style={{ marginBottom: 12 }}
          content="可点「按行业/赛道推荐」，按标的行业/赛道从上市主档挑选可比公司；无需先跑竞品分析。"
        />
      ) : null}
      {previewMsg ? <Alert type="info" content={previewMsg} style={{ marginBottom: 12 }} /> : null}
      {refreshBlocked ? (
        <Alert type="warning" content="竞品分析来源已删除，无法刷新可比，仅可使用已勾选快照或手工导入" style={{ marginBottom: 12 }} />
      ) : null}
      <Space style={{ marginBottom: 12 }} wrap>
        <Button {...recommendBtnProps} onClick={onRecommend}>按行业/赛道推荐</Button>
        {buttonState !== 'running' && latestSuccessId ? (
          <Button type="text" onClick={onViewLatest}>查看本次推荐的企业信息</Button>
        ) : null}
        <Checkbox checked={includeNeeq} onChange={setIncludeNeeq}>含新三板</Checkbox>
        <Checkbox checked={relax} onChange={setRelax}>放宽召回</Checkbox>
        <Button disabled={refreshBlocked} onClick={loadFromCompetitor}>从最新成功竞品分析加载</Button>
        <Input
          value={manualCode}
          placeholder="手工股票代码"
          style={{ width: 140 }}
          onChange={setManualCode}
        />
        <Button
          onClick={async () => {
            try {
              const res = await postManualComparable(caseId, { stock_code: manualCode })
              if (res.data?.success) {
                setManualCode('')
                await reloadComps()
                if (res.data?.data?.already) Message.info('该代码已在名单中')
                else if (res.data?.data?.revived) Message.success('已加回（保留原勾选/入池/底稿）')
                else Message.success('已添加')
              } else Message.error(res.data?.message || '添加失败')
            } catch (e) {
              Message.error(e.response?.data?.message || e.message || '添加失败')
            }
          }}
        >
          添加
        </Button>
        <UploadExcel caseId={caseId} onDone={reloadComps} />
      </Space>
      <ListTable
        rowKey="id"
        pagination={false}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: '勾选',
            width: 52,
            render: (_, r) => (
              <Checkbox
                checked={!!r.selected}
                disabled={!!r.disabled_reason}
                onChange={(v) => {
                  patchCaseComparable(caseId, r.id, { selected: v }).then(() => {
                    setComps((prev) => prev.map((x) => (x.id === r.id ? { ...x, selected: v ? 1 : 0 } : x)))
                  })
                }}
              />
            ),
          },
          { title: '代码', dataIndex: 'stock_code', width: 72 },
          { title: '名称', dataIndex: 'stock_name', width: 80, ellipsis: true },
          { title: '市场', dataIndex: 'listing_market', width: 72, render: (v) => MARKET_LABEL[v] || v || '-' },
          {
            title: '综合分',
            dataIndex: 'relevance_score',
            width: 72,
            align: 'right',
            render: (v) => (v == null || v === '' ? '-' : fmtNum(v, 2)),
          },
          {
            title: '可比程度',
            dataIndex: 'comparability',
            width: 110,
            render: (v, r) => (
              <div>
                <Select
                  size="mini"
                  value={v}
                  style={{ width: 72 }}
                  options={[
                    { value: 'strong', label: '强' },
                    { value: 'medium', label: '中' },
                    { value: 'weak', label: '弱' },
                  ]}
                  onChange={(nv) => {
                    patchCaseComparable(caseId, r.id, { comparability: nv }).then(() => {
                      setComps((prev) => prev.map((x) => (x.id === r.id ? { ...x, comparability: nv } : x)))
                    })
                  }}
                />
                <div className="valuation-pool-hint">改可比程度不会自动改 POOL</div>
              </div>
            ),
          },
          {
            title: 'POOL',
            dataIndex: 'in_pool',
            width: 56,
            render: (v, r) => (
              <Switch
                size="small"
                checked={!!v}
                onChange={(nv) => {
                  patchCaseComparable(caseId, r.id, { in_pool: nv }).then(() => {
                    setComps((prev) => prev.map((x) => (x.id === r.id ? { ...x, in_pool: nv ? 1 : 0 } : x)))
                  })
                }}
              />
            ),
          },
          {
            title: '匹配说明',
            dataIndex: 'match_reason',
            width: 180,
            render: (v, r) => {
              const dims = r.match_reason_json?.dimensions || r.match_reason_json
              const extra = dims
                ? Object.entries(dims).map(([k, val]) => `${k}：${val}`).join('\n')
                : ''
              return <ReasonCell text={v || '—'} extra={extra} />
            },
          },
          { title: '说明', dataIndex: 'disabled_reason', width: 140, ellipsis: true, render: (v) => v || '-' },
          {
            title: '操作',
            width: 120,
            render: (_, r) => (
              <Space size={4}>
                <Button
                  size="mini"
                  type="text"
                  onClick={() => {
                    setEditRow(r)
                    setEditCode(r.stock_code || '')
                    setEditComparability(r.comparability || 'medium')
                    setEditInPool(!!r.in_pool)
                    setEditSelected(!!r.selected)
                  }}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="删除后不再进入采集与 POOL。可用手工代码或推荐再次加回。"
                  onOk={async () => {
                    try {
                      await deleteCaseComparable(caseId, r.id)
                      await reloadComps()
                    } catch (e) {
                      Message.error(e.response?.data?.message || e.message || '删除失败')
                    }
                  }}
                >
                  <Button size="mini" type="text" status="danger">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        data={comps}
      />

      <SheetModal
        visible={progressOpen}
        title="推荐进行中"
        onClose={() => setProgressOpen(false)}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body">
            <p className="form-hint">
              程序正在执行中，正在按行业/赛道分析可比上市企业…关闭本窗不取消任务。
            </p>
          </div>
          <SheetActions
            onCancel={() => setProgressOpen(false)}
            cancelLabel="确认"
            submitLabel=""
          />
        </div>
      </SheetModal>

      <SheetModal
        visible={resultOpen}
        title="推荐企业"
        onClose={() => setResultOpen(false)}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body">
            <Space style={{ marginBottom: 8 }} wrap>
              <span>版本</span>
              <Select
                style={{ width: 160 }}
                value={runDetail?.id}
                options={runList.map((r) => ({ value: r.id, label: `v${r.version_no}` }))}
                onChange={(id) => openRun(id)}
                getPopupContainer={sheetPopupContainer}
              />
              <Typography.Text type="secondary">
                {runDetail?.relax ? '放宽' : '标准'}
                {runDetail?.include_neeq ? ' · 含新三板' : ''}
                {profile?.sw_industry_l3 ? ` · 申万三级 ${profile.sw_industry_l3}（方法配置）` : ''}
                {profile?.industry_category_4 ? ` · ${CATEGORY_LABEL[profile.industry_category_4] || profile.industry_category_4}` : ''}
              </Typography.Text>
            </Space>
            {runDetail?.result?.message ? <Alert type="info" content={runDetail.result.message} style={{ marginBottom: 8 }} /> : null}
            {runDetail?.result?.ai_propose?.status === 'failed' ? (
              <Alert
                type="warning"
                content={`AI 提名未成功${runDetail.result.ai_propose.message ? `：${runDetail.result.ai_propose.message}` : ''}，已展示规则召回结果`}
                style={{ marginBottom: 8 }}
              />
            ) : runDetail?.result?.ai_propose?.verified != null ? (
              <Alert
                type="info"
                content={`AI 提名 ${runDetail.result.ai_propose.nominated || 0} 家，上市主档核到 ${runDetail.result.ai_propose.verified} 家`}
                style={{ marginBottom: 8 }}
              />
            ) : null}
            {runDetail?.result?.ai_status === 'failed' ? (
              <Alert type="warning" content="业务理由暂不可用，规则结果仍可勾选确认" style={{ marginBottom: 8 }} />
            ) : null}
            <ListTable
              rowKey="stock_code"
              pagination={false}
              scroll={{ x: 1400, y: 360 }}
              columns={[
                {
                  title: '勾选',
                  width: 52,
                  render: (_, r) => (
                    <Checkbox
                      checked={checkedCodes.includes(r.stock_code)}
                      disabled={r.list_status === 'on_list'}
                      onChange={(v) => {
                        setCheckedCodes((prev) => (v ? [...prev, r.stock_code] : prev.filter((c) => c !== r.stock_code)))
                      }}
                    />
                  ),
                },
                { title: '代码', dataIndex: 'stock_code', width: 72 },
                { title: '名称', dataIndex: 'stock_name', width: 88, ellipsis: true },
                { title: '市场', dataIndex: 'listing_market', width: 72, render: (v) => MARKET_LABEL[v] || v || '-' },
                { title: '四大类', dataIndex: 'industry_category_4', width: 88, render: (v) => CATEGORY_LABEL[v] || v || '-' },
                { title: '申万三级', dataIndex: 'sw_industry_l3', width: 100, ellipsis: true, render: (v) => v || '-' },
                {
                  title: '匹配分',
                  dataIndex: 'relevance_score',
                  width: 72,
                  align: 'right',
                  render: (v) => (v == null ? '-' : fmtNum(v, 1)),
                },
                {
                  title: '匹配说明',
                  width: 220,
                  render: (_, r) => {
                    const dims = r.reason?.dimensions || {}
                    const extra = [
                      dims.industry, dims.sw, dims.track, dims.tags, dims.lens, dims.business || r.business_reason,
                    ].filter(Boolean).join('\n')
                    return <ReasonCell text={r.match_reason} extra={extra} />
                  },
                },
                {
                  title: '企业简介',
                  width: 220,
                  render: (_, r) => <ReasonCell text={r.company_intro_display || r.product_intro || r.company_intro} />,
                },
                {
                  title: '状态',
                  dataIndex: 'list_status',
                  width: 80,
                  render: (v) => STATUS_LABEL[v] || v || '可新增',
                },
              ]}
              data={candidates}
            />
          </div>
          <SheetActions
            onCancel={() => setResultOpen(false)}
            cancelLabel="关闭"
            submitLabel="确认加入名单"
            submitType="button"
            onSubmitClick={onApply}
          />
        </div>
      </SheetModal>

      <SheetModal
        visible={!!editRow}
        title="编辑可比公司"
        onClose={() => setEditRow(null)}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <div className="form-group form-span-2">
              <label>股票代码</label>
              <Input value={editCode} onChange={setEditCode} />
              <p className="form-hint">名称、市场以上市主档为准，保存后自动回填。</p>
            </div>
            <div className="form-group">
              <label>可比程度</label>
              <Select
                value={editComparability}
                options={[
                  { value: 'strong', label: '强' },
                  { value: 'medium', label: '中' },
                  { value: 'weak', label: '弱' },
                ]}
                onChange={setEditComparability}
                getPopupContainer={sheetPopupContainer}
              />
              <p className="form-hint">改可比程度不会自动改 POOL</p>
            </div>
            <div className="form-group">
              <label>采集</label>
              <Checkbox checked={editInPool} onChange={setEditInPool}>入池</Checkbox>
              <Checkbox checked={editSelected} onChange={setEditSelected} style={{ marginLeft: 12 }}>勾选采集</Checkbox>
            </div>
          </div>
          <SheetActions
            onCancel={() => setEditRow(null)}
            submitLabel="保存"
            submitType="button"
            onSubmitClick={saveEdit}
          />
        </div>
      </SheetModal>
    </CardLike>
  )
}

function CardLike({ children }) {
  return <>{children}</>
}

function UploadExcel({ caseId, onDone }) {
  return (
    <Upload
      accept=".xlsx,.xls"
      showUploadList={false}
      customRequest={async ({ file }) => {
        try {
          const res = await importComparablesExcel(caseId, file)
          const skipped = res.data?.data?.skipped || []
          Message.success(`导入 ${res.data?.data?.added?.length || 0} 条${skipped.length ? `，跳过 ${skipped.length}` : ''}`)
          await onDone()
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '导入失败')
        }
      }}
    >
      <Button>Excel 导入代码</Button>
    </Upload>
  )
}
