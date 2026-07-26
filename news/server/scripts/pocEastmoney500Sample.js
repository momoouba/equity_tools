/**
 * Stage 0 §4.2：分层抽样 500 条 ipo_new_share，探测东财/AkShare 全称+信用代码回填率
 *
 * 用法（news 目录）：
 *   node server/scripts/pocEastmoney500Sample.js
 *   node server/scripts/pocEastmoney500Sample.js --sample=100 --dry-run
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../db');
const { resolvePythonBin, pythonArgs } = require('./resolvePython');

const DEFAULT_OUT = path.resolve(__dirname, '../../../需求文档/竞品分析/东财500条回填率报告.md');
const PY_PROBE = path.join(__dirname, '../utils/listing/new_share_profile_probe.py');

function parseArgs() {
  const out = { sampleTotal: 500, dryRun: false, outFile: DEFAULT_OUT };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--sample=')) out.sampleTotal = Math.max(1, parseInt(a.slice(9), 10) || 500);
    else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

function probeRow(stockCode, exchange) {
  const py = resolvePythonBin();
  const r = spawnSync(py, pythonArgs(PY_PROBE, ['--code', String(stockCode), '--exchange', String(exchange || '')]), {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || r.stdout || 'probe failed' };
  }
  try {
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  } catch (e) {
    return { ok: false, error: `parse: ${e.message}` };
  }
}

function bucketExchange(ex) {
  const s = String(ex || '');
  if (s.includes('港')) return '港交所';
  if (s.includes('北')) return '北交所';
  if (s.includes('深')) return '深交所';
  if (s.includes('上')) return '上交所';
  return s || '其他';
}

async function stratifiedSample(totalWanted) {
  const all = await db.query(`
    SELECT F_Id AS id, stock_code, stock_name, exchange,
      enterprise_full_name_cn, enterprise_full_name_display
    FROM ipo_new_share
    ORDER BY F_Id ASC
  `);
  const buckets = new Map();
  for (const row of all) {
    const b = bucketExchange(row.exchange);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(row);
  }
  const order = ['上交所', '深交所', '北交所', '港交所', '其他'];
  const present = order.filter((k) => buckets.has(k) && buckets.get(k).length);
  const per = Math.max(1, Math.floor(totalWanted / present.length));
  const picked = [];
  const seen = new Set();
  for (const b of present) {
    const arr = buckets.get(b);
    const step = Math.max(1, Math.floor(arr.length / per));
    for (let i = 0; i < arr.length && picked.filter((p) => bucketExchange(p.exchange) === b).length < per; i += step) {
      const row = arr[i];
      const key = `${row.stock_code}:${row.exchange}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row);
    }
  }
  // 补齐到 totalWanted
  if (picked.length < totalWanted) {
    for (const row of all) {
      const key = `${row.stock_code}:${row.exchange}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row);
      if (picked.length >= totalWanted) break;
    }
  }
  return picked.slice(0, totalWanted);
}

function summarize(results) {
  const byEx = {};
  let full = 0;
  let uscc = 0;
  let either = 0;
  for (const r of results) {
    const b = bucketExchange(r.exchange);
    if (!byEx[b]) byEx[b] = { n: 0, full: 0, uscc: 0, either: 0, errors: 0 };
    byEx[b].n += 1;
    if (r.probe_error) {
      byEx[b].errors += 1;
      continue;
    }
    const hasFull = Boolean((r.probed_full_name || '').trim());
    const hasUscc = Boolean((r.probed_uscc || '').trim());
    if (hasFull) {
      full += 1;
      byEx[b].full += 1;
    }
    if (hasUscc) {
      uscc += 1;
      byEx[b].uscc += 1;
    }
    if (hasFull || hasUscc) {
      either += 1;
      byEx[b].either += 1;
    }
  }
  return { byEx, full, uscc, either, total: results.length };
}

async function main() {
  const opts = parseArgs();
  const sample = await stratifiedSample(opts.sampleTotal);
  console.log('[pocEastmoney500Sample] 抽样条数:', sample.length);

  if (opts.dryRun) {
    const dist = {};
    for (const r of sample) {
      const b = bucketExchange(r.exchange);
      dist[b] = (dist[b] || 0) + 1;
    }
    console.log('[pocEastmoney500Sample] 分层分布:', dist);
    await db.closePool();
    return;
  }

  try {
    await db.closePool();
  } catch (_) {}

  const results = [];
  for (let i = 0; i < sample.length; i += 1) {
    const row = sample[i];
    const probe = probeRow(row.stock_code, row.exchange);
    results.push({
      id: row.id,
      stock_code: row.stock_code,
      stock_name: row.stock_name,
      exchange: row.exchange,
      db_full_name: row.enterprise_full_name_cn || row.enterprise_full_name_display || '',
      probed_full_name: probe.enterprise_full_name || '',
      probed_uscc: probe.unified_credit_code || '',
      probe_ok: probe.ok,
      probe_error: probe.error || (!probe.ok ? 'empty' : ''),
    });
    if ((i + 1) % 50 === 0) {
      console.log('[pocEastmoney500Sample] 已探测', i + 1, '/', sample.length);
    }
  }

  const sum = summarize(results);
  const lines = [];
  lines.push('# 东财/AkShare 500 条回填率报告（Stage 0 §4.2）');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`抽样总数：**${sum.total}**（目标 ${opts.sampleTotal}）`);
  lines.push('');
  lines.push('## 1. 总体回填率（探测源：AkShare individual_info + 东财 F10）');
  lines.push('');
  lines.push(`- 企业全称：**${sum.full} / ${sum.total}**（${pct(sum.full, sum.total)}）`);
  lines.push(`- 统一社会信用代码：**${sum.uscc} / ${sum.total}**（${pct(sum.uscc, sum.total)}）`);
  lines.push(`- 全称或信用代码至少一项：**${sum.either} / ${sum.total}**（${pct(sum.either, sum.total)}）`);
  lines.push('');
  lines.push('## 2. 分板块');
  lines.push('');
  lines.push('| 板块 | 样本数 | 全称 | 信用代码 | 至少一项 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [ex, s] of Object.entries(sum.byEx).sort()) {
    lines.push(`| ${ex} | ${s.n} | ${pct(s.full, s.n)} | ${pct(s.uscc, s.n)} | ${pct(s.either, s.n)} |`);
  }
  lines.push('');
  lines.push('## 3. 门禁建议');
  lines.push('');
  const bj = sum.byEx['北交所'];
  if (bj && bj.n > 0 && bj.either / bj.n < 0.5) {
    lines.push('- **北交所**回填率偏低 → Stage 1 建议启用 **企查查第二源**（§4.2）。');
  } else {
    lines.push('- 北交所样本回填率未触发自动告警阈值（either < 50%）；仍建议 Stage 1 保留企查查作为第二源。');
  }
  lines.push(`- Stage 1b 目标：全量回填率 ≥ 本报告「至少一项」率 × 0.9（§5.4）。`);
  lines.push('');
  lines.push('## 4. 说明');
  lines.push('');
  lines.push('- 港股条目通常无境内统一社会信用代码，信用代码列可能为空属预期。');
  lines.push('- 本 PoC **不写库**，仅用于评估数据源可行性。');
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  console.log('[pocEastmoney500Sample] 报告:', opts.outFile);
  console.log('[pocEastmoney500Sample] 至少一项回填:', pct(sum.either, sum.total));
}

main().catch(async (e) => {
  console.error('[pocEastmoney500Sample] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
