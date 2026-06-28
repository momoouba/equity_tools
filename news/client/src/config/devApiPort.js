/** 本地开发后端端口，与项目根目录 `.env` 中 `PORT`、`VITE_DEV_API_PORT` 保持一致 */
export const DEV_API_PORT = import.meta.env.VITE_DEV_API_PORT || '3001'

export function devApiOrigin() {
  return `http://localhost:${DEV_API_PORT}`
}
