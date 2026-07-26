/**
 * Stage 1b：ipo_new_share 全称 + 统一社会信用代码回填
 * 东财批量 → 企查查（可选）→ AI 全称（可选）
 *
 * 用法（news 目录）：
 *   npm run backfill:new-share-profile-stage1b
 *   npm run backfill:new-share-profile-stage1b -- --dry-run
 *   npm run backfill:new-share-profile-stage1b -- --with-ai
 *   npm run backfill:new-share-profile-stage1b -- --no-qichacha
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { isDomesticExchange } = require('../utils/listing/listedUniverseUtils');
const {
  needsProfile,
  runBulkNameUsccFetch,
  mergeEastmoneyFields,
  tryQichachaForRow,
  sleep,
} = require('../utils/listing/newShareProfileBackfill');
const { backfillNewShareEnterpriseFullNamesDomesticPool } = require('../utils/listing/newShareService');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage1b全称信用代码回填报告.md');
const POC_EITHER_RATE = 0.878;
const STAGE1B_TARGET_RATE = POC_EITHER_RATE * 0.9;

function parseArgs() {
  const out = {
    dryRun: false,
    force: false,
    withQichacha: true,
    withAi: false,
    qichachaLimit: Math.max(0, Number(process.env.STAGE1B_QICHACHA_LIMIT || 300)),
    aiLimit: Math.max(1, Number(process.env.STAGE1B_AI_NAME_LIMIT || 500)),
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--with-ai') out.withAi = true;
    else if (a === '--no-qichacha') out.withQichacha = false;
    else if (a.startsWith('--qichacha-limit=')) {
      out.qichachaLimit = Math.max(0, parseInt(a.slice(17), 10) || 0);
    }
    else if (a.startsWith('--ai-limit=')) out.aiLimit = Math.max(1, parseInt(a.slice(11), 10) || 500);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

async function loadDomesticRows() {
  return db.query(`
    SELECT F_Id, stock_code, stock_name, exchange,
           enterprise_full_name_cn, enterprise_full_name_display, unified_credit_code, profile_source
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
    ORDER BY F_Id ASC
  `);
}

async function applyProfileUpdate(rowId, merged, dryRun) {
  if (!merged.changed) return false;
  if (dryRun) return true;
  await db.execute(
    `UPDATE ipo_new_share
     SET enterprise_full_name_cn = ?, enterprise_full_name_display = ?, unified_credit_code = ?,
         profile_source = CASE
           WHEN ? <> '' THEN COALESCE(NULLIF(TRIM(profile_source), ''), ?)
           ELSE profile_source
         END,
         F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [
      merged.enterprise_full_name_cn || null,
      merged.enterprise_full_name_display || null,
      merged.unified_credit_code || null,
      merged.profile_source || '',
      merged.profile_source || null,
      rowId,
    ]
  );
  return true;
}

async function queryPostStats() {
  const base = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(enterprise_full_name_cn, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_display, '')) <> '' THEN 1 ELSE 0 END) AS any_name,
      SUM(CASE WHEN TRIM(COALESCE(unified_credit_code, '')) <> '' THEN 1 ELSE 0 END) AS uscc,
      SUM(CASE WHEN TRIM(COALESCE(unified_credit_code, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_cn, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_display, '')) <> '' THEN 1 ELSE 0 END) AS either
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
  `);
  const byExchange = await db.query(`
    SELECT exchange,
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(unified_credit_code, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_cn, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_display, '')) <> '' THEN 1 ELSE 0 END) AS either
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
    GROUP BY exchange
    ORDER BY total DESC
  `);
  const b = base[0] || {};
  return {
    total: Number(b.total || 0),
    anyName: Number(b.any_name || 0),
    uscc: Number(b.uscc || 0),
    either: Number(b.either || 0),
    byExchange,
  };
}

function writeReport(opts, counters, postStats, aiResult) {
  const lines = [];
  lines.push('# Stage 1b 全称 + 信用代码回填报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`模式：${opts.dryRun ? '**dry-run**' : '**写入**'}`);
  lines.push('');
  lines.push('## 1. 回填摘要');
  lines.push('');
  lines.push(`- 东财批量更新：**${counters.eastmoney.updated}**（跳过 ${counters.eastmoney.skipped}）`);
  lines.push(`- 企查查更新：**${counters.qichacha.updated}**（尝试 ${counters.qichacha.tried}，跳过 ${counters.qichacha.skipped}）`);
  if (opts.withAi) {
    lines.push(
      `- AI 全称更新：**${aiResult?.updated || 0}**（候选 ${aiResult?.total || 0}，失败 ${aiResult?.failed || 0}）`
    );
  } else {
    lines.push('- AI 全称：**未执行**（加 `--with-ai` 启用第三源）');
  }
  lines.push('');
  lines.push('## 2. 库内沪深北（回填后）');
  lines.push('');
  lines.push(`- 记录总数：**${postStats.total.toLocaleString()}**`);
  lines.push(`- 全称任一：**${postStats.anyName.toLocaleString()}**（${pct(postStats.anyName, postStats.total)}）`);
  lines.push(`- 信用代码：**${postStats.uscc.toLocaleString()}**（${pct(postStats.uscc, postStats.total)}）`);
  lines.push(`- **全称或信用代码至少一项：**${postStats.either.toLocaleString()}**（**${pct(postStats.either, postStats.total)}**）`);
  lines.push('');
  lines.push('### 2.1 分交易所（至少一项）');
  lines.push('');
  lines.push('| 交易所 | 总数 | 至少一项 | 填充率 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of postStats.byExchange) {
    const t = Number(r.total || 0);
    const e = Number(r.either || 0);
    lines.push(`| ${r.exchange || '—'} | ${t.toLocaleString()} | ${e.toLocaleString()} | ${pct(e, t)} |`);
  }
  lines.push('');
  lines.push('## 3. 验收（§5.4 Stage 1b）');
  lines.push('');
  const targetPct = (STAGE1B_TARGET_RATE * 100).toFixed(2);
  const pass = postStats.total > 0 && postStats.either / postStats.total >= STAGE1B_TARGET_RATE;
  lines.push(`- 目标：≥ 东财 500 条 PoC 至少一项率 × 0.9 ≈ **${targetPct}%**`);
  lines.push(`- 当前：**${pass ? '达标' : '未达标'}**（${pct(postStats.either, postStats.total)}）`);
  lines.push(`- Stage 1b+企查查后 stretch 目标：**≥ 85%**`);
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  return opts.outFile;
}

async function main() {
  const opts = parseArgs();
  await db.query('SELECT 1');

  const rows = await loadDomesticRows();
  const counters = {
    eastmoney: { updated: 0, skipped: 0 },
    qichacha: { tried: 0, updated: 0, skipped: 0 },
  };

  console.log('[backfillNewShareProfileStage1b] 东财批量拉取 ORG_NAME / REG_NUM…');
  const { payload, map: bulkMap } = runBulkNameUsccFetch();
  console.log(
    '[backfillNewShareProfileStage1b] 东财源',
    payload.stats?.bulk_total,
    '有名称',
    payload.stats?.with_name,
    '有信用代码',
    payload.stats?.with_uscc
  );

  const liveRows = rows.map((r) => ({ ...r }));
  for (const row of liveRows) {
    if (!isDomesticExchange(row.exchange)) continue;
    if (!opts.force && !needsProfile(row)) {
      counters.eastmoney.skipped += 1;
      continue;
    }
    const source = bulkMap.get(String(row.stock_code || '').trim());
    if (!source) {
      counters.eastmoney.skipped += 1;
      continue;
    }
    const merged = mergeEastmoneyFields(row, source, opts.force);
    if (!merged.changed) {
      counters.eastmoney.skipped += 1;
      continue;
    }
    const ok = await applyProfileUpdate(row.F_Id, merged, opts.dryRun);
    if (ok) {
      counters.eastmoney.updated += 1;
      row.enterprise_full_name_cn = merged.enterprise_full_name_cn;
      row.enterprise_full_name_display = merged.enterprise_full_name_display;
      row.unified_credit_code = merged.unified_credit_code;
      row.profile_source = merged.profile_source || row.profile_source;
    }
  }

  if (opts.withQichacha && opts.qichachaLimit > 0) {
    console.log('[backfillNewShareProfileStage1b] 企查查第二源…');
    const qccDelayMs = Math.max(0, Number(process.env.STAGE1B_QICHACHA_DELAY_MS || 350));
    let qccUsed = 0;
    for (const row of liveRows) {
      if (qccUsed >= opts.qichachaLimit) break;
      if (!needsProfile(row)) continue;
      counters.qichacha.tried += 1;
      qccUsed += 1;
      const merged = await tryQichachaForRow(row, { force: opts.force });
      if (!merged || !merged.changed) {
        counters.qichacha.skipped += 1;
        if (qccDelayMs > 0) await sleep(qccDelayMs);
        continue;
      }
      const ok = await applyProfileUpdate(row.F_Id, merged, opts.dryRun);
      if (ok) {
        counters.qichacha.updated += 1;
        row.enterprise_full_name_cn = merged.enterprise_full_name_cn;
        row.enterprise_full_name_display = merged.enterprise_full_name_display;
        row.unified_credit_code = merged.unified_credit_code;
        row.profile_source = merged.profile_source || row.profile_source;
      } else {
        counters.qichacha.skipped += 1;
      }
      if (qccDelayMs > 0) await sleep(qccDelayMs);
    }
  }

  let aiResult = null;
  if (opts.withAi && !opts.dryRun) {
    console.log('[backfillNewShareProfileStage1b] AI 全称第三源…');
    aiResult = await backfillNewShareEnterpriseFullNamesDomesticPool({
      logTag: '[Stage1b-AI全称]',
      limit: opts.aiLimit,
    });
  }

  const postStats = await queryPostStats();
  const reportPath = writeReport(opts, counters, postStats, aiResult);

  console.log('[backfillNewShareProfileStage1b] 完成', counters);
  console.log(
    '[backfillNewShareProfileStage1b] 至少一项',
    pct(postStats.either, postStats.total),
    `(${postStats.either}/${postStats.total})`
  );
  console.log('[backfillNewShareProfileStage1b] 报告:', reportPath);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillNewShareProfileStage1b] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
