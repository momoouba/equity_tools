'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { READ_SCOPES, SERVICE_ACCOUNT } = require('./contract');

const SERVICE_PHONE = 'wb-svc-0000001';
const SERVICE_EMAIL = 'agent-integration@internal.invalid';

let pending = null;
let bootWarned = false;

async function renameLegacyTables() {
  const pairs = [
    ['workbuddy_access_token', 'agent_access_token'],
    ['workbuddy_audit', 'agent_audit'],
    ['workbuddy_client', 'agent_client'],
  ];
  for (const [from, to] of pairs) {
    const oldRows = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [from]
    );
    if (!oldRows.length) continue;
    const newRows = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [to]
    );
    if (!newRows.length) {
      await db.query(`RENAME TABLE \`${from}\` TO \`${to}\``);
    }
  }
}

async function ensureTables() {
  await renameLegacyTables();
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_client (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      client_id VARCHAR(64) NOT NULL,
      secret_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      ip_allowlist TEXT NULL,
      scopes VARCHAR(255) NOT NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_agent_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent 集成客户端'
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_access_token (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      client_row_id VARCHAR(19) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked TINYINT(1) NOT NULL DEFAULT 0,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_agent_token (token_hash),
      KEY idx_agent_token_client (client_row_id),
      KEY idx_agent_token_exp (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent 短期访问令牌'
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_audit (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      client_id VARCHAR(64) NULL,
      action VARCHAR(64) NOT NULL,
      resource VARCHAR(255) NULL,
      ip VARCHAR(64) NULL,
      request_id VARCHAR(64) NULL,
      http_status INT NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_agent_audit_time (F_CreatorTime),
      KEY idx_agent_audit_client (client_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent 调用审计'
  `);
  await ensureClientColumns();
}

async function ensureClientColumns() {
  const columns = [
    ['display_name', "VARCHAR(100) NULL COMMENT '凭证名称' AFTER client_id"],
    ['assignee_user_id', "VARCHAR(19) NULL COMMENT '发给的用户' AFTER display_name"],
    ['secret_prefix', "VARCHAR(8) NULL COMMENT '密钥前缀，仅用于辨认' AFTER secret_hash"],
    ['remark', "VARCHAR(255) NULL COMMENT '备注' AFTER scopes"],
  ];
  for (const [name, ddl] of columns) {
    const rows = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_client' AND COLUMN_NAME = ?`,
      [name]
    );
    if (!rows.length) {
      await db.query(`ALTER TABLE agent_client ADD COLUMN ${name} ${ddl}`);
    }
  }
}

async function ensureServiceUser() {
  const legacy = await db.query(
    'SELECT F_Id AS id FROM users WHERE account = ? LIMIT 1',
    ['workbuddy_integration']
  );
  const current = await db.query(
    'SELECT F_Id AS id FROM users WHERE account = ? LIMIT 1',
    [SERVICE_ACCOUNT]
  );
  if (legacy.length && !current.length) {
    await db.execute(
      'UPDATE users SET account = ?, email = ? WHERE F_Id = ?',
      [SERVICE_ACCOUNT, SERVICE_EMAIL, legacy[0].id]
    );
  }
  const existing = await db.query(
    'SELECT F_Id AS id, account, role FROM users WHERE account = ? LIMIT 1',
    [SERVICE_ACCOUNT]
  );
  if (existing.length) return existing[0];
  const id = await generateId('users');
  const password = crypto.randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await db.execute(
      `INSERT INTO users (F_Id, account, phone, email, password, role, account_status)
       VALUES (?,?,?,?,?,?,?)`,
      [id, SERVICE_ACCOUNT, SERVICE_PHONE, SERVICE_EMAIL, passwordHash, 'admin', 'active']
    );
  } catch (err) {
    const again = await db.query(
      'SELECT F_Id AS id, account, role FROM users WHERE account = ? LIMIT 1',
      [SERVICE_ACCOUNT]
    );
    if (again.length) return again[0];
    throw err;
  }
  return { id, account: SERVICE_ACCOUNT, role: 'admin' };
}

function allowlistFromEnv() {
  if (process.env.AGENT_IP_ALLOWLIST === undefined) return undefined;
  const parts = String(process.env.AGENT_IP_ALLOWLIST)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  return JSON.stringify(parts);
}

async function ensureClientFromEnv() {
  const clientId = String(process.env.AGENT_CLIENT_ID || '').trim();
  const secret = String(process.env.AGENT_CLIENT_SECRET || '');
  const rows = await db.query('SELECT COUNT(*) AS c FROM agent_client');
  const hasClient = Number(rows[0]?.c || 0) > 0;
  if (!clientId && !secret) {
    if (!hasClient && !bootWarned) {
      bootWarned = true;
      console.warn('[agent] 未设置 AGENT_CLIENT_ID / AGENT_CLIENT_SECRET，换票不可用');
    }
    return;
  }
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(clientId) || secret.length < 16) {
    if (!bootWarned) {
      bootWarned = true;
      console.warn('[agent] AGENT_CLIENT_ID 或 AGENT_CLIENT_SECRET 不符合要求，已跳过写入');
    }
    return;
  }
  const scopes = READ_SCOPES.join(',');
  const allowlist = allowlistFromEnv();
  const found = await db.query(
    'SELECT F_Id AS id, secret_hash FROM agent_client WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  if (!found.length) {
    const id = await generateId('agent_client');
    const secretHash = await bcrypt.hash(secret, 10);
    await db.execute(
      `INSERT INTO agent_client (F_Id, client_id, secret_hash, status, ip_allowlist, scopes)
       VALUES (?,?,?,?,?,?)`,
      [id, clientId, secretHash, 'active', allowlist == null ? null : allowlist, scopes]
    );
    console.log('[agent] 已创建集成客户端');
    return;
  }
  const match = await bcrypt.compare(secret, found[0].secret_hash);
  if (!match) {
    const secretHash = await bcrypt.hash(secret, 10);
    await db.execute(
      'UPDATE agent_client SET secret_hash = ?, status = ?, F_LastModifyTime = NOW() WHERE F_Id = ?',
      [secretHash, 'active', found[0].id]
    );
    console.log('[agent] 已按环境变量更新集成客户端密钥');
  }
  if (allowlist !== undefined) {
    await db.execute(
      'UPDATE agent_client SET ip_allowlist = ?, F_LastModifyTime = NOW() WHERE F_Id = ?',
      [allowlist, found[0].id]
    );
  }
}

async function ensureAgentOnce() {
  await ensureTables();
  await ensureServiceUser();
  await ensureClientFromEnv();
}

function ensureAgent() {
  if (!pending) {
    pending = ensureAgentOnce().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function loadServiceUser() {
  await ensureAgent();
  const rows = await db.query(
    'SELECT F_Id AS id, account, role FROM users WHERE account = ? AND account_status = ? LIMIT 1',
    [SERVICE_ACCOUNT, 'active']
  );
  return rows[0] || null;
}

module.exports = {
  ensureAgent,
  loadServiceUser,
};
