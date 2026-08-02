/**
 * 交易所 IPO 详情待复核队列（§1.4.2 / P1）
 */

const db = require('../../db');
const {
  isWatchlistStatus,
  isTerminalStatus,
  defaultMaxAttempts,
} = require('./ipoProgressWatchlist');
const {
  enrichSingleExchangeRowDetail,
  toYmdLoose,
  mapRowExchangeProjectId,
  findTimelineDateForStatus,
} = require('./listingExchangeCrawler');
const { matchSingleIpoProgressRow } = require('./listingMatchRunner');

function computeNextRecheckAt(attempts) {
  const base = new Date();
  // 首次入队立刻可跑（同轮爬虫末尾 process 能吃到）；失败后再退避 1~3 天
  if (Number(attempts) <= 0) return base;
  const days = Math.min(3, Math.max(1, Number(attempts) || 1));
  base.setDate(base.getDate() + days);
  return base;
}

function normalizeListUpdateYmd(v) {
  const ymd = toYmdLoose(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function buildProjectKey(exchange, projectId, company, board) {
  const pid = String(projectId || '').trim();
  if (pid) return pid;
  return `${exchange}__${String(company || '').trim()}__${String(board || '').trim()}`;
}

async function enqueueRecheck({
  exchange,
  projectKey,
  company,
  board = '',
  listStatus,
  listUpdateYmd,
  reason,
  maxAttempts,
}) {
  const ex = String(exchange || '').trim();
  const key = String(projectKey || '').trim();
  if (!ex || !key) return { enqueued: false, reason: 'missing_exchange_or_key' };

  const max = Number(maxAttempts) || defaultMaxAttempts(ex);
  const nextAt = computeNextRecheckAt(0);
  const safeListYmd = normalizeListUpdateYmd(listUpdateYmd);

  const pending = await db.query(
    `SELECT F_Id, attempts, status FROM ipo_progress_recheck
     WHERE exchange = ? AND project_key = ? AND status = 'pending'
     LIMIT 1`,
    [ex, key]
  );

  if (pending.length) {
    await db.execute(
      `UPDATE ipo_progress_recheck SET
         company = ?, board = ?, list_status = ?, list_update_ymd = ?,
         reason = ?, max_attempts = ?, next_recheck_at = ?,
         F_UpdateTime = NOW()
       WHERE F_Id = ?`,
      [
        company || '',
        board || '',
        listStatus || '',
        safeListYmd,
        reason || 'timeline_missing_status_date',
        max,
        nextAt,
        pending[0].F_Id,
      ]
    );
    return { enqueued: true, updated: true, id: pending[0].F_Id };
  }

  const expired = await db.query(
    `SELECT F_Id FROM ipo_progress_recheck
     WHERE exchange = ? AND project_key = ? AND status IN ('expired', 'done')
     ORDER BY F_UpdateTime DESC LIMIT 1`,
    [ex, key]
  );
  if (expired.length) {
    await db.execute(
      `UPDATE ipo_progress_recheck SET
         company = ?, board = ?, list_status = ?, list_update_ymd = ?,
         reason = ?, attempts = 0, max_attempts = ?, next_recheck_at = ?,
         last_error = NULL, status = 'pending', F_UpdateTime = NOW()
       WHERE F_Id = ?`,
      [
        company || '',
        board || '',
        listStatus || '',
        safeListYmd,
        reason || 'timeline_missing_status_date',
        max,
        nextAt,
        expired[0].F_Id,
      ]
    );
    return { enqueued: true, revived: true, id: expired[0].F_Id };
  }

  await db.execute(
    `INSERT INTO ipo_progress_recheck (
       exchange, project_key, company, board, list_status, list_update_ymd,
       reason, attempts, max_attempts, next_recheck_at, status, F_CreatorTime, F_UpdateTime
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending', NOW(), NOW())`,
    [
      ex,
      key,
      company || '',
      board || '',
      listStatus || '',
      safeListYmd,
      reason || 'timeline_missing_status_date',
      max,
      nextAt,
    ]
  );
  return { enqueued: true, created: true };
}

async function markRecheckDone(recheckId) {
  await db.execute(
    `UPDATE ipo_progress_recheck SET status = 'done', last_error = NULL, F_UpdateTime = NOW() WHERE F_Id = ?`,
    [recheckId]
  );
  return { done: true, id: recheckId };
}

async function markRecheckExpired(recheckId, lastError) {
  await db.execute(
    `UPDATE ipo_progress_recheck SET status = 'expired', last_error = ?, F_UpdateTime = NOW() WHERE F_Id = ?`,
    [String(lastError || 'max_attempts').slice(0, 500), recheckId]
  );
  return { expired: true, id: recheckId };
}

async function confirmIpoProgressRow({
  rowId,
  receiveDateYmd,
  adminId,
  logTag = '[上市进展recheck]',
  triggerMatch = true,
}) {
  const now = new Date();
  await db.execute(
    `UPDATE ipo_progress SET
       receive_date = ?,
       timeline_confirmed = 1,
       timeline_confirmed_at = ?,
       F_LastModifyUserId = ?,
       F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [receiveDateYmd, now, adminId, rowId]
  );
  let matchResult = null;
  if (triggerMatch) {
    try {
      matchResult = await matchSingleIpoProgressRow(rowId);
    } catch (e) {
      console.warn(`${logTag} 即时匹配失败 rowId=${rowId}: ${e.message}`);
    }
  }
  return { confirmed: true, rowId, matchResult };
}

async function loadIpoProgressByProjectKey(exchange, projectKey, listStatus) {
  const rows = await db.query(
    `SELECT * FROM ipo_progress
     WHERE F_DeleteMark = 0
       AND exchange = ?
       AND exchange_project_id = ?
       AND status = ?
     ORDER BY F_UpdateTime DESC, F_Id DESC
     LIMIT 1`,
    [exchange, projectKey, listStatus]
  );
  return rows[0] || null;
}

async function processIpoProgressRecheck({ adminId, logTag = '[上市进展recheck]', limit = 80 } = {}) {
  if (!adminId) {
    const adminRows = await db.query(`SELECT F_Id AS id FROM users WHERE account = 'admin' LIMIT 1`);
    adminId = adminRows[0]?.id;
  }
  if (!adminId) throw new Error('未找到 admin 用户');

  const lim = Math.max(1, Math.min(500, Number(limit) || 80));
  const pending = await db.query(
    `SELECT * FROM ipo_progress_recheck
     WHERE status = 'pending' AND next_recheck_at <= NOW()
     ORDER BY next_recheck_at ASC, F_Id ASC
     LIMIT ?`,
    [lim]
  );

  let confirmed = 0;
  let failed = 0;
  let expired = 0;

  for (const item of pending) {
    const exchange = String(item.exchange || '').trim();
    const projectKey = String(item.project_key || '').trim();
    const listStatus = String(item.list_status || '').trim();

    const crawlRow = {
      exchange,
      company: item.company,
      board: item.board,
      status: listStatus,
      f_update_time: item.list_update_ymd ? `${item.list_update_ymd} 00:00:00` : null,
      _szse_prjid: exchange === '深交所' ? projectKey : '',
      _sse_audit_id: exchange === '上交所' ? projectKey : '',
      _bse_id: exchange === '北交所' ? projectKey : '',
    };
    mapRowExchangeProjectId(crawlRow);

    try {
      const detailResult = await enrichSingleExchangeRowDetail(crawlRow, logTag);
      if (!detailResult.ok) {
        const attempts = Number(item.attempts || 0) + 1;
        const maxAttempts = Number(item.max_attempts) || defaultMaxAttempts(exchange);
        if (attempts >= maxAttempts) {
          await markRecheckExpired(item.F_Id, detailResult.error || 'detail_failed');
          expired += 1;
        } else {
          await db.execute(
            `UPDATE ipo_progress_recheck SET
               attempts = ?, last_error = ?, next_recheck_at = ?, F_UpdateTime = NOW()
             WHERE F_Id = ?`,
            [
              attempts,
              String(detailResult.error || 'detail_failed').slice(0, 500),
              computeNextRecheckAt(attempts),
              item.F_Id,
            ]
          );
          failed += 1;
        }
        continue;
      }

      const hit = findTimelineDateForStatus(crawlRow._timeline_rows, listStatus);
      if (!hit?.ymd) {
        const attempts = Number(item.attempts || 0) + 1;
        const maxAttempts = Number(item.max_attempts) || defaultMaxAttempts(exchange);
        if (attempts >= maxAttempts) {
          await markRecheckExpired(item.F_Id, 'timeline_missing_status_date');
          expired += 1;
        } else {
          await db.execute(
            `UPDATE ipo_progress_recheck SET
               attempts = ?, last_error = ?, next_recheck_at = ?, F_UpdateTime = NOW()
             WHERE F_Id = ?`,
            [attempts, 'timeline_missing_status_date', computeNextRecheckAt(attempts), item.F_Id]
          );
          failed += 1;
        }
        continue;
      }

      let ipRow = await loadIpoProgressByProjectKey(exchange, projectKey, listStatus);
      if (!ipRow) {
        ipRow = (
          await db.query(
            `SELECT * FROM ipo_progress
             WHERE F_DeleteMark = 0 AND exchange = ? AND company = ? AND board = ? AND status = ?
             ORDER BY F_UpdateTime DESC LIMIT 1`,
            [exchange, item.company, item.board, listStatus]
          )
        )[0];
      }
      if (!ipRow) {
        await db.execute(
          `UPDATE ipo_progress_recheck SET attempts = attempts + 1, last_error = ?, F_UpdateTime = NOW() WHERE F_Id = ?`,
          ['ipo_progress_row_not_found', item.F_Id]
        );
        failed += 1;
        continue;
      }

      await confirmIpoProgressRow({
        rowId: ipRow.F_Id,
        receiveDateYmd: hit.ymd,
        adminId,
        logTag,
        triggerMatch: true,
      });
      await markRecheckDone(item.F_Id);
      confirmed += 1;
    } catch (e) {
      failed += 1;
      await db.execute(
        `UPDATE ipo_progress_recheck SET attempts = attempts + 1, last_error = ?, next_recheck_at = ?, F_UpdateTime = NOW() WHERE F_Id = ?`,
        [String(e.message || e).slice(0, 500), computeNextRecheckAt(Number(item.attempts || 0) + 1), item.F_Id]
      );
    }
  }

  console.log(`${logTag} 处理完成 pending=${pending.length} confirmed=${confirmed} failed=${failed} expired=${expired}`);
  return { processed: pending.length, confirmed, failed, expired };
}

async function getRecheckSummaryForProgressRow(rowId) {
  const rows = await db.query(
    `SELECT exchange_project_id, exchange, company, board FROM ipo_progress WHERE F_Id = ? LIMIT 1`,
    [rowId]
  );
  if (!rows.length) return null;
  const ip = rows[0];
  const projectKey =
    String(ip.exchange_project_id || '').trim() ||
    buildProjectKey(ip.exchange, '', ip.company, ip.board);
  const rechecks = await db.query(
    `SELECT reason, attempts, max_attempts,
            DATE_FORMAT(next_recheck_at, '%Y-%m-%d %H:%i:%s') AS next_recheck_at,
            last_error, status, list_status,
            DATE_FORMAT(list_update_ymd, '%Y-%m-%d') AS list_update_ymd
     FROM ipo_progress_recheck
     WHERE exchange = ? AND project_key = ?
     ORDER BY F_UpdateTime DESC LIMIT 3`,
    [ip.exchange, projectKey]
  );
  return { projectKey, rechecks };
}

async function runIpoProgressBackfill({ limit = 200, logTag = '[上市进展补齐]', adminId } = {}) {
  if (!adminId) {
    const adminRows = await db.query(`SELECT F_Id AS id FROM users WHERE account = 'admin' LIMIT 1`);
    adminId = adminRows[0]?.id;
  }
  if (!adminId) throw new Error('未找到 admin 用户');

  const lim = Math.max(1, Math.min(2000, Number(limit) || 200));
  const candidates = await db.query(
    `SELECT * FROM ipo_progress
     WHERE F_DeleteMark = 0
       AND exchange IN ('深交所', '上交所', '北交所')
       AND (timeline_confirmed = 0 OR exchange_project_id IS NULL OR exchange_project_id = '')
     ORDER BY F_UpdateTime DESC
     LIMIT ?`,
    [lim]
  );

  const watchlist = candidates.filter((r) => isWatchlistStatus(r.status) && !isTerminalStatus(r.status));
  let idFilled = 0;
  let confirmed = 0;
  let enqueued = 0;
  const idFailures = [];

  for (const row of watchlist) {
    const crawlRow = {
      exchange: row.exchange,
      company: row.company,
      board: row.board,
      status: row.status,
      f_update_time: row.F_UpdateTime,
      _szse_prjid: row.exchange === '深交所' ? row.exchange_project_id : '',
      _sse_audit_id: row.exchange === '上交所' ? row.exchange_project_id : '',
      _bse_id: row.exchange === '北交所' ? row.exchange_project_id : '',
    };
    mapRowExchangeProjectId(crawlRow);

    if (!crawlRow.exchange_project_id) {
      idFailures.push({ company: row.company, exchange: row.exchange, reason: 'missing_id' });
      continue;
    }

    if (!row.exchange_project_id) {
      await db.execute(
        `UPDATE ipo_progress SET exchange_project_id = ?, F_LastModifyTime = NOW() WHERE F_Id = ?`,
        [crawlRow.exchange_project_id, row.F_Id]
      );
      idFilled += 1;
    }

    if (Number(row.timeline_confirmed) === 1) continue;

    const detailResult = await enrichSingleExchangeRowDetail(crawlRow, logTag);
    if (!detailResult.ok) {
      await enqueueRecheck({
        exchange: row.exchange,
        projectKey: crawlRow.exchange_project_id,
        company: row.company,
        board: row.board,
        listStatus: row.status,
        listUpdateYmd: toYmdLoose(row.F_UpdateTime),
        reason: detailResult.error?.includes('parse') ? 'detail_parse_failed' : 'detail_http_failed',
      });
      enqueued += 1;
      continue;
    }

    const hit = findTimelineDateForStatus(crawlRow._timeline_rows, row.status);
    if (hit?.ymd) {
      await confirmIpoProgressRow({
        rowId: row.F_Id,
        receiveDateYmd: hit.ymd,
        adminId,
        logTag,
        triggerMatch: false,
      });
      confirmed += 1;
    } else {
      await enqueueRecheck({
        exchange: row.exchange,
        projectKey: crawlRow.exchange_project_id,
        company: row.company,
        board: row.board,
        listStatus: row.status,
        listUpdateYmd: toYmdLoose(row.F_UpdateTime),
        reason: 'timeline_missing_status_date',
      });
      enqueued += 1;
    }
  }

  return { scanned: watchlist.length, idFilled, confirmed, enqueued, idFailures };
}

async function runIpoProgressMatchCleanupAfterBackfill({ logTag = '[上市进展匹配善后]' } = {}) {
  const orphan = await db.query(
    `SELECT ipp.F_Id FROM ipo_project_progress ipp
     LEFT JOIN ipo_progress ip ON ipp.ipo_progress_row_id = ip.F_Id AND ip.F_DeleteMark = 0
     WHERE ipp.F_DeleteMark = 0 AND ipp.match_source = 'ipo_progress' AND ipp.ipo_progress_row_id IS NOT NULL
       AND ip.F_Id IS NULL`
  );
  let deleted = 0;
  for (const r of orphan) {
    await db.execute(
      `UPDATE ipo_project_progress
       SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system_backfill_cleanup'
       WHERE F_Id = ? AND F_DeleteMark = 0`,
      [r.F_Id]
    );
    deleted += 1;
  }

  const confirmedRows = await db.query(
    `SELECT F_Id FROM ipo_progress
     WHERE F_DeleteMark = 0 AND timeline_confirmed = 1
       AND exchange IN ('深交所', '上交所', '北交所')
     ORDER BY F_Id DESC LIMIT 5000`
  );
  let matched = 0;
  for (const r of confirmedRows) {
    try {
      const mr = await matchSingleIpoProgressRow(r.F_Id);
      if (mr?.inserted) matched += 1;
    } catch (e) {
      console.warn(`${logTag} match row ${r.F_Id}: ${e.message}`);
    }
  }

  return { orphanDeleted: deleted, rematched: matched };
}

module.exports = {
  enqueueRecheck,
  markRecheckDone,
  markRecheckExpired,
  processIpoProgressRecheck,
  getRecheckSummaryForProgressRow,
  runIpoProgressBackfill,
  runIpoProgressMatchCleanupAfterBackfill,
  buildProjectKey,
  confirmIpoProgressRow,
};
