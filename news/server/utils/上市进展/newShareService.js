const db = require('../../db');
const { createShanghaiDate, formatDateOnly } = require('./listingBeijingDate');
const { runNewShareAkSync } = require('./newShareAkSync');
const { runNewShareMetricsSyncWithFallback } = require('./newShareMetricsSync');

function weekdayZh(ymd) {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return null;
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return names[d.getDay()] || null;
}

/** MySQL DATE / DATETIME / 'YYYY-MM-DD' → 日历日 YYYY-MM-DD（与抓取侧一致） */
function toYmdDb(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    const s = v.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    try {
      return formatDateOnly(v);
    } catch {
      return '';
    }
  }
  return '';
}

function isProvidedOptionalString(v) {
  if (v === undefined || v === null) return false;
  return String(v).trim() !== '';
}

function isProvidedNumber(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return Number.isFinite(Number(v));
}

function numClose(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) && !Number.isFinite(nb)) return true;
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) < 1e-6;
}

function pickFiniteNumberOrNull(rowVal, oldVal) {
  if (!isProvidedNumber(rowVal)) {
    const o = Number(oldVal);
    return Number.isFinite(o) ? o : null;
  }
  const n = Number(rowVal);
  return Number.isFinite(n) ? n : null;
}

function pickPositiveOrNullFromRow(rowVal, oldVal) {
  if (rowVal === undefined || rowVal === null || (typeof rowVal === 'string' && rowVal.trim() === '')) {
    return normalizePositiveOrNull(oldVal);
  }
  const fromRow = normalizePositiveOrNull(rowVal);
  if (fromRow !== null) return fromRow;
  return normalizePositiveOrNull(oldVal);
}

