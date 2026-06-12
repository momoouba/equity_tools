const db = require('../../db');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('../../utils/上市进展/listingBeijingDate');
const { rowsToCsv, sendCsv, formatCsvDateYmdSlash } = require('../../utils/上市进展/listingCsv');
const {
  getUserFromHeader,
  isAdminAccount,
  canAccessListing,
  hasListingFeature,
  LISTING_FEATURE,
} = require('../../utils/上市进展/listingAuth');

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

/** 统一为 utf8mb4_general_ci，避免 TEXT(utf8mb4_bin) 与字面量/绑定串在 CONCAT_WS/LIKE 中报 ER_CANT_AGGREGATE_2COLLATIONS */
function listingProgressKeywordBlob(exprSql) {
  return `CONVERT((${exprSql}) USING utf8mb4) COLLATE utf8mb4_general_ci`;
}

// #16: 白名单校验 —— exprSql 仅允许引用已知列，防止意外注入用户可控内容
const ALLOWED_EXPR_COLUMNS = new Set([
  'ipp.f_update_time', 'ipp.exchange', 'ipp.board', 'ipp.status',
  'ipp.fund', 'ipp.sub', 'ipp.project_name', 'ipp.company',
  'ipp.inv_amount', 'ipp.residual_amount', 'ipp.ratio', 'ipp.ct_amount', 'ipp.ct_residual',
]);
function assertSafeExprSql(exprSql) {
  // 允许的模式：IFNULL(列引用, ...)、DATE_FORMAT(列引用, ...)、TRIM(CAST(列引用 AS CHAR))
  // 提取所有 ipp.xxx 引用并验证是否在白名单内
  const refs = (exprSql.match(/ipp\.\w+/g) || []);
  for (const ref of refs) {
    if (!ALLOWED_EXPR_COLUMNS.has(ref)) {
      throw new Error(`listingProgressKeywordBlob: 不允许的列引用 ${ref}`);
    }
  }
  // 禁止 SQL 关键字（除 IFNULL/DATE_FORMAT/TRIM/CAST/AS/CHAR 外的危险函数）
  if (/\b(DROP|INSERT|UPDATE|DELETE|EXEC|EXECUTE|INTO|UNION|SELECT|ALTER|CREATE|GRANT)\b/i.test(exprSql)) {
    throw new Error(`listingProgressKeywordBlob: 表达式包含禁止的 SQL 关键字`);
  }
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

  const kwRaw = String(req.query.keyword || '').trim();
  const kw = kwRaw.length > 200 ? kwRaw.slice(0, 200) : kwRaw;
  if (kw) {
    const like = `%${kw}%`;
    // #16: 所有 exprSql 均为硬编码列引用，此处做运行时白名单校验
    const exprList = [
      `IFNULL(DATE_FORMAT(ipp.f_update_time, '%Y-%m-%d'), '')`,
      `IFNULL(DATE_FORMAT(ipp.f_update_time, '%H:%i:%s'), '')`,
      `IFNULL(ipp.exchange, '')`,
      `IFNULL(ipp.board, '')`,
      `IFNULL(ipp.status, '')`,
      `IFNULL(ipp.fund, '')`,
      `IFNULL(ipp.sub, '')`,
      `IFNULL(ipp.project_name, '')`,
      `IFNULL(ipp.company, '')`,
      `IFNULL(TRIM(CAST(ipp.inv_amount AS CHAR)), '')`,
      `IFNULL(TRIM(CAST(ipp.residual_amount AS CHAR)), '')`,
      `IFNULL(TRIM(CAST(ipp.ratio AS CHAR)), '')`,
      `IFNULL(TRIM(CAST(ipp.ratio * 100 AS CHAR)), '')`,
      `IFNULL(TRIM(CAST(ipp.ct_amount AS CHAR)), '')`,
      `IFNULL(TRIM(CAST(ipp.ct_residual AS CHAR)), '')`,
    ];
    exprList.forEach(assertSafeExprSql);
    where.push(`(
      CONCAT_WS(' ',
        ${exprList.map(e => listingProgressKeywordBlob(e)).join(',\n        ')}
      ) LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
    )`);
    params.push(like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

async function listIpoProjectProgress(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROJECT_PROGRESS))) return forbidden(res);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 15));

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
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROJECT_PROGRESS))) return forbidden(res);

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
    // 真正的软删除（原代码误用 DELETE FROM 导致硬删除）
    await db.execute(
      `UPDATE ipo_project_progress SET delete_mark = 1, delete_time = NOW(), delete_user_id = ? WHERE f_id = ?`,
      [user.id, fId]
    );
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
