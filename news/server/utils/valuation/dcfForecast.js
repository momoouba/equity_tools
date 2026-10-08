/**
 * DCF 预测：锚定日折现、年化收入、占收入比例、FCFF、周转天数倒推的 ΔNWC。
 * 金额单位：元。比例为小数（0.15 = 15%）。天数单位：天。
 */
const { normalizeBs, netDebtAmount, equityBookFromBs, totalAssetsFromBs, totalLiabFromBs } = require('./targetBsFields');
const { parseYmd } = require('./marketUtils');

const STATEMENT_MD = new Set(['03-31', '06-30', '09-30', '12-31']);

const RATIOS = [
  { key: 'cogs_ratio', label: '营业成本', nonNegative: false, growth: true, amountKey: 'cogs' },
  { key: 'surtax_ratio', label: '营业税金及附加', nonNegative: true },
  { key: 'selling_ratio', label: '销售费用', nonNegative: false, growth: true, amountKey: 'selling' },
  { key: 'admin_ratio', label: '管理费用', nonNegative: false, growth: true, amountKey: 'admin' },
  { key: 'rd_ratio', label: '研发费用', nonNegative: false, growth: true, amountKey: 'rd' },
  { key: 'finance_expense_ratio', label: '财务费用', nonNegative: false, growth: true, amountKey: 'finance_expense', optional: true },
  { key: 'other_income_ratio', label: '其他收益', nonNegative: false },
  { key: 'other_ratio', label: '其他', nonNegative: false },
  { key: 'da_ratio', label: '折旧摊销', nonNegative: true },
  { key: 'capex_ratio', label: '资本开支', nonNegative: true },
];

const DEFAULT_DISCOUNT = 0.3;
const DEFAULT_EXIT_PE = 40;
const DEFAULT_EXIT_PS = 20;
const DEFAULT_LIQUIDITY = 0.3;

const DAY_SPECS = [
  { key: 'dso', label: 'DSO' },
  { key: 'dpo', label: 'DPO' },
  { key: 'dio', label: '存货周转天数' },
];

const FORECAST_PL_SERIES = {
  cogs_ratio: 'cogs',
  surtax_ratio: 'surtax',
  selling_ratio: 'selling',
  admin_ratio: 'admin',
  rd_ratio: 'rd',
  finance_expense_ratio: 'finance_expense',
  other_income_ratio: 'other_income',
  other_ratio: 'other',
  da_ratio: 'da',
  capex_ratio: 'capex',
};

const FORECAST_PL_AMOUNT_KEYS = ['revenue', ...Object.values(FORECAST_PL_SERIES)];

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function num0(v) {
  const n = toNumber(v);
  return n == null ? 0 : n;
}

