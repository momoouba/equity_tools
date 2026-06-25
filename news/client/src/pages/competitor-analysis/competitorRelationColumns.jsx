import { Button, Checkbox, Space, Tag, Tooltip } from '@arco-design/web-react'

import { IntroPopoverCell } from './introPopoverAiCell'
import { formatFinancingDateTime } from './financingDateUtils'
import { isReviewPending } from './competitorRelationDisplayUtils'

const SOURCE_LABELS = { ipo_project: '底层', sourcing_financing_event: '融资', ai_web: '联网', user_added: '用户新增' }

export function evidenceConfidenceLabel(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 80) return '高'
  if (n >= 60) return '中'
  return '低'
}

/** 与后端 evidenceTierFromScore 一致，供复核表单默认值 */
export function evidenceTierFromScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return 'medium'
  if (n >= 80) return 'high'
  if (n >= 60) return 'medium'
  return 'low'
}

export const EVIDENCE_TIER_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

function parseEvidenceBreakdown(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

/** 证据可信 Tooltip：来源 / 新鲜度 / 一致性 / 判断强度 */
export function formatEvidenceBreakdownTooltip(record) {
  const bd =
    parseEvidenceBreakdown(record?.evidence_breakdown_json) ||
    parseEvidenceBreakdown(record?.score_breakdown_json?.evidence_breakdown)
  if (!bd) return null
  const months = bd.freshness_months_ago
  const freshnessHint =
    months == null ? '日期未知' : months <= 12 ? `${months} 月前` : `${months} 月前（可能滞后）`
  return [
    `来源覆盖：${bd.source_coverage_score ?? '—'}`,
    `数据新鲜度：${bd.freshness_score ?? '—'}（${freshnessHint}）`,
    `多源一致性：${bd.consistency_score ?? '—'}`,
    `判断强度：${bd.judgment_strength_score ?? '—'}`,
  ].join('\n')
}

/** 竞品明细：长文本列（除竞品名称外）左对齐；竞品名称表头居中、内容左对齐由 cr-rel-col-name 控制 */
const LEFT_ALIGN_FIELDS = new Set([
  'competitor_product_intro',
  'competitor_tags_display',
])

/** 各列 width 之和，供 Table scroll.x 使用 */
export const COMPETITOR_RELATION_TABLE_SCROLL_X = 1800

export const COMPETITOR_TYPE_META = {
  direct: { label: '直接竞品', color: 'red' },
  indirect: { label: '间接竞品', color: 'orangered' },
  substitute: { label: '替代品', color: 'gold' },
  same_track: { label: '同赛道', color: 'arcoblue' },
  upstream_downstream: { label: '上下游', color: 'purple' },
  not_competitor: { label: '非竞品', color: 'gray' },
}

/** 默认列表是否展示该行（兼容 Step 2 前 include_in_comparable 未写入的历史落库） */
export function isDefaultComparableVisible(row) {
  const type = String(row?.competitor_type || '').trim().toLowerCase()
  if (!type) return true
  if (type === 'same_track') return false
  return Number(row?.include_in_comparable) === 1
}

/** 列表排序：类型优先（direct → substitute → …）再综合分 */
export const COMPETITOR_TYPE_SORT_ORDER = {
  direct: 0,
  indirect: 1,
  substitute: 2,
  same_track: 3,
  upstream_downstream: 4,
  not_competitor: 5,
}

export function sortRelationsForDisplay(list) {
  return [...(list || [])].sort((a, b) => {
    const ta =
      COMPETITOR_TYPE_SORT_ORDER[String(a?.competitor_type || '').trim().toLowerCase()] ?? 6
    const tb =
      COMPETITOR_TYPE_SORT_ORDER[String(b?.competitor_type || '').trim().toLowerCase()] ?? 6
    if (ta !== tb) return ta - tb
    const ca = Number(a.include_in_comparable) === 1 ? 1 : 0
    const cb = Number(b.include_in_comparable) === 1 ? 1 : 0
    if (cb !== ca) return cb - ca
    const sa = Number(a.relevance_score) || 0
    const sb = Number(b.relevance_score) || 0
    if (sb !== sa) return sb - sa
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
}

function renderCompetitorTypeTag(type) {
  const key = String(type || '').trim().toLowerCase()
  const meta = COMPETITOR_TYPE_META[key]
  if (!meta) return '-'
  return (
    <Tag color={meta.color} size="small">
      {meta.label}
    </Tag>
  )
}

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

 * @param {(record: object) => void} [opts.onReview]

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
    onReview,
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

    {
      title: '竞品类型',
      dataIndex: 'competitor_type',
      width: 88,
      render: (t) => renderCompetitorTypeTag(t),
    },

    { title: '综合分', dataIndex: 'relevance_score', width: 70, className: CR_REL_CSS.colNumeric, render: (v) => (v == null ? '-' : String(v)) },

    {
      title: '判断依据',
      dataIndex: 'evidence_summary',
      width: 120,
      render: (t) => (
        <div className={CR_REL_CSS.introCell}>
          <IntroPopoverCell columnTitle="判断依据" raw={t} triggerMaxWidth={96} />
        </div>
      ),
    },

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
      title: '证据可信',
      dataIndex: 'evidence_confidence',
      width: 128,
      ellipsis: false,
      render: (v, record) => {
        const label = evidenceConfidenceLabel(v)
        if (!label) return '-'
        const needsReview = Number(record?.needs_review) === 1 || isReviewPending(record)
        const tip = formatEvidenceBreakdownTooltip(record)
        const body = (
          <Space size={4} wrap={false} style={{ whiteSpace: 'nowrap' }}>
            <Tag size="small" color={label === '高' ? 'green' : label === '中' ? 'arcoblue' : 'orangered'}>
              {label}
            </Tag>
            {needsReview ? (
              onReview ? (
                <Tag
                  size="small"
                  color="red"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReview(record)
                  }}
                >
                  待复核
                </Tag>
              ) : (
                <Tag size="small" color="red">
                  待复核
                </Tag>
              )
            ) : null}
            {record.review_status === 'confirmed' || record.review_status === 'corrected' ? (
              <Tag size="small" color="green">
                已确认
              </Tag>
            ) : null}
          </Space>
        )
        if (!tip) return body
        return (
          <Tooltip content={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tip}</pre>}>
            <span tabIndex={0}>{body}</span>
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
      width: 168,
      fixed: 'right',
      render: (_, record) => {
        if (actionReadOnly) {
          return onReview ? (
            <Button type="outline" size="small" onClick={() => onReview(record, { readOnly: true })}>
              查看
            </Button>
          ) : (
            '-'
          )
        }
        const userRow = !!record.creator_user_id
        const pending = isReviewPending(record)
        return (
          <Space size={8} style={{ padding: '0 4px' }} wrap={false}>
            {onReview ? (
              <Button
                type={pending ? 'primary' : 'outline'}
                size="small"
                onClick={() => onReview(record)}
              >
                {pending ? '复核' : '复核'}
              </Button>
            ) : null}
            {userRow ? (
              <>
                <Button type="outline" size="small" onClick={() => onEdit?.(record)}>
                  编辑
                </Button>
                <Button type="outline" size="small" status="danger" onClick={() => onDelete?.(record)}>
                  删除
                </Button>
              </>
            ) : null}
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


