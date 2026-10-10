/** 退出市值已经是亿元、两位小数。MOC / IRR 在展示时按投前估值和稀释重算。 */

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function yuanToYi2(yuan) {
  const n = Number(yuan);
  if (!Number.isFinite(n)) return null;
  return round2(n / 1e8);
}

/**
 * @param {number|null} capYi 退出市值，亿元，已保留 2 位
 * @param {number|null} dilution 空按 100%
 * @param {number|null} dealYi 本轮交易估值（投前），亿元
 * @param {number|null} holdingYears
 * @returns {{ moc: number|null, irr: number|null, note: string|null }}
 * irr 为百分数、2 位（15.24 表示 15.24%）
 */
function exitMocIrr(capYi, dilution, dealYi, holdingYears) {
  const cap = Number(capYi);
  if (!Number.isFinite(cap)) return { moc: null, irr: null, note: '待计算' };
  const deal = Number(dealYi);
  if (!(deal > 0)) return { moc: null, irr: null, note: '待填写本轮交易估值（投前）' };
  const d = dilution == null || dilution === '' ? 1 : Number(dilution);
  if (!Number.isFinite(d) || d < 0 || d > 1) {
    return { moc: null, irr: null, note: '后续股权稀释需在 0% 到 100%' };
  }
  const moc = round2((cap * d) / deal);
  if (!(moc > 0)) return { moc, irr: null, note: 'MOC 不为正，无 IRR' };
  const years = Number(holdingYears);
  if (!(years > 0)) return { moc, irr: null, note: null };
  const irr = round2((moc ** (1 / years) - 1) * 100);
  return { moc, irr, note: null };
}

module.exports = {
  round2,
  yuanToYi2,
  exitMocIrr,
};
