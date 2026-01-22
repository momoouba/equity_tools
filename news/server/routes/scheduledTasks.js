const express = require('express');
const db = require('../db');
const { updateScheduledTasks, executeEmailTask } = require('../utils/scheduledEmailTasks');
const { updateNewsSyncScheduledTasks } = require('../utils/scheduledNewsSyncTasks');
const { generateId } = require('../utils/idGenerator');
const { initializeScheduledTask: initializeNewsReanalysisTask } = require('../utils/scheduledNewsReanalysisTasks');
const cron = require('node-cron');
const { logWithTag, errorWithTag } = require('../utils/logUtils');

const router = express.Router();

// 权限检查中间件
const checkAdminPermission = (req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'user';
  const userId = req.headers['x-user-id'] || null;

  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  if (userRole !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }

  req.currentUserId = userId;
  next();
};

// 计算下次执行时间
function calculateNextExecutionTime(sendFrequency, sendTime, weekday = null, monthDay = null) {
  const now = new Date();
  const [hours, minutes] = sendTime.split(':');
  
  const nextExecution = new Date();
  nextExecution.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  
  // 星期映射：星期一=1, 星期二=2, ..., 星期日=0
  const weekdayMap = {
    '星期一': 1,
    '星期二': 2,
    '星期三': 3,
    '星期四': 4,
    '星期五': 5,
    '星期六': 6,
    '星期日': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6,
    'Sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6,
    'sunday': 0
  };
  
  switch (sendFrequency) {
    case 'daily':
      // 如果今天的时间已过，则明天执行
      if (nextExecution <= now) {
        nextExecution.setDate(nextExecution.getDate() + 1);
      }
      break;
    case 'weekly':
      if (weekday && weekdayMap[weekday] !== undefined) {
        // 根据配置的星期几计算
        const targetDay = weekdayMap[weekday];
        const currentDay = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
        
        let daysUntilTarget = targetDay - currentDay;
        
        // 如果目标星期几已经过了，或者今天就是目标星期几但时间已过，则计算下周
        if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextExecution <= now)) {
          daysUntilTarget += 7;
        }
        
        nextExecution.setDate(now.getDate() + daysUntilTarget);
        nextExecution.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      } else {
        // 如果没有配置weekday，默认下周一执行（保持向后兼容）
        const dayOfWeek = now.getDay();
        const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
        nextExecution.setDate(now.getDate() + daysUntilMonday);
        nextExecution.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      }
      break;
    case 'monthly':
      if (monthDay) {
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const currentDate = now.getDate();
        
        let targetDate;
        
        // 处理特殊值：first, last, 或数字
        if (monthDay === 'first') {
          targetDate = 1;
        } else if (monthDay === 'last') {
          // 本月最后一天
          const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
          targetDate = daysInMonth;
        } else {
          // 数字日期
          targetDate = parseInt(monthDay);
          if (isNaN(targetDate) || targetDate < 1 || targetDate > 31) {
            targetDate = 1; // 默认值
          }
        }
        
        // 计算本月目标日期
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const actualTargetDate = Math.min(targetDate, daysInMonth);
        
        nextExecution.setFullYear(currentYear, currentMonth, actualTargetDate);
        nextExecution.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        // 如果目标日期已过，或者今天就是目标日期但时间已过，则计算下个月
        if (nextExecution <= now) {
          nextExecution.setMonth(currentMonth + 1);
          const nextMonthDays = new Date(currentYear, currentMonth + 2, 0).getDate();
          let nextActualTargetDate;
          if (monthDay === 'last') {
            nextActualTargetDate = nextMonthDays;
          } else {
            nextActualTargetDate = Math.min(targetDate, nextMonthDays);
          }
          nextExecution.setDate(nextActualTargetDate);
        }
      } else {
        // 如果没有配置monthDay，默认下个月1号执行（保持向后兼容）
        nextExecution.setMonth(now.getMonth() + 1);
        nextExecution.setDate(1);
        nextExecution.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      }
      break;
  }
  
  return nextExecution;
}

// ========== AI分析定时任务配置路由（必须在动态路由之前） ==========

