const XLSX = require('xlsx');
const { toNumber, parseYmd, beijingYmd } = require('./marketUtils');
const { BS_INPUT_FIELDS, BS_INPUT_KEYS, BS_VISIBLE_FIELDS } = require('./targetBsFields');
const { impliedForecastDa } = require('./dcfForecast');

const PL_ALIASES = [
  { key: 'revenue', labels: ['营业收入', '营业总收入', '营收'] },
  { key: 'cogs', labels: ['营业成本', '成本'] },
  { key: 'selling', labels: ['销售费用'] },
  { key: 'admin', labels: ['管理费用'] },
  { key: 'rd', labels: ['研发费用'] },
  { key: 'finance_expense', labels: ['财务费用'] },
  { key: 'operating_profit', labels: ['营业利润', '经营利润'] },
  { key: 'net_income', labels: ['净利润'] },
];

const CF_ALIASES = [
  { key: 'da', labels: ['折旧摊销', '折旧及摊销', '加回折旧摊销'] },
  { key: 'capex', labels: ['资本性支出', '资本支出'] },
  { key: 'dnwc', labels: ['营运资本增加', '营运资金增加', '营运资金变动', '营运资本变动'] },
];

const BS_ALIASES = [
  ...BS_INPUT_FIELDS.map((f) => ({ key: f.key, labels: [f.label] })),
  { key: 'net_debt', labels: ['净负债'] },
];

const EXPENSE_KEYS = new Set(['cogs', 'selling', 'admin', 'rd', 'capex']);

function yearFromCell(v) {
  const m = String(v == null ? '' : v).match(/(20\d{2})/);
  return m ? m[1] : null;
}

function normLabel(v) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .replace(/^减去/, '')
    .replace(/^加回/, '')
    .replace(/（.*?）/g, '')
    .replace(/\(.*?\)/g, '');
}

function matchAlias(label, aliases) {
  const n = normLabel(label);
  if (!n) return null;
  let best = null;
  let bestLen = 0;
  for (const a of aliases) {
    for (const lb of a.labels) {
      const lbN = normLabel(lb);
      if (!lbN) continue;
      if (n === lbN || n.startsWith(lbN) || n.endsWith(lbN)) {
        if (lbN.length > bestLen) {
          best = a.key;
          bestLen = lbN.length;
        }
      }
    }
  }
  return best;
}

function findYearHeader(aoa) {
  let best = { row: -1, map: {} };
  const limit = Math.min(aoa.length, 16);
  for (let r = 0; r < limit; r += 1) {
    const map = {};
    (aoa[r] || []).forEach((cell, c) => {
      const y = yearFromCell(cell);
      if (y) map[c] = y;
    });
    if (Object.keys(map).length > Object.keys(best.map).length) best = { row: r, map };
  }
  return Object.keys(best.map).length ? best : null;
}

function absIfExpense(key, values, fcfSigned) {
  if (!EXPENSE_KEYS.has(key) || !values.length) return values;
  if (fcfSigned && key === 'capex') {
    return values.map((v) => (v == null ? v : Math.abs(v)));
  }
  const nums = values.filter((v) => v != null);
  const neg = nums.filter((v) => v < 0).length;
  if (nums.length && neg >= nums.length / 2) {
    return values.map((v) => (v == null ? v : Math.abs(v)));
  }
  return values;
}

function rowLabel(row) {
  const a = String(row?.[0] || '').trim();
  const b = String(row?.[1] || '').trim();
  if (a && matchAlias(a, [...PL_ALIASES, ...CF_ALIASES, ...BS_ALIASES])) return a;
  if (b && matchAlias(b, [...PL_ALIASES, ...CF_ALIASES, ...BS_ALIASES])) return b;
  return a || b;
}

function parseYearMatrix(aoa, aliases, opts = {}) {
  const header = findYearHeader(aoa);
  if (!header) return null;
  const years = [...new Set(Object.values(header.map))].sort();
  const colOf = {};
  Object.entries(header.map).forEach(([c, y]) => {
    if (colOf[y] == null) colOf[y] = Number(c);
  });
  const series = {};
  const fcfSigned = !!opts.fcfSigned;
  for (let r = header.row + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    const label = rowLabel(row);
    const key = matchAlias(label, aliases);
    if (!key || series[key]) continue;
    const values = years.map((y) => toNumber(row[colOf[y]]));
    if (key === 'dnwc' && fcfSigned) {
      series[key] = values.map((v) => (v == null ? v : -v));
    } else {
      series[key] = absIfExpense(key, values, fcfSigned);
    }
  }
  if (!Object.keys(series).length) return null;
  const keep = years.map((_, i) => Object.values(series).some((arr) => {
    const n = toNumber(arr?.[i]);
    return n != null && n !== 0;
  }));
  if (!keep.some(Boolean)) return { years, series };
  return {
    years: years.filter((_, i) => keep[i]),
    series: Object.fromEntries(Object.entries(series).map(([k, arr]) => [k, arr.filter((_, i) => keep[i])])),
  };
}

