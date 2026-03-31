const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const XLSX = require('xlsx');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { checkNewsPermission } = require('../utils/permissionChecker');
const { logRecipientChange } = require('../utils/logger');
const { sendNewsEmailsToAllRecipients, sendNewsEmailToRecipient } = require('../utils/emailSender');
const { updateScheduledTasks, sendNewsEmailWithExcel, getUserVisibleYesterdayNews, deduplicateNewsBySemanticSimilarity } = require('../utils/scheduledEmailTasks');
const qichachaCategoryMapperModule = require('../utils/qichachaCategoryMapper');
const { convertCategoryCodeToChinese, convertCategoryCodesToChinese, getCategoryMap } = qichachaCategoryMapperModule;
const { logWithTag, errorWithTag, warnWithTag, getLogTimestamp } = require('../utils/logUtils');

/**
 * 拆分逗号分隔的公众号ID字符串，返回去重后的ID数组
 * @param {string} accountIdsStr - 逗号分隔的公众号ID字符串
 * @returns {string[]} - 拆分后的公众号ID数组
 */
function splitAccountIds(accountIdsStr) {
  if (!accountIdsStr || typeof accountIdsStr !== 'string') {
    return [];
  }
  return accountIdsStr
    .split(',')
    .map(id => id.trim())
    .filter(id => id && id !== '');
}

/**
 * 根据企业信息从invested_enterprises表中获取fund和sub_fund
 * @param {string} enterpriseFullName - 企业全称
 * @param {string} unifiedCreditCode - 统一信用代码（可选）
 * @param {string} wechatAccountId - 公众号ID（可选）
 * @returns {Promise<{fund: string|null, sub_fund: string|null}>} - 返回fund和sub_fund
 */
async function getFundAndSubFundFromEnterprise(enterpriseFullName, unifiedCreditCode = null, wechatAccountId = null) {
  try {
    if (!enterpriseFullName) {
      return { fund: null, sub_fund: null };
    }

    let query = `SELECT fund, sub_fund FROM invested_enterprises WHERE delete_mark = 0 AND enterprise_full_name = ?`;
    const params = [enterpriseFullName];

    // 优先使用统一信用代码匹配
    if (unifiedCreditCode && unifiedCreditCode.trim() !== '') {
      query = `SELECT fund, sub_fund FROM invested_enterprises WHERE delete_mark = 0 AND unified_credit_code = ?`;
      params[0] = unifiedCreditCode.trim();
    } else if (wechatAccountId && wechatAccountId.trim() !== '') {
      // 其次使用公众号ID匹配（支持逗号分隔的多个ID）
      const accountIds = splitAccountIds(wechatAccountId);
      if (accountIds.length > 0) {
        const placeholders = accountIds.map(() => '?').join(',');
        query = `SELECT fund, sub_fund FROM invested_enterprises WHERE delete_mark = 0 AND (wechat_official_account_id LIKE ? OR FIND_IN_SET(?, wechat_official_account_id) > 0)`;
        params[0] = `%${accountIds[0]}%`;
        // 如果只有一个ID，使用LIKE匹配；如果有多个，尝试FIND_IN_SET
        if (accountIds.length > 1) {
          query = `SELECT fund, sub_fund FROM invested_enterprises WHERE delete_mark = 0 AND (wechat_official_account_id LIKE ? OR FIND_IN_SET(?, wechat_official_account_id) > 0) LIMIT 1`;
        }
      }
    }

    const results = await db.query(query, params);
    
    if (results && results.length > 0) {
      return {
        fund: results[0].fund || null,
        sub_fund: results[0].sub_fund || null
      };
    }

    return { fund: null, sub_fund: null };
  } catch (error) {
    console.error('获取fund和sub_fund失败:', error);
    return { fund: null, sub_fund: null };
  }
}

const router = express.Router();

/**
 * 将 send_frequency 和 send_time 转换为 Cron 表达式
 * @param {string} sendFrequency - 发送频率：daily/weekly/monthly
 * @param {string} sendTime - 发送时间：HH:mm:ss
 * @returns {string} Cron 表达式
 */
function convertToCronExpression(sendFrequency, sendTime) {
  if (!sendTime) {
    sendTime = '09:00:00'
  }
  const [hours, minutes] = sendTime.split(':')
  
  if (sendFrequency === 'daily') {
    // 每天执行：0 分钟 小时 * * ? *
    return `0 ${minutes} ${hours} * * ? *`
  } else if (sendFrequency === 'weekly') {
    // 每周执行：每周一，0 分钟 小时 ? * 2 *
    return `0 ${minutes} ${hours} ? * 2 *`
  } else if (sendFrequency === 'monthly') {
    // 每月执行：每月1号，0 分钟 小时 1 * ? *
    return `0 ${minutes} ${hours} 1 * ? *`
  }
  
  // 默认每天
  return `0 ${minutes} ${hours} * * ? *`
}

/**
 * 创建新闻同步执行日志
 * @param {Object} params - 日志参数
 * @returns {Promise<string>} - 返回日志ID
 */
async function createSyncLog(params) {
  const {
    configId,
    executionType, // 'manual' 或 'scheduled'
    userId = null,
    executionDetails = {}
  } = params;
  
  const logId = await generateId('news_sync_execution_log');
  const startTime = new Date();
  
  await db.execute(
    `INSERT INTO news_sync_execution_log 
     (id, config_id, execution_type, start_time, status, execution_details, created_by) 
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    [
      logId,
      configId,
      executionType,
      startTime,
      JSON.stringify(executionDetails),
      userId
    ]
  );
  
  return logId;
}

/**
 * 更新新闻同步执行日志
 * @param {string} logId - 日志ID
 * @param {Object} params - 更新参数
 */
async function updateSyncLog(logId, params) {
  const {
    status,
    syncedCount = 0,
    totalEnterprises = 0,
    processedEnterprises = 0,
    errorCount = 0,
    errorMessage = null,
    executionDetails = null
  } = params;
  
  // 获取开始时间
  if (!logId) {
    console.warn(`updateSyncLog: logId为空，跳过更新`);
    return;
  }
  
  const logs = await db.query(
    'SELECT start_time FROM news_sync_execution_log WHERE id = ?',
    [logId]
  );
  
  if (!logs || logs.length === 0) {
    console.warn(`日志记录不存在: ${logId}`);
    return;
  }
  
  if (!logs[0] || !logs[0].start_time) {
    console.warn(`日志记录缺少start_time字段: ${logId}`, logs);
    return;
  }
  
  const startTime = new Date(logs[0].start_time);
  const endTime = new Date();
  const durationSeconds = Math.floor((endTime - startTime) / 1000);
  
  const updateFields = [];
  const updateValues = [];
  
  updateFields.push('end_time = ?');
  updateValues.push(endTime);
  
  updateFields.push('duration_seconds = ?');
  updateValues.push(durationSeconds);
  
  updateFields.push('status = ?');
  updateValues.push(status);
  
  updateFields.push('synced_count = ?');
  updateValues.push(syncedCount);
  
  updateFields.push('total_enterprises = ?');
  updateValues.push(totalEnterprises);
  
  updateFields.push('processed_enterprises = ?');
  updateValues.push(processedEnterprises);
  
  updateFields.push('error_count = ?');
  updateValues.push(errorCount);
  
  if (errorMessage) {
    updateFields.push('error_message = ?');
    updateValues.push(errorMessage);
  }
  
  if (executionDetails) {
    updateFields.push('execution_details = ?');
    updateValues.push(JSON.stringify(executionDetails));
  }
  
  updateValues.push(logId);
  
  await db.execute(
    `UPDATE news_sync_execution_log 
     SET ${updateFields.join(', ')} 
     WHERE id = ?`,
    updateValues
  );
  
  // 更新对应配置的last_sync_time为执行日志的end_time
  try {
    const configRecords = await db.query(
      'SELECT config_id FROM news_sync_execution_log WHERE id = ?',
      [logId]
    );
    if (configRecords.length > 0 && configRecords[0].config_id) {
      await db.execute(
        'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
        [endTime, formatDateOnly(endTime), configRecords[0].config_id]
      );
      console.log(`[新闻同步] 已使用执行日志的end_time更新配置 ${configRecords[0].config_id} 的last_sync_time: ${endTime}`);
    }
  } catch (updateConfigError) {
    console.warn(`[新闻同步] 更新配置的last_sync_time失败: ${updateConfigError.message}`);
    // 不抛出错误，因为日志更新已经成功
  }
}

/**
 * 格式化日期为 yyyy-MM-dd HH:mm:ss
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 创建Asia/Shanghai时区的Date对象（当天00:00:00）
 * 正确的方式：使用ISO字符串格式，明确指定时区偏移量
 * @param {Date} date - 参考日期（可选，默认使用当前时间）
 * @returns {Date} Asia/Shanghai时区当天的00:00:00
 */
function createShanghaiDate(date = null) {
  const now = date || new Date();
  // 使用toLocaleString获取Asia/Shanghai时区的日期时间字符串
  const localDateTimeStr = now.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  // 解析格式：2024/12/8 14:30:00
  const [datePart] = localDateTimeStr.split(' ');
  const [localYear, localMonth, localDay] = datePart.split('/').map(Number);
  
  // 创建上海时区当天的00:00:00（使用ISO字符串方式，明确指定+08:00时区偏移）
  const dateStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T00:00:00+08:00`;
  return new Date(dateStr);
}

/**
 * 格式化日期为 YYYY-MM-DD，使用北京时区
 * @param {Date} date - 日期对象
 * @returns {string} YYYY-MM-DD 格式的日期字符串（北京时区）
 */
function formatDateOnly(date) {
  // 使用北京时区格式化日期，确保日期计算基于北京时间
  const beijingDateStr = date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // 解析格式：2024/12/8 或 2024-12-8
  const datePart = beijingDateStr.split(' ')[0];
  const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 上海国际集团按日查询接口：生成 query_date 列表（定时按 last_sync_date 补拉至昨日，手动按 customRange 逐日）
 * @param {object} config - news_interface_config 行
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to（YYYY-MM-DD HH:mm:ss）
 * @returns {{ queryDates: string[], lastQueryDate: string|null }}
 */
function buildShanghaiInternationalQueryDates(config, customRange) {
  const now = new Date();
  const baseRunDate = createShanghaiDate(now);
  const yesterday = new Date(baseRunDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateOnly(yesterday);

  if (customRange && customRange.from && customRange.to) {
    const startStr = String(customRange.from).trim().split(' ')[0];
    const endStr = String(customRange.to).trim().split(' ')[0];
    const queryDates = [];
    const startD = new Date(startStr + 'T00:00:00+08:00');
    const endD = new Date(endStr + 'T00:00:00+08:00');
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      queryDates.push(formatDateOnly(d));
    }
    const lastQueryDate = queryDates.length > 0 ? queryDates[queryDates.length - 1] : null;
    return { queryDates, lastQueryDate };
  }

  let lastSyncDateStr = null;
  if (config.last_sync_date) {
    if (config.last_sync_date instanceof Date) {
      lastSyncDateStr = formatDateOnly(config.last_sync_date);
    } else {
      lastSyncDateStr = String(config.last_sync_date).trim().split(' ')[0];
    }
  } else if (config.last_sync_time) {
    const lt = new Date(config.last_sync_time);
    const parts = lt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).split(' ')[0].split(/[\/\-]/);
    if (parts.length === 3) {
      lastSyncDateStr = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
    }
  }

  const queryDates = [];
  if (lastSyncDateStr) {
    const lastD = new Date(lastSyncDateStr + 'T00:00:00+08:00');
    const nextD = new Date(lastD);
    nextD.setDate(nextD.getDate() + 1);
    const yesterdayD = new Date(yesterdayStr + 'T00:00:00+08:00');
    for (let d = new Date(nextD); d <= yesterdayD; d.setDate(d.getDate() + 1)) {
      queryDates.push(formatDateOnly(d));
    }
  }
  if (queryDates.length === 0) {
    queryDates.push(yesterdayStr);
  }
  const lastQueryDate = queryDates.length > 0 ? queryDates[queryDates.length - 1] : yesterdayStr;
  return { queryDates, lastQueryDate };
}

/**
 * 判断指定日期是否为工作日，使用北京时区
 * @param {Date} date - 日期对象
 * @returns {Promise<boolean>} 是否为工作日
 */
async function isWorkdayDate(date) {
  // 使用北京时区格式化日期，确保与节假日表中的日期（北京时区）一致
  const dateStr = formatDateOnly(date);
  try {
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    if (rows.length > 0) {
      return rows[0].is_workday === 1;
    }
  } catch (error) {
    console.warn('查询节假日数据失败：', error.message);
  }
  // 如果没有节假日记录，使用北京时区判断星期几
  // 使用北京时区的日期来判断星期几
  const beijingDay = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).getDay();
  return beijingDay !== 0 && beijingDay !== 6; // 0=周日, 6=周六
}

/**
 * 查找指定日期之前的最后一个工作日
 * @param {Date} date - 起始日期
 * @returns {Promise<Date>} 最后一个工作日的Date对象（00:00:00）
 */
async function findPreviousWorkday(date) {
  let checkDate = new Date(date);
  checkDate.setDate(checkDate.getDate() - 1); // 从前一天开始查找
  
  // 最多向前查找30天，避免无限循环
  let maxDays = 30;
  let daysChecked = 0;
  
  while (daysChecked < maxDays) {
    const isWorkday = await isWorkdayDate(checkDate);
    if (isWorkday) {
      // 找到工作日，返回该日期的00:00:00
      const workday = new Date(checkDate);
      workday.setHours(0, 0, 0, 0);
      return workday;
    }
    
    // 继续向前查找
    checkDate.setDate(checkDate.getDate() - 1);
    daysChecked++;
  }
  
  // 如果30天内都没找到工作日，返回30天前的日期（兜底）
  const fallbackDate = new Date(date);
  fallbackDate.setDate(fallbackDate.getDate() - 30);
  fallbackDate.setHours(0, 0, 0, 0);
  return fallbackDate;
}

function getConfigFrequency(config) {
  if (config.send_frequency) {
    return config.send_frequency;
  }
  if (config.frequency_type === 'week') return 'weekly';
  if (config.frequency_type === 'month') return 'monthly';
  return 'daily';
}

/**
 * 计算手动同步的时间范围：从点击时间的前一天00:00:00到今天00:00:00
 * 
 * 示例：
 * - 如果在 2025-01-15 14:30:00 点击手动同步
 * - 获取时间范围：2025-01-14 00:00:00 到 2025-01-15 00:00:00
 * - 即：获取昨天一整天发布的新闻
 * 
 * @param {Date} currentTime - 当前时间（点击时间，可选，默认使用当前时间）
 * @returns {object} { from, to } 时间范围
 */
function calculateManualSyncTimeRange(currentTime = null) {
  const now = currentTime || new Date();
  
  // 获取当前时间的本地时间字符串（用于调试）
  const nowStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`[手动同步] 当前时间（本地）: ${nowStr}`);
  
  // 使用本地时区计算日期，确保日期计算基于Asia/Shanghai时区
  // 获取本地时间的年月日
  const localYear = now.getFullYear();
  const localMonth = now.getMonth();
  const localDate = now.getDate();
  const localHours = now.getHours();
  
  // 创建本地时区的日期对象（使用本地时区的年月日）
  const localNow = new Date(localYear, localMonth, localDate, localHours, now.getMinutes(), now.getSeconds());
  
  // 计算前一天00:00:00（基于本地时区）
  const yesterday = new Date(localNow);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  // 计算今天00:00:00（基于本地时区）
  const today = new Date(localNow);
  today.setHours(0, 0, 0, 0);
  
  const fromStr = formatDate(yesterday);
  const toStr = formatDate(today);
  
  console.log(`[手动同步] 计算的时间范围: ${fromStr} 到 ${toStr}`);
  console.log(`[手动同步] 昨天日期: ${yesterday.toLocaleDateString('zh-CN')}, 今天日期: ${today.toLocaleDateString('zh-CN')}`);
  
  return {
    from: fromStr,
    to: toStr
  };
}

/**
 * 测试时间范围计算（用于调试）
 */
function testTimeRangeCalculation() {
  console.log('\n=== 时间范围计算测试 ===');
  
  // 测试不同的时间点
  const testTimes = [
    new Date('2025-01-15 09:30:00'), // 上午
    new Date('2025-01-15 14:20:00'), // 下午
    new Date('2025-01-15 23:45:00'), // 深夜
    new Date('2025-01-16 00:15:00'), // 凌晨
  ];
  
  testTimes.forEach(testTime => {
    const range = calculateManualSyncTimeRange(testTime);
    console.log(`点击时间: ${formatDate(testTime)}`);
    console.log(`获取范围: ${range.from} 到 ${range.to}`);
    console.log('---');
  });
  
  console.log('=== 测试完成 ===\n');
}

/**
 * 计算定时任务的时间范围：前一天00:00:00到23:59:59
 * @param {Date} targetDate - 目标日期（可选，默认使用当前日期）
 * @returns {object} { from, to } 时间范围
 */
function calculateScheduledSyncTimeRange(targetDate = null) {
  // 使用Asia/Shanghai时区计算日期
  const today = createShanghaiDate(targetDate);
  
  // 创建本地时区的昨天00:00:00
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // 开始时间：前一天00:00:00
  const from = new Date(yesterday);
  from.setHours(0, 0, 0, 0);
  
  // 结束时间：前一天23:59:59
  const to = new Date(yesterday);
  to.setHours(23, 59, 59, 999);
  
  return {
    from: formatDate(from),
    to: formatDate(to)
  };
}

/**
 * 执行同步逻辑（可被手动触发或定时任务调用）
 * @param {boolean} isManual - 是否为手动触发，true=手动触发，false=定时任务
 * @returns {Promise<object>} 同步结果
 */
async function executeNewsSyncForConfig(config, range, options = {}) {
  const { isManual = false, logId = null } = options;
  try {
  const { request_url, content_type, api_key } = config;
  const { from, to } = range;
  
  console.log(`取数时间范围（${isManual ? '手动触发' : '定时任务'}，配置 ${config.id}）：`, { from, to });
  
  if (isManual) {
    const now = new Date();
    console.log(`手动触发详情：`);
    console.log(`- 点击时间: ${formatDate(now)}`);
    console.log(`- 获取范围: ${from} 到 ${to}`);
    console.log(`- 说明: 获取前一天0点到今天0点之间发布的新闻`);
  }

  // 解析 entity_type 配置（仅对新榜接口生效）
  let entityTypes = [];
  let includeAdditionalAccounts = false;
  let includeEnterpriseAccounts = true; // 默认包含企业公众号
  
  if (config.interface_type === '新榜' && config.entity_type) {
    try {
      // 解析 entity_type（可能是 JSON 字符串或数组）
      if (typeof config.entity_type === 'string') {
        entityTypes = JSON.parse(config.entity_type);
      } else if (Array.isArray(config.entity_type)) {
        entityTypes = config.entity_type;
      }
      
      // 检查是否包含"额外公众号"
      includeAdditionalAccounts = entityTypes.includes('额外公众号');
      
      // 如果包含"额外公众号"，检查是否还有其他企业类型
      if (includeAdditionalAccounts) {
        // 过滤掉"额外公众号"，保留其他企业类型
        const enterpriseTypes = entityTypes.filter(t => t !== '额外公众号');
        includeEnterpriseAccounts = enterpriseTypes.length > 0;
        entityTypes = enterpriseTypes; // 更新 entityTypes，用于后续企业类型过滤
      } else {
        // 不包含"额外公众号"，只查询企业公众号
        includeAdditionalAccounts = false;
        includeEnterpriseAccounts = entityTypes.length > 0 || entityTypes.length === 0; // 如果为空，查询所有企业类型
      }
      
      console.log(`[新闻同步] 配置 ${config.id} 的 entity_type 过滤:`, {
        entityTypes,
        includeAdditionalAccounts,
        includeEnterpriseAccounts
      });
    } catch (e) {
      console.warn(`[新闻同步] 解析 entity_type 失败: ${e.message}，将查询所有公众号`);
      // 解析失败，默认查询所有公众号
      includeAdditionalAccounts = true;
      includeEnterpriseAccounts = true;
    }
  } else {
    // 企查查接口或未配置 entity_type，查询所有公众号
    includeAdditionalAccounts = true;
    includeEnterpriseAccounts = true;
  }

  // 查询企业公众号（根据 entity_type 过滤）
  let enterpriseAccountIds = [];
  if (includeEnterpriseAccounts) {
    let enterpriseQuery = `
      SELECT DISTINCT wechat_official_account_id, entity_type
      FROM invested_enterprises 
      WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
      AND wechat_official_account_id IS NOT NULL 
      AND wechat_official_account_id != ''
      AND delete_mark = 0
    `;
    
    // 如果指定了企业类型，添加过滤条件
    if (entityTypes.length > 0 && config.interface_type === '新榜') {
      const placeholders = entityTypes.map(() => '?').join(',');
      enterpriseQuery += ` AND entity_type IN (${placeholders})`;
    }
    
    const enterprises = await db.query(enterpriseQuery, entityTypes.length > 0 ? entityTypes : []);
    
    // 合并两个数据源的公众号ID，并拆分逗号分隔的ID
    enterprises.forEach(e => {
      const ids = splitAccountIds(e.wechat_official_account_id);
      enterpriseAccountIds.push(...ids);
    });
  }

  // 查询额外公众号（仅在新榜接口且配置包含"额外公众号"时）
  let additionalAccountIds = [];
  if (includeAdditionalAccounts && config.interface_type === '新榜') {
    const additionalAccounts = await db.query(
      `SELECT DISTINCT wechat_account_id 
       FROM additional_wechat_accounts 
       WHERE status = 'active' 
       AND wechat_account_id IS NOT NULL 
       AND wechat_account_id != ''
       AND delete_mark = 0`
    );
    additionalAccountIds = additionalAccounts.map(a => a.wechat_account_id);
  }
  
  // 合并并去重：使用Set确保wechat_account_id唯一
  const allAccountIdsSet = new Set([...enterpriseAccountIds, ...additionalAccountIds]);
  const allAccountIds = Array.from(allAccountIdsSet);

  if (allAccountIds.length === 0) {
    return { 
      success: true, 
      message: '没有需要同步的公众号',
      data: { synced: 0, total: 0 }
    };
  }

  // 去重公众号ID
  let uniqueAccounts = [...new Set(allAccountIds)];

  // 过滤掉当天已查询过的公众号ID（手动触发和定时任务都使用相同逻辑）
  // 这样可以避免重复查询，减少失败率，提高效率
  try {
    // 获取当天开始时间（Asia/Shanghai时区）
    const todayStart = createShanghaiDate();
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    todayEnd.setMilliseconds(todayEnd.getMilliseconds() - 1);

    // 查询当天已同步的公众号ID（新榜接口）
    const syncedAccounts = await db.query(
      `SELECT DISTINCT wechat_account 
       FROM news_detail 
       WHERE APItype = '新榜' 
       AND created_at >= ? 
       AND created_at <= ?
       AND wechat_account IS NOT NULL 
       AND wechat_account != ''
       AND delete_mark = 0`,
      [todayStart, todayEnd]
    );

    const syncedAccountIds = syncedAccounts.map(a => a.wechat_account);
    const syncedAccountSet = new Set(syncedAccountIds);

    // 过滤掉已查询的公众号ID
    const beforeFilterCount = uniqueAccounts.length;
    uniqueAccounts = uniqueAccounts.filter(account => !syncedAccountSet.has(account));
    const afterFilterCount = uniqueAccounts.length;
    const filteredCount = beforeFilterCount - afterFilterCount;

    if (filteredCount > 0) {
      const triggerType = isManual ? '手动同步' : '定时任务';
      console.log(`[${triggerType}] 过滤掉当天已查询的公众号ID: ${filteredCount} 个`);
      console.log(`[${triggerType}] 剩余待查询公众号ID: ${afterFilterCount} 个`);
    }

    if (uniqueAccounts.length === 0) {
      const triggerType = isManual ? '手动同步' : '定时任务';
      console.log(`[${triggerType}] 所有公众号ID今天都已查询过，无需再次同步`);
      return {
        success: true,
        message: '所有公众号今天都已同步过，无需再次同步',
        data: { synced: 0, total: 0 }
      };
    }
  } catch (filterError) {
    const triggerType = isManual ? '手动同步' : '定时任务';
    console.error(`[${triggerType}] 过滤已查询公众号ID时出错:`, filterError.message);
    // 如果过滤出错，继续使用所有公众号ID，不中断同步流程
  }
  
  let totalSynced = 0;
  const errors = [];

  // 遍历每个公众号，调用接口获取数据
  for (const account of uniqueAccounts) {
    // 记录每个公众号的同步详情
    let accountDataCount = 0; // 该公众号返回的数据条数
    let accountInsertCount = 0; // 该公众号成功入库的条数
    let accountHasData = false; // 是否有数据返回
    let accountErrorMsg = null; // 错误信息
    
    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        // 调用新闻接口（使用 x-www-form-urlencoded 格式）
        const params = new URLSearchParams({
          account: account,
          from: from,
          to: to,
          page: page.toString(),
          size: '20'
        });

        // 记录API调用详情，便于排查404问题
        console.log(`[新榜同步] 调用API - 公众号ID: "${account}", 时间范围: ${from} 到 ${to}, 页码: ${page}`);
        console.log(`[新榜同步] API地址: ${request_url}`);
        
        const response = await axios.post(request_url, 
          params.toString(),
          {
            headers: {
              'Key': api_key,
              'Content-Type': content_type || 'application/x-www-form-urlencoded;charset=utf-8'
            },
            timeout: 30000
          }
        );
        
        // 记录API响应状态
        console.log(`[新榜同步] API响应 - 公众号ID: "${account}", 状态码: ${response.status}, 返回码: ${response.data?.code || 'N/A'}`);

        // 检查返回状态
        if (response.data.code === 0 && response.data.data && Array.isArray(response.data.data)) {
          const articles = response.data.data;
          
          if (articles.length === 0) {
            hasMore = false;
            break;
          }

          // 记录有数据返回
          accountHasData = true;
          accountDataCount += articles.length;

          // 批量插入数据
          for (const article of articles) {
            // 新榜接口：根据标题去重（不使用source_url去重）
            const sourceUrl = article.url || article.sourceUrl || '';
            const title = article.title || '';
            
            // 如果标题为空，跳过该条记录
            if (!title) {
              console.log(`[入库] 跳过标题为空的新闻: source_url: ${sourceUrl}`);
              continue;
            }

            // 检查标题是否重复（仅针对新榜接口）
            const existingByTitle = await db.query(
              'SELECT id, delete_mark, source_url FROM news_detail WHERE title = ? AND APItype = ? LIMIT 1',
              [title, '新榜']
            );

            // 如果标题已存在（无论是否已删除），跳过（避免重复）
            if (existingByTitle.length > 0) {
              if (existingByTitle[0].delete_mark === 1) {
                console.log(`[入库] 跳过已删除的新闻（标题重复，用户手动删除）: ${title} (source_url: ${existingByTitle[0].source_url})`);
              } else {
                console.log(`[入库] 跳过重复标题的新闻: ${title} (已存在ID: ${existingByTitle[0].id}, source_url: ${existingByTitle[0].source_url})`);
              }
              continue; // 跳过标题重复的记录（无论是否已删除）
            }

            // 只有不存在时才插入新数据
            // 注意：新榜接口的关键词不直接使用，而是通过AI分析生成
              // 这里将keywords设为null，等待后续AI分析填充
              // 与企查查接口保持一致的处理方式

              // 格式化发布时间
              let publicTime = null;
              if (article.publicTime) {
                try {
                  publicTime = new Date(article.publicTime).toISOString().slice(0, 19).replace('T', ' ');
                } catch (e) {
                  console.warn('发布时间格式错误:', article.publicTime);
                }
              }

              // 根据微信账号匹配被投企业全称
              // 对于invested_enterprises表中状态不为"完全退出"的数据对应的公众号的新闻，
              // 被投企业全称应该是这个被投企业的全称，不管是否跟这个企业有关
              // 先判断是否是企业公众号发的，如果是，直接设置企业全称
              let enterpriseFullName = null;
              try {
                // 使用传入的公众号ID（account），而不是接口返回的article.account
                const wechatAccountId = account;
                console.log(`[入库] 检查公众号是否为企业公众号 - wechat_account_id: "${wechatAccountId}", account_name: "${article.name || ''}"`);
                
                // 先检查是否是额外公众号
                const isAdditionalAccount = additionalAccountIds.includes(wechatAccountId);
                
                // 只从invested_enterprises表中查找被投企业，且状态不为"完全退出"
                // 支持逗号分隔的多个公众号ID
                const enterpriseResult = await db.query(
                  `SELECT enterprise_full_name 
                   FROM invested_enterprises 
                   WHERE (wechat_official_account_id = ? 
                     OR wechat_official_account_id LIKE ?
                     OR wechat_official_account_id LIKE ?
                     OR wechat_official_account_id LIKE ?)
                   AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
                   AND delete_mark = 0 
                   LIMIT 1`,
                  [
                    wechatAccountId,
                    `${wechatAccountId},%`,
                    `%,${wechatAccountId},%`,
                    `%,${wechatAccountId}`
                  ]
                );
                
                if (enterpriseResult.length > 0) {
                  enterpriseFullName = enterpriseResult[0].enterprise_full_name;
                  console.log(`[入库] ✓ 匹配到企业公众号，设置企业全称: ${enterpriseFullName}`);
                } else {
                  if (isAdditionalAccount) {
                    console.log(`[入库] ℹ 公众号 "${wechatAccountId}" 是额外公众号（非企业公众号），企业全称将在AI分析时根据内容相关性决定`);
                  } else {
                    console.log(`[入库] ✗ 公众号 "${wechatAccountId}" 不是invested_enterprises表中的企业公众号，也不是额外公众号`);
                  }
                }
                // 注意：来自additional_wechat_accounts的新闻不在此处设置enterprise_full_name
                // 它们将在AI分析时根据内容相关性来决定是否关联到被投企业
              } catch (e) {
                console.error('[入库] 匹配企业全称时出错:', e.message);
                console.error('[入库] 错误堆栈:', e.stack);
              }

              // 如果企业全称不为空，从invested_enterprises表中获取entity_type和project_abbreviation
              let entityType = null;
              let enterpriseAbbreviation = null;
              if (enterpriseFullName) {
                try {
                  // 尝试匹配格式化后的名称（包含【】），如果失败则尝试匹配原始全称
                  let enterpriseInfo = await db.query(
                    `SELECT entity_type, enterprise_full_name, project_abbreviation
                     FROM invested_enterprises 
                     WHERE (enterprise_full_name = ? OR enterprise_full_name LIKE ?)
                     AND delete_mark = 0 
                     LIMIT 1`,
                    [enterpriseFullName, `%【${enterpriseFullName}】`]
                  );
                  
                  // 如果没找到，尝试从格式化名称中提取全称进行匹配（兼容旧数据）
                  if (enterpriseInfo.length === 0) {
                    const formatMatch = enterpriseFullName.match(/^(.+?)【(.+?)】$/);
                    if (formatMatch) {
                      const extractedFullName = formatMatch[2];
                      enterpriseInfo = await db.query(
                        `SELECT entity_type, enterprise_full_name, project_abbreviation
                         FROM invested_enterprises 
                         WHERE enterprise_full_name = ? 
                         AND delete_mark = 0 
                         LIMIT 1`,
                        [extractedFullName]
                      );
                    }
                  }
                  
                  if (enterpriseInfo.length > 0) {
                    entityType = enterpriseInfo[0].entity_type;
                    enterpriseAbbreviation = enterpriseInfo[0].project_abbreviation || null;
                  }
                } catch (err) {
                  console.warn(`获取entity_type和project_abbreviation时出错: ${err.message}`);
                }
              }
              
              // 获取fund和sub_fund
              const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(enterpriseFullName, null, account);
              
              const newsId = await generateId('news_detail');
              await db.execute(
                `INSERT INTO news_detail 
                 (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, keywords, news_abstract, news_sentiment, APItype, fund, sub_fund) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  newsId,
                  article.name || '',
                  account, // 直接使用传入的公众号ID，不使用接口返回的article.account
                  enterpriseFullName,
                  enterpriseAbbreviation,
                  entityType,
                  sourceUrl,
                  article.title || '',
                  article.summary || '',
                  publicTime,
                  article.content || '',
                  null, // keywords - 设为null，等待后续AI分析生成（不使用接口返回的原始关键词）
                  null, // news_abstract - 暂时为空，后续可通过AI分析填充
                  'neutral', // news_sentiment - 默认为中性，后续可通过情感分析填充
                  '新榜', // APItype - 新榜接口
                  fund, // fund - 从invested_enterprises表获取
                  sub_fund // sub_fund - 从invested_enterprises表获取
                ]
              );
              
              // 新榜接口：入库后立即进行AI分析
              try {
                const newsAnalysis = require('../utils/newsAnalysis');
                const newsItem = {
                  id: newsId,
                  title: article.title || '',
                  content: article.content || '',
                  source_url: sourceUrl,
                  wechat_account: account,
                  enterprise_full_name: enterpriseFullName
                };
                const isAdditionalAccount = additionalAccountIds.includes(account);
                
                // 异步执行AI分析，不阻塞同步流程
                setImmediate(async () => {
                  try {
                    await newsAnalysis.analyzeXinbangNewsImmediately(newsItem, isAdditionalAccount);
                    console.log(`[新榜同步] ✓ 已立即分析新闻ID: ${newsId}`);
                  } catch (analysisError) {
                    console.error(`[新榜同步] ✗ 立即分析失败，新闻ID: ${newsId}, 错误: ${analysisError.message}`);
                  }
                });
              } catch (analysisInitError) {
                console.warn(`[新榜同步] ✗ 启动立即分析失败，新闻ID: ${newsId}, 错误: ${analysisInitError.message}`);
              }
              
              totalSynced++;
              accountInsertCount++;
          }

          // 如果返回的数据少于20条，说明没有更多数据了
          if (articles.length < 20) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
          if (response.data.code !== 0) {
            const errorMsg = response.data.msg || response.data.message || '接口返回错误';
            
            // 根据错误信息判断错误类型
            let errorType = '其他错误';
            if (errorMsg.includes('数据不存在') || errorMsg.includes('不存在') || errorMsg.includes('无数据') || errorMsg.includes('没有数据')) {
              errorType = '数据不存在';
            } else if (errorMsg.includes('使用量') || errorMsg.includes('配额') || errorMsg.includes('不足') || errorMsg.includes('quota') || errorMsg.includes('limit') || errorMsg.includes('次数')) {
              errorType = '接口使用量不足';
            } else if (errorMsg.includes('认证') || errorMsg.includes('auth') || errorMsg.includes('key') || errorMsg.includes('token')) {
              errorType = '401-认证失败';
            } else if (errorMsg.includes('权限') || errorMsg.includes('permission') || errorMsg.includes('forbidden')) {
              errorType = '403-权限不足';
            } else if (errorMsg.includes('超时') || errorMsg.includes('timeout')) {
              errorType = '请求超时';
            } else if (errorMsg.includes('网络') || errorMsg.includes('network') || errorMsg.includes('连接')) {
              errorType = '网络错误';
            }
            
            errors.push({
              account,
              message: errorMsg,
              type: errorType
            });
            
            // 记录错误信息
            accountErrorMsg = errorMsg;
            
            // 检查是否是使用量不足的错误
            const isQuotaExceeded = errorType === '接口使用量不足';
            
            if (isQuotaExceeded) {
              console.warn(`[新榜同步] 接口使用量不足，停止后续调用。已处理 ${totalSynced} 条数据`);
              // 如果已获取到数据，先返回已处理的数据
              if (totalSynced > 0) {
                return {
                  success: true,
                  message: `接口使用量不足，已处理 ${totalSynced} 条数据`,
                  data: {
                    synced: totalSynced,
                    total: uniqueAccounts.length,
                    errors: errors,
                    quotaExceeded: true
                  }
                };
              }
            }
          }
        }

        // 避免请求过快，添加延迟
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      // 区分不同类型的错误
      let errorMessage = error.message;
      let errorType = '未知错误';
      
      if (error.response) {
        // HTTP响应错误
        const status = error.response.status;
        const responseData = error.response.data || {};
        console.log(`[新榜同步] API错误响应 - 公众号ID: "${account}", HTTP状态: ${status}, 响应数据:`, JSON.stringify(responseData));
        
        if (status === 404) {
          errorType = '404-公众号不存在或已失效';
          errorMessage = `公众号ID "${account}" 在新榜API中不存在、已失效或已被删除`;
          console.log(`[新榜同步] ⚠️ 404错误 - 公众号ID: "${account}", 提示: 如果在新榜网站可以查到该公众号，可能是API调用方式或参数格式问题`);
        } else if (status === 401) {
          errorType = '401-认证失败';
          errorMessage = `API认证失败，请检查API Key是否正确`;
        } else if (status === 403) {
          errorType = '403-权限不足';
          errorMessage = `API权限不足，请检查API配置`;
        } else if (status >= 500) {
          errorType = '服务器错误';
          errorMessage = `新榜API服务器错误 (${status})`;
        } else {
          errorType = `HTTP错误-${status}`;
          errorMessage = `请求失败: ${error.response.data?.msg || error.message}`;
        }
      } else if (error.request) {
        // 请求已发送但没有收到响应
        errorType = '网络错误';
        errorMessage = `无法连接到新榜API服务器，请检查网络连接`;
      } else if (error.code === 'ECONNABORTED') {
        // 超时错误
        errorType = '请求超时';
        errorMessage = `请求超时（30秒），公众号 "${account}" 可能数据量过大`;
      }
      
      console.error(`[新榜同步] 同步公众号 "${account}" 失败 [${errorType}]：${errorMessage}`);
      errors.push({
        account,
        message: errorMessage,
        type: errorType
      });
      
      // 记录错误信息
      accountErrorMsg = errorMessage;
      
      // 检查是否是使用量不足的错误
      const isQuotaExceeded = errorMessage.includes('使用量') || 
                             errorMessage.includes('配额') || 
                             errorMessage.includes('不足') ||
                             errorMessage.includes('quota') ||
                             errorMessage.includes('limit') ||
                             errorMessage.includes('次数') ||
                             errorType === '403-权限不足' ||
                             (error.response && (error.response.status === 403 || error.response.status === 429));
      
      if (isQuotaExceeded) {
        console.warn(`[新榜同步] 接口使用量不足，停止后续调用。已处理 ${totalSynced} 条数据`);
        // 如果已获取到数据，先返回已处理的数据
        if (totalSynced > 0) {
          return {
            success: true,
            message: `接口使用量不足，已处理 ${totalSynced} 条数据`,
            data: {
              synced: totalSynced,
              total: uniqueAccounts.length,
              errors: errors,
              quotaExceeded: true
            }
          };
        }
      }
      
      // 记录该公众号的同步详情
      if (logId) {
        try {
          const detailLogId = await generateId('news_sync_detail_log');
          await db.execute(
            `INSERT INTO news_sync_detail_log 
             (id, sync_log_id, interface_type, account_id, has_data, data_count, insert_success, insert_count, error_message) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              detailLogId,
              logId,
              '新榜',
              account,
              accountHasData ? 1 : 0,
              accountDataCount,
              accountInsertCount > 0 ? 1 : 0,
              accountInsertCount,
              accountErrorMsg
            ]
          );
        } catch (detailLogError) {
          console.error(`[新榜同步] 记录详细日志失败（公众号：${account}）：`, detailLogError.message);
        }
      }
    }
  }

  // 统计错误类型
  const errorStats = {
    '404-公众号不存在或已失效': 0,
    '401-认证失败': 0,
    '403-权限不足': 0,
    '数据不存在': 0,
    '接口使用量不足': 0,
    '网络错误': 0,
    '请求超时': 0,
    '服务器错误': 0,
    '其他错误': 0
  };
  
  errors.forEach(err => {
    const type = err.type || '其他错误';
    if (errorStats.hasOwnProperty(type)) {
      errorStats[type]++;
    } else {
      errorStats['其他错误']++;
    }
  });

  // 输出同步统计信息
  // 注意：executeNewsSyncForConfig函数专门用于新榜同步，接口类型固定为"新榜"
  console.log(`[新榜同步] ========== 同步统计 ==========`);
  console.log(`[新榜同步] 配置ID: ${config.id}`);
  console.log(`[新榜同步] 接口类型: 新榜`); // 固定为新榜，因为此函数专门用于新榜同步
  console.log(`[新榜同步] 时间范围: ${from} 到 ${to}`);
  console.log(`[新榜同步] 公众号总数: ${uniqueAccounts.length}`);
  console.log(`[新榜同步] 成功同步: ${totalSynced} 条新闻`);
  console.log(`[新榜同步] 失败数量: ${errors.length}`);
  
  // 输出错误类型统计
  if (errors.length > 0) {
    console.log(`[新榜同步] 错误类型统计:`);
    Object.entries(errorStats).forEach(([type, count]) => {
      if (count > 0) {
        console.log(`[新榜同步]   - ${type}: ${count} 个`);
      }
    });
    
    // 显示前5个错误详情
    console.log(`[新榜同步] 失败详情（前5个）:`);
    errors.slice(0, 5).forEach((err, index) => {
      console.log(`[新榜同步]   ${index + 1}. 公众号 "${err.account}": [${err.type || '未知'}] ${err.message}`);
    });
    
    // 如果404错误较多，给出提示
    if (errorStats['404-公众号不存在或已失效'] > 0) {
      console.log(`[新榜同步] ⚠️  提示: 有 ${errorStats['404-公众号不存在或已失效']} 个公众号返回404错误`);
      console.log(`[新榜同步]   这通常意味着这些公众号ID在新榜API中不存在、已失效或已被删除`);
      console.log(`[新榜同步]   如果在新榜网站可以查到这些公众号，可能是以下原因：`);
      console.log(`[新榜同步]   1. API调用方式或参数格式不正确`);
      console.log(`[新榜同步]   2. API权限不足，无法访问这些公众号的数据`);
      console.log(`[新榜同步]   3. 新榜API和新榜网站使用不同的数据源`);
      console.log(`[新榜同步]   建议检查API调用日志中的详细错误信息，或联系新榜API服务商确认`);
    }
  }
  console.log(`[新榜同步] =============================`);

  // 更新日志记录
  if (logId) {
    try {
      // 将详细错误信息存储到execution_details中，而不是error_message
      // error_message字段只存储简要信息（如"有X个错误，详见详情"），详细错误在详情中查看
      const errorSummary = errors.length > 0 
        ? `共 ${errors.length} 个错误，详见接口详情` 
        : null;
      
      await updateSyncLog(logId, {
        status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
        syncedCount: totalSynced,
        totalEnterprises: uniqueAccounts.length,
        processedEnterprises: uniqueAccounts.length,
        errorCount: errors.length,
        errorMessage: errorSummary, // 只存储简要信息
        executionDetails: {
          timeRange: { from, to },
          interfaceType: '新榜', // 固定为新榜，因为此函数专门用于新榜同步
          requestUrl: request_url, // 请求地址
          configId: config.id, // 配置ID
          totalAccounts: uniqueAccounts.length,
          syncedCount: totalSynced,
          errorCount: errors.length,
          errors: errors.length > 0 ? errors : undefined // 详细错误信息存储在execution_details中
        }
      });
    } catch (logError) {
      console.error('更新同步日志失败:', logError.message);
    }
  }

  // 如果同步了新数据，先进行数据去重和清理，再触发AI分析
  if (totalSynced > 0) {
    try {
      console.log(`[新榜同步] 开始数据去重和清理...`);
      const newsDeduplication = require('../utils/newsDeduplication');
      
      // 异步执行数据去重，不阻塞同步响应
      setImmediate(async () => {
        try {
          await newsDeduplication.executeDeduplication();
          console.log(`[新榜同步] ✓ 数据去重完成`);
          
          // 数据去重完成后，触发AI分析
          console.log(`[新榜同步] 开始AI分析 ${totalSynced} 条新数据...`);
          const newsAnalysis = require('../utils/newsAnalysis');
          await newsAnalysis.batchAnalyzeNews(totalSynced);
          console.log(`[新榜同步] ✓ AI分析完成，已分析 ${totalSynced} 条新闻`);
        } catch (deduplicationError) {
          console.error(`[新榜同步] ✗ 数据去重失败:`, deduplicationError.message);
          // 即使去重失败，也继续执行AI分析
          try {
            const newsAnalysis = require('../utils/newsAnalysis');
          await newsAnalysis.batchAnalyzeNews(totalSynced);
          console.log(`[新榜同步] ✓ AI分析完成，已分析 ${totalSynced} 条新闻`);
        } catch (analysisError) {
          console.error(`[新榜同步] ✗ AI分析失败:`, analysisError.message);
          }
        }
      });
    } catch (error) {
      console.warn(`[新榜同步] ✗ 启动数据去重失败:`, error.message);
    }
  } else {
    console.log(`[新榜同步] 本次同步未获取到新数据`);
  }

  return {
    success: true,
    message: `同步完成，成功同步 ${totalSynced} 条数据${totalSynced > 0 ? '，已启动AI分析' : ''}`,
    data: {
      synced: totalSynced,
      total: uniqueAccounts.length,
      errors: errors.length > 0 ? errors : undefined
    }
  };
  } catch (error) {
    console.error('同步新闻数据失败：', error);
    throw error;
  }
}