function parseAnchor(value) {
  const parsed = parseYmd(value);
  const raw = parsed || (value == null ? '' : String(value).trim().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return {
      ok: false,
      ymd: raw || null,
      year: null,
      month: null,
      message: '请选择估值锚定日，须为最近一期报表日',
    };
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const md = raw.slice(5);
  if (!STATEMENT_MD.has(md)) {
    return {
      ok: false,
      ymd: raw,
      year,
      month,
      message: '估值锚定日须为 3 月 31 日、6 月 30 日、9 月 30 日或 12 月 31 日，请到方法配置修改',
    };
  }
  return { ok: true, ymd: raw, year, month, message: null };
}

function isStatementAnchor(value) {
  return parseAnchor(value).ok;
}

function discountYears(forecastYear, anchor) {
  const y = Number(forecastYear);
  return ((y - anchor.year) * 12 + (12 - anchor.month)) / 12;
}

function flowScale(forecastYear, anchor) {
  const y = Number(forecastYear);
  if (y === anchor.year && anchor.month < 12) return (12 - anchor.month) / 12;
  return 1;
}

function expectedFirstYear(anchor) {
  return anchor.month === 12 ? anchor.year + 1 : anchor.year;
}

function yearAmount(pl, key, year) {
  const years = Array.isArray(pl?.years) ? pl.years : [];
  const i = years.findIndex((y) => Number(String(y).replace(/[^\d]/g, '').slice(0, 4)) === year);
  if (i < 0) return null;
  return toNumber(pl[key]?.[i]);
}

/** 当期是年内累计时先年化，再按各年增速：本年 = 上一年 × (1+增速)。 */
function growAnnualized(base, rates, anchor) {
  let prev = base * 12 / anchor.month;
  return rates.map((g) => {
    const next = prev * (1 + num0(g));
    prev = next;
    return next;
  });
}

function carryForward(arr, n) {
  const values = [];
  let last = null;
  let filled = false;
  for (let i = 0; i < n; i += 1) {
    const v = toNumber(arr?.[i]);
    if (v != null) {
      last = v;
      filled = true;
    }
    values.push(last);
  }
  return { values, filled };
}

function pvFactor(rate, t) {
  if (!(rate > -1)) return 0;
  return 1 / (1 + rate) ** t;
}

function yuanToYi(v) {
  const n = toNumber(v);
  return n == null ? null : n / 1e8;
}

function blankResult(extra) {
  return {
    blocked: true,
    blockers: [],
    pvs: [],
    fcf: [],
    equity_value: null,
    equity_value_yi: null,
    enterprise_value: null,
    net_debt: null,
    terminal_value: null,
    terminal_pv: null,
    terminal_base: null,
    terminal_year: null,
    exit_multiple: null,
    forecast_bs: [],
    series: null,
    ...extra,
  };
}

function bsBalanced(bs) {
  const assets = totalAssetsFromBs(bs);
  const liab = totalLiabFromBs(bs);
  const equity = equityBookFromBs(bs);
  if (assets == null || liab == null || equity == null) return false;
  return Math.abs(assets - (liab + equity)) <= 100;
}

function yearListBlockers(years, anchor) {
  const out = [];
  const ys = (years || []).map((y) => Number(String(y).replace(/[^\d]/g, '').slice(0, 4)));
  if (!ys.length || ys.some((y) => !Number.isFinite(y))) {
    out.push('预测年已删光，请到标的利润表至少保留一年');
    return { ok: false, years: [], blockers: out };
  }
  if (ys.length > 15) {
    out.push('预测年超过 15 年，请到标的利润表删到 15 年以内');
  }
  for (let i = 1; i < ys.length; i += 1) {
    if (ys[i] !== ys[i - 1] + 1) {
      out.push('预测年须连续，请到标的利润表只在末尾增删');
      break;
    }
  }
  const start = expectedFirstYear(anchor);
  if (ys[0] !== start) {
    out.push(`预测首年应为 ${start}，请到标的利润表按锚定日排列年份`);
  }
  const last = ys[ys.length - 1];
  if (anchor.month < 12 && last <= anchor.year) {
    out.push(`终值不能留在不满 12 个月的锚定年，请到标的利润表至少保留到 ${anchor.year + 1} 年`);
  }
  if (anchor.month === 12 && last < anchor.year + 1) {
    out.push(`请到标的利润表至少保留 ${anchor.year + 1} 年`);
  }
  return { ok: out.length === 0, years: ys.map(String), blockers: out };
}

const PL_ARRAY_KEYS = [
  'revenue_growth', 'dso', 'dpo', 'dio',
  'revenue', 'cogs', 'gross_profit', 'selling', 'admin', 'rd', 'operating_profit', 'net_income',
  ...RATIOS.map((r) => r.key),
];

/** 锚定年之前的列是导入的当期，不进入预测。 */
function sliceForecastPl(pl, anchor) {
  const start = expectedFirstYear(anchor);
  const years = Array.isArray(pl?.years) ? pl.years : [];
  const idx = [];
  years.forEach((y, i) => {
    const n = Number(String(y).replace(/[^\d]/g, '').slice(0, 4));
    if (n >= start) idx.push(i);
  });
  if (!idx.length || idx.length === years.length) return pl || {};
  const out = { ...(pl || {}), years: idx.map((i) => years[i]) };
  for (const key of PL_ARRAY_KEYS) {
    if (Array.isArray(pl[key])) out[key] = idx.map((i) => pl[key][i]);
  }
  return out;
}

function resolveDays(override, median) {
  if (override != null) return override;
  if (median == null) return null;
  if (median < 0) return median;
  return median;
}

function forecastDayDefault(assumptions, median, key) {
  const user = toNumber(assumptions?.[`forecast_${key}`]);
  if (user != null) return user;
  return median;
}

/**
 * @returns 单套 DCF。blockers 为中文清单，不含「待补」前缀。
 */
function buildDcfForecast({
  assumptions = {},
  targetPl = {},
  targetBs = {},
  workingCapital = {},
  baseRate = null,
  scenarioRate = null,
  scenarioLabel = '',
  scenarioName = '',
  terminalType = 'exit_pe',
  exitMultiple = null,
  applyLiquidity = false,
  liquidityDiscount = null,
  forecastPl = {},
} = {}) {
  const blockers = [];
  const anchor = parseAnchor(assumptions.valuation_date);
  const sourcePl = targetPl || {};
  if (anchor.ok) targetPl = sliceForecastPl(sourcePl, anchor);
  if (!anchor.ok) blockers.push(anchor.message);

  const yearCheck = anchor.ok
    ? yearListBlockers(targetPl.years, anchor)
    : { ok: false, years: [], blockers: [] };
  blockers.push(...yearCheck.blockers);
  const years = yearCheck.years;
  const n = years.length;

  let ytd = toNumber(assumptions.ytd_revenue);
  if (!(ytd > 0) && anchor.ok) ytd = yearAmount(sourcePl, 'revenue', anchor.year);
  if (ytd == null || ytd <= 0) {
    blockers.push('请到标的利润表填写估值锚定日当期累计营业收入，须为正数');
  }

  const rawTax = toNumber(assumptions.tax_rate);
  let tax = 0.15;
  if (rawTax != null) {
    if (rawTax < 0 || rawTax > 1) {
      blockers.push('所得税率小于 0 或大于 100%，请到标的利润表修改');
    } else {
      tax = rawTax;
    }
  }

  const bs = normalizeBs(targetBs);
  if (!bsBalanced(bs)) {
    blockers.push('标的资产负债表实际列未配平，资产应等于负债加所有者权益，请到标的资产负债表修改');
  }

  const growth = n ? carryForward(targetPl.revenue_growth, n) : { values: [], filled: false };
  if (n && !growth.filled) {
    blockers.push('标的利润表的收入增速从未填写，请到标的利润表补上');
  }
  const carriedRatios = {};
  for (const spec of RATIOS) {
    const carried = n ? carryForward(targetPl[spec.key], n) : { values: [], filled: false };
    carriedRatios[spec.key] = carried;
    if (n && !carried.filled) {
      if (spec.optional) {
        carriedRatios[spec.key] = { values: Array(n).fill(0), filled: true };
      } else {
        const kind = spec.growth ? '增速' : '占收入比例';
        blockers.push(`标的利润表的「${spec.label}」${kind}从未填写，请到标的利润表补上`);
      }
    }
    if (!spec.nonNegative) continue;
    for (let i = 0; i < n; i += 1) {
      const raw = toNumber(targetPl[spec.key]?.[i]);
      if (raw != null && raw < 0) {
        blockers.push(`标的利润表 ${years[i]} 年「${spec.label}」占收入比例小于 0，请改为大于等于 0`);
      }
    }
  }

  const medians = {
    dso: forecastDayDefault(assumptions, toNumber(workingCapital?.dso_median), 'dso'),
    dpo: forecastDayDefault(assumptions, toNumber(workingCapital?.dpo_median), 'dpo'),
    dio: forecastDayDefault(assumptions, toNumber(workingCapital?.dio_median), 'dio'),
  };
  const daysByYear = years.map(() => ({}));
  for (let i = 0; i < n; i += 1) {
    for (const spec of DAY_SPECS) {
      const override = toNumber(targetPl[spec.key]?.[i]);
      const used = resolveDays(override, medians[spec.key]);
      daysByYear[i][spec.key] = used;
      if (used == null) {
        blockers.push(`标的资产负债表 ${years[i]} 年${spec.label}没有可比中位数，也未填写，请到标的资产负债表补周转天数`);
      } else if (used < 0) {
        blockers.push(`标的资产负债表 ${years[i]} 年${spec.label}小于 0，请改为大于等于 0`);
      }
    }
  }

  const scenarioFilled = scenarioLabel ? toNumber(scenarioRate) : null;
  let rate = null;
  if (scenarioLabel && scenarioFilled != null) {
    if (scenarioFilled <= 0) {
      blockers.push(`${scenarioLabel}折现率小于等于 0，请到方法配置修改`);
    } else {
      rate = scenarioFilled;
    }
  } else if (baseRate == null) {
    rate = DEFAULT_DISCOUNT;
  } else if (!(baseRate > 0)) {
    blockers.push('折现率小于等于 0，请到方法配置修改');
  } else {
    rate = baseRate;
  }

  const usePs = terminalType === 'exit_ps';
  let multiple = toNumber(exitMultiple);
  const multipleName = usePs ? '退出 P/S' : '退出 P/E';
  const who = scenarioLabel ? `${scenarioLabel}的` : '';
  if (multiple == null) multiple = usePs ? DEFAULT_EXIT_PS : DEFAULT_EXIT_PE;
  else if (multiple <= 0) {
    blockers.push(`${who}${multipleName}小于等于 0，请到方法配置修改`);
  }

  let liquidity = toNumber(liquidityDiscount);
  if (applyLiquidity) {
    if (liquidity == null) liquidity = DEFAULT_LIQUIDITY;
    else if (liquidity < 0 || liquidity > 1) {
      blockers.push('DCF 流动性折扣不在 0% 到 100% 之间，请到方法配置修改');
    }
  }

  const canProject = anchor.ok && yearCheck.ok && ytd != null && ytd > 0 && growth.filled && n > 0;
  const revenues = [];
  if (canProject) {
    const annualized = ytd * 12 / anchor.month;
    let prev = annualized;
    for (let i = 0; i < n; i += 1) {
      const g = growth.values[i];
      const manualRev = manualPlAmount(forecastPl, years[i], 'revenue');
      const rev = manualRev != null ? manualRev : prev * (1 + num0(g));
      revenues.push(rev);
      if (rev <= 0) {
        blockers.push(`${years[i]} 年全年营业收入小于等于 0，请修改该年收入增速或预测利润表中的营业收入，使全年收入为正`);
      }
      prev = rev;
    }
  }

  const ratiosOk = RATIOS.every((spec) => carriedRatios[spec.key]?.filled)
    && RATIOS.filter((spec) => spec.nonNegative).every((spec) => (
      (targetPl[spec.key] || []).every((v) => {
        const raw = toNumber(v);
        return raw == null || raw >= 0;
      })
    ));
  const daysOk = daysByYear.every((row) => DAY_SPECS.every((spec) => row[spec.key] != null && row[spec.key] >= 0));
  const revenueOk = canProject && revenues.length === n && revenues.every((r) => r > 0);
  const ready = blockers.length === 0 && revenueOk && ratiosOk && daysOk && bsBalanced(bs) && rate > 0 && multiple > 0;

  if (!ready) {
    return blankResult({
      blockers,
      scenario_name: scenarioName || null,
      discount_rate: rate,
      apply_liquidity: applyLiquidity,
      liquidity_discount: applyLiquidity ? liquidity : null,
      net_debt: netDebtAmount(bs),
    });
  }

  const growthBase = {};
  for (const spec of RATIOS) {
    if (!spec.growth || !anchor.ok) continue;
    growthBase[spec.key] = yearAmount(sourcePl, spec.amountKey, anchor.year);
  }
  const usedGrowth = {};

  const esopAnnual = toNumber(assumptions.esop) ?? 0;
  const nd = netDebtAmount(bs) ?? 0;
  const openingNwc = num0(bs.accounts_receivable) + num0(bs.inventory) - num0(bs.accounts_payable);
  const series = {
    years: [...years],
    revenue: [],
    cogs: [],
    surtax: [],
    selling: [],
    admin: [],
    rd: [],
    finance_expense: [],
    other_income: [],
    other: [],
    da: [],
    capex: [],
    ebitda: [],
    pretax: [],
    nopat: [],
    esop: [],
    dnwc: [],
    revenue_growth: growth.values.slice(),
    dso: [],
    dpo: [],
    dio: [],
    gross_profit: [],
    flow_scale: [],
    nwc: [],
    fcff_before_nwc: [],
    opening_nwc: openingNwc,
    tax_rate: tax,
  };
  const forecastBs = [];
  let prevNwc = openingNwc;
  for (let i = 0; i < n; i += 1) {
    const rev = revenues[i];
    const ratioOf = (key) => num0(carriedRatios[key].values[i]);
    const line = (ratioKey) => {
      const seriesKey = FORECAST_PL_SERIES[ratioKey];
      const manual = manualPlAmount(forecastPl, years[i], seriesKey);
      if (manual != null) return manual;
      const ratio = ratioOf(ratioKey);
      const base = growthBase[ratioKey];
      if (base != null) {
        if (i === 0) return base * (12 / anchor.month) * (1 + ratio);
        return usedGrowth[ratioKey][i - 1] * (1 + ratio);
      }
      return rev * ratio;
    };
    const cogs = line('cogs_ratio');
    const surtax = line('surtax_ratio');
    const selling = line('selling_ratio');
    const admin = line('admin_ratio');
    const rd = line('rd_ratio');
    const financeExpense = line('finance_expense_ratio');
    const otherIncome = line('other_income_ratio');
    const other = line('other_ratio');
    const da = line('da_ratio');
    const capex = line('capex_ratio');
    usedGrowth.cogs_ratio = usedGrowth.cogs_ratio || [];
    usedGrowth.selling_ratio = usedGrowth.selling_ratio || [];
    usedGrowth.admin_ratio = usedGrowth.admin_ratio || [];
    usedGrowth.rd_ratio = usedGrowth.rd_ratio || [];
    usedGrowth.finance_expense_ratio = usedGrowth.finance_expense_ratio || [];
    usedGrowth.cogs_ratio.push(cogs);
    usedGrowth.selling_ratio.push(selling);
    usedGrowth.admin_ratio.push(admin);
    usedGrowth.rd_ratio.push(rd);
    usedGrowth.finance_expense_ratio.push(financeExpense);
    const ebitda = rev - cogs - surtax - selling - admin - rd + otherIncome + other + da;
    const pretax = ebitda - da;
    const nopat = pretax > 0 ? pretax * (1 - tax) : pretax;
    const dso = daysByYear[i].dso;
    const dpo = daysByYear[i].dpo;
    const dio = daysByYear[i].dio;
    const ar = (dso / 360) * rev;
    const inv = (dio / 360) * cogs;
    const ap = (dpo / 360) * cogs;
    const nwc = ar + inv - ap;
    const dnwc = nwc - prevNwc;
    const scale = flowScale(years[i], anchor);
    const beforeNwc = (nopat + da + esopAnnual - capex) * scale;
    prevNwc = nwc;
    series.revenue.push(rev);
    series.cogs.push(cogs);
    series.surtax.push(surtax);
    series.selling.push(selling);
    series.admin.push(admin);
    series.rd.push(rd);
    series.finance_expense.push(financeExpense);
    series.other_income.push(otherIncome);
    series.other.push(other);
    series.da.push(da);
    series.capex.push(capex);
    series.ebitda.push(ebitda);
    series.pretax.push(pretax);
    series.nopat.push(nopat);
    series.esop.push(esopAnnual);
    series.dnwc.push(dnwc);
    series.dso.push(dso);
    series.dpo.push(dpo);
    series.dio.push(dio);
    series.gross_profit.push(rev - cogs);
    series.flow_scale.push(scale);
    series.nwc.push(nwc);
    series.fcff_before_nwc.push(beforeNwc);
    const col = { ...bs, accounts_receivable: ar, inventory: inv, accounts_payable: ap, year: years[i] };
    const assets = totalAssetsFromBs(col);
    const liab = totalLiabFromBs(col);
    const equity = equityBookFromBs(col);
    col.imbalance = num0(assets) - num0(liab) - num0(equity);
    forecastBs.push(col);
  }

  const lastNopat = series.nopat[n - 1];
  if (!usePs && !(lastNopat > 0)) {
    blockers.push(`最后一年 ${years[n - 1]} 税后经营利润小于等于 0，不能乘退出 P/E。请把预测延到该年为正，或在方法配置把退出方式改成 P/S`);
    return blankResult({
      blockers,
      scenario_name: scenarioName || null,
      series,
      forecast_bs: forecastBs,
      net_debt: nd,
      discount_rate: rate,
      apply_liquidity: applyLiquidity,
      liquidity_discount: applyLiquidity ? liquidity : null,
    });
  }

  const pvs = [];
  let ev = 0;
  for (let i = 0; i < n; i += 1) {
    const scale = flowScale(years[i], anchor);
    const flow = (series.nopat[i] + series.da[i] + esopAnnual - series.capex[i]) * scale;
    const fcf = flow - series.dnwc[i];
    const periods = discountYears(years[i], anchor);
    const factor = pvFactor(rate, periods);
    const pv = fcf * factor;
    ev += pv;
    pvs.push({
      year: years[i],
      periods,
      revenue: series.revenue[i],
      nopat: series.nopat[i],
      da: series.da[i],
      capex: series.capex[i],
      esop: esopAnnual,
      dnwc: series.dnwc[i],
      fcf,
      factor,
      pv,
      ar_balance: forecastBs[i].accounts_receivable,
      inventory_balance: forecastBs[i].inventory,
      ap_balance: forecastBs[i].accounts_payable,
      imbalance: forecastBs[i].imbalance,
    });
  }
  const terminalBase = usePs ? series.revenue[n - 1] : lastNopat;
  const exitEv = multiple * terminalBase + nd;
  const tvPeriods = pvs[n - 1].periods;
  const tvPv = exitEv * pvFactor(rate, tvPeriods);
  ev += tvPv;
  let equity = ev - nd;
  const liq = applyLiquidity ? liquidity : null;
  if (applyLiquidity) equity *= (1 - liq);
  return {
    blocked: false,
    blockers: [],
    scenario_name: scenarioName || null,
    discount_rate: rate,
    apply_liquidity: applyLiquidity,
    liquidity_discount: liq,
    fcf: pvs.map((p) => p.fcf),
    pvs,
    terminal_year: years[n - 1],
    terminal_base_kind: usePs ? 'revenue' : 'after_tax_operating_profit',
    terminal_base: terminalBase,
    exit_multiple: multiple,
    terminal_value: exitEv,
    terminal_pv: tvPv,
    enterprise_value: ev,
    net_debt: nd,
    equity_value: equity,
    equity_value_yi: yuanToYi(equity),
    forecast_bs: forecastBs,
    series,
  };
}

function forecastYearKey(y) {
  const m = String(y == null ? '' : y).match(/(20\d{2})/);
  return m ? m[1] : String(y || '');
}

/** 只认用户改过的格子。计算写回的金额没有 manual，下次仍按比例重算。0 算手改。 */
function manualPlAmount(forecastPl, year, key) {
  const cell = forecastPl && typeof forecastPl === 'object' ? forecastPl[forecastYearKey(year)] : null;
  if (!cell || !Array.isArray(cell.manual) || !cell.manual.includes(key)) return null;
  return toNumber(cell[key]);
}

/**
 * 计算成功后，把预测利润表金额写回未手改的格子。手改格子保留。
 * 被拦截时不写，避免把没算完的序列盖掉用户刚保存的数。
 */
function applyForecastPl(forecastPl, dcf) {
  const source = forecastPl && typeof forecastPl === 'object' && !Array.isArray(forecastPl) ? forecastPl : {};
  if (!dcf || dcf.blocked || !dcf.series?.years?.length) return source;
  const next = {};
  Object.entries(source).forEach(([year, row]) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const copy = { ...row };
    if (!Array.isArray(copy.manual) || !copy.manual.length) delete copy.manual;
    else copy.manual = [...copy.manual];
    next[forecastYearKey(year) || year] = copy;
  });
  dcf.series.years.forEach((year, i) => {
    const y = forecastYearKey(year);
    if (!y) return;
    const row = { ...(next[y] || {}) };
    const manual = new Set(Array.isArray(row.manual) ? row.manual : []);
    FORECAST_PL_AMOUNT_KEYS.forEach((key) => {
      if (manual.has(key)) return;
      const n = toNumber(dcf.series[key]?.[i]);
      if (n == null) return;
      row[key] = n;
    });
    if (manual.size) row.manual = [...manual];
    else delete row.manual;
    next[y] = row;
  });
  return next;
}