function parseBsTwoCol(aoa) {
  const out = {};
  for (const row of aoa || []) {
    let li = -1;
    for (let i = 0; i < (row || []).length; i += 1) {
      if (String(row[i] || '').trim()) {
        li = i;
        break;
      }
    }
    if (li < 0) continue;
    const key = matchAlias(row[li], BS_ALIASES);
    if (!key || out[key] != null) continue;
    let n = null;
    const end = Math.min(row.length, li + 3);
    for (let i = li + 1; i < end; i += 1) {
      const v = toNumber(row[i]);
      if (v != null) {
        n = v;
        break;
      }
    }
    if (n == null) {
      if (key !== 'net_debt') out[key] = 0;
      continue;
    }
    out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function sheetRole(name) {
  const s = String(name || '');
  if (/说明/.test(s)) return 'help';
  if (/锚定/.test(s)) return 'anchor';
  if (/当期/.test(s)) return 'currentPl';
  if (/预测/.test(s)) return 'forecast';
  if (/资产负债|balance|\bbs\b/i.test(s)) return 'bs';
  if (/现金|capex|\bcf\b/i.test(s) && !/dcf/i.test(s)) return 'cf';
  if (/dcf/i.test(s)) return 'dcf';
  if (/利润|income|\bpl\b/i.test(s)) return 'pl';
  return 'unknown';
}

const FORECAST_ROW_ALIASES = [
  { key: 'revenue_growth', labels: ['收入增速', '营收增速', '收入增长率'], percent: true },
  { key: 'cogs_ratio', labels: ['营业成本'], percent: true },
  { key: 'surtax_ratio', labels: ['税金及附加'], percent: true },
  { key: 'selling_ratio', labels: ['销售费用'], percent: true },
  { key: 'admin_ratio', labels: ['管理费用'], percent: true },
  { key: 'rd_ratio', labels: ['研发费用'], percent: true },
  { key: 'finance_expense_ratio', labels: ['财务费用'], percent: true },
  { key: 'other_income_ratio', labels: ['其他收益'], percent: true },
  { key: 'other_ratio', labels: ['其他'], percent: true },
  { key: 'da_ratio', labels: ['折旧摊销'], percent: true },
  { key: 'capex_ratio', labels: ['资本开支', '资本性支出'], percent: true },
  { key: 'dso', labels: ['DSO', '应收账款周转天数'], percent: false },
  { key: 'dpo', labels: ['DPO', '应付账款周转天数'], percent: false },
  { key: 'dio', labels: ['存货周转天数', 'DIO'], percent: false },
];

/** 空白不按 0：增速沿用已填值，资本开支未填不计算，周转天数空着用可比中位数。 */
const FORECAST_BLANK_KEEPS_LOGIC = new Set(['revenue_growth', 'capex_ratio', 'dso', 'dpo', 'dio']);

function anchorFromBeijingMonth(y, m) {
  if (m <= 4) return `${y - 1}-12-31`;
  if (m <= 7) return `${y}-03-31`;
  if (m <= 10) return `${y}-06-30`;
  return `${y}-09-30`;
}

/** 未选锚定日时按北京时间的月份预填报表日。1–4 月上年 12-31，5–7 月当年 3-31，8–10 月当年 6-30，11–12 月当年 9-30。无效时点回退到今天（北京）。 */
function suggestAnchorYmd(now = new Date()) {
  const ymd = parseYmd(now) || beijingYmd();
  let y = Number(ymd.slice(0, 4));
  let m = Number(ymd.slice(5, 7));
  if (!Number.isFinite(y) || m < 1 || m > 12) {
    const today = beijingYmd();
    y = Number(today.slice(0, 4));
    m = Number(today.slice(5, 7));
  }
  return anchorFromBeijingMonth(y, m);
}

function colLettersToIndex(letters) {
  let n = 0;
  const s = String(letters || '').toUpperCase();
  for (let i = 0; i < s.length; i += 1) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function formulaNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v == null || v === '' || v instanceof Date) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 只算四则、单元格引用和 SUM。跨表公式或算不出时返回 null。 */
function evalFormula(formula, get) {
  let expr = String(formula || '').trim();
  if (expr.startsWith('=')) expr = expr.slice(1);
  expr = expr.replace(/\$/g, '').replace(/\s+/g, '');
  if (!expr || /!/.test(expr)) return null;
  let i = 0;
  const peek = () => expr[i];
  function parseAdd() {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = expr[i];
      i += 1;
      const right = parseMul();
      if (left == null || right == null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const op = expr[i];
      i += 1;
      const right = parseUnary();
      if (left == null || right == null || (op === '/' && right === 0)) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parseUnary() {
    if (peek() === '+') { i += 1; return parseUnary(); }
    if (peek() === '-') {
      i += 1;
      const v = parseUnary();
      return v == null ? null : -v;
    }
    return parsePrimary();
  }
  function parsePrimary() {
    if (peek() === '(') {
      i += 1;
      const v = parseAdd();
      if (peek() === ')') i += 1;
      return v;
    }
    const rest = expr.slice(i);
    const sum = rest.match(/^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/i);
    if (sum) {
      i += sum[0].length;
      const c1 = colLettersToIndex(sum[1]);
      const r1 = Number(sum[2]) - 1;
      const c2 = colLettersToIndex(sum[3]);
      const r2 = Number(sum[4]) - 1;
      let total = 0;
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) {
          total += formulaNumber(get(r, c)) || 0;
        }
      }
      return total;
    }
    const ref = rest.match(/^([A-Z]+)(\d+)/i);
    if (ref) {
      i += ref[0].length;
      return formulaNumber(get(Number(ref[2]) - 1, colLettersToIndex(ref[1])));
    }
    const num = rest.match(/^\d+(\.\d+)?%?/);
    if (num) {
      i += num[0].length;
      const raw = num[0].endsWith('%') ? Number(num[0].slice(0, -1)) / 100 : Number(num[0]);
      return Number.isFinite(raw) ? raw : null;
    }
    return null;
  }
  const result = parseAdd();
  if (i !== expr.length || result == null || !Number.isFinite(result)) return null;
  return result;
}

function sheetToCalculatedAoa(ws) {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cache = new Map();
  const visiting = new Set();
  function valueAt(r, c) {
    if (r < range.s.r || c < range.s.c || r > range.e.r || c > range.e.c) return null;
    const addr = XLSX.utils.encode_cell({ r, c });
    if (cache.has(addr)) return cache.get(addr);
    if (visiting.has(addr)) return null;
    visiting.add(addr);
    const cell = ws[addr];
    let out = null;
    if (cell) {
      const text = typeof cell.v === 'string' ? cell.v.trim() : '';
      const cached = cell.v != null && cell.v !== '' && !text.startsWith('=');
      if (cached) out = cell.v;
      else if (cell.f) out = evalFormula(cell.f, valueAt);
      else if (text.startsWith('=')) out = evalFormula(text, valueAt);
    }
    visiting.delete(addr);
    cache.set(addr, out);
    return out;
  }
  const aoa = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const v = valueAt(r, c);
      row.push(v == null ? '' : v);
    }
    aoa.push(row);
  }
  return aoa;
}

function formatCellDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date || (typeof v === 'string' && /T\d{2}:|[zZ]|[+-]\d{2}:?\d{2}$/.test(v))) {
    return parseYmd(v);
  }
  const s = String(v).trim();
  const wall = parseYmd(s);
  if (wall && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/.test(s)) return wall;
  const m = s.match(/(20\d{2})\D(\d{1,2})\D(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return null;
}

/** 模板里比例按百分数填写，10 表示 10%。已带 % 或绝对值大于 1 时除以 100。 */
function percentToRatio(raw) {
  if (raw == null || raw === '') return null;
  const text = String(raw).trim();
  const marked = text.endsWith('%');
  const n = toNumber(marked ? text.slice(0, -1) : raw);
  if (n == null) return null;
  if (marked || Math.abs(n) > 1) return n / 100;
  return n;
}

function parseAnchorSheet(aoa) {
  const out = {};
  for (const row of aoa || []) {
    const label = normLabel(row?.[0]);
    if (!label) continue;
    const raw = row[1];
    if (/估值锚定日|锚定日/.test(label)) {
      const ymd = formatCellDate(raw);
      if (ymd) out.valuation_date = ymd;
    } else if (/所得税/.test(label)) {
      const rate = percentToRatio(raw);
      if (rate != null) out.tax_rate = rate;
    } else if (/市场法营业收入|市场营业收入/.test(label)) {
      const n = toNumber(raw);
      if (n != null) out.market_revenue = n;
    } else if (/市场法净利润|市场净利润/.test(label)) {
      const n = toNumber(raw);
      if (n != null) out.market_net_income = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

function parseForecastSheet(aoa) {
  const header = findYearHeader(aoa);
  if (!header) return null;
  const years = [...new Set(Object.values(header.map))].sort();
  const colOf = {};
  Object.entries(header.map).forEach(([c, y]) => {
    if (colOf[y] == null) colOf[y] = Number(c);
  });
  const series = { years };
  for (let r = header.row + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    const label = String(row[0] || row[1] || '').trim();
    const key = matchAlias(label, FORECAST_ROW_ALIASES);
    if (!key || series[key]) continue;
    const spec = FORECAST_ROW_ALIASES.find((a) => a.key === key);
    series[key] = years.map((y) => {
      const raw = row[colOf[y]];
      if (raw == null || raw === '') return FORECAST_BLANK_KEEPS_LOGIC.has(key) ? null : 0;
      const n = spec.percent ? percentToRatio(raw) : toNumber(raw);
      if (n == null) return FORECAST_BLANK_KEEPS_LOGIC.has(key) ? null : 0;
      return n;
    });
  }
  return series;
}

function mergeYearSeries(a, b, keys) {
  if (!a) return b;
  if (!b) return a;
  const years = [...new Set([...(a.years || []), ...(b.years || [])])].sort();
  const pick = (src, key, y) => {
    const i = (src.years || []).indexOf(y);
    return i >= 0 ? src[key]?.[i] : null;
  };
  const out = { years };
  for (const key of keys) {
    const arr = years.map((y) => {
      const va = pick(a, key, y);
      const vb = pick(b, key, y);
      return va != null ? va : vb;
    });
    if (arr.some((v) => v != null)) out[key] = arr;
  }
  return out;
}

function applyBs(target, parsed) {
  if (!parsed) return target;
  const next = { ...(target || {}) };
  for (const k of BS_INPUT_KEYS) {
    if (parsed[k] != null) next[k] = parsed[k];
  }
  if (parsed.net_debt != null && parsed.cash == null && parsed.short_term_loan == null) {
    if (parsed.net_debt >= 0) {
      next.cash = 0;
      next.short_term_loan = parsed.net_debt;
      next.long_term_loan = next.long_term_loan ?? 0;
    } else {
      next.cash = -parsed.net_debt;
      next.short_term_loan = 0;
      next.long_term_loan = 0;
    }
  }
  return next;
}

function parseTargetFinancialWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true });
  const warnings = [];
  const used = [];
  let targetPl = null;
  let targetBs = null;
  let targetBsSeries = null;
  let targetCf = null;
  let assumptions = null;
  let forecast = null;

  for (const name of wb.SheetNames) {
    const aoa = sheetToCalculatedAoa(wb.Sheets[name]);
    const kind = sheetRole(name);
    if (kind === 'help') continue;
    if (kind === 'anchor') {
      const found = parseAnchorSheet(aoa);
      if (found) {
        assumptions = { ...(assumptions || {}), ...found };
        used.push(name);
      }
      continue;
    }
    if (kind === 'forecast') {
      const found = parseForecastSheet(aoa);
      if (found?.years?.length) {
        forecast = found;
        used.push(name);
      }
      continue;
    }
    if (kind === 'unknown' && /结果对比|相对估值|三费|毛利|营运|市场法/.test(name)) continue;

    if (kind === 'bs' || kind === 'dcf' || kind === 'unknown') {
      const bs = parseBsTwoCol(aoa) || parseYearMatrix(aoa, BS_ALIASES);
      if (bs && !bs.years) {
        targetBs = applyBs(targetBs, bs);
        used.push(name);
      } else if (bs?.years && bs.series) {
        const seriesKeys = [...new Set([
          ...Object.keys(targetBsSeries || {}).filter((k) => k !== 'years'),
          ...Object.keys(bs.series),
        ])];
        targetBsSeries = mergeYearSeries(
          targetBsSeries,
          { years: bs.years, ...bs.series },
          seriesKeys,
        );
        used.push(name);
      }
    }

      const plMatrix = (kind === 'pl' || kind === 'currentPl' || kind === 'dcf' || kind === 'unknown')
      ? parseYearMatrix(aoa, PL_ALIASES)
      : null;
    if (plMatrix && (plMatrix.series.revenue || plMatrix.series.net_income || plMatrix.series.operating_profit)) {
      const pl = { years: plMatrix.years };
      for (const { key } of PL_ALIASES) {
        if (plMatrix.series[key]) pl[key] = plMatrix.series[key];
      }
      targetPl = mergeYearSeries(targetPl, pl, PL_ALIASES.map((x) => x.key));
      used.push(name);
    }

    const cfMatrix = (kind === 'cf' || kind === 'dcf' || kind === 'unknown')
      ? parseYearMatrix(aoa, CF_ALIASES, { fcfSigned: kind === 'dcf' })
      : null;
    if (cfMatrix && (cfMatrix.series.da || cfMatrix.series.capex || cfMatrix.series.dnwc)) {
      const cf = {
        years: cfMatrix.years,
        da: cfMatrix.series.da || [],
        capex: cfMatrix.series.capex || [],
        dnwc: cfMatrix.series.dnwc || [],
      };
      targetCf = mergeYearSeries(targetCf, cf, ['da', 'capex', 'dnwc']);
      used.push(name);
    }
  }

  if (!targetPl && !targetBs && !targetCf && !forecast && !assumptions?.valuation_date) {
    warnings.push('未识别到锚定日、当期利润表、预测或资产负债表，请用模板并保持科目名称不变');
  }

  const amountUnit = detectWorkbookAmountUnit(wb);
  if (amountUnit === 'wan') scaleImportedWanToYuan({ targetPl, targetBs, targetBsSeries, targetCf, assumptions });

  const overrides = {};
  if (targetCf) {
    const last = (arr) => {
      const nums = (arr || []).map(toNumber).filter((n) => n != null);
      return nums.length ? nums[nums.length - 1] : 0;
    };
    overrides.da = last(targetCf.da);
    overrides.capex = last(targetCf.capex);
    overrides.dnwc = last(targetCf.dnwc);
  }

  return {
    targetPl,
    targetBs,
    targetBsSeries,
    targetCf,
    assumptions,
    forecast,
    overrides: Object.keys(overrides).length ? overrides : null,
    warnings,
    sheets: [...new Set(used)],
  };
}

const PL_AMOUNT_KEYS = ['revenue', 'cogs', 'selling', 'admin', 'rd', 'finance_expense', 'operating_profit', 'net_income'];
const YUAN_PER_WAN = 10000;

function detectWorkbookAmountUnit(wb) {
  let yuan = false;
  let wan = false;
  for (const name of wb.SheetNames || []) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const blob = (sheetRole(name) === 'help' ? aoa : aoa.slice(0, 2)).flat().join('\n');
    if (/金额（元）|金额单位为元/.test(blob)) yuan = true;
    if (/金额（万元）|金额单位为万元/.test(blob)) wan = true;
  }
  if (wan && !yuan) return 'wan';
  return 'yuan';
}

