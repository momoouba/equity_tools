/**
 * 项目挖掘 / 投融资业务路由入口
 */
const express = require('express');
const { registerFinancingRoutes } = require('./financingRoutes');

const router = express.Router();
registerFinancingRoutes(router);

module.exports = router;
