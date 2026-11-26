import axios from 'axios'
import { clearUser, getUser, touchSession } from './auth'

const axiosInstance = axios.create({
  baseURL: '',
  timeout: 60000
})

axiosInstance.interceptors.request.use((config) => {
  const user = touchSession() || getUser()
  if (user) {
    const id = user.id || user.F_Id
    if (id) config.headers['x-user-id'] = id
    if (user.role) config.headers['x-user-role'] = user.role
  }
  return config
})

axiosInstance.interceptors.response.use(
  (res) => res,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/api/auth/login')
    const path = window.location.pathname || ''
    const onLogin = /\/h5\/?login\/?$/.test(path) || path.endsWith('/login')
    if (error.response?.status === 401 && !isLoginRequest && !onLogin) {
      clearUser()
      const base = import.meta.env.BASE_URL || '/h5/'
      window.location.href = `${base}login`.replace(/\/{2,}/g, '/')
    }
    return Promise.reject(error)
  }
)

export default axiosInstance
