/**
 * 业绩看板应用 - 数据查询路由
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { getCurrentUser } = require('../../middleware/auth');

router.use(getCurrentUser);

/**
 * 获取管理人指标
 * GET /api/performance/dashboard/manager?version=xxx
 */
router.get('/manager', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const rows = await db.query(
      `SELECT fof_num, direct_num, sub_amount, sub_add, 
              paid_in_amount, paid_in_add, dis_amount, dis_add,
              spv_num
       FROM b_manage_indicator
       WHERE version = ? AND F_DeleteMark = 0`,
      [version]
    );
    
    // 母基金/直投基金「自XX年起」：取 b_manage 中该类型最早成立年份（db.query 返回行数组，不要解构为 [rows]）
    let fofSinceYear = null;
    let directSinceYear = null;
    try {
      const fofRows = await db.query(
        `SELECT YEAR(MIN(set_up_date)) as y FROM b_manage 
         WHERE fund_type = '母基金' AND F_DeleteMark = 0 AND version = ?`,
        [version]
      );
      const fofVal = Array.isArray(fofRows) && fofRows.length > 0 ? (fofRows[0].y ?? fofRows[0].Y) : null;
      if (fofVal != null && fofVal !== '') fofSinceYear = Number(fofVal);
      const directRows = await db.query(
        `SELECT YEAR(MIN(set_up_date)) as y FROM b_manage 
         WHERE fund_type = '直投基金' AND F_DeleteMark = 0 AND version = ?`,
        [version]
      );
      const directVal = Array.isArray(directRows) && directRows.length > 0 ? (directRows[0].y ?? directRows[0].Y) : null;
      if (directVal != null && directVal !== '') directSinceYear = Number(directVal);
    } catch (e) {
      console.error('查询母基金/直投基金成立年份失败:', e.message);
    }
    
    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          fofNum: null,
          directNum: null,
          subAmount: null,
          subAdd: null,
          paidInAmount: null,
          paidInAdd: null,
          disAmount: null,
          disAdd: null,
          spvNum: null,
          fofSinceYear: fofSinceYear,
          directSinceYear: directSinceYear
        }
      });
    }
    
    const data = rows[0];
    res.json({
      success: true,
      data: {
        fofNum: data.fof_num,
        directNum: data.direct_num,
        subAmount: data.sub_amount,
        subAdd: data.sub_add,
        paidInAmount: data.paid_in_amount,
        paidInAdd: data.paid_in_add,
        disAmount: data.dis_amount,
        disAdd: data.dis_add,
        spvNum: data.spv_num,
        fofSinceYear: fofSinceYear,
        directSinceYear: directSinceYear
      }
    });
  } catch (error) {
    console.error('获取管理人指标失败:', error);
    res.status(500).json({ success: false, message: '获取管理人指标失败' });
  }
});

/**
 * 获取在管产品清单
 * GET /api/performance/dashboard/manager-funds?version=xxx
 */
router.get('/manager-funds', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const rows = await db.query(
      `SELECT fund, fund_type, sub_amount, sub_add,
              paid_in_amount, paid_in_add, dis_amount, dis_add,
              inv_start, ba_date, ba_num, set_up_date
       FROM b_manage
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY CASE fund_type
         WHEN '母基金' THEN 1
         WHEN '直投基金' THEN 2
         WHEN '内部备案SPV' THEN 3
         WHEN '内部非备案SPV' THEN 4
         WHEN '外部备案SPV' THEN 5
         WHEN '外部非备案SPV' THEN 6
         ELSE 7
       END, set_up_date ASC`,
      [version]
    );
    
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取在管产品清单失败:', error);
    res.status(500).json({ success: false, message: '获取在管产品清单失败' });
  }
});

/**
 * 获取基金产品指标
 * GET /api/performance/dashboard/funds?version=xxx
 */
