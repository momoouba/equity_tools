import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Link, Space, Select, Table, Typography } from '@arco-design/web-react'
import { AiIntroFullText } from './introPopoverAiCell'
import { COMPETITOR_RELATION_TABLE_SCROLL_X, CR_REL_CSS, isDefaultComparableVisible } from './competitorRelationColumns'
import {
  countHiddenSameTrack,
  countPendingReview,
  filterRelationsForDisplay,
  shouldAutoShowSameTrack,
} from './competitorRelationDisplayUtils'
import './competitorRelationDetailBlock.css'

const PRIMARY_OUTLINE_BTN = {
  color: 'rgb(var(--primary-6))',
  borderColor: 'rgb(var(--primary-6))',
}

const REL_PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

/**
 * 竞品明细展开区（投前/投后共用，cr-rel-* 独立样式域）。
 */
export default function CompetitorRelationDetailBlock({
  embedded = false,
  aiProductIntro,
  industryTags,
  runs = [],
  selectedRunId,
  runLoading = false,
  isHistorical = false,
  onOpenSummary,
  onVersionChange,
  onAdd,
  onRefresh,
  refreshLoading = false,
  relationColumns,
  relationData = [],
  relationLoading = false,
  stopPropagation = false,
  onReview,
  reviewReadOnly = false,
}) {
  const [relPage, setRelPage] = useState(1)
  const [relPageSize, setRelPageSize] = useState(20)
  const [showAllComparable, setShowAllComparable] = useState(false)
  const [reviewFilter, setReviewFilter] = useState('all')
  const autoSameTrackExpandedRef = useRef(false)

  const effectiveRunId = selectedRunId || (runs[0]?.id ?? undefined)

  const hiddenSameTrackCount = useMemo(
    () => countHiddenSameTrack(relationData),
    [relationData]
  )

  useEffect(() => {
    autoSameTrackExpandedRef.current = false
    setShowAllComparable(false)
  }, [effectiveRunId])

  useEffect(() => {
    if (autoSameTrackExpandedRef.current || relationLoading) return
    if (
      shouldAutoShowSameTrack({
        aiProductIntro,
        industryTags,
        relationData,
      })
    ) {
      setShowAllComparable(true)
      autoSameTrackExpandedRef.current = true
    }
  }, [aiProductIntro, industryTags, relationData, relationLoading, effectiveRunId])

  useEffect(() => {
    setRelPage(1)
  }, [relationData, showAllComparable, reviewFilter])

  const pendingReviewCount = useMemo(() => countPendingReview(relationData), [relationData])

  const filteredRelationData = useMemo(() => {
    let list = filterRelationsForDisplay(relationData, { reviewFilter })
    if (showAllComparable) return list
    return list.filter(isDefaultComparableVisible)
  }, [relationData, showAllComparable, reviewFilter])

  const guardClick = (e) => {
    if (stopPropagation) e.stopPropagation()
  }

  const runOptions = runs
    .filter((run) => run.id && run.version_label)
    .map((run) => ({
      label: run.version_label,
      value: run.id,
    }))

  const pagedRelationData = useMemo(() => {
    const start = (relPage - 1) * relPageSize
    return filteredRelationData.slice(start, start + relPageSize)
  }, [filteredRelationData, relPage, relPageSize])

  return (
    <section
      className={`${CR_REL_CSS.scope}${embedded ? ` ${CR_REL_CSS.scopeEmbedded}` : ''}`}
      aria-label="竞品明细展开区"
    >
      <div className="cr-rel-meta-panel">
        <div className="cr-rel-intro">
          <Typography.Text type="secondary" className="cr-rel-intro-label">
            产品介绍（AI）摘要
          </Typography.Text>
          <div className="cr-rel-intro-body">
            <AiIntroFullText raw={aiProductIntro} />
          </div>
        </div>
        <div className="cr-rel-actions">
          <Button
            type="outline"
            size="small"
            style={PRIMARY_OUTLINE_BTN}
            onClick={(e) => {
              guardClick(e)
              onOpenSummary?.(e)
            }}
          >
            竞品分析说明
          </Button>
          {runs.length > 0 ? (
            <Space size={8} align="center" wrap>
              <Typography.Text style={{ fontSize: 12, color: 'rgb(var(--primary-6))' }}>
                分析版本
              </Typography.Text>
              <Select
                size="small"
                style={{ minWidth: 180 }}
                loading={runLoading}
                value={effectiveRunId}
                aria-label="分析版本"
                onChange={(v) => onVersionChange?.(v)}
                triggerProps={{
                  style: { color: 'rgb(var(--primary-6))', borderColor: 'rgb(var(--primary-6))' },
                }}
                options={runOptions}
              />
              {isHistorical ? (
                <Typography.Text style={{ fontSize: 12 }} type="warning">
                  历史版本（只读）
                </Typography.Text>
              ) : null}
            </Space>
          ) : null}
        </div>
      </div>

      <div className="cr-rel-table-section">
        <div className="cr-rel-toolbar">
          <Space size={12} align="center" className="cr-rel-toolbar-title-wrap">
            <span className="cr-rel-toolbar-title">竞品明细</span>
            {hiddenSameTrackCount > 0 && !showAllComparable ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                另有 {hiddenSameTrackCount} 家同赛道未显示，
                <Link
                  style={{ fontSize: 12 }}
                  onClick={() => setShowAllComparable(true)}
                >
                  点击展开
                </Link>
              </Typography.Text>
            ) : null}
          </Space>
          <Space size={8} className="cr-rel-toolbar-actions">
            {pendingReviewCount > 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                待复核 {pendingReviewCount}
              </Typography.Text>
            ) : null}
            <Select
              size="small"
              style={{ width: 120 }}
              value={reviewFilter}
              onChange={setReviewFilter}
              options={[
                { label: '全部', value: 'all' },
                { label: '待复核', value: 'pending' },
                { label: '已确认', value: 'confirmed' },
                { label: '已驳回', value: 'dismissed' },
              ]}
            />
            <Checkbox
              checked={showAllComparable}
              onChange={setShowAllComparable}
            >
              显示全部（含同赛道）
            </Checkbox>
            <Button
              type="outline"
              size="small"
              style={PRIMARY_OUTLINE_BTN}
              disabled={isHistorical}
              onClick={(e) => {
                guardClick(e)
                onAdd?.()
              }}
            >
              新增
            </Button>
            <Button
              type="outline"
              size="small"
              style={PRIMARY_OUTLINE_BTN}
              loading={refreshLoading}
              onClick={(e) => {
                guardClick(e)
                onRefresh?.()
              }}
            >
              刷新
            </Button>
          </Space>
        </div>
        <Table
          className={`${CR_REL_CSS.table} pre-inv-sourcing-main-table`}
          rowKey="id"
          stripe
          loading={relationLoading}
          data={pagedRelationData}
          columns={relationColumns}
          border={{ wrapper: true, cell: true }}
          scroll={{ x: COMPETITOR_RELATION_TABLE_SCROLL_X }}
          pagination={{
            current: relPage,
            pageSize: relPageSize,
            total: filteredRelationData.length,
            showTotal: true,
            showJumper: true,
            sizeCanChange: true,
            pageSizeChangeResetCurrent: true,
            pageSizeOptions: REL_PAGE_SIZE_OPTIONS,
            onChange: (p) => setRelPage(p),
            onPageSizeChange: (ps) => {
              setRelPageSize(ps)
              setRelPage(1)
            },
          }}
          noDataElement={
            <div className="cr-rel-empty" role="status">
              暂无竞品明细
            </div>
          }
        />
      </div>
    </section>
  )
}
