/**
 * 业绩看板取数分层：层定义、目标表白名单、校验。
 * 存量 19 条 sql_layer 为 NULL，执行器按原链路跑，开发期不改写。
 */

const LOCAL_DATABASE_NAME = 'investment_tools';

/** 外库查询超时（extract / wash）；超时视为该层失败 */
const EXTERNAL_QUERY_TIMEOUT_MS = 10 * 60 * 1000;

const SQL_LAYERS = ['extract', 'wash', 'generate'];

const EXTRACT_TARGETS = [
  'perf_fund',
  'perf_relation',
  'perf_company',
  'perf_ipo',
  'perf_ipo_progress',
  'perf_fof_to_company_ratio',
  'perf_stock_price',
  'perf_exchange_rate',
  'b_transaction'
];

/** 本库 ipo_progress → perf_ipo_progress，允许不配外部库 */
const LOCAL_EXTRACT_TARGETS = ['perf_ipo_progress'];

const WASH_TARGETS = ['b_transaction'];

const GENERATE_TARGETS = [
  'b_manage',
  'b_manage_indicator',
  'b_transaction_indicator',
  'b_investor_list',
  'b_investment',
  'b_investment_spv',
  'b_investment_indicator',
  'b_investment_sum',
  'b_all_indicator',
  'b_ipo',
  'b_ipo_a',
  'b_ipo_p',
  'b_project',
  'b_project_a',
  'b_project_all',
  'b_region',
  'b_region_a'
];

const PERF_TABLES = EXTRACT_TARGETS.filter((t) => t.startsWith('perf_'));

const BOARD_DATA_TABLES = ['b_transaction', ...GENERATE_TARGETS];

/** 删除版本 / 定时清理：含 L1 与看板，不含 mapping / b_sql */
const VERSION_DATA_TABLES = [...PERF_TABLES, ...BOARD_DATA_TABLES, 'b_version'];

/** generate / 本库执行禁止 FROM/JOIN 的客户业务库表（须改用 perf_* / b_transaction） */
const FORBIDDEN_CUSTOMER_TABLES = [
  'spv_management',
  'fof_fund_management',
  'direct_fund_management',
  'sub_fund_management',
  'fundraising',
  'fund_transaction_detail',
  'project_transaction_detail',
  'invested_company',
  'sonfundpaidin',
  'penetration3_lpview_project',
  'fof_to_spv',
  'exitmanage',
  'pre_investment',
  'capital_account',
  'project_valuation',
  'penertrationprojectvaluation'
];

/** extract/wash 禁止 FROM/JOIN 的源库定开看板表（b_version 除外：外层用它做时点/版本标记） */
const FORBIDDEN_SOURCE_BOARD_TABLES = [
  'b_transaction_indicator',
  'b_manage_indicator',
  'b_investment_indicator',
  'b_investment_sum',
  'b_investor_list',
  'b_investment_spv',
  'b_all_indicator',
  'b_project_all',
  'b_project_a',
  'b_region_a',
  'b_ipo_p',
  'b_ipo_a',
  'b_transaction',
  'b_manage',
  'b_investment',
  'b_project',
  'b_region',
  'b_ipo',
  'b_sql'
];

const READY_STATUS_SQL = `(status = 'ready' OR status IS NULL)`;