router.get('/funds', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 获取指标数据（表头直接取自 b_transaction_indicator，该版本有什么就展示什么）
    // 表头逻辑顺序：先基金类型（母基金→直投基金→SPV），再成立时间；投资组合沿用同一顺序
    const indicatorRows = await db.query(
      `SELECT fund, lp_sub, paidin, distribution, tvpi, dpi, rvpi, nirr,
              sub_amount, inv_amount, exit_amount, girr, moc
       FROM b_transaction_indicator
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY CASE fund_type
         WHEN '母基金' THEN 1
         WHEN '直投基金' THEN 2
         WHEN '内部备案SPV' THEN 3
         WHEN '内部非备案SPV' THEN 4
         WHEN '外部备案SPV' THEN 5
         WHEN '外部非备案SPV' THEN 6
         ELSE 7
       END, set_up_date ASC`,
      [version]
    );

    const indicators = {};
    const funds = [];
    indicatorRows.forEach(row => {
      indicators[row.fund] = row;
      if (!funds.includes(row.fund)) funds.push(row.fund);
    });

    res.json({
      success: true,
      data: {
        funds,
        indicators
      }
    });
  } catch (error) {
    console.error('获取基金产品指标失败:', error);
    res.status(500).json({ success: false, message: '获取基金产品指标失败' });
  }
});

/**
 * 获取投资人名录
 * GET /api/performance/dashboard/investors?version=xxx&fund=xxx
 */
router.get('/investors', async (req, res) => {
  try {
    const { version, fund } = req.query;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    const rows = await db.query(
      `SELECT fund, lp, lp_type, subscription_amount, subscription_ratio,
              paidin, distribution, first_date, first_amount,
              second_date, second_amount, third_date, third_amount
       FROM b_investor_list
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [version, fund]
    );
    
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取投资人名录失败:', error);
    res.status(500).json({ success: false, message: '获取投资人名录失败' });
  }
});

/**
 * 获取基金业绩指标及现金流
 * GET /api/performance/dashboard/fund-performance?version=xxx&fund=xxx
 */
router.get('/fund-performance', async (req, res) => {
  try {
    const { version, fund } = req.query;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    // 获取指标
    const indicatorRows = await db.query(
      `SELECT fund, lp_sub, paidin, distribution, tvpi, dpi, rvpi, nirr
       FROM b_transaction_indicator
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [version, fund]
    );
    
    // 获取现金流明细（列表2）
    const cashflowRows = await db.query(
      `SELECT fund, lp, transaction_type, transaction_date, transaction_amount
       FROM b_transaction
       WHERE version = ? AND fund = ? AND lp IS NOT NULL AND F_DeleteMark = 0
       ORDER BY fund, transaction_date DESC`,
      [version, fund]
    );
    
    res.json({
      success: true,
      data: {
        indicator: indicatorRows,
        cashflow: cashflowRows
      }
    });
  } catch (error) {
    console.error('获取基金业绩指标失败:', error);
    res.status(500).json({ success: false, message: '获取基金业绩指标失败' });
  }
});

/**
 * 获取基金投资组合明细
 * GET /api/performance/dashboard/fund-portfolio?version=xxx&fund=xxx
 */
router.get('/fund-portfolio', async (req, res) => {
  try {
    const { version, fund } = req.query;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    const rows = await db.query(
      `SELECT transaction_type, project, first_date, acc_sub, change_sub,
              acc_paidin, change_paidin, acc_exit, change_exit,
              acc_receive, change_receive, unrealized, change_unrealized,
              total_value, moc, dpi, irr
       FROM b_investment
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0
       ORDER BY transaction_type, first_date ASC`,
      [version, fund]
    );

    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取基金投资组合明细失败:', error);
    res.status(500).json({ success: false, message: '获取基金投资组合明细失败' });
  }
});

/**
 * 获取项目现金流及业绩指标
 * GET /api/performance/dashboard/project-cashflow?version=xxx&fund=xxx
 */
