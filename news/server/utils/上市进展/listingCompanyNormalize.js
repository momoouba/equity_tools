/**
 * 上市进展匹配用：去掉全角/半角括号字符，括号内文字保留拼接（与需求文档示例一致）
 * 例：华太电子（深圳）有限公司 → 华太电子深圳有限公司
 *
 * 港交所等披露常见在公司英文名后带表决权架构后缀（与投资组合底层全称不一致），对齐后再做等价判断：
 * 例：Eccogene Inc. - B → Eccogene Inc.
 */
function normalizeCompanyNameForMatch(input) {
  if (input == null || input === '') return '';
  let s = String(input).replace(/[()（）]/g, '').trim();
  // trailing " - B" / "- W" / "－Ｂ"（加权投票权或类别股份标注）
  s = s.replace(/\s*[-－]\s*[BWＢＷ]\s*$/i, '').trim();
  s = s.replace(/[-－][BWＢＷ]\s*$/i, '').trim();
  return s;
}

function normalizeFuzzyText(input) {
  if (input == null || input === '') return '';
  return String(input)
    .toLowerCase()
    .replace(/[()（）]/g, '')
    .replace(/\s+/g, '')
    .replace(/[·•,.，。;；:：'"‘’“”\-_/\\|]/g, '')
    .trim();
}

function buildBigrams(text) {
  const s = String(text || '');
  if (!s) return [];
  if (s.length === 1) return [s];
  const grams = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    grams.push(s.slice(i, i + 2));
  }
  return grams;
}

function diceSimilarity(a, b) {
  const aa = normalizeFuzzyText(a);
  const bb = normalizeFuzzyText(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  const ga = buildBigrams(aa);
  const gb = buildBigrams(bb);
  if (!ga.length || !gb.length) return 0;
  const bucket = new Map();
  ga.forEach((g) => bucket.set(g, (bucket.get(g) || 0) + 1));
  let overlap = 0;
  gb.forEach((g) => {
    const c = bucket.get(g) || 0;
    if (c > 0) {
      overlap += 1;
      bucket.set(g, c - 1);
    }
  });
  return (2 * overlap) / (ga.length + gb.length);
}

function fuzzySimilarity(a, b) {
  const aa = normalizeFuzzyText(a);
  const bb = normalizeFuzzyText(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  const shortLen = Math.min(aa.length, bb.length);
  const longLen = Math.max(aa.length, bb.length);
  const containScore = (aa.includes(bb) || bb.includes(aa)) && longLen > 0 ? shortLen / longLen : 0;
  const diceScore = diceSimilarity(aa, bb);
  return Math.max(containScore, diceScore);
}

/** 证监会辅导公示/报告标题 → 仅保留公司全称（去掉「关于…报告」等套话）
 * 注意：如果输入已经是公司名称（如从辅导对象列获取），直接返回，不做额外提取。
 */
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
  // 如果输入不包含"报告"、"辅导"等关键字，说明已经是公司名称，直接返回
  const reportKeywords = ['报告', '辅导备案', '辅导工作', '首次公开发行', '公开发行'];
  if (!reportKeywords.some(kw => s.includes(kw))) {
    return s;
  }
  // 从报告标题中提取公司名称
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

module.exports = { normalizeCompanyNameForMatch, extractCsrcGuidanceCompanyName, fuzzySimilarity };
