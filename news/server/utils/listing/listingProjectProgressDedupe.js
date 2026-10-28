/**
 * 底层项目上市进展去重：
 * - 邮件 / 列表：同一持仓展示字段在同一业务日、同一审核状态下只保留一行
 * - 不同基金/子基金视为不同持仓，不去掉
 */

/** 邮件与列表共用的展示去重键（不依赖 ipo_project_f_id） */
function progressMailDedupeKey(r) {
  const updateRaw = r.F_UpdateTime || r.f_update_time || '';
  return [
    String(r.fund || '').trim(),
    String(r.sub || '').trim(),
    String(r.project_name || '').trim(),
    String(r.company || '').trim(),
    String(r.status || '').trim(),
    String(r.exchange || '').trim(),
    String(r.board || '').trim(),
    String(updateRaw).slice(0, 10),
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

/** 列表 SQL：按展示字段分区，保留 F_Id 最小的一条（与邮件去重口径一致） */
const IPP_LIST_DEDUPE_PARTITION_SQL = [
  "TRIM(IFNULL(ipp.fund, ''))",
  "TRIM(IFNULL(ipp.sub, ''))",
  "TRIM(IFNULL(ipp.project_name, ''))",
  "TRIM(IFNULL(ipp.company, ''))",
  "TRIM(IFNULL(ipp.status, ''))",
  "TRIM(IFNULL(ipp.exchange, ''))",
  "TRIM(IFNULL(ipp.board, ''))",
  'DATE(ipp.F_UpdateTime)',
  'IFNULL(ipp.inv_amount, 0)',
  'IFNULL(ipp.residual_amount, 0)',
  'IFNULL(ipp.ratio, 0)',
  'IFNULL(ipp.ct_amount, 0)',
  'IFNULL(ipp.ct_residual, 0)',
].join(', ');

const IPP_LIST_DEDUPE_ROW_NUMBER_SQL = `ROW_NUMBER() OVER (PARTITION BY ${IPP_LIST_DEDUPE_PARTITION_SQL} ORDER BY ipp.F_Id ASC)`;

/** 无表别名时的分区（分享页 plain 查询） */
const IPP_LIST_DEDUPE_PARTITION_PLAIN_SQL = [
  "TRIM(IFNULL(fund, ''))",
  "TRIM(IFNULL(sub, ''))",
  "TRIM(IFNULL(project_name, ''))",
  "TRIM(IFNULL(company, ''))",
  "TRIM(IFNULL(status, ''))",
  "TRIM(IFNULL(exchange, ''))",
  "TRIM(IFNULL(board, ''))",
  'DATE(F_UpdateTime)',
  'IFNULL(inv_amount, 0)',
  'IFNULL(residual_amount, 0)',
  'IFNULL(ratio, 0)',
  'IFNULL(ct_amount, 0)',
  'IFNULL(ct_residual, 0)',
].join(', ');

const IPP_LIST_DEDUPE_ROW_NUMBER_PLAIN_SQL = `ROW_NUMBER() OVER (PARTITION BY ${IPP_LIST_DEDUPE_PARTITION_PLAIN_SQL} ORDER BY F_Id ASC)`;

/**
 * 匹配源行状态：1 有效公开行，2 打新日历，0 源行失效/无关联
 */
function resolveMatchedProgressValid(row) {
  const source = String(row?.match_source || '').trim();
  if (source === 'new_share' && !row?.ipo_progress_row_id) return 2;
  if (row?.matched_progress_valid != null) return Number(row.matched_progress_valid) ? 1 : 0;
  return 0;
}

module.exports = {
  progressMailDedupeKey,
  dedupeIpoProjectProgressRowsForMail,
  IPP_LIST_DEDUPE_PARTITION_SQL,
  IPP_LIST_DEDUPE_ROW_NUMBER_SQL,
  IPP_LIST_DEDUPE_PARTITION_PLAIN_SQL,
  IPP_LIST_DEDUPE_ROW_NUMBER_PLAIN_SQL,
  resolveMatchedProgressValid,
};
