export function fmtYi(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

/** 与 PC 列表接近的区间摘要（亿元） */
export function formatConclusionRange(conclusion) {
  const yi = conclusion?.display_yi
  if (!yi) return ''
  const dcf = yi.dcf
  if (dcf?.ma) {
    return `并购 ${fmtYi(dcf.ma.low)}~${fmtYi(dcf.ma.high)} / 上市 ${fmtYi(dcf.ipo?.low)}~${fmtYi(dcf.ipo?.high)}`
  }
  if (dcf && (dcf.low != null || dcf.high != null)) {
    return `DCF ${fmtYi(dcf.low)} ~ ${fmtYi(dcf.high)}`
  }
  const ps = yi.market_ps
  const pe = yi.market_pe
  if (ps || pe) {
    return `PS ${fmtYi(ps?.low)}~${fmtYi(ps?.high)} · PE ${fmtYi(pe?.low)}~${fmtYi(pe?.high)}`
  }
  return ''
}

export function formatConclusionLines(conclusion) {
  const yi = conclusion?.display_yi
  if (!yi) return []
  const lines = []
  const dcf = yi.dcf
  if (dcf?.ma) {
    lines.push(`DCF 并购 ${fmtYi(dcf.ma.low)} ~ ${fmtYi(dcf.ma.high)} 亿`)
    lines.push(`DCF 上市 ${fmtYi(dcf.ipo?.low)} ~ ${fmtYi(dcf.ipo?.high)} 亿`)
  } else if (dcf && (dcf.low != null || dcf.high != null)) {
    lines.push(`DCF ${fmtYi(dcf.low)} ~ ${fmtYi(dcf.high)} 亿`)
  }
  if (yi.market_ps) {
    lines.push(`市场法 PS ${fmtYi(yi.market_ps.low)} ~ ${fmtYi(yi.market_ps.high)} 亿`)
  }
  if (yi.market_pe) {
    lines.push(`市场法 PE ${fmtYi(yi.market_pe.low)} ~ ${fmtYi(yi.market_pe.high)} 亿`)
  }
  return lines
}

export function resolveCaseId(row, tab) {
  if (!row) return ''
  if (tab === 'pre') return row.case_id ? String(row.case_id) : ''
  return row.id != null ? String(row.id) : ''
}

export function displayValuationTitle(row, tab) {
  if (tab === 'pre') {
    return (
      row?.project_abbreviation ||
      row?.display_name ||
      row?.enterprise_full_name ||
      '未命名项目'
    )
  }
  return (
    row?.project_abbreviation ||
    row?.enterprise_full_name ||
    row?.subject_display_name ||
    '未命名企业'
  )
}

export function displayValuationFullName(row, tab) {
  const short = displayValuationTitle(row, tab)
  const full =
    tab === 'pre'
      ? row?.enterprise_full_name || row?.display_name || ''
      : row?.enterprise_full_name || row?.subject_display_name || ''
  if (!full || full === short) return ''
  return full
}

export function formatValuedAt(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 16)
}
