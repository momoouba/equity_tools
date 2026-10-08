const C = require('./constants');

function defaultMethodConfig() {
  return {
    terminal_type: C.TERMINAL_PE,
    fcf_method: C.FCF_NI_BRIDGE,
    sensitivity_axes: C.SENS_EXIT_CAGR,
    scenario_mode: C.SCENARIO_SINGLE,
    multiple_source: C.MULTIPLE_POOL,
    industry_stat_method: C.INDUSTRY_ARITH,
    confirmed: false,
  };
}

/** 不把空的 DCF 流动性折扣填成 30% 或市场法折扣。已保存的数保持原值。 */
function seedDcfLiquidityDiscount(assumptions) {
  return { ...(assumptions || {}) };
}

function defaultAssumptions() {
  return {
    discount_rate: 0.3,
    exit_pe: 40,
    exit_ps: 20,
    liquidity_discount: 0.3,
    dcf_liquidity_discount: 0.3,
    tax_rate: 0.15,
    forecast_years: 5,
    esop: 0,
    valuation_date: null,
    ytd_revenue: null,
    market_revenue: null,
    market_net_income: null,
    forecast_dso: null,
    forecast_dpo: null,
    forecast_dio: null,
    round_deal_value_yi: null,
    display_unit: 'yi',
    wacc_breakdown: {
      risk_free_rate: null,
      erp: null,
      beta: null,
      debt_equity: null,
      debt_cost: null,
      tax_rate: null,
    },
  };
}

function defaultScenarioSet() {
  return {
    ma: {
      name: '并购预期',
      discount_rate: null,
      exit_pe: 40,
      exit_ps: 20,
    },
    ipo: {
      name: '上市预期',
      discount_rate: null,
      exit_pe: 40,
      exit_ps: 20,
    },
  };
}

function comparabilityFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return C.COMPARABILITY.WEAK;
  if (n >= 80) return C.COMPARABILITY.STRONG;
  if (n >= 60) return C.COMPARABILITY.MEDIUM;
  return C.COMPARABILITY.WEAK;
}

function defaultInPool(degree) {
  return degree === C.COMPARABILITY.STRONG || degree === C.COMPARABILITY.MEDIUM;
}

module.exports = {
  defaultMethodConfig,
  defaultAssumptions,
  seedDcfLiquidityDiscount,
  defaultScenarioSet,
  comparabilityFromScore,
  defaultInPool,
};
