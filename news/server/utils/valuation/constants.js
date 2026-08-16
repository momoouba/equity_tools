/**
 * 项目估值应用常量（applications.id 为业务写入主键）
 */
module.exports = {
  APP_NAME_PROJECT_VALUATION: '项目估值',
  PROJECT_VALUATION_APP_ID: '2026073000000000001',
  PROJECT_VALUATION_CREATED_AT: '2026-07-30 00:00:00',
  /** ai_model_config.application_type / usage_type 同码 */
  AI_APPLICATION_TYPE_VALUATION: 'project_valuation',
  AI_USAGE_TYPE_VALUATION: 'project_valuation',

  CASE_TYPE_PRE: 'pre_investment',
  CASE_TYPE_POST: 'post_investment',

  ALLOWED_LISTING_MARKETS: ['sse', 'szse', 'bse', 'neeq'],
  MARKET_LABELS: {
    sse: '上交所',
    szse: '深交所',
    bse: '北交所',
    neeq: '新三板',
  },

  COMPARABILITY: {
    STRONG: 'strong',
    MEDIUM: 'medium',
    WEAK: 'weak',
  },
  COMPARABILITY_LABELS: {
    strong: '强',
    medium: '中',
    weak: '弱',
  },

  TERMINAL_PE: 'exit_pe',
  TERMINAL_PS: 'exit_ps',
  FCF_NI_BRIDGE: 'ni_bridge',
  FCF_NOPAT: 'nopat_fcff',
  SENS_EXIT_CAGR: 'exit_x_cagr',
  SENS_EXIT_WACC: 'exit_x_wacc',
  SENS_WACC_EXIT: 'wacc_x_exit',
  SCENARIO_SINGLE: 'single',
  SCENARIO_DUAL: 'ma_and_ipo',
  MULTIPLE_POOL: 'stock_pool',
  MULTIPLE_INDUSTRY: 'sw_industry_median',
  /** 界面录入万元；内部存储与引擎一律用元 */
  YUAN_PER_WAN: 10000,
  /** POOL 倍数统计：排除负值与极端截面（失败行情/亏损股） */
  PE_SANE_MIN: 0,
  PE_SANE_MAX: 500,
  PS_SANE_MIN: 0,
  PS_SANE_MAX: 80,
  INDUSTRY_ARITH: 'arithmetic',
  INDUSTRY_OVERALL: 'overall',

  JOB_STATUS: {
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
  },
};
