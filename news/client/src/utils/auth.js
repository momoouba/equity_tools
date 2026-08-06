/**
 * 认证 / 登录态工具
 *
 * - 勾选「记住我30天」：写入 localStorage，有操作则滑动续期 30 天
 * - 未勾选：写入 sessionStorage，关闭浏览器即失效
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

/**
 * 当前是否为「记住我」模式（以 REMEMBER_KEY 为准；兼容仅有 localStorage 旧数据）
 */
export function isRememberMeEnabled() {
  try {
    if (localStorage.getItem(REMEMBER_KEY) === '1') return true
    if (sessionStorage.getItem(USER_KEY)) return false
    // 兼容旧版：只有 localStorage.user、无 remember 标记 → 视为记住我并补标记
    if (localStorage.getItem(USER_KEY)) {
      localStorage.setItem(REMEMBER_KEY, '1')
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 读取原始用户对象（不做续期）；过期则清理并返回 null
 */
export function getUser() {
  try {
    const remember = isRememberMeEnabled()
    const store = getStore(remember)
    let raw = readRawFrom(store)
    // 记住我模式下若 local 无数据，勿误读 session
    if (!raw && !remember) {
      raw = readRawFrom(sessionStorage)
    }
    if (!raw && remember) {
      raw = readRawFrom(localStorage)
    }
    if (!raw) return null

    const user = JSON.parse(raw)
    if (!user || !(user.id || user.F_Id)) {
      clearUser()
      return null
    }

    if (remember) {
      let expiresAt = Number(user.expiresAt || 0)
      // 兼容旧版无 expiresAt：首次读取时写入 30 天
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

/**
 * 登录成功后写入会话
 * @param {object} user - 后端返回的 user
 * @param {boolean} rememberMe - 是否记住 30 天
 */
export function setUserSession(user, rememberMe = false) {
  if (!user) return
  const payload = { ...user }
  // 统一 id 字段，便于拦截器
  if (!payload.id && payload.F_Id) payload.id = payload.F_Id

  // 互斥清理
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

/**
 * 更新已登录用户信息（保留 remember / expires 元数据）
 */
export function updateStoredUser(partialOrFull) {
  const current = getUser()
  if (!current) return null
  const remember = isRememberMeEnabled()
  const next = {
    ...current,
    ...partialOrFull
  }
  if (!next.id && next.F_Id) next.id = next.F_Id
  // 保留会话元数据
  if (remember) {
    next.rememberMe = true
    next.expiresAt = current.expiresAt
    next.loginAt = current.loginAt
    localStorage.setItem(USER_KEY, JSON.stringify(next))
  } else {
    next.rememberMe = false
    delete next.expiresAt
    sessionStorage.setItem(USER_KEY, JSON.stringify(next))
  }
  return next
}

/**
 * 滑动续期：仅「记住我」模式；有操作则将过期时间延后 30 天并写回
 */
export function touchSession() {
  if (!isRememberMeEnabled()) return getUser()
  const user = getUser()
  if (!user) return null
  user.expiresAt = Date.now() + REMEMBER_MS
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
  return user
}

export function getCurrentUserId() {
  const user = touchSession()
  if (!user) return null
  return user.F_Id || user.id || null
}

export function getCurrentUserRole() {
  const user = touchSession()
  return user?.role || null
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
