/**
 * 烯牛 industry_source_lv1/lv2 → 竞品 category_4（Stage 0）
 * 数据源：industry_source_l1_map 表（由 importIndustrySourceL1Map.js 从 xlsx 导入）
 */

const DISPLAY_TO_CATEGORY_4 = {
  数字智能: 'ai',
  '半导体&先进制造': 'semi_mfg',
  生物医药: 'bio',
};

/** 库内扩展：xlsx 无单独行时仍归入 semi_mfg */
const EXTENSION_L1_ROWS = [
  {
    source_lv1: '半导体',
    source_lv2: '',
    category_display: '半导体&先进制造',
    boundary_note: '库内扩展：与 xlsx 映射分类「半导体&先进制造」一致',
  },
];

/**
 * @param {string|null|undefined} display
 * @returns {string|null}
 */
function displayToCategory4(display) {
  const d = (display || '').trim();
  if (!d) return null;
  return DISPLAY_TO_CATEGORY_4[d] || null;
}

/**
 * @param {string} category4
 * @param {string} sourceLv1
 * @returns {string|null}
 */
function inferSubTrack(category4, sourceLv1) {
  if (category4 !== 'semi_mfg') return null;
  if ((sourceLv1 || '').trim() === '半导体') return 'semi';
  return 'advanced_mfg';
}

/**
 * @param {unknown[][]} sheetRows xlsx 首个 sheet 的二维数组
 * @returns {{ source_lv1: string, source_lv2: string, category_display: string, category_4: string, sub_track: string|null, boundary_note: string|null }[]}
 */
function parseXlsxSheetRows(sheetRows) {
  if (!sheetRows?.length) return [];

  const out = [];
  const seen = new Set();

  const pushRow = (sourceLv1, sourceLv2, categoryDisplay, boundaryNote) => {
    const lv1 = (sourceLv1 || '').trim();
    const lv2 = (sourceLv2 || '').trim();
    const display = (categoryDisplay || '').trim();
    if (!lv1 || !display) return;

    const category4 = displayToCategory4(display);
    if (!category4) {
      throw new Error(`未知映射分类「${display}」（一级行业=${lv1}）`);
    }

    const key = `${lv1}\0${lv2}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      source_lv1: lv1,
      source_lv2: lv2,
      category_display: display,
      category_4: category4,
      sub_track: inferSubTrack(category4, lv1),
      boundary_note: boundaryNote || null,
    });
  };

  for (let i = 0; i < sheetRows.length; i += 1) {
    const row = sheetRows[i] || [];
    const c0 = String(row[0] ?? '').trim();
    const c1 = String(row[1] ?? '').trim();
    const c2 = String(row[2] ?? '').trim();

    if (i === 0 && (c0.includes('一级') || c0.toLowerCase() === 'source_lv1')) continue;
    pushRow(c0, c1, c2, null);
  }

  for (const ext of EXTENSION_L1_ROWS) {
    pushRow(ext.source_lv1, ext.source_lv2, ext.category_display, ext.boundary_note);
  }

  return out;
}

/**
 * @param {string} lv1
 * @param {string} lv2
 * @param {{ source_lv1: string, source_lv2: string, category_4: string, category_display?: string, sub_track?: string|null }[]} mapRows
 * @returns {{ category_4: string, category_display: string|null, sub_track: string|null, match_level: 'exact'|'lv1'|'extension'|'other' }}
 */
function mapSourceIndustryToCategory4(lv1, lv2, mapRows) {
  const a = (lv1 || '').trim();
  const b = (lv2 || '').trim();
  if (!a) {
    return { category_4: 'other', category_display: null, sub_track: null, match_level: 'other' };
  }

  const exact = mapRows.find((m) => m.source_lv1 === a && (m.source_lv2 || '') === b);
  if (exact) {
    return {
      category_4: exact.category_4,
      category_display: exact.category_display || null,
      sub_track: exact.sub_track ?? inferSubTrack(exact.category_4, a),
      match_level: 'exact',
    };
  }

  const lv1Only = mapRows.find((m) => m.source_lv1 === a && !(m.source_lv2 || ''));
  if (lv1Only) {
    return {
      category_4: lv1Only.category_4,
      category_display: lv1Only.category_display || null,
      sub_track: lv1Only.sub_track ?? inferSubTrack(lv1Only.category_4, a),
      match_level: 'lv1',
    };
  }

  const ext = EXTENSION_L1_ROWS.find((m) => m.source_lv1 === a && !(m.source_lv2 || ''));
  if (ext) {
    const category4 = displayToCategory4(ext.category_display);
    return {
      category_4: category4 || 'other',
      category_display: ext.category_display,
      sub_track: inferSubTrack(category4, a),
      match_level: 'extension',
    };
  }

  return { category_4: 'other', category_display: null, sub_track: null, match_level: 'other' };
}

let cachedMapRows = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @param {import('mysql2/promise').Pool|{ query: Function }} db
 * @param {{ force?: boolean }} [opts]
 */
async function loadIndustryMapFromDb(db, opts = {}) {
  if (!opts.force && cachedMapRows && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedMapRows;
  }
  const rows = await db.query(
    `SELECT source_lv1, source_lv2, category_4, category_display, sub_track
     FROM industry_source_l1_map
     WHERE F_DeleteMark = 0`
  );
  cachedMapRows = rows.map((r) => ({
    source_lv1: r.source_lv1,
    source_lv2: r.source_lv2 || '',
    category_4: r.category_4,
    category_display: r.category_display,
    sub_track: r.sub_track,
  }));
  cacheLoadedAt = Date.now();
  return cachedMapRows;
}

function clearIndustryMapCache() {
  cachedMapRows = null;
  cacheLoadedAt = 0;
}

/**
 * @param {import('mysql2/promise').Pool|{ query: Function }} db
 * @param {string} lv1
 * @param {string} lv2
 */
async function resolveCategory4FromDb(db, lv1, lv2) {
  const mapRows = await loadIndustryMapFromDb(db);
  return mapSourceIndustryToCategory4(lv1, lv2, mapRows);
}

module.exports = {
  DISPLAY_TO_CATEGORY_4,
  EXTENSION_L1_ROWS,
  displayToCategory4,
  inferSubTrack,
  parseXlsxSheetRows,
  mapSourceIndustryToCategory4,
  loadIndustryMapFromDb,
  clearIndustryMapCache,
  resolveCategory4FromDb,
};
