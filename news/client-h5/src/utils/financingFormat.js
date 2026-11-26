/** 本地日历日 yyyy-MM-dd */
function ymd(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(base, delta) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  d.setDate(d.getDate() + delta)
  return d
}

/**
 * H5 时间预设 → date_from / date_to（空表示不限）
 */
export function rangePresetToDates(preset) {
  const today = new Date()
  const todayStr = ymd(today)
  if (preset === 'yesterday') {
    const y = addDays(today, -1)
    const s = ymd(y)
    return { date_from: s, date_to: s }
  }
  if (preset === 'week') {
    return { date_from: ymd(addDays(today, -6)), date_to: todayStr }
  }
  if (preset === 'month') {
    return { date_from: ymd(addDays(today, -29)), date_to: todayStr }
  }
  return { date_from: '', date_to: '' }
}

export function formatEventDate(value) {
  if (!value) return '—'
  return String(value).slice(0, 10)
}

export function displayRound(row) {
  return row?.round || row?.latest_round || '—'
}

export function displayFundingAmt(row) {
  return row?.funding_amt_raw || row?.estimated_amt_raw || '—'
}

export function displayTrack(row) {
  const a = row?.track_primary
  const b = row?.track_secondary
  if (a && b) return `${a} / ${b}`
  return a || b || '—'
}

export function displayIntro(row) {
  const text = String(row?.ai_product_intro || row?.project_desc || '').trim()
  return text
}

/** 参与方 / 投资方展示（口径对齐 PC formatInvestors） */
export function displayInvestors(row) {
  const raw = row?.investor_names
  if (raw == null || raw === '') {
    const lead = String(row?.lead_investor || '').trim()
    return lead
  }
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (x && (x.inv_nm || x.name || x)) || '')
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join('、')
  }
  const s = String(raw).trim()
  if (!s) return String(row?.lead_investor || '').trim()
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) {
        return arr.map((x) => x && x.inv_nm).filter(Boolean).join('、')
      }
    } catch {
      /* plain text */
    }
  }
  return s
}
