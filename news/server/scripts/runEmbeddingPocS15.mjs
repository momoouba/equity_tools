/**

 * Step 4b / S1.5 小步 POC：embedding Top-N 并入 LLM 池

 *

 * 对比：

 *   - 基线：当前 buildLlmScoringPool（in_llm_pool）

 *   - S1.5：基线 ∪ BGE-M3 embed Top-N

 *

 * 用法（news 目录）：

 *   $env:HF_ENDPOINT="https://hf-mirror.com"

 *   node server/scripts/runEmbeddingPocS15.mjs

 *   node server/scripts/runEmbeddingPocS15.mjs --embed-top 30

 */

import fs from 'fs';

import path from 'path';

import { fileURLToPath } from 'url';

import { env, pipeline } from '@xenova/transformers';



if (process.env.HF_ENDPOINT) {

  env.remoteHost = process.env.HF_ENDPOINT.replace(/\/$/, '');

}



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../../../scripts/competitor-embedding-poc/data');

const INPUT = path.join(DATA_DIR, 'pool.json');

const OUT_JSON = path.join(DATA_DIR, 'report-s15.json');

const OUT_MD = path.join(DATA_DIR, 'report-s15.md');

const MODEL = process.env.BGE_POC_MODEL || 'Xenova/bge-m3';



function parseEmbedTop(argv) {

  const idx = argv.indexOf('--embed-top');

  if (idx === -1) return 30;

  const n = parseInt(argv[idx + 1], 10);

  return Number.isFinite(n) && n > 0 ? n : 30;

}



const EMBED_TOP_N = parseEmbedTop(process.argv);



function recallInSet(candidates, positiveKeywords) {

  const hitKw = new Set();

  for (const c of candidates) {

    const name = c.display_name || '';

    for (const kw of positiveKeywords) {

      if (name.includes(kw)) hitKw.add(kw);

    }

  }

  const missed = positiveKeywords.filter((kw) => !hitKw.has(kw));

  return {

    hit: hitKw.size,

    total: positiveKeywords.length,

    rate: positiveKeywords.length ? hitKw.size / positiveKeywords.length : null,

    hit_keywords: [...hitKw].sort(),

    missed_keywords: missed,

  };

}



function pct(v) {

  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;

}



function aggregate(results) {

  const sum = (key) => {

    let hit = 0;

    let total = 0;

    for (const r of results) {

      if (!r[key].total) continue;

      hit += r[key].hit;

      total += r[key].total;

    }

    return { hit, total, rate: total ? hit / total : null };

  };

  const baseline = sum('recall_baseline_llm');

  const s15 = sum('recall_s15_union');

  const uplift = baseline.total ? (s15.hit - baseline.hit) / baseline.total : 0;

  const avgPool = (key) => {

    const vals = results.map((r) => r[key]).filter((v) => v != null);

    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  };

  let recommendation = 'S1.5 并集未带来 recall 提升，暂不建议改 buildLlmScoringPool';

  if (s15.hit > baseline.hit) {

    recommendation = 'S1.5 recall 有提升，可评估将 embed Top-N 并入 buildLlmScoringPool';

  } else if (s15.hit === baseline.hit && s15.hit > 0) {

    recommendation =

      'S1.5 recall 与基线相同（品善已在 LLM 池）；并入 Top-30 仅膨胀池子，生产集成价值低';

  }

  return {

    embed_top_n: EMBED_TOP_N,

    macro_baseline_llm: `${baseline.hit}/${baseline.total}`,

    macro_s15_union: `${s15.hit}/${s15.total}`,

    macro_baseline_rate: baseline.rate,

    macro_s15_rate: s15.rate,

    recall_uplift: uplift,

    avg_baseline_pool_size: avgPool('baseline_pool_size'),

    avg_s15_pool_size: avgPool('s15_pool_size'),

    avg_embed_added: avgPool('embed_only_added'),

    total_new_hits: results.reduce((n, r) => n + r.new_hits.length, 0),

    recommendation,

  };

}



