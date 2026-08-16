/**
 * 估值工作台结构化读写：方法/假设/情景/计算结果。
 * 替代 valuation_draft.payload_json、valuation_version.*_json、valuation_version_sheet。
 * 传入 pool 时供启动迁移使用（不可走 db.query，否则与 init 死锁）。
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { defaultMethodConfig, defaultAssumptions, defaultScenarioSet, seedDcfLiquidityDiscount } = require('./defaults');
const { toNumber, yuanToYi, resolveValuationDate, parseYmd, sqlDate } = require('./marketUtils');
const { parseJson } = require('./listedMetrics');

const DRAFT_VERSION_ID = '0';

function wrapDb(pool) {
  if (!pool) {
    return {
      query: (sql, params) => db.query(sql, params),
      execute: (sql, params) => db.execute(sql, params),
      idConn: undefined,
    };
  }
  return {
    query: async (sql, params) => {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    execute: async (sql, params) => {
      const [result] = await pool.query(sql, params);
      return result;
    },
    idConn: pool,
  };
}

function numOrNull(v) {
  const n = toNumber(v);
  return n == null ? null : n;
}

function strOrNull(v, max) {
  if (v == null || v === '') return null;
  const s = String(v);
  return max ? s.slice(0, max) : s;
}

async function upsertByCaseVersion(d, table, caseId, versionId, columns, values) {
  const exist = await d.query(
    `SELECT F_Id FROM ${table} WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  if (exist.length) {
    const sets = columns.map((c) => `${c} = ?`).join(', ');
    await d.execute(
      `UPDATE ${table} SET ${sets}, F_LastModifyTime = NOW() WHERE F_Id = ?`,
      [...values, exist[0].F_Id]
    );
    return exist[0].F_Id;
  }
  const id = await generateId(table, d.idConn);
  const placeholders = columns.map(() => '?').join(',');
  await d.execute(
    `INSERT INTO ${table} (F_Id, case_id, version_id, ${columns.join(',')}, F_CreatorTime, F_LastModifyTime)
     VALUES (?,?,?,${placeholders},NOW(),NOW())`,
    [id, caseId, versionId, ...values]
  );
  return id;
}

async function saveMethod(caseId, versionId, method, pool) {
  const d = wrapDb(pool);
  const m = { ...defaultMethodConfig(), ...(method || {}) };
  await upsertByCaseVersion(d, 'valuation_method', caseId, versionId, [
    'terminal_type', 'fcf_method', 'sensitivity_axes', 'scenario_mode',
    'multiple_source', 'industry_stat_method', 'confirmed',
  ], [
    strOrNull(m.terminal_type, 32),
    strOrNull(m.fcf_method, 32),
    strOrNull(m.sensitivity_axes, 32),
    strOrNull(m.scenario_mode, 32),
    strOrNull(m.multiple_source, 32),
    strOrNull(m.industry_stat_method, 32),
    m.confirmed ? 1 : 0,
  ]);
}

async function loadMethod(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT terminal_type, fcf_method, sensitivity_axes, scenario_mode,
            multiple_source, industry_stat_method, confirmed
     FROM valuation_method WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  if (!rows.length) return defaultMethodConfig();
  const r = rows[0];
  return {
    terminal_type: r.terminal_type,
    fcf_method: r.fcf_method,
    sensitivity_axes: r.sensitivity_axes,
    scenario_mode: r.scenario_mode,
    multiple_source: r.multiple_source,
    industry_stat_method: r.industry_stat_method,
    confirmed: Number(r.confirmed) === 1,
  };
}

async function caseCreatedAt(d, caseId) {
  const rows = await d.query('SELECT F_CreatorTime FROM valuation_case WHERE F_Id = ? LIMIT 1', [caseId]);
  return rows[0]?.F_CreatorTime || null;
}

async function saveAssumptions(caseId, versionId, assumptions, pool) {
  const d = wrapDb(pool);
  const a = seedDcfLiquidityDiscount({ ...defaultAssumptions(), ...(assumptions || {}) });
  a.valuation_date = resolveValuationDate(assumptions?.valuation_date, await caseCreatedAt(d, caseId));
  const w = a.wacc_breakdown || {};
  await upsertByCaseVersion(d, 'valuation_assumption', caseId, versionId, [
    'discount_rate', 'exit_pe', 'exit_ps', 'liquidity_discount', 'dcf_liquidity_discount', 'tax_rate', 'forecast_years',
    'esop', 'valuation_date', 'round_deal_value_yi', 'display_unit',
    'wacc_risk_free_rate', 'wacc_erp', 'wacc_beta', 'wacc_debt_equity', 'wacc_debt_cost', 'wacc_tax_rate',
  ], [
    numOrNull(a.discount_rate),
    numOrNull(a.exit_pe),
    numOrNull(a.exit_ps),
    numOrNull(a.liquidity_discount),
    numOrNull(a.dcf_liquidity_discount),
    numOrNull(a.tax_rate),
    a.forecast_years == null ? null : Number(a.forecast_years),
    numOrNull(a.esop),
    sqlDate(a.valuation_date),
    numOrNull(a.round_deal_value_yi),
    strOrNull(a.display_unit, 16) || 'yi',
    numOrNull(w.risk_free_rate),
    numOrNull(w.erp),
    numOrNull(w.beta),
    numOrNull(w.debt_equity),
    numOrNull(w.debt_cost),
    numOrNull(w.tax_rate),
  ]);
}

async function loadAssumptions(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_assumption WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  if (!rows.length) {
    const created = await caseCreatedAt(d, caseId);
    return { ...defaultAssumptions(), valuation_date: resolveValuationDate(null, created) };
  }
  const r = rows[0];
  const created = await caseCreatedAt(d, caseId);
  const valuationDate = resolveValuationDate(r.valuation_date, created);
  if (!parseYmd(r.valuation_date) && valuationDate) {
    await d.execute(
      'UPDATE valuation_assumption SET valuation_date = ? WHERE case_id = ? AND version_id = ?',
      [valuationDate, caseId, versionId]
    );
  }
  return {
    discount_rate: numOrNull(r.discount_rate),
    exit_pe: numOrNull(r.exit_pe),
    exit_ps: numOrNull(r.exit_ps),
    liquidity_discount: numOrNull(r.liquidity_discount),
    dcf_liquidity_discount: numOrNull(r.dcf_liquidity_discount) ?? numOrNull(r.liquidity_discount) ?? 0.3,
    tax_rate: numOrNull(r.tax_rate),
    forecast_years: r.forecast_years == null ? 5 : Number(r.forecast_years),
    esop: numOrNull(r.esop) ?? 0,
    valuation_date: valuationDate,
    round_deal_value_yi: numOrNull(r.round_deal_value_yi),
    display_unit: r.display_unit || 'yi',
    wacc_breakdown: {
      risk_free_rate: numOrNull(r.wacc_risk_free_rate),
      erp: numOrNull(r.wacc_erp),
      beta: numOrNull(r.wacc_beta),
      debt_equity: numOrNull(r.wacc_debt_equity),
      debt_cost: numOrNull(r.wacc_debt_cost),
      tax_rate: numOrNull(r.wacc_tax_rate),
    },
  };
}

async function saveScenarios(caseId, versionId, scenarios, pool) {
  const d = wrapDb(pool);
  const set = { ...defaultScenarioSet(), ...(scenarios || {}) };
  await d.execute(
    'DELETE FROM valuation_scenario WHERE case_id = ? AND version_id = ?',
    [caseId, versionId]
  );
  for (const key of ['ma', 'ipo']) {
    const s = set[key] || {};
    const id = await generateId('valuation_scenario', d.idConn);
    await d.execute(
      `INSERT INTO valuation_scenario (
         F_Id, case_id, version_id, scenario_key, name, discount_rate, exit_pe, exit_ps, F_CreatorTime
       ) VALUES (?,?,?,?,?,?,?,?,NOW())`,
      [
        id, caseId, versionId, key,
        strOrNull(s.name, 64) || (key === 'ma' ? '并购预期' : '上市预期'),
        numOrNull(s.discount_rate),
        numOrNull(s.exit_pe),
        numOrNull(s.exit_ps),
      ]
    );
  }
}

async function loadScenarios(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT scenario_key, name, discount_rate, exit_pe, exit_ps
     FROM valuation_scenario WHERE case_id = ? AND version_id = ?`,
    [caseId, versionId]
  );
  if (!rows.length) return defaultScenarioSet();
  const out = defaultScenarioSet();
  for (const r of rows) {
    out[r.scenario_key] = {
      name: r.name,
      discount_rate: numOrNull(r.discount_rate),
      exit_pe: numOrNull(r.exit_pe),
      exit_ps: numOrNull(r.exit_ps),
    };
  }
  return out;
}

function bandYi(lowYuan, highYuan) {
  const low = numOrNull(lowYuan);
  const high = numOrNull(highYuan);
  const increment = low != null && high != null ? high - low : null;
  return {
    low,
    increment,
    high,
    display: {
      low: yuanToYi(low),
      increment: yuanToYi(increment),
      high: yuanToYi(high),
    },
  };
}

function applyBand(circulating, illiquid) {
  return {
    circulating: numOrNull(circulating),
    illiquid: numOrNull(illiquid),
    illiquid_yi: yuanToYi(illiquid),
  };
}

async function saveWarnings(caseId, versionId, warnings, pool) {
  const d = wrapDb(pool);
  await d.execute('DELETE FROM valuation_warning WHERE case_id = ? AND version_id = ?', [caseId, versionId]);
  const list = Array.isArray(warnings) ? warnings : [];
  for (let i = 0; i < list.length; i += 1) {
    const msg = strOrNull(list[i], 1000);
    if (!msg) continue;
    const id = await generateId('valuation_warning', d.idConn);
    await d.execute(
      `INSERT INTO valuation_warning (F_Id, case_id, version_id, line_no, message, F_CreatorTime)
       VALUES (?,?,?,?,?,NOW())`,
      [id, caseId, versionId, i, msg]
    );
  }
}

async function loadWarnings(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT message FROM valuation_warning WHERE case_id = ? AND version_id = ? ORDER BY line_no ASC`,
    [caseId, versionId]
  );
  return rows.map((r) => r.message).filter(Boolean);
}

async function saveCalcMeta(caseId, versionId, payload, pool) {
  const d = wrapDb(pool);
  const wacc = payload.wacc || {};
  const nd = payload.net_debt || {};
  await upsertByCaseVersion(d, 'valuation_calc_meta', caseId, versionId, [
    'last_job_id', 'amount_unit', 'sw_industry_l3',
    'wacc_rate', 'wacc_used_breakdown', 'wacc_ke', 'wacc_we', 'wacc_wd',
    'net_debt', 'net_debt_source',
    'industry_unavailable', 'industry_message',
    'relative_formula', 'dcf_formula',
  ], [
    strOrNull(payload.last_job_id, 19),
    strOrNull(payload.amount_unit, 16) || 'wan',
    strOrNull(payload.sw_industry_l3, 128),
    numOrNull(wacc.rate),
    wacc.used_breakdown ? 1 : 0,
    numOrNull(wacc.ke),
    numOrNull(wacc.we),
    numOrNull(wacc.wd),
    numOrNull(nd.net_debt),
    strOrNull(nd.source, 32),
    payload.industryUnavailable || payload.industryMultiples?.unavailable ? 1 : 0,
    strOrNull(payload.industryUnavailable || payload.industryMultiples?.message, 500),
    strOrNull(payload.sheets?.relative?.formula, 1000),
    strOrNull(payload.sheets?.dcf?.formula, 1000),
  ]);
}

async function loadCalcMeta(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_calc_meta WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  return rows[0] || null;
}

async function saveRelative(caseId, versionId, rows, pool) {
  const d = wrapDb(pool);
  await d.execute('DELETE FROM valuation_relative_row WHERE case_id = ? AND version_id = ?', [caseId, versionId]);
  for (const r of rows || []) {
    const id = await generateId('valuation_relative_row', d.idConn);
    await d.execute(
      `INSERT INTO valuation_relative_row (
         F_Id, case_id, version_id, stock_code, stock_name, in_pool,
         pe_latest, pe_median, pe_median_override, pe_stdev, pe_minus_1s, pe_plus_1s, pe_usable,
         ps_latest, ps_median, ps_median_override, ps_stdev, ps_minus_1s, ps_plus_1s, ps_usable,
         asof_date, asof_trade_date, quality_warning, F_CreatorTime
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        id, caseId, versionId,
        strOrNull(r.stock_code, 32),
        strOrNull(r.stock_name, 200),
        r.in_pool ? 1 : 0,
        numOrNull(r.pe_latest), numOrNull(r.pe_median), numOrNull(r.pe_median_override), numOrNull(r.pe_stdev),
        numOrNull(r.pe_minus_1s), numOrNull(r.pe_plus_1s), r.pe_usable === false ? 0 : 1,
        numOrNull(r.ps_latest), numOrNull(r.ps_median), numOrNull(r.ps_median_override), numOrNull(r.ps_stdev),
        numOrNull(r.ps_minus_1s), numOrNull(r.ps_plus_1s), r.ps_usable === false ? 0 : 1,
        sqlDate(r.asof_date),
        sqlDate(r.asof_trade_date),
        strOrNull(r.quality_warning, 500),
      ]
    );
  }
}

async function loadRelative(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_relative_row WHERE case_id = ? AND version_id = ? ORDER BY F_CreatorTime ASC`,
    [caseId, versionId]
  );
  return rows.map((r) => ({
    stock_code: r.stock_code,
    stock_name: r.stock_name,
    in_pool: Number(r.in_pool) === 1,
    pe_latest: numOrNull(r.pe_latest),
    pe_median: numOrNull(r.pe_median),
    pe_median_override: numOrNull(r.pe_median_override),
    pe_stdev: numOrNull(r.pe_stdev),
    pe_minus_1s: numOrNull(r.pe_minus_1s),
    pe_plus_1s: numOrNull(r.pe_plus_1s),
    pe_usable: Number(r.pe_usable) === 1,
    ps_latest: numOrNull(r.ps_latest),
    ps_median: numOrNull(r.ps_median),
    ps_median_override: numOrNull(r.ps_median_override),
    ps_stdev: numOrNull(r.ps_stdev),
    ps_minus_1s: numOrNull(r.ps_minus_1s),
    ps_plus_1s: numOrNull(r.ps_plus_1s),
    ps_usable: Number(r.ps_usable) === 1,
    asof_date: sqlDate(r.asof_date),
    asof_trade_date: sqlDate(r.asof_trade_date),
    quality_warning: r.quality_warning || null,
  }));
}

async function saveRatios(caseId, versionId, sheets, pool) {
  const d = wrapDb(pool);
  const fees = sheets?.fees?.payload || {};
  const gm = sheets?.gross_margin?.payload || {};
  const wc = sheets?.working_capital?.payload || {};
  await upsertByCaseVersion(d, 'valuation_ratio_summary', caseId, versionId, [
    'selling_median', 'admin_median', 'rd_median',
    'gm_set_median', 'dso_median', 'dpo_median', 'dio_median',
    'fees_formula', 'gm_formula', 'wc_formula',
  ], [
    numOrNull(fees.selling_median),
    numOrNull(fees.admin_median),
    numOrNull(fees.rd_median),
    numOrNull(gm.set_median),
    numOrNull(wc.dso_median),
    numOrNull(wc.dpo_median),
    numOrNull(wc.dio_median),
    strOrNull(sheets?.fees?.formula || fees.formula, 1000),
    strOrNull(sheets?.gross_margin?.formula || gm.formula, 1000),
    strOrNull(sheets?.working_capital?.formula || wc.formula, 1000),
  ]);

  await d.execute(
    `DELETE p FROM valuation_gross_margin_period p
     INNER JOIN valuation_gross_margin_row r ON r.F_Id = p.row_id
     WHERE r.case_id = ? AND r.version_id = ?`,
    [caseId, versionId]
  );
  await d.execute('DELETE FROM valuation_gross_margin_row WHERE case_id = ? AND version_id = ?', [caseId, versionId]);
  for (const c of gm.companies || []) {
    const rid = await generateId('valuation_gross_margin_row', d.idConn);
    await d.execute(
      `INSERT INTO valuation_gross_margin_row (
         F_Id, case_id, version_id, stock_code, stock_name, latest_gm, median_gm, F_CreatorTime
       ) VALUES (?,?,?,?,?,?,?,NOW())`,
      [
        rid, caseId, versionId,
        strOrNull(c.stock_code, 32),
        strOrNull(c.stock_name, 200),
        numOrNull(c.latest),
        numOrNull(c.median),
      ]
    );
    const periods = Array.isArray(c.gross_margins) ? c.gross_margins : [];
    const byYear = c.by_year && typeof c.by_year === 'object' ? c.by_year : null;
    const rows = periods.length
      ? periods.map((item, i) => {
          if (item != null && typeof item === 'object') {
            return { year: strOrNull(item.year, 16), value: numOrNull(item.value) };
          }
          return { year: null, value: numOrNull(item), seq: i };
        })
      : Object.entries(byYear || {}).map(([year, value]) => ({ year, value: numOrNull(value) }));
    for (let i = 0; i < rows.length; i += 1) {
      const pid = await generateId('valuation_gross_margin_period', d.idConn);
      await d.execute(
        `INSERT INTO valuation_gross_margin_period (F_Id, row_id, seq_no, fiscal_year, gross_margin, F_CreatorTime)
         VALUES (?,?,?,?,?,NOW())`,
        [pid, rid, i, rows[i].year, rows[i].value]
      );
    }
  }
}

async function loadRatios(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const sum = await d.query(
    `SELECT * FROM valuation_ratio_summary WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  const companies = await d.query(
    `SELECT * FROM valuation_gross_margin_row WHERE case_id = ? AND version_id = ?`,
    [caseId, versionId]
  );
  const outCompanies = [];
  for (const c of companies) {
    const periods = await d.query(
      `SELECT fiscal_year, gross_margin FROM valuation_gross_margin_period WHERE row_id = ? ORDER BY seq_no ASC`,
      [c.F_Id]
    );
    const byYear = {};
    const grossMargins = periods.map((p) => {
      const year = p.fiscal_year ? String(p.fiscal_year) : null;
      const value = numOrNull(p.gross_margin);
      if (year && value != null) byYear[year] = value;
      return year ? { year, value } : value;
    });
    outCompanies.push({
      stock_code: c.stock_code,
      stock_name: c.stock_name,
      latest: numOrNull(c.latest_gm),
      median: numOrNull(c.median_gm),
      gross_margins: grossMargins,
      by_year: byYear,
    });
  }
  const s = sum[0];
  if (!s && !outCompanies.length) {
    return { fees: null, gross_margin: null, working_capital: null };
  }
  const row = s || {};
  return {
    fees: {
      title: '三费',
      payload: {
        selling_median: numOrNull(row.selling_median),
        admin_median: numOrNull(row.admin_median),
        rd_median: numOrNull(row.rd_median),
      },
      formula: row.fees_formula || null,
    },
    gross_margin: {
      title: '毛利',
      payload: {
        companies: outCompanies,
        set_median: numOrNull(row.gm_set_median),
      },
      formula: row.gm_formula || null,
    },
    working_capital: {
      title: '营运',
      payload: {
        dso_median: numOrNull(row.dso_median),
        dpo_median: numOrNull(row.dpo_median),
        dio_median: numOrNull(row.dio_median),
      },
      formula: row.wc_formula || null,
    },
  };
}

async function saveMarket(caseId, versionId, market, formula, pool) {
  if (!market) return;
  const d = wrapDb(pool);
  const pe = market.pe || {};
  const ps = market.ps || {};
  const peM = market.pe_multiples || {};
  const psM = market.ps_multiples || {};
  await upsertByCaseVersion(d, 'valuation_market_result', caseId, versionId, [
    'base_year', 'revenue_base', 'operating_profit_base', 'liquidity_discount',
    'pe_min', 'pe_median', 'pe_max', 'ps_min', 'ps_median', 'ps_max',
    'pe_low_circ', 'pe_low_illiq', 'pe_mid_circ', 'pe_mid_illiq', 'pe_high_circ', 'pe_high_illiq',
    'ps_low_circ', 'ps_low_illiq', 'ps_mid_circ', 'ps_mid_illiq', 'ps_high_circ', 'ps_high_illiq',
    'formula',
  ], [
    strOrNull(market.base_year, 16),
    numOrNull(market.revenue_base),
    numOrNull(market.operating_profit_base),
    numOrNull(market.liquidity_discount),
    numOrNull(peM.min), numOrNull(peM.median), numOrNull(peM.max),
    numOrNull(psM.min), numOrNull(psM.median), numOrNull(psM.max),
    numOrNull(pe.low?.circulating), numOrNull(pe.low?.illiquid),
    numOrNull(pe.mid?.circulating), numOrNull(pe.mid?.illiquid),
    numOrNull(pe.high?.circulating), numOrNull(pe.high?.illiquid),
    numOrNull(ps.low?.circulating), numOrNull(ps.low?.illiquid),
    numOrNull(ps.mid?.circulating), numOrNull(ps.mid?.illiquid),
    numOrNull(ps.high?.circulating), numOrNull(ps.high?.illiquid),
    strOrNull(formula || market.formula, 1000),
  ]);
}

async function loadMarket(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_market_result WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    title: '市场法',
    formula: r.formula || null,
    payload: {
      base_year: r.base_year,
      revenue_base: numOrNull(r.revenue_base),
      operating_profit_base: numOrNull(r.operating_profit_base),
      liquidity_discount: numOrNull(r.liquidity_discount),
      pe_multiples: { min: numOrNull(r.pe_min), median: numOrNull(r.pe_median), max: numOrNull(r.pe_max) },
      ps_multiples: { min: numOrNull(r.ps_min), median: numOrNull(r.ps_median), max: numOrNull(r.ps_max) },
      pe: {
        low: applyBand(r.pe_low_circ, r.pe_low_illiq),
        mid: applyBand(r.pe_mid_circ, r.pe_mid_illiq),
        high: applyBand(r.pe_high_circ, r.pe_high_illiq),
      },
      ps: {
        low: applyBand(r.ps_low_circ, r.ps_low_illiq),
        mid: applyBand(r.ps_mid_circ, r.ps_mid_illiq),
        high: applyBand(r.ps_high_circ, r.ps_high_illiq),
      },
    },
  };
}

function comparisonColumns(c) {
  const dual = !!(c && c.dcf && c.dcf.ma);
  return [
    numOrNull(c?.market_ps?.low),
    numOrNull(c?.market_ps?.high),
    numOrNull(c?.market_pe?.low),
    numOrNull(c?.market_pe?.high),
    dual ? 1 : 0,
    dual ? numOrNull(c.dcf.ma.low) : numOrNull(c?.dcf?.low),
    dual ? numOrNull(c.dcf.ma.high) : numOrNull(c?.dcf?.high),
    dual ? numOrNull(c.dcf.ipo?.low) : null,
    dual ? numOrNull(c.dcf.ipo?.high) : null,
    strOrNull(c?.dcf?.ma?.name, 64),
    strOrNull(c?.dcf?.ipo?.name, 64),
    strOrNull(c?.formula, 1000),
  ];
}

function comparisonFromRow(r) {
  if (!r) return null;
  const dual = Number(r.scenario_dual) === 1;
  const ps = bandYi(r.market_ps_low, r.market_ps_high);
  const pe = bandYi(r.market_pe_low, r.market_pe_high);
  let dcf;
  let dcfYi;
  if (dual) {
    const ma = bandYi(r.dcf_low, r.dcf_high);
    const ipo = bandYi(r.dcf_ipo_low, r.dcf_ipo_high);
    dcf = {
      ma: { low: ma.low, increment: ma.increment, high: ma.high, name: r.dcf_ma_name || '并购预期' },
      ipo: { low: ipo.low, increment: ipo.increment, high: ipo.high, name: r.dcf_ipo_name || '上市预期' },
    };
    dcfYi = { ma: ma.display, ipo: ipo.display };
  } else {
    const one = bandYi(r.dcf_low, r.dcf_high);
    dcf = { low: one.low, increment: one.increment, high: one.high };
    dcfYi = one.display;
  }
  return {
    rows: ['low', 'increment', 'high'],
    market_ps: { low: ps.low, increment: ps.increment, high: ps.high },
    market_pe: { low: pe.low, increment: pe.increment, high: pe.high },
    dcf,
    display_yi: {
      market_ps: ps.display,
      market_pe: pe.display,
      dcf: dcfYi,
    },
    formula: r.formula || '增量=高端−低端（堆叠区间，不是第三种方法）',
  };
}

async function saveComparison(caseId, versionId, comparison, pool) {
  if (!comparison) return;
  const d = wrapDb(pool);
  await upsertByCaseVersion(d, 'valuation_comparison', caseId, versionId, [
    'market_ps_low', 'market_ps_high', 'market_pe_low', 'market_pe_high',
    'scenario_dual', 'dcf_low', 'dcf_high', 'dcf_ipo_low', 'dcf_ipo_high',
    'dcf_ma_name', 'dcf_ipo_name', 'formula',
  ], comparisonColumns(comparison));
}

async function loadComparison(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_comparison WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  return comparisonFromRow(rows[0]);
}

async function saveDcfRun(d, caseId, versionId, role, dcf, extras) {
  if (!dcf) return;
  const id = await generateId('valuation_dcf_run', d.idConn);
  await d.execute(
    `INSERT INTO valuation_dcf_run (
       F_Id, case_id, version_id, role_key, scenario_name, discount_rate,
       equity_value, enterprise_value, net_debt, terminal_value, terminal_pv,
       terminal_base, exit_multiple, fcf_method, terminal_type,
       sens_row_kind, sens_col_kind, sens_low, sens_high, formula, F_CreatorTime
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
    [
      id, caseId, versionId, role,
      strOrNull(dcf.scenario_name, 64),
      numOrNull(dcf.discount_rate),
      numOrNull(dcf.equity_value),
      numOrNull(dcf.enterprise_value),
      numOrNull(dcf.net_debt),
      numOrNull(dcf.terminal_value),
      numOrNull(dcf.terminal_pv),
      numOrNull(dcf.terminal_base),
      numOrNull(dcf.exit_multiple),
      strOrNull(extras?.fcf_method, 32),
      strOrNull(extras?.terminal_type, 32),
      strOrNull(dcf.sensitivity?.row_kind, 16),
      strOrNull(dcf.sensitivity?.col_kind, 16),
      numOrNull(dcf.sensitivity?.low),
      numOrNull(dcf.sensitivity?.high),
      strOrNull(extras?.formula, 1000),
    ]
  );
  for (let i = 0; i < (dcf.pvs || []).length; i += 1) {
    const p = dcf.pvs[i];
    const yid = await generateId('valuation_dcf_year', d.idConn);
    await d.execute(
      `INSERT INTO valuation_dcf_year (F_Id, run_id, line_no, fiscal_year, fcf, factor, pv, F_CreatorTime)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [yid, id, i, strOrNull(p.year, 16), numOrNull(p.fcf), numOrNull(p.factor), numOrNull(p.pv)]
    );
  }
  const sens = dcf.sensitivity || {};
  const grid = Array.isArray(sens.grid) ? sens.grid : [];
  const rowLabels = sens.row_labels || [];
  const colLabels = sens.col_labels || [];
  for (let i = 0; i < grid.length; i += 1) {
    const row = grid[i] || [];
    for (let j = 0; j < row.length; j += 1) {
      const cid = await generateId('valuation_dcf_sens_cell', d.idConn);
      await d.execute(
        `INSERT INTO valuation_dcf_sens_cell (
           F_Id, run_id, row_idx, col_idx, row_value, col_value, equity_value, F_CreatorTime
         ) VALUES (?,?,?,?,?,?,?,NOW())`,
        [cid, id, i, j, numOrNull(rowLabels[i]), numOrNull(colLabels[j]), numOrNull(row[j])]
      );
    }
  }
}

async function saveDcf(caseId, versionId, dcfSheet, pool) {
  const payload = dcfSheet?.payload;
  if (!payload?.primary) return;
  const d = wrapDb(pool);
  const runs = await d.query(
    'SELECT F_Id FROM valuation_dcf_run WHERE case_id = ? AND version_id = ?',
    [caseId, versionId]
  );
  for (const r of runs) {
    await d.execute('DELETE FROM valuation_dcf_year WHERE run_id = ?', [r.F_Id]);
    await d.execute('DELETE FROM valuation_dcf_sens_cell WHERE run_id = ?', [r.F_Id]);
  }
  await d.execute('DELETE FROM valuation_dcf_run WHERE case_id = ? AND version_id = ?', [caseId, versionId]);
  const extras = {
    fcf_method: payload.fcf_method,
    terminal_type: payload.terminal_type,
    formula: dcfSheet.formula,
  };
  await saveDcfRun(d, caseId, versionId, 'primary', payload.primary, extras);
  if (payload.secondary) await saveDcfRun(d, caseId, versionId, 'secondary', payload.secondary, extras);
}

async function loadOneDcf(d, run) {
  const years = await d.query(
    `SELECT fiscal_year, fcf, factor, pv FROM valuation_dcf_year WHERE run_id = ? ORDER BY line_no ASC`,
    [run.F_Id]
  );
  const cells = await d.query(
    `SELECT row_idx, col_idx, row_value, col_value, equity_value
     FROM valuation_dcf_sens_cell WHERE run_id = ? ORDER BY row_idx ASC, col_idx ASC`,
    [run.F_Id]
  );
  let sensitivity = null;
  if (cells.length) {
    const maxR = Math.max(...cells.map((c) => Number(c.row_idx)));
    const maxC = Math.max(...cells.map((c) => Number(c.col_idx)));
    const grid = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(null));
    const rowLabels = Array(maxR + 1).fill(null);
    const colLabels = Array(maxC + 1).fill(null);
    for (const c of cells) {
      const i = Number(c.row_idx);
      const j = Number(c.col_idx);
      grid[i][j] = numOrNull(c.equity_value);
      rowLabels[i] = numOrNull(c.row_value);
      colLabels[j] = numOrNull(c.col_value);
    }
    sensitivity = {
      row_kind: run.sens_row_kind,
      col_kind: run.sens_col_kind,
      row_labels: rowLabels,
      col_labels: colLabels,
      grid,
      low: numOrNull(run.sens_low),
      high: numOrNull(run.sens_high),
    };
  }
  const equity = numOrNull(run.equity_value);
  return {
    scenario_name: run.scenario_name,
    discount_rate: numOrNull(run.discount_rate),
    equity_value: equity,
    equity_value_yi: yuanToYi(equity),
    enterprise_value: numOrNull(run.enterprise_value),
    net_debt: numOrNull(run.net_debt),
    terminal_value: numOrNull(run.terminal_value),
    terminal_pv: numOrNull(run.terminal_pv),
    terminal_base: numOrNull(run.terminal_base),
    terminal_base_kind: run.terminal_type === 'exit_ps' ? 'revenue' : 'net_income',
    terminal_year: years.length ? years[years.length - 1].fiscal_year : null,
    terminal_type: run.terminal_type || null,
    exit_multiple: numOrNull(run.exit_multiple),
    pvs: years.map((y) => ({
      year: y.fiscal_year,
      fcf: numOrNull(y.fcf),
      factor: numOrNull(y.factor),
      pv: numOrNull(y.pv),
    })),
    fcf: years.map((y) => numOrNull(y.fcf)),
    sensitivity,
  };
}

async function loadDcf(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const runs = await d.query(
    `SELECT * FROM valuation_dcf_run WHERE case_id = ? AND version_id = ?`,
    [caseId, versionId]
  );
  if (!runs.length) return null;
  const primaryRow = runs.find((r) => r.role_key === 'primary') || runs[0];
  const secondaryRow = runs.find((r) => r.role_key === 'secondary');
  const primary = await loadOneDcf(d, primaryRow);
  const secondary = secondaryRow ? await loadOneDcf(d, secondaryRow) : null;
  const nopat = primaryRow.fcf_method === 'nopat_fcff';
  if (primary) primary.apply_liquidity = secondary ? true : nopat;
  if (secondary) secondary.apply_liquidity = false;
  return {
    title: 'DCF',
    formula: primaryRow.formula || null,
    payload: {
      primary,
      secondary,
      fcf_method: primaryRow.fcf_method,
      terminal_type: primaryRow.terminal_type,
    },
  };
}

async function saveForecastPl(caseId, versionId, pl, pool) {
  const d = wrapDb(pool);
  await d.execute('DELETE FROM valuation_forecast_pl_line WHERE case_id = ? AND version_id = ?', [caseId, versionId]);
  if (!pl || !Array.isArray(pl.years) || !pl.years.length) return;
  for (let i = 0; i < pl.years.length; i += 1) {
    const id = await generateId('valuation_forecast_pl_line', d.idConn);
    await d.execute(
      `INSERT INTO valuation_forecast_pl_line (
         F_Id, case_id, version_id, line_no, fiscal_year,
         revenue, cogs, gross_profit, selling, admin, rd, operating_profit, net_income, revenue_growth,
         F_CreatorTime
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        id, caseId, versionId, i, strOrNull(pl.years[i], 16),
        numOrNull(pl.revenue?.[i]), numOrNull(pl.cogs?.[i]), numOrNull(pl.gross_profit?.[i]),
        numOrNull(pl.selling?.[i]), numOrNull(pl.admin?.[i]), numOrNull(pl.rd?.[i]),
        numOrNull(pl.operating_profit?.[i]), numOrNull(pl.net_income?.[i]), numOrNull(pl.revenue_growth?.[i]),
      ]
    );
  }
}

async function loadForecastPl(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_forecast_pl_line WHERE case_id = ? AND version_id = ? ORDER BY line_no ASC`,
    [caseId, versionId]
  );
  if (!rows.length) return null;
  const pl = {
    years: [], revenue: [], cogs: [], gross_profit: [], selling: [], admin: [], rd: [],
    operating_profit: [], net_income: [], revenue_growth: [],
  };
  for (const r of rows) {
    pl.years.push(r.fiscal_year);
    pl.revenue.push(numOrNull(r.revenue));
    pl.cogs.push(numOrNull(r.cogs));
    pl.gross_profit.push(numOrNull(r.gross_profit));
    pl.selling.push(numOrNull(r.selling));
    pl.admin.push(numOrNull(r.admin));
    pl.rd.push(numOrNull(r.rd));
    pl.operating_profit.push(numOrNull(r.operating_profit));
    pl.net_income.push(numOrNull(r.net_income));
    pl.revenue_growth.push(numOrNull(r.revenue_growth));
  }
  return pl;
}

async function saveIndustry(caseId, versionId, industry, formula, pool) {
  if (!industry) return;
  const d = wrapDb(pool);
  await upsertByCaseVersion(d, 'valuation_industry_result', caseId, versionId, [
    'unavailable', 'message', 'sw_industry_l3', 'trade_date', 'stat_method',
    'pe_median', 'ps_median', 'pe_min', 'pe_max', 'ps_min', 'ps_max', 'formula',
  ], [
    industry.unavailable ? 1 : 0,
    strOrNull(industry.message, 500),
    strOrNull(industry.sw_industry_l3, 128),
    sqlDate(industry.trade_date),
    strOrNull(industry.stat_method, 16),
    numOrNull(industry.pe_median),
    numOrNull(industry.ps_median),
    numOrNull(industry.pe_min),
    numOrNull(industry.pe_max),
    numOrNull(industry.ps_min),
    numOrNull(industry.ps_max),
    strOrNull(formula, 1000),
  ]);
}

async function loadIndustry(caseId, versionId, pool) {
  const d = wrapDb(pool);
  const rows = await d.query(
    `SELECT * FROM valuation_industry_result WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const payload = Number(r.unavailable) === 1
    ? { unavailable: true, message: r.message }
    : {
      sw_industry_l3: r.sw_industry_l3,
      trade_date: sqlDate(r.trade_date),
      stat_method: r.stat_method,
      pe_median: numOrNull(r.pe_median),
      ps_median: numOrNull(r.ps_median),
      pe_min: numOrNull(r.pe_min),
      pe_max: numOrNull(r.pe_max),
      ps_min: numOrNull(r.ps_min),
      ps_max: numOrNull(r.ps_max),
    };
  return { title: '行业倍数', payload, formula: r.formula || null };
}

async function saveWorkspace(caseId, versionId, payload, pool) {
  const vid = versionId || DRAFT_VERSION_ID;
  const p = payload || {};
  if (p.methodConfig) await saveMethod(caseId, vid, p.methodConfig, pool);
  if (p.assumptions) await saveAssumptions(caseId, vid, p.assumptions, pool);
  if (p.scenarios) await saveScenarios(caseId, vid, p.scenarios, pool);
  if (Array.isArray(p.warnings)) await saveWarnings(caseId, vid, p.warnings, pool);
  if (p.wacc || p.net_debt || p.last_job_id || p.sw_industry_l3 != null || p.amount_unit || p.sheets) {
    await saveCalcMeta(caseId, vid, p, pool);
  }
  const sheets = p.sheets || {};
  if (sheets.relative || Array.isArray(p.compStats?.relative)) {
    await saveRelative(caseId, vid, sheets.relative?.payload || p.compStats?.relative || [], pool);
  }
  if (sheets.fees || sheets.gross_margin || sheets.working_capital) {
    await saveRatios(caseId, vid, sheets, pool);
  }
  if (sheets.market?.payload) await saveMarket(caseId, vid, sheets.market.payload, sheets.market.formula, pool);
  if (p.comparison || sheets.result_compare?.payload) {
    await saveComparison(caseId, vid, p.comparison || sheets.result_compare.payload, pool);
  }
  if (sheets.dcf) await saveDcf(caseId, vid, sheets.dcf, pool);
  if (sheets.target_pl?.payload) await saveForecastPl(caseId, vid, sheets.target_pl.payload, pool);
  const industry = sheets.industry?.payload || p.industryMultiples;
  if (industry) await saveIndustry(caseId, vid, industry, sheets.industry?.formula, pool);
}

async function loadWorkspace(caseId, versionId, pool) {
  const vid = versionId || DRAFT_VERSION_ID;
  const methodConfig = await loadMethod(caseId, vid, pool);
  const assumptions = await loadAssumptions(caseId, vid, pool);
  const scenarios = await loadScenarios(caseId, vid, pool);
  const warnings = await loadWarnings(caseId, vid, pool);
  const meta = await loadCalcMeta(caseId, vid, pool);
  const relative = await loadRelative(caseId, vid, pool);
  const ratios = await loadRatios(caseId, vid, pool);
  const market = await loadMarket(caseId, vid, pool);
  const comparison = await loadComparison(caseId, vid, pool);
  const dcf = await loadDcf(caseId, vid, pool);
  const forecastPl = await loadForecastPl(caseId, vid, pool);
  const industry = await loadIndustry(caseId, vid, pool);

  const sheets = {};
  if (comparison) {
    sheets.result_compare = { title: '结果对比', payload: comparison, formula: comparison.formula };
  }
  if (dcf) sheets.dcf = dcf;
  if (market) sheets.market = market;
  if (relative.length) {
    sheets.relative = {
      title: '相对估值',
      payload: relative,
      formula: meta?.relative_formula || '公司：最新倍数、历史中位数、标准差、±1σ',
    };
  }
  if (ratios.fees) sheets.fees = ratios.fees;
  if (ratios.gross_margin) sheets.gross_margin = ratios.gross_margin;
  if (ratios.working_capital) sheets.working_capital = ratios.working_capital;
  if (forecastPl) {
    sheets.target_pl = {
      title: '标的利润表',
      payload: forecastPl,
      formula: '预测期默认 5 年；可只填前 2 年，其后用收入增速与费用率外推',
    };
  }
  if (industry) sheets.industry = industry;

  const wacc = meta
    ? {
      rate: numOrNull(meta.wacc_rate),
      used_breakdown: Number(meta.wacc_used_breakdown) === 1,
      ke: numOrNull(meta.wacc_ke),
      we: numOrNull(meta.wacc_we),
      wd: numOrNull(meta.wacc_wd),
    }
    : null;
  const net_debt = meta
    ? { net_debt: numOrNull(meta.net_debt), source: meta.net_debt_source || null }
    : null;

  return {
    methodConfig,
    assumptions,
    scenarios,
    warnings,
    sheets: Object.keys(sheets).length ? sheets : null,
    comparison,
    wacc,
    net_debt,
    sw_industry_l3: meta?.sw_industry_l3 || '',
    last_job_id: meta?.last_job_id || null,
    amount_unit: meta?.amount_unit || 'wan',
    industryUnavailable: meta?.industry_unavailable ? (meta.industry_message || '行业倍数不可用') : null,
  };
}

async function listColumns(pool, table) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set((rows || []).map((r) => r.COLUMN_NAME));
}

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return !!(rows && rows.length);
}

async function migrateValuationJsonStores(pool) {
  if (await tableExists(pool, 'valuation_case')) {
    const cols = await listColumns(pool, 'valuation_case');
    if (cols.has('method_config_json')) {
      const [rows] = await pool.query(
        'SELECT F_Id, method_config_json FROM valuation_case WHERE method_config_json IS NOT NULL'
      );
      for (const r of rows || []) {
        await saveMethod(r.F_Id, DRAFT_VERSION_ID, parseJson(r.method_config_json, null), pool);
      }
    }
  }

  if (await tableExists(pool, 'valuation_draft')) {
    const cols = await listColumns(pool, 'valuation_draft');
    if (cols.has('payload_json')) {
      const [rows] = await pool.query(
        'SELECT case_id, payload_json FROM valuation_draft WHERE payload_json IS NOT NULL'
      );
      const { saveTargetFinancials } = require('./targetFinancials');
      for (const r of rows || []) {
        const p = parseJson(r.payload_json, null);
        if (!p || typeof p !== 'object') continue;
        await saveWorkspace(r.case_id, DRAFT_VERSION_ID, p, pool);
        if (p.targetPl || p.targetBs || p.targetCf || p.overrides) {
          await saveTargetFinancials(r.case_id, DRAFT_VERSION_ID, p, pool);
        }
      }
    }
  }

  if (await tableExists(pool, 'valuation_version')) {
    const cols = await listColumns(pool, 'valuation_version');
    const selectCols = ['F_Id', 'case_id'];
    if (cols.has('method_config_json')) selectCols.push('method_config_json');
    if (cols.has('assumptions_json')) selectCols.push('assumptions_json');
    if (cols.has('conclusion_json')) selectCols.push('conclusion_json');
    if (selectCols.length > 2) {
      const [vers] = await pool.query(`SELECT ${selectCols.join(', ')} FROM valuation_version`);
      for (const v of vers || []) {
        if (v.method_config_json) {
          await saveMethod(v.case_id, v.F_Id, parseJson(v.method_config_json, null), pool);
        }
        if (v.assumptions_json) {
          await saveAssumptions(v.case_id, v.F_Id, parseJson(v.assumptions_json, null), pool);
        }
        if (v.conclusion_json) {
          await saveComparison(v.case_id, v.F_Id, parseJson(v.conclusion_json, null), pool);
        }
      }
    }
  }

  if (await tableExists(pool, 'valuation_version_sheet')) {
    const [sheets] = await pool.query(
      `SELECT s.version_id, s.sheet_key, s.sheet_title, s.payload_json, s.formula_notes_json, v.case_id
       FROM valuation_version_sheet s
       INNER JOIN valuation_version v ON v.F_Id = s.version_id`
    );
    const byVer = new Map();
    for (const s of sheets || []) {
      if (!byVer.has(s.version_id)) byVer.set(s.version_id, { caseId: s.case_id, sheets: {} });
      const formula = parseJson(s.formula_notes_json, {})?.formula || null;
      byVer.get(s.version_id).sheets[s.sheet_key] = {
        title: s.sheet_title,
        payload: parseJson(s.payload_json, null),
        formula,
      };
    }
    for (const [vid, pack] of byVer.entries()) {
      await saveWorkspace(pack.caseId, vid, { sheets: pack.sheets }, pool);
    }
  }
}

module.exports = {
  DRAFT_VERSION_ID,
  saveWorkspace,
  loadWorkspace,
  loadMethod,
  saveMethod,
  loadComparison,
  comparisonFromRow,
  migrateValuationJsonStores,
  listColumns,
  tableExists,
};
