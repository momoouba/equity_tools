#!/usr/bin/env node
'use strict';
/**
 * 本地测试：亦立医药竞品分析全链路
 * 用法（news 目录）：node server/scripts/runYiliCompetitorAnalysis.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { executeCompetitorAnalysisRun } = require('../utils/competitor-analysis/competitorAnalysisRunner');

const PROJECT_ID = process.env.YILI_PROJECT_ID || '2026072013324000001';
const OUT_DIR = path.resolve(__dirname, '../../tmp/yili_competitor_run');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const [proj] = await db.query(
    `SELECT F_Id, enterprise_full_name, project_abbreviation, unified_credit_code, ai_product_intro
     FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [PROJECT_ID]
  );
  if (!proj) throw new Error(`投前项目不存在: ${PROJECT_ID}`);
  console.log('[yili-run] 目标:', proj.enterprise_full_name, proj.F_Id);

  const runId = await generateId('sourcing_pre_investment_competitor_run');
  await db.execute(
    `INSERT INTO sourcing_pre_investment_competitor_run (
       F_Id, pre_investment_project_id, status, message, started_at, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,NOW(),NOW(),NOW(),0)`,
    [runId, PROJECT_ID, 'pending', '本地亦立医药测试']
  );
  console.log('[yili-run] runId:', runId);

  const t0 = Date.now();
  const result = await executeCompetitorAnalysisRun({
    subjectType: 'pre_investment_project',
    runId,
    preInvestmentProjectId: PROJECT_ID,
    preInvestmentRunId: runId,
    userId: null,
    enableAutoExpand: true,
    competitionLens: null,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[yili-run] 完成，耗时 ${elapsed}s`);
  console.log('[yili-run] result:', JSON.stringify(result, null, 2));

  const logs = await db.query(
    `SELECT step_code, message, detail_json FROM sourcing_competitor_run_step_log
     WHERE run_id = ? ORDER BY F_Id`,
    [runId]
  );
  fs.writeFileSync(path.join(OUT_DIR, `${runId}_steps.json`), JSON.stringify(logs, null, 2), 'utf8');

  const relations = await db.query(
    `SELECT competitor_type, competitor_display_name, unified_credit_code,
            relevance_score, confidence_grade, is_listed, include_in_comparable,
            competitor_product_intro, competitor_tags_display, financing_amount_text,
            score_breakdown_json, evidence_summary
     FROM sourcing_competitor_relation
     WHERE pre_investment_run_id = ? AND F_DeleteMark = 0
     ORDER BY relevance_score DESC`,
    [runId]
  );
  fs.writeFileSync(path.join(OUT_DIR, `${runId}_relations.json`), JSON.stringify(relations, null, 2), 'utf8');

  // 反馈表关键对照：漏召补竞品 / 模态误报 / 量级不可比
  const { namesMatchLoosely } = require('../utils/competitor-analysis/competitorCompanyMatch');
  const goldPairs = await db.query(
    `SELECT candidate_display_name, candidate_credit_code, final_is_competitor, final_type, notes
     FROM competitor_gold_standard_pair
     WHERE batch_id = 'feedback_yili_20260825' AND F_DeleteMark = 0`
  );
  const checklist = goldPairs.map((g) => {
    const gCredit = String(g.candidate_credit_code || '').trim().toUpperCase();
    const rel =
      relations.find((r) => {
        const rc = String(r.unified_credit_code || '').trim().toUpperCase();
        if (gCredit && rc && gCredit === rc) return true;
        return namesMatchLoosely(r.competitor_display_name, g.candidate_display_name);
      }) || null;
    return {
      candidate: g.candidate_display_name,
      expected_competitor: g.final_is_competitor === 1,
      expected_type: g.final_type,
      recalled: !!rel,
      actual_type: rel?.competitor_type || null,
      score: rel?.relevance_score ?? null,
      include_comparable: rel?.include_in_comparable ?? null,
      notes: g.notes,
    };
  });
  fs.writeFileSync(path.join(OUT_DIR, `${runId}_checklist.json`), JSON.stringify(checklist, null, 2), 'utf8');

  console.log('\n[yili-run] Top 20 竞品:');
  for (const r of relations.slice(0, 20)) {
    console.log(
      `  [${r.competitor_type}] ${r.competitor_display_name} score=${r.relevance_score} comparable=${r.include_in_comparable}`
    );
  }

  console.log('\n[yili-run] 金标对照:');
  for (const c of checklist) {
    console.log(
      `  ${c.candidate}: recalled=${c.recalled ? 'Y' : 'N'} type=${c.actual_type || '-'} expected=${c.expected_type}`
    );
  }

  console.log(`\n[yili-run] 输出目录: ${OUT_DIR}`);
  console.log(`[yili-run] runId=${runId}（同步服务器时用此 ID）`);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[yili-run] 失败:', e);
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
