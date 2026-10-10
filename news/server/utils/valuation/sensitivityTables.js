const { round2, yuanToYi2 } = require('./exitReturn');

const RATE_FLOOR = 0.01;
const DEFAULT_PE_STEP = 10;
const DEFAULT_PS_STEP = 2;
const DEFAULT_CAGR_STEP = 0.05;
const DEFAULT_RATE_STEP = 0.02;

function normalizeAxes(axes) {
  if (axes === 'exit_x_wacc' || axes === 'wacc_x_exit') return 'exit_x_wacc';
  if (axes === 'exit_x_rd_cagr') return 'exit_x_rd_cagr';
  return 'exit_x_cagr';
}

function positiveStep(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function pctLabel(rate) {
  const n = Math.round(Number(rate) * 10000) / 100;
  if (!Number.isFinite(n)) return '';
  return `${Number(n.toFixed(2))}%`;
}

function multipleLabel(multiple) {
  const n = round2(multiple);
  if (n == null) return '';
  return `${Number(n.toFixed(2))} 倍`;
}

function impliedCagr(revenues) {
  const list = Array.isArray(revenues) ? revenues.map(Number) : [];
  if (list.length < 2) return null;
  const first = list[0];
  const last = list[list.length - 1];
  if (!(first > 0) || !(last > 0)) return null;
  return (last / first) ** (1 / (list.length - 1)) - 1;
}

function shockPath(first, cagr, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(first * (1 + cagr) ** i);
  return out;
}

function seriesOf(peRun, psRun, key) {
  if (Array.isArray(peRun?.series?.[key]) && peRun.series[key].length) return peRun.series[key];
  if (Array.isArray(psRun?.series?.[key]) && psRun.series[key].length) return psRun.series[key];
  return [];
}

function blankReason(run, terminalType) {
  const text = (run?.blockers || []).join('\n');
  if (terminalType === 'exit_pe' && text.includes('税后经营利润小于等于 0')) return 'nopat';
  if (text.includes('营业收入小于等于 0')) return 'revenue';
  if (run?.blocked) return 'other';
  return null;
}

function cellFromRun(run, terminalType) {
  const reason = blankReason(run, terminalType);
  if (reason) return { equity_yi: null, cap_yi: null, blank: reason };
  return {
    equity_yi: yuanToYi2(run.equity_value),
    cap_yi: yuanToYi2(run.exit_equity_value),
    blank: null,
  };
}

function copyCell(run) {
  return {
    equity_yi: yuanToYi2(run.equity_value),
    cap_yi: yuanToYi2(run.exit_equity_value),
    blank: null,
  };
}

function holdingYearsOf(peRun, psRun) {
  const run = (psRun && !psRun.blocked && psRun.pvs?.length) ? psRun : peRun;
  const periods = run?.pvs?.length ? run.pvs[run.pvs.length - 1].periods : null;
  return round2(periods);
}

function baseRateOf(peRun, psRun) {
  const run = (peRun && !peRun.blocked) ? peRun : psRun;
  const n = Number(run?.discount_rate);
  return Number.isFinite(n) ? n : null;
}

function cagrRows(values, step, mode) {
  const cagr = impliedCagr(values);
  const first = Number(values[0]);
  const n = values.length;
  if (cagr == null || !(first > 0)) {
    return [{ center: true, label: '当前预测' }];
  }
  return [-2, -1, 0, 1, 2].map((k) => {
    if (k === 0) return { center: true, label: '当前预测' };
    const next = cagr + k * step;
    const row = { center: false, label: pctLabel(next) };
    if (mode === 'exit_x_rd_cagr') row.rdOverride = shockPath(first, next, n);
    else row.revenueOverride = shockPath(first, next, n);
    return row;
  });
}

function rateRows(rate, step) {
  let floored = false;
  const rows = [-2, -1, 0, 1, 2].map((k) => {
    if (k === 0) return { center: true, rate, label: pctLabel(rate) };
    const raw = rate + k * step;
    const hitFloor = raw < RATE_FLOOR;
    if (hitFloor) floored = true;
    const used = hitFloor ? RATE_FLOOR : raw;
    return { center: false, rate: used, label: pctLabel(used) };
  });
  return { rows, floored };
}

/**
 * @param {object} args
 * @param {object} args.peRun
 * @param {object} args.psRun
 * @param {function} args.rebuild ({ rate, multiple, terminalType, revenueOverride, rdOverride }) => buildDcfForecast result
 * @param {string} args.axes
 * @param {object} [args.steps]
 * @param {string} args.scenarioMode
 */
function buildExitView({ peRun, psRun, rebuild, axes, steps, scenarioMode } = {}) {
  const peOk = peRun && !peRun.blocked && peRun.equity_value != null;
  const psOk = psRun && !psRun.blocked && psRun.equity_value != null;
  if (!peOk && !psOk) return null;
  const mode = normalizeAxes(axes);
  const rate = baseRateOf(peRun, psRun);
  const stepSet = steps || {};
  let waccFloored = false;
  let rows;
  if (mode === 'exit_x_wacc') {
    const built = rateRows(rate, positiveStep(stepSet.rateStep, DEFAULT_RATE_STEP));
    rows = built.rows;
    waccFloored = built.floored;
  } else if (mode === 'exit_x_rd_cagr') {
    const values = seriesOf(peRun, psRun, 'rd');
    rows = cagrRows(values, positiveStep(stepSet.cagrStep, DEFAULT_CAGR_STEP), mode);
  } else {
    const values = seriesOf(peRun, psRun, 'revenue');
    rows = cagrRows(values, positiveStep(stepSet.cagrStep, DEFAULT_CAGR_STEP), mode);
  }

  const buildSide = (run, terminalType, ok) => {
    const multiple = Number(run?.exit_multiple);
    if (!ok || !(multiple > 0)) {
      return {
        blocked: true,
        multiple: Number.isFinite(multiple) ? multiple : null,
        equity_yi: null,
        cap_yi: null,
        row_labels: null,
        col_labels: null,
        center_row: null,
        center_col: null,
        cells: null,
      };
    }
    const step = positiveStep(
      terminalType === 'exit_pe' ? stepSet.peStep : stepSet.psStep,
      terminalType === 'exit_pe' ? DEFAULT_PE_STEP : DEFAULT_PS_STEP,
    );
    const cols = [-2, -1, 0, 1, 2].map((k) => {
      const next = multiple + k * step;
      return {
        center: k === 0,
        multiple: next,
        blank: !(next > 0),
        label: next > 0 ? multipleLabel(next) : '',
      };
    });
    const center = copyCell(run);
    const cells = rows.map((row) => cols.map((col) => {
      if (col.blank) return { equity_yi: null, cap_yi: null, blank: 'multiple' };
      if (row.center && col.center) return center;
      if (Array.isArray(row.revenueOverride) && row.revenueOverride.some((v) => !(Number(v) > 0))) {
        return { equity_yi: null, cap_yi: null, blank: 'revenue' };
      }
      const next = rebuild({
        rate: row.rate != null ? row.rate : rate,
        multiple: col.multiple,
        terminalType,
        revenueOverride: row.revenueOverride,
        rdOverride: row.rdOverride,
      });
      return cellFromRun(next, terminalType);
    }));
    return {
      blocked: false,
      multiple,
      equity_yi: center.equity_yi,
      cap_yi: center.cap_yi,
      row_labels: rows.map((row) => row.label),
      col_labels: cols.map((col) => col.label),
      center_row: rows.findIndex((row) => row.center),
      center_col: cols.findIndex((col) => col.center),
      cells,
    };
  };

  return {
    scenario_mode: scenarioMode || 'single',
    axes: mode,
    holding_years: holdingYearsOf(peRun, psRun),
    wacc_floored: waccFloored,
    discount_rate: rate,
    pe: buildSide(peRun, 'exit_pe', peOk),
    ps: buildSide(psRun, 'exit_ps', psOk),
  };
}

module.exports = {
  normalizeAxes,
  impliedCagr,
  blankReason,
  buildExitView,
  positiveStep,
};
