const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { logEmailConfigChange, logQichachaConfigChange, logNewsConfigChange } = require('../utils/logger');
const { clearCategoryMapCache } = require('../utils/qichachaCategoryMapper');
const xlsx = require('xlsx');
const multer = require('multer');

// 配置multer用于Excel文件上传
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: function (req, file, cb) {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持Excel文件'));
    }
  }
});

const router = express.Router();
const HOLIDAY_TYPES = ['周末', '调休', '法定节假日', '工作日'];

// 获取企查查配置列表（支持分页）
router.get('/qichacha-configs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 获取总数
    const totalResult = await db.query('SELECT COUNT(*) as total FROM qichacha_config');
    const total = totalResult[0].total;

    // 获取分页数据
    const configs = await db.query(`
      SELECT qc.id, qc.app_id, a.app_name, qc.qichacha_app_key, qc.qichacha_daily_limit, qc.interface_type, qc.is_active, qc.created_at, qc.updated_at
      FROM qichacha_config qc
      LEFT JOIN applications a ON qc.app_id = a.id
      ORDER BY qc.created_at DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

    res.json({
      success: true,
      data: configs,
      total: total,
      page: page,
      pageSize: pageSize
    });
  } catch (error) {
    console.error('获取企查查配置列表失败：', error);
    res.status(500).json({ success: false, message: '获取配置列表失败' });
  }
});

// 获取单个企查查配置（不包含密钥）
router.get('/qichacha-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const configs = await db.query(`
      SELECT qc.id, qc.app_id, a.app_name, qc.qichacha_app_key, qc.qichacha_daily_limit, qc.interface_type, qc.is_active, qc.created_at, qc.updated_at
      FROM qichacha_config qc
      LEFT JOIN applications a ON qc.app_id = a.id
      WHERE qc.id = ?
    `, [id]);
    if (configs.length > 0) {
      res.json({ success: true, data: configs[0] });
    } else {
      res.status(404).json({ success: false, message: '配置不存在' });
    }
  } catch (error) {
    console.error('获取企查查配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// 获取系统配置（兼容旧接口，返回企查查配置）
router.get('/config', async (req, res) => {
  try {
    const configs = await db.query('SELECT * FROM qichacha_config ORDER BY id DESC LIMIT 1');
    const configMap = {
      qichacha_app_key: '',
      qichacha_secret_key: '',
      qichacha_daily_limit: '100'
    };
    
    if (configs.length > 0) {
      const config = configs[0];
      configMap.qichacha_app_key = config.qichacha_app_key || '';
      configMap.qichacha_secret_key = config.qichacha_secret_key || '';
      configMap.qichacha_daily_limit = String(config.qichacha_daily_limit || 100);
    }

    res.json({
      success: true,
      data: configMap
    });
  } catch (error) {
    console.error('获取系统配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// 获取新闻接口配置列表（支持分页）
router.get('/news-configs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 获取总数
    const totalResult = await db.query('SELECT COUNT(*) as total FROM news_interface_config');
    const total = totalResult[0].total;

    // 获取分页数据（包括所有接口类型：新榜、企查查等）
    const configs = await db.query(`
      SELECT nic.id, nic.app_id, a.app_name, nic.interface_type, nic.request_url, nic.content_type, nic.frequency_type, nic.frequency_value, nic.last_sync_time, nic.is_active, nic.created_at, nic.updated_at
      FROM news_interface_config nic
      LEFT JOIN applications a ON nic.app_id = a.id
      ORDER BY nic.created_at DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

    res.json({
      success: true,
      data: configs,
      total: total,
      page: page,
      pageSize: pageSize
    });
  } catch (error) {
    console.error('获取新闻接口配置列表失败：', error);
    res.status(500).json({ success: false, message: '获取配置列表失败' });
  }
});

// 获取单个新闻接口配置（不包含密钥）
router.get('/news-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const configs = await db.query(`
      SELECT nic.id, nic.app_id, a.app_name, nic.interface_type, nic.request_url, nic.content_type, nic.api_key, nic.frequency_type, nic.frequency_value, nic.send_frequency, nic.send_time, nic.weekday, nic.month_day, nic.last_sync_time, nic.is_active, nic.created_at, nic.updated_at
      FROM news_interface_config nic
      LEFT JOIN applications a ON nic.app_id = a.id
      WHERE nic.id = ?
    `, [id]);
    if (configs.length > 0) {
      res.json({ success: true, data: configs[0] });
    } else {
      res.status(404).json({ success: false, message: '配置不存在' });
    }
  } catch (error) {
    console.error('获取新闻接口配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// 创建新闻接口配置
router.post('/news-config', [
  body('app_id').notEmpty().withMessage('应用ID不能为空'),
  body('request_url').notEmpty().withMessage('请求地址不能为空'),
  body('content_type').optional(), // Content-Type为非必填字段
  body('api_key').optional(), // 企查查接口不需要api_key，从qichacha_config获取
  body('frequency_type').isIn(['day', 'week', 'month']).withMessage('频次类型必须是day、week或month'),
  body('frequency_value').isInt({ min: 1 }).withMessage('频次值必须大于0'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { app_id, interface_type, request_url, content_type, api_key, frequency_type, frequency_value, send_frequency, send_time, weekday, month_day, is_active } = req.body;

    // 检查应用是否存在
    const appExists = await db.query('SELECT id FROM applications WHERE id = ?', [app_id]);
    if (appExists.length === 0) {
      return res.status(400).json({ success: false, message: '应用不存在' });
    }

    const interfaceType = interface_type || '新榜';
    
    // 根据frequency_type设置默认的send_frequency和send_time
    let finalSendFrequency = send_frequency;
    if (!finalSendFrequency && frequency_type) {
      if (frequency_type === 'week') {
        finalSendFrequency = 'weekly';
      } else if (frequency_type === 'month') {
        finalSendFrequency = 'monthly';
      } else {
        finalSendFrequency = 'daily';
      }
    }
    const finalSendTime = send_time || '00:00:00';
    const finalIsActive = is_active !== undefined ? (is_active ? 1 : 0) : 1;
    
    // 检查是否存在完全相同的配置（所有字段都相同）
    const existingConfigs = await db.query(
      `SELECT * FROM news_interface_config 
       WHERE app_id = ? AND interface_type = ?`,
      [app_id, interfaceType]
    );
    
    // 遍历所有现有配置，检查是否所有字段都相同
    for (const existing of existingConfigs) {
      const existingSendFreq = existing.send_frequency || (existing.frequency_type === 'week' ? 'weekly' : (existing.frequency_type === 'month' ? 'monthly' : 'daily'));
      // 处理时间格式：将 TIME 类型转换为 HH:mm:ss 格式字符串
      let existingSendTime = '00:00:00';
      if (existing.send_time) {
        const timeStr = existing.send_time.toString();
        // 处理 TIME 类型可能返回的格式（如 "00:00:00" 或 "00:00:00.000"）
        existingSendTime = timeStr.length >= 8 ? timeStr.substring(0, 8) : timeStr;
      }
      const existingIsActive = existing.is_active !== undefined ? existing.is_active : 1;
      const existingWeekday = existing.weekday || null;
      const existingMonthDay = existing.month_day || null;
      
      // 标准化新配置的时间格式
      let normalizedNewTime = finalSendTime;
      if (normalizedNewTime && normalizedNewTime.length >= 8) {
        normalizedNewTime = normalizedNewTime.substring(0, 8);
      }
      
      // 比较所有字段（包括应用ID、接口类型、请求地址、同步频率、同步时间、星期/日期、启用状态）
      const isIdentical = 
        existing.app_id === app_id &&
        existing.interface_type === interfaceType &&
        existing.request_url === request_url &&
        existingSendFreq === finalSendFrequency &&
        existingSendTime === normalizedNewTime &&
        existingIsActive === finalIsActive &&
        existingWeekday === (weekday || null) &&
        existingMonthDay === (month_day || null);
      
      if (isIdentical) {
        return res.status(400).json({ 
          success: false, 
          message: '已存在完全相同的新闻接口配置，所有字段都相同，不允许重复创建' 
        });
      }
    }

    // 企查查接口不需要api_key，但需要验证是否配置了企查查应用凭证
    if (interfaceType === '企查查') {
      const qichachaConfigs = await db.query(
        `SELECT id FROM qichacha_config WHERE interface_type = '新闻舆情' AND is_active = 1 LIMIT 1`
      );
      if (qichachaConfigs.length === 0) {
        return res.status(400).json({ success: false, message: '请先配置企查查新闻舆情接口的应用凭证和秘钥' });
      }
    } else if (!api_key) {
      return res.status(400).json({ success: false, message: 'Key不能为空' });
    }

    const configId = await generateId('news_interface_config');
    // 企查查接口不需要content_type，其他接口使用默认值
    const finalContentType = interfaceType === '企查查' 
      ? null 
      : (content_type || 'application/x-www-form-urlencoded;charset=utf-8');
    
    // 如果没有提供send_frequency，根据frequency_type设置默认值
    if (!finalSendFrequency) {
      if (frequency_type === 'week') {
        finalSendFrequency = 'weekly';
      } else if (frequency_type === 'month') {
        finalSendFrequency = 'monthly';
      } else {
        finalSendFrequency = 'daily';
      }
    }
    
    const retry_count = req.body.retry_count !== undefined ? parseInt(req.body.retry_count) : 0;
    const retry_interval = req.body.retry_interval !== undefined ? parseInt(req.body.retry_interval) : 0;

    await db.execute(
      `INSERT INTO news_interface_config 
       (id, app_id, interface_type, request_url, content_type, api_key, frequency_type, frequency_value, send_frequency, send_time, weekday, month_day, retry_count, retry_interval, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId,
        app_id,
        interfaceType,
        request_url,
        finalContentType,
        api_key || '', // 企查查接口可以为空
        frequency_type,
        frequency_value,
        finalSendFrequency,
        finalSendTime,
        weekday || null,
        month_day || null,
        retry_count,
        retry_interval,
        finalIsActive
      ]
    );

    // 记录创建日志
    const userId = req.headers['x-user-id'] || null;
    if (userId) {
      await logNewsConfigChange(
        configId,
        {},
        {
          app_id,
          request_url,
          content_type: content_type || 'application/x-www-form-urlencoded;charset=utf-8',
          frequency_type,
          frequency_value: frequency_value.toString(),
          is_active: '1'
        },
        userId
      );
    }

    // 如果新配置是启用的，更新新闻同步定时任务
    if (finalIsActive === 1) {
      try {
        const { updateNewsSyncScheduledTasks } = require('../utils/scheduledNewsSyncTasks');
        await updateNewsSyncScheduledTasks();
        console.log(`[新闻接口配置创建] 新配置已启用，新闻同步定时任务调度已更新`);
      } catch (taskError) {
        console.warn(`[新闻接口配置创建] 更新新闻同步定时任务调度失败:`, taskError.message);
        // 不阻断主流程，只记录警告
      }
    }

    res.json({ success: true, message: '新闻接口配置创建成功', data: { id: configId } });
  } catch (error) {
    console.error('创建新闻接口配置失败：', error);
    
    // 如果是唯一约束错误，提供更友好的提示
    if (error.code === 'ER_DUP_ENTRY' && error.message.includes('uk_app_interface')) {
      return res.status(400).json({ 
        success: false, 
        message: '数据库唯一约束仍然存在，请重启服务器以执行迁移脚本，或手动执行 fix_unique_constraint_manual.sql 文件中的SQL来修复' 
      });
    }
    
    res.status(500).json({ success: false, message: '创建配置失败：' + error.message });
  }
});

