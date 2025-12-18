const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const xlsx = require('xlsx');
const db = require('../db');
const { logEnterpriseChange } = require('../utils/logger');
const { generateId } = require('../utils/idGenerator');
const { checkNewsPermission } = require('../utils/permissionChecker');
const { queryExternal, getExternalPool, createExternalPool } = require('../utils/externalDb');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const TEMPLATE_HEADERS = ['项目简称', '被投企业全称', '统一信用代码', '企业公众号id', '企业官网', '退出状态（未退出/部分退出/完全退出/继续观察/不再观察/已上市）'];

/**
 * 合并微信公众号ID
 * 规则：
 * 1. 如果原来的是"abc",后来的是"abc,abcd",用多的覆盖少的,更新为"abc,abcd"
 * 2. 如果原来的是"abc",后来的是"abcd",合并为"abc,abcd"
 * 3. 去重处理，按逗号分割，合并后去重，再按逗号连接
 * @param {string|null|undefined} oldIds - 原有的微信公众号ID（可能为空）
 * @param {string|null|undefined} newIds - 新的微信公众号ID（可能为空）
 * @returns {string|null} - 合并后的微信公众号ID
 */
function mergeWechatOfficialAccountIds(oldIds, newIds) {
  // 处理空值
  const oldStr = (oldIds || '').trim();
  const newStr = (newIds || '').trim();
  
  // 如果两个都为空，返回null
  if (!oldStr && !newStr) {
    return null;
  }
  
  // 如果只有新的，返回新的
  if (!oldStr && newStr) {
    return newStr;
  }
  
  // 如果只有旧的，返回旧的
  if (oldStr && !newStr) {
    return oldStr;
  }
  
  // 两个都有，进行合并
  // 按逗号分割并去空
  const oldList = oldStr.split(',').map(id => id.trim()).filter(id => id);
  const newList = newStr.split(',').map(id => id.trim()).filter(id => id);
  
  // 合并去重
  const mergedSet = new Set([...oldList, ...newList]);
  const mergedArray = Array.from(mergedSet);
  
  // 如果合并后为空，返回null
  if (mergedArray.length === 0) {
    return null;
  }
  
  // 返回合并后的字符串
  return mergedArray.join(',');
}

async function generateProjectNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const prefix = `P${year}${month}${day}`;

  const rows = await db.query(
    `SELECT project_number 
     FROM invested_enterprises 
     WHERE project_number LIKE ? 
     ORDER BY project_number DESC 
     LIMIT 1`,
    [`${prefix}%`]
  );

  let sequence = 1;
  if (rows.length) {
    const suffix = rows[0].project_number.slice(prefix.length);
    sequence = parseInt(suffix, 10) + 1;
  }
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

/**
 * 检查数据是否完全重复（用于批量导入去重）
 * @param {object} data - 要检查的数据
 * @returns {object|null} - 如果找到完全重复的数据，返回该记录，否则返回null
 */
async function checkDuplicateData({
  project_abbreviation,
  enterprise_full_name,
  unified_credit_code,
  wechat_official_account_id,
  official_website,
  exit_status
}) {
  // 如果没有统一社会信用代码，无法进行去重校验
  if (!unified_credit_code || unified_credit_code.trim() === '') {
    return null;
  }

  // 查询是否存在相同的统一社会信用代码
  const existing = await db.query(
    `SELECT * FROM invested_enterprises 
     WHERE unified_credit_code = ? AND delete_mark = 0`,
    [unified_credit_code]
  );

  if (existing.length === 0) {
    return null;
  }

  // 检查是否有完全相同的记录（所有字段都一致）
  for (const record of existing) {
    const isIdentical = 
      (record.project_abbreviation || '') === (project_abbreviation || '') &&
      record.enterprise_full_name === enterprise_full_name &&
      (record.wechat_official_account_id || '') === (wechat_official_account_id || '') &&
      (record.official_website || '') === (official_website || '') &&
      (record.exit_status || '未退出') === (exit_status || '未退出');

    if (isIdentical) {
      return record;
    }
  }

  return null; // 有统一社会信用代码但字段不一致，允许导入
}

