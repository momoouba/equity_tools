const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { runListingExchangeCrawler } = require('../../utils/上市进展/listingExchangeCrawler');
const { runListingMatchBatch } = require('../../utils/上市进展/listingMatchRunner');
const { updateListingScheduledTasks } = require('../../utils/上市进展/scheduledListingTasks');
const { encryptText, decryptText, maskToken } = require('../../utils/上市进展/listingSecret');
const { normalizeSourceType, buildTaskKey } = require('../../utils/上市进展/listingSourceType');
const { executeWithRetry } = require('../../utils/上市进展/listingRetry');
const { createExecutionLog, appendExecutionLogProgress, finishExecutionLog } = require('../../utils/上市进展/listingSyncExecutionLog');
const { syncNewShareCalendar } = require('../../utils/上市进展/newShareService');
const { syncGuidanceProgress } = require('../../utils/上市进展/guidanceProgressService');
const { syncOverseasFiling } = require('../../utils/上市进展/overseasFilingService');
const { createShanghaiDate, formatDateOnly } = require('../../utils/上市进展/listingBeijingDate');

const runningManualTaskKeys = new Set();
const DEFAULT_MIN_SYNC_DATE = '2026-01-01';
const LISTING_DEFAULT_CONFIG_TEMPLATES = [
  { name: '交易所IPO主爬虫', interface_type: 'crawler', news_interface_type: 'exchange_ipo', request_url: null },
  { name: '打新日历', interface_type: 'crawler', news_interface_type: 'new_share', request_url: null },
  {
    name: '证监会辅导备案',
    interface_type: 'crawler',
    news_interface_type: 'guidance_progress',
    request_url: 'https://eid.csrc.gov.cn/csrcfd/index.html',
  },
  {
    name: '境外上市备案审核',
    interface_type: 'api',
    news_interface_type: 'overseas_filing',
    request_url: process.env.OVERSEAS_FILING_FILE_URL || null,
  },
];

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

