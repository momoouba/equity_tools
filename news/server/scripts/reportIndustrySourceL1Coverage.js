/**
 * Stage 0：融资事件行业映射覆盖率 + 信用代码填充率基线
 *
 * 用法（在 news 目录）：
 *   node server/scripts/reportIndustrySourceL1Coverage.js
 *   node server/scripts/reportIndustrySourceL1Coverage.js --out=../需求文档/竞品分析/库内行业映射覆盖率报告.md
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  loadIndustryMapFromDb,
  mapSourceIndustryToCategory4,
} = require('../utils/project-sourcing/industryCategory4Map');

const DEFAULT_OUT = path.resolve(__dirname, '../../../需求文档/竞品分析/库内行业映射覆盖率报告.md');

function parseArgs() {
  const out = { outFile: DEFAULT_OUT };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(num, den) {
  if (!den) return '0.00%';
  return `${((num / den) * 100).toFixed(2)}%`;
}

function mdTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) {
    lines.push(`| ${r.join(' | ')} |`);
  }
  return lines.join('\n');
}

async function creditCodeBaseline() {
  const [eventRows] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) AS total_events,
        SUM(CASE WHEN TRIM(COALESCE(company_credit_code, '')) <> '' THEN 1 ELSE 0 END) AS with_code_events,
        COUNT(DISTINCT CASE WHEN TRIM(COALESCE(company_credit_code, '')) <> '' THEN company_credit_code END) AS distinct_codes
      FROM sourcing_financing_event
      WHERE F_DeleteMark = 0
    `),
  ]);

  const companyRows = await db.query(`
    SELECT
      COUNT(DISTINCT CONCAT(COALESCE(company_name, ''), '\0', COALESCE(company_credit_code, ''))) AS distinct_company_keys,
      COUNT(DISTINCT CASE WHEN TRIM(COALESCE(company_credit_code, '')) <> '' THEN company_credit_code END) AS companies_with_code
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
  `);

  const e = eventRows[0] || {};
  const c = companyRows[0] || {};
  return {
    total_events: Number(e.total_events || 0),
    with_code_events: Number(e.with_code_events || 0),
    distinct_codes: Number(e.distinct_codes || 0),
    distinct_company_keys: Number(c.distinct_company_keys || 0),
    companies_with_code: Number(c.companies_with_code || 0),
  };
}

async function industryCoverage(mapRows) {
  const pairRows = await db.query(`
    SELECT
      TRIM(COALESCE(industry_source_lv1, '')) AS lv1,
      TRIM(COALESCE(industry_source_lv2, '')) AS lv2,
      COUNT(*) AS event_cnt
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
    GROUP BY TRIM(COALESCE(industry_source_lv1, '')), TRIM(COALESCE(industry_source_lv2, ''))
    ORDER BY event_cnt DESC
  `);

  let totalEvents = 0;
  let mappedEvents = 0;
  let emptyLv1Events = 0;
  const byCategory = { ai: 0, bio: 0, semi_mfg: 0, other: 0 };
  const unmappedPairs = [];

  for (const row of pairRows) {
    const cnt = Number(row.event_cnt || 0);
    totalEvents += cnt;
    if (!row.lv1) {
      emptyLv1Events += cnt;
      byCategory.other += cnt;
      continue;
    }

    const mapped = mapSourceIndustryToCategory4(row.lv1, row.lv2, mapRows);
    if (mapped.category_4 !== 'other') mappedEvents += cnt;
    else unmappedPairs.push({ lv1: row.lv1, lv2: row.lv2, event_cnt: cnt });
    byCategory[mapped.category_4] = (byCategory[mapped.category_4] || 0) + cnt;
  }

  const lv1Rows = await db.query(`
    SELECT TRIM(COALESCE(industry_source_lv1, '')) AS lv1, COUNT(*) AS event_cnt
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0 AND TRIM(COALESCE(industry_source_lv1, '')) <> ''
    GROUP BY TRIM(COALESCE(industry_source_lv1, ''))
    ORDER BY event_cnt DESC
  `);

  const unmappedLv1 = [];
  for (const row of lv1Rows) {
    const mapped = mapSourceIndustryToCategory4(row.lv1, '', mapRows);
    if (mapped.category_4 === 'other') {
      unmappedLv1.push({ lv1: row.lv1, event_cnt: Number(row.event_cnt || 0) });
    }
  }

  unmappedPairs.sort((a, b) => b.event_cnt - a.event_cnt);
  unmappedLv1.sort((a, b) => b.event_cnt - a.event_cnt);

  return {
    totalEvents,
    mappedEvents,
    emptyLv1Events,
    byCategory,
    unmappedLv1,
    unmappedPairs: unmappedPairs.slice(0, 30),
    distinctLv1InDb: lv1Rows.length,
  };
}

async function mapTableStats() {
  const rows = await db.query(`
    SELECT category_4, category_display, COUNT(*) AS map_rows
    FROM industry_source_l1_map
    WHERE F_DeleteMark = 0
    GROUP BY category_4, category_display
    ORDER BY category_4
  `);
  return rows;
}

function buildReport({ generatedAt, credit, coverage, mapStats }) {
  const lines = [];
  lines.push('# 库内行业映射覆盖率报告（Stage 0）');
  lines.push('');
  lines.push(`生成时间：${generatedAt}`);
  lines.push('');
  lines.push('## 1. 配置表 `industry_source_l1_map`');
  lines.push('');
  lines.push(mdTable(
    ['category_4', 'category_display', '映射行数'],
    mapStats.map((r) => [r.category_4, r.category_display || '—', String(r.map_rows)])
  ));
  lines.push('');
  lines.push('## 2. 融资事件行业映射覆盖率');
  lines.push('');
  lines.push(`- 事件总数：**${coverage.totalEvents.toLocaleString()}**`);
  lines.push(`- L1 为空事件：**${coverage.emptyLv1Events.toLocaleString()}**（${pct(coverage.emptyLv1Events, coverage.totalEvents)}）`);
  lines.push(`- 命中优先赛道（非 other）：**${coverage.mappedEvents.toLocaleString()}**（${pct(coverage.mappedEvents, coverage.totalEvents)}）`);
  lines.push(`- 库内去重 L1 数：**${coverage.distinctLv1InDb}**`);
  lines.push('');
  lines.push('### 2.1 按 category_4 事件分布');
  lines.push('');
  lines.push(mdTable(
    ['category_4', '事件数', '占比'],
    Object.entries(coverage.byCategory).map(([k, n]) => [k, n.toLocaleString(), pct(n, coverage.totalEvents)])
  ));
  lines.push('');
  lines.push('### 2.2 未映射 L1（归入 other，按事件数 Top）');
  lines.push('');
  if (!coverage.unmappedLv1.length) {
    lines.push('（无）');
  } else {
    lines.push(mdTable(
      ['industry_source_lv1', '事件数'],
      coverage.unmappedLv1.slice(0, 20).map((r) => [r.lv1, r.event_cnt.toLocaleString()])
    ));
  }
  lines.push('');
  lines.push('### 2.3 未映射 L1+L2 组合 Top 30');
  lines.push('');
  if (!coverage.unmappedPairs.length) {
    lines.push('（无）');
  } else {
    lines.push(mdTable(
      ['lv1', 'lv2', '事件数'],
      coverage.unmappedPairs.map((r) => [r.lv1, r.lv2 || '—', r.event_cnt.toLocaleString()])
    ));
  }
  lines.push('');
  lines.push('## 3. 信用代码填充率（Stage 0-3 基线）');
  lines.push('');
  lines.push(`- 事件级非空：**${credit.with_code_events.toLocaleString()} / ${credit.total_events.toLocaleString()}**（${pct(credit.with_code_events, credit.total_events)}）`);
  lines.push(`- 去重信用代码数：**${credit.distinct_codes.toLocaleString()}**`);
  lines.push(`- 企业级（去重 code 有值）：**${credit.companies_with_code.toLocaleString()}**`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  const mapRows = await loadIndustryMapFromDb(db, { force: true });
  if (!mapRows.length) {
    throw new Error('industry_source_l1_map 为空，请先运行 importIndustrySourceL1Map.js');
  }

  const [mapStats, credit, coverage] = await Promise.all([
    mapTableStats(),
    creditCodeBaseline(),
    industryCoverage(mapRows),
  ]);

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const report = buildReport({ generatedAt, credit, coverage, mapStats });

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, report, 'utf8');

  console.log('[reportIndustrySourceL1Coverage] 报告已写入:', opts.outFile);
  console.log('[reportIndustrySourceL1Coverage] 映射表行数:', mapRows.length);
  console.log('[reportIndustrySourceL1Coverage] 事件命中优先赛道:', pct(coverage.mappedEvents, coverage.totalEvents));
  console.log('[reportIndustrySourceL1Coverage] 信用代码事件级:', pct(credit.with_code_events, credit.total_events));

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[reportIndustrySourceL1Coverage] 失败:', e.message);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
