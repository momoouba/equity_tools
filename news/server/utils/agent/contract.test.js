'use strict';

const assert = require('assert');
const {
  normalizeIp,
  parseAllowlist,
  ipAllowed,
  assertAllowedQuery,
  sanitizeRequestId,
  isDraftVersionId,
  toPublicComparable,
  toForecastLines,
  toConclusion,
  httpError,
} = require('./contract');

assert.strictEqual(normalizeIp('::ffff:10.1.2.3'), '10.1.2.3');
assert.strictEqual(normalizeIp(' 10.1.2.3 '), '10.1.2.3');
assert.strictEqual(ipAllowed(null, '10.0.0.8'), true);
assert.strictEqual(ipAllowed('', '::ffff:10.0.0.8'), true);
assert.strictEqual(ipAllowed(JSON.stringify(['10.0.0.8']), '::ffff:10.0.0.8'), true);
assert.strictEqual(ipAllowed(JSON.stringify(['10.0.0.8']), '10.0.0.9'), false);
assert.strictEqual(ipAllowed('{', '10.0.0.8'), false);
assert.deepStrictEqual(parseAllowlist(null).mode, 'any');

assert.throws(() => assertAllowedQuery({ version_id: '1', sheets: '1' }, ['version_id']), (err) => err.code === 400);
assert.doesNotThrow(() => assertAllowedQuery({ stage: 'pre', page: '1' }, ['stage', 'keyword', 'page', 'pageSize']));
assert.strictEqual(sanitizeRequestId('req_1'), 'req_1');
assert.strictEqual(sanitizeRequestId('bad id'), '');
assert.strictEqual(isDraftVersionId('0'), true);
assert.strictEqual(isDraftVersionId('draft'), true);
assert.strictEqual(isDraftVersionId('2026010100000000001'), false);

const row = toPublicComparable({
  competitor_display_name: '甲公司',
  unified_credit_code: '91310000',
  stock_code: '600000',
  listing_market: 'sse',
  relevance_score: '80.5',
  selectable: 1,
  disabled_reason: '',
});
assert.strictEqual(row.name, '甲公司');
assert.strictEqual(row.selectable, true);
assert.strictEqual(row.relevance_score, 80.5);
assert.strictEqual(row.disabled_reason, null);
assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'source'), false);

const blocked = toPublicComparable({
  competitor_display_name: '乙公司',
  stock_code: '',
  selectable: false,
  disabled_reason: '无股票代码',
});
assert.strictEqual(blocked.stock_code, null);
assert.strictEqual(blocked.selectable, false);
assert.strictEqual(blocked.disabled_reason, '无股票代码');

const lines = toForecastLines([
  { fiscal_year: '2026', revenue: '100', cogs: '40', revenue_growth: '0.2' },
]);
assert.strictEqual(lines[0].revenue, 100);
assert.strictEqual(lines[0].revenue_growth, 0.2);
assert.strictEqual(lines[0].net_income, null);

const conclusion = toConclusion({
  display_yi: {
    market_ps: { low: 1, high: 2 },
    market_pe: { low: 3, high: 4 },
    dcf: { low: 5, high: 6 },
  },
  formula: '不应出现在短结论以外的底稿',
});
assert.strictEqual(conclusion.unit, 'yi');
assert.strictEqual(conclusion.market_ps.low, 1);
assert.strictEqual(Object.prototype.hasOwnProperty.call(conclusion, 'formula'), false);
assert.strictEqual(toConclusion(null), null);
assert.strictEqual(httpError('不返回草稿', 400).code, 400);

console.log('agent contract ok');