function yuanFromWanNumber(v) {
  if (v == null || v === '') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n * YUAN_PER_WAN : v;
}

function scaleImportedWanToYuan(parsed) {
  const mulArr = (arr) => (Array.isArray(arr) ? arr.map(yuanFromWanNumber) : arr);
  if (parsed.assumptions) {
    parsed.assumptions.market_revenue = yuanFromWanNumber(parsed.assumptions.market_revenue);
    parsed.assumptions.market_net_income = yuanFromWanNumber(parsed.assumptions.market_net_income);
  }
  if (parsed.targetPl) {
    for (const key of PL_AMOUNT_KEYS) parsed.targetPl[key] = mulArr(parsed.targetPl[key]);
  }
  const bsKeys = [...BS_INPUT_KEYS, 'net_debt'];
  if (parsed.targetBs) {
    for (const key of bsKeys) parsed.targetBs[key] = yuanFromWanNumber(parsed.targetBs[key]);
  }
  if (parsed.targetBsSeries) {
    for (const key of bsKeys) parsed.targetBsSeries[key] = mulArr(parsed.targetBsSeries[key]);
  }
  if (parsed.targetCf) {
    for (const key of ['da', 'capex', 'dnwc']) parsed.targetCf[key] = mulArr(parsed.targetCf[key]);
  }
}

