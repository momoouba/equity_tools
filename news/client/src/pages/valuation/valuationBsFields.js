/** 标的资产负债表科目（与 server/utils/valuation/targetBsFields.js 对齐）。界面单位：元。 */

export const BS_INPUT_FIELDS = [
  { key: 'cash', label: '货币资金', group: 'current_assets', note: '库存现金、银行存款及其他货币资金，含交易性金融资产、衍生金融资产' },
  { key: 'accounts_receivable', label: '应收账款（含应收票据）', group: 'current_assets', note: '应收账款、应收票据与应收款项融资合计，不另列这些科目' },
  { key: 'prepayment', label: '预付款项', group: 'current_assets', note: '不进营运资本' },
  { key: 'other_receivables', label: '其他应收款', group: 'current_assets', note: '不进营运资本' },
  { key: 'inventory', label: '存货', group: 'current_assets', note: '原材料、在产品、库存商品及周转材料等' },
  { key: 'contract_assets', label: '合同资产', group: 'current_assets', note: '不进营运资本' },
  { key: 'other_current_assets', label: '其他流动资产', group: 'current_assets', note: '一年内变现或耗用、未单独列示的其他流动资产' },
  { key: 'debt_investment', label: '债权投资', group: 'noncurrent_assets', note: '以摊余成本计量的债权投资。预测年沿用实际列，不进净负债' },
  { key: 'other_debt_investment', label: '其他债权投资', group: 'noncurrent_assets', note: '以公允价值计量且变动计入其他综合收益的债权投资。预测年沿用实际列' },
  { key: 'long_term_receivable', label: '长期应收款', group: 'noncurrent_assets', note: '期限超过一年的应收款项。预测年沿用实际列，不进营运资本' },
  { key: 'long_term_equity_investment', label: '长期股权投资', group: 'noncurrent_assets', note: '对子公司、合营和联营企业的股权投资。预测年沿用实际列' },
  { key: 'other_equity_investment', label: '其他权益工具投资', group: 'noncurrent_assets', note: '指定为以公允价值计量且变动计入其他综合收益的权益工具。预测年沿用实际列' },
  { key: 'other_noncurrent_financial', label: '其他非流动金融资产', group: 'noncurrent_assets', note: '不以交易为目的的非流动金融资产。预测年沿用实际列' },
  { key: 'investment_property', label: '投资性房地产', group: 'noncurrent_assets', note: '预测年沿用实际列' },
  { key: 'fixed_assets', label: '固定资产', group: 'noncurrent_assets', note: '预测年沿用实际列，资本开支不回写本行' },
  { key: 'cip', label: '在建工程', group: 'noncurrent_assets', note: '尚未完工交付的工程支出' },
  { key: 'rou_asset', label: '使用权资产', group: 'noncurrent_assets', note: '预测年沿用实际列' },
  { key: 'intangible', label: '无形资产', group: 'noncurrent_assets', note: '专利权、土地使用权、软件等无实物形态资产净值' },
  { key: 'goodwill', label: '商誉', group: 'noncurrent_assets', note: '预测年沿用实际列' },
  { key: 'long_prepaid', label: '长期待摊费用', group: 'noncurrent_assets', note: '已经发生、摊销期超过一年的费用' },
  { key: 'deferred_tax_assets', label: '递延所得税资产', group: 'noncurrent_assets', note: '可抵扣暂时性差异确认的所得税资产' },
  { key: 'other_noncurrent_assets', label: '其他非流动资产', group: 'noncurrent_assets', note: '预测年沿用实际列' },
  { key: 'short_term_loan', label: '短期借款', group: 'current_liab', note: '计入净负债' },
  { key: 'accounts_payable', label: '应付账款（含应付票据）', group: 'current_liab', note: '应付账款与应付票据合计。预收不并入本行' },
  { key: 'contract_liability', label: '合同负债', group: 'current_liab', note: '预测年沿用实际列，不进营运资本' },
  { key: 'staff_payable', label: '应付职工薪酬', group: 'current_liab', note: '应付职工的工资、奖金、社会保险及公积金等' },
  { key: 'tax_payable', label: '应交税费', group: 'current_liab', note: '应交未交的增值税、企业所得税等税费' },
  { key: 'other_payables', label: '其他应付款', group: 'current_liab', note: '不进营运资本' },
  { key: 'current_portion_noncurrent', label: '一年内到期的非流动负债', group: 'current_liab', note: '计入净负债。租赁的一年内到期部分在本行' },
  { key: 'other_current_liab', label: '其他流动负债', group: 'current_liab', note: '预测年沿用实际列' },
  { key: 'long_term_loan', label: '长期借款', group: 'noncurrent_liab', note: '计入净负债' },
  { key: 'lease_liability', label: '租赁负债', group: 'noncurrent_liab', note: '非流动部分，计入净负债' },
  { key: 'estimated_liab', label: '预计负债', group: 'noncurrent_liab', note: '不计入净负债' },
  { key: 'deferred_income', label: '递延收益', group: 'noncurrent_liab', note: '不计入净负债' },
  { key: 'deferred_tax_liab', label: '递延所得税负债', group: 'noncurrent_liab', note: '应纳税暂时性差异确认的所得税负债，不计入净负债' },
  { key: 'paid_in_capital', label: '实收资本', group: 'equity', note: '预测年沿用实际列' },
  { key: 'capital_reserve', label: '资本公积', group: 'equity', note: '预测年沿用实际列' },
  { key: 'surplus_reserve', label: '盈余公积', group: 'equity', note: '预测年沿用实际列' },
  { key: 'retained_earnings', label: '未分配利润', group: 'equity', note: '旧数据只有权益合计时，读入后放在本行' },
]

