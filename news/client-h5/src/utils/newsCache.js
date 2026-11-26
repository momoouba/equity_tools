const PREFIX = 'h5_news_item_'

export function cacheNewsItem(item) {
  if (!item?.id) return
  try {
    sessionStorage.setItem(PREFIX + item.id, JSON.stringify(item))
  } catch {
    /* ignore */
  }
}

export function readCachedNewsItem(id) {
  try {
    const raw = sessionStorage.getItem(PREFIX + id)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
