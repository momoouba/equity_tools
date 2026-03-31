const xlsx = require('xlsx');
const multer = require('multer');
const db = require('../../db');
const { generateIpoProjectNo } = require('../../utils/上市进展/ipoProjectNumber');
const { rowsToCsv, sendCsv, formatCsvDateYmdSlash } = require('../../utils/上市进展/listingCsv');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const {
  IPO_BATCH_IMPORT_TEMPLATE_HEADERS_CN,
  IPO_BATCH_IMPORT_TEMPLATE_EXAMPLE,
  normalizeIpoBatchImportRow,
} = require('../../utils/上市进展/ipoBatchImportNormalize');
const upload = multer({ storage: multer.memoryStorage() });

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无上市进展访问权限' });
}

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

async function buildIpoProjectWhere(req, user) {
  const keyword = (req.query.keyword || '').trim();
  const creatorUserId = (req.query.creatorUserId || '').trim();

  const where = ['p.F_DeleteMark = 0'];
  const params = [];

  if (!isAdminAccount(user.account)) {
    where.push('p.F_CreatorUserId = ?');
    params.push(user.id);
  } else if (creatorUserId) {
    where.push('p.F_CreatorUserId = ?');
    params.push(creatorUserId);
  }

  if (keyword) {
    const like = `%${keyword}%`;
    where.push(
      `(p.project_no LIKE ? OR p.fund LIKE ? OR p.sub LIKE ? OR p.project_name LIKE ? OR p.company LIKE ? OR CAST(p.inv_amount AS CHAR) LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

/**
 * GET /api/listing/ipo-project
 * query: page, pageSize, keyword, creatorUserId (admin only)
 */
async function listIpoProjects(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const { whereSql, params } = await buildIpoProjectWhere(req, user);

    const countRows = await db.query(
      `SELECT COUNT(*) AS total FROM ipo_project p ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    const offset = (page - 1) * pageSize;
    const rows = await db.query(
      `SELECT p.*, u.account AS creator_account
       FROM ipo_project p
       LEFT JOIN users u ON u.id = p.F_CreatorUserId
       ${whereSql}
       ORDER BY p.F_CreatorTime DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({
      success: true,
      data: { list: rows, total, page, pageSize },
    });
  } catch (e) {
    console.error('listIpoProjects', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function exportIpoProjectsCsv(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const { whereSql, params } = await buildIpoProjectWhere(req, user);
    const rows = await db.query(
      `SELECT p.*, u.account AS creator_account
       FROM ipo_project p
       LEFT JOIN users u ON u.id = p.F_CreatorUserId
       ${whereSql}
       ORDER BY p.F_CreatorTime DESC
       LIMIT 50000`,
      params
    );

    const csv = rowsToCsv(rows, [
      { label: '项目编号', key: 'project_no' },
      { label: '归属基金', key: 'fund' },
      { label: '归属子基金', key: 'sub' },
      { label: '项目简称', key: 'project_name' },
      { label: '企业全称', key: 'company' },
      { label: '投资金额', key: 'inv_amount' },
      { label: '剩余金额', key: 'residual_amount' },
      { label: '穿透权益占比', key: 'ratio' },
      { label: '穿透投资金额', key: 'ct_amount' },
      { label: '穿透剩余金额', key: 'ct_residual' },
      { label: '业务更新', key: 'biz_update_time', get: (r) => formatCsvDateYmdSlash(r.biz_update_time) },
      { label: '创建时间', key: 'F_CreatorTime', get: (r) => formatCsvDateYmdSlash(r.F_CreatorTime) },
      { label: '创建用户', key: 'creator_account' },
    ]);
    sendCsv(res, `底层项目表_${Date.now()}.csv`, csv);
  } catch (e) {
    console.error('exportIpoProjectsCsv', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/**
 * POST /ipo-project/batch-import
 * body: { rows: [ { ... } ] }
 * 每行支持「中文键名」（与 Excel 模板表头一致）或英文字段名；数值字段支持字符串及千分位逗号。
 */
async function importIpoProjectRows(rowsIn, user) {
  if (!Array.isArray(rowsIn) || rowsIn.length === 0) {
    return { success: false, status: 400, message: '请提供 rows 数组' };
  }
  if (rowsIn.length > 500) {
    return { success: false, status: 400, message: '单次最多导入 500 条' };
  }

  let inserted = 0;
  const now = new Date();
  for (const raw of rowsIn) {
    const r = normalizeIpoBatchImportRow(raw);
    if (!r) continue;
    const project_no = await generateIpoProjectNo();
    await db.execute(
      `INSERT INTO ipo_project (
        project_no, biz_update_time, F_CreatorTime, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime,
        project_name, company, inv_amount, residual_amount, ratio, ct_amount, ct_residual, fund, sub
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_no,
        r.biz_update_time || now,
        now,
        user.id,
        user.id,
        now,
        r.project_name,
        r.company,
        r.inv_amount,
        r.residual_amount,
        r.ratio,
        r.ct_amount,
        r.ct_residual,
        r.fund,
        r.sub,
      ]
    );
    inserted += 1;
  }

  return { success: true, data: { inserted, total: rowsIn.length } };
}

async function batchImportIpoProjects(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const body = req.body || {};
    const result = await importIpoProjectRows(body.rows, user);
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, message: result.message || '导入失败' });
    }
    return res.json(result);
  } catch (e) {
    console.error('batchImportIpoProjects', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function uploadBatchImportIpoProjects(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请先选择 Excel 文件' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) {
      return res.status(400).json({ success: false, message: 'Excel 文件无有效工作表' });
    }
    const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: '' });
    const result = await importIpoProjectRows(rows, user);
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, message: result.message || '导入失败' });
    }
    return res.json({ success: true, message: `导入完成：成功 ${result.data.inserted} 条`, data: result.data });
  } catch (e) {
    console.error('uploadBatchImportIpoProjects', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/**
 * GET /ipo-project/batch-import/template
 * 下载 .xlsx 模板（中文表头，与 JSON 批量导入键名一致）
 */
async function downloadIpoProjectBatchImportTemplate(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      IPO_BATCH_IMPORT_TEMPLATE_HEADERS_CN,
      IPO_BATCH_IMPORT_TEMPLATE_EXAMPLE,
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, '底层项目');
    const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    const filename = encodeURIComponent('底层项目批量导入模板.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (e) {
    console.error('downloadIpoProjectBatchImportTemplate', e);
    return res.status(500).json({ success: false, message: e.message || '模板生成失败' });
  }
}

async function createIpoProject(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const body = req.body || {};
    const project_no = await generateIpoProjectNo();
    const now = new Date();

    await db.execute(
      `INSERT INTO ipo_project (
        project_no, biz_update_time, F_CreatorTime, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime,
        project_name, company, inv_amount, residual_amount, ratio, ct_amount, ct_residual, fund, sub
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_no,
        body.biz_update_time || null,
        now,
        user.id,
        user.id,
        now,
        body.project_name,
        body.company,
        body.inv_amount,
        body.residual_amount,
        body.ratio,
        body.ct_amount,
        body.ct_residual,
        body.fund,
        body.sub || null,
      ]
    );

    const inserted = await db.query(
      `SELECT * FROM ipo_project WHERE project_no = ? LIMIT 1`,
      [project_no]
    );
    return res.json({ success: true, data: inserted[0] });
  } catch (e) {
    console.error('createIpoProject', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function updateIpoProject(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const fId = req.params.fId;
    const body = req.body || {};

    const rows = await db.query(
      `SELECT * FROM ipo_project WHERE f_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [fId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '记录不存在' });
    const row = rows[0];

    if (!isAdminAccount(user.account) && row.F_CreatorUserId !== user.id) {
      return forbidden(res);
    }

    const now = new Date();
    await db.execute(
      `UPDATE ipo_project SET
        project_name = ?, company = ?, inv_amount = ?, residual_amount = ?, ratio = ?,
        ct_amount = ?, ct_residual = ?, fund = ?, sub = ?,
        biz_update_time = COALESCE(?, biz_update_time),
        F_LastModifyUserId = ?, F_LastModifyTime = ?
       WHERE f_id = ?`,
      [
        body.project_name,
        body.company,
        body.inv_amount,
        body.residual_amount,
        body.ratio,
        body.ct_amount,
        body.ct_residual,
        body.fund,
        body.sub || null,
        body.biz_update_time || null,
        user.id,
        now,
        fId,
      ]
    );

    const updated = await db.query(`SELECT * FROM ipo_project WHERE f_id = ? LIMIT 1`, [fId]);
    return res.json({ success: true, data: updated[0] });
  } catch (e) {
    console.error('updateIpoProject', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function softDeleteIpoProject(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const fId = req.params.fId;
    const rows = await db.query(
      `SELECT * FROM ipo_project WHERE f_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [fId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '记录不存在' });
    const row = rows[0];

    if (!isAdminAccount(user.account) && row.F_CreatorUserId !== user.id) {
      return forbidden(res);
    }

    const now = new Date();
    await db.execute(
      `UPDATE ipo_project SET F_DeleteMark = 1, F_DeleteTime = ?, F_DeleteUserId = ? WHERE f_id = ?`,
      [now, user.id, fId]
    );
    return res.json({ success: true });
  } catch (e) {
    console.error('softDeleteIpoProject', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerIpoProjectRoutes(router) {
  router.get('/ipo-project', listIpoProjects);
  router.get('/ipo-project/export', exportIpoProjectsCsv);
  router.get('/ipo-project/batch-import/template', downloadIpoProjectBatchImportTemplate);
  router.post('/ipo-project/batch-import', batchImportIpoProjects);
  router.post('/ipo-project/batch-import/upload', upload.single('file'), uploadBatchImportIpoProjects);
  router.post('/ipo-project', createIpoProject);
  router.put('/ipo-project/:fId', updateIpoProject);
  router.delete('/ipo-project/:fId', softDeleteIpoProject);
}

module.exports = { registerIpoProjectRoutes };
