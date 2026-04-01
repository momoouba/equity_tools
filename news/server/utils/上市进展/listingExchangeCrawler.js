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

/**
 * 接口按「更新日期降序」分页时，应用本页的最大更新日判断是否已无更多可能落在 [startYmd,∞) 的数据。
 * 误用「本页最小更新日 < start」会提前停页：同一页若混有更早的记录，会漏掉后续页里仍在区间内的行。
 */
function shouldStopDescPagedFetch(pageMaxYmd, startYmd) {
  return Boolean(pageMaxYmd && pageMaxYmd < startYmd);
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
    let pageMaxU = '';
    for (const r of rows) {
      const u = r.updtdt ? String(r.updtdt).slice(0, 10) : '';
      if (u && (!pageMaxU || u > pageMaxU)) pageMaxU = u;
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
    if (shouldStopDescPagedFetch(pageMaxU, startYmd)) break;
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
    let pageMaxYmd = '';
    for (const v of list) {
      const u = sseUpdateToYmd(v.updateDate);
      if (u && (!pageMaxYmd || u > pageMaxYmd)) pageMaxYmd = u;
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
    if (shouldStopDescPagedFetch(pageMaxYmd, startYmd)) break;
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
    let pageMaxYmd = '';
    for (const r of content) {
      const u = bseTimeToYmd(r.updateDate);
      if (u && (!pageMaxYmd || u > pageMaxYmd)) pageMaxYmd = u;
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
    if (shouldStopDescPagedFetch(pageMaxYmd, startYmd)) break;
    page += 1;
  }
  return out;
}

function parseRowDateTimeMs(v) {
  if (v == null || v === '') return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.getTime();
}

function stringifyFetchedSampleRow(row, idx) {
  const exchange = row.exchange || '-';
  const board = row.board || '-';
  const company = row.company || '-';
  const projectName = row.project_name || company;
  const status = row.status || '-';
  const fUpdateTime = row.f_update_time || '-';
  const receiveDate = row.receive_date || '-';
  const code = row.code || '-';
  return `  [${idx + 1}] ${exchange} | ${board} | ${company} | 项目=${projectName} | 状态=${status} | 更新=${fUpdateTime} | 受理=${receiveDate} | 代码=${code}`;
}

function logFetchedDetails(logTag, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    console.log(`${logTag} 抓取明细：本次区间内未返回任何记录`);
    return;
  }

  const exchangeCounter = {};
  const exchangeCompanySet = {};
  let minUpdate = '';
  let maxUpdate = '';
  list.forEach((r) => {
    const ex = String(r.exchange || '-').trim() || '-';
    exchangeCounter[ex] = (exchangeCounter[ex] || 0) + 1;
    if (!exchangeCompanySet[ex]) exchangeCompanySet[ex] = new Set();
    if (r.company) exchangeCompanySet[ex].add(String(r.company).trim());
    const t = String(r.f_update_time || '').slice(0, 19);
    if (t) {
      if (!minUpdate || t < minUpdate) minUpdate = t;
      if (!maxUpdate || t > maxUpdate) maxUpdate = t;
    }
  });

  const exchangeSummary = Object.keys(exchangeCounter)
    .sort()
    .map((ex) => `${ex}=${exchangeCounter[ex]}(公司${exchangeCompanySet[ex]?.size || 0})`)
    .join(' / ');
  console.log(
    `${logTag} 抓取明细汇总：总记录=${list.length}；按交易所=${exchangeSummary || '-'}；更新时间范围=${minUpdate || '-'} ~ ${maxUpdate || '-'}`
  );

  const sampleLimit = 20;
  const sampleRows = list.slice(0, sampleLimit);
  const lines = sampleRows.map((r, i) => stringifyFetchedSampleRow(r, i));
  console.log(
    `${logTag} 抓取明细样例（原始抓取，最多${sampleLimit}条）:\n${lines.join('\n')}`
  );
}

/**
 * 业务唯一键：交易所 + 公司全称 + 审核状态 + 上市板块。
 * 同一键只保留「更新时间」最早的一条：库中已有且新数据时间不更早则跳过；新数据更早则整行更新为该快照。
 */
async function insertRows(rows, adminId) {
  let inserted = 0;
  let updatedEarlier = 0;
  let skipped = 0;
  const insertedByExchange = {};
  let skippedNoCompany = 0;
  let skippedNoDate = 0;
  let skippedDupSameOrLater = 0;
  /** @type {{ exchange: string, company: string, project_name: string, status: string, f_update_time: string }[]} */
  const insertedSamples = [];

  for (const r of rows) {
    const company = (r.company || '').trim();
    if (!company) {
      skippedNoCompany += 1;
      skipped += 1;
      continue;
    }
    const dateStr = r.f_update_time ? String(r.f_update_time).slice(0, 10) : '';
    if (!dateStr) {
      skippedNoDate += 1;
      skipped += 1;
      continue;
    }
    const exchange = String(r.exchange || '').trim();
    const status = String(r.status || '-').trim() || '-';
    const board = String(r.board || '').trim();
    const newTs = parseRowDateTimeMs(r.f_update_time || `${dateStr} 00:00:00`);
    if (newTs == null) {
      skippedNoDate += 1;
      skipped += 1;
      continue;
    }

    const existing = await db.query(
      `SELECT f_id, f_update_time FROM ipo_progress
       WHERE F_DeleteMark = 0 AND exchange = ? AND company = ? AND status = ? AND board = ?
       ORDER BY f_update_time ASC LIMIT 1`,
      [exchange, company, status, board]
    );

    if (existing.length) {
      const oldTs = parseRowDateTimeMs(existing[0].f_update_time);
      if (oldTs != null && newTs >= oldTs) {
        skippedDupSameOrLater += 1;
        skipped += 1;
        continue;
      }
      await db.execute(
        `UPDATE ipo_progress SET
          f_create_date = ?, f_update_time = ?, code = ?, project_name = ?, status = ?, register_address = ?,
          receive_date = ?, company = ?, board = ?, exchange = ?,
          F_LastModifyUserId = ?, F_LastModifyTime = NOW()
         WHERE f_id = ? AND F_DeleteMark = 0`,
        [
          dateStr,
          r.f_update_time || `${dateStr} 00:00:00`,
          r.code || '',
          r.project_name || company,
          status,
          r.register_address || '',
          r.receive_date || null,
          company,
          board,
          exchange,
          adminId,
          existing[0].f_id,
        ]
      );
      updatedEarlier += 1;
      const ex = exchange || '-';
      insertedByExchange[ex] = (insertedByExchange[ex] || 0) + 1;
      if (insertedSamples.length < 10) {
        insertedSamples.push({
          exchange: ex,
          company,
          project_name: (r.project_name || company).slice(0, 80),
          status: status.slice(0, 40),
          f_update_time: String(r.f_update_time || '').slice(0, 19),
        });
      }
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
        status,
        r.register_address || '',
        r.receive_date || null,
        company,
        board,
        exchange,
        adminId,
        adminId,
      ]
    );
    inserted += 1;
    const ex = exchange || '-';
    insertedByExchange[ex] = (insertedByExchange[ex] || 0) + 1;
    if (insertedSamples.length < 10) {
      insertedSamples.push({
        exchange: ex,
        company,
        project_name: (r.project_name || company).slice(0, 80),
        status: status.slice(0, 40),
        f_update_time: String(r.f_update_time || '').slice(0, 19),
      });
    }
  }
  return {
    inserted,
    updatedEarlier,
    skipped,
    insertedByExchange,
    skipBreakdown: { skippedNoCompany, skippedNoDate, skippedDupSameOrLater },
    insertedSamples,
  };
}

