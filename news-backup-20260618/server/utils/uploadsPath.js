const path = require('path');
const fs = require('fs');

/**
 * 解析上传根目录（Logo、登录背景等）。
 * - 默认与 Docker 卷挂载一致：项目根下 `uploads`（即 server 的上一级）
 * - 可设置环境变量 UPLOADS_DIR：绝对路径，或相对 process.cwd() 的相对路径
 */
function resolveUploadsDir() {
  const raw = process.env.UPLOADS_DIR;
  if (raw && String(raw).trim()) {
    const t = String(raw).trim();
    if (path.isAbsolute(t)) {
      return t;
    }
    return path.resolve(process.cwd(), t);
  }
  // 与 server/index.js 原逻辑一致：项目根（含 client、server）下的 uploads/
  return path.join(__dirname, '..', '..', 'uploads');
}

function ensureUploadsDir() {
  const dir = resolveUploadsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 确保 uploads 下的子目录存在（按应用/功能分文件夹存储）。
 * @param {string} relativePath - 相对于 uploads 根目录的路径，如 'competitor-analysis/bp'
 * @returns {string} 子目录的绝对路径
 */
function ensureUploadsSubDir(relativePath) {
  const base = ensureUploadsDir();
  const sub = path.join(base, relativePath);
  if (!fs.existsSync(sub)) {
    fs.mkdirSync(sub, { recursive: true });
  }
  return sub;
}

module.exports = { resolveUploadsDir, ensureUploadsDir, ensureUploadsSubDir };
