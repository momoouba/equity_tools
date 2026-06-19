import { Button, Checkbox, Space, Tooltip } from '@arco-design/web-react'

import { IntroPopoverCell } from './introPopoverAiCell'
import { formatFinancingDateTime } from './financingDateUtils'

const SOURCE_LABELS = { ipo_project: '底层', sourcing_financing_event: '融资', ai_web: '联网', user_added: '用户新增' }

/** 竞品明细：长文本列（除竞品名称外）左对齐；竞品名称表头居中、内容左对齐由 cr-rel-col-name 控制 */
const LEFT_ALIGN_FIELDS = new Set([
  'competitor_product_intro',
  'competitor_tags_display',
])

/** 各列 width 之和，供 Table scroll.x 使用 */
export const COMPETITOR_RELATION_TABLE_SCROLL_X = 1400

/** 长文本 Popover 触发区最大宽度（px），与列宽 - 左右 padding 对齐 */
export const CR_REL_COL_WIDTH = {
  name: { col: 187, inner: 163 },
  product: { col: 140, inner: 108 },
  tags: { col: 140, inner: 108 },
  credit: { col: 140 },
  financing: { col: 120, inner: 88 },
}

/** 竞品明细独立样式前缀（cr-rel-*），避免通用表格样式干扰 */
export const CR_REL_CSS = {
  scope: 'cr-rel-scope',
  scopeEmbedded: 'cr-rel-scope--embedded',
  table: 'cr-rel-table',
  colProduct: 'cr-rel-col-product',
  colTags: 'cr-rel-col-tags',
  cellMono: 'cr-rel-cell-mono',
  createdAt: 'cr-rel-created-at',
  introCell: 'cr-rel-intro-cell',
  sourceText: 'cr-rel-source-text',
  colNumeric: 'cr-rel-col-numeric',
}

function renderMonoEllipsis(raw, empty = '-') {
  const text = raw || empty
  if (text === empty) {
    return <span>{empty}</span>
  }
  return (
    <Tooltip content={text}>
      <span className={CR_REL_CSS.cellMono} translate="no" tabIndex={0}>
        {text}
      </span>
    </Tooltip>
  )
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
      ellipsis: true,
      render: (t) => t || '-',
    },

    {
      title: '信用代码',
      dataIndex: 'unified_credit_code',
      width: CR_REL_COL_WIDTH.credit.col,
      render: (t) => renderMonoEllipsis(t),
    },

    {
      title: '上市',
      dataIndex: 'is_listed',
      width: 56,
      render: (v) => (Number(v) === 1 ? '是' : '否'),
    },

    { title: '等级', dataIndex: 'confidence_grade', width: 56, render: (t) => t || '-' },

    { title: '综合分', dataIndex: 'relevance_score', width: 70, className: CR_REL_CSS.colNumeric, render: (v) => (v == null ? '-' : String(v)) },

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
      width: 100,
      ellipsis: true,
      render: (t) => t || '-',
    },

    {
      title: '数据源',
      dataIndex: 'data_sources_json',
      width: 70,
      render: (v) => {
        const text = formatCompetitorDataSources(v)
        if (text === '-') return '-'
        return (
          <Tooltip content={text}>
            <span className={CR_REL_CSS.sourceText} tabIndex={0}>
              {text}
            </span>
          </Tooltip>
        )
      },
    },

    {

      title: '融资',

      dataIndex: 'financing_history_text',

      width: 120,

      render: (t, record) => {

        const text = t || record.financing_amount_text

        return (
          <div className={CR_REL_CSS.introCell}>
            <IntroPopoverCell
              columnTitle="融资"
              raw={text}
              triggerMaxWidth={CR_REL_COL_WIDTH.financing.inner}
            />
          </div>
        )

      },

    },

    {

      title: '创建时间',

      dataIndex: 'created_at',

      width: 88,

      render: (t) => renderCreatedAtTwoLines(t),

    },

    {

      title: '是否可比公司',

      dataIndex: 'include_in_comparable',

      width: 100,
      fixed: 'right',

      render: (v, record) => (

        <Checkbox
          aria-label={`${record.competitor_display_name || '竞品'}是否可比公司`}
          checked={Number(v) === 1}
          disabled={comparableReadOnly || comparableSavingId === record.id}
          onChange={(checked) => onComparableToggle?.(record, checked)}
        />

      ),

    },

    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, record) => {
        if (actionReadOnly || !record.creator_user_id) return '-'
        return (
          <Space size={8} style={{ padding: '0 10px' }} wrap={false}>
            <Button type="primary" size="small" aria-label={`编辑竞品 ${record.competitor_display_name || ''}`} onClick={() => onEdit?.(record)}>
              编辑
            </Button>
            <Button type="outline" size="small" status="danger" aria-label={`删除竞品 ${record.competitor_display_name || ''}`} onClick={() => onDelete?.(record)}>
              删除
            </Button>
          </Space>
        )
      },
    },

  ].map((col) => {
    if (LEFT_ALIGN_FIELDS.has(col.dataIndex)) {
      return { ...col, align: 'left' }
    }
    return col
  })

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


