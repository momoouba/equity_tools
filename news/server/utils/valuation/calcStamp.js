/**
 * 上次计算成功时的输入指纹。本轮交易估值和后续股权稀释不在里面。
 * 客户端 valuationCalcStamp.js 须与本文件保持同一套字段。
 */

const ENUM_LABELS = {
  sensitivity_axes: {
    exit_x_cagr: '营收 CAGR × 退出倍数',
    exit_x_wacc: '折现率 × 退出倍数',
    wacc_x_exit: '折现率 × 退出倍数',
    exit_x_rd_cagr: '研发费用 CAGR × 退出倍数',
  },
  rd_growth_mode: { growth: '较上一年' },
  scenario_mode: { single: '单套情景', ma_and_ipo: '并购 + 上市并排' },
  terminal_type: { exit_pe: '退出 P/E', exit_ps: '退出 P/S' },
  fcf_method: { ni_bridge: '净利润桥', nopat_fcff: 'NOPAT / FCFF' },
  multiple_source: { stock_pool: '个股 POOL', sw_industry_median: '申万三级中位数' },
  industry_stat_method: { arithmetic: '算术平均', overall: '整体法' },
};

function normNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e8) / 1e8;
}

function positiveOr(value, fallback) {
  const n = normNum(value);
  return n != null && n > 0 ? n : fallback;
}

