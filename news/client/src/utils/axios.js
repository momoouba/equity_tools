import axios from 'axios'
import { devApiOrigin } from '../config/devApiPort'
import { clearUser, getPublishSession, getUser, isPublishPath, touchSession } from './auth'

// 创建axios实例
// 开发环境下优先直连后端，避免代理偶发未生效导致 404
const getBaseURL = () => {
  const isDev = import.meta.env.DEV
  if (!isDev) return ''

  // 本地开发：无论前端是否跑在 5173，都直连后端（端口见 .env VITE_DEV_API_PORT）
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return devApiOrigin()
  }

  // 其他主机（如局域网 IP）继续走相对路径，由代理处理
  return ''
}

const axiosInstance = axios.create({
  baseURL: getBaseURL(),
  timeout: 120000 // 增加到120秒，适应AI分析的时间需求
})

// 请求拦截器：自动添加用户ID和角色到请求头；记住我模式下滑动续期
axiosInstance.interceptors.request.use(
  (config) => {
    const onPublish = isPublishPath()
    if (onPublish) {
      const pub = getPublishSession()
      if (pub?.token) {
        config.headers['x-publish-token'] = pub.token
        if (pub.password) {
          config.headers['x-publish-password'] = btoa(unescape(encodeURIComponent(pub.password)))
        }
      }
      return config
    }
    const user = touchSession() || getUser()
    if (user) {
      const id = user.id || user.F_Id
      if (id) {
        config.headers['x-user-id'] = id
      }
      if (user.role) {
        config.headers['x-user-role'] = user.role
      }
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器：处理错误
axiosInstance.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/api/auth/login')
    const isOnLoginPage = window.location.pathname === '/login'

    // 401：登录失败留在登录页展示错误；已登录会话过期则跳转登录
    const path = window.location.pathname
    const isPublicShare = isPublishPath(path)
      || path.startsWith('/share/')
      || path.startsWith('/performance/share/')
    if (error.response?.status === 401 && !isLoginRequest && !isOnLoginPage && !isPublicShare) {
      clearUser()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default axiosInstance
