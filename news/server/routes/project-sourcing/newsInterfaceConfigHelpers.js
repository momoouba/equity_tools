const C = require('../../utils/project-sourcing/constants');

const FIELD_ORDER =
  'ORDER BY FIELD(news_type, "新闻舆情", "行政处罚", "被执行人", "失信被执行人", "限制高消费", "终本案件", "破产重组", "破产重整", "裁判文书", "法院公告", "开庭公告", "送达公告", "立案信息", "同花顺订阅")';

function getNewsTypeOptionsOrderSql(interfaceType) {
  if (interfaceType === C.INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING) {
    return 'ORDER BY news_type';
  }
  return FIELD_ORDER;
}

function filterBankruptcyNewsTypes(interfaceType, rows) {
  if (
    interfaceType === '上海国际集团' ||
    interfaceType === '企查查' ||
    interfaceType === C.INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING
  ) {
    return rows.filter((r) => r.news_type !== '破产重组');
  }
  return rows;
}

/** 与企查查、上海国际集团一致：不写 content_type、不要求本表 api_key */
function isNewsInterfaceUsingNullContentType(interfaceType) {
  return (
    interfaceType === '企查查' ||
    interfaceType === '上海国际集团' ||
    interfaceType === C.INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING
  );
}

/** entity_type：过滤「额外公众号」及校验 */
function shouldRestrictEntityExtraWechat(interfaceType) {
  return isNewsInterfaceUsingNullContentType(interfaceType);
}

/** PUT：frequency_type 联动 send_frequency */
function shouldSyncSendFrequencyFromFrequencyType(interfaceType) {
  return shouldRestrictEntityExtraWechat(interfaceType);
}

async function validateFinancingSigByApp(db, appId) {
  const sigConfigs = await db.query(
    `SELECT F_Id AS id FROM shanghai_international_group_config WHERE app_id = ? AND is_active = 1 LIMIT 1`,
    [appId]
  );
  if (sigConfigs.length === 0) {
    return {
      ok: false,
      message: '请先在「上海国际集团接口配置」中为「项目挖掘」应用添加 X-App-Id、APIkey 等凭证',
    };
  }
  return { ok: true };
}

module.exports = {
  getNewsTypeOptionsOrderSql,
  filterBankruptcyNewsTypes,
  isNewsInterfaceUsingNullContentType,
  shouldRestrictEntityExtraWechat,
  shouldSyncSendFrequencyFromFrequencyType,
  validateFinancingSigByApp,
  INTERFACE_TYPE_FINANCING: C.INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING,
};
