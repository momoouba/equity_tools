const db = require('../db');

/**
 * 检查用户是否有指定应用的权限
 * 为了彻底避免 collation 冲突，这里只用 ID 进行判断，不再在 UNION 中返回字符串字段
 * @param {string} userId - 用户ID
 * @param {string} appName - 应用名称（如"新闻舆情"）
 * @returns {Promise<boolean>} - 是否有权限
 */
async function checkUserAppPermission(userId, appName) {
  try {
    // 先通过 app_name 精确找到应用 ID，使用 BINARY 避免字符串比较的 collation 问题
    const appResult = await db.query(
      `SELECT id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
      [appName]
    );

    if (appResult.length === 0) {
      // 应用不存在
      return false;
    }

    const appId = appResult[0].id;

    // 1）通过会员等级（membership_levels）判断是否有该应用权限
    const levelResult = await db.query(
      `SELECT 1 AS has_permission
       FROM users u
       LEFT JOIN membership_levels ml ON u.membership_level_id = ml.id
       WHERE u.id = ? AND ml.app_id = ?
       LIMIT 1`,
      [userId, appId]
    );

    if (levelResult.length > 0) {
      return true;
    }

    // 2）如果会员等级里没有，再通过用户自定义的 app_permissions(JSON) 判断
    // 这里只比较 ID，不再 JOIN applications 表，避免任何字符串 collation 问题
    try {
      const jsonResult = await db.query(
        `SELECT 1 AS has_permission
         FROM users u
         CROSS JOIN JSON_TABLE(
           IFNULL(u.app_permissions, '[]'),
           '$[*]' COLUMNS (
             app_id VARCHAR(19) PATH '$.app_id'
           )
         ) AS jt
         WHERE u.id = ? AND BINARY jt.app_id = BINARY ?
         LIMIT 1`,
        [userId, appId]
      );

      return jsonResult.length > 0;
    } catch (jsonError) {
      // 如果 JSON_TABLE 在当前 MySQL 版本中不支持（例如 5.7），记录日志但不阻塞
      console.error('通过 JSON_TABLE 检查应用权限失败，将仅使用会员等级结果:', jsonError);
      return false;
    }
  } catch (error) {
    console.error('检查用户应用权限失败:', error);
    // 出现异常时，为了不影响正常功能，可以按需选择：
    // - 返回 false：严格权限控制（当前实现）
    // - 或者返回 true：出现异常时放行
    return false;
  }
}

/**
 * 检查用户是否有"新闻舆情"应用的权限
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>} - 是否有权限
 */
async function checkNewsPermission(userId) {
  return checkUserAppPermission(userId, '新闻舆情');
}

/** 上市进展菜单权限 */
async function checkListingPermission(userId) {
  return checkUserAppPermission(userId, '上市进展');
}

module.exports = {
  checkUserAppPermission,
  checkNewsPermission,
  checkListingPermission,
};

