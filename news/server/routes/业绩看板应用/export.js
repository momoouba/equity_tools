/**
 * 业绩看板应用 - 数据导出路由
 */
const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const db = require('../../db');
const { getCurrentUser } = require('../../middleware/auth');

const SYSTEM_COLUMN_RE =
  /^F_(Id|CreatorUserId|CreatorTime|DeleteUserId|DeleteMark|DeleteTime|Lock|LastModifyUserId|LastModifyTime)$/i;

const SYSTEM_COMMENT_RE =
  /^(主键|创建用户|创建时间|删除用户|删除状态|删除时间|锁定状态|最后修改时间|修改用户)$/;

function isSystemPerformanceColumn(columnName, comment) {
  if (SYSTEM_COLUMN_RE.test(String(columnName || ''))) return true;
  return SYSTEM_COMMENT_RE.test(String(comment || '').trim());
}

function parseCommentOrder(comment) {
  const m = String(comment || '').match(/^(.*?)-(\d+)$/);
  if (!m) return null;
  const label = m[1] && m[1].trim() ? m[1].trim() : '';
  const order = parseInt(m[2], 10);
  if (!label || !Number.isFinite(order)) return null;
  return { label, order };
}

async function getOrderedColumnsByComment(tableName) {
  const cols = await db.query(
    `SELECT COLUMN_NAME, COLUMN_COMMENT, ORDINAL_POSITION
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName]
  );

  const withOrder = (cols || [])
    .map((c) => {
      if (isSystemPerformanceColumn(c.COLUMN_NAME, c.COLUMN_COMMENT)) return null;
      const parsed = parseCommentOrder(c.COLUMN_COMMENT);
      if (!parsed) return null;
      return { name: c.COLUMN_NAME, label: parsed.label, order: parsed.order };
    })
    .filter(Boolean)
    .sort(
      (a, b) => a.order - b.order || String(a.label).localeCompare(String(b.label), 'zh-CN')
    );

  if (withOrder.length > 0) return withOrder;

  return (cols || [])
    .filter((c) => !isSystemPerformanceColumn(c.COLUMN_NAME, c.COLUMN_COMMENT))
    .map((c) => ({
      name: c.COLUMN_NAME,
      label: String(c.COLUMN_COMMENT || '').replace(/-\d+$/, '').trim() || c.COLUMN_NAME,
    }));
}

const DEFAULT_MAX_EXPORT_ROWS = parseInt(process.env.MAX_EXPORT_ROWS || '50000', 10) || 50000;

async function buildSheetFromRows(tableName, rows, opts = {}) {
  const maxRows = Math.max(100, Math.min(200000, parseInt(opts.maxExportRows || DEFAULT_MAX_EXPORT_ROWS, 10) || DEFAULT_MAX_EXPORT_ROWS));
  const truncated = rows && rows.length > maxRows;
  const safeRows = truncated ? rows.slice(0, maxRows) : (rows || []);
  const cols = await getOrderedColumnsByComment(tableName);
  const data = [];

  const dateColFlags = cols.map((c) => {
    const label = (c.label || '').toString();
    const name = (c.name || '').toString();
    return /日期|时间/.test(label) || /(_date|_time|b_date)$/i.test(name);
  });

  data.push(cols.map((c) => c.label));

  safeRows.forEach((row) => {
    const line = cols.map((c, idx) => {
      let v = row[c.name];
      if (v == null) return null;

      if (dateColFlags[idx]) {
        const d = v instanceof Date ? v : new Date(v);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${dd}`;
        }
        return String(v).slice(0, 10);
      }
      return v;
    });
    data.push(line);
  });

  if (truncated) {
    data.push([`⚠ 数据量过大，已截断显示前 ${maxRows} 行（共 ${rows.length} 行），请缩小查询范围或联系管理员提高上限后重新导出`]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const colWidths = new Array(range.e.c - range.s.c + 1).fill(0);

  for (let C = range.s.c; C <= range.e.c; C++) {
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
      const cell = ws[cellRef];
      if (!cell) continue;

      if (R === range.s.r) {
        cell.s = cell.s || {};
        cell.s.fill = { fgColor: { rgb: '165DFF' } };
        cell.s.font = { color: { rgb: 'FFFFFF' }, bold: true };
      } else {
        const isNumericString = typeof cell.v === 'string' && /^-?\d+(\.\d+)?$/.test(cell.v);
        if (typeof cell.v === 'number' || isNumericString) {
          const num = Number(cell.v);
          if (!Number.isNaN(num)) {
            const isInteger = Number.isInteger(num);
            cell.v = isInteger ? num : Number(num.toFixed(2));
            cell.t = 'n';
            cell.z = isInteger ? '#,##0' : '#,##0.00';
          }
        }
      }

      const text = cell.v == null ? '' : String(cell.v);
      colWidths[C - range.s.c] = Math.max(colWidths[C - range.s.c], text.length);
    }
  }

  ws['!cols'] = colWidths.map((w) => ({ wch: Math.min(Math.max(w + 2, 8), 40) }));
  return ws;
}

