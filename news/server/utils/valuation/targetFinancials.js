const db = require('../../db');
const { generateId } = require('../idGenerator');
const {
  toNumber,
  prepareAmountsForEngine,
  alignAssumptionMoney,
} = require('./marketUtils');
const { BS_INPUT_KEYS, pickBsSnapshot, normalizeBs } = require('./targetBsFields');

const DRAFT_VERSION_ID = '0';

const PL_KEYS = ['revenue', 'cogs', 'selling', 'admin', 'rd', 'finance_expense', 'operating_profit', 'net_income'];
const PL_RATIO_KEYS = [
  'cogs_ratio', 'surtax_ratio', 'selling_ratio', 'admin_ratio', 'rd_ratio', 'finance_expense_ratio',
  'other_income_ratio', 'other_ratio', 'da_ratio', 'capex_ratio',
  'dso', 'dpo', 'dio',
];
const OV_KEYS = ['da', 'capex', 'dnwc', 'net_debt'];
const CF_KEYS = ['da', 'capex', 'dnwc'];

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

function hasPlInput(pl) {
  if (!pl) return false;
  const years = Array.isArray(pl.years) ? pl.years.filter((y) => y != null && String(y).trim() !== '') : [];
  if (years.length) return true;
  return PL_KEYS.some((k) => Array.isArray(pl[k]) && pl[k].some((v) => toNumber(v) != null));
}