function stableStringify(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function withoutDays(pl) {
  if (!pl || typeof pl !== 'object') return pl || null;
  const next = { ...pl };
  delete next.dso;
  delete next.dpo;
  delete next.dio;
  return next;
}

const FORECAST_PL_KEYS = ['revenue', 'cogs', 'surtax', 'selling', 'admin', 'rd', 'finance_expense', 'other_income', 'other', 'da', 'capex'];

/** 与库表 DECIMAL(24,4)、JSON 回读后的金额对齐，避免计算写回后指纹对不上。 */
function roundMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function forecastYearKey(year) {
  const m = String(year == null ? '' : year).match(/(20\d{2})/);
  return m ? m[1] : String(year);
}

function canonicalForecastPl(forecastPl) {
  if (!forecastPl || typeof forecastPl !== 'object' || Array.isArray(forecastPl)) return null;
  const cleaned = {};
  Object.keys(forecastPl).forEach((year) => {
    const row = forecastPl[year];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const next = {};
    FORECAST_PL_KEYS.forEach((key) => {
      const n = roundMoney(row[key]);
      if (n != null) next[key] = n;
    });
    const manual = Array.isArray(row.manual)
      ? row.manual.filter((key) => FORECAST_PL_KEYS.includes(key) && next[key] != null).sort()
      : [];
    if (manual.length) next.manual = manual;
    if (Object.keys(next).length) cleaned[forecastYearKey(year)] = next;
  });
  return Object.keys(cleaned).length ? cleaned : null;
}

function canonicalCashflow(targetCf, overrides) {
  const cf = targetCf && typeof targetCf === 'object' ? targetCf : {};
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const srcYears = Array.isArray(cf.years) ? cf.years : [];
  const n = Math.max(
    srcYears.length,
    Array.isArray(cf.da) ? cf.da.length : 0,
    Array.isArray(cf.capex) ? cf.capex.length : 0,
    Array.isArray(cf.dnwc) ? cf.dnwc.length : 0,
  );
  const col = (arr) => Array.from({ length: n }, (_, i) => roundMoney(arr?.[i]));
  return {
    years: Array.from({ length: n }, (_, i) => (srcYears[i] == null ? null : String(srcYears[i]).slice(0, 16))),
    da: col(cf.da),
    capex: col(cf.capex),
    dnwc: col(cf.dnwc),
    da_default: roundMoney(ov.da != null ? ov.da : cf.da_default),
    capex_default: roundMoney(ov.capex != null ? ov.capex : cf.capex_default),
    dnwc_default: roundMoney(ov.dnwc != null ? ov.dnwc : cf.dnwc_default),
    net_debt: roundMoney(ov.net_debt),
  };
}

function selectedComps(comps) {
  return (comps || [])
    .filter((c) => c && c.stock_code && (c.selected == null || Number(c.selected) === 1))
    .map((c) => ({
      code: String(c.stock_code),
      in_pool: Number(c.in_pool) === 1 ? 1 : 0,
      pe: normNum(c.pe_median_override),
      ps: normNum(c.ps_median_override),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function buildCalcStamp(payload, comps) {
  const p = payload || {};
  const a = p.assumptions || {};
  const w = a.wacc_breakdown || {};
  const m = p.methodConfig || {};
  const ma = p.scenarios?.ma || {};
  const ipo = p.scenarios?.ipo || {};
  const pl = p.targetPl || {};
  return {
    valuation_date: a.valuation_date || null,
    discount_rate: normNum(a.discount_rate),
    exit_pe: normNum(a.exit_pe),
    exit_ps: normNum(a.exit_ps),
    tax_rate: normNum(a.tax_rate),
    esop: normNum(a.esop),
    liquidity_discount: normNum(a.liquidity_discount),
    dcf_liquidity_discount: normNum(a.dcf_liquidity_discount),
    market_revenue: normNum(a.market_revenue),
    market_net_income: normNum(a.market_net_income),
    ytd_revenue: normNum(a.ytd_revenue),
    forecast_years: normNum(a.forecast_years),
    wacc_risk_free_rate: normNum(w.risk_free_rate),
    wacc_erp: normNum(w.erp),
    wacc_beta: normNum(w.beta),
    wacc_debt_equity: normNum(w.debt_equity),
    wacc_debt_cost: normNum(w.debt_cost),
    wacc_tax_rate: normNum(w.tax_rate),
    sensitivity_axes: m.sensitivity_axes || null,
    pe_multiple_step: positiveOr(m.pe_multiple_step, 10),
    ps_multiple_step: positiveOr(m.ps_multiple_step, 2),
    cagr_step: positiveOr(m.cagr_step, 0.05),
    rate_step: positiveOr(m.rate_step, 0.02),
    rd_growth_mode: a.rd_growth_mode === 'share' ? 'share' : 'growth',
    scenario_mode: m.scenario_mode || null,
    terminal_type: m.terminal_type || null,
    fcf_method: m.fcf_method || null,
    multiple_source: m.multiple_source || null,
    industry_stat_method: m.industry_stat_method || null,
    sw_industry_l3: p.sw_industry_l3 || '',
    ma_discount_rate: normNum(ma.discount_rate),
    ma_exit_pe: normNum(ma.exit_pe),
    ma_exit_ps: normNum(ma.exit_ps),
    ipo_discount_rate: normNum(ipo.discount_rate),
    ipo_exit_pe: normNum(ipo.exit_pe),
    ipo_exit_ps: normNum(ipo.exit_ps),
    forecast_pl: stableStringify(canonicalForecastPl(p.forecastPl)),
    forecast_bs: stableStringify(p.forecastBs || null),
    target_pl: stableStringify(withoutDays(pl)),
    target_bs: stableStringify(p.targetBs || null),
    cashflow: stableStringify(canonicalCashflow(p.targetCf, p.overrides)),
    days: stableStringify({
      forecast_dso: normNum(a.forecast_dso),
      forecast_dpo: normNum(a.forecast_dpo),
      forecast_dio: normNum(a.forecast_dio),
      dso: pl.dso || null,
      dpo: pl.dpo || null,
      dio: pl.dio || null,
    }),
    comps: selectedComps(comps),
  };
}

const NAMED = [
  ['valuation_date', '估值锚定日', 'text'],
  ['discount_rate', '折现率', 'pct'],
  ['exit_pe', '退出 P/E', 'multiple'],
  ['exit_ps', '退出 P/S', 'multiple'],
  ['tax_rate', '所得税率', 'pct'],
  ['esop', 'ESOP', 'yuan'],
  ['liquidity_discount', '市场法流动性折扣', 'pct'],
  ['dcf_liquidity_discount', '并购 DCF 流动性折扣', 'pct'],
  ['market_revenue', '市场法营业收入', 'yuan'],
  ['market_net_income', '市场法净利润', 'yuan'],
  ['ytd_revenue', '锚定日累计营业收入', 'yuan'],
  ['forecast_years', '预测年数', 'number'],
  ['wacc_risk_free_rate', '无风险利率', 'pct'],
  ['wacc_erp', 'ERP', 'pct'],
  ['wacc_beta', 'Beta', 'number'],
  ['wacc_debt_equity', 'D/E', 'number'],
  ['wacc_debt_cost', '债务成本', 'pct'],
  ['wacc_tax_rate', 'WACC 所得税率', 'pct'],
  ['sensitivity_axes', '敏感性轴', 'enum'],
  ['pe_multiple_step', 'P/E 倍数步长', 'number'],
  ['ps_multiple_step', 'P/S 倍数步长', 'number'],
  ['cagr_step', 'CAGR 步长', 'pct'],
  ['rate_step', '折现率步长', 'pct'],
  ['rd_growth_mode', '研发费用口径', 'enum'],
  ['scenario_mode', '情景', 'enum'],
  ['terminal_type', '终值方式', 'enum'],
  ['fcf_method', '现金流方式', 'enum'],
  ['multiple_source', '倍数来源', 'enum'],
  ['industry_stat_method', '行业统计方法', 'enum'],
  ['sw_industry_l3', '申万三级', 'text'],
  ['ma_discount_rate', '并购折现率', 'pct'],
  ['ma_exit_pe', '并购退出 P/E', 'multiple'],
  ['ma_exit_ps', '并购退出 P/S', 'multiple'],
  ['ipo_discount_rate', '上市折现率', 'pct'],
  ['ipo_exit_pe', '上市退出 P/E', 'multiple'],
  ['ipo_exit_ps', '上市退出 P/S', 'multiple'],
];

const SHEETS = [
  ['forecast_pl', '预测利润表'],
  ['forecast_bs', '预测资产负债表'],
  ['target_pl', '标的利润表'],
  ['target_bs', '资产负债表'],
  ['cashflow', '现金流量表'],
  ['days', '周转天数'],
];

function fmtValue(key, type, value) {
  if (value == null || value === '') return '空';
  if (type === 'pct') {
    const n = Math.round(Number(value) * 10000) / 100;
    return Number.isFinite(n) ? `${Number(n.toFixed(2))}%` : '空';
  }
  if (type === 'multiple') return `${value} 倍`;
  if (type === 'yuan') return `${value} 元`;
  if (type === 'enum') return (ENUM_LABELS[key] && ENUM_LABELS[key][value]) || String(value);
  return String(value);
}

function diffCalcStamp(saved, current) {
  if (!saved || !current) return [];
  const lines = [];
  for (const [key, label, type] of NAMED) {
    const savedVal = saved[key] == null ? null : saved[key];
    const currentVal = current[key] == null ? null : current[key];
    if (savedVal !== currentVal) {
      lines.push(`${label}已改为 ${fmtValue(key, type, current[key])}，需要重新计算`);
    }
  }
  for (const [key, label] of SHEETS) {
    if (saved[key] !== current[key]) lines.push(`${label}已修改，需要重新计算`);
  }
  if (stableStringify(saved.comps || []) !== stableStringify(current.comps || [])) {
    lines.push('相对估值已修改，需要重新计算');
  }
  return lines;
}

function needsRefetch(saved, current) {
  if (!saved || !current) return true;
  if ((saved.valuation_date || null) !== (current.valuation_date || null)) return true;
  const a = new Set((saved.comps || []).map((c) => c.code));
  const b = new Set((current.comps || []).map((c) => c.code));
  if (a.size !== b.size) return true;
  for (const code of a) {
    if (!b.has(code)) return true;
  }
  return false;
}

module.exports = {
  buildCalcStamp,
  diffCalcStamp,
  needsRefetch,
};
