/**
 * Stage 2b §6.8：投前画像 pipeline（donor → 可选 LLM）
 * - 范围：近 N 年创建的投前项目（默认 3 年）
 * - 优先级：已有 BP/百科/listed → 跳过；否则 donor fan-out；仍缺则 --with-llm
 *
 * 用法（news 目录）：
 *   npm run backfill:pre-investment-profile-enrich
 *   npm run backfill:pre-investment-profile-enrich -- --dry-run
 *   npm run backfill:pre-investment-profile-enrich -- --with-llm --limit=20
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  findPreInvestmentProfileDonor,
  applyDonorToPreInvFanOut,
  loadPreInvestmentProjectsForEnrich,
  projectNeedsEnrich,
} = require('../utils/competitor-analysis/preInvestmentProfileDonor');
const {
  preparePreInvestmentProjectAiJobForBatch,
  runPreInvestmentProjectAiEnrichTask,
  PRE_INV_AI_VERSION,
} = require('../utils/competitor-analysis/preInvestmentProjectAiEnrichService');
const { withFinancingAiConcurrency } = require('../utils/project-sourcing/financingAiEnrichService');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage2b投前画像Pipeline报告.md');

function parseArgs() {
  const out = {
    dryRun: false,
    withLlm: false,
    years: 3,
    limit: Infinity,
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--with-llm') out.withLlm = true;
    else if (a.startsWith('--years=')) out.years = Math.max(1, parseInt(a.slice(8), 10) || 3);
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  if (!Number.isFinite(out.limit)) out.limit = Infinity;
  return out;
}

async function main() {
  const opts = parseArgs();
  console.log('[backfillPreInvestmentProfileEnrich] 开始', opts);

  const rows = await loadPreInvestmentProjectsForEnrich(db, opts.years);
  const work = rows.filter(projectNeedsEnrich).slice(0, opts.limit);
  console.log('[backfillPreInvestmentProfileEnrich] 候选', rows.length, '待 enrich', work.length);

  const stats = {
    total: work.length,
    skipped_has_profile: rows.length - work.length,
    donor_applied: 0,
    donor_rows: 0,
    llm_ok: 0,
    llm_fail: 0,
    no_donor: 0,
  };

  for (let i = 0; i < work.length; i += 1) {
    const row = work[i];
    const donor = await findPreInvestmentProfileDonor(
      db,
      row.unified_credit_code,
      row.enterprise_full_name
    );

    if (donor) {
      if (!opts.dryRun) {
        const n = await applyDonorToPreInvFanOut(db, row, donor);
        stats.donor_rows += n;
      }
      stats.donor_applied += 1;
      continue;
    }

    stats.no_donor += 1;
    if (!opts.withLlm || opts.dryRun) continue;

    const prep = await preparePreInvestmentProjectAiJobForBatch(row.F_Id);
    if (!prep.ok) {
      stats.llm_fail += 1;
      continue;
    }

    try {
      await withFinancingAiConcurrency(() =>
        runPreInvestmentProjectAiEnrichTask({
          preProjectId: prep.preProjectId,
          logId: prep.logId,
          triggerType: 'batch_profile_enrich',
          triggeredByUserId: null,
          clientIp: null,
        })
      );
      stats.llm_ok += 1;
    } catch (e) {
      stats.llm_fail += 1;
      console.warn('[backfillPreInvestmentProfileEnrich] LLM 失败', row.F_Id, e.message);
    }

    if ((i + 1) % 10 === 0) {
      console.log(`[backfillPreInvestmentProfileEnrich] 进度 ${i + 1}/${work.length}`);
    }
  }

  const report = `# Stage 2b 投前画像 Pipeline 报告

> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  
> 版本：\`${PRE_INV_AI_VERSION}\`  
> 近 **${opts.years}** 年投前项目 | dry-run：${opts.dryRun} | LLM：${opts.withLlm}

| 指标 | 值 |
|------|-----|
| 待 enrich 项目 | ${stats.total} |
| 已有画像跳过 | ${stats.skipped_has_profile} |
| donor 命中项目 | ${stats.donor_applied} |
| donor fan-out 行 | ${stats.donor_rows} |
| 无 donor | ${stats.no_donor} |
| LLM 成功 | ${stats.llm_ok} |
| LLM 失败 | ${stats.llm_fail} |

## 推荐执行顺序

1. \`npm run backfill:pre-investment-baike-lookup\`（或 \`--mode=browser\`）
2. \`npm run backfill:pre-investment-profile-enrich\`
3. 仍有缺口时：\`npm run backfill:pre-investment-profile-enrich -- --with-llm\`
`;

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');
  console.log('[backfillPreInvestmentProfileEnrich] 完成', stats);
  console.log('[backfillPreInvestmentProfileEnrich] 报告:', opts.outFile);
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillPreInvestmentProfileEnrich] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
