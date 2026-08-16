/** 上市财报科目列（金额单位：元）。替代 listed_company_financials.metrics_json。 */

const LISTED_METRIC_COLS = [
  'revenue',
  'cogs',
  'gross_profit',
  'tax_surcharge',
  'selling',
  'admin',
  'rd',
  'operating_profit',
  'net_income',
  'cash',
  'notes_receivable',
  'accounts_receivable',
  'prepayment',
  'inventory',
  'other_current_assets',
  'current_assets',
  'fixed_assets',
  'cip',
  'intangible',
  'long_prepaid',
  'deferred_tax_assets',
  'total_assets',
  'short_term_loan',
  'notes_payable',
  'accounts_payable',
  'advance_receipt',
  'staff_payable',
  'tax_payable',
  'long_term_loan',
  'deferred_income',
  'total_liab_equity',
  'equity',
  'cfo',
  'cfi',
  'cff',
  'da',
  'capex',
  'cash_begin',
  'cash_end',
];

const LISTED_METRIC_COMMENTS = {
  revenue: '营业收入',
  cogs: '营业成本',
  gross_profit: '毛利',
  tax_surcharge: '税金及附加',
  selling: '销售费用',
  admin: '管理费用',
  rd: '研发费用',
  operating_profit: '营业利润',
  net_income: '净利润',
  cash: '货币资金',
  notes_receivable: '应收票据',
  accounts_receivable: '应收账款',
  prepayment: '预付款项',
  inventory: '存货',
  other_current_assets: '其他流动资产',
  current_assets: '流动资产合计',
  fixed_assets: '固定资产',
  cip: '在建工程',
  intangible: '无形资产',
  long_prepaid: '长期待摊费用',
  deferred_tax_assets: '递延所得税资产',
  total_assets: '资产总计',
  short_term_loan: '短期借款',
  notes_payable: '应付票据',
  accounts_payable: '应付账款',
  advance_receipt: '预收款项',
  staff_payable: '应付职工薪酬',
  tax_payable: '应交税费',
  long_term_loan: '长期借款',
  deferred_income: '递延收益',
  total_liab_equity: '负债和所有者权益总计',
  equity: '净资产合计',
  cfo: '经营现金流净额',
  cfi: '投资现金流净额',
  cff: '筹资现金流净额',
  da: '折旧摊销',
  capex: '购建长期资产现金',
  cash_begin: '期初现金',
  cash_end: '期末现金',
};

function metricColumnDdl(name) {
  const c = LISTED_METRIC_COMMENTS[name] || name;
  return `DECIMAL(24,4) NULL COMMENT '${c}，元'`;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function metricsFromRow(row) {
  const m = {};
  if (!row) return m;
  for (const k of LISTED_METRIC_COLS) {
    const n = toNum(row[k]);
    if (n != null) m[k] = n;
  }
  return m;
}

function metricInsertValues(metrics) {
  return LISTED_METRIC_COLS.map((k) => toNum(metrics?.[k]));
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

module.exports = {
  LISTED_METRIC_COLS,
  LISTED_METRIC_COMMENTS,
  metricColumnDdl,
  metricsFromRow,
  metricInsertValues,
  parseJson,
  toNum,
};
