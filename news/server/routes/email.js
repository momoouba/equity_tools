const express = require('express');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');

const router = express.Router();

// 获取邮件收发记录（分页）
router.get('/records', async (req, res) => {
  try {
    const { email_config_id, page = 1, pageSize = 10 } = req.query;
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';
    
    if (!email_config_id) {
      return res.status(400).json({ success: false, message: '请提供邮件配置ID' });
    }

    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let whereClause = 'email_config_id = ?';
    let queryParams = [email_config_id];

    // 如果不是管理员，只显示发送给当前用户配置的收件人的邮件
    if (userRole !== 'admin' && userId) {
      // 获取当前用户的收件管理配置中的收件人邮箱列表
      const recipientConfigs = await db.query(
        `SELECT recipient_email 
         FROM recipient_management 
         WHERE user_id = ? AND is_deleted = 0 AND is_active = 1`,
        [userId]
      );
      
      if (recipientConfigs.length === 0) {
        // 用户没有配置收件人，返回空结果
        return res.json({
          success: true,
          data: [],
          total: 0,
          page: parseInt(page),
          pageSize: parseInt(pageSize)
        });
      }
      
      // 收集所有收件人邮箱
      const recipientEmails = [];
      recipientConfigs.forEach(config => {
        const emails = config.recipient_email.split(/[,;\n\r]+/).map(e => e.trim()).filter(e => e);
        recipientEmails.push(...emails);
      });
      
      if (recipientEmails.length === 0) {
        return res.json({
          success: true,
          data: [],
          total: 0,
          page: parseInt(page),
          pageSize: parseInt(pageSize)
        });
      }
      
      // 构建查询条件：to_email 中包含任何一个收件人邮箱
      // 使用 FIND_IN_SET 或 LIKE 来匹配（因为 to_email 可能是逗号分隔的多个邮箱）
      const emailConditions = recipientEmails.map(() => '(FIND_IN_SET(?, REPLACE(REPLACE(REPLACE(to_email, ";", ","), "\\n", ","), "\\r", ",")) > 0 OR to_email LIKE ?)').join(' OR ');
      whereClause += ` AND (${emailConditions})`;
      recipientEmails.forEach(email => {
        queryParams.push(email, `%${email}%`);
      });
    }

    // 获取总数
    const [totalResult] = await db.query(
      `SELECT COUNT(*) as total FROM email_logs WHERE ${whereClause}`,
      queryParams
    );
    const total = totalResult.total || 0;

    // 获取分页数据
    const records = await db.query(
      `SELECT id, operation_type, from_email, to_email, cc_email, bcc_email, 
              subject, status, created_at
       FROM email_logs 
       WHERE ${whereClause}
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(pageSize), offset]
    );

    res.json({
      success: true,
      data: records,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取邮件记录失败：', error);
    res.status(500).json({ success: false, message: '获取邮件记录失败：' + error.message });
  }
});

// 获取邮件日志（分页，包含错误信息）
router.get('/logs', async (req, res) => {
  try {
    const { email_config_id, page = 1, pageSize = 10 } = req.query;
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';
    
    if (!email_config_id) {
      return res.status(400).json({ success: false, message: '请提供邮件配置ID' });
    }

    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let whereClause = 'email_config_id = ?';
    let queryParams = [email_config_id];

    // 如果不是管理员，只显示发送给当前用户配置的收件人的邮件
    if (userRole !== 'admin' && userId) {
      // 获取当前用户的收件管理配置中的收件人邮箱列表
      const recipientConfigs = await db.query(
        `SELECT recipient_email 
         FROM recipient_management 
         WHERE user_id = ? AND is_deleted = 0 AND is_active = 1`,
        [userId]
      );
      
      if (recipientConfigs.length === 0) {
        // 用户没有配置收件人，返回空结果
        return res.json({
          success: true,
          data: [],
          total: 0,
          page: parseInt(page),
          pageSize: parseInt(pageSize)
        });
      }
      
      // 收集所有收件人邮箱
      const recipientEmails = [];
      recipientConfigs.forEach(config => {
        const emails = config.recipient_email.split(/[,;\n\r]+/).map(e => e.trim()).filter(e => e);
        recipientEmails.push(...emails);
      });
      
      if (recipientEmails.length === 0) {
        return res.json({
          success: true,
          data: [],
          total: 0,
          page: parseInt(page),
          pageSize: parseInt(pageSize)
        });
      }
      
      // 构建查询条件：to_email 中包含任何一个收件人邮箱
      // 使用 FIND_IN_SET 或 LIKE 来匹配（因为 to_email 可能是逗号分隔的多个邮箱）
      const emailConditions = recipientEmails.map(() => '(FIND_IN_SET(?, REPLACE(REPLACE(REPLACE(to_email, ";", ","), "\\n", ","), "\\r", ",")) > 0 OR to_email LIKE ?)').join(' OR ');
      whereClause += ` AND (${emailConditions})`;
      recipientEmails.forEach(email => {
        queryParams.push(email, `%${email}%`);
      });
    }

    // 获取总数
    const [totalResult] = await db.query(
      `SELECT COUNT(*) as total FROM email_logs WHERE ${whereClause}`,
      queryParams
    );
    const total = totalResult.total || 0;

    // 获取分页数据
    const logs = await db.query(
      `SELECT id, operation_type, from_email, to_email, subject, status, 
              error_message, created_at, created_by
       FROM email_logs 
       WHERE ${whereClause}
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(pageSize), offset]
    );

    res.json({
      success: true,
      data: logs,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取邮件日志失败：', error);
    res.status(500).json({ success: false, message: '获取邮件日志失败：' + error.message });
  }
});

// 发送邮件
router.post('/send', [
  body('email_config_id').notEmpty().withMessage('邮件配置ID不能为空'),
  body('to_email').notEmpty().withMessage('收件人邮箱不能为空'),
  body('subject').notEmpty().withMessage('邮件主题不能为空'),
  body('content').notEmpty().withMessage('邮件内容不能为空'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email_config_id, to_email, cc_email, bcc_email, subject, content } = req.body;
    // 从请求头获取用户ID（如果前端有发送）
    const userId = req.headers['x-user-id'] || null;

    // 获取邮件配置
    const configs = await db.query('SELECT * FROM email_config WHERE id = ?', [email_config_id]);
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '邮件配置不存在' });
    }

    const config = configs[0];

    // 创建邮件传输器
    const port = parseInt(config.smtp_port, 10);
    const useSecure = config.smtp_secure === 1;
    
    const transporterConfig = {
      host: config.smtp_host,
      port: port,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_password
      }
    };

    // 根据端口自动调整SSL/TLS设置
    if (port === 465) {
      transporterConfig.secure = true;
    } else if (port === 587) {
      transporterConfig.secure = false;
      transporterConfig.requireTLS = true;
    } else {
      transporterConfig.secure = useSecure;
      if (useSecure && port !== 465) {
        transporterConfig.requireTLS = true;
      }
    }

    const transporter = nodemailer.createTransport(transporterConfig);

    // 准备邮件选项
    const mailOptions = {
      from: `"${config.from_name || config.from_email}" <${config.from_email}>`,
      to: to_email,
      subject: subject,
      html: content.replace(/\n/g, '<br>')
    };

    if (cc_email) {
      mailOptions.cc = cc_email;
    }
    if (bcc_email) {
      mailOptions.bcc = bcc_email;
    }

    let logId = null;
    let status = 'success';
    let errorMessage = null;

    try {
      // 发送邮件
      await transporter.sendMail(mailOptions);

      // 记录成功日志
      logId = generateId('email_logs');
      await db.query(
        `INSERT INTO email_logs 
         (id, email_config_id, operation_type, from_email, to_email, cc_email, bcc_email, 
          subject, content, status, created_by) 
         VALUES (?, ?, 'send', ?, ?, ?, ?, ?, ?, 'success', ?)`,
        [logId, email_config_id, config.from_email, to_email, cc_email || null, 
         bcc_email || null, subject, content, userId]
      );

      res.json({
        success: true,
        message: '邮件发送成功',
        log_id: logId
      });
    } catch (sendError) {
      // 记录失败日志
      status = 'failed';
      errorMessage = sendError.message;

      logId = generateId('email_logs');
      await db.query(
        `INSERT INTO email_logs 
         (id, email_config_id, operation_type, from_email, to_email, cc_email, bcc_email, 
          subject, content, status, error_message, created_by) 
         VALUES (?, ?, 'send', ?, ?, ?, ?, ?, ?, 'failed', ?, ?)`,
        [logId, email_config_id, config.from_email, to_email, cc_email || null, 
         bcc_email || null, subject, content, errorMessage, userId]
      );

      console.error('邮件发送失败：', sendError);
      res.status(500).json({
        success: false,
        message: '邮件发送失败：' + sendError.message,
        log_id: logId
      });
    }
  } catch (error) {
    console.error('发送邮件处理失败：', error);
    res.status(500).json({ success: false, message: '发送邮件处理失败：' + error.message });
  }
});

