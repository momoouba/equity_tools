const db = require('../../db');
const { checkListingPermission } = require('../permissionChecker');

const LISTING_APP_NAME = '上市进展';

async function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'] || null;
  if (!userId) return null;
  const rows = await db.query('SELECT id, account FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0] : null;
}

function isAdminAccount(account) {
  return account === 'admin';
}

async function canAccessListing(userId, account) {
  if (isAdminAccount(account)) return true;
  return checkListingPermission(userId);
}

module.exports = {
  LISTING_APP_NAME,
  getUserFromHeader,
  isAdminAccount,
  canAccessListing,
};