async function insertEnterpriseRow({
  project_abbreviation,
  enterprise_full_name,
  unified_credit_code,
  wechat_official_account_id,
  official_website,
  exit_status = '未退出',
  userId = null
}) {
  const project_number = await generateProjectNumber();
  const enterpriseId = await generateId('invested_enterprises');
  
  // 插入到 invested_enterprises 表
  await db.execute(
    `INSERT INTO invested_enterprises 
     (id, project_number, project_abbreviation, enterprise_full_name, unified_credit_code, 
      wechat_official_account_id, official_website, exit_status, creator_user_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      enterpriseId,
      project_number,
      project_abbreviation || '',
      enterprise_full_name,
      unified_credit_code || '',
      wechat_official_account_id || '',
      official_website || '',
      exit_status || '未退出',
      userId
    ]
  );

  // 同步到 company 表（根据统一社会信用代码判断是否存在并更新）
  if (project_abbreviation && enterprise_full_name) {
    try {
      let existingCompany = null;
      
      // 如果有统一社会信用代码，检查是否已存在
      if (unified_credit_code && unified_credit_code.trim() !== '') {
        const companies = await db.query(
          'SELECT * FROM company WHERE unified_credit_code = ?',
          [unified_credit_code]
        );
        if (companies.length > 0) {
          existingCompany = companies[0];
        }
      }

      if (existingCompany) {
        // 如果已存在，检查是否需要更新
        let needUpdate = false;
        let finalWechatId = existingCompany.wechat_official_account_id;
        let finalWebsite = existingCompany.official_website;

        // 合并微信公众号ID（使用合并函数）
        const mergedWechatId = mergeWechatOfficialAccountIds(
          existingCompany.wechat_official_account_id,
          wechat_official_account_id
        );
        
        // 如果合并后的结果与原有不同，需要更新
        if (mergedWechatId !== (existingCompany.wechat_official_account_id || null)) {
          finalWechatId = mergedWechatId;
          needUpdate = true;
        }

        // 检查公司官网是否有变化
        // 如果新的官网不为空且与原有的不同，则更新
        if (official_website && official_website.trim() !== '') {
          if (official_website !== (existingCompany.official_website || '')) {
            finalWebsite = official_website;
            needUpdate = true;
          }
        }

        // 检查其他字段是否有变化
        if (project_abbreviation !== existingCompany.enterprise_abbreviation ||
            enterprise_full_name !== existingCompany.enterprise_full_name) {
          needUpdate = true;
        }

        // 如果需要更新，则更新 company 表
        if (needUpdate) {
          await db.execute(
            `UPDATE company 
             SET enterprise_abbreviation = ?, 
                 enterprise_full_name = ?,
                 official_website = ?,
                 wechat_official_account_id = ?,
                 updater_user_id = ?
             WHERE id = ?`,
            [
              project_abbreviation,
              enterprise_full_name,
              finalWebsite,
              finalWechatId,
              userId,
              existingCompany.id
            ]
          );
        }
      } else {
        // 如果不存在（统一社会信用代码为空或不存在于表中），则插入到 company 表
        const companyId = await generateId('company');
        await db.execute(
          `INSERT INTO company 
           (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
            official_website, wechat_official_account_id, creator_user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId,
            project_abbreviation,
            enterprise_full_name,
            unified_credit_code || null,
            official_website || null,
            wechat_official_account_id || null,
            userId
          ]
        );
      }
    } catch (err) {
      // 如果同步失败，不影响主流程，只记录错误
      console.warn('同步到 company 表失败:', err.message);
    }
  }

  return {
    id: enterpriseId,
    project_number
  };
}

