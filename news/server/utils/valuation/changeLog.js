/**
 * 估值关键假设 / 方法配置变更留痕。不记录三表数字（自动保存会刷屏）。
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');

const SOURCE_LABELS = {
  draft: '草稿',
  compute: '计算',
  method: '方法配置',
  version: '保存版本',
  restore: '发起新版本',
  case: '案件',
};

const ENUM_LABELS = {
  terminal_type: { exit_pe: '退出 P/E × 末期净利润', exit_ps: '退出 P/S × 末期营业收入' },
  fcf_method: { ni_bridge: '净利润桥', nopat_fcff: 'NOPAT / FCFF' },
  sensitivity_axes: {
    exit_x_cagr: '退出倍数 × 收入 CAGR',
    exit_x_wacc: '退出倍数 × 折现率',
    wacc_x_exit: '折现率 × 退出倍数',
  },
  scenario_mode: { single: '单套情景', ma_and_ipo: '并购 + 上市并排' },
  multiple_source: { stock_pool: '个股 POOL', sw_industry_median: '申万三级中位数' },
  industry_stat_method: { arithmetic: '算术平均', overall: '整体法' },
};

const TRACKED_FIELDS = [
  { key: 'valuation_date', label: '市场法锚定日', path: ['assumptions', 'valuation_date'], type: 'date' },
  { key: 'discount_rate', label: '汇总折现率', path: ['assumptions', 'discount_rate'], type: 'pct' },
  { key: 'exit_pe', label: '退出 P/E', path: ['assumptions', 'exit_pe'], type: 'multiple' },
  { key: 'exit_ps', label: '退出 P/S', path: ['assumptions', 'exit_ps'], type: 'multiple' },
  { key: 'liquidity_discount', label: '市场法流动性折扣', path: ['assumptions', 'liquidity_discount'], type: 'pct' },
  { key: 'dcf_liquidity_discount', label: '并购 DCF 流动性折扣', path: ['assumptions', 'dcf_liquidity_discount'], type: 'pct' },
  { key: 'ps_low_multiple', label: '市场法 P/S 低端倍数', path: ['assumptions', 'ps_low_multiple'], type: 'multiple' },
  { key: 'ps_median_multiple', label: '市场法 P/S 中位倍数', path: ['assumptions', 'ps_median_multiple'], type: 'multiple' },
  { key: 'pe_low_multiple', label: '市场法 P/E 低端倍数', path: ['assumptions', 'pe_low_multiple'], type: 'multiple' },
  { key: 'pe_median_multiple', label: '市场法 P/E 中位倍数', path: ['assumptions', 'pe_median_multiple'], type: 'multiple' },
  { key: 'tax_rate', label: '所得税率', path: ['assumptions', 'tax_rate'], type: 'pct' },
  { key: 'forecast_years', label: '预测年数', path: ['assumptions', 'forecast_years'], type: 'number' },
  { key: 'esop', label: 'ESOP', path: ['assumptions', 'esop'], type: 'pct' },
  { key: 'round_deal_value_yi', label: '本轮交易估值', path: ['assumptions', 'round_deal_value_yi'], type: 'yi' },
  { key: 'wacc_risk_free_rate', label: '无风险利率', path: ['assumptions', 'wacc_breakdown', 'risk_free_rate'], type: 'pct' },
  { key: 'wacc_erp', label: 'ERP', path: ['assumptions', 'wacc_breakdown', 'erp'], type: 'pct' },
  { key: 'wacc_beta', label: 'Beta', path: ['assumptions', 'wacc_breakdown', 'beta'], type: 'number' },
  { key: 'wacc_debt_equity', label: 'D/E', path: ['assumptions', 'wacc_breakdown', 'debt_equity'], type: 'number' },
  { key: 'wacc_debt_cost', label: '债务成本', path: ['assumptions', 'wacc_breakdown', 'debt_cost'], type: 'pct' },
  { key: 'wacc_tax_rate', label: 'WACC 所得税率', path: ['assumptions', 'wacc_breakdown', 'tax_rate'], type: 'pct' },
  { key: 'terminal_type', label: '终值口径', path: ['methodConfig', 'terminal_type'], type: 'enum' },
  { key: 'fcf_method', label: '现金流口径', path: ['methodConfig', 'fcf_method'], type: 'enum' },
  { key: 'sensitivity_axes', label: '敏感性轴', path: ['methodConfig', 'sensitivity_axes'], type: 'enum' },
  { key: 'scenario_mode', label: '情景', path: ['methodConfig', 'scenario_mode'], type: 'enum' },
  { key: 'multiple_source', label: '倍数来源', path: ['methodConfig', 'multiple_source'], type: 'enum' },
  { key: 'industry_stat_method', label: '行业统计方法', path: ['methodConfig', 'industry_stat_method'], type: 'enum' },
  { key: 'method_confirmed', label: '方法配置已确认', path: ['methodConfig', 'confirmed'], type: 'bool' },
  { key: 'sw_industry_l3', label: '申万三级', path: ['sw_industry_l3'], type: 'text' },
  { key: 'ma_discount_rate', label: '并购折现率', path: ['scenarios', 'ma', 'discount_rate'], type: 'pct' },
  { key: 'ma_exit_pe', label: '并购退出 P/E', path: ['scenarios', 'ma', 'exit_pe'], type: 'multiple' },
  { key: 'ma_exit_ps', label: '并购退出 P/S', path: ['scenarios', 'ma', 'exit_ps'], type: 'multiple' },
  { key: 'ipo_discount_rate', label: '上市折现率', path: ['scenarios', 'ipo', 'discount_rate'], type: 'pct' },
  { key: 'ipo_exit_pe', label: '上市退出 P/E', path: ['scenarios', 'ipo', 'exit_pe'], type: 'multiple' },
  { key: 'ipo_exit_ps', label: '上市退出 P/S', path: ['scenarios', 'ipo', 'exit_ps'], type: 'multiple' },
];

function getPath(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function toYmd(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

function trimNum(n) {
  if (!Number.isFinite(n)) return '';
  const s = n.toFixed(8).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function canon(type, v) {
  if (v == null || v === '') return '';
  if (type === 'bool') return v === true || v === 1 || v === '1' ? '1' : '0';
  if (type === 'date') return toYmd(v);
  if (type === 'pct' || type === 'number' || type === 'yi' || type === 'multiple') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return String(Math.round(n * 1e8) / 1e8);
  }
  return String(v).trim();
}

function display(type, key, v) {
  if (v == null || v === '') return '（空）';
  if (type === 'bool') return (v === true || v === 1 || v === '1') ? '是' : '否';
  if (type === 'date') return toYmd(v) || '（空）';
  if (type === 'pct') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return `${trimNum(n * 100)}%`;
  }
  if (type === 'multiple') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return `${trimNum(n)}x`;
  }
  if (type === 'yi') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return `${trimNum(n)} 亿元`;
  }
  if (type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return trimNum(n);
  }
  if (type === 'enum') return (ENUM_LABELS[key] && ENUM_LABELS[key][v]) || String(v);
  return String(v);
}

function diffPayload(before, after) {
  const rows = [];
  for (const f of TRACKED_FIELDS) {
    const ov = getPath(before, f.path);
    const nv = getPath(after, f.path);
    if (canon(f.type, ov) === canon(f.type, nv)) continue;
    rows.push({
      field_key: f.key,
      field_label: f.label,
      old_value: display(f.type, f.key, ov),
      new_value: display(f.type, f.key, nv),
    });
  }
  return rows;
}

const EVENT_KEYS = new Set(['save_version', 'restore_version']);

async function insertRow({ caseId, userId, source, field_key, field_label, old_value, new_value }) {
  if (!EVENT_KEYS.has(field_key)) {
    const last = await db.query(
      `SELECT new_value FROM valuation_change_log
       WHERE case_id = ? AND field_key = ?
       ORDER BY F_CreatorTime DESC, F_Id DESC LIMIT 1`,
      [caseId, field_key]
    );
    if (last[0] && String(last[0].new_value ?? '') === String(new_value ?? '')) return;
  }
  const id = await generateId('valuation_change_log');
  await db.execute(
    `INSERT INTO valuation_change_log
       (F_Id, case_id, field_key, field_label, old_value, new_value, source, F_CreatorUserId, F_CreatorTime)
     VALUES (?,?,?,?,?,?,?,?,NOW())`,
    [id, caseId, field_key, field_label, old_value, new_value, source || 'draft', userId || null]
  );
}

async function recordPayloadChanges(caseId, before, after, userId, source = 'draft') {
  if (!caseId || !after) return;
  try {
    const rows = diffPayload(before || {}, after);
    for (const row of rows) {
      await insertRow({ caseId, userId, source, ...row });
    }
  } catch (e) {
    console.error('[valuation change log]', e.message || e);
  }
}

async function recordChangeEvent(caseId, userId, { field_key, field_label, old_value, new_value, source }) {
  if (!caseId) return;
  try {
    await insertRow({
      caseId,
      userId,
      source: source || 'draft',
      field_key,
      field_label,
      old_value: old_value == null || old_value === '' ? '（空）' : String(old_value),
      new_value: new_value == null || new_value === '' ? '（空）' : String(new_value),
    });
  } catch (e) {
    console.error('[valuation change log]', e.message || e);
  }
}

async function listChangeLog(caseId, { page = 1, pageSize = 50 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const count = await db.query(
    'SELECT COUNT(*) AS cnt FROM valuation_change_log WHERE case_id = ?',
    [caseId]
  );
  const list = await db.query(
    `SELECT l.F_Id AS id, l.field_key, l.field_label, l.old_value, l.new_value, l.source,
            l.F_CreatorUserId AS user_id, l.F_CreatorTime AS created_at,
            u.account AS user_account
     FROM valuation_change_log l
     LEFT JOIN users u ON u.F_Id = l.F_CreatorUserId
     WHERE l.case_id = ?
     ORDER BY l.F_CreatorTime DESC, l.F_Id DESC
     LIMIT ? OFFSET ?`,
    [caseId, ps, (p - 1) * ps]
  );
  return {
    list: list.map((r) => ({
      ...r,
      source_label: SOURCE_LABELS[r.source] || r.source || '草稿',
    })),
    total: Number(count[0]?.cnt || 0),
    page: p,
    pageSize: ps,
  };
}

module.exports = {
  TRACKED_FIELDS,
  recordPayloadChanges,
  recordChangeEvent,
  listChangeLog,
};
