const XLSX = require('xlsx');
const zlib = require('zlib');
const { yuanToYi } = require('./marketUtils');
const {
  BS_INPUT_FIELDS,
  BS_INPUT_KEYS,
  nwcStockFromBs,
  currentAssetsFromBs,
  totalAssetsFromBs,
  currentLiabFromBs,
  totalLiabFromBs,
  debtRatioFromBs,
  currentRatioFromBs,
} = require('./targetBsFields');

const TAB_ORDER = [
  ['result_compare', '结果对比'],
  ['dcf', 'DCF'],
  ['market', '市场法'],
  ['relative', '相对估值'],
  ['fees', '三费'],
  ['gross_margin', '毛利'],
  ['working_capital', '营运'],
  ['target_pl', '标的利润表'],
  ['target_bs', '标的资产负债表'],
  ['target_cf', '标的现金流量表'],
  ['tie_out', '三表勾稽'],
  ['industry', '行业倍数'],
];

const YUAN_PER_WAN = 10000;

function num(v, fallback) {
  if (v == null || v === '') return arguments.length > 1 ? fallback : null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return arguments.length > 1 ? fallback : null;
}

/** 引擎 / 库表金额：一律按元换成万元。 */
function wanFromYuan(v) {
  const n = num(v);
  if (n == null) return null;
  return n / YUAN_PER_WAN;
}

/** 工作台录入：hydrate 后已是万元。 */
function wanFromInput(v) {
  const n = num(v);
  if (n == null) return null;
  return n;
}

function seriesLooksYuan(values) {
  const abs = (Array.isArray(values) ? values : [values])
    .map(num)
    .filter((n) => n != null && n !== 0)
    .map((n) => Math.abs(n));
  if (!abs.length) return false;
  return Math.max(...abs) >= 1e6;
}

function toWan(v, asYuan) {
  return asYuan ? wanFromYuan(v) : wanFromInput(v);
}

function asYi(v) {
  const n = num(v);
  if (n == null) return null;
  return yuanToYi(n);
}

/** SheetJS 公式单元格：缓存值 + 公式（不含 =）。 */
function F(v, f) {
  if (!f) return v;
  return { v: v == null ? null : v, f: String(f).replace(/^=/, '') };
}

function materializeAoa(aoa) {
  const formulas = [];
  const values = (aoa || []).map((row, r) => (row || []).map((cell, c) => {
    if (cell && typeof cell === 'object' && !Array.isArray(cell) && cell.f) {
      formulas.push({ r, c, f: cell.f, v: cell.v });
      return cell.v;
    }
    return cell;
  }));
  return { values, formulas };
}

function applyFormulas(ws, formulas) {
  for (const { r, c, f, v } of formulas || []) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr] && typeof ws[addr] === 'object' ? { ...ws[addr] } : {};
    cell.t = 'n';
    if (v != null && Number.isFinite(Number(v))) cell.v = Number(v);
    cell.f = f;
    ws[addr] = cell;
  }
}

function yearNum(y) {
  const n = Number(String(y || '').replace(/[^\d]/g, '').slice(0, 4));
  return Number.isFinite(n) && n >= 1900 ? n : null;
}

function lookupByYear(series, years, year, asYuan) {
  const list = Array.isArray(years) ? years : [];
  const i = list.findIndex((y) => String(y) === String(year));
  if (i < 0) return null;
  const yuan = asYuan == null ? seriesLooksYuan(series) : asYuan;
  return toWan(series?.[i], yuan);
}

function inferPeriod(p, rate, fallbackT) {
  if (p?.periods != null && Number.isFinite(Number(p.periods))) return Number(p.periods);
  const f = num(p?.factor);
  const r = num(rate);
  if (f > 0 && r > 0 && r !== 1) {
    const t = Math.log(1 / f) / Math.log(1 + r);
    if (Number.isFinite(t) && t > 0) return Math.round(t * 1000) / 1000;
  }
  const y = yearNum(p?.year);
  if (y != null && fallbackT == null) return null;
  return fallbackT;
}

function asPct(v) {
  const n = num(v);
  if (n == null) return null;
  return n * 100;
}

