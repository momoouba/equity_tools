const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');

const router = express.Router();

function generateShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

const checkAuth = (req, res, next) => {
  const userId = req.headers['x-user-id'] || null;
  if (!userId) return res.status(401).json({ success: false, message: '未登录' });
  req.currentUserId = userId;
  next();
};

async function ensureListingShareTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS listing_share_links (
      id VARCHAR(19) PRIMARY KEY,
      user_id VARCHAR(19) NOT NULL,
      share_token VARCHAR(64) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      has_expiry TINYINT(1) NOT NULL DEFAULT 0,
      expiry_time DATETIME NULL,
      has_password TINYINT(1) NOT NULL DEFAULT 0,
      password_hash VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_listing_share_user (user_id),
      INDEX idx_listing_share_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function buildShareUrl(req, token) {
  const requestHost = req.get('host') || '';
  const isDev =
    process.env.NODE_ENV === 'development' ||
    requestHost.includes('localhost:3001') ||
    requestHost.includes('127.0.0.1:3001');
  const frontendHost = isDev ? 'localhost:5173' : (process.env.FRONTEND_HOST || req.get('host'));
  return `${req.protocol}://${frontendHost}/share/listing-project-progress/${token}`;
}

router.post('/create', checkAuth, async (req, res) => {
  try {
    await ensureListingShareTable();
    const userId = req.currentUserId;
    const { hasExpiry, expiryTime, hasPassword, password } = req.body || {};

    const existing = await db.query(
      `SELECT id, share_token FROM listing_share_links
       WHERE user_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    let passwordHash = null;
    if (hasPassword && password) passwordHash = await bcrypt.hash(password, 10);
    const expiryTimeValue = hasExpiry && expiryTime ? new Date(expiryTime) : null;

    let id;
    let token;
    if (existing.length > 0) {
      id = existing[0].id;
      token = existing[0].share_token;
      await db.execute(
        `UPDATE listing_share_links
         SET has_expiry = ?, expiry_time = ?, has_password = ?, password_hash = ?
         WHERE id = ?`,
        [hasExpiry ? 1 : 0, expiryTimeValue, hasPassword ? 1 : 0, passwordHash, id]
      );
    } else {
      id = await generateId('news_share_links');
      token = generateShareToken();
      await db.execute(
        `INSERT INTO listing_share_links
         (id, user_id, share_token, status, has_expiry, expiry_time, has_password, password_hash)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
        [id, userId, token, hasExpiry ? 1 : 0, expiryTimeValue, hasPassword ? 1 : 0, passwordHash]
      );
    }

    return res.json({
      success: true,
      data: {
        id,
        shareToken: token,
        shareUrl: buildShareUrl(req, token),
        hasExpiry: !!hasExpiry,
        expiryTime: expiryTimeValue,
        hasPassword: !!hasPassword,
      },
    });
  } catch (e) {
    console.error('listingShare create', e);
    return res.status(500).json({ success: false, message: e.message || '创建分享失败' });
  }
});

router.get('/current', checkAuth, async (req, res) => {
  try {
    await ensureListingShareTable();
    const userId = req.currentUserId;
    const rows = await db.query(
      `SELECT id, share_token, status, has_expiry, expiry_time, has_password
       FROM listing_share_links
       WHERE user_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.json({ success: true, data: null });
    const row = rows[0];
    return res.json({
      success: true,
      data: {
        id: row.id,
        shareToken: row.share_token,
        shareUrl: buildShareUrl(req, row.share_token),
        hasExpiry: row.has_expiry === 1,
        expiryTime: row.expiry_time,
        hasPassword: row.has_password === 1,
      },
    });
  } catch (e) {
    console.error('listingShare current', e);
    return res.status(500).json({ success: false, message: e.message || '获取分享失败' });
  }
});

router.get('/verify/:token', async (req, res) => {
  try {
    await ensureListingShareTable();
    const token = req.params.token;
    const rows = await db.query(
      `SELECT * FROM listing_share_links WHERE share_token = ? AND status = 'active' LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '分享链接不存在或已失效' });
    const row = rows[0];
    if (row.has_expiry === 1 && row.expiry_time && new Date() > new Date(row.expiry_time)) {
      return res.status(410).json({ success: false, message: '分享链接已过期' });
    }
    return res.json({
      success: true,
      data: {
        hasPassword: row.has_password === 1,
        hasExpiry: row.has_expiry === 1,
        expiryTime: row.expiry_time,
      },
    });
  } catch (e) {
    console.error('listingShare verify', e);
    return res.status(500).json({ success: false, message: e.message || '验证失败' });
  }
});

router.post('/verify-password/:token', async (req, res) => {
  try {
    await ensureListingShareTable();
    const token = req.params.token;
    const { password } = req.body || {};
    const rows = await db.query(
      `SELECT * FROM listing_share_links WHERE share_token = ? AND status = 'active' LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '分享链接不存在或已失效' });
    const row = rows[0];
    if (row.has_password !== 1) return res.json({ success: true });
    const ok = await bcrypt.compare(String(password || ''), row.password_hash || '');
    if (!ok) return res.status(400).json({ success: false, message: '密码错误' });
    return res.json({ success: true });
  } catch (e) {
    console.error('listingShare verify-password', e);
    return res.status(500).json({ success: false, message: e.message || '验证失败' });
  }
});

router.get('/data/:token', async (req, res) => {
  try {
    await ensureListingShareTable();
    const token = req.params.token;
    const rows = await db.query(
      `SELECT * FROM listing_share_links WHERE share_token = ? AND status = 'active' LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '分享链接不存在或已失效' });
    const link = rows[0];
    if (link.has_expiry === 1 && link.expiry_time && new Date() > new Date(link.expiry_time)) {
      return res.status(410).json({ success: false, message: '分享链接已过期' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;

    const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_project_progress`);
    const dataRows = await db.query(
      `SELECT f_id, fund, sub, project_name, company, inv_amount, residual_amount, ratio, ct_amount, ct_residual,
              status, board, exchange, DATE_FORMAT(f_update_time, '%Y-%m-%d') AS f_update_time
       FROM ipo_project_progress
       ORDER BY f_update_time DESC, fund DESC, sub DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    return res.json({
      success: true,
      data: {
        list: dataRows,
        total: countRows[0].total,
        page,
        pageSize,
      },
    });
  } catch (e) {
    console.error('listingShare data', e);
    return res.status(500).json({ success: false, message: e.message || '获取数据失败' });
  }
});

module.exports = router;

