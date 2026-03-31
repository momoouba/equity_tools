const cron = require('node-cron');
const db = require('../../db');
const { runListingExchangeCrawler } = require('./listingExchangeCrawler');
const { runListingMatchBatch } = require('./listingMatchRunner');
const { runIpoProjectSqlSyncForUser } = require('./ipoProjectSqlSyncRunner');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('./listingBeijingDate');

const scheduledTasks = new Map();
const sqlSyncScheduledTasks = new Map();

function convertQuartzCronToNodeCron(quartzCron) {
  if (!quartzCron || typeof quartzCron !== 'string') {
    return null;
  }
  const parts = quartzCron.trim().split(/\s+/);
  if (parts.length === 5) {
    return quartzCron.trim();
  }
  if (parts.length === 6) {
    return quartzCron.trim();
  }
  if (parts.length === 7) {
    const [, minute, hour, day, month, weekday] = parts;
    let convertedDay = day === '?' ? '*' : day;
    let convertedWeekday = weekday;
    if (weekday === '?') {
      convertedWeekday = '*';
    } else if (weekday && weekday !== '*') {
      if (weekday.includes(',')) {
        convertedWeekday = weekday
          .split(',')
          .map((w) => {
            const wNum = parseInt(w.trim(), 10);
            if (wNum >= 1 && wNum <= 7) {
              return (wNum - 1).toString();
            }
            return w.trim();
          })
          .join(',');
      } else {
        const wNum = parseInt(weekday, 10);
        if (wNum >= 1 && wNum <= 7) {
          convertedWeekday = (wNum - 1).toString();
        }
      }
    }
    return `${minute} ${hour} ${convertedDay} ${month} ${convertedWeekday}`;
  }
  return null;
}

async function isWorkdayBeijing(date) {
  const dateStr = formatDateOnly(date);
  try {
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    if (rows.length > 0) {
      return rows[0].is_workday === 1;
    }
  } catch (e) {
    console.warn('[上市进展定时] 查询节假日失败:', e.message);
  }
  const bj = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const dow = bj.getDay();
  return dow !== 0 && dow !== 6;
}

/**
 * 计算本次定时同步的闭区间 [startDate, endDate]（YYYY-MM-DD，北京时间）
 * - endDate 为「执行日」的前一自然日（抓取前一日语义）
 * - startDate：上次成功同步的 last_sync_range_end 的下一自然日；无记录则仅同步 endDate 当日
 */
function computeScheduledSyncRange(config, baseRunDate) {
  const endDateObj = addDaysCalendar(baseRunDate, -1);
  const endDate = formatDateOnly(endDateObj);

  let startDate = endDate;
  if (config.last_sync_range_end) {
    const le = String(config.last_sync_range_end).slice(0, 10);
    const lastNext = addDaysCalendar(new Date(`${le}T12:00:00+08:00`), 1);
    startDate = formatDateOnly(lastNext);
  }

  if (startDate > endDate) {
    return { startDate: null, endDate: null, reason: 'no-range' };
  }
  return { startDate, endDate, reason: null };
}

async function executeListingSyncTask(configId) {
  console.log(`[上市进展定时] 开始执行配置 ${configId}`);
  const rows = await db.query(
    `SELECT * FROM listing_data_config WHERE id = ? AND is_active = 1`,
    [configId]
  );
  if (!rows.length) {
    console.log(`[上市进展定时] 配置 ${configId} 不存在或未启用，跳过`);
    return;
  }
  const cfg = rows[0];
  const baseRunDate = createShanghaiDate();

  const skipHoliday = cfg.skip_holiday === 1 || cfg.skip_holiday === true;
  if (skipHoliday) {
    const workday = await isWorkdayBeijing(baseRunDate);
    if (!workday) {
      const ds = formatDateOnly(baseRunDate);
      console.log(`[上市进展定时] ${ds} 为节假日且已开启跳过，本次不执行`);
      return;
    }
  }

  const { startDate, endDate, reason } = computeScheduledSyncRange(cfg, baseRunDate);
  if (reason === 'no-range' || !startDate || !endDate) {
    console.log(`[上市进展定时] 无需同步（日期区间为空）`);
    return;
  }

  console.log(`[上市进展定时] 同步区间 ${startDate} ~ ${endDate}（北京时间闭区间）`);

  try {
    const type = (cfg.interface_type || '').toLowerCase();
    if (type === 'crawler') {
      const result = await runListingExchangeCrawler({ startDate, endDate });
      await db.execute(
        `UPDATE listing_data_config SET last_sync_time = NOW(), last_sync_range_end = ? WHERE id = ?`,
        [endDate, cfg.id]
      );
      const f = result.fetched || {};
      console.log(
        `[上市进展定时] 交易所爬虫完成 抓取=${f.total ?? 0}(深${f.szse ?? 0}/沪${f.sse ?? 0}/北${f.bse ?? 0}) inserted=${result.inserted} skipped=${result.skipped}`
      );

      const matchResult = await runListingMatchBatch({
        startDate,
        endDate,
        restrictProjectUserId: null,
      });
      console.log(
        `[上市进展定时] 匹配完成 inserted=${matchResult.inserted} progress=${matchResult.progressCount} projects=${matchResult.projectCount}`
      );
    } else if (type === 'api') {
      console.warn(`[上市进展定时] 数据接口类型尚未实现自动同步，配置 ${configId}`);
    }
  } catch (e) {
    console.error(`[上市进展定时] 执行失败:`, e);
    try {
      const admins = await db.query(
        `SELECT id, email FROM users WHERE account = 'admin' LIMIT 1`
      );
      const to = process.env.LISTING_ALERT_EMAIL || admins[0]?.email;
      const ec = await db.query(
        `SELECT ec.id FROM email_config ec
         INNER JOIN applications a ON ec.app_id = a.id
         WHERE BINARY a.app_name = BINARY ? LIMIT 1`,
        ['上市进展']
      );
      if (to && ec.length) {
        const { sendMailWithConfig } = require('../sendMailWithConfig');
        await sendMailWithConfig({
          emailConfigId: ec[0].id,
          toEmail: to,
          subject: '[上市进展] 定时同步失败',
          html: `<p>配置 ID: ${configId}</p><pre>${String(e.message || e)}</pre>`,
          userId: admins[0]?.id || null,
        });
      }
    } catch (alertErr) {
      console.warn('[上市进展定时] 告警邮件未发送:', alertErr.message);
    }
  }
}

