const cron = require('node-cron');
const db = require('../db');

// 存储所有定时任务的Map
const scheduledTasks = new Map();

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
 * 根据发送频率、时间和可选参数生成cron表达式
 * @param {string} sendFrequency - 发送频率: 'daily', 'weekly', 'monthly'
 * @param {string} sendTime - 发送时间，格式: 'HH:mm:ss' 或 'HH:mm'
 * @param {string|null} weekday - 星期几（仅用于weekly）: 'monday', 'tuesday', ..., 'sunday' 或中文
 * @param {string|null} monthDay - 每月几号（仅用于monthly）: '1'-'31', 'first', 'last'
 * @returns {string} cron表达式
 */
function generateCronExpressionForNewsSync(sendFrequency, sendTime, weekday = null, monthDay = null) {
  // sendTime格式: HH:mm:ss 或 HH:mm
  const timeParts = sendTime.split(':');
  const hours = timeParts[0];
  const minutes = timeParts[1] || '0';
  
  // 星期映射
  const weekdayMap = {
    '星期一': 1, 'Monday': 1, 'monday': 1,
    '星期二': 2, 'Tuesday': 2, 'tuesday': 2,
    '星期三': 3, 'Wednesday': 3, 'wednesday': 3,
    '星期四': 4, 'Thursday': 4, 'thursday': 4,
    '星期五': 5, 'Friday': 5, 'friday': 5,
    '星期六': 6, 'Saturday': 6, 'saturday': 6,
    '星期日': 0, 'Sunday': 0, 'sunday': 0
  };
  
  switch (sendFrequency) {
    case 'daily':
      // 每天在指定时间执行: 分 时 * * *
      return `${minutes} ${hours} * * *`;
      
    case 'weekly':
      // 每周在指定星期几和指定时间执行
      if (weekday && weekdayMap[weekday] !== undefined) {
        const dayOfWeek = weekdayMap[weekday];
        // 分 时 * * 星期几 (0=周日, 1=周一, ..., 6=周六)
        return `${minutes} ${hours} * * ${dayOfWeek}`;
      } else {
        // 如果没有指定weekday，默认每周一执行
        return `${minutes} ${hours} * * 1`;
      }
      
    case 'monthly':
      // 每月在指定日期和指定时间执行
      if (monthDay) {
        if (monthDay === 'first') {
          // 每月1号
          return `${minutes} ${hours} 1 * *`;
        } else if (monthDay === 'last') {
          // 每月最后一天，使用L
          return `${minutes} ${hours} L * *`;
        } else {
          // 具体日期（1-31）
          const day = parseInt(monthDay);
          if (day >= 1 && day <= 31) {
            return `${minutes} ${hours} ${day} * *`;
          }
        }
      }
      // 如果没有指定monthDay，默认每月1号执行
      return `${minutes} ${hours} 1 * *`;
      
    default:
      // 默认每天执行
      return `${minutes} ${hours} * * *`;
  }
}

/**
 * 执行新闻同步任务
 * @param {string} configId - 新闻接口配置ID
 */