/**
 * 如果需要，安排重试
 * @param {Object} config - 新闻接口配置
 * @param {Object} range - 时间范围 { from, to }
 * @param {Object} options - 选项
 */
async function scheduleRetryIfNeeded(config, range, options = {}) {
  const { isManual = false, logId = null, retryAttempt = 0 } = options;
  
  // 获取重试配置
  const retryCount = config.retry_count || 0;
  const retryInterval = config.retry_interval || 0;
  
  // 如果未配置重试或已达到最大重试次数，不进行重试
  if (retryCount <= 0 || retryInterval <= 0 || retryAttempt >= retryCount) {
    if (retryAttempt >= retryCount && retryCount > 0) {
      console.log(`[新闻同步] 配置 ${config.id} 已达到最大重试次数 ${retryCount}，不再重试`);
    }
    return;
  }
  
  // 计算下次重试时间（毫秒）
  const retryDelayMs = retryInterval * 60 * 1000;
  const retryTime = new Date(Date.now() + retryDelayMs);
  
  console.log(`[新闻同步] 配置 ${config.id} 未获取到数据，将在 ${retryInterval} 分钟后（${retryTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}）进行第 ${retryAttempt + 1} 次重试（共 ${retryCount} 次）`);
  
  // 使用 setTimeout 安排重试
  setTimeout(async () => {
    try {
      console.log(`[新闻同步] 配置 ${config.id} 开始第 ${retryAttempt + 1} 次重试`);
      
      // 重新获取配置（可能已被更新）
      const updatedConfigs = await db.query(
        'SELECT nic.*, a.app_name FROM news_interface_config nic LEFT JOIN applications a ON nic.app_id = a.id WHERE nic.id = ? AND nic.is_active = 1 AND nic.is_deleted = 0',
        [config.id]
      );
      
      if (updatedConfigs.length === 0) {
        console.log(`[新闻同步] 配置 ${config.id} 在重试时已不存在或已禁用，取消重试`);
        return;
      }
      
      const updatedConfig = updatedConfigs[0];
      
      // 检查重试配置是否仍然有效
      const currentRetryCount = updatedConfig.retry_count || 0;
      const currentRetryInterval = updatedConfig.retry_interval || 0;
      
      if (currentRetryCount <= 0 || currentRetryInterval <= 0) {
        console.log(`[新闻同步] 配置 ${config.id} 的重试配置已更改，取消重试`);
        return;
      }
      
      // 执行重试，使用相同的时间范围
      const retryResult = await syncConfigWithSchedule(updatedConfig, {
        isManual: false, // 重试视为定时任务
        runDate: new Date(),
        customRange: range, // 使用相同的时间范围
        logId: null, // 重试时创建新日志
        retryAttempt: retryAttempt + 1
      });
      
      const retrySyncedCount = retryResult.data?.synced || 0;
      
      if (retrySyncedCount > 0) {
        console.log(`[新闻同步] 配置 ${config.id} 第 ${retryAttempt + 1} 次重试成功，获取到 ${retrySyncedCount} 条数据`);
      } else {
        console.log(`[新闻同步] 配置 ${config.id} 第 ${retryAttempt + 1} 次重试仍未获取到数据`);
        // 如果还有剩余重试次数，继续安排下一次重试
        if (retryAttempt + 1 < currentRetryCount) {
          await scheduleRetryIfNeeded(updatedConfig, range, {
            isManual: false,
            logId: null,
            retryAttempt: retryAttempt + 1
          });
        }
      }
    } catch (error) {
      console.error(`[新闻同步] 配置 ${config.id} 第 ${retryAttempt + 1} 次重试失败:`, error.message);
    }
  }, retryDelayMs);
}