/**
 * @returns {Promise<object>}
 */
async function runListingExchangeCrawler({ startDate, endDate, logTag = '[上市进展爬虫]' } = {}) {
  const adminRows = await db.query(`SELECT id FROM users WHERE account = 'admin' LIMIT 1`);
  const adminId = adminRows[0]?.id;
  if (!adminId) throw new Error('未找到 account=admin 用户，无法写入上市进展数据');

  const startYmd = String(startDate).trim().slice(0, 10);
  const endYmd = String(endDate).trim().slice(0, 10);
  const start = new Date(`${startYmd}T00:00:00+08:00`);
  const end = new Date(`${endYmd}T23:59:59+08:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('上市进展爬虫：日期区间无效');
  }

  console.log(`${logTag} 开始拉取 日期闭区间=${startYmd}~${endYmd}（按各所「更新日期」筛选落在此区间内）`);

  const settled = await Promise.allSettled([
    fetchSzseIpoInRange(startYmd, endYmd),
    fetchSseIpoInRange(startYmd, endYmd),
    fetchBseIpoInRange(startYmd, endYmd),
  ]);
  const labels = ['深交所', '上交所', '北交所'];
  const parts = [[], [], []];
  /** @type {{ exchange: string, message: string }[]} */
  const exchangeErrors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      parts[i] = s.value;
      console.log(`${logTag} ${labels[i]} 接口返回 ${parts[i].length} 条（区间内）`);
    } else {
      const msg = s.reason?.message || String(s.reason);
      exchangeErrors.push({ exchange: labels[i], message: msg });
      console.error(`${logTag} ${labels[i]} 拉取失败:`, msg);
    }
  });
  const merged = [...parts[0], ...parts[1], ...parts[2]];
  console.log(`${logTag} 三家合并共 ${merged.length} 条，开始去重入库 ipo_progress`);
  logFetchedDetails(logTag, merged);

  const result = await insertRows(merged, adminId);

  const ins = result.insertedByExchange || {};
  const sb = result.skipBreakdown || {};
  const ue = result.updatedEarlier ?? 0;
  console.log(
    `${logTag} 入库完成 新增=${result.inserted} 更正为更早快照=${ue} 跳过=${result.skipped}（无公司名=${sb.skippedNoCompany ?? 0} 无更新日=${sb.skippedNoDate ?? 0} ` +
      `同键已存在且更新时间不更早=${sb.skippedDupSameOrLater ?? 0}） ` +
      `分所写入(新+更正): 深交所=${ins['深交所'] ?? 0} 上交所=${ins['上交所'] ?? 0} 北交所=${ins['北交所'] ?? 0}`
  );
  if (result.insertedSamples && result.insertedSamples.length > 0) {
    const lines = result.insertedSamples.map(
      (s, idx) =>
        `  [${idx + 1}] ${s.exchange} | ${s.company} | ${s.project_name} | 状态=${s.status} | 更新=${s.f_update_time}`
    );
    console.log(`${logTag} 本次写入样例（新插入或更正，最多10条）:\n${lines.join('\n')}`);
  } else if (result.inserted === 0 && ue === 0 && merged.length > 0) {
    console.log(
      `${logTag} 本次无写入（同交易所+公司+状态+板块已存在且本条更新时间未更早）`
    );
  }

  return {
    ...result,
    fetched: {
      szse: parts[0].length,
      sse: parts[1].length,
      bse: parts[2].length,
      total: merged.length,
    },
    exchangeErrors,
  };
}

module.exports = { runListingExchangeCrawler };
