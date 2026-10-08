/**
 * 标的资产负债表科目。金额单位：库内元。
 * 净负债 = 短期借款 + 一年内到期的非流动负债 + 长期借款 + 租赁负债 − 货币资金。
 * hidden 行只为读入旧草稿：票据并入应收/应付，预收并入合同负债，权益合计并入未分配利润。
 */
function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const BS_INPUT_FIELDS = [
  { key: 'cash', label: '货币资金', group: 'current_assets', comment: '货币资金，元', note: '库存现金、银行存款及其他货币资金，含交易性金融资产、衍生金融资产' },
  { key: 'accounts_receivable', label: '应收账款（含应收票据）', group: 'current_assets', comment: '应收账款含应收票据，元', note: '应收账款、应收票据与应收款项融资合计，不另列这些科目' },
  { key: 'prepayment', label: '预付款项', group: 'current_assets', comment: '预付款项，元', note: '预先支付给供应商的货款或劳务款，不进营运资本' },
  { key: 'other_receivables', label: '其他应收款', group: 'current_assets', comment: '其他应收款，元', note: '不进营运资本' },
  { key: 'inventory', label: '存货', group: 'current_assets', comment: '存货，元', note: '原材料、在产品、库存商品及周转材料等' },
  { key: 'contract_assets', label: '合同资产', group: 'current_assets', comment: '合同资产，元', note: '不进营运资本' },
  { key: 'other_current_assets', label: '其他流动资产', group: 'current_assets', comment: '其他流动资产，元', note: '一年内变现或耗用、未单独列示的其他流动资产' },
  { key: 'debt_investment', label: '债权投资', group: 'noncurrent_assets', comment: '债权投资，元', note: '以摊余成本计量的债权投资。预测年沿用实际列，不进净负债' },
  { key: 'other_debt_investment', label: '其他债权投资', group: 'noncurrent_assets', comment: '其他债权投资，元', note: '以公允价值计量且变动计入其他综合收益的债权投资。预测年沿用实际列' },
  { key: 'long_term_receivable', label: '长期应收款', group: 'noncurrent_assets', comment: '长期应收款，元', note: '期限超过一年的应收款项。预测年沿用实际列，不进营运资本' },
  { key: 'long_term_equity_investment', label: '长期股权投资', group: 'noncurrent_assets', comment: '长期股权投资，元', note: '对子公司、合营和联营企业的股权投资。预测年沿用实际列' },
  { key: 'other_equity_investment', label: '其他权益工具投资', group: 'noncurrent_assets', comment: '其他权益工具投资，元', note: '指定为以公允价值计量且变动计入其他综合收益的权益工具。预测年沿用实际列' },
  { key: 'other_noncurrent_financial', label: '其他非流动金融资产', group: 'noncurrent_assets', comment: '其他非流动金融资产，元', note: '不以交易为目的的非流动金融资产。预测年沿用实际列' },
  { key: 'investment_property', label: '投资性房地产', group: 'noncurrent_assets', comment: '投资性房地产，元', note: '预测年沿用实际列' },
  { key: 'fixed_assets', label: '固定资产', group: 'noncurrent_assets', comment: '固定资产，元', note: '预测年沿用实际列，资本开支不回写本行' },
  { key: 'cip', label: '在建工程', group: 'noncurrent_assets', comment: '在建工程，元', note: '尚未完工交付的工程支出' },
  { key: 'rou_asset', label: '使用权资产', group: 'noncurrent_assets', comment: '使用权资产，元', note: '预测年沿用实际列' },
  { key: 'intangible', label: '无形资产', group: 'noncurrent_assets', comment: '无形资产，元', note: '专利权、土地使用权、软件等无实物形态资产净值' },
  { key: 'goodwill', label: '商誉', group: 'noncurrent_assets', comment: '商誉，元', note: '预测年沿用实际列' },
  { key: 'long_prepaid', label: '长期待摊费用', group: 'noncurrent_assets', comment: '长期待摊费用，元', note: '已经发生、摊销期超过一年的费用' },
  { key: 'deferred_tax_assets', label: '递延所得税资产', group: 'noncurrent_assets', comment: '递延所得税资产，元', note: '可抵扣暂时性差异确认的所得税资产' },
  { key: 'other_noncurrent_assets', label: '其他非流动资产', group: 'noncurrent_assets', comment: '其他非流动资产，元', note: '预测年沿用实际列' },
  { key: 'short_term_loan', label: '短期借款', group: 'current_liab', comment: '短期借款，元', note: '计入净负债' },
  { key: 'accounts_payable', label: '应付账款（含应付票据）', group: 'current_liab', comment: '应付账款含应付票据，元', note: '应付账款与应付票据合计，不另列票据。预收不并入本行，从应收账款里扣除' },
  { key: 'contract_liability', label: '合同负债', group: 'current_liab', comment: '合同负债，元', note: '预收款。锚定日净应收 = 应收账款（含票据）− 合同负债 − 预收款项。预测年净应收按周转天数重算，不再减一次' },
  { key: 'staff_payable', label: '应付职工薪酬', group: 'current_liab', comment: '应付职工薪酬，元', note: '应付职工的工资、奖金、社会保险及公积金等' },
  { key: 'tax_payable', label: '应交税费', group: 'current_liab', comment: '应交税费，元', note: '应交未交的增值税、企业所得税等税费' },
  { key: 'other_payables', label: '其他应付款', group: 'current_liab', comment: '其他应付款，元', note: '不进营运资本' },
  { key: 'current_portion_noncurrent', label: '一年内到期的非流动负债', group: 'current_liab', comment: '一年内到期的非流动负债，元', note: '计入净负债。租赁负债的一年内到期部分在本行，不与租赁负债重复' },
  { key: 'other_current_liab', label: '其他流动负债', group: 'current_liab', comment: '其他流动负债，元', note: '预测年沿用实际列' },
  { key: 'long_term_loan', label: '长期借款', group: 'noncurrent_liab', comment: '长期借款，元', note: '计入净负债。一年内到期部分不在本行' },
  { key: 'lease_liability', label: '租赁负债', group: 'noncurrent_liab', comment: '租赁负债，元', note: '非流动部分，计入净负债' },
  { key: 'estimated_liab', label: '预计负债', group: 'noncurrent_liab', comment: '预计负债，元', note: '不计入净负债' },
  { key: 'deferred_income', label: '递延收益', group: 'noncurrent_liab', comment: '递延收益，元', note: '不计入净负债' },
  { key: 'deferred_tax_liab', label: '递延所得税负债', group: 'noncurrent_liab', comment: '递延所得税负债，元', note: '应纳税暂时性差异确认的所得税负债，不计入净负债' },
  { key: 'paid_in_capital', label: '实收资本', group: 'equity', comment: '实收资本，元', note: '预测年沿用实际列' },
  { key: 'capital_reserve', label: '资本公积', group: 'equity', comment: '资本公积，元', note: '预测年沿用实际列' },
  { key: 'surplus_reserve', label: '盈余公积', group: 'equity', comment: '盈余公积，元', note: '预测年沿用实际列' },
  { key: 'retained_earnings', label: '未分配利润', group: 'equity', comment: '未分配利润，元', note: '预测年沿用实际列。旧数据只有权益合计时，读入后放在本行' },
  { key: 'notes_receivable', label: '应收票据', group: 'current_assets', comment: '应收票据，元', note: '旧列，读入时并入应收账款', hidden: true },
  { key: 'notes_payable', label: '应付票据', group: 'current_liab', comment: '应付票据，元', note: '旧列，读入时并入应付账款', hidden: true },
  { key: 'advance_receipt', label: '预收款项', group: 'current_liab', comment: '预收款项，元', note: '旧列，合同负债为空时并入合同负债', hidden: true },
  { key: 'equity', label: '所有者权益', group: 'equity', comment: '所有者权益合计，元', note: '旧列，明细为空时并入未分配利润', hidden: true },
];

