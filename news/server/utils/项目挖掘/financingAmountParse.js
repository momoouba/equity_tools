/**
 * 融资金额/估值类原始文本解析（对齐需求文档 §4.2 金额与估值文本标准化规则，首期实现）
 * - 原文不修改，仅输出结构化字段供写入 sourcing_financing_event
 * - 汇率：环境变量 FINANCING_USD_CNY_RATE，默认 7.2
 */

const USD_CNY_RATE = () => {
  const n = Number(process.env.FINANCING_USD_CNY_RATE);
  return Number.isFinite(n) && n > 0 ? n : 7.2;
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
  const hasWan = /万/u.test(original);
  const hasYi = /亿/u.test(original);

  let currency = 'CNY';
  let amountAbsolute = null;

  if (/亿美元/u.test(original)) {
    currency = 'USD';
    amountAbsolute = num * 1e8;
  } else if (/万美元/u.test(original)) {
    currency = 'USD';
    amountAbsolute = num * 1e4;
  } else if (hasUsd && !hasWan && !hasYi) {
    currency = 'USD';
    amountAbsolute = num;
  } else if (/亿人民币/u.test(original) || (hasYi && !hasUsd)) {
    currency = 'CNY';
    amountAbsolute = num * 1e8;
  } else if (/万元/u.test(original) || /万人民币/u.test(original) || (hasWan && !hasUsd && !hasYi)) {
    currency = 'CNY';
    amountAbsolute = num * 1e4;
  } else if (hasYi && hasUsd) {
    currency = 'USD';
    amountAbsolute = num * 1e8;
  } else if (/元/u.test(original) && !hasWan && !hasYi && !hasUsd) {
    currency = 'CNY';
    amountAbsolute = num;
  } else {
    return empty;
  }

  const rate = USD_CNY_RATE();
  let amountCny = null;
  if (currency === 'CNY') amountCny = amountAbsolute;
  else amountCny = amountAbsolute * rate;

  const status = fuzzy ? 'estimated' : 'parsed';
  const confidence = fuzzy ? 0.78 : 0.93;

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
