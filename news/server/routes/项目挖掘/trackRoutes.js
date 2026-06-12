const db = require('../../db');
const multer = require('multer');
const xlsx = require('xlsx');
const { applyTrackMatchForEvents } = require('../../utils/项目挖掘/financingTrackMatch');
const trackExcelImport = require('../../utils/项目挖掘/trackExcelImport');
const { requireProjectSourcingAccess } = require('../../utils/项目挖掘/projectSourcingRouteAuth');

/** 脱敏错误消息：避免向前端泄露 SQL、连接字符串、文件路径等内部信息 */
function safeErrorMessage(err, fallback = '操作失败') {
  const msg = String(err?.message || err || '');
  if (/ER_|SQLSTATE|ECONNREFUSED|ENOTFOUND|mysql|syntax|Duplicate entry|Deadlock/i.test(msg)) return fallback;
  if (/\/[\w.]+|\\[\w.]+/.test(msg) && msg.length > 120) return fallback;
  return msg.slice(0, 200) || fallback;
}

const trackUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function trimStr(v, max = 500) {
  if (v == null) return '';
  let s = String(v).trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

async function softDeleteLv3ForLv2Ids(lv2Ids) {
  if (!lv2Ids || !lv2Ids.length) return;
  const placeholders = lv2Ids.map(() => '?').join(',');
  await db.execute(
    `UPDATE sourcing_track_lv3 SET delete_mark = 1 WHERE lv2_id IN (${placeholders}) AND delete_mark = 0`,
    lv2Ids
  );
}

function registerTrackRoutes(router) {
  router.get('/tracks/tree', requireProjectSourcingAccess, async (req, res) => {
    try {
      const tracks = await db.query(
        `SELECT id, name, sort_order FROM sourcing_track WHERE delete_mark = 0 ORDER BY sort_order ASC, id ASC`
      );
      const lv1Rows = await db.query(
        `SELECT id, track_id, name, sort_order FROM sourcing_track_lv1 WHERE delete_mark = 0 ORDER BY sort_order ASC, id ASC`
      );
      const lv2Rows = await db.query(
        `SELECT id, lv1_id, name, sort_order FROM sourcing_track_lv2 WHERE delete_mark = 0 ORDER BY sort_order ASC, id ASC`
      );
      const lv3Rows = await db.query(
        `SELECT id, lv2_id, name, sort_order, match_industry_lv1, match_industry_lv2, match_keywords, match_priority
         FROM sourcing_track_lv3 WHERE delete_mark = 0 ORDER BY sort_order ASC, id ASC`
      );

      const lv3ByLv2 = new Map();
      for (let i = 0; i < lv3Rows.length; i++) {
        const r = lv3Rows[i];
        const k = r.lv2_id;
        if (!lv3ByLv2.has(k)) lv3ByLv2.set(k, []);
        lv3ByLv2.get(k).push(r);
      }

      const lv2ByLv1 = new Map();
      for (let i = 0; i < lv2Rows.length; i++) {
        const r = lv2Rows[i];
        const k = r.lv1_id;
        if (!lv2ByLv1.has(k)) lv2ByLv1.set(k, []);
        lv2ByLv1.get(k).push({
          ...r,
          lv3_list: lv3ByLv2.get(r.id) || [],
        });
      }

      const lv1ByTrack = new Map();
      for (let i = 0; i < lv1Rows.length; i++) {
        const r = lv1Rows[i];
        const k = r.track_id;
        if (!lv1ByTrack.has(k)) lv1ByTrack.set(k, []);
        lv1ByTrack.get(k).push({
          ...r,
          lv2_list: lv2ByLv1.get(r.id) || [],
        });
      }

      const tree = tracks.map((t) => ({
        ...t,
        lv1_list: lv1ByTrack.get(t.id) || [],
      }));

      res.json({ success: true, data: tree });
    } catch (e) {
      console.error('[project-sourcing/tracks/tree]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '加载失败' });
    }
  });

  router.post('/tracks/apply-match', requireProjectSourcingAccess, async (req, res) => {
    try {
      const body = req.body || {};
      const mode = body.mode === 'all' ? 'all' : 'fill_empty';
      const limit = Math.min(Math.max(parseInt(body.limit, 10) || 5000, 1), 20000);
      const offset = Math.max(parseInt(body.offset, 10) || 0, 0);
      console.log(
        '[project-sourcing/tracks/apply-match] request',
        JSON.stringify({ mode, limit, offset })
      );
      const result = await applyTrackMatchForEvents({ limit, offset, mode });
      console.log(
        '[project-sourcing/tracks/apply-match] response',
        JSON.stringify({
          scanned: result.scanned,
          matched: result.matched,
          message: result.message || null,
        })
      );
      res.json({ success: true, data: result });
    } catch (e) {
      console.error('[project-sourcing/tracks/apply-match]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '匹配失败' });
    }
  });

  router.get('/tracks/import/template', requireProjectSourcingAccess, (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      const exampleRow = [
        '人工智能',
        '具身智能',
        '感知与决策',
        '人机协作抓取示例',
        '0',
        '先进制造',
        '机器人',
        '协作机器人,人机交互',
        '10',
      ];
      const ws = xlsx.utils.aoa_to_sheet([trackExcelImport.HEADERS, exampleRow]);
      xlsx.utils.book_append_sheet(workbook, ws, '赛道导入');
      const buf = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
      const filename = encodeURIComponent('项目挖掘-赛道配置导入模板.xlsx');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.send(buf);
    } catch (e) {
      console.error('[project-sourcing/tracks/import/template]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '模板生成失败' });
    }
  });

  router.get('/tracks/export/excel', requireProjectSourcingAccess, async (req, res) => {
    try {
      const buf = await trackExcelImport.exportTrackTreeWorkbookBuffer();
      const filename = encodeURIComponent('项目挖掘-赛道配置导出.xlsx');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.send(buf);
    } catch (e) {
      console.error('[project-sourcing/tracks/export/excel]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '导出失败' });
    }
  });

  router.post(
    '/tracks/import/upload',
    requireProjectSourcingAccess,
    trackUpload.single('file'),
    async (req, res) => {
      try {
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ success: false, message: '请上传 Excel 文件' });
        }
        let dataRows;
        try {
          dataRows = trackExcelImport.parseWorkbook(req.file.buffer);
        } catch (err) {
          return res.status(400).json({ success: false, message: err.message || '文件解析失败' });
        }
        if (!dataRows.length) {
          return res.status(400).json({ success: false, message: '未检测到可导入的数据行（勿删除表头）' });
        }
        const result = await trackExcelImport.importTrackRows(dataRows);
        const msg =
          `处理 ${result.rowCount} 行：新建三级 ${result.createdLeaves} 条，更新三级 ${result.updatedLeaves} 条` +
          (result.errors.length ? `；失败 ${result.errors.length} 行（已回滚，请修正后重新上传）` : '');
        res.json({
          success: result.errors.length === 0,
          message: msg,
          data: {
            createdLeaves: result.createdLeaves,
            updatedLeaves: result.updatedLeaves,
            rowCount: result.rowCount,
            rolledBack: result.rolledBack || false,
          },
          errors: result.errors,
        });
      } catch (e) {
        console.error('[project-sourcing/tracks/import/upload]', e);
        res.status(500).json({ success: false, message: safeErrorMessage(e) || '导入失败' });
      }
    }
  );

  router.post('/tracks/lv3', requireProjectSourcingAccess, async (req, res) => {
    try {
      const {
        lv2_id,
        name,
        sort_order = 0,
        match_industry_lv1,
        match_industry_lv2,
        match_keywords,
        match_priority = 0,
      } = req.body || {};
      const lv2Id = parseInt(lv2_id, 10);
      const nm = trimStr(name, 100);
      if (!lv2Id || !nm) {
        return res.status(400).json({ success: false, message: 'lv2_id、name 不能为空' });
      }
      const check = await db.query(`SELECT id FROM sourcing_track_lv2 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [lv2Id]);
      if (!check.length) {
        return res.status(400).json({ success: false, message: '二级分类不存在' });
      }
      const ins = await db.execute(
        `INSERT INTO sourcing_track_lv3 (lv2_id, name, sort_order, match_industry_lv1, match_industry_lv2, match_keywords, match_priority)
         VALUES (?,?,?,?,?,?,?)`,
        [
          lv2Id,
          nm,
          parseInt(sort_order, 10) || 0,
          trimStr(match_industry_lv1, 100) || null,
          trimStr(match_industry_lv2, 100) || null,
          trimStr(match_keywords, 500) || null,
          parseInt(match_priority, 10) || 0,
        ]
      );
      res.json({ success: true, data: { id: ins.insertId } });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv3 POST]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '创建失败' });
    }
  });

  router.put('/tracks/lv3/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      const {
        name,
        sort_order,
        lv2_id,
        match_industry_lv1,
        match_industry_lv2,
        match_keywords,
        match_priority,
      } = req.body || {};

      const existing = await db.query(`SELECT id, name, lv2_id FROM sourcing_track_lv3 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [id]);
      if (!existing.length) return res.status(404).json({ success: false, message: '记录不存在' });

      const fields = [];
      const params = [];
      let targetLv2Id = existing[0].lv2_id;
      if (lv2_id !== undefined) {
        const nid = parseInt(lv2_id, 10);
        if (!nid) return res.status(400).json({ success: false, message: '无效的 lv2_id' });
        const chk = await db.query(`SELECT id FROM sourcing_track_lv2 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [nid]);
        if (!chk.length) return res.status(400).json({ success: false, message: '目标二级分类不存在' });
        targetLv2Id = nid;
        fields.push('lv2_id = ?');
        params.push(nid);
      }
      if (name !== undefined) {
        const nm = trimStr(name, 100);
        if (!nm) return res.status(400).json({ success: false, message: 'name 不能为空' });
        const nmFinal = nm;
        const dup = await db.query(
          `SELECT id FROM sourcing_track_lv3 WHERE lv2_id = ? AND name = ? AND delete_mark = 0 AND id != ? LIMIT 1`,
          [targetLv2Id, nmFinal, id]
        );
        if (dup.length) {
          return res.status(400).json({ success: false, message: '目标二级下已存在同名三级节点' });
        }
        fields.push('name = ?');
        params.push(nmFinal);
      } else if (lv2_id !== undefined) {
        const dup = await db.query(
          `SELECT id FROM sourcing_track_lv3 WHERE lv2_id = ? AND name = ? AND delete_mark = 0 AND id != ? LIMIT 1`,
          [targetLv2Id, existing[0].name, id]
        );
        if (dup.length) {
          return res.status(400).json({ success: false, message: '目标二级下已存在同名三级节点' });
        }
      }
      if (sort_order !== undefined) {
        fields.push('sort_order = ?');
        params.push(parseInt(sort_order, 10) || 0);
      }
      if (match_industry_lv1 !== undefined) {
        fields.push('match_industry_lv1 = ?');
        params.push(trimStr(match_industry_lv1, 100) || null);
      }
      if (match_industry_lv2 !== undefined) {
        fields.push('match_industry_lv2 = ?');
        params.push(trimStr(match_industry_lv2, 100) || null);
      }
      if (match_keywords !== undefined) {
        fields.push('match_keywords = ?');
        params.push(trimStr(match_keywords, 500) || null);
      }
      if (match_priority !== undefined) {
        fields.push('match_priority = ?');
        params.push(parseInt(match_priority, 10) || 0);
      }
      if (!fields.length) {
        return res.json({ success: true });
      }
      params.push(id);
      await db.execute(`UPDATE sourcing_track_lv3 SET ${fields.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv3 PUT]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '更新失败' });
    }
  });

  router.delete('/tracks/lv3/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      await db.execute(`UPDATE sourcing_track_lv3 SET delete_mark = 1 WHERE id = ?`, [id]);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv3 DELETE]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '删除失败' });
    }
  });

  router.post('/tracks/lv2', requireProjectSourcingAccess, async (req, res) => {
    try {
      const { lv1_id, name, sort_order = 0 } = req.body || {};
      const lv1Id = parseInt(lv1_id, 10);
      const nm = trimStr(name, 100);
      if (!lv1Id || !nm) {
        return res.status(400).json({ success: false, message: 'lv1_id、name 不能为空' });
      }
      const check = await db.query(`SELECT id FROM sourcing_track_lv1 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [lv1Id]);
      if (!check.length) {
        return res.status(400).json({ success: false, message: '一级分类不存在' });
      }
      const insLv2 = await db.execute(`INSERT INTO sourcing_track_lv2 (lv1_id, name, sort_order) VALUES (?,?,?)`, [
        lv1Id,
        nm,
        parseInt(sort_order, 10) || 0,
      ]);
      res.json({ success: true, data: { id: insLv2.insertId } });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv2 POST]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '创建失败' });
    }
  });

  router.put('/tracks/lv2/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      const { name, sort_order, lv1_id } = req.body || {};

      const existing = await db.query(`SELECT id, name, lv1_id FROM sourcing_track_lv2 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [id]);
      if (!existing.length) return res.status(404).json({ success: false, message: '记录不存在' });

      const fields = [];
      const params = [];
      let targetLv1Id = existing[0].lv1_id;
      if (lv1_id !== undefined) {
        const nid = parseInt(lv1_id, 10);
        if (!nid) return res.status(400).json({ success: false, message: '无效的 lv1_id' });
        const chk = await db.query(`SELECT id FROM sourcing_track_lv1 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [nid]);
        if (!chk.length) return res.status(400).json({ success: false, message: '目标一级分类不存在' });
        targetLv1Id = nid;
        fields.push('lv1_id = ?');
        params.push(nid);
      }
      if (name !== undefined) {
        const nm = trimStr(name, 100);
        if (!nm) return res.status(400).json({ success: false, message: 'name 不能为空' });
        const dup = await db.query(
          `SELECT id FROM sourcing_track_lv2 WHERE lv1_id = ? AND name = ? AND delete_mark = 0 AND id != ? LIMIT 1`,
          [targetLv1Id, nm, id]
        );
        if (dup.length) {
          return res.status(400).json({ success: false, message: '目标一级下已存在同名二级节点' });
        }
        fields.push('name = ?');
        params.push(nm);
      } else if (lv1_id !== undefined) {
        const dup = await db.query(
          `SELECT id FROM sourcing_track_lv2 WHERE lv1_id = ? AND name = ? AND delete_mark = 0 AND id != ? LIMIT 1`,
          [targetLv1Id, existing[0].name, id]
        );
        if (dup.length) {
          return res.status(400).json({ success: false, message: '目标一级下已存在同名二级节点' });
        }
      }
      if (sort_order !== undefined) {
        fields.push('sort_order = ?');
        params.push(parseInt(sort_order, 10) || 0);
      }
      if (!fields.length) {
        return res.json({ success: true });
      }
      params.push(id);
      await db.execute(`UPDATE sourcing_track_lv2 SET ${fields.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv2 PUT]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '更新失败' });
    }
  });

  router.delete('/tracks/lv2/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      await softDeleteLv3ForLv2Ids([id]);
      await db.execute(`UPDATE sourcing_track_lv2 SET delete_mark = 1 WHERE id = ?`, [id]);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv2 DELETE]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '删除失败' });
    }
  });

  router.post('/tracks/lv1', requireProjectSourcingAccess, async (req, res) => {
    try {
      const { track_id, name, sort_order = 0 } = req.body || {};
      const tid = parseInt(track_id, 10);
      const nm = trimStr(name, 100);
      if (!tid || !nm) {
        return res.status(400).json({ success: false, message: 'track_id、name 不能为空' });
      }
      const check = await db.query(`SELECT id FROM sourcing_track WHERE id = ? AND delete_mark = 0 LIMIT 1`, [tid]);
      if (!check.length) {
        return res.status(400).json({ success: false, message: '赛道不存在' });
      }
      const insLv1 = await db.execute(`INSERT INTO sourcing_track_lv1 (track_id, name, sort_order) VALUES (?,?,?)`, [
        tid,
        nm,
        parseInt(sort_order, 10) || 0,
      ]);
      res.json({ success: true, data: { id: insLv1.insertId } });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv1 POST]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '创建失败' });
    }
  });

  router.put('/tracks/lv1/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      const { name, sort_order, track_id } = req.body || {};
      const existing = await db.query(`SELECT id, name, track_id FROM sourcing_track_lv1 WHERE id = ? AND delete_mark = 0 LIMIT 1`, [id]);
      if (!existing.length) return res.status(404).json({ success: false, message: '记录不存在' });

      const fields = [];
      const params = [];
      let targetTrackId = existing[0].track_id;
      if (track_id !== undefined) {
        const nid = parseInt(track_id, 10);
        if (!nid) return res.status(400).json({ success: false, message: '无效的 track_id' });
        const chk = await db.query(`SELECT id FROM sourcing_track WHERE id = ? AND delete_mark = 0 LIMIT 1`, [nid]);
        if (!chk.length) return res.status(400).json({ success: false, message: '目标赛道不存在' });
        targetTrackId = nid;
        fields.push('track_id = ?');
        params.push(nid);
      }
      if (name !== undefined) {
        const nm = trimStr(name, 100);
        if (!nm) return res.status(400).json({ success: false, message: 'name 不能为空' });
        const dup = await db.query(
          `SELECT id FROM sourcing_track_lv1 WHERE track_id = ? AND name = ? AND delete_mark = 0 AND id != ? LIMIT 1`,
          [targetTrackId, nm, id]
        );
        if (dup.length) {
          return res.status(400).json({ success: false, message: '目标赛道下已存在同名一级节点' });
        }
        fields.push('name = ?');
        params.push(nm);
      } else if (track_id !== undefined) {
        const dup = await db.query(
          `SELECT id FROM sourcing_track_lv1 WHERE track_id = ? AND name = ? AND delete_mark = 0 AND id != ? LIMIT 1`,
          [targetTrackId, existing[0].name, id]
        );
        if (dup.length) {
          return res.status(400).json({ success: false, message: '目标赛道下已存在同名一级节点' });
        }
      }
      if (sort_order !== undefined) {
        fields.push('sort_order = ?');
        params.push(parseInt(sort_order, 10) || 0);
      }
      if (!fields.length) return res.json({ success: true });
      params.push(id);
      await db.execute(`UPDATE sourcing_track_lv1 SET ${fields.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv1 PUT]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '更新失败' });
    }
  });

  router.delete('/tracks/lv1/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      const l2rows = await db.query(`SELECT id FROM sourcing_track_lv2 WHERE lv1_id = ? AND delete_mark = 0`, [id]);
      const l2ids = l2rows.map((r) => r.id);
      await softDeleteLv3ForLv2Ids(l2ids);
      await db.execute(`UPDATE sourcing_track_lv2 SET delete_mark = 1 WHERE lv1_id = ?`, [id]);
      await db.execute(`UPDATE sourcing_track_lv1 SET delete_mark = 1 WHERE id = ?`, [id]);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks/lv1 DELETE]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '删除失败' });
    }
  });

  router.post('/tracks', requireProjectSourcingAccess, async (req, res) => {
    try {
      const { name, sort_order = 0 } = req.body || {};
      const nm = trimStr(name, 100);
      if (!nm) return res.status(400).json({ success: false, message: 'name 不能为空' });
      const insTr = await db.execute(`INSERT INTO sourcing_track (name, sort_order) VALUES (?,?)`, [
        nm,
        parseInt(sort_order, 10) || 0,
      ]);
      res.json({ success: true, data: { id: insTr.insertId } });
    } catch (e) {
      console.error('[project-sourcing/tracks POST]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '创建失败' });
    }
  });

  router.put('/tracks/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });
      const { name, sort_order } = req.body || {};
      const existing = await db.query(`SELECT id FROM sourcing_track WHERE id = ? AND delete_mark = 0 LIMIT 1`, [id]);
      if (!existing.length) return res.status(404).json({ success: false, message: '记录不存在' });

      const fields = [];
      const params = [];
      if (name !== undefined) {
        const nm = trimStr(name, 100);
        if (!nm) return res.status(400).json({ success: false, message: 'name 不能为空' });
        fields.push('name = ?');
        params.push(nm);
      }
      if (sort_order !== undefined) {
        fields.push('sort_order = ?');
        params.push(parseInt(sort_order, 10) || 0);
      }
      if (!fields.length) return res.json({ success: true });
      params.push(id);
      await db.execute(`UPDATE sourcing_track SET ${fields.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks PUT]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '更新失败' });
    }
  });

  router.delete('/tracks/:id', requireProjectSourcingAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ success: false, message: '无效 id' });

      const lv1Rows = await db.query(`SELECT id FROM sourcing_track_lv1 WHERE track_id = ? AND delete_mark = 0`, [id]);
      for (let i = 0; i < lv1Rows.length; i++) {
        const lid = lv1Rows[i].id;
        const l2rows = await db.query(`SELECT id FROM sourcing_track_lv2 WHERE lv1_id = ? AND delete_mark = 0`, [lid]);
        const l2ids = l2rows.map((r) => r.id);
        await softDeleteLv3ForLv2Ids(l2ids);
        await db.execute(`UPDATE sourcing_track_lv2 SET delete_mark = 1 WHERE lv1_id = ? AND delete_mark = 0`, [lid]);
      }
      await db.execute(`UPDATE sourcing_track_lv1 SET delete_mark = 1 WHERE track_id = ?`, [id]);
      await db.execute(`UPDATE sourcing_track SET delete_mark = 1 WHERE id = ?`, [id]);
      res.json({ success: true });
    } catch (e) {
      console.error('[project-sourcing/tracks DELETE]', e);
      res.status(500).json({ success: false, message: safeErrorMessage(e) || '删除失败' });
    }
  });
}

module.exports = { registerTrackRoutes };
