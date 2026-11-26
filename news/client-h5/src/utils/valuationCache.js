const PREFIX = 'h5_valuation_case_'

export function cacheValuationCase(item) {
  const id = item?.id || item?.case_id
  if (!id) return
  try {
    sessionStorage.setItem(PREFIX + id, JSON.stringify(item))
  } catch {
    /* ignore */
  }
}

export function readCachedValuationCase(id) {
  try {
    const raw = sessionStorage.getItem(PREFIX + id)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
