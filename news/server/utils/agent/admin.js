'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { ensureAgent } = require('./schema');
const { READ_SCOPES, SERVICE_ACCOUNT, httpError, normalizeIp } = require('./contract');

const ACTION_LABELS = {
  'token.issue': '换票成功',
  'token.denied': '换票失败',
  'auth.denied': '访问被拒绝',
  'subjects.list': '查询主体',
  'competitor.comparables': '查询可比公司',
  'valuation.forecast': '查询盈利预测',
};

function fmtTs(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v).replace('T', ' ').slice(0, 19);
}

function newClientId() {
  return `ag${crypto.randomBytes(6).toString('hex')}`;
}

function newSecret() {
  return crypto.randomBytes(24).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseIpInput(text) {
  const parts = String(text || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length > 20) throw httpError('白名单最多 20 个地址', 400);
  const normalized = [];
  for (const part of parts) {
    if (part.length > 64 || !/^[0-9a-fA-F:.]+$/.test(part)) {
      throw httpError(`IP 无效: ${part}`, 400);
    }
    normalized.push(normalizeIp(part));
  }
  return JSON.stringify(normalized);
}

function allowlistText(raw) {
  if (raw == null || String(raw).trim() === '') return '';
  try {
    const list = JSON.parse(String(raw));
    return Array.isArray(list) ? list.join(', ') : '';
  } catch {
    return '';
  }
}

async function requireAssignee(userId) {
  const id = String(userId || '').trim();
  if (!id) throw httpError('请选择要发给的用户', 400);
  const rows = await db.query(
    `SELECT F_Id AS id, account, company_name, account_status
     FROM users WHERE F_Id = ? LIMIT 1`,
    [id]
  );
  const user = rows[0];
  if (!user || user.account_status !== 'active') throw httpError('用户不存在或已停用', 400);
  if (String(user.account) === SERVICE_ACCOUNT) throw httpError('不能把密钥发给集成账号', 400);
  return user;
}

function publicKey(row) {
  return {
    id: String(row.id),
    client_id: row.client_id,
    display_name: row.display_name || row.client_id,
    assignee_user_id: row.assignee_user_id || null,
    assignee_account: row.assignee_account || null,
    assignee_company: row.assignee_company || null,
    secret_prefix: row.secret_prefix || null,
    status: row.status === 'active' ? 'active' : 'disabled',
    ip_allowlist: allowlistText(row.ip_allowlist),
    remark: row.remark || '',
    last_called_at: fmtTs(row.last_called_at),
    created_at: fmtTs(row.created_at),
  };
}

async function listAssignees() {
  await ensureAgent();
  const rows = await db.query(
    `SELECT F_Id AS id, account, company_name
     FROM users
     WHERE account <> ? AND account_status = 'active'
     ORDER BY account ASC
     LIMIT 500`,
    [SERVICE_ACCOUNT]
  );
  return rows.map((row) => ({
    id: String(row.id),
    account: row.account,
    company_name: row.company_name || '',
  }));
}

async function listKeys({ page, pageSize, keyword }) {
  await ensureAgent();
  const like = String(keyword || '').trim().slice(0, 100);
  const where = ['1=1'];
  const params = [];
  if (like) {
    where.push('(c.display_name LIKE ? OR c.client_id LIKE ? OR u.account LIKE ?)');
    const term = `%${like}%`;
    params.push(term, term, term);
  }
  const whereSql = where.join(' AND ');
  const countRows = await db.query(
    `SELECT COUNT(*) AS c
     FROM agent_client c
     LEFT JOIN users u ON u.F_Id = c.assignee_user_id
     WHERE ${whereSql}`,
    params
  );
  const offset = (page - 1) * pageSize;
  const rows = await db.query(
    `SELECT c.F_Id AS id, c.client_id, c.display_name, c.assignee_user_id, c.secret_prefix,
            c.status, c.ip_allowlist, c.remark, c.F_CreatorTime AS created_at,
            u.account AS assignee_account, u.company_name AS assignee_company,
            (SELECT MAX(a.F_CreatorTime) FROM agent_audit a WHERE a.client_id = c.client_id) AS last_called_at
     FROM agent_client c
     LEFT JOIN users u ON u.F_Id = c.assignee_user_id
     WHERE ${whereSql}
     ORDER BY c.F_CreatorTime DESC, c.F_Id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return {
    list: rows.map(publicKey),
    total: Number(countRows[0]?.c || 0),
    page,
    pageSize,
  };
}

async function insertKey({ displayName, assigneeUserId, remark, ipAllowlist }) {
  await ensureAgent();
  const name = String(displayName || '').trim();
  if (!name || name.length > 100) throw httpError('请填写不超过 100 字的名称', 400);
  const note = String(remark || '').trim();
  if (note.length > 255) throw httpError('备注不超过 255 字', 400);
  const assignee = await requireAssignee(assigneeUserId);
  const allowlist = parseIpInput(ipAllowlist);
  const secret = newSecret();
  const secretHash = await bcrypt.hash(secret, 10);
  const prefix = secret.slice(0, 4);
  let clientId = newClientId();
  let id = '';
  let inserted = false;
  for (let i = 0; i < 3; i += 1) {
    id = await generateId('agent_client');
    try {
      await db.execute(
        `INSERT INTO agent_client (
           F_Id, client_id, display_name, assignee_user_id, secret_hash, secret_prefix,
           status, ip_allowlist, scopes, remark
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          clientId,
          name,
          assignee.id,
          secretHash,
          prefix,
          'active',
          allowlist,
          READ_SCOPES.join(','),
          note || null,
        ]
      );
      inserted = true;
      break;
    } catch (err) {
      if (i === 2 || !/uk_agent_client|Duplicate/.test(String(err.message || ''))) throw err;
      clientId = newClientId();
    }
  }
  if (!inserted) throw httpError('创建失败，请重试', 500);
  return {
    id,
    client_id: clientId,
    client_secret: secret,
    display_name: name,
    assignee_account: assignee.account,
  };
}

