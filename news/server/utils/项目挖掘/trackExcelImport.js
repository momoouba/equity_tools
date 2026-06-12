const db = require('../../db');

/**
 * 包装 mysql2 原始连接，使 query() 直接返回行数组（与 db.query 行为一致），
 * 以便 ensure / upsert 函数可同时接受 db 或 wrapped conn。
 */
function wrapConn(conn) {
  return {
    async query(sql, params) {
      const [rows] = await conn.query(sql, params);
      return rows;
    },
    async execute(sql, params) {
      const [result] = await conn.execute(sql, params);
      return result;
    },
  };
}

/** 与模板表头完全一致（顺序不可调） */
const HEADERS = [
  '赛道名称',
  '一级分类',
  '二级分类',
  '三级名称（匹配节点）',
  '三级排序',
  '匹配行业一级',
  '匹配行业二级',
  '关键词',
  '匹配优先级',
];

function trimCell(v) {
  return String(v == null ? '' : v).trim();
}

async function ensureTrack(name, sortOrder, conn) {
  const executor = conn || db;
  const forUpdate = conn ? ' FOR UPDATE' : '';
  const rows = await executor.query(`SELECT id FROM sourcing_track WHERE name = ? AND delete_mark = 0 LIMIT 1${forUpdate}`, [name]);
  if (rows.length) return conn ? rows[0].id : rows[0].id;
  const r = await executor.execute(`INSERT INTO sourcing_track (name, sort_order) VALUES (?,?)`, [name, sortOrder]);
  return r.insertId;
}

async function ensureLv1(trackId, name, sortOrder, conn) {
  const executor = conn || db;
  const forUpdate = conn ? ' FOR UPDATE' : '';
  const rows = await executor.query(
    `SELECT id FROM sourcing_track_lv1 WHERE track_id = ? AND name = ? AND delete_mark = 0 LIMIT 1${forUpdate}`,
    [trackId, name]
  );
  if (rows.length) return rows[0].id;
  const r = await executor.execute(`INSERT INTO sourcing_track_lv1 (track_id, name, sort_order) VALUES (?,?,?)`, [
    trackId,
    name,
    sortOrder,
  ]);
  return r.insertId;
}

async function ensureLv2(lv1Id, name, sortOrder, conn) {
  const executor = conn || db;
  const forUpdate = conn ? ' FOR UPDATE' : '';
  const rows = await executor.query(
    `SELECT id FROM sourcing_track_lv2 WHERE lv1_id = ? AND name = ? AND delete_mark = 0 LIMIT 1${forUpdate}`,
    [lv1Id, name]
  );
  if (rows.length) return rows[0].id;
  const r = await executor.execute(`INSERT INTO sourcing_track_lv2 (lv1_id, name, sort_order) VALUES (?,?,?)`, [
    lv1Id,
    name,
    sortOrder,
  ]);
  return r.insertId;
}

async function upsertLv3(lv2Id, name, sortOrder, m1, m2, kw, pri, conn) {
  const safeName = String(name || '').trim().slice(0, 100);
  const safeSortOrder = Math.max(0, Math.min(9999, parseInt(sortOrder, 10) || 0));
  const safePri = Math.max(0, Math.min(100, parseInt(pri, 10) || 0));
  const safeM1 = m1 != null && String(m1).trim() ? String(m1).trim().slice(0, 100) : null;
  const safeM2 = m2 != null && String(m2).trim() ? String(m2).trim().slice(0, 100) : null;
  const safeKw = kw != null && String(kw).trim() ? String(kw).trim().slice(0, 500) : null;

  const executor = conn || db;
  const rows = await executor.query(
    `SELECT id FROM sourcing_track_lv3 WHERE lv2_id = ? AND name = ? AND delete_mark = 0 LIMIT 1`,
    [lv2Id, safeName]
  );
  if (rows.length) {
    await executor.execute(
      `UPDATE sourcing_track_lv3 SET sort_order = ?, match_industry_lv1 = ?, match_industry_lv2 = ?, match_keywords = ?, match_priority = ? WHERE id = ?`,
      [safeSortOrder, safeM1, safeM2, safeKw, safePri, rows[0].id]
    );
    return 'updated';
  }
  await executor.execute(
    `INSERT INTO sourcing_track_lv3 (lv2_id, name, sort_order, match_industry_lv1, match_industry_lv2, match_keywords, match_priority) VALUES (?,?,?,?,?,?,?)`,
    [lv2Id, safeName, safeSortOrder, safeM1, safeM2, safeKw, safePri]
  );
  return 'created';
}

function parseWorkbook(buffer) {
  const xlsx = require('xlsx');
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('未检测到数据工作表');
  }
  const worksheet = workbook.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!matrix.length) {
    throw new Error('模板内容为空');
  }
  const headers = matrix[0].map(trimCell);
  const headerOk = HEADERS.every((h, idx) => headers[idx] === h);
  if (!headerOk) {
    throw new Error('模板表头不匹配，请下载最新模板');
  }
  const dataRows = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || !row.some((c) => trimCell(c) !== '')) continue;
    dataRows.push({
      rowNumber: r + 1,
      cells: [
        trimCell(row[0]),
        trimCell(row[1]),
        trimCell(row[2]),
        trimCell(row[3]),
        trimCell(row[4]),
        trimCell(row[5]),
        trimCell(row[6]),
        trimCell(row[7]),
        trimCell(row[8]),
      ],
    });
  }
  return dataRows;
}

