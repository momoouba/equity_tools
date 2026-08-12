const {
  requireProjectSourcingAccess,
} = require('../../utils/project-sourcing/projectSourcingRouteAuth');
const {
  buildMarketOverview,
  buildTrackSecondary,
} = require('../../utils/project-sourcing/marketOverviewService');

function safeErrorMessage(err, fallback = '操作失败') {
  const msg = String(err?.message || err || '');
  if (/ER_|SQLSTATE|ECONNREFUSED|ENOTFOUND|mysql|syntax|Duplicate entry|Deadlock/i.test(msg)) {
    return fallback;
  }
  if (/\/[\w.]+|\\[\w.]+/.test(msg) && msg.length > 120) return fallback;
  return msg.slice(0, 200) || fallback;
}

function registerMarketOverviewRoutes(router) {
  router.get('/market-overview', requireProjectSourcingAccess, async (req, res) => {
    try {
      const data = await buildMarketOverview({
        yearFrom: req.query.year_from,
        yearTo: req.query.year_to,
      });
      res.json({ success: true, data });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[project-sourcing/market-overview]', e);
      res.status(status).json({
        success: false,
        message: safeErrorMessage(e, status === 400 ? e.message : '加载概览失败'),
      });
    }
  });

  router.get('/market-overview/track-secondary', requireProjectSourcingAccess, async (req, res) => {
    try {
      const data = await buildTrackSecondary({
        yearFrom: req.query.year_from,
        yearTo: req.query.year_to,
        trackPrimary: req.query.track_primary,
      });
      res.json({ success: true, data });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[project-sourcing/market-overview/track-secondary]', e);
      res.status(status).json({
        success: false,
        message: safeErrorMessage(e, status === 400 ? e.message : '加载子赛道失败'),
      });
    }
  });
}

module.exports = { registerMarketOverviewRoutes };