async function executeNewsSyncTask(configId) {
  try {
    console.log(`[新闻同步定时任务] 开始执行新闻同步任务: 配置ID ${configId}`);
    
    // 获取新闻接口配置
    const configs = await db.query(
      'SELECT * FROM news_interface_config WHERE id = ? AND is_active = 1 AND is_deleted = 0',
      [configId]
    );
    
    if (configs.length === 0) {
      console.log(`[新闻同步定时任务] 配置 ${configId} 不存在、已删除或未启用，跳过执行`);
      return;
    }
    
    const config = configs[0];
    const interfaceType = config.interface_type || '新榜';
    
    // 导入新闻路由
    const newsRoutes = require('../routes/news');
    
    // 创建同步日志
    let logId = null;
    try {
      if (newsRoutes.createSyncLog) {
        logId = await newsRoutes.createSyncLog({
          configId: configId,
          executionType: 'scheduled', // 定时任务触发
          userId: null, // 定时任务没有用户
          executionDetails: {
            interfaceType: interfaceType,
            triggerType: 'scheduled'
          }
        });
      }
    } catch (logError) {
      console.error(`[新闻同步定时任务] 创建同步日志失败:`, logError.message);
    }
    
    // 根据接口类型执行对应的同步函数
    if (interfaceType === '企查查') {
      // 企查查舆情接口同步
      if (newsRoutes.syncQichachaNewsData) {
        await newsRoutes.syncQichachaNewsData(configId, logId);
      } else {
        throw new Error('企查查舆情同步功能未实现');
      }
    } else {
      // 新榜接口同步
      if (newsRoutes.syncNewsData) {
        await newsRoutes.syncNewsData({ 
          isManual: false, // 定时任务触发，不是手动触发
          configId: configId, 
          logId: logId 
        });
      } else {
        throw new Error('新闻同步功能未实现');
      }
    }
    
    console.log(`[新闻同步定时任务] 新闻同步任务完成: 配置ID ${configId}, 接口类型 ${interfaceType}`);
  } catch (error) {
    console.error(`[新闻同步定时任务] 执行新闻同步任务失败: 配置ID ${configId}`, error);
  }
}

/**
 * 从旧字段（send_frequency, send_time等）生成cron表达式
 * @param {Object} config - 新闻接口配置对象
 * @returns {Object|null} - { cronExpression, source } 或 null
 */
function getCronFromLegacyFields(config) {
  // 确定send_frequency和send_time
  let sendFrequency = config.send_frequency;
  let sendTime = config.send_time;
  
  // 如果send_frequency为空，根据frequency_type设置默认值
  if (!sendFrequency && config.frequency_type) {
    if (config.frequency_type === 'week') {
      sendFrequency = 'weekly';
    } else if (config.frequency_type === 'month') {
      sendFrequency = 'monthly';
    } else {
      sendFrequency = 'daily';
    }
  }
  
  // 如果send_time为空，使用默认值
  if (!sendTime) {
    sendTime = '00:00:00';
  }
  
  // 确保sendTime格式正确（至少包含HH:mm）
  if (!sendTime.includes(':')) {
    sendTime = '00:00:00';
  }
  
  if (!sendFrequency || !sendTime) {
    return null;
  }
  
  // 生成cron表达式
  const cronExpression = generateCronExpressionForNewsSync(
    sendFrequency,
    sendTime,
    config.weekday || config.week_day || null,
    config.monthDay || config.month_day || null
  );
  
  return {
    cronExpression,
    source: 'send_frequency/send_time'
  };
}

/**
 * 更新所有新闻同步定时任务（根据news_interface_config配置）
 */
