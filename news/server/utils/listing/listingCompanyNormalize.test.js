const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCompanyNameForMatch,
  companiesExactMatchForListing,
  canonicalCompanyForMatchCross,
} = require('./listingCompanyNormalize');

test('去括号后全称精确：含行政区括号仍可对齐', () => {
  const a = normalizeCompanyNameForMatch('华太电子（深圳）有限公司');
  const b = normalizeCompanyNameForMatch('华太电子(深圳市)有限公司');
  assert.equal(a, '华太电子深圳有限公司');
  assert.equal(b, '华太电子深圳有限公司');
  assert.equal(a, b);
});

test('沪深北：立芯不得模糊对上宸芯/悦芯', () => {
  assert.equal(
    companiesExactMatchForListing('立芯科技股份有限公司', '宸芯科技股份有限公司', '深交所'),
    false
  );
  assert.equal(
    companiesExactMatchForListing('立芯科技股份有限公司', '悦芯科技股份有限公司', '深交所'),
    false
  );
  assert.equal(
    companiesExactMatchForListing('立芯科技股份有限公司', '立芯科技股份有限公司', '深交所'),
    true
  );
});

test('港股：繁简转中文后精确对齐', () => {
  const trad = canonicalCompanyForMatchCross('華為技術有限公司', '港交所');
  const simp = canonicalCompanyForMatchCross('华为技术有限公司', '港交所');
  assert.ok(trad);
  assert.equal(trad, simp);
  assert.equal(
    companiesExactMatchForListing('华为技术有限公司', '華為技術有限公司', '港交所'),
    true
  );
});