function yearNum(y) {
  const m = String(y == null ? '' : y).match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

function pickYearIndex(years, prefer) {
  const list = years || [];
  if (prefer) {
    const hit = list.findIndex((y) => yearNum(y) === prefer);
    if (hit >= 0) return hit;
  }
  let best = -1;
  let bestY = -1;
  list.forEach((y, i) => {
    const n = yearNum(y);
    if (n != null && n >= bestY) {
      best = i;
      bestY = n;
    }
  });
  return best;
}

function shiftArrays(pl, keys) {
  const next = { ...pl };
  for (const key of keys) {
    if (Array.isArray(next[key])) next[key] = [null, ...next[key]];
  }
  return next;
}

const PL_LINE_KEYS = [
  ...PL_AMOUNT_KEYS,
  'gross_profit', 'revenue_growth',
  'cogs_ratio', 'surtax_ratio', 'selling_ratio', 'admin_ratio', 'rd_ratio', 'finance_expense_ratio',
  'other_income_ratio', 'other_ratio', 'da_ratio', 'capex_ratio',
  'dso', 'dpo', 'dio',
];

function insertPlYear(pl, yearLabel) {
  const years = [...(pl.years || [])].map((y) => String(y));
  const n = yearNum(yearLabel);
  if (n == null || years.some((y) => yearNum(y) === n)) return { ...pl, years };
  let at = years.findIndex((y) => (yearNum(y) ?? 9999) > n);
  if (at < 0) at = years.length;
  years.splice(at, 0, String(n));
  const next = { ...pl, years };
  for (const key of PL_LINE_KEYS) {
    if (!Array.isArray(next[key])) continue;
    const arr = [...next[key]];
    arr.splice(at, 0, null);
    next[key] = arr;
  }
  return next;
}

function mergeForecastIntoPl(pl, forecast) {
  let next = { ...(pl || {}) };
  for (const y of forecast.years || []) next = insertPlYear(next, y);
  const years = next.years || [];
  for (const spec of FORECAST_ROW_ALIASES) {
    const src = forecast[spec.key];
    const zeroBlank = !FORECAST_BLANK_KEEPS_LOGIC.has(spec.key);
    if (!Array.isArray(src) && !zeroBlank) continue;
    const arr = Array.isArray(next[spec.key]) ? [...next[spec.key]] : [];
    forecast.years.forEach((y, i) => {
      const value = Array.isArray(src) ? src[i] : null;
      if (value == null && !zeroBlank) return;
      const dest = years.findIndex((oy) => yearNum(oy) === yearNum(y));
      if (dest >= 0) arr[dest] = value == null ? 0 : value;
    });
    next[spec.key] = arr;
  }
  return next;
}

function seedDaIntoCashflow(targetCf, pl, assumptions) {
  const implied = impliedForecastDa(pl, assumptions);
  const cf = { ...(targetCf || {}) };
  if (!implied) return { cf: targetCf || null, actualDa: null };
  const years = Array.isArray(cf.years) ? cf.years.map((y) => String(y)) : [];
  const da = Array.isArray(cf.da) ? [...cf.da] : [];
  implied.years.forEach((y, i) => {
    if (implied.da[i] == null) return;
    let dest = years.findIndex((oy) => yearNum(oy) === yearNum(y));
    if (dest < 0) {
      years.push(String(yearNum(y)));
      dest = years.length - 1;
    }
    if (da[dest] == null || da[dest] === '') da[dest] = implied.da[i];
  });
  return {
    cf: { ...cf, years, da, capex: cf.capex || [], dnwc: cf.dnwc || [] },
    actualDa: implied.actualDa,
  };
}

function mergeTargetFinancials(payload, parsed) {
  const next = { ...(payload || {}), amount_unit: 'yuan' };
  const assumptions = { ...(next.assumptions || {}) };
  if (parsed.assumptions?.valuation_date) assumptions.valuation_date = parsed.assumptions.valuation_date;
  if (parsed.assumptions?.tax_rate != null) assumptions.tax_rate = parsed.assumptions.tax_rate;
  if (parsed.assumptions?.market_revenue != null) assumptions.market_revenue = parsed.assumptions.market_revenue;
  if (parsed.assumptions?.market_net_income != null) assumptions.market_net_income = parsed.assumptions.market_net_income;
  next.assumptions = assumptions;
  const prefer = yearNum(assumptions.valuation_date);
  if (parsed.targetPl?.years?.length) {
    const src = parsed.targetPl;
    const srcI = pickYearIndex(src.years, prefer);
    const srcYear = yearNum(src.years[srcI]);
    let pl = { ...(next.targetPl || {}) };
    let years = [...(pl.years || [])].map((y) => String(y));
    let dest = srcYear == null ? -1 : years.findIndex((y) => yearNum(y) === srcYear);
    if (dest < 0 && srcYear != null) {
      years = [String(srcYear), ...years];
      pl = shiftArrays(pl, [
        ...PL_AMOUNT_KEYS,
        'gross_profit', 'revenue_growth',
        'cogs_ratio', 'surtax_ratio', 'selling_ratio', 'admin_ratio', 'rd_ratio', 'finance_expense_ratio',
        'other_income_ratio', 'other_ratio', 'da_ratio', 'capex_ratio',
        'dso', 'dpo', 'dio',
      ]);
      dest = 0;
    }
    pl.years = years;
    for (const key of PL_AMOUNT_KEYS) {
      const arr = Array.isArray(pl[key]) ? [...pl[key]] : [];
      const value = src[key]?.[srcI];
      arr[dest] = value == null ? 0 : value;
      pl[key] = arr;
    }
    const priorYear = prefer == null ? null : prefer - 1;
    const priorI = priorYear == null ? -1 : (src.years || []).findIndex((y) => yearNum(y) === priorYear);
    if (priorI >= 0) {
      pl = insertPlYear(pl, priorYear);
      const priorDest = (pl.years || []).findIndex((y) => yearNum(y) === priorYear);
      for (const key of PL_AMOUNT_KEYS) {
        const arr = Array.isArray(pl[key]) ? [...pl[key]] : [];
        const value = src[key]?.[priorI];
        arr[priorDest] = value == null ? 0 : value;
        pl[key] = arr;
      }
    }
    next.targetPl = pl;
    const revenue = src.revenue?.[srcI];
    const netIncome = src.net_income?.[srcI];
    const assumptions = { ...(next.assumptions || {}) };
    if ((assumptions.ytd_revenue == null || assumptions.ytd_revenue === '') && revenue != null) {
      assumptions.ytd_revenue = revenue;
    }
    if ((assumptions.market_revenue == null || assumptions.market_revenue === '') && revenue != null) {
      assumptions.market_revenue = revenue;
    }
    if ((assumptions.market_net_income == null || assumptions.market_net_income === '') && netIncome != null) {
      assumptions.market_net_income = netIncome;
    }
    next.assumptions = assumptions;
  }
  let importedBs = parsed.targetBs || null;
  if (parsed.targetBsSeries?.years?.length) {
    const srcI = pickYearIndex(parsed.targetBsSeries.years, prefer);
    const snap = {};
    for (const key of BS_INPUT_KEYS) {
      const value = parsed.targetBsSeries[key]?.[srcI];
      if (value != null) snap[key] = value;
    }
    importedBs = { ...(importedBs || {}), ...snap };
  }
  if (importedBs && Object.keys(importedBs).length) {
    next.targetBs = { ...(next.targetBs || {}), ...importedBs };
    next.overrides = { ...(next.overrides || {}), net_debt: null };
  }
  if (parsed.forecast?.years?.length) next.targetPl = mergeForecastIntoPl(next.targetPl, parsed.forecast);
  if (parsed.targetCf?.years?.length) next.targetCf = parsed.targetCf;
  else {
    const seeded = seedDaIntoCashflow(next.targetCf, next.targetPl, next.assumptions);
    if (seeded.cf?.years?.length) next.targetCf = seeded.cf;
    if ((next.overrides?.da == null || next.overrides?.da === '') && seeded.actualDa != null) {
      next.overrides = { ...(next.overrides || {}), da: seeded.actualDa };
    }
  }
  if (parsed.overrides) {
    next.overrides = { ...(next.overrides || {}), ...parsed.overrides, net_debt: next.overrides?.net_debt ?? null };
  }
  return next;
}

const NAME_COL_WCH = 28;
const NOTE_COL_WCH_BASE = 52;
const NOTE_COL_WCH = NOTE_COL_WCH_BASE * 1.5;
const FILL_COL_WCH = 12;
const HEADER_ROW_HPT = 22 * 3;

function displayWidth(text) {
  return [...String(text || '')].reduce((n, ch) => n + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0);
}

function noteRowHeight(text, colWch = NOTE_COL_WCH, cap = 110) {
  const lines = String(text || '').split('\n');
  const wrapped = lines.reduce((n, line) => n + Math.max(1, Math.ceil(displayWidth(line) / Math.max(8, colWch - 2))), 0);
  return Math.min(cap, 18 + wrapped * 16);
}

function wrapNoteSheet(ws, noteCol = 1, noteWch = NOTE_COL_WCH) {
  if (!ws['!ref']) return ws;
  const range = XLSX.utils.decode_range(ws['!ref']);
  ws['!cols'] = ws['!cols'] || [];
  ws['!cols'][0] = { wch: NAME_COL_WCH };
  ws['!cols'][noteCol] = { wch: noteWch };
  for (let c = noteCol + 1; c <= range.e.c; c += 1) {
    ws['!cols'][c] = ws['!cols'][c] || { wch: FILL_COL_WCH };
  }
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const note = ws[XLSX.utils.encode_cell({ r, c: noteCol })];
    const name = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const label = String(name?.v || '');
    let hpt = noteRowHeight(note?.v, noteWch);
    if (r === range.s.r && (label === '科目' || label === '项目')) hpt = HEADER_ROW_HPT;
    if (r === range.s.r && label === '填写说明') hpt = Math.min(420, noteRowHeight(note?.v, noteWch, 10000) * 3);
    rows[r] = { hpt };
  }
  ws['!rows'] = rows;
  return ws;
}

function sheetFromAoa(aoa, noteCol = 1, noteWch = NOTE_COL_WCH, widthOverrides = null) {
  const ws = wrapNoteSheet(XLSX.utils.aoa_to_sheet(aoa), noteCol, noteWch);
  if (widthOverrides) {
    ws['!cols'] = ws['!cols'] || [];
    for (const [idx, wch] of Object.entries(widthOverrides)) ws['!cols'][Number(idx)] = { wch };
  }
  return ws;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unzipXlsx(buf) {
  const files = {};
  let i = 0;
  while (i + 30 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) break;
    const flags = buf.readUInt16LE(i + 6);
    const method = buf.readUInt16LE(i + 8);
    let comp = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const dataStart = i + 30 + nlen + elen;
    if (flags & 8) {
      throw new Error('xlsx zip data descriptor not supported');
    }
    const compressed = buf.slice(dataStart, dataStart + comp);
    files[name] = method === 0
      ? compressed
      : require('zlib').inflateRawSync(compressed);
    i = dataStart + comp;
  }
  return files;
}

