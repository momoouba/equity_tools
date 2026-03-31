const nodemailer = require('nodemailer');
const db = require('../db');
const { generateId } = require('./idGenerator');

/**
 * 使用 email_config 发一封 HTML 邮件（供上市进展测试发信等复用）
 */
async function sendMailWithConfig({ emailConfigId, toEmail, subject, html, userId }) {
  const configs = await db.query('SELECT * FROM email_config WHERE id = ?', [emailConfigId]);
  if (!configs.length) {
    throw new Error('邮件配置不存在');
  }
  const config = configs[0];
  const port = parseInt(config.smtp_port, 10);
  const useSecure = config.smtp_secure === 1;

  const transporterConfig = {
    host: config.smtp_host,
    port,
    auth: {
      user: config.smtp_user,
      pass: config.smtp_password,
    },
  };

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
  const mailOptions = {
    from: `"${config.from_name || config.from_email}" <${config.from_email}>`,
    to: toEmail,
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);

  const logId = await generateId('email_logs');
  await db.query(
    `INSERT INTO email_logs 
     (id, email_config_id, operation_type, from_email, to_email, cc_email, bcc_email, subject, content, status, created_by) 
     VALUES (?, ?, 'send', ?, ?, NULL, NULL, ?, ?, 'success', ?)`,
    [logId, emailConfigId, config.from_email, toEmail, subject, html, userId || null]
  );

  return { logId };
}

module.exports = { sendMailWithConfig };