export const BS_INPUT_KEYS = BS_INPUT_FIELDS.map((f) => f.key)

export const BS_GROUPS = [
  { key: 'current_assets', label: '流动资产' },
  { key: 'noncurrent_assets', label: '非流动资产' },
  { key: 'current_liab', label: '流动负债' },
  { key: 'noncurrent_liab', label: '非流动负债' },
  { key: 'equity', label: '所有者权益' },
]

const EQUITY_PART_KEYS = ['paid_in_capital', 'capital_reserve', 'surplus_reserve', 'retained_earnings']

function toNum(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function num0(v) {
  const n = toNum(v)
  return n == null ? 0 : n
}

function sumKeys(bs, keys) {
  let any = false
  let s = 0
  for (const k of keys) {
    const n = toNum(bs?.[k])
    if (n != null) {
      any = true
      s += n
    }
  }
  return any ? s : null
}

export function displayBs(bs) {
  const out = { ...(bs || {}) }
  const fold = (into, extra) => {
    const add = toNum(out[extra])
    if (add == null || add === 0) return
    out[into] = num0(out[into]) + add
    out[extra] = 0
  }
  fold('accounts_receivable', 'notes_receivable')
  fold('accounts_payable', 'notes_payable')
  if (toNum(out.contract_liability) == null && toNum(out.advance_receipt) != null) {
    out.contract_liability = toNum(out.advance_receipt)
    out.advance_receipt = 0
  }
  const anyPart = EQUITY_PART_KEYS.some((k) => toNum(out[k]) != null)
  if (!anyPart && toNum(out.equity) != null) {
    out.retained_earnings = toNum(out.equity)
    out.equity = null
  }
  return out
}

const keysOf = (group) => BS_INPUT_FIELDS.filter((f) => f.group === group).map((f) => f.key)

export function currentAssetsFromBs(bs) {
  return sumKeys(displayBs(bs), keysOf('current_assets'))
}

export function noncurrentAssetsFromBs(bs) {
  return sumKeys(displayBs(bs), keysOf('noncurrent_assets'))
}

export function totalAssetsFromBs(bs) {
  const a = currentAssetsFromBs(bs)
  const b = noncurrentAssetsFromBs(bs)
  if (a == null && b == null) return null
  return num0(a) + num0(b)
}

export function currentLiabFromBs(bs) {
  return sumKeys(displayBs(bs), keysOf('current_liab'))
}

export function noncurrentLiabFromBs(bs) {
  return sumKeys(displayBs(bs), keysOf('noncurrent_liab'))
}

export function totalLiabFromBs(bs) {
  const a = currentLiabFromBs(bs)
  const b = noncurrentLiabFromBs(bs)
  if (a == null && b == null) return null
  return num0(a) + num0(b)
}

export function nwcStockFromBs(bs) {
  const n = displayBs(bs)
  const ar = toNum(n.accounts_receivable)
  const inv = toNum(n.inventory)
  const ap = toNum(n.accounts_payable)
  if (ar == null && inv == null && ap == null) return null
  return num0(ar) + num0(inv) - num0(ap)
}

export function equityBookFromBs(bs) {
  const n = displayBs(bs)
  const parts = sumKeys(n, EQUITY_PART_KEYS)
  if (parts != null) return parts
  return toNum(n.equity)
}

export function debtRatioFromBs(bs) {
  const assets = totalAssetsFromBs(bs)
  const liab = totalLiabFromBs(bs)
  if (assets == null || assets === 0 || liab == null) return null
  return liab / assets
}

export function currentRatioFromBs(bs) {
  const assets = currentAssetsFromBs(bs)
  const liab = currentLiabFromBs(bs)
  if (assets == null || liab == null || liab === 0) return null
  return assets / liab
}

export function equityImpliedFromBs(bs) {
  const assets = totalAssetsFromBs(bs)
  const liab = totalLiabFromBs(bs)
  if (assets == null && liab == null) return null
  return num0(assets) - num0(liab)
}

export const BS_LABELS = Object.fromEntries(BS_INPUT_FIELDS.map((f) => [f.key, f.label]))
