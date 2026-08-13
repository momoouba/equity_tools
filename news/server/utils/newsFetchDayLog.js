/**
 * 新闻抓取日账本：记录「接口 × 类型 × 账号 × 业务日」是否已抓到数据，
 * 用于新榜企业公众号 / 上海国际全接口按日跳过，避免重复计费与重叠日重抓。
 *
 * 规则：
 * - has_data：永不再抓
 * - empty：允许在后续窗口再试 1 次（empty_retry_count < 1）
 * - failed：必重试
 */
const db = require('../db');
const { generateId } = require('./idGenerator');

function formatBeijingYmd(date = new Date()) {
  const s = date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const part = s.split(' ')[0];
  const [y, m, d] = part.split(/[\/\-]/).map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}

/** 日历日星期几（0=周日），按 YYYY-MM-DD 民用日计算，避免时区偏移 */
function ymdDayOfWeek(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function eachYmdInclusive(startYmd, endYmd) {
  const out = [];
  if (!startYmd || !endYmd || startYmd > endYmd) return out;
  for (let cur = startYmd; cur <= endYmd; cur = addDaysYmd(cur, 1)) {
    out.push(cur);
  }
  return out;
}

async function isWorkdayYmd(ymd) {
  try {
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND F_DeleteMark = 0 LIMIT 1',
      [ymd]
    );
    if (rows.length > 0) return rows[0].is_workday === 1;
  } catch (_) {
    /* ignore */
  }
  const day = ymdDayOfWeek(ymd);
  return day !== 0 && day !== 6;
}

async function findPreviousWorkdayYmd(ymd) {
  let cur = addDaysYmd(ymd, -1);
  for (let i = 0; i < 60; i++) {
    if (await isWorkdayYmd(cur)) return cur;
    cur = addDaysYmd(cur, -1);
  }
  return addDaysYmd(ymd, -1);
}

/**
 * 解析本次同步应覆盖的业务日列表（北京日历）。
 * - 周一：周五～周日
 * - 周二～周五：前天+昨天
 * - 并与「上个工作日次日～昨天」取并集（节后拉长）
 * - 手动 customRange：使用 from～to 的日期部分
 */
async function resolveSyncBizDates({ runDate = new Date(), customRange = null } = {}) {
  if (customRange && customRange.from && customRange.to) {
    const startStr = String(customRange.from).trim().split(' ')[0];
    const endStr = String(customRange.to).trim().split(' ')[0];
    return eachYmdInclusive(startStr, endStr);
  }

  const todayYmd = formatBeijingYmd(runDate);
  const yesterdayYmd = addDaysYmd(todayYmd, -1);
  const dayOfWeek = ymdDayOfWeek(todayYmd); // 0=Sun ... 1=Mon

  const set = new Set();

  if (dayOfWeek === 1) {
    // 周一：周五～周日
    set.add(addDaysYmd(todayYmd, -3));
    set.add(addDaysYmd(todayYmd, -2));
    set.add(addDaysYmd(todayYmd, -1));
  } else {
    // 周二～周五（及其他工作日）：前天 + 昨天
    set.add(addDaysYmd(todayYmd, -2));
    set.add(yesterdayYmd);
  }

  // 节后拉长：上个工作日次日～昨天
  const prevWd = await findPreviousWorkdayYmd(todayYmd);
  const stretchStart = addDaysYmd(prevWd, 1);
  for (const d of eachYmdInclusive(stretchStart, yesterdayYmd)) {
    set.add(d);
  }

  return [...set].filter((d) => d <= yesterdayYmd).sort();
}

function dayRangeFromTo(bizDateYmd) {
  return {
    from: `${bizDateYmd} 00:00:00`,
    to: `${bizDateYmd} 23:59:59`,
    bizDate: bizDateYmd
  };
}

async function getFetchDayRow({ interfaceType, newsType, accountKey, bizDate }) {
  const rows = await db.query(
    `SELECT F_Id, status, empty_retry_count, item_count
     FROM news_fetch_day_log
     WHERE interface_type = ? AND news_type = ? AND account_key = ? AND biz_date = ?
     LIMIT 1`,
    [interfaceType, newsType || '新闻舆情', accountKey, bizDate]
  );
  return rows[0] || null;
}

/**
 * @returns {Promise<{ fetch: boolean, reason: string, row?: object }>}
 */
async function shouldFetchAccountBizDay({ interfaceType, newsType, accountKey, bizDate }) {
  const row = await getFetchDayRow({ interfaceType, newsType, accountKey, bizDate });
  if (!row) return { fetch: true, reason: 'no_record' };
  if (row.status === 'has_data') return { fetch: false, reason: 'has_data', row };
  if (row.status === 'failed') return { fetch: true, reason: 'failed_retry', row };
  if (row.status === 'empty') {
    const retries = Number(row.empty_retry_count || 0);
    if (retries < 1) return { fetch: true, reason: 'empty_retry_once', row };
    return { fetch: false, reason: 'empty_exhausted', row };
  }
  return { fetch: true, reason: 'unknown_status', row };
}

async function upsertFetchDayResult({
  interfaceType,
  newsType,
  accountKey,
  bizDate,
  status,
  itemCount = 0,
  configId = null,
  lastError = null,
  previousRow = null
}) {
  const nt = newsType || '新闻舆情';
  let emptyRetryCount = 0;
  if (status === 'empty') {
    const prev = previousRow || (await getFetchDayRow({ interfaceType, newsType: nt, accountKey, bizDate }));
    if (prev && prev.status === 'empty') {
      emptyRetryCount = Number(prev.empty_retry_count || 0) + 1;
    } else {
      emptyRetryCount = 0;
    }
  }

  const existing = previousRow || (await getFetchDayRow({ interfaceType, newsType: nt, accountKey, bizDate }));
  if (existing) {
    await db.execute(
      `UPDATE news_fetch_day_log
       SET status = ?, empty_retry_count = ?, item_count = ?, config_id = ?, last_error = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [status, emptyRetryCount, itemCount, configId, lastError ? String(lastError).slice(0, 500) : null, existing.F_Id]
    );
    return existing.F_Id;
  }

  const id = await generateId('news_fetch_day_log');
  await db.execute(
    `INSERT INTO news_fetch_day_log
     (F_Id, interface_type, news_type, account_key, biz_date, status, empty_retry_count, item_count, config_id, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      interfaceType,
      nt,
      accountKey,
      bizDate,
      status,
      emptyRetryCount,
      itemCount,
      configId,
      lastError ? String(lastError).slice(0, 500) : null
    ]
  );
  return id;
}

module.exports = {
  formatBeijingYmd,
  addDaysYmd,
  eachYmdInclusive,
  isWorkdayYmd,
  findPreviousWorkdayYmd,
  resolveSyncBizDates,
  dayRangeFromTo,
  shouldFetchAccountBizDay,
  upsertFetchDayResult,
  getFetchDayRow
};