async function syncConfigWithSchedule(config, { isManual, runDate, customRange, logId = null, retryAttempt = 0 } = {}) {
  const frequency = getConfigFrequency(config) || 'daily';
  const customRangeEnabled = !!(customRange && customRange.from && customRange.to);
  
  // 获取当前时间（用于计算基准日期）
  const now = runDate || new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  const baseRunDate = createShanghaiDate(now);
  
  let fromDate;
  let toDate;

  if (customRangeEnabled) {
    // customRange.from 和 customRange.to 应该是字符串格式 "YYYY-MM-DD HH:mm:ss"
    // 解析字符串时，需要将其视为本地时区（Asia/Shanghai）的时间
    // 例如："2025-12-03 00:00:00" 应该被解析为 Asia/Shanghai 时区的 2025-12-03 00:00:00
    
    // 解析日期字符串（格式：YYYY-MM-DD HH:mm:ss）
    const parseLocalDateTime = (dateStr) => {
      const [datePart, timePart] = dateStr.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes, seconds] = timePart ? timePart.split(':').map(Number) : [0, 0, 0];
      // 创建本地时区的Date对象（不进行UTC转换）
      return new Date(year, month - 1, day, hours, minutes, seconds);
    };
    
    fromDate = parseLocalDateTime(customRange.from);
    toDate = parseLocalDateTime(customRange.to);
    
    console.log(`[新闻同步] 自定义时间范围: ${customRange.from} -> ${customRange.to}`);
    console.log(`[新闻同步] 解析后的日期对象: ${fromDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} -> ${toDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    
    baseRunDate.setTime(toDate.getTime());
  } else {
    const skipHolidayCheck = isManual || frequency !== 'daily';
    if (!skipHolidayCheck) {
      const workday = await isWorkdayDate(baseRunDate);
      if (!workday) {
        const runDateStr = formatDateOnly(baseRunDate);
        console.log(`[新闻同步] 配置 ${config.id} 在 ${runDateStr} 为节假日，跳过执行`);
        return { success: true, skipped: true, reason: 'holiday', runDate: runDateStr };
      }
    }

    // 使用baseRunDate（已基于Asia/Shanghai时区计算）作为toDate
    // toDate 应该是执行日期的前一天23:59:59，因为要抓取的是执行日期之前的数据
    toDate = new Date(baseRunDate);
    toDate.setDate(toDate.getDate() - 1); // 执行日期前一天
    toDate.setHours(23, 59, 59, 999); // 设置为前一天的23:59:59
    
    if (isManual) {
      // 手动触发时，始终使用前一天00:00:00到当天00:00:00，忽略last_sync_time
      // 这样可以确保手动触发时只同步昨天的数据，而不是从上次同步时间开始
      const yesterdayDate = new Date(baseRunDate);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      fromDate = new Date(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate(), 0, 0, 0);
    } else {
      // 定时任务时，使用上一次同步日期到当前执行日期之间的范围（使用北京时区）
      // 这样可以确保不遗漏跳过节假日期间的数据
      if (config.last_sync_date) {
        // 如果有 last_sync_date，从 last_sync_date + 1天 开始（北京时区）
        // last_sync_date 可能是字符串（YYYY-MM-DD格式）或Date对象
        let lastSyncDateStr;
        if (config.last_sync_date instanceof Date) {
          // 如果是Date对象，转换为YYYY-MM-DD格式字符串（北京时区）
          const beijingDateStr = config.last_sync_date.toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          const datePart = beijingDateStr.split(' ')[0];
          const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
          lastSyncDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        } else if (typeof config.last_sync_date === 'string') {
          lastSyncDateStr = config.last_sync_date;
        } else {
          // 其他类型，尝试转换为字符串
          lastSyncDateStr = String(config.last_sync_date);
        }
        
        // 解析日期字符串，从上次同步日期开始（不+1天，因为要包含上次同步的那一天）
        const [year, month, day] = lastSyncDateStr.split('-').map(Number);
        const lastSyncDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
        // 从上次同步日期开始（不+1天），确保包含上次同步的那一天
        fromDate = lastSyncDate;
        
        console.log(`[新闻同步] 使用上次同步日期计算时间范围（北京时区）:`);
        console.log(`[新闻同步] - 上次同步日期: ${lastSyncDateStr}`);
        console.log(`[新闻同步] - 起始日期（从上次同步日期开始）: ${fromDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      } else if (config.last_sync_time) {
        // 如果有 last_sync_time，从 last_sync_time 的日期开始（北京时区，不+1天）
        const lastSyncTime = new Date(config.last_sync_time);
        // 获取北京时区的日期部分
        const beijingDateStr = lastSyncTime.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const datePart = beijingDateStr.split(' ')[0];
        const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
        const lastSyncDateOnly = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
        // 从上次同步日期开始（不+1天），确保包含上次同步的那一天
        fromDate = lastSyncDateOnly;
        
        console.log(`[新闻同步] 使用上次同步时间计算时间范围（北京时区）:`);
        console.log(`[新闻同步] - 上次同步时间: ${config.last_sync_time}`);
        console.log(`[新闻同步] - 起始日期（从上次同步日期开始）: ${fromDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      } else {
        // 如果没有上次同步记录，使用前一天00:00:00（北京时区）
        const yesterdayDate = new Date(baseRunDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        yesterdayDate.setHours(0, 0, 0, 0);
        fromDate = yesterdayDate;
        
        console.log(`[新闻同步] 首次执行，使用前一天作为起始日期（北京时区）:`);
        console.log(`[新闻同步] - 起始日期: ${fromDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      }
    }
    
    console.log(`[新闻同步] 时间范围计算（定时任务）:`);
    console.log(`[新闻同步] - baseRunDate: ${baseRunDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`[新闻同步] - fromDate: ${fromDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`[新闻同步] - toDate: ${toDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  }

  if (!toDate || !fromDate) {
    return { success: true, skipped: true, reason: 'invalid-range', runDate: formatDateOnly(baseRunDate) };
  }

  if (toDate.getTime() <= fromDate.getTime()) {
    return { success: true, skipped: true, reason: 'no-range', runDate: formatDateOnly(toDate) };
  }

  // 第一次尝试：使用上一次同步时间到当天的范围（如果存在）
  let range = {
    from: formatDate(fromDate),
    to: formatDate(toDate)
  };

  console.log(`[新闻同步] 配置 ${config.id}(${config.app_name || ''}) 区间 ${range.from} -> ${range.to}`);
  
  // 根据接口类型选择同步函数
  const interfaceType = config.interface_type || '新榜';
  let result;
  
  if (interfaceType === '企查查') {
    // 企查查接口使用syncQichachaNewsData，它有自己的时间范围计算逻辑
    console.log(`[新闻同步] 企查查接口，调用syncQichachaNewsData`);
    result = await syncQichachaNewsData(config.id, logId);
  } else if (interfaceType === '上海国际集团') {
    const newsType = (config.news_type || '新闻舆情').trim();
    if (newsType === '被执行人') {
      console.log(`[新闻同步] 上海国际集团接口(被执行人)，调用syncShanghaiInternationalGroupExecPersData`);
      result = await syncShanghaiInternationalGroupExecPersData(config.id, logId);
    } else if (newsType === '裁判文书') {
      console.log(`[新闻同步] 上海国际集团接口(裁判文书)，调用syncShanghaiInternationalGroupJudgmentData`);
      result = await syncShanghaiInternationalGroupJudgmentData(config.id, logId);
    } else if (newsType === '法院公告') {
      console.log(`[新闻同步] 上海国际集团接口(法院公告)，调用syncShanghaiInternationalGroupCourtAnnouncementData`);
      result = await syncShanghaiInternationalGroupCourtAnnouncementData(config.id, logId);
    } else if (newsType === '送达公告') {
      console.log(`[新闻同步] 上海国际集团接口(送达公告)，调用syncShanghaiInternationalGroupDeliveryAnnouncementData`);
      result = await syncShanghaiInternationalGroupDeliveryAnnouncementData(config.id, logId);
    } else if (newsType === '开庭公告') {
      console.log(`[新闻同步] 上海国际集团接口(开庭公告)，调用syncShanghaiInternationalGroupCourtHearingData`);
      result = await syncShanghaiInternationalGroupCourtHearingData(config.id, logId);
    } else if (newsType === '立案信息') {
      console.log(`[新闻同步] 上海国际集团接口(立案信息)，调用syncShanghaiInternationalGroupFilingData`);
      result = await syncShanghaiInternationalGroupFilingData(config.id, logId);
    } else if (newsType === '破产重整') {
      console.log(`[新闻同步] 上海国际集团接口(破产重整)，调用syncShanghaiInternationalGroupBankrptReorgData`);
      result = await syncShanghaiInternationalGroupBankrptReorgData(config.id, logId);
    } else if (newsType === '失信被执行人') {
      console.log(`[新闻同步] 上海国际集团接口(失信被执行人)，调用syncShanghaiInternationalGroupDiscrdtExecData`);
      result = await syncShanghaiInternationalGroupDiscrdtExecData(config.id, logId);
    } else if (newsType === '限制高消费') {
      console.log(`[新闻同步] 上海国际集团接口(限制高消费)，调用syncShanghaiInternationalGroupRestrictHighConsData`);
      result = await syncShanghaiInternationalGroupRestrictHighConsData(config.id, logId);
    } else if (newsType === '行政处罚') {
      console.log(`[新闻同步] 上海国际集团接口(行政处罚)，调用syncShanghaiInternationalGroupAdminPnshData`);
      result = await syncShanghaiInternationalGroupAdminPnshData(config.id, logId);
    } else if (newsType === '终本案件') {
      console.log(`[新闻同步] 上海国际集团接口(终本案件)，调用syncShanghaiInternationalGroupFinalCaseData`);
      result = await syncShanghaiInternationalGroupFinalCaseData(config.id, logId);
    } else if (newsType === '同花顺订阅') {
      console.log(`[新闻同步] 上海国际集团接口(同花顺订阅)，调用syncShanghaiInternationalGroupThsSubscriptionData`);
      result = await syncShanghaiInternationalGroupThsSubscriptionData(config.id, logId);
    } else {
      console.log(`[新闻同步] 上海国际集团接口，调用syncShanghaiInternationalGroupNewsData`);
      result = await syncShanghaiInternationalGroupNewsData(config.id, logId);
    }
  } else {
    // 新榜接口使用executeNewsSyncForConfig
    console.log(`[新闻同步] 新榜接口，调用executeNewsSyncForConfig`);
    result = await executeNewsSyncForConfig(config, range, { isManual, logId });
  }

  // 检查是否获取到数据
  const syncedCount = result.data?.synced || 0;
  
  // 拖底逻辑：如果有上一次同步时间但没有获取到数据，使用前一天00:00:00到当天00:00:00
  // 注意：企查查、上海国际集团接口不需要拖底逻辑，它们有自己的时间范围计算逻辑
  if (interfaceType !== '企查查' && interfaceType !== '上海国际集团' && config.last_sync_time && syncedCount === 0 && !customRangeEnabled) {
    console.log(`[新闻同步] 配置 ${config.id} 使用上一次同步时间未获取到数据，启用拖底逻辑：获取前一天00:00:00到当天00:00:00的新闻`);
    
    // 使用拖底逻辑：前一天00:00:00到当天00:00:00
    const fallbackToDate = new Date(baseRunDate);
    const fallbackFromDate = startOfDay(addDays(fallbackToDate, -1));
    
    const fallbackRange = {
      from: formatDate(fallbackFromDate),
      to: formatDate(fallbackToDate)
    };
    
    console.log(`[新闻同步] 配置 ${config.id}(${config.app_name || ''}) 拖底区间 ${fallbackRange.from} -> ${fallbackRange.to}`);
    
    // 使用拖底范围重新执行同步（仅新榜接口）
    const fallbackResult = await executeNewsSyncForConfig(config, fallbackRange, { isManual, logId });
    
    // 检查拖底逻辑后是否获取到数据
    const fallbackSyncedCount = fallbackResult.data?.synced || 0;
    
    // 注意：last_sync_time 的更新现在在 updateSyncLog 函数中处理
    // 这里不再需要更新，因为 updateSyncLog 会使用执行日志的 end_time 来更新 last_sync_time
    
    // 如果拖底逻辑后仍未获取到数据，检查是否需要重试（仅在非手动触发且非重试时）
    if (fallbackSyncedCount === 0 && !isManual && retryAttempt === 0) {
      await scheduleRetryIfNeeded(config, fallbackRange, { isManual, logId, retryAttempt: 0 });
    }
    
    return {
      ...fallbackResult,
      runDate: formatDateOnly(fallbackToDate),
      usedFallback: true // 标记使用了拖底逻辑
    };
  }
  
  // 如果未获取到数据且未使用拖底逻辑，检查是否需要重试（仅在非手动触发且非重试时）
  if (syncedCount === 0 && !customRangeEnabled && !isManual && retryAttempt === 0) {
    await scheduleRetryIfNeeded(config, range, { isManual, logId, retryAttempt: 0 });
  }

  // 注意：last_sync_time 的更新现在在 updateSyncLog 函数中处理
  // 这里不再需要更新，因为 updateSyncLog 会使用执行日志的 end_time 来更新 last_sync_time

  return {
    ...result,
    runDate: formatDateOnly(toDate),
    usedFallback: false
  };
}

async function syncNewsData(options = {}) {
  if (typeof options === 'boolean') {
    options = { isManual: options };
  }
  const { isManual = true, configId = null, runDate = null, customRange = null, logId = null } = options || {};

  try {
    const params = [];
    let sql = `
      SELECT nic.*, a.app_name
      FROM news_interface_config nic
      LEFT JOIN applications a ON nic.app_id = a.id
      WHERE nic.is_active = 1 AND nic.is_deleted = 0
    `;
    if (configId) {
      sql += ' AND nic.id = ?';
      params.push(configId);
    }
    sql += ' ORDER BY nic.created_at ASC';

    const configs = await db.query(sql, params);
    if (!configs.length) {
      if (configId) {
        throw new Error('未找到可用的新闻接口配置');
      }
      return { success: true, message: '没有可执行的新闻接口配置', data: [] };
    }

    const results = [];
    let totalSyncedAll = 0;
    let totalConfigs = configs.length;
    let successConfigs = 0;
    
    for (const config of configs) {
      try {
        // 为每个配置创建日志（手动触发和定时任务都需要）
        // 如果提供了logId（单个配置手动触发时），使用它；否则为每个配置创建新日志
        let configLogId = logId;
        if (!configLogId) {
          try {
            configLogId = await createSyncLog({
              configId: config.id,
              executionType: isManual ? 'manual' : 'scheduled',
              userId: null,
              executionDetails: {
                interfaceType: config.interface_type || '新榜',
                requestUrl: config.request_url, // 请求地址
                configId: config.id // 配置ID
              }
            });
          } catch (logError) {
            console.error('创建同步日志失败:', logError.message);
          }
        }
        
        const res = await syncConfigWithSchedule(config, { isManual, runDate, customRange, logId: configLogId });
        const syncedCount = res.data?.synced || 0;
        totalSyncedAll += syncedCount;
        if (res.success) {
          successConfigs++;
        }
        results.push({
          configId: config.id,
          appId: config.app_id,
          appName: config.app_name || '',
          ...res
        });
      } catch (err) {
        errorWithTag('[新闻同步]', `配置 ${config.id} 同步失败：`, err);
        results.push({
          configId: config.id,
          appId: config.app_id,
          appName: config.app_name || '',
          success: false,
          error: err.message
        });
      }
    }

    // 输出总体统计
    logWithTag('[新闻同步]', '========== 总体统计 ==========');
    logWithTag('[新闻同步]', `配置总数: ${totalConfigs}`);
    logWithTag('[新闻同步]', `成功配置: ${successConfigs}`);
    logWithTag('[新闻同步]', `失败配置: ${totalConfigs - successConfigs}`);
    logWithTag('[新闻同步]', `总同步数量: ${totalSyncedAll} 条新闻`);
    logWithTag('[新闻同步]', '=============================');

    return {
      success: true,
      message: `新闻同步任务已执行，共同步 ${totalSyncedAll} 条新闻`,
      data: results,
      summary: {
        totalConfigs,
        successConfigs,
        failedConfigs: totalConfigs - successConfigs,
        totalSynced: totalSyncedAll
      }
    };
  } catch (error) {
    console.error('同步新闻数据失败：', error);
    throw error;
  }
}

/**
 * 手动同步公众号文章数据
 */
// 手动触发新闻同步接口（支持可选 start_time、end_time 控制同步时间范围，格式：YYYY-MM-DD HH:mm:ss）
router.post('/sync', async (req, res) => {
  let logId = null;
  try {
    const { config_id, start_time, end_time } = req.body;
    const userId = req.headers['x-user-id'] || null;

    if (!config_id) {
      return res.status(400).json({ success: false, message: '请提供配置ID' });
    }

    // 获取配置
    const configs = await db.query('SELECT * FROM news_interface_config WHERE id = ?', [config_id]);
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const config = configs[0];
    if (config.is_active !== 1) {
      return res.status(400).json({ success: false, message: '配置未启用' });
    }

    // 自定义时间范围（弹窗传入）：格式 YYYY-MM-DD HH:mm:ss
    const customRange = (start_time && end_time && String(start_time).trim() && String(end_time).trim())
      ? { from: String(start_time).trim(), to: String(end_time).trim() }
      : null;
    if (customRange) {
      logWithTag('[手动同步]', `使用自定义时间范围: ${customRange.from} 至 ${customRange.to}`);
    }

    // 创建日志记录
    try {
      logId = await createSyncLog({
        configId: config_id,
        executionType: 'manual',
        userId: userId,
        executionDetails: {
          interfaceType: config.interface_type || '新榜',
          requestUrl: config.request_url,
          ...(customRange && { customRange })
        }
      });
    } catch (logError) {
      console.error('创建同步日志失败:', logError.message);
    }

    logWithTag('[手动同步]', '========== 开始手动同步 ==========');
    logWithTag('[手动同步]', `配置ID: ${config_id}`);
    logWithTag('[手动同步]', `接口类型: ${config.interface_type || '新榜'}`);
    const syncStartTime = Date.now(); // 接口触发开始时间，用于计算取数耗时
    logWithTag('[手动同步]', `触发时间: ${formatDate(new Date())}`);
    
    // 根据接口类型选择同步函数
    const interfaceType = config.interface_type || '新榜';
    let result;
    
    if (interfaceType === '企查查') {
      logWithTag('[手动同步]', '执行企查查新闻同步...');
      result = await syncQichachaNewsData(config_id, logId, customRange);
    } else if (interfaceType === '上海国际集团') {
      const newsType = (config.news_type || '新闻舆情').trim();
      if (newsType === '被执行人') {
        logWithTag('[手动同步]', '执行上海国际集团被执行人同步...');
        result = await syncShanghaiInternationalGroupExecPersData(config_id, logId, customRange);
      } else if (newsType === '裁判文书') {
        logWithTag('[手动同步]', '执行上海国际集团裁判文书同步...');
        result = await syncShanghaiInternationalGroupJudgmentData(config_id, logId, customRange);
      } else if (newsType === '法院公告') {
        logWithTag('[手动同步]', '执行上海国际集团法院公告同步...');
        result = await syncShanghaiInternationalGroupCourtAnnouncementData(config_id, logId, customRange);
      } else if (newsType === '送达公告') {
        logWithTag('[手动同步]', '执行上海国际集团送达公告同步...');
        result = await syncShanghaiInternationalGroupDeliveryAnnouncementData(config_id, logId, customRange);
      } else if (newsType === '开庭公告') {
        logWithTag('[手动同步]', '执行上海国际集团开庭公告同步...');
        result = await syncShanghaiInternationalGroupCourtHearingData(config_id, logId, customRange);
      } else if (newsType === '立案信息') {
        logWithTag('[手动同步]', '执行上海国际集团立案信息同步...');
        result = await syncShanghaiInternationalGroupFilingData(config_id, logId, customRange);
      } else if (newsType === '破产重整') {
        logWithTag('[手动同步]', '执行上海国际集团破产重整同步...');
        result = await syncShanghaiInternationalGroupBankrptReorgData(config_id, logId, customRange);
      } else if (newsType === '失信被执行人') {
        logWithTag('[手动同步]', '执行上海国际集团失信被执行人同步...');
        result = await syncShanghaiInternationalGroupDiscrdtExecData(config_id, logId, customRange);
      } else if (newsType === '限制高消费') {
        logWithTag('[手动同步]', '执行上海国际集团限制高消费同步...');
        result = await syncShanghaiInternationalGroupRestrictHighConsData(config_id, logId, customRange);
      } else if (newsType === '行政处罚') {
        logWithTag('[手动同步]', '执行上海国际集团行政处罚同步...');
        result = await syncShanghaiInternationalGroupAdminPnshData(config_id, logId, customRange);
      } else if (newsType === '终本案件') {
        logWithTag('[手动同步]', '执行上海国际集团终本案件同步...');
        result = await syncShanghaiInternationalGroupFinalCaseData(config_id, logId, customRange);
      } else if (newsType === '同花顺订阅') {
        logWithTag('[手动同步]', '执行上海国际集团同花顺订阅同步...');
        result = await syncShanghaiInternationalGroupThsSubscriptionData(config_id, logId, customRange);
      } else {
        logWithTag('[手动同步]', '执行上海国际集团新闻同步...');
        result = await syncShanghaiInternationalGroupNewsData(config_id, logId, customRange);
      }
    } else {
      logWithTag('[手动同步]', '执行新榜新闻同步...');
      
      const now = new Date();
      const todayStart = createShanghaiDate(now);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const defaultRange = { from: formatDate(yesterdayStart), to: formatDate(todayStart) };
      const rangeToUse = customRange || defaultRange;

      if (!customRange) {
        logWithTag('[手动同步]', `服务器当前时间: ${now.toISOString()}`);
        logWithTag('[手动同步]', '计算的时间范围:');
        logWithTag('[手动同步]', `- 昨天开始: ${rangeToUse.from}`);
        logWithTag('[手动同步]', `- 今天开始: ${rangeToUse.to}`);
      }
      
      result = await syncNewsData({
        isManual: true,
        configId: config_id,
        customRange: rangeToUse,
        logId: logId
      });
    }

    // 本次接口取数时间 = 接口触发结束时间 - 接口触发开始时间
    const syncEndTime = Date.now();
    const durationMs = syncEndTime - syncStartTime;
    const durationSec = Math.floor(durationMs / 1000);
    const durationMin = Math.floor(durationSec / 60);
    const durationRemSec = durationSec % 60;
    const durationText = `${durationMin}分${durationRemSec}秒`;
    const summaryMessage = (result.message || '同步完成') + `，本次接口取数时间 ${durationText}`;
    
    const syncedCount = result.data?.synced ?? (Array.isArray(result.data) && result.data[0] ? (result.data[0].data?.synced ?? 0) : 0);
    const totalCount = result.data?.total ?? (Array.isArray(result.data) && result.data[0] ? (result.data[0].data?.total ?? 0) : 0);
    logWithTag('[手动同步]', '========== 同步完成 ==========');
    logWithTag('[手动同步]', '结果:', JSON.stringify({
      success: result.success,
      message: summaryMessage,
      synced: syncedCount,
      total: totalCount,
      duration: durationText,
      durationSeconds: durationSec
    }, null, 2));
    console.log(`[手动同步] =============================`);
    
    res.json({
      success: true,
      message: summaryMessage,
      data: result.data,
      duration: durationText,
      durationSeconds: durationSec,
      logId: logId
    });
  } catch (error) {
    errorWithTag('[手动同步]', '同步新闻数据失败：', error);
    res.status(500).json({ success: false, message: '同步失败：' + error.message });
  }
});

// 获取用户相关的舆情统计信息
router.get('/user-stats', async (req, res) => {
  try {
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    // 检查用户是否有"新闻舆情"应用权限
    if (userRole !== 'admin' && userId) {
      const hasPermission = await checkNewsPermission(userId);
      if (!hasPermission) {
        return res.json({
          success: true,
          data: {
            yesterdayCount: 0,
            totalCount: 0
          }
        });
      }
    }

    if (!userId) {
      return res.json({
        success: true,
        data: {
          yesterdayCount: 0,
          totalCount: 0
        }
      });
    }

    // 查询用户创建的被投企业总数（退出状态不为完全退出）
    const totalEnterprisesQuery = `
      SELECT COUNT(*) as count
      FROM invested_enterprises 
      WHERE creator_user_id = ? 
      AND exit_status NOT IN ('完全退出', '已上市')
      AND delete_mark = 0
    `;
    
    const totalEnterprisesResult = await db.query(totalEnterprisesQuery, [userId]);
    const totalEnterprises = totalEnterprisesResult[0].count;

    // 查询用户创建的被投企业的微信公众号ID
    let wechatAccountsQuery = `
      SELECT DISTINCT wechat_official_account_id 
      FROM invested_enterprises 
      WHERE creator_user_id = ? 
      AND wechat_official_account_id IS NOT NULL 
      AND wechat_official_account_id != ''
      AND exit_status NOT IN ('完全退出', '已上市')
      AND delete_mark = 0
    `;
    
    const wechatAccounts = await db.query(wechatAccountsQuery, [userId]);

    // 查询用户添加的额外公众号ID
    const userAdditionalAccounts = await db.query(
      `SELECT DISTINCT wechat_account_id 
       FROM additional_wechat_accounts 
       WHERE creator_user_id = ? 
       AND status = 'active' 
       AND wechat_account_id IS NOT NULL 
       AND wechat_account_id != ''
       AND delete_mark = 0`,
      [userId]
    );

    // 提取微信公众号ID列表：被投企业 + 用户添加的额外公众号
    const accountIds = [];
    wechatAccounts.forEach(item => {
      const ids = splitAccountIds(item.wechat_official_account_id);
      accountIds.push(...ids);
    });
    userAdditionalAccounts.forEach(item => {
      accountIds.push(item.wechat_account_id);
    });
    const uniqueAccountIds = [...new Set(accountIds)];

    if (uniqueAccountIds.length === 0) {
      return res.json({
        success: true,
        data: {
          yesterdayCount: 0,
          yesterdayAccountsCount: 0,
          totalCount: 0,
          totalAccountsCount: 0,
          totalEnterprises: totalEnterprises
        }
      });
    }

    // 构建查询条件
    let condition = 'FROM news_detail WHERE wechat_account IN (';
    const params = [];
    
    // 添加微信公众号ID占位符（包含被投企业 + 额外公众号）
    const placeholders = uniqueAccountIds.map(() => '?').join(',');
    condition += placeholders + ') AND delete_mark = 0';
    params.push(...uniqueAccountIds);

    // 计算昨日日期范围
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // 查询昨日新增数量
    const yesterdayCondition = condition + ' AND created_at >= ? AND created_at <= ?';
    const yesterdayParams = [...params, yesterdayStart, yesterdayEnd];
    const yesterdayResult = await db.query(`SELECT COUNT(*) as count ${yesterdayCondition}`, yesterdayParams);

    // 查询昨日发布新闻的企业个数（去重）
    const yesterdayAccountsCondition = condition + ' AND created_at >= ? AND created_at <= ?';
    const yesterdayAccountsParams = [...params, yesterdayStart, yesterdayEnd];
    const yesterdayAccountsResult = await db.query(
      `SELECT COUNT(DISTINCT wechat_account) as count ${yesterdayAccountsCondition}`, 
      yesterdayAccountsParams
    );

    // 查询总数量
    const totalResult = await db.query(`SELECT COUNT(*) as count ${condition}`, params);

    res.json({
      success: true,
      data: {
        yesterdayCount: yesterdayResult[0].count,
        yesterdayAccountsCount: yesterdayAccountsResult[0].count,
        totalCount: totalResult[0].count,
        totalAccountsCount: uniqueAccountIds.length,
        totalEnterprises: totalEnterprises
      }
    });
  } catch (error) {
    errorWithTag('[用户统计]', '查询用户舆情统计失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 获取用户相关的舆情信息（根据用户创建的被投企业的微信公众号）
router.get('/user-news', async (req, res) => {
  try {
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    // 检查用户是否有"新闻舆情"应用权限
    if (userRole !== 'admin' && userId) {
      const hasPermission = await checkNewsPermission(userId);
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: '您没有访问舆情信息的权限'
        });
      }
    }

    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 10;
    const search = req.query.search || '';
    const timeRange = req.query.timeRange || 'all'; // yesterday, thisWeek, thisMonth, all
    const enterpriseFilter = req.query.enterpriseFilter || 'all'; // enterprise, all
    const offset = (page - 1) * pageSize;

    // 计算时间范围（使用北京时区）
    let timeCondition = '';
    let timeParams = [];
    
    // 使用北京时区获取当前时间
    const now = new Date();
    const beijingNow = createShanghaiDate(now);
    
    if (timeRange === 'yesterday') {
      // 昨日舆情：显示今天创建的数据（created_at是今天，北京时区）
      const todayStart = new Date(beijingNow);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(beijingNow);
      todayEnd.setHours(23, 59, 59, 999);
      
      timeCondition = ' AND created_at >= ? AND created_at <= ?';
      timeParams = [todayStart, todayEnd];
    } else if (timeRange === 'thisWeek') {
      // 本周：本周一00:00:00到现在（北京时区）
      const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
      
      // 获取北京时区的星期几（0=周日, 1=周一, ..., 6=周六）
      const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
      const daysToMonday = beijingDayOfWeek === 0 ? 6 : beijingDayOfWeek - 1; // 0是周日，需要调整
      
      const weekStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
      weekStart.setDate(weekStart.getDate() - daysToMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      timeCondition = ' AND public_time >= ?';
      timeParams = [weekStart];
    } else if (timeRange === 'lastWeek') {
      // 上周：上周一00:00:00到上周日23:59:59（北京时区）
      const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
      
      // 获取北京时区的星期几（0=周日, 1=周一, ..., 6=周六）
      const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
      // 计算上周一：周日需要回退14天（本周一往前推7天），其他天回退(dayOfWeek - 1 + 7)天
      const daysToLastMonday = beijingDayOfWeek === 0 ? 14 : beijingDayOfWeek - 1 + 7; // 上周一
      
      const lastMonday = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
      lastMonday.setDate(lastMonday.getDate() - daysToLastMonday);
      lastMonday.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);
      
      // 支持public_time或created_at在上周范围内（用于处理企查查新闻public_time可能为NULL的情况）
      timeCondition = ' AND ((public_time >= ? AND public_time <= ?) OR (public_time IS NULL AND created_at >= ? AND created_at <= ?))';
      timeParams = [lastMonday, lastSunday, lastMonday, lastSunday];
    } else if (timeRange === 'thisMonth') {
      // 本月：本月1日00:00:00到现在（北京时区）
      const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth] = beijingDateStr.split(/[\/\-]/).map(Number);
      
      const monthStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-01T00:00:00+08:00`);
      
      timeCondition = ' AND public_time >= ?';
      timeParams = [monthStart];
    }
    // timeRange === 'all' 时不添加时间条件

    if (!userId) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        pageSize
      });
    }

    // 查询用户创建的被投企业的微信公众号ID和企业全称
    let enterprisesQuery = `
      SELECT DISTINCT wechat_official_account_id, enterprise_full_name
      FROM invested_enterprises 
      WHERE creator_user_id = ? 
      AND delete_mark = 0
    `;
    
    const enterprises = await db.query(enterprisesQuery, [userId]);

    // 查询用户添加的额外公众号ID
    const userAdditionalAccounts = await db.query(
      `SELECT DISTINCT wechat_account_id 
       FROM additional_wechat_accounts 
       WHERE creator_user_id = ? 
       AND status = 'active' 
       AND wechat_account_id IS NOT NULL 
       AND wechat_account_id != ''
       AND delete_mark = 0`,
      [userId]
    );

    // 提取微信公众号ID列表（用于匹配新榜新闻）：被投企业 + 用户添加的额外公众号
    const accountIds = enterprises
      .filter(item => item.wechat_official_account_id && item.wechat_official_account_id !== '')
      .flatMap(item => splitAccountIds(item.wechat_official_account_id));
    userAdditionalAccounts.forEach(item => {
      accountIds.push(item.wechat_account_id);
    });
    const uniqueAccountIds = [...new Set(accountIds)];
    
    // 提取企业全称列表（用于匹配企查查新闻）
    const enterpriseNames = enterprises
      .filter(item => item.enterprise_full_name && item.enterprise_full_name !== '')
      .map(item => item.enterprise_full_name);

    // 构建查询条件：支持新榜（通过wechat_account）和企查查（通过enterprise_full_name）
    let condition = 'FROM news_detail WHERE delete_mark = 0 AND (';
    const params = [];
    const conditions = [];
    
    // 新榜新闻：通过wechat_account匹配（含被投企业 + 额外公众号）
    if (uniqueAccountIds.length > 0) {
      const placeholders = uniqueAccountIds.map(() => '?').join(',');
      conditions.push(`wechat_account IN (${placeholders})`);
      params.push(...uniqueAccountIds);
    }
    
    // 企查查新闻：通过enterprise_full_name匹配
    if (enterpriseNames.length > 0) {
      const placeholders = enterpriseNames.map(() => '?').join(',');
      conditions.push(`enterprise_full_name IN (${placeholders})`);
      params.push(...enterpriseNames);
    }
    
    if (conditions.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        pageSize
      });
    }
    
    condition += conditions.join(' OR ') + ')';

    // 添加时间条件
    if (timeCondition) {
      condition += timeCondition;
      params.push(...timeParams);
    }

    // 添加企业过滤条件
    if (enterpriseFilter === 'enterprise') {
      // 企业相关：只显示企业类型为被投企业的数据
      condition += ' AND entity_type = \'被投企业\'';
    } else if (enterpriseFilter === 'fund') {
      // 基金相关主体：只显示企业类型为基金相关主体的数据
      condition += ' AND entity_type = \'基金相关主体\'';
    } else if (enterpriseFilter === 'sub_fund') {
      // 子基金：只显示企业类型为子基金、子基金管理人、子基金GP的数据
      condition += ' AND entity_type IN (\'子基金\', \'子基金管理人\', \'子基金GP\')';
    }

    // 添加搜索条件（支持多标签搜索）
    const userSearchTags = req.query.searchTags ? req.query.searchTags.split(',').filter(tag => tag.trim()) : [];
    if (userSearchTags.length > 0) {
      // 多标签搜索：任一标签匹配即可（OR关系）
      const tagConditions = userSearchTags.map(() => `(
        title LIKE ? OR 
        news_abstract LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        fund LIKE ? OR 
        sub_fund LIKE ? OR 
        enterprise_abbreviation LIKE ? OR 
        account_name LIKE ? OR 
        wechat_account LIKE ?
      )`).join(' OR ');
      condition += ' AND (' + tagConditions + ')';
      userSearchTags.forEach(tag => {
        const searchTerm = `%${tag.trim()}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      });
    } else if (search) {
      condition += ' AND (title LIKE ? OR news_abstract LIKE ? OR enterprise_full_name LIKE ? OR fund LIKE ? OR sub_fund LIKE ? OR enterprise_abbreviation LIKE ? OR account_name LIKE ? OR wechat_account LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // 查询数据（有企业的优先，然后按发布时间降序）
    const data = await db.query(
      `SELECT account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, public_time, title, source_url, keywords, fund, sub_fund, entity_type, news_abstract, news_sentiment
       ${condition}
       ORDER BY
         CASE WHEN enterprise_full_name IS NOT NULL AND enterprise_full_name != '' THEN 0 ELSE 1 END,
         public_time DESC,
         created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );

    const totalRows = await db.query(`SELECT COUNT(*) as total ${condition}`, params);

    // 解析 keywords JSON 字段
    const formattedData = data.map(item => {
      let keywords = [];
      if (item.keywords) {
        try {
          if (typeof item.keywords === 'string') {
            keywords = JSON.parse(item.keywords);
          } else {
            keywords = item.keywords;
          }
        } catch (e) {
          console.warn('解析keywords失败:', e.message, '原始值:', item.keywords);
          keywords = [];
        }
      }
      return {
        account_name: item.account_name || '',
        wechat_account: item.wechat_account || '',
        enterprise_full_name: item.enterprise_full_name || '',
        enterprise_abbreviation: item.enterprise_abbreviation || null,
        public_time: item.public_time || '',
        title: item.title || '',
        source_url: item.source_url || '',
        keywords: keywords,
        fund: item.fund || null,
        sub_fund: item.sub_fund || null,
        entity_type: item.entity_type || null,
        news_abstract: item.news_abstract || null,
        news_sentiment: item.news_sentiment || null
      };
    });

    res.json({
      success: true,
      data: formattedData,
      total: totalRows[0].total,
      page,
      pageSize
    });
  } catch (error) {
    console.error('查询用户舆情信息失败：', error);
    console.error('错误详情：', error.message);
    console.error('错误堆栈：', error.stack);
    res.status(500).json({ 
      success: false, 
      message: '查询失败：' + (error.message || '未知错误') 
    });
  }
});

