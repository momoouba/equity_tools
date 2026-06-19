const { INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING } = require('./constants');

function isFinancingNewsInterface(interfaceType) {
  return interfaceType === INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING;
}

/** 投融资接口尚未接入新闻同步链路时的定时任务跳过日志 */
function logScheduledSkipFinancing(configId) {
  console.warn(
    `[新闻同步定时任务] 配置 ${configId} 为项目挖掘投融资接口（${INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING}），入库同步尚未接入新闻同步链路，已跳过`
  );
}

module.exports = {
  isFinancingNewsInterface,
  logScheduledSkipFinancing,
};
