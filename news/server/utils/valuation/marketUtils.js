const C = require('./constants');
const { BS_INPUT_KEYS } = require('./targetBsFields');

const HK_US_HINT = '本期仅支持境内上市（含新三板）';

function padStockCode(code) {
  let s = String(code || '').trim().toUpperCase();
  s = s.replace(/\.(SH|SZ|BJ|NQ)$/i, '');
  if (/^\d+$/.test(s) && s.length < 6) s = s.padStart(6, '0');
  return s;
}

function listingMarketFromCode(stockCode) {
  const code = padStockCode(stockCode);
  if (!code) return null;
  if (code.startsWith('60') || code.startsWith('68') || code.startsWith('90')) return 'sse';
  if (code.startsWith('00') || code.startsWith('30')) return 'szse';
  if (code.startsWith('92') || code.startsWith('8') || code.startsWith('43')) return 'bse';
  if (code.startsWith('4')) return 'neeq';
  return null;
}

function listingMarketFromExchange(exchange) {
  const s = String(exchange || '').trim();
  if (s === '上交所' || s === '上海' || /SSE|SH/i.test(s)) return 'sse';
  if (s === '深交所' || s === '深圳' || /SZSE|SZ/i.test(s)) return 'szse';
  if (s === '北交所' || /BSE|BJ/i.test(s)) return 'bse';
  if (s === '新三板' || /NEEQ|NQ/i.test(s)) return 'neeq';
  return null;
}

function isAllowedListingMarket(market) {
  return C.ALLOWED_LISTING_MARKETS.includes(String(market || '').trim());
}

function isLikelyHkOrUs(codeOrExchange) {
  const s = String(codeOrExchange || '').trim().toUpperCase();
  if (!s) return false;
  if (/\.(HK|US)$/.test(s)) return true;
  if (/港股|美股|纳斯达克|NYSE|NASDAQ|HKEX/.test(s)) return true;
  if (/^[A-Z]{1,5}$/.test(s) && !/^\d+$/.test(s)) return true;
  return false;
}

function eastmoneySecid(stockCode, listingMarket) {
  const code = padStockCode(stockCode);
  const m = listingMarket || listingMarketFromCode(code);
  if (m === 'sse') return `1.${code}`;
  return `0.${code}`;
}

function eastmoneySecucode(stockCode, listingMarket) {
  const code = padStockCode(stockCode);
  const m = listingMarket || listingMarketFromCode(code);
  if (m === 'sse') return `${code}.SH`;
  if (m === 'bse' || m === 'neeq') return `${code}.BJ`;
  return `${code}.SZ`;
}

function reportTypeFromPeriod(period, typeName) {
  const name = String(typeName || '');
  if (/年报|年度/.test(name)) return 'annual';
  if (/一季|Q1/i.test(name)) return 'q1';
  if (/中报|半年/.test(name)) return 'interim';
  if (/三季|Q3/i.test(name)) return 'q3';
  const p = String(period || '');
  if (/-12-31$/.test(p) || /1231$/.test(p)) return 'annual';
  if (/-03-31$/.test(p) || /0331$/.test(p)) return 'q1';
  if (/-06-30$/.test(p) || /0630$/.test(p)) return 'interim';
  if (/-09-30$/.test(p) || /0930$/.test(p)) return 'q3';
  return 'annual';
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').replace(/%/g, ''));
  return Number.isFinite(n) ? n : null;
}