// 获取新闻列表（管理员使用）
router.get('/', async (req, res) => {
  try {
    // 检查用户权限
    const userRole = req.headers['x-user-role'] || 'user';
    const userId = req.headers['x-user-id'] || null;

    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    // 如果不是管理员，返回用户相关的舆情信息
    if (userRole !== 'admin') {
      // 重定向到用户新闻接口的逻辑
      const page = parseInt(req.query.page, 10) || 1;
      const pageSize = parseInt(req.query.pageSize, 10) || 10;
      const search = req.query.search || '';
      const offset = (page - 1) * pageSize;

      // 查询用户创建的被投企业的微信公众号ID
      let wechatAccountsQuery = `
        SELECT DISTINCT wechat_official_account_id 
        FROM invested_enterprises 
        WHERE creator_user_id = ? 
        AND wechat_official_account_id IS NOT NULL 
        AND wechat_official_account_id != ''
        AND delete_mark = 0
      `;
      
      const wechatAccounts = await db.query(wechatAccountsQuery, [userId]);

      // 查询用户添加的额外公众号ID
      const userAdditionalAccounts = await db.query(
        `SELECT DISTINCT wechat_account_id 
         FROM additional_wechat_accounts 
         WHERE creator_user_id = ? 
         AND status = 'active' 
         AND wechat_account_id IS NOT NULL 
         AND wechat_account_id != ''
         AND delete_mark = 0`,
        [userId]
      );

      // 提取微信公众号ID列表：被投企业 + 用户添加的额外公众号
      const accountIds = [];
      wechatAccounts.forEach(item => {
        const ids = splitAccountIds(item.wechat_official_account_id);
        accountIds.push(...ids);
      });
      userAdditionalAccounts.forEach(item => {
        accountIds.push(item.wechat_account_id);
      });
      const uniqueAccountIds = [...new Set(accountIds)];
      
      if (uniqueAccountIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          total: 0,
          page,
          pageSize
        });
      }

      // 构建查询条件
      let whereCondition = 'WHERE nd.wechat_account IN (';
      const params = [];
      
      // 添加微信公众号ID占位符（包含被投企业 + 额外公众号）
      const placeholders = uniqueAccountIds.map(() => '?').join(',');
      whereCondition += placeholders + ') AND nd.delete_mark = 0';
      params.push(...uniqueAccountIds);

      // 添加搜索条件（支持多标签搜索）
      const searchTags = req.query.searchTags ? req.query.searchTags.split(',').filter(tag => tag.trim()) : [];
      if (searchTags.length > 0) {
        // 多标签搜索：任一标签匹配即可（OR关系）
        const tagConditions = searchTags.map(() => `(
          nd.title LIKE ? OR 
          nd.news_abstract LIKE ? OR 
          nd.enterprise_full_name LIKE ? OR 
          nd.fund LIKE ? OR 
          nd.sub_fund LIKE ? OR 
          nd.enterprise_abbreviation LIKE ? OR 
          nd.account_name LIKE ? OR 
          nd.wechat_account LIKE ?
        )`).join(' OR ');
        whereCondition += ' AND (' + tagConditions + ')';
        searchTags.forEach(tag => {
          const searchTerm = `%${tag.trim()}%`;
          params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        });
      } else if (search) {
        whereCondition += ' AND (nd.title LIKE ? OR nd.news_abstract LIKE ? OR nd.enterprise_full_name LIKE ? OR nd.fund LIKE ? OR nd.sub_fund LIKE ? OR nd.enterprise_abbreviation LIKE ? OR nd.account_name LIKE ? OR nd.wechat_account LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      }

      // 查询数据（按发布时间降序）
      // 优先使用news_detail表中的entity_type，如果没有则从invested_enterprises表获取
      const data = await db.query(
        `SELECT nd.account_name, nd.wechat_account, nd.public_time, nd.title, nd.source_url, nd.keywords, nd.enterprise_full_name, nd.enterprise_abbreviation,
                nd.fund, nd.sub_fund, nd.news_abstract, nd.news_sentiment,
                COALESCE(nd.entity_type, ie.entity_type) as entity_type
         FROM news_detail nd
         LEFT JOIN invested_enterprises ie ON nd.enterprise_full_name = ie.enterprise_full_name AND ie.delete_mark = 0
         ${whereCondition}
         ORDER BY nd.public_time DESC, nd.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(pageSize), offset]
      );

      const totalRows = await db.query(
        `SELECT COUNT(*) as total
         FROM news_detail nd
         LEFT JOIN invested_enterprises ie ON nd.enterprise_full_name = ie.enterprise_full_name AND ie.delete_mark = 0
         ${whereCondition}`,
        params
      );

      // 解析 keywords JSON 字段
      const formattedData = data.map(item => {
        let keywords = [];
        if (item.keywords) {
          try {
            if (typeof item.keywords === 'string') {
              keywords = JSON.parse(item.keywords);
            } else {
              keywords = item.keywords;
            }
          } catch (e) {
            console.warn('解析keywords失败:', e.message, '原始值:', item.keywords);
            keywords = [];
          }
        }
        return {
          account_name: item.account_name || '',
          wechat_account: item.wechat_account || '',
          public_time: item.public_time || '',
          title: item.title || '',
          source_url: item.source_url || '',
          enterprise_full_name: item.enterprise_full_name || '',
          enterprise_abbreviation: item.enterprise_abbreviation || null,
          entity_type: item.entity_type || null,
          fund: item.fund || null,
          sub_fund: item.sub_fund || null,
          news_abstract: item.news_abstract || null,
          news_sentiment: item.news_sentiment || null,
          keywords: keywords
        };
      });

      return res.json({
        success: true,
        data: formattedData,
        total: totalRows[0].total,
        page,
        pageSize
      });
    }

    // 管理员可以查看所有数据
    const { page = 1, pageSize = 10, search, account, timeRange = 'all', enterpriseFilter = 'all' } = req.query;
    const offset = (page - 1) * pageSize;

    let whereCondition = 'WHERE nd.delete_mark = 0';
    const params = [];

    // 添加时间范围条件（管理员也支持时间筛选，使用北京时区）
    const now = new Date();
    const beijingNow = createShanghaiDate(now);
    
    if (timeRange === 'yesterday') {
      // 昨日舆情：显示今天创建的数据（created_at是今天，北京时区）
      const todayStart = new Date(beijingNow);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(beijingNow);
      todayEnd.setHours(23, 59, 59, 999);
      
      whereCondition += ' AND nd.created_at >= ? AND nd.created_at <= ?';
      params.push(todayStart, todayEnd);
    } else if (timeRange === 'thisWeek') {
      // 本周：本周一00:00:00到现在（北京时区）
      const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
      
      // 获取北京时区的星期几（0=周日, 1=周一, ..., 6=周六）
      const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
      const daysToMonday = beijingDayOfWeek === 0 ? 6 : beijingDayOfWeek - 1;
      
      const weekStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
      weekStart.setDate(weekStart.getDate() - daysToMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      whereCondition += ' AND nd.public_time >= ?';
      params.push(weekStart);
    } else if (timeRange === 'lastWeek') {
      // 上周：上周一00:00:00到上周日23:59:59（北京时区）
      // 对于企查查新闻，如果public_time为NULL，使用created_at作为替代
      const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
      
      // 获取北京时区的星期几（0=周日, 1=周一, ..., 6=周六）
      const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
      // 计算上周一：周日需要回退14天（本周一往前推7天），其他天回退(dayOfWeek - 1 + 7)天
      const daysToLastMonday = beijingDayOfWeek === 0 ? 14 : beijingDayOfWeek - 1 + 7; // 上周一
      
      const lastMonday = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
      lastMonday.setDate(lastMonday.getDate() - daysToLastMonday);
      lastMonday.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);
      
      // 支持public_time或created_at在上周范围内（用于处理企查查新闻public_time可能为NULL的情况）
      whereCondition += ' AND ((nd.public_time >= ? AND nd.public_time <= ?) OR (nd.public_time IS NULL AND nd.created_at >= ? AND nd.created_at <= ?))';
      params.push(lastMonday, lastSunday, lastMonday, lastSunday);
    } else if (timeRange === 'thisMonth') {
      // 本月：本月1日00:00:00到现在（北京时区）
      const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth] = beijingDateStr.split(/[\/\-]/).map(Number);
      
      const monthStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-01T00:00:00+08:00`);
      
      whereCondition += ' AND nd.public_time >= ?';
      params.push(monthStart);
    }

    // 添加企业过滤条件
    if (enterpriseFilter === 'enterprise') {
      // 企业相关：只显示企业类型为被投企业的数据
      whereCondition += ' AND COALESCE(nd.entity_type, ie.entity_type) = \'被投企业\'';
    } else if (enterpriseFilter === 'fund') {
      // 基金相关主体：只显示企业类型为基金相关主体的数据
      whereCondition += ' AND COALESCE(nd.entity_type, ie.entity_type) = \'基金相关主体\'';
    } else if (enterpriseFilter === 'sub_fund') {
      // 子基金：只显示企业类型为子基金、子基金管理人、子基金GP的数据
      whereCondition += ' AND COALESCE(nd.entity_type, ie.entity_type) IN (\'子基金\', \'子基金管理人\', \'子基金GP\')';
    }

    // 添加搜索条件（支持多标签搜索）
    const searchTags = req.query.searchTags ? req.query.searchTags.split(',').filter(tag => tag.trim()) : [];
    if (searchTags.length > 0) {
      // 多标签搜索：任一标签匹配即可（OR关系）
      const tagConditions = searchTags.map(() => `(
        nd.title LIKE ? OR 
        nd.news_abstract LIKE ? OR 
        nd.enterprise_full_name LIKE ? OR 
        nd.fund LIKE ? OR 
        nd.sub_fund LIKE ? OR 
        nd.enterprise_abbreviation LIKE ? OR 
        nd.account_name LIKE ? OR 
        nd.wechat_account LIKE ?
      )`).join(' OR ');
      whereCondition += ' AND (' + tagConditions + ')';
      searchTags.forEach(tag => {
        const searchTerm = `%${tag.trim()}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      });
    } else if (search) {
      whereCondition += ' AND (nd.title LIKE ? OR nd.news_abstract LIKE ? OR nd.enterprise_full_name LIKE ? OR nd.fund LIKE ? OR nd.sub_fund LIKE ? OR nd.enterprise_abbreviation LIKE ? OR nd.account_name LIKE ? OR nd.wechat_account LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (account) {
      whereCondition += ' AND nd.wechat_account = ?';
      params.push(account);
    }

    // 查询数据（有企业的优先，然后按发布时间降序）
    // 优先使用news_detail表中的entity_type，如果没有则从invested_enterprises表获取
    // 注意：使用COALESCE确保优先使用news_detail表中的entity_type
    const data = await db.query(
      `SELECT nd.id, nd.account_name, nd.wechat_account, nd.public_time, nd.title, nd.source_url,
              nd.keywords, nd.enterprise_full_name, nd.enterprise_abbreviation, nd.news_abstract, nd.news_sentiment, nd.content,
              nd.created_at, nd.APItype, nd.news_category,
              nd.fund, nd.sub_fund,
              COALESCE(nd.entity_type, ie.entity_type) as entity_type
       FROM news_detail nd
       LEFT JOIN invested_enterprises ie ON nd.enterprise_full_name = ie.enterprise_full_name AND ie.delete_mark = 0
       ${whereCondition}
       ORDER BY
         CASE WHEN nd.enterprise_full_name IS NOT NULL AND nd.enterprise_full_name != '' THEN 0 ELSE 1 END,
         nd.public_time DESC,
         nd.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );
    const totalRows = await db.query(
      `SELECT COUNT(*) as total 
       FROM news_detail nd
       LEFT JOIN invested_enterprises ie ON nd.enterprise_full_name = ie.enterprise_full_name AND ie.delete_mark = 0
       ${whereCondition}`,
      params
    );

    // 解析 keywords JSON 字段
    const formattedData = data.map(item => {
      let keywords = [];
      if (item.keywords) {
        try {
          if (typeof item.keywords === 'string') {
            keywords = JSON.parse(item.keywords);
          } else {
            keywords = item.keywords;
          }
        } catch (e) {
          console.warn('解析keywords失败:', e.message, '原始值:', item.keywords);
          keywords = [];
        }
      }
      return {
        ...item,
        keywords: keywords
      };
    });

    res.json({
      success: true,
      data: formattedData || [],
      total: totalRows[0]?.total || 0,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('查询新闻列表失败：', error);
    console.error('错误详情：', error.message);
    console.error('错误堆栈：', error.stack);
    res.status(500).json({ 
      success: false, 
      message: '查询失败：' + (error.message || '未知错误') 
    });
  }
});

// 导出舆情数据为Excel
router.post('/export', async (req, res) => {
  try {
    const { timeRange = 'all', exportTimeRange } = req.body;
    
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    // 计算时间范围（使用北京时区）
    let timeCondition = '';
    let timeParams = [];
    let fileNameSuffix = '';
    
    const now = new Date();
    const beijingNow = createShanghaiDate(now);
    
    // 如果是全部舆情tab且指定了导出时间范围
    if (timeRange === 'all' && exportTimeRange) {
      if (exportTimeRange === 'thisWeek') {
        // 本周：本周一00:00:00到现在（北京时区）
        const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
        const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
        const daysToMonday = beijingDayOfWeek === 0 ? 6 : beijingDayOfWeek - 1;
        
        const weekStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [weekStart];
        
        const weekEnd = new Date(beijingNow);
        fileNameSuffix = `${formatDateForFileName(weekStart)}-${formatDateForFileName(weekEnd)}舆情信息`;
      } else if (exportTimeRange === 'thisMonth') {
        // 本月：本月1日00:00:00到现在（北京时区）
        const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [beijingYear, beijingMonth] = beijingDateStr.split(/[\/\-]/).map(Number);
        const monthStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-01T00:00:00+08:00`);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [monthStart];
        fileNameSuffix = `${beijingYear}年${String(beijingMonth).padStart(2, '0')}月舆情信息`;
      } else if (exportTimeRange === 'lastMonth') {
        // 上月：上月1日00:00:00到上月最后一天23:59:59（北京时区）
        const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [beijingYear, beijingMonth] = beijingDateStr.split(/[\/\-]/).map(Number);
        const lastMonthStart = new Date(beijingYear, beijingMonth - 2, 1); // 上月1日
        const lastMonthEnd = new Date(beijingYear, beijingMonth - 1, 0); // 上月最后一天
        lastMonthStart.setHours(0, 0, 0, 0);
        lastMonthEnd.setHours(23, 59, 59, 999);
        
        timeCondition = ' AND public_time >= ? AND public_time <= ?';
        timeParams = [lastMonthStart, lastMonthEnd];
        fileNameSuffix = `${lastMonthStart.getFullYear()}年${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}月舆情信息`;
      } else if (exportTimeRange === 'all') {
        fileNameSuffix = '全部舆情信息';
      }
    } else {
      // 使用当前tab的时间范围（北京时区）
      if (timeRange === 'yesterday') {
        // 昨日：前一天00:00:00到23:59:59（北京时区）
        const yesterday = new Date(beijingNow);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStart = new Date(yesterday);
        yesterdayStart.setHours(0, 0, 0, 0);
        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999);
        
        timeCondition = ' AND public_time >= ? AND public_time <= ?';
        timeParams = [yesterdayStart, yesterdayEnd];
        fileNameSuffix = `${formatDateForFileName(yesterday)}舆情信息`;
      } else if (timeRange === 'thisWeek') {
        // 本周：本周一00:00:00到现在（北京时区）
        const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
        const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
        const daysToMonday = beijingDayOfWeek === 0 ? 6 : beijingDayOfWeek - 1;
        
        const weekStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [weekStart];
        
        const weekEnd = new Date(beijingNow);
        fileNameSuffix = `${formatDateForFileName(weekStart)}-${formatDateForFileName(weekEnd)}舆情信息`;
      } else if (timeRange === 'lastWeek') {
        // 上周：上周一00:00:00到上周日23:59:59（北京时区）
        const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
        const beijingDayOfWeek = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`).getDay();
        const daysToLastMonday = beijingDayOfWeek === 0 ? 14 : beijingDayOfWeek - 1 + 7;
        
        const lastMonday = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
        lastMonday.setDate(lastMonday.getDate() - daysToLastMonday);
        lastMonday.setHours(0, 0, 0, 0);
        
        const lastSunday = new Date(lastMonday);
        lastSunday.setDate(lastMonday.getDate() + 6);
        lastSunday.setHours(23, 59, 59, 999);
        
        timeCondition = ' AND public_time >= ? AND public_time <= ?';
        timeParams = [lastMonday, lastSunday];
        fileNameSuffix = `${formatDateForFileName(lastMonday)}-${formatDateForFileName(lastSunday)}舆情信息`;
      } else if (timeRange === 'thisMonth') {
        // 本月：本月1日00:00:00到现在（北京时区）
        const beijingDateStr = beijingNow.toLocaleString('zh-CN', { 
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const [beijingYear, beijingMonth] = beijingDateStr.split(/[\/\-]/).map(Number);
        const monthStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-01T00:00:00+08:00`);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [monthStart];
        fileNameSuffix = `${beijingYear}年${String(beijingMonth).padStart(2, '0')}月舆情信息`;
      } else {
        fileNameSuffix = '全部舆情信息';
      }
    }

    let condition, params;

    if (userRole === 'admin') {
      // 管理员可以导出所有数据
      condition = 'FROM news_detail WHERE delete_mark = 0';
      params = [];
      
      if (timeCondition) {
        condition += timeCondition;
        params.push(...timeParams);
      }
    } else {
      // 普通用户只能导出自己相关的数据（被投企业 + 额外公众号）
      const wechatAccountsQuery = `
        SELECT DISTINCT wechat_official_account_id 
        FROM invested_enterprises 
        WHERE creator_user_id = ? 
        AND wechat_official_account_id IS NOT NULL 
        AND wechat_official_account_id != ''
        AND exit_status NOT IN ('完全退出', '已上市')
        AND delete_mark = 0
      `;
      
      const wechatAccounts = await db.query(wechatAccountsQuery, [userId]);

      const userAdditionalAccounts = await db.query(
        `SELECT DISTINCT wechat_account_id 
         FROM additional_wechat_accounts 
         WHERE creator_user_id = ? 
         AND status = 'active' 
         AND wechat_account_id IS NOT NULL 
         AND wechat_account_id != ''
         AND delete_mark = 0`,
        [userId]
      );

      // 提取微信公众号ID列表：被投企业 + 额外公众号
      const accountIds = [];
      wechatAccounts.forEach(item => {
        const ids = splitAccountIds(item.wechat_official_account_id);
        accountIds.push(...ids);
      });
      userAdditionalAccounts.forEach(item => {
        accountIds.push(item.wechat_account_id);
      });
      const uniqueAccountIds = [...new Set(accountIds)];
      
      if (uniqueAccountIds.length === 0) {
        return res.json({
          success: false,
          message: '没有可导出的数据'
        });
      }

      const placeholders = uniqueAccountIds.map(() => '?').join(',');
      
      condition = `FROM news_detail WHERE wechat_account IN (${placeholders}) AND delete_mark = 0`;
      params = [...uniqueAccountIds];
      
      if (timeCondition) {
        condition += timeCondition;
        params.push(...timeParams);
      }
    }

    // 查询数据
    const data = await db.query(
      `SELECT 
        enterprise_full_name as '被投企业全称',
        account_name as '公众号名称',
        wechat_account as '微信账号',
        title as '文章标题',
        summary as '文章摘要',
        public_time as '发布时间',
        source_url as '原文链接',
        keywords as '关键词',
        created_at as '创建时间'
       ${condition} 
       ORDER BY public_time DESC, created_at DESC`,
      params
    );

    if (data.length === 0) {
      return res.json({
        success: false,
        message: '没有可导出的数据'
      });
    }

    // 处理数据格式
    const formattedData = data.map(item => ({
      ...item,
      '发布时间': item['发布时间'] ? new Date(item['发布时间']) : null,
      '创建时间': new Date(item['创建时间']),
      '关键词': item['关键词'] ? (typeof item['关键词'] === 'string' ? 
        JSON.parse(item['关键词']).join(', ') : 
        Array.isArray(item['关键词']) ? item['关键词'].join(', ') : '') : ''
    }));

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(formattedData);
    
    // 设置列宽
    const colWidths = [
      { wch: 20 }, // 被投企业全称
      { wch: 15 }, // 公众号名称
      { wch: 15 }, // 微信账号
      { wch: 30 }, // 文章标题
      { wch: 40 }, // 文章摘要
      { wch: 15 }, // 发布时间
      { wch: 50 }, // 原文链接
      { wch: 30 }, // 关键词
      { wch: 15 }  // 创建时间
    ];
    ws['!cols'] = colWidths;

    // 设置单元格格式
    const range = XLSX.utils.decode_range(ws['!ref']);
    
    // 设置表头样式
    for (let colNum = 0; colNum <= range.e.c; colNum++) {
      const headerCell = XLSX.utils.encode_cell({ r: 0, c: colNum });
      if (ws[headerCell]) {
        ws[headerCell].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4472C4" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
          }
        };
      }
    }
    
    // 遍历所有数据行，设置格式
    for (let rowNum = 1; rowNum <= range.e.r; rowNum++) {
      // 为所有数据单元格添加边框
      for (let colNum = 0; colNum <= range.e.c; colNum++) {
        const cellRef = XLSX.utils.encode_cell({ r: rowNum, c: colNum });
        if (ws[cellRef]) {
          if (!ws[cellRef].s) ws[cellRef].s = {};
          ws[cellRef].s.border = {
            top: { style: "thin", color: { rgb: "CCCCCC" } },
            bottom: { style: "thin", color: { rgb: "CCCCCC" } },
            left: { style: "thin", color: { rgb: "CCCCCC" } },
            right: { style: "thin", color: { rgb: "CCCCCC" } }
          };
          
          // 设置文本对齐
          ws[cellRef].s.alignment = { 
            horizontal: "left", 
            vertical: "top",
            wrapText: true 
          };
        }
      }
      
      // 发布时间列 (F列，索引5)
      const publishTimeCell = XLSX.utils.encode_cell({ r: rowNum, c: 5 });
      if (ws[publishTimeCell] && ws[publishTimeCell].v) {
        ws[publishTimeCell].t = 'd'; // 设置为日期类型
        ws[publishTimeCell].z = 'yyyy-mm-dd hh:mm:ss'; // 设置日期格式
        ws[publishTimeCell].s.alignment = { horizontal: "center", vertical: "center" };
      }
      
      // 原文链接列 (G列，索引6)
      const linkCell = XLSX.utils.encode_cell({ r: rowNum, c: 6 });
      if (ws[linkCell] && ws[linkCell].v && ws[linkCell].v.startsWith('http')) {
        ws[linkCell].l = { Target: ws[linkCell].v, Tooltip: '点击打开链接' }; // 设置超链接
        if (!ws[linkCell].s) ws[linkCell].s = {};
        ws[linkCell].s.font = { color: { rgb: "0000FF" }, underline: true }; // 蓝色下划线样式
        ws[linkCell].s.alignment = { horizontal: "left", vertical: "center" };
      }
      
      // 创建时间列 (I列，索引8)
      const createTimeCell = XLSX.utils.encode_cell({ r: rowNum, c: 8 });
      if (ws[createTimeCell] && ws[createTimeCell].v) {
        ws[createTimeCell].t = 'd'; // 设置为日期类型
        ws[createTimeCell].z = 'yyyy-mm-dd hh:mm:ss'; // 设置日期格式
        ws[createTimeCell].s.alignment = { horizontal: "center", vertical: "center" };
      }
      
      // 被投企业全称列 (A列，索引0) - 加粗显示
      const enterpriseCell = XLSX.utils.encode_cell({ r: rowNum, c: 0 });
      if (ws[enterpriseCell]) {
        if (!ws[enterpriseCell].s) ws[enterpriseCell].s = {};
        ws[enterpriseCell].s.font = { bold: true, color: { rgb: "2F4F4F" } };
      }
    }

    // 设置冻结窗格（冻结表头）
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    
    // 设置自动筛选
    ws['!autofilter'] = { ref: ws['!ref'] };

    XLSX.utils.book_append_sheet(wb, ws, '舆情信息');

    // 生成Excel文件
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileNameSuffix)}.xlsx"`);
    
    res.send(buffer);

  } catch (error) {
    console.error('导出舆情数据失败：', error);
    res.status(500).json({ success: false, message: '导出失败：' + error.message });
  }
});

// 格式化日期用于文件名
function formatDateForFileName(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// 删除新闻记录（逻辑删除）
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.headers['user-role'];
    const userId = req.headers['user-id'];
    
    // 只有管理员可以删除
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '权限不足，只有管理员可以删除新闻记录'
      });
    }

    // 检查记录是否存在且未被删除
    const checkResult = await db.query(
      'SELECT id FROM news_detail WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: '新闻记录不存在或已被删除'
      });
    }

    // 执行逻辑删除操作
    await db.query(
      'UPDATE news_detail SET delete_mark = 1, delete_user_id = ?, delete_time = NOW() WHERE id = ?',
      [userId, id]
    );

    res.json({
      success: true,
      message: '删除成功'
    });

  } catch (error) {
    console.error('删除新闻记录失败:', error);
    res.status(500).json({
      success: false,
      message: '删除失败：' + error.message
    });
  }
});

// 导出路由和同步函数
// 调试：测试时间范围计算
router.get('/debug/time-range', (req, res) => {
  try {
    const now = new Date();
    const manualRange = calculateManualSyncTimeRange();
    const scheduledRange = calculateScheduledSyncTimeRange();
    
    res.json({
      success: true,
      data: {
        currentTime: formatDate(now),
        manualSync: {
          description: '手动触发：前一天0点到今天0点',
          from: manualRange.from,
          to: manualRange.to
        },
        scheduledSync: {
          description: '定时任务：前一天0点到前一天23:59:59',
          from: scheduledRange.from,
          to: scheduledRange.to
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '时间范围计算失败: ' + error.message
    });
  }
});

// 收件管理相关接口
// 检查管理员权限的中间件
const checkAdminPermission = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  
  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  if (userRole !== 'admin') {
    return res.status(403).json({ success: false, message: '需要管理员权限' });
  }
  
  req.currentUserId = userId;
  next();
};

// 获取收件管理列表（支持分页，管理员查看全部，用户查看自己的）
router.get('/recipients', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    
    // 检查用户是否登录
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    let query, countQuery, queryParams;
    
    if (userRole === 'admin') {
      // 管理员查看全部，包含用户名称（排除已删除的记录）
      query = `
        SELECT rm.id, rm.user_id, u.account as user_account, rm.recipient_email, rm.email_subject, 
               rm.send_frequency, rm.send_time, rm.cron_expression, rm.skip_holiday, rm.is_active, rm.qichacha_category_codes, rm.entity_type, rm.created_at, rm.updated_at,
               rm.is_deleted, rm.deleted_at, rm.deleted_by, u2.account as deleted_by_account
        FROM recipient_management rm
        LEFT JOIN users u ON rm.user_id = u.id
        LEFT JOIN users u2 ON rm.deleted_by = u2.id
        WHERE rm.is_deleted = 0
        ORDER BY rm.created_at DESC
        LIMIT ? OFFSET ?
      `;
      countQuery = 'SELECT COUNT(*) as total FROM recipient_management WHERE is_deleted = 0';
      queryParams = [pageSize, offset];
    } else {
      // 用户只查看自己的（排除已删除的记录）
      query = `
        SELECT rm.id, rm.user_id, rm.recipient_email, rm.email_subject, 
               rm.send_frequency, rm.send_time, rm.cron_expression, rm.skip_holiday, rm.is_active, rm.qichacha_category_codes, rm.entity_type, rm.created_at, rm.updated_at,
               rm.is_deleted, rm.deleted_at, rm.deleted_by
        FROM recipient_management rm
        WHERE rm.user_id = ? AND rm.is_deleted = 0
        ORDER BY rm.created_at DESC
        LIMIT ? OFFSET ?
      `;
      countQuery = 'SELECT COUNT(*) as total FROM recipient_management WHERE user_id = ? AND is_deleted = 0';
      queryParams = [userId, pageSize, offset];
    }

    // 获取总数
    const totalResult = userRole === 'admin' 
      ? await db.query(countQuery)
      : await db.query(countQuery, [userId]);
    const total = totalResult[0]?.total || 0;

    // 获取分页数据
    const recipients = await db.query(query, queryParams);
    
    // 解析entity_type JSON字段
    const processedRecipients = (recipients || []).map(recipient => {
      if (recipient.entity_type) {
        if (Array.isArray(recipient.entity_type)) {
          // 已经是数组，直接使用
        } else if (typeof recipient.entity_type === 'string') {
          try {
            const parsed = JSON.parse(recipient.entity_type);
            if (Array.isArray(parsed)) {
              recipient.entity_type = parsed;
            } else {
              // 如果是单个值，转换为数组
              recipient.entity_type = [parsed];
            }
          } catch (e) {
            // JSON解析失败，可能是单个值，转换为数组
            recipient.entity_type = [recipient.entity_type];
          }
        }
      }
      return recipient;
    });

    res.json({
      success: true,
      data: processedRecipients,
      total: total,
      page: page,
      pageSize: pageSize
    });
  } catch (error) {
    console.error('获取收件管理列表失败：', error);
    console.error('错误详情：', error.message);
    res.status(500).json({ 
      success: false, 
      message: '获取列表失败：' + (error.message || '未知错误') 
    });
  }
});

// 获取单个收件管理信息
router.get('/recipients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    let query;
    if (userRole === 'admin') {
      query = `
        SELECT rm.id, rm.user_id, u.account as user_account, rm.recipient_email, rm.email_subject, 
               rm.send_frequency, rm.send_time, rm.cron_expression, rm.skip_holiday, rm.is_active, rm.qichacha_category_codes, rm.entity_type, rm.created_at, rm.updated_at,
               rm.is_deleted, rm.deleted_at, rm.deleted_by, u2.account as deleted_by_account
        FROM recipient_management rm
        LEFT JOIN users u ON rm.user_id = u.id
        LEFT JOIN users u2 ON rm.deleted_by = u2.id
        WHERE rm.id = ? AND rm.is_deleted = 0
      `;
    } else {
      query = `
        SELECT rm.id, rm.user_id, rm.recipient_email, rm.email_subject, 
               rm.send_frequency, rm.send_time, rm.cron_expression, rm.skip_holiday, rm.is_active, rm.qichacha_category_codes, rm.entity_type, rm.created_at, rm.updated_at,
               rm.is_deleted, rm.deleted_at, rm.deleted_by
        FROM recipient_management rm
        WHERE rm.id = ? AND rm.user_id = ? AND rm.is_deleted = 0
      `;
    }

    const recipients = userRole === 'admin' 
      ? await db.query(query, [id])
      : await db.query(query, [id, userId]);

    if (recipients.length > 0) {
      const recipient = recipients[0];
      // 记录从数据库读取的原始值
      console.log(`[获取收件管理] ID: ${id}, 数据库中的qichacha_category_codes:`, recipient.qichacha_category_codes, '类型:', typeof recipient.qichacha_category_codes);
      console.log(`[获取收件管理] ID: ${id}, 数据库中的entity_type:`, recipient.entity_type, '类型:', typeof recipient.entity_type);
      
      // 解析entity_type JSON字段
      if (recipient.entity_type) {
        if (Array.isArray(recipient.entity_type)) {
          // 已经是数组，直接使用
          console.log(`[获取收件管理] entity_type已经是数组，直接使用:`, recipient.entity_type.length, '个元素');
        } else if (typeof recipient.entity_type === 'string') {
          try {
            const parsed = JSON.parse(recipient.entity_type);
            if (Array.isArray(parsed)) {
              recipient.entity_type = parsed;
              console.log(`[获取收件管理] JSON解析成功:`, parsed, '类型:', typeof parsed, '是否为数组:', Array.isArray(parsed));
            } else {
              // 如果是单个值，转换为数组
              recipient.entity_type = [parsed];
              console.log(`[获取收件管理] 单个值转换为数组:`, recipient.entity_type);
            }
          } catch (e) {
            // JSON解析失败，可能是单个值，转换为数组
            recipient.entity_type = [recipient.entity_type];
            console.log(`[获取收件管理] 解析失败，作为单个值转换为数组:`, recipient.entity_type);
          }
        }
      }
      
      // 解析JSON字段
      if (recipient.qichacha_category_codes) {
        // 如果已经是数组，直接使用
        if (Array.isArray(recipient.qichacha_category_codes)) {
          console.log(`[获取收件管理] qichacha_category_codes已经是数组，直接使用:`, recipient.qichacha_category_codes.length, '个元素');
          // 已经是数组，不需要解析
        } else if (typeof recipient.qichacha_category_codes === 'string') {
          // 如果是字符串，尝试解析JSON
          try {
            const parsed = JSON.parse(recipient.qichacha_category_codes);
            console.log(`[获取收件管理] JSON解析成功:`, parsed, '类型:', typeof parsed, '是否为数组:', Array.isArray(parsed));
            if (Array.isArray(parsed)) {
              recipient.qichacha_category_codes = parsed;
            } else {
              console.warn(`[获取收件管理] 解析后的值不是数组:`, parsed);
              recipient.qichacha_category_codes = null;
            }
          } catch (e) {
            // JSON解析失败，可能是MySQL返回的数组格式字符串（单引号）
            // 尝试使用eval或手动解析（安全起见，只处理数组格式）
            console.warn(`[获取收件管理] JSON解析失败:`, e.message, '尝试其他解析方式...');
            const str = recipient.qichacha_category_codes.trim();
            // 检查是否是数组格式字符串 ['xxx', 'yyy', ...]
            if (str.startsWith('[') && str.endsWith(']')) {
              try {
                // 使用eval解析（仅用于解析数组字符串，确保安全）
                // 或者手动解析：移除方括号，分割，去除引号
                const cleaned = str.slice(1, -1); // 移除 [ 和 ]
                if (cleaned.trim() === '') {
                  recipient.qichacha_category_codes = [];
                } else {
                  // 分割并清理每个元素
                  const items = cleaned.split(',').map(item => {
                    const trimmed = item.trim();
                    // 移除单引号或双引号
                    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || 
                        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
                      return trimmed.slice(1, -1);
                    }
                    return trimmed;
                  });
                  recipient.qichacha_category_codes = items;
                  console.log(`[获取收件管理] 手动解析成功:`, items.length, '个元素');
                }
              } catch (parseError) {
                console.error(`[获取收件管理] 手动解析也失败:`, parseError.message);
                recipient.qichacha_category_codes = null;
              }
            } else {
              console.error(`[获取收件管理] 无法识别的格式:`, str);
              recipient.qichacha_category_codes = null;
            }
          }
        } else {
          console.warn(`[获取收件管理] qichacha_category_codes类型未知:`, typeof recipient.qichacha_category_codes);
          recipient.qichacha_category_codes = null;
        }
      } else {
        console.log(`[获取收件管理] qichacha_category_codes为空或null`);
        recipient.qichacha_category_codes = null;
      }
      
      console.log(`[获取收件管理] 返回给前端的数据:`, {
        id: recipient.id,
        qichacha_category_codes: recipient.qichacha_category_codes,
        isArray: Array.isArray(recipient.qichacha_category_codes),
        length: Array.isArray(recipient.qichacha_category_codes) ? recipient.qichacha_category_codes.length : 'N/A'
      });
      
      res.json({ success: true, data: recipient });
    } else {
      res.status(404).json({ success: false, message: '记录不存在' });
    }
  } catch (error) {
    console.error('获取收件管理信息失败：', error);
    res.status(500).json({ success: false, message: '获取信息失败' });
  }
});

// 获取企查查类别映射（从数据库获取）
router.get('/qichacha-categories', async (req, res) => {
  try {
    // 优先从数据库获取类别映射
    // 检查 getCategoryMap 是否存在且为函数，如果不存在则从模块重新获取
    let getCategoryMapFunc = getCategoryMap;
    if (typeof getCategoryMapFunc !== 'function') {
      // 如果导入的函数不存在，尝试从模块重新获取
      getCategoryMapFunc = qichachaCategoryMapperModule.getCategoryMap;
      if (typeof getCategoryMapFunc !== 'function') {
        throw new Error('getCategoryMap 函数未正确导入');
      }
    }
    const categoryMap = await getCategoryMapFunc();
    res.json({ success: true, data: categoryMap });
  } catch (error) {
    console.error('获取企查查类别映射失败：', error);
    // 如果数据库获取失败，使用默认映射作为后备
    try {
      const defaultMap = qichachaCategoryMapperModule.categoryMap || qichachaCategoryMapperModule.defaultCategoryMap;
      if (defaultMap) {
        res.json({ success: true, data: defaultMap });
      } else {
        throw new Error('无法获取默认类别映射');
      }
    } catch (fallbackError) {
      console.error('获取默认类别映射失败：', fallbackError);
      res.status(500).json({ success: false, message: '获取类别映射失败' });
    }
  }
});

// 验证多个邮箱格式的辅助函数
const validateMultipleEmails = (emails) => {
  if (!emails || typeof emails !== 'string') {
    return { valid: false, message: '收件人邮箱不能为空' };
  }
  
  // 支持逗号、分号、换行符分隔
  const emailList = emails
    .split(/[,;\n\r]+/)
    .map(email => email.trim())
    .filter(email => email.length > 0);
  
  if (emailList.length === 0) {
    return { valid: false, message: '至少需要输入一个收件人邮箱' };
  }
  
  // 验证每个邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const email of emailList) {
    if (!emailRegex.test(email)) {
      return { valid: false, message: `邮箱格式不正确: ${email}` };
    }
  }
  
  return { valid: true, emails: emailList.join(',') };
};

// 创建收件管理
router.post('/recipients', [
  body('recipient_email').notEmpty().withMessage('收件人邮箱不能为空'),
  body('email_subject').optional(),
  body('cron_expression').optional().isString().withMessage('Cron表达式必须是字符串'),
  body('send_frequency').optional().isIn(['daily', 'weekly', 'monthly']).withMessage('发送频率必须是daily、weekly或monthly'),
  body('send_time').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).withMessage('发送时间格式不正确，应为HH:mm:ss'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    const { recipient_email, email_subject, cron_expression, send_frequency, send_time, is_active, qichacha_category_codes, entity_type } = req.body;
    
    // 如果没有提供 cron_expression，从 send_frequency 和 send_time 转换（向后兼容）
    let finalCronExpression = cron_expression;
    if (!finalCronExpression && send_frequency && send_time) {
      finalCronExpression = convertToCronExpression(send_frequency, send_time);
    }
    // 如果还是没有，使用默认值
    if (!finalCronExpression) {
      finalCronExpression = '0 0 9 * * ? *'; // 默认每天9点执行
    }
    
    // 验证多个邮箱格式
    const emailValidation = validateMultipleEmails(recipient_email);
    if (!emailValidation.valid) {
      return res.status(400).json({ success: false, message: emailValidation.message });
    }

    // 处理企查查类别编码（JSON格式）
    let categoryCodesJson = null;
    if (qichacha_category_codes !== null && qichacha_category_codes !== undefined) {
      if (Array.isArray(qichacha_category_codes) && qichacha_category_codes.length > 0) {
        categoryCodesJson = JSON.stringify(qichacha_category_codes);
      } else if (typeof qichacha_category_codes === 'string' && qichacha_category_codes.trim() !== '') {
        try {
          const parsed = JSON.parse(qichacha_category_codes);
          if (Array.isArray(parsed) && parsed.length > 0) {
            categoryCodesJson = qichacha_category_codes;
          }
        } catch (e) {
          // 如果不是有效的JSON，忽略
        }
      }
    }

    // 处理entity_type（支持数组多选）
    const validEntityTypes = ['被投企业', '基金相关主体', '子基金', '子基金管理人', '子基金GP'];
    let validatedEntityTypeJson = null;
    if (entity_type !== null && entity_type !== undefined && entity_type !== '') {
      let entityTypes = entity_type;
      // 如果是字符串，尝试解析为JSON
      if (typeof entityTypes === 'string') {
        try {
          entityTypes = JSON.parse(entityTypes);
        } catch (e) {
          // 如果不是JSON，可能是单个值，转换为数组
          entityTypes = [entityTypes];
        }
      }
      // 确保是数组
      if (!Array.isArray(entityTypes)) {
        entityTypes = [entityTypes];
      }
      // 验证所有值是否有效
      const invalidTypes = entityTypes.filter(type => !validEntityTypes.includes(type));
      if (invalidTypes.length > 0) {
        return res.status(400).json({ success: false, message: `企业类型值无效: ${invalidTypes.join(', ')}` });
      }
      // 如果有有效值，转换为JSON
      if (entityTypes.length > 0) {
        validatedEntityTypeJson = JSON.stringify(entityTypes);
      }
    }

    const recipientId = await generateId('recipient_management');

    const newsAppRows = await db.query(
      `SELECT id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
      ['新闻舆情']
    );
    const newsAppId = newsAppRows.length ? newsAppRows[0].id : null;
    
    // 如果提供了 cron_expression，send_frequency 和 send_time 可以为 null（已废弃）
    // 如果没有提供 cron_expression，需要从 send_frequency 和 send_time 转换
    const finalSendFrequency = finalCronExpression ? null : (send_frequency || 'daily');
    const finalSendTime = finalCronExpression ? null : (send_time || '09:00:00');
    
    const newData = {
      user_id: userId,
      app_id: newsAppId,
      recipient_email: emailValidation.emails,
      email_subject: email_subject || '',
      cron_expression: finalCronExpression,
      send_frequency: finalSendFrequency,
      send_time: finalSendTime,
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1,
      qichacha_category_codes: categoryCodesJson,
      entity_type: validatedEntityTypeJson
    };
    
    await db.execute(
      `INSERT INTO recipient_management 
       (id, user_id, app_id, recipient_email, email_subject, cron_expression, send_frequency, send_time, is_active, qichacha_category_codes, entity_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recipientId,
        newData.user_id,
        newData.app_id,
        newData.recipient_email,
        newData.email_subject,
        newData.cron_expression,
        newData.send_frequency,
        newData.send_time,
        newData.is_active,
        newData.qichacha_category_codes,
        newData.entity_type
      ]
    );

    // 记录创建日志
    await logRecipientChange(recipientId, {}, newData, userId);

    // 更新定时任务
    await updateScheduledTasks();

    res.json({ success: true, message: '收件管理创建成功', data: { id: recipientId } });
  } catch (error) {
    console.error('创建收件管理失败：', error);
    res.status(500).json({ success: false, message: '创建失败：' + error.message });
  }
});

