/**
 * 融资金额/估值类原始文本解析（对齐需求文档 §4.2 金额与估值文本标准化规则，首期实现）
 * - 原文不修改，仅输出结构化字段供写入 sourcing_financing_event
 * - 汇率：环境变量 FINANCING_USD_CNY_RATE，默认 7.2
 */

const USD_CNY_RATE = () => {
  const n = Number(process.env.FINANCING_USD_CNY_RATE);
  return Number.isFinite(n) && n > 0 ? n : 7.2;
};

const HKD_CNY_RATE = () => {
  const n = Number(process.env.FINANCING_HKD_CNY_RATE);
  return Number.isFinite(n) && n > 0 ? n : 0.92;
};

function round2(x) {
  if (x == null || !Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

const UNDIS = /^(未披露|保密|不详|暂无|无|N\/A|NA|—|-|\/|暂无披露|unknown)$/i;

/**
 * @returns {{
 *   amount: number|null,
 *   amount_currency: string|null,
 *   amount_cny: number|null,
 *   amount_parse_status: 'parsed'|'estimated'|'unparsed',
 *   amount_parse_confidence: number
 * }}
 */
function parseFinancingMoneyText(raw) {
  const empty = {
    amount: null,
    amount_currency: null,
    amount_cny: null,
    amount_parse_status: 'unparsed',
    amount_parse_confidence: 0,
  };
  if (raw == null) return empty;
  const original = String(raw).trim();
  if (!original) return empty;

  const compact = original.replace(/[\s,，、]/g, '');
  if (!compact || UNDIS.test(compact)) return empty;

  const fuzzy = /约|左右|近|超|逾|\~|\+/.test(original);

  const numMatch = compact.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return empty;
  const num = parseFloat(numMatch[1]);
  if (!Number.isFinite(num) || num < 0) return empty;

  const hasUsd = /美元|USD|US\$|美金/u.test(original);
  const hasHkd = /港元|HKD|港币|港圆/u.test(original);
  const hasWan = /万/u.test(original);
  const hasYi = /亿/u.test(original);
  // "千万" = 10^7，需在 "万" 之前匹配，否则 "3千万" 会被解析为 3×10^4 = 30000（偏差 1000 倍）
  const hasQianWan = /千万/u.test(original);

  // #2.2: 复合数量表达 — 十亿(10^9)、百亿(10^10)、千亿(10^11)、十万(10^5)
  // 需在 "亿"/"万" 之前检测，否则 "十亿" 会落入 "亿" 分支解析为 num × 10^8
  const hasShiYi = /十亿/u.test(original);
  const hasBaiYi = /百亿/u.test(original);
  const hasQianYi = /千亿/u.test(original);
  const hasShiWan = /十万/u.test(original);

  let currency = 'CNY';
  let amountAbsolute = null;

  // ── 十亿 / 百亿 / 千亿 ──
  if (hasQianYi && hasUsd) {
    currency = 'USD'; amountAbsolute = num * 1e11;
  } else if (hasBaiYi && hasUsd) {
    currency = 'USD'; amountAbsolute = num * 1e10;
  } else if (hasShiYi && hasUsd) {
    currency = 'USD'; amountAbsolute = num * 1e9;
  } else if (hasQianYi && hasHkd) {
    currency = 'HKD'; amountAbsolute = num * 1e11;
  } else if (hasBaiYi && hasHkd) {
    currency = 'HKD'; amountAbsolute = num * 1e10;
  } else if (hasShiYi && hasHkd) {
    currency = 'HKD'; amountAbsolute = num * 1e9;
  } else if (hasQianYi && !hasUsd && !hasHkd) {
    currency = 'CNY'; amountAbsolute = num * 1e11;
  } else if (hasBaiYi && !hasUsd && !hasHkd) {
    currency = 'CNY'; amountAbsolute = num * 1e10;
  } else if (hasShiYi && !hasUsd && !hasHkd) {
    currency = 'CNY'; amountAbsolute = num * 1e9;
  // ── 十万 ──
  } else if (hasShiWan && hasUsd) {
    currency = 'USD'; amountAbsolute = num * 1e5;
  } else if (hasShiWan && hasHkd) {
    currency = 'HKD'; amountAbsolute = num * 1e5;
  } else if (hasShiWan && !hasUsd && !hasHkd && !hasYi) {
    currency = 'CNY'; amountAbsolute = num * 1e5;
  // ── 原有分支（亿/千万/万/元）──
  } else if (/亿美元/u.test(original)) {
    currency = 'USD';
    amountAbsolute = num * 1e8;
  } else if (/千万美元/u.test(original) || (hasQianWan && hasUsd)) {
    currency = 'USD';
    amountAbsolute = num * 1e7;
  } else if (/万美元/u.test(original)) {
    currency = 'USD';
    amountAbsolute = num * 1e4;
  } else if (hasUsd && !hasWan && !hasYi) {
    currency = 'USD';
    amountAbsolute = num;
  } else if (/亿港元/u.test(original)) {
    currency = 'HKD';
    amountAbsolute = num * 1e8;
  } else if (/千万港元/u.test(original) || /千万港币/u.test(original) || (hasQianWan && hasHkd)) {
    currency = 'HKD';
    amountAbsolute = num * 1e7;
  } else if (/万港元/u.test(original) || (/万港币/u.test(original)) || (hasWan && hasHkd)) {
    currency = 'HKD';
    amountAbsolute = num * 1e4;
  } else if (hasHkd && !hasWan && !hasYi) {
    currency = 'HKD';
    amountAbsolute = num;
  } else if (/亿人民币/u.test(original) || (hasYi && !hasUsd && !hasHkd)) {
    currency = 'CNY';
    amountAbsolute = num * 1e8;
  } else if (/千万人民币/u.test(original) || /千万元/u.test(original) || (hasQianWan && !hasUsd && !hasYi && !hasHkd)) {
    currency = 'CNY';
    amountAbsolute = num * 1e7;
  } else if (/万元/u.test(original) || /万人民币/u.test(original) || (hasWan && !hasUsd && !hasYi && !hasHkd)) {
    currency = 'CNY';
    amountAbsolute = num * 1e4;
  } else if (hasYi && hasUsd) {
    currency = 'USD';
    amountAbsolute = num * 1e8;
  } else if (/元/u.test(original) && !hasWan && !hasYi && !hasUsd) {
    currency = 'CNY';
    amountAbsolute = num;
  } else if (/^\d+(?:\.\d+)?$/.test(compact) && num > 0) {
    // #2.4: 纯数字无单位，视为人民币元（低置信度）
    currency = 'CNY';
    amountAbsolute = num;
  } else {
    return empty;
  }

  const rate = currency === 'HKD' ? HKD_CNY_RATE() : USD_CNY_RATE();
  let amountCny = null;
  if (currency === 'CNY') amountCny = amountAbsolute;
  else amountCny = amountAbsolute * rate;

  // #2.4: 纯数字无单位标记为低置信度
  const isBareNumber = /^\d+(?:\.\d+)?$/.test(compact);
  const status = fuzzy ? 'estimated' : (isBareNumber ? 'estimated' : 'parsed');
  const confidence = fuzzy ? 0.78 : (isBareNumber ? 0.45 : 0.93);

  return {
    amount: round2(amountAbsolute),
    amount_currency: currency,
    amount_cny: round2(amountCny),
    amount_parse_status: status,
    amount_parse_confidence: confidence,
  };
}

/** 优先 funding_raw，否则 estimated_raw */
function parseFundingAmountFields(fundingAmtRaw, estimatedAmtRaw) {
  let r = parseFinancingMoneyText(fundingAmtRaw);
  if (r.amount_parse_status !== 'unparsed') return r;
  return parseFinancingMoneyText(estimatedAmtRaw);
}

module.exports = {
  parseFinancingMoneyText,
  parseFundingAmountFields,
  USD_CNY_RATE,
};