// 更新新闻接口配置
router.put('/news-config/:id', [
  body('app_id').optional().notEmpty().withMessage('应用ID不能为空'),
  body('request_url').optional().notEmpty().withMessage('请求地址不能为空'),
  body('content_type').optional(), // Content-Type为非必填字段
  body('api_key').optional(), // 企查查接口不需要api_key
  body('frequency_type').optional().isIn(['day', 'week', 'month']).withMessage('频次类型必须是day、week或month'),
  body('frequency_value').optional().isInt({ min: 1 }).withMessage('频次值必须大于0'),
  body('is_active').optional().isBoolean().withMessage('is_active必须是布尔值'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { app_id, interface_type, request_url, content_type, api_key, frequency_type, frequency_value, send_frequency, send_time, weekday, month_day, is_active, retry_count, retry_interval } = req.body;

    // 检查配置是否存在，并获取旧数据用于日志记录
    const existingConfigs = await db.query('SELECT * FROM news_interface_config WHERE id = ?', [id]);
    if (existingConfigs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const oldConfig = existingConfigs[0];

    // 如果更新应用ID或接口类型，检查应用是否存在，以及是否重复
    if (app_id || interface_type) {
      const checkAppId = app_id || oldConfig.app_id;
      const checkInterfaceType = interface_type || oldConfig.interface_type || '新榜';
      
      if (app_id) {
        const appExists = await db.query('SELECT id FROM applications WHERE id = ?', [app_id]);
        if (appExists.length === 0) {
          return res.status(400).json({ success: false, message: '应用不存在' });
        }
      }
      
      // 检查是否存在相同应用和接口类型的配置（排除当前配置）
      const duplicate = await db.query(
        'SELECT id FROM news_interface_config WHERE app_id = ? AND interface_type = ? AND id != ?', 
        [checkAppId, checkInterfaceType, id]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ success: false, message: `该应用已存在接口类型为"${checkInterfaceType}"的新闻接口配置` });
      }
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    if (app_id !== undefined) {
      updateFields.push('app_id = ?');
      updateValues.push(app_id);
    }
    if (interface_type !== undefined) {
      updateFields.push('interface_type = ?');
      updateValues.push(interface_type);
    }
    if (request_url !== undefined) {
      updateFields.push('request_url = ?');
      updateValues.push(request_url);
    }
    if (content_type !== undefined) {
      updateFields.push('content_type = ?');
      updateValues.push(content_type);
    }
    if (api_key !== undefined) {
      updateFields.push('api_key = ?');
      updateValues.push(api_key);
    }
    if (frequency_type !== undefined) {
      updateFields.push('frequency_type = ?');
      updateValues.push(frequency_type);
      
      // 如果是企查查接口，根据frequency_type自动更新send_frequency，同步到定时任务
      const currentInterfaceType = interface_type !== undefined ? interface_type : oldConfig.interface_type;
      if (currentInterfaceType === '企查查') {
        let sendFrequency = 'daily';
        if (frequency_type === 'week') {
          sendFrequency = 'weekly';
        } else if (frequency_type === 'month') {
          sendFrequency = 'monthly';
        }
        
        updateFields.push('send_frequency = ?');
        updateValues.push(sendFrequency);
        
        console.log(`[新闻接口配置更新] 企查查接口frequency_type更新为${frequency_type}，同步更新send_frequency为${sendFrequency}`);
      }
    }
    if (frequency_value !== undefined) {
      updateFields.push('frequency_value = ?');
      updateValues.push(frequency_value);
    }
    if (send_frequency !== undefined) {
      updateFields.push('send_frequency = ?');
      updateValues.push(send_frequency);
    }
    if (send_time !== undefined) {
      updateFields.push('send_time = ?');
      updateValues.push(send_time);
    }
    if (weekday !== undefined) {
      updateFields.push('weekday = ?');
      updateValues.push(weekday);
    }
    if (month_day !== undefined) {
      updateFields.push('month_day = ?');
      updateValues.push(month_day);
    }
    if (retry_count !== undefined) {
      updateFields.push('retry_count = ?');
      updateValues.push(retry_count);
    }
    if (retry_interval !== undefined) {
      updateFields.push('retry_interval = ?');
      updateValues.push(retry_interval);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(is_active ? 1 : 0);
    }

    if (updateFields.length > 0) {
      updateValues.push(id);
      await db.execute(
        `UPDATE news_interface_config SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
      
      // 如果更新了定时任务相关字段（send_frequency, send_time, weekday, month_day, is_active），需要更新定时任务调度
      const shouldUpdateScheduledTasks = 
        send_frequency !== undefined || 
        send_time !== undefined || 
        weekday !== undefined || 
        month_day !== undefined || 
        is_active !== undefined ||
        frequency_type !== undefined; // frequency_type变更可能影响send_frequency的默认值
      
      if (shouldUpdateScheduledTasks) {
        try {
          const { updateNewsSyncScheduledTasks } = require('../utils/scheduledNewsSyncTasks');
          await updateNewsSyncScheduledTasks();
          console.log(`[新闻接口配置更新] 定时任务相关字段已更新，新闻同步定时任务调度已同步更新`);
        } catch (taskError) {
          console.warn(`[新闻接口配置更新] 更新新闻同步定时任务调度失败:`, taskError.message);
          // 不阻断主流程，只记录警告
        }
      }

      // 记录更新日志
      const userId = req.headers['x-user-id'] || null;
      if (userId) {
        // 获取更新后的数据
        const updatedConfigs = await db.query('SELECT * FROM news_interface_config WHERE id = ?', [id]);
        const newConfig = updatedConfigs[0];
        
        // 构建新旧数据对比（只记录变更的字段）
        const oldData = {
          app_id: oldConfig.app_id || '',
          request_url: oldConfig.request_url || '',
          content_type: oldConfig.content_type || '',
          frequency_type: oldConfig.frequency_type || '',
          frequency_value: oldConfig.frequency_value ? oldConfig.frequency_value.toString() : '',
          is_active: oldConfig.is_active ? '1' : '0'
        };
        
        const newData = {
          app_id: newConfig.app_id || '',
          request_url: newConfig.request_url || '',
          content_type: newConfig.content_type || '',
          frequency_type: newConfig.frequency_type || '',
          frequency_value: newConfig.frequency_value ? newConfig.frequency_value.toString() : '',
          is_active: newConfig.is_active ? '1' : '0'
        };
        
        await logNewsConfigChange(id, oldData, newData, userId);
      }
    }

    res.json({ success: true, message: '新闻接口配置更新成功' });
  } catch (error) {
    console.error('更新新闻接口配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败：' + error.message });
  }
});

// 获取新闻接口配置的变更日志
router.get('/news-config/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'news_interface_config' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取新闻接口配置日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 删除新闻接口配置
router.delete('/news-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM news_interface_config WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    await db.execute('DELETE FROM news_interface_config WHERE id = ?', [id]);
    res.json({ success: true, message: '新闻接口配置删除成功' });
  } catch (error) {
    console.error('删除新闻接口配置失败：', error);
    res.status(500).json({ success: false, message: '删除配置失败' });
  }
});

// 创建企查查配置
router.post('/qichacha-config', [
  body('app_id').notEmpty().withMessage('应用ID不能为空'),
  body('qichacha_app_key').notEmpty().withMessage('应用凭证不能为空'),
  body('qichacha_secret_key').notEmpty().withMessage('凭证秘钥不能为空'),
  body('qichacha_daily_limit').optional().isInt({ min: 0 }).withMessage('每日查询限制必须是非负整数'),
  body('interface_type').optional().isIn(['企业信息', '新闻舆情']).withMessage('接口类型必须是"企业信息"或"新闻舆情"'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { app_id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit, interface_type } = req.body;

    // 检查应用是否存在
    const appExists = await db.query('SELECT id FROM applications WHERE id = ?', [app_id]);
    if (appExists.length === 0) {
      return res.status(400).json({ success: false, message: '应用不存在' });
    }

    // 检查该应用是否已有相同接口类型的配置
    const interfaceType = req.body.interface_type || '企业信息';
    const existing = await db.query(
      'SELECT id FROM qichacha_config WHERE app_id = ? AND interface_type = ?', 
      [app_id, interfaceType]
    );
    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `该应用已存在接口类型为"${interfaceType}"的企查查配置` 
      });
    }

    const configId = await generateId('qichacha_config');
    await db.execute(
      'INSERT INTO qichacha_config (id, app_id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit, interface_type) VALUES (?, ?, ?, ?, ?, ?)',
      [
        configId,
        app_id,
        qichacha_app_key,
        qichacha_secret_key,
        qichacha_daily_limit || 100,
        interface_type || '企业信息'
      ]
    );

    // 记录创建日志
    const userId = req.headers['x-user-id'] || null;
    if (userId) {
      await logQichachaConfigChange(
        configId,
        {},
        {
          app_id,
          qichacha_app_key,
          qichacha_daily_limit: (qichacha_daily_limit || 100).toString(),
          interface_type: interface_type || '企业信息',
          is_active: '1'
        },
        userId
      );
    }

    res.json({ success: true, message: '企查查配置创建成功', data: { id: configId } });
  } catch (error) {
    console.error('创建企查查配置失败：', error);
    res.status(500).json({ success: false, message: '创建配置失败：' + error.message });
  }
});

// 更新企查查配置
router.put('/qichacha-config/:id', [
  body('app_id').optional().notEmpty().withMessage('应用ID不能为空'),
  body('qichacha_app_key').optional().notEmpty().withMessage('应用凭证不能为空'),
  body('qichacha_secret_key').optional().notEmpty().withMessage('凭证秘钥不能为空'),
  body('qichacha_daily_limit').optional().isInt({ min: 0 }).withMessage('每日查询限制必须是非负整数'),
  body('interface_type').optional().isIn(['企业信息', '新闻舆情']).withMessage('接口类型必须是"企业信息"或"新闻舆情"'),
  body('is_active').optional().isBoolean().withMessage('is_active必须是布尔值'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { app_id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit, interface_type, is_active } = req.body;

    // 检查配置是否存在，并获取旧数据用于日志记录
    const existingConfigs = await db.query('SELECT * FROM qichacha_config WHERE id = ?', [id]);
    if (existingConfigs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const oldConfig = existingConfigs[0];

    // 如果更新应用ID，检查应用是否存在，以及是否重复
    if (app_id) {
      const appExists = await db.query('SELECT id FROM applications WHERE id = ?', [app_id]);
      if (appExists.length === 0) {
        return res.status(400).json({ success: false, message: '应用不存在' });
      }
      
      // 如果更新了接口类型，检查新接口类型是否已存在
      if (interface_type !== undefined) {
        const duplicate = await db.query(
          'SELECT id FROM qichacha_config WHERE app_id = ? AND interface_type = ? AND id != ?', 
          [app_id, interface_type, id]
        );
        if (duplicate.length > 0) {
          return res.status(400).json({ 
            success: false, 
            message: `该应用已存在接口类型为"${interface_type}"的企查查配置` 
          });
        }
      }
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    if (app_id !== undefined) {
      updateFields.push('app_id = ?');
      updateValues.push(app_id);
    }
    if (qichacha_app_key !== undefined) {
      updateFields.push('qichacha_app_key = ?');
      updateValues.push(qichacha_app_key);
    }
    if (qichacha_secret_key !== undefined) {
      updateFields.push('qichacha_secret_key = ?');
      updateValues.push(qichacha_secret_key);
    }
    if (qichacha_daily_limit !== undefined) {
      updateFields.push('qichacha_daily_limit = ?');
      updateValues.push(qichacha_daily_limit);
    }
    if (interface_type !== undefined) {
      updateFields.push('interface_type = ?');
      updateValues.push(interface_type);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(is_active ? 1 : 0);
    }

    if (updateFields.length > 0) {
      updateValues.push(id);
      await db.execute(
        `UPDATE qichacha_config SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      // 记录更新日志
      const userId = req.headers['x-user-id'] || null;
      if (userId) {
        // 获取更新后的数据
        const updatedConfigs = await db.query('SELECT * FROM qichacha_config WHERE id = ?', [id]);
        const newConfig = updatedConfigs[0];
        
        // 构建新旧数据对比（只记录变更的字段）
        const oldData = {
          app_id: oldConfig.app_id || '',
          qichacha_app_key: oldConfig.qichacha_app_key || '',
          qichacha_daily_limit: oldConfig.qichacha_daily_limit ? oldConfig.qichacha_daily_limit.toString() : '',
          interface_type: oldConfig.interface_type || '企业信息',
          is_active: oldConfig.is_active ? '1' : '0'
        };
        
        const newData = {
          app_id: newConfig.app_id || '',
          qichacha_app_key: newConfig.qichacha_app_key || '',
          qichacha_daily_limit: newConfig.qichacha_daily_limit ? newConfig.qichacha_daily_limit.toString() : '',
          interface_type: newConfig.interface_type || '企业信息',
          is_active: newConfig.is_active ? '1' : '0'
        };
        
        await logQichachaConfigChange(id, oldData, newData, userId);
      }
    }

    res.json({ success: true, message: '企查查配置更新成功' });
  } catch (error) {
    console.error('更新企查查配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败：' + error.message });
  }
});