function colLetter(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function blankToNull(row) {
  return row.map((v) => (v === undefined ? null : v));
}

function companyGmByYear(company) {
  if (company?.by_year && typeof company.by_year === 'object' && Object.keys(company.by_year).length) {
    return company.by_year;
  }
  const out = {};
  (Array.isArray(company?.gross_margins) ? company.gross_margins : []).forEach((item, i) => {
    if (item != null && typeof item === 'object' && item.year) out[String(item.year)] = item.value;
    else if (item != null && typeof item !== 'object') out[`第${i + 1}期`] = item;
  });
  return out;
}

function collectGmYears(companies) {
  const set = new Set();
  for (const c of companies || []) {
    Object.keys(companyGmByYear(c)).forEach((y) => set.add(y));
  }
  const years = [...set].filter((y) => /^\d{4}/.test(y)).sort();
  const others = [...set].filter((y) => !/^\d{4}/.test(y)).sort();
  return [...years, ...others];
}

function fmtAxisLabel(kind, v) {
  const n = num(v);
  if (n == null) return String(v ?? '');
  if (kind === 'cagr' || kind === 'wacc') return `${(n * 100).toFixed(1)}%`;
  return n;
}

function sheetBuilder(title, formula) {
  const aoa = [];
  const kinds = [];
  const widths = [];
  const push = (row, rowKinds, rowType) => {
    aoa.push(blankToNull(row));
    kinds.push({ type: rowType, cols: rowKinds || row.map(() => 'text') });
  };
  return {
    aoa,
    kinds,
    widths,
    push,
    start(colCount) {
      this.colCount = Math.max(1, colCount || 1);
      push([title || '项目估值', ...Array(Math.max(0, colCount - 1)).fill(null)], Array(colCount).fill('title'), 'title');
      push(
        [formula ? `公式：${formula}` : '', ...Array(Math.max(0, colCount - 1)).fill(null)],
        Array(colCount).fill('formula'),
        'formula',
      );
      push(Array(colCount).fill(null), Array(colCount).fill('text'), 'gap');
    },
    header(headers) {
      if (!this.aoa.length) this.start(headers.length);
      push(headers, headers.map(() => 'header'), 'header');
      if (!widths.length) {
        headers.forEach((h) => widths.push({ wch: Math.min(36, Math.max(12, String(h || '').length * 2 + 4)) }));
      }
    },
    data(row, colKinds) {
      push(row, colKinds, 'data');
    },
    note(text, colCount) {
      const n = Math.max(1, colCount || this.colCount || 1);
      push([text, ...Array(n - 1).fill(null)], Array(n).fill('formula'), 'formula');
    },
    section(text, colCount) {
      const n = Math.max(1, colCount || this.colCount || 1);
      push([text, ...Array(n - 1).fill(null)], Array(n).fill('section'), 'section');
    },
    gap(n = 1, cols = 1) {
      const c = Math.max(1, cols || this.colCount || 1);
      for (let i = 0; i < n; i += 1) push(Array(c).fill(null), Array(c).fill('text'), 'gap');
    },
    merges(colCount) {
      const last = Math.max(0, (colCount || this.colCount || 1) - 1);
      if (last < 1) return [];
      return this.kinds
        .map((k, r) => (k.type === 'title' || k.type === 'formula' || k.type === 'section'
          ? { s: { r, c: 0 }, e: { r, c: last } }
          : null))
        .filter(Boolean);
    },
  };
}

function qSheet(name) {
  const n = String(name || '');
  return `'${n.replace(/'/g, "''")}'`;
}

function buildResult(sheet, title, _payload, refs) {
  const yi = sheet?.payload?.display_yi;
  const b = sheetBuilder(title, sheet?.formula || '增量=高端−低端。市场法低端=−1σ×基数×(1−折扣)，高端=中位×基数×(1−折扣)；DCF 低/高端=敏感性内圈四角 MIN/MAX');
  const dual = !!(yi && yi.dcf?.ma);
  const headers = dual
    ? ['序号', '区间', '市场法 P/S（亿元）', '市场法 P/E（亿元）', 'DCF 并购预期（亿元）', 'DCF 上市预期（亿元）']
    : ['序号', '区间', '市场法 P/S（亿元）', '市场法 P/E（亿元）', 'DCF（亿元）'];
  b.start(headers.length);
  b.header(headers);
  if (!yi) {
    b.data(['', '暂无结果对比', '', '', ''], headers.map(() => 'text'));
    return b;
  }
  const mkt = refs?.marketSheet ? qSheet(refs.marketSheet) : null;
  const dcfSh = refs?.dcfSheet ? qSheet(refs.dcfSheet) : null;
  const psLowF = mkt && refs.psIlliqLow ? `${mkt}!${refs.psIlliqLow}` : null;
  const psHighF = mkt && refs.psIlliqMid ? `${mkt}!${refs.psIlliqMid}` : null;
  const peLowF = mkt && refs.peIlliqLow ? `${mkt}!${refs.peIlliqLow}` : null;
  const peHighF = mkt && refs.peIlliqMid ? `${mkt}!${refs.peIlliqMid}` : null;
  const dcfCorners = (refs?.dcfInner || []).map((addr) => `${dcfSh}!${addr}`);
  const dcfLowF = !dual && dcfCorners.length ? `MIN(${dcfCorners.join(',')})` : null;
  const dcfHighF = !dual && dcfCorners.length ? `MAX(${dcfCorners.join(',')})` : null;

  const lowExcel = b.aoa.length + 1;
  const kinds = dual
    ? ['seq', 'text', 'yi', 'yi', 'yi', 'yi']
    : ['seq', 'text', 'yi', 'yi', 'yi'];
  const lowCells = dual
    ? [1, '低端', yi.market_ps?.low, yi.market_pe?.low, yi.dcf.ma.low, yi.dcf.ipo.low]
    : [
      1, '低端',
      F(yi.market_ps?.low, psLowF),
      F(yi.market_pe?.low, peLowF),
      F(yi.dcf?.low, dcfLowF),
    ];
  b.data(lowCells, kinds);
  const highExcel = lowExcel + 2;
  const incCells = dual
    ? [2, '增量', yi.market_ps?.increment, yi.market_pe?.increment, yi.dcf.ma.increment, yi.dcf.ipo.increment]
    : [
      2, '增量',
      F(yi.market_ps?.increment, `C${highExcel}-C${lowExcel}`),
      F(yi.market_pe?.increment, `D${highExcel}-D${lowExcel}`),
      F(yi.dcf?.increment, `E${highExcel}-E${lowExcel}`),
    ];
  if (dual) {
    incCells[2] = F(yi.market_ps?.increment, `C${highExcel}-C${lowExcel}`);
    incCells[3] = F(yi.market_pe?.increment, `D${highExcel}-D${lowExcel}`);
    incCells[4] = F(yi.dcf.ma.increment, `E${highExcel}-E${lowExcel}`);
    incCells[5] = F(yi.dcf.ipo.increment, `F${highExcel}-F${lowExcel}`);
  }
  b.data(incCells, kinds);
  const highCells = dual
    ? [3, '高端', yi.market_ps?.high, yi.market_pe?.high, yi.dcf.ma.high, yi.dcf.ipo.high]
    : [
      3, '高端',
      F(yi.market_ps?.high, psHighF),
      F(yi.market_pe?.high, peHighF),
      F(yi.dcf?.high, dcfHighF),
    ];
  b.data(highCells, kinds);
  b.note('改「市场法」「DCF」过程格后，本表低端/高端/增量会跟着重算。敏感性矩阵仍是引擎输出，改折现率后矩阵需回系统重算。');
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 24 });
  return b;
}

function cfLookup(cf, overrides, year, key, cfIsYuan) {
  const fromYear = lookupByYear(cf?.[key], cf?.years, year, cfIsYuan);
  if (fromYear != null) return fromYear;
  if (overrides?.[key] != null && overrides[key] !== '') return wanFromInput(overrides[key]);
  return toWan(cf?.[`${key}_default`], !!cfIsYuan) ?? 0;
}

function inputIsYuan(payload, values) {
  if (payload?.amount_unit === 'wan') return false;
  if (payload?.amount_unit === 'yuan') return true;
  return seriesLooksYuan(values);
}

function pickPl(payload) {
  const sheet = payload?.sheets?.target_pl?.payload;
  if (sheet?.years?.length) return { pl: sheet, yuan: true };
  const pl = payload?.targetPl || {};
  return { pl, yuan: inputIsYuan(payload, pl.net_income || pl.revenue) };
}

function pickCf(payload) {
  const input = payload?.targetCf;
  if (input && (input.years?.length || input.da || input.capex || input.dnwc)) {
    return {
      cf: input,
      yuan: inputIsYuan(payload, [...(input.da || []), ...(input.capex || []), ...(input.dnwc || [])]),
    };
  }
  const sheet = payload?.sheets?.target_cf?.payload;
  if (sheet) return { cf: sheet, yuan: true };
  return { cf: {}, yuan: false };
}

function pickBs(payload) {
  const input = payload?.targetBs;
  if (input && Object.keys(input).length) {
    return {
      bs: input,
      yuan: inputIsYuan(payload, BS_INPUT_KEYS.map((k) => input[k])),
    };
  }
  const sheet = payload?.sheets?.target_bs?.payload;
  if (sheet) return { bs: sheet, yuan: true };
  return { bs: {}, yuan: false };
}

function cfSeriesWan(cf, overrides, years, key, cfIsYuan) {
  let last = null;
  return (years || []).map((year) => {
    const fromYear = lookupByYear(cf?.[key], cf?.years, year, cfIsYuan);
    if (fromYear != null) {
      last = fromYear;
      return fromYear;
    }
    if (last != null) return last;
    return cfLookup(cf, overrides, year, key, cfIsYuan);
  });
}

