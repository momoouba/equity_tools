/**
 * Stage 0 §4.3 百科 PoC（D8：百度百科爬虫）
 * 优先行业批抽样，统计词条命中率；提取 company_intro / product_intro（无产品则用企业介绍）
 *
 * 用法（news 目录）：
 *   node server/scripts/runBaikePoc.js
 *   node server/scripts/runBaikePoc.js --per-category=30 --sleep-ms=1200
 *   node server/scripts/runBaikePoc.js --month=2026-06 --per-category=30
 *   node server/scripts/runBaikePoc.js --mode=browser --month=2026-06 --cdp-url=http://127.0.0.1:9222
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../db');
const { resolvePythonBin, pythonArgs } = require('./resolvePython');
const {
  loadIndustryMapFromDb,
  mapSourceIndustryToCategory4,
} = require('../utils/project-sourcing/industryCategory4Map');

const DEFAULT_OUT = path.resolve(__dirname, '../../../需求文档/竞品分析/百科PoC命中率报告.md');
const PY_BAIKE = path.join(__dirname, '../utils/project-sourcing/baidu_baike_fetch.py');
const PY_BAIKE_BROWSER = path.join(__dirname, '../utils/project-sourcing/baidu_baike_fetch_browser.py');

const PRIORITY_CATS = ['ai', 'bio', 'semi_mfg'];

function parseArgs() {
  const out = {
    perCategory: 30,
    sleepMs: 1200,
    years: 3,
    month: '',
    mode: 'http',
    cdpUrl: process.env.BAIKE_CDP_URL || 'http://127.0.0.1:9222',
    captchaWaitMs: 15000,
    pageTimeoutMs: 30000,
    dryRun: false,
    outFile: DEFAULT_OUT,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--per-category=')) out.perCategory = Math.max(1, parseInt(a.slice(15), 10) || 30);
    else if (a.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(a.slice(11), 10) || 1200);
    else if (a.startsWith('--years=')) out.years = Math.max(1, parseInt(a.slice(8), 10) || 3);
    else if (a.startsWith('--month=')) out.month = String(a.slice(8)).trim();
    else if (a.startsWith('--mode=')) out.mode = String(a.slice(7)).trim().toLowerCase() || 'http';
    else if (a.startsWith('--cdp-url=')) out.cdpUrl = String(a.slice(10)).trim();
    else if (a.startsWith('--captcha-wait-ms=')) {
      out.captchaWaitMs = Math.max(0, parseInt(a.slice(18), 10) || 15000);
    } else if (a.startsWith('--timeout-ms=')) {
      out.pageTimeoutMs = Math.max(5000, parseInt(a.slice(13), 10) || 30000);
    } else if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function monthRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const start = `${y}-${String(mo).padStart(2, '0')}-01`;
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextY = mo === 12 ? y + 1 : y;
  const end = `${nextY}-${String(nextMo).padStart(2, '0')}-01`;
  return { start, end, label: `${y}年${mo}月` };
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

function fetchBaike(name, sleepMs) {
  const py = resolvePythonBin();
  const args = pythonArgs(PY_BAIKE, ['--name', String(name)]);
  if (sleepMs > 0) args.push('--sleep-ms', String(sleepMs));
  const r = spawnSync(py, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || r.stdout || 'fetch failed' };
  }
  try {
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  } catch (e) {
    return { ok: false, error: `parse: ${e.message}` };
  }
}

function fetchBaikeBatchBrowser(companies, opts) {
  const py = resolvePythonBin();
  const payload = JSON.stringify(companies.map((c) => ({ company_name: c.company_name })));
  const args = pythonArgs(PY_BAIKE_BROWSER, [
    '--batch',
    '--cdp-url',
    opts.cdpUrl,
    '--sleep-ms',
    String(opts.sleepMs),
    '--captcha-wait-ms',
    String(opts.captchaWaitMs),
    '--timeout-ms',
    String(opts.pageTimeoutMs),
  ]);
  const r = spawnSync(py, args, {
    input: payload,
    encoding: 'utf8',
    windowsHide: true,
    cwd: path.join(__dirname, '../utils/project-sourcing'),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const msg = String(r.stderr || r.stdout || 'browser batch failed').trim();
    throw new Error(msg);
  }
  try {
    return JSON.parse(String(r.stdout || '').trim());
  } catch (e) {
    throw new Error(`browser batch parse: ${e.message}`);
  }
}

async function loadPriorityCompanies(mapRows, opts) {
  let sql;
  let params;
  const range = opts.month ? monthRange(opts.month) : null;
  if (range) {
    sql = `SELECT company_name, company_credit_code, industry_source_lv1, industry_source_lv2, MAX(event_date) AS last_event
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND event_date >= ?
       AND event_date < ?
     GROUP BY company_name, company_credit_code, industry_source_lv1, industry_source_lv2`;
    params = [range.start, range.end];
  } else {
    sql = `SELECT company_name, company_credit_code, industry_source_lv1, industry_source_lv2, MAX(event_date) AS last_event
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0
       AND TRIM(COALESCE(company_name, '')) <> ''
       AND event_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)
     GROUP BY company_name, company_credit_code, industry_source_lv1, industry_source_lv2`;
    params = [opts.years];
  }
  const rows = await db.query(sql, params);

  const byCode = new Map();
  for (const row of rows) {
    const mapped = mapSourceIndustryToCategory4(row.industry_source_lv1, row.industry_source_lv2, mapRows);
    if (!PRIORITY_CATS.includes(mapped.category_4)) continue;
    const code = String(row.company_credit_code || '').trim();
    const key = code || `name:${String(row.company_name).trim()}`;
    const existing = byCode.get(key);
    if (!existing || String(row.last_event) > String(existing.last_event)) {
      byCode.set(key, {
        company_name: String(row.company_name).trim(),
        company_credit_code: code,
        category_4: mapped.category_4,
        industry_source_lv1: row.industry_source_lv1,
        last_event: row.last_event,
      });
    }
  }
  return [...byCode.values()];
}

function samplePerCategory(companies, perCategory) {
  const pools = { ai: [], bio: [], semi_mfg: [] };
  for (const c of companies) {
    if (pools[c.category_4]) pools[c.category_4].push(c);
  }
  const out = [];
  for (const cat of PRIORITY_CATS) {
    const arr = pools[cat].sort((a, b) => String(b.last_event).localeCompare(String(a.last_event)));
    const step = Math.max(1, Math.floor(arr.length / perCategory));
    let taken = 0;
    for (let i = 0; i < arr.length && taken < perCategory; i += step) {
      out.push(arr[i]);
      taken += 1;
    }
    for (let i = 0; i < arr.length && taken < perCategory; i += 1) {
      if (out.includes(arr[i])) continue;
      out.push(arr[i]);
      taken += 1;
    }
  }
  return out;
}

function summarize(results) {
  const byCat = {};
  for (const cat of PRIORITY_CATS) {
    byCat[cat] = { n: 0, lemma: 0, intro: 0, product: 0, product_fallback: 0, errors: 0 };
  }
  for (const r of results) {
    const s = byCat[r.category_4];
    if (!s) continue;
    s.n += 1;
    if (r.has_lemma) s.lemma += 1;
    if ((r.company_intro || '').trim().length >= 20) s.intro += 1;
    if ((r.product_intro || '').trim().length >= 20) s.product += 1;
    if (r.product_from_fallback) s.product_fallback += 1;
    if (r.miss_reason || r.error) s.errors += 1;
  }
  return byCat;
}

function summarizeMissReasons(results) {
  const counts = {
    found: 0,
    no_lemma: 0,
    anti_crawl: 0,
    http_error: 0,
    network_error: 0,
    other: 0,
  };
  for (const r of results) {
    if (r.has_lemma || r.lemma_status === 'found') {
      counts.found += 1;
      continue;
    }
    const reason = r.miss_reason || r.error || 'other';
    if (reason === 'no_lemma') counts.no_lemma += 1;
    else if (reason === 'anti_crawl') counts.anti_crawl += 1;
    else if (reason === 'http_error' || String(reason).startsWith('http_')) counts.http_error += 1;
    else if (reason === 'network_error') counts.network_error += 1;
    else counts.other += 1;
  }
  return counts;
}

const MISS_REASON_LABEL = {
  no_lemma: '确认无词条',
  anti_crawl: '反爬/访问受限（词条未知）',
  http_error: 'HTTP 异常',
  network_error: '网络异常',
  empty_name: '名称为空',
};

async function main() {
  const opts = parseArgs();
  const range = opts.month ? monthRange(opts.month) : null;
  if (opts.month && !range) {
    throw new Error(`无效 --month 格式，应为 YYYY-MM，收到: ${opts.month}`);
  }
  if (!['http', 'browser'].includes(opts.mode)) {
    throw new Error(`无效 --mode，应为 http 或 browser，收到: ${opts.mode}`);
  }
  const mapRows = await loadIndustryMapFromDb(db, { force: true });
  const companies = await loadPriorityCompanies(mapRows, opts);
  const sample = samplePerCategory(companies, opts.perCategory);

  const windowLabel = range ? `${range.label}（${range.start} ~ ${range.end} 前）` : `近 ${opts.years} 年`;
  console.log('[runBaikePoc] 抽样窗口:', windowLabel);

  console.log('[runBaikePoc] 优先行业批去重企业:', companies.length);
  console.log('[runBaikePoc] 本次抽样:', sample.length, '每类目标:', opts.perCategory);
  console.log('[runBaikePoc] 抓取模式:', opts.mode);
  if (opts.mode === 'browser') {
    console.log('[runBaikePoc] CDP:', opts.cdpUrl, '验证码等待:', opts.captchaWaitMs, 'ms');
  }

  if (opts.dryRun) {
    const dist = {};
    for (const s of sample) dist[s.category_4] = (dist[s.category_4] || 0) + 1;
    console.log('[runBaikePoc] dry-run 分布:', dist);
    await db.closePool();
    return;
  }

  try {
    await db.closePool();
  } catch (_) {}

  const results = [];
  if (opts.mode === 'browser') {
    console.log('[runBaikePoc] 连接本机 Chrome CDP，批跑', sample.length, '家…');
    const fetchedList = fetchBaikeBatchBrowser(sample, opts);
    if (!Array.isArray(fetchedList) || fetchedList.length !== sample.length) {
      throw new Error(`browser batch 返回条数异常: 期望 ${sample.length}，实际 ${fetchedList?.length}`);
    }
    for (let i = 0; i < sample.length; i += 1) {
      const c = sample[i];
      const fetched = fetchedList[i] || {};
      results.push({
        category_4: c.category_4,
        company_name: c.company_name,
        company_credit_code: c.company_credit_code,
        lookup_name: c.company_name,
        has_lemma: Boolean(fetched.has_lemma),
        lemma_status: fetched.lemma_status || (fetched.has_lemma ? 'found' : 'unknown'),
        miss_reason: fetched.miss_reason || '',
        company_intro: fetched.company_intro || '',
        product_intro: fetched.product_intro || '',
        product_from_fallback: Boolean(fetched.product_from_fallback),
        baike_url: fetched.baike_url || '',
        error: fetched.error || '',
      });
      if ((i + 1) % 10 === 0) {
        console.log('[runBaikePoc] 进度', i + 1, '/', sample.length);
      }
    }
  } else {
    for (let i = 0; i < sample.length; i += 1) {
      const c = sample[i];
      const lookupName = c.company_name;
      const fetched = fetchBaike(lookupName, opts.sleepMs);
      results.push({
        category_4: c.category_4,
        company_name: c.company_name,
        company_credit_code: c.company_credit_code,
        lookup_name: lookupName,
        has_lemma: Boolean(fetched.has_lemma),
        lemma_status: fetched.lemma_status || (fetched.has_lemma ? 'found' : 'unknown'),
        miss_reason: fetched.miss_reason || '',
        company_intro: fetched.company_intro || '',
        product_intro: fetched.product_intro || '',
        product_from_fallback: Boolean(fetched.product_from_fallback),
        baike_url: fetched.baike_url || '',
        error: fetched.error || '',
      });
      if ((i + 1) % 10 === 0) {
        console.log('[runBaikePoc] 进度', i + 1, '/', sample.length);
      }
    }
  }

  const byCat = summarize(results);
  const missCounts = summarizeMissReasons(results);
  const total = results.length;
  const lemmaTotal = results.filter((r) => r.has_lemma).length;

  const lines = [];
  lines.push('# 百科 PoC 命中率报告（Stage 0 §4.3 / D8 爬虫方案）');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push('');
  lines.push('## D8 定稿（本期）');
  lines.push('');
  lines.push('| 项 | 结论 |');
  lines.push('| --- | --- |');
  lines.push('| 接入方式 | **百度百科可控爬虫**（`baidu_baike_fetch.py` / CDP：`baidu_baike_fetch_browser.py`） |');
  lines.push('| 本次模式 | **' + (opts.mode === 'browser' ? 'Playwright CDP（本机 Chrome）' : 'HTTP requests') + '** |');
  if (opts.mode === 'browser') {
    lines.push('| CDP 地址 | `' + opts.cdpUrl + '` |');
    lines.push('| 验证码等待 | **' + opts.captchaWaitMs + 'ms**（命中安全验证时供人工处理） |');
  }
  lines.push('| 抓取字段 | `company_intro`（企业介绍）、`product_intro`（产品介绍/主营业务） |');
  lines.push('| 降级规则 | **无独立产品介绍段落时，`product_intro` = `company_intro`** |');
  lines.push('| 频率限制 | 默认请求间隔 **' + opts.sleepMs + 'ms**（可调 `--sleep-ms`） |');
  lines.push('| 全量门禁 | 本 PoC 通过后，才启动 Stage 1/2 全量 `backfill*BaikeLookup` |');
  lines.push('');
  lines.push(`## 1. 抽样范围`);
  lines.push('');
  if (range) {
    lines.push(`- 优先行业批：**${range.label}** 发生融资的去重企业（\`event_date\` ∈ [${range.start}, ${range.end})）`);
  } else {
    lines.push(`- 优先行业批：近 **${opts.years}** 年融资去重企业`);
  }
  lines.push(`- 赛道：${PRIORITY_CATS.join(' / ')}`);
  lines.push(`- 每类抽样：**${opts.perCategory}** 家，合计 **${total}** 家`);
  lines.push('');
  lines.push('## 2. 命中率');
  lines.push('');
  lines.push(`- 有词条（has_lemma）：**${lemmaTotal} / ${total}**（${pct(lemmaTotal, total)}）`);
  lines.push('');
  lines.push('### 2.1 词条状态分布（区分无词条 vs 反爬）');
  lines.push('');
  lines.push('| 状态 | 数量 | 占比 | 说明 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    `| 有词条 | ${missCounts.found} | ${pct(missCounts.found, total)} | 成功抓取百科内容 |`
  );
  lines.push(
    `| 确认无词条 | ${missCounts.no_lemma} | ${pct(missCounts.no_lemma, total)} | 页面明确提示尚未收录/约为0/页面不存在 |`
  );
  lines.push(
    `| 反爬/访问受限 | ${missCounts.anti_crawl} | ${pct(missCounts.anti_crawl, total)} | 安全验证页；**词条是否存在未知，不可当作无词条** |`
  );
  if (missCounts.http_error) {
    lines.push(
      `| HTTP 异常 | ${missCounts.http_error} | ${pct(missCounts.http_error, total)} | 非 200 且非明确无词条 |`
    );
  }
  if (missCounts.network_error) {
    lines.push(
      `| 网络异常 | ${missCounts.network_error} | ${pct(missCounts.network_error, total)} | 请求超时/连接失败 |`
    );
  }
  if (missCounts.other) {
    lines.push(`| 其它 | ${missCounts.other} | ${pct(missCounts.other, total)} | — |`);
  }
  lines.push('');
  lines.push('| category_4 | 样本 | 有词条 | 企业介绍≥20字 | 产品介绍≥20字 | 产品来自企业介绍降级 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const cat of PRIORITY_CATS) {
    const s = byCat[cat];
    lines.push(
      `| ${cat} | ${s.n} | ${pct(s.lemma, s.n)} | ${pct(s.intro, s.n)} | ${pct(s.product, s.n)} | ${pct(s.product_fallback, s.n)} |`
    );
  }
  lines.push('');
  lines.push('## 3. 失败样例（Top 10）');
  lines.push('');
  lines.push('> `确认无词条` 与 `反爬/访问受限` 分开统计；后者表示未能访问百科，**不等于**企业没有词条。');
  lines.push('');
  const fails = results.filter((r) => !r.has_lemma).slice(0, 10);
  if (!fails.length) {
    lines.push('（无）');
  } else {
    lines.push('| 企业 | category_4 | miss_reason | lemma_status | 详情 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const f of fails) {
      const reason = f.miss_reason || f.error || 'unknown';
      const label = MISS_REASON_LABEL[reason] || reason;
      lines.push(
        `| ${f.company_name} | ${f.category_4} | ${label} | ${f.lemma_status || 'unknown'} | ${f.error || '—'} |`
      );
    }
  }
  lines.push('');
  lines.push('## 4. 结构化质量（人工抽检入口）');
  lines.push('');
  lines.push('建议业务对每类再抽 ≥10 条，对比：百科 `product_intro` vs 现 AI enrich vs 主观判断（§4.3）。');
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  console.log('[runBaikePoc] 报告:', opts.outFile);
  console.log('[runBaikePoc] 词条命中率:', pct(lemmaTotal, total));
  console.log(
    '[runBaikePoc] 状态分布:',
    `有词条 ${missCounts.found}`,
    `无词条 ${missCounts.no_lemma}`,
    `反爬/未知 ${missCounts.anti_crawl}`
  );
}

main().catch(async (e) => {
  console.error('[runBaikePoc] 失败:', e.message);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
