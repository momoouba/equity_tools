'use strict';

/** 优先行业批 / 百科查词默认时间窗：2025-01-01 起 */
const DEFAULT_EVENT_SINCE = '2025-01-01';

/**
 * @param {{ sinceDate?: string, years?: number }} opts
 * @returns {{ clause: string, params: unknown[] }}
 */
function buildFinancingEventSinceClause(opts = {}) {
  if (opts.years != null && !opts.sinceDate) {
    const y = Math.max(1, Number(opts.years) || 3);
    return {
      clause: 'event_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)',
      params: [y],
      label: `近${y}年`,
    };
  }
  const since = String(opts.sinceDate || DEFAULT_EVENT_SINCE).slice(0, 10);
  return {
    clause: 'event_date >= ?',
    params: [since],
    label: `自 ${since}`,
  };
}

function buildPreInvSinceClause(opts = {}) {
  if (opts.years != null && !opts.sinceDate) {
    const y = Math.max(1, Number(opts.years) || 3);
    return {
      clause: 'F_CreatorTime >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)',
      params: [y],
      label: `近${y}年`,
    };
  }
  const since = String(opts.sinceDate || DEFAULT_EVENT_SINCE).slice(0, 10);
  return {
    clause: 'F_CreatorTime >= ?',
    params: [since],
    label: `自 ${since}`,
  };
}

function parseSinceArg(argv) {
  const out = { sinceDate: DEFAULT_EVENT_SINCE, years: null };
  for (const a of argv) {
    if (a.startsWith('--since=')) out.sinceDate = a.slice(8).trim().slice(0, 10);
    else if (a.startsWith('--years=')) out.years = Math.max(1, parseInt(a.slice(8), 10) || 3);
  }
  if (out.years != null) out.sinceDate = null;
  return out;
}

module.exports = {
  DEFAULT_EVENT_SINCE,
  buildFinancingEventSinceClause,
  buildPreInvSinceClause,
  parseSinceArg,
};