function zipXlsx(files) {
  const zlib = require('zlib');
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const n = Object.keys(files).length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colLetters(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetBounds(xml) {
  const ref = (xml.match(/<dimension ref="([^"]+)"/) || [])[1] || 'A1';
  const span = ref.split(':');
  const end = span[span.length - 1];
  const m = end.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { maxCol: 0, maxRow: 1 };
  return { maxCol: colIndex(m[1]), maxRow: Number(m[2]) };
}

function inputCellsForSheet(sheetNo, maxCol, maxRow) {
  const nums = [];
  const texts = [];
  const pushCols = (fromCol, toCol, startRow, bucket) => {
    for (let r = startRow; r <= maxRow; r += 1) {
      for (let c = fromCol; c <= toCol; c += 1) bucket.push(`${colLetters(c)}${r}`);
    }
  };
  if (sheetNo === 2) {
    texts.push('B2');
    pushCols(1, 1, 3, nums);
  } else if (sheetNo === 3 || sheetNo === 4) {
    pushCols(2, Math.max(2, maxCol), 2, nums);
  } else if (sheetNo === 5) {
    pushCols(2, 2, 2, nums);
  }
  return { nums, texts };
}

function setCellStyle(xml, ref, styleIdx, numeric) {
  const full = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  if (full.test(xml)) {
    return xml.replace(full, (_, attrs, inner) => {
      if (numeric) {
        const value = inner && (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (value == null || String(value).trim() === '') return `<c r="${ref}" s="${styleIdx}"/>`;
        if (/^-?\d+(?:\.\d+)?$/.test(String(value).trim())) {
          return `<c r="${ref}" s="${styleIdx}"><v>${String(value).trim()}</v></c>`;
        }
      }
      const next = attrs.replace(/\ss="\d+"/, '');
      if (inner == null) return `<c r="${ref}" s="${styleIdx}"${next.replace(/\s*\/$/, '')}/>`;
      return `<c r="${ref}" s="${styleIdx}"${next}>${inner}</c>`;
    });
  }
  const rowNo = ref.match(/\d+/)[0];
  const row = new RegExp(`(<row r="${rowNo}"[^>]*>)([\\s\\S]*?)(</row>)`);
  if (row.test(xml)) {
    return xml.replace(row, (_, start, inner, end) => `${start}${inner}<c r="${ref}" s="${styleIdx}"/>${end}`);
  }
  return xml.replace('</sheetData>', `<row r="${rowNo}"><c r="${ref}" s="${styleIdx}"/></row></sheetData>`);
}

function bumpStyleList(xml, tag, extras) {
  const re = new RegExp(`<${tag} count="(\\d+)">([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  if (!m) throw new Error(`styles missing ${tag}`);
  const start = Number(m[1]);
  return {
    xml: xml.replace(re, `<${tag} count="${start + extras.length}">${m[2]}${extras.join('')}</${tag}>`),
    start,
  };
}

function templateStyleIndexes(stylesXml) {
  const border = '<border><left style="thin"><color rgb="FF8FA4B8"/></left><right style="thin"><color rgb="FF8FA4B8"/></right><top style="thin"><color rgb="FF8FA4B8"/></top><bottom style="thin"><color rgb="FF8FA4B8"/></bottom><diagonal/></border>';
  const fonts = bumpStyleList(stylesXml, 'fonts', [
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="11"/><color rgb="FF1F4E79"/><name val="Calibri"/><family val="2"/></font>',
    '<font><sz val="11"/><color rgb="FF1F2933"/><name val="Calibri"/><family val="2"/></font>',
  ]);
  const fills = bumpStyleList(fonts.xml, 'fills', [
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD6E3F0"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF3F8"/><bgColor indexed="64"/></patternFill></fill>',
  ]);
  const borders = bumpStyleList(fills.xml, 'borders', [border]);
  const bodyFont = fonts.start + 2;
  const headerFont = fonts.start;
  const labelFont = fonts.start + 1;
  const navy = fills.start;
  const ice = fills.start + 1;
  const pale = fills.start + 2;
  const borderId = borders.start;
  const xfs = [
    `<xf numFmtId="0" fontId="${bodyFont}" fillId="0" borderId="${borderId}" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="left"/></xf>`,
    `<xf numFmtId="4" fontId="${bodyFont}" fillId="0" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>`,
    `<xf numFmtId="0" fontId="${bodyFont}" fillId="0" borderId="${borderId}" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>`,
    `<xf numFmtId="0" fontId="${headerFont}" fillId="${navy}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>`,
    `<xf numFmtId="0" fontId="${labelFont}" fillId="${ice}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="left"/></xf>`,
    `<xf numFmtId="4" fontId="${bodyFont}" fillId="${pale}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>`,
    `<xf numFmtId="0" fontId="${labelFont}" fillId="0" borderId="${borderId}" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>`,
  ];
  const cellXfs = bumpStyleList(borders.xml, 'cellXfs', xfs);
  return {
    xml: cellXfs.xml,
    note: cellXfs.start,
    inputNum: cellXfs.start + 1,
    inputText: cellXfs.start + 2,
    header: cellXfs.start + 3,
    label: cellXfs.start + 4,
    checkNum: cellXfs.start + 5,
    checkText: cellXfs.start + 6,
  };
}

function cellExists(xml, ref) {
  return new RegExp(`<c r="${ref}"[\\s>]`).test(xml);
}

function applyWrapTextToXlsx(buffer) {
  const files = unzipXlsx(buffer);
  const theme = templateStyleIndexes(files['xl/styles.xml'].toString('utf8'));
  files['xl/styles.xml'] = Buffer.from(theme.xml, 'utf8');
  for (const name of Object.keys(files)) {
    if (!name.startsWith('xl/worksheets/sheet') || !name.endsWith('.xml')) continue;
    const sheetNo = Number((name.match(/sheet(\d+)\.xml$/) || [])[1] || 0);
    let xml = files[name].toString('utf8');
    const { maxCol, maxRow } = sheetBounds(xml);
    const noteCol = sheetNo === 2 ? 2 : 1;
    for (let c = 0; c <= maxCol; c += 1) {
      if (sheetNo === 5 && c === 3) continue;
      if (sheetNo === 1 && c !== 0) continue;
      const ref = `${colLetters(c)}1`;
      if (!cellExists(xml, ref)) continue;
      xml = setCellStyle(xml, ref, theme.header, false);
    }
    for (let r = 2; r <= maxRow; r += 1) {
      const labelRef = `A${r}`;
      if (cellExists(xml, labelRef)) xml = setCellStyle(xml, labelRef, theme.label, false);
      const noteRef = `${colLetters(noteCol)}${r}`;
      if (sheetNo !== 1 && cellExists(xml, noteRef)) xml = setCellStyle(xml, noteRef, theme.note, false);
    }
    if (sheetNo === 1 && cellExists(xml, 'B1')) xml = setCellStyle(xml, 'B1', theme.note, false);
    const { nums, texts } = inputCellsForSheet(sheetNo, maxCol, maxRow);
    for (const ref of texts) xml = setCellStyle(xml, ref, theme.inputText, false);
    for (const ref of nums) xml = setCellStyle(xml, ref, theme.inputNum, true);
    if (sheetNo === 5) {
      for (let r = 2; r <= 11; r += 1) {
        if (cellExists(xml, `E${r}`)) xml = setCellStyle(xml, `E${r}`, theme.label, false);
        if (cellExists(xml, `G${r}`)) xml = setCellStyle(xml, `G${r}`, theme.note, false);
        if (r === 11 && cellExists(xml, 'F11')) xml = setCellStyle(xml, 'F11', theme.checkText, false);
        else if (cellExists(xml, `F${r}`)) xml = setCellStyle(xml, `F${r}`, theme.checkNum, false);
      }
    }
    files[name] = Buffer.from(xml, 'utf8');
  }
  return zipXlsx(files);
}

function cellOrEmpty(v) {
  return v == null || v === '' ? '' : v;
}

function putCell(ws, r, c, cell) {
  const addr = XLSX.utils.encode_cell({ r, c });
  ws[addr] = cell;
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  if (r > range.e.r) range.e.r = r;
  if (c > range.e.c) range.e.c = c;
  if (r < range.s.r) range.s.r = r;
  if (c < range.s.c) range.s.c = c;
  ws['!ref'] = XLSX.utils.encode_range(range);
}

function bsGroupSpan(group) {
  const rows = BS_VISIBLE_FIELDS.map((f, i) => (f.group === group ? i + 2 : 0)).filter(Boolean);
  if (!rows.length) return null;
  return { start: rows[0], end: rows[rows.length - 1] };
}

function appendBsCheck(ws, bs) {
  const spanSum = (group) => {
    const span = bsGroupSpan(group);
    return span ? `SUM(C${span.start}:C${span.end})` : '0';
  };
  const groupYuan = (group) => BS_VISIBLE_FIELDS.reduce((sum, f) => {
    if (f.group !== group) return sum;
    const n = Number(bs?.[f.key]);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const round2 = (n) => Math.round(n * 100) / 100;
  const ca = round2(groupYuan('current_assets'));
  const nca = round2(groupYuan('noncurrent_assets'));
  const cl = round2(groupYuan('current_liab'));
  const ncl = round2(groupYuan('noncurrent_liab'));
  const eq = round2(groupYuan('equity'));
  const assets = round2(ca + nca);
  const liab = round2(cl + ncl);
  const liabEq = round2(liab + eq);
  const gap = round2(assets - liabEq);
  const rows = [
    ['校验项', '金额（元）', '核对说明'],
    ['流动资产合计', spanSum('current_assets'), ca, '货币资金到其他流动资产'],
    ['非流动资产合计', spanSum('noncurrent_assets'), nca, '债权投资到其他非流动资产'],
    ['资产总计', 'F2+F3', assets, '流动资产合计 + 非流动资产合计'],
    ['流动负债合计', spanSum('current_liab'), cl, '短期借款到其他流动负债'],
    ['非流动负债合计', spanSum('noncurrent_liab'), ncl, '长期借款到递延所得税负债'],
    ['负债总计', 'F5+F6', liab, '流动负债合计 + 非流动负债合计'],
    ['权益合计', spanSum('equity'), eq, '实收资本 + 资本公积 + 盈余公积 + 未分配利润'],
    ['负债加权益', 'F7+F8', liabEq, '负债总计 + 权益合计'],
    ['配平差额', 'F4-F9', gap, '资产总计 − 负债加权益。0 为配平'],
    ['配平结果', 'IF(ABS(F10)<100,"已配平","未配平")', Math.abs(gap) < 100 ? '已配平' : '未配平', '差额绝对值小于 100 元视为已配平'],
  ];
  rows.forEach((row, i) => {
    putCell(ws, i, 4, { t: 's', v: row[0] });
    if (i === 0) {
      putCell(ws, i, 5, { t: 's', v: row[1] });
    } else if (i === rows.length - 1) {
      putCell(ws, i, 5, { t: 's', f: row[1], v: row[2] });
    } else {
      putCell(ws, i, 5, { t: 'n', f: row[1], v: row[2] });
    }
    putCell(ws, i, 6, { t: 's', v: row[i === 0 ? 2 : 3] });
  });
  ws['!cols'] = ws['!cols'] || [];
  ws['!cols'][3] = { wch: 3 };
  ws['!cols'][4] = { wch: 18 };
  ws['!cols'][5] = { wch: 18 };
  ws['!cols'][6] = { wch: 28 };
}

function ratioPercentCell(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Math.round(n * 10000) / 100;
}

function valueAtYear(arr, years, year) {
  const i = (years || []).findIndex((y) => yearNum(y) === year);
  if (i < 0) return '';
  return cellOrEmpty(arr?.[i]);
}

const CURRENT_PL_TEMPLATE_ROWS = [
  ['营业收入', '锚定日当期累计营业收入，元。未填按 0。导入后写入累计营业收入；市场法营业收入为空时一并带出。'],
  ['营业成本', '当期利润表营业成本，元。未填按 0。'],
  ['销售费用', '当期利润表销售费用，元，含已分摊折旧。填正数。'],
  ['管理费用', '当期利润表管理费用，元，含已分摊折旧。填正数。'],
  ['研发费用', '当期利润表研发费用，元，含已分摊折旧。填正数。'],
  ['财务费用', '当期利润表财务费用，元。利息收入大于利息支出时填负数。未填按 0。不进入自由现金流。'],
  ['营业利润', '当期利润表营业利润，元。'],
  ['净利润', '当期利润表净利润，元。市场法净利润为空时一并带出。'],
];

const FORECAST_TEMPLATE_ROWS = [
  ['收入增速', '百分数，10 表示 10%。可为负或 0。空白年份沿用最近一次已填数。'],
  ['营业成本', '增速。当期有营业成本时，年底数 = 年化后的当期金额 ×（1+增速），以后各年 = 上一年 ×（1+增速）。当期没填金额时仍按占收入。未填按 0。'],
  ['税金及附加', '占当年全年收入的百分数。未填按 0，小于 0 会拦截。'],
  ['销售费用', '增速，含已分摊折旧。有当期金额时先年化再乘（1+增速），以后各年 = 上一年 ×（1+增速）。没填当期金额时按占收入。未填按 0。'],
  ['管理费用', '增速，含已分摊折旧。有当期金额时先年化再乘（1+增速），以后各年 = 上一年 ×（1+增速）。没填当期金额时按占收入。未填按 0。'],
  ['研发费用', '增速，含已分摊折旧。有当期金额时先年化再乘（1+增速），以后各年 = 上一年 ×（1+增速）。没填当期金额时按占收入。未填按 0。'],
  ['财务费用', '增速。当期有金额时先年化再乘（1+增速），以后各年 = 上一年 ×（1+增速）。没填当期金额时按占收入。可为负。未填按 0，不进入自由现金流。'],
  ['其他收益', '占收入的百分数。可为负。未填按 0。补助不可持续时把后续年份改低。'],
  ['其他', '占收入的百分数。只放经营性项目，可为负。未填按 0。'],
  ['折旧摊销', '占收入的百分数。填现金流量表补充资料里的折旧摊销合计。未填按 0。'],
  ['资本开支', '占收入的百分数。未填不会按 0 计算。'],
  ['DSO', '天。空着则用可比公司年报中位数。'],
  ['DPO', '天。空着则用可比公司年报中位数。'],
  ['存货周转天数', '天。空着则用可比公司年报中位数。'],
];

function forecastYearsForTemplate(anchorYmd, plYears) {
  const anchorYear = yearNum(anchorYmd);
  const month = Number(String(anchorYmd).slice(5, 7));
  const start = month === 12 ? anchorYear + 1 : anchorYear;
  const saved = (plYears || []).map((y) => yearNum(y)).filter((n) => n != null && n >= start);
  const unique = [...new Set(saved)].sort((a, b) => a - b);
  if (unique.length) return unique.map(String);
  return Array.from({ length: 5 }, (_, i) => String(start + i));
}

function buildTargetFinancialTemplateBuffer(payload, now = new Date()) {
  const savedDate = formatCellDate(payload?.assumptions?.valuation_date);
  const anchor = savedDate || suggestAnchorYmd(now);
  const pl = payload?.targetPl || {};
  const plYears = (pl.years || []).map(String);
  const forecastYears = forecastYearsForTemplate(anchor, plYears);
  const anchorYear = yearNum(anchor);
  const assumptions = payload?.assumptions || {};
  const tax = assumptions.tax_rate == null || assumptions.tax_rate === '' ? '' : ratioPercentCell(assumptions.tax_rate);
  const bs = payload?.targetBs || {};

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['填写说明', [
      '按工作表分别填写：锚定日、当期利润表、预测、资产负债表。科目名称请保持与模板一致，否则无法导入。',
      '金额单位为元，与页面和数据库一致。预测表里的比例填百分数，10 表示 10%。',
      `估值锚定日只能是 3 月 31 日、6 月 30 日、9 月 30 日或 12 月 31 日。页面已选日期时按所选日期预填；未选时按当前月份：1–4 月为上年 12 月 31 日，5–7 月为当年 3 月 31 日，8–10 月为当年 6 月 30 日，11–12 月为当年 9 月 30 日。本次为 ${anchor}，可直接改「锚定日」表里的日期。`,
      '改锚定日时，请把「当期利润表」的当期列表头改成同一天。上一列是上一年 12 月 31 日的年末数，按锚定年自动前推一年。',
      '预测列默认从当前年份对应的预测首年起共 5 年。锚定日不是 12 月 31 日时，预测首年就是锚定日所在年；是 12 月 31 日时从下一年起。表头年份可改。',
      '资产负债表只填锚定日当天的实际数。右侧校验区汇总资产、负债和所有者权益，配平结果为已配平即可。',
      '当期利润表金额、预测里的比例和折旧摊销、资产负债表金额，单元格空着按 0。收入、营业成本、销售、管理、研发、财务费用的百分比是增速：锚定月不是 12 月时，先把当期累计按 12/锚定月年化，年底数 = 年化值 ×（1+增速），以后各年 = 上一年 ×（1+增速）。财务费用可为负。资本开支空着不按 0。DSO、DPO、存货周转天数空着用可比公司年报中位数。',
    ].join('\n')],
  ], 1, NOTE_COL_WCH * 3.5), '说明');
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['项目', '填写', '说明'],
    ['估值锚定日', anchor, '只能填 3 月 31 日、6 月 30 日、9 月 30 日、12 月 31 日。可改。'],
    ['所得税率', tax, '百分数，15 表示 15%。空着按 15%。'],
    ['市场法营业收入', cellOrEmpty(assumptions.market_revenue), '可选，元。空着则导入时用当期营业收入。'],
    ['市场法净利润', cellOrEmpty(assumptions.market_net_income), '可选，元。空着则导入时用当期净利润。'],
  ], 2, NOTE_COL_WCH, { 1: FILL_COL_WCH * 3 }), '锚定日');
  const priorYearEnd = `${anchorYear - 1}-12-31`;
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['科目', '科目说明', priorYearEnd, anchor],
    ...CURRENT_PL_TEMPLATE_ROWS.map(([name, note]) => {
      const key = matchAlias(name, PL_ALIASES);
      return [
        name,
        note,
        valueAtYear(pl[key], plYears, anchorYear - 1),
        valueAtYear(pl[key], plYears, anchorYear),
      ];
    }),
  ], 1, NOTE_COL_WCH, { 2: FILL_COL_WCH * 1.5, 3: FILL_COL_WCH * 1.5 }), '当期利润表');
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['科目', '科目说明', ...forecastYears],
    ...FORECAST_TEMPLATE_ROWS.map(([name, note]) => {
      const spec = FORECAST_ROW_ALIASES.find((a) => a.key === matchAlias(name, FORECAST_ROW_ALIASES));
      const cells = forecastYears.map((y) => {
        const raw = valueAtYear(pl[spec.key], plYears, yearNum(y));
        return spec.percent ? ratioPercentCell(raw) : raw;
      });
      return [name, note, ...cells];
    }),
  ]), '预测');
  const bsSheet = sheetFromAoa([
    ['科目', '科目说明', '金额（元）'],
    ...BS_VISIBLE_FIELDS.map((f) => [f.label, f.note || f.label, cellOrEmpty(bs[f.key])]),
  ], 1, NOTE_COL_WCH, { 2: FILL_COL_WCH * 1.5 });
  appendBsCheck(bsSheet, bs);
  XLSX.utils.book_append_sheet(wb, bsSheet, '资产负债表');
  return applyWrapTextToXlsx(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function getIndustryMultiplesStatus(db) {
  try {
    const rows = await db.query('SELECT COUNT(*) AS n FROM industry_market_multiples');
    const n = Number(rows[0]?.n || 0);
    return {
      available: true,
      count: n,
      message: n > 0
        ? `已缓存 ${n} 条行业倍数；计算时按申万三级现算成分股历史中位`
        : '计算时按申万三级从东财成分 + 库内历史中位汇总；找不到该行业或没有历史倍数则回退个股 POOL',
    };
  } catch {
    return { available: false, count: 0, message: '行业倍数表不可用，请用个股 POOL' };
  }
}

module.exports = {
  parseTargetFinancialWorkbook,
  mergeTargetFinancials,
  matchAlias,
  suggestAnchorYmd,
  buildTargetFinancialTemplateBuffer,
  getIndustryMultiplesStatus,
  sheetToCalculatedAoa,
};
