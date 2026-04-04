const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('../utils/上市进展/listingBeijingDate');
const { rowsToCsv, sendCsv, formatCsvDateYmdSlash } = require('../utils/上市进展/listingCsv');

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

async function getShareLinkOrError(req, res) {
  await ensureListingShareTable();
  const token = req.params.token;
  const rows = await db.query(
    `SELECT * FROM listing_share_links WHERE share_token = ? AND status = 'active' LIMIT 1`,
    [token]
  );
  if (!rows.length) {
    res.status(404).json({ success: false, message: '分享链接不存在或已失效' });
    return null;
  }
  const link = rows[0];
  if (link.has_expiry === 1 && link.expiry_time && new Date() > new Date(link.expiry_time)) {
    res.status(410).json({ success: false, message: '分享链接已过期' });
    return null;
  }
  return link;
}

/** 与 ipoProjectProgress 列表一致：昨日/本周/本月（北京时间），用于分享页底层项目表 */
function rangeFromPresetBeijingForShare(preset) {
  const today = createShanghaiDate();
  const todayYmd = formatDateOnly(today);
  if (preset === 'yesterday') {
    const d = addDaysCalendar(today, -1);
    const ymd = formatDateOnly(d);
    return {
      start: new Date(`${ymd}T00:00:00+08:00`),
      end: new Date(`${ymd}T23:59:59.999+08:00`),
    };
  }
  if (preset === 'week') {
    const startD = addDaysCalendar(today, -6);
    return {
      start: new Date(`${formatDateOnly(startD)}T00:00:00+08:00`),
      end: new Date(`${todayYmd}T23:59:59.999+08:00`),
    };
  }
  if (preset === 'month') {
    const startD = addDaysCalendar(today, -29);
    return {
      start: new Date(`${formatDateOnly(startD)}T00:00:00+08:00`),
      end: new Date(`${todayYmd}T23:59:59.999+08:00`),
    };
  }
  return null;
}

