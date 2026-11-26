/**
 * 与 PC client 同源会话键，便于同址跳转后免再登录。
 * 仅实现 H5 需要的登录态读写（无发布嵌入逻辑）。
 */

const USER_KEY = 'user'
const REMEMBER_KEY = 'auth_remember_me'
export const REMEMBER_DAYS = 30
const REMEMBER_MS = REMEMBER_DAYS * 24 * 60 * 60 * 1000

function getStore(rememberMe) {
  return rememberMe ? localStorage : sessionStorage
}

function readRawFrom(store) {
  try {
    return store.getItem(USER_KEY)
  } catch {
    return null
  }
}

export function isRememberMeEnabled() {
  try {
    if (localStorage.getItem(REMEMBER_KEY) === '1') return true
    if (sessionStorage.getItem(USER_KEY)) return false
    if (localStorage.getItem(USER_KEY)) {
      localStorage.setItem(REMEMBER_KEY, '1')
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function readStoredUser() {
  try {
    const remember = isRememberMeEnabled()
    const store = getStore(remember)
    let raw = readRawFrom(store)
    if (!raw && !remember) raw = readRawFrom(sessionStorage)
    if (!raw && remember) raw = readRawFrom(localStorage)
    if (!raw) return null

    const user = JSON.parse(raw)
    if (!user || !(user.id || user.F_Id)) {
      clearUser()
      return null
    }

    if (remember) {
      let expiresAt = Number(user.expiresAt || 0)
      if (!expiresAt) {
        expiresAt = Date.now() + REMEMBER_MS
        user.expiresAt = expiresAt
        user.rememberMe = true
        try {
          localStorage.setItem(REMEMBER_KEY, '1')
          localStorage.setItem(USER_KEY, JSON.stringify(user))
        } catch {
          /* ignore */
        }
      } else if (Date.now() > expiresAt) {
        clearUser()
        return null
      }
    }

    return user
  } catch {
    return null
  }
}

export function getUser() {
  return readStoredUser()
}

export function setUserSession(user, rememberMe = false) {
  if (!user) return
  const payload = { ...user }
  if (!payload.id && payload.F_Id) payload.id = payload.F_Id

  try {
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(USER_KEY)
    localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* ignore */
  }

  if (rememberMe) {
    const now = Date.now()
    payload.loginAt = now
    payload.expiresAt = now + REMEMBER_MS
    payload.rememberMe = true
    localStorage.setItem(REMEMBER_KEY, '1')
    localStorage.setItem(USER_KEY, JSON.stringify(payload))
  } else {
    payload.rememberMe = false
    delete payload.expiresAt
    delete payload.loginAt
    sessionStorage.setItem(USER_KEY, JSON.stringify(payload))
  }
}

export function touchSession() {
  if (!isRememberMeEnabled()) return readStoredUser()
  const user = readStoredUser()
  if (!user) return null
  user.expiresAt = Date.now() + REMEMBER_MS
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
  return user
}

export function isLoggedIn() {
  return !!touchSession()
}

export function clearUser() {
  try {
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(USER_KEY)
    localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* ignore */
  }
}

export function hasNewsPermission(user = getUser()) {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.app_permissions || user.appPermissions || []
  return perms.some((p) => p && p.app_name === '新闻舆情')
}

/** 上市进展应用权限（打新等具体功能以后端 feature 校验为准） */
export function hasListingPermission(user = getUser()) {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.app_permissions || user.appPermissions || []
  return perms.some((p) => p && p.app_name === '上市进展' && p.membership_level_id)
}

/** 项目挖掘应用权限（融资事件等） */
export function hasProjectSourcingPermission(user = getUser()) {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.app_permissions || user.appPermissions || []
  return perms.some((p) => p && p.app_name === '项目挖掘' && p.membership_level_id)
}

/** 项目估值应用权限 */
export function hasValuationPermission(user = getUser()) {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.app_permissions || user.appPermissions || []
  return perms.some((p) => p && p.app_name === '项目估值' && p.membership_level_id)
}

/** 竞品分析应用权限 */
export function hasCompetitorPermission(user = getUser()) {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.app_permissions || user.appPermissions || []
  return perms.some((p) => p && p.app_name === '竞品分析' && p.membership_level_id)
}

/** 业绩看板应用权限（兼容「业绩看板应用」与历史名「业绩看板」） */
export function hasPerformancePermission(user = getUser()) {
  if (!user) return false
  if (user.role === 'admin') return true
  const perms = user.app_permissions || user.appPermissions || []
  return perms.some(
    (p) =>
      p &&
      (p.app_name === '业绩看板应用' || p.app_name === '业绩看板') &&
      p.membership_level_id
  )
}
