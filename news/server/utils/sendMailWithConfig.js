const nodemailer = require('nodemailer');
const db = require('../db');
const { generateId } = require('./idGenerator');

/**
 * 使用 email_config 发一封邮件（支持附件）
 * @param {object} opts
 * @param {string} [opts.emailConfigId]
 * @param {object} [opts.emailConfig] 已查询的配置行，可替代 emailConfigId
 * @param {string} opts.toEmail
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {Array<{filename:string,content:Buffer|string,contentType?:string}>} [opts.attachments]
 * @param {string|null} [opts.userId]
 */
async function sendMailWithConfig({
  emailConfigId,
  emailConfig,
  toEmail,
  subject,
  html,
  text,
  attachments,
  userId,
}) {
  let config = emailConfig;
  if (!config) {
    const configs = await db.query('SELECT * FROM email_config WHERE F_Id = ?', [emailConfigId]);
    if (!configs.length) {
      throw new Error('邮件配置不存在');
    }
    config = configs[0];
  }
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
    html: html || undefined,
    text: text || undefined,
  };
  if (attachments && attachments.length) {
    mailOptions.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }));
  }

  await transporter.sendMail(mailOptions);

  const logId = await generateId('email_logs');
  await db.query(
    `INSERT INTO email_logs 
     (F_Id, email_config_id, operation_type, from_email, to_email, cc_email, bcc_email, subject, content, status, F_CreatorUserId) 
     VALUES (?, ?, 'send', ?, ?, NULL, NULL, ?, ?, 'success', ?)`,
    [
      logId,
      config.F_Id || emailConfigId,
      config.from_email,
      toEmail,
      subject,
      String(html || text || '').slice(0, 16000),
      userId || null,
    ]
  );

  return { logId };
}

module.exports = { sendMailWithConfig };
