/**
 * 底层项目上市进展展示去重：同一持仓在同一业务日、同一审核状态被匹配表写入多条快照时，只保留一行。
 * 不同基金/子基金（例如长三角一期 vs 金澜二期）视为不同持仓，不去掉。
 */
function progressMailDedupeKey(r) {
  return [
    String(r.fund || '').trim(),
    String(r.sub || '').trim(),
    String(r.project_name || '').trim(),
    String(r.company || '').trim(),
    String(r.status || '').trim(),
    String(r.exchange || '').trim(),
    String(r.board || '').trim(),
    String(r.F_UpdateTime || '').slice(0, 10),
    String(r.inv_amount ?? ''),
    String(r.residual_amount ?? ''),
    String(r.ratio ?? ''),
    String(r.ct_amount ?? ''),
    String(r.ct_residual ?? ''),
  ].join('\0');
}

function dedupeIpoProjectProgressRowsForMail(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const key = progressMailDedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

module.exports = { dedupeIpoProjectProgressRowsForMail };
