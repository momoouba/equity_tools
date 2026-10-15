const assert = require('assert');
const { normalizeNotifyPhone, maskNotifyPhone } = require('./smsNotifyPhone');

assert.deepStrictEqual(normalizeNotifyPhone(''), { ok: true, phone: null });
assert.deepStrictEqual(normalizeNotifyPhone('  '), { ok: true, phone: null });
assert.deepStrictEqual(normalizeNotifyPhone('13800138000'), { ok: true, phone: '13800138000' });
assert.strictEqual(normalizeNotifyPhone('12345').ok, false);
assert.strictEqual(normalizeNotifyPhone('23800138000').ok, false);
assert.strictEqual(normalizeNotifyPhone('1380013800').ok, false);
assert.strictEqual(maskNotifyPhone('13800138000'), '138****8000');

console.log('smsNotifyPhone.test.js ok');
