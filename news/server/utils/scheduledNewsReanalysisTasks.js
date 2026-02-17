const cron = require('node-cron');
const db = require('../db');
const newsAnalysis = require('./newsAnalysis');

// 存储定时任务
let scheduledTask = null;

/**
 * 获取当天的开始和结束时间（Asia/Shanghai时区）
 * @returns {Object} { startTime, endTime } - 当天的开始和结束时间（Date对象）
 */
function getTodayTimeRange() {
  const now = new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  const localDateTimeStr = now.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const [datePart] = localDateTimeStr.split(' ');
  const [localYear, localMonth, localDay] = datePart.split('/').map(Number);
  
  // 当天的00:00:00
  const startTimeStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T00:00:00+08:00`;
  const startTime = new Date(startTimeStr);
  
  // 当天的23:59:59.999
  const endTimeStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T23:59:59.999+08:00`;
  const endTime = new Date(endTimeStr);
  
  return { startTime, endTime };
}

/**
 * 查询摘要为空的新闻（仅查询执行当天创建的新闻）
 * @param {number} limit - 每次处理的记录数（如果为0或负数，则不限制）
 * @returns {Promise<Array>} - 新闻列表
 */
async function getNewsWithEmptyAbstract(limit = 50) {
  try {
    // 获取当天的开始和结束时间
    const { startTime, endTime } = getTodayTimeRange();
    
    // 获取当天的日期字符串（Asia/Shanghai时区，YYYY-MM-DD格式）
    const todayDateStr = startTime.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); // 格式: YYYY-MM-DD
    
    console.log(`[空摘要重新分析定时任务] 查询当天日期: ${todayDateStr}`);
    console.log(`[空摘要重新分析定时任务] startTime (Asia/Shanghai): ${startTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`[空摘要重新分析定时任务] endTime (Asia/Shanghai): ${endTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    
    // 查询条件：
    // 1. 摘要为空或null
    // 2. 有正文内容 OR（企查查/上海国际集团且有source_url，可从链接抓取正文）
    // 3. 未被删除
    // 4. created_at在当天的00:00:00到23:59:59之间
    // 使用DATE函数确保只查询当天的数据，避免时区问题
    let query = `
      SELECT id, title, content, source_url, enterprise_full_name,
              wechat_account, account_name, APItype, news_abstract, keywords, created_at
       FROM news_detail
       WHERE (news_abstract IS NULL OR news_abstract = '')
       AND (
         (content IS NOT NULL AND content != '' AND LENGTH(content) > 20)
         OR
         (source_url IS NOT NULL AND source_url != '' 
          AND APItype IN ('企查查', 'qichacha', '上海国际集团'))
       )
       AND delete_mark = 0
       AND DATE(created_at) = DATE(?)
       ORDER BY created_at DESC
    `;
    
    // 使用当天的日期字符串（YYYY-MM-DD格式）
    const params = [todayDateStr];
    
    // 如果limit大于0，添加LIMIT子句
    if (limit > 0) {
      query += ' LIMIT ?';
      params.push(limit);
    }
    
    console.log(`[空摘要重新分析定时任务] 执行SQL查询，参数:`, params);
    
    const newsList = await db.query(query, params);
    
    console.log(`[空摘要重新分析定时任务] 查询到 ${newsList.length} 条当天创建的摘要为空的新闻`);
    
    // 如果查询结果为空，输出调试信息
    if (newsList.length === 0) {
      // 先查询当天是否有任何新闻（不限制摘要）
      const debugQuery = `SELECT COUNT(*) as total FROM news_detail WHERE DATE(created_at) = DATE(?) AND delete_mark = 0`;
      const debugResult = await db.query(debugQuery, [todayDateStr]);
      console.log(`[空摘要重新分析定时任务] 调试信息: 当天共有 ${debugResult[0]?.total || 0} 条新闻（不限制摘要）`);
      
      // 再查询当天摘要为空的新闻数量（不限制其他条件）
      const debugQuery2 = `SELECT COUNT(*) as total FROM news_detail WHERE DATE(created_at) = DATE(?) AND (news_abstract IS NULL OR news_abstract = '') AND delete_mark = 0`;
      const debugResult2 = await db.query(debugQuery2, [todayDateStr]);
      console.log(`[空摘要重新分析定时任务] 调试信息: 当天共有 ${debugResult2[0]?.total || 0} 条摘要为空的新闻（不限制内容长度）`);
    }
    
    return newsList;
  } catch (error) {
    console.error('[空摘要重新分析定时任务] 查询空摘要新闻失败:', error);
    throw error;
  }
}

/**
 * 执行空摘要新闻的重新分析
 * @param {number} batchSize - 每批处理的记录数
 */
async function executeEmptyAbstractReanalysis(batchSize = 50) {
  try {
    console.log(`\n========== [空摘要重新分析定时任务] 开始执行 ==========`);
    const startTime = new Date();

    // 查询需要分析的新闻
    const newsList = await getNewsWithEmptyAbstract(batchSize);
    
    if (newsList.length === 0) {
      console.log('[空摘要重新分析定时任务] 没有找到当天创建的摘要为空的新闻');
      return {
        total: 0,
        processed: 0,
        successCount: 0,
        errorCount: 0
      };
    }

    console.log(`[空摘要重新分析定时任务] 找到 ${newsList.length} 条当天创建的摘要为空的新闻，开始重新分析...`);

    // 确保新闻分析模块已初始化（加载AI配置）
    try {
      await newsAnalysis.getActiveAIConfig();
    } catch (configError) {
      console.error(`[空摘要重新分析定时任务] 获取AI配置失败: ${configError.message}`);
      throw new Error(`无法获取AI配置: ${configError.message}`);
    }

    let successCount = 0;
    let errorCount = 0;
    const processedNews = [];

    // 分批处理新闻
    for (let i = 0; i < newsList.length; i++) {
      const news = newsList[i];
      try {
        console.log(`[空摘要重新分析定时任务] 处理第 ${i + 1}/${newsList.length} 条: ID=${news.id}, 标题=${news.title?.substring(0, 50)}`);

        // 检查是否是额外公众号
        let isAdditionalAccount = false;
        if (news.wechat_account) {
          try {
            const additionalResult = await db.query(
              `SELECT id FROM additional_wechat_accounts 
               WHERE wechat_account_id = ? 
               AND status = 'active' 
               AND delete_mark = 0`,
              [news.wechat_account]
            );
            isAdditionalAccount = additionalResult.length > 0;
          } catch (err) {
            console.warn(`[空摘要重新分析定时任务] 检查额外公众号失败: ${err.message}`);
          }
        }

        // 不再跳过乱码：乱码时 processNews* 内会通过 ensureNewsContent 从 source_url 重新抓取正文
        const interfaceType = news.APItype || '新榜';

        // 如果有企业全称，使用 processNewsWithEnterprise
        // 如果没有企业全称，使用 processNewsWithoutEnterprise
        let analysisResult;
        if (news.enterprise_full_name) {
          analysisResult = await newsAnalysis.processNewsWithEnterprise({
            id: news.id,
            title: news.title || '',
            content: news.content || '',
            source_url: news.source_url || '',
            enterprise_full_name: news.enterprise_full_name,
            wechat_account: news.wechat_account || '',
            account_name: news.account_name || '',
            APItype: interfaceType
          });
        } else {
          analysisResult = await newsAnalysis.processNewsWithoutEnterprise({
            id: news.id,
            title: news.title || '',
            content: news.content || '',
            source_url: news.source_url || '',
            wechat_account: news.wechat_account || '',
            account_name: news.account_name || '',
            APItype: interfaceType
          }, isAdditionalAccount);
        }

        // 检查分析结果是否成功
        if (analysisResult && analysisResult.success) {
          // 验证分析结果中是否有摘要
          const updatedNews = await db.query(
            'SELECT news_abstract FROM news_detail WHERE id = ?',
            [news.id]
          );

          if (updatedNews.length > 0 && updatedNews[0].news_abstract) {
            console.log(`[空摘要重新分析定时任务] ✓ 新闻 ${news.id} 分析成功，已生成摘要`);
            successCount++;
            processedNews.push({
              id: news.id,
              title: news.title,
              status: 'success'
            });
          } else {
            console.log(`[空摘要重新分析定时任务] ⚠️ 新闻 ${news.id} 分析完成但摘要仍为空`);
            errorCount++;
            processedNews.push({
              id: news.id,
              title: news.title,
              status: 'warning'
            });
          }
        } else {
          console.error(`[空摘要重新分析定时任务] ✗ 新闻 ${news.id} 分析失败`);
          errorCount++;
          processedNews.push({
            id: news.id,
            title: news.title,
            status: 'error'
          });
        }

        // 添加延迟，避免API调用过于频繁
        if (i < newsList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 延迟1秒
        }

      } catch (error) {
        console.error(`[空摘要重新分析定时任务] ✗ 处理新闻 ${news.id} 时出错:`, error.message);
        errorCount++;
        processedNews.push({
          id: news.id,
          title: news.title,
          status: 'error',
          error: error.message
        });
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n========== [空摘要重新分析定时任务] 执行完成 ==========`);
    console.log(`[空摘要重新分析定时任务] 总计: ${newsList.length} 条`);
    console.log(`[空摘要重新分析定时任务] 成功: ${successCount} 条`);
    console.log(`[空摘要重新分析定时任务] 失败: ${errorCount} 条`);
    console.log(`[空摘要重新分析定时任务] 耗时: ${duration} 秒`);

    return {
      total: newsList.length,
      processed: newsList.length,
      successCount,
      errorCount,
      duration: parseFloat(duration),
      processedNews: processedNews.slice(0, 20) // 只返回前20条详情
    };

  } catch (error) {
    console.error('[空摘要重新分析定时任务] 执行失败:', error);
    throw error;
  }
}

/**
 * 将7字段的Quartz Cron表达式转换为6字段的node-cron表达式
 * Quartz格式: 秒 分 时 日 月 周 年
 * node-cron格式: 分 时 日 月 周
 * Quartz周: 1=Sunday, 2=Monday, ..., 7=Saturday
 * node-cron周: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
function convertQuartzCronToNodeCron(quartzCron) {
  if (!quartzCron || typeof quartzCron !== 'string') {
    return null;
  }
  
  const parts = quartzCron.trim().split(/\s+/);
  
  // 如果是6字段，直接返回
  if (parts.length === 6) {
    return quartzCron.trim();
  }
  
  // 如果是7字段，转换为6字段
  if (parts.length === 7) {
    // 提取: 秒 分 时 日 月 周 年 -> 分 时 日 月 周
    const [second, minute, hour, day, month, weekday, year] = parts;
    
    // 转换日期字段：将 ? 转换为 *（node-cron不支持?）
    let convertedDay = day === '?' ? '*' : day;
    
    // 转换星期字段：Quartz (1-7) -> node-cron (0-6)
    // 同时将 ? 转换为 *（node-cron不支持?）
    let convertedWeekday = weekday;
    if (weekday === '?') {
      convertedWeekday = '*';
    } else if (weekday && weekday !== '*') {
      // 处理逗号分隔的值，如 "2,3,4,5,6"
      if (weekday.includes(',')) {
        convertedWeekday = weekday.split(',').map(w => {
          const wNum = parseInt(w.trim());
          if (wNum >= 1 && wNum <= 7) {
            // Quartz: 1=Sunday -> node-cron: 0=Sunday
            // Quartz: 2=Monday -> node-cron: 1=Monday
            return (wNum - 1).toString();
          }
          return w.trim();
        }).join(',');
      } else {
        // 单个值
        const wNum = parseInt(weekday);
        if (wNum >= 1 && wNum <= 7) {
          convertedWeekday = (wNum - 1).toString();
        }
      }
    }
    
    // 构建6字段cron表达式: 分 时 日 月 周
    return `${minute} ${hour} ${convertedDay} ${month} ${convertedWeekday}`;
  }
  
  return null;
}

/**
 * 初始化定时任务（从数据库读取配置）
 */
async function initializeScheduledTaskFromConfig() {
  try {
    const db = require('../db');
    
    // 从system_config表读取配置
    const configs = await db.query(
      'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)',
      ['ai_reanalysis_cron', 'ai_reanalysis_cron_expression', 'ai_reanalysis_active']
    );

    let cronExpression = '0 2 * * *'; // 默认每天凌晨2点（6字段node-cron格式，向后兼容）
    let cronExpression7Field = null; // 7字段Quartz格式
    let isActive = true; // 默认启用

    for (const config of configs) {
      if (config.config_key === 'ai_reanalysis_cron_expression') {
        // 优先使用7字段Quartz Cron表达式
        cronExpression7Field = config.config_value;
      } else if (config.config_key === 'ai_reanalysis_cron') {
        // 向后兼容：使用旧的6字段cron表达式
        cronExpression = config.config_value || '0 2 * * *';
      } else if (config.config_key === 'ai_reanalysis_active') {
        isActive = config.config_value === '1' || config.config_value === 'true';
      }
    }

    // 如果存在7字段配置，转换为6字段
    if (cronExpression7Field) {
      const converted = convertQuartzCronToNodeCron(cronExpression7Field);
      if (converted) {
        cronExpression = converted;
        console.log(`[空摘要重新分析定时任务] 使用7字段Cron表达式: ${cronExpression7Field} -> 转换为6字段: ${cronExpression}`);
      } else {
        console.warn(`[空摘要重新分析定时任务] 7字段Cron表达式格式无效: ${cronExpression7Field}，使用默认值`);
      }
    }

    if (isActive) {
      initializeScheduledTask(cronExpression);
    } else {
      console.log('[空摘要重新分析定时任务] 配置为禁用状态，不启动定时任务');
    }
  } catch (error) {
    console.error('[空摘要重新分析定时任务] 从配置初始化失败:', error);
    // 如果读取配置失败，使用默认配置
    initializeScheduledTask('0 2 * * *');
  }
}

/**
 * 初始化定时任务
 * @param {string} cronExpression - Cron表达式，默认为每天凌晨2点执行
 */
function initializeScheduledTask(cronExpression = '0 2 * * *') {
  try {
    // 如果已有任务，先停止
    if (scheduledTask) {
      scheduledTask.destroy();
      scheduledTask = null;
    }

    // 验证cron表达式
    if (!cron.validate(cronExpression)) {
      console.error(`[空摘要重新分析定时任务] 无效的cron表达式: ${cronExpression}`);
      return;
    }

    // 解析cron表达式为可读的时间描述
    let timeDesc = '';
    try {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length >= 2 && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
        const hours = parseInt(parts[1]);
        const minutes = parseInt(parts[0]);
        timeDesc = `每天${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      } else {
        timeDesc = cronExpression;
      }
    } catch (e) {
      timeDesc = cronExpression;
    }

    console.log(`[空摘要重新分析定时任务] 创建定时任务，Cron表达式: ${cronExpression} (${timeDesc})`);

    // 创建定时任务
    scheduledTask = cron.schedule(cronExpression, async () => {
      try {
        console.log(`[空摘要重新分析定时任务] 定时任务触发，开始执行...`);
        await executeEmptyAbstractReanalysis(50); // 每次处理50条
      } catch (error) {
        console.error('[空摘要重新分析定时任务] 定时任务执行失败:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    console.log('[空摘要重新分析定时任务] ✓ 定时任务已创建并启动');

  } catch (error) {
    console.error('[空摘要重新分析定时任务] 初始化定时任务失败:', error);
    throw error;
  }
}

/**
 * 停止定时任务
 */
function stopScheduledTask() {
  if (scheduledTask) {
    scheduledTask.destroy();
    scheduledTask = null;
    console.log('[空摘要重新分析定时任务] 定时任务已停止');
  }
}

module.exports = {
  initializeScheduledTask,
  initializeScheduledTaskFromConfig,
  stopScheduledTask,
  executeEmptyAbstractReanalysis,
  getNewsWithEmptyAbstract
};