function appendDcfBlock(b, dcf, heading, ctx, refs) {
  if (!dcf) return;
  const pvs = Array.isArray(dcf.pvs) ? dcf.pvs : [];
  const years = pvs.map((p) => p.year);
  const n = years.length;
  const colCount = Math.max(2, n + 1);
  const rate = num(dcf.discount_rate) ?? num(ctx?.discountRate);
  const exitM = num(dcf.exit_multiple);
  const terminalType = ctx?.terminalType || 'exit_pe';
  const nopat = ctx?.fcfMethod === 'nopat_fcff';
  const pl = ctx?.pl || {};
  const cf = ctx?.cf || {};
  const overrides = ctx?.overrides || {};
  const tax = num(ctx?.taxRate, 0.15);
  const esop = wanFromInput(ctx?.esop) ?? 0;
  const liq = num(dcf.liquidity_discount, num(ctx?.liquidityDiscount, 0.3));
  const plYuan = !!ctx?.plYuan;
  const cfYuan = !!ctx?.cfYuan;

  b.section(heading, colCount);
  const rateExcel = b.aoa.length + 1;
  b.data(['折现率（小数，0.3=30%）', rate], ['text', 'num']);
  if (ctx?.wacc?.used_breakdown) {
    b.data(['WACC 分项 Ke（小数）', num(ctx.wacc.ke)], ['text', 'num']);
    b.data(['WACC 权益权重 We', num(ctx.wacc.we)], ['text', 'num']);
    b.data(['WACC 债务权重 Wd', num(ctx.wacc.wd)], ['text', 'num']);
  }
  const exitExcel = b.aoa.length + 1;
  b.data([terminalType === 'exit_ps' ? '退出 P/S' : '退出 P/E', exitM], ['text', 'num']);
  const ndExcel = b.aoa.length + 1;
  b.data(['净负债（万元）', wanFromYuan(dcf.net_debt)], ['text', 'wan']);
  const applyLiq = dcf.apply_liquidity != null ? !!dcf.apply_liquidity : !!nopat;
  let liqExcel = null;
  let taxExcel = null;
  let esopExcel = null;
  if (applyLiq) {
    liqExcel = b.aoa.length + 1;
    b.data(['并购缺乏流动性折扣（小数）', liq], ['text', 'num']);
  }
  if (nopat) {
    taxExcel = b.aoa.length + 1;
    b.data(['所得税率（小数）', tax], ['text', 'num']);
  } else if (esop) {
    esopExcel = b.aoa.length + 1;
    b.data(['ESOP（万元/年）', esop], ['text', 'wan']);
  }
  b.gap(1, colCount);

  b.header(['项目', ...years.map((y) => String(y ?? ''))]);
  const yearKinds = ['text', ...years.map(() => 'wan')];
  const numKinds = ['text', ...years.map(() => 'num')];

  const niRow = [];
  const opRow = [];
  const revRow = [];
  const daRow = cfSeriesWan(cf, overrides, years, 'da', cfYuan);
  const capexRow = cfSeriesWan(cf, overrides, years, 'capex', cfYuan);
  const dnwcRow = cfSeriesWan(cf, overrides, years, 'dnwc', cfYuan);
  years.forEach((year) => {
    niRow.push(lookupByYear(pl.net_income, pl.years, year, plYuan) ?? 0);
    opRow.push(lookupByYear(pl.operating_profit, pl.years, year, plYuan) ?? 0);
    revRow.push(lookupByYear(pl.revenue, pl.years, year, plYuan) ?? 0);
  });

  const revExcel = b.aoa.length + 1;
  b.data(['营业收入（万元）', ...revRow], yearKinds);

  let opExcel = null;
  let nopatExcel = null;
  let niExcel = null;
  if (nopat) {
    opExcel = b.aoa.length + 1;
    b.data(['营业利润（万元）', ...opRow], yearKinds);
    nopatExcel = b.aoa.length + 1;
    b.data([
      'NOPAT（万元）',
      ...opRow.map((v, i) => {
        const col = colLetter(i + 1);
        return F(v * (1 - ((v > 0) ? tax : 0)), `${col}${opExcel}*(1-IF(${col}${opExcel}>0,$B$${taxExcel},0))`);
      }),
    ], yearKinds);
  } else {
    niExcel = b.aoa.length + 1;
    b.data(['净利润（万元）', ...niRow], yearKinds);
  }
  if (nopat) {
    niExcel = b.aoa.length + 1;
    b.data(['净利润（万元，终值用）', ...niRow], yearKinds);
  }
  const daExcel = b.aoa.length + 1;
  b.data(['折旧摊销（万元）', ...daRow], yearKinds);
  const capexExcel = b.aoa.length + 1;
  b.data(['资本性支出（万元）', ...capexRow], yearKinds);
  const dnwcExcel = b.aoa.length + 1;
  b.data(['营运资本增加（万元）', ...dnwcRow], yearKinds);

  const fcfExcel = b.aoa.length + 1;
  const fcfVals = years.map((_, i) => wanFromYuan(pvs[i]?.fcf));
  b.data([
    '自由现金流（万元）',
    ...fcfVals.map((v, i) => {
      const col = colLetter(i + 1);
      const earn = nopat ? `${col}${nopatExcel}` : `${col}${niExcel}`;
      const esopRef = esopExcel ? `+$B$${esopExcel}` : '';
      return F(v, `${earn}+${col}${daExcel}${esopRef}-${col}${capexExcel}-${col}${dnwcExcel}`);
    }),
  ], yearKinds);

  const periodExcel = b.aoa.length + 1;
  const periods = pvs.map((p, i) => inferPeriod(p, rate, i + 1) ?? (i + 1));
  b.data(['折现期数', ...periods], numKinds);

  const factorExcel = b.aoa.length + 1;
  b.data([
    '折现因子',
    ...pvs.map((p, i) => {
      const col = colLetter(i + 1);
      return F(num(p.factor), `1/(1+$B$${rateExcel})^${col}${periodExcel}`);
    }),
  ], numKinds);

  const pvExcel = b.aoa.length + 1;
  b.data([
    '现值（万元）',
    ...pvs.map((p, i) => {
      const col = colLetter(i + 1);
      return F(wanFromYuan(p.pv), `${col}${fcfExcel}*${col}${factorExcel}`);
    }),
  ], yearKinds);

  const lastCol = colLetter(Math.max(1, n));
  b.gap(1, colCount);
  const sumExcel = b.aoa.length + 1;
  const fcfPvSum = pvs.reduce((s, p) => s + (wanFromYuan(p.pv) || 0), 0);
  b.data(
    ['预测期 FCF 现值合计（万元）', n ? F(fcfPvSum, `SUM(B${pvExcel}:${lastCol}${pvExcel})`) : null],
    ['text', 'wan'],
  );
  const tvExcel = b.aoa.length + 1;
  const lastEarnExcel = terminalType === 'exit_ps' ? revExcel : niExcel;
  const tvLabel = terminalType === 'exit_ps'
    ? '终值（万元，退出P/S×末期收入）'
    : '终值（万元，退出P/E×末期净利润）';
  b.data(
    [tvLabel, F(wanFromYuan(dcf.terminal_value), n && lastEarnExcel ? `$B$${exitExcel}*${lastCol}${lastEarnExcel}` : null)],
    ['text', 'wan'],
  );
  const tvPvExcel = b.aoa.length + 1;
  b.data(
    ['终值现值（万元）', F(wanFromYuan(dcf.terminal_pv), n ? `B${tvExcel}*${lastCol}${factorExcel}` : null)],
    ['text', 'wan'],
  );
  const evExcel = b.aoa.length + 1;
  b.data(
    ['企业价值（万元）', F(wanFromYuan(dcf.enterprise_value), `B${sumExcel}+B${tvPvExcel}`)],
    ['text', 'wan'],
  );
  const eqWan = wanFromYuan(dcf.equity_value);
  const eqExcel = b.aoa.length + 1;
  const eqF = applyLiq && liqExcel
    ? `(B${evExcel}-B${ndExcel})*(1-$B$${liqExcel})`
    : `B${evExcel}-B${ndExcel}`;
  b.data(['股权价值（万元）', F(eqWan, eqF)], ['text', 'wan']);
  b.data(['股权价值（亿元）', F(num(dcf.equity_value_yi) ?? asYi(dcf.equity_value), `B${eqExcel}/10000`)], ['text', 'yi']);

  const sens = dcf.sensitivity;
  if (sens?.grid) {
    b.gap(1, colCount);
    b.note('敏感性矩阵为引擎输出（亿元）。结果对比 DCF 区间取内圈四角 MIN/MAX；改左侧折现率/退出倍数不会自动重算本矩阵。', colCount);
    const colLabels = sens.col_labels || [];
    const headers = [`${sens.row_kind} \\ ${sens.col_kind}（亿元）`, ...colLabels.map((c) => fmtAxisLabel(sens.col_kind, c))];
    b.header(headers);
    const dataStartExcel = b.aoa.length + 1;
    (sens.grid || []).forEach((row, i) => {
      b.data(
        [fmtAxisLabel(sens.row_kind, sens.row_labels?.[i]), ...row.map((v) => asYi(v))],
        ['text', ...row.map(() => 'yi')],
      );
    });
    if (refs && !refs.dcfInner) {
      const lastR = (sens.grid || []).length - 1;
      const lastC = (sens.grid[0] || []).length - 1;
      const corners = lastR >= 3 && lastC >= 3
        ? [[1, 1], [1, 3], [3, 1], [3, 3]]
        : [[0, 0], [0, lastC], [lastR, 0], [lastR, lastC]];
      refs.dcfInner = corners.map(([ri, ci]) => `${colLetter(ci + 1)}${dataStartExcel + ri}`);
    }
  }
  b.gap(1, colCount);
}