async function updateNewsSyncScheduledTasks() {
  try {
    console.log('[新闻同步定时任务] 更新新闻同步定时任务...');
    
    // 停止所有现有任务
    scheduledTasks.forEach((task, configId) => {
      if (task && task.destroy) {
        task.destroy();
      }
      scheduledTasks.delete(configId);
    });
    
    // 获取所有启用的新闻接口配置
    // 查询条件：有 cron_expression 或者有 send_frequency 和 send_time
    const configs = await db.query(
      `SELECT * FROM news_interface_config 
       WHERE is_active = 1 
       AND is_deleted = 0
       AND (
         (cron_expression IS NOT NULL AND cron_expression != '')
         OR (send_frequency IS NOT NULL AND send_time IS NOT NULL)
       )`,
      []
    );
    
    console.log(`[新闻同步定时任务] 找到 ${configs.length} 个启用的新闻接口配置`);
    
    // 为每个配置创建定时任务
    for (const config of configs) {
      try {
        let cronExpression = null;
        let cronSource = '';
        
        // 优先使用 cron_expression 字段
        if (config.cron_expression && config.cron_expression.trim()) {
          // 将7字段的Quartz Cron转换为6字段的node-cron
          cronExpression = convertQuartzCronToNodeCron(config.cron_expression);
          cronSource = 'cron_expression';
          
          if (!cronExpression) {
            console.warn(`[新闻同步定时任务] 配置 ${config.id} 的 cron_expression 格式无效: ${config.cron_expression}`);
            // 如果转换失败，尝试使用旧的字段
            const fallbackResult = getCronFromLegacyFields(config);
            if (fallbackResult) {
              cronExpression = fallbackResult.cronExpression;
              cronSource = fallbackResult.source;
            }
          }
        } else {
          // 向后兼容：使用旧的 send_frequency 和 send_time
          const legacyResult = getCronFromLegacyFields(config);
          if (legacyResult) {
            cronExpression = legacyResult.cronExpression;
            cronSource = legacyResult.source;
          }
        }
        
        if (!cronExpression) {
          console.error(`[新闻同步定时任务] 配置 ${config.id} 没有有效的定时任务配置`);
          continue;
        }
        
        // 验证cron表达式
        if (!cron.validate(cronExpression)) {
          console.error(`[新闻同步定时任务] 无效的cron表达式: ${cronExpression} (配置ID: ${config.id})`);
          continue;
        }
        
        // 格式化企业类型信息
        let entityTypeDisplay = '(空)';
        if (config.entity_type) {
          try {
            let entityTypes = config.entity_type;
            if (typeof entityTypes === 'string') {
              entityTypes = JSON.parse(entityTypes);
            }
            if (Array.isArray(entityTypes) && entityTypes.length > 0) {
              entityTypeDisplay = entityTypes.join('、');
            } else if (entityTypes && !Array.isArray(entityTypes)) {
              entityTypeDisplay = String(entityTypes);
            }
          } catch (e) {
            entityTypeDisplay = String(config.entity_type);
          }
        }
        
        console.log(`[新闻同步定时任务] 为配置 ${config.id} (${config.interface_type || '新榜'}) 创建定时任务: ${cronExpression} (来源: ${cronSource})`);
        console.log(`[新闻同步定时任务]   - 原始配置: cron_expression=${config.cron_expression || '(空)'}, send_frequency=${config.send_frequency || '(空)'}, send_time=${config.send_time || '(空)'}, entity_type=${entityTypeDisplay}`);
        
        // 创建定时任务
        const task = cron.schedule(cronExpression, async () => {
          console.log(`[新闻同步定时任务] 执行配置 ${config.id} 的新闻同步任务`);
          await executeNewsSyncTask(config.id);
        }, {
          scheduled: true,
          timezone: 'Asia/Shanghai'
        });
        
        scheduledTasks.set(config.id, task);
        console.log(`[新闻同步定时任务] ✓ 配置 ${config.id} 的定时任务已创建并启动`);
      } catch (error) {
        console.error(`[新闻同步定时任务] 创建定时任务失败 (配置ID ${config.id}):`, error);
      }
    }
    
    console.log(`[新闻同步定时任务] ✓ 定时任务更新完成，共 ${scheduledTasks.size} 个任务`);
  } catch (error) {
    console.error('[新闻同步定时任务] 更新定时任务失败:', error);
  }
}

/**
 * 初始化新闻同步定时任务（服务器启动时调用）
 */
async function initializeNewsSyncScheduledTasks() {
  await updateNewsSyncScheduledTasks();
}

/**
 * 停止所有新闻同步定时任务
 */
function stopAllNewsSyncTasks() {
  scheduledTasks.forEach((task, configId) => {
    if (task && task.destroy) {
      task.destroy();
    }
  });
  scheduledTasks.clear();
  console.log('[新闻同步定时任务] 所有定时任务已停止');
}

module.exports = {
  updateNewsSyncScheduledTasks,
  initializeNewsSyncScheduledTasks,
  executeNewsSyncTask,
  stopAllNewsSyncTasks,
  generateCronExpressionForNewsSync
};

