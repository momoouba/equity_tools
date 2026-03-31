/**
 * ?????????? IPO ??????????????????HTTP + ????? JSON/JSONP ????????????????????????
 * - ???????https://www.szse.cn/api/ras/projectrends/query ??bizType=1 IPO?? * - ????????https://query.sse.com.cn/commonSoaQuery.do ??sqlId=SH_XM_LB?? * - ?????????https://www.bse.cn/projectNewsController/infoResult.do ??JSONP?????????????????? Cookie?? */

const axios = require('axios');
const db = require('../../db');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const axiosJson = axios.create({
  timeout: 60000,
  headers: {
    'User-Agent': UA,
    Accept: 'application/json, text/javascript, */*; q=0.01',
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

function parseJsonpBody(text) {
  const t = String(text || '').trim();
  const m = t.match(/^[\w$]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) {
    throw new Error('??JSONP ?????');
  }
  return JSON.parse(m[1]);
}

function ymdInRange(ymd, startYmd, endYmd) {
  if (!ymd) return false;
  const d = String(ymd).slice(0, 10);
  return d >= startYmd && d <= endYmd;
}

/** SSE updateDate: 20260330100926 */
function sseUpdateToSqlDateTime(s) {
  const x = String(s || '');
  if (x.length < 14) return null;
  const y = x.slice(0, 4);
  const mo = x.slice(4, 6);
  const day = x.slice(6, 8);
  const h = x.slice(8, 10);
  const mi = x.slice(10, 12);
  const se = x.slice(12, 14);
  return `${y}-${mo}-${day} ${h}:${mi}:${se}`;
}

function sseUpdateToYmd(s) {
  const dt = sseUpdateToSqlDateTime(s);
  return dt ? dt.slice(0, 10) : null;
}

function sseAuditApplyToYmd(s) {
  return sseUpdateToYmd(s);
}

/** ??sse ?? statusTransform ????ipo ????*/
function sseStatusToZh(v) {
  const status = String(v.currStatus);
  const subStatus = v.commitiResult != null ? String(v.commitiResult) : '';
  const registeResult = v.registeResult != null ? String(v.registeResult) : '';
  const suspendStatus = v.suspendStatus ? String(v.suspendStatus) : '';
  if (status === '1') return '\u5df2\u53d7\u7406';
  if (status === '2') return '\u5df2\u95ee\u8be2';
  if (status === '3') {
    if (subStatus === '1') return '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u901a\u8fc7';
    if (subStatus === '2') return '\u6709\u6761\u4ef6\u901a\u8fc7';
    if (subStatus === '3') return '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u672a\u901a\u8fc7';
    if (subStatus === '6') return '\u6682\u7f13\u5ba1\u8bae';
    return '\u4e0a\u5e02\u59d4\u4f1a\u8bae';
  }
  if (status === '4') return '\u63d0\u4ea4\u6ce8\u518c';
  if (status === '5') {
    if (registeResult === '1') return '\u6ce8\u518c\u751f\u6548';
    if (registeResult === '2') return '\u4e0d\u4e88\u6ce8\u518c';
    if (registeResult === '3') return '\u7ec8\u6b62\u6ce8\u518c';
    return '\u6ce8\u518c\u7ed3\u679c';
  }
  if (status === '6') return '\u5df2\u53d1\u884c';
  if (status === '7') {
    if (suspendStatus === '1') return '\u4e2d\u6b62(\u8d22\u62a5\u66f4\u65b0)';
    if (suspendStatus === '2') return '\u4e2d\u6b62(\u5176\u4ed6\u4e8b\u9879)';
    return '\u4e2d\u6b62\u53ca\u8d22\u62a5\u66f4\u65b0';
  }
  if (status === '8') return '\u7ec8\u6b62';
  if (status === '9') {
    if (subStatus === '4') return '\u590d\u5ba1\u59d4\u4f1a\u8bae\u901a\u8fc7';
    if (subStatus === '5') return '\u590d\u5ba1\u59d4\u4f1a\u8bae\u672a\u901a\u8fc7';
    return '\u590d\u5ba1\u59d4\u4f1a\u8bae';
  }
  if (status === '10') return '\u8865\u5145\u5ba1\u6838';
  return '-';
}

function ssePlateZh(issueMarketType) {
  const n = Number(issueMarketType);
  if (n === 1) return '\u79d1\u521b\u677f';
  if (n === 2) return '\u4e3b\u677f';
  return '\u4e0a\u4ea4\u6240';
}

async function fetchSzseIpoInRange(startYmd, endYmd) {
  const out = [];
  const pageSize = 100;
  let pageIndex = 0;
  let totalPage = 1;
  while (pageIndex < totalPage && pageIndex < 500) {
    const { data } = await axiosJson.get('https://www.szse.cn/api/ras/projectrends/query', {
      params: {
        bizType: 1,
        pageIndex,
        pageSize,
        random: Math.random(),
      },
      headers: { Referer: 'https://www.szse.cn/listing/projectdynamic/ipo/index.html' },
    });
    if (!data || data.totalPage == null) break;
    totalPage = data.totalPage;
    const rows = data.data || [];
    let minU = '9999-99-99';
    for (const r of rows) {
      const u = r.updtdt ? String(r.updtdt).slice(0, 10) : '';
      if (u && u < minU) minU = u;
      if (!ymdInRange(u, startYmd, endYmd)) continue;
      out.push({
        exchange: '\u6df1\u4ea4\u6240',
        board: r.boardName || (r.boardCode === '16' ? '\u521b\u4e1a\u677f' : '\u4e3b\u677f'),
        company: (r.cmpnm || '').trim(),
        project_name: (r.cmpsnm || '').trim() || (r.cmpnm || '').trim(),
        status: (r.prjst || '').trim() || '-',
        register_address: (r.regloc || '').trim(),
        code: (r.cmpcode || '').trim(),
        receive_date: r.acptdt ? String(r.acptdt).slice(0, 10) : null,
        f_update_time: r.updtdt ? `${String(r.updtdt).slice(0, 10)} 00:00:00` : null,
      });
    }
    if (rows.length === 0) break;
    if (minU !== '9999-99-99' && minU < startYmd) break;
    pageIndex += 1;
  }
  return out;
}

async function fetchSseIpoInRange(startYmd, endYmd) {
  const out = [];
  const pageSize = 25;
  let pageNo = 1;
  let pageCount = 1;
  while (pageNo <= pageCount && pageNo <= 600) {
    const params = {
      sqlId: 'SH_XM_LB',
      isPagination: true,
      'pageHelp.cacheSize': 1,
      'pageHelp.beginPage': 1,
      'pageHelp.endPage': 1,
      'pageHelp.pageSize': pageSize,
      'pageHelp.pageNo': pageNo,
      issueMarketType: '1,2',
      order: 'updateDate|desc,stockAuditNum|desc',
      keyword: '',
      currStatus: '',
      province: '',
      csrcCode: '',
      auditApplyDateBegin: '',
      auditApplyDateEnd: '',
    };
    const { data } = await axiosJson.get('https://query.sse.com.cn/commonSoaQuery.do', {
      params,
      headers: { Referer: 'https://www.sse.com.cn/' },
    });
    const list = data && data.result ? data.result : [];
    const ph = data && data.pageHelp ? data.pageHelp : {};
    pageCount = ph.pageCount || 1;
    let minYmdOnPage = '9999-99-99';
    for (const v of list) {
      const u = sseUpdateToYmd(v.updateDate);
      if (u && u < minYmdOnPage) minYmdOnPage = u;
      if (!u || !ymdInRange(u, startYmd, endYmd)) continue;
      const issuer = v.stockIssuer && v.stockIssuer[0] ? v.stockIssuer[0] : {};
      const company = (issuer.s_issueCompanyFullName || v.stockAuditName || '').trim();
      const fUpdate = sseUpdateToSqlDateTime(v.updateDate);
      const recv = sseAuditApplyToYmd(v.auditApplyDate);
      out.push({
        exchange: '\u4e0a\u4ea4\u6240',
        board: ssePlateZh(v.issueMarketType),
        company,
        project_name: (issuer.s_issueCompanyAbbrName || '').trim() || company,
        status: sseStatusToZh(v),
        register_address: (issuer.s_province || '').trim(),
        code: (issuer.s_companyCode || '').trim(),
        receive_date: recv,
        f_update_time: fUpdate,
      });
    }
    if (list.length === 0) break;
    if (minYmdOnPage !== '9999-99-99' && minYmdOnPage < startYmd) break;
    pageNo += 1;
  }
  return out;
}

let bseCookieHeader = '';

function pickCookiePair(setCookieValue) {
  if (!setCookieValue) return '';
  return String(setCookieValue).split(';')[0].trim();
}

function mergeCookieHeader(origin, extraPairs) {
  const m = new Map();
  const add = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    const idx = t.indexOf('=');
    if (idx <= 0) return;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (!k || !v) return;
    m.set(k, v);
  };
  String(origin || '')
    .split(';')
    .forEach(add);
  (Array.isArray(extraPairs) ? extraPairs : [extraPairs]).forEach(add);
  return Array.from(m.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function ensureBseCookie(forceRefresh = false) {
  if (bseCookieHeader && !forceRefresh) return;
  if (forceRefresh) bseCookieHeader = '';
  const homeRes = await axiosJson.get('https://www.bse.cn/', {
    maxRedirects: 0,
    headers: { Referer: 'https://www.bse.cn/' },
    responseType: 'text',
  });
  const homeSetCookie = homeRes.headers['set-cookie'];
  const headerPairs = (Array.isArray(homeSetCookie) ? homeSetCookie : [homeSetCookie])
    .filter(Boolean)
    .map(pickCookiePair);

  // bse ????? JS ????????document.cookie="C3VK=xxxx; ..."
  const body = String(homeRes.data || '');
  const jsCookieMatches = [...body.matchAll(/document\.cookie\s*=\s*"([^"]+)"/g)];
  const jsPairs = jsCookieMatches.map((m) => pickCookiePair(m[1]));
  bseCookieHeader = mergeCookieHeader('', [...headerPairs, ...jsPairs]);

  // ???????????????????????? cookie???????30x ?????????
  const warmRes = await axiosJson.get('https://www.bse.cn/audit/project_news.html', {
    maxRedirects: 0,
    responseType: 'text',
    headers: {
      Referer: 'https://www.bse.cn/',
      Cookie: bseCookieHeader || undefined,
    },
  });
  const warmSetCookie = warmRes.headers['set-cookie'];
  const warmPairs = (Array.isArray(warmSetCookie) ? warmSetCookie : [warmSetCookie])
    .filter(Boolean)
    .map(pickCookiePair);
  bseCookieHeader = mergeCookieHeader(bseCookieHeader, warmPairs);
}

function bseStatusToZh(code) {
  const m = {
    P01: '\u5df2\u53d7\u7406',
    P02: '\u5df2\u95ee\u8be2',
    P03: '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u901a\u8fc7',
    P04: '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u672a\u901a\u8fc7',
    P05: '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u6682\u7f13',
    P06: '\u63d0\u4ea4\u6ce8\u518c',
    P07: '\u6ce8\u518c',
    P08: '\u4e0d\u4e88\u6ce8\u518c',
    P09: '\u4e2d\u6b62',
    P10: '\u7ec8\u6b62',
  };
  return m[code] || code || '-';
}

function bseTimeToYmd(t) {
  if (t == null) return null;
  if (typeof t === 'object' && t.time != null) {
    const ms = Number(t.time);
    if (!Number.isFinite(ms)) return null;
    // Avoid Intl edge case that may output 24:00:00 at midnight.
    const bj = new Date(ms + 8 * 60 * 60 * 1000);
    const y = bj.getUTCFullYear();
    const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function bseTimeToSqlDateTime(t) {
  if (t == null || typeof t !== 'object' || t.time == null) return null;
  const ms = Number(t.time);
  if (!Number.isFinite(ms)) return null;
  // Build Beijing local datetime with a stable 00-23 hour range.
  const bj = new Date(ms + 8 * 60 * 60 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bj.getUTCDate()).padStart(2, '0');
  const h = String(bj.getUTCHours()).padStart(2, '0');
  const mi = String(bj.getUTCMinutes()).padStart(2, '0');
  const s = String(bj.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mi}:${s}`;
}

async function fetchBseIpoInRange(startYmd, endYmd) {
  await ensureBseCookie();
  const out = [];
  const pageSize = 20;
  let page = 0;
  let totalPages = 1;
  const statetypes = 'P01';
  const needFields = [
    'id',
    'stockCode',
    'stockName',
    'companyName',
    'status',
    'registerAddress',
    'updateDate',
    'receiveDate',
  ].join(',');

  while (page < totalPages && page < 500) {
    const callback = `jsonp_${Date.now()}`;
    const url = 'https://www.bse.cn/projectNewsController/infoResult.do';
    const params = {
      callback,
      page,
      isNewThree: 1,
      sortfield: 'updateDate',
      sorttype: 'desc',
      companyCode: '',
      keyword: '',
      statetypes,
      needFields,
    };
    let resp = await axiosJson.get(url, {
      maxRedirects: 0,
      params,
      headers: {
        Referer: 'https://www.bse.cn/audit/project_news.html',
        Cookie: bseCookieHeader || undefined,
      },
      responseType: 'text',
    });
    // ??????? 302?????/?????? Cookie ?????
    if (resp.status >= 300 && resp.status < 400) {
      await ensureBseCookie(true);
      resp = await axiosJson.get(url, {
        maxRedirects: 0,
        params,
        headers: {
          Referer: 'https://www.bse.cn/audit/project_news.html',
          Cookie: bseCookieHeader || undefined,
        },
        responseType: 'text',
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers?.location || '';
        throw new Error(`????????(${resp.status})${loc ? ` -> ${loc}` : ''}`);
      }
    }
    const raw = resp.data;
    let parsed;
    try {
      parsed = parseJsonpBody(raw);
    } catch (e) {
      throw new Error(`??? JSONP ????: ${e.message}`);
    }
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    const listInfo = pack && pack.listInfo ? pack.listInfo : {};
    totalPages = listInfo.totalPages != null ? Number(listInfo.totalPages) : 1;
    const content = listInfo.content || [];
    let minYmd = '9999-99-99';
    for (const r of content) {
      const u = bseTimeToYmd(r.updateDate);
      if (u && u < minYmd) minYmd = u;
      if (!u || !ymdInRange(u, startYmd, endYmd)) continue;
      out.push({
        exchange: '\u5317\u4ea4\u6240',
        board: '\u5317\u4ea4\u6240',
        company: (r.companyName || '').trim(),
        project_name: (r.stockName || '').trim() || (r.companyName || '').trim(),
        status: bseStatusToZh(r.status),
        register_address: (r.registerAddress || '').trim(),
        code: (r.stockCode || '').trim(),
        receive_date: bseTimeToYmd(r.receiveDate),
        f_update_time: bseTimeToSqlDateTime(r.updateDate),
      });
    }
    if (content.length === 0) break;
    if (minYmd !== '9999-99-99' && minYmd < startYmd) break;
    page += 1;
  }
  return out;
}

async function insertRows(rows, adminId) {
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const company = r.company;
    if (!company) {
      skipped += 1;
      continue;
    }
    const dateStr = r.f_update_time ? String(r.f_update_time).slice(0, 10) : '';
    if (!dateStr) {
      skipped += 1;
      continue;
    }
    const dup = await db.query(
      `SELECT f_id FROM ipo_progress
       WHERE F_DeleteMark = 0 AND exchange = ? AND company = ? AND DATE(f_update_time) = ? LIMIT 1`,
      [r.exchange, company, dateStr]
    );
    if (dup.length) {
      skipped += 1;
      continue;
    }
    await db.execute(
      `INSERT INTO ipo_progress (
        f_create_date, f_update_time, code, project_name, status, register_address, receive_date,
        company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [
        dateStr,
        r.f_update_time || `${dateStr} 00:00:00`,
        r.code || '',
        r.project_name || company,
        r.status || '-',
        r.register_address || '',
        r.receive_date || null,
        company,
        r.board || '',
        r.exchange,
        adminId,
        adminId,
      ]
    );
    inserted += 1;
  }
  return { inserted, skipped };
}

/**
 * @returns {{ inserted: number, skipped: number, fetched: { sse: number, szse: number, bse: number } }}
 */
async function runListingExchangeCrawler({ startDate, endDate }) {
  const adminRows = await db.query(`SELECT id FROM users WHERE account = 'admin' LIMIT 1`);
  const adminId = adminRows[0]?.id;
  if (!adminId) throw new Error('??? account=admin ??????????????');

  const startYmd = String(startDate).trim().slice(0, 10);
  const endYmd = String(endDate).trim().slice(0, 10);
  const start = new Date(`${startYmd}T00:00:00+08:00`);
  const end = new Date(`${endYmd}T23:59:59+08:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error('??????');

  const settled = await Promise.allSettled([
    fetchSzseIpoInRange(startYmd, endYmd),
    fetchSseIpoInRange(startYmd, endYmd),
    fetchBseIpoInRange(startYmd, endYmd),
  ]);
  const labels = ['\u6df1\u4ea4\u6240', '\u4e0a\u4ea4\u6240', '\u5317\u4ea4\u6240'];
  const parts = [[], [], []];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      parts[i] = s.value;
    } else {
      console.error(`[??????] ${labels[i]} ????:`, s.reason?.message || s.reason);
    }
  });
  const merged = [...parts[0], ...parts[1], ...parts[2]];
  const result = await insertRows(merged, adminId);
  return {
    ...result,
    fetched: {
      szse: parts[0].length,
      sse: parts[1].length,
      bse: parts[2].length,
      total: merged.length,
    },
  };
}

module.exports = { runListingExchangeCrawler };
