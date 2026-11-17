const { round2, yuanToYi2 } = require('./exitReturn');
const { PARAMS, axisLevels, patchFromLevel, mergePatches } = require('./sensitivityCustom');

const RATE_FLOOR = 0.01;
const DEFAULT_PE_STEP = 10;
const DEFAULT_PS_STEP = 2;
const DEFAULT_CAGR_STEP = 0.05;
const DEFAULT_RATE_STEP = 0.02;
const DEFAULT_GROWTH_STEP = 0.005;
const DEFAULT_TERMINAL_GROWTH = 0.02;

function normalizeAxes(axes) {
  if (axes === 'exit_x_wacc' || axes === 'wacc_x_exit') return 'exit_x_wacc';
  if (axes === 'rate_x_g' || axes === 'g_x_rate') return 'rate_x_g';
  if (axes === 'exit_x_rd_cagr') return 'exit_x_rd_cagr';
  if (axes === 'rev_cagr_x_rd_cagr') return 'rev_cagr_x_rd_cagr';
  if (axes === 'univariate' || axes === 'custom') return axes;
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
  if (terminalType === 'gordon' && (text.includes('自由现金流小于等于 0') || text.includes('须小于折现率'))) return 'gordon';
  if (text.includes('营业收入小于等于 0')) return 'revenue';
  if (run?.blocked) return 'other';
  return null;
}