// 获取企查查配置的变更日志
router.get('/qichacha-config/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'qichacha_config' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取企查查配置日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 删除企查查配置
router.delete('/qichacha-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM qichacha_config WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    await db.execute('DELETE FROM qichacha_config WHERE id = ?', [id]);
    res.json({ success: true, message: '企查查配置删除成功' });
  } catch (error) {
    console.error('删除企查查配置失败：', error);
    res.status(500).json({ success: false, message: '删除配置失败' });
  }
});

// ========== 企查查新闻类别管理 API ==========

// 获取企查查新闻类别列表
router.get('/qichacha-news-categories', async (req, res) => {
  try {
    const { page = 1, pageSize = 1000, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    
    let query = 'SELECT * FROM qichacha_news_categories WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM qichacha_news_categories WHERE 1=1';
    const params = [];
    
    if (search) {
      query += ' AND (category_code LIKE ? OR category_name LIKE ?)';
      countQuery += ' AND (category_code LIKE ? OR category_name LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }
    
    query += ' ORDER BY category_code ASC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), offset);
    
    const categories = await db.query(query, params);
    const [totalResult] = await db.query(countQuery, search ? [params[0], params[1]] : []);
    const total = totalResult.total;
    
    res.json({ 
      success: true, 
      data: categories, 
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取企查查新闻类别列表失败：', error);
    res.status(500).json({ success: false, message: '获取类别列表失败' });
  }
});

// 获取单个企查查新闻类别
router.get('/qichacha-news-category/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const categories = await db.query('SELECT * FROM qichacha_news_categories WHERE id = ?', [id]);
    if (categories.length === 0) {
      return res.status(404).json({ success: false, message: '类别不存在' });
    }
    res.json({ success: true, data: categories[0] });
  } catch (error) {
    console.error('获取企查查新闻类别失败：', error);
    res.status(500).json({ success: false, message: '获取类别失败' });
  }
});

// 创建企查查新闻类别
router.post('/qichacha-news-category', [
  body('category_code').notEmpty().withMessage('类别编码不能为空'),
  body('category_name').notEmpty().withMessage('类别描述不能为空'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { category_code, category_name } = req.body;

    // 检查类别编码是否已存在
    const existing = await db.query(
      'SELECT id FROM qichacha_news_categories WHERE category_code = ?',
      [category_code]
    );
    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `类别编码"${category_code}"已存在` 
      });
    }

    const categoryId = await generateId('qichacha_news_categories');
    await db.execute(
      'INSERT INTO qichacha_news_categories (id, category_code, category_name) VALUES (?, ?, ?)',
      [categoryId, category_code, category_name]
    );

    // 清除类别映射缓存
    clearCategoryMapCache();

    res.json({ success: true, message: '企查查新闻类别创建成功', data: { id: categoryId } });
  } catch (error) {
    console.error('创建企查查新闻类别失败：', error);
    res.status(500).json({ success: false, message: '创建类别失败：' + error.message });
  }
});

// 更新企查查新闻类别
router.put('/qichacha-news-category/:id', [
  body('category_code').optional().notEmpty().withMessage('类别编码不能为空'),
  body('category_name').optional().notEmpty().withMessage('类别描述不能为空'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { category_code, category_name } = req.body;

    // 检查类别是否存在
    const existing = await db.query('SELECT * FROM qichacha_news_categories WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '类别不存在' });
    }

    // 如果更新类别编码，检查是否与其他记录重复
    if (category_code && category_code !== existing[0].category_code) {
      const duplicate = await db.query(
        'SELECT id FROM qichacha_news_categories WHERE category_code = ? AND id != ?',
        [category_code, id]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: `类别编码"${category_code}"已存在` 
        });
      }
    }

    const updateFields = [];
    const updateValues = [];
    
    if (category_code !== undefined) {
      updateFields.push('category_code = ?');
      updateValues.push(category_code);
    }
    if (category_name !== undefined) {
      updateFields.push('category_name = ?');
      updateValues.push(category_name);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }
    
    updateValues.push(id);
    await db.execute(
      `UPDATE qichacha_news_categories SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // 清除类别映射缓存
    clearCategoryMapCache();

    res.json({ success: true, message: '企查查新闻类别更新成功' });
  } catch (error) {
    console.error('更新企查查新闻类别失败：', error);
    res.status(500).json({ success: false, message: '更新类别失败：' + error.message });
  }
});

// 删除企查查新闻类别
router.delete('/qichacha-news-category/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM qichacha_news_categories WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '类别不存在' });
    }

    await db.execute('DELETE FROM qichacha_news_categories WHERE id = ?', [id]);
    
    // 清除类别映射缓存
    clearCategoryMapCache();
    
    res.json({ success: true, message: '企查查新闻类别删除成功' });
  } catch (error) {
    console.error('删除企查查新闻类别失败：', error);
    res.status(500).json({ success: false, message: '删除类别失败' });
  }
});

// 下载企查查新闻类别导入模板
router.get('/qichacha-news-categories/template', async (req, res) => {
  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['类别编号', '类别描述'],
      ['10000', '信用预警'],
      ['10001', '承诺失信']
    ]);
    
    // 设置列宽
    worksheet['!cols'] = [
      { wch: 15 }, // 类别编号
      { wch: 30 }  // 类别描述
    ];
    
    xlsx.utils.book_append_sheet(workbook, worksheet, '企查查新闻类别');
    const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('企查查新闻类别导入模板.xlsx')}"`);
    res.send(buffer);
  } catch (error) {
    console.error('生成企查查新闻类别模板失败：', error);
    res.status(500).json({ success: false, message: '模板生成失败' });
  }
});

// 批量导入企查查新闻类别（Excel文件）
router.post('/qichacha-news-categories/import', excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传Excel文件' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: '未检测到数据工作表' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Excel内容为空' });
    }

    // 验证表头
    const headers = rows[0].map((cell) => String(cell || '').trim());
    if (headers[0] !== '类别编号' || headers[1] !== '类别描述') {
      return res.status(400).json({ success: false, message: '模板表头不匹配，请下载最新模板' });
    }

    // 获取数据行（跳过表头）
    const dataRows = rows.slice(1).filter((row) => {
      const code = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      return code !== '' || name !== '';
    });

    if (!dataRows.length) {
      return res.status(400).json({ success: false, message: '未检测到可导入的数据' });
    }

    const results = {
      success: 0,
      duplicate: [],
      failed: 0,
      errors: []
    };

    // 批量查询所有已存在的类别编码（提高性能）
    const allExistingCategories = await db.query('SELECT category_code FROM qichacha_news_categories');
    const existingCodesSet = new Set(allExistingCategories.map(cat => cat.category_code));

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2; // Excel行号（从第2行开始，因为第1行是表头）
      const [codeCell, nameCell] = dataRows[i];
      
      const category_code = String(codeCell || '').trim();
      const category_name = String(nameCell || '').trim();

      // 验证必填字段
      if (!category_code) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          category_code: category_code || '(空)',
          message: '类别编号不能为空'
        });
        continue;
      }

      if (!category_name) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          category_code: category_code,
          message: '类别描述不能为空'
        });
        continue;
      }

      // 检查类别编码是否已存在
      if (existingCodesSet.has(category_code)) {
        results.duplicate.push({
          row: rowNumber,
          category_code: category_code,
          category_name: category_name
        });
        continue;
      }

      // 导入新类别
      try {
        const categoryId = await generateId('qichacha_news_categories');
        await db.execute(
          'INSERT INTO qichacha_news_categories (id, category_code, category_name) VALUES (?, ?, ?)',
          [categoryId, category_code, category_name]
        );
        results.success++;
        // 添加到已存在集合，避免同一批导入中重复
        existingCodesSet.add(category_code);
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          category_code: category_code,
          message: error.message || '导入失败'
        });
      }
    }

    // 清除类别映射缓存
    if (results.success > 0) {
      clearCategoryMapCache();
    }

    res.json({ 
      success: true, 
      message: `导入完成：成功 ${results.success} 条，重复 ${results.duplicate.length} 条，失败 ${results.failed} 条`,
      data: results
    });
  } catch (error) {
    console.error('批量导入企查查新闻类别失败：', error);
    res.status(500).json({ success: false, message: '导入失败：' + error.message });
  }
});

