const db = require('../../db');
const { rowsToCsv, sendCsv } = require('../../utils/上市进展/listingCsv');
const { getUserFromHeader, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { syncOverseasFiling } = require('../../utils/上市进展/overseasFilingService');
const { createExecutionLog, finishExecutionLog } = require('../../utils/上市进展/listingSyncExecutionLog');
const { buildTaskKey } = require('../../utils/上市进展/listingSourceType');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

const OVERSEAS_BOARD = '境外发行备案';

function buildWhere(req) {
  const where = ['F_DeleteMark = 0', 'board = ?'];
  const params = [OVERSEAS_BOARD];
  const companyName = String(req.query.companyName || '').trim();
  const filingType = String(req.query.filingType || '').trim();
  const filingStatus = String(req.query.filingStatus || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (companyName) {
    const like = `%${companyName}%`;
    where.push('(project_name LIKE ? OR company LIKE ?)');
    params.push(like, like);
  }
  if (filingType) {
    where.push('register_address = ?');
    params.push(filingType);
  }
  if (filingStatus) {
    where.push('status = ?');
    params.push(filingStatus);
  }
  if (from) {
    where.push('receive_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('receive_date <= ?');
    params.push(to);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

async function listOverseasFiling(req, res) {
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
         f_id AS id,
         project_name AS company_name,
         register_address AS filing_type,
         company AS filing_entity,
         exchange AS target_exchange,
         DATE_FORMAT(receive_date, '%Y-%m-%d') AS receive_date,
         status AS filing_status,
         NULL AS source_page_url,
         NULL AS source_file_url,
         NULL AS batch_week,
         DATE_FORMAT(f_create_date, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM ipo_progress ${whereSql}
       ORDER BY receive_date DESC, f_id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return res.json({ success: true, data: { list, total: Number(countRows[0].total || 0), page, pageSize } });
  } catch (e) {
    console.error('listOverseasFiling', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function exportOverseasFiling(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const { whereSql, params } = buildWhere(req);
    const rows = await db.query(
      `SELECT
         project_name AS company_name,
         register_address AS filing_type,
         company AS filing_entity,
         exchange AS target_exchange,
         DATE_FORMAT(receive_date, '%Y-%m-%d') AS receive_date,
         status AS filing_status,
         NULL AS batch_week
       FROM ipo_progress ${whereSql}
       ORDER BY receive_date DESC, f_id DESC
       LIMIT 50000`,
      params
    );
    const csv = rowsToCsv(rows, [
      { label: '企业名称', key: 'company_name' },
      { label: '申报类型', key: 'filing_type' },
      { label: '申报主体', key: 'filing_entity' },
      { label: '拟上市证券交易所', key: 'target_exchange' },
      { label: '接收日期', key: 'receive_date' },
      { label: '备案状态', key: 'filing_status' },
      { label: '批次周', key: 'batch_week' },
    ]);
    sendCsv(res, `境外上市备案审核_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('exportOverseasFiling', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function syncOverseasFilingRoute(req, res) {
  let logId = null;
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const body = req.body || {};
    const from = body.from || null;
    const to = body.to || null;
    const source = String(body.source || 'url').trim().toLowerCase();
    const sourceUrl = String(body.sourceUrl || body.url || '').trim();
    const sourceFile = String(body.sourceFile || body.file || '').trim();
    const useCsrcDiscover = body.useCsrcDiscover !== false;
    const sourceType = 'overseas_filing';
    const configId = 'direct_overseas';
    const taskKey = buildTaskKey(
      { id: configId, interface_type: 'api', news_interface_type: sourceType },
      from,
      to
    );
    logId = await createExecutionLog({
      configId,
      configName: '境外备案-直接接口同步',
      sourceType,
      triggerType: 'manual',
      windowStart: from,
      windowEnd: to,
      taskKey,
    });
    const result = await syncOverseasFiling({
      from,
      to,
      source,
      sourceUrl,
      sourceFile,
      triggerType: 'manual',
      operatorUserId: user.id,
      useCsrcDiscover,
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
    console.error('syncOverseasFilingRoute', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerOverseasFilingRoutes(router) {
  router.get('/overseas-filing', listOverseasFiling);
  router.get('/overseas-filing/export', exportOverseasFiling);
  router.post('/overseas-filing/sync', syncOverseasFilingRoute);
}

module.exports = { registerOverseasFilingRoutes };
