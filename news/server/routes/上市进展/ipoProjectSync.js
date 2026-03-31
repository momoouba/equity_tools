const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getUserFromHeader, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { queryExternal } = require('../../utils/externalDb');
const {
  assertReadOnlySql,
  ensureExternalPool,
  formatExternalSqlError,
  runIpoProjectSqlSyncForUser,
} = require('../../utils/上市进展/ipoProjectSqlSyncRunner');
const { updateListingScheduledTasks } = require('../../utils/上市进展/scheduledListingTasks');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无上市进展访问权限' });
}

async function getSqlSyncSetting(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const configId = (req.query?.external_db_config_id || '').trim();
    const rows = configId
      ? await db.query(
          `SELECT id, user_id, external_db_config_id, sql_text, is_enabled, cron_expression, column_map, created_at, updated_at
           FROM ipo_project_sql_sync_setting
           WHERE user_id = ? AND external_db_config_id = ?
           LIMIT 1`,
          [user.id, configId]
        )
      : await db.query(
          `SELECT id, user_id, external_db_config_id, sql_text, is_enabled, cron_expression, column_map, created_at, updated_at
           FROM ipo_project_sql_sync_setting
           WHERE user_id = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
          [user.id]
        );
    if (!rows.length) {
      return res.json({
        success: true,
        data: {
          external_db_config_id: '',
          sql_text: '',
          is_enabled: 1,
          cron_expression: '',
        },
      });
    }
    const row = rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        is_enabled: row.is_enabled === 0 ? 0 : 1,
      },
    });
  } catch (e) {
    console.error('getSqlSyncSetting', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function putSqlSyncSetting(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const body = req.body || {};
    const external_db_config_id = body.external_db_config_id || null;
    const sql_text = (body.sql_text || '').trim();
    const cron_expression = (body.cron_expression || '').trim();
    const is_enabled =
      body.is_enabled === false || body.is_enabled === 0 || body.is_enabled === '0' ? 0 : 1;

    if (sql_text) assertReadOnlySql(sql_text);

    if (!external_db_config_id) {
      return res.status(400).json({ success: false, message: '请选择业务数据库连接' });
    }

    const existing = await db.query(
      `SELECT id FROM ipo_project_sql_sync_setting WHERE user_id = ? AND external_db_config_id = ? LIMIT 1`,
      [user.id, external_db_config_id]
    );

    if (existing.length) {
      await db.execute(
        `UPDATE ipo_project_sql_sync_setting SET
          external_db_config_id = ?, sql_text = ?, is_enabled = ?, cron_expression = ?
         WHERE user_id = ? AND external_db_config_id = ?`,
        [external_db_config_id, sql_text || null, is_enabled, cron_expression || null, user.id, external_db_config_id]
      );
    } else {
      const id = await generateId('ipo_project_sql_sync_setting');
      await db.execute(
        `INSERT INTO ipo_project_sql_sync_setting (id, user_id, external_db_config_id, sql_text, is_enabled, cron_expression, column_map)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user.id, external_db_config_id, sql_text || null, is_enabled, cron_expression || null, JSON.stringify({})]
      );
    }

    const saved = await db.query(
      `SELECT * FROM ipo_project_sql_sync_setting WHERE user_id = ? AND external_db_config_id = ? LIMIT 1`,
      [user.id, external_db_config_id]
    );
    await updateListingScheduledTasks();
    return res.json({ success: true, data: saved[0] });
  } catch (e) {
    console.error('putSqlSyncSetting', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

async function postSqlSyncPreview(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const body = req.body || {};
    const configId = body.external_db_config_id;
    const sql_text = (body.sql_text || '').trim();
    if (!configId) return res.status(400).json({ success: false, message: '请选择业务数据库连接' });
    if (!sql_text) return res.status(400).json({ success: false, message: '请填写 SQL' });
    assertReadOnlySql(sql_text);

    await ensureExternalPool(configId);
    const rows = await queryExternal(configId, sql_text, []);
    const sample = Array.isArray(rows) ? rows.slice(0, 30) : [];
    return res.json({
      success: true,
      data: { rowCount: Array.isArray(rows) ? rows.length : 0, sample },
    });
  } catch (e) {
    console.error('postSqlSyncPreview', e);
    return res.status(400).json({
      success: false,
      message: `SQL 预览失败：${formatExternalSqlError(e)}`,
    });
  }
}

async function postSqlSyncRun(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const body = req.body || {};
    let external_db_config_id = body.external_db_config_id;
    let sql_text = (body.sql_text || '').trim();
    let is_enabled = body.is_enabled;

    if (!external_db_config_id || !sql_text || is_enabled === undefined) {
      const saved = await db.query(
        `SELECT * FROM ipo_project_sql_sync_setting
         WHERE user_id = ? AND external_db_config_id = ?
         LIMIT 1`,
        [user.id, external_db_config_id]
      );
      if (saved.length) {
        const s = saved[0];
        if (!external_db_config_id) external_db_config_id = s.external_db_config_id;
        if (!sql_text) sql_text = (s.sql_text || '').trim();
        if (is_enabled === undefined) is_enabled = s.is_enabled;
      }
    }
    const result = await runIpoProjectSqlSyncForUser({
      userId: user.id,
      external_db_config_id,
      sql_text,
      is_enabled,
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    console.error('postSqlSyncRun', e);
    return res.status(400).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerIpoProjectSyncRoutes(router) {
  router.get('/ipo-project/sql-sync-setting', getSqlSyncSetting);
  router.put('/ipo-project/sql-sync-setting', putSqlSyncSetting);
  router.post('/ipo-project/sql-sync-preview', postSqlSyncPreview);
  router.post('/ipo-project/sql-sync-run', postSqlSyncRun);
}

module.exports = { registerIpoProjectSyncRoutes };
