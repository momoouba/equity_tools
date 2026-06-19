const db = require('../../db');
const { rowsToCsv, sendCsv } = require('../../utils/上市进展/listingCsv');
const {
  getUserFromHeader,
  canAccessListing,
  hasListingFeature,
  LISTING_FEATURE,
} = require('../../utils/上市进展/listingAuth');
const { syncNewShareCalendar, refreshNewShareEnterpriseFullNamesByIds } = require('../../utils/上市进展/newShareService');
const { createExecutionLog, finishExecutionLog } = require('../../utils/上市进展/listingSyncExecutionLog');
const { buildTaskKey } = require('../../utils/上市进展/listingSourceType');
const {
  createShanghaiDate,
  formatDateOnly,
  addDaysCalendar,
  subtractOneBeijingCalendarDay,
} = require('../../utils/上市进展/listingBeijingDate');

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
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.NEW_SHARE))) return forbidden(res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));
    const offset = (page - 1) * pageSize;
    const { whereSql, params } = buildWhere(req);

    const countRows = await db.query(`SELECT COUNT(*) AS total FROM ipo_new_share ${whereSql}`, params);
    const list = await db.query(
      `SELECT F_Id AS id, stock_code, stock_name,
              enterprise_full_name_cn, enterprise_full_name_en, enterprise_full_name_display,
              DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
              issue_weekday, issue_price, offer_pe, limit_shares,
              exchange, DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
              win_rate, total_issued_shares, first_day_close, first_day_chg_pct, first_day_market_cap,
              DATE_FORMAT(F_CreatorTime, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(F_LastModifyTime, '%Y-%m-%d %H:%i:%s') AS updated_at
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
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.NEW_SHARE))) return forbidden(res);
    const { whereSql, params } = buildWhere(req);
    const rows = await db.query(
      `SELECT stock_code, stock_name,
              enterprise_full_name_cn, enterprise_full_name_en, enterprise_full_name_display,
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
      { label: '企业全称（中/英）', key: 'enterprise_full_name_display' },
      { label: '企业中文全称', key: 'enterprise_full_name_cn' },
      { label: '企业英文全称', key: 'enterprise_full_name_en' },
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
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.NEW_SHARE))) return forbidden(res);
    const body = req.body || {};
    const startDateBody = String(body.startDate || '').trim().slice(0, 10);
    const exclusiveBody = String(body.issueDateAfterExclusive || '').trim().slice(0, 10);
    const fromLegacy = String(body.from || '').trim().slice(0, 10) || null;
    const toLegacy = String(body.to || '').trim().slice(0, 10) || null;
    const now = createShanghaiDate();
    const todayYmd = formatDateOnly(now);
    let from;
    let to;
    let issueDateAfterExclusive = null;
    const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (startDateBody && ymdOk(startDateBody)) {
      // 配置页同款：startDate 表示「含当日」的起算日
      issueDateAfterExclusive = subtractOneBeijingCalendarDay(startDateBody) || startDateBody;
      from = fromLegacy || startDateBody;
      if (toLegacy && ymdOk(toLegacy)) {
        to = toLegacy;
      } else {
        const anchor = createShanghaiDate(new Date(`${startDateBody}T12:00:00+08:00`));
        to = formatDateOnly(addDaysCalendar(anchor, 730));
      }
    } else if (exclusiveBody && ymdOk(exclusiveBody)) {
      // 仅传 issueDateAfterExclusive 时保持字面「严格大于」语义（兼容旧调用）
      issueDateAfterExclusive = exclusiveBody;
      from = fromLegacy || exclusiveBody;
      if (toLegacy && ymdOk(toLegacy)) {
        to = toLegacy;
      } else {
        const anchor = createShanghaiDate(new Date(`${exclusiveBody}T12:00:00+08:00`));
        to = formatDateOnly(addDaysCalendar(anchor, 730));
      }
    } else if (fromLegacy && toLegacy && ymdOk(fromLegacy) && ymdOk(toLegacy)) {
      from = fromLegacy;
      to = toLegacy;
    } else {
      issueDateAfterExclusive = subtractOneBeijingCalendarDay(todayYmd) || todayYmd;
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

async function aiNameNewShare(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.NEW_SHARE))) return forbidden(res);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const normalizedIds = Array.from(
      new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    if (!normalizedIds.length) {
      return res.status(400).json({ success: false, message: '请先选择需要AI查名的数据' });
    }
    const result = await refreshNewShareEnterpriseFullNamesByIds(normalizedIds, {
      logTag: `[打新日历AI查名][user=${user.id}]`,
    });
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('aiNameNewShare', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerNewShareRoutes(router) {
  router.get('/new-share', listNewShare);
  router.get('/new-share/export', exportNewShare);
  router.post('/new-share/sync', syncNewShare);
  router.post('/new-share/ai-name', aiNameNewShare);
}

module.exports = { registerNewShareRoutes };