function stripStringsAndComments(sql) {
  let s = (sql || '').replace(/\r\n/g, '\n');
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === "'" || s[i] === '"') {
      const q = s[i];
      out += ' ';
      i++;
      while (i < n && s[i] !== q) {
        if (s[i] === '\\') i++;
        i++;
      }
      if (i < n) i++;
      continue;
    }
    if (s[i] === '-' && s[i + 1] === '-') {
      out += ' ';
      i += 2;
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      out += ' ';
      i += 2;
      while (i < n - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

function findForbiddenBoardTable(sqlContent, layer) {
  const stripped = stripStringsAndComments(sqlContent || '');
  for (const table of FORBIDDEN_SOURCE_BOARD_TABLES) {
    // wash 上月未实现需要读源库/已洗 b_transaction，允许 FROM
    if (layer === 'wash' && table === 'b_transaction') continue;
    const re = new RegExp(`\\b(?:FROM|JOIN)\\s+(?:\\w+\\.)?\`?${table}\`?\\b`, 'i');
    if (re.test(stripped)) return table;
  }
  return null;
}

function findForbiddenCustomerTable(sqlContent) {
  const stripped = stripStringsAndComments(sqlContent || '');
  for (const table of FORBIDDEN_CUSTOMER_TABLES) {
    const re = new RegExp(`\\b(?:FROM|JOIN)\\s+(?:\\w+\\.)?\`?${table}\`?\\b`, 'i');
    if (re.test(stripped)) return table;
  }
  return null;
}

function normalizeLayer(sqlLayer) {
  if (sqlLayer == null || sqlLayer === '') return null;
  const layer = String(sqlLayer).trim().toLowerCase();
  return SQL_LAYERS.includes(layer) ? layer : null;
}

/**
 * 分层 SQL 配置校验。sqlLayer 为 null 时视为存量未分层，不做目标表/外部库约束。
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateSqlLayerConfig({ sqlLayer, targetTable, externalDbConfigId, sqlContent }) {
  const layer = normalizeLayer(sqlLayer);
  if (sqlLayer != null && String(sqlLayer).trim() !== '' && !layer) {
    return { ok: false, message: `sql_layer 只能是 extract / wash / generate，收到: ${sqlLayer}` };
  }
  if (!layer) return { ok: true };

  const target = targetTable ? String(targetTable).trim() : '';
  if (!target) return { ok: false, message: '目标表不能为空' };
  if (target.includes('.')) {
    return { ok: false, message: '目标表名不允许包含 schema 限定' };
  }

  const hasExternal = !!(externalDbConfigId && String(externalDbConfigId).trim());

  if (layer === 'extract') {
    if (!EXTRACT_TARGETS.includes(target)) {
      return { ok: false, message: `extract 目标表须为 L1 维度表（perf_*）或 b_transaction，收到: ${target}` };
    }
    if (!hasExternal && !LOCAL_EXTRACT_TARGETS.includes(target)) {
      return { ok: false, message: 'extract 须选择外部数据库（perf_ipo_progress 可读本库 ipo_progress，可不选）' };
    }
    const forbidden = findForbiddenBoardTable(sqlContent, 'extract');
    if (forbidden) {
      return { ok: false, message: `extract SQL 禁止 FROM/JOIN 源库看板表 ${forbidden}` };
    }
  }

  if (layer === 'wash') {
    if (!WASH_TARGETS.includes(target)) {
      return { ok: false, message: 'wash 目标表只能是 b_transaction' };
    }
    if (!hasExternal) {
      return { ok: false, message: 'wash 须选择外部数据库' };
    }
    const forbidden = findForbiddenBoardTable(sqlContent, 'wash');
    if (forbidden) {
      return { ok: false, message: `wash SQL 禁止 FROM/JOIN 源库看板表 ${forbidden}` };
    }
  }

  if (layer === 'generate') {
    if (!GENERATE_TARGETS.includes(target)) {
      return { ok: false, message: `generate 目标表须为本系统看板表，收到: ${target}` };
    }
    if (hasExternal) {
      return { ok: false, message: 'generate 从本系统业务库（investment_tools）执行，不能配置外部数据库' };
    }
    const customerTable = findForbiddenCustomerTable(sqlContent);
    if (customerTable) {
      return {
        ok: false,
        message: `generate SQL 禁止 FROM/JOIN 客户库表 ${customerTable}，请改用本系统 perf_* / b_transaction`
      };
    }
  }

  return { ok: true };
}

function isPerfTable(tableName) {
  const t = tableName ? String(tableName).trim() : '';
  return t.startsWith('perf_');
}

module.exports = {
  LOCAL_DATABASE_NAME,
  EXTERNAL_QUERY_TIMEOUT_MS,
  SQL_LAYERS,
  EXTRACT_TARGETS,
  LOCAL_EXTRACT_TARGETS,
  WASH_TARGETS,
  GENERATE_TARGETS,
  PERF_TABLES,
  BOARD_DATA_TABLES,
  VERSION_DATA_TABLES,
  FORBIDDEN_SOURCE_BOARD_TABLES,
  FORBIDDEN_CUSTOMER_TABLES,
  READY_STATUS_SQL,
  normalizeLayer,
  validateSqlLayerConfig,
  findForbiddenBoardTable,
  findForbiddenCustomerTable,
  isPerfTable
};
