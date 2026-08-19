const C = require('./constants');
const { toNumber, median, stdev, minMax, yuanToYi, isHistPe, isSanePs, beijingYmd, resolveValuationDate, parseYmd } = require('./marketUtils');
const { nwcStockFromBs } = require('./targetBsFields');

function num(v, fallback = 0) {
  const n = toNumber(v);
  return n == null ? fallback : n;
}

function safeDiv(a, b) {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x == null || y == null || y === 0) return null;
  return x / y;
}

function pvFactor(rate, t) {
  const r = num(rate, 0);
  if (r <= -1) return 0;
  return 1 / (1 + r) ** t;
}

function percentileSet(values) {
  const arr = (values || []).map(toNumber).filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return { min: null, median: null, max: null };
  return {
    min: arr[0],
    median: median(arr),
    max: arr[arr.length - 1],
  };
}

function waccFromBreakdown(breakdown, fallbackRate, incomeTaxRate) {
  const b = breakdown || {};
  const rf = toNumber(b.risk_free_rate);
  const erp = toNumber(b.erp);
  const beta = toNumber(b.beta);
  const deIn = toNumber(b.debt_equity);
  const kdIn = toNumber(b.debt_cost);
  const any = [rf, erp, beta, deIn, kdIn].some((x) => x != null);
  if (rf == null || erp == null || beta == null) {
    return { rate: num(fallbackRate, 0.3), used_breakdown: false, incomplete: any };
  }
  const de = deIn == null ? 0 : deIn;
  const kd = kdIn == null ? 0 : kdIn;
  const tax = num(b.tax_rate, num(incomeTaxRate, 0.15));
  const ke = rf + beta * erp;
  const we = 1 / (1 + de);
  const wd = de / (1 + de);
  const wacc = we * ke + wd * kd * (1 - tax);
  return { rate: wacc, used_breakdown: true, incomplete: false, ke, we, wd, tax };
}

function yearOnYear(curr, prev) {
  const a = toNumber(curr);
  const b = toNumber(prev);
  if (a == null || b == null || b === 0) return null;
  return a / b - 1;
}

function compactYearSeries(obj, valueKeys, yearsKey = 'years') {
  if (!obj || typeof obj !== 'object') return obj || {};
  const years = Array.isArray(obj[yearsKey]) ? obj[yearsKey] : [];
  const n = Math.max(years.length, ...valueKeys.map((k) => (Array.isArray(obj[k]) ? obj[k].length : 0)));
  const keep = [];
  for (let i = 0; i < n; i += 1) {
    const y = years[i];
    if (y == null || String(y).trim() === '') continue;
    const has = valueKeys.some((k) => {
      const n = toNumber(obj[k]?.[i]);
      return n != null && n !== 0;
    });
    if (has) keep.push(i);
  }
  if (!keep.length) return obj;
  const out = { ...obj, [yearsKey]: keep.map((i) => years[i]) };
  for (const k of valueKeys) {
    if (Array.isArray(obj[k])) out[k] = keep.map((i) => obj[k][i]);
  }
  return out;
}

function extrapolatePl(pl, forecastYears, taxRate) {
  const years = Array.isArray(pl?.years) ? [...pl.years] : [];
  const revenue = Array.isArray(pl?.revenue) ? [...pl.revenue] : [];
  const cogs = Array.isArray(pl?.cogs) ? [...pl.cogs] : [];
  const selling = Array.isArray(pl?.selling) ? [...pl.selling] : [];
  const admin = Array.isArray(pl?.admin) ? [...pl.admin] : [];
  const rd = Array.isArray(pl?.rd) ? [...pl.rd] : [];
  const opProfit = Array.isArray(pl?.operating_profit) ? [...pl.operating_profit] : [];
  const ni = Array.isArray(pl?.net_income) ? [...pl.net_income] : [];
  const growth = Array.isArray(pl?.revenue_growth) ? [...pl.revenue_growth] : [];
  const n = Math.max(1, Number(forecastYears) || 5);

  while (years.length < n) {
    const lastYear = years.length ? Number(String(years[years.length - 1]).slice(0, 4)) : new Date().getFullYear();
    years.push(String(lastYear + 1));
  }

  let lastGrowth = null;
  for (let i = 1; i < revenue.length; i += 1) {
    const g = yearOnYear(revenue[i], revenue[i - 1]);
    if (g != null) lastGrowth = g;
  }
  if (growth.length) {
    const gLast = toNumber(growth[growth.length - 1]);
    if (gLast != null) lastGrowth = gLast;
  }
  if (lastGrowth == null) lastGrowth = 0.2;
  let growthCapped = false;
  if (lastGrowth > 1 || lastGrowth < -0.5) {
    growthCapped = true;
    lastGrowth = Math.min(1, Math.max(-0.5, lastGrowth));
  }

  const lastRevBefore = (idx) => {
    for (let i = idx - 1; i >= 0; i -= 1) {
      const v = toNumber(revenue[i]);
      if (v != null) return v;
    }
    return 0;
  };

  for (let i = 0; i < revenue.length; i += 1) {
    if (toNumber(revenue[i]) != null) continue;
    if (i === 0) continue;
    const prev = lastRevBefore(i);
    const g = toNumber(growth[i]) ?? lastGrowth;
    revenue[i] = prev * (1 + g);
    growth[i] = g;
    if (toNumber(ni[i]) === 0) ni[i] = null;
    if (toNumber(opProfit[i]) === 0) opProfit[i] = null;
  }

  const lastRev = () => {
    for (let i = revenue.length - 1; i >= 0; i -= 1) {
      if (toNumber(revenue[i]) != null) return num(revenue[i]);
    }
    return 0;
  };

  const ratioOf = (arr, baseArr) => {
    const ratios = [];
    for (let i = 0; i < arr.length; i += 1) {
      const r = safeDiv(arr[i], baseArr[i]);
      if (r != null) ratios.push(r);
    }
    return ratios.length ? median(ratios) : null;
  };

  const sellRatio = toNumber(pl?.selling_ratio) ?? ratioOf(selling, revenue) ?? 0.1;
  const adminRatio = toNumber(pl?.admin_ratio) ?? ratioOf(admin, revenue) ?? 0.08;
  const rdRatio = toNumber(pl?.rd_ratio) ?? ratioOf(rd, revenue) ?? 0.05;
  const gm = toNumber(pl?.gross_margin);
  const cogsRatio = gm != null ? 1 - gm : (ratioOf(cogs, revenue) ?? 0.6);

  while (revenue.length < n) {
    const prev = lastRev() || (revenue.length ? num(revenue[revenue.length - 1]) : 0);
    const g = toNumber(growth[revenue.length]) ?? lastGrowth;
    revenue.push(prev * (1 + g));
    growth[revenue.length - 1] = g;
  }
  while (cogs.length < n) cogs.push(num(revenue[cogs.length]) * cogsRatio);
  while (selling.length < n) selling.push(num(revenue[selling.length]) * sellRatio);
  while (admin.length < n) admin.push(num(revenue[admin.length]) * adminRatio);
  while (rd.length < n) rd.push(num(revenue[rd.length]) * rdRatio);

  const gross = [];
  const ebit = [];
  const net = [];
  for (let i = 0; i < n; i += 1) {
    const rev = num(revenue[i]);
    const gp = rev - num(cogs[i]);
    gross[i] = gp;
    const op = toNumber(opProfit[i]);
    const computedOp = gp - num(selling[i]) - num(admin[i]) - num(rd[i]);
    ebit[i] = op != null ? op : computedOp;
    const givenNi = toNumber(ni[i]);
    const tax = num(taxRate, 0.15);
    net[i] = givenNi != null ? givenNi : ebit[i] * (1 - (ebit[i] > 0 ? tax : 0));
  }

  return {
    years: years.slice(0, n),
    revenue: revenue.slice(0, n),
    cogs: cogs.slice(0, n),
    gross_profit: gross,
    selling: selling.slice(0, n),
    admin: admin.slice(0, n),
    rd: rd.slice(0, n),
    operating_profit: ebit,
    net_income: net,
    revenue_growth: years.slice(0, n).map((_, i) => (
      i === 0 ? (toNumber(growth[0]) ?? null) : yearOnYear(revenue[i], revenue[i - 1])
    )),
    selling_ratio: sellRatio,
    admin_ratio: adminRatio,
    rd_ratio: rdRatio,
    gross_margin: 1 - cogsRatio,
    growth_capped: growthCapped,
  };
}

