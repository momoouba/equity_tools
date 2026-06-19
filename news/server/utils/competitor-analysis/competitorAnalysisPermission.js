const { APP_NAME_COMPETITOR_ANALYSIS } = require('./constants');

async function checkCompetitorAnalysisPermission(userId) {
  const { checkUserAppPermission } = require('../permissionChecker');
  return checkUserAppPermission(userId, APP_NAME_COMPETITOR_ANALYSIS);
}

module.exports = {
  checkCompetitorAnalysisPermission,
};
