import axios from 'axios'

// 创建axios实例
// 开发环境下优先直连后端，避免代理偶发未生效导致 404
const getBaseURL = () => {
  const isDev = import.meta.env.DEV
  if (!isDev) return ''

  // 本地开发：无论前端是否跑在 5173，都直连后端 3001
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001'
  }

  // 其他主机（如局域网 IP）继续走相对路径，由代理处理
  return ''
}

const axiosInstance = axios.create({
  baseURL: getBaseURL(),
  timeout: 120000 // 增加到120秒，适应AI分析的时间需求
})

// 请求拦截器：自动添加用户ID和角色到请求头
axiosInstance.interceptors.request.use(
  (config) => {
    // 从localStorage获取用户信息
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        if (user.id) {
          // 添加用户ID到请求头
          config.headers['x-user-id'] = user.id
        }
        if (user.role) {
          // 添加用户角色到请求头
          config.headers['x-user-role'] = user.role
        }
      } catch (e) {
        // 静默处理解析错误
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
    // 如果是401未授权，清除用户信息并跳转到登录页
    if (error.response?.status === 401) {
      localStorage.removeItem('user')
      // 只在非分享页面时跳转
      if (!window.location.pathname.startsWith('/share/')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default axiosInstance

