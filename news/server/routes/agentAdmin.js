'use strict';

const express = require('express');
const db = require('../db');
const { SERVICE_ACCOUNT } = require('../utils/agent/contract');
const {
  listAssignees,
  listKeys,
  insertKey,
  setKeyStatus,
  rotateKey,
  listLogs,
} = require('../utils/agent/admin');

const router = express.Router();

async function requireSystemAdmin(req, res, next) {
  try {
    const userId = String(req.headers['x-user-id'] || '').trim();
    if (!userId) return res.status(401).json({ success: false, message: '未登录' });
    const rows = await db.query(
      'SELECT F_Id AS id, account, role, account_status FROM users WHERE F_Id = ? LIMIT 1',
      [userId]
    );
    const user = rows[0];
    if (!user || user.account_status !== 'active') {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    const admin = String(user.role || '').toLowerCase() === 'admin' || String(user.account || '').toLowerCase() === 'admin';
    if (!admin || String(user.account) === SERVICE_ACCOUNT) {
      return res.status(403).json({ success: false, message: '仅管理员可管理 agent 调用' });
    }
    req.adminUser = user;
    return next();
  } catch (err) {
    console.error('[agent admin]', err.message || err);
    return res.status(500).json({ success: false, message: '权限校验失败' });
  }
}

router.use(requireSystemAdmin);

function sendErr(res, err) {
  const code = err && (err.code === 400 || err.code === 404) ? err.code : 500;
  if (code === 500) console.error('[agent admin]', err);
  res.status(code).json({ success: false, message: code === 500 ? '操作失败' : err.message });
}

function paging(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  return { page, pageSize, keyword: req.query.keyword };
}

router.get('/assignees', async (_req, res) => {
  try {
    res.json({ success: true, data: await listAssignees() });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/keys', async (req, res) => {
  try {
    res.json({ success: true, data: await listKeys(paging(req)) });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/keys', async (req, res) => {
  try {
    const body = req.body || {};
    const data = await insertKey({
      displayName: body.display_name,
      assigneeUserId: body.assignee_user_id,
      remark: body.remark,
      ipAllowlist: body.ip_allowlist,
    });
    res.json({
      success: true,
      message: '密钥只显示这一次。关闭后，该密钥和已发出的访问令牌会立即失效。',
      data,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.put('/keys/:id/status', async (req, res) => {
  try {
    const data = await setKeyStatus(req.params.id, req.body?.status);
    res.json({
      success: true,
      message: data.status === 'disabled'
        ? '已关闭，该密钥和已发出的访问令牌立即失效'
        : '已启用。请用原密钥重新换票，关闭前发出的访问令牌不会恢复。',
      data,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/keys/:id/rotate', async (req, res) => {
  try {
    const data = await rotateKey(req.params.id);
    res.json({
      success: true,
      message: '新密钥只显示这一次，旧访问令牌已失效。',
      data,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/logs', async (req, res) => {
  try {
    const { page, pageSize } = paging(req);
    res.json({
      success: true,
      data: await listLogs({ page, pageSize, clientId: req.query.client_id }),
    });
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;