async function upsertNewShareRow(row) {
  const rowIssueSlice = String(row.issue_date || '').slice(0, 10);
  const existing = await db.query(
    `SELECT id, stock_name, issue_date, issue_weekday, issue_price, offer_pe, limit_shares, total_issued_shares,
            public_date, win_rate, first_day_close, first_day_chg_pct, first_day_market_cap
     FROM ipo_new_share
     WHERE stock_code = ? AND exchange = ?
     LIMIT 1`,
    [row.stock_code, row.exchange]
  );

  if (!existing.length) {
    const issueDate = isYmd(rowIssueSlice) ? rowIssueSlice : '';
    const issueWeekday = weekdayZh(issueDate);
    await db.execute(
      `INSERT INTO ipo_new_share
      (stock_code, stock_name, issue_date, issue_weekday, issue_price, offer_pe, limit_shares, total_issued_shares, exchange, public_date, win_rate,
       first_day_close, first_day_chg_pct, first_day_market_cap)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.stock_code,
        row.stock_name,
        issueDate,
        issueWeekday,
        row.issue_price ?? null,
        row.offer_pe ?? null,
        row.limit_shares ?? null,
        row.total_issued_shares ?? null,
        row.exchange,
        row.public_date || null,
        row.win_rate ?? null,
        row.first_day_close ?? null,
        row.first_day_chg_pct ?? null,
        row.first_day_market_cap ?? null,
      ]
    );
    return 'inserted';
  }

  const old = existing[0];
  const oldIssueYmd = toYmdDb(old.issue_date);
  const issueDate = isYmd(rowIssueSlice) ? rowIssueSlice : oldIssueYmd;
  const issueWeekday = weekdayZh(issueDate);

  const nextStockName = isProvidedOptionalString(row.stock_name)
    ? String(row.stock_name).trim()
    : String(old.stock_name || '');

  const nextIssuePrice = pickFiniteNumberOrNull(row.issue_price, old.issue_price);
  const nextOfferPe = pickFiniteNumberOrNull(row.offer_pe, old.offer_pe);
  const nextLimitShares = pickFiniteNumberOrNull(row.limit_shares, old.limit_shares);
  const nextTotalIssuedShares = pickPositiveOrNullFromRow(row.total_issued_shares, old.total_issued_shares);

  const rowPubSlice = String(row.public_date || '').trim().slice(0, 10);
  const nextPublicDate = isYmd(rowPubSlice) ? rowPubSlice : toYmdDb(old.public_date) || null;

  const nextWinRate = pickFiniteNumberOrNull(row.win_rate, old.win_rate);

  const nextFirstDayClose = pickPositiveOrNullFromRow(row.first_day_close, old.first_day_close);
  const nextFirstDayChgPct =
    row.first_day_chg_pct === undefined || row.first_day_chg_pct === null || (typeof row.first_day_chg_pct === 'string' && row.first_day_chg_pct.trim() === '')
      ? (old.first_day_chg_pct != null && old.first_day_chg_pct !== '' ? Number(old.first_day_chg_pct) : null)
      : Number(row.first_day_chg_pct);
  const nextFirstDayMarketCap = pickPositiveOrNullFromRow(row.first_day_market_cap, old.first_day_market_cap);

  const changed =
    String(old.stock_name || '') !== nextStockName ||
    toYmdDb(old.issue_date) !== issueDate ||
    String(old.issue_weekday || '') !== String(issueWeekday || '') ||
    !numClose(old.issue_price, nextIssuePrice) ||
    !numClose(old.offer_pe, nextOfferPe) ||
    !numClose(old.limit_shares, nextLimitShares) ||
    !numClose(old.total_issued_shares, nextTotalIssuedShares) ||
    toYmdDb(old.public_date) !== (nextPublicDate || '') ||
    !numClose(old.win_rate, nextWinRate) ||
    !numClose(old.first_day_close, nextFirstDayClose) ||
    !numClose(old.first_day_chg_pct, nextFirstDayChgPct) ||
    !numClose(old.first_day_market_cap, nextFirstDayMarketCap);

  if (!changed) return 'skipped';

  await db.execute(
    `UPDATE ipo_new_share
      SET stock_name = ?, issue_date = ?, issue_weekday = ?, issue_price = ?, offer_pe = ?,
          limit_shares = ?, total_issued_shares = ?, public_date = ?, win_rate = ?,
          first_day_close = ?, first_day_chg_pct = ?, first_day_market_cap = ?
      WHERE id = ?`,
    [
      nextStockName,
      issueDate,
      issueWeekday,
      nextIssuePrice,
      nextOfferPe,
      nextLimitShares,
      nextTotalIssuedShares,
      nextPublicDate,
      nextWinRate,
      nextFirstDayClose,
      Number.isFinite(nextFirstDayChgPct) ? nextFirstDayChgPct : null,
      nextFirstDayMarketCap,
      old.id,
    ]
  );
  return 'updated';
}

function isYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10));
}

function calcFirstDayMarketCap(close, totalIssuedShares) {
  const c = Number(close);
  const ts = Number(totalIssuedShares);
  if (!Number.isFinite(c) || !Number.isFinite(ts)) return null;
  if (c <= 0 || ts <= 0) return null;
  return Math.round(c * ts * 100) / 100;
}

function normalizePositiveOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function runWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const c = Math.max(1, Math.min(32, Number(concurrency || 1)));
  const results = new Array(list.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(c, list.length || 1) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= list.length) break;
      results[i] = await worker(list[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function refreshNewShareDailyMetrics(rows, logTag) {
  const todayYmd = formatDateOnly(createShanghaiDate());
  const lookbackDays = Math.max(30, Math.min(3650, Number(process.env.NEW_SHARE_METRICS_LOOKBACK_DAYS || 3650)));
  const recentListedRows = await db.query(
    `SELECT stock_code, stock_name, exchange, DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
            DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date, issue_weekday, issue_price, offer_pe, limit_shares, win_rate, total_issued_shares,
            first_day_close, first_day_chg_pct, first_day_market_cap
     FROM ipo_new_share
     WHERE public_date IS NOT NULL
       AND public_date <= CURDATE()
       AND public_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND (
         first_day_close IS NULL OR first_day_close <= 0
         OR first_day_chg_pct IS NULL
         OR first_day_market_cap IS NULL OR first_day_market_cap <= 0
         OR total_issued_shares IS NULL OR total_issued_shares <= 0
       )
     ORDER BY public_date DESC
     LIMIT 5000`
    ,
    [lookbackDays]
  );
  const uniq = new Map();
  [...rows, ...recentListedRows].forEach((r) => {
    const key = `${r.stock_code}|${r.exchange || ''}`;
    if (!uniq.has(key)) uniq.set(key, r);
  });
  const candidates = Array.from(uniq.values());
  console.log(`${logTag} 首日指标候选 total=${candidates.length} fetchedRows=${rows.length} dbMissing=${recentListedRows.length}`);
  let refreshed = 0;
  let refreshedUpdated = 0;
  let failed = 0;
  let skippedNoListDate = 0;
  const failedItems = [];
  const refreshedItems = [];
  const metricsConcurrency = Math.max(1, Math.min(32, Number(process.env.NEW_SHARE_METRICS_CONCURRENCY || 8)));
  const taskResults = await runWithConcurrency(candidates, metricsConcurrency, async (row) => {
    const listDate = String(row.public_date || '').slice(0, 10);
    if (!isYmd(listDate) || listDate > todayYmd) {
      return { status: 'skipped', row, listDate };
    }
    const market = row.exchange === '港交所' ? 'hk' : 'a';
    const fetched = await runNewShareMetricsSyncWithFallback({
      stockCode: row.stock_code,
      listDate,
      market,
      logTag: `${logTag}[${row.stock_code}][首日指标]`,
    });
    if (!fetched.ok || !fetched.firstRow) {
      const failMsg = String(fetched.stderr || 'firstRow missing').slice(0, 500);
      const failedItem = {
        stockCode: row.stock_code,
        exchange: row.exchange || '',
        listDate,
        reason: failMsg,
      };
      console.warn(
        `${logTag} 首日指标抓取失败 stock=${row.stock_code} exchange=${row.exchange || ''} listDate=${listDate} reason=${failMsg}`
      );
      return { status: 'failed', row, listDate, failedItem };
    }
    const first = fetched.firstRow || {};
    const totalIssuedShares =
      row.total_issued_shares != null && Number.isFinite(Number(row.total_issued_shares)) && Number(row.total_issued_shares) > 0
        ? Number(row.total_issued_shares)
        : fetched.totalShares != null && Number.isFinite(Number(fetched.totalShares))
          ? Number(fetched.totalShares)
          : null;
    const close = first.close != null && Number.isFinite(Number(first.close)) ? Number(first.close) : null;
    const chgPct = first.chg_pct != null && Number.isFinite(Number(first.chg_pct)) ? Number(first.chg_pct) : null;
    const fetchedIssuePrice =
      fetched.issuePrice != null && Number.isFinite(Number(fetched.issuePrice)) ? Number(fetched.issuePrice) : null;
    const fetchedWinRate = fetched.winRate != null && Number.isFinite(Number(fetched.winRate)) ? Number(fetched.winRate) : null;
    const marketCap = calcFirstDayMarketCap(close, totalIssuedShares);

    const result = await upsertNewShareRow({
      ...row,
      issue_price:
        row.issue_price != null && Number.isFinite(Number(row.issue_price)) && Number(row.issue_price) > 0
          ? Number(row.issue_price)
          : fetchedIssuePrice,
      win_rate:
        row.win_rate != null && Number.isFinite(Number(row.win_rate)) && Number(row.win_rate) > 0
          ? Number(row.win_rate)
          : fetchedWinRate,
      total_issued_shares: normalizePositiveOrNull(totalIssuedShares ?? row.total_issued_shares ?? null),
      first_day_close: normalizePositiveOrNull(close),
      first_day_chg_pct: chgPct,
      first_day_market_cap: normalizePositiveOrNull(marketCap),
    });
    const refreshedItem = {
      stockCode: row.stock_code,
      exchange: row.exchange || '',
      listDate,
      tradeDate: first.trade_date || null,
      close: close ?? null,
      chgPct: chgPct ?? null,
      totalIssuedShares: totalIssuedShares ?? null,
      marketCap: marketCap ?? null,
      source: fetched.source || null,
      state: result,
    };
    console.log(
      `${logTag} 首日指标抓取成功 stock=${row.stock_code} exchange=${row.exchange || ''} listDate=${listDate} tradeDate=${
        first.trade_date || '-'
      } close=${close ?? 'null'} chgPct=${chgPct ?? 'null'} totalShares=${totalIssuedShares ?? 'null'} marketCap=${
        marketCap ?? 'null'
      } issuePrice=${fetchedIssuePrice ?? 'null'} winRate=${fetchedWinRate ?? 'null'} source=${fetched.source || '-'} state=${result}`
    );
    return { status: 'refreshed', result, refreshedItem };
  });

  for (const tr of taskResults) {
    if (!tr) continue;
    if (tr.status === 'skipped') {
      skippedNoListDate += 1;
      continue;
    }
    if (tr.status === 'failed') {
      failed += 1;
      if (tr.failedItem) failedItems.push(tr.failedItem);
      continue;
    }
    if (tr.status === 'refreshed') {
      refreshed += 1;
      if (tr.refreshedItem) refreshedItems.push(tr.refreshedItem);
      if (tr.result === 'updated') refreshedUpdated += 1;
    }
  }

  if (refreshedItems.length) {
    console.log(`${logTag} 首日指标抓取明细`, refreshedItems);
  }
  if (failedItems.length) {
    console.warn(`${logTag} 首日指标失败明细`, failedItems);
  }
  console.log(`${logTag} 首日指标补抓完成 refreshed=${refreshed} updated=${refreshedUpdated} failed=${failed} skipped=${skippedNoListDate}`);
  return { refreshed, refreshedUpdated, failed, candidates: candidates.length, skippedNoListDate };
}

async function syncNewShareCalendar(options = {}) {
  const now = createShanghaiDate();
  const from = options.from || formatDateOnly(now);
  const to = options.to || formatDateOnly(now);
  const triggerType = options.triggerType || 'manual';
  const logTag = options.logTag || '[打新日历同步]';
  const issueAfter = String(options.issueDateAfterExclusive || '').trim().slice(0, 10) || null;
  const updateAfter = String(options.updateDateAfterExclusive || '').trim().slice(0, 10) || null;
  const listingDateLookbackDays =
    Math.max(0, Number(options.listingDateLookbackDays || process.env.NEW_SHARE_LISTING_DATE_LOOKBACK_DAYS || 14));
  const hkRecentDays =
    triggerType === 'scheduled' && !issueAfter ? 7 : 0;

  console.log(
    `${logTag} 执行开始 from=${from} to=${to} trigger=${triggerType}` +
      (issueAfter ? ` issueDate>${issueAfter}` : '') +
      (updateAfter ? ` upDate>=${updateAfter}` : '') +
      (issueAfter ? ` listingDateLookbackDays=${listingDateLookbackDays}` : '')
  );
  const fetched = runNewShareAkSync({
    startDate: from,
    endDate: to,
    hkRecentDays,
    issueDateAfterExclusive: issueAfter,
    updateDateAfterExclusive: updateAfter,
    listingDateLookbackDays: issueAfter ? listingDateLookbackDays : 0,
    logTag,
  });
  if (!fetched.ok) {
    throw new Error(fetched.stderr || '打新日历抓取失败');
  }
  const rows = fetched.rows || [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const state = await upsertNewShareRow(row);
    if (state === 'inserted') inserted += 1;
    else if (state === 'updated') updated += 1;
    else skipped += 1;
  }
  const refreshResult = await refreshNewShareDailyMetrics(rows, logTag);
  const result = {
    from,
    to,
    triggerType,
    fetched: rows.length,
    inserted,
    updated,
    skipped,
    sourceRows: Number((fetched.summary && fetched.summary.sourceRows) || 0),
    dailyMetricsRefreshed: refreshResult.refreshed,
    dailyMetricsUpdated: refreshResult.refreshedUpdated,
    dailyMetricsFailed: Number(refreshResult.failed || 0),
    dailyMetricsCandidates: Number(refreshResult.candidates || 0),
    message: '打新日历同步完成',
    executedAt: new Date().toISOString(),
  };
  console.log(`${logTag} 执行完成`, result);
  return result;
}

module.exports = {
  syncNewShareCalendar,
};

