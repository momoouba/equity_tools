const db = require('../../db');
const { getUserFromHeader, canAccessListing } = require('../../utils/上市进展/listingAuth');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

/**
 * GET /listing-data-change-log?tableName=ipo_project&recordId=xxx
 * 查询 data_change_log（与系统其它模块一致）
 */
async function listDataChangeLog(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const tableName = (req.query.tableName || '').trim();
    const recordId = (req.query.recordId || '').trim();
    if (!tableName || !recordId) {
      return res.status(400).json({ success: false, message: '请提供 tableName、recordId' });
    }

    const rows = await db.query(
      `SELECT d.*, u.account AS change_user_account
       FROM data_change_log d
       LEFT JOIN users u ON u.id = d.change_user_id
       WHERE d.table_name = ? AND d.record_id = ?
       ORDER BY d.change_time DESC
       LIMIT 500`,
      [tableName, recordId]
    );

    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listDataChangeLog', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerListingLogsRoutes(router) {
  router.get('/listing-data-change-log', listDataChangeLog);
}

module.exports = { registerListingLogsRoutes };
