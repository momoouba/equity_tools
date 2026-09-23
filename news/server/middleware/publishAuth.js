'use strict';

function decodePublishPassword(raw) {
  if (raw == null || raw === '') return '';
  try {
    return Buffer.from(String(raw), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const {
  ensureAppPublishTable,
  loadLinkByToken,
  isExpired,
  passwordMatches,
  pathAllowedForApp,
  publisherView,
  guardValuationEnterprise,
  APP_VALUATION,
} = require('../utils/appPublish');

/**
 * 公开嵌入页：带 x-publish-token 时，把请求身份改成点击发布的用户，并限制在该应用接口内。
 * 不带令牌的普通登录请求原样放行。
 */
async function publishAuthMiddleware(req, res, next) {
  const token = req.headers['x-publish-token'];
  if (!token) return next();

  const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
  if (pathOnly.startsWith('/api/app-publish')) {
    // 发布管理接口只认登录态，避免嵌入页凭令牌改写或关闭发布
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    return next();
  }

  try {
    await ensureAppPublishTable();
    const link = await loadLinkByToken(String(token).trim());
    if (!link || link.status !== 'active') {
      return res.status(401).json({ success: false, message: '发布链接无效' });
    }
    if (isExpired(link)) {
      return res.status(403).json({ success: false, message: '发布链接已过期' });
    }
    if (!pathAllowedForApp(link.app_name, pathOnly)) {
      return res.status(403).json({ success: false, message: '该发布链接不能访问此接口' });
    }
    const password = decodePublishPassword(req.headers['x-publish-password']);
    if (link.has_password) {
      const ok = await passwordMatches(link, password);
      if (!ok) {
        return res.status(403).json({ success: false, message: password ? '密码错误' : '需要访问密码' });
      }
    }
    if (link.app_name === APP_VALUATION) {
      const allowed = await guardValuationEnterprise(req, res, pathOnly);
      if (!allowed) return;
    }
    const publisher = publisherView(link);
    req.headers['x-user-id'] = publisher.id;
    req.headers['x-user-role'] = publisher.role || 'user';
    req.publishLink = link;
    return next();
  } catch (e) {
    console.error('publishAuth', e);
    return res.status(500).json({ success: false, message: '发布链接校验失败' });
  }
}

module.exports = { publishAuthMiddleware };
