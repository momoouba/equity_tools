'use strict';

/**
 * 落库裁剪：主体去重 + 按竞品类型配额 + 上市形态上下限 + 总量封顶。
 * 金标（用户勾选可比）优先保留，但不突破总量与形态上限。
 */

const {
  candidateDedupeKey,
  normalizeCreditCode,
  strTrim,
} = require('./competitorMatchUtils');
const { namesMatchLoosely, normalizeCompetitorCompanyNameForMatch } = require('./competitorCompanyMatch');
const {
  MIN_DOMESTIC_LISTED_COMPETITORS,
  MIN_UNLISTED_COMPETITORS,
  isDomesticListedCandidate,
  isDomesticUnlistedCandidate,
  countDomesticListedInPersistRows,
  countUnlistedInPersistRows,
} = require('./competitorListedDomestic');
const { isOverseasCompetitorCandidate } = require('./competitorDomesticIdentityUtils');

const PERSIST_TOTAL_CAP = Math.max(
  12,
  parseInt(process.env.COMPETITOR_PERSIST_TOTAL_CAP || '30', 10) || 30
);
const TYPE_MAX = {
  direct: Math.max(1, parseInt(process.env.COMPETITOR_TYPE_MAX_DIRECT || '10', 10) || 10),
  indirect: Math.max(1, parseInt(process.env.COMPETITOR_TYPE_MAX_INDIRECT || '14', 10) || 14),
  substitute: Math.max(0, parseInt(process.env.COMPETITOR_TYPE_MAX_SUBSTITUTE || '4', 10) || 4),
  same_track: Math.max(0, parseInt(process.env.COMPETITOR_TYPE_MAX_SAME_TRACK || '2', 10) || 2),
};
const MAX_OVERSEAS = Math.max(
  0,
  parseInt(process.env.COMPETITOR_MAX_OVERSEAS || '8', 10) || 8
);
const MAX_DOMESTIC_LISTED = Math.max(
  MIN_DOMESTIC_LISTED_COMPETITORS,
  parseInt(process.env.COMPETITOR_MAX_DOMESTIC_LISTED || '8', 10) || 8
);
const MAX_DOMESTIC_UNLISTED = Math.max(
  MIN_UNLISTED_COMPETITORS,
  parseInt(process.env.COMPETITOR_MAX_DOMESTIC_UNLISTED || '16', 10) || 16
);

const CITY_PREFIX_RE =
  /^(北京|上海|杭州|嘉兴|烟台|苏州|无锡|宁波|成都|南京|广州|深圳|天津|重庆|武汉|西安|青岛|佛山|合肥|郑州|长沙|沈阳)/;

function coreBrandName(name) {
  let s = normalizeCompetitorCompanyNameForMatch(name);
  if (!s) return '';
  const SUF =
    /(股份有限公司|有限责任公司|有限公司|集团|控股|药业|医药|生物技术|生物医药|生物|科技|医疗|技术)$/;
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(CITY_PREFIX_RE, '').replace(SUF, '');
    if (next === s) break;
    s = next;
  }
  return strTrim(s);
}

function persistRowName(row) {
  return strTrim(row.display_name || row._candidate?.display_name);
}

function persistRowCredit(row) {
  return normalizeCreditCode(row.unified_credit_code || row._candidate?.unified_credit_code);
}

function samePersistEntity(a, b) {
  const ac = persistRowCredit(a);
  const bc = persistRowCredit(b);
  if (ac.length >= 15 && bc.length >= 15 && ac === bc) return true;
  const na = persistRowName(a);
  const nb = persistRowName(b);
  if (namesMatchLoosely(na, nb)) return true;
  const ca = coreBrandName(na);
  const cb = coreBrandName(nb);
  if (ca.length >= 2 && ca === cb) return true;
  if (ca.length >= 2 && cb.length >= 2 && (ca.includes(cb) || cb.includes(ca))) return true;
  return false;
}

