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
  build: {
    // 优化构建配置，减少内存占用
    chunkSizeWarningLimit: 1000,
    // 限制构建时的并发数，减少CPU和内存占用
    rollupOptions: {
      // 限制并发处理，避免一次性处理太多文件（降低到1，进一步减少内存占用）
      maxParallelFileOps: 1,
      // 禁用某些优化以减少内存占用
      // 注意：preset: 'smallest' 可能过度优化，导致代码被错误移除
      treeshake: {
        preset: 'recommended',
        moduleSideEffects: 'no-external'
      },
      output: {
        // 移除手动分包，让 Vite 自动处理 chunk 分离
        // 这样可以确保正确的依赖顺序，避免循环依赖和加载顺序问题
        // 减少内联资源，降低内存占用
        inlineDynamicImports: false,
        // 优化输出格式
        format: 'es'
      }
    },
    // 使用 esbuild 压缩（默认，更快，内存占用更少）
    // 如果需要更小的文件大小，可以安装 terser 并使用 minify: 'terser'
    minify: 'esbuild',
    // 减少源映射生成，降低内存占用（生产环境通常不需要）
    sourcemap: false,
    // 启用压缩，但使用更快的算法
    cssMinify: 'esbuild',
    // 禁用报告压缩，减少内存占用
    reportCompressedSize: false,
    // 减少构建输出，降低内存占用
    write: true
  },
  server: {
    port: 5173,
    // 确保支持客户端路由（history API fallback）
    // Vite 默认已经支持，但明确配置以确保正确工作
    strictPort: false,
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
          const proxyStartTime = Date.now()
          let lastWarningTime = 0
          let startupLogged = false

          proxy.on('error', (err, req, _res) => {
            const isConnectionRefused =
              err.code === 'ECONNREFUSED' ||
              err.message?.includes('ECONNREFUSED') ||
              err.message?.includes('connect ECONNREFUSED') ||
              (err.cause && (err.cause.code === 'ECONNREFUSED' || err.cause.message?.includes('ECONNREFUSED'))) ||
              (err.name === 'AggregateError' && err.errors?.some(e =>
                e.code === 'ECONNREFUSED' || e.message?.includes('ECONNREFUSED')
              ))

            if (isConnectionRefused) {
              const now = Date.now()
              const isStartupPhase = now - proxyStartTime < 20000
              // 启动阶段（20 秒内）：只打一次友好提示，避免刷屏
              if (isStartupPhase) {
                if (!startupLogged) {
                  console.warn('[Vite代理] 后端正在启动 (localhost:3001)，API 请求将自动重试…')
                  startupLogged = true
                }
                return
              }
              // 启动阶段过后仍连不上：提示检查后端
              if (now - lastWarningTime > 10000) {
                console.error('[Vite代理] ❌ 无法连接到后端 (localhost:3001)，请确认已执行 npm run server 或后端服务已启动')
                console.error('[Vite代理] 错误详情:', err.message, err.code)
                lastWarningTime = now
              }
              return
            }
            console.error('[Vite代理] ❌ 代理错误:', err.message, err.code)
          })
          
          // 代理请求和响应（已移除日志以减少控制台输出）
        }
      }
    }
  },
  // 自定义日志级别，减少错误输出
  logLevel: 'info', // 显示所有日志，便于调试
  clearScreen: false // 不清屏，保持日志连续性
})

