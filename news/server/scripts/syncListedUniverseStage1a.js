/**
 * Stage 1a：扩 ipo_new_share 至 A 股现行上市池（~5,5xx）并回填申万行业（东财 EM2016）
 *
 * 用法（news 目录）：
 *   npm run sync:listed-universe-stage1a
 *   npm run sync:listed-universe-stage1a -- --dry-run
 *   npm run sync:listed-universe-stage1a -- --limit=50
 *   npm run sync:listed-universe-stage1a -- --sw-only
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../db');
const { resolvePythonBin, pythonArgs } = require('./resolvePython');
const {
  MARKET_LISTED_BASELINE,
  UNIVERSE_PLACEHOLDER_ISSUE_DATE,
  isDomesticExchange,
} = require('../utils/listing/listedUniverseUtils');

const PY_FETCH = path.join(__dirname, '../utils/listing/listed_universe_fetch.py');
const DEFAULT_REPORT = path.resolve(__dirname, '../../../需求文档/竞品分析/Stage1a申万填充率报告.md');

function parseArgs() {
  const out = {
    dryRun: false,
    forceSw: false,
    swOnly: false,
    limit: 0,
    outFile: DEFAULT_REPORT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force-sw') out.forceSw = true;
    else if (a === '--sw-only') out.swOnly = true;
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

function weekdayZh(ymd) {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return null;
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return names[d.getDay()] || null;
}

function fetchUniversePayload(limit) {
  const py = resolvePythonBin();
  const args = pythonArgs(PY_FETCH, limit > 0 ? [`--limit=${limit}`] : []);
  const r = spawnSync(py, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TQDM_DISABLE: '1' },
    maxBuffer: 40 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'listed_universe_fetch failed');
  }
  const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
  const payload = JSON.parse(line);
  if (!payload.ok || !Array.isArray(payload.rows)) {
    throw new Error('listed_universe_fetch output invalid');
  }
  return payload;
}

async function loadExistingMap() {
  const rows = await db.query(
    `SELECT F_Id, stock_code, exchange, stock_name, issue_date, public_date,
            sw_industry_l1, sw_industry_l2
     FROM ipo_new_share`
  );
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.stock_code}::${row.exchange}`, row);
  }
  return map;
}

async function upsertRow(row, existing, opts, syncAt) {
  const key = `${row.stock_code}::${row.exchange}`;
  const old = existing.get(key);
  const swL1 = String(row.sw_industry_l1 || '').trim();
  const swL2 = String(row.sw_industry_l2 || '').trim();

  if (old) {
    const needSw =
      opts.forceSw ||
      !String(old.sw_industry_l1 || '').trim() ||
      !String(old.sw_industry_l2 || '').trim();
    if (!needSw && !opts.forceSw) {
      return { action: 'skipped', reason: 'sw_exists' };
    }
    if (!swL1 && !opts.forceSw) {
      return { action: 'skipped', reason: 'no_sw_source' };
    }
    if (opts.dryRun) {
      return { action: 'would_update_sw' };
    }
    await db.execute(
      `UPDATE ipo_new_share
       SET sw_industry_l1 = ?, sw_industry_l2 = ?,
           listed_pool_sync_at = COALESCE(listed_pool_sync_at, ?),
           profile_source = CASE
             WHEN ? <> '' THEN COALESCE(profile_source, 'eastmoney_sw')
             ELSE profile_source
           END,
           F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [swL1 || old.sw_industry_l1, swL2 || old.sw_industry_l2, syncAt, swL1, old.F_Id]
    );
    return { action: 'updated_sw' };
  }

  if (opts.swOnly) {
    return { action: 'skipped', reason: 'not_in_db' };
  }

  const issueDate = String(row.issue_date || '').slice(0, 10) || UNIVERSE_PLACEHOLDER_ISSUE_DATE;
  const issueWeekday = weekdayZh(issueDate);
  const publicDate = row.public_date ? String(row.public_date).slice(0, 10) : null;

  if (opts.dryRun) {
    return { action: 'would_insert' };
  }

  await db.execute(
    `INSERT INTO ipo_new_share
      (stock_code, stock_name, issue_date, issue_weekday, exchange, public_date,
       sw_industry_l1, sw_industry_l2, profile_source, listed_pool_sync_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.stock_code,
      row.stock_name,
      issueDate,
      issueWeekday,
      row.exchange,
      publicDate,
      swL1 || null,
      swL2 || null,
      swL1 ? 'eastmoney_sw' : null,
      syncAt,
    ]
  );
  return { action: 'inserted' };
}

async function queryPostStats() {
  const domesticFilter = `exchange IN ('上交所', '深交所', '北交所')`;
  const total = await db.query(`SELECT COUNT(*) AS c FROM ipo_new_share WHERE ${domesticFilter}`);
  const sw = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(sw_industry_l1, '')) <> '' THEN 1 ELSE 0 END) AS sw_l1,
      SUM(CASE WHEN TRIM(COALESCE(sw_industry_l2, '')) <> '' THEN 1 ELSE 0 END) AS sw_l2
    FROM ipo_new_share
    WHERE ${domesticFilter}
  `);
  const byExchange = await db.query(`
    SELECT exchange,
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(sw_industry_l1, '')) <> '' THEN 1 ELSE 0 END) AS sw_l1
    FROM ipo_new_share
    WHERE ${domesticFilter}
    GROUP BY exchange
    ORDER BY total DESC
  `);
  const placeholder = await db.query(`
    SELECT COUNT(*) AS c FROM ipo_new_share
    WHERE ${domesticFilter} AND DATE(issue_date) = '1900-01-01'
  `);
  return {
    domesticTotal: Number(total[0]?.c || 0),
    swL1: Number(sw[0]?.sw_l1 || 0),
    swL2: Number(sw[0]?.sw_l2 || 0),
    byExchange,
    placeholderIssueDate: Number(placeholder[0]?.c || 0),
  };
}

function writeReport(opts, payload, counters, postStats) {
  const lines = [];
  lines.push('# Stage 1a 申万行业填充率报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`模式：${opts.dryRun ? '**dry-run**' : '**写入**'}${opts.swOnly ? '（仅回填申万）' : ''}`);
  lines.push('');
  lines.push('## 1. 同步摘要');
  lines.push('');
  lines.push(`- 东财/AkShare 现行 A 股池：**${payload.stats?.universe_total?.toLocaleString() || '—'}**`);
  lines.push(`- 源侧申万命中：**${payload.stats?.sw_hit?.toLocaleString() || '—'}** / 未命中：**${payload.stats?.sw_miss?.toLocaleString() || '—'}**`);
  lines.push(`- 新增入库：**${counters.inserted}**；申万更新：**${counters.updated_sw}**；跳过：**${counters.skipped}**`);
  lines.push('');
  lines.push('## 2. 库内沪深北（同步后）');
  lines.push('');
  lines.push(`- 境内记录数：**${postStats.domesticTotal.toLocaleString()}**（目标约 **5,532**）`);
  lines.push(`- 申万一级非空：**${postStats.swL1.toLocaleString()}**（**${pct(postStats.swL1, postStats.domesticTotal)}**）`);
  lines.push(`- 申万二级非空：**${postStats.swL2.toLocaleString()}**（**${pct(postStats.swL2, postStats.domesticTotal)}**）`);
  lines.push(`- 占位申购日（1900-01-01，主池扩入行）：**${postStats.placeholderIssueDate.toLocaleString()}**`);
  lines.push('');
  lines.push('### 2.1 分交易所');
  lines.push('');
  lines.push('| 交易所 | 库内 | 市场目标 | 申万一级 | 填充率 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const ex of ['上交所', '深交所', '北交所']) {
    const row = postStats.byExchange.find((r) => r.exchange === ex) || { total: 0, sw_l1: 0 };
    const t = Number(row.total || 0);
    const s = Number(row.sw_l1 || 0);
    const baseline = MARKET_LISTED_BASELINE[ex] || '—';
    lines.push(`| ${ex} | ${t.toLocaleString()} | ${baseline} | ${s.toLocaleString()} | ${pct(s, t)} |`);
  }
  lines.push('');
  lines.push('## 3. 验收（§5.4 Stage 1a）');
  lines.push('');
  const pass = postStats.domesticTotal > 0 && postStats.swL1 / postStats.domesticTotal >= 0.95;
  lines.push(`- 申万一级 ≥ 95%：**${pass ? '达标' : '未达标'}**（当前 ${pct(postStats.swL1, postStats.domesticTotal)}）`);
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  return opts.outFile;
}

async function main() {
  const opts = parseArgs();
  // 必须先等 DB 初始化完成；否则下方 spawnSync 会阻塞事件循环，导致 createDatabaseIfNeeded 握手 ETIMEDOUT
  await db.query('SELECT 1');
  console.log('[syncListedUniverseStage1a] 拉取上市池 + 申万…');
  const payload = fetchUniversePayload(opts.limit);
  console.log(
    '[syncListedUniverseStage1a] 源池',
    payload.stats?.universe_total,
    '申万命中',
    payload.stats?.sw_hit
  );

  const existing = await loadExistingMap();
  const syncAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const counters = { inserted: 0, updated_sw: 0, skipped: 0 };

  for (const row of payload.rows) {
    if (!isDomesticExchange(row.exchange)) continue;
    const result = await upsertRow(row, existing, opts, syncAt);
    if (result.action === 'inserted' || result.action === 'would_insert') counters.inserted += 1;
    else if (result.action === 'updated_sw' || result.action === 'would_update_sw') counters.updated_sw += 1;
    else counters.skipped += 1;
  }

  const postStats = opts.dryRun
    ? await queryPostStats()
    : await queryPostStats();
  const reportPath = writeReport(opts, payload, counters, postStats);

  console.log('[syncListedUniverseStage1a] 完成', counters);
  console.log('[syncListedUniverseStage1a] 沪深北', postStats.domesticTotal, '申万一级', pct(postStats.swL1, postStats.domesticTotal));
  console.log('[syncListedUniverseStage1a] 报告:', reportPath);

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[syncListedUniverseStage1a] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