/**
 * 模板没有现金流量表时，用预测表里的折旧摊销占收入，乘对应全年收入，得到现金流量表金额。
 * 实际列用锚定日当期营业收入 × 该比例。预测年用年化后再按增速滚动的全年收入。
 */
function impliedForecastDa(pl, assumptions) {
  const anchor = parseAnchor(assumptions?.valuation_date);
  if (!anchor.ok) return null;
  const source = pl || {};
  const forecast = sliceForecastPl(source, anchor);
  const years = (forecast.years || [])
    .map((y) => String(y).replace(/[^\d]/g, '').slice(0, 4))
    .filter((y) => /^\d{4}$/.test(y));
  if (!years.length) return null;
  const ytd = toNumber(assumptions?.ytd_revenue);
  const revenueBase = ytd != null && ytd > 0 ? ytd : yearAmount(source, 'revenue', anchor.year);
  if (!(revenueBase > 0)) return null;
  const ratios = carryForward(forecast.da_ratio, years.length);
  if (!ratios.filled) return null;
  const growth = carryForward(forecast.revenue_growth, years.length);
  const revenues = growth.filled
    ? growAnnualized(revenueBase, growth.values, anchor)
    : years.map(() => null);
  const da = revenues.map((rev, i) => (rev == null ? null : rev * num0(ratios.values[i])));
  const actualDa = revenueBase * num0(ratios.values[0]);
  return { years, da, actualDa };
}

