const { runListingMatchBatch } = require('../../utils/上市进展/listingMatchRunner');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const db = require('../../db');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

/**
 * POST /api/listing/match
 * body: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * 按需求：匹配 ipo_progress 与 ipo_project，笛卡尔组合写入 ipo_project_progress
 */
async function runMatch(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    let { startDate, endDate } = req.body || {};
    if (!startDate || !endDate) {
      const rows = await db.query(
        `SELECT
           DATE_FORMAT(MIN(f_update_time), '%Y-%m-%d') AS min_date,
           DATE_FORMAT(MAX(f_update_time), '%Y-%m-%d') AS max_date
         FROM ipo_progress
         WHERE F_DeleteMark = 0`
      );
      const minDate = rows?.[0]?.min_date;
      const maxDate = rows?.[0]?.max_date;
      if (!minDate || !maxDate) {
        return res.status(400).json({ success: false, message: '上市信息表暂无可匹配数据' });
      }
      startDate = minDate;
      endDate = maxDate;
    }

    const restrictProjectUserId = isAdminAccount(user.account) ? null : user.id;
    const result = await runListingMatchBatch({
      startDate,
      endDate,
      restrictProjectUserId,
    });

    return res.json({
      success: true,
      data: {
        progressCount: result.progressCount,
        projectCount: result.projectCount,
        inserted: result.inserted,
      },
    });
  } catch (e) {
    console.error('runMatch', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

function registerMatchRoutes(router) {
  router.post('/match', runMatch);
}

module.exports = { registerMatchRoutes };