// 更新系统配置（兼容旧接口）
router.put('/config', [
  body('qichacha_app_key').optional(),
  body('qichacha_secret_key').optional(),
  body('qichacha_daily_limit').optional().isInt({ min: 0 }).withMessage('每日查询限制必须是非负整数'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { qichacha_app_key, qichacha_secret_key, qichacha_daily_limit } = req.body;

    // 检查是否已存在配置
    const existing = await db.query('SELECT id FROM qichacha_config ORDER BY id DESC LIMIT 1');
    
    if (existing.length > 0) {
      // 更新现有配置
      const updateFields = [];
      const updateValues = [];
      
      if (qichacha_app_key !== undefined) {
        updateFields.push('qichacha_app_key = ?');
        updateValues.push(qichacha_app_key);
      }
      
      if (qichacha_secret_key !== undefined) {
        updateFields.push('qichacha_secret_key = ?');
        updateValues.push(qichacha_secret_key);
      }
      
      if (qichacha_daily_limit !== undefined) {
        updateFields.push('qichacha_daily_limit = ?');
        updateValues.push(qichacha_daily_limit);
      }
      
      if (updateFields.length > 0) {
        updateValues.push(existing[0].id);
        await db.execute(
          `UPDATE qichacha_config SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );
      }
    } else {
      // 创建新配置
      const configId = await generateId('qichacha_config');
      await db.execute(
        'INSERT INTO qichacha_config (id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit) VALUES (?, ?, ?, ?)',
        [
          configId,
          qichacha_app_key || '',
          qichacha_secret_key || '',
          qichacha_daily_limit || 100
        ]
      );
    }

    res.json({ success: true, message: '配置更新成功' });
  } catch (error) {
    console.error('更新系统配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败' });
  }
});

// 邮件配置相关路由
const nodemailer = require('nodemailer');

// 获取所有邮件配置
router.get('/email-configs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 获取总数
    const totalResult = await db.query('SELECT COUNT(*) as total FROM email_config');
    const total = totalResult[0].total;

    // 获取分页数据
    const configs = await db.query(`
      SELECT ec.id, ec.app_id, a.app_name, ec.smtp_host, ec.pop_host, ec.from_email, ec.from_name, ec.pop_user, ec.is_active, ec.created_at, ec.updated_at 
      FROM email_config ec
      LEFT JOIN applications a ON ec.app_id = a.id
      ORDER BY ec.created_at DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

    res.json({
      success: true,
      data: configs,
      total: total,
      page: page,
      pageSize: pageSize
    });
  } catch (error) {
    console.error('获取邮件配置列表失败：', error);
    res.status(500).json({ success: false, message: '获取配置列表失败' });
  }
});

// 获取应用列表
router.get('/applications', async (req, res) => {
  try {
    const apps = await db.query('SELECT id, app_name FROM applications ORDER BY app_name');
    res.json({
      success: true,
      data: apps
    });
  } catch (error) {
    console.error('获取应用列表失败：', error);
    res.status(500).json({ success: false, message: '获取应用列表失败' });
  }
});

// 获取单个邮件配置（不包含密码）
router.get('/email-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const configs = await db.query(
      `SELECT ec.id, ec.app_id, a.app_name, ec.smtp_host, ec.smtp_port, ec.smtp_secure, ec.smtp_user, ec.from_email, ec.from_name, 
       ec.pop_host, ec.pop_port, ec.pop_secure, ec.pop_user, ec.is_active 
       FROM email_config ec
       LEFT JOIN applications a ON ec.app_id = a.id
       WHERE ec.id = ?`,
      [id]
    );
    if (configs.length > 0) {
      res.json({
        success: true,
        data: configs[0]
      });
    } else {
      res.status(404).json({ success: false, message: '配置不存在' });
    }
  } catch (error) {
    console.error('获取邮件配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// 创建邮件配置
router.post('/email-config', [
  body('app_id').notEmpty().withMessage('应用ID不能为空'),
  body('smtp_host').notEmpty().withMessage('SMTP服务器地址不能为空'),
  body('smtp_port').isInt({ min: 1, max: 65535 }).withMessage('SMTP端口必须是1-65535之间的整数'),
  body('smtp_secure').optional().isBoolean().withMessage('smtp_secure必须是布尔值'),
  body('smtp_user').notEmpty().withMessage('SMTP用户名不能为空'),
  body('smtp_password').notEmpty().withMessage('SMTP密码不能为空'),
  body('from_email').isEmail().withMessage('发件人邮箱格式不正确'),
  body('from_name').optional(),
  body('pop_host').optional(),
  body('pop_port').optional().isInt({ min: 1, max: 65535 }).withMessage('POP端口必须是1-65535之间的整数'),
  body('pop_secure').optional().isBoolean().withMessage('pop_secure必须是布尔值'),
  body('pop_user').optional(),
  body('pop_password').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { app_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_email, from_name,
            pop_host, pop_port, pop_secure, pop_user, pop_password } = req.body;

    // 检查应用是否存在
    const appExists = await db.query('SELECT id FROM applications WHERE id = ?', [app_id]);
    if (appExists.length === 0) {
      return res.status(400).json({ success: false, message: '应用不存在' });
    }

    // 检查该应用是否已有邮件配置
    const existing = await db.query('SELECT id FROM email_config WHERE app_id = ?', [app_id]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '该应用已存在邮件配置' });
    }

    const configId = await generateId('email_config');
    await db.execute(
      `INSERT INTO email_config 
       (id, app_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_email, from_name,
        pop_host, pop_port, pop_secure, pop_user, pop_password) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId,
        app_id,
        smtp_host,
        smtp_port,
        smtp_secure ? 1 : 0,
        smtp_user,
        smtp_password,
        from_email,
        from_name || '',
        pop_host || null,
        pop_port || null,
        pop_secure ? 1 : 0,
        pop_user || null,
        pop_password || null
      ]
    );

    // 记录创建日志
    const userId = req.headers['x-user-id'] || null;
    if (userId) {
      await logEmailConfigChange(
        configId,
        {},
        {
          app_id,
          smtp_host,
          smtp_port: smtp_port.toString(),
          smtp_secure: smtp_secure ? '1' : '0',
          smtp_user,
          from_email,
          from_name: from_name || '',
          pop_host: pop_host || '',
          pop_port: pop_port ? pop_port.toString() : '',
          pop_secure: pop_secure ? '1' : '0',
          pop_user: pop_user || '',
          is_active: '1'
        },
        userId
      );
    }

    res.json({ success: true, message: '邮件配置创建成功', data: { id: configId } });
  } catch (error) {
    console.error('创建邮件配置失败：', error);
    res.status(500).json({ success: false, message: '创建配置失败：' + error.message });
  }
});

// 更新邮件配置
router.put('/email-config/:id', [
  body('app_id').optional().notEmpty().withMessage('应用ID不能为空'),
  body('smtp_host').optional().notEmpty().withMessage('SMTP服务器地址不能为空'),
  body('smtp_port').optional().isInt({ min: 1, max: 65535 }).withMessage('SMTP端口必须是1-65535之间的整数'),
  body('smtp_secure').optional().isBoolean().withMessage('smtp_secure必须是布尔值'),
  body('smtp_user').optional().notEmpty().withMessage('SMTP用户名不能为空'),
  body('smtp_password').optional().notEmpty().withMessage('SMTP密码不能为空'),
  body('from_email').optional().isEmail().withMessage('发件人邮箱格式不正确'),
  body('from_name').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { app_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_email, from_name,
            pop_host, pop_port, pop_secure, pop_user, pop_password } = req.body;

    // 检查配置是否存在，并获取旧数据用于日志记录
    const existingConfigs = await db.query('SELECT * FROM email_config WHERE id = ?', [id]);
    if (existingConfigs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const oldConfig = existingConfigs[0];

    // 如果更新应用ID，检查应用是否存在，以及是否重复
    if (app_id) {
      const appExists = await db.query('SELECT id FROM applications WHERE id = ?', [app_id]);
      if (appExists.length === 0) {
        return res.status(400).json({ success: false, message: '应用不存在' });
      }
      
      const duplicate = await db.query('SELECT id FROM email_config WHERE app_id = ? AND id != ?', [app_id, id]);
      if (duplicate.length > 0) {
        return res.status(400).json({ success: false, message: '该应用已存在邮件配置' });
      }
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    if (app_id !== undefined) {
      updateFields.push('app_id = ?');
      updateValues.push(app_id);
    }
    if (smtp_host !== undefined) {
      updateFields.push('smtp_host = ?');
      updateValues.push(smtp_host);
    }
    if (smtp_port !== undefined) {
      updateFields.push('smtp_port = ?');
      updateValues.push(smtp_port);
    }
    if (smtp_secure !== undefined) {
      updateFields.push('smtp_secure = ?');
      updateValues.push(smtp_secure ? 1 : 0);
    }
    if (smtp_user !== undefined) {
      updateFields.push('smtp_user = ?');
      updateValues.push(smtp_user);
    }
    // 只有明确提供了非空密码时才更新
    if (smtp_password !== undefined && smtp_password !== null && smtp_password !== '') {
      updateFields.push('smtp_password = ?');
      updateValues.push(smtp_password);
    }
    if (from_email !== undefined) {
      updateFields.push('from_email = ?');
      updateValues.push(from_email);
    }
    if (from_name !== undefined) {
      updateFields.push('from_name = ?');
      updateValues.push(from_name);
    }
    if (pop_host !== undefined) {
      updateFields.push('pop_host = ?');
      updateValues.push(pop_host || null);
    }
    if (pop_port !== undefined) {
      updateFields.push('pop_port = ?');
      updateValues.push(pop_port || null);
    }
    if (pop_secure !== undefined) {
      updateFields.push('pop_secure = ?');
      updateValues.push(pop_secure ? 1 : 0);
    }
    if (pop_user !== undefined) {
      updateFields.push('pop_user = ?');
      updateValues.push(pop_user || null);
    }
    if (pop_password !== undefined && pop_password !== '') {
      updateFields.push('pop_password = ?');
      updateValues.push(pop_password);
    }

    if (updateFields.length > 0) {
      updateValues.push(id);
      await db.execute(
        `UPDATE email_config SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );

      // 记录更新日志
      const userId = req.headers['x-user-id'] || null;
      if (userId) {
        // 获取更新后的数据
        const updatedConfigs = await db.query('SELECT * FROM email_config WHERE id = ?', [id]);
        const newConfig = updatedConfigs[0];
        
        // 构建新旧数据对比（只记录变更的字段）
        const oldData = {
          app_id: oldConfig.app_id || '',
          smtp_host: oldConfig.smtp_host || '',
          smtp_port: oldConfig.smtp_port ? oldConfig.smtp_port.toString() : '',
          smtp_secure: oldConfig.smtp_secure ? '1' : '0',
          smtp_user: oldConfig.smtp_user || '',
          from_email: oldConfig.from_email || '',
          from_name: oldConfig.from_name || '',
          pop_host: oldConfig.pop_host || '',
          pop_port: oldConfig.pop_port ? oldConfig.pop_port.toString() : '',
          pop_secure: oldConfig.pop_secure ? '1' : '0',
          pop_user: oldConfig.pop_user || '',
          is_active: oldConfig.is_active ? '1' : '0'
        };
        
        const newData = {
          app_id: newConfig.app_id || '',
          smtp_host: newConfig.smtp_host || '',
          smtp_port: newConfig.smtp_port ? newConfig.smtp_port.toString() : '',
          smtp_secure: newConfig.smtp_secure ? '1' : '0',
          smtp_user: newConfig.smtp_user || '',
          from_email: newConfig.from_email || '',
          from_name: newConfig.from_name || '',
          pop_host: newConfig.pop_host || '',
          pop_port: newConfig.pop_port ? newConfig.pop_port.toString() : '',
          pop_secure: newConfig.pop_secure ? '1' : '0',
          pop_user: newConfig.pop_user || '',
          is_active: newConfig.is_active ? '1' : '0'
        };
        
        await logEmailConfigChange(id, oldData, newData, userId);
      }
    }

    res.json({ success: true, message: '邮件配置更新成功' });
  } catch (error) {
    console.error('更新邮件配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败：' + error.message });
  }
});

