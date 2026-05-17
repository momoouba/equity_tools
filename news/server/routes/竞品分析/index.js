/**
 * 竞品分析应用 — HTTP 路由入口
 */
const express = require('express');
const { registerCompetitorMatchRoutes } = require('./competitorMatchRoutes');
const { registerIpoProjectSourcingRoutes } = require('./ipoProjectSourcingRoutes');
const { registerInvestedEnterpriseAiRoutes } = require('./investedEnterpriseRoutes');

const router = express.Router();
registerCompetitorMatchRoutes(router);
registerIpoProjectSourcingRoutes(router);
registerInvestedEnterpriseAiRoutes(router);

module.exports = router;
