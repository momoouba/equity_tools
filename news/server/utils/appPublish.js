'use strict';

/**
 * 竞品分析 / 项目估值发布链接。
 * 公开页不登录，请求带 x-publish-token 时改写为发布人身份，且只放行该应用的接口。
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateId } = require('./idGenerator');
const { getApplicationIdByAppName } = require('./applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('./enterpriseDataApp');
const { APP_NAME_PROJECT_VALUATION } = require('./valuation/constants');
const { shouldUseViteFrontendHost } = require('./devHost');

const APP_COMPETITOR = DATA_APP_COMPETITOR_ANALYSIS;
const APP_VALUATION = APP_NAME_PROJECT_VALUATION;

/** 发布令牌可访问的接口前缀（按应用名） */
const PUBLISH_PREFIXES = {
  [APP_COMPETITOR]: ['/api/competitor-analysis'],
  [APP_VALUATION]: [
    '/api/valuation',
    '/api/enterprises',
    '/api/companies/search',
    '/api/qichacha/search',
    '/api/system/database-configs',
  ],
};

let ensurePromise = null;

function ensureAppPublishTable() {
  if (!ensurePromise) {
    ensurePromise = db.query(`
      CREATE TABLE IF NOT EXISTS app_publish_links (
        F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID',
        app_id VARCHAR(19) NOT NULL COMMENT '应用ID，区分是哪个应用的发布',
        user_id VARCHAR(19) NOT NULL COMMENT '点击发布的用户，公开链接沿用其鉴权',
        share_token VARCHAR(64) NOT NULL COMMENT '发布令牌',
        status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
        has_expiry TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用过期时间',
        expiry_time DATETIME NULL COMMENT '过期时间',
        has_password TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用访问密码',
        password_hash VARCHAR(255) NULL COMMENT '访问密码哈希',
        F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uk_app_publish_token (share_token),
        UNIQUE KEY uk_app_publish_user_app (user_id, app_id),
        INDEX idx_app_publish_app (app_id),
        INDEX idx_app_publish_status (status),
        FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(F_Id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应用发布链接（竞品分析、项目估值）'
    `).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

function isPublishableApp(appName) {
  return Object.prototype.hasOwnProperty.call(PUBLISH_PREFIXES, appName);
}

/**
 * 项目估值发布令牌访问被投企业时，只允许「项目估值」应用下的数据。
 * 未带 data_app_name 的列表/写入会落到新闻舆情，这里改写成项目估值。
 */
async function guardValuationEnterprise(req, res, pathOnly) {
  if (!pathOnly.startsWith('/api/enterprises')) return true;
  const fromQuery = req.query && req.query.data_app_name;
  const fromBody = req.body && typeof req.body === 'object' ? req.body.data_app_name : undefined;
  const nameFromClient = String(fromQuery || fromBody || '').trim();
  if (nameFromClient && nameFromClient !== APP_VALUATION) {
    res.status(403).json({ success: false, message: '该发布链接仅可访问项目估值下的被投企业' });
    return false;
  }

  const rest = pathOnly.slice('/api/enterprises'.length);
  const parts = rest.split('/').filter(Boolean);
  const staticFirst = new Set(['export', 'batch-import', 'sync-task']);
  if (parts.length === 0 || staticFirst.has(parts[0])) {
    if (req.query && !req.query.data_app_name) req.query.data_app_name = APP_VALUATION;
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && !req.body.data_app_name) {
      req.body.data_app_name = APP_VALUATION;
    }
    return true;
  }

  const rows = await db.query(
    'SELECT data_app_name, data_app_id FROM invested_enterprises WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1',
    [parts[0]]
  );
  if (!rows.length) return true;
  const rowName = String(rows[0].data_app_name || '').trim();
  const rowAppId = rows[0].data_app_id != null ? String(rows[0].data_app_id) : '';
  const valuationId = await getApplicationIdByAppName(APP_VALUATION);
  if (rowName === APP_VALUATION || (valuationId && rowAppId === valuationId)) return true;
  res.status(403).json({ success: false, message: '该发布链接仅可访问项目估值下的被投企业' });
  return false;
}

function pathAllowedForApp(appName, reqPath) {
  const prefixes = PUBLISH_PREFIXES[appName];
  if (!prefixes) return false;
  const pathOnly = String(reqPath || '').split('?')[0];
  return prefixes.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`));
}

function isExpired(link) {
  return !!(link.has_expiry && link.expiry_time && new Date() > new Date(link.expiry_time));
}

const passwordCache = new Map();

async function passwordMatches(link, password) {
  if (!link.has_password) return true;
  if (!link.password_hash) return false;
  const given = password == null ? '' : String(password);
  if (!given) return false;
  const key = `${link.share_token}:${link.password_hash}`;
  const hit = passwordCache.get(key);
  if (hit && hit.until > Date.now() && hit.password === given) return true;
  const ok = await bcrypt.compare(given, link.password_hash);
  if (ok) {
    passwordCache.set(key, { password: given, until: Date.now() + 10 * 60 * 1000 });
  }
  return ok;
}

async function loadLinkByToken(token) {
  const rows = await db.query(
    `SELECT l.F_Id AS id, l.app_id, l.user_id, l.share_token, l.status,
            l.has_expiry, l.expiry_time, l.has_password, l.password_hash,
            a.app_name, u.account AS publisher_account, u.role AS publisher_role
     FROM app_publish_links l
     INNER JOIN applications a ON a.F_Id = l.app_id
     INNER JOIN users u ON u.F_Id = l.user_id
     WHERE l.share_token = ?
     LIMIT 1`,
    [token]
  );
  const row = rows[0];
  if (row && row.app_name != null) row.app_name = String(row.app_name).trim();
  return row || null;
}

function publisherView(link) {
  return {
    id: String(link.user_id),
    account: link.publisher_account || '',
    role: link.publisher_role || 'user',
  };
}

/** Nginx 终结 TLS 后转给 Node 的是 HTTP，对外协议以 X-Forwarded-Proto 为准。 */
function requestPublicProtocol(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwarded === 'https' || forwarded === 'http') return forwarded;
  return req.protocol || 'http';
}

function buildShareUrl(req, token) {
  const isDev = shouldUseViteFrontendHost(req);
  const frontendHost = isDev ? 'localhost:5173' : (process.env.FRONTEND_HOST || req.get('host'));
  const protocol = isDev ? 'http' : requestPublicProtocol(req);
  return `${protocol}://${frontendHost}/share/app/${token}`;
}

function publicLinkPayload(link, req) {
  return {
    id: link.id,
    appId: link.app_id,
    appName: String(link.app_name || '').trim(),
    shareToken: link.share_token,
    shareUrl: buildShareUrl(req, link.share_token),
    status: link.status,
    hasExpiry: link.has_expiry === 1 || link.has_expiry === true,
    expiryTime: link.expiry_time,
    hasPassword: link.has_password === 1 || link.has_password === true,
  };
}

async function findUserLink(userId, appId) {
  const rows = await db.query(
    `SELECT l.F_Id AS id, l.app_id, l.user_id, l.share_token, l.status,
            l.has_expiry, l.expiry_time, l.has_password, l.password_hash,
            a.app_name
     FROM app_publish_links l
     INNER JOIN applications a ON a.F_Id = l.app_id
     WHERE l.user_id = ? AND l.app_id = ?
     LIMIT 1`,
    [userId, appId]
  );
  return rows[0] || null;
}

function generateShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function savePublishLink(userId, appName, body) {
  if (!isPublishableApp(appName)) {
    const err = new Error('该应用不支持发布');
    err.statusCode = 400;
    throw err;
  }
  const appId = await getApplicationIdByAppName(appName);
  if (!appId) {
    const err = new Error('未找到对应应用，无法发布');
    err.statusCode = 400;
    throw err;
  }
  await ensureAppPublishTable();
  const existing = await findUserLink(userId, appId);
  const {
    hasExpiry,
    expiryTime,
    hasPassword,
    password,
    rotateToken,
  } = body || {};

  let passwordHash = existing ? existing.password_hash : null;
  if (hasPassword) {
    if (password) {
      passwordHash = await bcrypt.hash(String(password), 10);
    } else if (!passwordHash) {
      const err = new Error('请输入访问密码');
      err.statusCode = 400;
      throw err;
    }
  } else {
    passwordHash = null;
  }

  if (hasExpiry && !expiryTime) {
    const err = new Error('请选择过期时间');
    err.statusCode = 400;
    throw err;
  }
  const expiryTimeValue = hasExpiry && expiryTime ? new Date(expiryTime) : null;
  if (hasExpiry && Number.isNaN(expiryTimeValue.getTime())) {
    const err = new Error('过期时间无效');
    err.statusCode = 400;
    throw err;
  }

  const token = !existing || existing.status !== 'active' || rotateToken
    ? generateShareToken()
    : existing.share_token;

  if (existing) {
    await db.execute(
      `UPDATE app_publish_links
       SET share_token = ?, status = 'active', has_expiry = ?, expiry_time = ?,
           has_password = ?, password_hash = ?, F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [
        token,
        hasExpiry ? 1 : 0,
        expiryTimeValue,
        hasPassword ? 1 : 0,
        passwordHash,
        existing.id,
      ]
    );
  } else {
    const id = await generateId('app_publish_links');
    await db.execute(
      `INSERT INTO app_publish_links
       (F_Id, app_id, user_id, share_token, status, has_expiry, expiry_time, has_password, password_hash)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        id,
        appId,
        userId,
        token,
        hasExpiry ? 1 : 0,
        expiryTimeValue,
        hasPassword ? 1 : 0,
        passwordHash,
      ]
    );
  }

  const saved = await loadLinkByToken(token);
  return saved;
}

module.exports = {
  APP_COMPETITOR,
  APP_VALUATION,
  ensureAppPublishTable,
  isPublishableApp,
  pathAllowedForApp,
  guardValuationEnterprise,
  isExpired,
  passwordMatches,
  loadLinkByToken,
  publisherView,
  buildShareUrl,
  publicLinkPayload,
  findUserLink,
  savePublishLink,
  getApplicationIdByAppName,
};