// 删除邮件配置
router.delete('/email-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM email_config WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    await db.execute('DELETE FROM email_config WHERE id = ?', [id]);
    res.json({ success: true, message: '邮件配置删除成功' });
  } catch (error) {
    console.error('删除邮件配置失败：', error);
    res.status(500).json({ success: false, message: '删除配置失败' });
  }
});

// 获取邮件配置的变更日志
router.get('/email-config/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'email_config' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取邮件配置日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 测试邮件连接（使用表单数据，用于新增配置时测试）
router.post('/email-config/test', async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_email, from_name, test_email } = req.body;

    if (!test_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(test_email)) {
      return res.status(400).json({ success: false, message: '请输入有效的测试邮箱地址' });
    }

    if (!smtp_host || !smtp_port || !smtp_user || !smtp_password || !from_email) {
      return res.status(400).json({ success: false, message: '请填写完整的SMTP配置信息' });
    }

    // 创建邮件传输器
    const port = parseInt(smtp_port, 10);
    const useSecure = smtp_secure === true || smtp_secure === 1;
    
    // 根据端口和配置自动调整SSL/TLS设置
    // 端口465通常使用SSL（secure: true）
    // 端口587通常使用TLS/STARTTLS（secure: false, requireTLS: true）
    const transporterConfig = {
      host: smtp_host,
      port: port,
      auth: {
        user: smtp_user,
        pass: smtp_password
      }
    };

    // 对于端口465，使用SSL
    if (port === 465) {
      transporterConfig.secure = true;
    } else if (port === 587) {
      // 对于端口587，使用STARTTLS
      transporterConfig.secure = false;
      transporterConfig.requireTLS = true;
    } else {
      // 其他端口，根据用户配置
      transporterConfig.secure = useSecure;
      if (useSecure && port !== 465) {
        transporterConfig.requireTLS = true;
      }
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    // 测试连接
    try {
      await transporter.verify();
    } catch (verifyError) {
      return res.status(400).json({
        success: false,
        message: 'SMTP连接失败：' + verifyError.message
      });
    }

    // 发送测试邮件
    const mailOptions = {
      from: `"${from_name || from_email}" <${from_email}>`,
      to: test_email,
      subject: '邮件配置测试',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>邮件配置测试</h2>
          <p>这是一封测试邮件，用于验证邮件配置是否正确。</p>
          <p><strong>SMTP服务器：</strong>${smtp_host}:${smtp_port}</p>
          <p><strong>发件人：</strong>${from_email}</p>
          <p>如果您收到这封邮件，说明邮件配置已成功！</p>
          <hr>
          <p style="color: #999; font-size: 12px;">此邮件由系统自动发送，请勿回复。</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: `测试邮件已发送到 ${test_email}，请查收`
    });
  } catch (error) {
    console.error('测试邮件发送失败：', error);
    res.status(500).json({
      success: false,
      message: '测试邮件发送失败：' + error.message
    });
  }
});

// 测试邮件连接（使用已保存的配置）
router.post('/email-config/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const { test_email } = req.body;

    if (!test_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(test_email)) {
      return res.status(400).json({ success: false, message: '请输入有效的测试邮箱地址' });
    }

    const configs = await db.query('SELECT * FROM email_config WHERE id = ?', [id]);
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const config = configs[0];

    // 创建邮件传输器
    const port = parseInt(config.smtp_port, 10);
    const useSecure = config.smtp_secure === 1;
    
    // 根据端口和配置自动调整SSL/TLS设置
    const transporterConfig = {
      host: config.smtp_host,
      port: port,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_password
      }
    };

    // 对于端口465，使用SSL
    if (port === 465) {
      transporterConfig.secure = true;
    } else if (port === 587) {
      // 对于端口587，使用STARTTLS
      transporterConfig.secure = false;
      transporterConfig.requireTLS = true;
    } else {
      // 其他端口，根据用户配置
      transporterConfig.secure = useSecure;
      if (useSecure && port !== 465) {
        transporterConfig.requireTLS = true;
      }
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    // 测试连接
    try {
      await transporter.verify();
    } catch (verifyError) {
      return res.status(400).json({
        success: false,
        message: 'SMTP连接失败：' + verifyError.message
      });
    }

    // 发送测试邮件
    const mailOptions = {
      from: `"${config.from_name || config.from_email}" <${config.from_email}>`,
      to: test_email,
      subject: '邮件配置测试',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>邮件配置测试</h2>
          <p>这是一封测试邮件，用于验证邮件配置是否正确。</p>
          <p><strong>应用名称：</strong>${config.app_name}</p>
          <p><strong>SMTP服务器：</strong>${config.smtp_host}:${config.smtp_port}</p>
          <p><strong>发件人：</strong>${config.from_email}</p>
          <p>如果您收到这封邮件，说明邮件配置已成功！</p>
          <hr>
          <p style="color: #999; font-size: 12px;">此邮件由系统自动发送，请勿回复。</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: `测试邮件已发送到 ${test_email}，请查收`
    });
  } catch (error) {
    console.error('测试邮件发送失败：', error);
    res.status(500).json({
      success: false,
      message: '测试邮件发送失败：' + error.message
    });
  }
});

// 系统基础配置相关路由
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// 确保uploads目录存在
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

const formatDateToYMD = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeHolidayDate = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateToYMD(value);
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    if (xlsx?.SSF?.parse_date_code) {
      const parsed = xlsx.SSF.parse_date_code(value);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        const jsDate = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
        return formatDateToYMD(jsDate);
      }
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed
      .replace(/[年\/\\.]/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, '')
      .replace(/--+/g, '-');
    const parsedDate = new Date(normalized);
    if (!Number.isNaN(parsedDate.getTime())) {
      return formatDateToYMD(parsedDate);
    }
  }
  return null;
};

const normalizeIsWorkdayValue = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    if (value === 1) return 1;
    if (value === 0) return 0;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const lower = text.toLowerCase();
  if (
    ['1', 'true', 'yes', 'y', 'workday'].includes(lower) ||
    ['是', '上班', '工作日', '班'].some((token) => text.includes(token))
  ) {
    return 1;
  }
  if (
    ['0', 'false', 'no', 'n', 'holiday', 'weekend'].includes(lower) ||
    ['否', '休', '休息', '放假', '假', '周末'].some((token) => text.includes(token))
  ) {
    return 0;
  }
  return null;
};

const normalizeHolidayType = (value, isWorkday) => {
  const trimmed = (value || '').trim();
  if (HOLIDAY_TYPES.includes(trimmed)) {
    return trimmed;
  }
  return isWorkday ? '工作日' : '法定节假日';
};

const upsertHolidayRecord = async ({ holidayDate, isWorkday, workdayType, holidayName, userId }) => {
  const existing = await db.query(
    'SELECT id, is_deleted FROM holiday_calendar WHERE holiday_date = ?',
    [holidayDate]
  );

  if (existing.length === 0) {
    const newId = await generateId('holiday_calendar');
    await db.execute(
      `INSERT INTO holiday_calendar
       (id, holiday_date, is_workday, workday_type, holiday_name, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId, holidayDate, isWorkday, workdayType, holidayName, userId, userId]
    );
    return newId;
  }

  const record = existing[0];
  await db.execute(
    `UPDATE holiday_calendar
     SET is_deleted = 0,
         deleted_at = NULL,
         deleted_by = NULL,
         is_workday = ?,
         workday_type = ?,
         holiday_name = ?,
         updated_by = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [isWorkday, workdayType, holidayName, userId, record.id]
  );
  return record.id;
};

const logHolidayChange = async (recordId, oldData, newData, userId) => {
  if (!userId) {
    return;
  }
  const fields = ['holiday_date', 'is_workday', 'workday_type', 'holiday_name'];
  for (const field of fields) {
    const oldValue = oldData[field] !== undefined && oldData[field] !== null ? String(oldData[field]) : '';
    const newValue = newData[field] !== undefined && newData[field] !== null ? String(newData[field]) : '';
    if (oldValue !== newValue) {
      const logId = await generateId('data_change_log');
      await db.execute(
        `INSERT INTO data_change_log
         (id, table_name, record_id, changed_field, old_value, new_value, change_user_id)
         VALUES (?, 'holiday_calendar', ?, ?, ?, ?, ?)`,
        [logId, recordId, field, oldValue, newValue, userId]
      );
    }
  }
};

const getMimeTypeByExtension = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
};

