const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreCandidate,
  defaultCheckedCodes,
  enabledRecallLayers,
  pickBestByCredit,
  companyIntroFallback,
  parseTags,
} = require('./listedIndustryRecommendScore');
const { resolveMergeAction } = require('./comparableMergePolicy');

const profile = {
  industry_category_4: 'bio',
  sub_track: 'radiopharma',
  sw_industry_l1: '医药生物',
  sw_industry_l2: '化学制药',
  sw_industry_l3: '化学制剂',
  tags: ['核药', 'RDC', '肿瘤'],
  competition_lens: { must_align: ['核药'], custom_keywords: [] },
};

test('四大类+三级+标签+透镜封顶 100，且无三级时申万整项为 0', () => {
  const hit = scoreCandidate(profile, {
    industry_category_4: 'bio',
    sub_track: 'radiopharma',
    sw_industry_l1: '医药生物',
    sw_industry_l2: '化学制药',
    sw_industry_l3: '化学制剂',
    industry_tags_display: '核药、RDC、肿瘤、化学制剂',
    product_intro: '核药研发',
  });
  assert.equal(hit.breakdown.category, 25);
  assert.equal(hit.breakdown.sub_track, 15);
  assert.equal(hit.breakdown.sw, 30);
  assert.ok(hit.breakdown.tags > 0);
  assert.ok(hit.breakdown.lens >= 5);
  assert.ok(hit.score <= 100);
  assert.equal(hit.comparability, 'strong');

  const noL3 = scoreCandidate({ ...profile, sw_industry_l3: '' }, {
    industry_category_4: 'bio',
    sw_industry_l1: '医药生物',
    sw_industry_l2: '化学制药',
    sw_industry_l3: '化学制剂',
    industry_tags_json: ['核药'],
  });
  assert.equal(noL3.breakdown.sw, 0);
});

test('四大类 other 不启用同行业层；有标签时走简介召回层', () => {
  assert.deepEqual(
    enabledRecallLayers({ industry_category_4: 'other', tags: ['合成生物学'] }),
    [5]
  );
  assert.equal(
    scoreCandidate(
      { industry_category_4: 'other' },
      { industry_category_4: 'other' }
    ).breakdown.category,
    0
  );
});

test('有四大类时不启用仅申万一级层；relax 从第 3 层起', () => {
  assert.deepEqual(enabledRecallLayers(profile), [1, 2, 3]);
  assert.deepEqual(enabledRecallLayers(profile, { relax: true }), [3]);
  assert.deepEqual(
    enabledRecallLayers({ sw_industry_l1: '医药生物' }),
    [4]
  );
  assert.deepEqual(
    enabledRecallLayers({ industry_category_4: 'ai', sw_industry_l1: '信息技术' }),
    [3]
  );
  assert.ok(!enabledRecallLayers(profile).includes(4));
});

test('默认勾选：≥60 且未在名单的前 15 家，已在名单不勾', () => {
  const list = [];
  for (let i = 0; i < 20; i += 1) {
    list.push({
      stock_code: String(600000 + i).padStart(6, '0'),
      score: 80 - i,
      list_status: i === 0 ? 'on_list' : 'can_add',
    });
  }
  list[2].list_status = 'was_deleted';
  const checked = defaultCheckedCodes(list);
  assert.equal(checked.length, 15);
  assert.ok(!checked.includes('600000'));
  assert.ok(!checked.includes('600002'));
  assert.equal(checked[0], '600001');
});

test('同一信用代码只留最高分，同分优先 A 股', () => {
  const picked = pickBestByCredit([
    { stock_code: '200001', unified_credit_code: '91110000AAA', score: 80 },
    { stock_code: '000001', unified_credit_code: '91110000AAA', score: 80 },
    { stock_code: '600001', unified_credit_code: '91110000BBB', score: 70 },
    { stock_code: '300001', score: 90 },
  ]);
  const codes = picked.map((r) => r.stock_code).sort();
  assert.deepEqual(codes, ['000001', '300001', '600001']);
});

test('合并策略：竞品不复活；推荐复活重置；手工复活保留', () => {
  assert.equal(resolveMergeAction('competitor_run', { hasActive: true }), 'keep_fill_empty');
  assert.equal(resolveMergeAction('competitor_run', { hasDeleted: true }), 'skip');
  assert.equal(resolveMergeAction('industry_recommend', { hasActive: true }), 'skip');
  assert.equal(resolveMergeAction('industry_recommend', { hasDeleted: true }), 'revive_reset');
  assert.equal(resolveMergeAction('manual', { hasDeleted: true }), 'revive_keep');
  assert.equal(resolveMergeAction('excel', { hasActive: false, hasDeleted: false }), 'insert');
});

test('简介回退与标签解析', () => {
  assert.equal(companyIntroFallback({ product_intro: 'P', company_intro: 'C' }), 'P');
  assert.equal(
    companyIntroFallback({ sw_industry_l1: '医药生物', sw_industry_l3: '化学制剂' }),
    '医药生物 / 化学制剂；暂无简介'
  );
  assert.deepEqual(parseTags('核药、RDC，肿瘤'), ['核药', 'RDC', '肿瘤']);
});
