import React from 'react'
import { Button, Space, Select, Table } from '@arco-design/web-react'
import { AiIntroFullText } from './introPopoverAiCell'
import { COMPETITOR_RELATION_TABLE_SCROLL_X, CR_REL_CSS } from './competitorRelationColumns'
import './competitorRelationDetailBlock.css'

const PRIMARY_OUTLINE_BTN = {
  color: 'rgb(var(--primary-6))',
  borderColor: 'rgb(var(--primary-6))',
}

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

  return (
    <div className={`${CR_REL_CSS.scope}${embedded ? ` ${CR_REL_CSS.scopeEmbedded}` : ''}`}>
      <div className="cr-rel-intro">
        <div className="cr-rel-intro-label">产品介绍（AI）摘要：</div>
        <AiIntroFullText raw={aiProductIntro} />
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
          <Space size={8} align="center">
            <span style={{ fontSize: 12, color: 'rgb(var(--primary-6))' }}>分析版本</span>
            <Select
              size="small"
              style={{ minWidth: 180 }}
              loading={runLoading}
              value={effectiveRunId}
              onChange={(v) => onVersionChange?.(v)}
              triggerProps={{
                style: { color: 'rgb(var(--primary-6))', borderColor: 'rgb(var(--primary-6))' },
              }}
              options={runOptions}
            />
            {isHistorical ? (
              <span style={{ fontSize: 12, color: 'var(--color-warning-6)' }}>历史版本（只读）</span>
            ) : null}
          </Space>
        ) : null}
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
        <div className="cr-rel-table-wrap">
          <Table
            className={CR_REL_CSS.table}
            rowKey="id"
            loading={relationLoading}
            data={relationData}
            columns={relationColumns}
            pagination={false}
            border={{ wrapper: true, cell: true }}
            scroll={{ x: COMPETITOR_RELATION_TABLE_SCROLL_X, y: 600 }}
          />
        </div>
      </div>
    </div>
  )
}