router.get('/', async (req, res) => {
  try {
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    // 检查用户是否有"新闻舆情"应用权限
    if (userRole !== 'admin' && userId) {
      const hasPermission = await checkNewsPermission(userId);
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: '您没有访问被投企业管理的权限'
        });
      }
    }

    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 10;
    const search = req.query.search || '';
    const filterUserId = req.query.filter_user_id || ''; // 用户筛选（仅admin使用）
    const offset = (page - 1) * pageSize;

    let condition = 'FROM invested_enterprises WHERE delete_mark = 0';
    const params = [];

    // 如果不是admin，只显示当前用户创建的数据
    if (userRole !== 'admin') {
      if (userId) {
        condition += ' AND creator_user_id = ?';
        params.push(userId);
      } else {
        // 如果没有用户ID，返回空数据
        return res.json({
          success: true,
          data: [],
          total: 0,
          page,
          pageSize
        });
      }
    } else {
      // admin用户：如果指定了筛选用户ID，则只显示该用户的数据
      if (filterUserId && filterUserId.trim() !== '') {
        condition += ' AND creator_user_id = ?';
        params.push(filterUserId);
      }
    }

    if (search) {
      condition += ` AND (
        project_number LIKE ? OR 
        project_abbreviation LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        unified_credit_code LIKE ? OR 
        wechat_official_account_id LIKE ? OR 
        official_website LIKE ? OR 
        exit_status LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const data = await db.query(
      `SELECT * ${condition} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRows = await db.query(`SELECT COUNT(*) as total ${condition}`, params);

    res.json({
      success: true,
      data,
      total: totalRows[0].total,
      page,
      pageSize
    });
  } catch (error) {
    console.error('查询被投企业失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 导出被投企业数据为Excel
router.get('/export', async (req, res) => {
  try {
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    // 检查用户是否有"新闻舆情"应用权限
    if (userRole !== 'admin' && userId) {
      const hasPermission = await checkNewsPermission(userId);
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: '您没有访问被投企业管理的权限'
        });
      }
    }

    const search = req.query.search || '';
    const filterUserId = req.query.filter_user_id || ''; // 用户筛选（仅admin使用）

    let condition = 'FROM invested_enterprises WHERE delete_mark = 0';
    const params = [];

    // 如果不是admin，只显示当前用户创建的数据
    if (userRole !== 'admin') {
      if (userId) {
        condition += ' AND creator_user_id = ?';
        params.push(userId);
      } else {
        // 如果没有用户ID，返回空数据
        return res.status(400).json({
          success: false,
          message: '无法导出：未登录或没有权限'
        });
      }
    } else {
      // admin用户：如果指定了筛选用户ID，则只显示该用户的数据
      if (filterUserId && filterUserId.trim() !== '') {
        condition += ' AND creator_user_id = ?';
        params.push(filterUserId);
      }
    }

    if (search) {
      condition += ` AND (
        project_number LIKE ? OR 
        project_abbreviation LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        unified_credit_code LIKE ? OR 
        wechat_official_account_id LIKE ? OR 
        official_website LIKE ? OR 
        exit_status LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // 查询所有符合条件的数据（不分页）
    const data = await db.query(
      `SELECT * ${condition} ORDER BY created_at DESC`,
      params
    );

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有可导出的数据'
      });
    }

    // 格式化数据为Excel格式
    const excelData = data.map((item, index) => ({
      '序号': index + 1,
      '项目编号': item.project_number || '',
      '项目简称': item.project_abbreviation || '',
      '被投企业全称': item.enterprise_full_name || '',
      '统一信用代码': item.unified_credit_code || '',
      '企业公众号id': item.wechat_official_account_id || '',
      '企业官网': item.official_website || '',
      '退出状态': item.exit_status || '未退出',
      '创建时间': item.created_at ? new Date(item.created_at) : null,
      '更新时间': item.updated_at ? new Date(item.updated_at) : null
    }));

    // 创建工作簿
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(excelData);

    // 设置列宽
    const colWidths = [
      { wch: 8 },  // 序号
      { wch: 18 }, // 项目编号
      { wch: 15 }, // 项目简称
      { wch: 30 }, // 被投企业全称
      { wch: 20 }, // 统一信用代码
      { wch: 25 }, // 企业公众号id
      { wch: 40 }, // 企业官网
      { wch: 12 }, // 退出状态
      { wch: 20 }, // 创建时间
      { wch: 20 }  // 更新时间
    ];
    ws['!cols'] = colWidths;

    // 设置单元格格式
    const range = xlsx.utils.decode_range(ws['!ref']);

    // 设置表头样式
    for (let colNum = 0; colNum <= range.e.c; colNum++) {
      const headerCell = xlsx.utils.encode_cell({ r: 0, c: colNum });
      if (ws[headerCell]) {
        ws[headerCell].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4472C4" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
          }
        };
      }
    }

    // 遍历所有数据行，设置格式
    for (let rowNum = 1; rowNum <= range.e.r; rowNum++) {
      // 为所有数据单元格添加边框
      for (let colNum = 0; colNum <= range.e.c; colNum++) {
        const cellRef = xlsx.utils.encode_cell({ r: rowNum, c: colNum });
        if (ws[cellRef]) {
          if (!ws[cellRef].s) ws[cellRef].s = {};
          ws[cellRef].s.border = {
            top: { style: "thin", color: { rgb: "CCCCCC" } },
            bottom: { style: "thin", color: { rgb: "CCCCCC" } },
            left: { style: "thin", color: { rgb: "CCCCCC" } },
            right: { style: "thin", color: { rgb: "CCCCCC" } }
          };

          // 设置文本对齐
          ws[cellRef].s.alignment = {
            horizontal: "left",
            vertical: "top",
            wrapText: true
          };
        }
      }

      // 创建时间列 (I列，索引8)
      const createTimeCell = xlsx.utils.encode_cell({ r: rowNum, c: 8 });
      if (ws[createTimeCell] && ws[createTimeCell].v) {
        ws[createTimeCell].t = 'd'; // 设置为日期类型
        ws[createTimeCell].z = 'yyyy-mm-dd hh:mm:ss'; // 设置日期格式
        ws[createTimeCell].s.alignment = { horizontal: "center", vertical: "center" };
      }

      // 更新时间列 (J列，索引9)
      const updateTimeCell = xlsx.utils.encode_cell({ r: rowNum, c: 9 });
      if (ws[updateTimeCell] && ws[updateTimeCell].v) {
        ws[updateTimeCell].t = 'd'; // 设置为日期类型
        ws[updateTimeCell].z = 'yyyy-mm-dd hh:mm:ss'; // 设置日期格式
        ws[updateTimeCell].s.alignment = { horizontal: "center", vertical: "center" };
      }

      // 企业官网列 (G列，索引6) - 设置超链接
      const websiteCell = xlsx.utils.encode_cell({ r: rowNum, c: 6 });
      if (ws[websiteCell] && ws[websiteCell].v && typeof ws[websiteCell].v === 'string' && ws[websiteCell].v.startsWith('http')) {
        ws[websiteCell].l = { Target: ws[websiteCell].v, Tooltip: '点击打开链接' }; // 设置超链接
        if (!ws[websiteCell].s) ws[websiteCell].s = {};
        ws[websiteCell].s.font = { color: { rgb: "0000FF" }, underline: true }; // 蓝色下划线样式
        ws[websiteCell].s.alignment = { horizontal: "left", vertical: "center" };
      }
    }

    // 设置冻结窗格（冻结表头）
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    // 设置自动筛选
    ws['!autofilter'] = { ref: ws['!ref'] };

    xlsx.utils.book_append_sheet(wb, ws, '被投企业');

    // 生成Excel文件
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 生成文件名（包含日期）
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const fileName = `被投企业数据_${dateStr}.xlsx`;

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    res.send(buffer);

  } catch (error) {
    console.error('导出被投企业数据失败：', error);
    res.status(500).json({ success: false, message: '导出失败：' + error.message });
  }
});

// 批量导入相关路由（必须在 /:id 路由之前）
router.get('/batch-import/template', (req, res) => {
  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    xlsx.utils.book_append_sheet(workbook, worksheet, '模板');
    const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // 使用 URL 编码处理中文文件名
    const filename = encodeURIComponent('被投企业批量导入模板.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('生成模板失败：', error);
    res.status(500).json({ success: false, message: '模板生成失败' });
  }
});

router.post('/', [
  body('project_abbreviation').optional(),
  body('enterprise_full_name').notEmpty().withMessage('企业全称不能为空'),
  body('unified_credit_code').optional(),
  body('wechat_official_account_id').optional(),
  body('official_website').optional(),
  body('exit_status').optional(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      project_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      wechat_official_account_id,
      official_website,
      exit_status = '未退出'
    } = req.body;

    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    const result = await insertEnterpriseRow({
      project_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      wechat_official_account_id,
      official_website,
      exit_status,
      userId: userId
    });

    res.json({
      success: true,
      message: '创建成功',
      data: {
        id: result.id,
        project_number: result.project_number,
        project_abbreviation,
        enterprise_full_name,
        unified_credit_code,
        wechat_official_account_id,
        official_website,
        exit_status
      }
    });
  } catch (error) {
    console.error('创建被投企业失败：', error);
    console.error('错误详情：', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      success: false, 
      message: '创建失败：' + (error.message || '未知错误'),
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.put('/:id', [
  body('project_abbreviation').optional(),
  body('enterprise_full_name').notEmpty().withMessage('企业全称不能为空'),
  body('unified_credit_code').optional(),
  body('wechat_official_account_id').optional(),
  body('official_website').optional(),
  body('exit_status').optional(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const {
      project_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      wechat_official_account_id,
      official_website,
      exit_status
    } = req.body;

    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    // 获取旧数据用于日志记录
    const oldDataRows = await db.query(
      'SELECT * FROM invested_enterprises WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (oldDataRows.length === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    const oldData = oldDataRows[0];
    const newData = {
      project_abbreviation: project_abbreviation || '',
      enterprise_full_name,
      unified_credit_code: unified_credit_code || '',
      wechat_official_account_id: wechat_official_account_id || '',
      official_website: official_website || '',
      exit_status: exit_status || '未退出'
    };

    const result = await db.execute(
      `UPDATE invested_enterprises 
       SET project_abbreviation = ?, enterprise_full_name = ?, unified_credit_code = ?,
           wechat_official_account_id = ?, official_website = ?, exit_status = ?,
           modifier_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND delete_mark = 0`,
      [
        newData.project_abbreviation,
        newData.enterprise_full_name,
        newData.unified_credit_code,
        newData.wechat_official_account_id,
        newData.official_website,
        newData.exit_status,
        userId,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    // 记录变更日志
    await logEnterpriseChange(id, oldData, newData, userId);

    // 同步更新到 company 表
    if (newData.unified_credit_code && newData.unified_credit_code.trim() !== '' && 
        newData.project_abbreviation && newData.enterprise_full_name) {
      try {
        const existingCompany = await db.query(
          'SELECT * FROM company WHERE unified_credit_code = ?',
          [newData.unified_credit_code]
        );
        
        if (existingCompany.length > 0) {
          // 如果已存在，合并微信公众号ID并更新
          const company = existingCompany[0];
          const mergedWechatId = mergeWechatOfficialAccountIds(
            company.wechat_official_account_id,
            newData.wechat_official_account_id
          );
          
          let needUpdate = false;
          let finalWebsite = company.official_website;
          
          // 检查微信公众号ID是否有变化
          if (mergedWechatId !== (company.wechat_official_account_id || null)) {
            needUpdate = true;
          }
          
          // 检查公司官网是否有变化
          if (newData.official_website && newData.official_website.trim() !== '') {
            if (newData.official_website !== (company.official_website || '')) {
              finalWebsite = newData.official_website;
              needUpdate = true;
            }
          }
          
          // 检查其他字段是否有变化
          if (newData.project_abbreviation !== company.enterprise_abbreviation ||
              newData.enterprise_full_name !== company.enterprise_full_name) {
            needUpdate = true;
          }
          
          if (needUpdate) {
            await db.execute(
              `UPDATE company 
               SET enterprise_abbreviation = ?, 
                   enterprise_full_name = ?,
                   official_website = ?,
                   wechat_official_account_id = ?,
                   updater_user_id = ?
               WHERE id = ?`,
              [
                newData.project_abbreviation,
                newData.enterprise_full_name,
                finalWebsite,
                mergedWechatId,
                userId,
                company.id
              ]
            );
          }
        } else {
          // 如果不存在，创建新记录
          const companyId = await generateId('company');
          await db.execute(
            `INSERT INTO company 
             (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
              official_website, wechat_official_account_id, creator_user_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              companyId,
              newData.project_abbreviation,
              newData.enterprise_full_name,
              newData.unified_credit_code,
              newData.official_website || null,
              newData.wechat_official_account_id || null,
              userId
            ]
          );
        }
      } catch (err) {
        // 如果同步失败，不影响主流程，只记录错误
        console.warn('同步到 company 表失败:', err.message);
      }
    }

    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('更新被投企业失败：', error);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// 删除被投企业（软删除）
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    const result = await db.execute(
      `UPDATE invested_enterprises 
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
       WHERE id = ? AND delete_mark = 0`,
      [userId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '企业不存在或已被删除' });
    }

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除被投企业失败：', error);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

