const PREFIX = 'h5_financing_event_'

export function cacheFinancingItem(item) {
  const id = item?.id
  if (!id) return
  try {
    sessionStorage.setItem(PREFIX + id, JSON.stringify(item))
  } catch {
    /* ignore */
  }
}

export function readCachedFinancingItem(id) {
  try {
    const raw = sessionStorage.getItem(PREFIX + id)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
