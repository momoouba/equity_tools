'use strict';

const TOKEN_TTL_SECONDS = 3600;
const READ_SCOPES = ['competitor:read', 'valuation:read'];
const SERVICE_ACCOUNT = 'agent_integration';

const COMPARABLE_NOTICE = '系统跑出的可比公司。是否改用立项会报告由调用方判断，本接口不接收该选择。';
const FORECAST_NOTICE = '盈利预测来自该已保存版本测算时进池的可比公司，与当前竞品分析或立项会名单可能不是同一套。';

function httpError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeIp(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

function parseAllowlist(raw) {
  if (raw == null || String(raw).trim() === '') return { mode: 'any', ips: [] };
  let list;
  try {
    list = JSON.parse(String(raw));
  } catch {
    return { mode: 'invalid', ips: [] };
  }
  if (!Array.isArray(list)) return { mode: 'invalid', ips: [] };
  return {
    mode: 'list',
    ips: list.map((item) => normalizeIp(item)).filter(Boolean),
  };
}

function ipAllowed(allowlistRaw, ip) {
  const parsed = parseAllowlist(allowlistRaw);
  if (parsed.mode === 'any') return true;
  if (parsed.mode === 'invalid') return false;
  const needle = normalizeIp(ip);
  if (!needle) return false;
  return parsed.ips.includes(needle);
}

function parseScopes(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertAllowedQuery(query, allowed) {
  const unknown = Object.keys(query || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw httpError(`不支持的查询参数: ${unknown.join(',')}`, 400);
  }
}

function sanitizeRequestId(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 64 || !/^[A-Za-z0-9_-]+$/.test(s)) return '';
  return s;
}

function isDraftVersionId(id) {
  const s = String(id || '').trim().toLowerCase();
  return s === '0' || s === 'draft';
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function blankToNull(v) {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}

function toPublicComparable(row) {
  const src = row || {};
  return {
    name: src.competitor_display_name || src.stock_name || '',
    unified_credit_code: blankToNull(src.unified_credit_code),
    stock_code: blankToNull(src.stock_code),
    listing_market: blankToNull(src.listing_market),
    relevance_score: numOrNull(src.relevance_score),
    selectable: !!src.selectable,
    disabled_reason: blankToNull(src.disabled_reason),
  };
}

function toForecastLines(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    fiscal_year: row?.fiscal_year == null || row.fiscal_year === '' ? null : String(row.fiscal_year),
    revenue: numOrNull(row?.revenue),
    cogs: numOrNull(row?.cogs),
    gross_profit: numOrNull(row?.gross_profit),
    selling: numOrNull(row?.selling),
    admin: numOrNull(row?.admin),
    rd: numOrNull(row?.rd),
    operating_profit: numOrNull(row?.operating_profit),
    net_income: numOrNull(row?.net_income),
    revenue_growth: numOrNull(row?.revenue_growth),
  }));
}

function toConclusion(comparison) {
  const display = comparison?.display_yi;
  if (!display) return null;
  return {
    unit: 'yi',
    market_ps: display.market_ps || null,
    market_pe: display.market_pe || null,
    market_ps_ntm: display.market_ps_ntm || null,
    market_pe_ntm: display.market_pe_ntm || null,
    dcf: display.dcf || null,
  };
}

module.exports = {
  TOKEN_TTL_SECONDS,
  READ_SCOPES,
  SERVICE_ACCOUNT,
  COMPARABLE_NOTICE,
  FORECAST_NOTICE,
  httpError,
  normalizeIp,
  parseAllowlist,
  ipAllowed,
  parseScopes,
  assertAllowedQuery,
  sanitizeRequestId,
  isDraftVersionId,
  numOrNull,
  toPublicComparable,
  toForecastLines,
  toConclusion,
};