function buildFcfSeries(pl, extras, method, taxRate, esop) {
  const n = pl.years.length;
  const da = Array.isArray(extras?.da) ? extras.da : [];
  const capex = Array.isArray(extras?.capex) ? extras.capex : [];
  const dnwc = Array.isArray(extras?.dnwc) ? extras.dnwc : [];
  const fcf = [];
  for (let t = 0; t < n; t += 1) {
    const daT = num(da[t], extras?.da_default ?? 0);
    const capexT = num(capex[t], extras?.capex_default ?? 0);
    const dnwcT = num(dnwc[t], extras?.dnwc_default ?? 0);
    const esopT = num(esop, 0);
    if (method === C.FCF_NOPAT) {
      const ebit = num(pl.operating_profit[t]);
      const nopat = ebit * (1 - (ebit > 0 ? num(taxRate, 0.15) : 0));
      fcf.push(nopat + daT - dnwcT - capexT);
    } else {
      fcf.push(num(pl.net_income[t]) + daT + esopT - capexT - dnwcT);
    }
  }
  return fcf;
}

function runDcf({
  pl,
  fcf,
  discountRate,
  terminalType,
  exitPe,
  exitPs,
  netDebt,
  liquidityDiscount,
  applyLiquidity,
  originYear,
}) {
  const n = fcf.length;
  const r = num(discountRate, 0.3);
  const pvs = [];
  let ev = 0;
  for (let t = 0; t < n; t += 1) {
    const periods = discountPeriod(pl.years[t], originYear, t + 1);
    const fac = pvFactor(r, periods);
    const pv = num(fcf[t]) * fac;
    pvs.push({ year: pl.years[t], fcf: fcf[t], factor: fac, pv, periods });
    ev += pv;
  }
  const terminalBase = terminalType === C.TERMINAL_PS
    ? num(pl.revenue[n - 1])
    : num(pl.net_income[n - 1]);
  const exitMultiple = terminalType === C.TERMINAL_PS ? num(exitPs, 20) : num(exitPe, 40);
  const tv = exitMultiple * terminalBase;
  const tvPeriods = discountPeriod(pl.years[n - 1], originYear, n);
  const tvPv = tv * pvFactor(r, tvPeriods);
  ev += tvPv;
  let equity = ev - num(netDebt, 0);
  if (applyLiquidity) equity *= (1 - num(liquidityDiscount, 0.3));
  return {
    fcf,
    pvs,
    terminal_year: pl.years[n - 1] || null,
    terminal_base_kind: terminalType === C.TERMINAL_PS ? 'revenue' : 'net_income',
    terminal_base: terminalBase,
    exit_multiple: exitMultiple,
    terminal_value: tv,
    terminal_pv: tvPv,
    enterprise_value: ev,
    net_debt: num(netDebt, 0),
    equity_value: equity,
    equity_value_yi: yuanToYi(equity),
  };
}

function sensitivityGrid({
  axes,
  pl,
  extras,
  method,
  taxRate,
  esop,
  discountRate,
  terminalType,
  exitPe,
  exitPs,
  netDebt,
  liquidityDiscount,
  applyLiquidity,
  originYear,
}) {
  const baseExit = terminalType === C.TERMINAL_PS ? num(exitPs, 20) : num(exitPe, 40);
  const baseRate = num(discountRate, 0.3);
  const growths = pl.revenue_growth.map((g) => toNumber(g)).filter((g) => g != null);
  const baseCagr = growths.length ? median(growths) : 0.2;

  // 默认敏感性：退出倍数 0.5x～1.5x，收入 CAGR 以中位为中心 ±5%（2.5% 步长）
  const exitCols = [baseExit * 0.5, baseExit * 0.75, baseExit, baseExit * 1.25, baseExit * 1.5];
  const cagrRows = [baseCagr - 0.05, baseCagr - 0.025, baseCagr, baseCagr + 0.025, baseCagr + 0.05];
  const waccRows = [baseRate - 0.05, baseRate - 0.025, baseRate, baseRate + 0.025, baseRate + 0.05].map((x) => Math.max(0.01, x));

  let rowLabels;
  let colLabels;
  let rowKind;
  let colKind;
  if (axes === C.SENS_EXIT_WACC) {
    rowKind = 'wacc';
    colKind = 'exit';
    rowLabels = waccRows;
    colLabels = exitCols;
  } else if (axes === C.SENS_WACC_EXIT) {
    rowKind = 'exit';
    colKind = 'wacc';
    rowLabels = exitCols;
    colLabels = waccRows;
  } else {
    rowKind = 'cagr';
    colKind = 'exit';
    rowLabels = cagrRows;
    colLabels = exitCols;
  }

  const grid = [];
  for (let i = 0; i < rowLabels.length; i += 1) {
    const row = [];
    for (let j = 0; j < colLabels.length; j += 1) {
      const rv = rowLabels[i];
      const cv = colLabels[j];
      let rate = baseRate;
      let exitM = baseExit;
      let cagr = baseCagr;
      if (rowKind === 'wacc') rate = rv;
      if (rowKind === 'exit') exitM = rv;
      if (rowKind === 'cagr') cagr = rv;
      if (colKind === 'wacc') rate = cv;
      if (colKind === 'exit') exitM = cv;
      if (colKind === 'cagr') cagr = cv;

      const adjPl = { ...pl, revenue: [...pl.revenue], net_income: [...pl.net_income], operating_profit: [...pl.operating_profit] };
      if (rowKind === 'cagr' || colKind === 'cagr') {
        const r0 = num(pl.revenue[0]);
        for (let t = 1; t < adjPl.revenue.length; t += 1) {
          adjPl.revenue[t] = r0 * (1 + cagr) ** t;
          const scale = safeDiv(adjPl.revenue[t], pl.revenue[t]) || 1;
          adjPl.net_income[t] = num(pl.net_income[t]) * scale;
          adjPl.operating_profit[t] = num(pl.operating_profit[t]) * scale;
        }
      }
      const fcf = buildFcfSeries(adjPl, extras, method, taxRate, esop);
      const dcf = runDcf({
        pl: adjPl,
        fcf,
        discountRate: rate,
        terminalType,
        exitPe: terminalType === C.TERMINAL_PE ? exitM : exitPe,
        exitPs: terminalType === C.TERMINAL_PS ? exitM : exitPs,
        netDebt,
        liquidityDiscount,
        applyLiquidity,
        originYear,
      });
      row.push(dcf.equity_value);
    }
    grid.push(row);
  }

  const lastR = grid.length - 1;
  const lastC = (grid[0] || []).length - 1;
  const cornerIdx = lastR >= 3 && lastC >= 3
    ? [[1, 1], [1, 3], [3, 1], [3, 3]]
    : [[0, 0], [0, lastC], [lastR, 0], [lastR, lastC]];
  const corners = cornerIdx
    .map(([i, j]) => toNumber(grid[i]?.[j]))
    .filter((n) => n != null);
  const low = corners.length ? Math.min(...corners) : null;
  const high = corners.length ? Math.max(...corners) : null;

  return {
    axes,
    row_kind: rowKind,
    col_kind: colKind,
    row_labels: rowLabels,
    col_labels: colLabels,
    grid,
    low,
    high,
    formula: '二维敏感性：退出倍数 0.5x～1.5x、收入 CAGR ±5%；结果对比 DCF 低端/高端取内圈四角，不是整张表最外极端点',
  };
}

