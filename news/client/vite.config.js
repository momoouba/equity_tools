import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 在启动阶段临时抑制ECONNREFUSED错误输出（仅针对Vite代理错误）
let startupPhase = true
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

// 启动后30秒内，抑制ECONNREFUSED相关的错误输出
setTimeout(() => {
  startupPhase = false
}, 30000)

// 临时重写console.error和console.warn，过滤启动阶段的Vite代理ECONNREFUSED错误
if (process.env.NODE_ENV === 'development') {
  console.error = (...args) => {
    const message = args.join(' ')
    // 只抑制Vite代理相关的ECONNREFUSED错误，不影响其他错误
    if (startupPhase && (
      (message.includes('ECONNREFUSED') && message.includes('proxy')) || 
      message.includes('http proxy error') ||
      (message.includes('AggregateError') && message.includes('ECONNREFUSED'))
    )) {
      // 启动阶段抑制这些Vite代理错误
      return
    }
    originalConsoleError.apply(console, args)
  }
  
  console.warn = (...args) => {
    const message = args.join(' ')
    // 只抑制Vite代理相关的ECONNREFUSED警告，不影响其他警告
    if (startupPhase && (
      (message.includes('ECONNREFUSED') && message.includes('proxy')) || 
      message.includes('http proxy error') ||
      (message.includes('AggregateError') && message.includes('ECONNREFUSED'))
    )) {
      // 启动阶段抑制这些Vite代理警告
      return
    }
    originalConsoleWarn.apply(console, args)
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 减少日志输出，避免启动时的错误信息刷屏
    hmr: {
      overlay: false // 禁用HMR错误覆盖层，减少错误提示
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
        configure: (proxy, _options) => {
          // 使用闭包保持状态，记录是否已经显示过启动提示
          let lastWarningTime = 0
          let errorCount = 0
          
          proxy.on('error', (err, req, _res) => {
            // ECONNREFUSED 错误通常发生在服务器启动时，前端在服务器完全启动之前尝试连接
            // 这是正常情况，完全抑制这些错误，避免刷屏
            const isConnectionRefused = 
              err.code === 'ECONNREFUSED' || 
              err.message?.includes('ECONNREFUSED') ||
              err.message?.includes('connect ECONNREFUSED') ||
              (err.cause && (err.cause.code === 'ECONNREFUSED' || err.cause.message?.includes('ECONNREFUSED'))) ||
              (err.name === 'AggregateError' && err.errors?.some(e => 
                e.code === 'ECONNREFUSED' || e.message?.includes('ECONNREFUSED')
              ))
            
            if (isConnectionRefused) {
              errorCount++
              // 只在开发环境且距离上次警告超过10秒时显示一次提示
              const now = Date.now()
              if (process.env.NODE_ENV === 'development' && (now - lastWarningTime > 10000)) {
                console.warn('[Vite代理] 后端服务器正在启动中，请稍候...')
                lastWarningTime = now
                errorCount = 0
              }
              // 完全抑制错误，不输出到控制台，也不抛出异常
              return
            }
            // 其他错误才显示
            console.warn('[Vite代理] 代理错误:', err.message)
          })
          
          // 拦截代理请求，在启动阶段不输出日志
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // 启动阶段不显示代理请求日志，避免刷屏
            // 服务器就绪后（10秒后）可以显示（可选，如果需要调试可以取消注释）
            // if (process.env.NODE_ENV === 'development' && (Date.now() - lastWarningTime > 10000)) {
            //   console.log('[1]代理请求:', req.method, req.url)
            // }
          })
        }
      }
    }
  },
  // 自定义日志级别，减少错误输出
  logLevel: 'warn', // 只显示警告和错误，不显示info
  clearScreen: false // 不清屏，保持日志连续性
})

