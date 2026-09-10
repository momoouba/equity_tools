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

  const comparable = relations.filter((r) => Number(r.include_in_comparable) === 1);
  fs.writeFileSync(
    path.join(OUT_DIR, `${runId}_user_comparable.json`),
    JSON.stringify(comparable, null, 2),
    'utf8'
  );

  console.log('\n[yili-run] Top 20 竞品:');
  for (const r of relations.slice(0, 20)) {
    console.log(
      `  [${r.competitor_type}] ${r.competitor_display_name} score=${r.relevance_score} comparable=${r.include_in_comparable}`
    );
  }

  console.log(`\n[yili-run] 本轮用户可比 ${comparable.length} 条（金标只认勾选，不读人工金标表）:`);
  for (const r of comparable) {
    console.log(`  [${r.competitor_type}] ${r.competitor_display_name}`);
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
