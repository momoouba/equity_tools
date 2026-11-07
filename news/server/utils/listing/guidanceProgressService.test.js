const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  statusLooksLikeDate,
  repairGuidanceShiftedFields,
} = require('./guidanceProgressRepair');

test('statusLooksLikeDate：纯日期为 true，正常状态为 false', () => {
  assert.equal(statusLooksLikeDate('2026-11-03'), true);
  assert.equal(statusLooksLikeDate('2026/11/03'), true);
  assert.equal(statusLooksLikeDate('2026-11-03 00:00:00'), true);
  assert.equal(statusLooksLikeDate('辅导备案'), false);
  assert.equal(statusLooksLikeDate('验收工作完成'), false);
});

test('repairGuidanceShiftedFields：status 为日期时回填派出机构与默认板块', () => {
  const repaired = repairGuidanceShiftedFields('2026-11-03', '辅导备案', '上海证监局');
  assert.deepEqual(repaired, {
    status: '辅导备案',
    registerAddress: '上海证监局',
    board: '辅导备案报告',
  });
});

test('repairGuidanceShiftedFields：正常行不改写', () => {
  const repaired = repairGuidanceShiftedFields('辅导备案', '上海证监局', '辅导备案报告');
  assert.deepEqual(repaired, {
    status: '辅导备案',
    registerAddress: '上海证监局',
    board: '辅导备案报告',
  });
});