function median(values) {
  const arr = (values || []).map(toNumber).filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function stdev(values) {
  const arr = (values || []).map(toNumber).filter((n) => n != null && Number.isFinite(n));
  if (arr.length < 2) return null;
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function minMax(values) {
  const arr = (values || []).map(toNumber).filter((n) => n != null && Number.isFinite(n));
  if (!arr.length) return { min: null, max: null };
  return { min: Math.min(...arr), max: Math.max(...arr) };
}

function yuanToYi(v) {
  const n = toNumber(v);
  return n == null ? null : n / 1e8;
}

function yiToYuan(v) {
  const n = toNumber(v);
  return n == null ? null : n * 1e8;
}

function yuanToWan(v) {
  const n = toNumber(v);
  return n == null ? null : n / C.YUAN_PER_WAN;
}

function wanToYuan(v) {
  const n = toNumber(v);
  return n == null ? null : n * C.YUAN_PER_WAN;
}

/**
 * 界面按万元录入。旧草稿可能是元，或把元数字又填进万元框（多 4 个 0）。
 * 换算成引擎用的元，并去掉明显多出来的 0000。
 */
function scaleAmountToYuan(value, unit) {
  const x = toNumber(value);
  if (x == null) return null;
  if (unit === 'wan') {
    let wan = x;
    while (wan >= 1e8) wan /= C.YUAN_PER_WAN;
    return wan * C.YUAN_PER_WAN;
  }
  let yuan = x;
  while (yuan >= 1e12) yuan /= C.YUAN_PER_WAN;
  return yuan;
}

function mapAmountFields(obj, keys, unit) {
  if (!obj || typeof obj !== 'object') return obj || {};
  const out = { ...obj };
  for (const k of keys) {
    if (Array.isArray(out[k])) {
      out[k] = out[k].map((v) => {
        const n = scaleAmountToYuan(v, unit);
        return n == null ? v : n;
      });
    } else if (out[k] != null && out[k] !== '') {
      const n = scaleAmountToYuan(out[k], unit);
      if (n != null) out[k] = n;
    }
  }
  return out;
}

function mapAmountFieldsToWan(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj || {};
  const out = { ...obj };
  for (const k of keys) {
    if (Array.isArray(out[k])) {
      out[k] = out[k].map((v) => {
        const n = yuanToWan(v);
        return n == null ? v : n;
      });
    } else if (out[k] != null && out[k] !== '') {
      const n = yuanToWan(out[k]);
      if (n != null) out[k] = n;
    }
  }
  return out;
}

function prepareAmountsForEngine(payload) {
  const unit = payload?.amount_unit === 'wan' ? 'wan' : 'yuan';
  const plKeys = ['revenue', 'cogs', 'selling', 'admin', 'rd', 'operating_profit', 'net_income'];
  const bsKeys = BS_INPUT_KEYS;
  const ovKeys = ['da', 'capex', 'dnwc', 'net_debt'];
  const cfKeys = ['da', 'capex', 'dnwc', 'da_default', 'capex_default', 'dnwc_default'];
  const assumptions = { ...(payload?.assumptions || {}) };
  if (assumptions.esop != null && assumptions.esop !== '') {
    const esop = scaleAmountToYuan(assumptions.esop, unit);
    if (esop != null) assumptions.esop = esop;
  }
  return {
    targetPl: mapAmountFields(payload?.targetPl || {}, plKeys, unit),
    targetBs: mapAmountFields(payload?.targetBs || {}, bsKeys, unit),
    targetCf: mapAmountFields(payload?.targetCf || {}, cfKeys, unit),
    overrides: mapAmountFields(payload?.overrides || {}, ovKeys, unit),
    assumptions,
  };
}

function beijingYmd(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  const src = Number.isFinite(date.getTime()) ? date : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(src);
}

function parseYmd(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return beijingYmd(value);
  if (typeof value.format === 'function') {
    try {
      const f = value.format('YYYY-MM-DD');
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
    } catch { /* ignore */ }
  }
  const raw = String(value).trim();
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime()) && /[a-z]{3}/i.test(raw) && raw.length > 10) {
    return beijingYmd(parsed);
  }
  return null;
}

/** 市场法锚定日：已填用已填；未填用案件创建日；再没有则用今天。 */
function resolveValuationDate(value, createdAt) {
  return parseYmd(value) || parseYmd(createdAt) || beijingYmd();
}

function sqlDate(value) {
  return parseYmd(value);
}

function isSanePe(v) {
  const n = toNumber(v);
  return n != null && n > C.PE_SANE_MIN && n <= C.PE_SANE_MAX;
}

/** 历史中位允许亏损日（负 PE）；仍丢掉 0 与 |PE|>500 的极端点。 */
function isHistPe(v) {
  const n = toNumber(v);
  return n != null && Number.isFinite(n) && n !== 0 && Math.abs(n) <= C.PE_SANE_MAX;
}

function isSanePs(v) {
  const n = toNumber(v);
  return n != null && n > C.PS_SANE_MIN && n <= C.PS_SANE_MAX;
}

module.exports = {
  HK_US_HINT,
  padStockCode,
  listingMarketFromCode,
  listingMarketFromExchange,
  isAllowedListingMarket,
  isLikelyHkOrUs,
  eastmoneySecid,
  eastmoneySecucode,
  reportTypeFromPeriod,
  toNumber,
  median,
  stdev,
  minMax,
  yuanToYi,
  yiToYuan,
  yuanToWan,
  wanToYuan,
  scaleAmountToYuan,
  prepareAmountsForEngine,
  mapAmountFieldsToWan,
  isSanePe,
  isHistPe,
  isSanePs,
  beijingYmd,
  parseYmd,
  resolveValuationDate,
  sqlDate,
};
