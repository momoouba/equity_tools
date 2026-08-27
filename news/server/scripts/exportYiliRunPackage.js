#!/usr/bin/env node
'use strict';
/**
 * 导出亦立生物本次竞品分析结果（Excel + 服务器同步包）
 * 用法（news 目录）：node server/scripts/exportYiliRunPackage.js [runId]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { buildPreInvestmentCompetitorExportWorkbook } = require('../utils/competitor-analysis/competitorMatchExport');

const PROJECT_ID = process.env.YILI_PROJECT_ID || '2026072013324000001';
const RUN_ID = process.argv[2] || '2026082511551700001';
const OUT_DIR = path.resolve(__dirname, '../../tmp/yili_competitor_run');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const [run] = await db.query(
    `SELECT * FROM sourcing_pre_investment_competitor_run WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [RUN_ID]
  );
  if (!run) throw new Error(`run 不存在: ${RUN_ID}`);

  const relations = await db.query(
    `SELECT * FROM sourcing_competitor_relation
     WHERE pre_investment_run_id = ? AND F_DeleteMark = 0
     ORDER BY relevance_score DESC`,
    [RUN_ID]
  );

  const stepLogs = await db.query(
    `SELECT * FROM sourcing_competitor_run_step_log WHERE run_id = ? ORDER BY F_Id`,
    [RUN_ID]
  );

  const goldPairs = await db.query(
    `SELECT * FROM competitor_gold_standard_pair
     WHERE batch_id = 'feedback_yili_20260825' AND F_DeleteMark = 0`
  );

  const [project] = await db.query(
    `SELECT F_Id, project_no, enterprise_full_name, project_abbreviation, unified_credit_code
     FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [PROJECT_ID]
  );

  const syncPayload = {
    exported_at: new Date().toISOString(),
    project,
    run,
    relations,
    step_logs: stepLogs,
    gold_pairs: goldPairs,
    notes: '投前竞品：服务器需存在相同 pre_investment_project_id；导入后可在 UI 选该 run 版本查看。',
  };

  const jsonPath = path.join(OUT_DIR, `${RUN_ID}_sync_payload.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(syncPayload, null, 2), 'utf8');

  const { workbook } = await buildPreInvestmentCompetitorExportWorkbook({
    preInvestmentProjectIds: [PROJECT_ID],
    exportAll: false,
    exportBatchMode: 'latest',
    years: [],
    psUser: { id: run.F_CreatorUserId || '1' },
    isAdmin: true,
  });

  const xlsxPath = path.join(OUT_DIR, `竞品分析导出_亦立医药-本地测试-${RUN_ID}.xlsx`);
  const xlsx = require('xlsx');
  xlsx.writeFile(workbook, xlsxPath);

  console.log('[exportYiliRunPackage] 完成');
  console.log('  项目:', project?.enterprise_full_name, PROJECT_ID);
  console.log('  runId:', RUN_ID);
  console.log('  竞品数:', relations.length);
  console.log('  Excel:', xlsxPath);
  console.log('  同步包:', jsonPath);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[exportYiliRunPackage] 失败:', e);
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
