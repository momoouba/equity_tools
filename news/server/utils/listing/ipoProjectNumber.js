const db = require('../../db');

/**
 * ???????PP + YYYYMMDD + 5 ?????????uk_ipo_project_no??
 * ?????? allocateConsecutiveIpoProjectNos(????, n) ???????????? generateIpoProjectNo
 * ???????????? INSERT ??????
 */
function buildDatePrefix() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `PP${year}${month}${day}`;
}

/**
 * ???????? count ??? project_no?
 * @param {import('mysql2/promise').PoolConnection | null} connection ??????????? MAX?null ?????
 * @param {number} count
 * @returns {Promise<string[]>}
 */
async function allocateConsecutiveIpoProjectNos(connection, count) {
  const n = Math.max(0, parseInt(count, 10) || 0);
  if (n === 0) return [];
  const prefix = buildDatePrefix();
  const sql = `SELECT project_no FROM ipo_project WHERE project_no LIKE ? ORDER BY project_no DESC LIMIT 1`;
  const params = [`${prefix}%`];
  let rows;
  if (connection && typeof connection.query === 'function') {
    const [r] = await connection.query(sql, params);
    rows = r;
  } else {
    rows = await db.query(sql, params);
  }
  let sequence = 1;
  if (rows && rows.length) {
    const suffix = String(rows[0].project_no || '').slice(prefix.length);
    const seqNum = parseInt(suffix, 10);
    if (!Number.isNaN(seqNum)) sequence = seqNum + 1;
  }
  const lastSeq = sequence + n - 1;
  if (lastSeq > 99999) {
    throw new Error(`?????? ${prefix} ??????? 99999??????????????`);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${prefix}${String(sequence + i).padStart(5, '0')}`);
  }
  return out;
}

/**
 * @param {import('mysql2/promise').PoolConnection | null} [connection] ????????????????
 */
async function generateIpoProjectNo(connection) {
  const arr = await allocateConsecutiveIpoProjectNos(connection || null, 1);
  return arr[0];
}

module.exports = { generateIpoProjectNo, allocateConsecutiveIpoProjectNos };
