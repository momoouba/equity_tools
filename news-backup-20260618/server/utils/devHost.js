/**
 * 判断请求 Host 是否为当前配置的后端本地地址（与 process.env.PORT 一致，默认 3001）。
 */
function isLocalBackendDevHost(hostHeader) {
  const port = String(process.env.PORT || 3001)
  const h = hostHeader || ''
  return h.includes(`localhost:${port}`) || h.includes(`127.0.0.1:${port}`)
}

/** 分享链接等场景：本地开发时前端走 Vite（5173） */
function shouldUseViteFrontendHost(req) {
  const requestHost = req.get('host') || ''
  return process.env.NODE_ENV === 'development' || isLocalBackendDevHost(requestHost)
}

module.exports = { isLocalBackendDevHost, shouldUseViteFrontendHost }