// 更新收件管理
router.put('/recipients/:id', [
  body('recipient_email').optional(),
  body('email_subject').optional(),
  body('cron_expression').optional().isString().withMessage('Cron表达式必须是字符串'),
  body('send_frequency').optional().isIn(['daily', 'weekly', 'monthly']).withMessage('发送频率必须是daily、weekly或monthly'),
  body('send_time').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).withMessage('发送时间格式不正确，应为HH:mm:ss'),
  body('is_active').optional().isBoolean().withMessage('is_active必须是布尔值'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const { recipient_email, email_subject, cron_expression, send_frequency, send_time, is_active, qichacha_category_codes, entity_type } = req.body;
    const skip_holiday_raw = req.body.skip_holiday;
    const skip_holiday = skip_holiday_raw === true || skip_holiday_raw === 1 || skip_holiday_raw === '1' || skip_holiday_raw === 'true';
    
    // 如果没有提供 cron_expression，从 send_frequency 和 send_time 转换（向后兼容）
    let finalCronExpression = cron_expression
    if (!finalCronExpression && send_frequency && send_time) {
      finalCronExpression = convertToCronExpression(send_frequency, send_time)
    }

    // 检查记录是否存在（排除已删除的记录）
    const existing = await db.query('SELECT * FROM recipient_management WHERE id = ? AND is_deleted = 0', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '记录不存在或已被删除' });
    }

    // 非管理员只能修改自己的记录
    if (userRole !== 'admin' && existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权修改此记录' });
    }

    // 保存旧数据用于日志
    const oldData = {
      user_id: existing[0].user_id,
      recipient_email: existing[0].recipient_email,
      email_subject: existing[0].email_subject || '',
      cron_expression: existing[0].cron_expression || '',
      send_frequency: existing[0].send_frequency,
      send_time: existing[0].send_time || '',
      is_active: existing[0].is_active,
      qichacha_category_codes: existing[0].qichacha_category_codes
    };

    // 如果更新邮箱，验证多个邮箱格式
    let validatedEmail = recipient_email;
    if (recipient_email !== undefined) {
      const emailValidation = validateMultipleEmails(recipient_email);
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message });
      }
      validatedEmail = emailValidation.emails;
    }

    // 处理企查查类别编码（JSON格式）
    let categoryCodesJson = null;
    if (qichacha_category_codes !== undefined) {
      if (qichacha_category_codes === null) {
        categoryCodesJson = null;
      } else if (Array.isArray(qichacha_category_codes)) {
        if (qichacha_category_codes.length > 0) {
          categoryCodesJson = JSON.stringify(qichacha_category_codes);
        } else {
          categoryCodesJson = null;
        }
      } else if (typeof qichacha_category_codes === 'string' && qichacha_category_codes.trim() !== '') {
        try {
          const parsed = JSON.parse(qichacha_category_codes);
          if (Array.isArray(parsed) && parsed.length > 0) {
            categoryCodesJson = qichacha_category_codes;
          } else {
            categoryCodesJson = null;
          }
        } catch (e) {
          categoryCodesJson = null;
        }
      }
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    if (recipient_email !== undefined) {
      updateFields.push('recipient_email = ?');
      updateValues.push(validatedEmail);
    }
    if (email_subject !== undefined) {
      updateFields.push('email_subject = ?');
      updateValues.push(email_subject);
    }
    if (cron_expression !== undefined || finalCronExpression) {
      updateFields.push('cron_expression = ?');
      updateValues.push(finalCronExpression || cron_expression);
    }
    if (send_frequency !== undefined) {
      updateFields.push('send_frequency = ?');
      updateValues.push(send_frequency);
    }
    if (send_time !== undefined) {
      updateFields.push('send_time = ?');
      updateValues.push(send_time);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(is_active ? 1 : 0);
    }
    if (req.body.skip_holiday !== undefined) {
      updateFields.push('skip_holiday = ?');
      updateValues.push(skip_holiday ? 1 : 0);
    }
    // 处理企查查类别编码：即使为null也要更新（允许清空类别）
    if (qichacha_category_codes !== undefined) {
      updateFields.push('qichacha_category_codes = ?');
      updateValues.push(categoryCodesJson);
      console.log(`[更新收件管理] 更新qichacha_category_codes:`, {
        original: qichacha_category_codes,
        json: categoryCodesJson,
        isNull: categoryCodesJson === null,
        isArray: Array.isArray(qichacha_category_codes)
      });
    } else {
      console.log(`[更新收件管理] qichacha_category_codes未提供，保持原值`);
    }

    // 处理企业类型（支持数组多选）
    if (entity_type !== undefined) {
      const validEntityTypes = ['被投企业', '基金相关主体', '子基金', '子基金管理人', '子基金GP'];
      let validatedEntityTypeJson = null;
      if (entity_type !== null && entity_type !== '') {
        let entityTypes = entity_type;
        // 如果是字符串，尝试解析为JSON
        if (typeof entityTypes === 'string') {
          try {
            entityTypes = JSON.parse(entityTypes);
          } catch (e) {
            // 如果不是JSON，可能是单个值，转换为数组
            entityTypes = [entityTypes];
          }
        }
        // 确保是数组
        if (!Array.isArray(entityTypes)) {
          entityTypes = [entityTypes];
        }
        // 验证所有值是否有效
        const invalidTypes = entityTypes.filter(type => !validEntityTypes.includes(type));
        if (invalidTypes.length > 0) {
          return res.status(400).json({ success: false, message: `企业类型值无效: ${invalidTypes.join(', ')}` });
        }
        // 如果有有效值，转换为JSON
        if (entityTypes.length > 0) {
          validatedEntityTypeJson = JSON.stringify(entityTypes);
        }
      }
      updateFields.push('entity_type = ?');
      updateValues.push(validatedEntityTypeJson);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      updateValues.push(id);
      await db.execute(
        `UPDATE recipient_management SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      // 构建新数据用于日志
      const newData = { ...oldData };
      if (recipient_email !== undefined) newData.recipient_email = validatedEmail;
      if (email_subject !== undefined) newData.email_subject = email_subject;
      if (cron_expression !== undefined || finalCronExpression) {
        newData.cron_expression = finalCronExpression || cron_expression;
      }
      if (send_frequency !== undefined) newData.send_frequency = send_frequency;
      if (send_time !== undefined) newData.send_time = send_time;
      if (is_active !== undefined) newData.is_active = is_active ? 1 : 0;
      if (qichacha_category_codes !== undefined) {
        newData.qichacha_category_codes = categoryCodesJson;
        console.log(`[更新收件管理] 新数据中的qichacha_category_codes:`, categoryCodesJson);
      }

      // 记录更新日志
      await logRecipientChange(id, oldData, newData, userId);
      
      // 验证更新后的数据
      const verifyQuery = await db.query('SELECT qichacha_category_codes FROM recipient_management WHERE id = ?', [id]);
      if (verifyQuery.length > 0) {
        console.log(`[更新收件管理] 验证：数据库中保存的值:`, verifyQuery[0].qichacha_category_codes);
      }
    }

    // 更新定时任务
    await updateScheduledTasks();

    res.json({ success: true, message: '收件管理更新成功' });
  } catch (error) {
    console.error('更新收件管理失败：', error);
    res.status(500).json({ success: false, message: '更新失败：' + error.message });
  }
});

// 删除收件管理（软删除）
router.delete('/recipients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // 检查记录是否存在（排除已删除的记录）
    const existing = await db.query('SELECT * FROM recipient_management WHERE id = ? AND is_deleted = 0', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '记录不存在或已被删除' });
    }

    // 非管理员只能删除自己的记录
    if (userRole !== 'admin' && existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权删除此记录' });
    }

    // 保存旧数据用于日志
    const oldData = {
      user_id: existing[0].user_id,
      recipient_email: existing[0].recipient_email,
      email_subject: existing[0].email_subject || '',
      send_frequency: existing[0].send_frequency,
      send_time: existing[0].send_time || '',
      is_active: existing[0].is_active,
      is_deleted: existing[0].is_deleted || 0,
      deleted_at: existing[0].deleted_at || null,
      deleted_by: existing[0].deleted_by || null
    };

    // 软删除：更新 is_deleted、deleted_at 和 deleted_by 字段
    await db.execute(
      'UPDATE recipient_management SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [userId, id]
    );

    // 构建新数据用于日志（标记为已删除）
    const newData = {
      ...oldData,
      is_deleted: 1,
      deleted_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      deleted_by: userId
    };

    // 记录删除日志
    await logRecipientChange(id, oldData, newData, userId);

    // 更新定时任务
    await updateScheduledTasks();

    res.json({ success: true, message: '收件管理删除成功' });
  } catch (error) {
    console.error('删除收件管理失败：', error);
    res.status(500).json({ success: false, message: '删除失败：' + error.message });
  }
});

// 获取收件管理日志
router.get('/recipients/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // 检查记录是否存在
    const existing = await db.query('SELECT * FROM recipient_management WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    // 非管理员只能查看自己的记录日志
    if (userRole !== 'admin' && existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权查看此记录的日志' });
    }

    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'recipient_management' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取收件管理日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败：' + error.message });
  }
});

// 手动触发发送舆情信息邮件（发送给所有收件人）
router.post('/send-news-emails', checkAdminPermission, async (req, res) => {
  try {
    console.log('收到手动发送舆情信息邮件请求');
    
    const result = await sendNewsEmailsToAllRecipients();
    
    res.json({
      success: true,
      message: result.message,
      data: {
        total: result.total,
        successCount: result.successCount,
        errorCount: result.errorCount,
        results: result.results
      }
    });
  } catch (error) {
    console.error('发送舆情信息邮件失败：', error);
    res.status(500).json({
      success: false,
      message: '发送邮件失败：' + error.message
    });
  }
});

// 手动触发发送舆情信息邮件（发送给指定的收件管理配置，包含Excel附件）
router.post('/recipients/:id/send-email', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    
    // 检查用户是否登录
    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    
    // 检查收件管理配置是否存在，以及用户是否有权限
    const existing = await db.query(
      'SELECT * FROM recipient_management WHERE id = ? AND is_deleted = 0',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '收件管理配置不存在或已被删除' });
    }
    
    // 非管理员只能发送自己的邮件
    if (userRole !== 'admin' && existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权发送此收件管理配置的邮件' });
    }
    
    console.log(`收到发送邮件请求，收件管理配置ID: ${id}`);
    
    const recipient = existing[0];
    
    // 获取用户可见的昨日舆情信息（传入收件管理配置，跳过最终过滤，用于AI重新分析）
    // 注意：这里先获取基本查询结果（跳过企查查类别过滤和最终过滤）
    // 然后对这些新闻进行基本过滤（标题、关键词、企业全称、新闻摘要都有数据）
    // 再进行AI重新分析，分析后再应用企查查类别过滤等
    let newsList = await getUserVisibleYesterdayNews(recipient.user_id, recipient, true); // skipFinalFilter = true
    
    // ========== 步骤1：基本过滤（标题、关键词、企业全称、新闻摘要都有数据）==========
    logWithTag('[手动发送邮件]', '========== 步骤1：基本过滤 ==========');
    logWithTag('[手动发送邮件]', `初始查询结果：${newsList.length} 条新闻`);
    
    // 预先获取所有额外公众号的ID列表（用于后续过滤判断）
    let additionalAccountIdsSet = new Set();
    try {
      const additionalAccounts = await db.query(
        `SELECT DISTINCT wechat_account_id 
         FROM additional_wechat_accounts 
         WHERE status = 'active' 
         AND wechat_account_id IS NOT NULL 
         AND wechat_account_id != ''
         AND delete_mark = 0`
      );
      additionalAccounts.forEach(acc => {
        if (acc.wechat_account_id) {
          additionalAccountIdsSet.add(acc.wechat_account_id);
        }
      });
      logWithTag('[手动发送邮件]', `预先获取额外公众号ID列表，共 ${additionalAccountIdsSet.size} 个`);
    } catch (err) {
      warnWithTag('[手动发送邮件]', `获取额外公众号列表失败: ${err.message}`);
    }
    
    // 基本过滤：标题、关键词、企业全称、新闻摘要都有数据
    const basicFilteredNewsList = newsList.filter(news => {
      // 1. 检查标题（标题是必需的）
      if (!news.title || news.title.trim() === '') {
        return false;
      }
      
      // 2. 检查关键词（关键词是必需的，可能是JSON字符串或数组）
      let hasKeywords = false;
      if (news.keywords) {
        if (typeof news.keywords === 'string') {
          // 尝试解析JSON字符串
          try {
            const parsed = JSON.parse(news.keywords);
            hasKeywords = Array.isArray(parsed) ? parsed.length > 0 : parsed.trim() !== '';
          } catch (e) {
            // 如果不是JSON，直接检查字符串
            hasKeywords = news.keywords.trim() !== '';
          }
        } else if (Array.isArray(news.keywords)) {
          hasKeywords = news.keywords.length > 0;
        } else {
          hasKeywords = String(news.keywords).trim() !== '';
        }
      }
      if (!hasKeywords) {
        logWithTag('[手动发送邮件]', `新闻 ${news.id} 被基本过滤：关键词为空`);
        return false;
      }
      
      // 3. 检查企业全称（额外公众号的新闻可能没有企业名称）
      const enterpriseName = news.enterprise_full_name;
      const hasEnterpriseName = enterpriseName && enterpriseName.trim() !== '';
      
      // 对于没有企业名称的新闻，检查是否是额外公众号的新闻
      if (!hasEnterpriseName) {
        const isAdditionalAccountNews = news.wechat_account && additionalAccountIdsSet.has(news.wechat_account);
        if (!isAdditionalAccountNews) {
          // 非额外公众号的新闻，企业全称是必需的
          return false;
        }
      }
      
      // 4. 检查新闻摘要（news_abstract 或 summary）
      const hasAbstract = news.news_abstract && news.news_abstract.trim() !== '';
      const hasSummary = news.summary && news.summary.trim() !== '';
      
      if (!hasAbstract && !hasSummary) {
        return false;
      }
      
      return true;
    });
    
    logWithTag('[手动发送邮件]', `基本过滤后：${basicFilteredNewsList.length} 条新闻（满足标题、关键词、企业全称、新闻摘要都有数据的条件）`);
    
    // ========== 步骤2：AI重新分析 ==========
    if (basicFilteredNewsList.length > 0) {
      logWithTag('[手动发送邮件]', '========== 开始AI重新分析 ==========');
      logWithTag('[手动发送邮件]', `需要重新分析的新闻数量: ${basicFilteredNewsList.length}`);
      
      const newsAnalysis = require('../utils/newsAnalysis');
      
      let reanalyzeSuccessCount = 0;
      let reanalyzeErrorCount = 0;
      
      // 导入AI分析缓存工具
      const aiAnalysisCache = require('../utils/aiAnalysisCache');
      
      // 批量重新分析新闻（使用基本过滤后的新闻列表）
      let skippedCount = 0;
      for (const news of basicFilteredNewsList) {
        try {
          // 检查是否在20分钟内已分析过
          if (aiAnalysisCache.isRecentlyAnalyzed(news.id)) {
            skippedCount++;
            logWithTag('[手动发送邮件]', `⏭️ 新闻 ${news.id} 在20分钟内已分析过，跳过重新分析`);
            continue;
          }
          // 裁判文书、法院公告、送达公告、开庭公告、立案信息、破产重整、被执行人、失信被执行人、限制高消费、行政处罚、终本案件等仅拼接入库的数据不做 AI 重新分析
          const skipReanalyzeAccountNames = ['裁判文书', '法院公告', '送达公告', '开庭公告', '立案信息', '破产重整', '被执行人', '失信被执行人', '限制高消费', '行政处罚', '终本案件'];
          if (skipReanalyzeAccountNames.includes(news.account_name) && (news.APItype === '上海国际' || news.APItype === '上海国际集团')) {
            skippedCount++;
            logWithTag('[手动发送邮件]', `⏭️ 新闻 ${news.id} 为仅拼接入库数据(${news.account_name})，跳过AI重新分析`);
            continue;
          }
          
          logWithTag('[手动发送邮件]', `正在重新分析新闻 ${news.id}: ${news.title?.substring(0, 50)}`);
          
          // 获取完整的新闻数据（包括content）
          const fullNewsItems = await db.query(
            'SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name, news_abstract, news_sentiment, keywords, APItype FROM news_detail WHERE id = ?',
            [news.id]
          );
          
          if (fullNewsItems.length === 0) {
            warnWithTag('[手动发送邮件]', `⚠️ 新闻 ${news.id} 不存在，跳过重新分析`);
            continue;
          }
          
          const newsItem = fullNewsItems[0];
          
          // 根据是否有企业关联选择不同的处理方式
          let reanalyzeResult;
          if (newsItem.enterprise_full_name) {
            // 有企业关联，使用processNewsWithEnterprise（会保护来自invested_enterprises的企业关联）
            logWithTag('[手动发送邮件]', `新闻 ${news.id} 有企业关联，使用processNewsWithEnterprise`);
            reanalyzeResult = await newsAnalysis.processNewsWithEnterprise(newsItem);
          } else {
            // 无企业关联，使用processNewsWithoutEnterprise
            logWithTag('[手动发送邮件]', `新闻 ${news.id} 无企业关联，使用processNewsWithoutEnterprise`);
            reanalyzeResult = await newsAnalysis.processNewsWithoutEnterprise(newsItem);
          }
          
          if (reanalyzeResult) {
            reanalyzeSuccessCount++;
            // 记录分析时间戳到缓存
            aiAnalysisCache.recordAnalysis(news.id);
            logWithTag('[手动发送邮件]', `✓ 新闻 ${news.id} 重新分析成功`);
          } else {
            reanalyzeErrorCount++;
            logWithTag('[手动发送邮件]', `✗ 新闻 ${news.id} 重新分析失败`);
          }
          
          // 添加延迟避免API频率限制
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          reanalyzeErrorCount++;
          errorWithTag('[手动发送邮件]', `✗ 新闻 ${news.id} 重新分析出错: ${error.message}`);
        }
      }
      
      if (skippedCount > 0) {
        logWithTag('[手动发送邮件]', `⏭️ 跳过 ${skippedCount} 条在20分钟内已分析过的新闻`);
      }
      
      logWithTag('[手动发送邮件]', `AI重新分析完成: 成功 ${reanalyzeSuccessCount} 条, 失败 ${reanalyzeErrorCount} 条, 跳过 ${skippedCount || 0} 条`);
      logWithTag('[手动发送邮件]', '========== AI重新分析结束 ==========');
      
      // 重新分析完成后，从数据库重新获取最新的新闻数据（包含entity_type）
      logWithTag('[手动发送邮件]', '从数据库重新获取最新的新闻数据...');
      const newsIds = basicFilteredNewsList.map(n => n.id);
      if (newsIds.length > 0) {
        const placeholders = newsIds.map(() => '?').join(',');
        const refreshedNewsList = await db.query(
          `SELECT DISTINCT nd.id, nd.title, nd.enterprise_full_name, nd.news_sentiment, nd.keywords, 
                  nd.news_abstract, nd.summary, nd.content, nd.public_time, nd.account_name, nd.wechat_account, nd.source_url, nd.created_at,
                  nd.APItype, nd.news_category, nd.entity_type
           FROM news_detail nd
           WHERE nd.id IN (${placeholders})
           AND nd.delete_mark = 0`,
          newsIds
        );
        
        logWithTag('[手动发送邮件]', `重新获取到 ${refreshedNewsList.length} 条新闻数据`);
        
        // 检查重新获取的数据中的 entity_type 分布（用于调试）
        if (refreshedNewsList.length > 0) {
          const entityTypeStats = {};
          refreshedNewsList.forEach(n => {
            const et = n.entity_type || '(NULL)';
            entityTypeStats[et] = (entityTypeStats[et] || 0) + 1;
          });
          logWithTag('[手动发送邮件]', `重新获取的新闻entity_type统计:`, JSON.stringify(entityTypeStats, null, 2));
          
          // 显示前5条新闻的详细信息
          refreshedNewsList.slice(0, 5).forEach((n, index) => {
            logWithTag('[手动发送邮件]', `重新获取的新闻 ${index + 1}: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}" (类型: ${typeof n.entity_type}), enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
          });
        }
        
        newsList = refreshedNewsList;
      }
      
      // 重新应用最终过滤逻辑（过滤掉不满足发送邮件条件的数据）
      logWithTag('[手动发送邮件]', '========== 重新应用最终过滤逻辑 ==========');
      
      // 预先获取所有额外公众号的ID列表（用于后续过滤判断）
      let additionalAccountIdsSet = new Set();
      try {
        const additionalAccounts = await db.query(
          `SELECT DISTINCT wechat_account_id 
           FROM additional_wechat_accounts 
           WHERE status = 'active' 
           AND wechat_account_id IS NOT NULL 
           AND wechat_account_id != ''
           AND delete_mark = 0`
        );
        additionalAccounts.forEach(acc => {
          if (acc.wechat_account_id) {
            additionalAccountIdsSet.add(acc.wechat_account_id);
          }
        });
        logWithTag('[手动发送邮件]', `预先获取额外公众号ID列表，共 ${additionalAccountIdsSet.size} 个`);
      } catch (err) {
        warnWithTag('[手动发送邮件]', `获取额外公众号列表失败: ${err.message}`);
      }
      
      // 解析企查查类别编码（JSON格式）
      let categoryCodes = null;
      if (recipient.qichacha_category_codes) {
        try {
          const parsed = typeof recipient.qichacha_category_codes === 'string'
            ? JSON.parse(recipient.qichacha_category_codes)
            : recipient.qichacha_category_codes;
          if (Array.isArray(parsed) && parsed.length > 0) {
            categoryCodes = parsed;
          }
        } catch (e) {
          warnWithTag('[手动发送邮件]', `解析企查查类别编码失败: ${e.message}`);
        }
      }
      
      // 导入过滤函数
      const { filterNewsByCategory } = require('../utils/scheduledEmailTasks');
      
      // 过滤新闻：根据收件配置的企查查类别编码进行过滤
      logWithTag('[手动发送邮件]', 'AI重新分析后，重新应用企查查类别过滤...');
      logWithTag('[手动发送邮件]', `重新分析后的新闻数量: ${newsList.length}`);
      if (newsList.length > 0) {
        logWithTag('[手动发送邮件]', `重新分析后的新闻类别详情（前5条）:`, newsList.slice(0, 5).map(n => ({
          id: n.id,
          title: n.title?.substring(0, 30),
          APItype: n.APItype || '(NULL)',
          news_category: n.news_category || '(NULL)',
          enterprise_full_name: n.enterprise_full_name || '(NULL)'
        })));
      }
      const filteredNewsList = filterNewsByCategory(newsList, categoryCodes);
      logWithTag('[手动发送邮件]', `企查查类别过滤后: ${filteredNewsList.length} 条新闻`);
      if (filteredNewsList.length < newsList.length) {
        const filteredOut = newsList.filter(n => {
          const isQichacha = n.APItype === '企查查' || n.APItype === 'qichacha';
          if (!isQichacha) return false; // 非企查查新闻不会被类别过滤过滤掉
          const categoryCode = n.news_category ? String(n.news_category).trim() : '';
          const isInFiltered = filteredNewsList.some(fn => fn.id === n.id);
          return !isInFiltered;
        });
        if (filteredOut.length > 0) {
          logWithTag('[手动发送邮件]', `⚠️ 被类别过滤过滤掉的企查查新闻（${filteredOut.length}条）:`, filteredOut.map(n => ({
            id: n.id,
            title: n.title?.substring(0, 50),
            news_category: n.news_category || '(NULL)',
            enterprise_full_name: n.enterprise_full_name || '(NULL)'
          })));
        }
      }
      
      // 使用finalNewsList的过滤逻辑再次过滤
      const beforeFinalFilterCount = filteredNewsList.length;
      const finalFilteredNewsList = filteredNewsList.filter(news => {
        // 检查标题（标题是必需的）
        if (!news.title || news.title.trim() === '') {
          return false;
        }
        
        // 检查企业全称（额外公众号的新闻可能没有企业名称）
        const enterpriseName = news.enterprise_full_name;
        const hasEnterpriseName = enterpriseName && enterpriseName.trim() !== '';
        
        // 对于没有企业名称的新闻，检查是否是额外公众号的新闻
        if (!hasEnterpriseName) {
          const isAdditionalAccountNews = news.wechat_account && additionalAccountIdsSet.has(news.wechat_account);
          if (!isAdditionalAccountNews) {
            // 非额外公众号的新闻，企业全称是必需的
            return false;
          }
        }
        
        // 检查 news_abstract 字段（AI提取的摘要）
        const hasAbstract = news.news_abstract && news.news_abstract.trim() !== '';
        // 检查 summary 字段（原始摘要，新榜数据使用此字段）
        const hasSummary = news.summary && news.summary.trim() !== '';
        // 检查 content 字段（正文）
        const hasContent = news.content && news.content.trim() !== '';
        
        // 判断数据源类型
        const isQichacha = news.APItype === '企查查' || news.APItype === 'qichacha';
        const isXinbang = news.APItype === '新榜' || !news.APItype || (!isQichacha);
        
        if (isXinbang) {
          // 新榜新闻：只要有摘要（news_abstract 或 summary）即可推送
          return hasAbstract || hasSummary;
        } else {
          // 企查查新闻：有摘要（news_abstract）或正文即可推送
          return hasAbstract || hasContent;
        }
      });
      
      const afterFinalFilterCount = finalFilteredNewsList.length;
      const finalFilteredCount = beforeFinalFilterCount - afterFinalFilterCount;
      if (finalFilteredCount > 0) {
        logWithTag('[手动发送邮件]', `最终过滤掉 ${finalFilteredCount} 条不满足发送邮件条件的数据，剩余 ${afterFinalFilterCount} 条`);
      }
      logWithTag('[手动发送邮件]', '========== 最终过滤完成 ==========');
      
      // 使用最终过滤后的新闻列表
      newsList = finalFilteredNewsList;
    }
    
    // 获取邮件配置（使用"新闻舆情"应用的邮件配置）
    const emailConfigs = await db.query(
      `SELECT ec.*, a.app_name
       FROM email_config ec
       LEFT JOIN applications a ON ec.app_id = a.id
       WHERE CAST(a.app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci 
       AND ec.is_active = 1
       LIMIT 1`,
      ['新闻舆情']
    );
    
    if (emailConfigs.length === 0) {
      return res.status(404).json({ success: false, message: '未找到"新闻舆情"应用的邮件配置' });
    }
    
    const emailConfig = emailConfigs[0];
    
    // 发送邮件（包含Excel附件），即使没有新闻也发送提示邮件
    // 确保 newsList 是数组，避免 undefined 错误
    if (!Array.isArray(newsList)) {
      logWithTag('[手动发送邮件]', `⚠️ newsList 不是数组，类型: ${typeof newsList}, 值: ${newsList}`);
      newsList = [];
    }

    // 按企业做标题/摘要语义相似度去重：同一企业内若存在相似度>=50%的新闻，只保留按 title、account_name、wechat_account 倒序的第一条
    if (newsList.length > 1) {
      logWithTag('[手动发送邮件]', '========== 开始语义相似度去重 ==========');
      newsList = await deduplicateNewsBySemanticSimilarity(newsList, '[手动发送邮件]');
      logWithTag('[手动发送邮件]', `========== 语义相似度去重结束，将发送 ${newsList.length} 条 ==========`);
    }
    
    // 检查最终传入 sendNewsEmailWithExcel 的 newsList 的 entity_type 分布（用于调试）
    logWithTag('[手动发送邮件]', `========== 最终传入 sendNewsEmailWithExcel 的数据检查 ==========`);
    logWithTag('[手动发送邮件]', `最终新闻数量: ${newsList.length}`);
    if (newsList.length > 0) {
      const finalStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        finalStats[et] = (finalStats[et] || 0) + 1;
      });
      logWithTag('[手动发送邮件]', `最终传入的新闻 entity_type 分布:`, JSON.stringify(finalStats, null, 2));
      
      // 显示前5条新闻的详细信息
      newsList.slice(0, 5).forEach((n, index) => {
        logWithTag('[手动发送邮件]', `最终传入的新闻 ${index + 1}: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}" (类型: ${typeof n.entity_type}), enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
      });
    }
    logWithTag('[手动发送邮件]', `========== 最终数据检查结束 ==========`);
    
    const result = await sendNewsEmailWithExcel(recipient, emailConfig, newsList);
    
    res.json({
      success: true,
      message: newsList.length === 0 ? '昨日没有可见的舆情信息，已发送提示邮件' : '邮件发送成功（含Excel附件）',
      data: {
        recipientId: id,
        recipientEmail: recipient.recipient_email,
        logId: result.logId,
        newsCount: newsList.length
      }
    });
  } catch (error) {
    console.error('发送舆情信息邮件失败：', error);
    res.status(500).json({
      success: false,
      message: '发送邮件失败：' + error.message
    });
  }
});

/**
 * 企查查舆情接口同步函数
 * @param {string|null} configId - 新闻接口配置ID，如果为null则自动查找企查查舆情接口配置
 * @returns {Promise<object>} 同步结果
 */
async function syncQichachaNewsData(configId = null, logId = null, customRange = null) {
  try {
    // 获取企查查舆情接口配置
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '企查查']
      );
      if (configs.length === 0) {
        throw new Error('企查查舆情接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['企查查']
      );
      if (configs.length === 0) {
        throw new Error('请先配置企查查舆情接口');
      }
      config = configs[0];
    }

    const { request_url, api_key } = config;

    // 获取企查查应用凭证和秘钥（从qichacha_config表，接口类型为"新闻舆情"）
    const qichachaConfigs = await db.query(
      `SELECT qichacha_app_key, qichacha_secret_key, qichacha_daily_limit
       FROM qichacha_config 
       WHERE interface_type = '新闻舆情' AND is_active = 1 
       ORDER BY created_at DESC LIMIT 1`
    );

    if (qichachaConfigs.length === 0) {
      throw new Error('请先配置企查查新闻舆情接口的应用凭证和秘钥');
    }

    const appKey = qichachaConfigs[0].qichacha_app_key;
    const secretKey = qichachaConfigs[0].qichacha_secret_key;
    const dailyLimit = parseInt(qichachaConfigs[0].qichacha_daily_limit || '100', 10);

    if (!appKey || !secretKey) {
      throw new Error('企查查应用凭证或秘钥未配置');
    }

    console.log(`企查查每日查询限制次数: ${dailyLimit}`);

    const now = new Date();
    const baseRunDate = createShanghaiDate(now);
    let startDate, endDate;

    // 手动同步时若传入自定义时间范围，优先使用（from/to 格式：YYYY-MM-DD HH:mm:ss，取日期部分）
    if (customRange && customRange.from && customRange.to) {
      startDate = customRange.from.split(' ')[0];
      endDate = customRange.to.split(' ')[0];
      console.log(`[企查查同步] 使用自定义时间范围: ${startDate} 至 ${endDate}`);
    } else {
      const toDate = new Date(baseRunDate);
      toDate.setDate(toDate.getDate() - 1);
      endDate = formatDateOnly(toDate);

      if (config.last_sync_date) {
      // 如果有 last_sync_date，从 last_sync_date + 1天 开始（北京时区）
      // last_sync_date 可能是字符串（YYYY-MM-DD格式）或Date对象
      let lastSyncDateStr;
      if (config.last_sync_date instanceof Date) {
        // 如果是Date对象，转换为YYYY-MM-DD格式字符串（北京时区）
        const beijingDateStr = config.last_sync_date.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const datePart = beijingDateStr.split(' ')[0];
        const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
        lastSyncDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      } else if (typeof config.last_sync_date === 'string') {
        lastSyncDateStr = config.last_sync_date;
      } else {
        // 其他类型，尝试转换为字符串
        lastSyncDateStr = String(config.last_sync_date);
      }
      
      // 解析日期字符串，从上次同步日期开始（不+1天，因为要包含上次同步的那一天）
      const [year, month, day] = lastSyncDateStr.split('-').map(Number);
      const lastSyncDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
      // 从上次同步日期开始（不+1天），确保包含上次同步的那一天
      startDate = formatDateOnly(lastSyncDate);
      
      console.log(`[企查查同步] 使用上次同步日期计算时间范围（北京时区）:`);
      console.log(`[企查查同步] - 上次同步日期: ${lastSyncDateStr}`);
      console.log(`[企查查同步] - 起始日期（从上次同步日期开始）: ${startDate}`);
    } else if (config.last_sync_time) {
      // 如果有 last_sync_time，从 last_sync_time 的日期开始（北京时区，不+1天）
      const lastSyncTime = new Date(config.last_sync_time);
      // 获取北京时区的日期部分
      const beijingDateStr = lastSyncTime.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const datePart = beijingDateStr.split(' ')[0];
      const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
      const lastSyncDateOnly = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
      // 从上次同步日期开始（不+1天），确保包含上次同步的那一天
      startDate = formatDateOnly(lastSyncDateOnly);
      
      console.log(`[企查查同步] 使用上次同步时间计算时间范围（北京时区）:`);
      console.log(`[企查查同步] - 上次同步时间: ${config.last_sync_time}`);
      console.log(`[企查查同步] - 起始日期（从上次同步日期开始）: ${startDate}`);
    } else {
      // 首次执行：使用前一天00:00:00（北京时区）
      const yesterdayDate = new Date(baseRunDate);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      startDate = formatDateOnly(yesterdayDate);
      
      console.log(`[企查查同步] 首次执行，使用前一天作为起始日期（北京时区）:`);
      console.log(`[企查查同步] - 起始日期: ${startDate}`);
    }
    }

    console.log(`企查查舆情同步时间范围：${startDate} 至 ${endDate}`);

    // 从invested_enterprises表获取统一信用代码（排除完全退出的）
    // 使用DISTINCT在SQL层面去重，确保每个统一信用代码只出现一次
    // 根据配置的 entity_type 过滤企业类型
    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') {
          entityTypes = JSON.parse(entityTypes);
        }
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          // 构建多选过滤条件
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') {
              conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            } else if (type === '基金相关主体') {
              conditions.push(`entity_type = '基金相关主体'`);
            } else if (type === '子基金') {
              conditions.push(`entity_type = '子基金'`);
            } else if (type === '子基金管理人') {
              conditions.push(`entity_type = '子基金管理人'`);
            } else if (type === '子基金GP') {
              conditions.push(`entity_type = '子基金GP'`);
            }
          });
          if (conditions.length > 0) {
            entityTypeFilter = `AND (${conditions.join(' OR ')})`;
            console.log(`[企查查同步] 根据配置的企业类型过滤: ${entityTypes.join(', ')}`);
          }
        }
      } catch (e) {
        console.warn(`[企查查同步] 解析 entity_type 配置失败: ${e.message}`);
      }
    }
    
    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type
       FROM invested_enterprises 
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL 
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      console.log('未找到需要同步的企业（统一信用代码为空或所有企业都已完全退出）');
      return {
        success: true,
        message: '没有需要同步的企业',
        data: { synced: 0, total: 0 }
      };
    }

    // 二次去重：虽然SQL已使用DISTINCT，但为了确保数据准确性，在JavaScript层面再次去重
    // 同时过滤掉可能的空值或无效值
    const creditCodes = enterprises
      .map(e => e.unified_credit_code)
      .filter(code => code && code.trim() !== '' && code !== 'null');
    
    let uniqueCreditCodes = [...new Set(creditCodes)];

    // 如果是手动触发（通过logId判断，手动触发会创建logId），过滤掉当天已查询过的企业
    // 通过查询news_detail表中当天已同步的企业全称，找到对应的统一信用代码
    if (logId) {
      try {
        // 获取当天开始时间（Asia/Shanghai时区）
        const todayStart = createShanghaiDate();
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        todayEnd.setMilliseconds(todayEnd.getMilliseconds() - 1);

        // 查询当天已同步的企业全称（企查查接口）
        const syncedEnterprises = await db.query(
          `SELECT DISTINCT enterprise_full_name 
           FROM news_detail 
           WHERE APItype = '企查查' 
           AND created_at >= ? 
           AND created_at <= ?
           AND enterprise_full_name IS NOT NULL 
           AND enterprise_full_name != ''
           AND delete_mark = 0`,
          [todayStart, todayEnd]
        );

        const syncedEnterpriseNames = syncedEnterprises.map(e => e.enterprise_full_name);
        const syncedEnterpriseSet = new Set(syncedEnterpriseNames);

        // 创建企业全称到统一信用代码的映射
        const enterpriseNameToCreditCode = {};
        enterprises.forEach(e => {
          if (e.enterprise_full_name && e.unified_credit_code) {
            enterpriseNameToCreditCode[e.enterprise_full_name] = e.unified_credit_code;
          }
        });

        // 找到已查询企业的统一信用代码
        const syncedCreditCodes = new Set();
        syncedEnterpriseNames.forEach(name => {
          const creditCode = enterpriseNameToCreditCode[name];
          if (creditCode) {
            syncedCreditCodes.add(creditCode);
          }
        });

        // 过滤掉已查询的统一信用代码
        const beforeFilterCount = uniqueCreditCodes.length;
        uniqueCreditCodes = uniqueCreditCodes.filter(code => !syncedCreditCodes.has(code));
        const afterFilterCount = uniqueCreditCodes.length;
        const filteredCount = beforeFilterCount - afterFilterCount;

        if (filteredCount > 0) {
          console.log(`[手动同步] 过滤掉当天已查询的企业: ${filteredCount} 个`);
          console.log(`[手动同步] 剩余待查询企业: ${afterFilterCount} 个`);
        }

        if (uniqueCreditCodes.length === 0) {
          console.log(`[手动同步] 所有企业今天都已查询过，无需再次同步`);
          return {
            success: true,
            message: '所有企业今天都已同步过，无需再次同步',
            data: { synced: 0, total: 0 }
          };
        }
      } catch (filterError) {
        console.error('[手动同步] 过滤已查询企业时出错:', filterError.message);
        // 如果过滤出错，继续使用所有企业，不中断同步流程
      }
    }
    
    console.log(`从数据库查询到 ${enterprises.length} 条记录`);
    console.log(`过滤后得到 ${creditCodes.length} 个统一信用代码`);
    console.log(`去重后得到 ${uniqueCreditCodes.length} 个唯一统一信用代码`);
    
    if (uniqueCreditCodes.length === 0) {
      console.log('去重后没有有效的统一信用代码');
      return {
        success: true,
        message: '没有有效的统一信用代码需要同步',
        data: { synced: 0, total: 0 }
      };
    }

    let totalSynced = 0;
    const errors = [];

    // 根据每日查询限制次数，计算每次同步可以处理的企业数量
    // 每个企业只查询1次，所以每次同步最多处理 dailyLimit 个企业
    // 如果dailyLimit很小，至少处理1个企业
    const maxEnterprisesPerSync = Math.max(1, dailyLimit);
    const enterprisesToSync = uniqueCreditCodes.slice(0, maxEnterprisesPerSync);
    
    console.log(`每日查询限制: ${dailyLimit}次，每次同步最多处理: ${maxEnterprisesPerSync}个企业（每个企业1次查询）`);
    
    if (enterprisesToSync.length < uniqueCreditCodes.length) {
      console.log(`提示：共有 ${uniqueCreditCodes.length} 个企业，受每日查询限制（${dailyLimit}次），本次只同步前 ${enterprisesToSync.length} 个企业`);
      console.log(`剩余 ${uniqueCreditCodes.length - enterprisesToSync.length} 个企业将在后续同步中处理`);
    }

    // 遍历每个统一信用代码，每个企业只查询一次
    for (const creditCode of enterprisesToSync) {
      // 记录每个企业的同步详情
      let enterpriseDataCount = 0; // 该企业返回的数据条数
      let enterpriseInsertCount = 0; // 该企业成功入库的条数
      let enterpriseHasData = false; // 是否有数据返回
      let enterpriseErrorMsg = null; // 错误信息
      
      try {
        // 生成Token和Timespan
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const token = require('crypto')
          .createHash('md5')
          .update(appKey + timestamp + secretKey)
          .digest('hex')
          .toUpperCase();

        // 构建请求参数（不指定emotionType和category，获取所有数据）
        const params = new URLSearchParams({
          key: appKey,
          searchKey: creditCode,
          // 不指定emotionType和category，让API返回所有情感类型和所有类别的数据
          startDate: startDate,
          endDate: endDate,
          pageSize: '50',
          pageIndex: '1'
        });

        // 构建完整请求URL
        const baseUrl = request_url || 'https://api.qichacha.com/CompanyNews/SearchNews';
        const requestUrl = `${baseUrl}?${params.toString()}`;

        console.log(`请求企查查舆情接口: ${creditCode}（获取所有情感类型和所有类别的数据）`);

        // 调用企查查接口（每个企业只调用一次）
        const response = await axios.get(requestUrl, {
          headers: {
            'Token': token,
            'Timespan': timestamp
          },
          timeout: 30000
        });

        // 检查返回状态
        if (response.data.Status === '200' || response.data.status === '200') {
          const result = response.data.Result || response.data.result || [];
          
          if (Array.isArray(result) && result.length > 0) {
            // 不进行任何过滤，保留所有返回的数据（包括所有情感类型和所有类别）
            console.log(`企业 ${creditCode} 返回 ${result.length} 条数据，全部保存`);
            
            // 记录有数据返回
            enterpriseHasData = true;
            enterpriseDataCount = result.length;
            
            // 批量插入数据（所有数据）
            for (const newsItem of result) {
                try {
                  // 检查是否已存在（根据source_url、title、public_time组合去重）
                  // 不再使用企查查返回的NewsId（可能过长），改用系统自动生成的ID
                  const sourceUrl = newsItem.Url || '';
                  const title = newsItem.Title || '';
                  let publicTime = null;
                  if (newsItem.PublishTime) {
                    try {
                      publicTime = new Date(newsItem.PublishTime).toISOString().slice(0, 19).replace('T', ' ');
                    } catch (e) {
                      // 忽略时间格式错误
                    }
                  }
                  
                  // 如果source_url、title、public_time都为空，跳过这条数据
                  if (!sourceUrl && !title && !publicTime) {
                    console.warn('跳过无效数据：source_url、title、public_time均为空');
                    continue;
                  }
                  
                  // 检查是否已存在（根据source_url、title、public_time组合去重）
                  // 如果用户手动删除了某条新闻（delete_mark = 1），不应该重新插入
                  let existing = [];
                  if (sourceUrl) {
                    // 优先使用source_url去重（包括已删除的记录）
                    existing = await db.query(
                      'SELECT id, delete_mark FROM news_detail WHERE source_url = ? LIMIT 1',
                      [sourceUrl]
                    );
                  } else if (title && publicTime) {
                    // 如果没有source_url，使用title和public_time组合去重（包括已删除的记录）
                    existing = await db.query(
                      'SELECT id, delete_mark FROM news_detail WHERE title = ? AND public_time = ? LIMIT 1',
                      [title, publicTime]
                    );
                  }

                  // 如果已存在，无论是否已删除，都跳过（保护用户手动删除的记录）
                  if (existing.length > 0) {
                    if (existing[0].delete_mark === 1) {
                      console.log(`[入库] 跳过已删除的企查查新闻（用户手动删除）: ${sourceUrl || title}`);
                    }
                    continue; // 跳过已存在的记录（无论是否已删除）
                  }

                  // 只有不存在时才插入新数据
                  // 使用系统自动生成的ID，不再使用企查查返回的NewsId（可能过长）
                  const newsId = await generateId('news_detail');
                    // 转换情感类型
                    let newsSentiment = 'neutral'; // 默认中性
                    const emotionTypeValue = newsItem.EmotionType || '';
                    if (emotionTypeValue === 'positive') {
                      newsSentiment = 'positive';
                    } else if (emotionTypeValue === 'negative') {
                      newsSentiment = 'negative';
                    } else if (emotionTypeValue === 'none') {
                      newsSentiment = 'neutral';
                    }

                    // publicTime已在去重检查时处理，这里不需要重复处理

                    // 根据统一信用代码查找对应的企业全称、entity_type、fund和sub_fund
                    let enterpriseFullName = null;
                    let entityType = null;
                    let fund = null;
                    let sub_fund = null;
                    let enterpriseAbbreviation = null;
                    const enterpriseResult = await db.query(
                      `SELECT enterprise_full_name, entity_type, fund, sub_fund, project_abbreviation 
                       FROM invested_enterprises 
                       WHERE unified_credit_code = ? 
                       AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
                       AND delete_mark = 0 
                       LIMIT 1`,
                      [creditCode]
                    );
                    if (enterpriseResult.length > 0) {
                      enterpriseFullName = enterpriseResult[0].enterprise_full_name;
                      entityType = enterpriseResult[0].entity_type;
                      fund = enterpriseResult[0].fund;
                      sub_fund = enterpriseResult[0].sub_fund;
                      enterpriseAbbreviation = enterpriseResult[0].project_abbreviation || null;
                    }

                    // 将Category编码转换为中文类别
                    // Category可能是字符串、数字或数组
                    let categoryCode = newsItem.Category || '';
                    let newsCategory = null;
                    let keywordsValue = null;
                    
                    if (categoryCode) {
                      // 如果是数组，转换所有编码；如果是字符串/数字，转换为数组
                      let categoryCodes = Array.isArray(categoryCode) ? categoryCode : [categoryCode];
                      
                      // 确保所有编码都是字符串格式
                      categoryCodes = categoryCodes.map(code => String(code).trim()).filter(code => code);
                      
                      if (categoryCodes.length > 0) {
                        // news_category字段存储第一个类别编码（用于过滤判断）
                        newsCategory = categoryCodes[0];
                        
                        // 使用convertCategoryCodesToChinese转换所有编码为中文数组，存储到keywords字段（JSON格式）
                        const chineseCategories = convertCategoryCodesToChinese(categoryCodes);
                        if (chineseCategories.length > 0) {
                          keywordsValue = JSON.stringify(chineseCategories);
                        }
                      }
                    }

                    // 检查content是否为空，如果为空则从链接提取正文内容
                    // 注意：企查查接口数据，需要在正文内容入库后，再基于正文内容做摘要、关键词、情感的分析
                    // 所以在同步时，只提取正文，不提取摘要，摘要将在后续的AI分析中生成
                    let finalContent = newsItem.Content || '';
                    
                    if (!finalContent && newsItem.Url) {
                      try {
                        console.log(`[企查查同步] 检测到content为空，开始从链接提取正文内容: ${newsItem.Url}`);
                        
                        // 优先使用 extractArticleContent 方法（查找 news-detail 或 article-content 标记）
                        const newsAnalysis = require('../utils/newsAnalysis');
                        
                        // 先尝试使用 fetchContentFromUrl 方法（会使用 extractArticleContent 查找标记）
                        // 传入Source字段作为account_name，用于判断今日头条等特殊网站
                        const accountName = newsItem.Source || '';
                        let extractedContent = await newsAnalysis.fetchContentFromUrl(newsItem.Url, accountName);
                        
                        if (extractedContent && extractedContent.trim().length > 50) {
                          finalContent = extractedContent;
                          console.log(`[企查查同步] ✓ 使用extractArticleContent方法成功提取正文，长度: ${finalContent.length} 字符`);
                          console.log(`[企查查同步] 注意：摘要、关键词、情感分析将在后续的AI分析中基于正文内容生成`);
                        } else {
                          // 如果 extractArticleContent 提取失败，使用 AI 提取作为备用方案
                          console.log(`[企查查同步] extractArticleContent提取失败或内容太短，尝试使用AI提取作为备用方案`);
                        const WebContentExtractor = require('../utils/webContentExtractor');
                        const extractor = new WebContentExtractor();
                        
                        const extractedResult = await extractor.extractFromUrl(
                          newsItem.Url,
                          newsItem.Title || ''
                        );
                        
                          if (extractedResult.content && extractedResult.content.trim().length > 50) {
                          finalContent = newsAnalysis.stripDisclaimerAndAfter(extractedResult.content);
                            console.log(`[企查查同步] ✓ 使用AI提取成功提取正文，长度: ${finalContent.length} 字符`);
                          console.log(`[企查查同步] 注意：摘要、关键词、情感分析将在后续的AI分析中基于正文内容生成`);
                        } else {
                            console.warn(`[企查查同步] AI提取正文为空或太短: ${newsItem.Url}`);
                          }
                        }
                        
                        // 不提取摘要，摘要将在后续的AI分析中基于正文内容生成
                      } catch (extractError) {
                        console.error(`[企查查同步] 提取网页内容失败 (${newsItem.Url}):`, extractError.message);
                        // 提取失败不影响数据插入，继续使用空的content
                      }
                    }

                    // 插入新闻数据
                    // 注意：企查查接口数据，摘要、关键词、情感分析将在后续的AI分析中基于正文内容生成
                    // 所以这里news_abstract设为NULL，等待后续AI分析
                    await db.execute(
                      `INSERT INTO news_detail 
                       (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, keywords, news_sentiment, APItype, news_category, news_abstract, fund, sub_fund) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        newsId,
                        newsItem.Source || '企查查',
                        newsItem.Source || '企查查',
                        enterpriseFullName,
                        enterpriseAbbreviation,
                        entityType,
                        newsItem.Url || '',
                        newsItem.Title || '',
                        newsItem.NewsTags || '',
                        publicTime,
                        finalContent,
                        keywordsValue,
                        newsSentiment,
                        '企查查', // APItype - 企查查接口
                        newsCategory, // 新闻类别（中文）
                        null, // news_abstract设为NULL，等待后续AI分析基于正文内容生成
                        fund, // fund - 从invested_enterprises表获取
                        sub_fund // sub_fund - 从invested_enterprises表获取
                      ]
                    );

                    totalSynced++;
                    enterpriseInsertCount++;
                } catch (insertError) {
                  const newsTitle = newsItem.Title || newsItem.Url || '未知标题';
                  console.error(`插入新闻数据失败 (${newsTitle}):`, insertError.message);
                  errors.push(`插入失败 (${newsTitle}): ${insertError.message}`);
                }
              }
            }
          } else {
            const status = response.data.Status || response.data.status || 'unknown';
            const message = response.data.Message || response.data.message || '未知错误';
            console.warn(`企查查接口返回错误状态: ${status}, ${message}`);
            errors.push(`接口错误 (${creditCode}): ${status} - ${message}`);
            
            // 记录错误信息
            enterpriseErrorMsg = `${status} - ${message}`;
            
            // 检查是否是使用量不足的错误
            const isQuotaExceeded = message.includes('使用量') || 
                                   message.includes('配额') || 
                                   message.includes('不足') ||
                                   message.includes('quota') ||
                                   message.includes('limit') ||
                                   message.includes('次数') ||
                                   status === '403' ||
                                   status === '429';
            
            if (isQuotaExceeded) {
              console.warn(`[企查查同步] 接口使用量不足，停止后续调用。已处理 ${totalSynced} 条数据`);
              // 如果已获取到数据，先返回已处理的数据
              if (totalSynced > 0) {
                return {
                  success: true,
                  message: `接口使用量不足，已处理 ${totalSynced} 条数据`,
                  data: {
                    synced: totalSynced,
                    total: uniqueCreditCodes.length,
                    errors: errors,
                    quotaExceeded: true
                  }
                };
              }
            }
          }

          // 避免请求过快，添加延迟（每个企业查询后延迟）
          await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`同步企查查舆情数据失败 (${creditCode}):`, error.message);
        
        // 检查是否是使用量不足的错误
        const errorMessage = error.message || '';
        const responseStatus = error.response?.status;
        const isQuotaExceeded = errorMessage.includes('使用量') || 
                               errorMessage.includes('配额') || 
                               errorMessage.includes('不足') ||
                               errorMessage.includes('quota') ||
                               errorMessage.includes('limit') ||
                               errorMessage.includes('次数') ||
                               responseStatus === 403 ||
                               responseStatus === 429;
        
        errors.push(`同步失败 (${creditCode}): ${error.message}`);
        
        // 记录错误信息
        enterpriseErrorMsg = error.message;
        
        if (isQuotaExceeded) {
          console.warn(`[企查查同步] 接口使用量不足，停止后续调用。已处理 ${totalSynced} 条数据`);
          // 如果已获取到数据，先返回已处理的数据
          if (totalSynced > 0) {
            return {
              success: true,
              message: `接口使用量不足，已处理 ${totalSynced} 条数据`,
              data: {
                synced: totalSynced,
                total: uniqueCreditCodes.length,
                errors: errors,
                quotaExceeded: true
              }
            };
          }
        }
        
        // 记录该企业的同步详情
        if (logId) {
          try {
            const detailLogId = await generateId('news_sync_detail_log');
            await db.execute(
              `INSERT INTO news_sync_detail_log 
               (id, sync_log_id, interface_type, account_id, has_data, data_count, insert_success, insert_count, error_message) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                detailLogId,
                logId,
                '企查查',
                creditCode,
                enterpriseHasData ? 1 : 0,
                enterpriseDataCount,
                enterpriseInsertCount > 0 ? 1 : 0,
                enterpriseInsertCount,
                enterpriseErrorMsg
              ]
            );
          } catch (detailLogError) {
            console.error(`[企查查同步] 记录详细日志失败（企业：${creditCode}）：`, detailLogError.message);
          }
        }
      }
    }

    // 注意：last_sync_time 的更新现在在 updateSyncLog 函数中处理
    // 这里不再需要更新，因为 updateSyncLog 会使用执行日志的 end_time 来更新 last_sync_time

    // 输出同步统计信息
    console.log(`[企查查同步] ========== 同步统计 ==========`);
    console.log(`[企查查同步] 配置ID: ${configId || config.id}`);
    console.log(`[企查查同步] 时间范围: ${startDate} 到 ${endDate}`);
    console.log(`[企查查同步] 企业总数: ${uniqueCreditCodes.length}`);
    console.log(`[企查查同步] 本次处理: ${enterprisesToSync.length} 个企业`);
    console.log(`[企查查同步] 成功同步: ${totalSynced} 条新闻`);
    console.log(`[企查查同步] 失败数量: ${errors.length}`);
    if (errors.length > 0) {
      console.log(`[企查查同步] 失败详情:`, errors.slice(0, 5)); // 只显示前5个错误
    }
    if (enterprisesToSync.length < uniqueCreditCodes.length) {
      console.log(`[企查查同步] 剩余待处理: ${uniqueCreditCodes.length - enterprisesToSync.length} 个企业`);
    }
    console.log(`[企查查同步] =============================`);

    // 更新日志记录
    if (logId) {
      try {
        // 将详细错误信息存储到execution_details中，而不是error_message
        // error_message字段只存储简要信息（如"有X个错误，详见详情"），详细错误在详情中查看
        const errorSummary = errors.length > 0 
          ? `共 ${errors.length} 个错误，详见接口详情` 
          : null;
        
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: enterprisesToSync.length,
          errorCount: errors.length,
          errorMessage: errorSummary, // 只存储简要信息
          executionDetails: {
            timeRange: { startDate, endDate },
            interfaceType: '企查查',
            requestUrl: request_url || 'https://api.qichacha.com/CompanyNews/SearchNews',
            configId: configId || config.id,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: enterprisesToSync.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined // 详细错误信息存储在execution_details中
          }
        });
      } catch (logError) {
        console.error('更新同步日志失败:', logError.message);
      }
    }

    // 如果同步了新数据，先进行数据去重和清理，再触发AI分析
    if (totalSynced > 0) {
      try {
        console.log(`[企查查同步] 开始数据去重和清理...`);
        const newsDeduplication = require('../utils/newsDeduplication');
        
        // 异步执行数据去重，不阻塞同步响应
        setImmediate(async () => {
          try {
            await newsDeduplication.executeDeduplication();
            console.log(`[企查查同步] ✓ 数据去重完成`);
            
            // 数据去重完成后，触发AI分析
            console.log(`[企查查同步] 开始AI分析 ${totalSynced} 条新数据...`);
            const newsAnalysis = require('../utils/newsAnalysis');
            await newsAnalysis.batchAnalyzeNews(totalSynced);
            console.log(`[企查查同步] ✓ AI分析完成，已分析 ${totalSynced} 条新闻`);
          } catch (deduplicationError) {
            console.error(`[企查查同步] ✗ 数据去重失败:`, deduplicationError.message);
            // 即使去重失败，也继续执行AI分析
            try {
              const newsAnalysis = require('../utils/newsAnalysis');
            await newsAnalysis.batchAnalyzeNews(totalSynced);
            console.log(`[企查查同步] ✓ AI分析完成，已分析 ${totalSynced} 条新闻`);
          } catch (analysisError) {
            console.error(`[企查查同步] ✗ AI分析失败:`, analysisError.message);
            }
          }
        });
      } catch (error) {
        console.warn(`[企查查同步] ✗ 启动数据去重失败:`, error.message);
      }
    } else {
      console.log(`[企查查同步] 本次同步未获取到新数据`);
    }

    return {
      success: true,
      message: `同步完成，共同步 ${totalSynced} 条新闻`,
      data: {
        synced: totalSynced,
        total: uniqueCreditCodes.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : [] // 只返回前10个错误
      }
    };
  } catch (error) {
    console.error('企查查舆情同步失败：', error);
    throw error;
  }
}

/** 上海国际集团各接口默认地址：当新闻接口配置中未填写 request_url 时使用，优先从配置的 request_url 读取以便后续替换接口地址 */
const SHANGHAI_INTERNATIONAL_EXECPERS_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/execPers';

/** 上海国际集团裁判文书概要接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_JUDINSTRMNT_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/judInstrmnt';

/** 上海国际集团法院公告概要接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_CRTANNCMNT_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/crtAnncmnt';

/** 上海国际集团送达公告概要接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_DELIVANNCMNT_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/delivAnncmnt';

/** 上海国际集团开庭公告概要接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_SESSANNCMNT_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/sessAnncmnt';

/** 上海国际集团立案信息概要接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_FILING_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/filing';

/** 上海国际集团破产重整概要接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_BANKRPTREORG_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/bankrptReorgSumm';

/** 上海国际集团失信被执行人接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_DISCRDTEXEC_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/discrdtExec';

/** 上海国际集团限制高消费接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_RESTRICTHIGHCONS_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/restricthighcons';

/** 上海国际集团行政处罚接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_ADMINPNSH_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/adminPnsh';

/** 上海国际集团终本案件接口地址（与 1.12 同环境） */
const SHANGHAI_INTERNATIONAL_FINALCASE_URL = 'http://114.141.181.181:8000/dofp/v2/ipaas/query/finalCase';

/** 上海国际集团同花顺订阅接口地址（测试环境-内网） */
const SHANGHAI_INTERNATIONAL_THS_SUBSCRIBE_URL = 'http://61.152.159.102:21313/esb/gateway/arsenal/yq_qdc/industry_chain_api/v1/client/sync/org/add';

/**
 * 将接口日期格式（如 2025-10-11T00:00:00）格式化为中文「2025年10月11日」
 * @param {string} dt - 日期字符串
 * @returns {string}
 */
function formatJudgmentDateToZh(dt) {
  if (!dt || typeof dt !== 'string') return '';
  const s = dt.replace('T', ' ').trim().substring(0, 10);
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, n] = parts;
  const month = parseInt(m, 10);
  const day = parseInt(n, 10);
  return `${y}年${month}月${day}日`;
}

/**
 * 拼接单条裁判文书记录的 summary（不做 AI 分析，仅拼接）
 * @param {object} item - 接口单条 Data 项
 * @returns {string}
 */
function buildJudgmentSummary(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const caseCause = item.case_cause || '';
  const caseTyp = item.case_typ || '';
  const instrmntTyp = item.instrmnt_typ || '';
  return `${subjInstnNm}作为${subjRole}涉及${caseCause}${caseTyp}，相关裁判文书为${instrmntTyp}类型`;
}

/**
 * 拼接单条裁判文书记录的 content/news_abstract（不做 AI 分析，仅拼接）
 * @param {object} item - 接口单条 Data 项
 * @returns {string}
 */
function buildJudgmentContent(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const caseNo = item.case_no || '';
  const caseCause = item.case_cause || '';
  const caseTyp = item.case_typ || '';
  const instrmntId = item.instrmnt_id || '';
  const instrmntNm = item.instrmnt_nm || '';
  const instrmntTyp = item.instrmnt_typ || '';
  const judCrt = item.jud_crt || '';
  const judDtZh = formatJudgmentDateToZh(item.jud_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${subjInstnNm}作为${subjRole}涉及案号为 ${caseNo} 的${caseCause}${caseTyp}，裁判文书ID为${instrmntId}，文书名称为《${instrmntNm}》，文书类型为${instrmntTyp}，裁判法院为${judCrt}，裁判日期为${judDtZh}，${pubDtZh}公开`;
}

/**
 * 拼接单条法院公告记录的 summary（不做 AI 分析，仅拼接）
 * 示例：浙江台信资产管理有限公司作为申请执行人涉及 (1996) 琼高法执字第 2 号案件，法院公告类型为起诉状副本及开庭传票
 */
function buildCourtAnnouncementSummary(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const caseNo = item.case_no || '';
  const anncmntTyp = item.anncmnt_typ || '';
  return `${subjInstnNm}作为${subjRole}涉及 ${caseNo} 案件，法院公告类型为${anncmntTyp}`;
}

/**
 * 拼接单条法院公告记录的 content/news_abstract（不做 AI 分析，仅拼接）
 * 示例：浙江台信资产管理有限公司作为申请执行人涉及案号为 (1996) 琼高法执字第 2 号的案件，公告类型为起诉状副本及开庭传票，公告法院为海南省高级人民法院，2025 年 10 月 15 日刊登
 */
function buildCourtAnnouncementContent(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const caseNo = item.case_no || '';
  const anncmntTyp = item.anncmnt_typ || '';
  const anncmntCrt = item.anncmnt_crt || '';
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${subjInstnNm}作为${subjRole}涉及案号为 ${caseNo} 的案件，公告类型为${anncmntTyp}，公告法院为${anncmntCrt}，${pubDtZh}刊登`;
}

/**
 * 拼接单条送达公告记录的 summary（不做 AI 分析，仅拼接）
 * 示例：广东粤垦农业小额贷款股份有限公司作为原告涉及金融借款合同纠纷案件，相关送达公告标题为《...》，由横琴粤澳深度合作区人民法院于 2025 年 10 月 21 日发布
 */
function buildDeliveryAnnouncementSummary(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const anncmntTitle = item.anncmnt_title || '';
  const anncmntCrt = item.anncmnt_crt || '';
  const dateZh = formatJudgmentDateToZh(item.anncmnt_dt);
  return `${subjInstnNm}作为${subjRole}涉及相关案件，相关送达公告标题为《${anncmntTitle}》，由${anncmntCrt}于 ${dateZh} 发布`;
}

/**
 * 拼接单条送达公告记录的 content/news_abstract（不做 AI 分析，仅拼接）
 * 示例：广东粤垦农业小额贷款股份有限公司作为原告涉及金融借款合同纠纷案件，公告标题为《...》，公告法院为横琴粤澳深度合作区人民法院，于 2025 年 10 月 21 日发布。
 */
function buildDeliveryAnnouncementContent(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const anncmntTitle = item.anncmnt_title || '';
  const anncmntCrt = item.anncmnt_crt || '';
  const dateZh = formatJudgmentDateToZh(item.anncmnt_dt);
  return `${subjInstnNm}作为${subjRole}涉及相关案件，公告标题为《${anncmntTitle}》，公告法院为${anncmntCrt}，于 ${dateZh} 发布。`;
}

/**
 * 拼接单条开庭公告记录的 summary（不做 AI 分析，仅拼接）
 * 示例：龙元建设集团股份有限公司作为被告涉及 (2012) 开民初字第 0138 号建设工程施工合同纠纷案件，2013 年 10 月 30 日在徐州经济技术开发区人民法院第四法庭开庭，承办部门为民事审判庭，主审人为聂新国
 */
function buildCourtHearingSummary(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const caseNo = item.case_no || '';
  const caseCause = item.case_cause || '';
  const sessDtZh = formatJudgmentDateToZh(item.sess_dt);
  const crtNm = item.crt_nm || '';
  const courtroom = item.courtroom || '';
  const adminDept = item.admin_dept || '';
  const judNm = item.jud_nm || '';
  return `${subjInstnNm}作为${subjRole}涉及 ${caseNo} ${caseCause}案件，${sessDtZh}在${crtNm}${courtroom}开庭，承办部门为${adminDept}，主审人为${judNm}`;
}

/**
 * 拼接单条开庭公告记录的 content/news_abstract（不做 AI 分析，仅拼接）
 * 示例：龙元建设集团股份有限公司作为被告涉及案号为 (2012) 开民初字第 0138 号的建设工程施工合同纠纷案件，于 2013 年 10 月 30 日开庭，承办部门为民事审判庭，主审人为聂新国，审理法院为徐州经济技术开发区人民法院，审理法庭为第四法庭，地区及排期日期信息未披露，公告内容未披露
 */
function buildCourtHearingContent(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const subjRole = item.subj_role || '';
  const caseNo = item.case_no || '';
  const caseCause = item.case_cause || '';
  const sessDtZh = formatJudgmentDateToZh(item.sess_dt);
  const adminDept = item.admin_dept || '';
  const judNm = item.jud_nm || '';
  const crtNm = item.crt_nm || '';
  const courtroom = item.courtroom || '';
  return `${subjInstnNm}作为${subjRole}涉及案号为 ${caseNo} 的${caseCause}案件，于 ${sessDtZh} 开庭，承办部门为${adminDept}，主审人为${judNm}，审理法院为${crtNm}，审理法庭为${courtroom}，地区及排期日期信息未披露，公告内容未披露`;
}

/**
 * 拼接单条立案信息记录的 summary（不做 AI 分析，仅拼接）
 * 示例：中国建筑第三工程局第三建筑安装工程公司作为被执行人涉及 (2000) 沪一中执字第 00631 号执行案件，2000 年 6 月 6 日立案
 */
function buildFilingSummary(item) {
  const partyInstnNm = item.party_instn_nm || '';
  const partyRole = item.party_role || '';
  const caseNo = item.case_no || '';
  const caseTyp = item.case_typ || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  return `${partyInstnNm}作为${partyRole}涉及 ${caseNo} ${caseTyp}案件，${filingDtZh}立案`;
}

/**
 * 拼接单条立案信息记录的 content/news_abstract（不做 AI 分析，仅拼接）
 * 示例：中国建筑第三工程局第三建筑安装工程公司作为被执行人涉及案号为 (2000) 沪一中执字第 00631 号的执行案件，案件类型为执行案件，于 2000 年 6 月 6 日立案，案件相关信息中案由、审理法院、承办部门、案件进度、地区、立案人及审判成员等信息未披露，数据创建时间为 2025 年 10 月 17 日，更新时间为 2025 年 10 月 21 日
 */
function buildFilingContent(item) {
  const partyInstnNm = item.party_instn_nm || '';
  const partyRole = item.party_role || '';
  const caseNo = item.case_no || '';
  const caseTyp = item.case_typ || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const createTimeZh = formatJudgmentDateToZh(item.create_time) || '';
  const updateTimeZh = formatJudgmentDateToZh(item.update_time) || '';
  return `${partyInstnNm}作为${partyRole}涉及案号为 ${caseNo} 的${caseTyp}案件，于 ${filingDtZh} 立案，案件相关信息中案由、审理法院、承办部门、案件进度、地区、立案人及审判成员等信息未披露，数据创建时间为 ${createTimeZh}，更新时间为 ${updateTimeZh}`;
}

/**
 * 拼接单条破产重整记录的 summary（不做 AI 分析，仅拼接）
 * 示例：兰州远东化肥有限责任公司作为破产案件的申请人，相关案件公开于 2025 年 7 月 23 日
 */
function buildBankrptReorgSummary(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const caseTyp = item.case_typ || '破产案件';
  const subjRole = item.subj_role || '';
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${subjInstnNm}作为${caseTyp}的${subjRole}，相关案件公开于 ${pubDtZh}`;
}

/**
 * 拼接单条破产重整记录的 content（不做 AI 分析，仅拼接）
 * 示例：兰州远东化肥有限责任公司涉及案号为 (2013) 兰民破预字第 6 号的破产案件，案件类型编码为 C29002，案件类型为破产案件，破产重整主体唯一识别码为 91620100MA74AADC6G，主体身份为申请人，公告 ID 为 1f682ac7d09c070181e40278b348cf99，2025 年 7 月 23 日公开
 */
function buildBankrptReorgContent(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const caseNo = item.case_no || '';
  const caseTyp = item.case_typ || '破产案件';
  const caseTypCd = item.case_typ_cd || '';
  const subjIdtfnCd = item.subj_idtfn_cd || '';
  const subjRole = item.subj_role || '';
  const pubId = item.pub_id || '';
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${subjInstnNm}涉及案号为 ${caseNo} 的${caseTyp}，案件类型编码为 ${caseTypCd}，案件类型为${caseTyp}，破产重整主体唯一识别码为 ${subjIdtfnCd}，主体身份为${subjRole}，公告 ID 为 ${pubId}，${pubDtZh}公开`;
}

/**
 * 拼接单条破产重整记录的 news_abstract（不做 AI 分析，仅拼接）
 * 示例：兰州远东化肥有限责任公司涉及案号为 (2013) 兰民破预字第 6 号的破产案件，案件类型为破产案件，主体身份为申请人，2025 年 7 月 23 日公开
 */
function buildBankrptReorgAbstract(item) {
  const subjInstnNm = item.subj_instn_nm || '';
  const caseNo = item.case_no || '';
  const caseTyp = item.case_typ || '破产案件';
  const subjRole = item.subj_role || '';
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${subjInstnNm}涉及案号为 ${caseNo} 的${caseTyp}，案件类型为${caseTyp}，主体身份为${subjRole}，${pubDtZh}公开`;
}

/**
 * 拼接单条被执行人记录的 summary/content/news_abstract 文案（不做 AI 分析，仅拼接）
 * @param {object} item - 接口单条 Data 项
 * @returns {string}
 */
function buildExecPersSummary(item) {
  const execInstnNm = item.exec_instn_nm || '';
  const caseNo = item.case_no || '';
  const execUndl = item.exec_undl != null && String(item.exec_undl).trim() !== '' ? String(item.exec_undl).trim() : null;
  const execCrt = item.exec_crt != null && String(item.exec_crt).trim() !== '' ? String(item.exec_crt).trim() : null;
  const caseSts = item.case_sts;
  const statusText = caseSts === '1' ? '结案' : '其他';
  let middle = '';
  if (execUndl) middle = `执行标的为 ${execUndl}，`;
  else if (execCrt) middle = `执行法院为 ${execCrt}，`;
  return `${execInstnNm}涉及被执行人案件，案号为 ${caseNo} 的案件，${middle}案件状态均为${statusText}。`;
}

/**
 * 拼接单条失信被执行人记录的 summary（不做 AI 分析，仅拼接）
 * 示例：四川万崇置业有限公司为失信被执行人，涉及 (2025) 川 1402 执 2760 号案件，执行法院为眉山市东坡区人民法院，被执行人履行情况为全部未履行，2025 年 9 月 3 日立案，2025 年 10 月 13 日发布，需支付勘察费本金 44030.98 元
 */
function buildDiscrdtExecSummary(item, enterpriseFullName) {
  const name = enterpriseFullName || item.exec_instn_nm || '';
  const caseNo = item.case_no || '';
  const execCrt = item.exec_crt || '';
  const stsOfExecPers = item.sts_of_exec_pers || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  const oblig = (item.oblig_in_law_instrmnt || '').trim();
  const obligSnippet = oblig.length > 80 ? oblig.substring(0, 80) + '…' : oblig;
  const obligPart = obligSnippet ? `，${obligSnippet}` : '';
  return `${name}为失信被执行人，涉及 ${caseNo} 案件，执行法院为${execCrt}，被执行人履行情况为${stsOfExecPers}，${filingDtZh}立案，${pubDtZh}发布${obligPart}`;
}

/**
 * 拼接单条失信被执行人记录的 content（不做 AI 分析，仅拼接）
 */
function buildDiscrdtExecContent(item, enterpriseFullName) {
  const name = enterpriseFullName || item.exec_instn_nm || '';
  const execInstnIdThs = item.exec_instn_id_ths || '';
  const execIdtfnCd = item.exec_idtfn_cd || '';
  const caseNo = item.case_no || '';
  const execCrt = item.exec_crt || '';
  const stsOfExecPers = item.sts_of_exec_pers || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  const area = item.area || '';
  const unitOfExecBss = item.unit_of_exec_bss || '';
  const execBssSymb = item.exec_bss_symb || '';
  const oblig = item.oblig_in_law_instrmnt || '';
  return `${name}（失信被执行人同花顺 ID：${execInstnIdThs}，唯一识别码：${execIdtfnCd}）为失信被执行人，涉及案号为 ${caseNo} 号的案件，执行法院为${execCrt}，被执行人履行情况为${stsOfExecPers}，案件于 ${filingDtZh} 立案，${pubDtZh} 发布，所属地区为${area}，做出执行依据单位为${unitOfExecBss}，执行依据文号为 ${execBssSymb}，生效法律文书确定${oblig}`;
}

/**
 * 拼接单条失信被执行人记录的 news_abstract（不做 AI 分析，仅拼接）
 */
function buildDiscrdtExecAbstract(item, enterpriseFullName) {
  const name = enterpriseFullName || item.exec_instn_nm || '';
  const caseNo = item.case_no || '';
  const execCrt = item.exec_crt || '';
  const stsOfExecPers = item.sts_of_exec_pers || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  const area = item.area || '';
  const unitOfExecBss = item.unit_of_exec_bss || '';
  const execBssSymb = item.exec_bss_symb || '';
  const oblig = item.oblig_in_law_instrmnt || '';
  return `${name}为失信被执行人，涉及案号为 ${caseNo} 号的案件，执行法院为${execCrt}，被执行人履行情况为${stsOfExecPers}，案件于 ${filingDtZh} 立案，${pubDtZh} 发布，所属地区为${area}，做出执行依据单位为${unitOfExecBss}，执行依据文号为 ${execBssSymb}，生效法律文书确定${oblig}`;
}

/**
 * 拼接单条限制高消费记录的 summary（不做 AI 分析，仅拼接）
 */
function buildRestrictHighConsSummary(item, enterpriseFullName) {
  const name = enterpriseFullName || item.restr_instn_nm || '';
  const caseNo = item.case_no || '';
  const restrPersNm = item.restr_pers_nm || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${name}涉及限制高消费事项，关联案号 ${caseNo}，相关受限人员为${restrPersNm}，${filingDtZh}立案，${pubDtZh}发布`;
}

/**
 * 拼接单条限制高消费记录的 content（不做 AI 分析，仅拼接）
 */
function buildRestrictHighConsContent(item, enterpriseFullName) {
  const name = enterpriseFullName || item.restr_instn_nm || '';
  const restrInstnIdThs = item.restr_instn_id_ths || '';
  const restrIdtfnCd = item.restr_idtfn_cd || '';
  const caseNo = item.case_no || '';
  const restrPersNm = item.restr_pers_nm || '';
  const restrPersIdThs = item.restr_pers_id_ths || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  const s3Path = item.s3_path || '';
  return `${name}（限高机构同花顺 ID：${restrInstnIdThs}，唯一识别码：${restrIdtfnCd}）涉及限制高消费事项，关联案号为 ${caseNo}，相关受限人员${restrPersNm}（同花顺 ID：${restrPersIdThs}），案件于 ${filingDtZh} 立案，${pubDtZh} 发布，详情关键字为 ${s3Path}`;
}

/**
 * 拼接单条限制高消费记录的 news_abstract（不做 AI 分析，仅拼接）
 */
function buildRestrictHighConsAbstract(item, enterpriseFullName) {
  const name = enterpriseFullName || item.restr_instn_nm || '';
  const caseNo = item.case_no || '';
  const restrPersNm = item.restr_pers_nm || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const pubDtZh = formatJudgmentDateToZh(item.pub_dt);
  return `${name}涉及限制高消费事项，关联案号为 ${caseNo}，相关受限人员${restrPersNm}，案件于 ${filingDtZh} 立案，${pubDtZh} 发布`;
}

/**
 * 拼接单条行政处罚记录的 summary（不做 AI 分析，仅拼接）
 */
function buildAdminPnshSummary(item, enterpriseFullName) {
  const name = enterpriseFullName || item.pnsh_instn_nm || '';
  const decisionDtZh = formatJudgmentDateToZh(item.pnsh_decision_dt);
  const dept = item.decision_dept || '';
  const instrmntNo = item.pnsh_instrmnt_no || '';
  const amt = item.pnsh_amt != null ? Number(item.pnsh_amt) : null;
  const amtStr = amt !== null && !Number.isNaN(amt) ? `${amt} 万元` : '未载明金额';
  const rslt = (item.pnsh_rslt || '').trim();
  const rsltSnippet = rslt.length > 60 ? rslt.substring(0, 60) + '…' : rslt;
  const resultPart = rsltSnippet ? `，处罚结果为${rsltSnippet}` : '';
  return `${name}于 ${decisionDtZh} 收到${dept}出具的编号为 ${instrmntNo} 的行政处罚决定书，处罚金额为 ${amtStr}${resultPart}`;
}

/**
 * 拼接单条行政处罚记录的 content（不做 AI 分析，仅拼接）
 */
function buildAdminPnshContent(item, enterpriseFullName) {
  const name = enterpriseFullName || item.pnsh_instn_nm || '';
  const instnIdThs = item.pnsh_instn_id_ths || '';
  const idtfnCd = item.pnsh_idtfn_cd || '';
  const decisionDtZh = formatJudgmentDateToZh(item.pnsh_decision_dt);
  const dept = item.decision_dept || '';
  const instrmntNo = item.pnsh_instrmnt_no || '';
  const rslt = (item.pnsh_rslt || '').trim() || '相关行政处罚';
  return `${name}（同花顺机构编码：${instnIdThs}，唯一识别码：${idtfnCd}）于 ${decisionDtZh} 收到${dept}出具的编号为 ${instrmntNo} 的行政处罚决定书，处罚结果为${rslt}`;
}

/**
 * 拼接单条行政处罚记录的 news_abstract（不做 AI 分析，仅拼接）
 */
function buildAdminPnshAbstract(item, enterpriseFullName) {
  return buildAdminPnshContent(item, enterpriseFullName);
}

/**
 * 拼接单条终本案件记录的 summary（不做 AI 分析，仅拼接）
 * 示例：四川永星电子有限公司涉及 (2021) 沪 01 执 1248 号终本案件，2021 年 7 月 2 日立案，2021 年 9 月 28 日终本，执行标的 209078333，未履行金额 209078333 元，执行法院为上海市第一中级人民法院
 */
function buildFinalCaseSummary(item, enterpriseFullName) {
  const name = enterpriseFullName || item.exec_instn_nm || '';
  const caseNo = item.case_no || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const stpDtZh = formatJudgmentDateToZh(item.stp_dt);
  const brchAmt = item.brch_amt != null && String(item.brch_amt).trim() !== '' ? String(item.brch_amt).trim() : '';
  const execUndl = item.exec_undl != null && String(item.exec_undl).trim() !== '' ? String(item.exec_undl).trim() : '';
  const execCrt = item.exec_crt || '';
  return `${name}涉及 ${caseNo} 终本案件，${filingDtZh}立案，${stpDtZh}终本，执行标的 ${brchAmt}，未履行金额 ${execUndl} 元，执行法院为${execCrt}`;
}

/**
 * 拼接单条终本案件记录的 content（不做 AI 分析，仅拼接）
 */
function buildFinalCaseContent(item, enterpriseFullName) {
  const name = enterpriseFullName || item.exec_instn_nm || '';
  const execInstnIdThs = item.exec_instn_id_ths || '';
  const execIdtfnCd = item.exec_idtfn_cd || '';
  const caseNo = item.case_no || '';
  const execBssSymb = item.exec_bss_symb || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const stpDtZh = formatJudgmentDateToZh(item.stp_dt);
  const brchAmt = item.brch_amt != null && String(item.brch_amt).trim() !== '' ? String(item.brch_amt).trim() : '';
  const execUndl = item.exec_undl != null && String(item.exec_undl).trim() !== '' ? String(item.exec_undl).trim() : '';
  const execCrt = item.exec_crt || '';
  const addr = item.addr || '';
  return `${name}（被执行人同花顺编码：${execInstnIdThs}，唯一识别码：${execIdtfnCd}）涉及案号为 ${caseNo} 的终本案件，执行依据文号为 ${execBssSymb}，于 ${filingDtZh} 立案，${stpDtZh} 终本，执行标的为 ${brchAmt}，未履行金额为 ${execUndl}，执行法院为${execCrt}，企业地址为${addr}`;
}

/**
 * 拼接单条终本案件记录的 news_abstract（不做 AI 分析，仅拼接）
 */
function buildFinalCaseAbstract(item, enterpriseFullName) {
  const name = enterpriseFullName || item.exec_instn_nm || '';
  const caseNo = item.case_no || '';
  const execBssSymb = item.exec_bss_symb || '';
  const filingDtZh = formatJudgmentDateToZh(item.filing_dt);
  const stpDtZh = formatJudgmentDateToZh(item.stp_dt);
  const brchAmt = item.brch_amt != null && String(item.brch_amt).trim() !== '' ? String(item.brch_amt).trim() : '';
  const execUndl = item.exec_undl != null && String(item.exec_undl).trim() !== '' ? String(item.exec_undl).trim() : '';
  const execCrt = item.exec_crt || '';
  const addr = item.addr || '';
  return `${name}涉及案号为 ${caseNo} 的终本案件，执行依据文号为 ${execBssSymb}，于 ${filingDtZh} 立案，${stpDtZh} 终本，执行标的为 ${brchAmt}，未履行金额为 ${execUndl}，执行法院为${execCrt}，企业地址为${addr}`;
}

/**
 * 上海国际集团被执行人接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + exec_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupExecPersData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团被执行人接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '被执行人']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团被执行人接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团被执行人] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '被执行人' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团被执行人] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_EXECPERS_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const execIdtfnCd = normalizeCreditCode(creditCode);
      if (execIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团被执行人] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${execIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = execIdtfnCd.substring(0, 4) + '****' + execIdtfnCd.slice(-4);
        console.log(`[上海国际集团被执行人] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              exec_idtfn_cd: execIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团被执行人] 接口错误 (${maskedCode}, ${queryDate}): ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}, ${queryDate}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
          const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
          const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
          const entityType = enterpriseInfo.entity_type || null;
          const accountName = '被执行人';
          const keywords = JSON.stringify([accountName]);

          for (const item of list) {
            const caseNo = (item.case_no || '').trim();
            if (!caseNo) continue;
            if (existingCaseNos.has(caseNo)) continue;

            let publicTime = null;
            if (item.filing_dt) {
              const s = String(item.filing_dt).replace('T', ' ').substring(0, 19);
              if (s.length >= 19) publicTime = s;
            }
            if (!publicTime) publicTime = formatDate(new Date());

            const title = `被执行人 - ${enterpriseFullName}`;
            const summary = buildExecPersSummary(item);
            const APItype = '上海国际';

            const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
              enterpriseFullName,
              item.exec_idtfn_cd || creditCode,
              caseNo
            );

            const newsId = await generateId('news_detail');
            await db.execute(
              `INSERT INTO news_detail
               (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                newsId,
                accountName,
                caseNo,
                enterpriseFullName,
                enterpriseAbbreviation,
                entityType,
                '无',
                title,
                summary,
                publicTime,
                summary,
                'negative',
                APItype,
                summary,
                keywords,
                fund,
                sub_fund
              ]
            );
            existingCaseNos.add(caseNo);
            totalSynced++;
          }
        } catch (apiError) {
          console.error(`[上海国际集团被执行人] 请求失败 (${creditCode}, ${queryDate}):`, apiError.message);
          errors.push(`请求失败 (${creditCode}, ${queryDate}): ${apiError.message}`);
        }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团被执行人] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '被执行人',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团被执行人] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `被执行人同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团被执行人同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团失信被执行人接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + exec_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupDiscrdtExecData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团失信被执行人接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '失信被执行人']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团失信被执行人接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团失信被执行人] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '失信被执行人' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团失信被执行人] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_DISCRDTEXEC_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const execIdtfnCd = normalizeCreditCode(creditCode);
      if (execIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团失信被执行人] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${execIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = execIdtfnCd.substring(0, 4) + '****' + execIdtfnCd.slice(-4);
        console.log(`[上海国际集团失信被执行人] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              exec_idtfn_cd: execIdtfnCd,
              query_date: queryDate
            }),
            {
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              'X-App-Id': String(xAppId).trim(),
              'X-Sequence-No': uuid,
              'X-Timestamp': timestamp,
              'APIkey': String(apiKey).trim()
            },
            timeout: 60000,
            transformRequest: [(data) => data]
          }
        );

        if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
          const code = response.data?.Code || 'unknown';
          const desc = response.data?.Desc || '未知错误';
          console.warn(`[上海国际集团失信被执行人] 接口错误: ${code}, ${desc}`);
          errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
          continue;
        }

        const list = response.data.Data;
        const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '失信被执行人';
        const keywords = JSON.stringify([accountName]);

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          let publicTime = null;
          if (item.pub_dt) {
            const s = String(item.pub_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `失信被执行人 - ${enterpriseFullName || item.exec_instn_nm || ''}`;
          const summary = buildDiscrdtExecSummary(item, enterpriseFullName);
          const content = buildDiscrdtExecContent(item, enterpriseFullName);
          const newsAbstract = buildDiscrdtExecAbstract(item, enterpriseFullName);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName,
            item.exec_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.exec_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              newsAbstract,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团失信被执行人] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团失信被执行人] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '失信被执行人',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团失信被执行人] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `失信被执行人同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团失信被执行人同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团限制高消费接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + restr_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupRestrictHighConsData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团限制高消费接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '限制高消费']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团限制高消费接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团限制高消费] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '限制高消费' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团限制高消费] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_RESTRICTHIGHCONS_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const restrIdtfnCd = normalizeCreditCode(creditCode);
      if (restrIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团限制高消费] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${restrIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = restrIdtfnCd.substring(0, 4) + '****' + restrIdtfnCd.slice(-4);
        console.log(`[上海国际集团限制高消费] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              restr_idtfn_cd: restrIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团限制高消费] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
        const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '限制高消费';
        const keywords = JSON.stringify([accountName]);

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          let publicTime = null;
          if (item.pub_dt) {
            const s = String(item.pub_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `限制高消费 - ${enterpriseFullName || item.restr_instn_nm || ''}`;
          const summary = buildRestrictHighConsSummary(item, enterpriseFullName);
          const content = buildRestrictHighConsContent(item, enterpriseFullName);
          const newsAbstract = buildRestrictHighConsAbstract(item, enterpriseFullName);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName,
            item.restr_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.restr_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              newsAbstract,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团限制高消费] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团限制高消费] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '限制高消费',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团限制高消费] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `限制高消费同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团限制高消费同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团行政处罚接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + pnsh_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupAdminPnshData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团行政处罚接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '行政处罚']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团行政处罚接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团行政处罚] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '行政处罚' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingInstrmntNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团行政处罚] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_ADMINPNSH_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const pnshIdtfnCd = normalizeCreditCode(creditCode);
      if (pnshIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团行政处罚] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${pnshIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = pnshIdtfnCd.substring(0, 4) + '****' + pnshIdtfnCd.slice(-4);
        console.log(`[上海国际集团行政处罚] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              pnsh_idtfn_cd: pnshIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团行政处罚] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '行政处罚';
        const keywords = JSON.stringify([accountName]);
        const APItype = '上海国际';

        for (const item of list) {
          const instrmntNo = (item.pnsh_instrmnt_no || '').trim();
          if (!instrmntNo) continue;
          if (existingInstrmntNos.has(instrmntNo)) continue;

          let publicTime = null;
          if (item.pnsh_decision_dt) {
            const s = String(item.pnsh_decision_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `行政处罚 - ${enterpriseFullName || item.pnsh_instn_nm || ''}`;
          const summary = buildAdminPnshSummary(item, enterpriseFullName);
          const content = buildAdminPnshContent(item, enterpriseFullName);
          const newsAbstract = buildAdminPnshAbstract(item, enterpriseFullName);

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName,
            item.pnsh_idtfn_cd || creditCode,
            instrmntNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              instrmntNo,
              enterpriseFullName || item.pnsh_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              newsAbstract,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingInstrmntNos.add(instrmntNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团行政处罚] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团行政处罚] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '行政处罚',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团行政处罚] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: totalSynced > 0 ? `行政处罚同步完成，共入库 ${totalSynced} 条` : '没有新增行政处罚数据',
      data: { synced: totalSynced, total: uniqueCreditCodes.length }
    };
  } catch (error) {
    console.error('上海国际集团行政处罚同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团终本案件接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + exec_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupFinalCaseData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团终本案件接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '终本案件']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团终本案件接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团终本案件] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '终本案件' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团终本案件] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_FINALCASE_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const execIdtfnCd = normalizeCreditCode(creditCode);
      if (execIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团终本案件] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${execIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = execIdtfnCd.substring(0, 4) + '****' + execIdtfnCd.slice(-4);
        console.log(`[上海国际集团终本案件] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              exec_idtfn_cd: execIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团终本案件] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '终本案件';
        const keywords = JSON.stringify([accountName]);
        const APItype = '上海国际';

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          // public_time 取 stp_dt（终本日期）
          let publicTime = null;
          if (item.stp_dt) {
            const s = String(item.stp_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `终本案件 - ${enterpriseFullName || item.exec_instn_nm || ''}`;
          const summary = buildFinalCaseSummary(item, enterpriseFullName);
          const content = buildFinalCaseContent(item, enterpriseFullName);
          const newsAbstract = buildFinalCaseAbstract(item, enterpriseFullName);

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName,
            item.exec_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.exec_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              newsAbstract,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团终本案件] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团终本案件] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '终本案件',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团终本案件] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: totalSynced > 0 ? `终本案件同步完成，共同步 ${totalSynced} 条` : '没有新增终本案件数据',
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团终本案件同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团裁判文书概要接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + subj_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupJudgmentData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团裁判文书接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '裁判文书']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团裁判文书接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团裁判文书] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '裁判文书' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团裁判文书] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_JUDINSTRMNT_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const subjIdtfnCd = normalizeCreditCode(creditCode);
      if (subjIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团裁判文书] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${subjIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = subjIdtfnCd.substring(0, 4) + '****' + subjIdtfnCd.slice(-4);
        console.log(`[上海国际集团裁判文书] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              subj_idtfn_cd: subjIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团裁判文书] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
        const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '裁判文书';
        const keywords = JSON.stringify([accountName]); // keywords 列为 JSON 类型

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          let publicTime = null;
          if (item.pub_dt) {
            const s = String(item.pub_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `裁判文书 - ${enterpriseFullName || item.subj_instn_nm || ''}`;
          const summary = buildJudgmentSummary(item);
          const content = buildJudgmentContent(item);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName || item.subj_instn_nm,
            item.subj_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.subj_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              content,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团裁判文书] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团裁判文书] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '裁判文书',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团裁判文书] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `裁判文书同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团裁判文书同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团法院公告概要接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + subj_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupCourtAnnouncementData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团法院公告接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '法院公告']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团法院公告接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团法院公告] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '法院公告' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团法院公告] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_CRTANNCMNT_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const subjIdtfnCd = normalizeCreditCode(creditCode);
      if (subjIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团法院公告] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${subjIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = subjIdtfnCd.substring(0, 4) + '****' + subjIdtfnCd.slice(-4);
        console.log(`[上海国际集团法院公告] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              subj_idtfn_cd: subjIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团法院公告] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
          const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
          const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
          const entityType = enterpriseInfo.entity_type || null;
          const accountName = '法院公告';
        const keywords = JSON.stringify([accountName]); // keywords 列为 JSON 类型

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          let publicTime = null;
          if (item.pub_dt) {
            const s = String(item.pub_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `法院公告 - ${enterpriseFullName || item.subj_instn_nm || ''}`;
          const summary = buildCourtAnnouncementSummary(item);
          const content = buildCourtAnnouncementContent(item);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName || item.subj_instn_nm,
            item.subj_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.subj_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              content,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团法院公告] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团法院公告] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '法院公告',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团法院公告] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `法院公告同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团法院公告同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团开庭公告概要接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + subj_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupCourtHearingData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团开庭公告接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '开庭公告']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团开庭公告接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团开庭公告] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '开庭公告' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团开庭公告] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_SESSANNCMNT_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const subjIdtfnCd = normalizeCreditCode(creditCode);
      if (subjIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团开庭公告] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${subjIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = subjIdtfnCd.substring(0, 4) + '****' + subjIdtfnCd.slice(-4);
        console.log(`[上海国际集团开庭公告] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              subj_idtfn_cd: subjIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团开庭公告] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '开庭公告';
        const keywords = JSON.stringify([accountName]); // keywords 列为 JSON 类型

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          // 开庭时间 sess_dt 作为 public_time
          let publicTime = null;
          if (item.sess_dt) {
            const s = String(item.sess_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `开庭公告 - ${enterpriseFullName || item.subj_instn_nm || ''}`;
          const summary = buildCourtHearingSummary(item);
          const content = buildCourtHearingContent(item);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName || item.subj_instn_nm,
            item.subj_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.subj_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              content,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团开庭公告] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团开庭公告] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '开庭公告',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团开庭公告] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `开庭公告同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团开庭公告同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团立案信息概要接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + party_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupFilingData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团立案信息接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '立案信息']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团立案信息接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团立案信息] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '立案信息' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团立案信息] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_FILING_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const partyIdtfnCd = normalizeCreditCode(creditCode);
      if (partyIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团立案信息] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${partyIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = partyIdtfnCd.substring(0, 4) + '****' + partyIdtfnCd.slice(-4);
        console.log(`[上海国际集团立案信息] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              party_idtfn_cd: partyIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团立案信息] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;
        const accountName = '立案信息';
        const keywords = JSON.stringify([accountName]); // keywords 列为 JSON 类型

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          // 立案时间 filing_dt 作为 public_time
          let publicTime = null;
          if (item.filing_dt) {
            const s = String(item.filing_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const title = `立案信息 - ${enterpriseFullName || item.party_instn_nm || ''}`;
          const summary = buildFilingSummary(item);
          const content = buildFilingContent(item);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName || item.party_instn_nm,
            item.party_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              enterpriseFullName || item.party_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              content,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团立案信息] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团立案信息] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '立案信息',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团立案信息] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `立案信息同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团立案信息同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团送达公告概要接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + subj_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupDeliveryAnnouncementData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团送达公告接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '送达公告']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团送达公告接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团送达公告] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT title FROM news_detail WHERE APItype = '上海国际' AND account_name = '送达公告' AND (title IS NOT NULL AND title != '')"
    );
    const existingTitles = new Set((existingRows || []).map(r => (r.title || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团送达公告] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_DELIVANNCMNT_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const subjIdtfnCd = normalizeCreditCode(creditCode);
      if (subjIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团送达公告] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${subjIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = subjIdtfnCd.substring(0, 4) + '****' + subjIdtfnCd.slice(-4);
        console.log(`[上海国际集团送达公告] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              subj_idtfn_cd: subjIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团送达公告] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
          const enterpriseFullName = enterpriseInfo.enterprise_full_name || '';
          const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
          const entityType = enterpriseInfo.entity_type || null;
          const accountName = '送达公告';
        const keywords = JSON.stringify([accountName]); // keywords 列为 JSON 类型

        for (const item of list) {
          const title = (item.anncmnt_title || '').trim();
          if (!title) continue;
          if (existingTitles.has(title)) continue;

          let publicTime = null;
          if (item.anncmnt_dt) {
            const s = String(item.anncmnt_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const summary = buildDeliveryAnnouncementSummary(item);
          const content = buildDeliveryAnnouncementContent(item);
          const APItype = '上海国际';

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            enterpriseFullName || item.subj_instn_nm,
            item.subj_idtfn_cd || creditCode,
            accountName
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              accountName,
              enterpriseFullName || item.subj_instn_nm || '',
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              content,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingTitles.add(title);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团送达公告] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团送达公告] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '送达公告',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团送达公告] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `送达公告同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团送达公告同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团破产重整概要接口同步函数（仅拼接入库，不做 AI 分析）
 * 请求方式：POST，query_type=queryByCodeAndDate + subj_idtfn_cd + query_date；按 last_sync_date 逐日补拉或手动 customRange 逐日。
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发的 from/to
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupBankrptReorgData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团破产重整接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '破产重整']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团破产重整接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = Math.max(1, parseInt(sigConfigs[0].daily_limit || '100', 10));

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    const { queryDates, lastQueryDate } = buildShanghaiInternationalQueryDates(config, customRange);
    if (queryDates.length === 0) {
      return { success: true, message: '无需补拉日期', data: { synced: 0, total: 0 } };
    }
    console.log(`[上海国际集团破产重整] query_date 列表: ${queryDates.join(', ')}`);

    const existingRows = await db.query(
      "SELECT wechat_account FROM news_detail WHERE APItype = '上海国际' AND account_name = '破产重整' AND (wechat_account IS NOT NULL AND wechat_account != '')"
    );
    const existingCaseNos = new Set((existingRows || []).map(r => (r.wechat_account || '').trim()).filter(Boolean));

    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') entityTypes = JSON.parse(entityTypes);
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            else if (type === '基金相关主体') conditions.push(`entity_type = '基金相关主体'`);
            else if (type === '子基金') conditions.push(`entity_type = '子基金'`);
            else if (type === '子基金管理人') conditions.push(`entity_type = '子基金管理人'`);
            else if (type === '子基金GP') conditions.push(`entity_type = '子基金GP'`);
          });
          if (conditions.length > 0) entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
      } catch (e) {
        console.warn(`[上海国际集团破产重整] 解析 entity_type 失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type, project_abbreviation
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return { success: true, message: '没有需要同步的企业', data: { synced: 0, total: 0 } };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const creditCodes = enterprises.map(e => e.unified_credit_code).filter(c => c && c.trim() !== '' && c !== 'null');
    const uniqueCreditCodes = [...new Set(creditCodes)];
    const toProcess = uniqueCreditCodes.slice(0, dailyLimit);

    const apiUrl = (config.request_url && String(config.request_url).trim()) ? String(config.request_url).trim() : SHANGHAI_INTERNATIONAL_BANKRPTREORG_URL;
    let totalSynced = 0;
    const errors = [];
    let requestIndex = 0;

    for (const creditCode of toProcess) {
      const subjIdtfnCd = normalizeCreditCode(creditCode);
      if (subjIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团破产重整] 跳过无效机构代码: ${(creditCode || '').substring(0, 10)}... 长度=${subjIdtfnCd.length}`);
        continue;
      }

      for (const queryDate of queryDates) {
        requestIndex += 1;
        const maskedCode = subjIdtfnCd.substring(0, 4) + '****' + subjIdtfnCd.slice(-4);
        console.log(`[上海国际集团破产重整] 请求第 ${requestIndex} 机构:${maskedCode} query_date:${queryDate}`);

        try {
          const uuid = require('crypto').randomUUID();
          const timestamp = String(Date.now());
          const response = await axios.post(
            apiUrl,
            JSON.stringify({
              query_type: 'queryByCodeAndDate',
              subj_idtfn_cd: subjIdtfnCd,
              query_date: queryDate
            }),
            {
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-App-Id': String(xAppId).trim(),
                'X-Sequence-No': uuid,
                'X-Timestamp': timestamp,
                'APIkey': String(apiKey).trim()
              },
              timeout: 60000,
              transformRequest: [(data) => data]
            }
          );

          if (!response.data || response.data.Code !== '200' || !Array.isArray(response.data.Data)) {
            const code = response.data?.Code || 'unknown';
            const desc = response.data?.Desc || '未知错误';
            console.warn(`[上海国际集团破产重整] 接口错误: ${code}, ${desc}`);
            errors.push(`接口错误 (${maskedCode}): ${code} - ${desc}`);
            continue;
          }

          const list = response.data.Data;
          const enterpriseInfo = enterprises.find(e => e.unified_credit_code === creditCode) || {};
        const defaultEnterpriseName = enterpriseInfo.enterprise_full_name || '';
        const enterpriseAbbreviation = enterpriseInfo.project_abbreviation || null;
        const entityType = enterpriseInfo.entity_type || null;

        for (const item of list) {
          const caseNo = (item.case_no || '').trim();
          if (!caseNo) continue;
          if (existingCaseNos.has(caseNo)) continue;

          let publicTime = null;
          if (item.pub_dt) {
            const s = String(item.pub_dt).replace('T', ' ').substring(0, 19);
            if (s.length >= 19) publicTime = s;
          }
          if (!publicTime) publicTime = formatDate(new Date());

          const subjInstnNm = item.subj_instn_nm || defaultEnterpriseName;
          const title = `破产重整 - ${subjInstnNm}`;
          const summary = buildBankrptReorgSummary(item);
          const content = buildBankrptReorgContent(item);
          const newsAbstract = buildBankrptReorgAbstract(item);
          const accountName = '破产重整';
          const APItype = '上海国际';
          const keywords = JSON.stringify(['破产重整']); // keywords 列为 JSON 类型

          const { fund, sub_fund } = await getFundAndSubFundFromEnterprise(
            subjInstnNm,
            item.subj_idtfn_cd || creditCode,
            caseNo
          );

          const newsId = await generateId('news_detail');
          await db.execute(
            `INSERT INTO news_detail
             (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, news_sentiment, APItype, news_abstract, keywords, fund, sub_fund)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newsId,
              accountName,
              caseNo,
              subjInstnNm,
              enterpriseAbbreviation,
              entityType,
              '无',
              title,
              summary,
              publicTime,
              content,
              'negative',
              APItype,
              newsAbstract,
              keywords,
              fund,
              sub_fund
            ]
          );
          existingCaseNos.add(caseNo);
          totalSynced++;
        }
      } catch (apiError) {
        console.error(`[上海国际集团破产重整] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
      }
    }

    if (lastQueryDate && (configId || config.id)) {
      try {
        const endTime = new Date();
        await db.execute(
          'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
          [endTime, lastQueryDate, config.id]
        );
      } catch (e) {
        console.warn(`[上海国际集团破产重整] 更新 last_sync_date 失败:`, e.message);
      }
    }

    if (logId) {
      try {
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: toProcess.length,
          errorCount: errors.length,
          errorMessage: errors.length > 0 ? `共 ${errors.length} 个错误` : null,
          executionDetails: {
            interfaceType: '上海国际集团',
            newsType: '破产重整',
            requestUrl: apiUrl,
            configId: configId || config.id,
            lastQueryDate: lastQueryDate || undefined,
            queryDates: queryDates.length ? queryDates : undefined,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: toProcess.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors.slice(0, 20) : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团破产重整] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `破产重整同步完成，共同步 ${totalSynced} 条`,
      data: { synced: totalSynced, total: toProcess.length, errors: errors.slice(0, 10) }
    };
  } catch (error) {
    console.error('上海国际集团破产重整同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团舆情和公司公告接口同步函数
 * @param {string|null} configId - 新闻接口配置ID
 * @param {string|null} logId - 同步日志ID
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupNewsData(configId = null, logId = null, customRange = null) {
  try {
    // 获取上海国际集团舆情接口配置
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团舆情接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团舆情接口');
      }
      config = configs[0];
    }

    const { request_url } = config;

    // 获取上海国际集团接口配置（从shanghai_international_group_config表）
    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key, daily_limit
       FROM shanghai_international_group_config
       WHERE is_active = 1
       ORDER BY created_at DESC LIMIT 1`
    );

    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }

    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;
    const dailyLimit = parseInt(sigConfigs[0].daily_limit || '100', 10);

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    console.log(`[上海国际集团同步] 每日查询限制次数: ${dailyLimit}`);

    const now = new Date();
    const baseRunDate = createShanghaiDate(now);
    let startDate, endDate;

    // 手动同步时若传入自定义时间范围，优先使用（from/to 格式：YYYY-MM-DD HH:mm:ss）
    if (customRange && customRange.from && customRange.to) {
      startDate = customRange.from.split(' ')[0];
      endDate = customRange.to.split(' ')[0];
      console.log(`[上海国际集团同步] 使用自定义时间范围: ${startDate} 至 ${endDate}`);
    } else {
      const toDate = new Date(baseRunDate);
      toDate.setDate(toDate.getDate() - 1);
      endDate = formatDateOnly(toDate);

      if (config.last_sync_date) {
      let lastSyncDateStr;
      if (config.last_sync_date instanceof Date) {
        const beijingDateStr = config.last_sync_date.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const datePart = beijingDateStr.split(' ')[0];
        const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
        lastSyncDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      } else {
        lastSyncDateStr = String(config.last_sync_date);
      }
      const [year, month, day] = lastSyncDateStr.split('-').map(Number);
      const lastSyncDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
      startDate = formatDateOnly(lastSyncDate);
    } else if (config.last_sync_time) {
      const lastSyncTime = new Date(config.last_sync_time);
      const beijingDateStr = lastSyncTime.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const datePart = beijingDateStr.split(' ')[0];
      const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
      const lastSyncDateOnly = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
      startDate = formatDateOnly(lastSyncDateOnly);
    } else {
      const yesterdayDate = new Date(baseRunDate);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      startDate = formatDateOnly(yesterdayDate);
    }
    }

    // 接口要求 start_time <= end_time，否则返回「请输入正确的报文格式」
    if (startDate > endDate) {
      console.warn(`[上海国际集团同步] 修正日期范围：start_date(${startDate}) 晚于 end_date(${endDate})，已改为 start_date=${endDate}`);
      startDate = endDate;
    }
    // 部分网关要求 start_time 早于 end_time（不能同一天），同一天时改为查询 [endDate-1, endDate]
    if (startDate === endDate) {
      const prev = new Date(endDate + 'T00:00:00+08:00');
      prev.setDate(prev.getDate() - 1);
      const prevStr = formatDateOnly(prev);
      if (prevStr < endDate) {
        startDate = prevStr;
        console.log(`[上海国际集团同步] 同一天查询改为两天范围：${startDate} 至 ${endDate}`);
      }
    }

    console.log(`[上海国际集团同步] 时间范围：${startDate} 至 ${endDate}`);

    // 根据entity_type过滤企业
    let entityTypeFilter = '';
    if (config.entity_type) {
      try {
        let entityTypes = config.entity_type;
        if (typeof entityTypes === 'string') {
          entityTypes = JSON.parse(entityTypes);
        }
        if (Array.isArray(entityTypes) && entityTypes.length > 0) {
          const conditions = [];
          entityTypes.forEach(type => {
            if (type === '被投企业') {
              conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
            } else if (type === '基金相关主体') {
              conditions.push(`entity_type = '基金相关主体'`);
            } else if (type === '子基金') {
              conditions.push(`entity_type = '子基金'`);
            } else if (type === '子基金管理人') {
              conditions.push(`entity_type = '子基金管理人'`);
            } else if (type === '子基金GP') {
              conditions.push(`entity_type = '子基金GP'`);
            }
          });
          if (conditions.length > 0) {
            entityTypeFilter = `AND (${conditions.join(' OR ')})`;
          }
        }
      } catch (e) {
        console.warn(`[上海国际集团同步] 解析 entity_type 配置失败: ${e.message}`);
      }
    }

    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code, enterprise_full_name, entity_type
       FROM invested_enterprises
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
       ${entityTypeFilter}
       ORDER BY unified_credit_code`
    );

    if (enterprises.length === 0) {
      return {
        success: true,
        message: '没有需要同步的企业',
        data: { synced: 0, total: 0 }
      };
    }

    const creditCodes = enterprises
      .map(e => e.unified_credit_code)
      .filter(code => code && code.trim() !== '' && code !== 'null');
    let uniqueCreditCodes = [...new Set(creditCodes)];

    const maxEnterprisesPerSync = Math.max(1, dailyLimit);
    const enterprisesToSync = uniqueCreditCodes.slice(0, maxEnterprisesPerSync);

    let totalSynced = 0;
    const errors = [];

    const apiUrl = request_url || 'http://114.141.181.181:8000/dofp/v2/ipaas/query/newsAndPubnote';

    // 规范化机构唯一识别码：去空格/横线，接口要求 18 位统一社会信用代码
    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    let firstRequestLogged = false;
    let firstMessageFormatErrorLogged = false;
    const totalEnterprises = enterprisesToSync.length;
    let requestIndex = 0;
    for (const creditCode of enterprisesToSync) {
      const instnIdtfnCd = normalizeCreditCode(creditCode);
      if (instnIdtfnCd.length !== 18) {
        console.warn(`[上海国际集团同步] 跳过无效机构代码（需18位统一社会信用代码）: ${creditCode.substring(0, 10)}... 长度=${instnIdtfnCd.length}`);
        errors.push(`机构代码格式无效 (${creditCode.substring(0, 12)}...): 需18位`);
        continue;
      }

      requestIndex += 1;
      const maskedCode = instnIdtfnCd.substring(0, 4) + '****' + instnIdtfnCd.slice(-4);
      console.log(`[上海国际集团同步] 请求第 ${requestIndex}/${totalEnterprises} 个企业 机构:${maskedCode} 时间:${startDate} ~ ${endDate}`);

      try {
        const uuid = require('crypto').randomUUID();
        const timestamp = String(Date.now());

        // 按文档：instn_idtfn_cd 为 String；start_time/end_time 为 yyyy-MM-dd（仅日期）
        const requestBody = {
          instn_idtfn_cd: instnIdtfnCd,
          start_time: String(startDate),
          end_time: endDate ? String(endDate) : ''
        };
        if (!firstRequestLogged) {
          firstRequestLogged = true;
          const masked = { instn_idtfn_cd: maskedCode, start_time: requestBody.start_time, end_time: requestBody.end_time };
          console.log(`[上海国际集团同步] 首条请求报文示例: ${JSON.stringify(masked)}`);
        }

        // 显式以 UTF-8 JSON 字符串发送，避免网关对报文格式的严格校验
        const bodyString = JSON.stringify(requestBody);
        const response = await axios.post(apiUrl, bodyString, {
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-App-Id': String(xAppId).trim(),
            'X-Sequence-No': uuid,
            'X-Timestamp': timestamp,
            'APIkey': String(apiKey).trim()
          },
          timeout: 60000,
          transformRequest: [(data) => data] // 不再让 axios 二次序列化
        });

        if (response.data && response.data.Code === '200' && response.data.Data) {
          const data = response.data.Data;
          const newsItems = [...(data.instn_news || []), ...(data.instn_pubnote || [])];

          // 新闻舆情类型：被投企业全称、简称、企业类型一律来自 invested_enterprises（按统一社会信用代码），不使用接口返回的 instn_nm
          const enterpriseResult = await db.query(
            `SELECT enterprise_full_name, entity_type, fund, sub_fund, project_abbreviation
             FROM invested_enterprises
             WHERE unified_credit_code = ?
             AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
             AND delete_mark = 0
             LIMIT 1`,
            [creditCode]
          );
          const enterpriseFullName = enterpriseResult.length > 0 ? (enterpriseResult[0].enterprise_full_name || null) : null;
          const enterpriseAbbreviation = enterpriseResult.length > 0 ? (enterpriseResult[0].project_abbreviation || null) : null;
          const entityType = enterpriseResult.length > 0 ? enterpriseResult[0].entity_type : null;
          const fund = enterpriseResult.length > 0 ? enterpriseResult[0].fund : null;
          const sub_fund = enterpriseResult.length > 0 ? enterpriseResult[0].sub_fund : null;

          if (!enterpriseFullName) {
            console.warn(`[上海国际集团同步] 未在 invested_enterprises 中查到统一社会信用代码对应的企业，跳过该企业新闻: ${maskedCode}`);
            continue;
          }

          for (const item of newsItems) {
            try {
              const sourceUrl = item.news_url || '';
              const title = item.news_title || '';
              let publicTime = null;
              if (item.disp_time) {
                try {
                  publicTime = item.disp_time.replace('T', ' ').substring(0, 19);
                } catch (e) {}
              }

              if (!sourceUrl && !title && !publicTime) continue;

              let existing = [];
              if (sourceUrl) {
                existing = await db.query(
                  'SELECT id, delete_mark FROM news_detail WHERE source_url = ? LIMIT 1',
                  [sourceUrl]
                );
              } else if (title && publicTime) {
                existing = await db.query(
                  'SELECT id, delete_mark FROM news_detail WHERE title = ? AND public_time = ? LIMIT 1',
                  [title, publicTime]
                );
              }
              if (existing.length > 0) {
                if (existing[0].delete_mark === 1) {
                  console.log(`[上海国际集团同步] 跳过已删除的新闻: ${sourceUrl || title}`);
                }
                continue;
              }

              let newsSentiment = 'neutral';
              const sentimentTyp = item.sentiment_typ || '';
              if (sentimentTyp === '正面') newsSentiment = 'positive';
              else if (sentimentTyp === '负面') newsSentiment = 'negative';

              const accountName = item.pbls_src || '上海国际集团';
              const newsId = await generateId('news_detail');
              const newsAnalysis = require('../utils/newsAnalysis');

              // 上海国际集团流程：入库前提取正文（含中新经纬等规则）→ AI分析摘要关键词 → 校验 → 入库
              let finalContent = item.news_content || '';
              if (!finalContent && sourceUrl) {
                try {
                  console.log(`[上海国际集团同步] 检测到content为空，从链接提取正文（使用accountName: ${accountName}，支持中新经纬等规则）: ${sourceUrl}`);
                  let extractedContent = await newsAnalysis.fetchContentFromUrl(sourceUrl, accountName);
                  if (extractedContent && extractedContent.trim().length > 50) {
                    finalContent = extractedContent;
                    console.log(`[上海国际集团同步] ✓ 提取正文成功，长度: ${finalContent.length} 字符`);
                  } else {
                    const WebContentExtractor = require('../utils/webContentExtractor');
                    const extractor = new WebContentExtractor();
                    const extractedResult = await extractor.extractFromUrl(sourceUrl, title);
                    if (extractedResult.content && extractedResult.content.trim().length > 50) {
                      finalContent = newsAnalysis.stripDisclaimerAndAfter(extractedResult.content);
                      console.log(`[上海国际集团同步] ✓ AI提取正文成功，长度: ${finalContent.length} 字符`);
                    }
                  }
                } catch (extractError) {
                  console.error(`[上海国际集团同步] 提取网页内容失败 (${sourceUrl}):`, extractError.message);
                }
              }

              // 无正文则跳过（无法进行AI分析）
              if (!finalContent || finalContent.trim().length < 20) {
                console.log(`[上海国际集团同步] 跳过：无有效正文内容 (${sourceUrl || title})`);
                continue;
              }

              // 入库前AI分析：摘要、关键词、情感
              let analysisResult = null;
              try {
                analysisResult = await newsAnalysis.analyzeNewsSentimentAndType(
                  title, finalContent, sourceUrl, false, '上海国际集团'
                );
              } catch (analysisError) {
                console.error(`[上海国际集团同步] AI分析失败，跳过: ${analysisError.message}`);
                continue;
              }

              // 检查摘要和关键词是否为空，有空则跳过不入库
              const hasAbstract = analysisResult.news_abstract && analysisResult.news_abstract.trim().length > 0;
              const hasKeywords = analysisResult.keywords && Array.isArray(analysisResult.keywords) && analysisResult.keywords.length > 0;
              if (!hasAbstract || !hasKeywords) {
                console.log(`[上海国际集团同步] 跳过：摘要或关键词为空 (摘要:${hasAbstract ? '有' : '空'}, 关键词:${hasKeywords ? '有' : '空'}) - ${title}`);
                continue;
              }

              // 新闻舆情：被投企业全称、简称、企业类型均来自 invested_enterprises（按统一社会信用代码），不使用接口返回的 instn_nm，不做AI关联性判断
              const finalSentiment = analysisResult.sentiment === 'positive' ? 'positive'
                : analysisResult.sentiment === 'negative' ? 'negative' : newsSentiment;
              const keywordsJson = JSON.stringify(analysisResult.keywords);

              await db.execute(
                `INSERT INTO news_detail
                 (id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type, source_url, title, summary, public_time, content, keywords, news_sentiment, APItype, news_abstract, fund, sub_fund)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  newsId,
                  accountName,
                  accountName,
                  enterpriseFullName,
                  enterpriseAbbreviation,
                  entityType,
                  sourceUrl,
                  title,
                  item.event_nm_lv12 || item.risk_nm_lv12 || '',
                  publicTime,
                  finalContent,
                  keywordsJson,
                  finalSentiment,
                  '上海国际集团',
                  analysisResult.news_abstract,
                  fund,
                  sub_fund
                ]
              );
              totalSynced++;
            } catch (insertError) {
              console.error(`[上海国际集团同步] 插入新闻失败:`, insertError.message);
              errors.push(`插入失败 (${creditCode}): ${insertError.message}`);
            }
          }
        } else {
          const code = response.data?.Code || 'unknown';
          const desc = response.data?.Desc || '未知错误';
          console.warn(`[上海国际集团同步] 接口返回错误: ${code}, ${desc}`);
          if (code === '500' && desc && desc.includes('报文格式') && !firstMessageFormatErrorLogged) {
            firstMessageFormatErrorLogged = true;
            console.warn(`[上海国际集团同步] 报文格式错误时响应体(仅首条):`, JSON.stringify(response.data));
          }
          errors.push(`接口错误 (${creditCode}): ${code} - ${desc}`);
        }
      } catch (apiError) {
        console.error(`[上海国际集团同步] 请求失败 (${creditCode}):`, apiError.message);
        errors.push(`请求失败 (${creditCode}): ${apiError.message}`);
      }
    }

    // 更新日志记录
    if (logId) {
      try {
        const errorSummary = errors.length > 0
          ? `共 ${errors.length} 个错误，详见接口详情`
          : null;
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCreditCodes.length,
          processedEnterprises: enterprisesToSync.length,
          errorCount: errors.length,
          errorMessage: errorSummary,
          executionDetails: {
            timeRange: { startDate, endDate },
            interfaceType: '上海国际集团',
            requestUrl: apiUrl,
            configId: configId || config.id,
            totalEnterprises: uniqueCreditCodes.length,
            processedEnterprises: enterprisesToSync.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined
          }
        });
      } catch (logError) {
        console.warn(`[上海国际集团同步] 更新同步日志失败:`, logError.message);
      }
    }

    return {
      success: true,
      message: `同步完成，共同步 ${totalSynced} 条新闻`,
      data: {
        synced: totalSynced,
        total: uniqueCreditCodes.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : []
      }
    };
  } catch (error) {
    console.error('上海国际集团舆情同步失败：', error);
    throw error;
  }
}

/**
 * 上海国际集团同花顺订阅接口同步函数
 * - 定时任务：根据 company.updated_at 为当天的企业，按最多75个统一社会信用代码一批调用订阅接口
 * - 手动触发：根据传入的时间范围（start_date/end_date），查询 company.updated_at 在区间内的企业，按批调用订阅接口
 * @param {string|null} configId - 接口配置ID（news_interface_config）
 * @param {string|null} logId - 同步日志ID
 * @param {{from?: string, to?: string}|null} customRange - 手动触发时的时间范围
 * @returns {Promise<object>} 同步结果
 */
async function syncShanghaiInternationalGroupThsSubscriptionData(configId = null, logId = null, customRange = null) {
  try {
    let config;
    if (configId) {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1',
        [configId, '上海国际集团']
      );
      if (configs.length === 0) {
        throw new Error('上海国际集团同花顺订阅接口配置不存在或未启用');
      }
      config = configs[0];
    } else {
      const configs = await db.query(
        'SELECT * FROM news_interface_config WHERE interface_type = ? AND news_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
        ['上海国际集团', '同花顺订阅']
      );
      if (configs.length === 0) {
        throw new Error('请先配置上海国际集团同花顺订阅接口');
      }
      config = configs[0];
    }

    const sigConfigs = await db.query(
      `SELECT x_app_id, api_key FROM shanghai_international_group_config WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`
    );
    if (sigConfigs.length === 0) {
      throw new Error('请先配置上海国际集团接口的X-App-Id、APIkey等凭证');
    }
    const xAppId = sigConfigs[0].x_app_id;
    const apiKey = sigConfigs[0].api_key;

    if (!xAppId || !apiKey) {
      throw new Error('上海国际集团接口X-App-Id或APIkey未配置');
    }

    // 根据触发方式获取需要同步的统一社会信用代码列表
    let companyRows = [];
    if (customRange && customRange.from && customRange.to) {
      // 手动触发：使用传入的时间范围（start_date/end_date），按天补拉 company.updated_at
      const startDate = String(customRange.from).split(' ')[0];
      const endDate = String(customRange.to).split(' ')[0];
      console.log(`[上海国际集团同花顺订阅] 手动触发，同步 company.updated_at 在 ${startDate} 至 ${endDate} 之间的企业`);

      companyRows = await db.query(
        `SELECT DISTINCT unified_credit_code
         FROM company
         WHERE unified_credit_code IS NOT NULL
           AND unified_credit_code != ''
           AND unified_credit_code != 'null'
           AND DATE(updated_at) >= ?
           AND DATE(updated_at) <= ?`,
        [startDate, endDate]
      );
    } else {
      // 定时任务：按天触发，使用当天 updated_at = CURRENT_DATE 的企业
      console.log('[上海国际集团同花顺订阅] 定时任务触发，同步 company.updated_at = CURRENT_DATE 的企业');
      companyRows = await db.query(
        `SELECT DISTINCT unified_credit_code
         FROM company
         WHERE unified_credit_code IS NOT NULL
           AND unified_credit_code != ''
           AND unified_credit_code != 'null'
           AND DATE(updated_at) = CURRENT_DATE`
      );
    }

    if (!companyRows || companyRows.length === 0) {
      console.log('[上海国际集团同花顺订阅] 没有符合条件的企业，无需调用订阅接口');
      return {
        success: true,
        message: '没有符合条件的企业，无需调用订阅接口',
        data: { requested: 0, synced: 0, batches: 0, errors: [] }
      };
    }

    const normalizeCreditCode = (code) => {
      if (code == null || typeof code !== 'string') return '';
      return code.trim().replace(/[\s\-]/g, '');
    };

    const allCodes = companyRows
      .map(row => row.unified_credit_code)
      .filter(code => code && typeof code === 'string' && code.trim() !== '' && code !== 'null')
      .map(normalizeCreditCode)
      .filter(code => code.length > 0);
    const uniqueCodes = [...new Set(allCodes)];

    if (uniqueCodes.length === 0) {
      console.log('[上海国际集团同花顺订阅] 统一社会信用代码列表为空，无需调用订阅接口');
      return {
        success: true,
        message: '统一社会信用代码列表为空，无需调用订阅接口',
        data: { requested: 0, synced: 0, batches: 0, errors: [] }
      };
    }

    const apiUrl = (config.request_url && String(config.request_url).trim())
      ? String(config.request_url).trim()
      : SHANGHAI_INTERNATIONAL_THS_SUBSCRIBE_URL;

    const maxPerBatch = 75;
    let totalSynced = 0;
    const errors = [];
    const unSyncNames = new Set();

    let batchIndex = 0;
    for (let i = 0; i < uniqueCodes.length; i += maxPerBatch) {
      const batchCodes = uniqueCodes.slice(i, i + maxPerBatch);
      const creditcode = batchCodes.join(',');
      batchIndex += 1;

      console.log(`[上海国际集团同花顺订阅] 第 ${batchIndex} 批次，请求企业数量: ${batchCodes.length}`);

      try {
        const uuid = require('crypto').randomUUID();
        const timestamp = String(Date.now());
        const requestBody = { creditcode };

        const response = await axios.post(
          apiUrl,
          JSON.stringify(requestBody),
          {
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              'X-App-Id': String(xAppId).trim(),
              'X-Sequence-No': uuid,
              'X-Timestamp': timestamp,
              'APIkey': String(apiKey).trim()
            },
            timeout: 60000,
            transformRequest: [(data) => data]
          }
        );

        const statusCode = response.data?.status_code;
        const statusMsg = response.data?.status_msg || '';
        const data = response.data?.data || {};

        if (statusCode !== 0) {
          const msg = `批次 ${batchIndex} 调用失败: status_code=${statusCode}, status_msg=${statusMsg || '未知错误'}`;
          console.warn(`[上海国际集团同花顺订阅] ${msg}`);
          errors.push(msg);
          continue;
        }

        const batchSynced = parseInt(data.sync_num || 0, 10) || 0;
        totalSynced += batchSynced;

        if (Array.isArray(data.un_sync_name)) {
          data.un_sync_name.forEach(name => {
            if (name) unSyncNames.add(String(name));
          });
        }

        console.log(`[上海国际集团同花顺订阅] 批次 ${batchIndex} 成功，同步数量: ${batchSynced}, 未同步数量: ${Array.isArray(data.un_sync_name) ? data.un_sync_name.length : 0}`);
      } catch (e) {
        const status = e.response?.status;
        const respData = e.response?.data;
        const respStr = typeof respData === 'object' ? JSON.stringify(respData) : String(respData);
        console.error('[上海国际集团同花顺订阅] 调用接口异常:', e.message, status ? `HTTP ${status}` : '', respStr ? `响应: ${respStr}` : '');
        const msg = `批次 ${batchIndex} 调用异常: ${e.message}${respStr ? ` | 接口响应: ${respStr}` : ''}`;
        errors.push(msg);
      }
    }

    // 更新同步日志
    if (logId) {
      try {
        const errorSummary = errors.length > 0
          ? `共 ${errors.length} 个错误，详见接口详情`
          : null;
        await updateSyncLog(logId, {
          status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
          syncedCount: totalSynced,
          totalEnterprises: uniqueCodes.length,
          processedEnterprises: uniqueCodes.length,
          errorCount: errors.length,
          errorMessage: errorSummary,
          executionDetails: {
            interfaceType: '上海国际集团同花顺订阅',
            requestUrl: apiUrl,
            configId: configId || config.id,
            requestedCreditCodes: uniqueCodes.length,
            syncedCount: totalSynced,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined,
            unSyncNames: unSyncNames.size > 0 ? Array.from(unSyncNames) : undefined
          }
        });
      } catch (logError) {
        console.warn('[上海国际集团同花顺订阅] 更新同步日志失败:', logError.message);
      }
    }

    return {
      success: true,
      message: `同花顺订阅调用完成，请求企业 ${uniqueCodes.length} 家，同步成功数量 ${totalSynced}，未同步 ${unSyncNames.size} 个名称/信用代码`,
      data: {
        requested: uniqueCodes.length,
        synced: totalSynced,
        batches: Math.ceil(uniqueCodes.length / maxPerBatch),
        errors: errors,
        un_sync_name: Array.from(unSyncNames)
      }
    };
  } catch (error) {
    console.error('上海国际集团同花顺订阅同步失败：', error);
    throw error;
  }
}

module.exports = router;
// 导出同步函数供定时任务使用
router.syncNewsData = syncNewsData;
router.syncQichachaNewsData = syncQichachaNewsData;
router.syncShanghaiInternationalGroupNewsData = syncShanghaiInternationalGroupNewsData;
router.syncShanghaiInternationalGroupExecPersData = syncShanghaiInternationalGroupExecPersData;
router.syncShanghaiInternationalGroupThsSubscriptionData = syncShanghaiInternationalGroupThsSubscriptionData;
router.createSyncLog = createSyncLog;
router.updateSyncLog = updateSyncLog;

