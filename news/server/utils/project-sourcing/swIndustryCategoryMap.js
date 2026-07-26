/**
 * 申万行业（东财 EM2016）→ 竞品 category_4（Stage 1c）
 * 数据源：sw_industry_category_map 表
 */

const { DISPLAY_TO_CATEGORY_4 } = require('./industryCategory4Map');

/** Stage 1c 种子：东财申万一级默认映射（库内 27 个 L1） */
const SW_L1_DEFAULT_ROWS = [
  { sw_industry_l1: '信息技术', category_4: 'ai', category_display: '数字智能', sub_track: null },
  { sw_industry_l1: '互联网', category_4: 'ai', category_display: '数字智能', sub_track: null },
  { sw_industry_l1: '医药生物', category_4: 'bio', category_display: '生物医药', sub_track: null },
  { sw_industry_l1: '电子设备', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '机械设备', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '电气设备', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '交运设备', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '国防与装备', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '家电', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '基础化工', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '钢铁', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '有色金属', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '轻工制造', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '纺织服装', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '建材', category_4: 'semi_mfg', category_display: '半导体&先进制造', sub_track: 'advanced_mfg' },
  { sw_industry_l1: '农林牧渔', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '公用事业', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '交通运输', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '商贸零售', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '休闲、生活及专业服务', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '金融', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '建筑', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '房地产', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '食品饮料', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '化石能源', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '综合', category_4: 'other', category_display: null, sub_track: null },
  { sw_industry_l1: '文化传媒', category_4: 'other', category_display: null, sub_track: null },
];

/** L2 覆盖（优先于 L1 默认） */
const SW_L2_OVERRIDE_ROWS = [
  {
    sw_industry_l1: '电子设备',
    sw_industry_l2: '半导体',
    category_4: 'semi_mfg',
    category_display: '半导体&先进制造',
    sub_track: 'semi',
    boundary_note: '§7.2：半导体 L2 → sub_track=semi',
  },
];

function inferSwSubTrack(category4, swL1, swL2, mappedSubTrack) {
  if (category4 !== 'semi_mfg') return null;
  if (mappedSubTrack) return mappedSubTrack;
  const l2 = (swL2 || '').trim();
  if (l2 === '半导体') return 'semi';
  return 'advanced_mfg';
}

/**
 * @param {string} swL1
 * @param {string} swL2
 * @param {{ sw_industry_l1: string, sw_industry_l2: string, category_4: string, category_display?: string, sub_track?: string|null }[]} mapRows
 */
function mapSwIndustryToCategory4(swL1, swL2, mapRows) {
  const l1 = (swL1 || '').trim();
  const l2 = (swL2 || '').trim();
  if (!l1) {
    return { category_4: 'other', category_display: null, sub_track: null, match_level: 'no_sw' };
  }

  const exact = mapRows.find((m) => m.sw_industry_l1 === l1 && (m.sw_industry_l2 || '') === l2 && l2);
  if (exact) {
    return {
      category_4: exact.category_4,
      category_display: exact.category_display || null,
      sub_track: inferSwSubTrack(exact.category_4, l1, l2, exact.sub_track),
      match_level: 'l2',
    };
  }

  const l1Only = mapRows.find((m) => m.sw_industry_l1 === l1 && !(m.sw_industry_l2 || ''));
  if (l1Only) {
    return {
      category_4: l1Only.category_4,
      category_display: l1Only.category_display || null,
      sub_track: inferSwSubTrack(l1Only.category_4, l1, l2, l1Only.sub_track),
      match_level: 'l1',
    };
  }

  return { category_4: 'other', category_display: null, sub_track: null, match_level: 'unmapped' };
}

function buildSeedRows() {
  const rows = [];
  const seen = new Set();
  for (const r of SW_L1_DEFAULT_ROWS) {
    const key = `${r.sw_industry_l1}\0`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      sw_industry_l1: r.sw_industry_l1,
      sw_industry_l2: '',
      category_4: r.category_4,
      category_display: r.category_display,
      sub_track: r.sub_track,
      boundary_note: 'Stage1c L1 默认',
    });
  }
  for (const r of SW_L2_OVERRIDE_ROWS) {
    rows.push({
      sw_industry_l1: r.sw_industry_l1,
      sw_industry_l2: r.sw_industry_l2 || '',
      category_4: r.category_4,
      category_display: r.category_display,
      sub_track: r.sub_track,
      boundary_note: r.boundary_note || 'Stage1c L2 覆盖',
    });
  }
  return rows;
}

let cachedMapRows = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadSwIndustryMapFromDb(db, opts = {}) {
  if (!opts.force && cachedMapRows && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedMapRows;
  }
  const rows = await db.query(
    `SELECT sw_industry_l1, sw_industry_l2, category_4, category_display, sub_track
     FROM sw_industry_category_map
     WHERE F_DeleteMark = 0`
  );
  cachedMapRows = rows.map((r) => ({
    sw_industry_l1: r.sw_industry_l1,
    sw_industry_l2: r.sw_industry_l2 || '',
    category_4: r.category_4,
    category_display: r.category_display,
    sub_track: r.sub_track,
  }));
  cacheLoadedAt = Date.now();
  return cachedMapRows;
}

function clearSwIndustryMapCache() {
  cachedMapRows = null;
  cacheLoadedAt = 0;
}

async function resolveCategory4FromSw(db, swL1, swL2) {
  const mapRows = await loadSwIndustryMapFromDb(db);
  return mapSwIndustryToCategory4(swL1, swL2, mapRows);
}

module.exports = {
  DISPLAY_TO_CATEGORY_4,
  SW_L1_DEFAULT_ROWS,
  SW_L2_OVERRIDE_ROWS,
  buildSeedRows,
  inferSwSubTrack,
  mapSwIndustryToCategory4,
  loadSwIndustryMapFromDb,
  clearSwIndustryMapCache,
  resolveCategory4FromSw,
};
