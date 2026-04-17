const db = require('../../db');
const { rowsToCsv, sendCsv } = require('../../utils/上市进展/listingCsv');
const { getUserFromHeader, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { syncNewShareCalendar } = require('../../utils/上市进展/newShareService');
const { createExecutionLog, finishExecutionLog } = require('../../utils/上市进展/listingSyncExecutionLog');
const { buildTaskKey } = require('../../utils/上市进展/listingSourceType');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('../../utils/上市进展/listingBeijingDate');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

function buildWhere(req) {
  const where = ['1=1'];
  const params = [];
  const keyword = String(req.query.keyword || '').trim();
  const exchange = String(req.query.exchange || '').trim();
  const startDate = String(req.query.startDate || '').trim();
  const endDate = String(req.query.endDate || '').trim();
  if (keyword) {
    where.push('(stock_code LIKE ? OR stock_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (exchange) {
    where.push('exchange = ?');
    params.push(exchange);
  }
  if (startDate) {
    where.push('issue_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('issue_date <= ?');
    params.push(endDate);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function listNewShare(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));
    const offset = (page - 1) * pageSize;
    const { whereSql, params } = buildWhere(req);

    const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_new_share ${whereSql}`, params);
    const list = await db.query(
      `SELECT id, stock_code, stock_name,
              DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
              issue_weekday, issue_price, offer_pe, limit_shares,
              exchange, DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
              win_rate, total_issued_shares, first_day_close, first_day_chg_pct, first_day_market_cap,
              created_at, updated_at
       FROM ipo_new_share ${whereSql}
       ORDER BY issue_date DESC, stock_code ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return res.json({ success: true, data: { list, total: Number(countRows[0].total || 0), page, pageSize } });
  } catch (e) {
    console.error('listNewShare', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function exportNewShare(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const { whereSql, params } = buildWhere(req);
    const rows = await db.query(
      `SELECT stock_code, stock_name,
              DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
              issue_weekday, issue_price, offer_pe, limit_shares, exchange,
              DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
              win_rate, total_issued_shares, first_day_close, first_day_chg_pct, first_day_market_cap
       FROM ipo_new_share ${whereSql}
       ORDER BY issue_date DESC, stock_code ASC
       LIMIT 50000`,
      params
    );
    const csv = rowsToCsv(rows, [
      { label: '股票代码', key: 'stock_code' },
      { label: '股票简称', key: 'stock_name' },
      { label: '申购日期', key: 'issue_date' },
      { label: '星期', key: 'issue_weekday' },
      { label: '发行价', key: 'issue_price' },
      { label: '发行市盈率', key: 'offer_pe' },
      { label: '申购上限', key: 'limit_shares' },
      { label: '交易所', key: 'exchange' },
      { label: '上市日期', key: 'public_date' },
      { label: '中签率', key: 'win_rate' },
      { label: '总发行数量', key: 'total_issued_shares' },
      { label: '上市首日收盘价', key: 'first_day_close' },
      { label: '首日涨幅(%)', key: 'first_day_chg_pct' },
      { label: '首日市值', key: 'first_day_market_cap' },
    ]);
    sendCsv(res, `打新日历_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('exportNewShare', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function syncNewShare(req, res) {
  let logId = null;
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);
    const body = req.body || {};
    const startOrIssue = String(body.startDate || body.issueDateAfterExclusive || '').trim().slice(0, 10);
    const fromLegacy = String(body.from || '').trim().slice(0, 10) || null;
    const toLegacy = String(body.to || '').trim().slice(0, 10) || null;
    const now = createShanghaiDate();
    const todayYmd = formatDateOnly(now);
    let from;
    let to;
    let issueDateAfterExclusive = null;
    if (startOrIssue && /^\d{4}-\d{2}-\d{2}$/.test(startOrIssue)) {
      issueDateAfterExclusive = startOrIssue;
      from = fromLegacy || startOrIssue;
      if (toLegacy && /^\d{4}-\d{2}-\d{2}$/.test(toLegacy)) {
        to = toLegacy;
      } else {
        to = formatDateOnly(addDaysCalendar(new Date(`${startOrIssue}T12:00:00+08:00`), 730));
      }
    } else if (fromLegacy && toLegacy && /^\d{4}-\d{2}-\d{2}$/.test(fromLegacy) && /^\d{4}-\d{2}-\d{2}$/.test(toLegacy)) {
      from = fromLegacy;
      to = toLegacy;
    } else {
      issueDateAfterExclusive = todayYmd;
      from = todayYmd;
      to = formatDateOnly(addDaysCalendar(now, 730));
    }
    const sourceType = 'new_share';
    const configId = 'direct_new_share';
    const taskKey = buildTaskKey({ id: configId, interface_type: 'api', news_interface_type: sourceType }, from, to);
    logId = await createExecutionLog({
      configId,
      configName: '打新日历-直接接口同步',
      sourceType,
      triggerType: 'manual',
      windowStart: from,
      windowEnd: to,
      taskKey,
    });
    const result = await syncNewShareCalendar({
      from,
      to,
      issueDateAfterExclusive,
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
    console.error('syncNewShare', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerNewShareRoutes(router) {
  router.get('/new-share', listNewShare);
  router.get('/new-share/export', exportNewShare);
  router.post('/new-share/sync', syncNewShare);
}

module.exports = { registerNewShareRoutes };