const storeConfigFile = async (configKey, filename, mimeType) => {
  try {
    if (!filename) return;
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) return;
    const fileData = fs.readFileSync(filePath);
    const fileSize = fileData.length;
    const existing = await db.query(
      'SELECT id FROM system_file_storage WHERE config_key = ?',
      [configKey]
    );
    if (existing.length > 0) {
      await db.execute(
        'UPDATE system_file_storage SET filename = ?, mime_type = ?, file_size = ?, file_data = ? WHERE config_key = ?',
        [filename, mimeType, fileSize, fileData, configKey]
      );
    } else {
      const fileId = await generateId('system_file_storage');
      await db.execute(
        'INSERT INTO system_file_storage (id, config_key, filename, mime_type, file_size, file_data) VALUES (?, ?, ?, ?, ?, ?)',
        [fileId, configKey, filename, mimeType, fileSize, fileData]
      );
    }
  } catch (error) {
    console.error(`存储配置文件 ${configKey} 失败：`, error);
  }
};

const restoreConfigFile = async (configKey, filename) => {
  if (!filename) return '';
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    return filename;
  }
  try {
    const rows = await db.query(
      'SELECT filename, file_data FROM system_file_storage WHERE config_key = ?',
      [configKey]
    );
    if (rows.length === 0 || !rows[0].file_data) {
      return '';
    }
    const effectiveFilename = rows[0].filename || filename;
    const targetPath = path.join(uploadsDir, effectiveFilename);
    fs.writeFileSync(targetPath, rows[0].file_data);
    return effectiveFilename;
  } catch (error) {
    console.error(`恢复配置文件 ${configKey} 失败：`, error);
    return '';
  }
};

// 获取系统基础配置
router.get('/basic-config', async (req, res) => {
  try {
    const configs = await db.query('SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)', 
      ['system_name', 'logo', 'login_background']);
    
    const result = {
      system_name: '',
      logo: '',
      login_background: ''
    };

    for (const config of configs) {
      if (config.config_key === 'system_name') {
        result.system_name = config.config_value || '';
      } else if (config.config_key === 'logo') {
        const filename = await restoreConfigFile('logo', config.config_value);
        result.logo = filename;
      } else if (config.config_key === 'login_background') {
        const filename = await restoreConfigFile('login_background', config.config_value);
        result.login_background = filename;
      }
    }
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('获取系统基础配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// 更新系统基础配置
router.put('/basic-config', async (req, res) => {
  try {
    const { system_name, logo, login_background } = req.body;
    
    const configs = [];
    if (system_name !== undefined) {
      configs.push({ key: 'system_name', value: system_name });
    }
    if (logo !== undefined) {
      configs.push({ key: 'logo', value: logo });
    }
    if (login_background !== undefined) {
      configs.push({ key: 'login_background', value: login_background });
    }

    if (configs.length === 0) {
      return res.json({ success: true, message: '无可更新的配置' });
    }
    
    for (const config of configs) {
      const existing = await db.query('SELECT id FROM system_config WHERE config_key = ?', [config.key]);
      const value = config.value ?? '';

      if (existing.length > 0) {
        await db.execute('UPDATE system_config SET config_value = ? WHERE config_key = ?', 
          [value, config.key]);
      } else {
        const configId = await generateId('system_config');
        await db.execute(
          'INSERT INTO system_config (id, config_key, config_value, config_desc) VALUES (?, ?, ?, ?)',
          [configId, config.key, value, `系统${config.key === 'system_name' ? '名称' : config.key === 'logo' ? 'Logo' : '登录页底图'}`]
        );
      }
    }
    
    res.json({ success: true, message: '系统配置更新成功' });
  } catch (error) {
    console.error('更新系统基础配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败：' + error.message });
  }
});

// 文件上传
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' });
    }
    
    const fileType = req.body.type; // 'logo' 或 'background'
    console.log('========== 文件上传开始 ==========');
    console.log('接收到的 fileType:', fileType, '类型:', typeof fileType);
    console.log('req.body:', JSON.stringify(req.body));
    
    const configKey = fileType === 'logo' ? 'logo' : 'login_background';
    const originalPath = req.file.path;
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    // 从req.file.filename中提取基础名称（不包含扩展名）
    const uploadedFilename = req.file.filename;
    const uploadedExt = path.extname(uploadedFilename);
    const baseName = path.basename(uploadedFilename, uploadedExt);
    
    // 调试日志
    console.log('文件上传信息:', {
      fileType,
      configKey,
      originalPath,
      originalExt,
      uploadedFilename,
      uploadedExt,
      baseName
    });
    
    // 根据文件类型选择输出格式：logo 使用 PNG（支持透明），背景图使用 JPEG
    const finalExt = fileType === 'logo' ? '.png' : '.jpg';
    const compressedPath = path.join(uploadsDir, `${baseName}${finalExt}`);
    
    console.log('========== 文件处理配置 ==========');
    console.log('finalExt:', finalExt);
    console.log('compressedPath:', compressedPath);
    console.log('fileType === "logo":', fileType === 'logo');
    console.log('fileType === "background":', fileType === 'background');
    console.log('will use PNG:', fileType === 'logo');
    console.log('===================================');
    
    try {
      // 根据文件类型设置压缩参数
      let sharpInstance = sharp(originalPath);
      
      if (fileType === 'logo') {
        // Logo: 压缩为120x120，保留透明背景，使用 PNG 格式
        console.log('========== 处理 Logo 文件 ==========');
        console.log('将输出为 PNG 格式:', compressedPath);
        // 不设置背景色，让 sharp 自动保留透明通道
        sharpInstance = sharpInstance.resize(120, 120, {
          fit: 'contain'
        });
        // 输出为 PNG 格式以保留透明度
        await sharpInstance.png({ 
          quality: 90,
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: false // 不使用调色板，保持真彩色和透明
        }).toFile(compressedPath);
        console.log('Logo PNG 文件生成成功:', compressedPath);
        console.log('文件是否存在:', fs.existsSync(compressedPath));
        console.log('===================================');
      } else if (fileType === 'background') {
        // 背景图: 压缩为1920x1080，使用 JPEG 格式
        sharpInstance = sharpInstance.resize(1920, 1080, {
          fit: 'cover',
          position: 'center'
        });
        // 输出为 JPEG 格式
        await sharpInstance.jpeg({ quality: 75 }).toFile(compressedPath);
      } else {
        // 其他类型，默认使用原格式
        await sharpInstance.toFile(compressedPath);
      }
      
      // 删除原始文件，使用压缩后的文件
      if (fs.existsSync(originalPath)) {
        fs.unlinkSync(originalPath);
      }
      const finalFilename = path.basename(compressedPath);
      
      console.log('文件压缩成功:', {
        original: originalPath,
        compressed: compressedPath,
        finalFilename: finalFilename,
        exists: fs.existsSync(compressedPath)
      });
      
      // 如果是更新logo或背景，删除旧文件
      if (fileType === 'logo' || fileType === 'background') {
        const existing = await db.query('SELECT config_value FROM system_config WHERE config_key = ?', [configKey]);
        
        if (existing.length > 0 && existing[0].config_value) {
          const oldFilePath = path.join(uploadsDir, existing[0].config_value);
          if (fs.existsSync(oldFilePath)) {
            try {
              fs.unlinkSync(oldFilePath);
            } catch (err) {
              console.warn('删除旧文件失败:', err.message);
            }
          }
        }
      }
      
      const mimeType = fileType === 'logo' ? 'image/png' : 'image/jpeg';
      await storeConfigFile(configKey, finalFilename, mimeType);
      res.json({ 
        success: true, 
        message: '文件上传并压缩成功',
        filename: finalFilename
      });
    } catch (compressError) {
      console.error('图片压缩失败，使用原文件:', compressError);
      console.error('压缩错误详情:', {
        fileType,
        originalPath,
        compressedPath,
        error: compressError.message,
        stack: compressError.stack
      });
      
      // 如果压缩失败，对于 logo 类型，尝试直接将原文件转换为 PNG
      if (fileType === 'logo') {
        try {
          console.log('压缩失败，尝试直接转换原文件为 PNG 格式...');
          const pngPath = path.join(uploadsDir, `${baseName}.png`);
          await sharp(originalPath)
            .resize(120, 120, { fit: 'contain' })
            .png({ quality: 90, compressionLevel: 9, adaptiveFiltering: true, palette: false })
            .toFile(pngPath);
          
          const finalFilename = path.basename(pngPath);
          if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath);
          }
          
          // 删除旧文件
          const existing = await db.query('SELECT config_value FROM system_config WHERE config_key = ?', [configKey]);
          if (existing.length > 0 && existing[0].config_value) {
            const oldFilePath = path.join(uploadsDir, existing[0].config_value);
            if (fs.existsSync(oldFilePath)) {
              try {
                fs.unlinkSync(oldFilePath);
              } catch (err) {
                console.warn('删除旧文件失败:', err.message);
              }
            }
          }
          
          await storeConfigFile(configKey, finalFilename, 'image/png');
          res.json({ 
            success: true, 
            message: '文件上传成功（已转换为 PNG 格式）',
            filename: finalFilename
          });
          return;
        } catch (retryError) {
          console.error('PNG 转换也失败:', retryError);
        }
      }
      
      // 如果都失败了，使用原文件
      const finalFilename = req.file.filename;
      
      // 如果是更新logo或背景，删除旧文件
      if (fileType === 'logo' || fileType === 'background') {
        const existing = await db.query('SELECT config_value FROM system_config WHERE config_key = ?', [configKey]);
        
        if (existing.length > 0 && existing[0].config_value) {
          const oldFilePath = path.join(uploadsDir, existing[0].config_value);
          if (fs.existsSync(oldFilePath)) {
            try {
              fs.unlinkSync(oldFilePath);
            } catch (err) {
              console.warn('删除旧文件失败:', err.message);
            }
          }
        }
      }
      
      const mimeType = req.file?.mimetype || getMimeTypeByExtension(finalFilename);
      await storeConfigFile(configKey, finalFilename, mimeType);
      res.json({ 
        success: true, 
        message: '文件上传成功（压缩失败，使用原文件）',
        filename: finalFilename
      });
    }
  } catch (error) {
    console.error('文件上传失败：', error);
    res.status(500).json({ success: false, message: '文件上传失败：' + error.message });
  }
});