// 获取AI分析定时任务配置
router.get('/ai-analysis-config', checkAdminPermission, async (req, res) => {
  try {
    // 从system_config表读取配置
    const configs = await db.query(
      'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)',
      ['ai_reanalysis_cron', 'ai_reanalysis_cron_expression', 'ai_reanalysis_active']
    );

    let cronExpression = '0 2 * * *'; // 默认每天凌晨2点（6字段node-cron格式，向后兼容）
    let cronExpression7Field = '0 0 2 * * ? *'; // 默认每天凌晨2点（7字段Quartz格式）
    let isActive = true; // 默认启用

    for (const config of configs) {
      if (config.config_key === 'ai_reanalysis_cron_expression') {
        // 优先使用7字段Quartz Cron表达式
        cronExpression7Field = config.config_value || '0 0 2 * * ? *';
      } else if (config.config_key === 'ai_reanalysis_cron') {
        // 向后兼容：使用旧的6字段cron表达式
        cronExpression = config.config_value || '0 2 * * *';
        // 如果没有7字段配置，将6字段转换为7字段格式
        if (!configs.find(c => c.config_key === 'ai_reanalysis_cron_expression')) {
          const parts = cronExpression.trim().split(/\s+/);
          if (parts.length === 5) {
            // 6字段：分 时 日 月 周 -> 7字段：秒 分 时 日 月 周 年
            cronExpression7Field = `0 ${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} ${parts[4]} *`;
          }
        }
      } else if (config.config_key === 'ai_reanalysis_active') {
        isActive = config.config_value === '1' || config.config_value === 'true';
      }
    }

    res.json({
      success: true,
      data: {
        cronExpression: cronExpression7Field, // 返回7字段Quartz格式
        isActive
      }
    });
  } catch (error) {
    errorWithTag('[定时任务]', '获取AI分析定时任务配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败：' + error.message });
  }
});

// 更新AI分析定时任务配置
router.put('/ai-analysis-config', checkAdminPermission, async (req, res) => {
  try {
    const { cron_expression, isActive } = req.body;

    // 验证cron_expression格式（7字段Quartz格式：秒 分 时 日 月 周 年）
    if (!cron_expression || typeof cron_expression !== 'string' || !cron_expression.trim()) {
      return res.status(400).json({ success: false, message: 'Cron表达式不能为空' });
    }

    const cronParts = cron_expression.trim().split(/\s+/);
    if (cronParts.length !== 7) {
      return res.status(400).json({ success: false, message: 'Cron表达式必须是7字段格式（秒 分 时 日 月 周 年）' });
    }

    // 将7字段Quartz Cron转换为6字段node-cron用于验证
    const [second, minute, hour, day, month, weekday, year] = cronParts;
    // 转换星期字段：Quartz (1-7) -> node-cron (0-6)
    let convertedWeekday = weekday;
    if (weekday && weekday !== '*' && weekday !== '?') {
      if (weekday.includes(',')) {
        convertedWeekday = weekday.split(',').map(w => {
          const wNum = parseInt(w.trim());
          if (wNum >= 1 && wNum <= 7) {
            return (wNum - 1).toString();
          }
          return w.trim();
        }).join(',');
      } else {
        const wNum = parseInt(weekday);
        if (wNum >= 1 && wNum <= 7) {
          convertedWeekday = (wNum - 1).toString();
        }
      }
    }
    const nodeCronExpression = `${minute} ${hour} ${day} ${month} ${convertedWeekday}`;

    // 验证6字段cron表达式
    if (!cron.validate(nodeCronExpression)) {
      return res.status(400).json({ success: false, message: '无效的Cron表达式' });
    }

    // 更新或插入配置
    for (const config of [
      { key: 'ai_reanalysis_cron_expression', value: cron_expression.trim(), desc: 'AI分析定时任务Cron表达式（7字段Quartz格式）' },
      { key: 'ai_reanalysis_active', value: isActive ? '1' : '0', desc: 'AI分析定时任务是否启用' }
    ]) {
      const existing = await db.query('SELECT id FROM system_config WHERE config_key = ?', [config.key]);
      
      if (existing.length > 0) {
        await db.execute(
          'UPDATE system_config SET config_value = ? WHERE config_key = ?',
          [config.value, config.key]
        );
      } else {
        const configId = await generateId('system_config');
        await db.execute(
          'INSERT INTO system_config (id, config_key, config_value, config_desc) VALUES (?, ?, ?, ?)',
          [configId, config.key, config.value, config.desc]
        );
      }
    }

    // 重新初始化定时任务
    try {
      const { initializeScheduledTaskFromConfig, stopScheduledTask } = require('../utils/scheduledNewsReanalysisTasks');
      if (isActive) {
        await initializeScheduledTaskFromConfig();
      } else {
        stopScheduledTask();
      }
    } catch (initError) {
      errorWithTag('[定时任务]', '重新初始化AI分析定时任务失败:', initError);
      // 即使初始化失败，也返回成功，因为配置已保存
    }

    res.json({
      success: true,
      message: 'AI分析定时任务配置更新成功'
    });
  } catch (error) {
    errorWithTag('[定时任务]', '更新AI分析定时任务配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败：' + error.message });
  }
});