function periodIso(period) {
  if (period instanceof Date && !Number.isNaN(period.getTime())) {
    const y = period.getFullYear();
    const mo = String(period.getMonth() + 1).padStart(2, '0');
    const da = String(period.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const s = String(period || '');
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = s.replace(/[^\d]/g, '');
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return s;
}

function fiscalYearFromPeriod(period) {
  const iso = periodIso(period);
  if (iso && /^\d{4}/.test(iso)) return iso.slice(0, 4);
  const s = String(period || '').replace(/[^\d]/g, '');
  if (s.length >= 4 && /^\d{4}/.test(s)) return s.slice(0, 4);
  return null;
}

function reportTypeRank(reportType) {
  const t = String(reportType || '').toLowerCase();
  if (t === 'annual') return 3;
  if (t === 'q3') return 2;
  if (t === 'q1') return 1;
  return 0;
}

function ytdAnnualizeFactor(reportType) {
  const t = String(reportType || '').toLowerCase();
  if (t === 'q1') return 4;
  if (t === 'interim') return 2;
  if (t === 'q3') return 4 / 3;
  return 1;
}

function stmtField(s, field) {
  if (!s) return null;
  const m = s.metrics || {};
  return toNumber(m[field] ?? s[field]);
}

function latestOfType(statements, statementType) {
  const list = (statements || []).filter((s) => s.statement_type === statementType);
  list.sort((a, b) => periodIso(b.report_period).localeCompare(periodIso(a.report_period)));
  return list[0] || null;
}

function findPl(pls, year, reportType) {
  const y = String(year);
  const t = String(reportType || '').toLowerCase();
  return (pls || []).find((s) => (
    fiscalYearFromPeriod(s.report_period) === y
    && String(s.report_type || '').toLowerCase() === t
  )) || null;
}

/**
 * A 股利润表为年初至今累计。截至某期的 TTM：
 * 上年年报 + 本期累计 − 去年同期累计。
 * 缺去年同期时：Q1×4 / 中报×2 / Q3×4/3；再缺则退回上年年报。
 */
function ttmYtdItem(pls, field, asOf) {
  if (!asOf) return null;
  const year = Number(fiscalYearFromPeriod(asOf.report_period));
  const t = String(asOf.report_type || '').toLowerCase();
  const current = stmtField(asOf, field);
  if (t === 'annual') return current;
  if (Number.isFinite(year)) {
    const priorAnnual = stmtField(findPl(pls, year - 1, 'annual'), field);
    const priorStub = stmtField(findPl(pls, year - 1, t), field);
    if (current != null && priorAnnual != null && priorStub != null) {
      return priorAnnual + current - priorStub;
    }
  }
  if (current != null) return current * ytdAnnualizeFactor(t);
  if (Number.isFinite(year)) return stmtField(findPl(pls, year - 1, 'annual'), field);
  return null;
}

function turnoverDays(ttmFlow, stock) {
  const flow = toNumber(ttmFlow);
  const st = toNumber(stock);
  if (flow == null || flow === 0 || st == null) return null;
  return 360 / (flow / Math.max(st, 1e-9));
}

function computeComparableStats(compsFinancials, opts = {}) {
  const asOfYmd = resolveValuationDate(opts.asOfDate);
  const feeMedians = { selling: [], admin: [], rd: [] };
  const gmByCompany = [];
  const wc = { dso: [], dpo: [], dio: [] };
  const relative = [];

  for (const c of compsFinancials || []) {
    const pls = (c.statements || []).filter((s) => s.statement_type === 'pl');
    const annual = pls.filter((s) => s.report_type !== 'interim');
    const sellingRates = [];
    const adminRates = [];
    const rdRates = [];
    const gmByYear = new Map();
    for (const s of annual) {
      const m = s.metrics || {};
      const rev = toNumber(m.revenue);
      if (!rev) continue;
      const sell = toNumber(m.selling);
      const adm = toNumber(m.admin);
      const rd = toNumber(m.rd);
      const gp = toNumber(m.gross_profit) ?? (rev - num(m.cogs));
      if (sell != null) sellingRates.push(sell / rev);
      if (adm != null) adminRates.push(adm / rev);
      if (rd != null) rdRates.push(rd / rev);
      if (gp == null) continue;
      const year = fiscalYearFromPeriod(s.report_period);
      if (!year) continue;
      const rank = reportTypeRank(s.report_type);
      const prev = gmByYear.get(year);
      if (!prev || rank >= prev.rank) gmByYear.set(year, { value: gp / rev, rank });
    }
    feeMedians.selling.push(median(sellingRates));
    feeMedians.admin.push(median(adminRates));
    feeMedians.rd.push(median(rdRates));
    const years = [...gmByYear.keys()].sort();
    const gms = years.map((y) => gmByYear.get(y).value);
    const byYear = {};
    const grossMargins = years.map((y) => {
      byYear[y] = gmByYear.get(y).value;
      return { year: y, value: gmByYear.get(y).value };
    });
    gmByCompany.push({
      stock_code: c.stock_code,
      stock_name: c.stock_name,
      gross_margins: grossMargins,
      by_year: byYear,
      latest: years.length ? gmByYear.get(years[years.length - 1]).value : null,
      median: median(gms),
    });

    const latestBs = latestOfType(c.statements, 'bs');
    const asOfPl = latestBs
      ? (findPl(pls, fiscalYearFromPeriod(latestBs.report_period), latestBs.report_type) || latestOfType(c.statements, 'pl'))
      : latestOfType(c.statements, 'pl');
    const revTtm = ttmYtdItem(pls, 'revenue', asOfPl);
    const cogsTtm = ttmYtdItem(pls, 'cogs', asOfPl);
    const dso = turnoverDays(revTtm, stmtField(latestBs, 'accounts_receivable'));
    const dpo = turnoverDays(cogsTtm, stmtField(latestBs, 'accounts_payable'));
    const dio = turnoverDays(cogsTtm, stmtField(latestBs, 'inventory'));
    if (dso != null) wc.dso.push(dso);
    if (dpo != null) wc.dpo.push(dpo);
    if (dio != null) wc.dio.push(dio);

    const sliced = multiplesOnOrBefore(c.multiples, asOfYmd);
    const latestRow = sliced.length ? sliced[sliced.length - 1] : null;
    const peHist = sliced.map((x) => toNumber(x.pe_ttm)).filter((n) => isHistPe(n));
    const psHist = sliced.map((x) => toNumber(x.ps_ttm)).filter((n) => isSanePs(n));
    const peLatest = latestRow?.pe_ttm ?? (peHist.length ? peHist[peHist.length - 1] : null);
    const psLatest = latestRow?.ps_ttm ?? (psHist.length ? psHist[psHist.length - 1] : null);
    const asofTrade = tradeDateYmd(latestRow?.trade_date) || null;
    const peMed = median(peHist);
    const psMed = median(psHist);
    const peSd = stdev(peHist);
    const psSd = stdev(psHist);
    const peUsable = isHistPe(peMed) || isHistPe(peLatest);
    const psUsable = isSanePs(psMed) || isSanePs(psLatest);
    const extraWarn = [];
    if (peMed != null && peMed < 0) extraWarn.push('PE 历史中位为负，仍计入 POOL（对齐底稿亏损股）');
    else if (!peUsable && (peLatest != null || peMed != null)) extraWarn.push('PE 为负或极端，不参与 POOL 倍数');
    if (!psUsable && (psLatest != null || psMed != null)) extraWarn.push('PS 为负或极端，不参与 POOL 倍数');
    if (peHist.length < 2 && psHist.length < 2) extraWarn.push('仅 1 期倍数，无法计算 σ / ±1σ');
    if (!asofTrade) extraWarn.push(`锚定日 ${asOfYmd} 及以前无倍数截面`);
    else if (asofTrade < asOfYmd) extraWarn.push(`锚定日无交易，已用 ${asofTrade} 截面`);
    const peOverride = toNumber(c.pe_median_override);
    const psOverride = toNumber(c.ps_median_override);
    if (peOverride != null) extraWarn.push('PE 已用底稿中位进 POOL');
    if (psOverride != null) extraWarn.push('PS 已用底稿中位进 POOL');
    relative.push({
      stock_code: c.stock_code,
      stock_name: c.stock_name,
      asof_date: parseYmd(asOfYmd) || beijingYmd(),
      asof_trade_date: parseYmd(asofTrade),
      pe_latest: peLatest,
      pe_median: peMed,
      pe_median_override: peOverride,
      pe_stdev: peSd,
      pe_minus_1s: peMed != null && peSd != null ? peMed - peSd : null,
      pe_plus_1s: peMed != null && peSd != null ? peMed + peSd : null,
      pe_usable: peOverride != null ? true : peUsable,
      ps_latest: psLatest,
      ps_median: psMed,
      ps_median_override: psOverride,
      ps_stdev: psSd,
      ps_minus_1s: psMed != null && psSd != null ? psMed - psSd : null,
      ps_plus_1s: psMed != null && psSd != null ? psMed + psSd : null,
      ps_usable: psOverride != null ? true : psUsable,
      quality_warning: [c.quality_warning, ...extraWarn].filter(Boolean).join('；') || null,
      in_pool: !!c.in_pool,
    });
  }

  return {
    fees: {
      selling_median: median(feeMedians.selling),
      admin_median: median(feeMedians.admin),
      rd_median: median(feeMedians.rd),
      formula: '三费：各公司多期费率中位数（默认排除半年报）→ 可比集中位数',
    },
    gross_margin: {
      companies: gmByCompany,
      set_median: median(gmByCompany.map((x) => x.median)),
      formula: '毛利率：按公司、按年及最新一期，汇总中位数',
    },
    working_capital: {
      dso_median: median(wc.dso),
      dpo_median: median(wc.dpo),
      dio_median: median(wc.dio),
      formula: 'DSO=360/(TTM营收/净应收)；DPO/DIO 用 TTM 营业成本。TTM=上年年报+本期累计−去年同期，缺同期则按报告期年化（Q1×4）',
    },
    relative,
  };
}

function yearNum(y) {
  const n = Number(String(y || '').replace(/[^\d]/g, '').slice(0, 4));
  return Number.isFinite(n) && n >= 1900 ? n : null;
}

function modelOriginYear(rawPl) {
  for (const y of rawPl?.years || []) {
    const n = yearNum(y);
    if (n != null) return n;
  }
  return null;
}

/** 折现原点：预测期第一年 = 第 1 期。已实现年已含在净负债/现金里，不再折进 EV。 */
function dcfOriginYear(rawPl, asOf) {
  const years = rawPl?.years || [];
  const fromForecast = yearNum(years[firstForecastIndex(rawPl, asOf)]);
  if (fromForecast != null) return fromForecast;
  return modelOriginYear(rawPl);
}

function discountPeriod(year, originYear, fallbackT) {
  const y = yearNum(year);
  const origin = Number(originYear);
  if (y == null || !Number.isFinite(origin)) return fallbackT;
  return Math.max(1, y - origin + 1);
}

function tradeDateYmd(v) {
  return parseYmd(v) || '';
}

function multiplesOnOrBefore(multiples, asOfYmd) {
  return (multiples || []).filter((x) => {
    const d = tradeDateYmd(x.trade_date);
    return d && d <= asOfYmd;
  });
}

function asOfDateObj(ymd) {
  return new Date(`${resolveValuationDate(ymd)}T12:00:00+08:00`);
}

function latestCompletedFiscalYear(asOf = new Date()) {
  return asOf.getFullYear() - 1;
}

function lastFilledYearIndex(rawPl) {
  const revs = rawPl?.revenue || [];
  let idx = 0;
  for (let i = 0; i < revs.length; i += 1) {
    const n = toNumber(revs[i]);
    if (n != null && n !== 0) idx = i;
  }
  return idx;
}

/** 市场法基数：优先锚定日所在财年（有营收）；否则最近已实现年；再没有则最后已填年。 */
function marketBaseYearIndex(rawPl, asOf) {
  const years = rawPl?.years || [];
  const revs = rawPl?.revenue || [];
  const completed = latestCompletedFiscalYear(asOf);
  const asOfYear = asOf instanceof Date && Number.isFinite(asOf.getTime())
    ? asOf.getFullYear()
    : completed + 1;
  const n = Math.max(years.length, revs.length);
  let lastFilled = 0;
  let hist = null;
  let asOfIdx = null;
  for (let i = 0; i < n; i += 1) {
    const r = toNumber(revs[i]);
    if (r == null || r === 0) continue;
    lastFilled = i;
    const y = yearNum(years[i]);
    if (y != null && y === asOfYear) asOfIdx = i;
    if (y != null && y <= completed) hist = i;
  }
  if (asOfIdx != null) return asOfIdx;
  return hist != null ? hist : lastFilled;
}

function firstForecastIndex(rawPl, asOf) {
  const completed = latestCompletedFiscalYear(asOf);
  const years = rawPl?.years || [];
  for (let i = 0; i < years.length; i += 1) {
    const y = yearNum(years[i]);
    if (y != null && y > completed) return i;
  }
  return 0;
}

function slicePlFrom(pl, startIdx) {
  if (!startIdx) return pl || {};
  const keys = ['years', 'revenue', 'cogs', 'selling', 'admin', 'rd', 'operating_profit', 'net_income', 'revenue_growth', 'gross_profit'];
  const out = { ...(pl || {}) };
  for (const k of keys) {
    if (Array.isArray(pl?.[k])) out[k] = pl[k].slice(startIdx);
  }
  return out;
}

function alignCfToYears(targetCf, years, overrides) {
  const cfYears = (targetCf?.years || []).map((y) => String(y || ''));
  const pick = (arr, year) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    const j = year != null ? cfYears.findIndex((cy) => cy === String(year)) : -1;
    if (j >= 0 && toNumber(arr[j]) != null) return arr[j];
    return null;
  };
  const fillForward = (arr) => {
    let last = null;
    return arr.map((v) => {
      const n = toNumber(v);
      if (n != null) last = n;
      return n != null ? n : last;
    });
  };
  const da = [];
  const capex = [];
  const dnwc = [];
  (years || []).forEach((year) => {
    da.push(pick(targetCf?.da, year));
    capex.push(pick(targetCf?.capex, year));
    dnwc.push(pick(targetCf?.dnwc, year));
  });
  return {
    da: fillForward(da),
    capex: fillForward(capex),
    dnwc: fillForward(dnwc),
    da_default: num(overrides?.da ?? targetCf?.da_default, 0),
    capex_default: num(overrides?.capex ?? targetCf?.capex_default, 0),
    dnwc_default: num(overrides?.dnwc ?? targetCf?.dnwc_default, 0),
  };
}

/** POOL 各公司历史中位数 → MEDIAN / STDEV。不剔除公司；σ 对超过 3×中位的点截尾（避免极端高倍数把 −1σ 打成负数）。 */
function poolSigmaSet(pool, medianKey, latestKey, saneFn, overrideKey) {
  const raw = [];
  let insane = 0;
  for (const r of pool || []) {
    const ov = overrideKey ? toNumber(r[overrideKey]) : null;
    if (ov != null) {
      raw.push(ov);
      continue;
    }
    const med = toNumber(r[medianKey]);
    const latest = toNumber(r[latestKey]);
    const v = med != null ? med : latest;
    if (v == null || !Number.isFinite(v)) continue;
    if (typeof saneFn === 'function' && !saneFn(v)) {
      insane += 1;
      continue;
    }
    raw.push(v);
  }
  const mid = median(raw);
  const capped = mid != null && mid > 0
    ? raw.map((v) => {
      if (v > mid * 3) return mid * 3;
      if (v > 0 && v < mid / 3) return mid / 3;
      return v;
    })
    : raw;
  const sd = stdev(capped);
  let min = mid != null && sd != null ? mid - sd : mid;
  const max = mid != null && sd != null ? mid + sd : mid;
  let clamped = false;
  if (min != null && min <= 0) {
    min = 0.01;
    clamped = true;
  }
  return {
    min,
    median: mid,
    max,
    dropped: insane,
    clamped,
    sigma_winsorized: raw.some((v, i) => v !== capped[i]),
  };
}

function explicitMultipleSet(minV, medianV) {
  const median = toNumber(medianV);
  if (median == null) return null;
  const min = toNumber(minV);
  return {
    min: min != null ? min : median,
    median,
    max: median,
  };
}

function defaultMarketMultipleSets({ multipleSource, poolRelatives, industryMultiples }) {
  if (multipleSource === C.MULTIPLE_INDUSTRY && industryMultiples) {
    return {
      peSet: {
        min: toNumber(industryMultiples.pe_min) ?? toNumber(industryMultiples.pe_median),
        median: toNumber(industryMultiples.pe_median),
        max: toNumber(industryMultiples.pe_max) ?? toNumber(industryMultiples.pe_median),
      },
      psSet: {
        min: toNumber(industryMultiples.ps_min) ?? toNumber(industryMultiples.ps_median),
        median: toNumber(industryMultiples.ps_median),
        max: toNumber(industryMultiples.ps_max) ?? toNumber(industryMultiples.ps_median),
      },
      peWarnings: [],
      psWarnings: [],
    };
  }
  const pool = (poolRelatives || []).filter((r) => r.in_pool);
  const peSet = poolSigmaSet(pool, 'pe_median', 'pe_latest', isHistPe, 'pe_median_override');
  const psSet = poolSigmaSet(pool, 'ps_median', 'ps_latest', isSanePs, 'ps_median_override');
  const peWarnings = [];
  const psWarnings = [];
  if (peSet.dropped) peWarnings.push(`已排除 ${peSet.dropped} 家负 PE/极端 PE，不参与市场法 P/E 的 ±1σ`);
  if (peSet.clamped) peWarnings.push('POOL P/E −1σ 为负，低端倍数已按 0.01x 处理');
  if (peSet.sigma_winsorized) peWarnings.push('计算 P/E 的 σ 时，超过 3×中位的倍数已截尾（公司仍留在 POOL）');
  if (peSet.median == null) peWarnings.push('POOL 中无可用 P/E 历史中位，市场法 P/E 为空');
  if (psSet.dropped) psWarnings.push(`已排除 ${psSet.dropped} 家负 PS/极端 PS，不参与市场法 P/S 的 ±1σ`);
  if (psSet.clamped) psWarnings.push('POOL P/S −1σ 为负，低端倍数已按 0.01x 处理');
  if (psSet.sigma_winsorized) psWarnings.push('计算 P/S 的 σ 时，超过 3×中位的倍数已截尾（公司仍留在 POOL，不再整段剔除）');
  if (psSet.median == null) psWarnings.push('POOL 中无可用 P/S 历史中位，市场法 P/S 为空');
  return { peSet, psSet, peWarnings, psWarnings };
}

function marketMethod({
  multipleSource,
  poolRelatives,
  industryMultiples,
  pl,
  liquidityDiscount,
  baseYearIndex,
  multipleBand,
}) {
  const maxIdx = Math.max(0, (pl.years || []).length - 1);
  const lastIdx = Math.min(Math.max(0, baseYearIndex == null ? maxIdx : baseYearIndex), maxIdx);
  const revenue = toNumber(pl.revenue?.[lastIdx]);
  const ni = toNumber(pl.net_income?.[lastIdx]);
  const op = toNumber(pl.operating_profit?.[lastIdx]);
  const peBase = ni != null ? ni : num(op);
  const warnings = [];
  if (peBase < 0) warnings.push('利润为负，P/E 仅供参考');

  const defaults = defaultMarketMultipleSets({
    multipleSource,
    poolRelatives,
    industryMultiples,
  });
  const peBand = explicitMultipleSet(multipleBand?.pe_min, multipleBand?.pe_median);
  const psBand = explicitMultipleSet(multipleBand?.ps_min, multipleBand?.ps_median);
  const peSet = peBand || defaults.peSet;
  const psSet = psBand || defaults.psSet;
  if (peBand || psBand) {
    warnings.push('市场法倍数已按填写值覆盖 POOL 的 −1σ / 中位');
  }
  if (!peBand) warnings.push(...defaults.peWarnings);
  if (!psBand) warnings.push(...defaults.psWarnings);

  const d = num(liquidityDiscount, 0.3);
  const apply = (multiple, base) => {
    const circ = (toNumber(multiple) == null || base == null) ? null : toNumber(multiple) * base;
    const illiq = circ == null ? null : circ * (1 - d);
    return { circulating: circ, illiquid: illiq, illiquid_yi: yuanToYi(illiq) };
  };

  const peLow = apply(peSet.min, peBase);
  const peMid = apply(peSet.median, peBase);
  const peHigh = apply(peSet.max, peBase);
  const psLow = apply(psSet.min, revenue);
  const psMid = apply(psSet.median, revenue);
  const psHigh = apply(psSet.max, revenue);

  return {
    pe_multiples: peSet,
    ps_multiples: psSet,
    pool_pe_multiples: defaults.peSet,
    pool_ps_multiples: defaults.psSet,
    revenue_base: revenue,
    operating_profit_base: peBase,
    net_income_base: ni,
    base_year: pl.years?.[lastIdx] || null,
    liquidity_discount: d,
    pe: { low: peLow, mid: peMid, high: peHigh },
    ps: { low: psLow, mid: psMid, high: psHigh },
    warnings,
    formula: '流通基础权益=倍数×基数；非流通=流通×(1−市场法缺乏流动性折扣)。P/S、P/E 基数优先用锚定日所在年，无则已实现年。倍数默认取可比 POOL（低端=中位−σ，高端=中位）；改过市场法倍数则覆盖 POOL',
  };
}

function resultComparison({ market, dcfPrimary, dcfSecondary, scenarioMode }) {
  const psLow = market?.ps?.low?.illiquid ?? null;
  const psHigh = market?.ps?.mid?.illiquid ?? null;
  const peLow = market?.pe?.low?.illiquid ?? null;
  const peHigh = market?.pe?.mid?.illiquid ?? null;
  const dcfLow = dcfPrimary?.sensitivity?.low ?? dcfPrimary?.equity_value ?? null;
  const dcfHigh = dcfPrimary?.sensitivity?.high ?? dcfPrimary?.equity_value ?? null;

  const row = (low, high) => ({
    low,
    increment: (low != null && high != null) ? high - low : null,
    high,
  });

  const dcfCol = scenarioMode === C.SCENARIO_DUAL
    ? {
        ma: {
          ...row(dcfPrimary?.sensitivity?.low, dcfPrimary?.sensitivity?.high),
          name: dcfPrimary?.scenario_name || '并购预期',
        },
        ipo: {
          ...row(dcfSecondary?.sensitivity?.low, dcfSecondary?.sensitivity?.high),
          name: dcfSecondary?.scenario_name || '上市预期',
        },
      }
    : row(dcfLow, dcfHigh);

  return {
    rows: ['low', 'increment', 'high'],
    market_ps: row(psLow, psHigh),
    market_pe: row(peLow, peHigh),
    dcf: dcfCol,
    display_yi: {
      market_ps: {
        low: yuanToYi(psLow),
        increment: yuanToYi((psLow != null && psHigh != null) ? psHigh - psLow : null),
        high: yuanToYi(psHigh),
      },
      market_pe: {
        low: yuanToYi(peLow),
        increment: yuanToYi((peLow != null && peHigh != null) ? peHigh - peLow : null),
        high: yuanToYi(peHigh),
      },
      dcf: scenarioMode === C.SCENARIO_DUAL
        ? {
            ma: {
              low: yuanToYi(dcfCol.ma.low),
              increment: yuanToYi(dcfCol.ma.increment),
              high: yuanToYi(dcfCol.ma.high),
            },
            ipo: {
              low: yuanToYi(dcfCol.ipo.low),
              increment: yuanToYi(dcfCol.ipo.increment),
              high: yuanToYi(dcfCol.ipo.high),
            },
          }
        : {
            low: yuanToYi(dcfLow),
            increment: yuanToYi((dcfLow != null && dcfHigh != null) ? dcfHigh - dcfLow : null),
            high: yuanToYi(dcfHigh),
          },
    },
    formula: scenarioMode === C.SCENARIO_DUAL
      ? '增量=高端−低端。市场法 P/S、P/E 仍用同一套（低端=POOL −1σ、高端=中位，均×(1−市场法折扣)）。DCF 并购扣并购折扣，上市不扣'
      : '增量=高端−低端（堆叠区间，不是第三种方法）。市场法低端=POOL −1σ×基数×(1−市场法折扣)，高端=POOL 中位×基数×(1−市场法折扣)',
  };
}

function netDebtFromBs(bs, overrideYuan) {
  const cash = toNumber(bs?.cash);
  const st = toNumber(bs?.short_term_loan);
  const lt = toNumber(bs?.long_term_loan);
  const hasBs = cash != null || st != null || lt != null;
  if (hasBs) {
    return {
      net_debt: num(st) + num(lt) - num(cash),
      source: 'bs',
      warning: null,
    };
  }
  if (toNumber(overrideYuan) != null) {
    return { net_debt: num(overrideYuan), source: 'manual', warning: null };
  }
  return {
    net_debt: 0,
    source: 'missing_bs',
    warning: '缺少资产负债表，净负债已按 0，请补录货币资金与借款',
  };
}

/** 单套净利润桥不扣流动性；双情景时并购扣、上市不扣。NOPAT 单套仍扣。 */
function dcfApplyLiquidity(method, scenarioKey) {
  if (method?.scenario_mode === C.SCENARIO_DUAL) return scenarioKey === 'ma';
  return method?.fcf_method === C.FCF_NOPAT;
}

/** 并购 DCF / NOPAT 用独立折扣；未填时回退市场法折扣，避免旧草稿变成 0。 */
function resolveDcfLiquidityDiscount(assumptions) {
  const n = toNumber(assumptions?.dcf_liquidity_discount);
  if (n != null) return n;
  return num(assumptions?.liquidity_discount, 0.3);
}

function collectTieOutWarnings({ pl, extras, bs }) {
  const warnings = [];
  const WAN = 10000;
  const nwcStock = nwcStockFromBs(bs);
  const years = pl?.years || [];
  const dnwcs = years.map((_, t) => Math.abs(num(extras?.dnwc?.[t], extras?.dnwc_default)));
  const maxDnwc = dnwcs.length ? Math.max(0, ...dnwcs) : 0;
  if (nwcStock != null && maxDnwc > Math.abs(nwcStock) * 3 + WAN) {
    warnings.push(`勾稽：各年营运资本增加最大 ${(maxDnwc / WAN).toFixed(0)} 万，远大于资产负债表占用 ${(nwcStock / WAN).toFixed(0)} 万。请确认现金流量表填的是「增加额」而不是期末余额`);
  }
  if (nwcStock != null && Math.abs(nwcStock) > WAN && years.length >= 2) {
    const allClose = years.every((_, t) => {
      const v = num(extras?.dnwc?.[t], extras?.dnwc_default);
      return Math.abs(v - nwcStock) / Math.abs(nwcStock) < 0.08;
    });
    if (allClose) {
      warnings.push('勾稽：各年「营运资本增加」与资产负债表期末占用几乎相同，可能把余额当成了增加额');
    }
  }
  if (nwcStock != null && maxDnwc === 0 && Math.abs(nwcStock) > WAN) {
    warnings.push('勾稽：资产负债表有营运资本占用，但现金流量表营运资本增加为 0。DCF 未扣 ΔNWC');
  }
  return warnings;
}

function runValuationEngine(input) {
  const method = input.methodConfig || {};
  const assumptions = input.assumptions || {};
  const warnings = [...(input.warnings || [])];
  const taxRate = num(assumptions.tax_rate, 0.15);
  const forecastYears = Math.max(1, Number(assumptions.forecast_years) || 5);
  const wacc = waccFromBreakdown(assumptions.wacc_breakdown, assumptions.discount_rate, taxRate);
  const discountRate = wacc.rate;
  if (wacc.incomplete) {
    warnings.push('WACC 分项未填齐无风险利率、ERP、Beta，仍用汇总折现率');
  }
  if (wacc.used_breakdown) {
    warnings.push(`折现率已用 WACC 分项 ${(wacc.rate * 100).toFixed(1)}%（Ke=${(wacc.ke * 100).toFixed(1)}%）`);
  }

  const asOfYmd = resolveValuationDate(assumptions.valuation_date);
  const asOf = asOfDateObj(asOfYmd);
  warnings.push(`市场法按锚定日 ${asOfYmd} 及以前各股历史中位（无中位则回退该日截面）`);
  const rawPl = compactYearSeries(input.targetPl || {}, [
    'revenue', 'cogs', 'selling', 'admin', 'rd', 'operating_profit', 'net_income', 'revenue_growth', 'gross_profit',
  ]);
  const rawCf = compactYearSeries(input.targetCf || {}, ['da', 'capex', 'dnwc']);
  const droppedPlYears = (input.targetPl?.years || [])
    .map((y) => String(y || '').trim())
    .filter((y) => y && !(rawPl.years || []).map((x) => String(x)).includes(y));
  if (droppedPlYears.length) {
    warnings.push(`已跳过无有效数字的年份 ${droppedPlYears.join('、')}，不按 0 插入外推`);
  }
  const originYear = dcfOriginYear(rawPl, asOf);
  const baseYearIndex = marketBaseYearIndex(rawPl, asOf);
  const forecastStart = firstForecastIndex(rawPl, asOf);
  const marketBaseYear = yearNum(rawPl.years?.[baseYearIndex]);
  const asOfYear = asOf.getFullYear();
  if (marketBaseYear != null && marketBaseYear === asOfYear) {
    warnings.push(`市场法基数用锚定日所在年 ${marketBaseYear}`);
  } else if (marketBaseYear != null && marketBaseYear > asOfYear) {
    warnings.push(`利润表没有锚定年 ${asOfYear} 的营收，市场法基数暂用 ${marketBaseYear}，P/S、P/E 会偏高。请补录锚定年或已实现年`);
  }
  const forecastRaw = slicePlFrom(rawPl, forecastStart);
  const firstForecastYear = yearNum(forecastRaw.years?.[0]);
  if (firstForecastYear != null) {
    warnings.push(`DCF 以预测首年 ${firstForecastYear} 为第 1 期（已实现年不折现）`);
  }
  const yoyA = toNumber(forecastRaw.revenue?.[0]);
  const yoyB = toNumber(forecastRaw.revenue?.[1]);
  const filledYoy = yearOnYear(yoyB, yoyA);
  const pl = extrapolatePl(forecastRaw, forecastYears, taxRate);
  if (filledYoy != null && Math.abs(filledYoy) > 1) {
    warnings.push('已填两年营业收入增速超过 100%，请核对第 2 年是否多写一个 0（如 73550 写成 735500）');
  } else if (pl.growth_capped) {
    warnings.push('利润表相邻两年收入增速超过 ±50%~100%，外推已封顶。请检查是否多填了一个 0');
  }
  const firstRev = toNumber(input.targetPl?.revenue?.[0]) ?? toNumber(pl.revenue?.[0]);
  if (firstRev != null && firstRev > 1e11) {
    warnings.push('营业收入超过 1000 亿元，请确认利润表是否按万元录入（不要把「元」数字再填进万元框）');
  }
  if (input.compStats?.fees) {
    if (toNumber(input.targetPl?.selling_ratio) == null && input.compStats.fees.selling_median != null) {
      pl.selling_ratio = input.compStats.fees.selling_median;
    }
  }

  const extras = alignCfToYears(rawCf, pl.years, input.overrides);
  if (!extras.capex.length && extras.capex_default === 0 && extras.dnwc_default === 0 && extras.da_default === 0) {
    warnings.push('现金流量表三项（折旧摊销 / 资本性支出 / 营运资本增加）当前为 0，DCF 将按「仅用净利润±终值」计算');
  }

  const nd = netDebtFromBs(input.targetBs, input.overrides?.net_debt);
  if (nd.warning) warnings.push(nd.warning);
  if (nd.net_debt < 0) {
    warnings.push('净负债为负（净现金）。DCF 按该净现金加回权益；请按万元核对货币资金与短贷/长贷');
  }
  warnings.push(...collectTieOutWarnings({ pl, extras, bs: input.targetBs }));

  const fcfMethod = method.fcf_method || C.FCF_NI_BRIDGE;
  const terminalType = method.terminal_type || C.TERMINAL_PE;
  const axes = method.sensitivity_axes || C.SENS_EXIT_CAGR;

  const runOne = (scenario, scenarioKey) => {
    const rate = num(scenario?.discount_rate, discountRate);
    const exitPe = num(scenario?.exit_pe, assumptions.exit_pe);
    const exitPs = num(scenario?.exit_ps, assumptions.exit_ps);
    const applyScenarioLiq = dcfApplyLiquidity(method, scenarioKey);
    const dcfLiq = resolveDcfLiquidityDiscount(assumptions);
    const fcf = buildFcfSeries(pl, extras, fcfMethod, taxRate, assumptions.esop);
    const dcf = runDcf({
      pl,
      fcf,
      discountRate: rate,
      terminalType,
      exitPe,
      exitPs,
      netDebt: nd.net_debt,
      liquidityDiscount: dcfLiq,
      applyLiquidity: applyScenarioLiq,
      originYear,
    });
    const sensitivity = sensitivityGrid({
      axes,
      pl,
      extras,
      method: fcfMethod,
      taxRate,
      esop: assumptions.esop,
      discountRate: rate,
      terminalType,
      exitPe,
      exitPs,
      netDebt: nd.net_debt,
      liquidityDiscount: dcfLiq,
      applyLiquidity: applyScenarioLiq,
      originYear,
    });
    return {
      ...dcf,
      sensitivity,
      scenario_name: scenario?.name || null,
      discount_rate: rate,
      apply_liquidity: applyScenarioLiq,
      liquidity_discount: dcfLiq,
    };
  };

  if (method.scenario_mode === C.SCENARIO_DUAL) {
    warnings.push('并购 DCF 用「并购流动性折扣」，上市 DCF 不扣。市场法 P/S、P/E 只用「市场法流动性折扣」');
  }

  const primary = runOne(
    method.scenario_mode === C.SCENARIO_DUAL
      ? (input.scenarios?.ma || { name: '并购预期' })
      : { name: '基准', discount_rate: discountRate, exit_pe: assumptions.exit_pe, exit_ps: assumptions.exit_ps },
    method.scenario_mode === C.SCENARIO_DUAL ? 'ma' : 'base'
  );
  const secondary = method.scenario_mode === C.SCENARIO_DUAL
    ? runOne(input.scenarios?.ipo || { name: '上市预期' }, 'ipo')
    : null;

  const market = marketMethod({
    multipleSource: method.multiple_source,
    poolRelatives: input.compStats?.relative,
    industryMultiples: input.industryMultiples,
    pl: rawPl,
    liquidityDiscount: assumptions.liquidity_discount,
    baseYearIndex,
    multipleBand: {
      pe_min: assumptions.pe_low_multiple,
      pe_median: assumptions.pe_median_multiple,
      ps_min: assumptions.ps_low_multiple,
      ps_median: assumptions.ps_median_multiple,
    },
  });
  warnings.push(...(market.warnings || []));

  const comparison = resultComparison({
    market,
    dcfPrimary: primary,
    dcfSecondary: secondary,
    scenarioMode: method.scenario_mode,
  });

  const sheets = {
    result_compare: {
      title: '结果对比',
      payload: comparison,
      formula: comparison.formula,
    },
    dcf: {
      title: 'DCF',
      payload: { primary, secondary, fcf_method: fcfMethod, terminal_type: terminalType },
      formula: method.scenario_mode === C.SCENARIO_DUAL
        ? (fcfMethod === C.FCF_NOPAT
          ? `FCFF=NOPAT+折旧摊销−营运资金变化−资本支出。${terminalType === C.TERMINAL_PS ? '终值=退出P/S×末期营业收入' : '终值=退出P/E×末期净利润'}。并购股权价值=(EV−净负债)×(1−并购流动性折扣)；上市股权价值=EV−净负债。市场法用另一套折扣`
          : `自由现金流=净利润+折旧摊销+ESOP−资本性支出−营运资本增加。${terminalType === C.TERMINAL_PS ? '终值=退出P/S×末期营业收入' : '终值=退出P/E×末期净利润'}。并购股权价值=(EV−净负债)×(1−并购流动性折扣)；上市股权价值=EV−净负债，不扣折扣。市场法用另一套折扣`)
        : (fcfMethod === C.FCF_NOPAT
          ? `NOPAT=EBIT×(1−税率)（EBIT≤0 时税额为 0）；FCFF=NOPAT+折旧摊销−营运资金变化−资本支出；${terminalType === C.TERMINAL_PS ? '终值=退出P/S×末期营业收入' : '终值=退出P/E×末期净利润'}；股权价值=(EV−净负债)×(1−DCF流动性折扣)`
          : `自由现金流=净利润+折旧摊销+ESOP−资本性支出−营运资本增加；${terminalType === C.TERMINAL_PS ? '终值=退出P/S×末期营业收入' : '终值=退出P/E×末期净利润'}；股东权益=企业价值−净负债（净利润桥不再乘流动性折扣）。折现期数以预测首年为第 1 期，已实现年不折现`)
    },
    market: {
      title: '市场法',
      payload: market,
      formula: market.formula,
    },
    relative: {
      title: '相对估值',
      payload: input.compStats?.relative || [],
      formula: '公司：最新倍数、历史中位数、标准差、±1σ。底稿中位有数则进 POOL，空着仍用东财历史中位。市场法 POOL：各公司所用中位的 MEDIAN 与 STDEV（不剔除围栏外点）',
    },
    fees: {
      title: '三费',
      payload: input.compStats?.fees || {},
      formula: input.compStats?.fees?.formula,
    },
    gross_margin: {
      title: '毛利',
      payload: input.compStats?.gross_margin || {},
      formula: input.compStats?.gross_margin?.formula,
    },
    working_capital: {
      title: '营运',
      payload: input.compStats?.working_capital || {},
      formula: input.compStats?.working_capital?.formula,
    },
    target_pl: {
      title: '标的利润表',
      payload: pl,
      formula: '预测期默认 5 年；可只填前 2 年，其后用收入增速与费用率外推。空白/全 0 年份跳过，不按 0 占位',
    },
    target_bs: {
      title: '资产负债表',
      payload: input.targetBs || {},
      formula: '净负债=短期借款+长期借款−货币资金；营运资本占用=(应收票据+应收账款+预付款项+存货)−(应付票据+应付账款+预收款项)',
    },
    target_cf: {
      title: '现金流量表',
      payload: input.targetCf || {},
      formula: '折旧摊销供 DCF 加回；资本性支出与营运资金变动供扣减',
    },
    tie_out: {
      title: '三表勾稽',
      payload: { net_debt: nd.net_debt, nwc_stock: nwcStockFromBs(input.targetBs) },
      formula: '净负债=短贷+长贷−货币资金；营运资本占用=(应收票据+应收账款+预付款项+存货)−(应付票据+应付账款+预收款项)；ΔNWC 是增加额，不是期末占用',
    },
  };
  if (method.multiple_source === C.MULTIPLE_INDUSTRY) {
    sheets.industry = {
      title: '行业倍数',
      payload: input.industryMultiples || { unavailable: true },
      formula: '申万三级成分股：各股锚定日及以前历史中位，再取行业 MEDIAN 与 −1σ（整体法用市值加权）。找不到成分或没有历史倍数则回退个股 POOL',
    };
  }

  return {
    pl,
    market,
    dcf: { primary, secondary },
    comparison,
    sheets,
    warnings,
    wacc,
    net_debt: nd,
  };
}

module.exports = {
  runValuationEngine,
  extrapolatePl,
  computeComparableStats,
  waccFromBreakdown,
  netDebtFromBs,
  yuanToYi,
};
