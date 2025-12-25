const db = require('../db');
const nodemailer = require('nodemailer');
const { generateId } = require('./idGenerator');

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
 * 获取邮件发送的时间范围（与新闻同步一致：从节假日前的一个工作日到当前工作日）
 */
async function getEmailTimeRange() {
  const { getEmailTimeRange: getEmailTimeRangeFromScheduled } = require('./scheduledEmailTasks');
  return await getEmailTimeRangeFromScheduled();
}

/**
 * 获取前一天的开始和结束时间（保留用于兼容性）
 * @deprecated 使用 getEmailTimeRange 代替，以保持与新闻同步一致
 */
function getYesterdayTimeRange() {
  const now = new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  // 创建Asia/Shanghai时区的今天00:00:00（使用ISO字符串方式，确保时区正确）
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
  const todayStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T00:00:00+08:00`;
  const today = new Date(todayStr);
  
  // 创建本地时区的昨天00:00:00
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  return {
    from: formatDate(yesterday),
    to: formatDate(today)
  };
}

/**
 * 查询新闻，按企业分组（时间范围：从节假日前的一个工作日到当前工作日，与新闻同步一致）
 */
async function getYesterdayNewsByEnterprise() {
  const { from, to } = await getEmailTimeRange();
  
  console.log(`查询新闻（与新闻同步一致的时间范围）: ${from} 到 ${to}`);
  
  // 查询前一天的所有新闻（有企业全称的）
  const newsList = await db.query(
    `SELECT id, title, enterprise_full_name, news_sentiment, keywords, 
            news_abstract, public_time, account_name, source_url, created_at
     FROM news_detail 
     WHERE enterprise_full_name IS NOT NULL 
     AND enterprise_full_name != ''
     AND public_time >= ? 
     AND public_time < ?
     AND delete_mark = 0
     ORDER BY enterprise_full_name, public_time DESC`,
    [from, to]
  );
  
  // 按企业分组（过滤掉企业名称为null或空字符串的新闻）
  const newsByEnterprise = {};
  for (const news of newsList) {
    const enterpriseName = news.enterprise_full_name;
    // 确保企业名称不为null、不为空字符串
    if (enterpriseName && enterpriseName.trim() !== '') {
    if (!newsByEnterprise[enterpriseName]) {
      newsByEnterprise[enterpriseName] = [];
    }
    newsByEnterprise[enterpriseName].push(news);
    } else {
      // 记录被过滤掉的新闻（用于调试）
      console.log(`[邮件发送] 过滤掉企业名称为空的新闻: ${news.id} - ${news.title}`);
    }
  }
  
  return newsByEnterprise;
}

/**
 * 解析关键词（可能是JSON字符串或数组）
 */
function parseKeywords(keywords) {
  if (!keywords) return [];
  if (typeof keywords === 'string') {
    try {
      const parsed = JSON.parse(keywords);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return Array.isArray(keywords) ? keywords : [];
}

/**
 * 格式化新闻标签（返回HTML格式的圆角色块）
 */
function formatNewsTags(keywords) {
  const tags = parseKeywords(keywords);
  if (tags.length === 0) {
    return '';
  }
  
  // 为每个标签生成圆角色块
  return tags.map(tag => {
    return `<span style="display: inline-block; background-color: #e3f2fd; color: #1976d2; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin-right: 6px; margin-bottom: 4px; font-weight: 500;">${tag}</span>`;
  }).join('');
}

/**
 * 格式化新闻情绪（返回HTML格式的圆角色块）
 */
function formatNewsSentiment(sentiment) {
  const sentimentMap = {
    'positive': { text: '正面', color: '#4caf50', bgColor: '#e8f5e9' },
    'negative': { text: '负面', color: '#f44336', bgColor: '#ffebee' },
    'neutral': { text: '中性', color: '#757575', bgColor: '#f5f5f5' }
  };
  
  const sentimentInfo = sentimentMap[sentiment] || { text: sentiment || '未知', color: '#9e9e9e', bgColor: '#f5f5f5' };
  
  return `<span style="display: inline-block; background-color: ${sentimentInfo.bgColor}; color: ${sentimentInfo.color}; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">${sentimentInfo.text}</span>`;
}

/**
 * 格式化发布时间
 */
function formatPublicTime(timeStr) {
  if (!timeStr) return '未知时间';
  try {
    const date = new Date(timeStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch (e) {
    return timeStr;
  }
}

/**
 * 生成邮件HTML内容
 * @param {Object} newsByEnterprise - 按企业分组的新闻数据
 * @param {string} timeRangeFrom - 时间范围开始时间（可选）
 */
function generateEmailContent(newsByEnterprise, timeRangeFrom = null) {
  // 如果没有提供时间范围，使用默认的昨天（兼容旧代码）
  const dateStr = timeRangeFrom || (() => {
    const { from } = getYesterdayTimeRange();
    return from;
  })();
  
  if (Object.keys(newsByEnterprise).length === 0) {
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
        <h2 style="color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
          【企业新闻】未获取到企业相关信息
        </h2>
        <p style="color: #666; margin-bottom: 30px;">
          日期：${formatPublicTime(dateStr)}
        </p>
        <p style="color: #555; font-size: 16px; padding: 20px; background-color: #f9f9f9; border-radius: 5px;">
          昨日未获取到企业相关信息
        </p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          此邮件由系统自动发送，请勿回复。
        </p>
      </div>
    `;
  }
  
  let html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
      <h2 style="color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
        舆情信息日报
      </h2>
      <p style="color: #666; margin-bottom: 30px;">
        日期：${formatPublicTime(dateStr)}
      </p>
  `;
  
  // 按企业分组显示
  for (const [enterpriseName, newsList] of Object.entries(newsByEnterprise)) {
    // 只有分组键为null的才显示"——榜单或获奖信息"（这些是包含榜单/获奖标签的额外公众号新闻）
    // 其他空企业名称的新闻保持原样显示（可能是空字符串或其他值）
    const displayEnterpriseName = (enterpriseName === null) 
      ? '——榜单或获奖信息' 
      : (enterpriseName || '未关联企业');
    
    html += `
      <div style="margin-bottom: 40px; border-left: 4px solid #4CAF50; padding-left: 20px;">
        <h3 style="color: #2c3e50; margin-bottom: 20px; font-size: 18px;">
          ${displayEnterpriseName}
        </h3>
    `;
    
    for (const news of newsList) {
      const tags = formatNewsTags(news.keywords);
      const sentiment = formatNewsSentiment(news.news_sentiment);
      const publicTime = formatPublicTime(news.public_time);
      const accountName = news.account_name || '未知公众号';
      const sourceUrl = news.source_url || '#';
      const abstract = news.news_abstract || '暂无摘要';
      
      html += `
        <div style="margin-bottom: 25px; padding: 15px; background-color: #f9f9f9; border-radius: 5px;">
          <div style="margin-bottom: 12px;">
            <div style="margin-bottom: 8px;">
              <strong style="color: #2c3e50; font-size: 16px; line-height: 1.5;">${news.title || '无标题'}</strong>
            </div>
            <div style="line-height: 1.8;">
              ${tags}
              ${sentiment}
            </div>
          </div>
          <div style="color: #555; margin-bottom: 10px; line-height: 1.8;">
            ${abstract}
          </div>
          <div style="color: #888; font-size: 13px;">
            ${publicTime}，${accountName}，
            <a href="${sourceUrl}" target="_blank" style="color: #4CAF50; text-decoration: none;">
              原文链接
            </a>
          </div>
        </div>
      `;
    }
    
    html += `</div>`;
  }
  
  html += `
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="color: #999; font-size: 12px; text-align: center;">
        此邮件由系统自动发送，请勿回复。
      </p>
    </div>
  `;
  
  return html;
}

/**
 * 生成邮件纯文本内容（备用）
 * @param {Object} newsByEnterprise - 按企业分组的新闻数据
 * @param {string} timeRangeFrom - 时间范围开始时间（可选）
 */
function generateEmailTextContent(newsByEnterprise, timeRangeFrom = null) {
  // 如果没有提供时间范围，使用默认的昨天（兼容旧代码）
  const dateStr = timeRangeFrom || (() => {
    const { from } = getYesterdayTimeRange();
    return from;
  })();
  
  if (Object.keys(newsByEnterprise).length === 0) {
    return `【企业新闻】未获取到企业相关信息\n\n日期：${formatPublicTime(dateStr)}\n\n未获取到企业相关信息\n`;
  }
  
  let text = `舆情信息日报\n\n日期：${formatPublicTime(dateStr)}\n\n`;
  
  for (const [enterpriseName, newsList] of Object.entries(newsByEnterprise)) {
    text += `${enterpriseName}\n${'='.repeat(50)}\n\n`;
    
    for (const news of newsList) {
      const tags = formatNewsTags(news.keywords);
      const sentiment = formatNewsSentiment(news.news_sentiment);
      const publicTime = formatPublicTime(news.public_time);
      const accountName = news.account_name || '未知公众号';
      const sourceUrl = news.source_url || '#';
      const abstract = news.news_abstract || '暂无摘要';
      
      text += `${news.title || '无标题'} ${tags} ${sentiment}\n`;
      text += `${abstract}\n`;
      text += `${publicTime}，${accountName}，${sourceUrl}\n\n`;
    }
    
    text += '\n';
  }
  
  return text;
}

/**
 * 发送邮件给收件人
 */
async function sendNewsEmail(recipientConfig, emailConfig, newsByEnterprise) {
  try {
    // 创建邮件传输器
    const port = parseInt(emailConfig.smtp_port, 10);
    
    const transporterConfig = {
      host: emailConfig.smtp_host,
      port: port,
      auth: {
        user: emailConfig.smtp_user,
        pass: emailConfig.smtp_password
      }
    };
    
    // 根据端口自动调整SSL/TLS设置
    if (port === 465) {
      transporterConfig.secure = true;
    } else if (port === 587) {
      transporterConfig.secure = false;
      transporterConfig.requireTLS = true;
    } else {
      transporterConfig.secure = emailConfig.smtp_secure === 1;
      if (emailConfig.smtp_secure === 1 && port !== 465) {
        transporterConfig.requireTLS = true;
      }
    }
    
    const transporter = nodemailer.createTransport(transporterConfig);
    
    // 获取时间范围（用于邮件主题和内容）
    const timeRange = await getEmailTimeRange();
    
    // 生成邮件内容（使用与新闻同步一致的时间范围）
    const htmlContent = generateEmailContent(newsByEnterprise, timeRange.from);
    const textContent = generateEmailTextContent(newsByEnterprise, timeRange.from);
    
    // 邮件主题
    const subject = recipientConfig.email_subject || 
                   `舆情信息日报 - ${formatPublicTime(timeRange.from)}`;
    
    // 解析收件人邮箱（支持多个，用逗号、分号或换行分隔）
    const recipientEmails = recipientConfig.recipient_email
      .split(/[,;\n\r]+/)
      .map(email => email.trim())
      .filter(email => email && email.includes('@'));
    
    if (recipientEmails.length === 0) {
      throw new Error('收件人邮箱格式不正确');
    }
    
    // 准备邮件选项
    const mailOptions = {
      from: `"${emailConfig.from_name || emailConfig.from_email}" <${emailConfig.from_email}>`,
      to: recipientEmails.join(','),
      subject: subject,
      html: htmlContent,
      text: textContent
    };
    
    // 发送邮件
    const info = await transporter.sendMail(mailOptions);
    
    // 记录成功日志
    const logId = await generateId('email_logs');
    await db.execute(
      `INSERT INTO email_logs 
       (id, email_config_id, operation_type, from_email, to_email, 
        subject, content, status, created_by) 
       VALUES (?, ?, 'send', ?, ?, ?, ?, 'success', ?)`,
      [
        logId,
        emailConfig.id,
        emailConfig.from_email,
        recipientEmails.join(','),
        subject,
        htmlContent,
        recipientConfig.user_id || null
      ]
    );
    
    console.log(`✓ 邮件发送成功: ${recipientEmails.join(', ')}`);
    return {
      success: true,
      logId: logId,
      messageId: info.messageId
    };
  } catch (error) {
    console.error(`✗ 邮件发送失败:`, error);
    
    // 记录失败日志
    try {
      const logId = await generateId('email_logs');
      const recipientEmails = recipientConfig.recipient_email
        .split(/[,;\n\r]+/)
        .map(email => email.trim())
        .filter(email => email && email.includes('@'))
        .join(',');
      
      await db.execute(
        `INSERT INTO email_logs 
         (id, email_config_id, operation_type, from_email, to_email, 
          subject, status, error_message, created_by) 
         VALUES (?, ?, 'send', ?, ?, ?, 'failed', ?, ?)`,
        [
          logId,
          emailConfig.id,
          emailConfig.from_email,
          recipientEmails || recipientConfig.recipient_email,
          recipientConfig.email_subject || '舆情信息日报',
          error.message,
          recipientConfig.user_id || null
        ]
      );
    } catch (logError) {
      console.error('记录邮件日志失败:', logError);
    }
    
    throw error;
  }
}

/**
 * 发送舆情信息邮件给指定的收件管理配置
 */
async function sendNewsEmailToRecipient(recipientId) {
  try {
    console.log(`开始发送舆情信息邮件给收件管理配置: ${recipientId}`);
    
    // 获取指定的收件管理配置
    const recipients = await db.query(
      `SELECT rm.*, u.account as user_account
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.id = ? 
       AND rm.is_deleted = 0`,
      [recipientId]
    );
    
    if (recipients.length === 0) {
      throw new Error('收件管理配置不存在或已被删除');
    }
    
    const recipient = recipients[0];
    
    if (recipient.is_active !== 1) {
      throw new Error('收件管理配置未启用');
    }
    
    // 获取前一天的新闻（按企业分组）
    const newsByEnterprise = await getYesterdayNewsByEnterprise();
    
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
      throw new Error('未找到"新闻舆情"应用的邮件配置');
    }
    
    const emailConfig = emailConfigs[0];
    
    // 发送邮件
    const result = await sendNewsEmail(recipient, emailConfig, newsByEnterprise);
    
    return {
      success: true,
      recipientId: recipient.id,
      recipientEmail: recipient.recipient_email,
      logId: result.logId,
      message: '邮件发送成功'
    };
  } catch (error) {
    console.error('发送舆情信息邮件失败:', error);
    throw error;
  }
}

/**
 * 发送舆情信息邮件给所有启用的收件人
 */
async function sendNewsEmailsToAllRecipients() {
  try {
    console.log('开始发送舆情信息邮件...');
    
    // 获取所有启用的收件管理配置
    const recipients = await db.query(
      `SELECT rm.*, u.account as user_account
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.is_active = 1 
       AND rm.is_deleted = 0
       AND rm.send_frequency = 'daily'`,
      []
    );
    
    if (recipients.length === 0) {
      console.log('没有启用的收件管理配置');
      return {
        success: true,
        total: 0,
        successCount: 0,
        errorCount: 0,
        message: '没有启用的收件管理配置'
      };
    }
    
    console.log(`找到 ${recipients.length} 个启用的收件管理配置`);
    
    // 获取前一天的新闻（按企业分组）
    const newsByEnterprise = await getYesterdayNewsByEnterprise();
    
    if (Object.keys(newsByEnterprise).length === 0) {
      console.log('前一天没有相关企业的新闻，将发送空数据通知邮件');
    }
    
    // 获取邮件配置（使用第一个可用的配置，或者根据应用ID匹配）
    // 这里假设使用"新闻舆情"应用的邮件配置
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
      throw new Error('未找到"新闻舆情"应用的邮件配置');
    }
    
    const emailConfig = emailConfigs[0];
    console.log(`使用邮件配置: ${emailConfig.app_name} (${emailConfig.from_email})`);
    
    let successCount = 0;
    let errorCount = 0;
    const results = [];
    
    // 为每个收件人发送邮件
    for (const recipient of recipients) {
      try {
        const result = await sendNewsEmail(recipient, emailConfig, newsByEnterprise);
        successCount++;
        results.push({
          recipientId: recipient.id,
          recipientEmail: recipient.recipient_email,
          status: 'success',
          logId: result.logId
        });
      } catch (error) {
        errorCount++;
        results.push({
          recipientId: recipient.id,
          recipientEmail: recipient.recipient_email,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    console.log(`邮件发送完成: 成功 ${successCount} 个，失败 ${errorCount} 个`);
    
    return {
      success: true,
      total: recipients.length,
      successCount: successCount,
      errorCount: errorCount,
      results: results,
      message: `邮件发送完成: 成功 ${successCount} 个，失败 ${errorCount} 个`
    };
  } catch (error) {
    console.error('发送舆情信息邮件失败:', error);
    throw error;
  }
}

module.exports = {
  sendNewsEmailsToAllRecipients,
  sendNewsEmailToRecipient,
  getYesterdayNewsByEnterprise,
  generateEmailContent,
  generateEmailTextContent
};