async function replacePlLines(caseId, versionId, plYuan, pool) {
  const d = wrapDb(pool);
  await d.execute(
    'DELETE FROM valuation_target_pl_line WHERE case_id = ? AND version_id = ?',
    [caseId, versionId]
  );
  const years = Array.isArray(plYuan?.years) ? plYuan.years : [];
  const n = Math.max(
    years.length,
    ...PL_KEYS.map((k) => (Array.isArray(plYuan?.[k]) ? plYuan[k].length : 0)),
    ...PL_RATIO_KEYS.map((k) => (Array.isArray(plYuan?.[k]) ? plYuan[k].length : 0)),
    Array.isArray(plYuan?.revenue_growth) ? plYuan.revenue_growth.length : 0
  );
  for (let i = 0; i < n; i += 1) {
    const year = years[i] != null && String(years[i]).trim() !== ''
      ? String(years[i]).trim().slice(0, 16)
      : String(2026 + i);
    const id = await generateId('valuation_target_pl_line', d.idConn);
    await d.execute(
      `INSERT INTO valuation_target_pl_line (
         F_Id, case_id, version_id, line_no, fiscal_year,
         revenue, cogs, gross_profit, selling, admin, rd, finance_expense, operating_profit, net_income, revenue_growth,
         cogs_ratio, surtax_ratio, selling_ratio, admin_ratio, rd_ratio, finance_expense_ratio,
         other_income_ratio, other_ratio, da_ratio, capex_ratio, dso, dpo, dio,
         F_CreatorTime, F_LastModifyTime
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        id,
        caseId,
        versionId,
        i,
        year,
        numOrNull(plYuan.revenue?.[i]),
        numOrNull(plYuan.cogs?.[i]),
        numOrNull(plYuan.gross_profit?.[i]),
        numOrNull(plYuan.selling?.[i]),
        numOrNull(plYuan.admin?.[i]),
        numOrNull(plYuan.rd?.[i]),
        numOrNull(plYuan.finance_expense?.[i]),
        numOrNull(plYuan.operating_profit?.[i]),
        numOrNull(plYuan.net_income?.[i]),
        numOrNull(plYuan.revenue_growth?.[i]),
        numOrNull(plYuan.cogs_ratio?.[i]),
        numOrNull(plYuan.surtax_ratio?.[i]),
        numOrNull(plYuan.selling_ratio?.[i]),
        numOrNull(plYuan.admin_ratio?.[i]),
        numOrNull(plYuan.rd_ratio?.[i]),
        numOrNull(plYuan.finance_expense_ratio?.[i]),
        numOrNull(plYuan.other_income_ratio?.[i]),
        numOrNull(plYuan.other_ratio?.[i]),
        numOrNull(plYuan.da_ratio?.[i]),
        numOrNull(plYuan.capex_ratio?.[i]),
        numOrNull(plYuan.dso?.[i]),
        numOrNull(plYuan.dpo?.[i]),
        numOrNull(plYuan.dio?.[i]),
      ]
    );
  }
}

const FORECAST_PL_AMOUNT_KEYS = ['revenue', 'cogs', 'surtax', 'selling', 'admin', 'rd', 'finance_expense', 'other_income', 'other', 'da', 'capex'];

function forecastPlJson(forecastPl) {
  if (!forecastPl || typeof forecastPl !== 'object' || Array.isArray(forecastPl)) return null;
  const cleaned = {};
  Object.entries(forecastPl).forEach(([year, row]) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const next = {};
    FORECAST_PL_AMOUNT_KEYS.forEach((key) => {
      const n = numOrNull(row[key]);
      if (n != null) next[key] = n;
    });
    const manual = Array.isArray(row.manual)
      ? row.manual.filter((key) => FORECAST_PL_AMOUNT_KEYS.includes(key) && next[key] != null)
      : [];
    if (manual.length) next.manual = manual;
    if (Object.keys(next).length) cleaned[String(year)] = next;
  });
  return Object.keys(cleaned).length ? JSON.stringify(cleaned) : null;
}

function forecastBsJson(forecastBs) {
  if (!forecastBs || typeof forecastBs !== 'object' || Array.isArray(forecastBs)) return null;
  const cleaned = {};
  Object.entries(forecastBs).forEach(([year, row]) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const next = {};
    Object.entries(row).forEach(([key, value]) => {
      if (!BS_INPUT_KEYS.includes(key)) return;
      const n = numOrNull(value);
      if (n != null) next[key] = n;
    });
    if (Object.keys(next).length) cleaned[String(year)] = next;
  });
  return Object.keys(cleaned).length ? JSON.stringify(cleaned) : null;
}

function parseForecastBs(raw) {
  if (raw == null || raw === '') return {};
  const value = typeof raw === 'string' ? (() => {
    try { return JSON.parse(raw); } catch { return {}; }
  })() : raw;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function upsertBs(caseId, versionId, bsYuan, netDebtOverride, forecastBs, forecastPl, pool) {
  const d = wrapDb(pool);
  const exist = await d.query(
    'SELECT F_Id FROM valuation_target_bs WHERE case_id = ? AND version_id = ? LIMIT 1',
    [caseId, versionId]
  );
  const snap = pickBsSnapshot(normalizeBs(bsYuan));
  const forecastJson = forecastBsJson(forecastBs);
  const forecastPlStored = forecastPlJson(forecastPl);
  const vals = BS_INPUT_KEYS.map((k) => numOrNull(snap[k]));
  vals.push(numOrNull(netDebtOverride), forecastJson, forecastPlStored);
  const colSql = [...BS_INPUT_KEYS, 'net_debt_override', 'forecast_json', 'forecast_pl_json'].join(', ');
  const setSql = [...BS_INPUT_KEYS, 'net_debt_override', 'forecast_json', 'forecast_pl_json'].map((k) => `${k}=?`).join(', ');
  if (exist.length) {
    await d.execute(
      `UPDATE valuation_target_bs SET ${setSql}, F_LastModifyTime=NOW() WHERE F_Id=?`,
      [...vals, exist[0].F_Id]
    );
    return;
  }
  const empty = vals.every((v) => v == null);
  if (empty) return;
  const id = await generateId('valuation_target_bs', d.idConn);
  const placeholders = vals.map(() => '?').join(',');
  await d.execute(
    `INSERT INTO valuation_target_bs (
       F_Id, case_id, version_id, ${colSql}, F_CreatorTime, F_LastModifyTime
     ) VALUES (?,?,?,${placeholders},NOW(),NOW())`,
    [id, caseId, versionId, ...vals]
  );
}

async function upsertCf(caseId, versionId, cfYuan, overridesYuan, pool) {
  const d = wrapDb(pool);
  const daDefault = numOrNull(overridesYuan?.da ?? cfYuan?.da_default);
  const capexDefault = numOrNull(overridesYuan?.capex ?? cfYuan?.capex_default);
  const dnwcDefault = numOrNull(overridesYuan?.dnwc ?? cfYuan?.dnwc_default);
  const exist = await d.query(
    'SELECT F_Id FROM valuation_target_cf WHERE case_id = ? AND version_id = ? LIMIT 1',
    [caseId, versionId]
  );
  if (exist.length) {
    await d.execute(
      `UPDATE valuation_target_cf SET da_default=?, capex_default=?, dnwc_default=?, F_LastModifyTime=NOW()
       WHERE F_Id=?`,
      [daDefault, capexDefault, dnwcDefault, exist[0].F_Id]
    );
  } else if (daDefault != null || capexDefault != null || dnwcDefault != null) {
    const id = await generateId('valuation_target_cf', d.idConn);
    await d.execute(
      `INSERT INTO valuation_target_cf (
         F_Id, case_id, version_id, da_default, capex_default, dnwc_default, F_CreatorTime, F_LastModifyTime
       ) VALUES (?,?,?,?,?,?,NOW(),NOW())`,
      [id, caseId, versionId, daDefault, capexDefault, dnwcDefault]
    );
  }

  await d.execute(
    'DELETE FROM valuation_target_cf_line WHERE case_id = ? AND version_id = ?',
    [caseId, versionId]
  );
  const years = Array.isArray(cfYuan?.years) ? cfYuan.years : [];
  const n = Math.max(
    years.length,
    Array.isArray(cfYuan?.da) ? cfYuan.da.length : 0,
    Array.isArray(cfYuan?.capex) ? cfYuan.capex.length : 0,
    Array.isArray(cfYuan?.dnwc) ? cfYuan.dnwc.length : 0
  );
  for (let i = 0; i < n; i += 1) {
    const id = await generateId('valuation_target_cf_line', d.idConn);
    await d.execute(
      `INSERT INTO valuation_target_cf_line (
         F_Id, case_id, version_id, line_no, fiscal_year, da, capex, dnwc, F_CreatorTime, F_LastModifyTime
       ) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        id,
        caseId,
        versionId,
        i,
        years[i] != null ? String(years[i]).slice(0, 16) : null,
        numOrNull(cfYuan.da?.[i]),
        numOrNull(cfYuan.capex?.[i]),
        numOrNull(cfYuan.dnwc?.[i]),
      ]
    );
  }
}