function buildDcf(sheet, title, payload, refs) {
  const p = sheet?.payload || {};
  const formula = sheet?.formula || '自由现金流=净利润+折旧摊销−资本性支出−营运资本增加；折现因子=1/(1+折现率)^期数；终值=退出P/E×末期净利润或退出P/S×末期收入；股权价值=企业价值−净负债';
  const pickedPl = pickPl(payload);
  const pickedCf = pickCf(payload);
  const ctx = {
    pl: pickedPl.pl,
    cf: pickedCf.cf,
    plYuan: pickedPl.yuan,
    cfYuan: pickedCf.yuan,
    overrides: payload?.overrides || {},
    fcfMethod: p.fcf_method,
    terminalType: p.terminal_type,
    discountRate: payload?.assumptions?.discount_rate,
    taxRate: payload?.assumptions?.tax_rate,
    esop: payload?.assumptions?.esop,
    wacc: payload?.wacc,
    liquidityDiscount: payload?.assumptions?.dcf_liquidity_discount
      ?? payload?.assumptions?.liquidity_discount
      ?? payload?.sheets?.market?.payload?.liquidity_discount,
  };
  const n = (p.primary?.pvs || []).length;
  const b = sheetBuilder(title, formula);
  b.start(Math.max(4, n + 1));
  if (!p.primary) {
    b.header(['年份', '自由现金流（万元）', '折现因子', '现值（万元）']);
    b.data(['暂无 DCF 结果', null, null, null], ['text', 'wan', 'num', 'wan']);
    return b;
  }
  appendDcfBlock(b, p.primary, p.primary.scenario_name || '基准', ctx, refs);
  if (p.secondary) appendDcfBlock(b, p.secondary, p.secondary.scenario_name || '第二情景', ctx, null);
  b.widths.splice(0, b.widths.length, { wch: 28 }, ...Array(Math.max(1, n)).fill({ wch: 14 }));
  return b;
}

function buildMarket(sheet, title, _payload, refs) {
  const p = sheet?.payload || {};
  const b = sheetBuilder(title, sheet?.formula || '非流通权益（亿元）=倍数×基数（万元）×(1−折扣)/10000');
  b.start(5);
  const revWan = wanFromYuan(p.revenue_base);
  const peBaseWan = wanFromYuan(p.net_income_base ?? p.operating_profit_base);
  const disc = num(p.liquidity_discount, 0.3);
  b.data(['基数年份', p.base_year || null], ['text', 'text']);
  const revExcel = b.aoa.length + 1;
  b.data(['营业收入（万元）', revWan], ['text', 'wan']);
  const peExcel = b.aoa.length + 1;
  b.data(['P/E 基数（万元）', peBaseWan], ['text', 'wan']);
  const discExcel = b.aoa.length + 1;
  b.data(['市场法缺乏流动性折扣（小数，0.3=30%）', disc], ['text', 'num']);
  b.gap(1, 5);
  b.header(['序号', '项目', '−1σ', '中位', '+1σ']);
  const peM = p.pe_multiples || {};
  const psM = p.ps_multiples || {};
  const psMulExcel = b.aoa.length + 1;
  b.data([1, 'P/S 倍数', num(psM.min), num(psM.median), num(psM.max)], ['seq', 'text', 'num', 'num', 'num']);
  const psIlliqExcel = b.aoa.length + 1;
  b.data([
    2, 'P/S 非流通权益（亿元）',
    F(p.ps?.low?.illiquid_yi ?? asYi(p.ps?.low?.illiquid), `C${psMulExcel}*$B$${revExcel}*(1-$B$${discExcel})/10000`),
    F(p.ps?.mid?.illiquid_yi ?? asYi(p.ps?.mid?.illiquid), `D${psMulExcel}*$B$${revExcel}*(1-$B$${discExcel})/10000`),
    F(p.ps?.high?.illiquid_yi ?? asYi(p.ps?.high?.illiquid), `E${psMulExcel}*$B$${revExcel}*(1-$B$${discExcel})/10000`),
  ], ['seq', 'text', 'yi', 'yi', 'yi']);
  const peMulExcel = b.aoa.length + 1;
  b.data([3, 'P/E 倍数', num(peM.min), num(peM.median), num(peM.max)], ['seq', 'text', 'num', 'num', 'num']);
  const peIlliqExcel = b.aoa.length + 1;
  b.data([
    4, 'P/E 非流通权益（亿元）',
    F(p.pe?.low?.illiquid_yi ?? asYi(p.pe?.low?.illiquid), `C${peMulExcel}*$B$${peExcel}*(1-$B$${discExcel})/10000`),
    F(p.pe?.mid?.illiquid_yi ?? asYi(p.pe?.mid?.illiquid), `D${peMulExcel}*$B$${peExcel}*(1-$B$${discExcel})/10000`),
    F(p.pe?.high?.illiquid_yi ?? asYi(p.pe?.high?.illiquid), `E${peMulExcel}*$B$${peExcel}*(1-$B$${discExcel})/10000`),
  ], ['seq', 'text', 'yi', 'yi', 'yi']);
  if (refs) {
    refs.psIlliqLow = `C${psIlliqExcel}`;
    refs.psIlliqMid = `D${psIlliqExcel}`;
    refs.peIlliqLow = `C${peIlliqExcel}`;
    refs.peIlliqMid = `D${peIlliqExcel}`;
  }
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 });
  return b;
}

