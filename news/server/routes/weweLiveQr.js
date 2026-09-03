/**
 * P5：活码页 HTML + 公开 API（免登录，靠 HMAC token）
 * 页面：GET /wewe/live-qr?token=
 * API： /api/wewe-live-qr/*
 */
const express = require('express');
const { verifyLiveQrToken } = require('../utils/wewe/weweLiveQrToken');
const {
  createLoginUrl,
  completeLoginFromPoll,
  computeSessionPhase,
  ensureSessionRow
} = require('../utils/wewe/weweRemindService');
const { getWewePrivateConfig } = require('../utils/wewe/wewePrivateTeam');
const { listWeweAccounts } = require('../utils/wewe/weweClient');
const { getCurrentUser } = require('../middleware/auth');

const router = express.Router();

function authLiveQr(req, res, next) {
  const token = String(req.query.token || req.headers['x-wewe-live-token'] || '').trim();
  if (token) {
    const v = verifyLiveQrToken(token);
    if (!v.ok) {
      return res.status(401).json({ success: false, message: `token_${v.error}` });
    }
    req.liveQr = v.payload;
    return next();
  }
  getCurrentUser(req, res, () => {
    const role = (req.currentUser && req.currentUser.role) || '';
    if (String(role).toLowerCase() === 'admin') {
      req.liveQr = { purpose: 'wewe_live_qr', admin: true };
      return next();
    }
    return res.status(401).json({ success: false, message: '需要有效 token 或管理员登录' });
  });
}

