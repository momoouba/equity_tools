/**
 * Step 4 Embedding 离线 POC — 数据导出
 *
 * 用法（在 news 目录）：
 *   node server/scripts/runEmbeddingPoc.js export
 *   node server/scripts/runEmbeddingPoc.js export --subjects 2026062414483000001
 *
 * 导出后运行 Python 评测：
 *   python ../../scripts/competitor-embedding-poc/run_embedding_poc.py
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('../db');
const { exportGoldenEmbeddingPoc } = require('../utils/competitor-analysis/competitorAnalysisRunner');

const DEFAULT_GOLDEN = path.join(
  __dirname,
  '../../../scripts/competitor-embedding-poc/golden-set.json'
);
const DEFAULT_OUT = path.join(
  __dirname,
  '../../../scripts/competitor-embedding-poc/data/pool.json'
);

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

function parseSubjectsArg(argv) {
  const idx = argv.indexOf('--subjects');
  if (idx === -1) return null;
  const raw = argv[idx + 1];
  if (!raw || raw.startsWith('--')) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function resolveUserId() {
  if (process.env.COMPETITOR_POC_USER_ID) return String(process.env.COMPETITOR_POC_USER_ID);
  const rows = await db.query(`SELECT F_Id AS id FROM users WHERE account = 'admin' LIMIT 1`);
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function main() {
  const cmd = process.argv[2] || 'export';
  if (cmd !== 'export') {
    console.error('用法: node server/scripts/runEmbeddingPoc.js export [--subjects id1,id2]');
    process.exit(1);
  }

  const goldenPath = process.env.COMPETITOR_POC_GOLDEN || DEFAULT_GOLDEN;
  const outPath = process.env.COMPETITOR_POC_OUT || DEFAULT_OUT;
  const subjectIds = parseSubjectsArg(process.argv);

  await waitDbReady();
  const userId = await resolveUserId();
  console.log(`导出 Embedding POC 数据 → ${outPath}`);
  console.log(`黄金集: ${goldenPath}`);
  if (subjectIds?.length) console.log(`限定主体: ${subjectIds.join(', ')}`);
  if (userId) console.log(`融资池权限用户: ${userId}`);

  const payload = await exportGoldenEmbeddingPoc({
    userId,
    subjectIds: subjectIds?.length ? subjectIds : null,
    goldenPath,
    outPath,
  });

  for (const s of payload.subjects) {
    const positives = s.positive_keywords || [];
    const inPool = s.candidates.filter((c) => c.is_positive && c.in_llm_pool).length;
    const inRule = s.candidates.filter((c) => c.is_positive && c.in_rule_top20).length;
    const totalPos = positives.length;
    console.log(
      `  ${s.sample_id || s.subject_id} | track=${s.llm_pool_meta?.trackKind ?? '—'} | 池=${s.candidate_count} LLM池=${s.llm_pool_size} | ` +
        `规则Top20命中 ${inRule}/${totalPos} | LLM池命中 ${inPool}/${totalPos}`
    );
  }
  console.log(`\n已写入 ${outPath}`);
  console.log('下一步: python scripts/competitor-embedding-poc/run_embedding_poc.py');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