function usedMultiple(r, kind) {
  const ov = num(r?.[`${kind}_median_override`]);
  if (ov != null) return ov;
  return num(r?.[`${kind}_median`]) ?? num(r?.[`${kind}_latest`]);
}

function buildRelative(sheet, title) {
  const rows = Array.isArray(sheet?.payload) ? sheet.payload : [];
  const b = sheetBuilder(title, sheet?.formula || 'PE/PS −1σ=中位−σ；+1σ=中位+σ。POOL 用底稿中位（空则东财历史中位）的 MEDIAN / STDEV.S');
  const headers = [
    '序号', '代码', '名称', '入池', '截面日',
    'PE 锚定截面', 'PE 中位', 'PE 底稿中位', 'PE σ', 'PE −1σ', 'PE +1σ',
    'PS 锚定截面', 'PS 中位', 'PS 底稿中位', 'PS σ', 'PS −1σ', 'PS +1σ', '提示',
  ];
  b.start(headers.length);
  b.header(headers);
  const kinds = ['seq', 'text', 'text', 'text', 'text', ...Array(12).fill('num'), 'text'];
  const dataStart = b.aoa.length + 1;
  rows.forEach((r, i) => {
    const excel = dataStart + i;
    const hint = [r.quality_warning, r.pe_usable === false ? 'PE 未入统计' : null, r.ps_usable === false ? 'PS 未入统计' : null]
      .filter(Boolean).join('；') || null;
    b.data([
      i + 1, r.stock_code, r.stock_name, r.in_pool ? '是' : '否', r.asof_trade_date || r.asof_date || null,
      num(r.pe_latest), num(r.pe_median), num(r.pe_median_override), num(r.pe_stdev),
      F(num(r.pe_minus_1s), `G${excel}-I${excel}`),
      F(num(r.pe_plus_1s), `G${excel}+I${excel}`),
      num(r.ps_latest), num(r.ps_median), num(r.ps_median_override), num(r.ps_stdev),
      F(num(r.ps_minus_1s), `M${excel}-O${excel}`),
      F(num(r.ps_plus_1s), `M${excel}+O${excel}`),
      hint,
    ], kinds);
  });
  if (!rows.length) {
    b.data(['', '暂无相对估值结果', ...Array(16).fill(null)], kinds);
    return b;
  }
  const poolPe = [];
  const poolPs = [];
  rows.forEach((r, i) => {
    if (!r.in_pool) return;
    const excel = dataStart + i;
    poolPe.push(`IF(H${excel}="",G${excel},H${excel})`);
    poolPs.push(`IF(N${excel}="",M${excel},N${excel})`);
  });
  b.gap(1, headers.length);
  const peMed = medianNums(rows.filter((r) => r.in_pool).map((r) => usedMultiple(r, 'pe')));
  const psMed = medianNums(rows.filter((r) => r.in_pool).map((r) => usedMultiple(r, 'ps')));
  const peSd = stdevNums(rows.filter((r) => r.in_pool).map((r) => usedMultiple(r, 'pe')));
  const psSd = stdevNums(rows.filter((r) => r.in_pool).map((r) => usedMultiple(r, 'ps')));
  const peMedF = poolPe.length ? `MEDIAN(${poolPe.join(',')})` : null;
  const psMedF = poolPs.length ? `MEDIAN(${poolPs.join(',')})` : null;
  const peSdF = poolPe.length >= 2 ? `STDEV.S(${poolPe.join(',')})` : null;
  const psSdF = poolPs.length >= 2 ? `STDEV.S(${poolPs.join(',')})` : null;
  b.data([
    '', 'POOL（入池）', null, `${poolPe.length} 家`, null,
    null, F(peMed, peMedF), null, F(peSd, peSdF), null, null,
    null, F(psMed, psMedF), null, F(psSd, psSdF), null, null,
    '市场法倍数取底稿中位（空则东财中位）的 MEDIAN 与 σ；低端=中位−σ（结果对比高端用中位，不用 +1σ）',
  ], kinds);
  return b;
}

function medianNums(arr) {
  const a = (arr || []).filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function stdevNums(arr) {
  const a = (arr || []).filter((n) => n != null && Number.isFinite(n));
  if (a.length < 2) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const varS = a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1);
  return Math.sqrt(varS);
}

function buildFees(sheet, title) {
  const p = sheet?.payload || {};
  const b = sheetBuilder(title, sheet?.formula);
  b.start(3);
  b.header(['序号', '项目', '可比集中位数（%）']);
  [
    ['销售费用率', p.selling_median],
    ['管理费用率', p.admin_median],
    ['研发费用率', p.rd_median],
  ].forEach((r, i) => b.data([i + 1, r[0], asPct(r[1])], ['seq', 'text', 'num']));
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 16 }, { wch: 16 });
  return b;
}

function buildGross(sheet, title) {
  const p = sheet?.payload || {};
  const companies = Array.isArray(p.companies) ? p.companies : [];
  const years = collectGmYears(companies);
  const b = sheetBuilder(title, sheet?.formula);
  const headers = ['序号', '代码', '名称', '最新（%）', '中位数（%）', ...years.map((y) => `${y}（%）`)];
  b.start(Math.max(headers.length, 5));
  if (p.set_median != null) {
    b.note(`可比集毛利率中位数：${(Number(p.set_median) * 100).toFixed(2)}%`, headers.length);
  }
  b.header(headers);
  const kinds = ['seq', 'text', 'text', ...Array(2 + years.length).fill('num')];
  companies.forEach((c, i) => {
    const byYear = companyGmByYear(c);
    b.data([i + 1, c.stock_code, c.stock_name, asPct(c.latest), asPct(c.median), ...years.map((y) => asPct(byYear[y]))], kinds);
  });
  if (!companies.length) b.data(['', '暂无毛利结果', null, null, null], ['seq', 'text', 'num', 'num', 'num']);
  return b;
}