// 注意：静态文件访问由 server/index.js 中的 express.static 处理
// 此路由保留作为备用，但通常不会被调用（因为静态文件服务会优先匹配）
router.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  console.log('尝试访问文件:', { filename, filePath, exists: fs.existsSync(filePath) });
  
  if (fs.existsSync(filePath)) {
    // 设置正确的Content-Type
    const ext = path.extname(filename).toLowerCase();
    const contentTypeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(path.resolve(filePath));
  } else {
    console.error('文件不存在:', filePath);
    res.status(404).json({ success: false, message: '文件不存在: ' + filename });
  }
});

// 节假日数据维护
router.get('/holidays', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 10, 1), 100);
    const offset = (page - 1) * pageSize;
    const { year, month, keyword, workdayType, isWorkday } = req.query;

    const conditions = ['hc.is_deleted = 0'];
    const params = [];

    if (year) {
      conditions.push('YEAR(hc.holiday_date) = ?');
      params.push(year);
    }
    if (month) {
      conditions.push('MONTH(hc.holiday_date) = ?');
      params.push(month);
    }
    if (keyword && keyword.trim() !== '') {
      conditions.push('(hc.holiday_name LIKE ? OR DATE_FORMAT(hc.holiday_date, "%Y-%m-%d") LIKE ?)');
      const kw = `%${keyword.trim()}%`;
      params.push(kw, kw);
    }
    if (workdayType && HOLIDAY_TYPES.includes(workdayType)) {
      conditions.push('hc.workday_type = ?');
      params.push(workdayType);
    }
    if (isWorkday === '0' || isWorkday === '1') {
      conditions.push('hc.is_workday = ?');
      params.push(parseInt(isWorkday, 10));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalResult = await db.query(
      `SELECT COUNT(*) as total FROM holiday_calendar hc ${whereClause}`,
      params
    );

    const holidays = await db.query(
      `SELECT hc.*, 
              DATE_FORMAT(hc.holiday_date, '%Y-%m-%d') as holiday_date_text,
              u1.account AS created_by_account,
              u2.account AS updated_by_account,
              u3.account AS deleted_by_account
       FROM holiday_calendar hc
       LEFT JOIN users u1 ON hc.created_by = u1.id
       LEFT JOIN users u2 ON hc.updated_by = u2.id
       LEFT JOIN users u3 ON hc.deleted_by = u3.id
       ${whereClause}
       ORDER BY hc.holiday_date ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      data: holidays.map((item) => ({
        ...item,
        holiday_date: item.holiday_date_text || item.holiday_date
      })),
      total: totalResult[0]?.total || 0,
      page,
      pageSize
    });
  } catch (error) {
    console.error('获取节假日数据失败：', error);
    res.status(500).json({ success: false, message: '获取节假日数据失败' });
  }
});

router.get('/holidays/years', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT YEAR(holiday_date) as year
       FROM holiday_calendar
       WHERE is_deleted = 0
       ORDER BY year DESC`
    );
    const years = rows
      .map((row) => row.year)
      .filter((year) => year !== null && year !== undefined);
    res.json({ success: true, data: years });
  } catch (error) {
    console.error('获取节假年列表失败：', error);
    res.status(500).json({ success: false, message: '获取年份列表失败' });
  }
});

