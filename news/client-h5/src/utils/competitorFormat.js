export function displayCompetitorTitle(row) {
  return (
    row?.project_abbreviation ||
    row?.enterprise_full_name ||
    row?.project_no ||
    row?.project_number ||
    '未命名主体'
  )
}

export function displayCompetitorFullName(row) {
  const short = displayCompetitorTitle(row)
  const full = row?.enterprise_full_name || ''
  if (!full || full === short) return ''
  return full
}

export function statusTone(status, isRunning, label = '') {
  if (isRunning) return 'run'
  const s = String(status || '').toLowerCase()
  if (s === 'success') return 'ok'
  if (s === 'failed') return 'fail'
  if (s === 'queued' || s === 'running') return 'run'
  const lb = String(label || '')
  if (/完成/.test(lb)) return 'ok'
  if (/失败/.test(lb)) return 'fail'
  return 'neu'
}

export function formatPercent(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function formatScore(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : '—'
}