function baseGrowthOf(gordonRun) {
  const n = Number(gordonRun?.terminal_growth);
  if (Number.isFinite(n)) return n;
  return DEFAULT_TERMINAL_GROWTH;
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

/** 中心 ±1 邻域内有 equity_yi 的 min/max；全空则回退中心点。 */
function bandFromCells(cells, centerRow, centerCol, fallbackYi) {
  const vals = [];
  if (!Array.isArray(cells) || centerRow == null || centerCol == null) {
    return { band_low_yi: fallbackYi ?? null, band_high_yi: fallbackYi ?? null };
  }
  for (let i = centerRow - 1; i <= centerRow + 1; i += 1) {
    if (i < 0 || i >= cells.length) continue;
    const row = cells[i] || [];
    for (let j = centerCol - 1; j <= centerCol + 1; j += 1) {
      if (j < 0 || j >= row.length) continue;
      const v = Number(row[j]?.equity_yi);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (!vals.length) {
    const fb = fallbackYi != null && Number.isFinite(Number(fallbackYi)) ? Number(fallbackYi) : null;
    return { band_low_yi: fb, band_high_yi: fb };
  }
  return { band_low_yi: Math.min(...vals), band_high_yi: Math.max(...vals) };
}

function withBand(side) {
  if (!side || side.blocked || !side.cells) {
    return {
      ...side,
      band_low_yi: side?.equity_yi ?? null,
      band_high_yi: side?.equity_yi ?? null,
    };
  }
  return {
    ...side,
    ...bandFromCells(side.cells, side.center_row, side.center_col, side.equity_yi),
  };
}

function holdingYearsOf(peRun, psRun, gordonRun) {
  const run = (psRun && !psRun.blocked && psRun.pvs?.length)
    ? psRun
    : ((peRun && !peRun.blocked && peRun.pvs?.length) ? peRun : gordonRun);
  const periods = run?.pvs?.length ? run.pvs[run.pvs.length - 1].periods : null;
  return round2(periods);
}

function baseRateOf(peRun, psRun, gordonRun) {
  const run = (peRun && !peRun.blocked)
    ? peRun
    : ((psRun && !psRun.blocked) ? psRun : gordonRun);
  const n = Number(run?.discount_rate);
  return Number.isFinite(n) ? n : null;
}

function growthCols(growth, step) {
  return [-2, -1, 0, 1, 2].map((k) => {
    const next = growth + k * step;
    return {
      center: k === 0,
      growth: next,
      blank: false,
      label: pctLabel(next),
    };
  });
}

function cagrLevels(values, step) {
  const cagr = impliedCagr(values);
  const first = Number(values[0]);
  const n = values.length;
  if (cagr == null || !(first > 0)) {
    return [{ center: true, label: '当前预测', path: undefined }];
  }
  return [-2, -1, 0, 1, 2].map((k) => {
    if (k === 0) return { center: true, label: '当前预测', path: undefined };
    const next = cagr + k * step;
    return { center: false, label: pctLabel(next), path: shockPath(first, next, n) };
  });
}

function cagrRows(values, step, mode) {
  return cagrLevels(values, step).map((level) => {
    const row = { center: level.center, label: level.label };
    if (!level.center && mode === 'exit_x_rd_cagr') row.rdOverride = level.path;
    else if (!level.center) row.revenueOverride = level.path;
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
function buildCustomExitView({ peRun, psRun, gordonRun, rebuild, axes, steps, scenarioMode, custom } = {}) {
  const peOk = peRun && !peRun.blocked && peRun.equity_value != null;
  const psOk = psRun && !psRun.blocked && psRun.equity_value != null;
  const gordonOk = gordonRun && !gordonRun.blocked && gordonRun.equity_value != null;
  if (!peOk && !psOk && !gordonOk) return null;
  const rate = baseRateOf(peRun, psRun, gordonRun);
  const growth = baseGrowthOf(gordonRun);
  const stepSet = steps || {};
  const cfg = custom || {};
  const rowParam = cfg.rowParam || 'rev_cagr';
  const colParam = axes === 'univariate' ? null : (cfg.colParam || 'exit_multiple');
  if (colParam && rowParam === colParam) {
    return {
      scenario_mode: scenarioMode || 'single',
      axes,
      holding_years: holdingYearsOf(peRun, psRun, gordonRun),
      wacc_floored: false,
      discount_rate: rate,
      terminal_growth: growth,
      axis_title: '横轴与纵轴不能相同',
      pe: { blocked: true, cells: null },
      ps: { blocked: true, cells: null },
      gordon: { blocked: true, cells: null },
    };
  }
  const ctx = {
    revValues: seriesOf(peRun, psRun, 'revenue') || seriesOf(gordonRun, null, 'revenue'),
    rdValues: seriesOf(peRun, psRun, 'rd') || seriesOf(gordonRun, null, 'rd'),
  };
  const rowLevels = axisLevels(rowParam, {
    mode: cfg.rowMode || 'step',
    step: cfg.rowStep,
    levels: cfg.rowLevels,
    peStep: stepSet.peStep,
    psStep: stepSet.psStep,
  });
  const colLevels = colParam
    ? axisLevels(colParam, {
      mode: cfg.colMode || 'step',
      step: cfg.colStep,
      levels: cfg.colLevels,
      peStep: stepSet.peStep,
      psStep: stepSet.psStep,
    })
    : [{ delta: 0, center: true, label: '当前', meta: null }];

  const buildSide = (run, terminalType, ok) => {
    const isGordon = terminalType === 'gordon';
    const multiple = Number(run?.exit_multiple);
    if (!ok || (!isGordon && !(multiple > 0))) {
      return {
        blocked: true,
        multiple: Number.isFinite(multiple) ? multiple : null,
        growth: isGordon ? growth : null,
        equity_yi: null,
        cap_yi: null,
        row_labels: null,
        col_labels: null,
        center_row: null,
        center_col: null,
        cells: null,
      };
    }
    const center = copyCell(run);
    const sideColParam = (isGordon && colParam === 'exit_multiple') ? 'perp_growth' : colParam;
    const sideRowParam = (isGordon && rowParam === 'exit_multiple') ? 'perp_growth' : rowParam;
    const resolvedCols = sideColParam === 'exit_multiple'
      ? axisLevels('exit_multiple', {
        mode: cfg.colMode || 'step',
        step: cfg.colStep,
        levels: cfg.colLevels,
        peStep: stepSet.peStep,
        psStep: stepSet.psStep,
        terminalType,
      })
      : (sideColParam === 'perp_growth' && colParam === 'exit_multiple'
        ? axisLevels('perp_growth', {
          mode: 'step',
          step: stepSet.growthStep || DEFAULT_GROWTH_STEP,
        })
        : (sideColParam ? (sideColParam === colParam ? colLevels : axisLevels(sideColParam, {
          mode: cfg.colMode || 'step',
          step: cfg.colStep || stepSet.growthStep,
          levels: cfg.colLevels,
        })) : [{ delta: 0, center: true, label: '当前', meta: null }]));
    const resolvedRows = sideRowParam === 'exit_multiple'
      ? axisLevels('exit_multiple', {
        mode: cfg.rowMode || 'step',
        step: cfg.rowStep,
        levels: cfg.rowLevels,
        peStep: stepSet.peStep,
        psStep: stepSet.psStep,
        terminalType,
      })
      : (sideRowParam === 'perp_growth' && rowParam === 'exit_multiple'
        ? axisLevels('perp_growth', {
          mode: 'step',
          step: stepSet.growthStep || DEFAULT_GROWTH_STEP,
        })
        : (sideRowParam === rowParam ? rowLevels : axisLevels(sideRowParam, {
          mode: cfg.rowMode || 'step',
          step: cfg.rowStep || stepSet.growthStep,
          levels: cfg.rowLevels,
        })));

    const cells = resolvedRows.map((row) => resolvedCols.map((col) => {
      if (row.center && col.center) return center;
      let patch = mergePatches(
        patchFromLevel(sideRowParam, row, ctx),
        sideColParam ? patchFromLevel(sideColParam, col, ctx) : {},
      );
      let usedMultiple = isGordon ? null : (multiple + (patch.multipleDelta || 0));
      if (!isGordon && sideRowParam === 'exit_multiple') usedMultiple = multiple + row.delta;
      if (!isGordon && sideColParam === 'exit_multiple') usedMultiple = multiple + col.delta;
      if (!isGordon && !(usedMultiple > 0)) return { equity_yi: null, cap_yi: null, blank: 'multiple' };
      const nextRate = rate + (patch.rateDelta || 0);
      const usedRate = nextRate < RATE_FLOOR ? RATE_FLOOR : nextRate;
      const usedGrowth = growth + (patch.growthDelta || 0);
      if (isGordon && !(usedRate > usedGrowth)) return { equity_yi: null, cap_yi: null, blank: 'gordon' };
      if (Array.isArray(patch.revenueOverride) && patch.revenueOverride.some((v) => !(Number(v) > 0))) {
        return { equity_yi: null, cap_yi: null, blank: 'revenue' };
      }
      const next = rebuild({
        rate: usedRate,
        multiple: usedMultiple,
        terminalType,
        terminalGrowth: usedGrowth,
        revenueOverride: patch.revenueOverride,
        rdOverride: patch.rdOverride,
        sensitivityShocks: {
          ratioDeltas: patch.ratioDeltas,
          dayDeltas: patch.dayDeltas,
          growthDelta: 0,
        },
      });
      return cellFromRun(next, terminalType);
    }));
    const labelFor = (param, level, baseMultiple) => {
      if (level.center) return param ? '当前预测' : '当前';
      if (!param) return level.label;
      if (PARAMS[param]?.kind === 'cagr') {
        const base = impliedCagr(param === 'rd_cagr' ? ctx.rdValues : ctx.revValues);
        return base == null ? level.label : pctLabel(base + level.delta);
      }
      if (PARAMS[param]?.kind === 'rate') return pctLabel(rate + level.delta);
      if (PARAMS[param]?.kind === 'growth') return pctLabel(growth + level.delta);
      if (PARAMS[param]?.kind === 'multiple') return multipleLabel(baseMultiple + level.delta);
      return level.label;
    };
    return {
      blocked: false,
      multiple: isGordon ? null : multiple,
      growth: isGordon ? growth : null,
      equity_yi: center.equity_yi,
      cap_yi: center.cap_yi,
      row_labels: resolvedRows.map((r) => labelFor(sideRowParam, r, multiple)),
      col_labels: resolvedCols.map((c) => labelFor(sideColParam, c, multiple)),
      center_row: resolvedRows.findIndex((r) => r.center),
      center_col: resolvedCols.findIndex((c) => c.center),
      cells,
    };
  };

  const rowLabel = PARAMS[rowParam]?.label || rowParam;
  const colLabel = colParam ? (PARAMS[colParam]?.label || colParam) : null;
  return {
    scenario_mode: scenarioMode || 'single',
    axes,
    axis_title: colLabel ? `${rowLabel} × ${colLabel}` : rowLabel,
    holding_years: holdingYearsOf(peRun, psRun, gordonRun),
    wacc_floored: false,
    discount_rate: rate,
    terminal_growth: growth,
    pe: withBand(buildSide(peRun, 'exit_pe', peOk)),
    ps: withBand(buildSide(psRun, 'exit_ps', psOk)),
    gordon: withBand(buildSide(gordonRun, 'gordon', gordonOk)),
  };
}

function buildExitView({ peRun, psRun, gordonRun, rebuild, axes, steps, scenarioMode, custom } = {}) {
  const mode = normalizeAxes(axes);
  if (mode === 'univariate' || mode === 'custom') {
    return buildCustomExitView({
      peRun, psRun, gordonRun, rebuild, axes: mode, steps, scenarioMode, custom,
    });
  }
  const peOk = peRun && !peRun.blocked && peRun.equity_value != null;
  const psOk = psRun && !psRun.blocked && psRun.equity_value != null;
  const gordonOk = gordonRun && !gordonRun.blocked && gordonRun.equity_value != null;
  if (!peOk && !psOk && !gordonOk) return null;
  const rate = baseRateOf(peRun, psRun, gordonRun);
  const growth = baseGrowthOf(gordonRun);
  const stepSet = steps || {};
  const revenueStep = positiveStep(stepSet.cagrStep, DEFAULT_CAGR_STEP);
  const rdStep = positiveStep(stepSet.rdCagrStep, DEFAULT_CAGR_STEP);
  const growthStep = positiveStep(stepSet.growthStep, DEFAULT_GROWTH_STEP);
  let waccFloored = false;
  let rows;
  if (mode === 'exit_x_wacc' || mode === 'rate_x_g') {
    const built = rateRows(rate, positiveStep(stepSet.rateStep, DEFAULT_RATE_STEP));
    rows = built.rows;
    waccFloored = built.floored;
  } else if (mode === 'exit_x_rd_cagr') {
    const values = seriesOf(peRun, psRun, 'rd') || seriesOf(gordonRun, null, 'rd');
    rows = cagrRows(values, rdStep, mode);
  } else if (mode === 'rev_cagr_x_rd_cagr') {
    const values = seriesOf(peRun, psRun, 'revenue') || seriesOf(gordonRun, null, 'revenue');
    rows = cagrRows(values, revenueStep, 'exit_x_cagr');
  } else {
    const values = seriesOf(peRun, psRun, 'revenue') || seriesOf(gordonRun, null, 'revenue');
    rows = cagrRows(values, revenueStep, mode);
  }
  const rdLevels = mode === 'rev_cagr_x_rd_cagr'
    ? cagrLevels(seriesOf(peRun, psRun, 'rd') || seriesOf(gordonRun, null, 'rd'), rdStep)
    : null;
  const gCols = mode === 'rate_x_g' ? growthCols(growth, growthStep) : null;

  const buildSide = (run, terminalType, ok) => {
    const isGordon = terminalType === 'gordon';
    const multiple = Number(run?.exit_multiple);
    if (!ok || (!isGordon && !(multiple > 0))) {
      return {
        blocked: true,
        multiple: Number.isFinite(multiple) ? multiple : null,
        growth: isGordon ? growth : null,
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
    let cols;
    if (gCols && isGordon) {
      cols = gCols;
    } else if (gCols && !isGordon) {
      // 折现率 × 永续增长率：倍数侧横轴仍用退出倍数
      cols = [-2, -1, 0, 1, 2].map((k) => {
        const next = multiple + k * step;
        return {
          center: k === 0,
          multiple: next,
          blank: !(next > 0),
          label: next > 0 ? multipleLabel(next) : '',
        };
      });
    } else if (rdLevels) {
      cols = rdLevels.map((level) => ({
        center: level.center,
        multiple,
        growth,
        blank: false,
        label: level.label,
        rdOverride: level.path,
      }));
    } else if (isGordon) {
      cols = growthCols(growth, growthStep);
    } else {
      cols = [-2, -1, 0, 1, 2].map((k) => {
        const next = multiple + k * step;
        return {
          center: k === 0,
          multiple: next,
          blank: !(next > 0),
          label: next > 0 ? multipleLabel(next) : '',
        };
      });
    }
    const center = copyCell(run);
    const cells = rows.map((row) => cols.map((col) => {
      if (col.blank) return { equity_yi: null, cap_yi: null, blank: isGordon ? 'gordon' : 'multiple' };
      if (row.center && col.center) return center;
      if (Array.isArray(row.revenueOverride) && row.revenueOverride.some((v) => !(Number(v) > 0))) {
        return { equity_yi: null, cap_yi: null, blank: 'revenue' };
      }
      const usedRate = row.rate != null ? row.rate : rate;
      const usedGrowth = col.growth != null ? col.growth : growth;
      if (isGordon && !(usedRate > usedGrowth)) {
        return { equity_yi: null, cap_yi: null, blank: 'gordon' };
      }
      const next = rebuild({
        rate: usedRate,
        multiple: isGordon ? null : col.multiple,
        terminalType,
        terminalGrowth: usedGrowth,
        revenueOverride: row.revenueOverride,
        rdOverride: col.rdOverride || row.rdOverride,
      });
      return cellFromRun(next, terminalType);
    }));
    return {
      blocked: false,
      multiple: isGordon ? null : multiple,
      growth: isGordon ? growth : null,
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
    holding_years: holdingYearsOf(peRun, psRun, gordonRun),
    wacc_floored: waccFloored,
    discount_rate: rate,
    terminal_growth: growth,
    pe: withBand(buildSide(peRun, 'exit_pe', peOk)),
    ps: withBand(buildSide(psRun, 'exit_ps', psOk)),
    gordon: withBand(buildSide(gordonRun, 'gordon', gordonOk)),
  };
}

module.exports = {
  normalizeAxes,
  impliedCagr,
  blankReason,
  buildExitView,
  bandFromCells,
  positiveStep,
  PARAMS,
};
