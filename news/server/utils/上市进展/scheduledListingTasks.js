const cron = require('node-cron');
const db = require('../../db');
const { convertQuartzCronToNodeCron } = require('../cronQuartzToNode');
const { runListingExchangeCrawler } = require('./listingExchangeCrawler');
const { runListingMatchBatch } = require('./listingMatchRunner');
const { runIpoProjectSqlSyncForUser } = require('./ipoProjectSqlSyncRunner');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('./listingBeijingDate');

const scheduledTasks = new Map();
const sqlSyncScheduledTasks = new Map();

function logNextListingCronRun(nodeCron, label) {
  try {
    const cronParser = require('cron-parser');
    let parseExpression;
    if (cronParser.CronExpressionParser && typeof cronParser.CronExpressionParser.parse === 'function') {
      parseExpression = cronParser.CronExpressionParser.parse.bind(cronParser.CronExpressionParser);
    } else if (
      cronParser.default &&
      cronParser.default.CronExpressionParser &&
      typeof cronParser.default.CronExpressionParser.parse === 'function'
    ) {
      parseExpression = cronParser.default.CronExpressionParser.parse.bind(cronParser.default.CronExpressionParser);
    } else if (typeof cronParser.parseExpression === 'function') {
      parseExpression = cronParser.parseExpression;
    }
    if (!parseExpression) return;
    const interval = parseExpression(nodeCron, { tz: 'Asia/Shanghai', currentDate: new Date() });
    const nextResult = interval.next();
    const nextExecution =
      nextResult && typeof nextResult.toDate === 'function'
        ? nextResult.toDate()
        : nextResult instanceof Date
          ? nextResult
          : new Date(nextResult);
    console.log(
      `${label} 下次执行（北京时间）: ${nextExecution.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
    );
  } catch (e) {
    console.warn(`${label} 无法计算下次执行时间:`, e.message);
  }
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
 * - endDate：执行日的前一自然日（「昨日」）
 * - 有缺口：从 last_sync_range_end 的次日 补到 endDate
 * - 无缺口（已追到昨日）：仍对 [昨日,昨日] 再拉一次，与库内 exchange+公司+f_update_time 比对，已有则跳过、新增则追加（避免交易所晚更新导致遗漏）
 */
function computeScheduledSyncRange(config, baseRunDate) {
  const endDateObj = addDaysCalendar(baseRunDate, -1);
  const endDate = formatDateOnly(endDateObj);

  let startDate = endDate;
  if (config.last_sync_range_end) {
    const le = String(config.last_sync_range_end).slice(0, 10);
    const lastNext = addDaysCalendar(new Date(`${le}T12:00:00+08:00`), 1);
    const gapStart = formatDateOnly(lastNext);
    if (gapStart <= endDate) {
      startDate = gapStart;
    }
  }
  if (startDate > endDate) {
    startDate = endDate;
  }
  return { startDate, endDate, reason: null };
}

async function executeListingSyncTask(configId) {
  console.log(`[上市进展定时] 开始执行 配置 id=${configId}`);
  const rows = await db.query(
    `SELECT * FROM listing_data_config WHERE id = ? AND is_active = 1`,
    [configId]
  );
  if (!rows.length) {
    console.log(`[上市进展定时] 配置 id=${configId} 不存在或未启用，跳过`);
    return;
  }
  const cfg = rows[0];
  const cfgLabel = cfg.name ? `${cfg.name}(${configId})` : String(configId);
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

  const { startDate, endDate } = computeScheduledSyncRange(cfg, baseRunDate);
  if (!startDate || !endDate) {
    console.warn(`[上市进展定时] 配置「${cfg.name || configId}」日期区间无效，跳过`);
    return;
  }

  console.log(
    `[上市进展定时] 配置「${cfg.name || configId}」同步区间 ${startDate} ~ ${endDate}（北京时间闭区间；入库按 exchange+公司+更新时间去重，重复则跳过）interface=${cfg.interface_type || '-'}`
  );

  try {
    const type = (cfg.interface_type || '').toLowerCase();
    if (type === 'crawler') {
      const crawlLogTag = `[上市进展定时][${cfg.name || configId}][交易所爬虫]`;
      const result = await runListingExchangeCrawler({
        startDate,
        endDate,
        logTag: crawlLogTag,
        config: cfg,
      });
      await db.execute(
        `UPDATE listing_data_config SET last_sync_time = NOW(), last_sync_range_end = ? WHERE id = ?`,
        [endDate, cfg.id]
      );
      const f = result.fetched || {};
      const errs = result.exchangeErrors || [];
      console.log(
        `[上市进展定时] 配置「${cfg.name || configId}」爬虫汇总 区间内抓取=${f.total ?? 0}（深交所${f.szse ?? 0}/上交所${f.sse ?? 0}/北交所${f.bse ?? 0}/港交所${f.hkex ?? 0}） ` +
          `入库新增=${result.inserted} 更正更早=${result.updatedEarlier ?? 0} 跳过=${result.skipped} last_sync_range_end已更新=${endDate}`
      );
      if (errs.length) {
        console.warn(
          `[上市进展定时] 配置「${cfg.name || configId}」部分交易所拉取失败: ${errs.map((e) => `${e.exchange}:${e.message}`).join(' | ')}`
        );
      }

      const matchResult = await runListingMatchBatch({
        startDate,
        endDate,
        restrictProjectUserId: null,
      });
      console.log(
        `[上市进展定时] 配置「${cfg.name || configId}」项目匹配 ${startDate}~${endDate} 完成 inserted=${matchResult.inserted} progress=${matchResult.progressCount} projects=${matchResult.projectCount}`
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
    console.log(
      `[上市进展定时] 扫描 listing_data_config（对应后台「系统设置 → 上市数据配置」列表）符合条件的配置: ${configs.length} 条`
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
          const nm = config.name ? `「${config.name}」` : '';
          console.log(
            `[上市进展定时] Cron 触发 配置 id=${config.id} ${nm}类型=${config.interface_type || '-'}`.trim()
          );
          await executeListingSyncTask(config.id);
        },
        { scheduled: true, timezone: 'Asia/Shanghai' }
      );
      scheduledTasks.set(config.id, task);
      const dispName = config.name ? ` name=${config.name}` : '';
      console.log(
        `[上市进展定时] 已注册 表=listing_data_config id=${config.id}${dispName} node-cron=${nodeCron}（Quartz=${config.cron_expression}）`
      );
      logNextListingCronRun(nodeCron, `[上市进展定时] listing_data_config id=${config.id}`);
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
    console.log(
      `[底层项目同步] 扫描 ipo_project_sql_sync_setting（外部库→ipo_project）符合条件的配置: ${sqlSettings.length} 条`
    );
    for (const cfg of sqlSettings) {
      const nodeCron = convertQuartzCronToNodeCron(cfg.cron_expression);
      if (!nodeCron || !cron.validate(nodeCron)) {
        console.warn(`[底层项目同步] 配置 ${cfg.id} Cron 无效: ${cfg.cron_expression}`);
        continue;
      }
      const task = cron.schedule(
        nodeCron,
        async () => {
          try {
            let dbLabel = String(cfg.external_db_config_id || '');
            try {
              const dbRows = await db.query(
                'SELECT name, host FROM external_db_config WHERE id = ? AND is_deleted = 0 LIMIT 1',
                [cfg.external_db_config_id]
              );
              if (dbRows[0]) {
                dbLabel = dbRows[0].name || dbRows[0].host || dbLabel;
              }
            } catch (e) {
              /* ignore */
            }
            console.log(
              `[底层项目同步] Cron 触发 配置=${cfg.id} 用户=${cfg.user_id} 外部库=${dbLabel}`
            );
            const result = await runIpoProjectSqlSyncForUser({
              userId: cfg.user_id,
              external_db_config_id: cfg.external_db_config_id,
              sql_text: cfg.sql_text,
              is_enabled: cfg.is_enabled,
            });
            console.log(
              `[底层项目同步] 执行完成 配置=${cfg.id} 外部库=${dbLabel} 查询行=${result.total ?? 0} ` +
                `新增=${result.inserted ?? 0} 更新=${result.updated ?? 0} 跳过=${result.skipped ?? 0}`
            );
          } catch (err) {
            console.error(`[底层项目同步] 执行失败 配置=${cfg.id}:`, err.message || err);
          }
        },
        { scheduled: true, timezone: 'Asia/Shanghai' }
      );
      sqlSyncScheduledTasks.set(cfg.id, task);
      console.log(
        `[底层项目同步] 已注册 表=ipo_project_sql_sync_setting id=${cfg.id} user=${cfg.user_id} node-cron=${nodeCron}（Quartz=${cfg.cron_expression}）`
      );
      logNextListingCronRun(nodeCron, `[底层项目同步] id=${cfg.id}`);
    }

    console.log(
      `[上市进展定时] 调度汇总：上市数据配置 listing_data_config（交易所爬虫）=${scheduledTasks.size} 个；` +
        `底层项目同步 ipo_project_sql_sync_setting=${sqlSyncScheduledTasks.size} 个（与爬虫独立调度）。`
    );
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