/** 计算成功后，把预测年的折旧摊销、资本开支、ΔNWC 写回现金流量表。实际列和其他年份不动。 */
function applyForecastCashflow(targetCf, dcf) {
  const cf = { ...(targetCf || {}) };
  const series = dcf?.series;
  if (!dcf || dcf.blocked || !series?.years?.length) return cf;
  const years = Array.isArray(cf.years) ? cf.years.map((y) => String(y)) : [];
  const da = Array.isArray(cf.da) ? [...cf.da] : [];
  const capex = Array.isArray(cf.capex) ? [...cf.capex] : [];
  const dnwc = Array.isArray(cf.dnwc) ? [...cf.dnwc] : [];
  series.years.forEach((y, i) => {
    const key = forecastYearKey(y);
    if (!key) return;
    let dest = years.findIndex((oy) => forecastYearKey(oy) === key);
    if (dest < 0) {
      years.push(key);
      dest = years.length - 1;
    }
    da[dest] = series.da?.[i] ?? null;
    capex[dest] = series.capex?.[i] ?? null;
    dnwc[dest] = series.dnwc?.[i] ?? null;
  });
  return { ...cf, years, da, capex, dnwc };
}

module.exports = {
  RATIOS,
  parseAnchor,
  isStatementAnchor,
  discountYears,
  flowScale,
  expectedFirstYear,
  buildDcfForecast,
  applyForecastCashflow,
  applyForecastPl,
  impliedForecastDa,
};
