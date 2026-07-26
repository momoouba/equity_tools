/**
 * 认证相关工具函数
 */

/**
 * 获取当前用户ID
 * @returns {string|null} 用户ID或null
 */
export function getCurrentUserId() {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    return user?.F_Id || user?.id || null;
  } catch {
    return null;
  }
}

/**
 * 获取当前用户角色
 * @returns {string|null} 用户角色或null
 */
export function getCurrentUserRole() {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    return user?.role || null;
  } catch {
    return null;
  }
}

/**
 * 检查用户是否已登录
 * @returns {boolean}
 */
export function isLoggedIn() {
  return !!localStorage.getItem('user');
}

/**
 * 清除用户信息（登出）
 */
export function clearUser() {
  localStorage.removeItem('user');
}
