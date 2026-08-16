const { APP_NAME_PROJECT_VALUATION } = require('./constants');

async function checkProjectValuationPermission(userId) {
  const { checkUserAppPermission } = require('../permissionChecker');
  return checkUserAppPermission(userId, APP_NAME_PROJECT_VALUATION);
}

module.exports = {
  checkProjectValuationPermission,
};
