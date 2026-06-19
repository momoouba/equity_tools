/**
 * 底层项目批量导入：中文/英文列名归一化、数值解析（含千分位逗号）
 */

const CN_TO_FIELD = {
  项目简称: 'project_name',
  企业全称: 'company',
  归属基金: 'fund',
  投资金额: 'inv_amount',
  剩余金额: 'residual_amount',
  穿透权益占比: 'ratio',
  穿透投资金额: 'ct_amount',
  穿透剩余金额: 'ct_residual',
  归属子基金: 'sub',
};

const EN_IMPORT_FIELDS = new Set([
  'project_name',
  'company',
  'fund',
  'inv_amount',
  'residual_amount',
  'ratio',
  'ct_amount',
  'ct_residual',
  'sub',
  'biz_update_time',
]);

/** 与 Excel 模板首行一致（中文表头） */
const IPO_BATCH_IMPORT_TEMPLATE_HEADERS_CN = [
  '项目简称',
  '企业全称',
  '归属基金',
  '投资金额',
  '剩余金额',
  '穿透权益占比',
  '穿透投资金额',
  '穿透剩余金额',
  '归属子基金',
];

const IPO_BATCH_IMPORT_TEMPLATE_EXAMPLE = [
  '示例项目',
  '某某科技有限公司',
  '基金A',
  1000000,
  0,
  0,
  0,
  0,
  '',
];

function resolveImportFieldKey(key) {
  const t = String(key).trim();
  if (CN_TO_FIELD[t]) return CN_TO_FIELD[t];
  if (EN_IMPORT_FIELDS.has(t)) return t;
  return null;
}

/**
 * 将字符串或数字转为数字；去掉千分位逗号、空格、全角逗号等
 */
function parseFlexibleNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return null;
  let s = String(value).trim();
  if (s === '') return null;
  s = s.replace(/[\s\u00A0\u202F\u3000]/g, '');
  s = s.replace(/,/g, '').replace(/，/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} raw
 * @returns {object|null} 可插入字段；不满足必填则返回 null
 */
function normalizeIpoBatchImportRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const acc = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = resolveImportFieldKey(k);
    if (f) acc[f] = v;
  }

  const project_name = acc.project_name != null ? String(acc.project_name).trim() : '';
  const company = acc.company != null ? String(acc.company).trim() : '';
  const fund = acc.fund != null ? String(acc.fund).trim() : '';
  const subRaw = acc.sub != null ? String(acc.sub).trim() : '';

  const inv_amount = parseFlexibleNumber(acc.inv_amount);
  const residual_amount = parseFlexibleNumber(acc.residual_amount);
  const ratio = parseFlexibleNumber(acc.ratio);
  const ct_amount = parseFlexibleNumber(acc.ct_amount);
  const ct_residual = parseFlexibleNumber(acc.ct_residual);

  if (!project_name || !company || !fund || inv_amount === null) {
    return null;
  }

  return {
    project_name,
    company,
    fund,
    inv_amount,
    residual_amount: residual_amount ?? 0,
    ratio: ratio ?? 0,
    ct_amount: ct_amount ?? 0,
    ct_residual: ct_residual ?? 0,
    sub: subRaw || null,
    biz_update_time: acc.biz_update_time,
  };
}

module.exports = {
  IPO_BATCH_IMPORT_TEMPLATE_HEADERS_CN,
  IPO_BATCH_IMPORT_TEMPLATE_EXAMPLE,
  CN_TO_FIELD,
  resolveImportFieldKey,
  parseFlexibleNumber,
  normalizeIpoBatchImportRow,
};
