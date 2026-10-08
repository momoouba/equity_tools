const assert = require('assert');
const { buildDcfForecast, discountYears, parseAnchor, applyForecastCashflow, applyForecastPl, impliedForecastDa } = require('./dcfForecast');
const { sumCashflowDa } = require('./cashflowDa');
const { mergeTargetFinancials, matchAlias, suggestAnchorYmd, buildTargetFinancialTemplateBuffer, parseTargetFinancialWorkbook, sheetToCalculatedAoa } = require('./targetImport');
const { parseYmd } = require('./marketUtils');

function eq(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} !== ${expected}`);
}

const anchor = { year: 2026, month: 3 };
eq(discountYears(2026, anchor), 0.75, '2026 period');
eq(discountYears(2027, anchor), 1.75, '2027 period');
eq(discountYears(2026, { year: 2025, month: 12 }), 1, 'year-end anchor period');
assert.strictEqual(parseAnchor('2026-10-02').ok, false);
assert.strictEqual(parseAnchor('').ok, false);
assert.strictEqual(parseAnchor('2026-03-31').ok, true);

const bs = {
  cash: 20,
  accounts_receivable: 10,
  inventory: 5,
  accounts_payable: 8,
  short_term_loan: 5,
  current_portion_noncurrent: 3,
  long_term_loan: 10,
  lease_liability: 2,
  retained_earnings: 7,
};

const base = {
  assumptions: {
    valuation_date: '2026-03-31',
    ytd_revenue: 100,
    tax_rate: 0.15,
    esop: 0,
  },
  targetPl: {
    years: ['2026', '2027'],
    revenue_growth: [0.1, null],
    cogs_ratio: [0.5],
    surtax_ratio: [0],
    selling_ratio: [0],
    admin_ratio: [0],
    rd_ratio: [0],
    other_income_ratio: [0],
    other_ratio: [0],
    da_ratio: [0.1],
    capex_ratio: [0.1],
  },
  targetBs: bs,
  workingCapital: { dso_median: 36, dpo_median: 36, dio_median: 36 },
  baseRate: 0.1,
  terminalType: 'exit_pe',
  exitMultiple: 10,
  applyLiquidity: false,
};

const dayDefault = buildDcfForecast({
  ...base,
  assumptions: { ...base.assumptions, forecast_dio: 90 },
  targetPl: { ...base.targetPl, dso: [10, null] },
});
assert.strictEqual(dayDefault.blocked, false, (dayDefault.blockers || []).join('；'));
eq(dayDefault.series.dso[0], 10, 'year dso beats default');
eq(dayDefault.series.dso[1], 36, 'blank year uses comparable median');
eq(dayDefault.series.dio[0], 90, 'forecast dio default');
eq(dayDefault.series.dio[1], 90, 'forecast dio default year 2');

const out = buildDcfForecast(base);
assert.strictEqual(out.blocked, false, (out.blockers || []).join('；'));
eq(out.pvs[0].periods, 0.75, 'p0');
eq(out.pvs[1].periods, 1.75, 'p1');
eq(out.series.revenue[0], 440, 'rev2026');
eq(out.series.revenue[1], 484, 'rev2027');
eq(out.series.finance_expense[0], 0, 'blank finance expense is 0');
eq(out.series.pretax[0], 220, 'finance expense stays out of pretax');
const financeOut = buildDcfForecast({
  ...base,
  targetPl: { ...base.targetPl, finance_expense: [10, null], finance_expense_ratio: [0.1, 0] },
});
assert.strictEqual(financeOut.blocked, false, (financeOut.blockers || []).join('；'));
eq(financeOut.series.finance_expense[0], 44, 'annualized finance expense');
eq(financeOut.series.finance_expense[1], 44, 'next finance expense uses zero growth');
eq(financeOut.series.pretax[0], out.series.pretax[0], 'pretax ignores finance expense');
eq(out.pvs[0].fcf, 103.25, 'fcf2026');
eq(out.pvs[1].fcf, 201.3, 'fcf2027');
eq(out.net_debt, 0, 'net debt');
eq(out.terminal_value, 10 * out.series.nopat[1], 'exit ev');
assert.ok(out.equity_value > 0);

const notes = buildDcfForecast({
  ...base,
  targetBs: { ...bs, accounts_receivable: 6, notes_receivable: 4, retained_earnings: 7 },
});
assert.strictEqual(notes.blocked, false, (notes.blockers || []).join('；'));
eq(notes.pvs[0].fcf, out.pvs[0].fcf, 'notes folded into AR');

const badDate = buildDcfForecast({
  ...base,
  assumptions: { ...base.assumptions, valuation_date: '2026-10-02' },
});
assert.strictEqual(badDate.blocked, true);
assert.ok(badDate.blockers.some((m) => m.includes('3 月 31 日')));

const negRev = buildDcfForecast({
  ...base,
  targetPl: { ...base.targetPl, revenue_growth: [-2] },
});
assert.strictEqual(negRev.blocked, true);
assert.ok(negRev.blockers.some((m) => m.includes('全年营业收入')));

const lossExit = buildDcfForecast({
  ...base,
  targetPl: { ...base.targetPl, cogs_ratio: [1.2] },
});
assert.strictEqual(lossExit.blocked, true);
assert.ok(lossExit.blockers.some((m) => m.includes('改成 P/S')));

const psOk = buildDcfForecast({
  ...base,
  targetPl: { ...base.targetPl, cogs_ratio: [1.2] },
  terminalType: 'exit_ps',
  exitMultiple: 2,
});
assert.strictEqual(psOk.blocked, false, (psOk.blockers || []).join('；'));

const noRate = buildDcfForecast({ ...base, baseRate: null });
assert.strictEqual(noRate.blocked, false, (noRate.blockers || []).join('；'));
eq(noRate.discount_rate, 0.3, 'empty rate defaults to 30%');

const zeroRate = buildDcfForecast({ ...base, baseRate: 0 });
assert.ok(zeroRate.blockers.some((m) => m.includes('折现率小于等于 0')));

const noMultiple = buildDcfForecast({ ...base, exitMultiple: null });
assert.strictEqual(noMultiple.blocked, false, (noMultiple.blockers || []).join('；'));
eq(noMultiple.exit_multiple, 40, 'empty exit pe defaults to 40');

const june = buildDcfForecast({
  ...base,
  assumptions: { ...base.assumptions, valuation_date: '2026-06-30', ytd_revenue: 100 },
  targetPl: {
    ...base.targetPl,
    cogs: [40],
    cogs_ratio: [0.1],
    selling: [10],
    selling_ratio: [0],
  },
});
assert.strictEqual(june.blocked, false, (june.blockers || []).join('；'));
eq(june.series.revenue[0], 220, 'june rev annualized then grown');
eq(june.series.revenue[1], 242, 'next year rev');
eq(june.series.cogs[0], 88, 'june cogs annualized then grown');
eq(june.series.cogs[1], 96.8, 'next year cogs');
eq(june.series.selling[0], 20, 'june selling annualized flat');

const scenarioBad = buildDcfForecast({ ...base, scenarioLabel: '并购', scenarioRate: 0 });
assert.ok(scenarioBad.blockers.some((m) => m.includes('并购折现率')));

const scenarioEmpty = buildDcfForecast({ ...base, scenarioLabel: '上市', scenarioRate: null });
assert.strictEqual(scenarioEmpty.blocked, false, (scenarioEmpty.blockers || []).join('；'));
eq(scenarioEmpty.discount_rate, 0.1, 'empty scenario uses base');

const closed = buildDcfForecast({
  ...base,
  assumptions: { ...base.assumptions, valuation_date: '2025-12-31' },
  targetPl: {
    ...base.targetPl,
    years: ['2025', '2026', '2027'],
    revenue: [80, null, null],
    revenue_growth: [9, 0.1, null],
    cogs_ratio: [9, 0.5],
    surtax_ratio: [9, 0],
    selling_ratio: [9, 0],
    admin_ratio: [9, 0],
    rd_ratio: [9, 0],
    other_income_ratio: [9, 0],
    other_ratio: [9, 0],
    da_ratio: [9, 0.1],
    capex_ratio: [9, 0.1],
  },
});
assert.strictEqual(closed.blocked, false, (closed.blockers || []).join('；'));
assert.strictEqual(String(closed.pvs[0].year), '2026');
eq(closed.pvs[0].periods, 1, 'closed-year first period');
eq(closed.series.revenue[0], 110, 'closed-year ignores imported growth');

assert.strictEqual(matchAlias('应收账款', [
  { key: 'accounts_receivable', labels: ['应收账款（含应收票据）'] },
  { key: 'other', labels: ['其他应收款'] },
]), 'accounts_receivable');

const merged = mergeTargetFinancials({
  assumptions: { valuation_date: '2026-03-31', ytd_revenue: null, market_revenue: null, market_net_income: null },
  targetPl: { years: ['2026', '2027'], revenue_growth: [0.1, null], cogs_ratio: [0.5] },
}, {
  targetPl: { years: ['2024', '2025', '2026'], revenue: [1, 2, 30], cogs: [4, 5, 9], net_income: [6, 7, 8] },
  targetBsSeries: { years: ['2024', '2026'], cash: [1, 20], accounts_receivable: [2, 11] },
});
assert.strictEqual(merged.targetPl.years[0], '2026');
assert.strictEqual(merged.targetPl.revenue[0], 30);
assert.strictEqual(merged.targetPl.cogs_ratio[0], 0.5);
assert.strictEqual(merged.targetPl.revenue_growth[0], 0.1);
assert.strictEqual(merged.assumptions.ytd_revenue, 30);
assert.strictEqual(merged.assumptions.market_net_income, 8);
assert.strictEqual(merged.targetBs.cash, 20);
assert.strictEqual(merged.targetBs.accounts_receivable, 11);

assert.strictEqual(suggestAnchorYmd('2026-01-15'), '2025-12-31');
assert.strictEqual(suggestAnchorYmd('2026-04-30'), '2025-12-31');
assert.strictEqual(suggestAnchorYmd('2026-05-01'), '2026-03-31');
assert.strictEqual(suggestAnchorYmd('2026-07-31'), '2026-03-31');
assert.strictEqual(suggestAnchorYmd('2026-08-01'), '2026-06-30');
assert.strictEqual(suggestAnchorYmd('2026-10-02'), '2026-06-30');
assert.strictEqual(suggestAnchorYmd('2026-11-02'), '2026-09-30');
assert.strictEqual(suggestAnchorYmd('2026-12-31'), '2026-09-30');
assert.strictEqual(suggestAnchorYmd('2026-04-30 23:30:00'), '2025-12-31');
assert.strictEqual(suggestAnchorYmd('2026-04-30T16:30:00.000Z'), '2026-03-31');
assert.strictEqual(suggestAnchorYmd('2026-04-30T15:30:00.000Z'), '2025-12-31');
assert.strictEqual(suggestAnchorYmd(new Date('2026-07-31T16:30:00.000Z')), '2026-06-30');
assert.strictEqual(suggestAnchorYmd(new Date('2026-10-31T16:00:00.000Z')), '2026-09-30');
assert.ok(/^\d{4}-(12-31|03-31|06-30|09-30)$/.test(suggestAnchorYmd('not-a-date')));
assert.ok(/^\d{4}-(12-31|03-31|06-30|09-30)$/.test(suggestAnchorYmd(new Date(NaN))));
assert.strictEqual(parseYmd('2026-06-30'), '2026-06-30');
assert.strictEqual(parseYmd('2026-04-30 23:30:00'), '2026-04-30');
assert.strictEqual(parseYmd('2026-04-30T16:30:00.000Z'), '2026-05-01');
assert.strictEqual(parseYmd(new Date('2026-06-30T00:00:00.000Z')), '2026-06-30');
assert.strictEqual(parseYmd(new Date(NaN)), null);
assert.strictEqual(parseAnchor('2026-06-29T16:00:00.000Z').ok, true);
assert.strictEqual(parseAnchor('2026-06-29T16:00:00.000Z').ymd, '2026-06-30');
assert.strictEqual(parseAnchor(new Date(NaN)).ok, false);
const selected = parseTargetFinancialWorkbook(buildTargetFinancialTemplateBuffer(
  { assumptions: { valuation_date: '2025-09-30' } },
  '2026-10-02',
));
assert.strictEqual(selected.assumptions.valuation_date, '2025-09-30');

const template = parseTargetFinancialWorkbook(buildTargetFinancialTemplateBuffer(null, '2026-10-02'));
assert.strictEqual(template.assumptions.valuation_date, '2026-06-30');
assert.deepStrictEqual(template.forecast.years, ['2026', '2027', '2028', '2029', '2030']);
assert.ok(template.sheets.includes('锚定日'));
assert.ok(template.sheets.includes('当期利润表'));
assert.ok(template.sheets.includes('预测'));

const XLSX = require('xlsx');
const templateBook = XLSX.read(buildTargetFinancialTemplateBuffer(null, '2026-10-02'), { type: 'buffer', cellStyles: true });
assert.deepStrictEqual(templateBook.SheetNames, ['说明', '锚定日', '当期利润表', '预测', '资产负债表']);
assert.strictEqual(templateBook.Sheets['说明']['!cols'][1].wch, 52 * 1.5 * 3.5);
assert.strictEqual(templateBook.Sheets['锚定日']['!cols'][1].wch, 12 * 3);
assert.strictEqual(templateBook.Sheets['当期利润表']['!cols'][2].wch, 12 * 1.5);
assert.strictEqual(templateBook.Sheets['资产负债表']['!cols'][2].wch, 12 * 1.5);
assert.strictEqual(templateBook.Sheets['当期利润表']['!rows'][0].hpt, 22 * 3);
assert.ok(templateBook.Sheets['说明']['!rows'][0].hpt > 22 * 3);
assert.strictEqual(templateBook.Sheets['资产负债表'].F2.f.startsWith('SUM(C'), true);
assert.strictEqual(templateBook.Sheets['资产负债表'].E4.v, '资产总计');
const zlib = require('zlib');
function unzipEntry(buffer, suffix) {
  let i = 0;
  while (i + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(i);
    if (sig !== 0x04034b50) break;
    const method = buffer.readUInt16LE(i + 8);
    const comp = buffer.readUInt32LE(i + 18);
    const nlen = buffer.readUInt16LE(i + 26);
    const elen = buffer.readUInt16LE(i + 28);
    const name = buffer.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    const data = method === 0 ? buffer.slice(start, start + comp) : zlib.inflateRawSync(buffer.slice(start, start + comp));
    if (name.endsWith(suffix)) return data.toString('utf8');
    i = start + comp;
  }
  return '';
}
const styledBuf = buildTargetFinancialTemplateBuffer({
  assumptions: { valuation_date: '2026-06-30', tax_rate: 0.15, market_revenue: 12345.6 },
}, '2026-10-02');
const stylesXml = unzipEntry(styledBuf, 'xl/styles.xml');
assert.ok(stylesXml.includes('numFmtId="4"'));
assert.ok(stylesXml.includes('vertical="center" horizontal="right"'));
assert.ok(stylesXml.includes('FF1F4E79'));
assert.ok(stylesXml.includes('FF8FA4B8'));
const anchorXml = unzipEntry(styledBuf, 'xl/worksheets/sheet2.xml');
assert.ok(anchorXml.includes('>2026-06-30</v>'));
assert.ok(anchorXml.includes('<v>15</v>'));
assert.ok(anchorXml.includes('<v>12345.6</v>'));
const bsXml = unzipEntry(styledBuf, 'xl/worksheets/sheet5.xml');
assert.ok(bsXml.includes('金额（元）'));
assert.ok(bsXml.includes('SUM(C'));
assert.ok(!bsXml.includes('conditionalFormatting'));
assert.ok(stylesXml.includes('fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/>'));
assert.strictEqual((stylesXml.match(/<xf /g) || []).length, Number((stylesXml.match(/<cellXfs count="(\d+)"/) || [])[1]) + Number((stylesXml.match(/<cellStyleXfs count="(\d+)"/) || [])[1] || 0));
const roundTrip = parseTargetFinancialWorkbook(styledBuf);
const roundApplied = mergeTargetFinancials({ assumptions: {}, targetPl: { years: [] }, targetBs: {} }, roundTrip);
assert.strictEqual(roundApplied.assumptions.market_revenue, 12345.6);
assert.strictEqual(roundApplied.assumptions.valuation_date, '2026-06-30');
const bsRows = XLSX.utils.sheet_to_json(templateBook.Sheets['资产负债表'], { header: 1 });
const bsLabels = bsRows.slice(1).map((row) => row[0]);
assert.ok(bsLabels.includes('递延所得税负债'));
assert.ok(bsLabels.includes('债权投资'));
assert.ok(bsLabels.includes('其他债权投资'));
assert.ok(bsLabels.includes('长期应收款'));
assert.ok(bsLabels.includes('长期股权投资'));
assert.ok(bsLabels.includes('其他权益工具投资'));
assert.ok(bsLabels.includes('其他非流动金融资产'));
assert.ok(bsLabels.indexOf('债权投资') < bsLabels.indexOf('投资性房地产'));
assert.ok(bsLabels.indexOf('其他非流动金融资产') < bsLabels.indexOf('其他非流动资产'));
const { BS_INPUT_FIELDS } = require('./targetBsFields');
const bsAliases = BS_INPUT_FIELDS.map((f) => ({ key: f.key, labels: [f.label] }));
assert.strictEqual(matchAlias('债权投资', bsAliases), 'debt_investment');
assert.strictEqual(matchAlias('其他债权投资', bsAliases), 'other_debt_investment');
assert.strictEqual(matchAlias('其他非流动金融资产', bsAliases), 'other_noncurrent_financial');
assert.strictEqual(matchAlias('其他非流动资产', bsAliases), 'other_noncurrent_assets');
assert.ok(!bsLabels.includes('应收票据'));
assert.ok(!bsLabels.includes('应付票据'));
assert.ok(!bsLabels.includes('预收款项'));
assert.ok(!bsLabels.includes('所有者权益'));
assert.ok(String(bsRows.find((row) => row[0] === '货币资金')[1]).includes('交易性金融资产'));
assert.ok(String(bsRows.find((row) => row[0] === '应收账款（含应收票据）')[1]).includes('应收款项融资'));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['项目', '填写', '说明'],
  ['估值锚定日', '2025-12-31', '可改'],
  ['所得税率', 15, ''],
]), '锚定日');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['科目', '科目说明', '2025-12-31'],
  ['营业收入', '当期', 80],
  ['净利润', '当期', 6],
]), '当期利润表');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['科目', '科目说明', '2026', '2027'],
  ['收入增速', '百分数', 10, 0],
  ['营业成本', '百分数', 50, ''],
  ['资本开支', '百分数', '', ''],
  ['DSO', '天', 36, ''],
]), '预测');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['科目', '科目说明', '金额'],
  ['货币资金', '含交易性金融资产', ''],
  ['应收账款（含应收票据）', '含应收款项融资', 10],
]), '资产负债表');
const filled = parseTargetFinancialWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
const applied = mergeTargetFinancials({ assumptions: {}, targetPl: { years: [] } }, filled);
assert.strictEqual(applied.assumptions.valuation_date, '2025-12-31');
assert.strictEqual(applied.assumptions.tax_rate, 0.15);
assert.strictEqual(applied.assumptions.market_revenue, 80);
assert.strictEqual(applied.amount_unit, 'yuan');
const wanBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wanBook, XLSX.utils.aoa_to_sheet([
  ['项目', '填写', '说明'],
  ['估值锚定日', '2025-12-31', '金额单位为万元'],
  ['市场法营业收入', 2, ''],
]), '锚定日');
const wanParsed = mergeTargetFinancials({}, parseTargetFinancialWorkbook(XLSX.write(wanBook, { type: 'buffer', bookType: 'xlsx' })));
assert.strictEqual(wanParsed.assumptions.market_revenue, 20000);
assert.strictEqual(applied.targetPl.revenue[0], 80);
assert.strictEqual(applied.targetPl.cogs[0], 0);
assert.deepStrictEqual(applied.targetPl.years.map(String), ['2025', '2026', '2027']);
assert.strictEqual(applied.targetPl.revenue_growth[1], 0.1);
assert.strictEqual(applied.targetPl.revenue_growth[2], 0);
assert.strictEqual(applied.targetPl.cogs_ratio[1], 0.5);
assert.strictEqual(applied.targetPl.cogs_ratio[2], 0);
assert.strictEqual(applied.targetPl.selling_ratio[1], 0);
assert.strictEqual(applied.targetPl.capex_ratio?.[1] ?? null, null);
assert.strictEqual(applied.targetPl.capex_ratio?.[2] ?? null, null);
assert.strictEqual(applied.targetPl.dso[1], 36);
assert.strictEqual(applied.targetPl.dso[2] ?? null, null);
assert.strictEqual(applied.targetBs.cash, 0);
assert.strictEqual(applied.targetBs.accounts_receivable, 10);

const formulaPl = XLSX.utils.aoa_to_sheet([
  ['科目', '科目说明', '2026-06-30'],
  ['营业收入', '当期', 80],
  ['净利润', '当期', 0],
]);
formulaPl.C3 = { t: 'n', f: 'C2*0.1' };
formulaPl['!ref'] = 'A1:C3';
const formulaRows = sheetToCalculatedAoa(formulaPl);
assert.strictEqual(formulaRows[2][2], 8);
const cachedPl = XLSX.utils.aoa_to_sheet([
  ['科目', '科目说明', '2026-06-30'],
  ['营业收入', '当期', 80],
  ['净利润', '当期', 7],
]);
cachedPl.C3 = { t: 'n', f: 'C2*0.1', v: 7 };
const cachedBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(cachedBook, cachedPl, '当期利润表');
const cachedParsed = parseTargetFinancialWorkbook(XLSX.write(cachedBook, { type: 'buffer', bookType: 'xlsx' }));
assert.strictEqual(cachedParsed.targetPl.net_income[0], 7);

eq(sumCashflowDa({
  FA_IR_DEPR: 38086468.48,
  OILGAS_BIOLOGY_DEPR: 38086468.48,
  IA_AMORTIZE: 31929841.97,
  LPE_AMORTIZE: 2382014.77,
  USERIGHT_ASSET_AMORTIZE: 11520371.44,
}), 38086468.48 + 31929841.97 + 2382014.77 + 11520371.44, 'da components once');
assert.strictEqual(sumCashflowDa({ DEPRECIATION_ETC: 12, FA_IR_DEPR: 99 }), 12);
assert.strictEqual(sumCashflowDa({ OILGAS_BIOLOGY_DEPR: 5, IA_AMORTIZE: 1 }), 6);
assert.strictEqual(sumCashflowDa({}), null);
assert.strictEqual(sumCashflowDa({ FA_IR_DEPR: 0, IA_AMORTIZE: 3 }), 3);

const { alignAssumptionMoney } = require('./marketUtils');
const plYuan = { revenue: [199920083.69] };
const inflated = alignAssumptionMoney({
  ytd_revenue: 199920083.69 * 1e8,
  market_revenue: 199920083.69 * 1e8,
  market_net_income: 91675229.51 * 1e8,
  esop: 0,
}, plYuan, 'yuan');
assert.strictEqual(inflated.changed, true);
assert.ok(Math.abs(inflated.assumptions.market_revenue - 199920083.69) < 1);
assert.ok(Math.abs(inflated.assumptions.ytd_revenue - 199920083.69) < 1);
assert.ok(Math.abs(inflated.assumptions.market_net_income - 91675229.51) < 1);
const kept = alignAssumptionMoney({
  market_revenue: 199920083.69,
  ytd_revenue: 199920083.69,
}, plYuan, 'yuan');
assert.strictEqual(kept.changed, false);
const fromWan = alignAssumptionMoney({
  market_revenue: 19992.008369,
  ytd_revenue: 19992.008369,
  market_net_income: 9167.522951,
}, plYuan, 'wan');
assert.ok(Math.abs(fromWan.assumptions.market_revenue - 199920083.69) < 1);

const filledCf = applyForecastCashflow(
  { years: ['2025', '2026'], da: [1, null], capex: [2, null], dnwc: [3, null], da_default: 9 },
  { blocked: false, series: { years: ['2026', '2027'], da: [10, 11], capex: [20, 21], dnwc: [30, 31] } },
);
assert.deepStrictEqual(filledCf.years, ['2025', '2026', '2027']);
assert.deepStrictEqual(filledCf.da, [1, 10, 11]);
assert.deepStrictEqual(filledCf.capex, [2, 20, 21]);
assert.deepStrictEqual(filledCf.dnwc, [3, 30, 31]);
assert.strictEqual(filledCf.da_default, 9);
const blockedCf = applyForecastCashflow(
  { years: ['2026'], da: [9] },
  { blocked: true, series: { years: ['2026'], da: [1], capex: [1], dnwc: [1] } },
);
assert.strictEqual(blockedCf.da[0], 9);

const impliedDa = impliedForecastDa({
  years: ['2026', '2027'],
  revenue: [100],
  revenue_growth: [0.1, 0],
  da_ratio: [0.1, 0.1],
}, { valuation_date: '2026-06-30', ytd_revenue: 100 });
assert.deepStrictEqual(impliedDa.years, ['2026', '2027']);
eq(impliedDa.actualDa, 10, 'actual da');
eq(impliedDa.da[0], 22, '2026 da');
eq(impliedDa.da[1], 22, '2027 da');
const seededDa = mergeTargetFinancials({
  assumptions: { valuation_date: '2026-06-30', ytd_revenue: 100 },
  targetPl: {
    years: ['2026', '2027'],
    revenue: [100],
    revenue_growth: [0.1, 0],
    da_ratio: [0.1, 0.1],
  },
}, {});
eq(seededDa.overrides.da, 10, 'imported actual da');
eq(seededDa.targetCf.da[0], 22, 'imported 2026 da');

const manualPl = {
  2026: { revenue: 500, manual: ['revenue'] },
  2027: { capex: 10, manual: ['capex'] },
};
const manualOut = buildDcfForecast({ ...base, forecastPl: manualPl });
assert.strictEqual(manualOut.blocked, false, (manualOut.blockers || []).join('；'));
eq(manualOut.series.revenue[0], 500, 'manual revenue');
eq(manualOut.series.revenue[1], 550, 'next year grows from manual revenue');
eq(manualOut.series.capex[0], 50, 'capex still follows overridden revenue');
eq(manualOut.series.capex[1], 10, 'manual capex');
const grownManual = buildDcfForecast({
  ...base,
  targetPl: { ...base.targetPl, cogs: [40, null] },
  forecastPl: { 2026: { cogs: 100, manual: ['cogs'] } },
});
assert.strictEqual(grownManual.blocked, false, (grownManual.blockers || []).join('；'));
eq(grownManual.series.cogs[0], 100, 'manual cogs');
eq(grownManual.series.cogs[1], 150, 'next cogs grows from manual amount');
const writtenPl = applyForecastPl(manualPl, manualOut);
assert.strictEqual(writtenPl['2026'].revenue, 500);
assert.ok(writtenPl['2026'].manual.includes('revenue'));
eq(writtenPl['2026'].cogs, manualOut.series.cogs[0], 'writeback fills untouched cogs');
assert.strictEqual(writtenPl['2027'].capex, 10);
eq(writtenPl['2027'].revenue, 550, 'writeback fills grown revenue');
const blockedPl = applyForecastPl(manualPl, { blocked: true, series: manualOut.series });
assert.strictEqual(blockedPl['2026'].cogs, undefined);

console.log('dcfForecast.test.js ok');
