const PREFIX = 'h5_new_share_'

export function cacheNewShareItem(item) {
  if (!item?.id) return
  try {
    sessionStorage.setItem(PREFIX + item.id, JSON.stringify(item))
  } catch {
    /* ignore */
  }
}

export function readCachedNewShareItem(id) {
  try {
    const raw = sessionStorage.getItem(PREFIX + id)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
