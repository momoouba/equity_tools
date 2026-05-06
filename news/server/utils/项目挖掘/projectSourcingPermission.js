const { APP_NAME_PROJECT_SOURCING } = require('./constants');

/**
 * 项目挖掘菜单 / 接口权限（依赖 permissionChecker.checkUserAppPermission）
 * 运行时 require permissionChecker，避免与 permissionChecker 循环依赖。
 */
async function checkProjectSourcingPermission(userId) {
  const { checkUserAppPermission } = require('../permissionChecker');
  return checkUserAppPermission(userId, APP_NAME_PROJECT_SOURCING);
}

module.exports = {
  checkProjectSourcingPermission,
};
