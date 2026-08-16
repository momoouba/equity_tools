const XLSX = require('xlsx');
const { toNumber } = require('./marketUtils');
const { BS_INPUT_FIELDS, BS_INPUT_KEYS } = require('./targetBsFields');

const PL_ALIASES = [
  { key: 'revenue', labels: ['营业收入', '营业总收入', '营收'] },
  { key: 'cogs', labels: ['营业成本', '成本'] },
  { key: 'selling', labels: ['销售费用'] },
  { key: 'admin', labels: ['管理费用'] },
  { key: 'rd', labels: ['研发费用'] },
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
      if (n === lb || n.startsWith(lb) || n.endsWith(lb)) {
        if (lb.length > bestLen) {
          best = a.key;
          bestLen = lb.length;
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
    for (let i = li + 1; i < row.length; i += 1) {
      const v = toNumber(row[i]);
      if (v != null) {
        n = v;
        break;
      }
    }
    if (n == null) continue;
    out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function sheetKind(name) {
  const s = String(name || '');
  if (/资产负债|balance|\bbs\b/i.test(s)) return 'bs';
  if (/现金|capex|\bcf\b/i.test(s) && !/dcf/i.test(s)) return 'cf';
  if (/dcf/i.test(s)) return 'dcf';
  if (/利润|income|\bpl\b/i.test(s)) return 'pl';
  return 'unknown';
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
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const warnings = [];
  const used = [];
  let targetPl = null;
  let targetBs = null;
  let targetCf = null;

  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    const kind = sheetKind(name);
    if (kind === 'unknown' && /结果对比|相对估值|三费|毛利|营运|市场法/.test(name)) continue;

    if (kind === 'bs' || kind === 'dcf' || kind === 'unknown') {
      const bs = parseBsTwoCol(aoa) || parseYearMatrix(aoa, BS_ALIASES);
      if (bs && !bs.years) {
        targetBs = applyBs(targetBs, bs);
        used.push(name);
      } else if (bs?.years && bs.series) {
        const last = bs.years[bs.years.length - 1];
        const idx = bs.years.indexOf(last);
        const snap = {};
        Object.entries(bs.series).forEach(([k, arr]) => { snap[k] = arr[idx]; });
        targetBs = applyBs(targetBs, snap);
        used.push(name);
      }
    }

      const plMatrix = (kind === 'pl' || kind === 'dcf' || kind === 'unknown')
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

  if (!targetPl && !targetBs && !targetCf) {
    warnings.push('未识别到利润表/资产负债表/现金流量表科目，请用模板：第一列科目、第二列科目说明、其后为年份或金额');
  }

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
    targetCf,
    overrides: Object.keys(overrides).length ? overrides : null,
    warnings,
    sheets: [...new Set(used)],
  };
}

function mergeTargetFinancials(payload, parsed) {
  const next = { ...(payload || {}), amount_unit: 'wan' };
  if (parsed.targetPl?.years?.length) next.targetPl = parsed.targetPl;
  if (parsed.targetBs && Object.keys(parsed.targetBs).length) {
    next.targetBs = { ...(next.targetBs || {}), ...parsed.targetBs };
    next.overrides = { ...(next.overrides || {}), net_debt: null };
  }
  if (parsed.targetCf?.years?.length) next.targetCf = parsed.targetCf;
  if (parsed.overrides) {
    next.overrides = { ...(next.overrides || {}), ...parsed.overrides, net_debt: next.overrides?.net_debt ?? null };
  }
  return next;
}

const NAME_COL_WCH = 28;
const NOTE_COL_WCH = 52;

function displayWidth(text) {
  return [...String(text || '')].reduce((n, ch) => n + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0);
}

function noteRowHeight(text, colWch = NOTE_COL_WCH) {
  const lines = String(text || '').split('\n');
  const wrapped = lines.reduce((n, line) => n + Math.max(1, Math.ceil(displayWidth(line) / Math.max(8, colWch - 2))), 0);
  return Math.min(110, 18 + wrapped * 16);
}

function wrapNoteSheet(ws, noteCol = 1) {
  if (!ws['!ref']) return ws;
  const range = XLSX.utils.decode_range(ws['!ref']);
  ws['!cols'] = ws['!cols'] || [];
  ws['!cols'][0] = { wch: NAME_COL_WCH };
  ws['!cols'][noteCol] = { wch: NOTE_COL_WCH };
  for (let c = noteCol + 1; c <= range.e.c; c += 1) {
    ws['!cols'][c] = ws['!cols'][c] || { wch: 12 };
  }
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const note = ws[XLSX.utils.encode_cell({ r, c: noteCol })];
    const name = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const header = r === range.s.r && String(name?.v || '') === '科目';
    rows[r] = { hpt: header ? 22 : noteRowHeight(note?.v) };
  }
  ws['!rows'] = rows;
  return ws;
}

function sheetFromAoa(aoa, noteCol = 1) {
  return wrapNoteSheet(XLSX.utils.aoa_to_sheet(aoa), noteCol);
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

function applyWrapTextToXlsx(buffer) {
  const files = unzipXlsx(buffer);
  const styles = files['xl/styles.xml'].toString('utf8').replace(
    /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/,
    (_, count, inner) => `<cellXfs count="${Number(count) + 1}">${inner}<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top" horizontal="left"/></xf></cellXfs>`
  );
  files['xl/styles.xml'] = Buffer.from(styles, 'utf8');
  const wrapIdx = Number((styles.match(/<cellXfs count="(\d+)">/) || [])[1] || 2) - 1;
  for (const name of Object.keys(files)) {
    if (!name.startsWith('xl/worksheets/sheet') || !name.endsWith('.xml')) continue;
    let xml = files[name].toString('utf8');
    xml = xml.replace(/<c r="([AB]\d+)"([^>]*)>/g, (m, ref, rest) => {
      if (/\ss="\d+"/.test(rest)) return m;
      return `<c r="${ref}" s="${wrapIdx}"${rest}>`;
    });
    files[name] = Buffer.from(xml, 'utf8');
  }
  return zipXlsx(files);
}

const SAMPLE_YEARS = ['2024', '2025', '2026', '2027', '2028'];
const SAMPLE_PL = {
  revenue: [37320, 43222, 57800, 73500, ''],
  cogs: ['', '', '', '', ''],
  selling: [1602, 2101, 3179, 4043, ''],
  admin: [1768, 2159, 3468, 4410, ''],
  rd: [4380, '', '', '', ''],
  operating_profit: [8935, 9119, 11155, 13377, ''],
  net_income: [7912, 8326, 10218, 12163, ''],
};
const SAMPLE_BS = {
  cash: 0,
  short_term_loan: 21676,
  long_term_loan: 0,
  accounts_receivable: 15667.9,
  accounts_payable: 5501.5,
  inventory: 24066.2,
};
const SAMPLE_CF = {
  da: [0, 0, 0, 0, 0],
  capex: [266, 1178, 1000, 1000, 1000],
  dnwc: [-2091, 7399, 9967, 11247, 12750],
};

function cellOrEmpty(v) {
  return v == null || v === '' ? '' : v;
}

function hasCaseFinancials(payload) {
  const pl = payload?.targetPl;
  const bs = payload?.targetBs;
  const cf = payload?.targetCf;
  if (pl?.years?.length) return true;
  if (cf?.years?.length) return true;
  return !!(bs && Object.values(bs).some((v) => v != null && v !== ''));
}

function templateYears(payload) {
  const plY = (payload?.targetPl?.years || []).map(String).filter(Boolean);
  const cfY = (payload?.targetCf?.years || []).map(String).filter(Boolean);
  if (!plY.length && !cfY.length) return SAMPLE_YEARS;
  const seen = new Set(plY);
  return [...plY, ...cfY.filter((y) => !seen.has(y))];
}

function yearCells(src, srcYears, years, sampleArr, useSample) {
  return years.map((y, i) => {
    if (useSample) return sampleArr[i] ?? '';
    const idx = (srcYears || []).map(String).indexOf(String(y));
    if (idx < 0) return '';
    return cellOrEmpty(src?.[idx]);
  });
}

function buildTargetFinancialTemplateBuffer(payload) {
  const useSample = !hasCaseFinancials(payload);
  const years = useSample ? SAMPLE_YEARS : templateYears(payload);
  const pl = payload?.targetPl || {};
  const bs = payload?.targetBs || {};
  const cf = payload?.targetCf || {};
  const plY = (pl.years || []).map(String);
  const cfY = (cf.years || []).map(String);
  const pickPl = (key) => yearCells(pl[key], plY, years, SAMPLE_PL[key], useSample);
  const pickCf = (key) => yearCells(cf[key], cfY, years, SAMPLE_CF[key], useSample);
  const pickBs = (key) => (useSample ? SAMPLE_BS[key] : cellOrEmpty(bs[key]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['填写说明', useSample
      ? '单位万元。第一列「科目」供导入识别，请保持与模板一致。\n第二列「科目说明」仅阅读，导入时忽略。\n下表是示例数字；从案例页下载模板会带出该案例已填金额。\n费用填正数。营运资本增加：增加为正，DCF 扣除。'
      : '单位万元。下列金额来自当前案例已保存的三表，可改完再导入覆盖。\n第一列「科目」供导入识别；第二列「科目说明」仅阅读。\n空白表示该科目尚未录入。费用填正数。'],
  ]), '说明');
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['科目', '科目说明', ...years],
    ['营业收入', '利润表「营业收入」合计。\n已实现最近一年（如 2025）是市场法 P/S 基数。', ...pickPl('revenue')],
    ['营业成本', '可选。\n不填则按毛利率或费用率外推后续年份。', ...pickPl('cogs')],
    ['销售费用', '利润表「销售费用」。\n填正数（不要填成负数）。', ...pickPl('selling')],
    ['管理费用', '利润表「管理费用」。\n填正数。', ...pickPl('admin')],
    ['研发费用', '利润表「研发费用」。\n填正数。', ...pickPl('rd')],
    ['营业利润', '利润表「营业利润」。\n市场法 P/E 已改用已实现年净利润，本行供 DCF / 对标。', ...pickPl('operating_profit')],
    ['净利润', '利润表「净利润」。\n已实现年是市场法 P/E 基数；预测年是 DCF 净利润桥起点。', ...pickPl('net_income')],
  ]), '利润表');
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['科目', '科目说明', '金额（万元）'],
    ...BS_INPUT_FIELDS.map((f) => [f.label, f.note || f.label, pickBs(f.key)]),
  ]), '资产负债表');
  XLSX.utils.book_append_sheet(wb, sheetFromAoa([
    ['科目', '科目说明', ...years],
    ['折旧摊销', '现金流量表加回项：固定资产折旧 + 无形资产摊销 + 长期待摊费用摊销。\n与利润表年份对齐。', ...pickCf('da')],
    ['资本性支出', '购建固定资产、无形资产和其他长期资产支付的现金。\nDCF 扣除，填正数。', ...pickCf('capex')],
    ['营运资本增加', '存货增加 + 经营性应收增加 − 经营性应付增加。\n增加为正（DCF 扣除），不是期末余额。', ...pickCf('dnwc')],
  ]), '现金流量表');
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
  buildTargetFinancialTemplateBuffer,
  getIndustryMultiplesStatus,
};
