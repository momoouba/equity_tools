const axios = require('axios');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { executeWithRetry } = require('../listing/listingRetry');
const {
  padStockCode,
  eastmoneySecucode,
  reportTypeFromPeriod,
  toNumber,
  listingMarketFromCode,
  median,
  stdev,
  isHistPe,
  isSanePs,
} = require('./marketUtils');
const { LISTED_METRIC_COLS, metricsFromRow, metricInsertValues } = require('./listedMetrics');
const C = require('./constants');

const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://emweb.securities.eastmoney.com/',
};

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

async function emGet(url, params) {
  const { result } = await executeWithRetry(
    async () => {
      const res = await axios.get(url, {
        params,
        headers: EM_HEADERS,
        timeout: 20000,
      });
      return res.data;
    },
    { maxAttempts: 3, baseDelayMs: 800 }
  );
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDatacenterPage({
  reportName,
  filter,
  pageSize = 20,
  pageNumber = 1,
  sortColumns,
  source = 'HSF10',
  client = 'APP',
}) {
  const data = await emGet('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
    reportName,
    columns: 'ALL',
    filter,
    pageNumber,
    pageSize,
    sortTypes: -1,
    sortColumns,
    source,
    client,
  });
  return {
    rows: Array.isArray(data?.result?.data) ? data.result.data : [],
    pages: Number(data?.result?.pages) || 1,
    count: Number(data?.result?.count) || 0,
  };
}

async function fetchDatacenterTable(opts) {
  const { rows } = await fetchDatacenterPage({ ...opts, pageNumber: 1 });
  return rows;
}

async function fetchF10Table(reportName, stockCode, pageSize = 20) {
  return fetchDatacenterTable({
    reportName,
    filter: `(SECURITY_CODE="${padStockCode(stockCode)}")`,
    pageSize,
    sortColumns: 'REPORT_DATE',
    source: 'HSF10',
    client: 'APP',
  });
}

function mapPlRow(row) {
  const revenue = toNumber(pick(row, ['TOTAL_OPERATE_INCOME', 'OPERATE_INCOME', '营业总收入', '营业收入']));
  const cogs = toNumber(pick(row, ['OPERATE_COST', '营业成本']));
  const gpApi = toNumber(pick(row, ['GROSS_PROFIT', 'GROSSPROFIT', 'GROSS_RPOFIT', 'OPERATE_GROSS_PROFIT', '毛利']));
  return {
    revenue,
    cogs,
    gross_profit: gpApi != null ? gpApi : (revenue != null && cogs != null ? revenue - cogs : null),
    tax_surcharge: toNumber(pick(row, ['OPERATE_TAX_ADD', '税金及附加'])),
    selling: toNumber(pick(row, ['SALE_EXPENSE', '销售费用'])),
    admin: toNumber(pick(row, ['MANAGE_EXPENSE', '管理费用'])),
    rd: toNumber(pick(row, ['RESEARCH_EXPENSE', '研发费用'])),
    operating_profit: toNumber(pick(row, ['OPERATE_PROFIT', '营业利润'])),
    net_income: toNumber(pick(row, ['PARENT_NETPROFIT', 'NETPROFIT', '净利润'])),
  };
}

