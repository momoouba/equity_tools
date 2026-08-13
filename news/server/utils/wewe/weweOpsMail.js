/**
 * P5：wewe 运维邮件（复用新闻舆情 SMTP）
 */
const nodemailer = require('nodemailer');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const {
  getEmailConfigForRecipient,
  truncateContentForEmailLog
} = require('../emailSender');
const { getWewePrivateConfig } = require('./wewePrivateTeam');

async function resolveOpsRecipients() {
  const cfg = await getWewePrivateConfig();
  const raw = (cfg && cfg.ops_email) || process.env.WEWE_OPS_EMAIL || '';
  const list = String(raw)
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { list, remindEnabled: Boolean(cfg && Number(cfg.remind_enabled) === 1), cfg };
}

function buildTransporter(config) {
  const port = parseInt(config.smtp_port, 10);
  const useSecure = config.smtp_secure === 1;
  const transporterConfig = {
    host: config.smtp_host,
    port,
    auth: { user: config.smtp_user, pass: config.smtp_password }
  };
  if (port === 465) {
    transporterConfig.secure = true;
  } else if (port === 587) {
    transporterConfig.secure = false;
    transporterConfig.requireTLS = true;
  } else {
    transporterConfig.secure = useSecure;
    if (useSecure && port !== 465) transporterConfig.requireTLS = true;
  }
  return nodemailer.createTransport(transporterConfig);
}

/**
 * @param {{ to?: string|string[], subject: string, text?: string, html?: string, force?: boolean }} opts
 */
async function sendWeweOpsMail(opts) {
  const { list, remindEnabled } = await resolveOpsRecipients();
  if (!opts.force && !remindEnabled) {
    console.log(`[wewe运维邮件] skip remind_enabled=0 subject=${opts.subject}`);
    return { sent: false, mode: 'remind_disabled' };
  }
  const toList = opts.to
    ? (Array.isArray(opts.to) ? opts.to : String(opts.to).split(/[,;]/).map((s) => s.trim()).filter(Boolean))
    : list;
  if (!toList.length) {
    console.warn(`[wewe运维邮件] 无收件人 subject=${opts.subject}`);
    return { sent: false, mode: 'no_ops_email' };
  }

  const config = await getEmailConfigForRecipient({});
  const transporter = buildTransporter(config);
  const to = toList.join(',');
  const html =
    opts.html ||
    String(opts.text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

  await transporter.sendMail({
    from: `"${config.from_name || config.from_email}" <${config.from_email}>`,
    to,
    subject: opts.subject,
    text: opts.text || undefined,
    html
  });

  try {
    const logId = await generateId('email_logs');
    await db.execute(
      `INSERT INTO email_logs
       (F_Id, email_config_id, operation_type, from_email, to_email, subject, content, status)
       VALUES (?, ?, 'send', ?, ?, ?, ?, 'success')`,
      [
        logId,
        config.F_Id,
        config.from_email,
        to,
        opts.subject,
        truncateContentForEmailLog(opts.text || opts.html || '')
      ]
    );
  } catch (e) {
    console.warn('[wewe运维邮件] 写 email_logs 失败:', e.message);
  }

  console.log(`[wewe运维邮件] ✓ 已发送 to=${to} subject=${opts.subject}`);
  return { sent: true, mode: 'smtp', to };
}

module.exports = {
  resolveOpsRecipients,
  sendWeweOpsMail
};