function buildShareProjectProgressDateWhere(query) {
  const preset = (query.rangePreset || '').trim();
  const startStr = (query.startDate || '').trim();
  const endStr = (query.endDate || '').trim();
  const where = [];
  const params = [];
  let rangeStart = null;
  let rangeEnd = null;
  if (startStr && endStr) {
    rangeStart = new Date(`${startStr}T00:00:00+08:00`);
    rangeEnd = new Date(`${endStr}T23:59:59.999+08:00`);
  } else if (preset && preset !== 'all') {
    const r = rangeFromPresetBeijingForShare(preset);
    if (r) {
      rangeStart = r.start;
      rangeEnd = r.end;
    }
  }
  if (rangeStart && rangeEnd) {
    where.push('f_update_time >= ? AND f_update_time <= ?');
    params.push(rangeStart, rangeEnd);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

function buildIpoProgressShareWhere(keyword) {
  const kw = String(keyword || '').trim();
  const where = ['F_DeleteMark = 0'];
  const params = [];
  if (kw) {
    const like = `%${kw}%`;
    where.push(
      `(company LIKE ? OR project_name LIKE ? OR status LIKE ? OR exchange LIKE ? OR board LIKE ? OR register_address LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  return { whereSql, params };
}

router.get('/data/:token', async (req, res) => {
  try {
    const link = await getShareLinkOrError(req, res);
    if (!link) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));
    const offset = (page - 1) * pageSize;

    const { whereSql, params: dateParams } = buildShareProjectProgressDateWhere(req.query);

    const countRows = await db.query(
      `SELECT COUNT(*) AS total FROM ipo_project_progress ${whereSql}`,
      dateParams
    );
    const dataRows = await db.query(
      `SELECT f_id, fund, sub, project_name, company, inv_amount, residual_amount, ratio, ct_amount, ct_residual,
              status, board, exchange, DATE_FORMAT(f_update_time, '%Y-%m-%d') AS f_update_time
       FROM ipo_project_progress
       ${whereSql}
       ORDER BY f_update_time DESC, fund DESC, sub DESC
       LIMIT ? OFFSET ?`,
      [...dateParams, pageSize, offset]
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

/** GET /api/listing-share/project-progress-export/:token — 底层项目上市进展 CSV（与登录态时间范围一致） */
router.get('/project-progress-export/:token', async (req, res) => {
  try {
    const link = await getShareLinkOrError(req, res);
    if (!link) return;

    const { whereSql, params } = buildShareProjectProgressDateWhere(req.query);
    const rows = await db.query(
      `SELECT
         DATE_FORMAT(f_update_time, '%Y-%m-%d %H:%i:%s') AS f_update_time,
         exchange,
         board,
         status,
         fund,
         sub,
         project_name,
         company,
         inv_amount,
         residual_amount,
         ratio,
         ct_amount,
         ct_residual
       FROM ipo_project_progress
       ${whereSql}
       ORDER BY f_update_time DESC, fund DESC, sub DESC
       LIMIT 50000`,
      params
    );

    const csv = rowsToCsv(rows, [
      { label: '更新日期', key: 'f_update_time', get: (r) => formatCsvDateYmdSlash(r.f_update_time) },
      { label: '交易所', key: 'exchange' },
      { label: '板块', key: 'board' },
      { label: '审核状态', key: 'status' },
      { label: '归属基金', key: 'fund' },
      { label: '归属子基金', key: 'sub' },
      { label: '项目简称', key: 'project_name' },
      { label: '企业全称', key: 'company' },
      { label: '投资金额', key: 'inv_amount' },
      { label: '剩余金额', key: 'residual_amount' },
      { label: '穿透权益占比', key: 'ratio' },
      { label: '穿透投资金额', key: 'ct_amount' },
      { label: '穿透剩余金额', key: 'ct_residual' },
    ]);
    sendCsv(res, `底层项目上市进展_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('listingShare project-progress-export', e);
    return res.status(500).json({ success: false, message: e.message || '导出失败' });
  }
});

/** GET /api/listing-share/ipo-progress-stats/:token — 与登录态 IPO 统计一致，供分享页「IPO审核进展」Tab */
router.get('/ipo-progress-stats/:token', async (req, res) => {
  try {
    const link = await getShareLinkOrError(req, res);
    if (!link) return;

    const todayBj = createShanghaiDate();
    const yest = formatDateOnly(addDaysCalendar(todayBj, -1));
    const yearStart = `${String(todayBj.getFullYear())}-01-01`;

    const rows = await db.query(
      `SELECT
         exchange,
         SUM(CASE WHEN DATE(f_update_time) = ? THEN 1 ELSE 0 END) AS yesterday_count,
         SUM(CASE WHEN DATE(f_update_time) >= ? THEN 1 ELSE 0 END) AS year_count
       FROM ipo_progress
       WHERE F_DeleteMark = 0
         AND exchange IN ('深交所', '上交所', '北交所', '港交所')
       GROUP BY exchange`,
      [yest, yearStart]
    );

    const byExchange = {
      深交所: { yesterday: 0, year: 0 },
      上交所: { yesterday: 0, year: 0 },
      北交所: { yesterday: 0, year: 0 },
      港交所: { yesterday: 0, year: 0 },
    };
    rows.forEach((r) => {
      byExchange[r.exchange] = {
        yesterday: Number(r.yesterday_count || 0),
        year: Number(r.year_count || 0),
      };
    });

    return res.json({
      success: true,
      data: {
        yesterday: yest,
        year: todayBj.getFullYear(),
        byExchange,
      },
    });
  } catch (e) {
    console.error('listingShare ipo-progress-stats', e);
    return res.status(500).json({ success: false, message: e.message || '获取统计失败' });
  }
});

/** GET /api/listing-share/ipo-progress-data/:token — 与登录态 IPO 列表一致（只读） */
router.get('/ipo-progress-data/:token', async (req, res) => {
  try {
    const link = await getShareLinkOrError(req, res);
    if (!link) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));
    const offset = (page - 1) * pageSize;
    const { whereSql, params } = buildIpoProgressShareWhere(req.query.keyword);

    const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_progress ${whereSql}`, params);
    const total = countRows[0].total;

    const rows = await db.query(
      `SELECT
         f_id,
         f_create_date,
         DATE_FORMAT(f_update_time, '%Y-%m-%d %H:%i:%s') AS f_update_time,
         code,
         project_name,
         status,
         register_address,
         DATE_FORMAT(receive_date, '%Y-%m-%d') AS receive_date,
         company,
         board,
         exchange
       FROM ipo_progress ${whereSql}
       ORDER BY f_update_time DESC, exchange DESC, board DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({ success: true, data: { list: rows, total, page, pageSize } });
  } catch (e) {
    console.error('listingShare ipo-progress-data', e);
    return res.status(500).json({ success: false, message: e.message || '获取数据失败' });
  }
});

/** GET /api/listing-share/ipo-progress-export/:token — CSV 导出（与登录态字段一致） */
router.get('/ipo-progress-export/:token', async (req, res) => {
  try {
    const link = await getShareLinkOrError(req, res);
    if (!link) return;

    const { whereSql, params } = buildIpoProgressShareWhere(req.query.keyword);
    const rows = await db.query(
      `SELECT
         DATE_FORMAT(f_update_time, '%Y-%m-%d %H:%i:%s') AS f_update_time,
         company,
         status,
         exchange,
         board,
         project_name,
         register_address,
         code
       FROM ipo_progress ${whereSql}
       ORDER BY f_update_time DESC, exchange DESC, board DESC
       LIMIT 50000`,
      params
    );

    const csv = rowsToCsv(rows, [
      { label: '更新日期', key: 'f_update_time', get: (r) => formatCsvDateYmdSlash(r.f_update_time) },
      { label: '公司全称', key: 'company' },
      { label: '审核状态', key: 'status' },
      { label: '交易所', key: 'exchange' },
      { label: '板块', key: 'board' },
      { label: '项目简称', key: 'project_name' },
      { label: '注册地', key: 'register_address' },
      { label: '证券代码', key: 'code' },
    ]);
    sendCsv(res, `上市信息表_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('listingShare ipo-progress-export', e);
    return res.status(500).json({ success: false, message: e.message || '导出失败' });
  }
});

module.exports = router;

