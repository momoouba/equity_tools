/**
 * 项目挖掘 / 投融资业务路由入口
 */
const express = require('express');
const { registerTrackRoutes } = require('./trackRoutes');
const { registerFinancingRoutes } = require('./financingRoutes');
const { registerInvestedEnterpriseAiRoutes } = require('./investedEnterpriseRoutes');
const { registerIpoProjectSourcingRoutes } = require('./ipoProjectSourcingRoutes');
const { registerCompetitorMatchRoutes } = require('./competitorMatchRoutes');

const router = express.Router();
registerTrackRoutes(router);
registerFinancingRoutes(router);
registerInvestedEnterpriseAiRoutes(router);
registerIpoProjectSourcingRoutes(router);
registerCompetitorMatchRoutes(router);

module.exports = router;
