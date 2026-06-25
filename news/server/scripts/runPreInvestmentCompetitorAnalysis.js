/**
 * 投前项目竞品分析跑批（同步执行，供黄金集验收）
 *
 * 用法（在 news 目录）：
 *   node server/scripts/runPreInvestmentCompetitorAnalysis.js 2026062414280300001 2026062414483000001
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const {
  executeCompetitorAnalysisRun,
  listCompetitorRunStepLogs,
} = require('../utils/competitor-analysis/competitorAnalysisRunner');

const IM_GUANHUAI_SAME_TRACK = [
  '艾里奥斯',
  '赛普',
  '碧途',
  '品善',
  '科百特',
  '成器',
];
const IM_BITUO_DIRECT = ['艾里奥斯', '赛普', '科百特', '品善', '成器'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function matchImName(displayName, keywords) {
  const n = String(displayName || '');
  return keywords.find((k) => n.includes(k)) || null;
}

async function waitDbReady() {
  for (let i = 0; i < 60; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('数据库未就绪');
}

async function runOne(projectId) {
  const rows = await db.query(
    `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, F_CreatorUserId AS creator_user_id
     FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [projectId]
  );
  if (!rows.length) throw new Error(`投前项目不存在: ${projectId}`);
  const row = rows[0];
  const runId = await generateId('sourcing_pre_investment_competitor_run');
  const uid = row.creator_user_id ? String(row.creator_user_id) : null;

  await db.execute(
    `INSERT INTO sourcing_pre_investment_competitor_run (
       F_Id, pre_investment_project_id, status, message, triggered_by_user_id, started_at,
       F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,NOW(),NOW(),NOW(),0)`,
    [runId, projectId, 'queued', '脚本验收跑批', uid]
  );

  console.log(`\n=== 开始 ${row.enterprise_full_name || row.project_abbreviation} (${projectId}) run=${runId} ===`);
  const t0 = Date.now();
  const result = await executeCompetitorAnalysisRun({
    subjectType: 'pre_investment_project',
    runId,
    preInvestmentProjectId: projectId,
    preInvestmentRunId: runId,
    userId: uid,
    enableAutoExpand: true,
  });
  console.log(`=== 完成 ${projectId} ${((Date.now() - t0) / 1000).toFixed(0)}s ===`, result);

  const relations = await db.query(
    `SELECT competitor_display_name, competitor_type, relevance_score, confidence_grade, is_listed,
            score_breakdown_json
     FROM sourcing_competitor_relation
     WHERE pre_investment_project_id = ? AND (pre_investment_run_id = ? OR run_id = ?) AND F_DeleteMark = 0
     ORDER BY relevance_score DESC`,
    [projectId, runId, runId]
  );

  const logs = await listCompetitorRunStepLogs(runId);
  const s0 = logs.find((l) => l.step_code === 'S0_profile');
  let trackHint = null;
  if (s0?.detail_json) {
    try {
      const d = typeof s0.detail_json === 'string' ? JSON.parse(s0.detail_json) : s0.detail_json;
      trackHint = d.subject_track_hint || d.track_kind || null;
    } catch {
      /* ignore */
    }
  }

  return { projectId, runId, displayName: row.enterprise_full_name, result, relations, trackHint, logs };
}

function summarizeGuanhuai(relations) {
  const hits = [];
  const misses = [];
  for (const k of IM_GUANHUAI_SAME_TRACK) {
    const row = relations.find((r) => matchImName(r.competitor_display_name, [k]));
    if (row) hits.push({ k, type: row.competitor_type, score: row.relevance_score });
    else misses.push(k);
  }
  const kebate = relations.find((r) => matchImName(r.competitor_display_name, ['科百特']));
  const duoning = relations.find((r) => matchImName(r.competitor_display_name, ['多宁']));
  return { same_track_hits: hits, same_track_misses: misses, kebate, duoning };
}

const IM_SAIPU_DIRECT = ['科百特', '碧途', '艾里奥斯', '品善', '成器'];

function summarizeSaipu(relations) {
  const hits = [];
  const misses = [];
  for (const k of IM_SAIPU_DIRECT) {
    const row = relations.find((r) => matchImName(r.competitor_display_name, [k]));
    if (row) hits.push({ k, type: row.competitor_type, score: row.relevance_score });
    else misses.push(k);
  }
  const duoning = relations.find((r) => matchImName(r.competitor_display_name, ['多宁']));
  return { direct_hits: hits, direct_misses: misses, duoning };
}

function summarizeBituo(relations) {
  const hits = [];
  const misses = [];
  for (const k of IM_BITUO_DIRECT) {
    const row = relations.find((r) => matchImName(r.competitor_display_name, [k]));
    if (row) hits.push({ k, type: row.competitor_type, score: row.relevance_score });
    else misses.push(k);
  }
  const duoning = relations.find((r) => matchImName(r.competitor_display_name, ['多宁']));
  return { direct_hits: hits, direct_misses: misses, duoning };
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('用法: node server/scripts/runPreInvestmentCompetitorAnalysis.js <project_id> [...]');
    process.exit(1);
  }

  await waitDbReady();
  const reports = [];
  for (const id of ids) {
    reports.push(await runOne(id.trim()));
  }

  console.log('\n========== 验收摘要 ==========');
  for (const r of reports) {
    console.log(`\n【${r.displayName}】run_id=${r.runId} 落库=${r.relations.length}`);
    if (r.trackHint) console.log('  track:', r.trackHint);
    if (r.projectId === '2026062414280300001') {
      const s = summarizeGuanhuai(r.relations);
      console.log('  same_track 命中:', s.same_track_hits);
      console.log('  same_track 漏召:', s.same_track_misses);
      if (s.kebate) console.log('  科百特:', s.kebate.competitor_type, s.kebate.relevance_score);
      if (s.duoning) console.log('  多宁:', s.duoning.competitor_type, s.duoning.relevance_score);
    }
    if (r.projectId === '2026062414483000001') {
      const s = summarizeBituo(r.relations);
      console.log('  direct 命中:', s.direct_hits);
      console.log('  direct 漏召:', s.direct_misses);
      if (s.duoning) console.log('  多宁:', s.duoning.competitor_type, s.duoning.relevance_score, '(期望 not_competitor/未落库)');
      else console.log('  多宁: 未落库 ✅');
    }
    if (r.projectId === '2026062413465200001') {
      const s = summarizeSaipu(r.relations);
      console.log('  direct 命中:', s.direct_hits);
      console.log('  direct 漏召:', s.direct_misses);
      if (s.duoning) console.log('  多宁:', s.duoning.competitor_type, s.duoning.relevance_score, '(期望 not_competitor/未落库)');
      else console.log('  多宁: 未落库 ✅');
    }
    console.log('  类型分布:', r.relations.reduce((acc, x) => {
      acc[x.competitor_type] = (acc[x.competitor_type] || 0) + 1;
      return acc;
    }, {}));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