const BS_INPUT_KEYS = BS_INPUT_FIELDS.map((f) => f.key);
const BS_VISIBLE_FIELDS = BS_INPUT_FIELDS.filter((f) => !f.hidden);

const BS_GROUPS = [
  { key: 'current_assets', label: '流动资产' },
  { key: 'noncurrent_assets', label: '非流动资产' },
  { key: 'current_liab', label: '流动负债' },
  { key: 'noncurrent_liab', label: '非流动负债' },
  { key: 'equity', label: '所有者权益' },
];

const EQUITY_PART_KEYS = ['paid_in_capital', 'capital_reserve', 'surplus_reserve', 'retained_earnings'];
const keysOf = (group) => BS_VISIBLE_FIELDS.filter((f) => f.group === group).map((f) => f.key);
const CURRENT_ASSET_KEYS = keysOf('current_assets');
const NONCURRENT_ASSET_KEYS = keysOf('noncurrent_assets');
const CURRENT_LIAB_KEYS = keysOf('current_liab');
const NONCURRENT_LIAB_KEYS = keysOf('noncurrent_liab');

function num(v) {
  const n = toNumber(v);
  return n == null ? 0 : n;
}

function sumKeys(bs, keys) {
  let any = false;
  let s = 0;
  for (const k of keys) {
    const n = toNumber(bs?.[k]);
    if (n != null) {
      any = true;
      s += n;
    }
  }
  return any ? s : null;
}

function pickBsSnapshot(bs) {
  const out = {};
  for (const k of BS_INPUT_KEYS) out[k] = toNumber(bs?.[k]);
  return out;
}

