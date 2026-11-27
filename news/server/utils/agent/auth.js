'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { clientIpFromReq } = require('../competitor-analysis/competitorRouteUtils');
const { ensureAgent, loadServiceUser } = require('./schema');
const {
  TOKEN_TTL_SECONDS,
  httpError,
  ipAllowed,
  parseScopes,
  normalizeIp,
} = require('./contract');

let dummyHashPromise = null;

function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('agent-dummy-secret', 10);
  return dummyHashPromise;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function requestIp(req) {
  if (String(process.env.AGENT_TRUST_PROXY || '').trim() === '1') {
    return normalizeIp(clientIpFromReq(req));
  }
  return normalizeIp(req.socket?.remoteAddress || req.ip || '');
}

async function writeAudit({ clientId, action, resource, ip, requestId, httpStatus }) {
  const id = await generateId('agent_audit');
  await db.execute(
    `INSERT INTO agent_audit (F_Id, client_id, action, resource, ip, request_id, http_status)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      clientId ? String(clientId).slice(0, 64) : null,
      String(action || '').slice(0, 64),
      resource ? String(resource).slice(0, 255) : null,
      ip ? String(ip).slice(0, 64) : null,
      requestId ? String(requestId).slice(0, 64) : null,
      httpStatus == null ? null : Number(httpStatus),
    ]
  );
}

async function issueToken({ clientId, clientSecret, ip }) {
  await ensureAgent();
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '');
  const rows = await db.query(
    `SELECT F_Id AS id, client_id, secret_hash, status, ip_allowlist, scopes
     FROM agent_client WHERE client_id = ? LIMIT 1`,
    [id]
  );
  const client = rows[0];
  const hash = client ? client.secret_hash : await dummyHash();
  const secretOk = secret ? await bcrypt.compare(secret, hash) : false;
  if (!client || client.status !== 'active' || !secretOk) {
    throw httpError('凭证无效', 401);
  }
  if (!ipAllowed(client.ip_allowlist, ip)) {
    throw httpError('来源地址不在白名单', 403);
  }
  const token = crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const tokenId = await generateId('agent_access_token');
  await db.execute(
    `INSERT INTO agent_access_token (F_Id, client_row_id, token_hash, expires_at, revoked)
     VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL ${TOKEN_TTL_SECONDS} SECOND), 0)`,
    [tokenId, client.id, hashToken(token)]
  );
  db.execute('DELETE FROM agent_access_token WHERE expires_at < NOW()').catch(() => {});
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    scopes: parseScopes(client.scopes),
  };
}

async function requireAgentAuth(req, res, next) {
  try {
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    await ensureAgent();
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || token.length > 256) {
      await writeAudit({
        clientId: null,
        action: 'auth.denied',
        resource: String(req.originalUrl || '').split('?')[0].slice(0, 255),
        ip: requestIp(req),
        requestId: req.agentRequestId,
        httpStatus: 401,
      }).catch(() => {});
      return res.status(401).json({ success: false, message: '缺少访问令牌' });
    }
    const rows = await db.query(
      `SELECT c.client_id, c.status, c.ip_allowlist, c.scopes
       FROM agent_access_token t
       INNER JOIN agent_client c ON c.F_Id = t.client_row_id
       WHERE t.token_hash = ? AND t.revoked = 0 AND t.expires_at > NOW()
       LIMIT 1`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row || row.status !== 'active') {
      await writeAudit({
        clientId: row?.client_id || null,
        action: 'auth.denied',
        resource: String(req.originalUrl || '').split('?')[0].slice(0, 255),
        ip: requestIp(req),
        requestId: req.agentRequestId,
        httpStatus: 401,
      }).catch(() => {});
      return res.status(401).json({ success: false, message: '访问令牌无效或已过期' });
    }
    const ip = requestIp(req);
    if (!ipAllowed(row.ip_allowlist, ip)) {
      await writeAudit({
        clientId: row.client_id,
        action: 'auth.denied',
        resource: String(req.originalUrl || '').split('?')[0].slice(0, 255),
        ip,
        requestId: req.agentRequestId,
        httpStatus: 403,
      }).catch(() => {});
      return res.status(403).json({ success: false, message: '来源地址不在白名单' });
    }
    const serviceUser = await loadServiceUser();
    if (!serviceUser) {
      return res.status(500).json({ success: false, message: '集成用户未就绪' });
    }
    req.agentCaller = {
      clientId: row.client_id,
      scopes: parseScopes(row.scopes),
      ip,
      requestId: req.agentRequestId,
      serviceUser,
    };
    req.valUser = serviceUser;
    req.caUser = serviceUser;
    req.psUser = serviceUser;
    return next();
  } catch (err) {
    console.error('[agent] auth', err.message || err);
    return res.status(500).json({ success: false, message: '鉴权失败' });
  }
}

function requireScopes(scopes) {
  const need = Array.isArray(scopes) ? scopes : [scopes];
  return (req, res, next) => {
    const have = req.agentCaller?.scopes || [];
    const missing = need.filter((scope) => !have.includes(scope));
    if (missing.length) {
      writeAudit({
        clientId: req.agentCaller?.clientId,
        action: 'auth.denied',
        resource: String(req.originalUrl || '').split('?')[0].slice(0, 255),
        ip: req.agentCaller?.ip,
        requestId: req.agentCaller?.requestId,
        httpStatus: 403,
      }).catch(() => {});
      return res.status(403).json({ success: false, message: `缺少权限: ${missing.join(',')}` });
    }
    return next();
  };
}

module.exports = {
  requestIp,
  writeAudit,
  issueToken,
  requireAgentAuth,
  requireScopes,
};
