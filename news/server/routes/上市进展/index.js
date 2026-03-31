const express = require('express');
const { registerIpoProjectRoutes } = require('./ipoProject');
const { registerIpoProgressRoutes } = require('./ipoProgress');
const { registerIpoProjectProgressRoutes } = require('./ipoProjectProgress');
const { registerMatchRoutes } = require('./match');
const { registerListingConfigRoutes } = require('./listingConfig');
const { registerRecipientRoutes } = require('./recipients');
const { registerIpoProjectSyncRoutes } = require('./ipoProjectSync');
const { registerListingLogsRoutes } = require('./listingLogs');

const router = express.Router();

registerIpoProjectSyncRoutes(router);
registerIpoProjectRoutes(router);
registerListingLogsRoutes(router);
registerIpoProgressRoutes(router);
registerIpoProjectProgressRoutes(router);
registerMatchRoutes(router);
registerListingConfigRoutes(router);
registerRecipientRoutes(router);

module.exports = router;