// 即时执行AI分析定时任务
router.post('/ai-analysis-config/execute', checkAdminPermission, async (req, res) => {
  try {
    const { executeEmptyAbstractReanalysis } = require('../utils/scheduledNewsReanalysisTasks');
    
    logWithTag('[AI分析定时任务]', '管理员手动触发执行...');
    
    // 立即返回响应，告知前端开始处理
    res.json({
      success: true,
      message: '开始执行AI分析任务，请稍候...',
      status: 'processing'
    });

    // 异步执行任务
    setImmediate(async () => {
      try {
        const result = await executeEmptyAbstractReanalysis(50); // 每次处理50条
        logWithTag('[AI分析定时任务]', '手动执行完成:', result);
      } catch (error) {
        errorWithTag('[AI分析定时任务]', '手动执行失败:', error);
      }
    });
  } catch (error) {
    errorWithTag('[定时任务]', '执行AI分析定时任务失败：', error);
    res.status(500).json({ success: false, message: '执行失败：' + error.message });
  }
});

// ========== 其他定时任务路由 ==========

// 获取所有定时任务列表
router.get('/', checkAdminPermission, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, task_type = 'email' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    if (task_type === 'email') {
      // 获取所有收件管理配置（包括已删除的，用于显示完整信息）
      const recipients = await db.query(
        `SELECT rm.*, u.account as user_account, u.email as user_email
         FROM recipient_management rm
         LEFT JOIN users u ON rm.user_id = u.id
         WHERE rm.is_deleted = 0
         ORDER BY rm.created_at DESC
         LIMIT ? OFFSET ?`,
        [parseInt(pageSize), offset]
      );

      // 获取总数
      const [totalResult] = await db.query('SELECT COUNT(*) as total FROM recipient_management WHERE is_deleted = 0');
      const total = totalResult.total || 0;

      // 为每个配置添加定时任务信息
      const tasks = recipients.map(recipient => {
        const isActive = recipient.is_active === 1 && recipient.is_deleted === 0;
        const nextExecution = isActive ? calculateNextExecutionTime(recipient.send_frequency, recipient.send_time) : null;
        
        return {
          id: recipient.id,
          userId: recipient.user_id,
          userAccount: recipient.user_account,
          userEmail: recipient.user_email,
          recipientEmail: recipient.recipient_email,
          emailSubject: recipient.email_subject,
          sendFrequency: recipient.send_frequency,
          sendTime: recipient.send_time,
          isActive: isActive,
          isDeleted: recipient.is_deleted === 1,
          nextExecutionTime: nextExecution ? nextExecution.toISOString() : null,
          createdAt: recipient.created_at,
          updatedAt: recipient.updated_at
        };
      });

      res.json({
        success: true,
        data: tasks,
        total: total,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      });
    } else if (task_type === 'news_sync') {
      // 获取所有新闻接口配置
      const configs = await db.query(
        `SELECT nic.*, a.app_name
         FROM news_interface_config nic
         LEFT JOIN applications a ON nic.app_id = a.id
         WHERE nic.is_deleted = 0
         ORDER BY nic.created_at DESC
         LIMIT ? OFFSET ?`,
        [parseInt(pageSize), offset]
      );

      // 获取总数
      const [totalResult] = await db.query('SELECT COUNT(*) as total FROM news_interface_config WHERE is_deleted = 0');
      const total = totalResult.total || 0;

      // 为每个配置添加定时任务信息
      const tasks = await Promise.all(configs.map(async (config) => {
        const isActive = config.is_active === 1;
        
        // 如果send_frequency或send_time为空，根据frequency_type设置默认值
        let sendFrequency = config.send_frequency;
        let sendTime = config.send_time;
        
        if (!sendFrequency && config.frequency_type) {
          // 根据frequency_type设置默认的send_frequency
          if (config.frequency_type === 'week') {
            sendFrequency = 'weekly';
          } else if (config.frequency_type === 'month') {
            sendFrequency = 'monthly';
          } else {
            sendFrequency = 'daily';
          }
        }
        
        if (!sendTime) {
          sendTime = '00:00:00'; // 默认同步时间
        }
        
        const nextExecution = isActive && sendFrequency && sendTime 
          ? calculateNextExecutionTime(sendFrequency, sendTime, config.weekday || config.week_day || null, config.monthDay || config.month_day || null) 
          : null;
        
        // 优先从最新的执行日志中获取end_time作为lastSyncTime
        let lastSyncTime = config.last_sync_time;
        try {
          const latestLogs = await db.query(
            `SELECT end_time FROM news_sync_execution_log 
             WHERE config_id = ? AND end_time IS NOT NULL 
             ORDER BY end_time DESC LIMIT 1`,
            [config.id]
          );
          if (latestLogs.length > 0 && latestLogs[0].end_time) {
            lastSyncTime = latestLogs[0].end_time;
            // 如果配置表中的last_sync_time是旧的（时间部分为00:00:00），更新它
            if (config.last_sync_time && 
                (new Date(config.last_sync_time).getHours() === 0 && 
                 new Date(config.last_sync_time).getMinutes() === 0 && 
                 new Date(config.last_sync_time).getSeconds() === 0)) {
              // 异步更新配置表的last_sync_time（不阻塞响应）
              setImmediate(async () => {
                try {
                  await db.execute(
                    'UPDATE news_interface_config SET last_sync_time = ?, last_sync_date = DATE(?) WHERE id = ?',
                    [lastSyncTime, lastSyncTime, config.id]
                  );
                } catch (updateError) {
                  logWithTag('[定时任务API]', `更新配置 ${config.id} 的last_sync_time失败:`, updateError.message);
                }
              });
            }
          }
        } catch (logError) {
          logWithTag('[定时任务API]', `查询配置 ${config.id} 的执行日志失败:`, logError.message);
          // 如果查询失败，继续使用config.last_sync_time
        }
        
        return {
          id: config.id,
          appId: config.app_id,
          appName: config.app_name,
          interfaceType: config.interface_type || '新榜',
          requestUrl: config.request_url,
          sendFrequency: sendFrequency,
          sendTime: sendTime,
          isActive: isActive,
          weekday: config.weekday || config.week_day || null,
          monthDay: config.monthDay || config.month_day || null,
          retryCount: config.retry_count || 0,
          retry_count: config.retry_count || 0,
          retryInterval: config.retry_interval || 0,
          retry_interval: config.retry_interval || 0,
          nextExecutionTime: nextExecution ? nextExecution.toISOString() : null,
          lastSyncTime: lastSyncTime,
          createdAt: config.created_at,
          updatedAt: config.updated_at
        };
      }));

      res.json({
        success: true,
        data: tasks,
        total: total,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      });
    } else {
      res.status(400).json({ success: false, message: '无效的任务类型' });
    }
  } catch (error) {
    errorWithTag('[定时任务]', '获取定时任务列表失败：', error);
    res.status(500).json({ success: false, message: '获取定时任务列表失败：' + error.message });
  }
});

