/**
 * 自定义 / 单变量敏感性：档位生成与冲击补丁。
 * 相对 Δ；缺 0 自动插入。
 */

function positiveStep(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function impliedCagr(revenues) {
  const list = Array.isArray(revenues) ? revenues.map(Number) : [];
  if (list.length < 2) return null;
  const first = list[0];
  const last = list[list.length - 1];
  if (!(first > 0) || !(last > 0)) return null;
  return (last / first) ** (1 / (list.length - 1)) - 1;
}

const PARAMS = {
  rev_cagr: { label: '营收 CAGR', kind: 'cagr', defaultStep: 0.05 },
  rd_cagr: { label: '研发费用 CAGR', kind: 'cagr', defaultStep: 0.05 },
  rate: { label: '折现率', kind: 'rate', defaultStep: 0.02 },
  exit_multiple: { label: '退出倍数', kind: 'multiple', defaultStep: null },
  gross_margin: { label: '毛利率', kind: 'ratio', ratioKey: 'cogs_ratio', invert: true, defaultStep: 0.02 },
  selling_ratio: { label: '销售费用率', kind: 'ratio', ratioKey: 'selling_ratio', defaultStep: 0.01 },
  admin_ratio: { label: '管理费用率', kind: 'ratio', ratioKey: 'admin_ratio', defaultStep: 0.01 },
  rd_ratio: { label: '研发费用率', kind: 'ratio', ratioKey: 'rd_ratio', defaultStep: 0.01 },
  capex_ratio: { label: '资本开支率', kind: 'ratio', ratioKey: 'capex_ratio', defaultStep: 0.01 },
  dso: { label: 'DSO', kind: 'days', dayKey: 'dso', defaultStep: 5 },
  dio: { label: '存货周转天数', kind: 'days', dayKey: 'dio', defaultStep: 5 },
  dpo: { label: 'DPO', kind: 'days', dayKey: 'dpo', defaultStep: 5 },
};

function pctLabel(rate) {
  const n = Math.round(Number(rate) * 10000) / 100;
  if (!Number.isFinite(n)) return '';
  return `${Number(n.toFixed(2))}%`;
}

function deltaLabel(delta, kind) {
  const n = Number(delta);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '当前预测';
  if (kind === 'days') {
    const v = Math.round(n * 100) / 100;
    return n > 0 ? `+${v} 天` : `${v} 天`;
  }
  if (kind === 'multiple') {
    const v = Math.round(n * 100) / 100;
    return n > 0 ? `+${v}` : `${v}`;
  }
  return n > 0 ? `+${pctLabel(n)}` : pctLabel(n);
}

function normalizeLevels(levels) {
  const raw = Array.isArray(levels) ? levels.map(Number).filter((n) => Number.isFinite(n)) : [];
  let list = raw.slice(0, 7);
  if (!list.some((n) => n === 0)) list.push(0);
  list = [...new Set(list)].sort((a, b) => a - b);
  if (list.length < 3) {
    while (list.length < 3) {
      const span = list.length ? Math.max(...list.map(Math.abs), 0.01) : 0.01;
      list = [...new Set([-span, ...list, span])].sort((a, b) => a - b);
    }
  }
  if (list.length > 7) {
    // 保留 0，两侧均匀抽
    const neg = list.filter((n) => n < 0);
    const pos = list.filter((n) => n > 0);
    const keepNeg = neg.slice(-3);
    const keepPos = pos.slice(0, 3);
    list = [...keepNeg, 0, ...keepPos].slice(0, 7);
  }
  return list;
}

function stepDeltas(step, count = 5) {
  const s = positiveStep(step, 0.01);
  const half = Math.floor(count / 2);
  const out = [];
  for (let k = -half; k <= half; k += 1) out.push(k * s);
  return out;
}

function axisLevels(paramId, { mode, step, levels, peStep, psStep, terminalType }) {
  const meta = PARAMS[paramId];
  if (!meta) return [{ delta: 0, center: true, label: '当前预测' }];
  let deltas;
  if (mode === 'levels') deltas = normalizeLevels(levels);
  else {
    const st = meta.kind === 'multiple'
      ? positiveStep(terminalType === 'exit_pe' ? peStep : psStep, terminalType === 'exit_pe' ? 10 : 2)
      : positiveStep(step, meta.defaultStep || 0.01);
    deltas = stepDeltas(st, 5);
  }
  return deltas.map((delta) => ({
    delta,
    center: delta === 0,
    label: deltaLabel(delta, meta.kind),
    meta,
  }));
}

function shockPath(first, cagr, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(first * (1 + cagr) ** i);
  return out;
}

function patchFromLevel(paramId, level, ctx) {
  const meta = PARAMS[paramId];
  const delta = level.delta;
  if (!meta || delta === 0) return {};
  if (meta.kind === 'cagr') {
    const values = paramId === 'rd_cagr' ? ctx.rdValues : ctx.revValues;
    const base = impliedCagr(values);
    const first = Number(values?.[0]);
    const n = values?.length || 0;
    if (base == null || !(first > 0) || n < 2) return {};
    const path = shockPath(first, base + delta, n);
    return paramId === 'rd_cagr' ? { rdOverride: path } : { revenueOverride: path };
  }
  if (meta.kind === 'rate') {
    return { rateDelta: delta };
  }
  if (meta.kind === 'multiple') {
    return { multipleDelta: delta };
  }
  if (meta.kind === 'ratio') {
    const signed = meta.invert ? -delta : delta;
    return { ratioDeltas: { [meta.ratioKey]: signed } };
  }
  if (meta.kind === 'days') {
    return { dayDeltas: { [meta.dayKey]: delta } };
  }
  return {};
}

function mergePatches(a, b) {
  return {
    revenueOverride: b.revenueOverride || a.revenueOverride,
    rdOverride: b.rdOverride || a.rdOverride,
    rateDelta: (a.rateDelta || 0) + (b.rateDelta || 0),
    multipleDelta: (a.multipleDelta || 0) + (b.multipleDelta || 0),
    ratioDeltas: { ...(a.ratioDeltas || {}), ...(b.ratioDeltas || {}) },
    dayDeltas: { ...(a.dayDeltas || {}), ...(b.dayDeltas || {}) },
  };
}

module.exports = {
  PARAMS,
  axisLevels,
  patchFromLevel,
  mergePatches,
  normalizeLevels,
};