router.post('/batch-import/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: '未检测到数据工作表' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rows.length) {
      return res.status(400).json({ success: false, message: '模板内容为空' });
    }

    const headers = rows[0].map((cell) => String(cell || '').trim());
    const isHeaderValid = TEMPLATE_HEADERS.every((header, index) => header === headers[index]);
    if (!isHeaderValid) {
      return res.status(400).json({ success: false, message: '模板表头不匹配，请使用最新模板' });
    }

    const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
    if (!dataRows.length) {
      return res.status(400).json({ success: false, message: '未检测到可导入的数据' });
    }

    const errors = [];
    let successCount = 0;

    for (let index = 0; index < dataRows.length; index += 1) {
      const rowNumber = index + 2;
      const [
        project_abbreviation = '',
        enterprise_full_name = '',
        unified_credit_code = '',
        wechat_official_account_id = '',
        official_website = '',
        exit_status = '未退出'
      ] = dataRows[index].map((cell) => String(cell || '').trim());

      if (!enterprise_full_name) {
        errors.push({ row: rowNumber, message: '被投企业全称不能为空' });
        continue;
      }

      try {
        // 从请求头或请求体中获取用户ID
        const userId = req.headers['x-user-id'] || req.body.userId || null;
        
        // 检查是否完全重复（以统一社会信用代码为准）
        const duplicateRecord = await checkDuplicateData({
          project_abbreviation,
          enterprise_full_name,
          unified_credit_code,
          wechat_official_account_id,
          official_website,
          exit_status
        });

        if (duplicateRecord) {
          // 如果完全重复，不导入并提示用户
          errors.push({ 
            row: rowNumber, 
            message: `已存在相同的数据（项目编号：${duplicateRecord.project_number}），跳过导入` 
          });
          continue;
        }

        // 如果不存在完全重复的数据，则导入
        await insertEnterpriseRow({
          project_abbreviation,
          enterprise_full_name,
          unified_credit_code,
          wechat_official_account_id,
          official_website,
          exit_status,
          userId: userId
        });
        successCount += 1;
      } catch (err) {
        errors.push({ row: rowNumber, message: err.message });
      }
    }

    res.json({
      success: errors.length === 0,
      message: `成功导入 ${successCount} 条，失败 ${errors.length} 条`,
      successCount,
      errorCount: errors.length,
      errors
    });
  } catch (error) {
    console.error('批量导入失败：', error);
    res.status(500).json({ success: false, message: '导入失败，请重试' });
  }
});