function mapBsRow(row) {
  return {
    cash: toNumber(pick(row, ['MONETARYFUNDS', '货币资金'])),
    notes_receivable: toNumber(pick(row, ['NOTE_RECE', '应收票据'])),
    accounts_receivable: toNumber(pick(row, ['ACCOUNTS_RECE', '应收账款'])),
    prepayment: toNumber(pick(row, ['PREPAYMENT', '预付款项'])),
    inventory: toNumber(pick(row, ['INVENTORY', '存货'])),
    other_current_assets: toNumber(pick(row, ['OTHER_CURRENT_ASSET', '其他流动资产'])),
    current_assets: toNumber(pick(row, ['TOTAL_CURRENT_ASSETS', '流动资产合计'])),
    fixed_assets: toNumber(pick(row, ['FIXED_ASSET', '固定资产'])),
    cip: toNumber(pick(row, ['CIP', '在建工程'])),
    intangible: toNumber(pick(row, ['INTANGIBLE_ASSET', '无形资产'])),
    long_prepaid: toNumber(pick(row, ['LONG_PREPAID_EXPENSE', '长期待摊费用'])),
    deferred_tax_assets: toNumber(pick(row, ['DEFER_TAX_ASSET', '递延所得税资产'])),
    total_assets: toNumber(pick(row, ['TOTAL_ASSETS', '资产总计'])),
    short_term_loan: toNumber(pick(row, ['SHORT_LOAN', '短期借款'])),
    notes_payable: toNumber(pick(row, ['NOTE_PAYABLE', '应付票据'])),
    accounts_payable: toNumber(pick(row, ['ACCOUNTS_PAYABLE', '应付账款'])),
    advance_receipt: toNumber(pick(row, ['ADVANCE_RECEIVABLES', '预收款项'])),
    staff_payable: toNumber(pick(row, ['STAFF_SALARY_PAYABLE', '应付职工薪酬'])),
    tax_payable: toNumber(pick(row, ['TAX_PAYABLE', '应交税费'])),
    long_term_loan: toNumber(pick(row, ['LONG_LOAN', '长期借款'])),
    deferred_income: toNumber(pick(row, ['DEFER_INCOME', '递延收益'])),
    total_liab_equity: toNumber(pick(row, ['TOTAL_LIAB_EQUITY', '负债和所有者权益总计'])),
    equity: toNumber(pick(row, ['TOTAL_PARENT_EQUITY', 'TOTAL_EQUITY', '净资产合计'])),
  };
}

function mapCfRow(row) {
  return {
    cfo: toNumber(pick(row, ['NETCASH_OPERATE', '经营活动产生的现金流量净额'])),
    cfi: toNumber(pick(row, ['NETCASH_INVEST', '投资活动产生的现金流量净额'])),
    cff: toNumber(pick(row, ['NETCASH_FINANCE', '筹资活动产生的现金流量净额'])),
    da: toNumber(pick(row, ['DEPRECIATION_ETC', '折旧摊销'])),
    capex: toNumber(pick(row, ['CONSTRUCT_LONG_ASSET', '购建固定资产、无形资产和其他长期资产支付的现金'])),
    cash_begin: toNumber(pick(row, ['BEGIN_CASH', '期初现金'])),
    cash_end: toNumber(pick(row, ['END_CASH', '期末现金'])),
  };
}

async function upsertStatement({ stockCode, listingMarket, reportPeriod, reportType, statementType, metrics, source }) {
  const exist = await db.query(
    `SELECT F_Id FROM listed_company_financials
     WHERE stock_code = ? AND report_period = ? AND report_type = ? AND statement_type = ?
     LIMIT 1`,
    [stockCode, reportPeriod, reportType, statementType]
  );
  if (exist.length) return { id: exist[0].F_Id, inserted: false };
  const id = await generateId('listed_company_financials');
  const metricPh = LISTED_METRIC_COLS.map(() => '?').join(',');
  await db.execute(
    `INSERT INTO listed_company_financials (
       F_Id, stock_code, listing_market, report_period, report_type, statement_type,
       ${LISTED_METRIC_COLS.join(',')},
       data_source, fetched_at, F_CreatorTime, F_LastModifyTime
     ) VALUES (?,?,?,?,?,?,${metricPh},?,NOW(),NOW(),NOW())`,
    [
      id,
      stockCode,
      listingMarket,
      reportPeriod,
      reportType,
      statementType,
      ...metricInsertValues(metrics),
      source,
    ]
  );
  return { id, inserted: true };
}

const MULTIPLES_HISTORY_START = '2020-09-01';
const MULTIPLES_PAGE_SIZE = 250;
const MULTIPLES_MAX_PAGES = 12;

