const db = require('../../db');

/**
 * ?? Mock????????????? listingExchangeCrawler.runListingExchangeCrawler
 * @returns {{ inserted: number, skipped: number }}
 */
async function runListingMockCrawler({ startDate, endDate }) {
  const adminRows = await db.query(`SELECT id FROM users WHERE account = 'admin' LIMIT 1`);
  const adminId = adminRows[0]?.id;
  if (!adminId) throw new Error('??? account=admin ???????? Mock ????');

  const start = new Date(`${String(startDate).trim()}T00:00:00`);
  const end = new Date(`${String(endDate).trim()}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('??????');
  }

  const fmtLocal = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const exchanges = [
    { code: '???', board: '??' },
    { code: '???', board: '???' },
    { code: '???', board: '???' },
  ];

  let inserted = 0;
  let skipped = 0;
  const d = new Date(start);
  while (d <= end) {
    const dateStr = fmtLocal(d);
    for (let i = 0; i < exchanges.length; i += 1) {
      const { code: exchange, board } = exchanges[i];
      const company = `?????Mock?${dateStr.replace(/-/g, '')}-${i}`;
      const dup = await db.query(
        `SELECT f_id FROM ipo_progress
         WHERE F_DeleteMark = 0 AND exchange = ? AND company = ? AND DATE(f_update_time) = ? LIMIT 1`,
        [exchange, company, dateStr]
      );
      if (dup.length) {
        skipped += 1;
        continue;
      }
      const fUpdate = `${dateStr} 10:00:00`;
      await db.execute(
        `INSERT INTO ipo_progress (
          f_create_date, f_update_time, code, project_name, status, register_address, receive_date,
          company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
        ) VALUES (?, ?, '', ?, '???', '', NULL, ?, ?, ?, ?, ?, NOW(), 0)`,
        [dateStr, fUpdate, `Mock-${dateStr}`, company, board, exchange, adminId, adminId]
      );
      inserted += 1;
    }
    d.setDate(d.getDate() + 1);
  }

  return { inserted, skipped };
}

module.exports = { runListingMockCrawler };
