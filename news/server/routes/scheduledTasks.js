const express = require('express');
const db = require('../db');
const { updateScheduledTasks, executeEmailTask } = require('../utils/scheduledEmailTasks');

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
      const tasks = configs.map(config => {
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
          nextExecutionTime: nextExecution ? nextExecution.toISOString() : null,
          lastSyncTime: config.last_sync_time,
          createdAt: config.created_at,
          updatedAt: config.updated_at
        };
      });

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
    console.error('获取定时任务列表失败：', error);
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
    console.error('获取定时任务详情失败：', error);
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
            console.error('解析execution_details失败:', e.message, '原始数据:', log.execution_details);
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
    console.error('获取定时任务日志失败：', error);
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
        console.error('创建同步日志失败:', logError.message);
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
    console.error('执行定时任务失败：', error);
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

      if (updateFields.length > 0) {
        updateValues.push(id);
        await db.execute(
          `UPDATE news_interface_config SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );

        // TODO: 更新新闻同步定时任务（如果需要）
      }
    } else {
      return res.status(400).json({ success: false, message: '无效的任务类型' });
    }

    res.json({
      success: true,
      message: '定时任务更新成功'
    });
  } catch (error) {
    console.error('更新定时任务失败：', error);
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
    console.error('删除定时任务失败：', error);
    res.status(500).json({ success: false, message: '删除定时任务失败：' + error.message });
  }
});

module.exports = router;

