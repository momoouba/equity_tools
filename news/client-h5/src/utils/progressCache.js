const PREFIX = 'h5_ipo_progress_'

export function cacheProgressItem(item) {
  const id = item?.f_id ?? item?.id
  if (!id) return
  try {
    sessionStorage.setItem(PREFIX + id, JSON.stringify(item))
  } catch {
    /* ignore */
  }
}

export function readCachedProgressItem(id) {
  try {
    const raw = sessionStorage.getItem(PREFIX + id)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
