'use strict';

const express = require('express');
const db = require('../db');
const { checkCompetitorAnalysisPermission } = require('../utils/competitor-analysis/competitorAnalysisPermission');
const { checkProjectValuationPermission } = require('../utils/valuation/permission');
const {
  APP_COMPETITOR,
  APP_VALUATION,
  ensureAppPublishTable,
  isPublishableApp,
  loadLinkByToken,
  isExpired,
  passwordMatches,
  publisherView,
  publicLinkPayload,
  findUserLink,
  savePublishLink,
  getApplicationIdByAppName,
} = require('../utils/appPublish');

const router = express.Router();

function headerUserId(req) {
  const raw = req.headers['x-user-id'];
  return raw != null ? String(raw).trim() : '';
}

async function loadActor(req) {
  const userId = headerUserId(req);
  if (!userId) return null;
  const rows = await db.query(
    'SELECT F_Id AS id, account, role FROM users WHERE F_Id = ? LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

function isAdminUser(user) {
  if (!user) return false;
  if (String(user.role || '').trim().toLowerCase() === 'admin') return true;
  return String(user.account || '').trim().toLowerCase() === 'admin';
}

async function assertCanPublish(user, appName) {
  if (!isPublishableApp(appName)) {
    const err = new Error('该应用不支持发布');
    err.statusCode = 400;
    throw err;
  }
  if (isAdminUser(user)) return;
  let ok = false;
  if (appName === APP_COMPETITOR) ok = await checkCompetitorAnalysisPermission(user.id);
  if (appName === APP_VALUATION) ok = await checkProjectValuationPermission(user.id);
  if (!ok) {
    const err = new Error('无该应用访问权限，无法发布');
    err.statusCode = 403;
    throw err;
  }
}

router.post('/create', async (req, res) => {
  try {
    const user = await loadActor(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const appName = String(req.body?.appName || '').trim();
    await assertCanPublish(user, appName);
    const saved = await savePublishLink(user.id, appName, req.body || {});
    return res.json({
      success: true,
      message: '发布链接已生成',
      data: publicLinkPayload(saved, req),
    });
  } catch (e) {
    const code = e.statusCode || 500;
    if (code >= 500) console.error('appPublish create', e);
    return res.status(code).json({ success: false, message: e.message || '发布失败' });
  }
});

router.get('/current', async (req, res) => {
  try {
    const user = await loadActor(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const appName = String(req.query.appName || '').trim();
    if (!isPublishableApp(appName)) {
      return res.status(400).json({ success: false, message: '该应用不支持发布' });
    }
    await ensureAppPublishTable();
    const appId = await getApplicationIdByAppName(appName);
    if (!appId) return res.json({ success: true, data: null });
    const link = await findUserLink(user.id, appId);
    if (!link || link.status !== 'active') return res.json({ success: true, data: null });
    const full = await loadLinkByToken(link.share_token);
    return res.json({ success: true, data: publicLinkPayload(full || link, req) });
  } catch (e) {
    console.error('appPublish current', e);
    return res.status(500).json({ success: false, message: e.message || '读取发布信息失败' });
  }
});

router.post('/close', async (req, res) => {
  try {
    const user = await loadActor(req);
    if (!user) return res.status(401).json({ success: false, message: '请先登录' });
    const appName = String(req.body?.appName || '').trim();
    if (!isPublishableApp(appName)) {
      return res.status(400).json({ success: false, message: '该应用不支持发布' });
    }
    await ensureAppPublishTable();
    const appId = await getApplicationIdByAppName(appName);
    if (!appId) return res.json({ success: true, message: '发布已关闭' });
    await db.execute(
      `UPDATE app_publish_links
       SET status = 'inactive', F_LastModifyTime = NOW()
       WHERE user_id = ? AND app_id = ?`,
      [user.id, appId]
    );
    return res.json({ success: true, message: '发布已关闭' });
  } catch (e) {
    console.error('appPublish close', e);
    return res.status(500).json({ success: false, message: e.message || '关闭发布失败' });
  }
});

/** 免登录：确认链接是否有效，以及是否需要密码 */
router.get('/verify', async (req, res) => {
  try {
    await ensureAppPublishTable();
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ success: false, message: 'Token不能为空' });
    const link = await loadLinkByToken(token);
    if (!link || link.status !== 'active') {
      return res.status(404).json({ success: false, message: '发布链接不存在或已失效' });
    }
    if (isExpired(link)) {
      return res.status(410).json({ success: false, message: '发布链接已过期' });
    }
    const needPassword = !!(link.has_password === 1 || link.has_password === true);
    const password = req.query.password;
    if (needPassword) {
      const ok = password ? await passwordMatches(link, password) : false;
      if (!ok) {
        return res.json({
          success: true,
          data: {
            needPassword: true,
            appName: link.app_name,
            appId: link.app_id,
          },
        });
      }
    }
    return res.json({
      success: true,
      data: {
        needPassword: false,
        appName: link.app_name,
        appId: link.app_id,
        publisher: {
          account: publisherView(link).account,
          role: publisherView(link).role,
        },
      },
    });
  } catch (e) {
    console.error('appPublish verify', e);
    return res.status(500).json({ success: false, message: e.message || '验证失败' });
  }
});

module.exports = router;
