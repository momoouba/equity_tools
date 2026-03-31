const db = require('../../db');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('../../utils/上市进展/listingBeijingDate');
const { rowsToCsv, sendCsv, formatCsvDateYmdSlash } = require('../../utils/上市进展/listingCsv');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

/** 昨日/本周/本月 — 按北京时间日历日 */
function rangeFromPresetBeijing(preset) {
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

async function buildProgressWhere(req, user) {
  const preset = (req.query.rangePreset || '').trim();
  const startStr = (req.query.startDate || '').trim();
  const endStr = (req.query.endDate || '').trim();

  const where = [];
  const params = [];

  if (!isAdminAccount(user.account)) {
    where.push('ipp.F_CreatorUserId = ?');
    params.push(user.id);
  }

  let rangeStart = null;
  let rangeEnd = null;
  if (startStr && endStr) {
    rangeStart = new Date(`${startStr}T00:00:00+08:00`);
    rangeEnd = new Date(`${endStr}T23:59:59.999+08:00`);
  } else if (preset && preset !== 'all') {
    const r = rangeFromPresetBeijing(preset);
    if (r) {
      rangeStart = r.start;
      rangeEnd = r.end;
    }
  }

  if (rangeStart && rangeEnd) {
    where.push('ipp.f_update_time >= ? AND ipp.f_update_time <= ?');
    params.push(rangeStart, rangeEnd);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

async function listIpoProjectProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const { whereSql, params } = await buildProgressWhere(req, user);

    const countRows = await db.query(
      `SELECT COUNT(*) AS total FROM ipo_project_progress ipp ${whereSql}`,
      params
    );
    const total = countRows[0].total;
    const offset = (page - 1) * pageSize;

    const rows = await db.query(
      `SELECT
         ipp.f_id,
         ipp.ipo_progress_row_id,
         ipp.ipo_project_f_id,
         ipp.fund,
         ipp.sub,
         ipp.project_name,
         ipp.company,
         ipp.inv_amount,
         ipp.residual_amount,
         ipp.ratio,
         ipp.ct_amount,
         ipp.ct_residual,
         ipp.status,
         ipp.board,
         ipp.exchange,
         DATE_FORMAT(ipp.f_update_time, '%Y-%m-%d %H:%i:%s') AS f_update_time,
         ipp.f_create_date,
         ipp.F_CreatorUserId,
         u.account AS creator_account
       FROM ipo_project_progress ipp
       LEFT JOIN users u ON u.id = ipp.F_CreatorUserId
       ${whereSql}
       ORDER BY ipp.f_update_time DESC, ipp.fund DESC, ipp.sub DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({ success: true, data: { list: rows, total, page, pageSize } });
  } catch (e) {
    console.error('listIpoProjectProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function exportIpoProjectProgressCsv(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const { whereSql, params } = await buildProgressWhere(req, user);
    const rows = await db.query(
      `SELECT ipp.*, u.account AS creator_account
       FROM ipo_project_progress ipp
       LEFT JOIN users u ON u.id = ipp.F_CreatorUserId
       ${whereSql}
       ORDER BY ipp.f_update_time DESC, ipp.fund DESC, ipp.sub DESC
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
      { label: '创建用户', key: 'creator_account' },
    ]);
    sendCsv(res, `底层项目上市进展_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('exportIpoProjectProgressCsv', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function updateIpoProjectProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!isAdminAccount(user.account)) return forbidden(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const fId = req.params.fId;
    const body = req.body || {};
    const rows = await db.query(`SELECT f_id, f_update_time FROM ipo_project_progress WHERE f_id = ? LIMIT 1`, [fId]);
    if (!rows.length) return res.status(404).json({ success: false, message: '记录不存在' });

    await db.execute(
      `UPDATE ipo_project_progress SET
        fund = ?, sub = ?, project_name = ?, company = ?,
        inv_amount = ?, residual_amount = ?, ratio = ?, ct_amount = ?, ct_residual = ?,
        status = ?, board = ?, exchange = ?, f_update_time = ?
       WHERE f_id = ?`,
      [
        body.fund,
        body.sub ?? null,
        body.project_name,
        body.company,
        body.inv_amount,
        body.residual_amount,
        body.ratio,
        body.ct_amount,
        body.ct_residual,
        body.status,
        body.board,
        body.exchange,
        body.f_update_time || rows[0].f_update_time,
        fId,
      ]
    );
    const updated = await db.query(`SELECT * FROM ipo_project_progress WHERE f_id = ? LIMIT 1`, [fId]);
    return res.json({ success: true, data: updated[0] });
  } catch (e) {
    console.error('updateIpoProjectProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function softDeleteIpoProjectProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!isAdminAccount(user.account)) return forbidden(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const fId = req.params.fId;
    await db.execute(`DELETE FROM ipo_project_progress WHERE f_id = ?`, [fId]);
    return res.json({ success: true });
  } catch (e) {
    console.error('softDeleteIpoProjectProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerIpoProjectProgressRoutes(router) {
  router.get('/ipo-project-progress', listIpoProjectProgress);
  router.get('/ipo-project-progress/export', exportIpoProjectProgressCsv);
  router.put('/ipo-project-progress/:fId', updateIpoProjectProgress);
  router.delete('/ipo-project-progress/:fId', softDeleteIpoProjectProgress);
}

module.exports = { registerIpoProjectProgressRoutes };
