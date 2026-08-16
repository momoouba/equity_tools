/**
 * 项目估值应用 — HTTP 路由入口
 */
const express = require('express');
const { registerValuationRoutes } = require('./caseRoutes');

const router = express.Router();
registerValuationRoutes(router);

module.exports = router;
