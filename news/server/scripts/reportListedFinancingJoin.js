/**
 * Stage 0 §4.4 已上市关联摸底
 * 主口径：ipo_new_share（沪深北上市主档）为真值；融资 IPO 类仅作反查参考
 *
 * 用法（news 目录）：
 *   node server/scripts/reportListedFinancingJoin.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  MARKET_LISTED_BASELINE,
  isDomesticExchange,
  buildNewShareIndex,
  buildFinancingIpoIndex,
  classifyListedJoin,
  classifyFinancingListingNoise,
  dedupeIpoCompanies,
  findFinancingDonorForNewShare,
  countNewShareByExchange,
  IPO_ROUND_SQL,
} = require('../utils/project-sourcing/listedFinancingJoin');

const DEFAULT_OUT = path.resolve(__dirname, '../../../需求文档/竞品分析/listed_JOIN摸底报告.md');

function parseArgs() {
  const out = { outFile: DEFAULT_OUT, sampleUnknown: 12 };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
    else if (a.startsWith('--sample-unknown=')) {
      out.sampleUnknown = Math.max(0, parseInt(a.slice(17), 10) || 12);
    }
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

function mdTable(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const r of rows) {
    lines.push(`| ${r.join(' | ')} |`);
  }
  return lines.join('\n');
}

async function columnExists(table, column) {
  const rows = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function loadIpoFinancingEvents() {
  const hasListedStock = await columnExists('sourcing_financing_event', 'listed_stock_code');
  const cols = ['F_Id AS id', 'company_name', 'company_credit_code', 'round', 'latest_round', 'event_date'];
  if (hasListedStock) cols.push('listed_stock_code');
  return db.query(`
    SELECT ${cols.join(', ')}
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
      AND TRIM(COALESCE(company_name, '')) <> ''
      AND ${IPO_ROUND_SQL}
  `);
}

async function loadNewShareRows(hasUnifiedCreditCode) {
  const cols = [
    'F_Id',
    'stock_code',
    'exchange',
    'stock_name',
    'enterprise_full_name_cn',
    'enterprise_full_name_display',
  ];
  if (hasUnifiedCreditCode) cols.push('unified_credit_code');
  return db.query(`SELECT ${cols.join(', ')} FROM ipo_new_share`);
}

async function main() {
  const opts = parseArgs();
  console.log('[reportListedFinancingJoin] 开始生成报告…');
  const hasNsCredit = await columnExists('ipo_new_share', 'unified_credit_code');
  const hasFinListedStock = await columnExists('sourcing_financing_event', 'listed_stock_code');

  console.log('[reportListedFinancingJoin] 加载 IPO 类融资事件…');
  const ipoEvents = await loadIpoFinancingEvents();
  const financingCompanies = dedupeIpoCompanies(ipoEvents);
  console.log('[reportListedFinancingJoin] IPO 事件', ipoEvents.length, '去重企业', financingCompanies.length);
  const newShareRows = await loadNewShareRows(hasNsCredit);
  const domesticNewShare = newShareRows.filter((r) => isDomesticExchange(r.exchange));
  const poolStats = countNewShareByExchange(newShareRows);

  const nsIndex = buildNewShareIndex(newShareRows, { hasUnifiedCreditCode: hasNsCredit });
  const finIndex = buildFinancingIpoIndex(financingCompanies);
  const joinOpts = { financingHasListedStock: hasFinListedStock };

  const reverseResults = domesticNewShare.map((ns) => ({
    ns,
    fin: findFinancingDonorForNewShare(ns, finIndex, { hasUnifiedCreditCode: hasNsCredit }),
  }));
  const reverseHit = reverseResults.filter((r) => r.fin.has_financing_ipo).length;

  console.log('[reportListedFinancingJoin] 融资→new_share 关联分类…');
  const forwardResults = [];
  for (let i = 0; i < financingCompanies.length; i += 1) {
    const c = financingCompanies[i];
    const join = classifyListedJoin(c, nsIndex, joinOpts);
    forwardResults.push({ company: c, join, noise: classifyFinancingListingNoise(c, join) });
    if ((i + 1) % 2000 === 0) {
      console.log(`[reportListedFinancingJoin] 关联进度 ${i + 1}/${financingCompanies.length}`);
    }
  }

  const noiseCounts = {};
  for (const r of forwardResults) {
    noiseCounts[r.noise] = (noiseCounts[r.noise] || 0) + 1;
  }

  const unknownSamples = forwardResults
    .filter((r) => r.join.listing_status === 'unknown')
    .slice(0, opts.sampleUnknown);

  const lines = [];
  lines.push('# 已上市关联摸底报告（Stage 0 §4.4）');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push('');
  lines.push('## 0. 口径说明（重要）');
  lines.push('');
  lines.push('- **上市真值集**：`ipo_new_share` 表中 **沪深北** 在册企业（Stage 1 将扩至全市场约 **5,532** 家）');
  lines.push('- **融资 IPO 类轮次**：烯牛融资事件中的 IPO/上市/定增等标签，**噪声大**（含境外主体、已退市、非 A 股、重复档案）');
  lines.push('- **Stage 2 同步原则**：仅当企业在 `ipo_new_share` 池内命中 → `profile_source=listed_sync`；融资侧 IPO 标签 alone **不**视为已上市');
  lines.push('');
  lines.push('## 1. 上市主档 vs 市场存量');
  lines.push('');
  lines.push('| 交易所 | 市场存量（业务口径） | 库内 ipo_new_share | 缺口 | 填充率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const ex of ['上交所', '深交所', '北交所']) {
    const market = MARKET_LISTED_BASELINE[ex];
    const inDb = poolStats.counts[ex] || 0;
    const gap = market - inDb;
    lines.push(`| ${ex} | ${market.toLocaleString()} | ${inDb.toLocaleString()} | ${gap.toLocaleString()} | ${pct(inDb, market)} |`);
  }
  lines.push(
    `| **沪深北合计** | **${poolStats.marketTotal.toLocaleString()}** | **${poolStats.domesticTotal.toLocaleString()}** | **${(poolStats.marketTotal - poolStats.domesticTotal).toLocaleString()}** | **${pct(poolStats.domesticTotal, poolStats.marketTotal)}** |`
  );
  lines.push(`| 港交所（另计） | — | ${(poolStats.counts.港交所 || 0).toLocaleString()} | — | 非境内沪深北口径 |`);
  lines.push('');
  lines.push(
    `> Stage 1 目标：将 \`ipo_new_share\` 扩至沪深北 **~5,532** 家现行上市公司（东财/AkShare 全量同步），覆盖退市前仍在市主体；**不以融资池家数作为上市规模。**`
  );
  lines.push('');
  lines.push('## 2. 主口径：new_share → 融资池反查');
  lines.push('');
  lines.push(`- 沪深北 \`ipo_new_share\`：**${domesticNewShare.length.toLocaleString()}** 条`);
  lines.push(
    `- 反查命中融资 IPO 类记录：**${reverseHit} / ${domesticNewShare.length}**（${pct(reverseHit, domesticNewShare.length)}）`
  );
  lines.push(
    '- 未命中融资 IPO：属正常——多数上市公司从未出现在烯牛融资库，或仅有非 IPO 轮次档案'
  );
  lines.push('');
  lines.push('## 3. 参考口径：融资 IPO 类 → new_share（噪声分解）');
  lines.push('');
  lines.push(`- 融资 IPO 类事件：**${ipoEvents.length.toLocaleString()}** 行`);
  lines.push(`- 去重企业：**${financingCompanies.length.toLocaleString()}** 家`);
  lines.push('');
  lines.push('| 分类 | 企业数 | 占比 | 含义 |');
  lines.push('| --- | --- | --- | --- |');
  const noiseLabels = {
    in_new_share_pool: '在 new_share 池内（可 listed 同步）',
    financing_overseas_or_invalid_id: '境外/无效识别码（融资档案噪声）',
    financing_needs_review: '待二次匹配（fuzzy/多候选）',
    financing_not_in_new_share_pool: '不在 new_share 池（退市/未入库/非 A 股等）',
  };
  for (const [key, label] of Object.entries(noiseLabels)) {
    const n = noiseCounts[key] || 0;
    lines.push(`| ${key} | ${n} | ${pct(n, financingCompanies.length)} | ${label} |`);
  }
  lines.push('');
  lines.push('### 3.1 关联状态（融资 → new_share）');
  lines.push('');
  const statusCounts = { matched: 0, unknown: 0, no_match: 0 };
  for (const r of forwardResults) statusCounts[r.join.listing_status] += 1;
  lines.push(mdTable(
    ['listing_status', '企业数', '占比'],
    Object.entries(statusCounts).map(([k, n]) => [k, String(n), pct(n, financingCompanies.length)])
  ));
  lines.push('');
  lines.push('## 4. Stage 2 工作量（修订）');
  lines.push('');
  lines.push(`| 动作 | 数量 | 说明 |`);
  lines.push(`| --- | --- | --- |`);
  lines.push(
    `| listed_sync（主路径） | **${noiseCounts.in_new_share_pool || 0}** | 以 new_share 为真值，向融资表 fan-out 画像 |`
  );
  lines.push(
    `| 融资 IPO 噪声丢弃/忽略 | **${(noiseCounts.financing_not_in_new_share_pool || 0) + (noiseCounts.financing_overseas_or_invalid_id || 0)}** | 不在池或境外，不走 listed 主路径 |`
  );
  lines.push(`| 二次匹配队列 | **${noiseCounts.financing_needs_review || 0}** | unknown，人工/规则复核 |`);
  lines.push('');
  lines.push('## 5. 数据底座');
  lines.push('');
  lines.push(`- ipo_new_share.unified_credit_code：**${hasNsCredit ? '已建列' : '未建列（Stage 1）'}**`);
  lines.push(`- 融资 listed_stock_code：**${hasFinListedStock ? '已建列' : '未建列（Stage 2）'}**`);
  lines.push('');
  lines.push('## 6. unknown 样例（融资侧，仅供参考）');
  lines.push('');
  if (!unknownSamples.length) lines.push('（无）');
  else {
    lines.push('| 企业 | round | 方式 |');
    lines.push('| --- | --- | --- |');
    for (const s of unknownSamples) {
      const c = s.company;
      lines.push(`| ${c.company_name} | ${c.latest_round || c.round || '—'} | ${s.join.match_method} |`);
    }
  }
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');

  console.log('[reportListedFinancingJoin] 沪深北 new_share:', domesticNewShare.length, '/', poolStats.marketTotal);
  console.log('[reportListedFinancingJoin] 反查融资命中:', reverseHit);
  console.log('[reportListedFinancingJoin] 融资→池 matched:', noiseCounts.in_new_share_pool || 0);
  console.log('[reportListedFinancingJoin] 报告:', opts.outFile);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[reportListedFinancingJoin] 失败:', e.message);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
