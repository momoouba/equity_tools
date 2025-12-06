const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { logCompanyChange } = require('../utils/logger');
const { generateId } = require('../utils/idGenerator');

const router = express.Router();

// 获取企业列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10, search } = req.query;
    const offset = (page - 1) * pageSize;

    let condition = 'FROM company WHERE 1=1';
    const params = [];

    if (search) {
      condition += ' AND (enterprise_abbreviation LIKE ? OR enterprise_full_name LIKE ? OR unified_credit_code LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const data = await db.query(
      `SELECT * ${condition} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );
    const totalRows = await db.query(`SELECT COUNT(*) as total ${condition}`, params);

    res.json({
      success: true,
      data,
      total: totalRows[0].total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('查询企业列表失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 根据简称查询企业（用于联动查询）
router.get('/search', async (req, res) => {
  try {
    const { abbreviation } = req.query;
    if (!abbreviation || abbreviation.trim() === '') {
      return res.json({ success: true, data: [] });
    }

    const companies = await db.query(
      `SELECT id, enterprise_abbreviation, enterprise_full_name, unified_credit_code 
       FROM company 
       WHERE enterprise_abbreviation LIKE ? 
       ORDER BY enterprise_abbreviation 
       LIMIT 20`,
      [`%${abbreviation}%`]
    );

    res.json({ success: true, data: companies });
  } catch (error) {
    console.error('查询企业失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 获取单个企业详情
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const companies = await db.query('SELECT * FROM company WHERE id = ?', [id]);
    
    if (companies.length === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    res.json({ success: true, data: companies[0] });
  } catch (error) {
    console.error('查询企业详情失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 创建企业
router.post('/', [
  body('enterprise_abbreviation').notEmpty().withMessage('企业简称不能为空'),
  body('enterprise_full_name').notEmpty().withMessage('企业全称不能为空'),
  body('unified_credit_code').optional(),
  body('official_website').optional(),
  body('wechat_official_account_id').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      enterprise_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      official_website,
      wechat_official_account_id
    } = req.body;

    // 检查统一信用代码是否已存在
    if (unified_credit_code) {
      const existing = await db.query('SELECT id FROM company WHERE unified_credit_code = ?', [unified_credit_code]);
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: '该统一信用代码已存在' });
      }
    }

    const companyId = await generateId('company');
    await db.execute(
      `INSERT INTO company 
       (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, official_website, wechat_official_account_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        enterprise_abbreviation,
        enterprise_full_name,
        unified_credit_code || null,
        official_website || null,
        wechat_official_account_id || null
      ]
    );

    res.json({
      success: true,
      message: '创建成功',
      data: {
        id: companyId,
        enterprise_abbreviation,
        enterprise_full_name,
        unified_credit_code,
        official_website,
        wechat_official_account_id
      }
    });
  } catch (error) {
    console.error('创建企业失败：', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: '该统一信用代码已存在' });
    }
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

// 更新企业
router.put('/:id', [
  body('enterprise_abbreviation').notEmpty().withMessage('企业简称不能为空'),
  body('enterprise_full_name').notEmpty().withMessage('企业全称不能为空'),
  body('unified_credit_code').optional(),
  body('official_website').optional(),
  body('wechat_official_account_id').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const {
      enterprise_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      official_website,
      wechat_official_account_id
    } = req.body;

    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    // 获取旧数据用于日志记录
    const oldDataRows = await db.query('SELECT * FROM company WHERE id = ?', [id]);
    if (oldDataRows.length === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    const oldData = oldDataRows[0];

    // 检查统一信用代码是否被其他企业使用
    if (unified_credit_code) {
      const existing = await db.query(
        'SELECT id FROM company WHERE unified_credit_code = ? AND id != ?',
        [unified_credit_code, id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: '该统一信用代码已被其他企业使用' });
      }
    }

    const newData = {
      enterprise_abbreviation,
      enterprise_full_name,
      unified_credit_code: unified_credit_code || null,
      official_website: official_website || null,
      wechat_official_account_id: wechat_official_account_id || null
    };

    const result = await db.execute(
      `UPDATE company 
       SET enterprise_abbreviation = ?, enterprise_full_name = ?, unified_credit_code = ?,
           official_website = ?, wechat_official_account_id = ?, updater_user_id = ?
       WHERE id = ?`,
      [
        newData.enterprise_abbreviation,
        newData.enterprise_full_name,
        newData.unified_credit_code,
        newData.official_website,
        newData.wechat_official_account_id,
        userId,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    // 记录变更日志
    await logCompanyChange(id, oldData, newData, userId);

    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('更新企业失败：', error);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// 获取企业变更日志
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account 
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'company' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取企业日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 删除企业
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.execute('DELETE FROM company WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除企业失败：', error);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

module.exports = router;

