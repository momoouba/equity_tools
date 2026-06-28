/**
 * 从请求对象中提取客户端 IP（支持 x-forwarded-for 代理链）
 */
function clientIpFromReq(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf && typeof xf === 'string') {
    const first = xf.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  if (req.ip) return String(req.ip).slice(0, 64);
  return null;
}

module.exports = { clientIpFromReq };