// 获取被投企业变更日志
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account 
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'invested_enterprises' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取被投企业日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db.query(
      'SELECT * FROM invested_enterprises WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('获取被投企业失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 执行SQL查询并同步数据到被投企业表
async function executeSyncTask(dbConfigId, sqlQuery) {
  const { getExternalPool, createExternalPool, closeExternalPool } = require('../utils/externalDb');
  let retryCount = 0;
  const maxRetries = 3;
  let externalData = null;
  
  while (retryCount < maxRetries) {
    try {
      // 获取或创建外部数据库连接
      let pool = getExternalPool(dbConfigId);
      if (!pool) {
        // 如果连接池不存在，从数据库获取配置并创建
        const configs = await db.query(
          'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0 AND is_active = 1',
          [dbConfigId]
        );
        if (configs.length === 0) {
          throw new Error('数据库配置不存在或未启用');
        }
        pool = await createExternalPool(configs[0]);
        // 注意：createExternalPool 会自动将连接池保存到缓存中
      }

      // 执行SQL查询（带重试机制）
      try {
        if (pool.constructor.name === 'Pool' && pool.query && typeof pool.query === 'function' && !pool.getConnection) {
          // PostgreSQL
          const result = await pool.query(sqlQuery);
          externalData = result.rows;
        } else {
          // MySQL
          const [rows] = await pool.query(sqlQuery);
          externalData = rows;
        }
        
        // 查询成功，跳出重试循环
        break;
      } catch (queryError) {
        // 如果是连接错误，尝试重新创建连接池
        const isConnectionError = 
          queryError.code === 'ECONNRESET' || 
          queryError.code === 'PROTOCOL_CONNECTION_LOST' || 
          queryError.code === 'ETIMEDOUT' ||
          queryError.code === 'ECONNREFUSED' ||
          (queryError.message && (
            queryError.message.includes('ECONNRESET') ||
            queryError.message.includes('Connection lost') ||
            queryError.message.includes('timeout')
          ));
        
        if (isConnectionError && retryCount < maxRetries - 1) {
          console.warn(`[企业同步任务] 数据库连接错误 (${queryError.code || 'UNKNOWN'})，尝试重新连接... (重试 ${retryCount + 1}/${maxRetries})`);
          
          // 关闭旧的连接池
          try {
            await closeExternalPool(dbConfigId);
          } catch (closeError) {
            console.warn('[企业同步任务] 关闭旧连接池失败:', closeError.message);
          }
          
          // 等待一段时间后重试（递增延迟）
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          
          retryCount++;
          continue; // 重试
        } else {
          // 其他错误或达到最大重试次数，直接抛出
          if (retryCount >= maxRetries - 1) {
            throw new Error(`数据库连接失败，已重试 ${maxRetries} 次。最后错误: ${queryError.message || queryError.code || '未知错误'}`);
          }
          throw queryError;
        }
      }
    } catch (error) {
      // 如果达到最大重试次数，抛出错误
      if (retryCount >= maxRetries - 1) {
        throw error;
      }
      retryCount++;
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      continue;
    }
  }
  
  // 检查查询结果
  if (!externalData || externalData.length === 0) {
    return {
      success: true,
      message: '查询成功，但没有数据需要同步',
      synced: 0,
      updated: 0,
      inserted: 0
    };
  }

  // 同步数据到被投企业表
  let synced = 0;
  let updated = 0;
  let inserted = 0;

  for (const row of externalData) {
    // 映射字段（支持不同的字段名）
    const enterpriseData = {
      project_number: row.project_number || row.projectNumber || null,
      project_abbreviation: row.project_abbreviation || row.projectAbbreviation || row.project_abbr || '',
      enterprise_full_name: row.enterprise_full_name || row.enterpriseFullName || row.enterprise_name || row.enterpriseName || '',
      unified_credit_code: row.unified_credit_code || row.unifiedCreditCode || row.credit_code || '',
      wechat_official_account_id: row.wechat_official_account_id || row.wechatOfficialAccountId || row.wechat_account_id || '',
      official_website: row.official_website || row.officialWebsite || row.website || '',
      exit_status: row.exit_status || row.exitStatus || '未退出'
    };

    // 必填字段检查
    if (!enterpriseData.enterprise_full_name) {
      console.warn('跳过数据：缺少被投企业全称', row);
      continue;
    }

    // 根据统一社会信用代码判断是否已存在
    let existing = null;
    if (enterpriseData.unified_credit_code && enterpriseData.unified_credit_code.trim() !== '') {
      // 如果有统一信用代码，根据统一信用代码查找（同时查询退出状态）
      const existingRecords = await db.query(
        `SELECT id, project_number, exit_status FROM invested_enterprises 
         WHERE unified_credit_code = ? 
         AND delete_mark = 0
         LIMIT 1`,
        [enterpriseData.unified_credit_code]
      );
      if (existingRecords.length > 0) {
        existing = existingRecords[0];
      }
    }

    if (existing) {
      // 如果现有记录的退出状态为"不再观察"，则跳过更新，保护用户手动设置的状态
      if (existing.exit_status === '不再观察') {
        console.log(`跳过更新企业（退出状态为"不再观察"）：统一信用代码 ${enterpriseData.unified_credit_code}，企业全称 ${enterpriseData.enterprise_full_name}`);
        continue; // 跳过这条数据，不进行更新
      }
      
      // 统一信用代码一致，更新项目简称、被投企业全称、企业公众号ID、企业官网和退出状态
      await db.execute(
        `UPDATE invested_enterprises 
         SET project_abbreviation = ?,
             enterprise_full_name = ?,
             wechat_official_account_id = ?,
             official_website = ?,
             exit_status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          enterpriseData.project_abbreviation,
          enterpriseData.enterprise_full_name,
          enterpriseData.wechat_official_account_id || null,
          enterpriseData.official_website || null,
          enterpriseData.exit_status,
          existing.id
        ]
      );
      updated++;
      console.log(`更新企业：统一信用代码 ${enterpriseData.unified_credit_code}，更新项目简称、企业全称、企业公众号ID、企业官网和退出状态`);
      
      // 同步更新到 company 表
      if (enterpriseData.unified_credit_code && enterpriseData.unified_credit_code.trim() !== '') {
        try {
          const existingCompany = await db.query(
            'SELECT * FROM company WHERE unified_credit_code = ?',
            [enterpriseData.unified_credit_code]
          );
          
          if (existingCompany.length > 0) {
            // 如果已存在，合并微信公众号ID并更新
            const company = existingCompany[0];
            const mergedWechatId = mergeWechatOfficialAccountIds(
              company.wechat_official_account_id,
              enterpriseData.wechat_official_account_id
            );
            
            let needUpdate = false;
            let finalWebsite = company.official_website;
            
            // 检查微信公众号ID是否有变化
            if (mergedWechatId !== (company.wechat_official_account_id || null)) {
              needUpdate = true;
            }
            
            // 检查公司官网是否有变化
            if (enterpriseData.official_website && enterpriseData.official_website.trim() !== '') {
              if (enterpriseData.official_website !== (company.official_website || '')) {
                finalWebsite = enterpriseData.official_website;
                needUpdate = true;
              }
            }
            
            // 检查其他字段是否有变化
            if (enterpriseData.project_abbreviation !== company.enterprise_abbreviation ||
                enterpriseData.enterprise_full_name !== company.enterprise_full_name) {
              needUpdate = true;
            }
            
            if (needUpdate) {
              await db.execute(
                `UPDATE company 
                 SET enterprise_abbreviation = ?, 
                     enterprise_full_name = ?,
                     official_website = ?,
                     wechat_official_account_id = ?
                 WHERE id = ?`,
                [
                  enterpriseData.project_abbreviation,
                  enterpriseData.enterprise_full_name,
                  finalWebsite,
                  mergedWechatId,
                  company.id
                ]
              );
            }
          } else {
            // 如果不存在，创建新记录
            const companyId = await generateId('company');
            await db.execute(
              `INSERT INTO company 
               (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
                official_website, wechat_official_account_id) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                companyId,
                enterpriseData.project_abbreviation,
                enterpriseData.enterprise_full_name,
                enterpriseData.unified_credit_code,
                enterpriseData.official_website || null,
                enterpriseData.wechat_official_account_id || null
              ]
            );
          }
        } catch (err) {
          // 如果同步失败，不影响主流程，只记录错误
          console.warn('同步到 company 表失败:', err.message);
        }
      }
    } else {
      // 统一信用代码不一致或不存在，新增数据
      // 自动生成项目编号
      const projectNumber = await generateProjectNumber();
      const enterpriseId = await generateId('invested_enterprises');
      
      await db.execute(
        `INSERT INTO invested_enterprises 
         (id, project_number, project_abbreviation, enterprise_full_name, unified_credit_code, 
          wechat_official_account_id, official_website, exit_status, creator_user_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          enterpriseId,
          projectNumber,
          enterpriseData.project_abbreviation,
          enterpriseData.enterprise_full_name,
          enterpriseData.unified_credit_code || null,
          enterpriseData.wechat_official_account_id || null,
          enterpriseData.official_website || null,
          enterpriseData.exit_status,
          null // 同步的数据没有creator_user_id
        ]
      );
      inserted++;
      console.log(`新增企业：${enterpriseData.enterprise_full_name}，统一信用代码：${enterpriseData.unified_credit_code || '无'}，项目编号：${projectNumber}`);
      
      // 同步创建到 company 表
      if (enterpriseData.project_abbreviation && enterpriseData.enterprise_full_name) {
        try {
          let existingCompany = null;
          
          // 如果有统一社会信用代码，检查是否已存在
          if (enterpriseData.unified_credit_code && enterpriseData.unified_credit_code.trim() !== '') {
            const companies = await db.query(
              'SELECT * FROM company WHERE unified_credit_code = ?',
              [enterpriseData.unified_credit_code]
            );
            if (companies.length > 0) {
              existingCompany = companies[0];
            }
          }
          
          if (existingCompany) {
            // 如果已存在，合并微信公众号ID并更新
            const mergedWechatId = mergeWechatOfficialAccountIds(
              existingCompany.wechat_official_account_id,
              enterpriseData.wechat_official_account_id
            );
            
            let needUpdate = false;
            let finalWebsite = existingCompany.official_website;
            
            // 检查微信公众号ID是否有变化
            if (mergedWechatId !== (existingCompany.wechat_official_account_id || null)) {
              needUpdate = true;
            }
            
            // 检查公司官网是否有变化
            if (enterpriseData.official_website && enterpriseData.official_website.trim() !== '') {
              if (enterpriseData.official_website !== (existingCompany.official_website || '')) {
                finalWebsite = enterpriseData.official_website;
                needUpdate = true;
              }
            }
            
            // 检查其他字段是否有变化
            if (enterpriseData.project_abbreviation !== existingCompany.enterprise_abbreviation ||
                enterpriseData.enterprise_full_name !== existingCompany.enterprise_full_name) {
              needUpdate = true;
            }
            
            if (needUpdate) {
              await db.execute(
                `UPDATE company 
                 SET enterprise_abbreviation = ?, 
                     enterprise_full_name = ?,
                     official_website = ?,
                     wechat_official_account_id = ?
                 WHERE id = ?`,
                [
                  enterpriseData.project_abbreviation,
                  enterpriseData.enterprise_full_name,
                  finalWebsite,
                  mergedWechatId,
                  existingCompany.id
                ]
              );
            }
          } else {
            // 如果不存在，创建新记录
            const companyId = await generateId('company');
            await db.execute(
              `INSERT INTO company 
               (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
                official_website, wechat_official_account_id) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                companyId,
                enterpriseData.project_abbreviation,
                enterpriseData.enterprise_full_name,
                enterpriseData.unified_credit_code || null,
                enterpriseData.official_website || null,
                enterpriseData.wechat_official_account_id || null
              ]
            );
          }
        } catch (err) {
          // 如果同步失败，不影响主流程，只记录错误
          console.warn('同步到 company 表失败:', err.message);
        }
      }
    }
    synced++;
  }

  return {
    success: true,
    message: `同步完成：共处理 ${synced} 条数据，新增 ${inserted} 条，更新 ${updated} 条`,
    synced,
    updated,
    inserted
  };
}