async function importTrackRows(dataRows) {
  const errors = [];
  let updatedLeaves = 0;
  let createdLeaves = 0;

  // #4.1: 整个导入包裹在事务中，任何行失败则全部回滚
  const rawConn = await db.getConnection();
  try {
    await rawConn.beginTransaction();
    const conn = wrapConn(rawConn);

    for (let i = 0; i < dataRows.length; i++) {
      const { rowNumber, cells } = dataRows[i];
      const [trackName, lv1Name, lv2Name, lv3Name, lv3SortRaw, m1, m2, kw, priRaw] = cells;

      if (!trackName || !lv1Name || !lv2Name || !lv3Name) {
        errors.push({ row: rowNumber, message: '赛道名称、一级分类、二级分类、三级名称不能为空' });
        continue;
      }

      const sort3 = parseInt(String(lv3SortRaw || '0'), 10);
      const pri = parseInt(String(priRaw || '0'), 10);
      const mm1 = m1 ? (m1.length > 100 ? m1.slice(0, 100) : m1) : null;
      const mm2 = m2 ? (m2.length > 100 ? m2.slice(0, 100) : m2) : null;
      const kkw = kw ? (kw.length > 500 ? kw.slice(0, 500) : kw) : null;

      try {
        const tId = await ensureTrack(trackName, 0, conn);
        const l1Id = await ensureLv1(tId, lv1Name, 0, conn);
        const l2Id = await ensureLv2(l1Id, lv2Name, 0, conn);
        const action = await upsertLv3(
          l2Id,
          lv3Name.length > 100 ? lv3Name.slice(0, 100) : lv3Name,
          Number.isFinite(sort3) ? sort3 : 0,
          mm1,
          mm2,
          kkw,
          Number.isFinite(pri) ? pri : 0,
          conn
        );
        if (action === 'updated') updatedLeaves += 1;
        else createdLeaves += 1;
      } catch (e) {
        errors.push({ row: rowNumber, message: e.message || '该行写入失败' });
      }
    }

    if (errors.length > 0) {
      // 有错误行时回滚全部，确保数据一致性
      await rawConn.rollback();
    } else {
      await rawConn.commit();
    }
  } catch (txErr) {
    try { await rawConn.rollback(); } catch { /* ignore */ }
    throw txErr;
  } finally {
    rawConn.release();
  }

  return {
    errors,
    updatedLeaves: errors.length > 0 ? 0 : updatedLeaves,
    createdLeaves: errors.length > 0 ? 0 : createdLeaves,
    rowCount: dataRows.length,
    rolledBack: errors.length > 0,
  };
}

async function fetchFlatTrackRowsForExport() {
  return db.query(
    `SELECT
       t.name AS track_name,
       lv1.name AS lv1_name,
       lv2.name AS lv2_name,
       lv3.name AS lv3_name,
       lv3.sort_order AS lv3_sort_order,
       lv3.match_industry_lv1,
       lv3.match_industry_lv2,
       lv3.match_keywords,
       lv3.match_priority
     FROM sourcing_track_lv3 lv3
     INNER JOIN sourcing_track_lv2 lv2 ON lv2.id = lv3.lv2_id AND lv2.delete_mark = 0
     INNER JOIN sourcing_track_lv1 lv1 ON lv1.id = lv2.lv1_id AND lv1.delete_mark = 0
     INNER JOIN sourcing_track t ON t.id = lv1.track_id AND t.delete_mark = 0
     WHERE lv3.delete_mark = 0
     ORDER BY t.sort_order ASC, t.id ASC,
              lv1.sort_order ASC, lv1.id ASC,
              lv2.sort_order ASC, lv2.id ASC,
              lv3.sort_order ASC, lv3.id ASC`
  );
}

function buildExportWorkbookBuffer(rows) {
  const xlsx = require('xlsx');
  const aoa = [
    HEADERS,
    ...rows.map((r) => [
      r.track_name || '',
      r.lv1_name || '',
      r.lv2_name || '',
      r.lv3_name || '',
      r.lv3_sort_order ?? 0,
      r.match_industry_lv1 || '',
      r.match_industry_lv2 || '',
      r.match_keywords || '',
      r.match_priority ?? 0,
    ]),
  ];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  xlsx.utils.book_append_sheet(wb, ws, '赛道导入');
  return xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

async function exportTrackTreeWorkbookBuffer() {
  const rows = await fetchFlatTrackRowsForExport();
  return buildExportWorkbookBuffer(rows);
}

module.exports = {
  HEADERS,
  parseWorkbook,
  importTrackRows,
  exportTrackTreeWorkbookBuffer,
};
