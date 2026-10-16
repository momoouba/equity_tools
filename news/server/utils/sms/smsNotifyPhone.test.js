const assert = require('assert');
const { normalizeNotifyPhone, maskNotifyPhone } = require('./smsNotifyPhone');

assert.deepStrictEqual(normalizeNotifyPhone(''), { ok: true, phone: null, phones: [] });
assert.deepStrictEqual(normalizeNotifyPhone('  '), { ok: true, phone: null, phones: [] });
assert.deepStrictEqual(normalizeNotifyPhone('13800138000'), {
  ok: true,
  phone: '13800138000',
  phones: ['13800138000'],
});
assert.deepStrictEqual(normalizeNotifyPhone('13800138000,13900139000'), {
  ok: true,
  phone: '13800138000,13900139000',
  phones: ['13800138000', '13900139000'],
});
assert.deepStrictEqual(normalizeNotifyPhone('13800138000，13900139000，13800138000'), {
  ok: true,
  phone: '13800138000,13900139000',
  phones: ['13800138000', '13900139000'],
});
assert.strictEqual(normalizeNotifyPhone('12345').ok, false);
assert.strictEqual(normalizeNotifyPhone('13800138000,12345').ok, false);
assert.strictEqual(normalizeNotifyPhone('23800138000').ok, false);
assert.strictEqual(normalizeNotifyPhone('1380013800').ok, false);
assert.strictEqual(maskNotifyPhone('13800138000'), '138****8000');
assert.strictEqual(maskNotifyPhone('13800138000,13900139000'), '138****8000、139****9000');

console.log('smsNotifyPhone.test.js ok');
