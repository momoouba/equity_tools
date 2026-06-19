/**
 * 烯牛行业标签 → 内部标准行业（首期种子映射，未命中则标准列为空）
 * 后续可迁 MySQL 配置表，接口保持不变。
 */

/** @type {{ lv1: string, lv2: string, std1: string, std2: string }[]} */
const SEED_MAP = [
  // 原有映射
  { lv1: '文娱传媒', lv2: '媒体', std1: '文娱传媒', std2: '媒体' },
  { lv1: '人工智能', lv2: '人工智能基础技术', std1: '人工智能', std2: '人工智能基础技术' },
  { lv1: '人工智能', lv2: '', std1: '人工智能', std2: '' },
  // 扩充常见 PE/VC 投资行业映射
  { lv1: '医疗健康', lv2: '', std1: '医疗健康', std2: '' },
  { lv1: '医疗健康', lv2: '生物医药', std1: '医疗健康', std2: '生物医药' },
  { lv1: '医疗健康', lv2: '医疗器械', std1: '医疗健康', std2: '医疗器械' },
  { lv1: '医疗健康', lv2: '医疗服务', std1: '医疗健康', std2: '医疗服务' },
  { lv1: '医疗健康', lv2: '数字医疗', std1: '医疗健康', std2: '数字医疗' },
  { lv1: '半导体', lv2: '', std1: '半导体', std2: '' },
  { lv1: '半导体', lv2: '芯片设计', std1: '半导体', std2: '芯片设计' },
  { lv1: '半导体', lv2: '芯片制造', std1: '半导体', std2: '芯片制造' },
  { lv1: '先进制造', lv2: '', std1: '先进制造', std2: '' },
  { lv1: '先进制造', lv2: '机器人', std1: '先进制造', std2: '机器人' },
  { lv1: '先进制造', lv2: '航空航天', std1: '先进制造', std2: '航空航天' },
  { lv1: '新能源', lv2: '', std1: '新能源', std2: '' },
  { lv1: '新能源', lv2: '光伏', std1: '新能源', std2: '光伏' },
  { lv1: '新能源', lv2: '储能', std1: '新能源', std2: '储能' },
  { lv1: '新能源', lv2: '新能源汽车', std1: '新能源', std2: '新能源汽车' },
  { lv1: '新能源', lv2: '电池', std1: '新能源', std2: '电池' },
  { lv1: '新材料', lv2: '', std1: '新材料', std2: '' },
  { lv1: '消费', lv2: '', std1: '消费', std2: '' },
  { lv1: '消费', lv2: '食品饮料', std1: '消费', std2: '食品饮料' },
  { lv1: '消费', lv2: '品牌消费', std1: '消费', std2: '品牌消费' },
  { lv1: '企业服务', lv2: '', std1: '企业服务', std2: '' },
  { lv1: '企业服务', lv2: 'SaaS', std1: '企业服务', std2: 'SaaS' },
  { lv1: '企业服务', lv2: '云计算', std1: '企业服务', std2: '云计算' },
  { lv1: '金融科技', lv2: '', std1: '金融科技', std2: '' },
  { lv1: '教育', lv2: '', std1: '教育', std2: '' },
  { lv1: '物流', lv2: '', std1: '物流供应链', std2: '' },
  { lv1: '物流供应链', lv2: '', std1: '物流供应链', std2: '' },
  { lv1: '电子商务', lv2: '', std1: '电子商务', std2: '' },
  { lv1: '旅游', lv2: '', std1: '文旅消费', std2: '' },
  { lv1: '农业', lv2: '', std1: '现代农业', std2: '' },
  { lv1: '现代农业', lv2: '', std1: '现代农业', std2: '' },
  { lv1: '环保', lv2: '', std1: '节能环保', std2: '' },
  { lv1: '节能环保', lv2: '', std1: '节能环保', std2: '' },
  { lv1: '大数据', lv2: '', std1: '大数据', std2: '' },
  { lv1: '区块链', lv2: '', std1: '区块链', std2: '' },
  { lv1: '物联网', lv2: '', std1: '物联网', std2: '' },
  { lv1: '网络安全', lv2: '', std1: '网络安全', std2: '' },
];

/**
 * @returns {{ industry_std_lv1: string|null, industry_std_lv2: string|null, industry_match_confidence: number }}
 */
function mapIndustryToStd(lv1, lv2) {
  const a = (lv1 || '').trim();
  const b = (lv2 || '').trim();
  if (!a && !b) {
    return { industry_std_lv1: null, industry_std_lv2: null, industry_match_confidence: 0 };
  }

  const exact = SEED_MAP.find((m) => m.lv1 === a && (m.lv2 || '') === b);
  if (exact) {
    return {
      industry_std_lv1: exact.std1 || null,
      industry_std_lv2: exact.std2 || null,
      industry_match_confidence: 0.95,
    };
  }

  // #5.2 fix: 仅 lv1 命中时，lv2 未经映射验证，不应将原始来源 lv2 透传为"标准" lv2，
  // 否则下游会误以为 lv2 已标准化。改为 null 并降低置信度至 0.55。
  const lv1Only = SEED_MAP.find((m) => m.lv1 === a && !m.lv2);
  if (lv1Only) {
    return {
      industry_std_lv1: lv1Only.std1 || null,
      industry_std_lv2: null,
      industry_match_confidence: 0.55,
    };
  }

  return { industry_std_lv1: null, industry_std_lv2: null, industry_match_confidence: 0 };
}

module.exports = {
  mapIndustryToStd,
  SEED_MAP,
};
