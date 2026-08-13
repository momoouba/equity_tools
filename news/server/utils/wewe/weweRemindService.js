/**
 * P5：扫码催登 + 待订阅催办逻辑
 */
const db = require('../../db');
const { formatBeijingYmd } = require('../newsFetchDayLog');
const { getWewePrivateConfig } = require('./wewePrivateTeam');
const { sendWeweOpsMail, resolveOpsRecipients } = require('./weweOpsMail');
const { signLiveQrToken, buildLiveQrPageUrl } = require('./weweLiveQrToken');
const { resumeExtractAfterLogin, getSessionRow, runExtractTick } = require('./weweExtractService');
const { createLoginUrl, getLoginResult, addWeweAccount } = require('./weweClient');

function publicBaseUrl(req) {
  if (process.env.NEWS_PUBLIC_BASE_URL) {
    return String(process.env.NEWS_PUBLIC_BASE_URL).replace(/\/$/, '');
  }
  if (process.env.WEWE_LIVE_QR_BASE_URL) {
    return String(process.env.WEWE_LIVE_QR_BASE_URL).replace(/\/$/, '');
  }
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) return `${proto}://${host}`.replace(/\/$/, '');
  }
  return `http://127.0.0.1:${process.env.PORT || 3002}`;
}

async function ensureSessionRow() {
  let row = await getSessionRow();
  if (row) return row;
  const { generateId } = require('../idGenerator');
  const id = await generateId('wewe_private_session');
  await db.execute(
    `INSERT INTO wewe_private_session (F_Id, session_status) VALUES (?, 'unknown')`,
    [id]
  );
  return getSessionRow();
}

function computeSessionPhase(session, cfg, now = new Date()) {
  const ttlHours = Number((session && session.session_ttl_hours) || cfg.session_ttl_hours || 24) || 24;
  const beforeHours = Number(cfg.remind_before_hours || 24) || 24;
  const lastLogin = session && session.last_login_at ? new Date(session.last_login_at) : null;
  const paused = Boolean(session && Number(session.pause_extract) === 1);
  const status = String((session && session.session_status) || 'unknown');

  if (!lastLogin || Number.isNaN(lastLogin.getTime())) {
    return {
      phase: paused || status === 'expired' ? 'dead' : 'unknown',
      expiresAt: null,
      ttlHours
    };
  }
  const expiresAt = new Date(lastLogin.getTime() + ttlHours * 3600 * 1000);
  if (paused || status === 'expired' || now >= expiresAt) {
    return { phase: 'dead', expiresAt, ttlHours };
  }
  const bufferStart = new Date(expiresAt.getTime() - beforeHours * 3600 * 1000);
  if (now >= bufferStart) {
    return { phase: 'buffer', expiresAt, ttlHours };
  }
  return { phase: 'ok', expiresAt, ttlHours };
}

function msSince(dt) {
  if (!dt) return Infinity;
  const t = new Date(dt).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Date.now() - t;
}

