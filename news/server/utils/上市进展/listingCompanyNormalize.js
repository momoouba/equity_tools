/**
 * 上市进展匹配用：去掉全角/半角括号字符，括号内文字保留拼接（与需求文档示例一致）
 * 例：华太电子（深圳）有限公司 → 华太电子深圳有限公司
 */
function normalizeCompanyNameForMatch(input) {
  if (input == null || input === '') return '';
  return String(input).replace(/[()（）]/g, '');
}

/** 证监会辅导公示/报告标题 → 仅保留公司全称（去掉「关于…报告」等套话） */
const GUIDANCE_TITLE_SUFFIXES = [
  '首次公开发行股票并上市辅导备案报告',
  '首次公开发行股票并在科创板上市辅导备案报告',
  '首次公开发行股票并在创业板上市辅导备案报告',
  '辅导备案报告',
  '辅导工作进展情况报告',
  '辅导工作进展报告',
  '辅导工作总结报告',
  '上市辅导备案报告',
  '公开发行辅导备案报告',
];

function extractCsrcGuidanceCompanyName(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (s.startsWith('关于')) {
    s = s.slice(2).trim();
  }
  for (const suf of GUIDANCE_TITLE_SUFFIXES) {
    const i = s.indexOf(suf);
    if (i > 0) {
      s = s.slice(0, i);
      break;
    }
  }
  if (s.length > 4) {
    const cutKeys = ['首次公开发行股票', '首次公开发行', '公开发行股票并上市', '辅导工作进展', '上市辅导'];
    for (const k of cutKeys) {
      const i = s.indexOf(k);
      if (i > 0) {
        s = s.slice(0, i);
        break;
      }
    }
  }
  s = s.replace(/（[^）]{0,40}）\s*$/u, '').replace(/\([^)]{0,40}\)\s*$/, '').trim();
  return s.trim();
}

module.exports = { normalizeCompanyNameForMatch, extractCsrcGuidanceCompanyName };