// 接收邮件（POP3）
router.post('/receive', [
  body('email_config_id').notEmpty().withMessage('邮件配置ID不能为空'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email_config_id } = req.body;
    // 从请求头获取用户ID（如果前端有发送）
    const userId = req.headers['x-user-id'] || null;

    // 获取邮件配置
    const configs = await db.query('SELECT * FROM email_config WHERE id = ?', [email_config_id]);
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '邮件配置不存在' });
    }

    const config = configs[0];

    if (!config.pop_host || !config.pop_port || !config.pop_user || !config.pop_password) {
      return res.status(400).json({ success: false, message: 'POP配置不完整，无法接收邮件' });
    }

    // 注意：这里需要使用POP3客户端库（如node-imap或mailparser）
    // 由于nodemailer主要用于发送邮件，接收邮件需要使用其他库
    // 这里先返回一个提示，后续可以集成node-imap等库
    
    const logId = generateId('email_logs');
    const errorMessage = 'POP3接收功能暂未实现，需要集成node-imap等库';
    
    await db.query(
      `INSERT INTO email_logs 
       (id, email_config_id, operation_type, from_email, to_email, 
        subject, status, error_message, created_by) 
       VALUES (?, ?, 'receive', ?, ?, ?, 'failed', ?, ?)`,
      [logId, email_config_id, config.pop_user, config.pop_user, 
       '接收邮件', errorMessage, userId]
    );

    res.status(501).json({
      success: false,
      message: errorMessage,
      log_id: logId
    });
  } catch (error) {
    console.error('接收邮件处理失败：', error);
    res.status(500).json({ success: false, message: '接收邮件处理失败：' + error.message });
  }
});

module.exports = router;

