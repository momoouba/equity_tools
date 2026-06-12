/**
 * 竞品公司名规范化、境内判定、稳定匹配键（融资池兜底 / 可比勾选恢复）。
 */
const { normalizeCompanyName } = require('../上市进展/zhconvUtils');
const { normalizeCompanyNameForMatch } = require('../上市进展/listingCompanyNormalize');
const { normalizeCreditCode, strTrim } = require('./competitorMatchUtils');

const MAINLAND_USCC_LEN = 18;
const USCC_RE = /^[0-9A-Z]{18}$/i;

const OVERSEAS_NAME_MARKERS =
  /香港|澳门|澳門|台湾|臺灣|港交所|\(HK\)|（HK）|\(TW\)|（TW）|\(MO\)|（MO）|开曼|開曼|BVI|Cayman|Limited\s*Partnership/i;

const SUBSIDIARY_SUFFIX_RE =
  /(分公司|分支机构|分店|办事处|代表处|经营部|支公司|子公司)$/;

function isValidMainlandUscc(code) {
  const c = normalizeCreditCode(code);
  return c.length === MAINLAND_USCC_LEN && USCC_RE.test(c);
}

/** 外企英文名、港澳台名称等：不强制 18 位信用代码 */
function isOverseasOrExemptCreditName(name) {
  const n = strTrim(name);
  if (!n) return false;
  if (OVERSEAS_NAME_MARKERS.test(n)) return true;
  const withoutSpace = n.replace(/\s+/g, '');
  const latin = (withoutSpace.match(/[A-Za-z]/g) || []).length;
  const cjk = (withoutSpace.match(/[\u4e00-\u9fff]/g) || []).length;
  if (latin >= 4 && cjk === 0) return true;
  if (latin > 0 && cjk > 0 && latin >= cjk) return true;
  return false;
}

/** 境内竞品：需要 18 位码（已有合法码视为境内） */
function requiresMainlandCreditCode(name, creditCode) {
  if (isValidMainlandUscc(creditCode)) return true;
  if (isOverseasOrExemptCreditName(name)) return false;
  const n = strTrim(name);
  if (!n) return false;
  if (/[\u4e00-\u9fff]/.test(n)) return true;
  return false;
}

function stripSubsidiarySuffixes(name) {
  let s = strTrim(name);
  if (!s) return '';
  let prev;
  do {
    prev = s;
    s = s.replace(SUBSIDIARY_SUFFIX_RE, '');
  } while (s !== prev && SUBSIDIARY_SUFFIX_RE.test(s));
  return s;
}

/**
 * 融资池 / 可比键用公司名：去括号、繁简、去空白、去分子公司后缀、小写。
 */
function normalizeCompetitorCompanyNameForMatch(name) {
  const bracketStripped = normalizeCompanyNameForMatch(name);
  if (!bracketStripped) return '';
  const simplified = normalizeCompanyName(bracketStripped);
  const noSubsidiary = stripSubsidiarySuffixes(simplified);
  return strTrim(noSubsidiary).toLowerCase();
}

function relationCompetitorKey({ unified_credit_code, competitor_display_name, competitor_weak_key }) {
  const code = normalizeCreditCode(unified_credit_code);
  if (isValidMainlandUscc(code)) return `cc:${code.toUpperCase()}`;
  const name = normalizeCompetitorCompanyNameForMatch(competitor_display_name);
  if (name) return `name:${name}`;
  const weak = strTrim(competitor_weak_key).toLowerCase();
  if (weak) return `name:${weak.slice(0, 160)}`;
  return '';
}

/** 可比勾选恢复时尝试的全部键（含历史落库格式，避免重跑后键不一致） */
function collectCompetitorLookupKeys({ unified_credit_code, competitor_display_name, competitor_weak_key }) {
  const keys = new Set();
  const canonical = relationCompetitorKey({
    unified_credit_code,
    competitor_display_name,
    competitor_weak_key,
  });
  if (canonical) keys.add(canonical);

  const code = normalizeCreditCode(unified_credit_code);
  if (code.length >= 15) {
    // fix #17: 信用代码规范键始终大写，无需额外添加小写变体
    keys.add(`cc:${code.toUpperCase()}`);
  }

  const simpleName = strTrim(competitor_display_name).toLowerCase();
  if (simpleName) keys.add(`name:${simpleName}`);

  const normalizedName = normalizeCompetitorCompanyNameForMatch(competitor_display_name);
  if (normalizedName) keys.add(`name:${normalizedName}`);

  const weak = strTrim(competitor_weak_key).toLowerCase();
  if (weak) keys.add(`name:${weak.slice(0, 160)}`);

  return [...keys];
}

function isComparablePreferred(comparablePrefs, fields) {
  if (!comparablePrefs || !comparablePrefs.size) return false;
  for (const k of collectCompetitorLookupKeys(fields)) {
    if (comparablePrefs.get(k)) return true;
  }
  return false;
}

module.exports = {
  MAINLAND_USCC_LEN,
  isValidMainlandUscc,
  isOverseasOrExemptCreditName,
  requiresMainlandCreditCode,
  normalizeCompetitorCompanyNameForMatch,
  relationCompetitorKey,
  collectCompetitorLookupKeys,
  isComparablePreferred,
  stripSubsidiarySuffixes,
};
