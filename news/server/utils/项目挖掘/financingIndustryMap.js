/**
 * 烯牛行业标签 → 内部标准行业（首期种子映射，未命中则标准列为空）
 * 后续可迁 MySQL 配置表，接口保持不变。
 */

/** @type {{ lv1: string, lv2: string, std1: string, std2: string }[]} */
const SEED_MAP = [
  { lv1: '文娱传媒', lv2: '媒体', std1: '文娱传媒', std2: '媒体' },
  { lv1: '人工智能', lv2: '人工智能基础技术', std1: '人工智能', std2: '人工智能基础技术' },
  { lv1: '人工智能', lv2: '', std1: '人工智能', std2: '' },
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

  const lv1Only = SEED_MAP.find((m) => m.lv1 === a && !m.lv2);
  if (lv1Only) {
    return {
      industry_std_lv1: lv1Only.std1 || null,
      industry_std_lv2: b || null,
      industry_match_confidence: 0.82,
    };
  }

  return { industry_std_lv1: null, industry_std_lv2: null, industry_match_confidence: 0 };
}

module.exports = {
  mapIndustryToStd,
  SEED_MAP,
};
