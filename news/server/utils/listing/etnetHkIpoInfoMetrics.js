/**
 * 经济通 etnet 港股「新股信息」ci_ipo_info.php —— 供打新日历港股首日指标优先数据源。
 * 全表分页抓取 + 进程内 TTL 缓存 + 并发单飞，避免每只股票重复翻页或再走 AkShare 子进程。
 */

const ETNET_IPO_INFO_URL = 'https://www.etnet.com.hk/www/sc/stocks/ci_ipo_info.php';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_MS = Math.max(30_000, Number(process.env.NEW_SHARE_ETNET_IPOINFO_CACHE_TTL_MS || 300_000));
const PAGE_FETCH_MS = Math.max(8000, Number(process.env.NEW_SHARE_ETNET_FETCH_TIMEOUT_MS || 45_000));
const MAX_PAGES = Math.max(1, Math.min(80, Number(process.env.NEW_SHARE_ETNET_IPOINFO_MAX_PAGES || 35)));

let cache = { expireAt: 0, rows: [] };
let loadPromise = null;

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

function normYmd(s) {
  const t = String(s || '')
    .trim()
    .replace(/\//g, '-')
    .replace(/\./g, '-')
    .replace(/／/g, '-');
  if (!t) return '';
  const p = t.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  const m = p.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return '';
}

function parsePrice(v) {
  const s = String(v ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/，/g, '');
  if (!s || s === '--' || s.toLowerCase() === 'nan') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parsePct(s) {
  const t = String(s || '')
    .trim()
    .replace(/,/g, '')
    .replace(/，/g, '')
    .replace(/%/g, '')
    .replace(/\+/g, '');
  if (!t || t === '--') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseEtnetIpoInfoPage(html) {
  const rows = [];
  const trRe = /<tr class="(?:odd|even)Row"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const inner = m[1];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tm;
    while ((tm = tdRe.exec(inner)) !== null) {
      cells.push(stripTags(tm[1]).trim());
    }
    if (cells.length < 11) continue;
    const hrefM = inner.match(/ci_ipo_detail\.php\?code=(\d+)/i);
    if (!hrefM) continue;
    const code = String(hrefM[1]).trim().padStart(5, '0');
    if (!code || code === '00000') continue;

    const listDate = normYmd(cells[2]);
    if (!listDate) continue;

    const issuePrice = parsePrice(cells[4]);
    const winRate = parsePct(cells[7]);

    const foRaw = cells[8] || '';
    const firstOpen = foRaw.includes('延迟') ? null : parsePrice(foRaw);

    const closeRaw = cells[9] || '';
    const closePx = parsePrice(closeRaw);

    const cumChg = parsePct(cells[10]);

    rows.push({
      stock_code: code,
      stock_name: cells[1] || '',
      list_date: listDate,
      issue_price: issuePrice,
      win_rate: winRate,
      first_open: firstOpen,
      close: closePx,
      cum_chg_pct: cumChg,
    });
  }
  return rows;
}

async function httpGetText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_FETCH_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!resp.ok) throw new Error(`etnet http ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllIpoInfoRows() {
  const merged = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page <= 1 ? ETNET_IPO_INFO_URL : `${ETNET_IPO_INFO_URL}?page=${page}`;
    const html = await httpGetText(url);
    const chunk = parseEtnetIpoInfoPage(html);
    if (!chunk.length) break;
    let newCount = 0;
    for (const row of chunk) {
      const key = `${row.stock_code}|${row.list_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      newCount += 1;
    }
    if (newCount === 0) break;
  }
  return merged;
}

/**
 * 预热经济通新股信息表（全部分页），供港股首日指标批量查询。
 */
async function warmEtnetHkIpoInfoCache(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (!force && cache.expireAt > now && Array.isArray(cache.rows) && cache.rows.length > 0) {
    return { ok: true, rowCount: cache.rows.length, cached: true };
  }
  if (loadPromise) {
    const rows = await loadPromise;
    return { ok: true, rowCount: rows.length, cached: true, waited: true };
  }
  loadPromise = (async () => {
    const rows = await fetchAllIpoInfoRows();
    cache = { expireAt: Date.now() + CACHE_TTL_MS, rows };
    return rows;
  })();
  try {
    const rows = await loadPromise;
    if (opts.logTag) {
      console.log(`${opts.logTag} 经济通新股信息缓存已加载 rows=${rows.length} ttlMs=${CACHE_TTL_MS}`);
    }
    return { ok: true, rowCount: rows.length, cached: false };
  } catch (e) {
    if (opts.logTag) {
      console.warn(`${opts.logTag} 经济通新股信息加载失败: ${String(e?.message || e)}`);
    }
    throw e;
  } finally {
    loadPromise = null;
  }
}

/**
 * 在已预热（或内部会加载）的缓存中，按代码 + 上市日下限匹配一行（与 Python _fetch_hk_metrics_from_etnet 一致）。
 */
function lookupEtnetHkMetricsRow(stockCode, listDateYmd) {
  const code = String(stockCode || '').trim().padStart(5, '0');
  const listMin = String(listDateYmd || '').trim().slice(0, 10);
  if (!code || code === '00000' || !/^\d{4}-\d{2}-\d{2}$/.test(listMin)) return null;
  const now = Date.now();
  if (!(cache.expireAt > now && Array.isArray(cache.rows) && cache.rows.length)) return null;

  for (const row of cache.rows) {
    if (String(row.stock_code || '').trim().padStart(5, '0') !== code) continue;
    const ld = String(row.list_date || '').trim().slice(0, 10);
    if (!ld || ld < listMin) continue;
    const close = row.close != null && Number.isFinite(Number(row.close)) ? Number(row.close) : null;
    const chgPct = row.cum_chg_pct != null && Number.isFinite(Number(row.cum_chg_pct)) ? Number(row.cum_chg_pct) : null;
    if (close == null || chgPct == null) continue;
    return {
      source: 'etnet.ci_ipo_info.js-cache',
      firstRow: { trade_date: ld, close, chg_pct: chgPct },
      totalShares: null,
      win_rate: row.win_rate != null && Number.isFinite(Number(row.win_rate)) ? Number(row.win_rate) : null,
      issue_price: row.issue_price != null && Number.isFinite(Number(row.issue_price)) ? Number(row.issue_price) : null,
    };
  }
  return null;
}

/**
 * 确保缓存可用后查询单行（若未预热则在此首次拉全表）。
 */
async function fetchHkFirstDayBundleFromEtnet({ stockCode, listDate, logTag }) {
  await warmEtnetHkIpoInfoCache({ logTag });
  return lookupEtnetHkMetricsRow(stockCode, listDate);
}

module.exports = {
  warmEtnetHkIpoInfoCache,
  lookupEtnetHkMetricsRow,
  fetchHkFirstDayBundleFromEtnet,
  parseEtnetIpoInfoPage,
};
