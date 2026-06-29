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
export function sumCompetitorRelationColumnWidths(columns) {
  return (columns || []).reduce((sum, col) => sum + (Number(col.width) || 0), 0)
}

/** 综合分 → 等级（与后端 competitorMatchUtils.scoreToGrade 一致） */
export function scoreToConfidenceGrade(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 90) return 'S'
  if (n >= 80) return 'A'
  if (n >= 70) return 'B'
  if (n >= 60) return 'C'
  return null
}

export const GRADE_SCORE_RELATION_HINT =
  '与 AI 跑批规则一致：S≥90，A≥80，B≥70，C≥60；低于 60 分可不填等级'

/** 嵌入主表展开行：去掉 fixed 列，按容器宽度等比收窄，避免独立横向滚动条 */
export function adaptCompetitorRelationColumnsForEmbedded(columns, containerWidth) {
  const base = (columns || []).map(({ fixed: _fixed, ...col }) => ({ ...col }))
  if (!containerWidth || containerWidth <= 0) return base

  const total = sumCompetitorRelationColumnWidths(base)
  if (total <= containerWidth) return base

  const scale = containerWidth / total
  return base.map((col) => ({
    ...col,
    width: Math.max(36, Math.floor((Number(col.width) || 80) * scale)),
  }))
}

export const COMPETITOR_TYPE_META = {
  direct: { label: '直接竞品', color: 'red' },
  indirect: { label: '间接竞品', color: 'orangered' },
  substitute: { label: '替代品', color: 'gold' },
  same_track: { label: '同赛道', color: 'arcoblue' },
  upstream_downstream: { label: '上下游', color: 'purple' },
  not_competitor: { label: '非竞品', color: 'gray' },
}

/** 默认列表是否展示该行：仅用户勾选「可比公司」后显示；同赛道默认隐藏（可点「显示全部」） */
export function isDefaultComparableVisible(row) {
  const type = String(row?.competitor_type || '').trim().toLowerCase()
  if (type === 'same_track') return false
  return Number(row?.include_in_comparable) === 1
}

/** 列表排序：已纳入可比公司置顶，组内按综合分降序；其余按综合分降序 */
export function sortRelationsForDisplay(list) {
  return [...(list || [])].sort((a, b) => {
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
  name: { col: 108 },
  product: { col: 120, inner: 96 },
  tags: { col: 120, inner: 96 },
  credit: { col: 128 },
  financing: { col: 84, inner: 60 },
  comparable: { col: 68 },
}

/** 竞品明细独立样式前缀（cr-rel-*），避免通用表格样式干扰 */
export const CR_REL_CSS = {
  scope: 'cr-rel-scope',
  scopeEmbedded: 'cr-rel-scope--embedded',
  table: 'cr-rel-table',
  colProduct: 'cr-rel-col-product',
  colTags: 'cr-rel-col-tags',
  colName: 'cr-rel-col-name',
  colComparable: 'cr-rel-col-comparable',
  colFinancing: 'cr-rel-col-financing',
  cellMono: 'cr-rel-cell-mono',
  nameText: 'cr-rel-name-text',
  createdAt: 'cr-rel-created-at',
  introCell: 'cr-rel-intro-cell',
  sourceText: 'cr-rel-source-text',
  colNumeric: 'cr-rel-col-numeric',
  rowComparable: 'cr-rel-row-comparable',
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
      className: CR_REL_CSS.colName,
      ellipsis: false,
      render: (t) => <div className={CR_REL_CSS.nameText}>{t || '-'}</div>,
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
      width: 52,
      render: (v) => (Number(v) === 1 ? '是' : '否'),
    },

    { title: '等级', dataIndex: 'confidence_grade', width: 52, render: (t) => t || '-' },

    {
      title: '竞品类型',
      dataIndex: 'competitor_type',
      width: 80,
      render: (t) => renderCompetitorTypeTag(t),
    },

    { title: '综合分', dataIndex: 'relevance_score', width: 64, className: CR_REL_CSS.colNumeric, render: (v) => (v == null ? '-' : String(v)) },

    {
      title: '判断依据',
      dataIndex: 'evidence_summary',
      width: 100,
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
      width: 88,
      ellipsis: true,
      render: (t) => t || '-',
    },

    {
      title: '数据源',
      dataIndex: 'data_sources_json',
      width: 60,
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
      width: 108,
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

      width: CR_REL_COL_WIDTH.financing.col,

      className: CR_REL_CSS.colFinancing,

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

      width: 80,

      render: (t) => renderCreatedAtTwoLines(t),

    },

    {

      title: '是否可比公司',

      dataIndex: 'include_in_comparable',

      width: CR_REL_COL_WIDTH.comparable.col,
      align: 'center',
      className: CR_REL_CSS.colComparable,
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
      width: 120,
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

/** 默认列宽之和（与主表 scroll 宽度对齐，避免展开区出现横向滚动条） */
export const COMPETITOR_RELATION_TABLE_SCROLL_X = sumCompetitorRelationColumnWidths(
  getCompetitorRelationColumns()
)



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


