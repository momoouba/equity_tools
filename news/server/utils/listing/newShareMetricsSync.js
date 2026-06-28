const { spawnSync } = require('child_process');
const path = require('path');
const { fetchHkFirstDayBundleFromEtnet } = require('./etnetHkIpoInfoMetrics');

const IPOAPPLY_CACHE_TTL_MS = Math.max(30_000, Number(process.env.NEW_SHARE_METRICS_IPOAPPLY_CACHE_TTL_MS || 300_000));
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.NEW_SHARE_METRICS_FETCH_TIMEOUT_MS || 20000));
const PY_TIMEOUT_MS = Math.max(10000, Number(process.env.NEW_SHARE_METRICS_PY_TIMEOUT_MS || 45000));
// 港股专用超时配置（更长，因为港股数据源较慢）
const PY_TIMEOUT_MS_HK = Math.max(30000, Number(process.env.NEW_SHARE_METRICS_PY_TIMEOUT_MS_HK || 90000));
let ipoApplyCache = { expireAt: 0, byCode: new Map() };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeACodeCandidates(stockCode) {
  const raw = String(stockCode || '').trim();
  if (!raw) return [];
  const cands = [raw];
  if (/^\d+$/.test(raw)) {
    cands.push(raw.padStart(6, '0'));
    if (raw.length === 5 && /^[894]/.test(raw)) cands.push(`${raw.slice(0, 2)}0${raw.slice(2)}`);
  }
  return [...new Set(cands.filter(Boolean))];
}

function eastmoneySecids(stockCode, market) {
  if (market === 'hk') return [`116.${String(stockCode || '').trim().padStart(5, '0')}`];
  return normalizeACodeCandidates(stockCode).map((c) => (/^6/.test(c) ? `1.${c.padStart(6, '0')}` : `0.${c.padStart(6, '0')}`));
}

