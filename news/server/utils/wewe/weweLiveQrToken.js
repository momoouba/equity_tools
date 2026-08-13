/**
 * P5：活码页短时 HMAC token（不落库，不暴露 AUTH_CODE）
 * token = base64url(payloadJson).base64url(hmac)
 */
const crypto = require('crypto');

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

/**
 * @param {{ ttlHours?: number, purpose?: string }} options
 * @returns {{ token: string, exp: number, expiresAt: string }}
 */
function signLiveQrToken(options = {}) {
  const ttlHours = Math.min(168, Math.max(1, Number(options.ttlHours) || 48));
  const exp = Math.floor(Date.now() / 1000) + ttlHours * 3600;
  const payload = {
    v: 1,
    purpose: options.purpose || 'wewe_live_qr',
    exp
  };
  const payloadPart = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadPart).digest();
  const token = `${payloadPart}.${b64url(sig)}`;
  return {
    token,
    exp,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

/**
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
function verifyLiveQrToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, error: 'invalid_token' };
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
  if (!payload || payload.purpose !== 'wewe_live_qr') {
    return { ok: false, error: 'bad_purpose' };
  }
  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, payload };
}

function buildLiveQrPageUrl(baseUrl, token) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return `${base}/wewe/live-qr${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

module.exports = {
  signLiveQrToken,
  verifyLiveQrToken,
  buildLiveQrPageUrl
};