async function upsertMultipleRow(code, market, row) {
  const date = String(row.TRADE_DATE || row.trade_date || '').slice(0, 10);
  if (!date) return { inserted: false, withPe: false, date: null };
  const pe = toNumber(pick(row, ['PE_TTM', 'pe_ttm', 'PETTM', 'PE_TTM_NEW']));
  const ps = toNumber(pick(row, ['PS_TTM', 'ps_ttm', 'PSTTM', 'PS_TTM_NEW']));
  if (pe == null && ps == null) return { inserted: false, withPe: false, date };
  const exist = await db.query(
    `SELECT F_Id FROM listed_company_market_multiples WHERE stock_code = ? AND trade_date = ? LIMIT 1`,
    [code, date]
  );
  const peLyr = toNumber(pick(row, ['PE_LYR', 'pe_lyr', 'PELYR', 'PE_LAR']));
  const psLyr = toNumber(pick(row, ['PS_LYR', 'ps_lyr', 'PSLYR']));
  const cap = toNumber(pick(row, ['TOTAL_MARKET_CAP', 'market_cap', 'MARKET_CAP_A']));
  if (exist.length) {
    await db.execute(
      `UPDATE listed_company_market_multiples
       SET pe_ttm = COALESCE(pe_ttm, ?), ps_ttm = COALESCE(ps_ttm, ?),
           pe_lyr = COALESCE(pe_lyr, ?), ps_lyr = COALESCE(ps_lyr, ?)
       WHERE F_Id = ?`,
      [pe, ps, peLyr, psLyr, exist[0].F_Id]
    );
    return { inserted: false, withPe: pe != null, date };
  }
  const id = await generateId('listed_company_market_multiples');
  await db.execute(
    `INSERT INTO listed_company_market_multiples (
       F_Id, stock_code, listing_market, trade_date, pe_ttm, pe_lyr, ps_ttm, ps_lyr,
       market_cap, data_source, fetched_at, F_CreatorTime
     ) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [id, code, market, date, pe, peLyr, ps, psLyr, cap, 'eastmoney.valueanalysis']
  );
  return { inserted: true, withPe: pe != null, date };
}

async function eastmoneySuggestCodes(input) {
  try {
    const { result } = await executeWithRetry(
      async () => {
        const res = await axios.get('https://searchapi.eastmoney.com/api/suggest/get', {
          params: {
            input,
            type: 14,
            token: 'D43BF722C8E33BDC906FB84D85E326E8',
            count: 8,
          },
          headers: { ...EM_HEADERS, Referer: 'https://quote.eastmoney.com/' },
          timeout: 20000,
        });
        return res.data;
      },
      { maxAttempts: 2, baseDelayMs: 400 }
    );
    return result?.QuotationCodeTable?.Data || [];
  } catch {
    return [];
  }
}

async function listMultipleFetchAttempts(stockCode, listingMarket) {
  const code = padStockCode(stockCode);
  const market = listingMarket || listingMarketFromCode(code);
  const identities = [{ code, secucode: eastmoneySecucode(code, market) }];
  const suggested = await eastmoneySuggestCodes(code);
  for (const r of suggested) {
    const live = padStockCode(r.Code || r.UnifiedCode);
    if (!live || identities.some((x) => x.code === live)) continue;
    let m = listingMarketFromCode(live) || market;
    if (live.startsWith('8') || live.startsWith('92') || /BJ|NEEQ|京/i.test(String(r.Classify || r.SecurityTypeName || ''))) {
      m = 'bse';
    }
    identities.push({ code: live, secucode: eastmoneySecucode(live, m) });
  }
  const attempts = [];
  const seen = new Set();
  for (const id of identities) {
    for (const a of [
      { filter: `(SECUCODE="${id.secucode}")`, source: 'WEB', client: 'WEB' },
      { filter: `(SECURITY_CODE="${id.code}")`, source: 'WEB', client: 'WEB' },
      { filter: `(SECURITY_CODE="${id.code}")`, source: 'SECURITIES', client: 'WEB' },
    ]) {
      const k = `${a.source}|${a.filter}`;
      if (seen.has(k)) continue;
      seen.add(k);
      attempts.push(a);
    }
  }
  return attempts;
}

async function fetchHistoryMultiples(stockCode, listingMarket, opts = {}) {
  const code = padStockCode(stockCode);
  const market = listingMarket || listingMarketFromCode(code);
  const pageCap = Math.max(1, Number(opts.maxPages) || MULTIPLES_MAX_PAGES);
  try {
    const attempts = await listMultipleFetchAttempts(code, market);
    let attemptUsed = null;
    let firstPage = { rows: [], pages: 1, count: 0 };
    for (const attempt of attempts) {
      try {
        firstPage = await fetchDatacenterPage({
          reportName: 'RPT_VALUEANALYSIS_DET',
          filter: attempt.filter,
          pageSize: MULTIPLES_PAGE_SIZE,
          pageNumber: 1,
          sortColumns: 'TRADE_DATE',
          source: attempt.source,
          client: attempt.client,
        });
      } catch {
        firstPage = { rows: [], pages: 1, count: 0 };
      }
      if (firstPage.rows.length) {
        attemptUsed = attempt;
        break;
      }
    }
    if (!attemptUsed || !firstPage.rows.length) {
      return { ok: false, inserted: 0, message: '历史倍数接口无数据' };
    }
    const pages = Math.min(pageCap, Math.max(1, firstPage.pages || 1));
    let n = 0;
    let withPe = 0;
    let oldest = '9999-99-99';
    for (let page = 1; page <= pages; page += 1) {
      const pack = page === 1
        ? firstPage
        : await fetchDatacenterPage({
          reportName: 'RPT_VALUEANALYSIS_DET',
          filter: attemptUsed.filter,
          pageSize: MULTIPLES_PAGE_SIZE,
          pageNumber: page,
          sortColumns: 'TRADE_DATE',
          source: attemptUsed.source,
          client: attemptUsed.client,
        });
      if (!pack.rows.length) break;
      for (const row of pack.rows) {
        const out = await upsertMultipleRow(code, market, row);
        if (out.date && out.date < oldest) oldest = out.date;
        if (out.withPe) withPe += 1;
        if (out.inserted) n += 1;
      }
      if (oldest <= MULTIPLES_HISTORY_START) break;
      if (page < pages) await sleep(200);
    }
    if (withPe < 2) {
      return { ok: false, inserted: n, message: '历史倍数有效期数不足 2' };
    }
    return { ok: true, inserted: n, oldest };
  } catch (e) {
    return { ok: false, message: e.message || '历史倍数抓取失败' };
  }
}

async function fetchStatementsIfMissing(stockCode, listingMarket, logCtx) {
  const code = padStockCode(stockCode);
  const market = listingMarket || listingMarketFromCode(code);
  const specs = [
    { reportName: 'RPT_F10_FINANCE_GINCOME', type: 'pl', map: mapPlRow },
    { reportName: 'RPT_F10_FINANCE_GBALANCE', type: 'bs', map: mapBsRow },
    { reportName: 'RPT_F10_FINANCE_GCASHFLOW', alt: 'RPT_F10_FINANCE_GCFSTATE', type: 'cf', map: mapCfRow },
  ];
  const warnings = [];
  for (const spec of specs) {
    try {
      let rows = await fetchF10Table(spec.reportName, code, 16);
      if (!rows.length && spec.alt) {
        rows = await fetchF10Table(spec.alt, code, 16);
      }
      for (const row of rows) {
        const period = String(row.REPORT_DATE || row.report_date || '').slice(0, 10);
        if (!period) continue;
        const reportType = reportTypeFromPeriod(period, row.REPORT_TYPE || row.report_type);
        await upsertStatement({
          stockCode: code,
          listingMarket: market,
          reportPeriod: period,
          reportType,
          statementType: spec.type,
          metrics: spec.map(row),
          source: 'eastmoney.f10',
        });
      }
      await writeFetchLog({ ...logCtx, stock_code: code, action: `fetch_${spec.type}`, status: 'success', message: `rows=${rows.length}` });
    } catch (e) {
      warnings.push(`${code} ${spec.type}: ${e.message || '抓取失败'}`);
      await writeFetchLog({ ...logCtx, stock_code: code, action: `fetch_${spec.type}`, status: 'failed', message: e.message });
    }
  }
  return warnings;
}

async function writeFetchLog({ case_id, job_id, stock_code, action, status, message }) {
  try {
    const id = await generateId('valuation_fetch_log');
    await db.execute(
      `INSERT INTO valuation_fetch_log (F_Id, case_id, job_id, stock_code, action, status, message, F_CreatorTime)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [id, case_id || null, job_id || null, stock_code || null, action || null, status || null, message ? String(message).slice(0, 1000) : null]
    );
  } catch (e) {
    console.warn('[valuation fetch log]', e.message);
  }
}