function persistRowScore(row) {
  const vs = Number(row._candidate?.validation?.validated_score);
  const final = Number(row.finalScore) || 0;
  return (Number.isFinite(vs) ? vs : 0) * 1000 + final;
}

function isUserGoldRow(row) {
  const c = row._candidate || {};
  return !!(c._fromGoldStandard && c._goldStandardNegative !== true);
}

function preferPersistRow(next, prev) {
  const ng = isUserGoldRow(next) ? 1 : 0;
  const pg = isUserGoldRow(prev) ? 1 : 0;
  if (ng !== pg) return ng > pg;
  return persistRowScore(next) > persistRowScore(prev);
}

function dedupePersistRowsByEntity(rows) {
  const kept = [];
  for (const row of rows || []) {
    const idx = kept.findIndex((k) => samePersistEntity(k, row));
    if (idx < 0) {
      kept.push(row);
      continue;
    }
    if (preferPersistRow(row, kept[idx])) kept[idx] = row;
  }
  return kept;
}

function persistType(row) {
  const t = strTrim(row.competitorType || row._candidate?.validation?.competitor_type).toLowerCase();
  if (TYPE_MAX[t] != null) return t;
  return 'indirect';
}

function listingBucket(row) {
  const c = row._candidate || row;
  if (isOverseasCompetitorCandidate(c)) return 'overseas';
  if (isDomesticListedCandidate(c)) return 'listed';
  if (isDomesticUnlistedCandidate(c)) return 'unlisted';
  return 'overseas';
}

function sortByPersistScore(rows) {
  return [...rows].sort((a, b) => {
    const ga = isUserGoldRow(a) ? 1 : 0;
    const gb = isUserGoldRow(b) ? 1 : 0;
    if (ga !== gb) return gb - ga;
    return persistRowScore(b) - persistRowScore(a);
  });
}

function listingCounts(rows) {
  return {
    listed: countDomesticListedInPersistRows(rows),
    unlisted: countUnlistedInPersistRows(rows),
    overseas: rows.filter((r) => listingBucket(r) === 'overseas').length,
  };
}

function typeCount(rows, type) {
  return rows.filter((r) => persistType(r) === type).length;
}

function canAddRow(picked, row, { respectTypeMax = true, respectListingMax = true, respectTotal = true } = {}) {
  if (respectTotal && picked.length >= PERSIST_TOTAL_CAP) return false;
  if (respectTypeMax && typeCount(picked, persistType(row)) >= TYPE_MAX[persistType(row)]) return false;
  if (!respectListingMax) return true;
  const bucket = listingBucket(row);
  const counts = listingCounts(picked);
  if (bucket === 'overseas' && counts.overseas >= MAX_OVERSEAS) return false;
  if (bucket === 'listed' && counts.listed >= MAX_DOMESTIC_LISTED) return false;
  if (bucket === 'unlisted' && counts.unlisted >= MAX_DOMESTIC_UNLISTED) return false;
  return true;
}

function rowKey(row) {
  return candidateDedupeKey({
    unified_credit_code: persistRowCredit(row),
    display_name: persistRowName(row),
  });
}

/**
 * 去重后按类型配额与形态上下限裁到总量上限。
 * 用户可比金标优先入选；保底未上市/境内上市在裁剪时受保护。
 */