function renderMd(report) {

  const agg = report.aggregate;

  const lines = [

    '# S1.5 POC 报告 — LLM 池 ∪ Embedding Top-N',

    '',

    `- 生成时间: ${report.generated_at}`,

    `- 模型: **${report.model}**`,

    `- Embed Top-N: **${agg.embed_top_n}**`,

    '',

    '## 宏平均 recall（IM 正样本）',

    '',

    '| 方法 | 命中 | 比率 |',

    '|------|------|------|',

    `| 基线 LLM 池 | ${agg.macro_baseline_llm} | ${pct(agg.macro_baseline_rate)} |`,

    `| S1.5 并集 | ${agg.macro_s15_union} | ${pct(agg.macro_s15_rate)} |`,

    '',

    `**Recall 提升**: ${pct(agg.recall_uplift)} | **新增命中项**: ${agg.total_new_hits}`,

    '',

    `**池大小（均值）**: 基线 ${agg.avg_baseline_pool_size?.toFixed(1) ?? '—'} → S1.5 ${agg.avg_s15_pool_size?.toFixed(1) ?? '—'}（纯 embed 新增 ~${agg.avg_embed_added?.toFixed(1) ?? '—'}）`,

    '',

    `**结论**: ${agg.recommendation}`,

    '',

    '## 分主体',

    '',

  ];

  for (const r of report.subjects) {

    lines.push(`### ${r.sample_id} — ${r.subject_display_name}`, '');

    lines.push(`- 基线 LLM 池 ${r.baseline_pool_size} → S1.5 ${r.s15_pool_size}（+${r.embed_only_added} embed）`);

    const bl = r.recall_baseline_llm;

    const s15 = r.recall_s15_union;

    lines.push(`- 基线 recall: **${bl.hit}/${bl.total}** （${bl.hit_keywords.join(', ') || '—'}）`);

    lines.push(`- S1.5 recall: **${s15.hit}/${s15.total}** （${s15.hit_keywords.join(', ') || '—'}）`);

    if (r.new_hits.length) {

      lines.push('- **S1.5 新增命中**:');

      for (const x of r.new_hits) {

        lines.push(`  - ${x.keyword} ← ${x.display_name} (embed=${x.embed_score.toFixed(3)}, embedRank=${x.embed_rank}, 规则rank=${x.rank_rule})`);

      }

    }

    if (r.embed_top30_positives?.length) {

      lines.push('- **Embed Top-N 内正样本（含基线已有）**:');

      for (const x of r.embed_top30_positives) {

        lines.push(`  - ${x.keyword} rank=${x.embed_rank} embed=${x.embed_score.toFixed(3)} inBaseline=${x.in_baseline}`);

      }

    }

    lines.push('');

  }

  return lines.join('\n');

}



async function embedBatch(extractor, texts) {

  const out = [];

  const batch = 16;

  for (let i = 0; i < texts.length; i += batch) {

    const chunk = texts.slice(i, i + batch);

    const result = await extractor(chunk, { pooling: 'mean', normalize: true });

    const dim = result.dims[result.dims.length - 1];

    for (let j = 0; j < chunk.length; j++) {

      const start = j * dim;

      out.push(Array.from(result.data.slice(start, start + dim)));

    }

    process.stderr.write(`  embedded ${Math.min(i + batch, texts.length)}/${texts.length}\r`);

  }

  process.stderr.write('\n');

  return out;

}



function cosine(a, b) {

  return a.reduce((s, v, i) => s + v * b[i], 0);

}



