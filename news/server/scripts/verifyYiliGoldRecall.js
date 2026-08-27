'use strict';

/**
 * P9 回归：亦立生物金标种子召回是否生效
 * 用法（news 目录）：node server/scripts/verifyYiliGoldRecall.js
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

  const candidates = await recallGoldStandardCandidates(TARGET, null, null);
  console.log(`[verifyYiliGoldRecall] 金标召回 ${candidates.length} 条:`);
  for (const c of candidates) {
    console.log(`  - ${c.display_name} (source=${c.source}, gold=${!!c._fromGoldStandard})`);
  }

  const names = candidates.map((c) => c.display_name || '');
  const hits = EXPECTED_MISSED.map((kw) => ({
    kw,
    hit: names.some((n) => n.includes(kw)),
  }));
  const missed = hits.filter((h) => !h.hit);
  console.log('[verifyYiliGoldRecall] 漏召补竞品命中:', hits.map((h) => `${h.kw}:${h.hit ? 'Y' : 'N'}`).join(', '));

  const pairs = await db.query(
    `SELECT candidate_display_name, final_is_competitor, final_type
     FROM competitor_gold_standard_pair
     WHERE batch_id = 'feedback_yili_20260825' AND F_DeleteMark = 0
     ORDER BY F_Id`
  );
  console.log(`[verifyYiliGoldRecall] DB 金标对 ${pairs.length} 条`);

  if (missed.length) {
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
