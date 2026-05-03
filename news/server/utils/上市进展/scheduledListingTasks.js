const cron = require('node-cron');
const db = require('../../db');
const { convertQuartzCronToNodeCron } = require('../cronQuartzToNode');
const { runListingExchangeCrawler } = require('./listingExchangeCrawler');
const { runListingMatchBatch } = require('./listingMatchRunner');
const { runIpoProjectSqlSyncForUser } = require('./ipoProjectSqlSyncRunner');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('./listingBeijingDate');
const { syncNewShareCalendar } = require('./newShareService');
const { syncGuidanceProgress } = require('./guidanceProgressService');
const { syncOverseasFiling } = require('./overseasFilingService');
const { normalizeSourceType, buildTaskKey } = require('./listingSourceType');
const { executeWithRetry } = require('./listingRetry');
const { createExecutionLog, finishExecutionLog, appendExecutionLogProgress } = require('./listingSyncExecutionLog');
const { cleanupIpoProgress, cleanupIpoNewShare } = require('./cleanupTraditionalDuplicates');

const scheduledTasks = new Map();
const sqlSyncScheduledTasks = new Map();
const runningTaskKeys = new Set();
const DEFAULT_MIN_SYNC_DATE = '2026-01-01';

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

/**
 * 境外备案定时区间：
 * - 默认滚动近 7 天（昨日回看 7 天）；
 * - 若上次同步结束到昨日的缺口 > 7 天，则从缺口起点补到昨日。
 */
