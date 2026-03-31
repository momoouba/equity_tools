const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { runListingExchangeCrawler } = require('../../utils/上市进展/listingExchangeCrawler');
const { runListingMatchBatch } = require('../../utils/上市进展/listingMatchRunner');
const { updateListingScheduledTasks } = require('../../utils/上市进展/scheduledListingTasks');

async function refreshListingCrons() {
  try {
    await updateListingScheduledTasks();
  } catch (e) {
    console.warn('[上市进展] 刷新定时任务失败:', e.message);
  }
}

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '仅管理员可配置' });
}

async function assertAdminListing(req, res) {
  const user = await getUserFromHeader(req);
  if (!user) {
    unauthorized(res);
    return null;
  }
  if (!isAdminAccount(user.account)) {
    forbidden(res);
    return null;
  }
  if (!(await canAccessListing(user.id, user.account))) {
    forbidden(res);
    return null;
  }
  return user;
}

async function listConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    const rows = await db.query(`SELECT * FROM listing_data_config ORDER BY created_at DESC`);
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function createConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    const body = req.body || {};
    const id = await generateId('listing_data_config');
    const skip_holiday =
      body.skip_holiday === true || body.skip_holiday === 1 || body.skip_holiday === '1' ? 1 : 0;
    await db.execute(
      `INSERT INTO listing_data_config (
        id, name, interface_type, request_url, cron_expression, last_sync_time, status, is_active, news_interface_type, skip_holiday
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.interface_type || 'crawler',
        body.request_url || null,
        body.cron_expression || null,
        body.status || 'draft',
        body.is_active !== undefined ? body.is_active : 1,
        body.news_interface_type || null,
        skip_holiday,
      ]
    );
    const row = await db.query(`SELECT * FROM listing_data_config WHERE id = ?`, [id]);
    await refreshListingCrons();
    return res.json({ success: true, data: row[0] });
  } catch (e) {
    console.error('createConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function updateConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    const id = req.params.id;
    const body = req.body || {};
    const skip_holiday =
      body.skip_holiday === true || body.skip_holiday === 1 || body.skip_holiday === '1' ? 1 : 0;
    await db.execute(
      `UPDATE listing_data_config SET
        name = ?, interface_type = ?, request_url = ?, cron_expression = ?, status = ?, is_active = ?, news_interface_type = ?, skip_holiday = ?
       WHERE id = ?`,
      [
        body.name,
        body.interface_type,
        body.request_url,
        body.cron_expression,
        body.status,
        body.is_active,
        body.news_interface_type,
        skip_holiday,
        id,
      ]
    );
    const row = await db.query(`SELECT * FROM listing_data_config WHERE id = ?`, [id]);
    await refreshListingCrons();
    return res.json({ success: true, data: row[0] });
  } catch (e) {
    console.error('updateConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function deleteConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    await db.execute(`DELETE FROM listing_data_config WHERE id = ?`, [req.params.id]);
    await refreshListingCrons();
    return res.json({ success: true });
  } catch (e) {
    console.error('deleteConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/** POST /listing-config/:id/copy */
async function copyListingConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    const rows = await db.query(`SELECT * FROM listing_data_config WHERE id = ? LIMIT 1`, [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const src = rows[0];
    const newId = await generateId('listing_data_config');
    const skip_holiday = src.skip_holiday === 1 || src.skip_holiday === true ? 1 : 0;
    await db.execute(
      `INSERT INTO listing_data_config (
        id, name, interface_type, request_url, cron_expression, last_sync_time, last_sync_range_end, status, is_active, news_interface_type, skip_holiday
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      [
        newId,
        `${src.name}（副本）`,
        src.interface_type,
        src.request_url,
        src.cron_expression,
        src.status || 'draft',
        src.is_active,
        src.news_interface_type,
        skip_holiday,
      ]
    );
    const row = await db.query(`SELECT * FROM listing_data_config WHERE id = ?`, [newId]);
    await refreshListingCrons();
    return res.json({ success: true, data: row[0] });
  } catch (e) {
    console.error('copyListingConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/**
 * POST /listing-config/:id/sync
 * body: { startDate, endDate } — 与新闻接口配置手动同步一致，闭区间
 * 爬虫类型：三大交易所公开接口入库；数据接口类型暂返回 501
 */
async function syncListingConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    const { startDate, endDate } = req.body || {};
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: '请提供 startDate、endDate（YYYY-MM-DD）' });
    }

    const rows = await db.query(`SELECT * FROM listing_data_config WHERE id = ? LIMIT 1`, [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const cfg = rows[0];
    const type = (cfg.interface_type || '').toLowerCase();

    if (type === 'crawler') {
      const result = await runListingExchangeCrawler({ startDate, endDate });
      const matchResult = await runListingMatchBatch({
        startDate,
        endDate,
        restrictProjectUserId: null,
      });
      await db.execute(
        `UPDATE listing_data_config SET last_sync_time = NOW(), last_sync_range_end = ? WHERE id = ?`,
        [endDate, cfg.id]
      );
      const f = result.fetched || {};
      return res.json({
        success: true,
        message: `同步完成：抓取 ${f.total ?? 0} 条（深交所 ${f.szse ?? 0}、上交所 ${f.sse ?? 0}、北交所 ${f.bse ?? 0}），入库新增 ${result.inserted}、跳过 ${result.skipped}；匹配写入 ${matchResult.inserted} 条`,
        data: { crawler: result, match: matchResult },
      });
    }

    if (type === 'api') {
      return res.status(501).json({
        success: false,
        message: '数据接口类同步尚未接入（可后续对接上海国际集团/企查查等）',
      });
    }

    return res.status(400).json({ success: false, message: `未知的 interface_type: ${cfg.interface_type}` });
  } catch (e) {
    console.error('syncListingConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerListingConfigRoutes(router) {
  router.get('/listing-config', listConfig);
  router.post('/listing-config', createConfig);
  router.put('/listing-config/:id', updateConfig);
  router.delete('/listing-config/:id', deleteConfig);
  router.post('/listing-config/:id/copy', copyListingConfig);
  router.post('/listing-config/:id/sync', syncListingConfig);
}

module.exports = { registerListingConfigRoutes };
