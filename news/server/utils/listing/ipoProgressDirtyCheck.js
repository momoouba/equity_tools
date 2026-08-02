/**
 * 活跃项目列表状态脏检查（P2 / §1.4.5）
 */

const db = require('../../db');
const { isWatchlistStatus, isTerminalStatus } = require('./ipoProgressWatchlist');
const {
  enrichSingleExchangeRowDetail,
  toYmdLoose,
  mapRowExchangeProjectId,
  isStatusLikelySame,
  pruneMismatchedTimelineRows,
  findTimelineDateForStatus,
} = require('./listingExchangeCrawler');
const { enqueueRecheck, confirmIpoProgressRow } = require('./ipoProgressRecheck');

const DEFAULT_QUOTA_PER_EXCHANGE = 50;

async function loadDirtyCheckCandidates(exchange, limit) {
  return db.query(
    `SELECT * FROM ipo_progress
     WHERE F_DeleteMark = 0
       AND exchange = ?
       AND exchange_project_id IS NOT NULL
       AND exchange_project_id <> ''
     ORDER BY CASE WHEN timeline_confirmed = 0 THEN 0 ELSE 1 END, F_UpdateTime DESC
     LIMIT ?`,
    [exchange, limit * 3]
  );
}

function rowNeedsDetail(dbRow) {
  if (Number(dbRow.timeline_confirmed) === 0) return true;
  return isWatchlistStatus(dbRow.status);
}

async function reconcileRowFromDetail(dbRow, crawlRow, adminId, logTag) {
  const hit = findTimelineDateForStatus(crawlRow._timeline_rows, dbRow.status);
  if (hit?.ymd) {
    await confirmIpoProgressRow({
      rowId: dbRow.F_Id,
      receiveDateYmd: hit.ymd,
      adminId,
      logTag,
      triggerMatch: true,
    });
    return { action: 'confirmed' };
  }
  await enqueueRecheck({
    exchange: dbRow.exchange,
    projectKey: dbRow.exchange_project_id,
    company: dbRow.company,
    board: dbRow.board,
    listStatus: dbRow.status,
    listUpdateYmd: toYmdLoose(dbRow.F_UpdateTime),
    reason: 'status_dirty',
  });
  return { action: 'enqueued' };
}

async function processIpoProgressDirtyCheck({
  adminId,
  logTag = '[上市进展脏检查]',
  quotaPerExchange = DEFAULT_QUOTA_PER_EXCHANGE,
} = {}) {
  if (!adminId) {
    const adminRows = await db.query(`SELECT F_Id AS id FROM users WHERE account = 'admin' LIMIT 1`);
    adminId = adminRows[0]?.id;
  }
  if (!adminId) throw new Error('未找到 admin 用户');

  const quota = Math.max(1, Math.min(200, Number(quotaPerExchange) || DEFAULT_QUOTA_PER_EXCHANGE));
  const exchanges = ['深交所', '上交所', '北交所'];
  let checked = 0;
  let confirmed = 0;
  let enqueued = 0;

  for (const exchange of exchanges) {
    const candidates = await loadDirtyCheckCandidates(exchange, quota);
    const watchlist = candidates.filter(
      (r) => isWatchlistStatus(r.status) && !isTerminalStatus(r.status)
    );
    let processed = 0;

    for (const dbRow of watchlist) {
      if (processed >= quota) break;
      if (!dbRow.exchange_project_id || !rowNeedsDetail(dbRow)) continue;

      processed += 1;
      checked += 1;

      const crawlRow = {
        exchange: dbRow.exchange,
        company: dbRow.company,
        board: dbRow.board,
        status: dbRow.status,
        f_update_time: dbRow.F_UpdateTime,
        _szse_prjid: exchange === '深交所' ? dbRow.exchange_project_id : '',
        _sse_audit_id: exchange === '上交所' ? dbRow.exchange_project_id : '',
        _bse_id: exchange === '北交所' ? dbRow.exchange_project_id : '',
      };
      mapRowExchangeProjectId(crawlRow);

      try {
        const detailResult = await enrichSingleExchangeRowDetail(crawlRow, logTag);
        if (!detailResult.ok) {
          await enqueueRecheck({
            exchange,
            projectKey: dbRow.exchange_project_id,
            company: dbRow.company,
            board: dbRow.board,
            listStatus: dbRow.status,
            listUpdateYmd: toYmdLoose(dbRow.F_UpdateTime),
            reason: 'status_dirty',
          });
          enqueued += 1;
          continue;
        }

        await pruneMismatchedTimelineRows([crawlRow], adminId, logTag);
        const result = await reconcileRowFromDetail(dbRow, crawlRow, adminId, logTag);
        if (result.action === 'confirmed') confirmed += 1;
        else enqueued += 1;
      } catch (e) {
        console.warn(`${logTag} 单行异常 company=${dbRow.company}: ${e.message}`);
        try {
          await enqueueRecheck({
            exchange,
            projectKey: dbRow.exchange_project_id,
            company: dbRow.company,
            board: dbRow.board,
            listStatus: dbRow.status,
            listUpdateYmd: toYmdLoose(dbRow.F_UpdateTime),
            reason: 'status_dirty',
          });
          enqueued += 1;
        } catch (e2) {
          console.warn(`${logTag} 入队失败: ${e2.message}`);
        }
      }
    }
  }

  console.log(`${logTag} 完成 checked=${checked} confirmed=${confirmed} enqueued=${enqueued}`);
  return { checked, confirmed, enqueued };
}

module.exports = { processIpoProgressDirtyCheck, DEFAULT_QUOTA_PER_EXCHANGE };
