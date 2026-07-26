#!/usr/bin/env node
'use strict';

/**
 * Stage 4 POC：对比 ipo_project vs ipo_new_share 召回规模与行业字段填充率
 *
 * 用法（news 目录）：
 *   npm run poc:stage4-recall-compare
 *   npm run poc:stage4-recall-compare -- --limit=500
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  recallFromIpoProjects,
  recallFromListedNewShare,
  mergeRecalledCandidates,
  recallRichness,
} = require('../utils/competitor-analysis/competitorMatchRecall');
const { candidateDedupeKey, strTrim } = require('../utils/competitor-analysis/competitorMatchUtils');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage4召回对比POC报告.md');

function parseArgs() {
  const out = { limit: 8000, outFile: DEFAULT_REPORT };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--limit=')) out.limit = Math.max(100, parseInt(a.slice(8), 10) || 8000);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0%';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function summarize(list, label) {
  const withIntro = list.filter((c) => strTrim(c.product_intro).length >= 40).length;
  const withL1 = list.filter((c) => strTrim(c.industry_l1)).length;
  const withL2 = list.filter((c) => strTrim(c.industry_l2)).length;
  const withCredit = list.filter((c) => strTrim(c.unified_credit_code)).length;
  const domestic = list.filter((c) => c.domestic_listed === true).length;
  return {
    label,
    count: list.length,
    with_intro_40: withIntro,
    with_industry_l1: withL1,
    with_industry_l2: withL2,
    with_credit: withCredit,
    domestic_listed: domestic,
    avg_richness: list.length
      ? Math.round(list.reduce((s, c) => s + recallRichness(c), 0) / list.length)
      : 0,
  };
}

async function main() {
  const opts = parseArgs();
  console.log('[pocStage4RecallCompare] 开始', opts);

  // require('../db') 侧加载即初始化连接；首次 query 触发表迁移依赖服务已启动或本进程触达 init
  const ipoList = await recallFromIpoProjects(null, null);
  const nsList = await recallFromListedNewShare(null, null, { limit: opts.limit });
  const merged = mergeRecalledCandidates(ipoList, nsList);

  const ipoKeys = new Set(ipoList.map((c) => candidateDedupeKey(c)));
  const nsKeys = new Set(nsList.map((c) => candidateDedupeKey(c)));
  let overlap = 0;
  for (const k of ipoKeys) {
    if (nsKeys.has(k)) overlap += 1;
  }

  const sIpo = summarize(ipoList, 'ipo_project（1.0）');
  const sNs = summarize(nsList, 'ipo_new_share（Stage4）');
  const sMerged = summarize(merged, '双源合并');

  const lines = [];
  lines.push('# Stage 4 召回对比 POC 报告');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`> 范围：ipo_project 竞品池 vs ipo_new_share（limit=${opts.limit}）`);
  lines.push('');
  lines.push('## 1. 规模对比');
  lines.push('');
  lines.push('| 来源 | 候选数 | 简介≥40字 | 有 industry_l1 | 有 industry_l2 | 有信用代码 | 境内上市标记 | 平均 richness |');
  lines.push('|------|--------|-----------|----------------|----------------|------------|--------------|---------------|');
  for (const s of [sIpo, sNs, sMerged]) {
    lines.push(
      `| ${s.label} | ${s.count} | ${s.with_intro_40}（${pct(s.with_intro_40, s.count)}） | ${s.with_industry_l1}（${pct(s.with_industry_l1, s.count)}） | ${s.with_industry_l2}（${pct(s.with_industry_l2, s.count)}） | ${s.with_credit}（${pct(s.with_credit, s.count)}） | ${s.domestic_listed} | ${s.avg_richness} |`
    );
  }
  lines.push('');
  lines.push('## 2. 重叠与增量');
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 重叠企业（去重键） | ${overlap} |`);
  lines.push(`| 仅 ipo_project | ${ipoKeys.size - overlap} |`);
  lines.push(`| 仅 ipo_new_share | ${nsKeys.size - overlap} |`);
  lines.push(
    `| 合并后相对 1.0 增量 | ${merged.length - ipoList.length}（${pct(merged.length - ipoList.length, Math.max(1, ipoList.length))}） |`
  );
  lines.push('');
  lines.push('## 3. 结论（自动）');
  lines.push('');
  if (nsList.length > ipoList.length * 1.5) {
    lines.push('- **上市召回候选数较 1.0 显著提升**（达标方向正确）。');
  } else if (nsList.length > ipoList.length) {
    lines.push('- new_share 候选数高于 ipo_project，但提升幅度有限，建议检查简介/标签填充。');
  } else {
    lines.push('- ⚠️ new_share 候选数未超过 ipo_project，需检查 Stage 1d 画像填充或召回 WHERE 条件。');
  }
  if (sNs.with_industry_l1 / Math.max(1, sNs.count) >= 0.8) {
    lines.push('- new_share **industry_l1 填充率 ≥ 80%**，相对 1.0（常为空）是核心改进。');
  } else {
    lines.push('- ⚠️ new_share industry_l1 填充率偏低，建议复核 Stage 1a 申万回填。');
  }
  lines.push('');
  lines.push('## 4. 下一步');
  lines.push('');
  lines.push('1. 管理员打开 `enable_recall_ab_compare=1`，线上跑投前样例看 S1 `ab_compare` 日志。');
  lines.push('2. 灰度：`use_new_share_listed_recall=1` + 可选 `new_share_gray_categories=ai`。');
  lines.push('3. 确认无异常后全量开主开关；回滚只需关开关（无需回滚画像）。');
  lines.push('');

  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  console.log('[pocStage4RecallCompare] 完成', {
    ipo: sIpo.count,
    new_share: sNs.count,
    merged: sMerged.count,
    overlap,
    out: opts.outFile,
  });
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[pocStage4RecallCompare] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});