async function loadCompanyFinancialBundle(stockCode) {
  const code = padStockCode(stockCode);
  const statements = await db.query(
    `SELECT stock_code, report_period, report_type, statement_type, ${LISTED_METRIC_COLS.join(', ')}
     FROM listed_company_financials
     WHERE stock_code = ?
     ORDER BY report_period DESC`,
    [code]
  );
  const multiples = await db.query(
    `SELECT stock_code, trade_date, pe_ttm, pe_lyr, ps_ttm, ps_lyr, market_cap, quality_warning
     FROM listed_company_market_multiples
     WHERE stock_code = ?
     ORDER BY trade_date ASC`,
    [code]
  );
  const latest = multiples.length ? multiples[multiples.length - 1] : null;
  return {
    statements: statements.map((s) => ({
      ...s,
      metrics: metricsFromRow(s),
    })),
    multiples,
    latest_multiple: latest,
    quality_warning: latest?.quality_warning || null,
  };
}

const INDUSTRY_FETCH_MISSING_CAP = 20;

function parseEm2016(em2016) {
  const parts = String(em2016 || '').split('-').map((s) => s.trim()).filter(Boolean);
  return { l1: parts[0] || '', l2: parts[1] || '', l3: parts[2] || '' };
}

function matchSwIndustry(row, name) {
  const q = String(name || '').trim();
  if (!q) return false;
  if (row.sw_industry_l3 === q || row.sw_industry_l2 === q || row.sw_industry_l1 === q) return true;
  return String(row.em2016 || '').includes(q);
}

