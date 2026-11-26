import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const newsRoot = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, newsRoot, '')
  const devApiPort = env.VITE_DEV_API_PORT || env.PORT || '3001'
  const devApiTarget = `http://localhost:${devApiPort}`

  return {
    base: '/h5/',
    envDir: newsRoot,
    plugins: [
      react(),
      {
        // 刷新/打开 /h5（无尾斜杠）或根路径时，Vite 会只显示 base 提示页；强制跳到 /h5/
        name: 'h5-base-redirect',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const raw = req.url || '/'
            const pathOnly = raw.split('?')[0]
            const qs = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
            if (pathOnly === '/' || pathOnly === '/h5') {
              res.statusCode = 302
              res.setHeader('Location', `/h5/${qs}`)
              res.end()
              return
            }
            next()
          })
        }
      }
    ],
    server: {
      port: 5174,
      strictPort: false,
      open: '/h5/',
      proxy: {
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
          secure: false
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 800
    }
  }
})
