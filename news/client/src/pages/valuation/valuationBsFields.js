/** 标的资产负债表科目（与 server/utils/valuation/targetBsFields.js 对齐）。界面单位：万元。 */

export const BS_INPUT_FIELDS = [
  { key: 'cash', label: '货币资金', group: 'current_assets', note: '库存现金、银行存款及其他货币资金' },
  { key: 'notes_receivable', label: '应收票据', group: 'current_assets', note: '因销售商品或提供劳务收到的商业汇票' },
  { key: 'accounts_receivable', label: '应收账款', group: 'current_assets', note: '因销售商品或提供劳务应向客户收取的款项' },
  { key: 'prepayment', label: '预付款项', group: 'current_assets', note: '预先支付给供应商的货款或劳务款' },
  { key: 'inventory', label: '存货', group: 'current_assets', note: '原材料、在产品、库存商品及周转材料等' },
  { key: 'other_current_assets', label: '其他流动资产', group: 'current_assets', note: '一年内变现或耗用、未单独列示的其他流动资产' },
  { key: 'fixed_assets', label: '固定资产', group: 'noncurrent_assets', note: '房屋建筑物、机器设备等使用寿命超过一年的有形资产净值' },
  { key: 'cip', label: '在建工程', group: 'noncurrent_assets', note: '尚未完工交付的工程支出' },
  { key: 'intangible', label: '无形资产', group: 'noncurrent_assets', note: '专利权、土地使用权、软件等无实物形态资产净值' },
  { key: 'long_prepaid', label: '长期待摊费用', group: 'noncurrent_assets', note: '已经发生、摊销期超过一年的费用' },
  { key: 'deferred_tax_assets', label: '递延所得税资产', group: 'noncurrent_assets', note: '可抵扣暂时性差异确认的所得税资产' },
  { key: 'short_term_loan', label: '短期借款', group: 'current_liab', note: '向银行等借入、偿还期不超过一年的借款' },
  { key: 'notes_payable', label: '应付票据', group: 'current_liab', note: '开出、承兑的商业汇票' },
  { key: 'accounts_payable', label: '应付账款', group: 'current_liab', note: '因购买商品或接受劳务应付给供应商的款项' },
  { key: 'advance_receipt', label: '预收款项', group: 'current_liab', note: '预先向客户收取的货款或劳务款' },
  { key: 'staff_payable', label: '应付职工薪酬', group: 'current_liab', note: '应付职工的工资、奖金、社会保险及公积金等' },
  { key: 'tax_payable', label: '应交税费', group: 'current_liab', note: '应交未交的增值税、企业所得税等税费' },
  { key: 'long_term_loan', label: '长期借款', group: 'noncurrent_liab', note: '偿还期超过一年的借款' },
  { key: 'deferred_income', label: '递延收益', group: 'noncurrent_liab', note: '已收到但尚未确认为收入的政府补助等' },
  { key: 'equity', label: '所有者权益', group: 'equity', note: '实收资本、资本公积、盈余公积及未分配利润等合计' },
]

export const BS_INPUT_KEYS = BS_INPUT_FIELDS.map((f) => f.key)

export const BS_GROUPS = [
  { key: 'current_assets', label: '流动资产' },
  { key: 'noncurrent_assets', label: '非流动资产' },
  { key: 'current_liab', label: '流动负债' },
  { key: 'noncurrent_liab', label: '非流动负债' },
  { key: 'equity', label: '所有者权益' },
]

const NWC_ASSET_KEYS = ['notes_receivable', 'accounts_receivable', 'prepayment', 'inventory']
const NWC_LIAB_KEYS = ['notes_payable', 'accounts_payable', 'advance_receipt']

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

export function currentAssetsFromBs(bs) {
  return sumKeys(bs, BS_INPUT_FIELDS.filter((f) => f.group === 'current_assets').map((f) => f.key))
}

export function noncurrentAssetsFromBs(bs) {
  return sumKeys(bs, BS_INPUT_FIELDS.filter((f) => f.group === 'noncurrent_assets').map((f) => f.key))
}

export function totalAssetsFromBs(bs) {
  const a = currentAssetsFromBs(bs)
  const b = noncurrentAssetsFromBs(bs)
  if (a == null && b == null) return null
  return num0(a) + num0(b)
}

export function currentLiabFromBs(bs) {
  return sumKeys(bs, BS_INPUT_FIELDS.filter((f) => f.group === 'current_liab').map((f) => f.key))
}

export function noncurrentLiabFromBs(bs) {
  return sumKeys(bs, BS_INPUT_FIELDS.filter((f) => f.group === 'noncurrent_liab').map((f) => f.key))
}

export function totalLiabFromBs(bs) {
  const a = currentLiabFromBs(bs)
  const b = noncurrentLiabFromBs(bs)
  if (a == null && b == null) return null
  return num0(a) + num0(b)
}

export function nwcStockFromBs(bs) {
  const assets = sumKeys(bs, NWC_ASSET_KEYS)
  const liab = sumKeys(bs, NWC_LIAB_KEYS)
  if (assets == null && liab == null) return null
  return num0(assets) - num0(liab)
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
