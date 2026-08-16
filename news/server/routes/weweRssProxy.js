/**
 * wewe-rss 反代：挂在本站 /dash、/trpc（与 wewe 路由一致），避免 SPA 跳到 /dash/login 时脱离前缀导致空白。
 * gate 用短时 ticket 写入 localStorage.authCode 后进 /dash；登录页再兜底预填 + 可点确认。
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { getWeweConfig } = require('../utils/wewe/weweClient');

function getSecret() {
  return (
    process.env.WEWE_LIVE_QR_SECRET ||
    process.env.WEWE_RSS_AUTH_CODE ||
    process.env.APP_SECRET ||
    process.env.JWT_SECRET ||
    'wewe-live-qr-dev-secret'
  );
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function signWeweEmbedTicket(authCode, ttlSec = 180) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(30, ttlSec);
  const payload = { v: 1, purpose: 'wewe_embed', exp, c: String(authCode || '') };
  const payloadPart = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadPart).digest();
  return `${payloadPart}.${b64url(sig)}`;
}

function verifyWeweEmbedTicket(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, error: 'invalid_ticket' };
  const [payloadPart, sigPart] = parts;
  const expect = crypto.createHmac('sha256', getSecret()).update(payloadPart).digest();
  let given;
  try {
    given = fromB64url(sigPart);
  } catch (_) {
    return { ok: false, error: 'invalid_sig' };
  }
  if (expect.length !== given.length || !crypto.timingSafeEqual(expect, given)) {
    return { ok: false, error: 'bad_signature' };
  }
  let payload;
  try {
    payload = JSON.parse(fromB64url(payloadPart).toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'bad_payload' };
  }
  if (!payload || payload.purpose !== 'wewe_embed') return { ok: false, error: 'bad_purpose' };
  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, authCode: String(payload.c || '') };
}

function publicSiteOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1').split(',')[0].trim();
  return `${proto}://${host}`;
}

/** 登录页兜底：预填 auth code 并尝试自动点确认（React 受控输入用原生 setter） */
function authAssistScript() {
  return `<script>
(function(){
  function code(){ try { return localStorage.getItem('authCode')||''; } catch(e){ return ''; } }
  function setNative(el, v){
    var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function tryFill(){
    var c = code();
    if (!c) return false;
    var inputs = document.querySelectorAll('input');
    var target = null;
    for (var i=0;i<inputs.length;i++){
      var el = inputs[i];
      var tip = ((el.placeholder||'') + ' ' + (el.name||'') + ' ' + (el.id||'')).toLowerCase();
      if (tip.indexOf('auth') >= 0 || tip.indexOf('code') >= 0 || el.type === 'password') {
        target = el; break;
      }
    }
    if (!target && inputs.length === 1) target = inputs[0];
    if (!target) return false;
    if (target.value === c) return true;
    setNative(target, c);
    return true;
  }
  function trySubmit(){
    var btns = document.querySelectorAll('button');
    for (var i=0;i<btns.length;i++){
      var t = (btns[i].textContent||'').trim();
      if (t === '确认' || t === '登录' || /confirm/i.test(t)) {
        btns[i].click();
        return true;
      }
    }
    return false;
  }
  var n = 0;
  var timer = setInterval(function(){
    n++;
    var filled = tryFill();
    if (filled && location.pathname.indexOf('/login') >= 0) {
      trySubmit();
    }
    if (n > 40 || (filled && location.pathname.indexOf('/login') < 0)) clearInterval(timer);
  }, 250);
})();
</script>`;
}

