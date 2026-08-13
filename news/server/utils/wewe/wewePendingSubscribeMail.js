/**
 * P2/P5：待订阅催办邮件（与扫码催登分模板）
 * 多个账号合并为一封 digest，避免一号一邮刷屏。
 */
const { sendWeweOpsMail } = require('./weweOpsMail');

const PASTE_HINT = [
  '处理方式（在新闻系统「专队账号」页，不是 wewe-rss 管理页）：',
  '1. 打开该公众号任意一篇文章 → 复制分享链接（https://mp.weixin.qq.com/s/...）',
  '2. 管理员设置 → 私有公众号 wewe → 左侧「专队账号」→ 对应行「粘贴链接」→ 订阅映射',
  '3. 也可 POST /api/wewe-probe/team/map-url',
  '   body: { "wechat_account_id": "...", "sample_article_url": "https://mp.weixin.qq.com/s/..." }',
  '',
  '映射成功后 team_status=active，方可进入夜间提取队列。'
].join('\n');

/**
 * @param {{ wechatAccountId: string, reason?: string }[]} accounts
 */
function buildPendingSubscribeDigestMail(accounts = []) {
  const list = (Array.isArray(accounts) ? accounts : [])
    .map((a) => ({
      wechatAccountId: String(a.wechatAccountId || a.wechat_account_id || '').trim(),
      reason: a.reason || '缺分享链接'
    }))
    .filter((a) => a.wechatAccountId);

  const n = list.length;
  const subject =
    n <= 0
      ? '【wewe待订阅】缺分享链接'
      : n === 1
        ? `【wewe待订阅】缺分享链接：${list[0].wechatAccountId}`
        : `【wewe待订阅】缺分享链接（${n} 个账号）`;

  const lines = [
    '【模板：待订阅 / 与扫码催登分开】',
    '',
    `共 ${n} 个专队账号需要粘贴分享链接完成 wewe 订阅映射：`,
    ''
  ];
  list.forEach((a, i) => {
    lines.push(`${i + 1}. ${a.wechatAccountId}`);
    if (a.reason) lines.push(`   原因：${a.reason}`);
  });
  lines.push('', PASTE_HINT);

  return { subject, text: lines.join('\n'), count: n, accounts: list };
}

/** @deprecated 单账号仍走 digest，避免旧调用一号一邮 */
function buildPendingSubscribeMail({ wechatAccountId, reason }) {
  return buildPendingSubscribeDigestMail([{ wechatAccountId, reason }]);
}

/**
 * 批量发送待订阅催办（一封邮件）；remind_enabled=0 时仅打日志（除非 force）
 */
async function notifyPendingSubscribeDigest({ accounts = [], force = false } = {}) {
  const mail = buildPendingSubscribeDigestMail(accounts);
  if (mail.count === 0) {
    return { action: 'idle_empty', sent: false, count: 0 };
  }
  console.log(`[wewe待订阅邮件] subject=${mail.subject} count=${mail.count}`);
  console.log(mail.text);

  const sendResult = await sendWeweOpsMail({
    subject: mail.subject,
    text: mail.text,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${mail.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`,
    force
  });
  return { action: 'digest', ...mail, ...sendResult };
}

/**
 * 单账号入口：内部合并为 digest（仍只发一封）
 */
async function notifyPendingSubscribe({ wechatAccountId, reason, force = false }) {
  return notifyPendingSubscribeDigest({
    accounts: [{ wechatAccountId, reason }],
    force
  });
}

module.exports = {
  PASTE_HINT,
  buildPendingSubscribeMail,
  buildPendingSubscribeDigestMail,
  notifyPendingSubscribe,
  notifyPendingSubscribeDigest
};
