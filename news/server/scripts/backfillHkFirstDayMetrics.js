#!/usr/bin/env node
/**
 * 补抓港交所 ipo_new_share 缺失的首日收盘价/涨幅（修复 normalizePositiveOrNull 误过滤 0 与负涨幅后的历史数据）。
 */
const db = require('../db');
const { runNewShareMetricsSyncWithFallback } = require('../utils/listing/newShareMetricsSync');
const { warmEtnetHkIpoInfoCache, wasEtnetWarmRecentlyFailed } = require('../utils/listing/etnetHkIpoInfoMetrics');

function normalizePositiveOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeChgPctOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function computeFirstDayChgPctFromPrices(close, issuePrice) {
  const c = Number(close);
  const p = Number(issuePrice);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return Math.round(((c - p) / p) * 10000) / 100;
}

function calcFirstDayMarketCap(close, totalIssuedShares) {
  const c = Number(close);
  const ts = Number(totalIssuedShares);
  if (!Number.isFinite(c) || !Number.isFinite(ts) || c <= 0 || ts <= 0) return null;
  return Math.round(c * ts * 100) / 100;
}

async function main() {
  const logTag = '[港交所首日指标补抓]';
  const rows = await db.query(`
    SELECT stock_code, stock_name, exchange,
           DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
           issue_price, win_rate, total_issued_shares,
           first_day_close, first_day_chg_pct
    FROM ipo_new_share
    WHERE exchange = '港交所'
      AND public_date IS NOT NULL
      AND public_date <= CURDATE()
      AND (
        first_day_close IS NULL OR first_day_close <= 0
        OR first_day_chg_pct IS NULL
      )
    ORDER BY public_date DESC
    LIMIT 200
  `);
  if (!rows.length) {
    console.log(`${logTag} 无待补抓记录`);
    return;
  }
  console.log(`${logTag} 待补抓 ${rows.length} 条`);
  let skipEtnetFullWarm = false;
  try {
    await warmEtnetHkIpoInfoCache({ logTag });
  } catch (e) {
    skipEtnetFullWarm = true;
    console.warn(`${logTag} 经济通预热失败，改走近期页: ${String(e?.message || e)}`);
  }
  skipEtnetFullWarm = skipEtnetFullWarm || wasEtnetWarmRecentlyFailed();

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const listDate = String(row.public_date || '').slice(0, 10);
    try {
      const fetched = await runNewShareMetricsSyncWithFallback({
        stockCode: row.stock_code,
        listDate,
        market: 'hk',
        logTag: `${logTag}[${row.stock_code}]`,
        skipEtnet: skipEtnetFullWarm,
      });
      if (!fetched.ok || !fetched.firstRow) {
        failed += 1;
        console.warn(`${logTag} 失败 ${row.stock_code} ${listDate}: ${fetched.stderr || 'no firstRow'}`);
        continue;
      }
      const first = fetched.firstRow;
      const close = first.close != null && Number.isFinite(Number(first.close)) ? Number(first.close) : null;
      let chgPct = first.chg_pct != null && Number.isFinite(Number(first.chg_pct)) ? Number(first.chg_pct) : null;
      const issuePx =
        fetched.issuePrice != null && Number.isFinite(Number(fetched.issuePrice))
          ? Number(fetched.issuePrice)
          : row.issue_price != null && Number.isFinite(Number(row.issue_price))
            ? Number(row.issue_price)
            : null;
      if (chgPct == null && close != null) {
        chgPct = computeFirstDayChgPctFromPrices(close, issuePx);
      }
      const totalShares =
        row.total_issued_shares != null && Number(row.total_issued_shares) > 0
          ? Number(row.total_issued_shares)
          : null;
      const nextClose = normalizePositiveOrNull(close) ?? row.first_day_close;
      const nextChg = normalizeChgPctOrNull(chgPct) ?? row.first_day_chg_pct;
      const nextCap = calcFirstDayMarketCap(nextClose, totalShares);
      const nextWin =
        row.win_rate != null && Number(row.win_rate) > 0
          ? Number(row.win_rate)
          : fetched.winRate != null && Number.isFinite(Number(fetched.winRate))
            ? Number(fetched.winRate)
            : row.win_rate;
      const nextIssue =
        row.issue_price != null && Number(row.issue_price) > 0 ? Number(row.issue_price) : issuePx;

      await db.execute(
        `UPDATE ipo_new_share
         SET first_day_close = ?, first_day_chg_pct = ?, first_day_market_cap = COALESCE(?, first_day_market_cap),
             win_rate = COALESCE(?, win_rate),
             issue_price = COALESCE(?, issue_price)
         WHERE stock_code = ? AND exchange = '港交所'`,
        [nextClose, nextChg, nextCap, nextWin, nextIssue, row.stock_code]
      );
      updated += 1;
      console.log(
        `${logTag} 已更新 ${row.stock_code} ${row.stock_name} close=${nextClose} chgPct=${nextChg} source=${fetched.source || '-'}`
      );
    } catch (e) {
      failed += 1;
      console.warn(`${logTag} 异常 ${row.stock_code}: ${String(e?.message || e)}`);
    }
  }
  console.log(`${logTag} 完成 updated=${updated} failed=${failed} total=${rows.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
