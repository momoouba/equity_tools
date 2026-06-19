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

    let { startDate, endDate, newShareStartDate, newShareEndDate, newShareLookbackDays, matchTypes } = req.body || {};
    const norm = (v) => {
      const s = String(v || '').trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    };
    newShareStartDate = norm(newShareStartDate);
    newShareEndDate = norm(newShareEndDate);
    const lookback = Number(newShareLookbackDays || 0);
    newShareLookbackDays = Number.isFinite(lookback) && lookback > 0 ? Math.floor(lookback) : 0;
    const selectedTypes = Array.isArray(matchTypes)
      ? Array.from(new Set(matchTypes.map((x) => String(x || '').trim()).filter(Boolean)))
      : [];
    const selectedIpoTypes = selectedTypes.filter((x) =>
      ['exchange_ipo', 'guidance_progress', 'overseas_filing'].includes(x)
    );
    const effectiveMatchTypes =
      selectedTypes.length > 0 ? selectedTypes : ['exchange_ipo', 'guidance_progress', 'overseas_filing', 'new_share'];

    if (selectedIpoTypes.length > 0 && (!startDate || !endDate)) {
      const rows = await db.query(
        `SELECT
           DATE_FORMAT(MIN(F_UpdateTime), '%Y-%m-%d') AS min_date,
           DATE_FORMAT(MAX(F_UpdateTime), '%Y-%m-%d') AS max_date
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
      newShareStartDate,
      newShareEndDate,
      newShareLookbackDays,
      matchTypes: effectiveMatchTypes,
    });

    return res.json({
      success: true,
      data: {
        progressCount: result.progressCount,
        projectCount: result.projectCount,
        newShareCount: result.newShareCount || 0,
        newShareMatchCount: result.newShareMatchCount || 0,
        newShareSkipped: result.newShareSkipped || 0,
        newSharePublicDate: result.newSharePublicDate || null,
        insertedFromIpoProgress: result.insertedFromIpoProgress || 0,
        skippedFromIpoProgress: result.skippedFromIpoProgress || 0,
        insertedFromNewShare: result.insertedFromNewShare || 0,
        yesterdayStatusBackfilled: result.yesterdayStatusBackfilled || 0,
        yesterdaySourceBackfilled: result.yesterdaySourceBackfilled || 0,
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
