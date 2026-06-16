import { Button, Checkbox, Space } from '@arco-design/web-react'

import { IntroPopoverCell } from './introPopoverAiCell'
import { formatFinancingDateTime } from './financingDateUtils'

const SOURCE_LABELS = { ipo_project: '底层', sourcing_financing_event: '融资', ai_web: '联网', user_added: '用户新增' }

/** 竞品明细：长文本列左对齐，其余列居中 */
const LEFT_ALIGN_FIELDS = new Set([
  'competitor_display_name',
  'competitor_product_intro',
  'competitor_tags_display',
])

/** 各列 width 之和，供 Table scroll.x 使用 */
export const COMPETITOR_RELATION_TABLE_SCROLL_X = 1155

/**
 * 左对齐长文本列宽（px）：与 columns.width 一致。
 * cell = col - 2（右缘留 2px 与分隔线对齐）；inner = cell - 2（左内边距 2px）。
 */
export const CR_REL_COL_WIDTH = {
  name: { col: 140, cell: 138, inner: 136 },
  product: { col: 130, cell: 128, inner: 126 },
  tags: { col: 130, cell: 128, inner: 126 },
}

/** 竞品明细独立样式前缀（cr-rel-*），避免通用表格样式干扰 */
export const CR_REL_CSS = {
  scope: 'cr-rel-scope',
  scopeEmbedded: 'cr-rel-scope--embedded',
  table: 'cr-rel-table',
  colTitle: 'cr-rel-col-title',
  colName: 'cr-rel-col-name',
  colProduct: 'cr-rel-col-product',
  colTags: 'cr-rel-col-tags',
  cellText: 'cr-rel-cell-text',
  createdAt: 'cr-rel-created-at',
  introCell: 'cr-rel-intro-cell',
}

function wrapColTitle(text) {
  return <span className={CR_REL_CSS.colTitle}>{text}</span>
}

/** 列内省略：内容限制在列宽内，左侧 2px 缩进 */
function renderEllipsisText(raw, empty = '-') {
  const text = raw == null || String(raw).trim() === '' ? empty : String(raw)
  return <span className={CR_REL_CSS.cellText} title={text === empty ? undefined : text}>{text}</span>
}

function renderCreatedAtTwoLines(value) {
  const formatted = formatFinancingDateTime(value)
  if (formatted === '-') return '-'
  const [datePart, timePart] = formatted.split(' ')
  if (!timePart) return formatted
  return (
    <div className={CR_REL_CSS.createdAt}>
      <div>{datePart}</div>
      <div>{timePart}</div>
    </div>
  )
}



export function formatCompetitorDataSources(v) {

  if (!v) return '-'

  try {

    const arr = typeof v === 'string' ? JSON.parse(v) : v

    if (Array.isArray(arr)) {

      return arr.map((x) => SOURCE_LABELS[x] || x).join('、') || '-'

    }

  } catch {

    /* ignore */

  }

  return '-'

}



/**

 * @param {object} [opts]

 * @param {(record: object, checked: boolean) => void} [opts.onComparableToggle]

 * @param {string|null} [opts.comparableSavingId]
 * @param {boolean} [opts.comparableReadOnly]
 * @param {(record: object) => void} [opts.onEdit]
 * @param {(record: object) => void} [opts.onDelete]
 * @param {boolean} [opts.actionReadOnly]
 */
export function getCompetitorRelationColumns(opts = {}) {
  const {
    onComparableToggle,
    comparableSavingId,
    comparableReadOnly,
    onEdit,
    onDelete,
    actionReadOnly,
  } = opts

  return [

    {
      title: '竞品名称',
      dataIndex: 'competitor_display_name',
      width: CR_REL_COL_WIDTH.name.col,
      className: CR_REL_CSS.colName,
      render: (t) => renderEllipsisText(t),
    },

    { title: '信用代码', dataIndex: 'unified_credit_code', width: 120, render: (t) => t || '-' },

    {

      title: '上市',

      dataIndex: 'is_listed',

      width: 40,

      render: (v) => (Number(v) === 1 ? '是' : '否'),

    },

    { title: '等级', dataIndex: 'confidence_grade', width: 40, render: (t) => t || '-' },

    { title: '综合分', dataIndex: 'relevance_score', width: 50, render: (v) => (v == null ? '-' : String(v)) },

    {

      title: '产品介绍',

      dataIndex: 'competitor_product_intro',

      width: CR_REL_COL_WIDTH.product.col,

      className: CR_REL_CSS.colProduct,

      render: (t) => (
        <div className={CR_REL_CSS.introCell}>
          <IntroPopoverCell
            columnTitle="产品介绍"
            raw={t}
            triggerMaxWidth={CR_REL_COL_WIDTH.product.inner}
          />
        </div>
      ),

    },

    {

      title: '企业标签',

      dataIndex: 'competitor_tags_display',

      width: CR_REL_COL_WIDTH.tags.col,

      className: CR_REL_CSS.colTags,

      render: (t) => (
        <div className={CR_REL_CSS.introCell}>
          <IntroPopoverCell
            columnTitle="企业标签"
            raw={t}
            triggerMaxWidth={CR_REL_COL_WIDTH.tags.inner}
          />
        </div>
      ),

    },

    {

      title: '子基金名称',

      dataIndex: 'sub_fund_names',

      width: 80,

      render: (t) => t || '-',

    },

    {

      title: '数据源',

      dataIndex: 'data_sources_json',

      width: 55,

      render: (v) => formatCompetitorDataSources(v),

    },

    {

      title: '融资',

      dataIndex: 'financing_history_text',

      width: 120,

      render: (t, record) => {

        const text = t || record.financing_amount_text

        return (
          <div className={CR_REL_CSS.introCell}>
            <IntroPopoverCell columnTitle="融资" raw={text} triggerMaxWidth={116} />
          </div>
        )

      },

    },

    {

      title: '创建时间',

      dataIndex: 'created_at',

      width: 70,

      render: (t) => renderCreatedAtTwoLines(t),

    },

    {

      title: '是否可比公司',

      dataIndex: 'include_in_comparable',

      width: 60,
      fixed: 'right',

      render: (v, record) => (

        <Checkbox

          checked={Number(v) === 1}

          disabled={comparableReadOnly || comparableSavingId === record.id}

          onChange={(checked) => onComparableToggle?.(record, checked)}

        />

      ),

    },

    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, record) => {
        if (actionReadOnly || !record.creator_user_id) return '-'
        return (
          <Space size={8} style={{ padding: '0 10px' }} wrap={false}>
            <Button type="primary" size="small" onClick={() => onEdit?.(record)}>
              编辑
            </Button>
            <Button type="outline" size="small" status="danger" onClick={() => onDelete?.(record)}>
              删除
            </Button>
          </Space>
        )
      },
    },

  ].map((col) => ({
    ...col,
    title: typeof col.title === 'string' ? wrapColTitle(col.title) : col.title,
    align: LEFT_ALIGN_FIELDS.has(col.dataIndex) ? 'left' : 'center',
  }))

}



export function downloadBlob(blob, filename) {

  const url = window.URL.createObjectURL(blob)

  const a = document.createElement('a')

  a.href = url

  a.download = filename

  document.body.appendChild(a)

  a.click()

  a.remove()

  window.URL.revokeObjectURL(url)

}



export function parseExportFilename(contentDisposition, fallback) {

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


