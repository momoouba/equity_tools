/**
 * T4：批量回填 sourcing_financing_event 规则层字段（金额解析 + 行业映射 + classification 版本）
 *
 * 用法（在 news 目录执行，需已配置 .env 数据库）：
 *   node server/scripts/backfillFinancingRuleEnrich.js
 *   node server/scripts/backfillFinancingRuleEnrich.js --dry-run
 *   node server/scripts/backfillFinancingRuleEnrich.js --force --batch=300
 *   node server/scripts/backfillFinancingRuleEnrich.js --limit=5000
 *
 * 默认仅处理：delete_mark=0 且 (classification_version IS NULL OR classification_version='ingest_v1')
 * --force：额外包含 classification_source 为空或 rule、且非 llm/hybrid 的记录（仍会跳过 classification_source 为 llm/hybrid）
 */

const db = require('../db');
const { parseFundingAmountFields } = require('../utils/项目挖掘/financingAmountParse');
const { mapIndustryToStd } = require('../utils/项目挖掘/financingIndustryMap');

const RULE_ENRICH_VERSION = 'rule_enrich_v1';

function parseArgs() {
  const out = { dryRun: false, force: false, batch: 200, limit: Infinity };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--batch=')) out.batch = Math.max(1, parseInt(a.slice(8), 10) || 200);
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
  }
  if (!Number.isFinite(out.limit)) out.limit = Infinity;
  return out;
}

function whereClause(force) {
  if (force) {
    return `delete_mark = 0
      AND COALESCE(classification_source, '') NOT IN ('llm', 'hybrid')`;
  }
  return `delete_mark = 0
      AND (classification_version IS NULL OR classification_version = 'ingest_v1')`;
}

async function countCandidates(force) {
  const w = whereClause(force);
  const rows = await db.query(`SELECT COUNT(*) AS c FROM sourcing_financing_event WHERE ${w}`);
  return Number(rows[0]?.c || 0);
}

async function main() {
  const opts = parseArgs();
  const w = whereClause(opts.force);

  console.log('[backfillFinancingRuleEnrich] mode:', opts.force ? 'force(rule/null)' : 'legacy(ingest_v1/null)');
  console.log('[backfillFinancingRuleEnrich] dry-run:', opts.dryRun, 'batch:', opts.batch, 'limit:', opts.limit);

  const total = await countCandidates(opts.force);
  console.log('[backfillFinancingRuleEnrich] 符合条件的行数:', total);
  if (opts.dryRun) {
    await db.closePool();
    process.exit(0);
    return;
  }

  let updated = 0;
  let lastId = 0;

  while (updated < opts.limit) {
    const take = Math.min(opts.batch, opts.limit - updated);
    const rows = await db.query(
      `SELECT id, funding_amt_raw, estimated_amt_raw, industry_source_lv1, industry_source_lv2
       FROM sourcing_financing_event
       WHERE ${w} AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [lastId, take]
    );
    if (!rows.length) break;

    for (const row of rows) {
      const amt = parseFundingAmountFields(row.funding_amt_raw, row.estimated_amt_raw);
      const ind = mapIndustryToStd(row.industry_source_lv1, row.industry_source_lv2);

      await db.execute(
        `UPDATE sourcing_financing_event SET
          amount = ?, amount_currency = ?, amount_cny = ?, amount_parse_status = ?, amount_parse_confidence = ?,
          industry_std_lv1 = ?, industry_std_lv2 = ?, industry_match_confidence = ?,
          classification_status = 'verified', classification_source = 'rule', classification_version = ?, classification_retry_count = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          amt.amount,
          amt.amount_currency,
          amt.amount_cny,
          amt.amount_parse_status,
          amt.amount_parse_confidence,
          ind.industry_std_lv1,
          ind.industry_std_lv2,
          ind.industry_match_confidence,
          RULE_ENRICH_VERSION,
          row.id,
        ]
      );
      updated += 1;
      if (updated >= opts.limit) break;
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < take) break;
    if (updated % (opts.batch * 5) === 0) {
      console.log('[backfillFinancingRuleEnrich] 已更新', updated);
    }
  }

  console.log('[backfillFinancingRuleEnrich] 完成，共更新', updated, '行');
  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillFinancingRuleEnrich] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
