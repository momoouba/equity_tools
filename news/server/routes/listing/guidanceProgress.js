const db = require('../../db');
const { rowsToCsv, sendCsv } = require('../../utils/listing/listingCsv');
const { getUserFromHeader, canAccessListing } = require('../../utils/listing/listingAuth');
const { syncGuidanceProgress } = require('../../utils/listing/guidanceProgressService');
const { createExecutionLog, finishExecutionLog } = require('../../utils/listing/listingSyncExecutionLog');
const { buildTaskKey } = require('../../utils/listing/listingSourceType');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

function buildWhere(req) {
  const where = [`F_DeleteMark = 0`, `exchange = '证监会辅导备案'`];
  const params = [];
  const company = String(req.query.company || '').trim();
  const registerAddress = String(req.query.registerAddress || '').trim();
  const startDate = String(req.query.startDate || '').trim();
  const endDate = String(req.query.endDate || '').trim();
  if (company) {
    where.push('company LIKE ?');
    params.push(`%${company}%`);
  }
  if (registerAddress) {
    where.push('register_address LIKE ?');
    params.push(`%${registerAddress}%`);
  }
  if (startDate) {
    where.push('DATE(F_UpdateTime) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('DATE(F_UpdateTime) <= ?');
    params.push(endDate);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

async function listGuidanceProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));
    const offset = (page - 1) * pageSize;
    const { whereSql, params } = buildWhere(req);
    const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_progress ${whereSql}`, params);
    const list = await db.query(
      `SELECT
         F_Id AS f_id,
         DATE_FORMAT(F_UpdateTime, '%Y-%m-%d %H:%i:%s') AS f_update_time,
         company, project_name, status, exchange, board, register_address, code, receive_date
       FROM ipo_progress ${whereSql}
       ORDER BY F_UpdateTime DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return res.json({ success: true, data: { list, total: Number(countRows[0].total || 0), page, pageSize } });
  } catch (e) {
    console.error('listGuidanceProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function exportGuidanceProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const { whereSql, params } = buildWhere(req);
    const rows = await db.query(
      `SELECT DATE_FORMAT(F_UpdateTime, '%Y-%m-%d %H:%i:%s') AS f_update_time, company, project_name, status, exchange, board, register_address
       FROM ipo_progress ${whereSql}
       ORDER BY F_UpdateTime DESC
       LIMIT 50000`,
      params
    );
    const csv = rowsToCsv(rows, [
      { label: '更新时间', key: 'f_update_time' },
      { label: '公司全称', key: 'company' },
      { label: '项目简称', key: 'project_name' },
      { label: '状态', key: 'status' },
      { label: '交易所', key: 'exchange' },
      { label: '板块', key: 'board' },
      { label: '派出机构', key: 'register_address' },
    ]);
    sendCsv(res, `辅导备案进展_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('exportGuidanceProgress', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function syncGuidanceProgressRoute(req, res) {
  let logId = null;
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const body = req.body || {};
    const from = body.from || null;
    const to = body.to || null;
    const source = String(body.source || 'html').trim().toLowerCase();
    const sourceType = 'guidance_progress';
    const configId = 'direct_guidance';
    const taskKey = buildTaskKey(
      { id: configId, interface_type: 'api', news_interface_type: sourceType },
      from,
      to
    );
    logId = await createExecutionLog({
      configId,
      configName: '辅导备案-直接接口同步',
      sourceType,
      triggerType: 'manual',
      windowStart: from,
      windowEnd: to,
      taskKey,
    });
    const result = await syncGuidanceProgress({
      from,
      to,
      source,
      triggerType: 'manual',
      operatorUserId: user.id,
    });
    await finishExecutionLog(logId, {
      status: 'success',
      retryCount: 0,
      insertedCount: Number(result.inserted || 0),
      updatedCount: Number(result.updated || 0),
      skippedCount: Number(result.skipped || 0),
      dedupHits: Number(result.skipped || 0),
    });
    return res.json({ success: true, data: result });
  } catch (e) {
    if (logId) {
      try {
        await finishExecutionLog(logId, { status: 'failed', retryCount: 0, errorMessage: String(e.message || e) });
      } catch (_) {
        // ignore logging error
      }
    }
    console.error('syncGuidanceProgressRoute', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerGuidanceProgressRoutes(router) {
  router.get('/guidance-progress', listGuidanceProgress);
  router.get('/guidance-progress/export', exportGuidanceProgress);
  router.post('/guidance-progress/sync', syncGuidanceProgressRoute);
}

module.exports = { registerGuidanceProgressRoutes };

