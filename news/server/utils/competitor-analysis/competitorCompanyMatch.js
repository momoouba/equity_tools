/**
 * 竞品公司名规范化、境内判定、稳定匹配键（融资池兜底 / 可比勾选恢复）。
 */
const { normalizeCompanyName } = require('../listing/zhconvUtils');
const { normalizeCompanyNameForMatch } = require('../listing/listingCompanyNormalize');
const { normalizeCreditCode, strTrim } = require('./competitorMatchUtils');

const MAINLAND_USCC_LEN = 18;
const USCC_RE = /^[0-9A-Z]{18}$/i;

const OVERSEAS_NAME_MARKERS =
  /香港|澳门|澳門|台湾|臺灣|港交所|\(HK\)|（HK）|\(TW\)|（TW）|\(MO\)|（MO）|开曼|開曼|BVI|Cayman|Limited\s*Partnership/i;

const SUBSIDIARY_SUFFIX_RE =
  /(分公司|分支机构|分店|办事处|代表处|经营部|支公司|子公司)$/;

const CITY_PREFIX_RE =
  /^(北京|上海|杭州|嘉兴|烟台|苏州|无锡|宁波|成都|南京|广州|深圳|天津|重庆|武汉|西安|青岛|佛山|合肥|郑州|长沙|沈阳)/;

const ORG_SUFFIX_RE =
  /(股份有限公司|有限责任公司|有限公司|集团|控股|药业|医药|生物技术|生物医药|生物|科技|医疗|技术)$/;

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

function stripLegalSuffixes(s) {
  let out = strTrim(s);
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(/(股份有限公司|有限责任公司|有限公司|集团)$/g, '');
    if (next === out) break;
    out = next;
  }
  return strTrim(out);
}

/** 去掉城市前缀与有限公司等形态，保留医药/科技等行业词，避免「核欣医药」误并「核欣生物」 */
function legalCoreName(name) {
  const n = stripLegalSuffixes(normalizeCompetitorCompanyNameForMatch(name));
  return strTrim(n.replace(CITY_PREFIX_RE, ''));
}

const INDUSTRY_TAIL_RE = /^(科技|技术|生物|医药|医疗|药业|健康|制药)*$/;

function coreContainsLoosely(shorter, longer) {
  if (!shorter || !longer || !longer.includes(shorter)) return false;
  if (shorter.length >= 3) return true;
  return shorter.length >= 2 && longer.startsWith(shorter) && longer.length - shorter.length >= 2;
}

/**
 * 短核 = 品牌 + 行业词，长核 = 品牌 + 至少二字字号 + 同行词（可多带科技等尾巴）。
 * 「核欣医药科技」↔「核欣迅明医药科技」；「新华医药」↛「新华联医药」。
 */
function hasBrandInfixExpansion(short, long) {
  if (!short || !long || short.length < 4 || long.length <= short.length) return false;
  for (let brandLen = 2; brandLen <= short.length - 2; brandLen += 1) {
    const brand = short.slice(0, brandLen);
    const industry = short.slice(brandLen);
    if (!long.startsWith(brand)) continue;
    const idx = long.lastIndexOf(industry);
    if (idx < brand.length) continue;
    const infix = long.slice(brand.length, idx);
    const tail = long.slice(idx + industry.length);
    if (infix.length >= 2 && INDUSTRY_TAIL_RE.test(tail)) return true;
  }
  return false;
}

/**
 * 金标 / 联网 / 融资回查：法定全称、城市前缀、短名漏中间字号（品牌段插入 ≥2 字）。
 * 例：先通医药 ↔ 北京先通国际医药科技；核欣医药科技 ↔ 北京核欣迅明医药科技。
 * 不合并仅共享二字品牌的不同主体（核欣医药 ↛ 核欣生物；新华 ↛ 新华联）。
 */
function namesMatchLoosely(a, b) {
  const na = normalizeCompetitorCompanyNameForMatch(a);
  const nb = normalizeCompetitorCompanyNameForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (coreContainsLoosely(na, nb) || coreContainsLoosely(nb, na)) return true;

  const la = legalCoreName(a);
  const lb = legalCoreName(b);
  if (!la || !lb) return false;
  if (la === lb) return true;
  if (coreContainsLoosely(la, lb) || coreContainsLoosely(lb, la)) return true;

  const shorter = la.length <= lb.length ? la : lb;
  const longer = la.length <= lb.length ? lb : la;
  return hasBrandInfixExpansion(shorter, longer);
}

/** 越大越像同一主体，供多条 LIKE 命中时择优，避免先扫到弱匹配就定码 */
function nameMatchTightness(inputName, storedName) {
  const na = normalizeCompetitorCompanyNameForMatch(inputName);
  const nb = normalizeCompetitorCompanyNameForMatch(storedName);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const la = legalCoreName(inputName);
  const lb = legalCoreName(storedName);
  if (la && lb && la === lb) return 90;
  if (la && lb && (coreContainsLoosely(la, lb) || coreContainsLoosely(lb, la))) return 80;
  if (namesMatchLoosely(inputName, storedName)) return 40;
  return 0;
}

/**
 * 品牌检索词：去掉行政区前缀与公司形态后缀，供 LIKE + namesMatchLoosely 回查。
 * 「核欣医药科技有限公司」→「核欣」，才能命中「北京核欣迅明医药科技有限公司」。
 */
function extractBrandSearchToken(name) {
  let s = normalizeCompetitorCompanyNameForMatch(name);
  if (!s) return '';
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(CITY_PREFIX_RE, '').replace(ORG_SUFFIX_RE, '');
    if (next === s) break;
    s = next;
  }
  s = strTrim(s);
  if (s.length < 2 || s.length > 16) return '';
  return s;
}

/** 内部主数据名称与候选名是否同一主体；无候选名时只认信用代码命中 */
function creditBoundNameConsistent(inputName, storedName) {
  if (!strTrim(inputName)) return true;
  if (!strTrim(storedName)) return false;
  return namesMatchLoosely(inputName, storedName);
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
  namesMatchLoosely,
  nameMatchTightness,
  legalCoreName,
  extractBrandSearchToken,
  creditBoundNameConsistent,
};
