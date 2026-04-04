const db = require('../../db');
const { rowsToCsv, sendCsv, formatCsvDateYmdSlash } = require('../../utils/上市进展/listingCsv');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('../../utils/上市进展/listingBeijingDate');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

async function buildIpoProgressWhere(req) {
  const keyword = (req.query.keyword || '').trim();

  const where = ['F_DeleteMark = 0'];
  const params = [];
  if (keyword) {
    const like = `%${keyword}%`;
    where.push(
      `(company LIKE ? OR project_name LIKE ? OR status LIKE ? OR exchange LIKE ? OR board LIKE ? OR register_address LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  return { whereSql, params };
}

async function listIpoProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));

    const { whereSql, params } = await buildIpoProgressWhere(req);
    const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_progress ${whereSql}`, params);
    const total = countRows[0].total;
    const offset = (page - 1) * pageSize;

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
         exchange,
         F_CreatorUserId,
         F_LastModifyUserId,
         DATE_FORMAT(F_LastModifyTime, '%Y-%m-%d %H:%i:%s') AS F_LastModifyTime
       FROM ipo_progress ${whereSql}
       ORDER BY f_update_time DESC, exchange DESC, board DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({ success: true, data: { list: rows, total, page, pageSize } });
  } catch (e) {
    console.error('listIpoProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function exportIpoProgressCsv(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const { whereSql, params } = await buildIpoProgressWhere(req);
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
    console.error('exportIpoProgressCsv', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function fetchIpoProgressStats(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

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

    const byExchange = { 深交所: { yesterday: 0, year: 0 }, 上交所: { yesterday: 0, year: 0 }, 北交所: { yesterday: 0, year: 0 }, 港交所: { yesterday: 0, year: 0 } };
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
    console.error('fetchIpoProgressStats', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function updateIpoProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!isAdminAccount(user.account)) return forbidden(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const fId = req.params.fId;
    const body = req.body || {};
    const rows = await db.query(`SELECT * FROM ipo_progress WHERE f_id = ? AND F_DeleteMark = 0 LIMIT 1`, [fId]);
    if (!rows.length) return res.status(404).json({ success: false, message: '记录不存在' });

    const now = new Date();
    await db.execute(
      `UPDATE ipo_progress SET
        code = ?, project_name = ?, status = ?, register_address = ?, receive_date = ?,
        company = ?, board = ?, exchange = ?, f_update_time = ?,
        F_LastModifyUserId = ?, F_LastModifyTime = ?
       WHERE f_id = ?`,
      [
        body.code ?? rows[0].code,
        body.project_name,
        body.status,
        body.register_address,
        body.receive_date || null,
        body.company,
        body.board,
        body.exchange,
        body.f_update_time || rows[0].f_update_time,
        user.id,
        now,
        fId,
      ]
    );
    const updated = await db.query(`SELECT * FROM ipo_progress WHERE f_id = ? LIMIT 1`, [fId]);
    return res.json({ success: true, data: updated[0] });
  } catch (e) {
    console.error('updateIpoProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function softDeleteIpoProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!isAdminAccount(user.account)) return forbidden(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const fId = req.params.fId;
    const rows = await db.query(`SELECT * FROM ipo_progress WHERE f_id = ? AND F_DeleteMark = 0 LIMIT 1`, [fId]);
    if (!rows.length) return res.status(404).json({ success: false, message: '记录不存在' });

    const now = new Date();
    await db.execute(
      `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = ?, F_DeleteUserId = ? WHERE f_id = ?`,
      [now, user.id, fId]
    );
    return res.json({ success: true });
  } catch (e) {
    console.error('softDeleteIpoProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerIpoProgressRoutes(router) {
  router.get('/ipo-progress', listIpoProgress);
  router.get('/ipo-progress/stats', fetchIpoProgressStats);
  router.get('/ipo-progress/export', exportIpoProgressCsv);
  router.put('/ipo-progress/:fId', updateIpoProgress);
  router.delete('/ipo-progress/:fId', softDeleteIpoProgress);
}

module.exports = { registerIpoProgressRoutes };
