import { Checkbox } from '@arco-design/web-react'
import { IntroPopoverCell } from './introPopoverAiCell'

const SOURCE_LABELS = { ipo_project: '底层', sourcing_financing_event: '融资', ai_web: '联网' }

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
 */
export function getCompetitorRelationColumns(opts = {}) {
  const { onComparableToggle, comparableSavingId } = opts
  return [
    { title: '竞品名称', dataIndex: 'competitor_display_name', width: 140, ellipsis: true, render: (t) => t || '-' },
    { title: '信用代码', dataIndex: 'unified_credit_code', width: 150, render: (t) => t || '-' },
    {
      title: '是否上市',
      dataIndex: 'is_listed',
      width: 72,
      render: (v) => (Number(v) === 1 ? '是' : '否'),
    },
    { title: '等级', dataIndex: 'confidence_grade', width: 56, render: (t) => t || '-' },
    { title: '综合分', dataIndex: 'relevance_score', width: 64, render: (v) => (v == null ? '-' : String(v)) },
    {
      title: '产品介绍',
      dataIndex: 'competitor_product_intro',
      width: 200,
      render: (t) => <IntroPopoverCell columnTitle="产品介绍" raw={t} triggerMaxWidth={480} />,
    },
    {
      title: '企业标签',
      dataIndex: 'competitor_tags_display',
      width: 160,
      render: (t) => <IntroPopoverCell columnTitle="企业标签" raw={t} triggerMaxWidth={480} />,
    },
    {
      title: '子基金名称',
      dataIndex: 'sub_fund_names',
      width: 120,
      ellipsis: true,
      render: (t) => t || '-',
    },
    {
      title: '数据源',
      dataIndex: 'data_sources_json',
      width: 100,
      ellipsis: true,
      render: (v) => formatCompetitorDataSources(v),
    },
    {
      title: '融资',
      dataIndex: 'financing_history_text',
      width: 120,
      render: (t, record) => {
        const text = t || record.financing_amount_text
        return <IntroPopoverCell columnTitle="融资" raw={text} triggerMaxWidth={480} />
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: (t) => (t ? String(t).replace('T', ' ').slice(0, 19) : '-'),
    },
    {
      title: '是否放入可比公司',
      dataIndex: 'include_in_comparable',
      width: 130,
      render: (v, record) => (
        <Checkbox
          checked={Number(v) === 1}
          disabled={comparableSavingId === record.id}
          onChange={(checked) => onComparableToggle?.(record, checked)}
        />
      ),
    },
  ]
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