function buildWc(sheet, title) {
  const p = sheet?.payload || {};
  const b = sheetBuilder(title, sheet?.formula);
  b.start(3);
  b.header(['序号', '项目', '可比集中位数（天）']);
  [
    ['DSO（应收周转天数）', p.dso_median],
    ['DPO（应付周转天数）', p.dpo_median],
    ['DIO（存货周转天数）', p.dio_median],
  ].forEach((r, i) => b.data([i + 1, r[0], num(r[1])], ['seq', 'text', 'num']));
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 24 }, { wch: 20 });
  return b;
}

function buildPl(sheet, title) {
  const p = sheet?.payload || {};
  const years = Array.isArray(p.years) ? p.years : [];
  const yuan = seriesLooksYuan(p.revenue || p.net_income);
  const amt = (v) => toWan(v, yuan);
  const b = sheetBuilder(title, sheet?.formula);
  const headers = ['序号', '年份', '营业收入（万元）', '营业成本（万元）', '毛利（万元）', '营业利润（万元）', '净利润（万元）', '收入增速（%）'];
  b.start(headers.length);
  b.header(headers);
  const kinds = ['seq', 'text', 'wan', 'wan', 'wan', 'wan', 'wan', 'num'];
  years.forEach((year, i) => {
    b.data([
      i + 1, year, amt(p.revenue?.[i]), amt(p.cogs?.[i]), amt(p.gross_profit?.[i]),
      amt(p.operating_profit?.[i]), amt(p.net_income?.[i]), asPct(p.revenue_growth?.[i]),
    ], kinds);
  });
  if (!years.length) b.data(['', '暂无外推利润表', ...Array(6).fill(null)], kinds);
  return b;
}

function buildBs(sheet, title) {
  const p = sheet?.payload || {};
  const yuan = seriesLooksYuan(BS_INPUT_KEYS.map((k) => p[k]));
  const amt = (v) => toWan(v, yuan);
  const scaled = {};
  for (const k of BS_INPUT_KEYS) scaled[k] = amt(p[k]);
  const b = sheetBuilder(title, sheet?.formula || '净负债=短期借款+长期借款−货币资金；营运资本占用=(应收票据+应收账款+预付款项+存货)−(应付票据+应付账款+预收款项)');
  b.start(3);
  b.header(['序号', '科目', '金额（万元）']);
  const startExcel = b.aoa.length + 1;
  const rowOf = {};
  BS_INPUT_FIELDS.forEach((f, i) => {
    rowOf[f.key] = startExcel + i;
    b.data([i + 1, f.label, amt(p[f.key])], ['seq', 'text', 'wan']);
  });
  const n = BS_INPUT_FIELDS.length;
  const nd = (amt(p.short_term_loan) || 0) + (amt(p.long_term_loan) || 0) - (amt(p.cash) || 0);
  const nwc = (nwcStockFromBs(scaled) || 0);
  const ca = currentAssetsFromBs(scaled);
  const ta = totalAssetsFromBs(scaled);
  const cl = currentLiabFromBs(scaled);
  const tl = totalLiabFromBs(scaled);
  const cSt = `C${rowOf.short_term_loan}`;
  const cLt = `C${rowOf.long_term_loan}`;
  const cCash = `C${rowOf.cash}`;
  const nwcF = `C${rowOf.notes_receivable}+C${rowOf.accounts_receivable}+C${rowOf.prepayment}+C${rowOf.inventory}-C${rowOf.notes_payable}-C${rowOf.accounts_payable}-C${rowOf.advance_receipt}`;
  b.data([n + 1, '流动资产合计（自动）', ca], ['seq', 'text', 'wan']);
  b.data([n + 2, '资产总计（自动）', ta], ['seq', 'text', 'wan']);
  b.data([n + 3, '流动负债合计（自动）', cl], ['seq', 'text', 'wan']);
  b.data([n + 4, '负债合计（自动）', tl], ['seq', 'text', 'wan']);
  b.data([n + 5, '净负债（自动）', F(nd, `${cSt}+${cLt}-${cCash}`)], ['seq', 'text', 'wan']);
  b.data([n + 6, '期末营运资本占用（自动）', F(nwc, nwcF)], ['seq', 'text', 'wan']);
  const dr = debtRatioFromBs(scaled);
  const cr = currentRatioFromBs(scaled);
  b.data([n + 7, '资产负债率（自动）', dr], ['seq', 'text', 'num']);
  b.data([n + 8, '流动比率（自动）', cr], ['seq', 'text', 'num']);
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 22 }, { wch: 16 });
  return b;
}

function buildCf(sheet, title) {
  const p = sheet?.payload || {};
  const years = Array.isArray(p.years) ? p.years : [];
  const n = Math.max(years.length, (p.da || []).length, (p.capex || []).length, (p.dnwc || []).length);
  const yuan = seriesLooksYuan([...(p.da || []), ...(p.capex || []), ...(p.dnwc || [])]);
  const amt = (v) => toWan(v, yuan);
  const b = sheetBuilder(title, sheet?.formula || '折旧摊销供 DCF 加回；资本性支出与营运资本增加供扣减。增加额不是资产负债表期末占用');
  const headers = ['序号', '年份', '折旧摊销（万元）', '资本性支出（万元）', '营运资本增加（万元）'];
  b.start(headers.length);
  b.header(headers);
  const kinds = ['seq', 'text', 'wan', 'wan', 'wan'];
  for (let i = 0; i < Math.max(n, 0); i += 1) {
    b.data([i + 1, years[i] || `T${i + 1}`, amt(p.da?.[i]), amt(p.capex?.[i]), amt(p.dnwc?.[i])], kinds);
  }
  if (!n) b.data(['', '暂无现金流量表', null, null, null], kinds);
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 22 });
  return b;
}