function normalizeYmd(v) {
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function maxYmd(a, b) {
  const aa = normalizeYmd(a);
  const bb = normalizeYmd(b);
  if (!aa) return bb;
  if (!bb) return aa;
  return aa >= bb ? aa : bb;
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
        id, name, interface_type, request_url, min_sync_date, cron_expression, last_sync_time, status, is_active, news_interface_type, skip_holiday,
        ifind_enabled, ifind_username, ifind_password, ifind_token, ifind_dr_code, ifind_query_params, ifind_fields, ifind_format, ifind_fallback_to_hkex
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.interface_type || 'crawler',
        body.request_url || null,
        normalizeYmd(body.min_sync_date) || DEFAULT_MIN_SYNC_DATE,
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

/** POST /listing-config/init-defaults */
async function initDefaultConfigs(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    // 兼容历史配置：初始化默认接口前，先清理已废弃的“新股五日表现”配置
    await db.execute(
      `DELETE FROM listing_data_config
       WHERE IFNULL(news_interface_type, '') = 'listed_performance'
          OR name = '新股五日表现'`
    );

    const existing = await db.query(
      `SELECT id, name, interface_type, news_interface_type, request_url FROM listing_data_config WHERE is_active = 1`
    );
    const existsSet = new Set(
      existing.map((r) => `${String(r.name || '').trim()}|${String(r.interface_type || '').trim()}|${String(r.news_interface_type || '').trim()}`)
    );

    const created = [];
    for (const tpl of LISTING_DEFAULT_CONFIG_TEMPLATES) {
      const key = `${tpl.name}|${tpl.interface_type}|${tpl.news_interface_type}`;
      if (existsSet.has(key)) {
        const hit = existing.find(
          (r) =>
            `${String(r.name || '').trim()}|${String(r.interface_type || '').trim()}|${String(r.news_interface_type || '').trim()}` ===
            key
        );
        const reqUrl = String(hit?.request_url || '').trim();
        const targetUrl = String(tpl.request_url || '').trim();
        if (hit?.id && !reqUrl && targetUrl) {
          await db.execute(`UPDATE listing_data_config SET request_url = ? WHERE id = ?`, [targetUrl, hit.id]);
        }
        continue;
      }
      const id = await generateId('listing_data_config');
      await db.execute(
        `INSERT INTO listing_data_config (
          id, name, interface_type, request_url, min_sync_date, cron_expression, last_sync_time, status, is_active, news_interface_type, skip_holiday,
          ifind_enabled, ifind_username, ifind_password, ifind_token, ifind_dr_code, ifind_query_params, ifind_fields, ifind_format, ifind_fallback_to_hkex
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          tpl.name,
          tpl.interface_type,
          tpl.request_url || null,
          DEFAULT_MIN_SYNC_DATE,
          '0 0 8 * * ? *',
          'active',
          1,
          tpl.news_interface_type,
          0,
          0,
          null,
          null,
          null,
          'p04920',
          'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
          'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y',
          'json',
          0,
        ]
      );
      created.push({ id, ...tpl });
    }

    await refreshListingCrons();
    return res.json({ success: true, data: { createdCount: created.length, created } });
  } catch (e) {
    console.error('initDefaultConfigs', e);
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
        name = ?, interface_type = ?, request_url = ?, min_sync_date = ?, cron_expression = ?, status = ?, is_active = ?, news_interface_type = ?, skip_holiday = ?,
        ifind_enabled = ?, ${ifindUsernameSql} ${ifindPasswordSql} ${ifindTokenSql}
        ifind_dr_code = ?, ifind_query_params = ?, ifind_fields = ?, ifind_format = ?, ifind_fallback_to_hkex = ?
       WHERE id = ?`,
      [
        body.name,
        body.interface_type,
        body.request_url,
        normalizeYmd(body.min_sync_date) || DEFAULT_MIN_SYNC_DATE,
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
        id, name, interface_type, request_url, min_sync_date, cron_expression, last_sync_time, last_sync_range_end, status, is_active, news_interface_type, skip_holiday,
        ifind_enabled, ifind_username, ifind_password, ifind_token, ifind_dr_code, ifind_query_params, ifind_fields, ifind_format, ifind_fallback_to_hkex
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        `${src.name}（副本）`,
        src.interface_type,
        src.request_url,
        normalizeYmd(src.min_sync_date) || DEFAULT_MIN_SYNC_DATE,
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
 * body: { startDate, endDate? } — 打新日历仅需 startDate（取「申购/上市日期」> startDate）；其余类型仍为闭区间
 */
async function syncListingConfig(req, res) {
  try {
    const user = await assertAdminListing(req, res);
    if (!user) return;

    const { startDate, endDate } = req.body || {};
    if (!startDate) {
      return res.status(400).json({ success: false, message: '请提供 startDate（YYYY-MM-DD）' });
    }

    const rows = await db.query(`SELECT * FROM listing_data_config WHERE id = ? LIMIT 1`, [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const cfg = rows[0];
    const sourceType = normalizeSourceType(cfg);
    const endDateFinal =
      sourceType === 'new_share'
        ? String(endDate || '').trim().slice(0, 10) || '2099-12-31'
        : String(endDate || '').trim().slice(0, 10);
    if (sourceType !== 'new_share' && !endDateFinal) {
      return res.status(400).json({ success: false, message: '请提供 startDate、endDate（YYYY-MM-DD）' });
    }
    const minSyncDate = normalizeYmd(cfg.min_sync_date) || DEFAULT_MIN_SYNC_DATE;
    const effectiveStart = maxYmd(startDate, minSyncDate);
    if (effectiveStart > endDateFinal) {
      return res.status(400).json({
        success: false,
        message: `开始日期早于配置最早同步日期，且裁剪后区间无效（min_sync_date=${minSyncDate}）`,
      });
    }
    const taskKey = buildTaskKey(cfg, effectiveStart, endDateFinal);
    if (runningManualTaskKeys.has(taskKey)) {
      return res.status(409).json({ success: false, message: '同源同窗口任务正在执行，请稍后重试' });
    }
    runningManualTaskKeys.add(taskKey);

    let logId = null;
    try {
      console.log(
        `[上市进展手动同步] 收到触发请求 cfg=${cfg.id} name=${cfg.name || '-'} sourceType=${sourceType} start=${startDate} effectiveStart=${effectiveStart} end=${endDateFinal} operator=${user.account || user.id}`
      );
      logId = await createExecutionLog({
        configId: cfg.id,
        configName: cfg.name,
        sourceType,
        triggerType: 'manual',
        windowStart: effectiveStart,
        windowEnd: endDateFinal,
        taskKey,
      });
      console.log(`[上市进展手动同步] 已创建执行日志 logId=${logId} taskKey=${taskKey}`);
      await appendExecutionLogProgress(
        logId,
        `收到手动触发，配置=${cfg.name || cfg.id}，区间=${effectiveStart}~${endDateFinal}，操作者=${user.account || user.id}`
      );

      const wrapped = await executeWithRetry(
        async (attempt) => {
          console.log(
            `[上市进展手动同步] attempt=${attempt} sourceType=${sourceType} cfg=${cfg.id} range=${effectiveStart}~${endDateFinal} minSyncDate=${minSyncDate} operator=${user.account || user.id}`
          );
          if (sourceType === 'new_share') {
            return syncNewShareCalendar({
              from: effectiveStart,
              to: endDateFinal,
              issueDateAfterExclusive: effectiveStart,
              updateDateAfterExclusive: effectiveStart,
              minSyncDate,
              triggerType: 'manual',
              operatorUserId: user.id,
              logTag: `[上市进展手动同步][${cfg.name || cfg.id}][打新日历]`,
              progressReporter: async (msg) => {
                await appendExecutionLogProgress(logId, msg);
              },
            });
          }
          if (sourceType === 'guidance_progress') {
            return syncGuidanceProgress({
              from: effectiveStart,
              to: endDateFinal,
              source: 'html',
              sourceUrl: String(cfg.request_url || '').trim(),
              triggerType: 'manual',
              operatorUserId: user.id,
              logTag: `[上市进展手动同步][${cfg.name || cfg.id}][辅导备案]`,
            });
          }
          if (sourceType === 'overseas_filing') {
            return syncOverseasFiling({
              from: effectiveStart,
              to: endDateFinal,
              source: 'url',
              sourceUrl: String(cfg.request_url || '').trim(),
              triggerType: 'manual',
              operatorUserId: user.id,
              logTag: `[上市进展手动同步][${cfg.name || cfg.id}][境外备案审核]`,
            });
          }
          if (sourceType === 'exchange_crawler') {
            const crawlLogTag = `[上市进展手动同步][${cfg.name || cfg.id}][交易所爬虫]`;
            const crawlerResult = await runListingExchangeCrawler({
              startDate: effectiveStart,
              endDate: endDateFinal,
              logTag: crawlLogTag,
              config: cfg,
            });
            const matchResult = await runListingMatchBatch({
              startDate: effectiveStart,
              endDate: endDateFinal,
              restrictProjectUserId: null,
            });
            return { ...crawlerResult, matchResult };
          }
          throw new Error(`未识别来源类型: ${sourceType}`);
        },
        {
          maxAttempts: 5,
          baseDelayMs: 1000,
          factor: 2,
          onRetry: ({ attempt, delay, error }) => {
            console.warn(
              `[上市进展手动同步] retry=${attempt + 1} delay=${delay}ms cfg=${cfg.id} err=${error.message}`
            );
            appendExecutionLogProgress(
              logId,
              `执行重试 attempt=${attempt + 1} delay=${delay}ms err=${String(error.message || error)}`
            ).catch(() => {});
          },
        }
      );

      const result = wrapped.result || {};
      const rangeEndStored =
        sourceType === 'new_share' ? formatDateOnly(createShanghaiDate()) : endDateFinal;
      await db.execute(
        `UPDATE listing_data_config SET last_sync_time = NOW(), last_sync_range_end = ? WHERE id = ?`,
        [rangeEndStored, cfg.id]
      );
      await finishExecutionLog(logId, {
        status: 'success',
        retryCount: Number(wrapped.attemptCount || 1) - 1,
        insertedCount: Number(result.inserted || 0),
        updatedCount: Number(result.updated || result.updatedEarlier || 0),
        skippedCount: Number(result.skipped || 0),
        dedupHits: Number(result.skipped || 0),
      });
      return res.json({
        success: true,
        message: `同步完成（source=${sourceType}）：新增 ${result.inserted || 0}，更新 ${result.updated || result.updatedEarlier || 0}，跳过 ${result.skipped || 0}`,
        data: result,
      });
    } catch (syncErr) {
      if (logId) {
        await appendExecutionLogProgress(logId, `执行失败：${String(syncErr.message || syncErr)}`);
      }
      if (logId) {
        await finishExecutionLog(logId, {
          status: 'failed',
          retryCount: Number(syncErr.attemptCount || 5),
          errorMessage: String(syncErr.message || syncErr),
        });
      }
      throw syncErr;
    } finally {
      runningManualTaskKeys.delete(taskKey);
    }
  } catch (e) {
    console.error('syncListingConfig', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerListingConfigRoutes(router) {
  router.get('/listing-config', listConfig);
  router.post('/listing-config', createConfig);
  router.post('/listing-config/init-defaults', initDefaultConfigs);
  router.put('/listing-config/:id', updateConfig);
  router.delete('/listing-config/:id', deleteConfig);
  router.post('/listing-config/:id/copy', copyListingConfig);
  router.post('/listing-config/:id/sync', syncListingConfig);
}

module.exports = { registerListingConfigRoutes };
