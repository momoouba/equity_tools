/**
 * 从投资方字段拆分「有标记的机构」并按「事件内去重 → 跨事件累加参投数」聚合。
 * 概览口径：排除个人投资者、未披露/空名等；优先认 inv_id_xn>0 的机构。
 */

/** 明确的个人 / 未分类占位，一律不进机构榜与 KPI */
const PERSONAL_OR_UNMARKED_EXACT = new Set([
  '个人投资者',
  '多名个人投资者',
  '若干个人投资者',
  '个人',
  '自然人',
  '天使投资人',
  '公司高管',
  '员工持股',
  '员工持股平台',
  '未披露',
  '未透露',
  '未公开',
  '保密',
  '其他',
  '其它',
  '未知',
  '无',
  '不详',
  'n/a',
  'N/A',
  '-',
  '—',
  '[]',
  '{}',
]);

const PERSONAL_OR_UNMARKED_INCLUDES = [
  '个人投资者',
  '自然人投资者',
  '未披露投资',
  '未透露投资',
];

/** 机构名常见标记（中英文） */
const INSTITUTION_MARK_RE =
  /资本|基金|投资|创投|合伙|公司|有限|银行|证券|保险|集团|控股|管理|顾问|资产|股权|产业|母基金|孵化|加速|科创|引导|信托|租赁|财务|财团|中心|研究院|实验室|大学|学院|国资|国投|产投|战投|事务所|联盟|协会|公社|金控|金投|创投|风投|私募|公募|券商|VC|PE|CVC|FOF|LP|GP|Capital|Venture|Partner|Fund|Equity|Holding|Management|Invest|Asset|Securities|Bank|Insurance|Ltd|LLC|Inc|Corp|GmbH|株式会社/i;

function isBlankInvestorName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (n === '[]' || n === '{}' || n === '-' || n === '—' || n === '无' || n === '未知' || n === 'N/A' || n === 'n/a') {
    return true;
  }
  return false;
}

function looksLikePersonName(name) {
  const n = String(name || '').trim();
  // 纯中文短名（2～4 字）且无机构关键词 → 视为个人
  if (/^[\u4e00-\u9fff]{2,4}$/.test(n) && !INSTITUTION_MARK_RE.test(n)) return true;
  return false;
}

/**
 * 是否计入「头部机构」：只要有标记的机构，排除个人与未分类占位。
 * @param {string} name
 * @param {{ invIdXn?: number|null, requireMarked?: boolean }} [meta]
 *   - invIdXn>0：源端有机构 ID，视为有标记机构
 *   - requireMarked 默认 true：无 ID 时须命中机构关键词，否则不计入
 */
function isCountableInstitution(name, meta = {}) {
  if (isBlankInvestorName(name)) return false;
  const n = String(name).trim();
  const lower = n.toLowerCase();
  if (PERSONAL_OR_UNMARKED_EXACT.has(n) || PERSONAL_OR_UNMARKED_EXACT.has(lower)) return false;
  for (let i = 0; i < PERSONAL_OR_UNMARKED_INCLUDES.length; i++) {
    if (n.includes(PERSONAL_OR_UNMARKED_INCLUDES[i])) return false;
  }
  if (looksLikePersonName(n)) return false;

  const invId = meta.invIdXn != null ? Number(meta.invIdXn) : null;
  if (invId != null && Number.isFinite(invId) && invId > 0) {
    return true;
  }

  // 无源端 ID：仅保留带机构关键词的名称（有标记），其余丢弃（不进「未分类」桶）
  if (meta.requireMarked !== false) {
    return INSTITUTION_MARK_RE.test(n);
  }
  return true;
}

/**
 * 从单行提取可统计机构名列表（事件内去重）。
 * 优先 inv_info_json；否则回退 investor_names。
 * @param {{ investor_names?: *, inv_info_json?: * }} row
 * @returns {string[]}
 */
function extractInstitutionNames(row) {
  const seen = new Set();
  const out = [];

  function pushName(name, invIdXn) {
    const n = String(name || '').trim();
    if (!isCountableInstitution(n, { invIdXn, requireMarked: true })) return;
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  }

  let usedJson = false;
  const rawJson = row && row.inv_info_json;
  if (rawJson != null && String(rawJson).trim()) {
    try {
      const arr = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      if (Array.isArray(arr)) {
        usedJson = true;
        for (let i = 0; i < arr.length; i++) {
          const x = arr[i];
          if (x == null) continue;
          if (typeof x === 'string') {
            pushName(x, null);
            continue;
          }
          const nm = x.inv_nm != null ? String(x.inv_nm) : '';
          const idRaw = x.inv_id_xn != null ? x.inv_id_xn : x.inv_id;
          pushName(nm, idRaw);
        }
      }
    } catch {
      usedJson = false;
    }
  }

  if (!usedJson) {
    const names = parseInvestorNames(row && row.investor_names);
    for (let i = 0; i < names.length; i++) {
      pushName(names[i], null);
    }
  }

  return out;
}

