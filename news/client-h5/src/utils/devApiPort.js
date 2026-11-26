export const DEV_API_PORT = import.meta.env.VITE_DEV_API_PORT || '3001'

export function devApiOrigin() {
  return `http://localhost:${DEV_API_PORT}`
}
