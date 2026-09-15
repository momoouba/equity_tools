const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dedupeIpoProjectProgressRowsForMail } = require('./listingProjectProgressDedupe');

test('日报底层项目：同一持仓多条匹配快照去重，不同基金保留', () => {
  const yangtze = {
    fund: '长三角一期',
    sub: '国万极帆',
    project_name: '亿康基因',
    company: '上海序康基因科技股份有限公司',
    status: '终止上市辅导',
    exchange: '证监会辅导备案',
    board: '辅导备案报告',
    F_UpdateTime: '2026-09-14 00:00:00',
    inv_amount: 59700511.43,
    residual_amount: 59700511.43,
    ratio: 0.0342,
    ct_amount: 59700511.43,
    ct_residual: 59700511.43,
  };
  const jinlan = {
    ...yangtze,
    fund: '金澜二期',
    sub: '',
    inv_amount: 100000851,
    residual_amount: 100000851,
    ratio: 0.0084,
    ct_amount: 14679024,
    ct_residual: 14679024,
  };
  const rows = [
    yangtze,
    { ...yangtze },
    { ...yangtze },
    { ...yangtze },
    { ...yangtze },
    jinlan,
    { ...jinlan },
    { ...jinlan },
    { ...jinlan },
    { ...jinlan },
  ];
  const out = dedupeIpoProjectProgressRowsForMail(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].fund, '长三角一期');
  assert.equal(out[1].fund, '金澜二期');
});
