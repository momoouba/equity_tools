'use strict';

const crypto = require('crypto');
const express = require('express');
const { ensureAgent } = require('../utils/agent/schema');
const {
  issueToken,
  requireAgentAuth,
  requireScopes,
  requestIp,
  writeAudit,
} = require('../utils/agent/auth');
const { listSubjects, getComparables, getForecast } = require('../utils/agent/readModel');
const {
  READ_SCOPES,
  assertAllowedQuery,
  sanitizeRequestId,
  httpError,
} = require('../utils/agent/contract');

const router = express.Router();

router.use((req, res, next) => {
  const requestId = sanitizeRequestId(req.headers['x-request-id']) || crypto.randomBytes(16).toString('hex');
  req.agentRequestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
});

function sendError(res, err) {
  const code = err && (err.code === 400 || err.code === 401 || err.code === 403 || err.code === 404)
    ? err.code
    : 500;
  if (code === 500) console.error('[agent]', err);
  const message = code === 500 ? '查询失败' : (err && err.message) || '查询失败';
  res.status(code).json({ success: false, message });
  return code;
}

async function auditSafe(entry) {
  try {
    await writeAudit(entry);
  } catch (err) {
    console.error('[agent] audit', err.message || err);
  }
}

router.post('/token', async (req, res) => {
  const ip = requestIp(req);
  const requestId = req.agentRequestId;
  try {
    await ensureAgent();
    assertAllowedQuery(req.query, []);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw httpError('请求体无效', 400);
    }
    const extra = Object.keys(body).filter((key) => key !== 'client_id' && key !== 'client_secret');
    if (extra.length) throw httpError(`不支持的字段: ${extra.join(',')}`, 400);
    const data = await issueToken({
      clientId: body.client_id,
      clientSecret: body.client_secret,
      ip,
    });
    await auditSafe({
      clientId: body.client_id,
      action: 'token.issue',
      resource: null,
      ip,
      requestId,
      httpStatus: 200,
    });
    res.json({ success: true, data });
  } catch (err) {
    const code = sendError(res, err);
    await auditSafe({
      clientId: req.body && req.body.client_id,
      action: 'token.denied',
      resource: null,
      ip,
      requestId,
      httpStatus: code,
    });
  }
});

router.use(requireAgentAuth);

async function read(req, res, action, resource, fn) {
  try {
    const data = await fn();
    await auditSafe({
      clientId: req.agentCaller.clientId,
      action,
      resource,
      ip: req.agentCaller.ip,
      requestId: req.agentCaller.requestId,
      httpStatus: 200,
    });
    res.json({ success: true, data });
  } catch (err) {
    const code = sendError(res, err);
    await auditSafe({
      clientId: req.agentCaller.clientId,
      action,
      resource,
      ip: req.agentCaller.ip,
      requestId: req.agentCaller.requestId,
      httpStatus: code,
    });
  }
}

function parseStage(stage) {
  const value = String(stage || '').trim();
  if (value !== 'pre' && value !== 'post') throw httpError('stage 只能是 pre 或 post', 400);
  return value;
}

function parseId(id) {
  const value = String(id || '').trim();
  if (!value || value.length > 32) throw httpError('主体 id 无效', 400);
  return value;
}

router.get('/subjects', requireScopes(READ_SCOPES), async (req, res) => {
  await read(req, res, 'subjects.list', `subjects:${String(req.query.stage || '').trim()}`, () => {
    assertAllowedQuery(req.query, ['stage', 'keyword', 'page', 'pageSize']);
    const stage = parseStage(req.query.stage);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    return listSubjects({
      stage,
      keyword: req.query.keyword,
      page,
      pageSize,
    });
  });
});

router.get('/competitor/subjects/:stage/:id/comparables', requireScopes('competitor:read'), async (req, res) => {
  await read(req, res, 'competitor.comparables', `${req.params.stage}:${req.params.id}`, () => {
    assertAllowedQuery(req.query, []);
    return getComparables(parseStage(req.params.stage), parseId(req.params.id));
  });
});

router.get('/valuation/cases/:id/forecast', requireScopes('valuation:read'), async (req, res) => {
  await read(req, res, 'valuation.forecast', `case:${req.params.id}`, () => {
    assertAllowedQuery(req.query, ['version_id']);
    const versionId = String(req.query.version_id || '').trim();
    return getForecast(parseId(req.params.id), versionId);
  });
});

module.exports = router;