async function updateListingScheduledTasks() {
  try {
    console.log('[上市进展定时] 更新定时任务...');
    scheduledTasks.forEach((task) => {
      if (task && task.destroy) task.destroy();
    });
    scheduledTasks.clear();
    sqlSyncScheduledTasks.forEach((task) => {
      if (task && task.destroy) task.destroy();
    });
    sqlSyncScheduledTasks.clear();

    const configs = await db.query(
      `SELECT * FROM listing_data_config
       WHERE is_active = 1
         AND cron_expression IS NOT NULL
         AND TRIM(cron_expression) != ''`
    );

    for (const config of configs) {
      const nodeCron = convertQuartzCronToNodeCron(config.cron_expression);
      if (!nodeCron || !cron.validate(nodeCron)) {
        console.warn(`[上市进展定时] 配置 ${config.id} Cron 无效: ${config.cron_expression}`);
        continue;
      }
      const task = cron.schedule(
        nodeCron,
        async () => {
          console.log(`[上市进展定时] Cron 触发 配置=${config.id}`);
          await executeListingSyncTask(config.id);
        },
        { scheduled: true, timezone: 'Asia/Shanghai' }
      );
      scheduledTasks.set(config.id, task);
      console.log(`[上市进展定时] 已注册 ${config.id} -> ${nodeCron}`);
    }

    const sqlSettings = await db.query(
      `SELECT id, user_id, external_db_config_id, sql_text, is_enabled, cron_expression
       FROM ipo_project_sql_sync_setting
       WHERE is_enabled = 1
         AND external_db_config_id IS NOT NULL
         AND sql_text IS NOT NULL
         AND TRIM(sql_text) != ''
         AND cron_expression IS NOT NULL
         AND TRIM(cron_expression) != ''`
    );
    for (const cfg of sqlSettings) {
      const nodeCron = convertQuartzCronToNodeCron(cfg.cron_expression);
      if (!nodeCron || !cron.validate(nodeCron)) {
        console.warn(`[上市进展SQL定时] 配置 ${cfg.id} Cron 无效: ${cfg.cron_expression}`);
        continue;
      }
      const task = cron.schedule(
        nodeCron,
        async () => {
          try {
            console.log(`[上市进展SQL定时] Cron 触发 配置=${cfg.id} 用户=${cfg.user_id}`);
            const result = await runIpoProjectSqlSyncForUser({
              userId: cfg.user_id,
              external_db_config_id: cfg.external_db_config_id,
              sql_text: cfg.sql_text,
              is_enabled: cfg.is_enabled,
            });
            console.log(
              `[上市进展SQL定时] 执行完成 配置=${cfg.id} inserted=${result.inserted ?? 0} updated=${result.updated ?? 0} skipped=${result.skipped ?? 0} total=${result.total ?? 0}`
            );
          } catch (err) {
            console.error(`[上市进展SQL定时] 执行失败 配置=${cfg.id}:`, err.message || err);
          }
        },
        { scheduled: true, timezone: 'Asia/Shanghai' }
      );
      sqlSyncScheduledTasks.set(cfg.id, task);
      console.log(`[上市进展SQL定时] 已注册 ${cfg.id} -> ${nodeCron}`);
    }
    console.log(`[上市进展定时] 抓取任务 ${scheduledTasks.size} 个，SQL同步任务 ${sqlSyncScheduledTasks.size} 个`);
  } catch (e) {
    console.error('[上市进展定时] 更新失败:', e);
  }
}

async function initializeListingScheduledTasks() {
  await updateListingScheduledTasks();
}

module.exports = {
  initializeListingScheduledTasks,
  updateListingScheduledTasks,
  executeListingSyncTask,
};
