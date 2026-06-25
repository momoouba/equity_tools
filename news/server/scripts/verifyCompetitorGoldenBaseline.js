/**
 * 黄金集基线只读验收（生产回归 / 池诊断）
 *
 * 默认：艾里奥斯**最新 run**，IM direct **≥4/5**（80%）且多宁/东富龙未落库 → exit 0
 *
 * 用法（Docker 生产环境须在 app 容器内执行，见 smoke-test §15.1）：
 *   docker compose exec app node server/scripts/verifyCompetitorGoldenBaseline.js
 *
 * 用法（news 目录，本地或容器内）：
 *   node server/scripts/verifyCompetitorGoldenBaseline.js
 *   node server/scripts/verifyCompetitorGoldenBaseline.js --latest 2026061614420000001
 *   node server/scripts/verifyCompetitorGoldenBaseline.js --run-id 2026062512000100001
 *   node server/scripts/verifyCompetitorGoldenBaseline.js --min-direct 5
 *   node server/scripts/verifyCompetitorGoldenBaseline.js --export-only
 *   node server/scripts/verifyCompetitorGoldenBaseline.js --v005
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('../db');
const { buildEmbeddingPocSnapshot } = require('../utils/competitor-analysis/competitorAnalysisRunner');

function resolveGoldenSetPath() {
  const candidates = [
    path.join(__dirname, 'golden-set.json'),
    path.join(__dirname, '../../../scripts/competitor-embedding-poc/golden-set.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`未找到 golden-set.json，已尝试: ${candidates.join('; ')}`);
}

function resolveDiagOutPath() {
  const inRepo = path.join(__dirname, '../../../scripts/competitor-embedding-poc/data/golden-pool-diag.json');
  if (fs.existsSync(path.dirname(inRepo))) return inRepo;
  return path.join(__dirname, 'golden-pool-diag.json');
}

const DEFAULT_AILIOS_PROJECT = '2026061614420000001';
const DEFAULT_MIN_DIRECT = 4;

const NOT_COMPETITOR_KW = ['多宁', '东富龙'];
const DIRECT_TYPES = new Set(['direct']);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function parseArgs(argv) {
  const out = {
    exportOnly: false,
    runId: null,
    latestProjectId: null,
    minDirect: DEFAULT_MIN_DIRECT,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--export-only') out.exportOnly = true;
    else if (argv[i] === '--run-id') out.runId = argv[++i];
    else if (argv[i] === '--latest') out.latestProjectId = argv[++i];
    else if (argv[i] === '--min-direct') {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n >= 0) out.minDirect = n;
    }
  }
  if (argv.includes('--v005')) out.runId = '2026062412202200001';
  if (!out.runId && !out.latestProjectId && !out.exportOnly) {
    out.latestProjectId = DEFAULT_AILIOS_PROJECT;
  }
  return out;
}

function summarizeImHits(relations, directKw, sameTrackKw = []) {
  const directHits = [];
  const directMisses = [];
  const wrongType = [];
  for (const kw of directKw) {
    const row = relations.find((r) => String(r.competitor_display_name || '').includes(kw));
    if (!row) {
      directMisses.push(kw);
      continue;
    }
    const entry = {
      kw,
      type: row.competitor_type,
      score: row.relevance_score,
      name: row.competitor_display_name,
    };
    if (DIRECT_TYPES.has(String(row.competitor_type || '').toLowerCase())) {
      directHits.push(entry);
    } else {
      wrongType.push(entry);
    }
  }

  const sameTrackHits = [];
  const sameTrackMisses = [];
  for (const kw of sameTrackKw) {
    const row = relations.find((r) => String(r.competitor_display_name || '').includes(kw));
    if (row) sameTrackHits.push({ kw, type: row.competitor_type, score: row.relevance_score, name: row.competitor_display_name });
    else sameTrackMisses.push(kw);
  }

  const bad = [];
  for (const kw of NOT_COMPETITOR_KW) {
    const row = relations.find((r) => String(r.competitor_display_name || '').includes(kw));
    if (row) bad.push({ kw, type: row.competitor_type, score: row.relevance_score, name: row.competitor_display_name });
  }

  return {
    directHits,
    directMisses,
    wrongType,
    sameTrackHits,
    sameTrackMisses,
    bad,
    directTotal: directKw.length,
  };
}

async function resolveUserId() {
  if (process.env.COMPETITOR_POC_USER_ID) return String(process.env.COMPETITOR_POC_USER_ID);
  const rows = await db.query(`SELECT F_Id AS id FROM users WHERE account = 'admin' LIMIT 1`);
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function fetchRelations(projectId, runId) {
  return db.query(
    `SELECT competitor_display_name, competitor_type, relevance_score, confidence_grade, is_listed
     FROM sourcing_competitor_relation
     WHERE pre_investment_project_id = ?
       AND (pre_investment_run_id = ? OR run_id = ?)
       AND F_DeleteMark = 0
     ORDER BY relevance_score DESC`,
    [projectId, runId, runId]
  );
}

async function fetchLatestRunId(projectId) {
  const rows = await db.query(
    `SELECT F_Id AS id, status, started_at
     FROM sourcing_pre_investment_competitor_run
     WHERE pre_investment_project_id = ? AND F_DeleteMark = 0
     ORDER BY started_at DESC LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

async function verifyRun(projectId, runId, labelKeywords, label, minDirect) {
  const relations = await fetchRelations(projectId, runId);
  const directKw = labelKeywords?.direct || [];
  const sameKw = labelKeywords?.same_track || [];
  const im = summarizeImHits(relations, directKw, sameKw);
  const passBoundary = im.bad.length === 0;

  let passIm;
  if (directKw.length > 0) {
    passIm = im.directHits.length >= minDirect;
  } else {
    passIm = sameKw.length === 0 || im.sameTrackMisses.length === 0;
  }

  return {
    label,
    projectId,
    runId,
    minDirect,
    relationCount: relations.length,
    im,
    pass: passIm && passBoundary,
    passIm,
    passBoundary,
  };
}

async function runExportDiag(userId) {
  const goldenPath = resolveGoldenSetPath();
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const subjects = [];
  for (const s of golden) {
    try {
      const snap = await buildEmbeddingPocSnapshot({
        preInvestmentProjectId: s.subject_id,
        userId,
        labelKeywords: s.label_keywords,
        sampleId: s.id,
      });
      const posKw = [...(s.label_keywords?.direct || []), ...(s.label_keywords?.same_track || [])];
      const inLlm = snap.candidates.filter((c) => c.is_positive && c.in_llm_pool);
      const inRule = snap.candidates.filter((c) => c.is_positive && c.in_rule_top20);
      subjects.push({
        sample_id: s.id,
        subject_id: s.subject_id,
        track_kind: snap.llm_pool_meta?.trackKind ?? null,
        candidate_count: snap.candidate_count,
        llm_pool_size: snap.llm_pool_size,
        llm_pool_meta: snap.llm_pool_meta,
        im_in_llm: inLlm.map((c) => c.label_keyword || c.display_name),
        im_in_rule_top20: inRule.map((c) => c.label_keyword || c.display_name),
        im_llm_hit: inLlm.length,
        im_total: posKw.length,
      });
    } catch (err) {
      subjects.push({
        sample_id: s.id,
        subject_id: s.subject_id,
        error: err.message,
      });
    }
  }
  const payload = { generated_at: new Date().toISOString(), subjects };
  const diagOut = resolveDiagOutPath();
  fs.mkdirSync(path.dirname(diagOut), { recursive: true });
  fs.writeFileSync(diagOut, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  await waitDbReady();

  if (args.exportOnly) {
    const userId = await resolveUserId();
    console.log('=== 黄金集 S1/赛道/LLM 池诊断 ===');
    const diag = await runExportDiag(userId);
    for (const s of diag.subjects) {
      console.log(
        `${s.sample_id} | track=${s.track_kind} | 池=${s.candidate_count} LLM=${s.llm_pool_size} | IM命中 ${s.im_llm_hit}/${s.im_total}`
      );
    }
    const diagOut = resolveDiagOutPath();
    console.log(`\n已写入 ${diagOut}`);
    process.exit(0);
  }

  const goldenPath = resolveGoldenSetPath();
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  let projectId = DEFAULT_AILIOS_PROJECT;
  let runId = args.runId;
  let labelKeywords = golden.find((g) => g.subject_id === projectId)?.label_keywords;

  if (args.latestProjectId) {
    projectId = args.latestProjectId;
    const sample = golden.find((g) => g.subject_id === projectId);
    labelKeywords = sample?.label_keywords;
    const latest = await fetchLatestRunId(projectId);
    if (!latest) {
      console.error(`无跑批记录: ${projectId}`);
      process.exit(1);
    }
    runId = latest.id;
    console.log(`最新 run: ${runId} status=${latest.status}`);
  }

  if (!runId) {
    console.error('请指定 --run-id 或 --latest <project_id>');
    process.exit(1);
  }

  const sample = golden.find((g) => g.subject_id === projectId);
  const report = await verifyRun(
    projectId,
    runId,
    labelKeywords,
    sample?.subject_short_name || projectId,
    args.minDirect
  );

  console.log('=== 黄金集生产回归验收 ===');
  console.log(`主体: ${report.label} (${projectId})`);
  console.log(`run_id: ${runId}`);
  console.log(`落库: ${report.relationCount}`);
  console.log(
    `IM direct: ${report.im.directHits.length}/${report.im.directTotal}（通过线 ≥${report.minDirect}，须为 direct 类型）`
  );
  if (report.im.directHits.length) {
    for (const h of report.im.directHits) {
      console.log(`  ✅ ${h.kw} → ${h.type} ${h.score} (${h.name})`);
    }
  }
  if (report.im.wrongType.length) {
    console.log('IM 命中但类型非 direct:');
    for (const w of report.im.wrongType) {
      console.log(`  ⚠️ ${w.kw} → ${w.type} ${w.score} (${w.name})`);
    }
  }
  if (report.im.directMisses.length) {
    console.log(`IM direct 漏召: ${report.im.directMisses.join(', ')}`);
  }
  if (report.im.sameTrackHits.length || report.im.sameTrackMisses.length) {
    console.log(
      `same_track: ${report.im.sameTrackHits.length}/${report.im.sameTrackHits.length + report.im.sameTrackMisses.length}（非主样本通过线）`
    );
  }
  if (report.im.bad.length) {
    console.log('边界误召:');
    for (const b of report.im.bad) {
      console.log(`  ❌ ${b.kw} → ${b.type} ${b.score} (${b.name})`);
    }
  } else {
    console.log('边界: 多宁/东富龙 未落库 ✅');
  }
  console.log(`\n判定: ${report.pass ? 'PASS ✅' : 'FAIL ❌'}`);
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