async function bumpRemindCounters(session, kind) {
  const ymd = formatBeijingYmd();
  let count = Number(session.remind_count_today || 0);
  if (session.remind_day_ymd !== ymd) count = 0;
  count += 1;
  await db.execute(
    `UPDATE wewe_private_session
     SET last_remind_at = NOW(),
         remind_count_today = ?,
         remind_day_ymd = ?,
         session_status = ?,
         note = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [
      count,
      ymd,
      kind === 'dead' ? 'expired' : kind === 'buffer' ? 'buffering' : session.session_status || 'unknown',
      `last_remind_kind=${kind}`,
      session.F_Id
    ]
  );
}

function buildScanMail({ kind, liveUrl, expiresAt }) {
  if (kind === 'dead') {
    return {
      subject: '【wewe催登】会话已失效，专队提取已暂停',
      text: [
        '微信读书会话已失效，私有公众号专队提取已暂停（新榜同步不受影响）。',
        '',
        '请尽快用手机微信打开下方活码页并扫码恢复：',
        liveUrl,
        '',
        '恢复后系统会自动停止催办并补提未执行账号。',
        expiresAt ? `预计失效时间：${expiresAt.toISOString()}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      html: `<p><b>微信读书会话已失效</b>，专队提取已暂停（新榜不受影响）。</p>
<p>请用手机微信打开活码页扫码恢复：</p>
<p><a href="${liveUrl}">${liveUrl}</a></p>
<p>恢复后将自动停止催办并补提。</p>`
    };
  }
  return {
    subject: '【wewe催登】会话即将失效',
    text: [
      '微信读书会话进入缓冲期，即将失效。',
      expiresAt ? `预计失效：${expiresAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '',
      '',
      '请提前扫码续期（活码页）：',
      liveUrl
    ]
      .filter(Boolean)
      .join('\n'),
    html: `<p>微信读书会话<strong>即将失效</strong>。</p>
${expiresAt ? `<p>预计失效：${expiresAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>` : ''}
<p>请打开活码页扫码续期：</p>
<p><a href="${liveUrl}">${liveUrl}</a></p>`
  };
}

/**
 * 扫码催办巡检（cron / probe）
 */
async function runScanRemindTick(options = {}) {
  const force = options.force === true;
  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.remind_enabled) !== 1) {
    if (!force) return { action: 'skip_disabled' };
  }

  const session = await ensureSessionRow();
  const phaseInfo = computeSessionPhase(session, cfg || {});
  if (phaseInfo.phase === 'ok') {
    return { action: 'idle_ok', phase: 'ok', expiresAt: phaseInfo.expiresAt };
  }
  if (phaseInfo.phase === 'unknown' && !force) {
    // 从未登录：仍可催一次（当 pause 或运维要求）
    if (Number(session.pause_extract) !== 1 && session.session_status !== 'expired') {
      return { action: 'idle_unknown' };
    }
  }

  const kind = phaseInfo.phase === 'buffer' ? 'buffer' : 'dead';
  const bufferHours = Number(cfg.remind_interval_buffer_hours || 2) || 2;
  const deadMinutes = Number(cfg.remind_interval_dead_minutes || 30) || 30;
  const dailyCap = Number(cfg.remind_daily_cap || 20) || 20;
  const minIntervalMs = kind === 'buffer' ? bufferHours * 3600 * 1000 : deadMinutes * 60 * 1000;

  const ymd = formatBeijingYmd();
  let countToday = Number(session.remind_count_today || 0);
  if (session.remind_day_ymd !== ymd) countToday = 0;
  if (countToday >= dailyCap && !force) {
    return { action: 'cap_reached', kind, countToday, dailyCap };
  }
  if (msSince(session.last_remind_at) < minIntervalMs && !force) {
    return {
      action: 'skip_interval',
      kind,
      waitMs: minIntervalMs - msSince(session.last_remind_at)
    };
  }

  const { token, expiresAt: tokenExp } = signLiveQrToken({
    ttlHours: Number(process.env.WEWE_LIVE_QR_TTL_HOURS) || 48
  });
  const liveUrl = buildLiveQrPageUrl(publicBaseUrl(options.req), token);
  const mail = buildScanMail({ kind, liveUrl, expiresAt: phaseInfo.expiresAt });
  const sendResult = await sendWeweOpsMail({
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    force
  });

  if (sendResult.sent || force) {
    await bumpRemindCounters(session, kind);
  }

  return {
    action: sendResult.sent ? 'sent' : `not_sent_${sendResult.mode}`,
    kind,
    liveUrl,
    tokenExpiresAt: tokenExp,
    sendResult,
    phase: phaseInfo.phase,
    expiresAt: phaseInfo.expiresAt
  };
}

/**
 * 待订阅日催（默认每天）
 */
async function runPendingSubscribeRemindTick(options = {}) {
  const force = options.force === true;
  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.remind_enabled) !== 1) {
    if (!force) return { action: 'skip_disabled' };
  }

  const rows = await db.query(
    `SELECT wechat_account_id, note, last_xinbang_error
     FROM wewe_private_accounts
     WHERE F_DeleteMark = 0
       AND (team_status = 'pending_subscribe' OR map_status = 'pending_subscribe')
     ORDER BY F_CreatorTime ASC
     LIMIT 200`
  );
  if (!rows.length) return { action: 'idle_empty', count: 0 };

  // 合并为一封 digest，避免一号一邮
  const { notifyPendingSubscribeDigest } = require('./wewePendingSubscribeMail');
  const accounts = rows.map((row) => ({
    wechatAccountId: row.wechat_account_id,
    reason: row.note || row.last_xinbang_error || '缺分享链接'
  }));
  const digest = await notifyPendingSubscribeDigest({ accounts, force });
  return {
    action: 'digest',
    count: accounts.length,
    subject: digest.subject,
    sent: digest.sent,
    mode: digest.mode,
    to: digest.to
  };
}

async function markSessionRecovered({ vid, username } = {}) {
  const session = await ensureSessionRow();
  await db.execute(
    `UPDATE wewe_private_session
     SET last_login_at = NOW(),
         session_status = 'ok',
         pause_extract = 0,
         remind_count_today = 0,
         note = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [`login_ok vid=${vid || ''} user=${username || ''}`.slice(0, 500), session.F_Id]
  );
  const resume = await resumeExtractAfterLogin();
  try {
    await runExtractTick({ force: true });
  } catch (e) {
    console.warn('[wewe活码] 恢复后立即 tick 失败:', e.message);
  }
  return { resume, sessionId: session.F_Id };
}

