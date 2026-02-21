/**
 * 对外 API 鉴权：校验请求头中的用户 api_token（users.api_token）
 * 支持 Authorization: Bearer <token> 或 X-Api-Token: <token>
 */
const db = require('../db');

async function requireApiToken(req, res, next) {
  const raw =
    req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : req.headers['x-api-token']?.trim();

  if (!raw) {
    return res.status(401).json({
      success: false,
      message: '缺少鉴权信息，请提供 Authorization: Bearer <token> 或 X-Api-Token: <token>'
    });
  }

  try {
    const users = await db.query(
      "SELECT id, account FROM users WHERE api_token = ? AND account_status = 'active'",
      [raw]
    );
    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Token 无效或已失效'
      });
    }
    req.apiUser = users[0];
    next();
  } catch (err) {
    console.error('[apiTokenAuth]', err);
    return res.status(500).json({
      success: false,
      message: '鉴权校验失败'
    });
  }
}

module.exports = { requireApiToken };
