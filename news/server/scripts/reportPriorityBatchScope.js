/**
 * Stage 3：优先行业批摸底（三大类 × 自 2025-01-01 起）
 *
 * 用法（news 目录）：
 *   npm run report:priority-batch-scope
 *   npm run report:priority-batch-scope -- --since=2025-01-01
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  loadPriorityFinancingCompanies,
  countPriorityFinancingByCategory,
  loadPriorityPreInvestmentProjects,
  PRIORITY_CATEGORY_4,
  DEFAULT_EVENT_SINCE,
} = require('../utils/competitor-analysis/priorityBatchScope');
const { STRUCTURED_SCHEMA_VERSION } = require('../utils/competitor-analysis/structuredSchemaV1');
const {
  buildFinancingEventSinceClause,
  parseSinceArg,
} = require('../utils/project-sourcing/financingEventWindow');

const DEFAULT_OUT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage3优先行业批摸底报告.md');

function parseArgs() {
  const sinceParsed = parseSinceArg(process.argv.slice(2));
  const out = {
    sinceDate: sinceParsed.sinceDate,
    years: sinceParsed.years,
    outFile: DEFAULT_OUT,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

async function main() {
  const opts = parseArgs();
  const windowOpts = { sinceDate: opts.sinceDate, years: opts.years };
  const windowLabel = buildFinancingEventSinceClause(windowOpts).label;
  const byCat = await countPriorityFinancingByCategory(db, windowOpts);
  const totalFin = Object.values(byCat).reduce((a, b) => a + b, 0);

  const pendingFin = await loadPriorityFinancingCompanies(db, {
    ...windowOpts,
    skipStructured: true,
  });
  const allFin = await loadPriorityFinancingCompanies(db, {
    ...windowOpts,
    skipStructured: false,
  });
  const withIntro = allFin.filter((c) => c.has_intro).length;
  const doneStructured = allFin.filter((c) => c.has_structured).length;

  const pendingPre = await loadPriorityPreInvestmentProjects(db, {
    ...windowOpts,
    skipStructured: true,
  });
  const allPre = await loadPriorityPreInvestmentProjects(db, {
    ...windowOpts,
    skipStructured: false,
  });

  const pendingByCat = { ai: 0, bio: 0, semi_mfg: 0 };
  for (const c of pendingFin) {
    pendingByCat[c.industry_category_4] = (pendingByCat[c.industry_category_4] || 0) + 1;
  }

  const semiSub = { semi: 0, advanced_mfg: 0 };
  for (const c of pendingFin) {
    if (c.industry_category_4 === 'semi_mfg') {
      const st = c.sub_track === 'semi' ? 'semi' : 'advanced_mfg';
      semiSub[st] += 1;
    }
  }

  const report = `# Stage 3 优先行业批摸底报告

> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}  
> schema：\`${STRUCTURED_SCHEMA_VERSION}\`  
> 范围：**${windowLabel}** 融资事件 · **三大类** \`ai\` / \`bio\` / \`semi_mfg\`（半导体与先进制造合并）

## 1. 融资池（去重企业）

| category_4 | 企业数 | 待 structured | 有产品简介 | 已有 structured |
|------------|--------|---------------|------------|-----------------|
| ai | ${byCat.ai || 0} | ${pendingByCat.ai || 0} | — | — |
| bio | ${byCat.bio || 0} | ${pendingByCat.bio || 0} | — | — |
| semi_mfg | ${byCat.semi_mfg || 0} | ${pendingByCat.semi_mfg || 0} | — | — |
| **合计** | **${totalFin}** | **${pendingFin.length}** | **${withIntro}**（${pct(withIntro, allFin.length)}） | **${doneStructured}** |

### semi_mfg 子轨（待处理）

| sub_track | 企业数 |
|-----------|--------|
| semi | ${semiSub.semi} |
| advanced_mfg | ${semiSub.advanced_mfg} |

## 2. 投前项目（三大类内）

| 指标 | 值 |
|------|-----|
| 三大类内项目 | ${allPre.length} |
| 待 structured | ${pendingPre.length} |
| 有简介/BP 上下文 | ${allPre.filter((p) => p.has_intro).length} |

## 3. 推荐执行顺序

\`\`\`bash
cd news
npm run report:priority-batch-scope
npm run backfill:financing-structured -- --dry-run --limit=20
npm run backfill:financing-structured -- --category=ai,bio,semi_mfg --limit=100
npm run backfill:pre-investment-structured -- --limit=20
\`\`\`

## 4. 说明

- **三大类** = 优先赛道；\`other\` 不在 Stage 3 批处理范围。
- \`semi_mfg\` 映射层合并；L3 层用 \`sub_track\` 区分半导体 / 先进制造。
- 时间窗默认 \`${DEFAULT_EVENT_SINCE}\`；仅处理窗口内有事件的企业，画像/百科结果 **fan-out 反向填充** 至该企业全部历史行。
- structured 抽取需要 \`ai_product_intro\` / BP 等上下文 ≥ 40 字；无简介企业需先完成画像 enrich 或百科。
`;

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');
  console.log('[reportPriorityBatchScope] 融资三大类企业', totalFin, '待 structured', pendingFin.length);
  console.log('[reportPriorityBatchScope] 投前待 structured', pendingPre.length);
  console.log('[reportPriorityBatchScope] 报告:', opts.outFile);
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[reportPriorityBatchScope] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