async function saveTargetFinancials(caseId, versionId, payload, pool) {
  const vid = versionId || DRAFT_VERSION_ID;
  const yuan = prepareAmountsForEngine(payload || {});
  await replacePlLines(caseId, vid, yuan.targetPl || {}, pool);
  await upsertBs(caseId, vid, yuan.targetBs || {}, yuan.overrides?.net_debt, payload?.forecastBs, payload?.forecastPl, pool);
  await upsertCf(caseId, vid, yuan.targetCf || {}, yuan.overrides || {}, pool);
}

function normalizeFiscalYear(y, i) {
  const s = String(y == null ? '' : y).trim();
  if (/^\d{4}/.test(s)) return s.slice(0, 4);
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 30 && n < 1900) return String(2026 + i);
  return s || String(2026 + i);
}

function linesToPl(rows) {
  const sorted = [...rows].sort((a, b) => Number(a.line_no) - Number(b.line_no));
  const pl = {
    years: [],
    revenue: [],
    cogs: [],
    gross_profit: [],
    selling: [],
    admin: [],
    rd: [],
    finance_expense: [],
    operating_profit: [],
    net_income: [],
    revenue_growth: [],
  };
  for (const k of PL_RATIO_KEYS) pl[k] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i];
    pl.years.push(normalizeFiscalYear(r.fiscal_year, i));
    pl.revenue.push(numOrNull(r.revenue));
    pl.cogs.push(numOrNull(r.cogs));
    pl.gross_profit.push(numOrNull(r.gross_profit));
    pl.selling.push(numOrNull(r.selling));
    pl.admin.push(numOrNull(r.admin));
    pl.rd.push(numOrNull(r.rd));
    pl.finance_expense.push(numOrNull(r.finance_expense));
    pl.operating_profit.push(numOrNull(r.operating_profit));
    pl.net_income.push(numOrNull(r.net_income));
    pl.revenue_growth.push(numOrNull(r.revenue_growth));
    for (const k of PL_RATIO_KEYS) pl[k].push(numOrNull(r[k]));
  }
  return pl;
}

