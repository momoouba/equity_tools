/**
 * 融资轮次 → 概览七桶归并（口径 v1）。
 * 供市场概览聚合与融资事件列表 round_bucket 筛选共用。
 */

const ROUND_BUCKET_VERSION = 'v1';

const ROUND_BUCKETS = [
  '种子/天使',
  'Pre-A / A',
  'B',
  'C',
  'D 及以后',
  '战略/并购及其他',
  '未识别',
];

const EARLY_STAGE_BUCKETS = ['种子/天使', 'Pre-A / A'];

function normalizeRoundText(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * @param {string|null|undefined} raw
 * @returns {string} 桶展示名
 */
function mapRoundToBucket(raw) {
  const s = normalizeRoundText(raw);
  if (!s || s === '未知' || s === 'unknown' || s === 'n/a' || s === '-' || s === '—') {
    return '未识别';
  }

  if (/种子|天使|seed|angel/.test(s)) return '种子/天使';

  if (/pre-?a|prea/.test(s)) return 'Pre-A / A';
  if (/a\+|a1|a2|a轮|a角|系列a|seriesa/.test(s)) return 'Pre-A / A';
  if (/^a$/.test(s)) return 'Pre-A / A';

  if (/pre-?b|preb/.test(s)) return 'B';
  if (/b\+|b1|b2|b轮|系列b|seriesb/.test(s)) return 'B';
  if (/^b$/.test(s)) return 'B';

  if (/pre-?c|prec/.test(s)) return 'C';
  if (/c\+|c1|c2|c轮|系列c|seriesc/.test(s)) return 'C';
  if (/^c$/.test(s)) return 'C';

  if (/pre-?ipo|preipo|上市前/.test(s)) return 'D 及以后';
  if (/[defg]轮|[defg]\+|系列[defg]|series[defg]/.test(s)) return 'D 及以后';
  if (/^[defg]$/.test(s)) return 'D 及以后';

  if (/战略|并购|收购|定增|ipo|已上市|债|借款/.test(s)) return '战略/并购及其他';

  return '未识别';
}

/**
 * MySQL 表达式：将 round 列映射为桶名（与 mapRoundToBucket 尽量对齐，供列表筛选）。
 * 列名固定为 `round`。
 */
function roundBucketSqlExpr(column = 'round') {
  const col = column;
  const norm = `LOWER(REPLACE(TRIM(COALESCE(${col},'')), ' ', ''))`;
  return `(CASE
    WHEN ${col} IS NULL OR TRIM(${col}) = ''
      OR ${norm} IN ('未知','unknown','n/a','-','—') THEN '未识别'
    WHEN ${norm} REGEXP '种子|天使|seed|angel' THEN '种子/天使'
    WHEN ${norm} REGEXP 'pre-?a|prea|a\\\\+|a1|a2|a轮|a角|系列a|seriesa' OR ${norm} = 'a' THEN 'Pre-A / A'
    WHEN ${norm} REGEXP 'pre-?b|preb|b\\\\+|b1|b2|b轮|系列b|seriesb' OR ${norm} = 'b' THEN 'B'
    WHEN ${norm} REGEXP 'pre-?c|prec|c\\\\+|c1|c2|c轮|系列c|seriesc' OR ${norm} = 'c' THEN 'C'
    WHEN ${norm} REGEXP 'pre-?ipo|preipo|上市前|[defg]轮|[defg]\\\\+|系列[defg]|series[defg]'
      OR ${norm} REGEXP '^[defg]$' THEN 'D 及以后'
    WHEN ${norm} REGEXP '战略|并购|收购|定增|ipo|已上市|债|借款' THEN '战略/并购及其他'
    ELSE '未识别'
  END)`;
}

function isValidRoundBucket(name) {
  return ROUND_BUCKETS.includes(String(name || ''));
}

module.exports = {
  ROUND_BUCKET_VERSION,
  ROUND_BUCKETS,
  EARLY_STAGE_BUCKETS,
  normalizeRoundText,
  mapRoundToBucket,
  roundBucketSqlExpr,
  isValidRoundBucket,
};