router.post('/holidays', [
  body('holiday_date').notEmpty().withMessage('日期不能为空'),
  body('is_workday').custom((value) => normalizeIsWorkdayValue(value) !== null).withMessage('是否工作日只能填写是/否'),
  body('workday_type').optional().isIn(HOLIDAY_TYPES).withMessage('工作日类型不合法'),
  body('holiday_name').optional().isLength({ max: 100 }).withMessage('节日名称长度不能超过100个字符')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const holidayDate = normalizeHolidayDate(req.body.holiday_date);
    if (!holidayDate) {
      return res.status(400).json({ success: false, message: '日期格式不正确' });
    }

    const isWorkday = normalizeIsWorkdayValue(req.body.is_workday);
    if (isWorkday === null) {
      return res.status(400).json({ success: false, message: '是否工作日只能填写是/否' });
    }

    const workdayType = normalizeHolidayType(req.body.workday_type, isWorkday);
    const holidayName = (req.body.holiday_name || '').trim();
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    const existing = await db.query(
      'SELECT id, is_deleted FROM holiday_calendar WHERE holiday_date = ?',
      [holidayDate]
    );

    if (existing.length > 0 && !existing[0].is_deleted) {
      return res.status(400).json({ success: false, message: '该日期已存在节假日配置' });
    }

    if (existing.length > 0 && existing[0].is_deleted) {
      await db.execute(
        `UPDATE holiday_calendar
         SET is_deleted = 0,
             deleted_by = NULL,
             deleted_at = NULL,
             is_workday = ?,
             workday_type = ?,
             holiday_name = ?,
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [isWorkday, workdayType, holidayName, userId, existing[0].id]
      );

      return res.json({
        success: true,
        message: '节假日记录已恢复并更新',
        data: { id: existing[0].id }
      });
    }

    const holidayId = await generateId('holiday_calendar');
    await db.execute(
      `INSERT INTO holiday_calendar
       (id, holiday_date, is_workday, workday_type, holiday_name, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [holidayId, holidayDate, isWorkday, workdayType, holidayName, userId, userId]
    );

    res.json({ success: true, message: '节假日记录创建成功', data: { id: holidayId } });
  } catch (error) {
    console.error('创建节假日记录失败：', error);
    res.status(500).json({ success: false, message: '创建节假日记录失败' });
  }
});

router.put('/holidays/:id', [
  body('holiday_date').optional(),
  body('is_workday').optional().custom((value) => normalizeIsWorkdayValue(value) !== null).withMessage('是否工作日只能填写是/否'),
  body('workday_type').optional().isIn(HOLIDAY_TYPES).withMessage('工作日类型不合法'),
  body('holiday_name').optional().isLength({ max: 100 }).withMessage('节日名称长度不能超过100个字符')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const existingRows = await db.query(
      `SELECT *, DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date_text
       FROM holiday_calendar WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: '节假日记录不存在' });
    }

    const existing = existingRows[0];
    const updateFields = [];
    const updateValues = [];
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    if (req.body.holiday_date !== undefined) {
      const newDate = normalizeHolidayDate(req.body.holiday_date);
      if (!newDate) {
        return res.status(400).json({ success: false, message: '日期格式不正确' });
      }
      if (newDate !== existing.holiday_date) {
        const duplicate = await db.query(
          'SELECT id FROM holiday_calendar WHERE holiday_date = ? AND id != ? AND is_deleted = 0',
          [newDate, id]
        );
        if (duplicate.length > 0) {
          return res.status(400).json({ success: false, message: '该日期已存在节假日配置' });
        }
      }
      updateFields.push('holiday_date = ?');
      updateValues.push(newDate);
    }

    let resolvedIsWorkday = null;
    if (req.body.is_workday !== undefined) {
      const normalizedIsWorkday = normalizeIsWorkdayValue(req.body.is_workday);
      if (normalizedIsWorkday === null) {
        return res.status(400).json({ success: false, message: '是否工作日只能填写是/否' });
      }
      resolvedIsWorkday = normalizedIsWorkday;
      updateFields.push('is_workday = ?');
      updateValues.push(normalizedIsWorkday);
    }

    if (req.body.workday_type !== undefined) {
      const typeBase = resolvedIsWorkday !== null ? resolvedIsWorkday : existing.is_workday;
      const normalizedType = normalizeHolidayType(req.body.workday_type, typeBase);
      updateFields.push('workday_type = ?');
      updateValues.push(normalizedType);
    }

    if (req.body.holiday_name !== undefined) {
      updateFields.push('holiday_name = ?');
      updateValues.push((req.body.holiday_name || '').trim());
    }

    if (updateFields.length === 0) {
      return res.json({ success: true, message: '未检测到变更' });
    }

    updateFields.push('updated_by = ?');
    updateValues.push(userId);
    updateFields.push('updated_at = CURRENT_TIMESTAMP');

    updateValues.push(id);

    await db.execute(
      `UPDATE holiday_calendar SET ${updateFields.join(', ')} WHERE id = ? AND is_deleted = 0`,
      updateValues
    );

    const updatedRows = await db.query(
      `SELECT holiday_date, DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date_text,
              is_workday, workday_type, holiday_name
       FROM holiday_calendar WHERE id = ?`,
      [id]
    );
    if (updatedRows.length > 0) {
      const newData = updatedRows[0];
      await logHolidayChange(
        id,
        {
          holiday_date: existing.holiday_date_text || existing.holiday_date,
          is_workday: existing.is_workday,
          workday_type: existing.workday_type,
          holiday_name: existing.holiday_name
        },
        newData,
        userId
      );
    }

    res.json({ success: true, message: '节假日记录更新成功' });
  } catch (error) {
    console.error('更新节假日记录失败：', error);
    res.status(500).json({ success: false, message: '更新节假日记录失败' });
  }
});

router.delete('/holidays/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'] || req.body.userId || null;
    const result = await db.execute(
      `UPDATE holiday_calendar
       SET is_deleted = 1,
           deleted_by = ?,
           deleted_at = CURRENT_TIMESTAMP
       WHERE id = ? AND is_deleted = 0`,
      [userId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '节假日记录不存在或已删除' });
    }

    res.json({ success: true, message: '节假日记录删除成功' });
  } catch (error) {
    console.error('删除节假日记录失败：', error);
    res.status(500).json({ success: false, message: '删除节假日记录失败' });
  }
});

router.get('/holidays/template', (req, res) => {
  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['日期', '是否工作日(是/否)', '工作日类型', '节日名称']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, '节假日模板');
    const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const filename = encodeURIComponent('节假日维护模板.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('生成节假日模板失败：', error);
    res.status(500).json({ success: false, message: '模板生成失败' });
  }
});

router.post('/holidays/import', excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传Excel文件' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: '未检测到数据工作表' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Excel内容为空' });
    }

    const headers = rows[0].map((cell) => String(cell || '').trim());
    if (
      headers[0] !== '日期' ||
      !(headers[1]?.startsWith('是否工作日')) ||
      headers[2] !== '工作日类型' ||
      headers[3] !== '节日名称'
    ) {
      return res.status(400).json({ success: false, message: '模板表头不匹配，请下载最新模板' });
    }

    const dataRows = rows.slice(1).filter((row) =>
      row.some((cell) => String(cell || '').trim() !== '')
    );

    if (!dataRows.length) {
      return res.status(400).json({ success: false, message: '未检测到可导入的数据' });
    }

    const errors = [];
    let successCount = 0;
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    for (let i = 0; i < dataRows.length; i += 1) {
      const rowNumber = i + 2;
      const [dateCell, workdayCell, typeCell, nameCell] = dataRows[i];
      const normalizedDate = normalizeHolidayDate(dateCell);
      const normalizedWorkday = normalizeIsWorkdayValue(workdayCell);
      const normalizedType = normalizeHolidayType(typeCell, normalizedWorkday ?? 0);
      const holidayName = (nameCell || '').toString().trim();

      if (!normalizedDate) {
        errors.push({ row: rowNumber, message: '日期格式不正确' });
        continue;
      }
      if (normalizedWorkday === null) {
        errors.push({ row: rowNumber, message: '是否工作日列只能填写是/否' });
        continue;
      }
      if (!HOLIDAY_TYPES.includes(normalizedType)) {
        errors.push({ row: rowNumber, message: '工作日类型不合法' });
        continue;
      }

      try {
        await upsertHolidayRecord({
          holidayDate: normalizedDate,
          isWorkday: normalizedWorkday,
          workdayType: normalizedType,
          holidayName,
          userId
        });
        successCount += 1;
      } catch (err) {
        errors.push({ row: rowNumber, message: err.message || '导入失败' });
      }
    }

    res.json({
      success: true,
      message: `成功导入 ${successCount} 条记录`,
      errors
    });
  } catch (error) {
    console.error('导入节假日数据失败：', error);
    res.status(500).json({ success: false, message: '导入节假日数据失败：' + error.message });
  }
});

router.post('/holidays/generate', [
  body('year')
    .notEmpty().withMessage('年份不能为空')
    .isInt({ min: 2000, max: 2100 }).withMessage('年份需在2000-2100之间')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const year = parseInt(req.body.year, 10);
    if (Number.isNaN(year)) {
      return res.status(400).json({ success: false, message: '年份格式不正确' });
    }

    const userId = req.headers['x-user-id'] || req.body.userId || null;
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year + 1, 0, 1));
    const existingRows = await db.query(
      `SELECT holiday_date, is_deleted FROM holiday_calendar 
       WHERE holiday_date >= ? AND holiday_date < ?`,
      [formatDateToYMD(startDate), formatDateToYMD(endDate)]
    );

    const existingMap = new Map();
    existingRows.forEach((row) => {
      const key = formatDateToYMD(new Date(row.holiday_date));
      existingMap.set(key, row.is_deleted === 0);
    });

    let created = 0;
    let skipped = 0;
    for (let date = new Date(startDate); date < endDate; date.setUTCDate(date.getUTCDate() + 1)) {
      const weekday = date.getUTCDay(); // 0 Sunday
      if (weekday === 0 || weekday === 6) {
        const dateStr = formatDateToYMD(date);
        if (existingMap.get(dateStr) === true) {
          skipped += 1;
          continue;
        }
        await upsertHolidayRecord({
          holidayDate: dateStr,
          isWorkday: 0,
          workdayType: '周末',
          holidayName: '',
          userId
        });
        existingMap.set(dateStr, true);
        created += 1;
      }
    }

    res.json({
      success: true,
      message: `生成完成，新增 ${created} 条周末记录，跳过 ${skipped} 条已存在记录`
    });
  } catch (error) {
    console.error('批量生成周末节假日失败：', error);
    res.status(500).json({ success: false, message: '生成失败：' + error.message });
  }
});

router.get('/holidays/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.id, l.changed_field, l.old_value, l.new_value, l.change_time,
              u.account AS change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'holiday_calendar' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取节假日日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

router.get('/holidays/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'holiday_calendar' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取节假日操作日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 数据库连接配置相关路由
// 获取数据库配置列表（支持分页）
router.get('/database-configs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    // 获取总数
    const totalResult = await db.query('SELECT COUNT(*) as total FROM external_db_config WHERE is_deleted = 0');
    const total = totalResult[0].total;

    // 获取分页数据
    const configs = await db.query(`
      SELECT id, name, db_type, host, port, \`user\`, \`database\`, is_active, created_at, updated_at
      FROM external_db_config
      WHERE is_deleted = 0
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

    res.json({
      success: true,
      data: configs,
      total: total,
      page: page,
      pageSize: pageSize
    });
  } catch (error) {
    console.error('获取数据库配置列表失败：', error);
    res.status(500).json({ success: false, message: '获取配置列表失败' });
  }
});

// 获取单个数据库配置（不包含密码）
router.get('/database-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const configs = await db.query(`
      SELECT id, name, db_type, host, port, \`user\`, \`database\`, is_active, created_at, updated_at
      FROM external_db_config
      WHERE id = ? AND is_deleted = 0
    `, [id]);
    if (configs.length > 0) {
      res.json({ success: true, data: configs[0] });
    } else {
      res.status(404).json({ success: false, message: '配置不存在' });
    }
  } catch (error) {
    console.error('获取数据库配置失败：', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// 创建数据库配置
router.post('/database-config', [
  body('name').notEmpty().withMessage('配置名称不能为空'),
  body('db_type').isIn(['mysql']).withMessage('数据库类型必须是mysql'),
  body('host').notEmpty().withMessage('主机地址不能为空'),
  body('port').isInt({ min: 1, max: 65535 }).withMessage('端口必须是1-65535之间的整数'),
  body('user').notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
  body('database').notEmpty().withMessage('数据库名不能为空'),
  body('is_active').optional().isBoolean().withMessage('is_active必须是布尔值'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, db_type, host, port, user, password, database, is_active } = req.body;

    // 检查配置名称是否已存在
    const existing = await db.query(
      'SELECT id FROM external_db_config WHERE name = ? AND is_deleted = 0',
      [name]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '配置名称已存在' });
    }

    const configId = await generateId('external_db_config');
    const userId = req.headers['x-user-id'] || null;
    const finalIsActive = is_active !== undefined ? (is_active ? 1 : 0) : 1;

    await db.execute(
      `INSERT INTO external_db_config 
       (id, name, db_type, host, port, \`user\`, password, \`database\`, is_active, created_by, updated_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId,
        name,
        db_type || 'mysql',
        host,
        port,
        user,
        password,
        database,
        finalIsActive,
        userId,
        userId
      ]
    );

    res.json({ success: true, message: '数据库配置创建成功', data: { id: configId } });
  } catch (error) {
    console.error('创建数据库配置失败：', error);
    res.status(500).json({ success: false, message: '创建配置失败：' + error.message });
  }
});

// 更新数据库配置
router.put('/database-config/:id', [
  body('name').optional().notEmpty().withMessage('配置名称不能为空'),
  body('host').optional().notEmpty().withMessage('主机地址不能为空'),
  body('port').optional().isInt({ min: 1, max: 65535 }).withMessage('端口必须是1-65535之间的整数'),
  body('user').optional().notEmpty().withMessage('用户名不能为空'),
  body('database').optional().notEmpty().withMessage('数据库名不能为空'),
  body('is_active').optional().isBoolean().withMessage('is_active必须是布尔值'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { name, host, port, user, password, database, is_active } = req.body;

    // 检查配置是否存在
    const existingConfigs = await db.query('SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0', [id]);
    if (existingConfigs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    // 如果更新配置名称，检查是否重复
    if (name) {
      const duplicate = await db.query(
        'SELECT id FROM external_db_config WHERE name = ? AND id != ? AND is_deleted = 0',
        [name, id]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ success: false, message: '配置名称已存在' });
      }
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (host !== undefined) {
      updateFields.push('host = ?');
      updateValues.push(host);
    }
    if (port !== undefined) {
      updateFields.push('port = ?');
      updateValues.push(port);
    }
    if (user !== undefined) {
      updateFields.push('`user` = ?');
      updateValues.push(user);
    }
    if (password !== undefined && password !== null && password !== '') {
      updateFields.push('password = ?');
      updateValues.push(password);
    }
    if (database !== undefined) {
      updateFields.push('`database` = ?');
      updateValues.push(database);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(is_active ? 1 : 0);
    }

    if (updateFields.length > 0) {
      const userId = req.headers['x-user-id'] || null;
      updateFields.push('updated_by = ?');
      updateValues.push(userId);
      updateValues.push(id);
      await db.execute(
        `UPDATE external_db_config SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    res.json({ success: true, message: '数据库配置更新成功' });
  } catch (error) {
    console.error('更新数据库配置失败：', error);
    res.status(500).json({ success: false, message: '更新配置失败：' + error.message });
  }
});

// 删除数据库配置
router.delete('/database-config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM external_db_config WHERE id = ? AND is_deleted = 0', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const userId = req.headers['x-user-id'] || null;
    await db.execute(
      `UPDATE external_db_config 
       SET is_deleted = 1, deleted_by = ?, deleted_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [userId, id]
    );
    res.json({ success: true, message: '数据库配置删除成功' });
  } catch (error) {
    console.error('删除数据库配置失败：', error);
    res.status(500).json({ success: false, message: '删除配置失败' });
  }
});

// 测试数据库连接（使用表单数据）
router.post('/database-config/test', async (req, res) => {
  try {
    const { db_type, host, port, user, password, database } = req.body;

    if (!host || !port || !user || !password || !database) {
      return res.status(400).json({ success: false, message: '请填写完整的数据库配置信息' });
    }

    if (db_type !== 'mysql') {
      return res.status(400).json({ success: false, message: '当前仅支持MySQL数据库' });
    }

    // 尝试连接数据库
    const mysql = require('mysql2/promise');
    let connection;
    try {
      connection = await mysql.createConnection({
        host: host,
        port: parseInt(port, 10),
        user: user,
        password: password,
        database: database,
        connectTimeout: 5000
      });

      // 测试查询
      await connection.query('SELECT 1');
      await connection.end();

      res.json({
        success: true,
        message: '数据库连接测试成功'
      });
    } catch (connectError) {
      if (connection) {
        await connection.end().catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: '数据库连接失败：' + connectError.message
      });
    }
  } catch (error) {
    console.error('测试数据库连接失败：', error);
    res.status(500).json({
      success: false,
      message: '测试失败：' + error.message
    });
  }
});

// 测试数据库连接（使用已保存的配置）
router.post('/database-config/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const configs = await db.query('SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0', [id]);
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const config = configs[0];

    if (config.db_type !== 'mysql') {
      return res.status(400).json({ success: false, message: '当前仅支持MySQL数据库' });
    }

    // 尝试连接数据库
    const mysql = require('mysql2/promise');
    let connection;
    try {
      connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectTimeout: 5000
      });

      // 测试查询
      await connection.query('SELECT 1');
      await connection.end();

      res.json({
        success: true,
        message: '数据库连接测试成功'
      });
    } catch (connectError) {
      if (connection) {
        await connection.end().catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: '数据库连接失败：' + connectError.message
      });
    }
  } catch (error) {
    console.error('测试数据库连接失败：', error);
    res.status(500).json({
      success: false,
      message: '测试失败：' + error.message
    });
  }
});

module.exports = router;

