/**
 * Stage 2 §6.1：烯牛 industry_source_lv1/lv2 → industry_category_4
 * 跳过 profile_source=listed_sync（上市侧申万/category 已写入）
 *
 * 用法（news 目录）：
 *   npm run backfill:financing-category4-stage2
 *   npm run backfill:financing-category4-stage2 -- --dry-run
 *   npm run backfill:financing-category4-stage2 -- --years=6
 *   npm run backfill:financing-category4-stage2 -- --since=2020-09-10
 */

const db = require('../db');
const { buildFinancingEventSinceClause } = require('../utils/project-sourcing/financingEventWindow');

const CATEGORY4_VERSION = 'financing_category4_v1';

function parseArgs() {
  const out = { dryRun: false, sinceDate: null, years: null };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--all') {
      out.sinceDate = null;
      out.years = null;
    } else if (a.startsWith('--since=')) {
      out.sinceDate = a.slice(8).trim().slice(0, 10);
      out.years = null;
    } else if (a.startsWith('--years=')) {
      out.years = Math.max(1, parseInt(a.slice(8), 10) || 6);
      out.sinceDate = null;
    }
  }
  return out;
}

function eventDateClause(alias, since) {
  const col = alias ? `${alias}.event_date` : 'event_date';
  return since.clause.replace(/event_date/g, col);
}

async function main() {
  const opts = parseArgs();
  const since =
    opts.years != null || opts.sinceDate
      ? buildFinancingEventSinceClause({ years: opts.years, sinceDate: opts.sinceDate })
      : { clause: '1=1', params: [], label: '全量' };
  console.log('[backfillFinancingCategory4Stage2] dry-run:', opts.dryRun, '窗口:', since.label);

  const pending = await db.query(
    `
    SELECT COUNT(*) AS c
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
      AND COALESCE(profile_source, '') <> 'listed_sync'
      AND (industry_category_4 IS NULL OR TRIM(industry_category_4) = '')
      AND ${eventDateClause('', since)}
  `,
    since.params
  );
  const total = Number(pending[0]?.c || 0);
  console.log('[backfillFinancingCategory4Stage2] 待处理行数:', total);

  if (opts.dryRun || total === 0) {
    await db.closePool();
    process.exit(0);
    return;
  }

  const dateParams = since.params;
  const sDate = eventDateClause('s', since);
  const bareDate = eventDateClause('', since);

  const exactResult = await db.execute(
    `
    UPDATE sourcing_financing_event s
    INNER JOIN industry_source_l1_map m
      ON m.F_DeleteMark = 0
     AND m.source_lv1 = TRIM(COALESCE(s.industry_source_lv1, ''))
     AND m.source_lv2 = TRIM(COALESCE(s.industry_source_lv2, ''))
    SET
      s.industry_category_4 = m.category_4,
      s.classification_version = COALESCE(s.classification_version, ?),
      s.F_LastModifyTime = CURRENT_TIMESTAMP
    WHERE s.F_DeleteMark = 0
      AND COALESCE(s.profile_source, '') <> 'listed_sync'
      AND (s.industry_category_4 IS NULL OR TRIM(s.industry_category_4) = '')
      AND TRIM(COALESCE(s.industry_source_lv1, '')) <> ''
      AND ${sDate}
  `,
    [CATEGORY4_VERSION, ...dateParams]
  );

  const lv1Result = await db.execute(
    `
    UPDATE sourcing_financing_event s
    INNER JOIN industry_source_l1_map m
      ON m.F_DeleteMark = 0
     AND m.source_lv1 = TRIM(COALESCE(s.industry_source_lv1, ''))
     AND (m.source_lv2 IS NULL OR m.source_lv2 = '')
    SET
      s.industry_category_4 = m.category_4,
      s.classification_version = COALESCE(s.classification_version, ?),
      s.F_LastModifyTime = CURRENT_TIMESTAMP
    WHERE s.F_DeleteMark = 0
      AND COALESCE(s.profile_source, '') <> 'listed_sync'
      AND (s.industry_category_4 IS NULL OR TRIM(s.industry_category_4) = '')
      AND TRIM(COALESCE(s.industry_source_lv1, '')) <> ''
      AND ${sDate}
  `,
    [CATEGORY4_VERSION, ...dateParams]
  );

  const otherResult = await db.execute(
    `
    UPDATE sourcing_financing_event
    SET
      industry_category_4 = 'other',
      classification_version = COALESCE(classification_version, ?),
      F_LastModifyTime = CURRENT_TIMESTAMP
    WHERE F_DeleteMark = 0
      AND COALESCE(profile_source, '') <> 'listed_sync'
      AND (industry_category_4 IS NULL OR TRIM(industry_category_4) = '')
      AND ${bareDate}
  `,
    [CATEGORY4_VERSION, ...dateParams]
  );

  const updated =
    (exactResult.affectedRows || 0) +
    (lv1Result.affectedRows || 0) +
    (otherResult.affectedRows || 0);

  const dist = await db.query(`
    SELECT industry_category_4, COUNT(*) AS cnt
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0 AND TRIM(COALESCE(industry_category_4, '')) <> ''
    GROUP BY industry_category_4
    ORDER BY cnt DESC
  `);

  console.log('[backfillFinancingCategory4Stage2] 完成，累计影响行数约', updated);
  console.log('[backfillFinancingCategory4Stage2] 分布:', Object.fromEntries(dist.map((r) => [r.industry_category_4, r.cnt])));

  const aibozi = await db.query(
    `SELECT F_Id, company_name, event_date, industry_source_lv1, industry_source_lv2, industry_category_4
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND F_Id = 148089 LIMIT 1`
  );
  console.log('[backfillFinancingCategory4Stage2] 艾博兹:', aibozi[0] || null);
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillFinancingCategory4Stage2] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
