'use strict';

const { strTrim, jaccardSimilarity, textOverlapScore } = require('./competitorMatchUtils');

/** 过宽的行业/赛道标签，不宜单独作为竞品对齐依据 */
const GENERIC_INDUSTRY_TAG_RE =
  /^(生物制药|生命科学|生物医药|医疗健康|医疗器械|生物技术|制药|医疗|健康|科技|创新|服务|领域|行业|企业|公司|平台|解决方案|综合服务|整体解决方案|生物|细胞与基因治疗)$/i;

const GENERIC_INDUSTRY_PHRASE_RE =
  /生物制药与生命科学|生命科学领域|生物医药领域|医疗健康领域|聚焦生物制药|生物制药服务|同属.*领域|客户有交集|下游客户|行业相近/i;

function isGenericIndustryTag(tag) {
  const s = strTrim(tag);
  if (!s || s.length <= 2) return true;
  if (GENERIC_INDUSTRY_TAG_RE.test(s)) return true;
  if (/^(提供|从事|专注|面向).{0,4}(领域|行业|服务)$/.test(s)) return true;
  return false;
}

function extractPhrasesFromIntro(intro, max = 8) {
  const s = strTrim(intro);
  if (!s) return [];
  const terms = [];
  const phraseRe =
    /[\u4e00-\u9fff]{2,16}(?:装备|设备|系统|平台|耗材|材料|填料|反应器|过滤器|过滤|纯化|分离|膜|滤芯|配液|流体|工艺|解决方案)/g;
  let m;
  while ((m = phraseRe.exec(s)) !== null && terms.length < max) {
    const t = m[0].trim();
    if (t.length >= 4 && !terms.includes(t) && !isGenericIndustryTag(t)) terms.push(t);
  }
  return terms;
}

/**
 * 从目标画像提取核心产品线（优先 tags，辅以 intro 短语）
 * @returns {string[]}
 */
function extractCoreProductLines(profile) {
  const tags = (profile?.tags || [])
    .map((t) => strTrim(t))
    .filter((t) => t && !isGenericIndustryTag(t));
  const intro = [profile?.product_intro, profile?.qcc_intro_effective].filter(Boolean).join('\n');
  const fromIntro = extractPhrasesFromIntro(intro, 6);
  const merged = [];
  const seen = new Set();
  for (const t of [...tags, ...fromIntro]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
    if (merged.length >= 12) break;
  }
  return merged;
}

function candidateTextBlob(row) {
  return [
    row?.display_name,
    row?.product_intro,
    row?.qcc_intro,
    row?.qcc_intro_effective,
    ...(row?.tags || []),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 核心产品线在候选文本中的命中比例（0~100）
 */
function scoreCoreProductLineOverlap(coreLines, candidateBlob) {
  const lines = (coreLines || []).map((x) => strTrim(x)).filter(Boolean);
  const blob = strTrim(candidateBlob);
  if (!lines.length || !blob) return 0;
  let hit = 0;
  for (const line of lines) {
    if (line.length >= 3 && blob.includes(line)) {
      hit += 1;
      continue;
    }
    const grams = line.split(/[/、，,\s]+/).filter((g) => g.length >= 2);
    if (grams.length >= 2 && grams.every((g) => blob.includes(g))) hit += 1;
  }
  return Math.round((hit / lines.length) * 100);
}

function scoreSpecificTagOverlap(targetTags, candidateTags) {
  const a = (targetTags || []).filter((t) => !isGenericIndustryTag(t));
  const b = (candidateTags || []).filter((t) => !isGenericIndustryTag(t));
  return Math.round(jaccardSimilarity(a, b) * 100);
}

/**
 * 目标-候选的产品线精度得分（规则分与校验后处理共用）
 */
function computeProductPrecisionScores(target, candidate) {
  const coreLines =
    target?.core_product_lines?.length > 0
      ? target.core_product_lines
      : extractCoreProductLines(target);
  const introA = [target?.product_intro, target?.qcc_intro_effective].filter(Boolean).join('\n');
  const introB = [candidate?.product_intro, candidate?.qcc_intro, candidate?.qcc_intro_effective]
    .filter(Boolean)
    .join('\n');
  const productScore = Math.round(textOverlapScore(introA, introB) * 100);
  const coreLineScore = scoreCoreProductLineOverlap(coreLines, candidateTextBlob(candidate));
  const specificTagScore = scoreSpecificTagOverlap(target?.tags, candidate?.tags);
  const onlyBroadIndustry =
    (productScore < 22 && coreLineScore < 18 && specificTagScore < 20) ||
    (GENERIC_INDUSTRY_PHRASE_RE.test(introB) && coreLineScore < 25);
  return {
    core_product_lines: coreLines,
    productScore,
    coreLineScore,
    specificTagScore,
    onlyBroadIndustry,
  };
}

function attachCoreProductLines(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const lines = extractCoreProductLines(profile);
  return { ...profile, core_product_lines: lines };
}

/** 产品线定向召回用检索词（含层析/纯化/过滤等同义扩展） */
function expandProductLineSearchTerms(coreLines, introBlob) {
  const terms = (coreLines || []).map((t) => strTrim(t)).filter((t) => t.length >= 3);
  const blob = [introBlob, ...terms].filter(Boolean).join('\n');
  if (/层析|色谱|填料|纯化|分离介质|微球|树脂/.test(blob)) {
    terms.push('层析填料', '色谱填料', '纯化填料', '色谱介质', '层析介质', '工业制备色谱');
  }
  if (/过滤|滤芯|膜|超滤|微滤|除菌/.test(blob)) {
    terms.push('过滤系统', '除菌过滤', '超滤膜', '微滤膜');
  }
  if (/反应器|培养|生物反应|一次性/.test(blob)) {
    terms.push('生物反应器', '细胞培养', '一次性生物反应器');
  }
  const seen = new Set();
  const out = [];
  for (const t of terms) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 14) break;
  }
  return out;
}

module.exports = {
  isGenericIndustryTag,
  extractCoreProductLines,
  scoreCoreProductLineOverlap,
  scoreSpecificTagOverlap,
  computeProductPrecisionScores,
  attachCoreProductLines,
  expandProductLineSearchTerms,
};
