/**
 * 上市进展匹配用：去掉全角/半角括号字符，括号内文字保留拼接（与需求文档示例一致）
 * 例：华太电子（深圳）有限公司 → 华太电子深圳有限公司
 */
function normalizeCompanyNameForMatch(input) {
  if (input == null || input === '') return '';
  return String(input).replace(/[()（）]/g, '');
}

module.exports = { normalizeCompanyNameForMatch };