function sigmaBand(values) {
  const mid = median(values);
  if (mid == null) return { min: null, median: null, max: null };
  const sd = stdev(values);
  const lo = sd == null ? mid : mid - sd;
  return {
    min: lo != null && lo < 0.01 ? 0.01 : lo,
    median: mid,
    max: mid,
  };
}

async function fetchEm2016Members(name) {
  const q = String(name || '').trim().replace(/["'\\;]/g, '');
  if (!q) return [];
  const data = await emGet('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
    reportName: 'RPT_F10_BASIC_ORGINFO',
    columns: 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,EM2016',
    filter: `(INSTR(EM2016,"${q}")>0)`,
    pageNumber: 1,
    pageSize: 5000,
    sortTypes: 1,
    sortColumns: 'SECURITY_CODE',
    source: 'HSF10',
    client: 'PC',
  });
  const rows = Array.isArray(data?.result?.data) ? data.result.data : [];
  return rows.map((row) => {
    const code = padStockCode(row.SECURITY_CODE);
    const em2016 = String(row.EM2016 || '').trim();
    const { l1, l2, l3 } = parseEm2016(em2016);
    return {
      stock_code: code,
      stock_name: row.SECURITY_NAME_ABBR || '',
      em2016,
      sw_industry_l1: l1,
      sw_industry_l2: l2,
      sw_industry_l3: l3,
    };
  }).filter((r) => r.stock_code && matchSwIndustry(r, q));
}

async function upsertConstituents(members) {
  for (const row of members) {
    const exist = await db.query(
      'SELECT F_Id FROM valuation_sw_constituent WHERE stock_code = ? LIMIT 1',
      [row.stock_code]
    );
    if (exist.length) {
      await db.execute(
        `UPDATE valuation_sw_constituent
         SET stock_name = ?, em2016 = ?, sw_industry_l1 = ?, sw_industry_l2 = ?, sw_industry_l3 = ?, fetched_at = NOW()
         WHERE F_Id = ?`,
        [row.stock_name || null, row.em2016 || null, row.sw_industry_l1 || null, row.sw_industry_l2 || null, row.sw_industry_l3 || null, exist[0].F_Id]
      );
    } else {
      const id = await generateId('valuation_sw_constituent');
      await db.execute(
        `INSERT INTO valuation_sw_constituent (
           F_Id, stock_code, stock_name, em2016, sw_industry_l1, sw_industry_l2, sw_industry_l3, fetched_at, F_CreatorTime
         ) VALUES (?,?,?,?,?,?,?,NOW(),NOW())`,
        [id, row.stock_code, row.stock_name || null, row.em2016 || null, row.sw_industry_l1 || null, row.sw_industry_l2 || null, row.sw_industry_l3 || null]
      );
    }
  }
}

async function listSwIndustryNames() {
  try {
    const rows = await db.query(
      `SELECT i.sw_industry_l3 AS name,
              i.sw_industry_l1 AS l1,
              i.sw_industry_l2 AS l2,
              COUNT(c.stock_code) AS n
       FROM valuation_sw_industry i
       LEFT JOIN valuation_sw_constituent c
         ON c.sw_industry_l3 = i.sw_industry_l3
       GROUP BY i.sw_industry_l3, i.sw_industry_l1, i.sw_industry_l2
       ORDER BY i.sw_industry_l1 ASC, i.sw_industry_l2 ASC, i.sw_industry_l3 ASC`
    );
    if (rows.length) {
      return rows.map((r) => ({
        name: r.name,
        l1: r.l1 || '',
        l2: r.l2 || '',
        count: Number(r.n) || 0,
      }));
    }
  } catch (e) {
    console.warn('[valuation] listSwIndustryNames', e.message);
  }
  const seed = require('./swIndustryL3Seed');
  return (Array.isArray(seed) ? seed : []).map((r) => ({
    name: r.l3,
    l1: r.l1 || '',
    l2: r.l2 || '',
    count: 0,
  }));
}

async function loadMembersForIndustry(name) {
  const q = String(name || '').trim().replace(/[%_]/g, '');
  if (!q) return [];
  const like = `%${q}%`;
  const local = await db.query(
    `SELECT stock_code, stock_name, em2016, sw_industry_l1, sw_industry_l2, sw_industry_l3
     FROM valuation_sw_constituent
     WHERE sw_industry_l3 = ? OR sw_industry_l2 = ? OR sw_industry_l1 = ? OR em2016 LIKE ?`,
    [q, q, q, like]
  );
  let members = local.filter((r) => matchSwIndustry(r, q));
  if (members.length >= 5) return members;
  try {
    const remote = await fetchEm2016Members(q);
    if (remote.length) {
      await upsertConstituents(remote);
      members = remote;
    }
  } catch (e) {
    console.warn('[valuation] EM2016 industry fetch', e.message);
  }
  return members;
}

async function histMediansForCodes(codes, asOf) {
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  const params = asOf ? [...codes, asOf] : [...codes];
  const dateSql = asOf ? 'AND trade_date <= ?' : '';
  const rows = await db.query(
    `SELECT stock_code, trade_date, pe_ttm, ps_ttm, market_cap
     FROM listed_company_market_multiples
     WHERE stock_code IN (${placeholders}) ${dateSql}
     ORDER BY stock_code ASC, trade_date ASC`,
    params
  );
  const byCode = new Map();
  for (const r of rows) {
    const code = padStockCode(r.stock_code);
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(r);
  }
  const out = [];
  for (const code of codes) {
    const hist = byCode.get(code) || [];
    const peHist = hist.map((x) => toNumber(x.pe_ttm)).filter((n) => isHistPe(n));
    const psHist = hist.map((x) => toNumber(x.ps_ttm)).filter((n) => isSanePs(n));
    const last = hist.length ? hist[hist.length - 1] : null;
    out.push({
      stock_code: code,
      pe_median: median(peHist),
      ps_median: median(psHist),
      pe_latest: last ? toNumber(last.pe_ttm) : null,
      ps_latest: last ? toNumber(last.ps_ttm) : null,
      market_cap: last ? toNumber(last.market_cap) : null,
      usable: hist.length,
    });
  }
  return out;
}

async function upsertIndustryMultiple(row) {
  const exist = await db.query(
    `SELECT F_Id FROM industry_market_multiples
     WHERE sw_industry_l3 = ? AND trade_date = ? AND stat_method = ? LIMIT 1`,
    [row.sw_industry_l3, row.trade_date, row.stat_method]
  );
  if (exist.length) {
    await db.execute(
      `UPDATE industry_market_multiples
       SET pe_median = ?, ps_median = ?, pe_min = ?, pe_max = ?, ps_min = ?, ps_max = ?,
           data_source = ?, fetched_at = NOW()
       WHERE F_Id = ?`,
      [row.pe_median, row.ps_median, row.pe_min, row.pe_max, row.ps_min, row.ps_max, row.data_source, exist[0].F_Id]
    );
    return exist[0].F_Id;
  }
  const id = await generateId('industry_market_multiples');
  await db.execute(
    `INSERT INTO industry_market_multiples (
       F_Id, sw_industry_l3, trade_date, stat_method,
       pe_median, ps_median, pe_min, pe_max, ps_min, ps_max,
       data_source, fetched_at, F_CreatorTime
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [
      id, row.sw_industry_l3, row.trade_date, row.stat_method,
      row.pe_median, row.ps_median, row.pe_min, row.pe_max, row.ps_min, row.ps_max,
      row.data_source,
    ]
  );
  return id;
}

async function ensureIndustryMultiples(swIndustryL3, statMethod, asOfDate, onProgress) {
  const name = String(swIndustryL3 || '').trim();
  const method = statMethod || C.INDUSTRY_ARITH;
  const asOf = String(asOfDate || '').trim().slice(0, 10);
  const progress = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg);
  };
  if (!name) return { unavailable: true, message: '未指定申万三级行业' };
  progress(`拉取申万行业「${name}」成分…`);
  const members = await loadMembersForIndustry(name);
  if (!members.length) {
    return { unavailable: true, message: `未找到申万行业「${name}」的成分股，请改用个股 POOL 或换一个三级名称` };
  }
  const codes = members.map((r) => padStockCode(r.stock_code)).filter(Boolean);
  let stats = await histMediansForCodes(codes, asOf);
  const peLocal = stats.map((s) => s.pe_median).filter((n) => isHistPe(n));
  const psLocal = stats.map((s) => s.ps_median).filter((n) => isSanePs(n));
  const missing = stats.filter((s) => s.usable < 2).map((s) => s.stock_code);
  let fetched = 0;
  if (peLocal.length < 5 && psLocal.length < 5) {
    const todo = missing.slice(0, INDUSTRY_FETCH_MISSING_CAP);
    for (let i = 0; i < todo.length; i += 1) {
      const code = todo[i];
      progress(`行业成分补采历史倍数 ${code}（${i + 1}/${todo.length}）`);
      try {
        await fetchHistoryMultiples(code, listingMarketFromCode(code), { maxPages: 2 });
        fetched += 1;
      } catch (e) {
        console.warn('[valuation] industry hist fetch', code, e.message);
      }
      await sleep(300);
    }
    if (fetched) stats = await histMediansForCodes(codes, asOf);
  }

  const peVals = stats.map((s) => s.pe_median).filter((n) => isHistPe(n));
  const psVals = stats.map((s) => s.ps_median).filter((n) => isSanePs(n));
  if (!peVals.length && !psVals.length) {
    return {
      unavailable: true,
      message: `行业「${name}」有 ${codes.length} 家成分，但库内没有可用历史 PE/PS，请先采集若干可比或改用个股 POOL`,
    };
  }

  let peBand = sigmaBand(peVals);
  let psBand = sigmaBand(psVals);
  if (method === C.INDUSTRY_OVERALL) {
    let capPe = 0;
    let earn = 0;
    let capPs = 0;
    let sales = 0;
    for (const s of stats) {
      const cap = toNumber(s.market_cap);
      const pe = isHistPe(s.pe_latest) ? s.pe_latest : s.pe_median;
      const ps = isSanePs(s.ps_latest) ? s.ps_latest : s.ps_median;
      if (cap != null && cap > 0 && isHistPe(pe)) {
        capPe += cap;
        earn += cap / pe;
      }
      if (cap != null && cap > 0 && isSanePs(ps)) {
        capPs += cap;
        sales += cap / ps;
      }
    }
    if (earn > 0) {
      const overallPe = capPe / earn;
      peBand = { min: peBand.min ?? overallPe, median: overallPe, max: overallPe };
    }
    if (sales > 0) {
      const overallPs = capPs / sales;
      psBand = { min: psBand.min ?? overallPs, median: overallPs, max: overallPs };
    }
  }

  const row = {
    sw_industry_l3: name,
    trade_date: asOf || new Date().toISOString().slice(0, 10),
    stat_method: method,
    pe_median: peBand.median,
    ps_median: psBand.median,
    pe_min: peBand.min,
    pe_max: peBand.max,
    ps_min: psBand.min,
    ps_max: psBand.max,
    data_source: `em2016+local_hist n=${codes.length} pe=${peVals.length} ps=${psVals.length}`,
    constituent_count: codes.length,
    pe_sample: peVals.length,
    ps_sample: psVals.length,
    fetched_missing: fetched,
  };
  try {
    await upsertIndustryMultiple(row);
  } catch (e) {
    console.warn('[valuation] persist industry multiple', e.message);
  }
  return row;
}

async function fetchIndustryMultiples(swIndustryL3, statMethod, asOfDate, onProgress) {
  const method = statMethod || C.INDUSTRY_ARITH;
  if (!swIndustryL3) return { unavailable: true, message: '未指定申万三级行业' };
  const computed = await ensureIndustryMultiples(swIndustryL3, method, asOfDate, onProgress);
  if (computed && !computed.unavailable) return computed;
  const asOf = String(asOfDate || '').trim().slice(0, 10);
  const rows = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? await db.query(
      `SELECT * FROM industry_market_multiples
       WHERE sw_industry_l3 = ? AND stat_method = ? AND trade_date <= ?
       ORDER BY trade_date DESC
       LIMIT 1`,
      [swIndustryL3, method, asOf]
    )
    : await db.query(
      `SELECT * FROM industry_market_multiples
       WHERE sw_industry_l3 = ? AND stat_method = ?
       ORDER BY trade_date DESC
       LIMIT 1`,
      [swIndustryL3, method]
    );
  if (rows.length) return rows[0];
  return computed || { unavailable: true, message: '暂无该申万三级行业 PE/PS 序列，已禁用行业中位数，请改用个股 POOL' };
}

const MIN_USABLE_MULTIPLES = 2;

async function inspectLocalCoverage(stockCode) {
  const code = padStockCode(stockCode);
  const stmts = await db.query(
    `SELECT statement_type, COUNT(*) AS n
     FROM listed_company_financials
     WHERE stock_code = ?
     GROUP BY statement_type`,
    [code]
  );
  const byType = {};
  for (const r of stmts) byType[r.statement_type] = Number(r.n) || 0;
  const mult = await db.query(
    `SELECT COUNT(*) AS n,
            MIN(trade_date) AS mn,
            SUM(CASE WHEN pe_ttm IS NOT NULL OR ps_ttm IS NOT NULL THEN 1 ELSE 0 END) AS usable
     FROM listed_company_market_multiples
     WHERE stock_code = ?`,
    [code]
  );
  const usable = Number(mult[0]?.usable || 0);
  const mnRaw = mult[0]?.mn;
  const mn = mnRaw ? String(mnRaw).slice(0, 10) : null;
  const historyDeepEnough = (mn && mn <= MULTIPLES_HISTORY_START) || usable >= 700;
  return {
    hasPl: (byType.pl || 0) > 0,
    hasBs: (byType.bs || 0) > 0,
    usableMultiples: usable,
    statementsReady: (byType.pl || 0) > 0 && (byType.bs || 0) > 0,
    multiplesReady: usable >= MIN_USABLE_MULTIPLES && historyDeepEnough,
  };
}

async function ensureComparablesFetched(comps, logCtx, onProgress) {
  const warnings = [];
  const notes = [];
  const skipped = [];
  let fetched = 0;
  let i = 0;
  for (const c of comps) {
    i += 1;
    const code = padStockCode(c.stock_code);
    const market = c.listing_market || listingMarketFromCode(code);
    if (typeof onProgress === 'function') onProgress(i, comps.length, code);

    const cov = await inspectLocalCoverage(code);
    if (cov.statementsReady && cov.multiplesReady) {
      skipped.push(code);
      continue;
    }

    fetched += 1;
    if (!cov.statementsReady) {
      const w = await fetchStatementsIfMissing(code, market, logCtx);
      warnings.push(...w);
    }

    if (!cov.multiplesReady) {
      const hist = await fetchHistoryMultiples(code, market);
      const after = await inspectLocalCoverage(code);
      if (!after.multiplesReady) {
        warnings.push(`${code}：历史 PE/PS 不足 2 期，不入 POOL`);
        if (!hist.ok && hist.message) {
          warnings.push(`${code}：${hist.message}`);
        }
      }
    }
    await sleep(400);
  }

  if (skipped.length === (comps || []).length && (comps || []).length) {
    notes.push(`可比 ${skipped.length} 家库内已有财报与历史倍数，已跳过抓取，仅用库内数据重算`);
  } else if (skipped.length) {
    notes.push(`可比 ${skipped.length} 家已有库内数据已跳过抓取，另 ${fetched} 家补采财报/历史倍数`);
  }
  return { warnings, notes, skippedCount: skipped.length, fetchedCount: fetched };
}

module.exports = {
  ensureComparablesFetched,
  fetchHistoryMultiples,
  loadCompanyFinancialBundle,
  fetchIndustryMultiples,
  listSwIndustryNames,
  writeFetchLog,
};