function computeOverseasScheduledSyncRange(config, baseRunDate) {
  const endDateObj = addDaysCalendar(baseRunDate, -1);
  const endDate = formatDateOnly(endDateObj);
  const rollingStartDate = formatDateOnly(addDaysCalendar(baseRunDate, -7));
  let startDate = rollingStartDate;
  let reason = 'rolling_7d';
  let gapDays = 0;

  if (config.last_sync_range_end) {
    const le = String(config.last_sync_range_end).slice(0, 10);
    const lastNext = addDaysCalendar(new Date(`${le}T12:00:00+08:00`), 1);
    const gapStart = formatDateOnly(lastNext);
    if (gapStart <= endDate) {
      const gapStartObj = new Date(`${gapStart}T12:00:00+08:00`);
      const endObj = new Date(`${endDate}T12:00:00+08:00`);
      gapDays = Math.floor((endObj.getTime() - gapStartObj.getTime()) / 86400000) + 1;
      if (gapDays > 7) {
        startDate = gapStart;
        reason = 'catchup_gap_gt_7d';
      }
    }
  }

  if (startDate > endDate) {
    startDate = endDate;
  }
  return { startDate, endDate, reason, gapDays };
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

  const sourceType = normalizeSourceType(cfg);
  const minSyncDate = normalizeYmd(cfg.min_sync_date) || DEFAULT_MIN_SYNC_DATE;
  let startDate;
  let endDate;
  // 打新日历：仅保留申购日期（A 股）/ 上市日期（港股）严格大于该自然日（不含当日）
  let newShareIssueAfterExclusive = null;
  // 打新日历（A股）：补抓最近由东财 UP_DATE 更新的数据，避免申购日较早但次日补齐上市日期时被漏掉
  let newShareUpdateAfterExclusive = null;
  if (sourceType === 'new_share') {
    const todayYmd = formatDateOnly(baseRunDate);
    startDate = todayYmd;
    endDate = formatDateOnly(addDaysCalendar(baseRunDate, 730));
    newShareIssueAfterExclusive = todayYmd;
    newShareUpdateAfterExclusive = todayYmd;
  } else {
    const r =
      sourceType === 'overseas_filing'
        ? computeOverseasScheduledSyncRange(cfg, baseRunDate)
        : computeScheduledSyncRange(cfg, baseRunDate);
    startDate = r.startDate;
    endDate = r.endDate;
  }
  if (!startDate || !endDate) {
    console.warn(`[上市进展定时] 配置「${cfg.name || configId}」日期区间无效，跳过`);
    return;
  }
  startDate = maxYmd(startDate, minSyncDate);
  if (startDate > endDate) {
    console.log(`[上市进展定时] 配置「${cfg.name || configId}」区间早于最早同步日期(${minSyncDate})，跳过`);
    return;
  }

  console.log(
    sourceType === 'new_share'
      ? `[上市进展定时] 配置「${cfg.name || configId}」打新日历：申购/上市日期 > ${newShareIssueAfterExclusive} 且 ≤ ${endDate}；A股补抓 UP_DATE > ${newShareUpdateAfterExclusive}（北京时间；入库按 stock_code+exchange 插入或更新）interface=${cfg.interface_type || '-'}`
      : sourceType === 'overseas_filing'
        ? `[上市进展定时] 配置「${cfg.name || configId}」境外备案区间 ${startDate} ~ ${endDate}（策略=近7天滚动；缺口>7天则补齐，minSyncDate=${minSyncDate}，北京时间闭区间）interface=${cfg.interface_type || '-'}`
      : `[上市进展定时] 配置「${cfg.name || configId}」同步区间 ${startDate} ~ ${endDate}（minSyncDate=${minSyncDate}，北京时间闭区间；入库按 exchange+公司+更新时间去重，重复则跳过）interface=${cfg.interface_type || '-'}`
  );
  const taskKey = buildTaskKey(cfg, startDate, endDate);
  if (runningTaskKeys.has(taskKey)) {
    console.warn(`[上市进展定时] 命中并发互斥，跳过 task=${taskKey}`);
    const logId = await createExecutionLog({
      configId: cfg.id,
      configName: cfg.name,
      sourceType,
      triggerType: 'scheduled',
      windowStart: startDate,
      windowEnd: endDate,
      taskKey,
      status: 'skipped',
    });
    await finishExecutionLog(logId, { status: 'skipped', errorMessage: '同源同窗口任务运行中，已跳过' });
    return;
  }
  runningTaskKeys.add(taskKey);
  let logId = null;
  let syncResult = null;
  let syncError = null;
  let matchResult = null;
  let matchError = null;

  try {
    logId = await createExecutionLog({
      configId: cfg.id,
      configName: cfg.name,
      sourceType,
      triggerType: 'scheduled',
      windowStart: startDate,
      windowEnd: endDate,
      taskKey,
    });

    // 数据入库阶段（独立处理，异常不影响后续项目匹配）
    console.log(`[上市进展定时] 开始数据入库 sourceType=${sourceType} cfg=${cfg.id}`);
    try {
      if (sourceType === 'new_share') {
        syncResult = await syncNewShareCalendar({
          from: startDate,
          to: endDate,
          issueDateAfterExclusive: newShareIssueAfterExclusive,
          updateDateAfterExclusive: newShareUpdateAfterExclusive,
          minSyncDate,
          triggerType: 'scheduled',
          logTag: `[上市进展定时][${cfg.name || configId}][打新日历]`,
        });
      } else if (sourceType === 'guidance_progress') {
        syncResult = await syncGuidanceProgress({
          from: startDate,
          to: endDate,
          triggerType: 'scheduled',
          source: 'html',
          sourceUrl: String(cfg.request_url || '').trim(),
          logTag: `[上市进展定时][${cfg.name || configId}][辅导备案]`,
        });
      } else if (sourceType === 'overseas_filing') {
        syncResult = await syncOverseasFiling({
          from: startDate,
          to: endDate,
          triggerType: 'scheduled',
          source: 'url',
          sourceUrl: String(cfg.request_url || '').trim(),
          logTag: `[上市进展定时][${cfg.name || configId}][境外备案审核]`,
        });
      } else if (sourceType === 'exchange_crawler') {
        await appendExecutionLogProgress(
          logId,
          '交易所爬虫（定时）：阶段日志写入本执行记录；Python 全量明细见 Node 服务终端。'
        );
        syncResult = await runListingExchangeCrawler({
          startDate,
          endDate,
          logTag: `[上市进展定时][${cfg.name || configId}][交易所爬虫]`,
          config: cfg,
          progressReporter: async (msg) => {
            await appendExecutionLogProgress(logId, msg);
          },
        });
      } else {
        throw new Error(`未识别来源类型: ${sourceType}`);
      }
      console.log(`[上市进展定时] 数据入库完成 sourceType=${sourceType}`, syncResult);

      // 港股繁简体重复数据清理（入库后处理）
      // 业务逻辑：只有繁体保留繁体；有繁体+简体保留简体删除繁体
      if (sourceType === 'new_share' || sourceType === 'exchange_crawler') {
        console.log(`[上市进展定时] 开始港股繁简体重复数据清理 sourceType=${sourceType}`);
        try {
          const cleanupProgress = await cleanupIpoProgress(false);
          const cleanupNewShare = await cleanupIpoNewShare(false);
          console.log(
            `[上市进展定时] 港股繁简体清理完成: ipo_progress删除=${cleanupProgress.cleaned}, ipo_new_share删除=${cleanupNewShare.cleaned}`
          );
        } catch (cleanupErr) {
          console.warn(`[上市进展定时] 港股繁简体清理异常（不影响主流程）:`, cleanupErr.message);
        }
      }
    } catch (e) {
      syncError = e;
      console.error(`[上市进展定时] 数据入库异常 sourceType=${sourceType}:`, e.message);
    }

    // 项目匹配阶段（独立处理，交易所爬虫/境外备案/辅导备案都执行）
    // 即使数据入库有异常，也执行项目匹配（已入库的数据需要匹配）
    const needMatch = ['guidance_progress', 'overseas_filing', 'exchange_crawler'].includes(sourceType);
    if (needMatch) {
      console.log(`[上市进展定时] 开始底层项目匹配 sourceType=${sourceType}`);
      try {
        matchResult = await runListingMatchBatch({
          startDate,
          endDate,
          restrictProjectUserId: null,
        });
        console.log(`[上市进展定时] 底层项目匹配完成`, matchResult);
      } catch (e) {
        matchError = e;
        console.error(`[上市进展定时] 底层项目匹配异常:`, e.message);
      }
    }

    // 合并结果
    const result = { ...syncResult, matchResult };
    const rangeEndStored = sourceType === 'new_share' ? formatDateOnly(baseRunDate) : endDate;
    await db.execute(
      `UPDATE listing_data_config SET last_sync_time = NOW(), last_sync_range_end = ? WHERE id = ?`,
      [rangeEndStored, cfg.id]
    );

    // 判断整体状态：如果数据入库或项目匹配有异常，记录为 partial_success 或 failed
    const hasSyncError = syncError !== null;
    const hasMatchError = matchError !== null;
    const overallStatus = (hasSyncError || hasMatchError)
      ? (syncResult ? 'partial_success' : 'failed')
      : 'success';

    await finishExecutionLog(logId, {
      insertedCount: Number(syncResult?.inserted || 0),
      updatedCount: Number(syncResult?.updated || syncResult?.updatedEarlier || 0),
      skippedCount: Number(syncResult?.skipped || 0),
      dedupHits: Number(syncResult?.skipped || 0),
      matchedCount: Number(matchResult?.matched || 0),
      status: overallStatus,
      errorMessage: hasSyncError ? `入库异常: ${syncError.message}` : (hasMatchError ? `匹配异常: ${matchError.message}` : null),
    });

    // 如果数据入库有严重错误（无任何数据入库），抛出异常触发告警
    if (hasSyncError && !syncResult) {
      throw syncError;
    }
  } catch (e) {
    console.error(`[上市进展定时] 执行失败:`, e);
    if (logId) {
      await finishExecutionLog(logId, {
        status: 'failed',
        retryCount: Number(e.attemptCount || 5),
        errorMessage: String(e.message || e),
      });
    }
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
  } finally {
    runningTaskKeys.delete(taskKey);
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
                `清空旧行=${result.deletedPrevious ?? '-'} 写入=${result.inserted ?? 0} 跳过=${result.skipped ?? 0}（全量替换，无增量更新）`
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