async function analyzeSubject(extractor, subject) {

  const positives = subject.positive_keywords || [];

  const candidates = subject.candidates || [];

  const query = subject.target_document || '';



  process.stderr.write(`\n${subject.sample_id} | ${candidates.length} 候选 embedding …\n`);

  const qv = (await embedBatch(extractor, [query]))[0];

  const docs = candidates.map((c) => c.document || c.display_name || '');

  const dvs = await embedBatch(extractor, docs);



  const embedRanked = candidates

    .map((c, i) => ({ ...c, embed_score: cosine(qv, dvs[i]) }))

    .sort((a, b) => b.embed_score - a.embed_score);



  const baselinePool = candidates.filter((c) => c.in_llm_pool);

  const baselineKeys = new Set(baselinePool.map((c) => c.key));

  const embedTop = embedRanked.slice(0, EMBED_TOP_N);

  const embedTopKeys = new Set(embedTop.map((c) => c.key));



  const unionKeys = new Set([...baselineKeys, ...embedTopKeys]);

  const s15Pool = candidates.filter((c) => unionKeys.has(c.key));

  const embedOnlyAdded = [...embedTopKeys].filter((k) => !baselineKeys.has(k)).length;



  const baselineRecall = recallInSet(baselinePool, positives);

  const s15Recall = recallInSet(s15Pool, positives);



  const baselineHitSet = new Set(baselineRecall.hit_keywords);

  const newHits = [];

  for (const kw of s15Recall.hit_keywords) {

    if (!baselineHitSet.has(kw)) {

      const c = s15Pool.find((x) => (x.display_name || '').includes(kw));

      const embedRank = embedRanked.findIndex((x) => x.key === c?.key) + 1;

      if (c) {

        newHits.push({

          keyword: kw,

          display_name: c.display_name,

          embed_score: c.embed_score ?? embedRanked.find((x) => x.key === c.key)?.embed_score ?? 0,

          embed_rank: embedRank,

          rank_rule: c.rank_rule,

        });

      }

    }

  }



  const embedTop30Positives = [];

  for (let i = 0; i < embedTop.length; i++) {

    const c = embedTop[i];

    const name = c.display_name || '';

    for (const kw of positives) {

      if (name.includes(kw)) {

        embedTop30Positives.push({

          keyword: kw,

          embed_rank: i + 1,

          embed_score: c.embed_score,

          in_baseline: baselineKeys.has(c.key),

        });

      }

    }

  }



  return {

    sample_id: subject.sample_id,

    subject_id: subject.subject_id,

    subject_display_name: subject.subject_display_name,

    baseline_pool_size: baselinePool.length,

    s15_pool_size: s15Pool.length,

    embed_only_added: embedOnlyAdded,

    recall_baseline_llm: baselineRecall,

    recall_s15_union: s15Recall,

    new_hits: newHits,

    embed_top30_positives: embedTop30Positives,

  };

}



async function main() {

  if (!fs.existsSync(INPUT)) {

    console.error(`缺少 ${INPUT}，请先运行 node server/scripts/runEmbeddingPoc.js export`);

    process.exit(1);

  }

  const payload = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

  process.stderr.write(`S1.5 POC | embed Top-${EMBED_TOP_N} | 模型 ${MODEL} …\n`);

  const extractor = await pipeline('feature-extraction', MODEL, { quantized: true });



  const results = [];

  for (const s of payload.subjects || []) {

    results.push(await analyzeSubject(extractor, s));

  }



  const report = {

    generated_at: new Date().toISOString(),

    input: INPUT,

    model: MODEL,

    embed_top_n: EMBED_TOP_N,

    exported_at: payload.exported_at,

    subjects: results,

    aggregate: aggregate(results),

  };



  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');

  fs.writeFileSync(OUT_MD, renderMd(report), 'utf8');



  const agg = report.aggregate;

  console.log(`S1.5 embed Top-${EMBED_TOP_N}`);

  console.log(`基线 LLM 池: ${agg.macro_baseline_llm} (${pct(agg.macro_baseline_rate)})`);

  console.log(`S1.5 并集: ${agg.macro_s15_union} (${pct(agg.macro_s15_rate)})`);

  console.log(`池均值: ${agg.avg_baseline_pool_size?.toFixed(1)} → ${agg.avg_s15_pool_size?.toFixed(1)}`);

  console.log(`结论: ${agg.recommendation}`);

  console.log(`\n报告: ${OUT_JSON}\n      ${OUT_MD}`);

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


