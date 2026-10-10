const XLSX = require('xlsx');
const zlib = require('zlib');
const { yuanToYi } = require('./marketUtils');
const { exitMocIrr } = require('./exitReturn');
const {
  BS_VISIBLE_FIELDS,
  BS_INPUT_KEYS,
  nwcStockFromBs,
  netDebtAmount,
  currentAssetsFromBs,
  totalAssetsFromBs,
  currentLiabFromBs,
  totalLiabFromBs,
  equityBookFromBs,
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

function sensDisplay(cell, block, dealYi, dilution, years) {
  if (!cell || cell.blank === 'revenue' || cell.blank === 'other' || cell.blank === 'multiple') return { v: null, text: false };
  if (cell.blank === 'nopat') return { v: '税后经营利润小于等于 0', text: true };
  if (block === 'equity') return { v: cell.equity_yi, text: false };
  const m = exitMocIrr(cell.cap_yi, dilution, dealYi, years);
  if (block === 'moc') {
    if (m.note && m.moc == null) return { v: m.note, text: true };
    return { v: m.moc, text: false };
  }
  if (m.note === 'MOC 不为正，无 IRR') return { v: m.note, text: true };
  if (m.note && m.irr == null) return { v: m.note, text: true };
  return { v: m.irr, text: false };
}

function appendExitBlock(b, view, dealYi, dilution, heading, includeDeal) {
  if (!view) return;
  b.colCount = Math.max(b.colCount || 1, 13);
  const years = view.holding_years;
  const axis = view.axes === 'exit_x_wacc' ? '折现率' : (view.axes === 'exit_x_rd_cagr' ? '研发费用 CAGR' : '营收 CAGR');
  const deal = num(dealYi);
  const showReturn = deal > 0 && (dilution == null || dilution === '' || (Number(dilution) >= 0 && Number(dilution) <= 1));
  const sides = [
    ['退出 P/E', view.pe],
    ['退出 P/S', view.ps],
  ].filter(([, side]) => side && !side.blocked && side.cells);
  if (!sides.length) return;
  b.gap(1);
  b.section(heading || '基准情形');
  if (includeDeal) {
    const dilPct = dilution == null || dilution === '' ? 100 : Math.round(Number(dilution) * 10000) / 100;
    b.data(['本轮交易估值（投前）（亿元）', deal], ['text', 'num']);
    b.data(['后续股权稀释（%）', Number.isFinite(dilPct) ? dilPct : null], ['text', 'num']);
  }
  b.data(['持有年数', years], ['text', 'num']);
  sides.forEach(([name, side]) => {
    const m = exitMocIrr(side.cap_yi, dilution, dealYi, years);
    b.data([`${name}（倍）`, side.multiple], ['text', 'num']);
    b.data([`${name} 股权价值（亿元）`, side.equity_yi], ['text', 'num']);
    b.data([`${name} 退出市值（亿元）`, side.cap_yi], ['text', 'num']);
    b.data([`${name} 退出 MOC`, m.moc == null ? m.note : m.moc], ['text', m.moc == null ? 'text' : 'num']);
    b.data([`${name} 退出 IRR（%）`, m.irr == null ? (m.note || null) : m.irr], ['text', m.irr == null ? 'text' : 'num']);
  });
  const blocks = [{ key: 'equity', title: `估值（亿元）：${axis} × 退出倍数` }];
  if (showReturn) {
    blocks.push({ key: 'moc', title: `退出 MOC：${axis} × 退出倍数` });
    blocks.push({ key: 'irr', title: `退出 IRR（%）：${axis} × 退出倍数。持有 ${years == null ? '' : Number(years).toFixed(2)} 年` });
  } else {
    const note = !(deal > 0)
      ? '待填写本轮交易估值（投前），退出 MOC 与退出 IRR 不出表'
      : '后续股权稀释需在 0% 到 100%，退出 MOC 与退出 IRR 不出表';
    blocks.push({ key: 'note', title: note });
  }
  blocks.forEach((block) => {
    b.gap(1);
    b.section(block.title);
    if (block.key === 'note') return;
    const pe = sides.find(([name]) => name === '退出 P/E')?.[1];
    const ps = sides.find(([name]) => name === '退出 P/S')?.[1];
    const rowCount = Math.max(pe?.row_labels?.length || 0, ps?.row_labels?.length || 0);
    const header = [
      ...(pe ? [axis, ...pe.col_labels] : []),
      ...(pe && ps ? [null] : []),
      ...(ps ? [axis, ...ps.col_labels] : []),
    ];
    b.data(header, header.map(() => 'text'));
    for (let i = 0; i < rowCount; i += 1) {
      const row = [];
      const kinds = [];
      const pushSide = (side) => {
        if (!side) return;
        row.push(side.row_labels?.[i] ?? null);
        kinds.push('text');
        (side.cells?.[i] || []).forEach((cell, j) => {
          const shown = sensDisplay(cell, block.key, dealYi, dilution, years);
          const center = i === side.center_row && j === side.center_col;
          row.push(shown.v);
          kinds.push(shown.text ? (center ? 'centerText' : 'text') : (center ? 'centerNum' : 'num'));
        });
      };
      pushSide(pe);
      if (pe && ps) {
        row.push(null);
        kinds.push('text');
      }
      pushSide(ps);
      b.data(row, kinds);
    }
  });
  if (view.wacc_floored) b.note('折现率低于 1% 的档已按 1% 计算。');
}

function buildResult(sheet, title, payload, refs) {
  const yi = sheet?.payload?.display_yi;
  const b = sheetBuilder(title, sheet?.formula || '增量=高端−低端。市场法低端=−1σ×基数×(1−折扣)，高端=中位×基数×(1−折扣)。DCF 低端和高端是退出 P/E 与退出 P/S 的股权价值');
  const dual = !!(yi && yi.dcf?.ma);
  const headers = dual
    ? ['序号', '区间', '市场法 P/S（亿元）', '市场法 P/E（亿元）', 'DCF 并购预期（亿元）', 'DCF 上市预期（亿元）']
    : ['序号', '区间', '市场法 P/S（亿元）', '市场法 P/E（亿元）', 'DCF（亿元）'];
  b.start(Math.max(headers.length, 13));
  if (payload?.export_stale_lines?.length) {
    b.note(`输入已修改，表内为上次计算。${payload.export_stale_lines.join('；')}`);
  }
  b.header(headers);
  if (!yi) {
    b.data(['', '暂无结果对比', '', '', ''], headers.map(() => 'text'));
    return b;
  }
  const mkt = refs?.marketSheet ? qSheet(refs.marketSheet) : null;
  const psLowF = mkt && refs.psIlliqLow ? `${mkt}!${refs.psIlliqLow}` : null;
  const psHighF = mkt && refs.psIlliqMid ? `${mkt}!${refs.psIlliqMid}` : null;
  const peLowF = mkt && refs.peIlliqLow ? `${mkt}!${refs.peIlliqLow}` : null;
  const peHighF = mkt && refs.peIlliqMid ? `${mkt}!${refs.peIlliqMid}` : null;
  const dcfLowF = null;
  const dcfHighF = null;

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
  b.note('DCF 低端和高端是退出 P/E 与退出 P/S 的股权价值。下面三块表是敏感性，改折现率或倍数后需回系统重算再导出。');
  const dcfPayload = payload?.sheets?.dcf?.payload;
  const dealYi = payload?.export_deal_yi != null ? payload.export_deal_yi : payload?.assumptions?.round_deal_value_yi;
  const dilution = payload?.assumptions?.follow_on_dilution;
  if (dcfPayload?.primary?.exit_view) {
    const dualExit = !!dcfPayload.secondary?.exit_view;
    appendExitBlock(
      b,
      dcfPayload.primary.exit_view,
      dealYi,
      dilution,
      dualExit ? (dcfPayload.primary.scenario_name || '并购') : null,
      true,
    );
    if (dualExit) {
      appendExitBlock(
        b,
        dcfPayload.secondary.exit_view,
        dealYi,
        dilution,
        dcfPayload.secondary.scenario_name || '上市',
        false,
      );
    }
  }
  b.widths.splice(0, b.widths.length, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 });
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
  const tax = num(ctx?.taxRate, 0.15);
  const esop = wanFromInput(ctx?.esop) ?? 0;
  const liq = num(dcf.liquidity_discount, num(ctx?.liquidityDiscount, 0.3));

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
  const taxExcel = b.aoa.length + 1;
  b.data(['所得税率（小数）', tax], ['text', 'num']);
  const series = dcf.series || {};
  const esopWan = wanFromYuan(series.esop?.[0] ?? pvs[0]?.esop) ?? esop ?? 0;
  const esopExcel = b.aoa.length + 1;
  b.data(['ESOP（万元/年）', esopWan], ['text', 'wan']);
  const hasPeriod = Array.isArray(series.period_nopat) && series.period_nopat.length === n;
  const ytd = series.anchor_ytd;
  const stubIndex = hasPeriod && ytd && series.anchor_month < 12 && Number(years[0]) === Number(series.anchor_year) ? 0 : -1;
  let ytdPretaxExcel = null;
  let ytdDaExcel = null;
  let ytdCapexExcel = null;
  if (stubIndex === 0) {
    ytdPretaxExcel = b.aoa.length + 1;
    b.data(['锚定日累计税前经营利润（万元）', wanFromYuan(ytd.pretax) ?? 0], ['text', 'wan']);
    ytdDaExcel = b.aoa.length + 1;
    b.data(['锚定日累计折旧摊销（万元）', wanFromYuan(ytd.da) ?? 0], ['text', 'wan']);
    ytdCapexExcel = b.aoa.length + 1;
    b.data(['锚定日累计资本开支（万元）', wanFromYuan(ytd.capex) ?? 0], ['text', 'wan']);
  }
  if (applyLiq) {
    liqExcel = b.aoa.length + 1;
    b.data(['并购缺乏流动性折扣（小数）', liq], ['text', 'num']);
  }
  b.gap(1, colCount);

  b.header(['项目', ...years.map((y) => String(y ?? ''))]);
  const yearKinds = ['text', ...years.map(() => 'wan')];
  const numKinds = ['text', ...years.map(() => 'num')];
  const cell = (row, i) => `${colLetter(i + 1)}${row}`;
  const wanLine = (key, i) => wanFromYuan(series[key]?.[i]) ?? 0;
  const hasSeries = Array.isArray(series.revenue) && series.revenue.length === n;

  let revExcel = null;
  let nopatExcel = null;
  let daExcel = null;
  let capexExcel = null;
  let scaleExcel = null;
  let beforeExcel = null;
  let dnwcExcel = null;

  if (hasSeries && n) {
    revExcel = b.aoa.length + 1;
    b.data(['营业收入（万元）', ...years.map((_, i) => wanLine('revenue', i))], yearKinds);
    const cogsExcel = b.aoa.length + 1;
    b.data(['营业成本（万元）', ...years.map((_, i) => wanLine('cogs', i))], yearKinds);
    const surtaxExcel = b.aoa.length + 1;
    b.data(['税金及附加（万元）', ...years.map((_, i) => wanLine('surtax', i))], yearKinds);
    const sellingExcel = b.aoa.length + 1;
    b.data(['销售费用（万元）', ...years.map((_, i) => wanLine('selling', i))], yearKinds);
    const adminExcel = b.aoa.length + 1;
    b.data(['管理费用（万元）', ...years.map((_, i) => wanLine('admin', i))], yearKinds);
    const rdExcel = b.aoa.length + 1;
    b.data(['研发费用（万元）', ...years.map((_, i) => wanLine('rd', i))], yearKinds);
    const otherIncomeExcel = b.aoa.length + 1;
    b.data(['其他收益（万元）', ...years.map((_, i) => wanLine('other_income', i))], yearKinds);
    const otherExcel = b.aoa.length + 1;
    b.data(['其他（万元）', ...years.map((_, i) => wanLine('other', i))], yearKinds);
    daExcel = b.aoa.length + 1;
    b.data(['折旧摊销（万元）', ...years.map((_, i) => wanLine('da', i))], yearKinds);
    const ebitdaExcel = b.aoa.length + 1;
    b.data(['EBITDA（万元）', ...years.map((_, i) => F(
      wanLine('ebitda', i),
      `${cell(revExcel, i)}-${cell(cogsExcel, i)}-${cell(surtaxExcel, i)}-${cell(sellingExcel, i)}-${cell(adminExcel, i)}-${cell(rdExcel, i)}+${cell(otherIncomeExcel, i)}+${cell(otherExcel, i)}+${cell(daExcel, i)}`,
    ))], yearKinds);
    const pretaxExcel = b.aoa.length + 1;
    b.data(['税前经营利润（万元）', ...years.map((_, i) => F(
      wanLine('pretax', i),
      `${cell(ebitdaExcel, i)}-${cell(daExcel, i)}`,
    ))], yearKinds);
    nopatExcel = b.aoa.length + 1;
    b.data(['税后经营利润（万元）', ...years.map((_, i) => F(
      wanLine('nopat', i),
      `IF(${cell(pretaxExcel, i)}>0,${cell(pretaxExcel, i)}*(1-$B$${taxExcel}),${cell(pretaxExcel, i)})`,
    ))], yearKinds);
    capexExcel = b.aoa.length + 1;
    b.data(['资本开支（万元）', ...years.map((_, i) => wanLine('capex', i))], yearKinds);
    if (hasPeriod) {
      const periodPretaxExcel = b.aoa.length + 1;
      b.data(['期间税前经营利润（万元）', ...years.map((_, i) => {
        const full = wanLine('pretax', i);
        const ytdPretax = wanFromYuan(ytd?.pretax) ?? 0;
        const value = i === stubIndex ? full - ytdPretax : full;
        const formula = i === stubIndex ? `${cell(pretaxExcel, i)}-$B$${ytdPretaxExcel}` : `${cell(pretaxExcel, i)}`;
        return F(value, formula);
      })], yearKinds);
      const periodNopatExcel = b.aoa.length + 1;
      b.data(['期间税后经营利润（万元）', ...years.map((_, i) => F(
        wanFromYuan(series.period_nopat?.[i]) ?? 0,
        `IF(${cell(periodPretaxExcel, i)}>0,${cell(periodPretaxExcel, i)}*(1-$B$${taxExcel}),${cell(periodPretaxExcel, i)})`,
      ))], yearKinds);
      const periodDaExcel = b.aoa.length + 1;
      b.data(['期间折旧摊销（万元）', ...years.map((_, i) => {
        const full = wanLine('da', i);
        const ytdDa = wanFromYuan(ytd?.da) ?? 0;
        const value = i === stubIndex ? full - ytdDa : full;
        const formula = i === stubIndex ? `${cell(daExcel, i)}-$B$${ytdDaExcel}` : `${cell(daExcel, i)}`;
        return F(value, formula);
      })], yearKinds);
      const periodEsopExcel = b.aoa.length + 1;
      const esopFactor = `(12-${Number(series.anchor_month) || 12})/12`;
      b.data(['期间ESOP（万元）', ...years.map((_, i) => {
        const value = wanFromYuan(series.period_esop?.[i]) ?? esopWan;
        const formula = i === stubIndex ? `$B$${esopExcel}*${esopFactor}` : `$B$${esopExcel}`;
        return F(value, formula);
      })], yearKinds);
      const periodCapexExcel = b.aoa.length + 1;
      b.data(['期间资本开支（万元）', ...years.map((_, i) => {
        const full = wanLine('capex', i);
        const ytdCapex = wanFromYuan(ytd?.capex) ?? 0;
        const value = i === stubIndex ? full - ytdCapex : full;
        const formula = i === stubIndex ? `${cell(capexExcel, i)}-$B$${ytdCapexExcel}` : `${cell(capexExcel, i)}`;
        return F(value, formula);
      })], yearKinds);
      beforeExcel = b.aoa.length + 1;
      b.data(['扣营运资本前现金流（万元）', ...years.map((_, i) => F(
        wanLine('fcff_before_nwc', i),
        `${cell(periodNopatExcel, i)}+${cell(periodDaExcel, i)}+${cell(periodEsopExcel, i)}-${cell(periodCapexExcel, i)}`,
      ))], yearKinds);
    } else {
      scaleExcel = b.aoa.length + 1;
      b.data(['流量比例', ...years.map((_, i) => num(series.flow_scale?.[i], 1))], numKinds);
      beforeExcel = b.aoa.length + 1;
      b.data(['扣营运资本前现金流（万元）', ...years.map((_, i) => F(
        wanLine('fcff_before_nwc', i),
        `(${cell(nopatExcel, i)}+${cell(daExcel, i)}+$B$${esopExcel}-${cell(capexExcel, i)})*${cell(scaleExcel, i)}`,
      ))], yearKinds);
    }
    dnwcExcel = b.aoa.length + 1;
    b.data(['ΔNWC（万元）', ...years.map((_, i) => wanLine('dnwc', i))], yearKinds);
  } else if (n) {
    nopatExcel = b.aoa.length + 1;
    b.data(['税后经营利润（万元）', ...pvs.map((p) => wanFromYuan(p.nopat) ?? 0)], yearKinds);
    daExcel = b.aoa.length + 1;
    b.data(['折旧摊销（万元）', ...pvs.map((p) => wanFromYuan(p.da) ?? 0)], yearKinds);
    capexExcel = b.aoa.length + 1;
    b.data(['资本开支（万元）', ...pvs.map((p) => wanFromYuan(p.capex) ?? 0)], yearKinds);
    scaleExcel = b.aoa.length + 1;
    b.data(['流量比例', ...years.map(() => 1)], numKinds);
    beforeExcel = b.aoa.length + 1;
    b.data(['扣营运资本前现金流（万元）', ...pvs.map((p, i) => {
      const before = ((wanFromYuan(p.nopat) ?? 0) + (wanFromYuan(p.da) ?? 0) + esopWan - (wanFromYuan(p.capex) ?? 0));
      return F(before, `(${cell(nopatExcel, i)}+${cell(daExcel, i)}+$B$${esopExcel}-${cell(capexExcel, i)})*${cell(scaleExcel, i)}`);
    })], yearKinds);
    dnwcExcel = b.aoa.length + 1;
    b.data(['ΔNWC（万元）', ...pvs.map((p) => wanFromYuan(p.dnwc) ?? 0)], yearKinds);
    revExcel = b.aoa.length + 1;
    b.data(['营业收入（万元）', ...pvs.map((p) => wanFromYuan(p.revenue) ?? 0)], yearKinds);
  }

  const fcfExcel = b.aoa.length + 1;
  const fcfVals = years.map((_, i) => wanFromYuan(pvs[i]?.fcf));
  b.data([
    '自由现金流（万元）',
    ...fcfVals.map((v, i) => (
      beforeExcel && dnwcExcel
        ? F(v, `${cell(beforeExcel, i)}-${cell(dnwcExcel, i)}`)
        : v
    )),
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
  const lastEarnExcel = terminalType === 'exit_ps' ? revExcel : nopatExcel;
  const tvLabel = terminalType === 'exit_ps'
    ? '终值（万元，退出P/S×末期营业收入+净负债）'
    : '终值（万元，退出P/E×末期税后经营利润+净负债）';
  b.data(
    [tvLabel, F(wanFromYuan(dcf.terminal_value), n && lastEarnExcel ? `$B$${exitExcel}*${lastCol}${lastEarnExcel}+$B$${ndExcel}` : null)],
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
  b.gap(1, colCount);
}

function buildDcf(sheet, title, payload, refs) {
  const p = sheet?.payload || {};
  const formula = sheet?.formula || 'FCFF=期间税后经营利润+期间折旧摊销+期间ESOP−期间资本开支−ΔNWC。锚定年且不是12月时，期间数=年底全年−锚定日累计，ESOP按剩余月；以后各年期间数=全年。终值=退出倍数×末期全年基数+锚定日净负债。股权价值=企业价值−同一笔净负债';
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
  b.start(6);
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
  b.gap(1, 6);
  b.header(['序号', '项目', '低端倍数', '高端倍数', '低端非流通权益（亿元）', '高端非流通权益（亿元）']);
  const peM = p.pe_multiples || {};
  const psM = p.ps_multiples || {};
  const psExcel = b.aoa.length + 1;
  b.data([
    1, 'P/S',
    num(psM.min), num(psM.median),
    F(p.ps?.low?.illiquid_yi ?? asYi(p.ps?.low?.illiquid), `C${psExcel}*$B$${revExcel}*(1-$B$${discExcel})/10000`),
    F(p.ps?.mid?.illiquid_yi ?? asYi(p.ps?.mid?.illiquid), `D${psExcel}*$B$${revExcel}*(1-$B$${discExcel})/10000`),
  ], ['seq', 'text', 'num', 'num', 'yi', 'yi']);
  const peExcelRow = b.aoa.length + 1;
  b.data([
    2, 'P/E',
    num(peM.min), num(peM.median),
    F(p.pe?.low?.illiquid_yi ?? asYi(p.pe?.low?.illiquid), `C${peExcelRow}*$B$${peExcel}*(1-$B$${discExcel})/10000`),
    F(p.pe?.mid?.illiquid_yi ?? asYi(p.pe?.mid?.illiquid), `D${peExcelRow}*$B$${peExcel}*(1-$B$${discExcel})/10000`),
  ], ['seq', 'text', 'num', 'num', 'yi', 'yi']);
  if (refs) {
    refs.psIlliqLow = `E${psExcel}`;
    refs.psIlliqMid = `F${psExcel}`;
    refs.peIlliqLow = `E${peExcelRow}`;
    refs.peIlliqMid = `F${peExcelRow}`;
  }
  b.widths.splice(0, b.widths.length, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 24 });
  return b;
}

function buildRelative(sheet, title) {
  const rows = Array.isArray(sheet?.payload) ? sheet.payload : [];
  const b = sheetBuilder(title, sheet?.formula || '单家取数：底稿中位，否则历史中位，否则锚定截面。低端=取用值中位数−σ，高端=中位数。可比强度只作标记');
  const headers = [
    '序号', '代码', '名称', '入池', '可比强度', '截面日',
    'PE 锚定截面', 'PE 中位', 'PE 底稿中位', 'PE σ', 'PE −1σ', 'PE +1σ',
    'PS 锚定截面', 'PS 中位', 'PS 底稿中位', 'PS σ', 'PS −1σ', 'PS +1σ',
    'PE 取用', 'PS 取用', '提示',
  ];
  b.start(headers.length);
  b.header(headers);
  const kinds = ['seq', 'text', 'text', 'text', 'text', 'text', ...Array(14).fill('num'), 'text'];
  const dataStart = b.aoa.length + 1;
  const degreeLabel = { strong: '强', medium: '中', weak: '弱' };
  let poolCount = 0;
  let peTakeCount = 0;
  let psTakeCount = 0;
  rows.forEach((r, i) => {
    const excel = dataStart + i;
    const hint = [r.quality_warning, r.pe_usable === false ? 'PE 未入统计' : null, r.ps_usable === false ? 'PS 未入统计' : null]
      .filter(Boolean).join('；') || null;
    const peUsed = poolUsedNumber(r, 'pe');
    const psUsed = poolUsedNumber(r, 'ps');
    if (r.in_pool && !r._summary) poolCount += 1;
    if (peUsed != null) peTakeCount += 1;
    if (psUsed != null) psTakeCount += 1;
    b.data([
      i + 1, r.stock_code, r.stock_name, r.in_pool ? '是' : '否',
      degreeLabel[r.comparability] || '中',
      r.asof_trade_date || r.asof_date || null,
      num(r.pe_latest), num(r.pe_median), num(r.pe_median_override), num(r.pe_stdev),
      F(num(r.pe_minus_1s), `H${excel}-J${excel}`),
      F(num(r.pe_plus_1s), `H${excel}+J${excel}`),
      num(r.ps_latest), num(r.ps_median), num(r.ps_median_override), num(r.ps_stdev),
      F(num(r.ps_minus_1s), `N${excel}-P${excel}`),
      F(num(r.ps_plus_1s), `N${excel}+P${excel}`),
      peUsed != null ? F(peUsed, `IF(I${excel}="",IF(H${excel}="",G${excel},H${excel}),I${excel})`) : null,
      psUsed != null ? F(psUsed, `IF(O${excel}="",IF(N${excel}="",M${excel},N${excel}),O${excel})`) : null,
      hint,
    ], kinds);
  });
  if (!rows.length) {
    b.data(['', '暂无相对估值结果', ...Array(19).fill(null)], kinds);
    return b;
  }
  b.gap(1, headers.length);
  const peVals = rows.map((r) => poolUsedNumber(r, 'pe')).filter((n) => n != null);
  const psVals = rows.map((r) => poolUsedNumber(r, 'ps')).filter((n) => n != null);
  const peMed = medianNums(peVals);
  const psMed = medianNums(psVals);
  const peSd = stdevNums(peVals);
  const psSd = stdevNums(psVals);
  const takeExcel = b.aoa.length + 1;
  const lastData = dataStart + rows.length - 1;
  const peMedF = peTakeCount ? `MEDIAN(S${dataStart}:S${lastData})` : null;
  const psMedF = psTakeCount ? `MEDIAN(T${dataStart}:T${lastData})` : null;
  const peSdF = peTakeCount >= 2 ? `STDEV.S(S${dataStart}:S${lastData})` : null;
  const psSdF = psTakeCount >= 2 ? `STDEV.S(T${dataStart}:T${lastData})` : null;
  const peLow = peMed != null && peSd != null ? peMed - peSd : peMed;
  const psLow = psMed != null && psSd != null ? psMed - psSd : psMed;
  b.data([
    '', '取用结果', null, `${poolCount} 家入池`, null, null,
    null, F(peMed, peMedF), null, F(peSd, peSdF), F(peLow, `H${takeExcel}-J${takeExcel}`), null,
    null, F(psMed, psMedF), null, F(psSd, psSdF), F(psLow, `N${takeExcel}-P${takeExcel}`), null,
    null, null,
    '单家取数：底稿中位，否则历史中位，否则锚定截面。本行中位=高端倍数，−1σ=低端倍数。可比强度不参与',
  ], kinds);
  return b;
}

function poolUsedNumber(r, kind) {
  if (!r?.in_pool || r._summary) return null;
  const ov = num(r[`${kind}_median_override`]);
  if (ov != null) return ov;
  const med = num(r[`${kind}_median`]);
  const latest = num(r[`${kind}_latest`]);
  const v = med != null ? med : latest;
  if (v == null) return null;
  if (kind === 'pe' && (v === 0 || Math.abs(v) > 500)) return null;
  if (kind === 'ps' && (v <= 0 || v > 80)) return null;
  return v;
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
  return buildMetricYearSheet(sheet, title, true, {
    selling: '销售费用率',
    admin: '管理费用率',
    rd: '研发费用率',
  }, [
    ['销售费用率可比集中位数', sheet?.payload?.selling_median],
    ['管理费用率可比集中位数', sheet?.payload?.admin_median],
    ['研发费用率可比集中位数', sheet?.payload?.rd_median],
  ]);
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
  return buildMetricYearSheet(sheet, title, false, {
    dso: 'DSO（应收周转天数）',
    dpo: 'DPO（应付周转天数）',
    dio: 'DIO（存货周转天数）',
  }, [
    ['DSO 可比集中位数（天）', sheet?.payload?.dso_median],
    ['DPO 可比集中位数（天）', sheet?.payload?.dpo_median],
    ['DIO 可比集中位数（天）', sheet?.payload?.dio_median],
  ]);
}

function buildMetricYearSheet(sheet, title, asPercent, nameByKey, setLines) {
  const p = sheet?.payload || {};
  const companies = Array.isArray(p.companies) ? p.companies : [];
  const years = collectItemYears(companies);
  const b = sheetBuilder(title, sheet?.formula);
  const headers = ['序号', '代码', '名称', '项目', asPercent ? '最新（%）' : '最新', asPercent ? '中位数（%）' : '中位数', ...years.map((y) => (asPercent ? `${y}（%）` : String(y)))];
  b.start(Math.max(headers.length, 6));
  (setLines || []).forEach(([label, value]) => {
    if (value == null) return;
    b.note(`${label}：${asPercent ? `${(Number(value) * 100).toFixed(2)}%` : Number(value).toFixed(1)}`, headers.length);
  });
  b.header(headers);
  const kinds = ['seq', 'text', 'text', 'text', ...Array(2 + years.length).fill('num')];
  let seq = 0;
  companies.forEach((c) => {
    (c.items || []).forEach((item) => {
      seq += 1;
      const byYear = item.by_year || {};
      const cell = (v) => (asPercent ? asPct(v) : num(v));
      b.data([
        seq, c.stock_code, c.stock_name, item.name || nameByKey[item.key] || item.key,
        cell(item.latest), cell(item.median), ...years.map((y) => cell(byYear[y])),
      ], kinds);
    });
  });
  if (!seq) b.data(['', '暂无结果', null, null, null, null], ['seq', 'text', 'text', 'text', 'num', 'num']);
  return b;
}

function collectItemYears(companies) {
  const set = new Set();
  for (const c of companies || []) {
    for (const item of c.items || []) {
      Object.keys(item.by_year || {}).forEach((y) => set.add(String(y)));
    }
  }
  return [...set].filter((y) => /^\d{4}/.test(y)).sort();
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
  const b = sheetBuilder(title, sheet?.formula || '净负债=短期借款+一年内到期的非流动负债+长期借款+租赁负债−货币资金；净应收=应收账款（含票据）−合同负债；净应付=应付账款（含票据）−预付款项；营运资本=净应收+存货−净应付');
  b.start(3);
  b.header(['序号', '科目', '金额（万元）']);
  const startExcel = b.aoa.length + 1;
  const rowOf = {};
  BS_VISIBLE_FIELDS.forEach((f, i) => {
    rowOf[f.key] = startExcel + i;
    b.data([i + 1, f.label, amt(p[f.key])], ['seq', 'text', 'wan']);
  });
  const n = BS_VISIBLE_FIELDS.length;
  const nd = netDebtAmount(scaled) || 0;
  const nwc = (nwcStockFromBs(scaled) || 0);
  const ca = currentAssetsFromBs(scaled);
  const ta = totalAssetsFromBs(scaled);
  const cl = currentLiabFromBs(scaled);
  const tl = totalLiabFromBs(scaled);
  const cSt = `C${rowOf.short_term_loan}`;
  const cCp = `C${rowOf.current_portion_noncurrent}`;
  const cLt = `C${rowOf.long_term_loan}`;
  const cLease = `C${rowOf.lease_liability}`;
  const cCash = `C${rowOf.cash}`;
  const clFilled = scaled.contract_liability != null && scaled.contract_liability !== '';
  const advExtra = clFilled ? 0 : (Number(scaled.advance_receipt) || 0);
  const nwcF = `C${rowOf.accounts_receivable}-C${rowOf.contract_liability}-${advExtra}+C${rowOf.inventory}-C${rowOf.accounts_payable}+C${rowOf.prepayment}`;
  const eq = equityBookFromBs(scaled);
  b.data([n + 1, '流动资产合计（自动）', ca], ['seq', 'text', 'wan']);
  b.data([n + 2, '资产总计（自动）', ta], ['seq', 'text', 'wan']);
  b.data([n + 3, '流动负债合计（自动）', cl], ['seq', 'text', 'wan']);
  b.data([n + 4, '负债总计（自动）', tl], ['seq', 'text', 'wan']);
  b.data([n + 5, '所有者权益总计（自动）', eq], ['seq', 'text', 'wan']);
  b.data([n + 6, '净负债（自动）', F(nd, `${cSt}+${cCp}+${cLt}+${cLease}-${cCash}`)], ['seq', 'text', 'wan']);
  b.data([n + 7, '期末营运资本占用（自动）', F(nwc, nwcF)], ['seq', 'text', 'wan']);
  const dr = debtRatioFromBs(scaled);
  const cr = currentRatioFromBs(scaled);
  b.data([n + 8, '资产负债率（自动）', dr], ['seq', 'text', 'num']);
  b.data([n + 9, '流动比率（自动）', cr], ['seq', 'text', 'num']);
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
  const b = sheetBuilder(title, sheet?.formula || '净负债=短期借款+一年内到期的非流动负债+长期借款+租赁负债−货币资金。FCFF=期间税后经营利润+期间折旧摊销+期间ESOP−期间资本开支−ΔNWC。ΔNWC是增加额，不是期末占用');
  const pickedBs = pickBs(payload);
  const bs = pickedBs.bs;
  const dcf = payload?.sheets?.dcf?.payload?.primary || {};
  const pvs = Array.isArray(dcf.pvs) ? dcf.pvs : [];
  const bsAmt = (v) => toWan(v, pickedBs.yuan);

  b.start(11);
  b.section('资产负债勾稽（万元）');
  b.header(['项目', '公式', '金额（万元）', '说明']);
  const scaledBs = {};
  for (const k of BS_INPUT_KEYS) scaledBs[k] = bsAmt(bs[k]);
  const ndBs = netDebtAmount(scaledBs);
  const nwc = nwcStockFromBs(scaledBs);
  const ndDcf = wanFromYuan(dcf.net_debt);
  b.data(['净负债（资产负债表）', '短期借款+一年内到期的非流动负债+长期借款+租赁负债−货币资金', ndBs, '进入 DCF 扣减'], ['text', 'text', 'wan', 'text']);
  b.data(['净负债（DCF）', '引擎扣减额', ndDcf, Math.abs((ndBs || 0) - (ndDcf || 0)) > 0.5 ? '与资产负债表不一致' : '一致'], ['text', 'text', 'wan', 'text']);
  b.data(['期末营运资本占用', '（应收账款−合同负债）+存货−（应付账款−预付款项）', nwc, '时点余额，不是 ΔNWC'], ['text', 'text', 'wan', 'text']);
  b.gap(1);
  const series = dcf.series || {};
  const years = pvs.map((x) => x.year);
  const hasPeriod = Array.isArray(series.period_nopat) && series.period_nopat.length === years.length && years.length > 0;
  b.section('自由现金流勾稽（万元）');
  if (hasPeriod) {
    b.header(['年份', '期间税后经营利润', '期间折旧摊销', '期间ESOP', '期间资本开支', '扣营运资本前现金流', 'ΔNWC', 'FCF（勾稽）', 'FCF（DCF）', '差额']);
    const kinds = ['text', 'wan', 'wan', 'wan', 'wan', 'wan', 'wan', 'wan', 'wan', 'wan'];
    const dataStart = b.aoa.length + 1;
    const issues = [];
    years.forEach((year, i) => {
      const nopatWan = wanFromYuan(series.period_nopat?.[i] ?? pvs[i]?.period_nopat) ?? 0;
      const da = wanFromYuan(series.period_da?.[i] ?? pvs[i]?.period_da) ?? 0;
      const esopWan = wanFromYuan(series.period_esop?.[i] ?? pvs[i]?.period_esop) ?? 0;
      const capex = wanFromYuan(series.period_capex?.[i] ?? pvs[i]?.period_capex) ?? 0;
      const dnwc = wanFromYuan(series.dnwc?.[i] ?? pvs[i]?.dnwc) ?? 0;
      const before = nopatWan + da + esopWan - capex;
      const expected = before - dnwc;
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
        year, nopatWan, da, esopWan, capex,
        F(before, `B${excel}+C${excel}+D${excel}-E${excel}`),
        dnwc,
        F(expected, `F${excel}-G${excel}`),
        actual,
        F(gap, `H${excel}-I${excel}`),
      ], kinds);
    });
    const uniqueIssues = [...new Set(issues)];
    if (uniqueIssues.length) uniqueIssues.forEach((t) => b.note(t));
    else b.note('未发现 ΔNWC 与期末占用明显串科目。差额列应接近 0。');
  } else {
    b.header(['年份', '税后经营利润', '折旧摊销', 'ESOP', '资本开支', '流量比例', '扣营运资本前现金流', 'ΔNWC', 'FCF（勾稽）', 'FCF（DCF）', '差额']);
    const kinds = ['text', 'wan', 'wan', 'wan', 'wan', 'num', 'wan', 'wan', 'wan', 'wan', 'wan'];
    const dataStart = b.aoa.length + 1;
    const issues = [];
    years.forEach((year, i) => {
      const nopatWan = wanFromYuan(series.nopat?.[i] ?? pvs[i]?.nopat) ?? 0;
      const da = wanFromYuan(series.da?.[i] ?? pvs[i]?.da) ?? 0;
      const esopWan = wanFromYuan(series.esop?.[i] ?? pvs[i]?.esop) ?? 0;
      const capex = wanFromYuan(series.capex?.[i] ?? pvs[i]?.capex) ?? 0;
      const scale = num(series.flow_scale?.[i], 1);
      const dnwc = wanFromYuan(series.dnwc?.[i] ?? pvs[i]?.dnwc) ?? 0;
      const before = (nopatWan + da + esopWan - capex) * scale;
      const expected = before - dnwc;
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
        year, nopatWan, da, esopWan, capex, scale,
        F(before, `(B${excel}+C${excel}+D${excel}-E${excel})*F${excel}`),
        dnwc,
        F(expected, `G${excel}-H${excel}`),
        actual,
        F(gap, `I${excel}-J${excel}`),
      ], kinds);
    });
    if (!years.length) b.data(['暂无 DCF 年', null, null, null, null, null, null, null, null, null, null], kinds);
    const uniqueIssues = [...new Set(issues)];
    if (uniqueIssues.length) uniqueIssues.forEach((t) => b.note(t));
    else b.note('未发现 ΔNWC 与期末占用明显串科目。差额列应接近 0。');
  }
  b.gap(1);
  (p.warnings || []).forEach((w) => b.note(String(w)));
  b.widths.splice(0, b.widths.length,
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
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
      formula: '净负债=短期借款+一年内到期的非流动负债+长期借款+租赁负债−货币资金。FCFF=期间税后经营利润+期间折旧摊销+期间ESOP−期间资本开支−ΔNWC。ΔNWC是增加额，不是期末占用',
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
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F8FF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F3FF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CD"/><bgColor indexed="64"/></patternFill></fill>
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
<cellXfs count="18">
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
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="4" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
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
  oddSeq: 14,
  evenSeq: 15,
  centerNum: 16,
  centerText: 17,
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
  if (colKind === 'seq') return XF[`${even}Seq`];
  if (colKind === 'num') return XF[`${even}Num`];
  if (colKind === 'centerNum') return XF.centerNum;
  if (colKind === 'centerText') return XF.centerText;
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