function rewriteHtml(html, siteOrigin) {
  let out = String(html || '');
  out = out.replace(
    /window\.__WEWE_RSS_SERVER_ORIGIN_URL__\s*=\s*['"][^'"]*['"]/,
    `window.__WEWE_RSS_SERVER_ORIGIN_URL__ = '${siteOrigin}'`
  );
  // 资源保持 /dash/...（由本站 /dash 反代），勿再改写成 /wewe-rss
  out = out.replace(/href=["']http:\/\/127\.0\.0\.1:\d+\/favicon\.ico["']/g, 'href="/dash/favicon.ico"');
  out = out.replace(/href=["']http:\/\/localhost:\d+\/favicon\.ico["']/g, 'href="/dash/favicon.ico"');
  if (!out.includes('wewe-auth-assist')) {
    out = out.replace('</body>', `<!--wewe-auth-assist-->${authAssistScript()}</body>`);
  }
  return out;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'accept-encoding'
]);

function buildProxyHeaders(req, targetHost, authCode, contentLength) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    const key = String(k).toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (contentLength != null && key === 'content-length') continue;
    headers[k] = v;
  }
  headers.host = targetHost;
  if (contentLength != null) headers['content-length'] = String(contentLength);
  if (authCode) {
    headers.authorization = authCode;
    headers['x-auth-code'] = authCode;
  }
  return headers;
}

/** express.json 已读完时，把 parsed body 还原成 JSON 再转给 wewe */
function parsedBodyBuffer(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  if (!req.readableEnded) return null;
  const body = req.body;
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  return Buffer.from(JSON.stringify(body));
}

function proxyToWewe(req, res, upstreamPath) {
  const { baseUrl, authCode } = getWeweConfig();
  let path = upstreamPath || '/';
  if (!path.startsWith('/')) path = `/${path}`;

  let target;
  try {
    target = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  } catch (e) {
    res.status(502).send(`invalid wewe upstream: ${e.message}`);
    return;
  }

  const replayBuf = parsedBodyBuffer(req);
  const contentLength =
    replayBuf != null
      ? replayBuf.length
      : req.headers['content-length'] != null
        ? Number(req.headers['content-length'])
        : null;
  const headers = buildProxyHeaders(req, target.host, authCode, Number.isFinite(contentLength) ? contentLength : null);

  const lib = target.protocol === 'https:' ? https : http;
  const proxyReq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers
    },
    (proxyRes) => {
      const ct = String(proxyRes.headers['content-type'] || '');
      const isHtml = ct.includes('text/html');
      const outHeaders = { ...proxyRes.headers };
      delete outHeaders['content-security-policy'];
      delete outHeaders['content-security-policy-report-only'];
      delete outHeaders['x-frame-options'];
      delete outHeaders['content-length'];
      delete outHeaders['content-encoding'];

      if (!isHtml) {
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
        return;
      }

      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = rewriteHtml(raw, publicSiteOrigin(req));
        outHeaders['content-type'] = 'text/html; charset=utf-8';
        res.writeHead(proxyRes.statusCode || 200, outHeaders);
        res.end(body);
      });
    }
  );

  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.status(502).send(`wewe proxy error: ${e.message}`);
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
    return;
  }
  if (replayBuf != null) {
    proxyReq.end(replayBuf);
    return;
  }
  req.pipe(proxyReq);
}

/** 兼容旧 /wewe-rss/* ：剥前缀后反代 */
function weweRssProxyMiddleware(req, res) {
  let upstreamPath = req.originalUrl.replace(/^\/wewe-rss/, '') || '/';
  proxyToWewe(req, res, upstreamPath);
}

/** 本站 /dash/* → wewe /dash/* */
function weweDashProxyMiddleware(req, res) {
  proxyToWewe(req, res, req.originalUrl);
}

/** 本站 /trpc/* → wewe /trpc/* */
function weweTrpcProxyMiddleware(req, res) {
  proxyToWewe(req, res, req.originalUrl);
}

function weweRssGateHtml({ authCode = '', error = '' } = {}) {
  if (error) {
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>wewe 进入失败</title>
<style>body{font-family:system-ui,sans-serif;padding:40px;color:#333}</style></head>
<body><p>${String(error).replace(/</g, '&lt;')}</p>
<p>请回到配置页点击「刷新嵌入」，或「新窗口打开」。</p></body></html>`;
  }
  const codeJson = JSON.stringify(String(authCode || ''));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>wewe 自动进入</title>
  <style>
    body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#333}
  </style>
</head>
<body>
  <div>正在进入 wewe-rss 管理页…</div>
  <script>
    (function () {
      try {
        var code = ${codeJson};
        if (code) localStorage.setItem('authCode', code);
        else localStorage.removeItem('authCode');
      } catch (e) {}
      location.replace('/dash');
    })();
  </script>
</body>
</html>`;
}

function handleWeweRssGate(req, res) {
  const ticket = String(req.query.t || req.query.ticket || '').trim();
  if (!ticket) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(
      weweRssGateHtml({ error: '缺少嵌入票据。请从系统配置页打开「wewe-rss 管理」。' })
    );
    return;
  }
  const verified = verifyWeweEmbedTicket(ticket);
  if (!verified.ok) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(401).send(weweRssGateHtml({ error: `嵌入票据无效：${verified.error}` }));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(weweRssGateHtml({ authCode: verified.authCode }));
}

module.exports = {
  weweRssProxyMiddleware,
  weweDashProxyMiddleware,
  weweTrpcProxyMiddleware,
  weweRssGateHtml,
  handleWeweRssGate,
  signWeweEmbedTicket,
  verifyWeweEmbedTicket,
  publicSiteOrigin
};
