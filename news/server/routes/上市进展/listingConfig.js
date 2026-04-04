const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { runListingExchangeCrawler } = require('../../utils/上市进展/listingExchangeCrawler');
const { runListingMatchBatch } = require('../../utils/上市进展/listingMatchRunner');
const { updateListingScheduledTasks } = require('../../utils/上市进展/scheduledListingTasks');
const { encryptText, decryptText, maskToken } = require('../../utils/上市进展/listingSecret');

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

/** 对单条配置记录进行敏感字段脱敏处理 */
function maskConfigRow(row) {
  if (!row) return row;
  // 解密用户名并 mask 显示
  let maskedUsername = '';
  if (row.ifind_username) {
    try {
      const decrypted = decryptText(row.ifind_username);
      maskedUsername = maskToken(decrypted);
    } catch {
      maskedUsername = '******';
    }
  }
  row.ifind_username = maskedUsername;
  row.ifind_password = '';
  row.ifind_token = '';
  row.ifind_username_configured = !!row.ifind_username_configured || maskedUsername !== '';
  row.ifind_password_configured = !!row.ifind_password_configured || (row.ifind_password_configured === undefined && !!row.ifind_password);
  row.ifind_token_configured = !!row.ifind_token_configured || (row.ifind_token_configured === undefined && !!row.ifind_token);
  return row;
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
    const safeRows = rows.map((r) => {
      const row = { ...r };
      // 保存原始值用于判断是否已配置
      row.ifind_username_configured = !!r.ifind_username;
      row.ifind_password_configured = !!r.ifind_password;
      row.ifind_token_configured = !!r.ifind_token;
      return maskConfigRow(row);
    });
    return res.json({ success: true, data: safeRows });
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
    const encryptedIfindUsername = body.ifind_username ? encryptText(String(body.ifind_username).trim()) : null;
    const encryptedIfindPassword = body.ifind_password ? encryptText(String(body.ifind_password).trim()) : null;
    const encryptedIfindToken = body.ifind_token ? encryptText(String(body.ifind_token).trim()) : null;
    await db.execute(
      `INSERT INTO listing_data_config (
        id, name, interface_type, request_url, cron_expression, last_sync_time, status, is_active, news_interface_type, skip_holiday,
        ifind_enabled, ifind_username, ifind_password, ifind_token, ifind_dr_code, ifind_query_params, ifind_fields, ifind_format, ifind_fallback_to_hkex
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        body.ifind_enabled === true || body.ifind_enabled === 1 || body.ifind_enabled === '1' ? 1 : 0,
        encryptedIfindUsername,
        encryptedIfindPassword,
        encryptedIfindToken,
        (body.ifind_dr_code || 'p04920').trim(),
        (body.ifind_query_params || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0').trim(),
        (
          body.ifind_fields ||
          'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y'
        ).trim(),
        (body.ifind_format || 'json').trim(),
        body.ifind_fallback_to_hkex === true || body.ifind_fallback_to_hkex === 1 || body.ifind_fallback_to_hkex === '1'
          ? 1
          : 0,
      ]
    );
    const row = await db.query(`SELECT * FROM listing_data_config WHERE id = ?`, [id]);
    if (row[0]) {
      row[0].ifind_username_configured = !!row[0].ifind_username;
      row[0].ifind_password_configured = !!row[0].ifind_password;
      row[0].ifind_token_configured = !!row[0].ifind_token;
      maskConfigRow(row[0]);
    }
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
    const updateIfindUsername = Object.prototype.hasOwnProperty.call(body, 'ifind_username');
    const updateIfindPassword = Object.prototype.hasOwnProperty.call(body, 'ifind_password');
    const updateIfindToken = Object.prototype.hasOwnProperty.call(body, 'ifind_token');
    const ifindUsernameSql = updateIfindUsername ? 'ifind_username = ?,' : '';
    const ifindPasswordSql = updateIfindPassword ? 'ifind_password = ?,' : '';
    const ifindTokenSql = updateIfindToken ? 'ifind_token = ?,' : '';
    const ifindUsernameVal = updateIfindUsername
      ? body.ifind_username
        ? encryptText(String(body.ifind_username).trim())
        : null
      : undefined;
    const ifindPasswordVal = updateIfindPassword
      ? body.ifind_password
        ? encryptText(String(body.ifind_password).trim())
        : null
      : undefined;
    const ifindTokenVal = updateIfindToken
      ? body.ifind_token
        ? encryptText(String(body.ifind_token).trim())
        : null
      : undefined;
    const ifindEnabled = body.ifind_enabled === true || body.ifind_enabled === 1 || body.ifind_enabled === '1' ? 1 : 0;
    await db.execute(
      `UPDATE listing_data_config SET
        name = ?, interface_type = ?, request_url = ?, cron_expression = ?, status = ?, is_active = ?, news_interface_type = ?, skip_holiday = ?,
        ifind_enabled = ?, ${ifindUsernameSql} ${ifindPasswordSql} ${ifindTokenSql}
        ifind_dr_code = ?, ifind_query_params = ?, ifind_fields = ?, ifind_format = ?, ifind_fallback_to_hkex = ?
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
        ifindEnabled,
        ...(updateIfindUsername ? [ifindUsernameVal] : []),
        ...(updateIfindPassword ? [ifindPasswordVal] : []),
        ...(updateIfindToken ? [ifindTokenVal] : []),
        (body.ifind_dr_code || 'p04920').trim(),
        (body.ifind_query_params || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0').trim(),
        (
          body.ifind_fields ||
          'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y'
        ).trim(),
        (body.ifind_format || 'json').trim(),
        body.ifind_fallback_to_hkex === true || body.ifind_fallback_to_hkex === 1 || body.ifind_fallback_to_hkex === '1'
          ? 1
          : 0,
        id,
      ]
    );
    const row = await db.query(`SELECT * FROM listing_data_config WHERE id = ?`, [id]);
    if (row[0]) {
      row[0].ifind_username_configured = !!row[0].ifind_username;
      row[0].ifind_password_configured = !!row[0].ifind_password;
      row[0].ifind_token_configured = !!row[0].ifind_token;
      maskConfigRow(row[0]);
    }
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
        id, name, interface_type, request_url, cron_expression, last_sync_time, last_sync_range_end, status, is_active, news_interface_type, skip_holiday,
        ifind_enabled, ifind_username, ifind_password, ifind_token, ifind_dr_code, ifind_query_params, ifind_fields, ifind_format, ifind_fallback_to_hkex
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        src.ifind_enabled || 0,
        src.ifind_username || null,
        src.ifind_password || null,
        src.ifind_token || null,
        src.ifind_dr_code || 'p04920',
        src.ifind_query_params || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
        src.ifind_fields ||
          'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y',
        src.ifind_format || 'json',
        src.ifind_fallback_to_hkex || 0,
      ]
    );
    const row = await db.query(`SELECT * FROM listing_data_config WHERE id = ?`, [newId]);
    if (row[0]) {
      row[0].ifind_username_configured = !!row[0].ifind_username;
      row[0].ifind_password_configured = !!row[0].ifind_password;
      row[0].ifind_token_configured = !!row[0].ifind_token;
      maskConfigRow(row[0]);
    }
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
      const crawlLogTag = `[上市进展手动同步][${cfg.name || cfg.id}][交易所爬虫]`;
      console.log(
        `${crawlLogTag} 开始执行，配置=${cfg.id}，区间=${startDate}~${endDate}，触发人=${user.account || user.id}`
      );
      const result = await runListingExchangeCrawler({ startDate, endDate, logTag: crawlLogTag, config: cfg });
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
      const errs = result.exchangeErrors || [];
      console.log(
        `${crawlLogTag} 执行完成：抓取=${f.total ?? 0}（深交所${f.szse ?? 0}/上交所${f.sse ?? 0}/北交所${f.bse ?? 0}/港交所${f.hkex ?? 0}），` +
          `入库新增=${result.inserted} 更正更早=${result.updatedEarlier ?? 0} 跳过=${result.skipped}，` +
          `项目匹配写入=${matchResult.inserted} 进展=${matchResult.progressCount} 项目=${matchResult.projectCount}`
      );
      if (errs.length) {
        console.warn(
          `${crawlLogTag} 部分交易所拉取失败: ${errs.map((e) => `${e.exchange}:${e.message}`).join(' | ')}`
        );
      }
      return res.json({
        success: true,
        message: `同步完成：抓取 ${f.total ?? 0} 条（深交所 ${f.szse ?? 0}、上交所 ${f.sse ?? 0}、北交所 ${f.bse ?? 0}、港交所 ${f.hkex ?? 0}），入库新增 ${result.inserted}、更正更早快照 ${result.updatedEarlier ?? 0}、跳过 ${result.skipped}；匹配写入 ${matchResult.inserted} 条`,
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
