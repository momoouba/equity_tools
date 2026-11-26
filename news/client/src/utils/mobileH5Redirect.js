/**
 * 同址进站：手机访问 PC 入口时跳到 H5（分享等路径除外）。
 * 仅供 Login / App 探针调用；勿引入业务页。
 */

const SHARE_PREFIXES = ['/share/', '/performance/share/', '/publish/']

function isLocalHost() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1'
}

function h5DevOrigin() {
  return import.meta.env.VITE_H5_DEV_ORIGIN || 'http://localhost:5174'
}

export function isExcludedFromH5Redirect(pathname = window.location.pathname) {
  if (!pathname) return true
  if (pathname.startsWith('/api')) return true
  return SHARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

export function shouldPreferH5() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('pc') === '1') return false
    if (localStorage.getItem('force_pc') === '1') return false
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent || ''
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)
}

function h5TargetForPath(pathname) {
  if (pathname === '/login' || pathname === '/') return '/h5/login'
  if (pathname.startsWith('/dashboard')) return '/h5/'
  return '/h5/'
}

/**
 * @returns {boolean} 是否已发起跳转
 */
export function redirectToH5IfMobile() {
  if (typeof window === 'undefined') return false
  const pathname = window.location.pathname || '/'
  const search = window.location.search || ''
  const hash = window.location.hash || ''

  // 本地 PC 开发服误开 /h5/*：始终转到 H5 Vite（5174），避免刷新后停在电脑版壳里
  if (import.meta.env.DEV && isLocalHost() && (pathname === '/h5' || pathname.startsWith('/h5/'))) {
    window.location.replace(`${h5DevOrigin()}${pathname}${search}${hash}`)
    return true
  }

  if (isExcludedFromH5Redirect(pathname)) return false
  if (!shouldPreferH5()) return false

  const targetPath = h5TargetForPath(pathname)
  if (import.meta.env.DEV && isLocalHost()) {
    window.location.replace(`${h5DevOrigin()}${targetPath}${search}`)
  } else {
    window.location.replace(`${targetPath}${search}`)
  }
  return true
}
