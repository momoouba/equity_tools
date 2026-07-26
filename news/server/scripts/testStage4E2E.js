#!/usr/bin/env node
'use strict';
/**
 * Stage 4 E2E 测试：用案例企业跑完整竞品分析（new_share 主召回已激活）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { executeCompetitorAnalysisRun } = require('../utils/competitor-analysis/competitorAnalysisRunner');

const PROJECT_ID = '2026063009440800001'; // 上海未来不远机器人科技

(async () => {
  const runId = await generateId('sourcing_pre_investment_competitor_run');
  console.log('[E2E] runId:', runId, 'project:', PROJECT_ID);

  await db.execute(
    'INSERT INTO sourcing_pre_investment_competitor_run (F_Id, pre_investment_project_id, status, message, started_at, F_CreatorTime, F_LastModifyTime, F_DeleteMark) VALUES (?,?,?,?,NOW(),NOW(),NOW(),0)',
    [runId, PROJECT_ID]
  );
  console.log('[E2E] Run record created, starting pipeline...');

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
  console.log('[E2E] Done in', elapsed + 's');
  console.log('[E2E] Result:', JSON.stringify(result));

  // Step logs
  const [logs] = await db.execute(
    'SELECT step_code, message, detail_json FROM sourcing_competitor_run_step_log WHERE run_id = ? ORDER BY F_Id',
    [runId]
  );
  console.log('\n[E2E] Step logs:');
  for (const l of logs) {
    let extra = '';
    if (l.detail_json) {
      try {
        const d = typeof l.detail_json === 'string' ? JSON.parse(l.detail_json) : l.detail_json;
        if (d.candidates !== undefined) extra += ` candidates=${d.candidates}`;
        if (d.saved !== undefined) extra += ` saved=${d.saved}`;
        if (d.ab_compare) extra += ` ab=${JSON.stringify(d.ab_compare)}`;
        if (d.recall_flags) extra += ` flags=${JSON.stringify(d.recall_flags)}`;
        if (d.strategy_id) extra += ` strategy=${d.strategy_id}`;
      } catch (_) {}
    }
    console.log(`  ${l.step_code}: ${l.message}${extra}`);
  }

  // Results
  const [results] = await db.execute(
    'SELECT competitor_type, competitor_display_name, relevance_score, confidence_grade, is_listed, include_in_comparable FROM sourcing_competitor_relation WHERE pre_investment_run_id = ? AND F_DeleteMark=0 ORDER BY relevance_score DESC LIMIT 15',
    [runId]
  );
  console.log(`\n[E2E] Top ${results.length} results:`);
  for (const r of results) {
    console.log(`  [${r.competitor_type}] ${r.competitor_display_name} score=${r.relevance_score} grade=${r.confidence_grade} listed=${r.is_listed} comparable=${r.include_in_comparable}`);
  }

  process.exit(0);
})().catch(e => { console.error('[E2E] Fatal:', e.message); process.exit(1); });