function buildTieOut(sheet, title, payload) {
  const p = sheet?.payload || {};
  const b = sheetBuilder(title, sheet?.formula || '净负债=短贷+长贷−货币资金；FCF=净利润+折旧−资本支出−ΔNWC；ΔNWC 是增加额，不是期末占用');
  const pickedBs = pickBs(payload);
  const pickedPl = pickPl(payload);
  const pickedCf = pickCf(payload);
  const bs = pickedBs.bs;
  const pl = pickedPl.pl;
  const cf = pickedCf.cf;
  const ov = payload?.overrides || {};
  const dcf = payload?.sheets?.dcf?.payload?.primary || {};
  const pvs = Array.isArray(dcf.pvs) ? dcf.pvs : [];
  const nopat = payload?.sheets?.dcf?.payload?.fcf_method === 'nopat_fcff';
  const tax = num(payload?.assumptions?.tax_rate, 0.15);
  const bsAmt = (v) => toWan(v, pickedBs.yuan);

  b.start(8);
  b.section('资产负债勾稽（万元）');
  b.header(['项目', '公式', '金额（万元）', '说明']);
  const ndBs = (bsAmt(bs.short_term_loan) || 0) + (bsAmt(bs.long_term_loan) || 0) - (bsAmt(bs.cash) || 0);
  const scaledBs = {};
  for (const k of BS_INPUT_KEYS) scaledBs[k] = bsAmt(bs[k]);
  const nwc = nwcStockFromBs(scaledBs);
  const ndDcf = wanFromYuan(dcf.net_debt);
  b.data(['净负债（资产负债表）', '短贷+长贷−货币资金', ndBs, '进入 DCF 扣减'], ['text', 'text', 'wan', 'text']);
  b.data(['净负债（DCF）', '引擎扣减额', ndDcf, Math.abs((ndBs || 0) - (ndDcf || 0)) > 0.5 ? '与资产负债表不一致' : '一致'], ['text', 'text', 'wan', 'text']);
  b.data(['期末营运资本占用', '(应收票据+应收账款+预付款项+存货)−(应付票据+应付账款+预收款项)', nwc, '时点余额，不是 ΔNWC'], ['text', 'text', 'wan', 'text']);
  b.gap(1);
  const years = pvs.length ? pvs.map((x) => x.year) : (pl.years || []);
  b.section('自由现金流勾稽（万元）');
  b.header(['年份', nopat ? 'NOPAT' : '净利润（万元）', '折旧摊销（万元）', '资本性支出（万元）', '营运资本增加（万元）', 'FCF（勾稽）', 'FCF（DCF）', '差额']);
  const kinds = ['text', 'wan', 'wan', 'wan', 'wan', 'wan', 'wan', 'wan'];
  const dataStart = b.aoa.length + 1;
  const issues = [];
  const daList = cfSeriesWan(cf, ov, years, 'da', pickedCf.yuan);
  const capexList = cfSeriesWan(cf, ov, years, 'capex', pickedCf.yuan);
  const dnwcList = cfSeriesWan(cf, ov, years, 'dnwc', pickedCf.yuan);
  years.forEach((year, i) => {
    const op = lookupByYear(pl.operating_profit, pl.years, year, pickedPl.yuan) ?? 0;
    const ni = lookupByYear(pl.net_income, pl.years, year, pickedPl.yuan) ?? 0;
    const earn = nopat ? op * (1 - (op > 0 ? tax : 0)) : ni;
    const da = daList[i];
    const capex = capexList[i];
    const dnwc = dnwcList[i];
    const expected = earn + da - capex - dnwc;
    const actual = wanFromYuan(pvs[i]?.fcf);
    const gap = (actual == null ? null : expected - actual);
    if (nwc != null && Math.abs(dnwc) > Math.abs(nwc) * 3 + 1) {
      issues.push(`${year} 的 ΔNWC 远大于资产负债表占用`);
    }
    if (nwc != null && Math.abs(nwc) > 1 && Math.abs(dnwc - nwc) / Math.abs(nwc) < 0.08) {
      issues.push(`${year} 的 ΔNWC 与期末占用几乎相同，可能把余额当成增加额`);
    }
    const excel = dataStart + i;
    b.data([
      year, earn, da, capex, dnwc,
      F(expected, `B${excel}+C${excel}-D${excel}-E${excel}`),
      actual,
      F(gap, `F${excel}-G${excel}`),
    ], kinds);
  });
  if (!years.length) b.data(['暂无 DCF 年', null, null, null, null, null, null, null], kinds);
  b.gap(1);
  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length) uniqueIssues.forEach((t) => b.note(t));
  else b.note('未发现 ΔNWC 与期末占用明显串科目。差额列应接近 0。');
  (p.warnings || []).forEach((w) => b.note(String(w)));
  b.widths.splice(0, b.widths.length,
    { wch: 26 },
    { wch: 22 },
    { wch: 16 },
    { wch: 20 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
  );
  return b;
}

function buildIndustry(sheet, title) {
  const p = sheet?.payload || {};
  const b = sheetBuilder(title, sheet?.formula);
  b.start(3);
  if (p.unavailable) {
    b.header(['项目', '说明']);
    b.data(['行业倍数', p.message || '不可用'], ['text', 'text']);
    return b;
  }
  b.header(['序号', '项目', '数值']);
  [
    ['申万三级', p.sw_industry_l3],
    ['截面日', p.trade_date ? String(p.trade_date).slice(0, 10) : null],
    ['P/E 中位', num(p.pe_median)],
    ['P/S 中位', num(p.ps_median)],
    ['P/E −1σ', num(p.pe_min)],
    ['P/E +1σ', num(p.pe_max)],
    ['P/S −1σ', num(p.ps_min)],
    ['P/S +1σ', num(p.ps_max)],
  ].forEach((r, i) => {
    const k = typeof r[1] === 'number' ? 'num' : 'text';
    b.data([i + 1, r[0], r[1]], ['seq', 'text', k]);
  });
  return b;
}

const BUILDERS = {
  result_compare: buildResult,
  dcf: buildDcf,
  market: buildMarket,
  relative: buildRelative,
  fees: buildFees,
  gross_margin: buildGross,
  working_capital: buildWc,
  target_pl: buildPl,
  target_bs: buildBs,
  target_cf: buildCf,
  tie_out: buildTieOut,
  industry: buildIndustry,
};

