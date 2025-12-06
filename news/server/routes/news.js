const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const XLSX = require('xlsx');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { checkNewsPermission } = require('../utils/permissionChecker');
const { logRecipientChange } = require('../utils/logger');
const { sendNewsEmailsToAllRecipients, sendNewsEmailToRecipient } = require('../utils/emailSender');
const { updateScheduledTasks, sendNewsEmailWithExcel, getUserVisibleYesterdayNews } = require('../utils/scheduledEmailTasks');
const { convertCategoryCodeToChinese } = require('../utils/qichachaCategoryMapper');

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

const router = express.Router();

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
  const [logs] = await db.query(
    'SELECT start_time FROM news_sync_execution_log WHERE id = ?',
    [logId]
  );
  
  if (logs.length === 0) {
    console.warn(`日志记录不存在: ${logId}`);
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

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

async function isWorkdayDate(date) {
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
  const day = date.getDay();
  return day !== 0 && day !== 6;
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
  const now = targetDate || new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  const localDateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const [localYear, localMonth, localDay] = localDateStr.split('/').map(Number);
  
  // 创建本地时区的今天00:00:00
  const today = new Date(localYear, localMonth - 1, localDay, 0, 0, 0);
  
  // 创建本地时区的昨天00:00:00
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // 开始时间：前一天00:00:00
  const from = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
  
  // 结束时间：前一天23:59:59
  const to = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
  
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

  // 查询invested_enterprises表中退出状态不为"完全退出"和"已上市"的数据
  const enterprises = await db.query(
    `SELECT DISTINCT wechat_official_account_id 
     FROM invested_enterprises 
     WHERE exit_status NOT IN ('完全退出', '已上市')
     AND wechat_official_account_id IS NOT NULL 
     AND wechat_official_account_id != ''
     AND delete_mark = 0`
  );

  // 查询additional_wechat_accounts表中状态为"active"的数据
  const additionalAccounts = await db.query(
    `SELECT DISTINCT wechat_account_id 
     FROM additional_wechat_accounts 
     WHERE status = 'active' 
     AND wechat_account_id IS NOT NULL 
     AND wechat_account_id != ''
     AND delete_mark = 0`
  );

  // 合并两个数据源的公众号ID，并拆分逗号分隔的ID
  const enterpriseAccountIds = [];
  enterprises.forEach(e => {
    const ids = splitAccountIds(e.wechat_official_account_id);
    enterpriseAccountIds.push(...ids);
  });
  const additionalAccountIds = additionalAccounts.map(a => a.wechat_account_id);
  const allAccountIds = [...enterpriseAccountIds, ...additionalAccountIds];

  if (allAccountIds.length === 0) {
    return { 
      success: true, 
      message: '没有需要同步的公众号',
      data: { synced: 0, total: 0 }
    };
  }

  // 去重公众号ID
  const uniqueAccounts = [...new Set(allAccountIds)];
  
  let totalSynced = 0;
  const errors = [];

  // 遍历每个公众号，调用接口获取数据
  for (const account of uniqueAccounts) {
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

        // 检查返回状态
        if (response.data.code === 0 && response.data.data && Array.isArray(response.data.data)) {
          const articles = response.data.data;
          
          if (articles.length === 0) {
            hasMore = false;
            break;
          }

          // 批量插入数据
          for (const article of articles) {
            // 检查是否已存在（根据原文链接去重）
            const sourceUrl = article.sourceUrl || article.url || '';
            if (!sourceUrl) continue; // 跳过没有链接的文章

            const existing = await db.query(
              'SELECT id FROM news_detail WHERE source_url = ? AND delete_mark = 0',
              [sourceUrl]
            );

            if (existing.length === 0) {
              // 将关键词数组转换为JSON字符串
              const keywordsJson = article.keywords && Array.isArray(article.keywords) 
                ? JSON.stringify(article.keywords) 
                : null;

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
                // 获取文章中的公众号ID（可能是article.account或account）
                const wechatAccountId = article.account || account;
                console.log(`[入库] 检查公众号是否为企业公众号 - wechat_account_id: "${wechatAccountId}", account_name: "${article.name || ''}"`);
                
                // 只从invested_enterprises表中查找被投企业，且状态不为"完全退出"
                // 支持逗号分隔的多个公众号ID
                const enterpriseResult = await db.query(
                  `SELECT enterprise_full_name 
                   FROM invested_enterprises 
                   WHERE (wechat_official_account_id = ? 
                     OR wechat_official_account_id LIKE ?
                     OR wechat_official_account_id LIKE ?
                     OR wechat_official_account_id LIKE ?)
                   AND exit_status NOT IN ('完全退出', '已上市')
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
                  console.log(`[入库] ✗ 公众号 "${wechatAccountId}" 不是invested_enterprises表中的企业公众号`);
                }
                // 注意：来自additional_wechat_accounts的新闻不在此处设置enterprise_full_name
                // 它们将在AI分析时根据内容相关性来决定是否关联到被投企业
              } catch (e) {
                console.error('[入库] 匹配企业全称时出错:', e.message);
                console.error('[入库] 错误堆栈:', e.stack);
              }

              const newsId = await generateId('news_detail');
              await db.execute(
                `INSERT INTO news_detail 
                 (id, account_name, wechat_account, enterprise_full_name, source_url, title, summary, public_time, content, keywords, news_abstract, news_sentiment, APItype) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  newsId,
                  article.name || '',
                  article.account || account,
                  enterpriseFullName,
                  sourceUrl,
                  article.title || '',
                  article.summary || '',
                  publicTime,
                  article.content || '',
                  keywordsJson,
                  null, // news_abstract - 暂时为空，后续可通过AI分析填充
                  'neutral', // news_sentiment - 默认为中性，后续可通过情感分析填充
                  '新榜' // APItype - 新榜接口
                ]
              );
              totalSynced++;
            }
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
            errors.push({
              account,
              message: response.data.msg || response.data.message || '接口返回错误'
            });
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
        if (status === 404) {
          errorType = '404-公众号不存在或已失效';
          errorMessage = `公众号ID "${account}" 在新榜API中不存在、已失效或已被删除`;
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
    }
  }

  // 统计错误类型
  const errorStats = {
    '404-公众号不存在或已失效': 0,
    '401-认证失败': 0,
    '403-权限不足': 0,
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
  console.log(`[新榜同步] ========== 同步统计 ==========`);
  console.log(`[新榜同步] 配置ID: ${config.id}`);
  console.log(`[新榜同步] 接口类型: ${config.interface_type || '新榜'}`);
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
      console.log(`[新榜同步]   建议检查数据库中这些公众号ID是否正确，或联系新榜API服务商确认`);
    }
  }
  console.log(`[新榜同步] =============================`);

  // 更新日志记录
  if (logId) {
    try {
      await updateSyncLog(logId, {
        status: errors.length > 0 && totalSynced === 0 ? 'failed' : 'success',
        syncedCount: totalSynced,
        totalEnterprises: uniqueAccounts.length,
        processedEnterprises: uniqueAccounts.length,
        errorCount: errors.length,
        errorMessage: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
        executionDetails: {
          timeRange: { from, to },
          interfaceType: config.interface_type || '新榜',
          totalAccounts: uniqueAccounts.length,
          syncedCount: totalSynced,
          errorCount: errors.length
        }
      });
    } catch (logError) {
      console.error('更新同步日志失败:', logError.message);
    }
  }

  // 如果同步了新数据，触发AI分析
  if (totalSynced > 0) {
    try {
      console.log(`[新榜同步] 开始AI分析 ${totalSynced} 条新数据...`);
      const newsAnalysis = require('../utils/newsAnalysis');
      
      // 异步执行AI分析，不阻塞同步响应
      setImmediate(async () => {
        try {
          await newsAnalysis.batchAnalyzeNews(totalSynced);
          console.log(`[新榜同步] ✓ AI分析完成，已分析 ${totalSynced} 条新闻`);
        } catch (analysisError) {
          console.error(`[新榜同步] ✗ AI分析失败:`, analysisError.message);
        }
      });
    } catch (error) {
      console.warn(`[新榜同步] ✗ 启动AI分析失败:`, error.message);
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

async function syncConfigWithSchedule(config, { isManual, runDate, customRange, logId = null }) {
  const frequency = getConfigFrequency(config) || 'daily';
  const customRangeEnabled = !!(customRange && customRange.from && customRange.to);
  
  // 获取当前时间（用于计算基准日期）
  const now = runDate || new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  const localDateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const [localYear, localMonth, localDay] = localDateStr.split('/').map(Number);
  const baseRunDate = new Date(localYear, localMonth - 1, localDay, 0, 0, 0);
  
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
    toDate = new Date(baseRunDate);
    
    if (isManual) {
      // 手动触发时，始终使用前一天00:00:00到当天00:00:00，忽略last_sync_time
      // 这样可以确保手动触发时只同步昨天的数据，而不是从上次同步时间开始
      const yesterdayDate = new Date(baseRunDate);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      fromDate = new Date(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate(), 0, 0, 0);
    } else {
      // 定时任务时，查找节假日前的一个工作日到当前工作日之间的新闻
      // 这样可以确保不遗漏节假日期间的数据
      const previousWorkday = await findPreviousWorkday(baseRunDate);
      fromDate = previousWorkday;
      
      console.log(`[新闻同步] 查找节假日前的工作日:`);
      console.log(`[新闻同步] - 当前日期: ${baseRunDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      console.log(`[新闻同步] - 前一个工作日: ${previousWorkday.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
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

  const result = await executeNewsSyncForConfig(config, range, { isManual, logId });

  // 检查是否获取到数据
  const syncedCount = result.data?.synced || 0;
  
  // 拖底逻辑：如果有上一次同步时间但没有获取到数据，使用前一天00:00:00到当天00:00:00
  if (config.last_sync_time && syncedCount === 0 && !customRangeEnabled) {
    console.log(`[新闻同步] 配置 ${config.id} 使用上一次同步时间未获取到数据，启用拖底逻辑：获取前一天00:00:00到当天00:00:00的新闻`);
    
    // 使用拖底逻辑：前一天00:00:00到当天00:00:00
    const fallbackToDate = new Date(baseRunDate);
    const fallbackFromDate = startOfDay(addDays(fallbackToDate, -1));
    
    const fallbackRange = {
      from: formatDate(fallbackFromDate),
      to: formatDate(fallbackToDate)
    };
    
    console.log(`[新闻同步] 配置 ${config.id}(${config.app_name || ''}) 拖底区间 ${fallbackRange.from} -> ${fallbackRange.to}`);
    
    // 使用拖底范围重新执行同步
    const fallbackResult = await executeNewsSyncForConfig(config, fallbackRange, { isManual });
    
    // 更新同步时间
    await db.execute(
      'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
      [fallbackRange.to, formatDateOnly(fallbackToDate), config.id]
    );
    
    return {
      ...fallbackResult,
      runDate: formatDateOnly(fallbackToDate),
      usedFallback: true // 标记使用了拖底逻辑
    };
  }

  // 正常情况：更新同步时间
  await db.execute(
    'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = ? WHERE id = ?',
    [range.to, formatDateOnly(toDate), config.id]
  );

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
        // 如果是单个配置且提供了logId，使用它；否则为每个配置创建日志
        let configLogId = logId;
        if (!configLogId && configId) {
          try {
            configLogId = await createSyncLog({
              configId: config.id,
              executionType: isManual ? 'manual' : 'scheduled',
              userId: null,
              executionDetails: {
                interfaceType: config.interface_type || '新榜'
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
        console.error(`配置 ${config.id} 同步失败：`, err);
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
    console.log(`[新闻同步] ========== 总体统计 ==========`);
    console.log(`[新闻同步] 配置总数: ${totalConfigs}`);
    console.log(`[新闻同步] 成功配置: ${successConfigs}`);
    console.log(`[新闻同步] 失败配置: ${totalConfigs - successConfigs}`);
    console.log(`[新闻同步] 总同步数量: ${totalSyncedAll} 条新闻`);
    console.log(`[新闻同步] =============================`);

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
// 手动触发新闻同步接口
router.post('/sync', async (req, res) => {
  let logId = null;
  try {
    const { config_id } = req.body;
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

    // 创建日志记录
    try {
      logId = await createSyncLog({
        configId: config_id,
        executionType: 'manual',
        userId: userId,
        executionDetails: {
          interfaceType: config.interface_type || '新榜',
          requestUrl: config.request_url
        }
      });
    } catch (logError) {
      console.error('创建同步日志失败:', logError.message);
    }

    console.log(`[手动同步] ========== 开始手动同步 ==========`);
    console.log(`[手动同步] 配置ID: ${config_id}`);
    console.log(`[手动同步] 接口类型: ${config.interface_type || '新榜'}`);
    console.log(`[手动同步] 触发时间: ${formatDate(new Date())}`);
    
    // 根据接口类型选择同步函数
    const interfaceType = config.interface_type || '新榜';
    let result;
    
    if (interfaceType === '企查查') {
      console.log(`[手动同步] 执行企查查新闻同步...`);
      result = await syncQichachaNewsData(config_id, logId);
    } else {
      console.log(`[手动同步] 执行新榜新闻同步...`);
      
      // 获取当前时间（Asia/Shanghai时区）
      const now = new Date();
      console.log(`[手动同步] 服务器当前时间: ${now.toISOString()}`);
      console.log(`[手动同步] 服务器本地时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
      
      // 使用本地时区计算日期，确保基于Asia/Shanghai时区
      // 获取本地时间的年月日（基于Asia/Shanghai时区）
      const localDateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const [localYear, localMonth, localDay] = localDateStr.split('/').map(Number);
      
      // 创建本地时区的今天00:00:00
      const todayStart = new Date(localYear, localMonth - 1, localDay, 0, 0, 0);
      
      // 创建本地时区的昨天00:00:00
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      
      console.log(`[手动同步] 计算的时间范围:`);
      console.log(`[手动同步] - 昨天开始: ${formatDate(yesterdayStart)} (${yesterdayStart.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`);
      console.log(`[手动同步] - 今天开始: ${formatDate(todayStart)} (${todayStart.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`);
      
      result = await syncNewsData({
        isManual: true,
        configId: config_id,
        customRange: { from: formatDate(yesterdayStart), to: formatDate(todayStart) },
        logId: logId
      });
    }
    
    console.log(`[手动同步] ========== 同步完成 ==========`);
    console.log(`[手动同步] 结果:`, JSON.stringify({
      success: result.success,
      message: result.message,
      synced: result.data?.synced || 0,
      total: result.data?.total || 0
    }, null, 2));
    console.log(`[手动同步] =============================`);
    
    res.json({
      success: true,
      message: result.message,
      data: result.data,
      logId: logId
    });
  } catch (error) {
    console.error('同步新闻数据失败：', error);
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
    
    if (wechatAccounts.length === 0) {
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

    // 提取微信公众号ID列表，并拆分逗号分隔的ID
    const accountIds = [];
    wechatAccounts.forEach(item => {
      const ids = splitAccountIds(item.wechat_official_account_id);
      accountIds.push(...ids);
    });

    // 构建查询条件
    let condition = 'FROM news_detail WHERE wechat_account IN (';
    const params = [];
    
    // 添加微信公众号ID占位符
    const placeholders = accountIds.map(() => '?').join(',');
    condition += placeholders + ') AND delete_mark = 0';
    params.push(...accountIds);

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
        totalAccountsCount: accountIds.length,
        totalEnterprises: totalEnterprises
      }
    });
  } catch (error) {
    console.error('查询用户舆情统计失败：', error);
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
    const offset = (page - 1) * pageSize;

    // 计算时间范围
    let timeCondition = '';
    let timeParams = [];
    
    const now = new Date();
    
    if (timeRange === 'yesterday') {
      // 昨日：前一天00:00:00到23:59:59
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStart = new Date(yesterday);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);
      
      timeCondition = ' AND public_time >= ? AND public_time <= ?';
      timeParams = [yesterdayStart, yesterdayEnd];
    } else if (timeRange === 'thisWeek') {
      // 本周：本周一00:00:00到现在
      const weekStart = new Date(now);
      const dayOfWeek = weekStart.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 0是周日，需要调整
      weekStart.setDate(weekStart.getDate() - daysToMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      timeCondition = ' AND public_time >= ?';
      timeParams = [weekStart];
    } else if (timeRange === 'lastWeek') {
      // 上周：上周一00:00:00到上周日23:59:59
      // 对于企查查新闻，如果public_time为NULL，使用created_at作为替代
      const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
      const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7; // 上周一
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - daysToLastMonday);
      lastMonday.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);
      
      // 支持public_time或created_at在上周范围内（用于处理企查查新闻public_time可能为NULL的情况）
      timeCondition = ' AND ((public_time >= ? AND public_time <= ?) OR (public_time IS NULL AND created_at >= ? AND created_at <= ?))';
      timeParams = [lastMonday, lastSunday, lastMonday, lastSunday];
    } else if (timeRange === 'thisMonth') {
      // 本月：本月1日00:00:00到现在
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      monthStart.setHours(0, 0, 0, 0);
      
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
    
    if (enterprises.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        pageSize
      });
    }

    // 提取微信公众号ID列表（用于匹配新榜新闻）
    const accountIds = enterprises
      .filter(item => item.wechat_official_account_id && item.wechat_official_account_id !== '')
      .map(item => item.wechat_official_account_id);
    
    // 提取企业全称列表（用于匹配企查查新闻）
    const enterpriseNames = enterprises
      .filter(item => item.enterprise_full_name && item.enterprise_full_name !== '')
      .map(item => item.enterprise_full_name);

    // 构建查询条件：支持新榜（通过wechat_account）和企查查（通过enterprise_full_name）
    let condition = 'FROM news_detail WHERE delete_mark = 0 AND (';
    const params = [];
    const conditions = [];
    
    // 新榜新闻：通过wechat_account匹配
    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      conditions.push(`wechat_account IN (${placeholders})`);
      params.push(...accountIds);
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

    // 添加搜索条件
    if (search) {
      condition += ' AND (title LIKE ? OR account_name LIKE ? OR wechat_account LIKE ? OR enterprise_full_name LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // 查询数据（按发布时间降序）
    const data = await db.query(
      `SELECT account_name, wechat_account, enterprise_full_name, public_time, title, source_url, keywords 
       ${condition} 
       ORDER BY public_time DESC, created_at DESC 
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
        public_time: item.public_time || '',
        title: item.title || '',
        source_url: item.source_url || '',
        keywords: keywords
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
      
      if (wechatAccounts.length === 0) {
        return res.json({
          success: true,
          data: [],
          total: 0,
          page,
          pageSize
        });
      }

      // 提取微信公众号ID列表，并拆分逗号分隔的ID
      const accountIds = [];
      wechatAccounts.forEach(item => {
        const ids = splitAccountIds(item.wechat_official_account_id);
        accountIds.push(...ids);
      });

      // 构建查询条件
      let condition = 'FROM news_detail WHERE wechat_account IN (';
      const params = [];
      
      // 添加微信公众号ID占位符
      const placeholders = accountIds.map(() => '?').join(',');
      condition += placeholders + ') AND delete_mark = 0';
      params.push(...accountIds);

      // 添加搜索条件
      if (search) {
        condition += ' AND (title LIKE ? OR account_name LIKE ? OR wechat_account LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      // 查询数据（按发布时间降序）
      const data = await db.query(
        `SELECT account_name, wechat_account, public_time, title, source_url, keywords 
         ${condition} 
         ORDER BY public_time DESC, created_at DESC 
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
          public_time: item.public_time || '',
          title: item.title || '',
          source_url: item.source_url || '',
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
    const { page = 1, pageSize = 10, search, account, timeRange = 'all' } = req.query;
    const offset = (page - 1) * pageSize;

    let condition = 'FROM news_detail WHERE delete_mark = 0';
    const params = [];

    // 添加时间范围条件（管理员也支持时间筛选）
    const now = new Date();
    
    if (timeRange === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStart = new Date(yesterday);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);
      
      condition += ' AND public_time >= ? AND public_time <= ?';
      params.push(yesterdayStart, yesterdayEnd);
    } else if (timeRange === 'thisWeek') {
      const weekStart = new Date(now);
      const dayOfWeek = weekStart.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      weekStart.setDate(weekStart.getDate() - daysToMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      condition += ' AND public_time >= ?';
      params.push(weekStart);
    } else if (timeRange === 'lastWeek') {
      // 上周：上周一00:00:00到上周日23:59:59
      // 对于企查查新闻，如果public_time为NULL，使用created_at作为替代
      const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
      const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7; // 上周一
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - daysToLastMonday);
      lastMonday.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);
      
      // 支持public_time或created_at在上周范围内（用于处理企查查新闻public_time可能为NULL的情况）
      condition += ' AND ((public_time >= ? AND public_time <= ?) OR (public_time IS NULL AND created_at >= ? AND created_at <= ?))';
      params.push(lastMonday, lastSunday, lastMonday, lastSunday);
    } else if (timeRange === 'thisMonth') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      monthStart.setHours(0, 0, 0, 0);
      
      condition += ' AND public_time >= ?';
      params.push(monthStart);
    }

    if (search) {
      condition += ' AND (title LIKE ? OR account_name LIKE ? OR wechat_account LIKE ? OR enterprise_full_name LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (account) {
      condition += ' AND wechat_account = ?';
      params.push(account);
    }

    const data = await db.query(
      `SELECT * ${condition} ORDER BY public_time DESC, created_at DESC LIMIT ? OFFSET ?`,
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

    // 计算时间范围
    let timeCondition = '';
    let timeParams = [];
    let fileNameSuffix = '';
    
    const now = new Date();
    
    // 如果是全部舆情tab且指定了导出时间范围
    if (timeRange === 'all' && exportTimeRange) {
      if (exportTimeRange === 'thisWeek') {
        const weekStart = new Date(now);
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [weekStart];
        
        const weekEnd = new Date(now);
        fileNameSuffix = `${formatDateForFileName(weekStart)}-${formatDateForFileName(weekEnd)}舆情信息`;
      } else if (exportTimeRange === 'thisMonth') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [monthStart];
        fileNameSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月舆情信息`;
      } else if (exportTimeRange === 'lastMonth') {
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        lastMonthStart.setHours(0, 0, 0, 0);
        lastMonthEnd.setHours(23, 59, 59, 999);
        
        timeCondition = ' AND public_time >= ? AND public_time <= ?';
        timeParams = [lastMonthStart, lastMonthEnd];
        fileNameSuffix = `${lastMonthStart.getFullYear()}年${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}月舆情信息`;
      } else if (exportTimeRange === 'all') {
        fileNameSuffix = '全部舆情信息';
      }
    } else {
      // 使用当前tab的时间范围
      if (timeRange === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStart = new Date(yesterday);
        yesterdayStart.setHours(0, 0, 0, 0);
        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999);
        
        timeCondition = ' AND public_time >= ? AND public_time <= ?';
        timeParams = [yesterdayStart, yesterdayEnd];
        fileNameSuffix = `${formatDateForFileName(yesterday)}舆情信息`;
      } else if (timeRange === 'thisWeek') {
        const weekStart = new Date(now);
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [weekStart];
        
        const weekEnd = new Date(now);
        fileNameSuffix = `${formatDateForFileName(weekStart)}-${formatDateForFileName(weekEnd)}舆情信息`;
      } else if (timeRange === 'lastWeek') {
        // 上周：上周一00:00:00到上周日23:59:59
        const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
        const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7; // 上周一
        const lastMonday = new Date(now);
        lastMonday.setDate(now.getDate() - daysToLastMonday);
        lastMonday.setHours(0, 0, 0, 0);
        
        const lastSunday = new Date(lastMonday);
        lastSunday.setDate(lastMonday.getDate() + 6);
        lastSunday.setHours(23, 59, 59, 999);
        
        timeCondition = ' AND public_time >= ? AND public_time <= ?';
        timeParams = [lastMonday, lastSunday];
        fileNameSuffix = `${formatDateForFileName(lastMonday)}-${formatDateForFileName(lastSunday)}舆情信息`;
      } else if (timeRange === 'thisMonth') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        
        timeCondition = ' AND public_time >= ?';
        timeParams = [monthStart];
        fileNameSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月舆情信息`;
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
      // 普通用户只能导出自己相关的数据
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
      
      if (wechatAccounts.length === 0) {
        return res.json({
          success: false,
          message: '没有可导出的数据'
        });
      }

      // 提取微信公众号ID列表，并拆分逗号分隔的ID
      const accountIds = [];
      wechatAccounts.forEach(item => {
        const ids = splitAccountIds(item.wechat_official_account_id);
        accountIds.push(...ids);
      });
      const placeholders = accountIds.map(() => '?').join(',');
      
      condition = `FROM news_detail WHERE wechat_account IN (${placeholders}) AND delete_mark = 0`;
      params = [...accountIds];
      
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
               rm.send_frequency, rm.send_time, rm.is_active, rm.created_at, rm.updated_at,
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
               rm.send_frequency, rm.send_time, rm.is_active, rm.created_at, rm.updated_at,
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

    res.json({
      success: true,
      data: recipients || [],
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
               rm.send_frequency, rm.send_time, rm.is_active, rm.created_at, rm.updated_at,
               rm.is_deleted, rm.deleted_at, rm.deleted_by, u2.account as deleted_by_account
        FROM recipient_management rm
        LEFT JOIN users u ON rm.user_id = u.id
        LEFT JOIN users u2 ON rm.deleted_by = u2.id
        WHERE rm.id = ? AND rm.is_deleted = 0
      `;
    } else {
      query = `
        SELECT rm.id, rm.user_id, rm.recipient_email, rm.email_subject, 
               rm.send_frequency, rm.send_time, rm.is_active, rm.created_at, rm.updated_at,
               rm.is_deleted, rm.deleted_at, rm.deleted_by
        FROM recipient_management rm
        WHERE rm.id = ? AND rm.user_id = ? AND rm.is_deleted = 0
      `;
    }

    const recipients = userRole === 'admin' 
      ? await db.query(query, [id])
      : await db.query(query, [id, userId]);

    if (recipients.length > 0) {
      res.json({ success: true, data: recipients[0] });
    } else {
      res.status(404).json({ success: false, message: '记录不存在' });
    }
  } catch (error) {
    console.error('获取收件管理信息失败：', error);
    res.status(500).json({ success: false, message: '获取信息失败' });
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
  body('send_frequency').isIn(['daily', 'weekly', 'monthly']).withMessage('发送频率必须是daily、weekly或monthly'),
  body('send_time').matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).withMessage('发送时间格式不正确，应为HH:mm:ss'),
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

    const { recipient_email, email_subject, send_frequency, send_time, is_active } = req.body;
    
    // 验证多个邮箱格式
    const emailValidation = validateMultipleEmails(recipient_email);
    if (!emailValidation.valid) {
      return res.status(400).json({ success: false, message: emailValidation.message });
    }

    const recipientId = await generateId('recipient_management');
    const newData = {
      user_id: userId,
      recipient_email: emailValidation.emails,
      email_subject: email_subject || '',
      send_frequency: send_frequency,
      send_time: send_time || '09:00:00',
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1
    };
    
    await db.execute(
      `INSERT INTO recipient_management 
       (id, user_id, recipient_email, email_subject, send_frequency, send_time, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        recipientId,
        newData.user_id,
        newData.recipient_email,
        newData.email_subject,
        newData.send_frequency,
        newData.send_time,
        newData.is_active
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
  body('recipient_email').optional().isEmail().withMessage('收件人邮箱格式不正确'),
  body('email_subject').optional(),
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
    const { recipient_email, email_subject, send_frequency, send_time, is_active } = req.body;

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
      send_frequency: existing[0].send_frequency,
      send_time: existing[0].send_time || '',
      is_active: existing[0].is_active
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

    if (updateFields.length > 0) {
      updateValues.push(id);
      await db.execute(
        `UPDATE recipient_management SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      // 构建新数据用于日志
      const newData = { ...oldData };
      if (recipient_email !== undefined) newData.recipient_email = validatedEmail;
      if (email_subject !== undefined) newData.email_subject = email_subject;
      if (send_frequency !== undefined) newData.send_frequency = send_frequency;
      if (send_time !== undefined) newData.send_time = send_time;
      if (is_active !== undefined) newData.is_active = is_active ? 1 : 0;

      // 记录更新日志
      await logRecipientChange(id, oldData, newData, userId);
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
    
    // 获取用户可见的昨日舆情信息
    const newsList = await getUserVisibleYesterdayNews(recipient.user_id);
    
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
async function syncQichachaNewsData(configId = null) {
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
    console.log(`企查查接口频次类型: ${config.frequency_type || 'week'}`);

    // 根据frequency_type和weekday计算时间范围
    let startDate, endDate;
    const now = new Date();
    const frequencyType = config.frequency_type || 'week'; // 默认按周执行
    const sendFrequency = config.send_frequency || 'weekly';
    const weekday = config.weekday || config.week_day || null;
    
    // 星期映射：monday=1, tuesday=2, ..., sunday=0
    const weekdayMap = {
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6,
      'sunday': 0
    };
    
    // 如果是每周执行且有weekday配置，使用新的周期逻辑
    if (frequencyType === 'week' && sendFrequency === 'weekly' && weekday && weekdayMap[weekday] !== undefined) {
      const targetWeekday = weekdayMap[weekday];
      const currentDay = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
      
      if (targetWeekday === 4) {
        // 周四执行：取数周期从本周一00:00:00到本周四00:00:00
        const daysToMonday = currentDay === 0 ? 6 : currentDay - 1; // 到本周一的天数
        const thisMonday = new Date(now);
        thisMonday.setDate(now.getDate() - daysToMonday);
        thisMonday.setHours(0, 0, 0, 0);
        
        const thisThursday = new Date(thisMonday);
        thisThursday.setDate(thisMonday.getDate() + 3); // 周一+3天=周四
        thisThursday.setHours(0, 0, 0, 0);
        
        startDate = thisMonday.toISOString().slice(0, 10);
        endDate = thisThursday.toISOString().slice(0, 10);
      } else if (targetWeekday === 1) {
        // 周一执行：取数周期从上周四00:00:00到本周一00:00:00
        const daysToMonday = currentDay === 0 ? 6 : currentDay - 1; // 到本周一的天数
        const thisMonday = new Date(now);
        thisMonday.setDate(now.getDate() - daysToMonday);
        thisMonday.setHours(0, 0, 0, 0);
        
        const lastThursday = new Date(thisMonday);
        lastThursday.setDate(thisMonday.getDate() - 4); // 本周一-4天=上周四
        lastThursday.setHours(0, 0, 0, 0);
        
        startDate = lastThursday.toISOString().slice(0, 10);
        endDate = thisMonday.toISOString().slice(0, 10);
      } else {
        // 其他星期几：默认使用上周一至上周日
        const daysToLastMonday = currentDay === 0 ? 6 : currentDay - 1 + 7;
        const lastMonday = new Date(now);
        lastMonday.setDate(now.getDate() - daysToLastMonday);
        lastMonday.setHours(0, 0, 0, 0);
        
        const lastSunday = new Date(lastMonday);
        lastSunday.setDate(lastMonday.getDate() + 6);
        lastSunday.setHours(23, 59, 59, 999);
        
        startDate = lastMonday.toISOString().slice(0, 10);
        endDate = lastSunday.toISOString().slice(0, 10);
      }
    } else if (frequencyType === 'week') {
      // 按周执行（无weekday配置）：计算上周周一和周日日期
      const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
      const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7; // 上周一
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - daysToLastMonday);
      lastMonday.setHours(0, 0, 0, 0);
      
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);

      startDate = lastMonday.toISOString().slice(0, 10); // YYYY-MM-DD
      endDate = lastSunday.toISOString().slice(0, 10); // YYYY-MM-DD
    } else if (frequencyType === 'day') {
      // 按天执行：计算前N天
      const days = config.frequency_value || 1;
      const fromDate = new Date(now);
      fromDate.setDate(now.getDate() - days);
      fromDate.setHours(0, 0, 0, 0);
      
      const toDate = new Date(now);
      toDate.setHours(0, 0, 0, 0);

      startDate = fromDate.toISOString().slice(0, 10);
      endDate = toDate.toISOString().slice(0, 10);
    } else {
      // 按月执行：计算上个月
      const lastMonth = new Date(now);
      lastMonth.setMonth(now.getMonth() - 1);
      lastMonth.setDate(1);
      lastMonth.setHours(0, 0, 0, 0);
      
      const lastDayOfMonth = new Date(now);
      lastDayOfMonth.setDate(0); // 上个月的最后一天
      lastDayOfMonth.setHours(23, 59, 59, 999);

      startDate = lastMonth.toISOString().slice(0, 10);
      endDate = lastDayOfMonth.toISOString().slice(0, 10);
    }

    console.log(`企查查舆情同步时间范围（${frequencyType}）：${startDate} 至 ${endDate}`);

    // 从invested_enterprises表获取统一信用代码（排除完全退出的）
    // 使用DISTINCT在SQL层面去重，确保每个统一信用代码只出现一次
    const enterprises = await db.query(
      `SELECT DISTINCT unified_credit_code 
       FROM invested_enterprises 
       WHERE exit_status NOT IN ('完全退出', '已上市')
       AND exit_status IS NOT NULL
       AND unified_credit_code IS NOT NULL 
       AND unified_credit_code != ''
       AND unified_credit_code != 'null'
       AND delete_mark = 0
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
    
    const uniqueCreditCodes = [...new Set(creditCodes)];
    
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
                  let existing = [];
                  if (sourceUrl) {
                    // 优先使用source_url去重
                    existing = await db.query(
                      'SELECT id FROM news_detail WHERE source_url = ? AND delete_mark = 0 LIMIT 1',
                      [sourceUrl]
                    );
                  } else if (title && publicTime) {
                    // 如果没有source_url，使用title和public_time组合去重
                    existing = await db.query(
                      'SELECT id FROM news_detail WHERE title = ? AND public_time = ? AND delete_mark = 0 LIMIT 1',
                      [title, publicTime]
                    );
                  }

                  if (existing.length === 0) {
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

                    // 根据统一信用代码查找对应的企业全称
                    let enterpriseFullName = null;
                    const enterpriseResult = await db.query(
                      `SELECT enterprise_full_name 
                       FROM invested_enterprises 
                       WHERE unified_credit_code = ? 
                       AND exit_status NOT IN ('完全退出', '已上市')
                       AND delete_mark = 0 
                       LIMIT 1`,
                      [creditCode]
                    );
                    if (enterpriseResult.length > 0) {
                      enterpriseFullName = enterpriseResult[0].enterprise_full_name;
                    }

                    // 将Category转换为JSON格式（如果是字符串则直接存储）
                    let keywordsValue = newsItem.Category || '';
                    if (typeof keywordsValue === 'string' && keywordsValue.trim() !== '') {
                      // 如果Category是字符串，尝试转换为JSON
                      try {
                        keywordsValue = JSON.stringify([keywordsValue]);
                      } catch (e) {
                        keywordsValue = newsItem.Category || '';
                      }
                    }

                    // 将Category编码转换为中文类别
                    // Category可能是字符串、数字或数组
                    let categoryCode = newsItem.Category || '';
                    let newsCategory = null;
                    
                    if (categoryCode) {
                      // 如果是数组，取第一个元素；如果是字符串/数字，直接转换
                      if (Array.isArray(categoryCode)) {
                        categoryCode = categoryCode.length > 0 ? categoryCode[0] : '';
                      }
                      newsCategory = convertCategoryCodeToChinese(categoryCode);
                    }

                    // 插入新闻数据
                    await db.execute(
                      `INSERT INTO news_detail 
                       (id, account_name, wechat_account, enterprise_full_name, source_url, title, summary, public_time, content, keywords, news_sentiment, APItype, news_category) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        newsId,
                        newsItem.Source || '企查查',
                        newsItem.Source || '企查查',
                        enterpriseFullName,
                        newsItem.Url || '',
                        newsItem.Title || '',
                        newsItem.NewsTags || '',
                        publicTime,
                        newsItem.Content || '',
                        keywordsValue,
                        newsSentiment,
                        '企查查', // APItype - 企查查接口
                        newsCategory // 新闻类别（中文）
                      ]
                    );

                    totalSynced++;
                  }
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
          }

          // 避免请求过快，添加延迟（每个企业查询后延迟）
          await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`同步企查查舆情数据失败 (${creditCode}):`, error.message);
        errors.push(`同步失败 (${creditCode}): ${error.message}`);
      }
    }

    // 更新最后同步时间
    if (configId || config.id) {
      await db.execute(
        'UPDATE news_interface_config SET last_sync_time = NOW(), last_sync_date = CURDATE() WHERE id = ?',
        [configId || config.id]
      );
    }

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

    // 如果同步了新数据，触发AI分析
    if (totalSynced > 0) {
      try {
        console.log(`[企查查同步] 开始AI分析 ${totalSynced} 条新数据...`);
        const newsAnalysis = require('../utils/newsAnalysis');
        
        // 异步执行AI分析，不阻塞同步响应
        setImmediate(async () => {
          try {
            await newsAnalysis.batchAnalyzeNews(totalSynced);
            console.log(`[企查查同步] ✓ AI分析完成，已分析 ${totalSynced} 条新闻`);
          } catch (analysisError) {
            console.error(`[企查查同步] ✗ AI分析失败:`, analysisError.message);
          }
        });
      } catch (error) {
        console.warn(`[企查查同步] ✗ 启动AI分析失败:`, error.message);
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

module.exports = router;
// 导出同步函数供定时任务使用
router.syncNewsData = syncNewsData;
router.syncQichachaNewsData = syncQichachaNewsData;
router.createSyncLog = createSyncLog;
router.updateSyncLog = updateSyncLog;

