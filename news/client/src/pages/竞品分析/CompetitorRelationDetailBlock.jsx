import React, { useEffect, useMemo, useState } from 'react'
import { Button, Space, Select, Table, Typography } from '@arco-design/web-react'
import { AiIntroFullText } from './introPopoverAiCell'
import { COMPETITOR_RELATION_TABLE_SCROLL_X, CR_REL_CSS } from './competitorRelationColumns'
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
}) {
  const [relPage, setRelPage] = useState(1)
  const [relPageSize, setRelPageSize] = useState(20)

  useEffect(() => {
    setRelPage(1)
  }, [relationData])

  const guardClick = (e) => {
    if (stopPropagation) e.stopPropagation()
  }

  const runOptions = runs
    .filter((run) => run.id && run.version_label)
    .map((run) => ({
      label: run.version_label,
      value: run.id,
    }))

  const effectiveRunId = selectedRunId || (runs[0]?.id ?? undefined)

  const pagedRelationData = useMemo(() => {
    const start = (relPage - 1) * relPageSize
    return relationData.slice(start, start + relPageSize)
  }, [relationData, relPage, relPageSize])

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
          <span className="cr-rel-toolbar-title">竞品明细</span>
          <Space size={8} className="cr-rel-toolbar-actions">
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
            total: relationData.length,
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