// 构造安全的 Content-Disposition，避免中文/换行等导致 ERR_INVALID_CHAR
function buildContentDisposition(filename) {
  const safeAscii = String(filename)
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .replace(/[^\x20-\x7E]/g, '_'); // 非 ASCII 替换为下划线，保证 Node 不报错
  const encoded = encodeURIComponent(String(filename));
  // 同时带上 filename*，方便支持 UTF-8 文件名的浏览器
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

router.use(getCurrentUser);

// 导出权限中间件：只允许拥有业绩看板导出权限的用户访问
async function checkExportPermission(req, res, next) {
  try {
    const user = req.currentUser;
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    // admin 账号可以导出全部
    if (user.role === 'admin') {
      return next();
    }

    // 通过业绩看板权限接口的逻辑判断导出能力（普通/高级会员不允许导出，VIP允许）
    // 这里直接重用 membership_levels 的规则：只有 VIP会员 才允许导出
    const levelRows = await db.query(
      `SELECT ml.level_name
       FROM users u
       LEFT JOIN membership_levels ml ON u.membership_level_id = ml.id
       WHERE u.id = ?
       LIMIT 1`,
      [user.id]
    );

    const levelName = levelRows[0]?.level_name || '';
    if (levelName !== 'VIP会员') {
      return res.status(403).json({ success: false, message: '当前会员等级不支持导出业绩看板数据' });
    }

    next();
  } catch (error) {
    console.error('[业绩看板] 导出权限检查失败：', error);
    return res.status(500).json({ success: false, message: '导出权限检查失败' });
  }
}

/**
 * 导出在管产品清单
 * POST /api/performance/exports/manager-funds
 */
router.post('/manager-funds', checkExportPermission, async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 获取在管产品清单数据
    const manageRows = await db.query(
      `SELECT * FROM b_manage
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund_type, set_up_date`,
      [version]
    );
    
    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND F_DeleteMark = 0 
         AND transaction_type IN ('实缴','分配','认缴') 
         AND lp IS NOT NULL
       ORDER BY fund, transaction_date ASC`,
      [version]
    );
    
    // 创建工作簿
    const wb = XLSX.utils.book_new();
    
    // Sheet1: 在管产品清单（使用 b_manage 字段注释定义列名和顺序）
    const ws1 = await buildSheetFromRows('b_manage', manageRows);
    XLSX.utils.book_append_sheet(wb, ws1, '在管产品清单');
    
    // Sheet2: 数据明细表（使用 b_transaction 字段注释定义列名和顺序）
    const ws2 = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '数据明细表');
    
    // 生成文件名
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-在管产品清单-${date}.xlsx`;
    
    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    // 发送文件
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出在管产品清单失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出投资人名录
 * POST /api/performance/exports/investors
 */
router.post('/investors', checkExportPermission, async (req, res) => {
  try {
    const { version, fund } = req.body;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    // 获取投资人名录
    const investorRows = await db.query(
      `SELECT * FROM b_investor_list
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [version, fund]
    );
    
    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0
       ORDER BY transaction_date ASC`,
      [version, fund]
    );
    
    const wb = XLSX.utils.book_new();
    
    const ws1 = await buildSheetFromRows('b_investor_list', investorRows);
    XLSX.utils.book_append_sheet(wb, ws1, '投资人名录');
    
    const ws2 = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '数据明细表');
    
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-${fund}-投资人名录-${date}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出投资人名录失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出基金业绩指标及现金流底表
 * POST /api/performance/exports/fund-performance
 */
router.post('/fund-performance', checkExportPermission, async (req, res) => {
  try {
    const { version, fund } = req.body;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    // 获取基金业绩指标
    const indicatorRows = await db.query(
      `SELECT * FROM b_transaction_indicator
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [version, fund]
    );
    
    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0
       ORDER BY transaction_date ASC`,
      [version, fund]
    );
    
    const wb = XLSX.utils.book_new();
    
    const ws1 = await buildSheetFromRows('b_transaction_indicator', indicatorRows);
    XLSX.utils.book_append_sheet(wb, ws1, '基金业绩指标');
    
    const ws2 = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '数据明细表');
    
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-${fund}-基金业绩指标及现金流底表-${date}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出基金业绩指标失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出基金投资组合明细
 * POST /api/performance/exports/fund-portfolio
 */
router.post('/fund-portfolio', checkExportPermission, async (req, res) => {
  try {
    const { version, fund } = req.body;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    // 获取投资组合明细
    const portfolioRows = await db.query(
      `SELECT * FROM b_investment
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0
       ORDER BY transaction_type, first_date ASC`,
      [version, fund]
    );
    
    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0
       ORDER BY transaction_date DESC`,
      [version, fund]
    );
    
    const wb = XLSX.utils.book_new();
    
    const ws1 = await buildSheetFromRows('b_investment', portfolioRows);
    XLSX.utils.book_append_sheet(wb, ws1, '基金投资组合明细');
    
    const ws2 = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '数据明细表');
    
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-${fund}-基金投资组合明细-${date}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出基金投资组合明细失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出项目现金流及业绩指标
 * POST /api/performance/exports/project-cashflow
 */
router.post('/project-cashflow', checkExportPermission, async (req, res) => {
  try {
    const { version, fund } = req.body;
    if (!version || !fund) {
      return res.status(400).json({ success: false, message: '版本号和基金名称不能为空' });
    }
    
    // 获取业绩指标
    const indicatorRows = await db.query(
      `SELECT * FROM b_transaction_indicator
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0`,
      [version, fund]
    );
    
    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND fund = ? AND F_DeleteMark = 0
       ORDER BY transaction_date ASC`,
      [version, fund]
    );
    
    const wb = XLSX.utils.book_new();
    
    const ws1 = await buildSheetFromRows('b_transaction_indicator', indicatorRows);
    XLSX.utils.book_append_sheet(wb, ws1, '项目现金流及业绩指标');
    
    const ws2 = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '数据明细表');
    
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-${fund}-项目现金流及业绩指标-${date}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出项目现金流失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出整体基金投资组合明细
 * POST /api/performance/exports/portfolio-detail
 */
router.post('/portfolio-detail', checkExportPermission, async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 获取整体投资组合明细
    const portfolioRows = await db.query(
      `SELECT * FROM b_investment_sum
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY transaction_type`,
      [version]
    );

    // 获取SPV投资组合明细
    const spvRows = await db.query(
      `SELECT * FROM b_investment_spv
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, transaction_type, first_date ASC`,
      [version]
    );
    
    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY transaction_date DESC`,
      [version]
    );
    
    const wb = XLSX.utils.book_new();
    
    const ws1 = await buildSheetFromRows('b_investment_sum', portfolioRows);
    XLSX.utils.book_append_sheet(wb, ws1, '全量基金投资组合明细');

    const wsSpv = await buildSheetFromRows('b_investment_spv', spvRows);
    XLSX.utils.book_append_sheet(wb, wsSpv, 'SPV投资组合明细');
    
    const ws2 = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, '数据明细表');
    
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-基金投资组合明细-${date}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出整体投资组合明细失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出SPV投资组合明细
 * POST /api/performance/exports/spv-detail
 */
router.post('/spv-detail', checkExportPermission, async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }

    // 获取SPV投资组合明细
    const spvRows = await db.query(
      `SELECT * FROM b_investment_spv
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, transaction_type, first_date ASC`,
      [version]
    );

    // 获取数据明细
    const detailRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY transaction_date DESC`,
      [version]
    );

    const wb = XLSX.utils.book_new();

    const wsSpv = await buildSheetFromRows('b_investment_spv', spvRows);
    XLSX.utils.book_append_sheet(wb, wsSpv, 'SPV投资组合明细');

    const wsDetail = await buildSheetFromRows('b_transaction', detailRows);
    XLSX.utils.book_append_sheet(wb, wsDetail, '数据明细表');

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-SPV投资组合明细-${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出SPV投资组合明细失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出投资组合（当前版本全部基金）
 * POST /api/performance/exports/portfolio
 */
router.post('/portfolio', checkExportPermission, async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }

    const indicatorRows = await db.query(
      `SELECT * FROM b_investment_indicator
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund_type, fund`,
      [version]
    );

    const detailRows = await db.query(
      `SELECT * FROM b_investment
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, transaction_type, first_date ASC`,
      [version]
    );

    const wb = XLSX.utils.book_new();
    const wsIndicator = await buildSheetFromRows('b_investment_indicator', indicatorRows);
    XLSX.utils.book_append_sheet(wb, wsIndicator, '基金投资组合指标');

    const wsDetail = await buildSheetFromRows('b_investment', detailRows);
    XLSX.utils.book_append_sheet(wb, wsDetail, '基金投资组合明细');

    const transactionRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, transaction_date ASC`,
      [version]
    );
    const wsTransaction = await buildSheetFromRows('b_transaction', transactionRows);
    XLSX.utils.book_append_sheet(wb, wsTransaction, '数据明细表');

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-投资组合-${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出投资组合失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出基金产品指标（当前版本全部基金）
 * POST /api/performance/exports/fund-products
 */
router.post('/fund-products', checkExportPermission, async (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }

    const indicatorRows = await db.query(
      `SELECT * FROM b_transaction_indicator
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund_type, fund`,
      [version]
    );

    const investorRows = await db.query(
      `SELECT * FROM b_investor_list
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, lp`,
      [version]
    );

    const investmentRows = await db.query(
      `SELECT * FROM b_investment
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, transaction_type, first_date ASC`,
      [version]
    );

    const wb = XLSX.utils.book_new();
    const wsIndicator = await buildSheetFromRows('b_transaction_indicator', indicatorRows);
    XLSX.utils.book_append_sheet(wb, wsIndicator, '基金产品指标');

    const wsInvestors = await buildSheetFromRows('b_investor_list', investorRows);
    XLSX.utils.book_append_sheet(wb, wsInvestors, '合伙人名录');

    const wsInvestment = await buildSheetFromRows('b_investment', investmentRows);
    XLSX.utils.book_append_sheet(wb, wsInvestment, '投资组合');

    const transactionRows = await db.query(
      `SELECT * FROM b_transaction
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY fund, transaction_date ASC`,
      [version]
    );
    const wsTransaction = await buildSheetFromRows('b_transaction', transactionRows);
    XLSX.utils.book_append_sheet(wb, wsTransaction, '数据明细表');

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-基金产品指标-${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出基金产品指标失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出底层企业明细
 * POST /api/performance/exports/underlying-companies
 */
router.post('/underlying-companies', checkExportPermission, async (req, res) => {
  try {
    const { version, type = 'cumulative' } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }

    const table = type === 'cumulative' ? 'b_project_a' : 'b_project';
    const rows = await db.query(
      `SELECT * FROM ${table}
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY set_up_date ASC`,
      [version]
    );

    const wb = XLSX.utils.book_new();
    const ws = await buildSheetFromRows(table, rows);
    XLSX.utils.book_append_sheet(wb, ws, '底层企业明细');

    const typeLabel = type === 'cumulative' ? '累计' : '当前';
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-底层企业明细-${typeLabel}-${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出底层企业明细失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出区域企业明细
 * POST /api/performance/exports/region-companies
 */
router.post('/region-companies', checkExportPermission, async (req, res) => {
  try {
    const { version, type = 'cumulative' } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }

    const table = type === 'cumulative' ? 'b_region_a' : 'b_region';
    const rows = await db.query(
      `SELECT * FROM ${table}
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY set_up_date ASC`,
      [version]
    );

    const wb = XLSX.utils.book_new();
    const ws = await buildSheetFromRows(table, rows);
    XLSX.utils.book_append_sheet(wb, ws, '区域企业明细');

    const typeLabel = type === 'cumulative' ? '累计' : '当前';
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-区域企业明细-${typeLabel}-${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出区域企业明细失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

/**
 * 导出上市企业明细
 * POST /api/performance/exports/ipo-companies
 */
router.post('/ipo-companies', checkExportPermission, async (req, res) => {
  try {
    const { version, type = 'cumulative' } = req.body;
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    const table = type === 'cumulative' ? 'b_ipo_a' : 'b_ipo';
    
    // 获取上市企业明细
    const rows = await db.query(
      `SELECT * FROM ${table}
       WHERE version = ? AND F_DeleteMark = 0
       ORDER BY ipo_date DESC`,
      [version]
    );
    
    const wb = XLSX.utils.book_new();
    
    const ws = await buildSheetFromRows(table, rows);
    XLSX.utils.book_append_sheet(wb, ws, '上市企业明细');
    
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `${version}-上市企业明细-${date}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('导出上市企业明细失败:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

module.exports = router;
