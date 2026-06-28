/**
 * 业绩看板 - 共享数据查询
 * 提取 manager / funds / portfolio / underlying 四大板块的查询逻辑，
 * 供 dashboard 路由和 share /data 端点复用。
 */
const db = require('../../db');

/**
 * 获取管理人板块数据
 * @param {string} version 版本号
 * @returns {{ indicator: object|null, fundsList: object[], fofSinceYear: number|null, directSinceYear: number|null }}
 */
async function fetchManagerData(version) {
  const indicatorRows = await db.query(
    `SELECT fof_num, direct_num, sub_amount, sub_add,
            paid_in_amount, paid_in_add, dis_amount, dis_add,
            spv_num
     FROM b_manage_indicator
     WHERE version = ? AND F_DeleteMark = 0`,
    [version]
  );
  const indicator = indicatorRows.length > 0 ? indicatorRows[0] : null;

  let fofSinceYear = null;
  let directSinceYear = null;
  try {
    const fofRows = await db.query(
      `SELECT YEAR(MIN(set_up_date)) AS y FROM b_manage
       WHERE fund_type = '母基金' AND F_DeleteMark = 0 AND version = ?`,
      [version]
    );
    const fofVal = Array.isArray(fofRows) && fofRows.length > 0 ? (fofRows[0].y ?? fofRows[0].Y) : null;
    if (fofVal != null && fofVal !== '') fofSinceYear = Number(fofVal);

    const directRows = await db.query(
      `SELECT YEAR(MIN(set_up_date)) AS y FROM b_manage
       WHERE fund_type = '直投基金' AND F_DeleteMark = 0 AND version = ?`,
      [version]
    );
    const directVal = Array.isArray(directRows) && directRows.length > 0 ? (directRows[0].y ?? directRows[0].Y) : null;
    if (directVal != null && directVal !== '') directSinceYear = Number(directVal);
  } catch (e) {
    console.error('[dashboardQueries] 查询母基金/直投基金成立年份失败:', e.message);
  }

  const fundsList = await db.query(
    `SELECT fund, fund_type, sub_amount, sub_add,
            paid_in_amount, paid_in_add, dis_amount, dis_add
     FROM b_manage
     WHERE version = ? AND F_DeleteMark = 0
       AND fund_type NOT IN ('内部非备案SPV', '外部非备案SPV', '外部备案SPV')
     ORDER BY CASE fund_type WHEN '母基金' THEN 1 WHEN '直投基金' THEN 2 WHEN '内部备案SPV' THEN 3 ELSE 4 END, set_up_date DESC`,
    [version]
  );

  return { indicator, fundsList, fofSinceYear, directSinceYear };
}

/**
 * 获取基金产品板块数据
 * @param {string} version
 * @returns {{ funds: string[], indicators: Object<string, object> }}
 */
async function fetchFundsData(version) {
  const indicatorRows = await db.query(
    `SELECT fund, lp_sub, paidin, distribution, tvpi, dpi, rvpi, nirr,
            sub_amount, inv_amount, exit_amount, girr, moc
     FROM b_transaction_indicator
     WHERE version = ? AND F_DeleteMark = 0`,
    [version]
  );
  const indicators = {};
  const funds = [];
  indicatorRows.forEach((row) => {
    indicators[row.fund] = row;
    if (!funds.includes(row.fund)) funds.push(row.fund);
  });

  return { funds, indicators };
}

/**
 * 获取投资组合板块数据
 * @param {string} version
 * @returns {{ funds: object[], overall: object|null }}
 */
async function fetchPortfolioData(version) {
  const fundRows = await db.query(
    `SELECT fund, fund_inv, fund_exit, fund_sub, fund_exit_amount,
            fund_paidin, fund_receive, project_inv, project_exit,
            project_paidin, project_receive
     FROM b_investment_indicator
     WHERE version = ? AND F_DeleteMark = 0`,
    [version]
  );

  const overallRows = await db.query(
    `SELECT fund_inv, fund_inv_change, fund_sub, fund_sub_change,
            fund_paidin, fund_paidin_change, fund_exit, fund_exit_change,
            fund_exit_amount, fund_exit_amount_change, fund_receive, fund_receive_change,
            project_inv, project_inv_change, project_paidin, project_paidin_change,
            project_exit, project_exit_change, project_receive, project_receive_change,
            spv_paidin, spv_paidin_change, spv_receive, spv_receive_change
     FROM b_all_indicator
     WHERE version = ? AND F_DeleteMark = 0`,
    [version]
  );

  return { funds: fundRows, overall: overallRows[0] || null };
}

/**
 * 获取底层资产板块数据
 * @param {string} version
 * @returns {{ cumulative: object|null, current: object|null }}
 */
async function fetchUnderlyingData(version) {
  // 合并为一次查询（同一张表同一条件，累计列 + 当前列）
  const rows = await db.query(
    `SELECT project_num_a, company_num_a, total_amount_a, ct_amount_a,
            ipo_num_a, ipo_amount_a, sh_num_a, sh_amount_a,
            project_num, company_num, total_amount, ct_amount,
            ipo_num, ipo_amount, sh_num, sh_amount
     FROM b_project_all
     WHERE version = ? AND F_DeleteMark = 0`,
    [version]
  );
  if (!rows.length) return { cumulative: null, current: null };
  const r = rows[0];
  return {
    cumulative: {
      project_num_a: r.project_num_a, company_num_a: r.company_num_a,
      total_amount_a: r.total_amount_a, ct_amount_a: r.ct_amount_a,
      ipo_num_a: r.ipo_num_a, ipo_amount_a: r.ipo_amount_a,
      sh_num_a: r.sh_num_a, sh_amount_a: r.sh_amount_a,
    },
    current: {
      project_num: r.project_num, company_num: r.company_num,
      total_amount: r.total_amount, ct_amount: r.ct_amount,
      ipo_num: r.ipo_num, ipo_amount: r.ipo_amount,
      sh_num: r.sh_num, sh_amount: r.sh_amount,
    },
  };
}

/**
 * 一次性获取看板四大板块数据（并行查询）
 * @param {string} version
 * @returns {{ manager: object, funds: object, portfolio: object, underlying: object }}
 */
async function fetchDashboardData(version) {
  const [mgr, funds, portfolio, underlying] = await Promise.all([
    fetchManagerData(version),
    fetchFundsData(version),
    fetchPortfolioData(version),
    fetchUnderlyingData(version),
  ]);

  // 组装 manager 板块（与 dashboard.js /manager + /manager-funds 响应结构一致）
  const manager = {
    fofNum: mgr.indicator ? mgr.indicator.fof_num : null,
    directNum: mgr.indicator ? mgr.indicator.direct_num : null,
    subAmount: mgr.indicator ? mgr.indicator.sub_amount : null,
    subAdd: mgr.indicator ? mgr.indicator.sub_add : null,
    paidInAmount: mgr.indicator ? mgr.indicator.paid_in_amount : null,
    paidInAdd: mgr.indicator ? mgr.indicator.paid_in_add : null,
    disAmount: mgr.indicator ? mgr.indicator.dis_amount : null,
    disAdd: mgr.indicator ? mgr.indicator.dis_add : null,
    spvNum: mgr.indicator ? mgr.indicator.spv_num : null,
    fofSinceYear: mgr.fofSinceYear,
    directSinceYear: mgr.directSinceYear,
    fundsList: mgr.fundsList,
  };

  return { manager, funds, portfolio, underlying };
}

module.exports = {
  fetchDashboardData,
  fetchManagerData,
  fetchFundsData,
  fetchPortfolioData,
  fetchUnderlyingData,
};
