/**
 * Stage 1d：ipo_new_share 企业介绍 / 产品简介 / 标签回填
 * 东财批量 → 企查查（可选）→ 百科 HTTP（可选，限量）
 *
 * 用法（news 目录）：
 *   npm run backfill:new-share-profile-stage1d
 *   npm run backfill:new-share-profile-stage1d -- --dry-run
 *   npm run backfill:new-share-profile-stage1d -- --with-qichacha --with-baike
 *   npm run backfill:new-share-profile-stage1d -- --priority-only
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { isDomesticExchange } = require('../utils/listing/listedUniverseUtils');
const {
  MIN_INTRO_LEN,
  isValidIntro,
  needsIntro,
  needsCompanyIntro,
  runBulkIntroFetch,
  mergeEastmoneyIntro,
  mergeBaikeIntro,
  tryQichachaIntro,
  applySwTags,
  fetchBaikeSync,
  sleep,
} = require('../utils/listing/newShareIntroBackfill');

const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage1d产品简介回填报告.md');
const PRIORITY_CATS = new Set(['ai', 'bio', 'semi_mfg']);
const STAGE1D_TARGET_RATE = 0.8;

function parseArgs() {
  const out = {
    dryRun: false,
    force: false,
    priorityOnly: false,
    withQichacha: false,
    withBaike: false,
    qichachaLimit: Math.max(0, Number(process.env.STAGE1D_QICHACHA_LIMIT || 200)),
    baikeLimit: Math.max(0, Number(process.env.STAGE1D_BAIKE_LIMIT || 0)),
    baikeSleepMs: Math.max(500, Number(process.env.STAGE1D_BAIKE_SLEEP_MS || 1200)),
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--priority-only') out.priorityOnly = true;
    else if (a === '--with-qichacha') out.withQichacha = true;
    else if (a === '--with-baike') out.withBaike = true;
    else if (a.startsWith('--qichacha-limit=')) {
      out.qichachaLimit = Math.max(0, parseInt(a.slice(17), 10) || 0);
    } else if (a.startsWith('--baike-limit=')) {
      out.baikeLimit = Math.max(0, parseInt(a.slice(14), 10) || 0);
    } else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

async function loadDomesticRows(priorityOnly) {
  const where = priorityOnly
    ? `AND industry_category_4 IN ('ai', 'bio', 'semi_mfg')`
    : '';
  return db.query(`
    SELECT F_Id, stock_code, stock_name, exchange,
           enterprise_full_name_cn, enterprise_full_name_display,
           sw_industry_l1, sw_industry_l2, industry_category_4,
           company_intro, product_intro, industry_tags_display, industry_tags_json,
           profile_source, baike_lemma_url, baike_lemma_status, baike_miss_reason
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
    ${where}
    ORDER BY F_Id ASC
  `);
}

async function applyIntroUpdate(rowId, merged, dryRun) {
  if (!merged.changed) return false;
  if (dryRun) return true;
  await db.execute(
    `UPDATE ipo_new_share
     SET company_intro = ?, product_intro = ?,
         industry_tags_display = ?, industry_tags_json = ?,
         baike_lemma_url = ?, baike_lemma_status = ?, baike_miss_reason = ?,
         profile_source = CASE
           WHEN ? <> '' THEN COALESCE(NULLIF(TRIM(profile_source), ''), ?)
           ELSE profile_source
         END,
         F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [
      merged.company_intro || null,
      merged.product_intro || null,
      merged.industry_tags_display || null,
      merged.industry_tags_json || null,
      merged.baike_lemma_url || null,
      merged.baike_lemma_status || null,
      merged.baike_miss_reason || null,
      merged.profile_source || '',
      merged.profile_source || null,
      rowId,
    ]
  );
  return true;
}

async function queryPostStats(priorityOnly) {
  const where = priorityOnly
    ? `AND industry_category_4 IN ('ai', 'bio', 'semi_mfg')`
    : '';
  const base = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN CHAR_LENGTH(TRIM(COALESCE(company_intro, ''))) >= ${MIN_INTRO_LEN} THEN 1 ELSE 0 END) AS company_intro,
      SUM(CASE WHEN CHAR_LENGTH(TRIM(COALESCE(product_intro, ''))) >= ${MIN_INTRO_LEN} THEN 1 ELSE 0 END) AS product_intro,
      SUM(CASE WHEN TRIM(COALESCE(industry_tags_display, '')) <> '' THEN 1 ELSE 0 END) AS tags
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
    ${where}
  `);
  const byCat = await db.query(`
    SELECT industry_category_4,
      COUNT(*) AS total,
      SUM(CASE WHEN CHAR_LENGTH(TRIM(COALESCE(product_intro, ''))) >= ${MIN_INTRO_LEN} THEN 1 ELSE 0 END) AS product_intro
    FROM ipo_new_share
    WHERE exchange IN ('上交所', '深交所', '北交所')
    ${where}
    GROUP BY industry_category_4
    ORDER BY total DESC
  `);
  const b = base[0] || {};
  return {
    total: Number(b.total || 0),
    companyIntro: Number(b.company_intro || 0),
    productIntro: Number(b.product_intro || 0),
    tags: Number(b.tags || 0),
    byCat,
  };
}

function writeReport(opts, counters, postStats) {
  const scope = opts.priorityOnly ? '优先赛道（ai/bio/semi_mfg）' : '沪深北全量';
  const lines = [];
  lines.push('# Stage 1d 企业介绍 / 产品简介回填报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`范围：**${scope}**`);
  lines.push(`模式：${opts.dryRun ? '**dry-run**' : '**写入**'}`);
  lines.push('');
  lines.push('## 1. 回填摘要');
  lines.push('');
  lines.push(`- 东财批量更新：**${counters.eastmoney.updated}**（跳过 ${counters.eastmoney.skipped}）`);
  lines.push(`- 企查查更新：**${counters.qichacha.updated}**（尝试 ${counters.qichacha.tried}）`);
  lines.push(`- 百科更新：**${counters.baike.updated}**（尝试 ${counters.baike.tried}）`);
  lines.push(`- 申万标签落库：**${counters.tags.updated}**`);
  lines.push('');
  lines.push('## 2. 库内（回填后）');
  lines.push('');
  lines.push(`- 记录总数：**${postStats.total.toLocaleString()}**`);
  lines.push(`- 有效企业介绍（≥${MIN_INTRO_LEN}字）：**${postStats.companyIntro.toLocaleString()}**（${pct(postStats.companyIntro, postStats.total)}）`);
  lines.push(`- 有效 product_intro（≥${MIN_INTRO_LEN}字）：**${postStats.productIntro.toLocaleString()}**（**${pct(postStats.productIntro, postStats.total)}**）`);
  lines.push(`- 行业标签非空：**${postStats.tags.toLocaleString()}**（${pct(postStats.tags, postStats.total)}）`);
  lines.push('');
  lines.push('### 2.1 分 category_4（product_intro）');
  lines.push('');
  lines.push('| category_4 | 总数 | 有效 product_intro | 填充率 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of postStats.byCat) {
    const t = Number(r.total || 0);
    const p = Number(r.product_intro || 0);
    lines.push(`| ${r.industry_category_4 || '—'} | ${t.toLocaleString()} | ${p.toLocaleString()} | ${pct(p, t)} |`);
  }
  lines.push('');
  lines.push('## 3. 验收（§5.4 Stage 1d）');
  lines.push('');
  const pass = postStats.total > 0 && postStats.productIntro / postStats.total >= STAGE1D_TARGET_RATE;
  lines.push(`- 有效 product_intro ≥ 80%：**${pass ? '达标' : '未达标'}**（当前 ${pct(postStats.productIntro, postStats.total)}）`);
  if (opts.priorityOnly) {
    lines.push('- 注：本次为优先赛道子集；全量请去掉 `--priority-only` 再跑。');
  }
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  return opts.outFile;
}

async function main() {
  const opts = parseArgs();
  await db.query('SELECT 1');

  const rows = await loadDomesticRows(opts.priorityOnly);
  const counters = {
    eastmoney: { updated: 0, skipped: 0 },
    qichacha: { tried: 0, updated: 0 },
    baike: { tried: 0, updated: 0 },
    tags: { updated: 0 },
  };

  console.log('[backfillNewShareProfileStage1d] 东财批量拉取 ORG_PROFILE / 主营业务…');
  const { payload, map: bulkMap } = runBulkIntroFetch();
  console.log(
    '[backfillNewShareProfileStage1d] 东财源',
    payload.stats?.bulk_total,
    '企业介绍',
    payload.stats?.with_company_intro,
    '产品简介',
    payload.stats?.with_product_intro
  );

  const liveRows = rows.map((r) => ({ ...r }));

  for (const row of liveRows) {
    if (!isDomesticExchange(row.exchange)) continue;

    let merged = {
      company_intro: row.company_intro,
      product_intro: row.product_intro,
      profile_source: row.profile_source,
      industry_tags_display: row.industry_tags_display,
      industry_tags_json: row.industry_tags_json,
      baike_lemma_url: row.baike_lemma_url,
      baike_lemma_status: row.baike_lemma_status,
      baike_miss_reason: row.baike_miss_reason,
      changed: false,
    };

    const source = bulkMap.get(String(row.stock_code || '').trim());
    if (source) {
      const em = mergeEastmoneyIntro(row, source, opts.force);
      merged = { ...merged, ...em };
    } else if (!opts.force && !needsIntro(row) && !needsCompanyIntro(row)) {
      counters.eastmoney.skipped += 1;
    }

    merged = applySwTags(row, merged);

    if (merged.changed) {
      const ok = await applyIntroUpdate(row.F_Id, merged, opts.dryRun);
      if (ok) {
        if (merged.filled_product || merged.filled_company) counters.eastmoney.updated += 1;
        else if (merged.industry_tags_display && merged.industry_tags_display !== row.industry_tags_display) {
          counters.tags.updated += 1;
        }
        row.company_intro = merged.company_intro;
        row.product_intro = merged.product_intro;
        row.industry_tags_display = merged.industry_tags_display;
        row.industry_tags_json = merged.industry_tags_json;
        row.profile_source = merged.profile_source || row.profile_source;
      }
    }
  }

  if (opts.withQichacha && opts.qichachaLimit > 0) {
    console.log('[backfillNewShareProfileStage1d] 企查查第二源…');
    const qccDelay = Math.max(0, Number(process.env.STAGE1D_QICHACHA_DELAY_MS || 350));
    let used = 0;
    for (const row of liveRows) {
      if (used >= opts.qichachaLimit) break;
      if (!needsIntro(row)) continue;
      counters.qichacha.tried += 1;
      used += 1;
      let merged = await tryQichachaIntro(row, { force: opts.force });
      if (!merged || !merged.changed) {
        if (qccDelay > 0) await sleep(qccDelay);
        continue;
      }
      merged = applySwTags(row, merged);
      const ok = await applyIntroUpdate(row.F_Id, merged, opts.dryRun);
      if (ok) {
        counters.qichacha.updated += 1;
        row.company_intro = merged.company_intro;
        row.product_intro = merged.product_intro;
        row.profile_source = merged.profile_source || row.profile_source;
      }
      if (qccDelay > 0) await sleep(qccDelay);
    }
  }

  if (opts.withBaike && opts.baikeLimit > 0) {
    console.log('[backfillNewShareProfileStage1d] 百科第三源（HTTP，限量）…');
    let used = 0;
    for (const row of liveRows) {
      if (used >= opts.baikeLimit) break;
      if (!needsIntro(row)) continue;
      if (!PRIORITY_CATS.has(String(row.industry_category_4 || '').trim())) continue;
      const name =
        String(row.enterprise_full_name_cn || '').trim() ||
        String(row.enterprise_full_name_display || '').trim() ||
        String(row.stock_name || '').trim();
      counters.baike.tried += 1;
      used += 1;
      const baike = fetchBaikeSync(name, opts.baikeSleepMs);
      let merged = mergeBaikeIntro(row, baike, opts.force);
      merged = applySwTags(row, merged);
      if (merged.changed) {
        const ok = await applyIntroUpdate(row.F_Id, merged, opts.dryRun);
        if (ok) {
          counters.baike.updated += 1;
          row.product_intro = merged.product_intro;
          row.company_intro = merged.company_intro;
          row.baike_lemma_url = merged.baike_lemma_url;
          row.baike_lemma_status = merged.baike_lemma_status;
          row.baike_miss_reason = merged.baike_miss_reason;
        }
      } else if (baike && !baike.ok) {
        if (!opts.dryRun) {
          await db.execute(
            `UPDATE ipo_new_share SET baike_lemma_status = ?, baike_miss_reason = ?, F_LastModifyTime = NOW() WHERE F_Id = ?`,
            [baike.lemma_status || null, baike.miss_reason || null, row.F_Id]
          );
        }
      }
      if (opts.baikeSleepMs > 0) await sleep(opts.baikeSleepMs);
    }
  }

  // 标签兜底：仅有申万尚未写 tags 的行
  for (const row of liveRows) {
    if (String(row.industry_tags_display || '').trim()) continue;
    const merged = applySwTags(row, { ...row, changed: false });
    if (merged.industry_tags_display) {
      merged.changed = true;
      const ok = await applyIntroUpdate(row.F_Id, merged, opts.dryRun);
      if (ok) counters.tags.updated += 1;
    }
  }

  const postStats = await queryPostStats(opts.priorityOnly);
  const reportPath = writeReport(opts, counters, postStats);

  console.log('[backfillNewShareProfileStage1d] 完成', counters);
  console.log(
    '[backfillNewShareProfileStage1d] product_intro',
    pct(postStats.productIntro, postStats.total),
    `(${postStats.productIntro}/${postStats.total})`
  );
  console.log('[backfillNewShareProfileStage1d] 报告:', reportPath);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[backfillNewShareProfileStage1d] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