// 获取单个定时任务详情
router.get('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    const recipients = await db.query(
      `SELECT rm.*, u.account as user_account, u.email as user_email
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.id = ?`,
      [id]
    );

    if (recipients.length === 0) {
      return res.status(404).json({ success: false, message: '定时任务不存在' });
    }

    const recipient = recipients[0];
    const isActive = recipient.is_active === 1 && recipient.is_deleted === 0;
    const nextExecution = isActive ? calculateNextExecutionTime(recipient.send_frequency, recipient.send_time) : null;

    const task = {
      id: recipient.id,
      userId: recipient.user_id,
      userAccount: recipient.user_account,
      userEmail: recipient.user_email,
      recipientEmail: recipient.recipient_email,
      emailSubject: recipient.email_subject,
      sendFrequency: recipient.send_frequency,
      sendTime: recipient.send_time,
      isActive: isActive,
      isDeleted: recipient.is_deleted === 1,
      nextExecutionTime: nextExecution ? nextExecution.toISOString() : null,
      createdAt: recipient.created_at,
      updatedAt: recipient.updated_at
    };

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    errorWithTag('[定时任务]', '获取定时任务详情失败：', error);
    res.status(500).json({ success: false, message: '获取定时任务详情失败：' + error.message });
  }
});

// 获取定时任务的发送日志
router.get('/:id/logs', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, pageSize = 10, task_type = 'email' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    if (task_type === 'news_sync') {
      // 新闻同步日志查询
      // 检查配置是否存在
      const configs = await db.query(
        'SELECT id FROM news_interface_config WHERE id = ?',
        [id]
      );

      if (configs.length === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }

      // 获取总数
      const [totalResult] = await db.query(
        `SELECT COUNT(*) as total 
         FROM news_sync_execution_log 
         WHERE config_id = ?`,
        [id]
      );
      const total = totalResult.total || 0;

      // 获取分页数据
      const logs = await db.query(
        `SELECT id, execution_type, start_time, end_time, duration_seconds, 
                status, synced_count, total_enterprises, processed_enterprises, 
                error_count, error_message, execution_details, created_at, created_by
         FROM news_sync_execution_log 
         WHERE config_id = ?
         ORDER BY start_time DESC 
         LIMIT ? OFFSET ?`,
        [id, parseInt(pageSize), offset]
      );

      // 为每个日志获取详细记录
      for (const log of logs) {
        const detailLogs = await db.query(
          `SELECT id, interface_type, account_id, has_data, data_count, 
                  insert_success, insert_count, error_message, created_at
           FROM news_sync_detail_log 
           WHERE sync_log_id = ?
           ORDER BY created_at ASC`,
          [log.id]
        );
        log.detail_logs = detailLogs || [];
      }

      // 解析execution_details JSON字段
      const formattedLogs = logs.map(log => {
        let executionDetails = null;
        if (log.execution_details) {
          try {
            // 如果已经是对象，直接使用；如果是字符串，则解析
            if (typeof log.execution_details === 'string') {
              executionDetails = JSON.parse(log.execution_details);
            } else {
              executionDetails = log.execution_details;
            }
          } catch (e) {
            errorWithTag('[定时任务]', '解析execution_details失败:', e.message, '原始数据:', log.execution_details);
            executionDetails = null;
          }
        }
        return {
          ...log,
          execution_details: executionDetails
        };
      });

      res.json({
        success: true,
        data: formattedLogs,
        total: total,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      });
    } else {
      // 邮件发送日志查询（原有逻辑）
    // 获取收件管理配置
    const recipients = await db.query(
      'SELECT recipient_email FROM recipient_management WHERE id = ?',
      [id]
    );

    if (recipients.length === 0) {
      return res.status(404).json({ success: false, message: '定时任务不存在' });
    }

    const recipient = recipients[0];
    const recipientEmails = recipient.recipient_email
      .split(/[,;\n\r]+/)
      .map(email => email.trim())
      .filter(email => email && email.includes('@'));

    if (recipientEmails.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      });
    }

    // 获取邮件配置ID（新闻舆情应用）
    const emailConfigs = await db.query(
      `SELECT ec.id
       FROM email_config ec
       LEFT JOIN applications a ON ec.app_id = a.id
       WHERE CAST(a.app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci 
       AND ec.is_active = 1
       LIMIT 1`,
      ['新闻舆情']
    );

    if (emailConfigs.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      });
    }

    const emailConfigId = emailConfigs[0].id;

    // 构建查询条件：匹配收件人邮箱
    // 使用LIKE匹配，因为to_email可能包含多个邮箱（逗号分隔）
    const emailConditions = recipientEmails.map(() => 'to_email LIKE ?').join(' OR ');
    const queryParams = [];
    recipientEmails.forEach(email => {
      queryParams.push(`%${email}%`);
    });

    // 获取总数
    const [totalResult] = await db.query(
      `SELECT COUNT(*) as total 
       FROM email_logs 
       WHERE email_config_id = ? 
       AND (${emailConditions})`,
      [emailConfigId, ...queryParams]
    );
    const total = totalResult.total || 0;

    // 获取分页数据
    const logs = await db.query(
      `SELECT id, operation_type, from_email, to_email, subject, status, 
              error_message, created_at, created_by
       FROM email_logs 
       WHERE email_config_id = ? 
       AND (${emailConditions})
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [emailConfigId, ...queryParams, parseInt(pageSize), offset]
    );

    res.json({
      success: true,
      data: logs,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
    }
  } catch (error) {
    errorWithTag('[定时任务]', '获取定时任务日志失败：', error);
    res.status(500).json({ success: false, message: '获取定时任务日志失败：' + error.message });
  }
});

// 手动触发执行定时任务
router.post('/:id/execute', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const { task_type = 'email' } = req.body;

    console.log(`管理员手动触发执行定时任务: ${id}, 类型: ${task_type}`);
    
    if (task_type === 'email') {
      await executeEmailTask(id);
    } else if (task_type === 'news_sync') {
      // 执行新闻接口同步任务
      const newsRoutes = require('./news');
      
      // 检查接口类型
      const configs = await db.query(
        'SELECT interface_type FROM news_interface_config WHERE id = ?',
        [id]
      );
      
      if (configs.length === 0) {
        throw new Error('新闻接口配置不存在');
      }
      
      const interfaceType = configs[0].interface_type || '新榜';
      let logId = null;
      
      // 创建日志记录
      try {
        if (newsRoutes.createSyncLog) {
          logId = await newsRoutes.createSyncLog({
            configId: id,
            executionType: 'manual', // 手动触发时使用'manual'
            userId: req.headers['x-user-id'] || null, // 记录操作人
            executionDetails: {
              interfaceType: interfaceType,
              triggerType: 'manual' // 标记为手动触发
            }
          });
        }
      } catch (logError) {
        errorWithTag('[定时任务]', '创建同步日志失败:', logError.message);
      }
      
      if (interfaceType === '企查查') {
        // 企查查舆情接口同步
        if (newsRoutes.syncQichachaNewsData) {
          await newsRoutes.syncQichachaNewsData(id, logId);
        } else {
          throw new Error('企查查舆情同步功能未实现');
        }
      } else {
        if (newsRoutes.syncNewsData) {
          // 手动触发时，isManual应该为true，确保获取昨天的数据
          await newsRoutes.syncNewsData({ isManual: true, configId: id, logId: logId });
        } else {
          throw new Error('新闻同步功能未实现');
        }
      }
    } else {
      return res.status(400).json({ success: false, message: '无效的任务类型' });
    }

    res.json({
      success: true,
      message: '定时任务执行完成'
    });
  } catch (error) {
    errorWithTag('[定时任务]', '执行定时任务失败：', error);
    res.status(500).json({
      success: false,
      message: '执行定时任务失败：' + error.message
    });
  }
});

// 更新定时任务（通过更新收件管理配置或新闻接口配置）
router.put('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const { send_frequency, send_time, is_active, task_type = 'email' } = req.body;

    if (task_type === 'email') {
      // 检查收件管理配置是否存在
      const existing = await db.query(
        'SELECT * FROM recipient_management WHERE id = ?',
        [id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }

      // 构建更新字段
      const updateFields = [];
      const updateValues = [];

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

        // 更新定时任务
        await updateScheduledTasks();
      }
    } else if (task_type === 'news_sync') {
      // 检查新闻接口配置是否存在
      const existing = await db.query(
        'SELECT * FROM news_interface_config WHERE id = ?',
        [id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }

      // 构建更新字段
      const updateFields = [];
      const updateValues = [];

      if (send_frequency !== undefined) {
        updateFields.push('send_frequency = ?');
        updateValues.push(send_frequency);
        
        // 根据send_frequency自动更新frequency_type和frequency_value
        // 确保与创建时的逻辑一致
        let frequencyType = 'day';
        let frequencyValue = 1;
        
        if (send_frequency === 'weekly') {
          frequencyType = 'week';
          frequencyValue = 1;
        } else if (send_frequency === 'monthly') {
          frequencyType = 'month';
          frequencyValue = 1;
        } else {
          // daily 或其他情况
          frequencyType = 'day';
          frequencyValue = 1;
        }
        
        updateFields.push('frequency_type = ?');
        updateValues.push(frequencyType);
        updateFields.push('frequency_value = ?');
        updateValues.push(frequencyValue);
        
        logWithTag('[定时任务更新]', `同步更新frequency_type: ${frequencyType}, frequency_value: ${frequencyValue} (基于send_frequency: ${send_frequency})`);
      }
      if (send_time !== undefined) {
        updateFields.push('send_time = ?');
        updateValues.push(send_time);
      }
      if (is_active !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(is_active ? 1 : 0);
      }
      
      // 添加星期和日期字段
      const { weekday, month_day } = req.body;
      if (weekday !== undefined) {
        updateFields.push('weekday = ?');
        updateValues.push(weekday);
      }
      if (month_day !== undefined) {
        updateFields.push('month_day = ?');
        updateValues.push(month_day);
      }
      if (req.body.retry_count !== undefined) {
        updateFields.push('retry_count = ?');
        updateValues.push(parseInt(req.body.retry_count) || 0);
      }
      if (req.body.retry_interval !== undefined) {
        updateFields.push('retry_interval = ?');
        updateValues.push(parseInt(req.body.retry_interval) || 0);
      }

      if (updateFields.length > 0) {
        updateValues.push(id);
        await db.execute(
          `UPDATE news_interface_config SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );

        // 更新新闻同步定时任务
        updateNewsSyncScheduledTasks().catch(error => {
          errorWithTag('[定时任务]', '更新新闻同步定时任务失败:', error);
        });
      }
    } else {
      return res.status(400).json({ success: false, message: '无效的任务类型' });
    }

    res.json({
      success: true,
      message: '定时任务更新成功'
    });
  } catch (error) {
    errorWithTag('[定时任务]', '更新定时任务失败：', error);
    res.status(500).json({ success: false, message: '更新定时任务失败：' + error.message });
  }
});

router.delete('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const { task_type = 'email' } = req.query;

    if (task_type === 'email') {
      const existing = await db.query(
        'SELECT id FROM recipient_management WHERE id = ? AND is_deleted = 0',
        [id]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }
      const result = await db.execute(
        'UPDATE recipient_management SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
        [req.currentUserId || null, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }
      await updateScheduledTasks();
    } else if (task_type === 'news_sync') {
      const existing = await db.query(
        'SELECT id FROM news_interface_config WHERE id = ? AND is_deleted = 0',
        [id]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }
      const result = await db.execute(
        'UPDATE news_interface_config SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
        [req.currentUserId || null, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: '定时任务不存在' });
      }
    } else {
      return res.status(400).json({ success: false, message: '无效的任务类型' });
    }

    res.json({ success: true, message: '定时任务删除成功' });
  } catch (error) {
    errorWithTag('[定时任务]', '删除定时任务失败：', error);
    res.status(500).json({ success: false, message: '删除定时任务失败：' + error.message });
  }
});

module.exports = router;

