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

/**
 * GET /listing-sync-execution-log
 * 查询上市进展同步执行日志
 */
async function listSyncExecutionLog(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;
    const id = String(req.query.id || '').trim();
    const configId = String(req.query.configId || '').trim();
    const taskKey = String(req.query.taskKey || '').trim();
    const sourceType = String(req.query.sourceType || '').trim();
    const status = String(req.query.status || '').trim();

    const where = ['1=1'];
    const params = [];
    if (id) {
      where.push('id = ?');
      params.push(Number(id));
    }
    if (configId) {
      where.push('config_id = ?');
      params.push(configId);
    }
    if (taskKey) {
      where.push('task_key = ?');
      params.push(taskKey);
    }
    if (sourceType) {
      where.push('source_type = ?');
      params.push(sourceType);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countRows = await db.query(
      `SELECT COUNT(*) AS total FROM listing_sync_execution_log ${whereSql}`,
      params
    );
    const rows = await db.query(
      `SELECT
         id, config_id, config_name, source_type, trigger_type, window_start, window_end, task_key, status,
         DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS started_at,
         DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') AS ended_at,
         retry_count, inserted_count, updated_count, skipped_count, dedup_hits, error_message, progress_log,
         DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM listing_sync_execution_log
       ${whereSql}
       ORDER BY started_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return res.json({
      success: true,
      data: { list: rows, total: Number(countRows[0].total || 0), page, pageSize },
    });
  } catch (e) {
    console.error('listSyncExecutionLog', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerListingLogsRoutes(router) {
  router.get('/listing-data-change-log', listDataChangeLog);
  router.get('/listing-sync-execution-log', listSyncExecutionLog);
}

module.exports = { registerListingLogsRoutes };