/**
 * 登录结果落库 wewe + 恢复专队
 * platform.getLoginResult: { message:'waiting' } | { vid, token, username, message? }
 */
async function completeLoginFromPoll(uuid) {
  const result = await getLoginResult(uuid);
  const row = result && result.json ? result.json : result;
  if (!row || typeof row !== 'object') {
    return { ok: false, pending: true, message: 'empty_result', result: row };
  }
  const msg = String(row.message || '').toLowerCase();
  if (msg === 'waiting' || msg.includes('wait')) {
    return { ok: false, pending: true, message: 'waiting', result: row };
  }
  const vid = row.vid != null ? row.vid : row.id;
  const token = row.token;
  if (vid == null || vid === '' || !token) {
    return {
      ok: false,
      pending: true,
      message: msg || 'incomplete_credentials',
      result: row
    };
  }
  try {
    await addWeweAccount({
      id: String(vid),
      token: String(token),
      name: row.username || row.name || String(vid),
      status: 1
    });
  } catch (e) {
    console.warn('[wewe活码] account.add 警告:', e.message);
    return {
      ok: false,
      pending: false,
      message: `account.add_failed: ${e.message}`,
      result: row
    };
  }
  const recovered = await markSessionRecovered({
    vid: String(vid),
    username: row.username || row.name
  });
  return {
    ok: true,
    pending: false,
    message: 'login_ok',
    vid: String(vid),
    username: row.username || row.name || '',
    recovered
  };
}

async function issueLiveQrForMail(req) {
  const signed = signLiveQrToken({
    ttlHours: Number(process.env.WEWE_LIVE_QR_TTL_HOURS) || 48
  });
  return {
    ...signed,
    pageUrl: buildLiveQrPageUrl(publicBaseUrl(req), signed.token)
  };
}

module.exports = {
  publicBaseUrl,
  ensureSessionRow,
  computeSessionPhase,
  runScanRemindTick,
  runPendingSubscribeRemindTick,
  markSessionRecovered,
  completeLoginFromPoll,
  issueLiveQrForMail,
  createLoginUrl,
  getLoginResult
};
