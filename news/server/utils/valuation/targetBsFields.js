/**
 * 标的资产负债表科目（与上市财报同名字段对齐）。
 * 金额单位：库内元。净负债仍 = 短贷 + 长贷 − 货币资金。
 */
function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const BS_INPUT_FIELDS = [
  { key: 'cash', label: '货币资金', group: 'current_assets', comment: '货币资金，元', note: '库存现金、银行存款及其他货币资金' },
  { key: 'notes_receivable', label: '应收票据', group: 'current_assets', comment: '应收票据，元', note: '因销售商品或提供劳务收到的商业汇票' },
  { key: 'accounts_receivable', label: '应收账款', group: 'current_assets', comment: '应收账款，元', note: '因销售商品或提供劳务应向客户收取的款项' },
  { key: 'prepayment', label: '预付款项', group: 'current_assets', comment: '预付款项，元', note: '预先支付给供应商的货款或劳务款' },
  { key: 'inventory', label: '存货', group: 'current_assets', comment: '存货，元', note: '原材料、在产品、库存商品及周转材料等' },
  { key: 'other_current_assets', label: '其他流动资产', group: 'current_assets', comment: '其他流动资产，元', note: '一年内变现或耗用、未单独列示的其他流动资产' },
  { key: 'fixed_assets', label: '固定资产', group: 'noncurrent_assets', comment: '固定资产，元', note: '房屋建筑物、机器设备等使用寿命超过一年的有形资产净值' },
  { key: 'cip', label: '在建工程', group: 'noncurrent_assets', comment: '在建工程，元', note: '尚未完工交付的工程支出' },
  { key: 'intangible', label: '无形资产', group: 'noncurrent_assets', comment: '无形资产，元', note: '专利权、土地使用权、软件等无实物形态资产净值' },
  { key: 'long_prepaid', label: '长期待摊费用', group: 'noncurrent_assets', comment: '长期待摊费用，元', note: '已经发生、摊销期超过一年的费用' },
  { key: 'deferred_tax_assets', label: '递延所得税资产', group: 'noncurrent_assets', comment: '递延所得税资产，元', note: '可抵扣暂时性差异确认的所得税资产' },
  { key: 'short_term_loan', label: '短期借款', group: 'current_liab', comment: '短期借款，元', note: '向银行等借入、偿还期不超过一年的借款' },
  { key: 'notes_payable', label: '应付票据', group: 'current_liab', comment: '应付票据，元', note: '开出、承兑的商业汇票' },
  { key: 'accounts_payable', label: '应付账款', group: 'current_liab', comment: '应付账款，元', note: '因购买商品或接受劳务应付给供应商的款项' },
  { key: 'advance_receipt', label: '预收款项', group: 'current_liab', comment: '预收款项，元', note: '预先向客户收取的货款或劳务款' },
  { key: 'staff_payable', label: '应付职工薪酬', group: 'current_liab', comment: '应付职工薪酬，元', note: '应付职工的工资、奖金、社会保险及公积金等' },
  { key: 'tax_payable', label: '应交税费', group: 'current_liab', comment: '应交税费，元', note: '应交未交的增值税、企业所得税等税费' },
  { key: 'long_term_loan', label: '长期借款', group: 'noncurrent_liab', comment: '长期借款，元', note: '偿还期超过一年的借款' },
  { key: 'deferred_income', label: '递延收益', group: 'noncurrent_liab', comment: '递延收益，元', note: '已收到但尚未确认为收入的政府补助等' },
  { key: 'equity', label: '所有者权益', group: 'equity', comment: '所有者权益合计，元', note: '实收资本、资本公积、盈余公积及未分配利润等合计' },
];

const BS_INPUT_KEYS = BS_INPUT_FIELDS.map((f) => f.key);

const BS_GROUPS = [
  { key: 'current_assets', label: '流动资产' },
  { key: 'noncurrent_assets', label: '非流动资产' },
  { key: 'current_liab', label: '流动负债' },
  { key: 'noncurrent_liab', label: '非流动负债' },
  { key: 'equity', label: '所有者权益' },
];

const NWC_ASSET_KEYS = ['notes_receivable', 'accounts_receivable', 'prepayment', 'inventory'];
const NWC_LIAB_KEYS = ['notes_payable', 'accounts_payable', 'advance_receipt'];
const CURRENT_ASSET_KEYS = BS_INPUT_FIELDS.filter((f) => f.group === 'current_assets').map((f) => f.key);
const NONCURRENT_ASSET_KEYS = BS_INPUT_FIELDS.filter((f) => f.group === 'noncurrent_assets').map((f) => f.key);
const CURRENT_LIAB_KEYS = BS_INPUT_FIELDS.filter((f) => f.group === 'current_liab').map((f) => f.key);
const NONCURRENT_LIAB_KEYS = BS_INPUT_FIELDS.filter((f) => f.group === 'noncurrent_liab').map((f) => f.key);

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

function currentAssetsFromBs(bs) {
  return sumKeys(bs, CURRENT_ASSET_KEYS);
}

function noncurrentAssetsFromBs(bs) {
  return sumKeys(bs, NONCURRENT_ASSET_KEYS);
}

function totalAssetsFromBs(bs) {
  const a = currentAssetsFromBs(bs);
  const b = noncurrentAssetsFromBs(bs);
  if (a == null && b == null) return null;
  return num(a) + num(b);
}

function currentLiabFromBs(bs) {
  return sumKeys(bs, CURRENT_LIAB_KEYS);
}

function noncurrentLiabFromBs(bs) {
  return sumKeys(bs, NONCURRENT_LIAB_KEYS);
}

function totalLiabFromBs(bs) {
  const a = currentLiabFromBs(bs);
  const b = noncurrentLiabFromBs(bs);
  if (a == null && b == null) return null;
  return num(a) + num(b);
}

function nwcStockFromBs(bs) {
  const assets = sumKeys(bs, NWC_ASSET_KEYS);
  const liab = sumKeys(bs, NWC_LIAB_KEYS);
  if (assets == null && liab == null) return null;
  return num(assets) - num(liab);
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
  BS_GROUPS,
  NWC_ASSET_KEYS,
  NWC_LIAB_KEYS,
  CURRENT_ASSET_KEYS,
  NONCURRENT_ASSET_KEYS,
  CURRENT_LIAB_KEYS,
  NONCURRENT_LIAB_KEYS,
  pickBsSnapshot,
  currentAssetsFromBs,
  noncurrentAssetsFromBs,
  totalAssetsFromBs,
  currentLiabFromBs,
  noncurrentLiabFromBs,
  totalLiabFromBs,
  nwcStockFromBs,
  debtRatioFromBs,
  currentRatioFromBs,
  equityImpliedFromBs,
};