// 根据数据库配置ID获取定时任务
router.get('/sync-task/by-db/:db_config_id', async (req, res) => {
  try {
    const { db_config_id } = req.params;
    const tasks = await db.query(
      `SELECT id, db_config_id, sql_query, cron_expression, description, is_active, 
              last_execution_time, last_execution_status, last_execution_message, execution_count,
              created_at, updated_at
       FROM enterprise_sync_task 
       WHERE db_config_id = ? AND is_active = 1
       ORDER BY created_at DESC 
       LIMIT 1`,
      [db_config_id]
    );
    
    if (tasks.length > 0) {
      res.json({ success: true, data: tasks[0] });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error('获取定时任务失败：', error);
    res.status(500).json({ success: false, message: '获取任务失败：' + error.message });
  }
});

// 创建定时同步任务
router.post('/sync-task', [
  body('db_config_id').notEmpty().withMessage('数据库配置ID不能为空'),
  body('sql_query').notEmpty().withMessage('SQL查询语句不能为空'),
  body('cron_expression').notEmpty().withMessage('Cron表达式不能为空'),
  body('description').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { db_config_id, sql_query, cron_expression, description } = req.body;

    // 验证SQL语句（支持WITH语句和SELECT语句）
    const sql = sql_query.trim().toUpperCase();
    if (!sql.startsWith('SELECT') && !sql.startsWith('WITH')) {
      return res.status(400).json({ success: false, message: 'SQL语句必须以SELECT或WITH开头' });
    }

    // 检查数据库配置是否存在
    const dbConfigs = await db.query(
      'SELECT * FROM external_db_config WHERE id = ? AND is_deleted = 0 AND is_active = 1',
      [db_config_id]
    );
    if (dbConfigs.length === 0) {
      return res.status(400).json({ success: false, message: '数据库配置不存在或未启用' });
    }

    // 检查是否已存在任务（每个数据库配置只能有一个任务）
    const existing = await db.query(
      'SELECT id FROM enterprise_sync_task WHERE db_config_id = ?',
      [db_config_id]
    );

    const userId = req.headers['x-user-id'] || null;
    const taskId = existing.length > 0 ? existing[0].id : await generateId('enterprise_sync_task');

    if (existing.length > 0) {
      // 更新现有任务
      await db.execute(
        `UPDATE enterprise_sync_task 
         SET sql_query = ?, cron_expression = ?, description = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [sql_query, cron_expression, description || '', userId, taskId]
      );
    } else {
      // 创建新任务
      await db.execute(
        `INSERT INTO enterprise_sync_task 
         (id, db_config_id, sql_query, cron_expression, description, created_by, updated_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [taskId, db_config_id, sql_query, cron_expression, description || '', userId, userId]
      );
    }

    res.json({ 
      success: true, 
      message: existing.length > 0 ? '任务更新成功' : '任务创建成功',
      data: { id: taskId }
    });
  } catch (error) {
    console.error('创建/更新同步任务失败：', error);
    res.status(500).json({ success: false, message: '操作失败：' + error.message });
  }
});

// 手动执行同步任务
router.post('/sync-task/execute', [
  body('db_config_id').notEmpty().withMessage('数据库配置ID不能为空'),
  body('sql_query').optional(), // SQL查询语句改为可选，如果未提供则从数据库读取
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { db_config_id, sql_query } = req.body;

    // 如果未提供SQL查询语句，从数据库读取已保存的任务
    let finalSqlQuery = sql_query;
    if (!finalSqlQuery || finalSqlQuery.trim() === '') {
      const tasks = await db.query(
        'SELECT sql_query FROM enterprise_sync_task WHERE db_config_id = ? AND is_active = 1',
        [db_config_id]
      );
      if (tasks.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: '该数据库配置没有已保存的定时任务，请先保存任务或提供SQL查询语句' 
        });
      }
      finalSqlQuery = tasks[0].sql_query;
      if (!finalSqlQuery || finalSqlQuery.trim() === '') {
        return res.status(400).json({ 
          success: false, 
          message: '已保存的任务中SQL查询语句为空，请提供SQL查询语句' 
        });
      }
    }

    // 验证SQL语句（支持WITH语句和SELECT语句）
    const sql = finalSqlQuery.trim().toUpperCase();
    if (!sql.startsWith('SELECT') && !sql.startsWith('WITH')) {
      return res.status(400).json({ success: false, message: 'SQL语句必须以SELECT或WITH开头' });
    }

    // 执行同步任务
    const result = await executeSyncTask(db_config_id, finalSqlQuery);

    // 更新任务执行记录（如果任务存在）
    try {
      const tasks = await db.query(
        'SELECT id FROM enterprise_sync_task WHERE db_config_id = ?',
        [db_config_id]
      );
      if (tasks.length > 0) {
        await db.execute(
          `UPDATE enterprise_sync_task 
           SET last_execution_time = CURRENT_TIMESTAMP,
               last_execution_status = ?,
               last_execution_message = ?,
               execution_count = execution_count + 1
           WHERE id = ?`,
          ['success', result.message, tasks[0].id]
        );
      }
    } catch (updateError) {
      console.warn('更新任务执行记录失败：', updateError);
    }

    res.json(result);
  } catch (error) {
    console.error('执行同步任务失败：', error);
    
    // 尝试更新任务执行记录为失败
    try {
      const tasks = await db.query(
        'SELECT id FROM enterprise_sync_task WHERE db_config_id = ?',
        [req.body.db_config_id]
      );
      if (tasks.length > 0) {
        await db.execute(
          `UPDATE enterprise_sync_task 
           SET last_execution_time = CURRENT_TIMESTAMP,
               last_execution_status = ?,
               last_execution_message = ?,
               execution_count = execution_count + 1
           WHERE id = ?`,
          ['failed', error.message, tasks[0].id]
        );
      }
    } catch (updateError) {
      console.warn('更新任务执行记录失败：', updateError);
    }

    res.status(500).json({ 
      success: false, 
      message: '执行失败：' + error.message 
    });
  }
});

module.exports = router;
module.exports.executeSyncTask = executeSyncTask;