router.get('/session', authLiveQr, async (req, res) => {
  try {
    const cfg = await getWewePrivateConfig();
    const session = await ensureSessionRow();
    const phase = computeSessionPhase(session, cfg || {});
    res.json({
      success: true,
      phase: 'P5',
      session: {
        session_status: session.session_status,
        pause_extract: session.pause_extract,
        last_login_at: session.last_login_at,
        last_remind_at: session.last_remind_at
      },
      phaseInfo: {
        phase: phase.phase,
        expiresAt: phase.expiresAt,
        ttlHours: phase.ttlHours
      },
      token: req.liveQr
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

function isPlatformRelayError(message) {
  return /404|502|500|createLoginUrl|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|status code/i.test(
    String(message || '')
  );
}

const PLATFORM_RELAY_HINT =
  '微信读书中转（wewe 的 PLATFORM_URL）连不上，所以出不了码。这不是新闻站缺路由。默认 https://weread.111965.xyz 现为 502；备用 https://weread.965111.xyz 已 404（Deno Deploy Classic 于 2026-07-20 下线）。请看 docker compose logs wewe-rss --tail 80。中转恢复或换可用 PLATFORM_URL 之前无法扫码。';

router.post('/qr', authLiveQr, async (req, res) => {
  try {
    const qr = await createLoginUrl();
    res.json({ success: true, phase: 'P5', uuid: qr.uuid, scanUrl: qr.scanUrl });
  } catch (e) {
    const message = e.message || '生成二维码失败';
    res.status(502).json({
      success: false,
      message,
      hint: isPlatformRelayError(message) ? PLATFORM_RELAY_HINT : undefined,
      body: e.body
    });
  }
});

router.get('/poll', authLiveQr, async (req, res) => {
  try {
    const uuid = String(req.query.id || req.query.uuid || '').trim();
    if (!uuid) {
      return res.status(400).json({ success: false, message: '需要 id(uuid)' });
    }
    const result = await completeLoginFromPoll(uuid);
    res.json({ success: true, phase: 'P5', ...result });
  } catch (e) {
    const msg = String(e.message || '');
    // 登录码已被消费后，wewe 偶发 Prisma id=undefined；若账号已启用则视为成功
    if (/id:\s*undefined|AccountWhereUniqueInput/i.test(msg)) {
      try {
        const session = await ensureSessionRow();
        const accounts = await listWeweAccounts(20);
        const enabled = accounts.find((a) => Number(a.status) === 1);
        if (enabled && session && Number(session.pause_extract) === 0) {
          return res.json({
            success: true,
            phase: 'P5',
            ok: true,
            pending: false,
            message: 'login_ok_recovered_from_stale_poll',
            vid: enabled.id,
            username: enabled.name || ''
          });
        }
      } catch (_) {
        /* fall through */
      }
    }
    res.status(502).json({ success: false, message: e.message, body: e.body });
  }
});

function liveQrHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>wewe 扫码续期</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#111}
    h1{font-size:1.25rem;margin:0 0 8px}
    .muted{color:#666;font-size:14px;line-height:1.5}
    #qr{margin:24px 0;text-align:center}
    #qr img{width:220px;height:220px;border:1px solid #ddd;border-radius:8px}
    button{padding:10px 16px;font-size:15px;cursor:pointer;margin-right:8px}
    .ok{color:#0a7;font-weight:600}
    .err{color:#c00}
    .wait{color:#b45309}
    #detail{font-size:13px;color:#444;white-space:pre-wrap;background:#f7f8fa;padding:10px;border-radius:6px;min-height:2.5em}
  </style>
</head>
<body>
  <h1>微信读书会话续期</h1>
  <p class="muted">请用手机微信扫描下方二维码。成功后应只剩绿色「扫码成功」，可关闭本页。</p>
  <p id="status" class="muted">准备中…</p>
  <div id="qr"></div>
  <pre id="detail"></pre>
  <button type="button" id="refresh">刷新二维码</button>
  <script>
    const params = new URLSearchParams(location.search);
    const token = params.get('token') || '';
    const qs = token ? ('?token=' + encodeURIComponent(token)) : '';
    const statusEl = document.getElementById('status');
    const qrEl = document.getElementById('qr');
    const detailEl = document.getElementById('detail');
    let uuid = null;
    let timer = null;
    let pollCount = 0;
    let done = false;
    let inflight = false;

    function setStatus(t, cls) {
      statusEl.className = cls || 'muted';
      statusEl.textContent = t;
    }
    function setDetail(t) { detailEl.textContent = t || ''; }

    function markSuccess(data) {
      done = true;
      if (timer) clearInterval(timer);
      timer = null;
      setStatus('扫码成功，会话已恢复。可关闭本页，回专队配置刷新。', 'ok');
      setDetail('vid=' + (data.vid || '') + ' user=' + (data.username || ''));
      qrEl.innerHTML = '<p class="ok">✓ 登录完成</p>';
    }

    async function createQr() {
      done = false;
      inflight = false;
      setStatus('正在生成二维码…');
      setDetail('');
      qrEl.innerHTML = '';
      pollCount = 0;
      if (timer) clearInterval(timer);
      const res = await fetch('/api/wewe-live-qr/qr' + qs, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const err = new Error(data.message || '生成失败');
        err.hint = data.hint || '';
        throw err;
      }
      uuid = data.uuid;
      const scanUrl = data.scanUrl || '';
      if (!scanUrl) throw new Error('未返回 scanUrl');
      const img = document.createElement('img');
      img.alt = '扫码登录';
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(scanUrl);
      qrEl.appendChild(img);
      setStatus('请扫码；状态：等待中…', 'wait');
      timer = setInterval(poll, 2000);
    }

    async function poll() {
      if (!uuid || done || inflight) return;
      inflight = true;
      pollCount += 1;
      try {
        const res = await fetch('/api/wewe-live-qr/poll' + qs + (qs ? '&' : '?') + 'id=' + encodeURIComponent(uuid), {
          credentials: 'include'
        });
        const data = await res.json();
        if (done) return;
        if (data.ok) {
          markSuccess(data);
          return;
        }
        if (!res.ok) {
          const msg = String(data.message || res.status);
          if (/id:\\s*undefined|AccountWhereUniqueInput/i.test(msg)) {
            setStatus('登录码已结束。请回专队配置看「读书账号」是否为可用；可用则可关闭本页。', 'wait');
            setDetail(msg.slice(0, 240));
            if (timer) clearInterval(timer);
            return;
          }
          setStatus('轮询失败：' + msg.slice(0, 160), 'err');
          setDetail(JSON.stringify(data, null, 2));
          return;
        }
        const msg = data.message || (data.result && data.result.message) || 'waiting';
        setStatus('请扫码；状态：' + msg + '（已轮询 ' + pollCount + ' 次）', 'wait');
      } catch (e) {
        if (!done) setStatus('轮询异常：' + (e.message || e), 'err');
      } finally {
        inflight = false;
      }
    }

    function failQr(e) {
      setStatus(e.message || String(e), 'err');
      setDetail(e.hint || '');
    }
    document.getElementById('refresh').onclick = () => createQr().catch(failQr);
    createQr().catch(failQr);
  </script>
</body>
</html>`;
}

module.exports = {
  router,
  liveQrHtml
};
