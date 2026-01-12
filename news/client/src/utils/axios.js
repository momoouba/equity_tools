import axios from 'axios'

// 创建axios实例
// 如果当前访问的是后端端口（3001），API请求也应该指向同一端口
const getBaseURL = () => {
  // 开发环境：如果当前在localhost:3001，API也指向3001
  if (window.location.hostname === 'localhost' && window.location.port === '3001') {
    return 'http://localhost:3001'
  }
  // 其他情况：使用相对路径，由代理或服务器处理
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
        console.warn('解析用户信息失败:', e)
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
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default axiosInstance