/** 旧草稿：票据并入应收/应付，预收在合同负债为空时并入，权益合计在明细为空时放入未分配利润。可重复调用。 */
function normalizeBs(bs) {
  const out = { ...(bs || {}) };
  const fold = (into, extra) => {
    const add = toNumber(out[extra]);
    if (add == null || add === 0) return;
    const base = toNumber(out[into]);
    out[into] = (base || 0) + add;
    out[extra] = 0;
  };
  fold('accounts_receivable', 'notes_receivable');
  fold('accounts_payable', 'notes_payable');
  if (toNumber(out.contract_liability) == null && toNumber(out.advance_receipt) != null) {
    out.contract_liability = toNumber(out.advance_receipt);
    out.advance_receipt = 0;
  }
  const anyPart = EQUITY_PART_KEYS.some((k) => toNumber(out[k]) != null);
  if (!anyPart && toNumber(out.equity) != null) {
    out.retained_earnings = toNumber(out.equity);
    out.equity = null;
  }
  return out;
}

function netDebtAmount(bs) {
  const n = normalizeBs(bs);
  const parts = [
    toNumber(n.short_term_loan),
    toNumber(n.current_portion_noncurrent),
    toNumber(n.long_term_loan),
    toNumber(n.lease_liability),
    toNumber(n.cash),
  ];
  if (parts.every((x) => x == null)) return null;
  return num(n.short_term_loan) + num(n.current_portion_noncurrent) + num(n.long_term_loan) + num(n.lease_liability) - num(n.cash);
}

function currentAssetsFromBs(bs) {
  return sumKeys(normalizeBs(bs), CURRENT_ASSET_KEYS);
}

function noncurrentAssetsFromBs(bs) {
  return sumKeys(normalizeBs(bs), NONCURRENT_ASSET_KEYS);
}

function totalAssetsFromBs(bs) {
  const a = currentAssetsFromBs(bs);
  const b = noncurrentAssetsFromBs(bs);
  if (a == null && b == null) return null;
  return num(a) + num(b);
}

function currentLiabFromBs(bs) {
  return sumKeys(normalizeBs(bs), CURRENT_LIAB_KEYS);
}

function noncurrentLiabFromBs(bs) {
  return sumKeys(normalizeBs(bs), NONCURRENT_LIAB_KEYS);
}

function totalLiabFromBs(bs) {
  const a = currentLiabFromBs(bs);
  const b = noncurrentLiabFromBs(bs);
  if (a == null && b == null) return null;
  return num(a) + num(b);
}

/** 预收款抵减应收。合同负债为空时，预收款项已并入合同负债，不会减两次。 */
function customerAdvances(bs) {
  const n = normalizeBs(bs);
  return num(n.contract_liability) + num(n.advance_receipt);
}

function nwcStockFromBs(bs) {
  const n = normalizeBs(bs);
  const ar = toNumber(n.accounts_receivable);
  const inv = toNumber(n.inventory);
  const ap = toNumber(n.accounts_payable);
  const advance = bs?.ar_is_net ? 0 : customerAdvances(n);
  if (ar == null && inv == null && ap == null && advance === 0) return null;
  return num(ar) - advance + num(inv) - num(ap);
}

function equityBookFromBs(bs) {
  const n = normalizeBs(bs);
  const parts = sumKeys(n, EQUITY_PART_KEYS);
  if (parts != null) return parts;
  return toNumber(n.equity);
}

function debtRatioFromBs(bs) {
  const assets = totalAssetsFromBs(bs);
  const liab = totalLiabFromBs(bs);
  if (assets == null || assets === 0 || liab == null) return null;
  return liab / assets;
}

function currentRatioFromBs(bs) {
  const assets = currentAssetsFromBs(bs);
  const liab = currentLiabFromBs(bs);
  if (assets == null || liab == null || liab === 0) return null;
  return assets / liab;
}

function equityImpliedFromBs(bs) {
  const assets = totalAssetsFromBs(bs);
  const liab = totalLiabFromBs(bs);
  if (assets == null && liab == null) return null;
  return num(assets) - num(liab);
}

module.exports = {
  BS_INPUT_FIELDS,
  BS_INPUT_KEYS,
  BS_VISIBLE_FIELDS,
  BS_GROUPS,
  EQUITY_PART_KEYS,
  CURRENT_ASSET_KEYS,
  NONCURRENT_ASSET_KEYS,
  CURRENT_LIAB_KEYS,
  NONCURRENT_LIAB_KEYS,
  pickBsSnapshot,
  normalizeBs,
  netDebtAmount,
  currentAssetsFromBs,
  noncurrentAssetsFromBs,
  totalAssetsFromBs,
  currentLiabFromBs,
  noncurrentLiabFromBs,
  totalLiabFromBs,
  nwcStockFromBs,
  equityBookFromBs,
  debtRatioFromBs,
  currentRatioFromBs,
  equityImpliedFromBs,
};