function applyPersistTypeQuota(rows) {
  const deduped = sortByPersistScore(dedupePersistRowsByEntity(rows));
  const picked = [];
  const pickedKeys = new Set();
  const add = (row, opts) => {
    const k = rowKey(row);
    if (!k || pickedKeys.has(k)) return false;
    if (!canAddRow(picked, row, opts)) return false;
    picked.push(row);
    pickedKeys.add(k);
    return true;
  };

  const gold = deduped.filter(isUserGoldRow);
  const rest = deduped.filter((r) => !isUserGoldRow(r));

  for (const row of gold) add(row, { respectTypeMax: false, respectListingMax: true, respectTotal: true });
  for (const row of rest) add(row, { respectTypeMax: true, respectListingMax: true, respectTotal: true });

  const fillMins = (bucket, minN, pred) => {
    let n = bucket === 'listed' ? listingCounts(picked).listed : listingCounts(picked).unlisted;
    if (n >= minN) return;
    for (const respectTypeMax of [true, false]) {
      for (const row of deduped) {
        if (n >= minN || picked.length >= PERSIST_TOTAL_CAP) return;
        if (!pred(row)) continue;
        if (add(row, { respectTypeMax, respectListingMax: false, respectTotal: true })) {
          n += 1;
        }
      }
    }
  };
  fillMins('listed', MIN_DOMESTIC_LISTED_COMPETITORS, (r) => listingBucket(r) === 'listed');
  fillMins('unlisted', MIN_UNLISTED_COMPETITORS, (r) => listingBucket(r) === 'unlisted');

  const clipped = [];
  const typeUsed = { direct: 0, indirect: 0, substitute: 0, same_track: 0 };
  for (const row of sortByPersistScore(picked)) {
    const t = persistType(row);
    if (!isUserGoldRow(row) && typeUsed[t] >= TYPE_MAX[t]) continue;
    clipped.push(row);
    typeUsed[t] += 1;
  }
  picked.length = 0;
  picked.push(...clipped);
  pickedKeys.clear();
  for (const row of picked) pickedKeys.add(rowKey(row));
  const fillMinsRespectType = (bucket, minN, pred) => {
    let n = bucket === 'listed' ? listingCounts(picked).listed : listingCounts(picked).unlisted;
    if (n >= minN) return;
    for (const row of deduped) {
      if (n >= minN || picked.length >= PERSIST_TOTAL_CAP) return;
      if (!pred(row)) continue;
      if (add(row, { respectTypeMax: true, respectListingMax: false, respectTotal: true })) {
        n += 1;
      }
    }
  };
  fillMinsRespectType('listed', MIN_DOMESTIC_LISTED_COMPETITORS, (r) => listingBucket(r) === 'listed');
  fillMinsRespectType('unlisted', MIN_UNLISTED_COMPETITORS, (r) => listingBucket(r) === 'unlisted');

  while (picked.length > PERSIST_TOTAL_CAP) {
    const counts = listingCounts(picked);
    let dropIdx = -1;
    for (let i = picked.length - 1; i >= 0; i -= 1) {
      if (isUserGoldRow(picked[i])) continue;
      const b = listingBucket(picked[i]);
      if (b === 'listed' && counts.listed <= MIN_DOMESTIC_LISTED_COMPETITORS) continue;
      if (b === 'unlisted' && counts.unlisted <= MIN_UNLISTED_COMPETITORS) continue;
      dropIdx = i;
      break;
    }
    if (dropIdx < 0) break;
    const dropped = picked.splice(dropIdx, 1)[0];
    pickedKeys.delete(rowKey(dropped));
  }

  return { rows: sortByPersistScore(picked), stats: buildQuotaStats(rows, picked) };
}

function buildQuotaStats(before, after) {
  const counts = listingCounts(after);
  const byType = {};
  for (const t of Object.keys(TYPE_MAX)) byType[t] = typeCount(after, t);
  return {
    before: (before || []).length,
    after: after.length,
    cap: PERSIST_TOTAL_CAP,
    by_type: byType,
    type_max: { ...TYPE_MAX },
    listed: counts.listed,
    unlisted: counts.unlisted,
    overseas: counts.overseas,
    max_listed: MAX_DOMESTIC_LISTED,
    max_unlisted: MAX_DOMESTIC_UNLISTED,
    max_overseas: MAX_OVERSEAS,
    gold_kept: after.filter(isUserGoldRow).length,
  };
}

module.exports = {
  PERSIST_TOTAL_CAP,
  TYPE_MAX,
  MAX_OVERSEAS,
  MAX_DOMESTIC_LISTED,
  MAX_DOMESTIC_UNLISTED,
  dedupePersistRowsByEntity,
  applyPersistTypeQuota,
  samePersistEntity,
  coreBrandName,
};
