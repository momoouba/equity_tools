'use strict';

/**
 * 回归：用户勾选可比后，下一轮是否能按名称/信用代码召回。
 * 用法（news 目录）：
 *   YILI_IE_ID=投后企业ID node server/scripts/verifyYiliGoldRecall.js
 */

const db = require('../db');
const { recallGoldStandardCandidates } = require('../utils/competitor-analysis/competitorGoldStandardRecall');
const { clearCompetitorPromptCache } = require('../utils/competitor-analysis/competitorAnalysisPromptService');
const { initPrompts } = require('../utils/initPrompts');

const TARGET = {
  display_name: '亦立医药',
  unified_credit_code: '91330108MAD8RWW9X3',
};

const EXPECTED_MISSED = [
  '烟台蓝纳成',
  '法伯新天',
  '艾博兹',
  '核欣',
  '速康',
  '砹尔法',
];

async function main() {
  // 同步提示词到 DB（P4/P5）
  await initPrompts();
  clearCompetitorPromptCache();
  console.log('[verifyYiliGoldRecall] 提示词已同步并清缓存');

  const ieId = process.env.YILI_IE_ID || process.env.YILI_INVESTED_ENTERPRISE_ID || '';
  const candidates = await recallGoldStandardCandidates(TARGET, null, null, {
    subjectType: 'invested_enterprise',
    investedEnterpriseId: ieId || null,
    preInvestmentProjectId: null,
  });
  console.log(
    `[verifyYiliGoldRecall] 用户可比召回 ${candidates.length} 条（invested_enterprise_id=${ieId || '未设'}）:`
  );
  for (const c of candidates) {
    console.log(`  - ${c.display_name} (source=${c.source}, gold=${!!c._fromGoldStandard})`);
  }

  const names = candidates.map((c) => c.display_name || '');
  const hits = EXPECTED_MISSED.map((kw) => ({
    kw,
    hit: names.some((n) => n.includes(kw)),
  }));
  const missed = hits.filter((h) => !h.hit);
  console.log('[verifyYiliGoldRecall] 漏召补竞品命中（仅当用户已勾选可比时才会出现）:', hits.map((h) => `${h.kw}:${h.hit ? 'Y' : 'N'}`).join(', '));

  if (!ieId) {
    console.log('[verifyYiliGoldRecall] 未设置 YILI_IE_ID，跳过命中断言（金标已改为用户可比勾选）');
  } else if (!candidates.length) {
    console.log('[verifyYiliGoldRecall] 该主体尚无用户勾选可比，金标种子为空（符合产品语义，跳过命中断言）');
  } else if (missed.length) {
    console.warn('[verifyYiliGoldRecall] 未命中:', missed.map((m) => m.kw).join(', '));
    process.exitCode = 1;
  } else {
    console.log('[verifyYiliGoldRecall] PASS');
  }

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[verifyYiliGoldRecall] 失败:', e);
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