/**
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
function parseInvestorNames(raw) {
  if (raw == null || raw === '') return [];
  if (typeof raw !== 'string') {
    raw = String(raw);
  }
  const trimmed = raw.trim();
  if (!trimmed || isBlankInvestorName(trimmed)) return [];

  let names = [];
  let parsedJsonArray = false;
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        parsedJsonArray = true;
        names = arr
          .map((x) => {
            if (x == null) return '';
            if (typeof x === 'string') return x;
            if (typeof x === 'object' && x.inv_nm != null) return String(x.inv_nm);
            return '';
          })
          .filter((s) => !isBlankInvestorName(s));
      }
    } catch {
      /* 非合法 JSON：按分隔符拆 */
    }
  }
  if (!parsedJsonArray && !names.length) {
    names = trimmed
      .split(/[、，,;；]/)
      .map((s) => s.trim())
      .filter((s) => !isBlankInvestorName(s));
  }

  const seen = new Set();
  const unique = [];
  for (let i = 0; i < names.length; i++) {
    const n = String(names[i] || '').trim();
    if (isBlankInvestorName(n) || seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  return unique;
}

/**
 * @param {Array<{ id?: *, event_date?: *, investor_names?: *, inv_info_json?: *, amount_cny?: * }>} rows
 * @param {{ years: number[], windowEventCount: number, topN?: number, yearlyTopN?: number }} opts
 */
function aggregateInvestors(rows, opts) {
  const years = opts.years || [];
  const windowEventCount = Number(opts.windowEventCount || 0);
  const topN = opts.topN != null ? opts.topN : 20;
  const yearlyTopN = opts.yearlyTopN != null ? opts.yearlyTopN : 10;

  /** @type {Map<string, { dealCount: number, amountSum: number, byYear: Map<number, number> }>} */
  const map = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const names = extractInstitutionNames(row);
    if (!names.length) continue;

    let year = null;
    if (row.event_date) {
      const d = row.event_date instanceof Date ? row.event_date : new Date(row.event_date);
      if (!Number.isNaN(d.getTime())) year = d.getFullYear();
      else {
        const m = String(row.event_date).match(/^(\d{4})/);
        if (m) year = parseInt(m[1], 10);
      }
    }

    const amt =
      row.amount_cny != null && row.amount_cny !== '' && Number.isFinite(Number(row.amount_cny))
        ? Number(row.amount_cny)
        : null;

    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      let rec = map.get(name);
      if (!rec) {
        rec = { dealCount: 0, amountSum: 0, byYear: new Map() };
        map.set(name, rec);
      }
      rec.dealCount += 1;
      if (amt != null) rec.amountSum += amt;
      if (year != null && Number.isFinite(year)) {
        rec.byYear.set(year, (rec.byYear.get(year) || 0) + 1);
      }
    }
  }

  const sorted = [...map.entries()].sort((a, b) => {
    if (b[1].dealCount !== a[1].dealCount) return b[1].dealCount - a[1].dealCount;
    return a[0].localeCompare(b[0], 'zh-CN');
  });

  const top20 = sorted.slice(0, topN).map(([name, rec], idx) => ({
    rank: idx + 1,
    name,
    deal_count: rec.dealCount,
    share: windowEventCount > 0 ? Number((rec.dealCount / windowEventCount).toFixed(6)) : 0,
    amount_cny_sum: rec.amountSum > 0 ? Number(rec.amountSum.toFixed(2)) : null,
  }));

  const top10_yearly = sorted.slice(0, yearlyTopN).map(([name, rec]) => ({
    name,
    series: years.map((y) => ({
      year: y,
      deal_count: rec.byYear.get(y) || 0,
    })),
  }));

  return {
    top20,
    top10_yearly,
    top1: top20.length ? { name: top20[0].name, count: top20[0].deal_count } : { name: '', count: 0 },
  };
}

module.exports = {
  parseInvestorNames,
  extractInstitutionNames,
  aggregateInvestors,
  isBlankInvestorName,
  isCountableInstitution,
};
