const { toNumber } = require('./marketUtils');

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

/**
 * 现金流量表补充资料里的折旧摊销合计（元）。
 * 东方财富没有「折旧摊销」合计列，固定资产折旧与油气/生物资产折旧常是同一金额的两列，只计一次。
 * 含使用权资产折旧。不含递延收益摊销。
 */
function sumCashflowDa(row) {
  const direct = toNumber(pick(row, ['DEPRECIATION_ETC', '折旧摊销']));
  if (direct != null) return direct;
  const fa = toNumber(pick(row, ['FA_IR_DEPR', '固定资产折旧']));
  const oil = toNumber(pick(row, ['OILGAS_BIOLOGY_DEPR']));
  const parts = [
    fa != null ? fa : oil,
    toNumber(pick(row, ['IA_AMORTIZE', '无形资产摊销'])),
    toNumber(pick(row, ['LPE_AMORTIZE', '长期待摊费用摊销'])),
    toNumber(pick(row, ['USERIGHT_ASSET_AMORTIZE', '使用权资产折旧'])),
  ].filter((n) => n != null);
  if (!parts.length) return null;
  return parts.reduce((sum, n) => sum + n, 0);
}

module.exports = { sumCashflowDa };