async function loadTargetFinancialsYuan(caseId, versionId) {
  const vid = versionId || DRAFT_VERSION_ID;
  const plRows = await db.query(
    `SELECT line_no, fiscal_year, revenue, cogs, gross_profit, selling, admin, rd, finance_expense,
            operating_profit, net_income, revenue_growth,
            cogs_ratio, surtax_ratio, selling_ratio, admin_ratio, rd_ratio, finance_expense_ratio,
            other_income_ratio, other_ratio, da_ratio, capex_ratio, dso, dpo, dio
     FROM valuation_target_pl_line
     WHERE case_id = ? AND version_id = ?
     ORDER BY line_no ASC`,
    [caseId, vid]
  );
  const bsRows = await db.query(
    `SELECT ${[...BS_INPUT_KEYS, 'net_debt_override', 'forecast_json', 'forecast_pl_json'].join(', ')}
     FROM valuation_target_bs WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, vid]
  );
  const cfRows = await db.query(
    `SELECT da_default, capex_default, dnwc_default
     FROM valuation_target_cf WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, vid]
  );
  const cfLines = await db.query(
    `SELECT line_no, fiscal_year, da, capex, dnwc
     FROM valuation_target_cf_line WHERE case_id = ? AND version_id = ?
     ORDER BY line_no ASC`,
    [caseId, vid]
  );
  const hasRows = plRows.length > 0 || bsRows.length > 0 || cfRows.length > 0 || cfLines.length > 0;
  if (!hasRows) return { hasRows: false };

  const bs = bsRows[0] || {};
  const cfHead = cfRows[0] || {};
  const targetCf = {
    years: cfLines.map((r) => r.fiscal_year),
    da: cfLines.map((r) => numOrNull(r.da)),
    capex: cfLines.map((r) => numOrNull(r.capex)),
    dnwc: cfLines.map((r) => numOrNull(r.dnwc)),
    da_default: numOrNull(cfHead.da_default),
    capex_default: numOrNull(cfHead.capex_default),
    dnwc_default: numOrNull(cfHead.dnwc_default),
  };
  return {
    hasRows: true,
    targetPl: linesToPl(plRows),
    targetBs: pickBsSnapshot(normalizeBs(bs)),
    forecastBs: parseForecastBs(bs.forecast_json),
    forecastPl: parseForecastBs(bs.forecast_pl_json),
    targetCf,
    overrides: {
      net_debt: numOrNull(bs.net_debt_override),
      da: numOrNull(cfHead.da_default),
      capex: numOrNull(cfHead.capex_default),
      dnwc: numOrNull(cfHead.dnwc_default),
    },
  };
}

function stripFinancialsFromPayload(payload) {
  const next = { ...(payload || {}) };
  delete next.targetPl;
  delete next.targetBs;
  delete next.targetCf;
  delete next.overrides;
  return next;
}

async function hydrateDraftPayload(caseId, payload, versionId) {
  const vid = versionId || DRAFT_VERSION_ID;
  const base = payload || {};
  let stored = await loadTargetFinancialsYuan(caseId, vid);
  if (!stored.hasRows && (hasPlInput(base.targetPl) || Object.keys(base.targetBs || {}).length || Object.keys(base.overrides || {}).length)) {
    await saveTargetFinancials(caseId, vid, base);
    stored = await loadTargetFinancialsYuan(caseId, vid);
  }
  const aligned = alignAssumptionMoney(base.assumptions, stored.targetPl, base.amount_unit || 'wan');
  const assumptions = aligned.assumptions;
  if (aligned.changed) {
    await db.execute(
      `UPDATE valuation_assumption
       SET esop = ?, ytd_revenue = ?, market_revenue = ?, market_net_income = ?, F_LastModifyTime = NOW()
       WHERE case_id = ? AND version_id = ?`,
      [
        assumptions.esop ?? null,
        assumptions.ytd_revenue ?? null,
        assumptions.market_revenue ?? null,
        assumptions.market_net_income ?? null,
        caseId,
        vid,
      ]
    );
    await db.execute(
      `UPDATE valuation_calc_meta SET amount_unit = 'yuan', F_LastModifyTime = NOW()
       WHERE case_id = ? AND version_id = ?`,
      [caseId, vid]
    );
  }
  if (!stored.hasRows) {
    return { ...base, assumptions, amount_unit: 'yuan' };
  }
  return {
    ...base,
    assumptions,
    amount_unit: 'yuan',
    targetPl: stored.targetPl,
    targetBs: stored.targetBs,
    forecastBs: stored.forecastBs || {},
    forecastPl: stored.forecastPl || {},
    targetCf: stored.targetCf,
    overrides: stored.overrides,
  };
}

module.exports = {
  DRAFT_VERSION_ID,
  saveTargetFinancials,
  loadTargetFinancialsYuan,
  hydrateDraftPayload,
  stripFinancialsFromPayload,
};
