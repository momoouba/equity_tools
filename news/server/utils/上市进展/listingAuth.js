const db = require('../../db');
const { checkListingPermission } = require('../permissionChecker');

const LISTING_APP_NAME = '上市进展';
const LISTING_LEVEL = {
  BASIC: '普通会员',
  ADVANCED: '高级会员',
  VIP: 'VIP会员',
};
const LISTING_FEATURE = {
  IPO_PROGRESS: 'ipo_progress',
  IPO_PROJECT: 'ipo_project',
  IPO_PROJECT_PROGRESS: 'ipo_project_progress',
  LISTING_CONFIG: 'listing_config',
  NEW_SHARE: 'new_share',
};

async function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'] || null;
  if (!userId) return null;
  const rows = await db.query('SELECT F_Id AS id, account, role FROM users WHERE F_Id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0] : null;
}

function isAdminAccount(account) {
  return String(account || '').trim().toLowerCase() === 'admin';
}

/** 邮件/会员档位：管理员视为最高档（与 VIP 可发内容一致），避免无 membership_level_id 时被降级截断 */
function isListingMailUnrestrictedUser(userRow) {
  if (!userRow) return false;
  if (isAdminAccount(userRow.account)) return true;
  return String(userRow.role || '').trim().toLowerCase() === 'admin';
}

async function getListingMembershipLevelName(userId) {
  if (!userId) return '';
  const rows = await db.query(
    'SELECT app_permissions, account, role FROM users WHERE F_Id = ? LIMIT 1',
    [userId]
  );
  if (!rows.length) return '';
  if (isListingMailUnrestrictedUser(rows[0])) {
    return LISTING_LEVEL.VIP;
  }
  if (!rows[0].app_permissions) return '';
  let appPermissions = [];
  try {
    appPermissions = JSON.parse(rows[0].app_permissions);
  } catch (error) {
    console.warn('[listingAuth] 解析 app_permissions 失败:', error.message);
    return '';
  }
  if (!Array.isArray(appPermissions) || appPermissions.length === 0) return '';
  const levelIds = appPermissions.map((p) => p?.membership_level_id).filter(Boolean);
  if (!levelIds.length) return '';
  const levelRows = await db.query(
    `SELECT ml.F_Id, ml.level_name, a.app_name
     FROM membership_levels ml
     INNER JOIN applications a ON a.F_Id = ml.app_id
     WHERE ml.F_Id IN (${levelIds.map(() => '?').join(',')})`,
    levelIds
  );
  const listingLevel = levelRows.find((item) => item.app_name === LISTING_APP_NAME);
  return listingLevel?.level_name || '';
}

function getAllowedListingFeatures(levelName) {
  if (levelName === LISTING_LEVEL.VIP) {
    return new Set([
      LISTING_FEATURE.IPO_PROGRESS,
      LISTING_FEATURE.IPO_PROJECT,
      LISTING_FEATURE.IPO_PROJECT_PROGRESS,
      LISTING_FEATURE.LISTING_CONFIG,
      LISTING_FEATURE.NEW_SHARE,
    ]);
  }
  if (levelName === LISTING_LEVEL.ADVANCED) {
    return new Set([
      LISTING_FEATURE.IPO_PROGRESS,
      LISTING_FEATURE.IPO_PROJECT,
      LISTING_FEATURE.IPO_PROJECT_PROGRESS,
      LISTING_FEATURE.LISTING_CONFIG,
    ]);
  }
  if (levelName === LISTING_LEVEL.BASIC) {
    return new Set([LISTING_FEATURE.IPO_PROGRESS]);
  }
  return new Set();
}

async function canAccessListing(userId, account) {
  if (isAdminAccount(account)) return true;
  return checkListingPermission(userId);
}

async function hasListingFeature(userId, account, feature) {
  if (isAdminAccount(account)) return true;
  const canAccess = await canAccessListing(userId, account);
  if (!canAccess) return false;
  const levelName = await getListingMembershipLevelName(userId);
  return getAllowedListingFeatures(levelName).has(feature);
}

const LEGACY_NEW_SHARE_MAIL_TYPE = 'new_share';
const NEW_SHARE_UPCOMING_MAIL_TYPE = 'new_share_upcoming';
const NEW_SHARE_APPLY_MAIL_TYPE = 'new_share_apply';

function expandLegacyListingMailTypes(rawTypes) {
  let arr = rawTypes;
  if (arr == null || arr === '') return [];
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [arr];
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const expanded = new Set();
  for (const v of arr) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (s === LEGACY_NEW_SHARE_MAIL_TYPE) {
      expanded.add(NEW_SHARE_UPCOMING_MAIL_TYPE);
      expanded.add(NEW_SHARE_APPLY_MAIL_TYPE);
    } else {
      expanded.add(s);
    }
  }
  return Array.from(expanded);
}

function getAllowedListingMailTypes(levelName) {
  const allowed = new Set(['listing_progress', 'listing_guidance', 'overseas_filing']);
  if (levelName === LISTING_LEVEL.ADVANCED || levelName === LISTING_LEVEL.VIP) {
    allowed.add('listing_project_progress');
  }
  if (levelName === LISTING_LEVEL.VIP) {
    allowed.add(NEW_SHARE_UPCOMING_MAIL_TYPE);
    allowed.add(NEW_SHARE_APPLY_MAIL_TYPE);
    allowed.add('new_share_listed_yesterday');
  }
  return allowed;
}

function normalizeListingMailTypesByLevel(rawTypes, levelName) {
  const allowed = getAllowedListingMailTypes(levelName);
  if (!allowed.size) return [];
  let arr = expandLegacyListingMailTypes(rawTypes);
  if (!arr.length) arr = ['listing_progress'];
  const normalized = Array.from(
    new Set(arr.map((v) => String(v || '').trim()).filter((v) => allowed.has(v)))
  );
  if (normalized.length) return normalized;
  return allowed.has('listing_progress') ? ['listing_progress'] : [];
}

module.exports = {
  LISTING_APP_NAME,
  LISTING_LEVEL,
  LISTING_FEATURE,
  getUserFromHeader,
  isAdminAccount,
  canAccessListing,
  getListingMembershipLevelName,
  hasListingFeature,
  normalizeListingMailTypesByLevel,
  expandLegacyListingMailTypes,
  NEW_SHARE_UPCOMING_MAIL_TYPE,
  NEW_SHARE_APPLY_MAIL_TYPE,
  LEGACY_NEW_SHARE_MAIL_TYPE,
};
