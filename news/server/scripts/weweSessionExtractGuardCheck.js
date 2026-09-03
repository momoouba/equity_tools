/**
 * 会话过期仍提取 / WeRead 404 被当成 wewe 宕机 — 回归检查
 * Usage: node server/scripts/weweSessionExtractGuardCheck.js
 */
const assert = require('assert');
const {
  isWeweUnavailableError,
  isHttp404Error,
  isSessionTtlExpired
} = require('../utils/wewe/weweExtractErrors');

const wrapped404 = { message: 'Request failed with status code 404', status: 500 };
assert.strictEqual(isHttp404Error(wrapped404), true);
assert.strictEqual(
  isWeweUnavailableError(wrapped404),
  false,
  'WeRead 404 wrapped in tRPC 500 must not freeze the queue as wewe_unavailable'
);

assert.strictEqual(
  isWeweUnavailableError({ message: 'connect ECONNREFUSED 127.0.0.1:4000', code: 'ECONNREFUSED' }),
  true,
  'real wewe down still counts as unavailable'
);

assert.strictEqual(
  isWeweUnavailableError({ message: 'wewe feed.json HTTP 502', status: 502 }),
  true
);

const expiredAt = new Date('2026-09-03T11:28:00+08:00');
assert.strictEqual(
  isSessionTtlExpired(
    {
      session_status: 'expired',
      pause_extract: 0,
      last_login_at: '2026-09-01T02:21:43.000Z'
    },
    { session_ttl_hours: 30 },
    expiredAt
  ),
  true,
  'status=expired must pause extract even when pause_extract=0'
);

assert.strictEqual(
  isSessionTtlExpired(
    {
      session_status: 'ok',
      pause_extract: 0,
      last_login_at: '2026-09-01T02:21:43.000Z'
    },
    { session_ttl_hours: 30 },
    expiredAt
  ),
  true,
  'TTL past expiresAt must pause extract'
);

assert.strictEqual(
  isSessionTtlExpired(
    {
      session_status: 'ok',
      pause_extract: 0,
      last_login_at: '2026-09-03T02:00:00.000Z'
    },
    { session_ttl_hours: 30 },
    expiredAt
  ),
  false
);

console.log('weweSessionExtractGuardCheck ok');