function ensureSheets(sheets, payload) {
  const s = { ...(sheets || {}) };
  if (!s.result_compare && payload?.comparison) {
    s.result_compare = { title: '结果对比', payload: payload.comparison, formula: payload.comparison.formula };
  }
  if (!s.target_bs && payload?.targetBs) {
    s.target_bs = { title: '标的资产负债表', payload: payload.targetBs, formula: '净负债=短期借款+长期借款−货币资金' };
  }
  if (!s.target_cf && payload?.targetCf) {
    s.target_cf = { title: '标的现金流量表', payload: payload.targetCf, formula: '折旧摊销供 DCF 加回；资本性支出与营运资金变动供扣减' };
  }
  if (!s.tie_out) {
    s.tie_out = {
      title: '三表勾稽',
      payload: {},
      formula: '净负债=短贷+长贷−货币资金；FCF=净利润+折旧−资本支出−ΔNWC；ΔNWC 是增加额，不是期末占用',
    };
  }
  return s;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unzipXlsx(buf) {
  const files = {};
  let i = 0;
  while (i + 30 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const comp = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const dataStart = i + 30 + nlen + elen;
    const compressed = buf.slice(dataStart, dataStart + comp);
    files[name] = method === 0 ? compressed : zlib.inflateRawSync(compressed);
    i = dataStart + comp;
  }
  return files;
}

function zipXlsx(files) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const n = Object.keys(files).length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="176" formatCode="#,##0.00;-#,##0.00"/>
<numFmt numFmtId="177" formatCode="#,##0.00;-#,##0.00"/>
<numFmt numFmtId="178" formatCode="#,##0.00;-#,##0.00"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><color theme="1"/><name val="微软雅黑"/><family val="2"/></font>
<font><sz val="13"/><b/><color rgb="FF1D2129"/><name val="微软雅黑"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF4E5969"/><name val="微软雅黑"/><family val="2"/></font>
<font><sz val="11"/><b/><color rgb="FF1E3A8A"/><name val="微软雅黑"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F8FF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F3FF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFC9D6E8"/></left>
<right style="thin"><color rgb="FFC9D6E8"/></right>
<top style="thin"><color rgb="FFC9D6E8"/></top>
<bottom style="thin"><color rgb="FFC9D6E8"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="4" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="176" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="177" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="177" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="178" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="178" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const XF = {
  title: 1,
  formula: 2,
  header: 3,
  odd: 4,
  even: 5,
  oddNum: 6,
  evenNum: 7,
  oddWan: 8,
  evenWan: 9,
  oddYi: 10,
  evenYi: 11,
  oddPct: 12,
  evenPct: 13,
};

function xfFor(rowType, colKind, stripeEven) {
  if (rowType === 'title' || colKind === 'title') return XF.title;
  if (rowType === 'formula' || colKind === 'formula') return XF.formula;
  if (rowType === 'header' || colKind === 'header') return XF.header;
  if (rowType === 'gap' || rowType === 'section' || colKind === 'section') return XF.formula;
  const even = stripeEven ? 'even' : 'odd';
  if (colKind === 'wan') return XF[`${even}Wan`];
  if (colKind === 'yi') return XF[`${even}Yi`];
  if (colKind === 'pct') return XF[`${even}Pct`];
  if (colKind === 'num' || colKind === 'seq') return XF[`${even}Num`];
  return XF[even];
}

function rowHeightPt(kind, row, colCount) {
  if (kind?.type === 'title') return 26;
  if (kind?.type === 'header') return 36;
  if (kind?.type === 'section') return 24;
  if (kind?.type === 'formula') {
    const text = String(row?.[0] == null ? '' : row[0]);
    const charsPerLine = Math.max(24, (colCount || 5) * 8);
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    return Math.min(80, 18 + lines * 16);
  }
  return 18;
}
function applyExportStyles(buffer, metas) {
  const files = unzipXlsx(buffer);
  files['xl/styles.xml'] = Buffer.from(STYLES_XML, 'utf8');
  const sheetFiles = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/sheet(\d+)/)[1]) - Number(b.match(/sheet(\d+)/)[1]));
  sheetFiles.forEach((name, si) => {
    const meta = metas[si];
    if (!meta) return;
    const colCount = Math.max(...(meta.aoa || []).map((r) => r.length), 1);
    let xml = files[name].toString('utf8');
    xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    xml = xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (m, col, rowStr, rest) => {
      const r = Number(rowStr);
      const c = colIndex(col);
      const rowMeta = meta.kinds[r - 1];
      if (!rowMeta) return m;
      const colKind = rowMeta.cols[c] || 'text';
      const xf = xfFor(rowMeta.type, colKind, meta.stripe?.[r - 1]);
      const cleaned = rest.replace(/\ss="\d+"/, '');
      return `<c r="${col}${rowStr}" s="${xf}"${cleaned}>`;
    });
    xml = xml.replace(/<row r="(\d+)"([^>]*)>/g, (m, rowStr, rest) => {
      const r = Number(rowStr);
      const rowMeta = meta.kinds[r - 1];
      const ht = rowHeightPt(rowMeta, meta.aoa?.[r - 1], colCount);
      const cleaned = rest.replace(/\sht="[^"]*"/, '').replace(/\scustomHeight="[^"]*"/, '');
      return `<row r="${rowStr}" ht="${ht}" customHeight="1"${cleaned}>`;
    });
    files[name] = Buffer.from(xml, 'utf8');
  });
  return zipXlsx(files);
}

function withStripe(built) {
  let n = 0;
  built.stripe = built.kinds.map((k) => {
    if (k.type !== 'data') return false;
    const even = n % 2 === 1;
    n += 1;
    return even;
  });
  return built;
}

function appendSheet(wb, built, name) {
  const { values, formulas } = materializeAoa(built.aoa);
  const ws = XLSX.utils.aoa_to_sheet(values);
  const colCount = Math.max(...values.map((r) => r.length), 1);
  applyFormulas(ws, formulas);
  ws['!merges'] = built.merges(colCount);
  ws['!cols'] = built.widths.length ? built.widths : Array.from({ length: colCount }, () => ({ wch: 14 }));
  ws['!rows'] = built.kinds.map((k, i) => ({ hpt: rowHeightPt(k, built.aoa[i], colCount) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function buildWorkbookBuffer({ title, sheets, payload }) {
  const map = ensureSheets(sheets, payload);
  const wb = XLSX.utils.book_new();
  const metas = [];
  const used = new Set();
  const names = {};
  for (const [key, fallbackTitle] of TAB_ORDER) {
    const sheet = map[key];
    if (!sheet && key !== 'result_compare') continue;
    let name = String(sheet?.title || fallbackTitle).slice(0, 31);
    if (used.has(name)) name = `${name.slice(0, 28)}_${used.size}`;
    used.add(name);
    names[key] = name;
  }
  const refs = {
    marketSheet: names.market,
    dcfSheet: names.dcf,
  };
  const builtByKey = {};
  for (const [key, fallbackTitle] of TAB_ORDER) {
    if (key === 'result_compare') continue;
    const sheet = map[key];
    if (!sheet) continue;
    const builder = BUILDERS[key];
    if (!builder) continue;
    builtByKey[key] = withStripe(builder(sheet, title || fallbackTitle, payload, refs));
  }
  if (map.result_compare || names.result_compare) {
    builtByKey.result_compare = withStripe(
      BUILDERS.result_compare(map.result_compare || { title: '结果对比', payload: null }, title || '结果对比', payload, refs),
    );
  }
  for (const [key, fallbackTitle] of TAB_ORDER) {
    const built = builtByKey[key];
    if (!built) continue;
    const name = names[key] || fallbackTitle;
    appendSheet(wb, built, name);
    metas.push(built);
  }
  if (!metas.length) {
    const ws = XLSX.utils.aoa_to_sheet([[title || '项目估值'], ['暂无明细']]);
    XLSX.utils.book_append_sheet(wb, ws, '结果对比');
  }
  const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  try {
    return applyExportStyles(raw, metas);
  } catch (e) {
    console.warn('[valuation export style]', e.message);
    return raw;
  }
}

module.exports = {
  buildWorkbookBuffer,
  yuanToYi,
};