async function loadKey(id) {
  const rows = await db.query(
    'SELECT F_Id AS id, client_id, status FROM agent_client WHERE F_Id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) throw httpError('凭证不存在', 404);
  return rows[0];
}

async function setKeyStatus(id, status) {
  await ensureAgent();
  const next = status === 'active' ? 'active' : status === 'disabled' ? 'disabled' : '';
  if (!next) throw httpError('状态只能是 active 或 disabled', 400);
  const key = await loadKey(id);
  await db.execute(
    'UPDATE agent_client SET status = ?, F_LastModifyTime = NOW() WHERE F_Id = ?',
    [next, key.id]
  );
  if (next === 'disabled') {
    await db.execute(
      'UPDATE agent_access_token SET revoked = 1 WHERE client_row_id = ? AND revoked = 0',
      [key.id]
    );
  }
  return { id: String(key.id), client_id: key.client_id, status: next };
}

async function rotateKey(id) {
  await ensureAgent();
  const key = await loadKey(id);
  const secret = newSecret();
  const secretHash = await bcrypt.hash(secret, 10);
  await db.execute(
    `UPDATE agent_client
     SET secret_hash = ?, secret_prefix = ?, F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [secretHash, secret.slice(0, 4), key.id]
  );
  await db.execute(
    'UPDATE agent_access_token SET revoked = 1 WHERE client_row_id = ? AND revoked = 0',
    [key.id]
  );
  return {
    id: String(key.id),
    client_id: key.client_id,
    client_secret: secret,
  };
}

async function listLogs({ page, pageSize, clientId }) {
  await ensureAgent();
  const cid = String(clientId || '').trim();
  const where = ['1=1'];
  const params = [];
  if (cid) {
    where.push('a.client_id = ?');
    params.push(cid);
  }
  const whereSql = where.join(' AND ');
  const countRows = await db.query(
    `SELECT COUNT(*) AS c FROM agent_audit a WHERE ${whereSql}`,
    params
  );
  const offset = (page - 1) * pageSize;
  const rows = await db.query(
    `SELECT a.F_Id AS id, a.client_id, a.action, a.resource, a.ip, a.request_id,
            a.http_status, a.F_CreatorTime AS created_at,
            c.display_name, u.account AS assignee_account
     FROM agent_audit a
     LEFT JOIN agent_client c ON c.client_id = a.client_id
     LEFT JOIN users u ON u.F_Id = c.assignee_user_id
     WHERE ${whereSql}
     ORDER BY a.F_CreatorTime DESC, a.F_Id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return {
    list: rows.map((row) => ({
      id: String(row.id),
      client_id: row.client_id || null,
      display_name: row.display_name || row.client_id || '',
      assignee_account: row.assignee_account || null,
      action: row.action,
      action_label: ACTION_LABELS[row.action] || row.action,
      resource: row.resource || '',
      ip: row.ip || '',
      request_id: row.request_id || '',
      http_status: row.http_status == null ? null : Number(row.http_status),
      created_at: fmtTs(row.created_at),
    })),
    total: Number(countRows[0]?.c || 0),
    page,
    pageSize,
  };
}

module.exports = {
  listAssignees,
  listKeys,
  insertKey,
  setKeyStatus,
  rotateKey,
  listLogs,
};
