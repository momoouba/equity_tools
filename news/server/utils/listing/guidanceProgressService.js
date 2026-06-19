const db = require('../../db');
const { createShanghaiDate, formatDateOnly } = require('./listingBeijingDate');
const { normalizeCompanyNameForMatch, extractCsrcGuidanceCompanyName } = require('./listingCompanyNormalize');
const { runGuidanceProgressSync } = require('./guidanceProgressSync');

async function resolveAdminId() {
  const rows = await db.query(`SELECT F_Id AS id FROM users WHERE account='admin' LIMIT 1`);
  if (!rows.length) throw new Error('未找到 account=admin 用户，无法写入辅导备案');
  return rows[0].id;
}

async function upsertGuidanceRow(row, adminId, writeDate) {
  const company = normalizeCompanyNameForMatch(
    extractCsrcGuidanceCompanyName(row.company || '')
  ).trim();
  if (!company) return 'skipped';
  const updateDate = String(row.record_date || '').slice(0, 10);
  if (!updateDate) return 'skipped';
  const updateTime = `${updateDate} 00:00:00`;
  const createDate = String(writeDate || '').slice(0, 10) || formatDateOnly(createShanghaiDate());
  const exchange = '证监会辅导备案';
  const board = String(row.board || '').trim() || '辅导备案';
  const status = String(row.status || '').trim() || '辅导备案';
  const registerAddress = String(row.register_address || '').trim();
  const code = String(row.code || '').trim();
  const projectName = company;

  const exists = await db.query(
    `SELECT F_Id, status, register_address, board, code, project_name, company
     FROM ipo_progress
     WHERE F_DeleteMark = 0
       AND exchange = ?
       AND company = ?
       AND F_UpdateTime = ?
     LIMIT 1`,
    [exchange, company, updateTime]
  );
  if (!exists.length) {
    await db.execute(
      `INSERT INTO ipo_progress (
        F_CreatorTime, F_UpdateTime, code, project_name, status, register_address, receive_date,
        company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [
        createDate,
        updateTime,
        code,
        projectName,
        status,
        registerAddress,
        updateDate,
        company,
        board,
        exchange,
        adminId,
        adminId,
      ]
    );
    return 'inserted';
  }

  const old = exists[0];
  const changed =
    String(old.status || '') !== status ||
    String(old.register_address || '') !== registerAddress ||
    String(old.board || '') !== board ||
    String(old.code || '') !== code ||
    String(old.project_name || '') !== projectName ||
    String(old.company || '') !== company;
  if (!changed) return 'skipped';

  await db.execute(
    `UPDATE ipo_progress
     SET status = ?, register_address = ?, board = ?, code = ?, project_name = ?, company = ?,
         receive_date = ?, F_LastModifyUserId = ?, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [status, registerAddress, board, code, projectName, company, updateDate, adminId, old.F_Id]
  );
  return 'updated';
}

async function syncGuidanceProgress(options = {}) {
  const now = createShanghaiDate();
  const from = options.from || formatDateOnly(now);
  const to = options.to || formatDateOnly(now);
  const triggerType = options.triggerType || 'manual';
  const logTag = options.logTag || '[辅导备案同步]';
  const source = options.source || 'html';
  const sourceUrl = String(options.sourceUrl || '').trim();

  console.log(`${logTag} 执行开始 from=${from} to=${to} trigger=${triggerType}`);
  const adminId = await resolveAdminId();
  const fetched = runGuidanceProgressSync({ startDate: from, endDate: to, source, sourceUrl, logTag });
  if (!fetched.ok) {
    throw new Error(fetched.stderr || '辅导备案抓取失败');
  }
  const rows = fetched.rows || [];
  const writeDate = formatDateOnly(createShanghaiDate());
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const state = await upsertGuidanceRow(row, adminId, writeDate);
    if (state === 'inserted') inserted += 1;
    else if (state === 'updated') updated += 1;
    else skipped += 1;
  }
  const result = {
    from,
    to,
    triggerType,
    fetched: rows.length,
    inserted,
    updated,
    skipped,
    sourceRows: Number((fetched.summary && fetched.summary.sourceRows) || 0),
    source: String((fetched.summary && fetched.summary.source) || source),
    message: '辅导备案同步完成',
    executedAt: new Date().toISOString(),
  };
  console.log(`${logTag} 执行完成`, result);
  return result;
}

module.exports = {
  syncGuidanceProgress,
};