router.get('/project-cashflow', async (req, res) => {
  try {
    const { version, fund } = req.query;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    // 获取业绩指标
    const indicatorRows = await db.query(
      `SELECT fund, sub_amount, inv_amount, exit_amount, girr, moc
       FROM b_transaction_indicator
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [version, fund]
    );
    
    // 获取项目现金流
    const cashflowRows = await db.query(
      `SELECT fund, spv, sub_fund, company, transaction_type, transaction_date, transaction_amount
       FROM b_transaction
       WHERE version = ? AND fund = ? AND lp IS NULL AND F_DeleteMark = 0
       ORDER BY transaction_date DESC`,
      [version, fund]
    );
    
    res.json({
      success: true,
      data: {
        indicator: indicatorRows[0] || null,
        cashflow: cashflowRows
      }
    });
  } catch (error) {
    console.error('获取项目现金流失败:', error);
    res.status(500).json({ success: false, message: '获取项目现金流失败' });
  }
});

/**
 * 获取投资组合数据
 * GET /api/performance/dashboard/portfolio?version=xxx
 */
router.get('/portfolio', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 获取各基金的投资组合指标
    // 表头顺序与基金产品一致：先基金类型（母基金→直投基金→SPV），再成立时间
    const fundRows = await db.query(
      `SELECT fund, fund_inv, fund_exit, fund_sub, fund_exit_amount,
              fund_paidin, fund_receive, project_inv, project_exit,
              project_paidin, project_receive
       FROM b_investment_indicator
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY CASE fund_type
         WHEN '母基金' THEN 1
         WHEN '直投基金' THEN 2
         WHEN '内部备案SPV' THEN 3
         WHEN '内部非备案SPV' THEN 4
         WHEN '外部备案SPV' THEN 5
         WHEN '外部非备案SPV' THEN 6
         ELSE 7
       END, set_up_date ASC`,
      [version]
    );
    
    // 获取整体组合指标
    const overallRows = await db.query(
      `SELECT fund_inv, fund_inv_change, fund_sub, fund_sub_change,
              fund_paidin, fund_paidin_change, fund_exit, fund_exit_change,
              fund_exit_amount, fund_exit_amount_change, fund_receive, fund_receive_change,
              project_inv, project_inv_change, project_paidin, project_paidin_change,
              project_exit, project_exit_change, project_receive, project_receive_change,
              spv_paidin, spv_paidin_change, spv_receive, spv_receive_change,
              ipo_num, ipo_cost, ipo_valuation,
              fd_num, fd_cost, fd_valuation,
              sl_num, sl_cost, sl_valuation
       FROM b_all_indicator
       WHERE version = ? AND F_DeleteMark = 0`,
      [version]
    );
    
    res.json({
      success: true,
      data: {
        funds: fundRows,
        overall: overallRows[0] || null
      }
    });
  } catch (error) {
    console.error('获取投资组合数据失败:', error);
    res.status(500).json({ success: false, message: '获取投资组合数据失败' });
  }
});

/**
 * 获取整体基金投资组合明细
 * GET /api/performance/dashboard/portfolio-detail?version=xxx
 */
router.get('/portfolio-detail', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const rows = await db.query(
      `SELECT transaction_type, project, first_date, acc_sub, change_sub, acc_paidin,
              change_paidin, acc_exit, change_exit, acc_receive, change_receive,
              unrealized, change_unrealized, total_value, moc, dpi, irr
       FROM b_investment_sum
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY (CASE WHEN transaction_type = '子基金' THEN 0 WHEN transaction_type = '直投项目' THEN 1 ELSE 2 END), first_date DESC`,
      [version]
    );

    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取整体投资组合明细失败:', error);
    res.status(500).json({ success: false, message: '获取整体投资组合明细失败' });
  }
});

/**
 * 获取SPV投资组合明细
 * GET /api/performance/dashboard/spv-detail?version=xxx
 */
router.get('/spv-detail', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const rows = await db.query(
      `SELECT fund, fund_type, set_up_date, transaction_type, project,
              acc_sub, acc_paidin, acc_exit, acc_receive, fund_paid, lp_paid
       FROM b_investment_spv
       WHERE version = ? AND F_DeleteMark = 0
         AND (lp_paid IS NOT NULL AND lp_paid > 0)
         AND fund_type = '内部备案SPV'
       ORDER BY set_up_date ASC`,
      [version]
    );
    
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取SPV投资组合明细失败:', error);
    res.status(500).json({ success: false, message: '获取SPV投资组合明细失败' });
  }
});

/**
 * 获取底层资产数据
 * GET /api/performance/dashboard/underlying?version=xxx
 */
router.get('/underlying', async (req, res) => {
  try {
    const { version } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 一次查询获取累计+当前所有字段
    const rows = await db.query(
      `SELECT project_num_a, company_num_a, total_amount_a, ct_amount_a,
              ipo_num_a, ipo_amount_a, sh_num_a, sh_amount_a,
              project_num, company_num, total_amount, ct_amount,
              ipo_num, ipo_amount, sh_num, sh_amount
       FROM b_project_all
       WHERE version = ? AND F_DeleteMark = 0`,
      [version]
    );
    
    const row = rows[0] || null;
    const cumulative = row ? {
      project_num_a: row.project_num_a,
      company_num_a: row.company_num_a,
      total_amount_a: row.total_amount_a,
      ct_amount_a: row.ct_amount_a,
      ipo_num_a: row.ipo_num_a,
      ipo_amount_a: row.ipo_amount_a,
      sh_num_a: row.sh_num_a,
      sh_amount_a: row.sh_amount_a
    } : null;
    const current = row ? {
      project_num: row.project_num,
      company_num: row.company_num,
      total_amount: row.total_amount,
      ct_amount: row.ct_amount,
      ipo_num: row.ipo_num,
      ipo_amount: row.ipo_amount,
      sh_num: row.sh_num,
      sh_amount: row.sh_amount
    } : null;
    
    res.json({
      success: true,
      data: { cumulative, current }
    });
  } catch (error) {
    console.error('获取底层资产数据失败:', error);
    res.status(500).json({ success: false, message: '获取底层资产数据失败' });
  }
});

/**
 * 获取底层企业明细
 * GET /api/performance/dashboard/underlying-companies?version=xxx&type=cumulative|current
 * 列表来自 b_project_a(累计)/b_project(当前)，合计(去重)来自 b_project_all
 */
router.get('/underlying-companies', async (req, res) => {
  try {
    const { version, type = 'cumulative' } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const table = type === 'cumulative' ? 'b_project_a' : 'b_project';
    
    const rows = await db.query(
      `SELECT fund, project_num, company_num, total_amount, project_amount,
              ipo_num, ipo_amount
       FROM ${table}
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY set_up_date ASC`,
      [version]
    );
    
    // 合计(去重)：从 b_project_all 取数，每版本一行
    let totalDedup = null;
    try {
      const dedupCols = type === 'cumulative'
        ? 'project_num_a AS project_num, company_num_a AS company_num, total_amount_a AS total_amount, ct_amount_a AS project_amount, ipo_num_a AS ipo_num, ipo_amount_a AS ipo_amount'
        : 'project_num, company_num, total_amount, ct_amount AS project_amount, ipo_num, ipo_amount';
      const dedupRows = await db.query(
        `SELECT ${dedupCols} FROM b_project_all WHERE version = ? AND F_DeleteMark = 0`,
        [version]
      );
      if (dedupRows.length > 0) {
        totalDedup = dedupRows[0];
      }
    } catch (e) {
      console.error('获取底层企业合计(去重)失败:', e.message);
    }
    
    res.json({
      success: true,
      data: {
        list: rows,
        summary: totalDedup ? { totalDedup } : undefined
      }
    });
  } catch (error) {
    console.error('获取底层企业明细失败:', error);
    res.status(500).json({ success: false, message: '获取底层企业明细失败' });
  }
});

/**
 * 获取上市企业明细
 * GET /api/performance/dashboard/ipo-companies?version=xxx&type=cumulative|current
 */
router.get('/ipo-companies', async (req, res) => {
  try {
    const { version, type = 'cumulative' } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const table = type === 'cumulative' ? 'b_ipo_a' : 'b_ipo';
    
    const rows = await db.query(
      `SELECT project, ipo_date, fund, amount
       FROM ${table}
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY ipo_date DESC`,
      [version]
    );
    
    res.json({ success: true, data: { list: rows } });
  } catch (error) {
    console.error('获取上市企业明细失败:', error);
    res.status(500).json({ success: false, message: '获取上市企业明细失败' });
  }
});

const IPO_P_STATUS_WHITELIST = ['已上市', '已受理', '辅导备案'];

/**
 * 直投项目-上市进展企业明细（b_ipo_p）
 * GET /api/performance/dashboard/listed-enterprises?version=xxx&status=已上市|已受理|辅导备案
 */
router.get('/listed-enterprises', async (req, res) => {
  try {
    const { version, status = '已上市' } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    if (!IPO_P_STATUS_WHITELIST.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的上市状态' });
    }

    const rows = await db.query(
      `SELECT fund, project, ipo_date, ticker, ipo_progress, paid_amount, realized, unrealized, total_value,
              DPI AS dpi, MOC AS moc
       FROM b_ipo_p
       WHERE version = ? AND F_DeleteMark = 0 AND ipo_status = ?
       ORDER BY ipo_date DESC, fund ASC, project ASC`,
      [version, status]
    );

    const list = Array.isArray(rows) ? rows : [];
    const projectSet = new Set();
    let paidAmount = 0;
    let realized = 0;
    let unrealized = 0;
    let totalValue = 0;
    for (const row of list) {
      const p = row.project != null ? String(row.project).trim() : '';
      if (p) projectSet.add(p);
      paidAmount += Number(row.paid_amount) || 0;
      realized += Number(row.realized) || 0;
      unrealized += Number(row.unrealized) || 0;
      totalValue += Number(row.total_value) || 0;
    }
    const dpi = paidAmount !== 0 ? realized / paidAmount : null;
    const moc = paidAmount !== 0 ? totalValue / paidAmount : null;

    res.json({
      success: true,
      data: {
        list,
        status,
        summary: {
          projectCountDedup: projectSet.size,
          paid_amount: paidAmount,
          realized,
          unrealized,
          total_value: totalValue,
          dpi,
          moc,
        },
      },
    });
  } catch (error) {
    console.error('获取上市进展企业明细失败:', error);
    res.status(500).json({ success: false, message: '获取上市进展企业明细失败' });
  }
});

/**
 * 获取区域企业明细
 * GET /api/performance/dashboard/region-companies?version=xxx&type=cumulative|current
 * 列表来自 b_region_a(累计)/b_region(当前)，合计(去重)来自 b_project_all
 */
router.get('/region-companies', async (req, res) => {
  try {
    const { version, type = 'cumulative' } = req.query;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const table = type === 'cumulative' ? 'b_region_a' : 'b_region';
    
    const rows = await db.query(
      `SELECT fund, csj_num, csj_amount, sh_num, sh_amount, pd_num, pd_amount
       FROM ${table}
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY set_up_date ASC`,
      [version]
    );
    
    // 合计(去重)：从 b_project_all 取数
    let totalDedup = null;
    try {
      const dedupCols = type === 'cumulative'
        ? 'csj_num_a AS csj_num, csj_amount_a AS csj_amount, sh_num_a AS sh_num, sh_amount_a AS sh_amount, pd_num_a AS pd_num, pd_amount_a AS pd_amount'
        : 'csj_num, csj_amount, sh_num, sh_amount, pd_num, pd_amount';
      const dedupRows = await db.query(
        `SELECT ${dedupCols} FROM b_project_all WHERE version = ? AND F_DeleteMark = 0`,
        [version]
      );
      if (dedupRows.length > 0) {
        totalDedup = dedupRows[0];
      }
    } catch (e) {
      console.error('获取区域企业合计(去重)失败:', e.message);
    }
    
    res.json({
      success: true,
      data: {
        list: rows,
        summary: totalDedup ? { totalDedup } : undefined
      }
    });
  } catch (error) {
    console.error('获取区域企业明细失败:', error);
    res.status(500).json({ success: false, message: '获取区域企业明细失败' });
  }
});

module.exports = router;
