/**
 * BGE-M3 Embedding POC（Node / @xenova/transformers WASM）
 * 规避 Windows Python 3.14 下 torch/onnxruntime DLL 问题
 *
 * 用法: node run_embedding_poc_node.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from '@xenova/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(__dirname, 'data/pool.json');
const OUT_JSON = path.join(__dirname, 'data/report-bge-m3.json');
const OUT_MD = path.join(__dirname, 'data/report-bge-m3.md');
const TOP_K = 20;
const MODEL = process.env.BGE_POC_MODEL || 'Xenova/bge-m3';

function recallAtK(ranked, positiveKeywords, k) {
  const hitKw = new Set();
  for (const c of ranked.slice(0, k)) {
    const name = c.display_name || '';
    for (const kw of positiveKeywords) {
      if (name.includes(kw)) hitKw.add(kw);
    }
  }
  const missed = positiveKeywords.filter((kw) => !hitKw.has(kw));
  return {
    k,
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
  const rule = sum('recall_rule_top_k');
  const emb = sum('recall_embed_top_k');
  const llm = sum('recall_llm_pool');
  const rescued = results.reduce((n, r) => n + r.embedding_rescued.length, 0);
  const uplift = rule.total ? (emb.hit - rule.hit) / rule.total : 0;
  let recommendation = '当前 POC 未显示明显 recall 提升';
  if (uplift >= 0.15 || rescued >= 3) {
    recommendation = '建议进入 Step 4b（Embedding 补充通道）：漏召改善 ≥15% 或 rescued≥3';
  } else if (uplift > 0) {
    recommendation = '有小幅改善，可观察扩样后再定 Step 4b';
  }
  return {
    macro_rule_recall: `${rule.hit}/${rule.total}`,
    macro_embed_recall: `${emb.hit}/${emb.total}`,
    macro_llm_pool_recall: `${llm.hit}/${llm.total}`,
    macro_rule_rate: rule.rate,
    macro_embed_rate: emb.rate,
    macro_llm_pool_rate: llm.rate,
    total_embedding_rescued: rescued,
    step4b_recommendation: recommendation,
  };
}

function renderMd(report) {
  const agg = report.aggregate;
  const lines = [
    '# Embedding POC 报告 (BGE-M3 / Node WASM)',
    '',
    `- 生成时间: ${report.generated_at}`,
    `- 模型: **${report.model}**`,
    `- Top-K: ${report.top_k}`,
    '',
    '## 宏平均 recall',
    '',
    '| 方法 | 命中 | 比率 |',
    '|------|------|------|',
    `| S2 规则 Top-${TOP_K} | ${agg.macro_rule_recall} | ${pct(agg.macro_rule_rate)} |`,
    `| Embedding Top-${TOP_K} | ${agg.macro_embed_recall} | ${pct(agg.macro_embed_rate)} |`,
    `| LLM 对标池 | ${agg.macro_llm_pool_recall} | ${pct(agg.macro_llm_pool_rate)} |`,
    '',
    `**Embedding 补救漏召**: ${agg.total_embedding_rescued} 项`,
    '',
    `**结论**: ${agg.step4b_recommendation}`,
    '',
    '## 分主体',
    '',
  ];
  for (const r of report.subjects) {
    lines.push(`### ${r.sample_id} — ${r.subject_display_name}`, '');
    lines.push(`- 候选池 ${r.candidate_count} | LLM池 ${r.llm_pool_size}`);
    const rr = r.recall_rule_top_k;
    const er = r.recall_embed_top_k;
    lines.push(`- 规则 Top-${rr.k}: **${rr.hit}/${rr.total}** （漏: ${rr.missed_keywords.join(', ') || '—'}）`);
    lines.push(`- Embedding Top-${er.k}: **${er.hit}/${er.total}** （漏: ${er.missed_keywords.join(', ') || '—'}）`);
    if (r.embedding_rescued.length) {
      lines.push('- **Embedding 补救**:');
      for (const x of r.embedding_rescued) {
        lines.push(`  - ${x.keyword} ← ${x.display_name} (embed=${x.embed_score.toFixed(3)}, 规则rank=${x.rank_rule})`);
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

  const ruleRanked = [...candidates].sort((a, b) => b.internal_score - a.internal_score);
  const llmPool = candidates.filter((c) => c.in_llm_pool);
  const llmRanked = [...llmPool].sort((a, b) => b.internal_score - a.internal_score);

  const ruleRecall = recallAtK(ruleRanked, positives, TOP_K);
  const embedRecall = recallAtK(embedRanked, positives, TOP_K);
  const llmRecall = recallAtK(llmRanked, positives, llmRanked.length);

  const rescued = [];
  for (const kw of embedRecall.hit_keywords) {
    if (ruleRecall.missed_keywords.includes(kw)) {
      const c = embedRanked.slice(0, TOP_K).find((x) => (x.display_name || '').includes(kw));
      if (c) {
        rescued.push({
          keyword: kw,
          display_name: c.display_name,
          embed_score: c.embed_score,
          rank_rule: c.rank_rule,
          internal_score: c.internal_score,
        });
      }
    }
  }

  return {
    sample_id: subject.sample_id,
    subject_id: subject.subject_id,
    subject_display_name: subject.subject_display_name,
    candidate_count: subject.candidate_count,
    llm_pool_size: subject.llm_pool_size,
    positive_count: positives.length,
    backend: 'bge-m3-xenova',
    recall_rule_top_k: ruleRecall,
    recall_embed_top_k: embedRecall,
    recall_llm_pool: llmRecall,
    embedding_rescued: rescued,
    delta_embed_vs_rule: embedRecall.hit - ruleRecall.hit,
  };
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`缺少 ${INPUT}，请先运行 node server/scripts/runEmbeddingPoc.js export`);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  process.stderr.write(`加载模型 ${MODEL} …\n`);
  const extractor = await pipeline('feature-extraction', MODEL, { quantized: true });

  const results = [];
  for (const s of payload.subjects || []) {
    results.push(await analyzeSubject(extractor, s));
  }

  const report = {
    generated_at: new Date().toISOString(),
    input: INPUT,
    model: MODEL,
    top_k: TOP_K,
    backend: 'bge-m3-xenova',
    exported_at: payload.exported_at,
    subjects: results,
    aggregate: aggregate(results),
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMd(report), 'utf8');

  const agg = report.aggregate;
  console.log(`backend=bge-m3-xenova model=${MODEL}`);
  console.log(`规则 Top-${TOP_K}: ${agg.macro_rule_recall} (${pct(agg.macro_rule_rate)})`);
  console.log(`Embedding Top-${TOP_K}: ${agg.macro_embed_recall} (${pct(agg.macro_embed_rate)})`);
  console.log(`LLM池: ${agg.macro_llm_pool_recall} (${pct(agg.macro_llm_pool_rate)})`);
  console.log(`结论: ${agg.step4b_recommendation}`);
  console.log(`\n报告: ${OUT_JSON}\n      ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