function ymd(v) {
  const s = String(v || '').trim();
  return s ? s.slice(0, 10) : '';
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasUsableFirstRow(firstRow) {
  if (!firstRow || typeof firstRow !== 'object') return false;
  const close = toNum(firstRow.close);
  const chgPct = toNum(firstRow.chg_pct);
  return close != null && chgPct != null;
}

async function fetchIpoApplySnapshot(force = false) {
  const now = Date.now();
  if (!force && ipoApplyCache.expireAt > now && ipoApplyCache.byCode.size > 0) {
    return ipoApplyCache.byCode;
  }
  const byCode = new Map();
  const pageSize = 5000;
  let page = 1;
  let totalCount = null;
  while (page <= 20) {
    const u = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
    u.searchParams.set('sortColumns', 'APPLY_DATE,SECURITY_CODE');
    u.searchParams.set('sortTypes', '-1,-1');
    u.searchParams.set('pageSize', String(pageSize));
    u.searchParams.set('pageNumber', String(page));
    u.searchParams.set('reportName', 'RPTA_APP_IPOAPPLY');
    u.searchParams.set(
      'columns',
      'SECURITY_CODE,SECURITY_NAME,LISTING_DATE,ISSUE_PRICE,ISSUE_NUM,TOTAL_ISSUE_NUM,ONLINE_ISSUE_LWR,CLOSE_PRICE,LD_CLOSE_CHANGE,MARKET_TYPE_NEW',
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(u.toString(), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(`ipoapply http ${resp.status}`);
    const payload = await resp.json();
    const result = payload?.result || {};
    const data = result.data || [];
    if (totalCount == null && result.count != null) totalCount = Number(result.count);
    for (const r of data) {
      const code = String(r?.SECURITY_CODE || '').trim();
      if (code) byCode.set(code, r);
      if (code && /^\d+$/.test(code)) byCode.set(code.padStart(6, '0'), r);
    }
    if (!data.length) break;
    if (totalCount != null && byCode.size >= totalCount) break;
    if (data.length < pageSize) break;
    page += 1;
  }
  ipoApplyCache = { expireAt: now + IPOAPPLY_CACHE_TTL_MS, byCode };
  return byCode;
}

async function fetchIpoApplyRowByCode(stockCode) {
  const cands = normalizeACodeCandidates(stockCode).map((c) => c.padStart(6, '0'));
  try {
    const byCode = await fetchIpoApplySnapshot(false);
    const hit = cands.map((c) => byCode.get(c)).find(Boolean);
    if (hit) return hit;
  } catch (_) {
    // fall through to filter API
  }
  for (const cand of cands) {
    const u = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
    u.searchParams.set('reportName', 'RPTA_APP_IPOAPPLY');
    u.searchParams.set('filter', `(SECURITY_CODE='${cand}')`);
    u.searchParams.set('pageSize', '10');
    u.searchParams.set('pageNumber', '1');
    u.searchParams.set(
      'columns',
      'SECURITY_CODE,SECURITY_NAME,LISTING_DATE,ISSUE_PRICE,ISSUE_NUM,TOTAL_ISSUE_NUM,ONLINE_ISSUE_LWR,CLOSE_PRICE,LD_CLOSE_CHANGE,MARKET_TYPE_NEW,APPLY_DATE,UP_DATE,AFTER_ISSUE_PE,ONLINE_APPLY_UPPER',
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(u.toString(), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: ctrl.signal });
      if (!resp.ok) continue;
      const payload = await resp.json();
      const row = (payload?.result?.data || [])[0];
      if (row) return row;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchMetricsFromIpoApplyFast({ stockCode, listDate }) {
  const cands = normalizeACodeCandidates(stockCode).map((c) => c.padStart(6, '0'));
  let row = null;
  try {
    const byCode = await fetchIpoApplySnapshot(false);
    row = cands.map((c) => byCode.get(c)).find(Boolean) || null;
  } catch (_) {
    row = null;
  }
  if (!row) row = await fetchIpoApplyRowByCode(stockCode);
  if (!row) return null;
  const ld = ymd(row.LISTING_DATE);
  if (ld && ld < ymd(listDate)) return null;
  let totalShares = toNum(row.TOTAL_ISSUE_NUM);
  if (totalShares == null) {
    const issueNumWan = toNum(row.ISSUE_NUM);
    if (issueNumWan != null) totalShares = issueNumWan * 10000;
  }
  let winRate = toNum(row.ONLINE_ISSUE_LWR);
  if (winRate != null && winRate <= 1) winRate *= 100;
  return {
    ok: true,
    source: 'eastmoney.datacenter.RPTA_APP_IPOAPPLY.fast-cache',
    firstRow: {
      trade_date: ld || ymd(listDate),
      close: toNum(row.CLOSE_PRICE),
      chg_pct: toNum(row.LD_CLOSE_CHANGE),
    },
    totalShares,
    winRate,
    issuePrice: toNum(row.ISSUE_PRICE),
  };
}

async function fetchEastmoneyFirstRow({ stockCode, listDate, market }) {
  const listYmd = String(listDate || '').slice(0, 10);
  const beg = listYmd.replace(/-/g, '');
  const emAttempts = Math.max(1, Number(process.env.NEW_SHARE_METRICS_EM_ATTEMPTS || 5));
  for (const secid of eastmoneySecids(stockCode, market)) {
    for (let i = 0; i < emAttempts; i += 1) {
      try {
        const end = new Date(`${listYmd}T00:00:00`);
        end.setDate(end.getDate() + 20);
        const endYmd = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(
          end.getDate(),
        ).padStart(2, '0')}`;
        const u = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
        u.searchParams.set('secid', secid);
        u.searchParams.set('klt', '101');
        u.searchParams.set('fqt', '0');
        u.searchParams.set('beg', beg);
        u.searchParams.set('end', endYmd);
        u.searchParams.set('ut', 'fa5fd1943c7b386f172d6893dbfba10b');
        u.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
        u.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        let resp;
        try {
          resp = await fetch(u.toString(), {
            headers: {
              'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
              referer: 'https://quote.eastmoney.com/',
              accept: 'application/json,text/plain,*/*',
            },
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!resp.ok) throw new Error(`em http ${resp.status}`);
        const payload = await resp.json();
        const klines = payload?.data?.klines || [];
        for (const line of klines) {
          const parts = String(line || '').split(',');
          if (parts.length < 9) continue;
          const tradeDate = String(parts[0] || '').slice(0, 10);
          if (!tradeDate || tradeDate < listYmd) continue;
          const close = Number(parts[2]);
          const chgPct = Number(parts[8]);
          return {
            trade_date: tradeDate,
            close: Number.isFinite(close) ? close : null,
            chg_pct: Number.isFinite(chgPct) ? chgPct : null,
          };
        }
        break;
      } catch (_) {
        if (i >= emAttempts - 1) break;
        await sleep(Math.min(12000, 800 * 2 ** i));
      }
    }
  }
  return null;
}

function runNewShareMetricsSync(opts) {
  const stockCode = String(opts.stockCode || '').trim();
  const listDate = String(opts.listDate || '').trim().slice(0, 10);
  const market = String(opts.market || 'a').trim().toLowerCase();
  const logTag = opts.logTag || '[打新日历-首日指标]';
  if (!stockCode || !listDate) {
    return { ok: false, stderr: 'stockCode/listDate invalid' };
  }
  const script = path.join(__dirname, 'new_share_metrics_fetch.py');
  const py = process.env.PYTHON || 'python';
  const args = [script, '--stock-code', stockCode, '--list-date', listDate, '--market', market];
  // 港股使用更长的超时时间
  const pyTimeoutMs = market === 'hk' ? PY_TIMEOUT_MS_HK : PY_TIMEOUT_MS;
  const parsePayload = (text) => {
    try {
      const line = String(text || '').trim().split('\n').filter(Boolean).pop();
      return line ? JSON.parse(line) : null;
    } catch (_) {
      return null;
    }
  };
  const r = spawnSync(py, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    timeout: pyTimeoutMs,
    killSignal: 'SIGTERM',
  });
  if (r.error) return { ok: false, stderr: String(r.error.message || 'spawn error') };
  const payload = parsePayload(r.stdout) || parsePayload(r.stderr);
  if (r.status !== 0) {
    return { ok: false, stderr: String(payload?.error || r.stderr || r.stdout || '').trim() };
  }
  if (!payload || payload.ok !== true) {
    return { ok: false, stderr: String(payload?.error || 'invalid payload') };
  }
  const totalShares =
    payload.totalShares != null && Number.isFinite(Number(payload.totalShares)) ? Number(payload.totalShares) : null;
  const winRate = payload.winRate != null && Number.isFinite(Number(payload.winRate)) ? Number(payload.winRate) : null;
  const issuePrice = payload.issuePrice != null && Number.isFinite(Number(payload.issuePrice)) ? Number(payload.issuePrice) : null;
  return {
    ok: true,
    source: payload.source || null,
    firstRow: payload.firstRow || null,
    totalShares,
    winRate,
    issuePrice,
  };
}

async function runNewShareMetricsSyncWithFallback(opts) {
  const market = String(opts.market || 'a').trim().toLowerCase();
  if (market === 'hk') {
    const hkEtnetFirst = String(process.env.NEW_SHARE_METRICS_HK_ETNET_FIRST || '1') !== '0';
    if (hkEtnetFirst) {
      try {
        const et = await fetchHkFirstDayBundleFromEtnet({
          stockCode: opts.stockCode,
          listDate: opts.listDate,
          logTag: opts.logTag,
        });
        if (et && hasUsableFirstRow(et.firstRow)) {
          return {
            ok: true,
            source: et.source || 'etnet.ci_ipo_info.js-cache',
            firstRow: et.firstRow,
            totalShares: null,
            winRate: et.win_rate != null && Number.isFinite(Number(et.win_rate)) ? Number(et.win_rate) : null,
            issuePrice: et.issue_price != null && Number.isFinite(Number(et.issue_price)) ? Number(et.issue_price) : null,
          };
        }
      } catch (_) {
        // 经济通失败则回退东财 / Python
      }
    }
    const firstRow = await fetchEastmoneyFirstRow({
      stockCode: opts.stockCode,
      listDate: opts.listDate,
      market,
    });
    if (hasUsableFirstRow(firstRow)) {
      return {
        ok: true,
        source: 'eastmoney.push2his.js-fallback',
        firstRow,
        totalShares: null,
        winRate: null,
        issuePrice: null,
      };
    }
    // 默认启用 Python 兜底（含经济通 etnet），仅在显式置 0 时关闭。
    const allowPythonForHk = String(process.env.NEW_SHARE_METRICS_HK_ALLOW_PY || '1') !== '0';
    if (!allowPythonForHk) {
      return { ok: false, stderr: 'hk first row missing/incomplete (js fallback)' };
    }
    const pyResult = runNewShareMetricsSync(opts);
    if (pyResult.ok && hasUsableFirstRow(pyResult.firstRow)) return pyResult;
    if (firstRow) {
      return {
        ok: true,
        source: 'eastmoney.push2his.js-fallback.incomplete',
        firstRow,
        totalShares: pyResult.ok ? pyResult.totalShares ?? null : null,
        winRate: pyResult.ok ? pyResult.winRate ?? null : null,
        issuePrice: pyResult.ok ? pyResult.issuePrice ?? null : null,
      };
    }
    return pyResult;
  }
  if (market !== 'hk') {
    try {
      const fast = await fetchMetricsFromIpoApplyFast(opts);
      if (fast && fast.firstRow) return fast;
    } catch (_) {
      // keep compatibility: fall back to existing python path
    }
  }
  const pyResult = runNewShareMetricsSync(opts);
  if (pyResult.ok && pyResult.firstRow) return pyResult;
  const firstRow = await fetchEastmoneyFirstRow({
    stockCode: opts.stockCode,
    listDate: opts.listDate,
    market,
  });
  if (firstRow)
    return {
      ok: true,
      source: 'eastmoney.push2his.js-fallback',
      firstRow,
      totalShares: pyResult.ok ? pyResult.totalShares : null,
      winRate: pyResult.ok ? pyResult.winRate ?? null : null,
      issuePrice: pyResult.ok ? pyResult.issuePrice ?? null : null,
    };
  return pyResult;
}

module.exports = { runNewShareMetricsSync, runNewShareMetricsSyncWithFallback, fetchIpoApplyRowByCode };

