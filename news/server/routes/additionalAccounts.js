const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const { logDataChange } = require('../utils/logger');

const router = express.Router();

// 配置multer用于文件上传
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB限制
  }
});

// 用户认证中间件（所有用户都可以访问）
const checkAuth = (req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'user';
  const userId = req.headers['x-user-id'] || null;

  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  req.currentUserId = userId;
  req.currentUserRole = userRole;
  next();
};

// 获取额外公众号列表
router.get('/', checkAuth, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, search, status, userId } = req.query;
    const offset = (page - 1) * pageSize;
    const isAdmin = req.currentUserRole === 'admin';

    let condition = 'WHERE a.delete_mark = 0';
    const params = [];

    // 权限控制：普通用户只能看到自己创建的，管理员可以看到所有，并能切换用户查看
    if (isAdmin && userId) {
      // 管理员指定查看某个用户创建的
      condition += ' AND a.creator_user_id = ?';
      params.push(userId);
    } else if (!isAdmin) {
      // 普通用户只能看到自己创建的
      condition += ' AND a.creator_user_id = ?';
      params.push(req.currentUserId);
    }

    if (search) {
      condition += ' AND (a.account_name LIKE ? OR a.wechat_account_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (status) {
      condition += ' AND a.status = ?';
      params.push(status);
    }

    // 查询数据，包含创建人信息
    const data = await db.query(
      `SELECT 
        a.id, a.account_name, a.wechat_account_id, a.status, 
        a.creator_user_id, a.created_at, a.updater_user_id, a.updated_at,
        u.account as creator_account
       FROM additional_wechat_accounts a
       LEFT JOIN users u ON a.creator_user_id = u.id
       ${condition} 
       ORDER BY a.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );

    // 查询总数
    const totalRows = await db.query(
      `SELECT COUNT(*) as total 
       FROM additional_wechat_accounts a
       ${condition}`,
      params
    );

    res.json({
      success: true,
      data: data || [],
      total: totalRows[0]?.total || 0,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('查询额外公众号列表失败：', error);
    console.error('错误详情：', error.message);
    console.error('错误堆栈：', error.stack);
    res.status(500).json({ 
      success: false, 
      message: '查询失败：' + (error.message || '未知错误') 
    });
  }
});

// 新增额外公众号（所有用户都可以创建）
router.post('/', checkAuth, async (req, res) => {
  try {
    const { account_name, wechat_account_id, status = 'active' } = req.body;

    if (!account_name || !wechat_account_id) {
      return res.status(400).json({ 
        success: false, 
        message: '公众号名称和账号ID不能为空' 
      });
    }

    // 检查是否已存在（允许不同用户创建相同的公众号ID，但在同步时会去重）
    // 这里只检查当前用户是否已经创建过相同的公众号ID
    const existing = await db.query(
      'SELECT id FROM additional_wechat_accounts WHERE wechat_account_id = ? AND creator_user_id = ? AND delete_mark = 0',
      [wechat_account_id, req.currentUserId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: '您已经创建过该微信账号ID' 
      });
    }

    const accountId = await generateId('additional_wechat_accounts');
    await db.execute(
      `INSERT INTO additional_wechat_accounts 
       (id, account_name, wechat_account_id, status, creator_user_id) 
       VALUES (?, ?, ?, ?, ?)`,
      [accountId, account_name, wechat_account_id, status, req.currentUserId]
    );

    // 记录新增日志（新增时旧数据为空）
    const newData = {
      account_name,
      wechat_account_id,
      status
    };
    await logDataChange('additional_wechat_accounts', accountId, {}, newData, req.currentUserId);

    res.json({
      success: true,
      message: '添加成功',
      data: { id: accountId }
    });
  } catch (error) {
    console.error('新增额外公众号失败：', error);
    res.status(500).json({ success: false, message: '添加失败：' + error.message });
  }
});

// 更新额外公众号（用户只能更新自己创建的，管理员可以更新所有）
router.put('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { account_name, wechat_account_id, status } = req.body;

    if (!account_name || !wechat_account_id) {
      return res.status(400).json({ 
        success: false, 
        message: '公众号名称和账号ID不能为空' 
      });
    }

    // 检查记录是否存在并获取旧数据
    const existing = await db.query(
      'SELECT * FROM additional_wechat_accounts WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '记录不存在' 
      });
    }

    const oldData = existing[0];
    
    // 权限检查：普通用户只能更新自己创建的
    if (req.currentUserRole !== 'admin' && oldData.creator_user_id !== req.currentUserId) {
      return res.status(403).json({ 
        success: false, 
        message: '无权更新此记录' 
      });
    }

    // 检查微信账号ID是否重复（排除当前记录，只检查当前用户创建的）
    const duplicate = await db.query(
      'SELECT id FROM additional_wechat_accounts WHERE wechat_account_id = ? AND id != ? AND creator_user_id = ? AND delete_mark = 0',
      [wechat_account_id, id, req.currentUserId]
    );

    if (duplicate.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: '您已经创建过该微信账号ID' 
      });
    }

    await db.execute(
      `UPDATE additional_wechat_accounts 
       SET account_name = ?, wechat_account_id = ?, status = ?, updater_user_id = ?
       WHERE id = ?`,
      [account_name, wechat_account_id, status, req.currentUserId, id]
    );

    // 记录变更日志
    const newData = {
      account_name,
      wechat_account_id,
      status
    };
    await logDataChange('additional_wechat_accounts', id, oldData, newData, req.currentUserId);

    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新额外公众号失败：', error);
    res.status(500).json({ success: false, message: '更新失败：' + error.message });
  }
});

// 删除额外公众号（软删除，用户只能删除自己创建的，管理员可以删除所有）
router.delete('/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT id, creator_user_id FROM additional_wechat_accounts WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '记录不存在' 
      });
    }
    
    // 权限检查：普通用户只能删除自己创建的
    if (req.currentUserRole !== 'admin' && existing[0].creator_user_id !== req.currentUserId) {
      return res.status(403).json({ 
        success: false, 
        message: '无权删除此记录' 
      });
    }

    await db.execute(
      `UPDATE additional_wechat_accounts 
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
       WHERE id = ?`,
      [req.currentUserId, id]
    );

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除额外公众号失败：', error);
    res.status(500).json({ success: false, message: '删除失败：' + error.message });
  }
});

// 批量导入额外公众号（所有用户都可以导入）
router.post('/batch-import', checkAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: '请选择要导入的文件' 
      });
    }

    // 解析Excel文件
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: '文件中没有有效数据' 
      });
    }

    let successCount = 0;
    let skipCount = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // Excel行号（从第2行开始）

      try {
        const account_name = row['公众号名称'] || row['account_name'];
        const wechat_account_id = row['账号ID'] || row['wechat_account_id'];

        if (!account_name || !wechat_account_id) {
          errors.push(`第${rowNum}行：公众号名称和账号ID不能为空`);
          continue;
        }

        // 检查当前用户是否已创建过该公众号ID
        const existing = await db.query(
          'SELECT id FROM additional_wechat_accounts WHERE wechat_account_id = ? AND creator_user_id = ? AND delete_mark = 0',
          [wechat_account_id, req.currentUserId]
        );

        if (existing.length > 0) {
          skipCount++;
          continue;
        }

        // 插入数据
        const accountId = await generateId('additional_wechat_accounts');
        await db.execute(
          `INSERT INTO additional_wechat_accounts 
           (id, account_name, wechat_account_id, status, creator_user_id) 
           VALUES (?, ?, ?, 'active', ?)`,
          [accountId, account_name, wechat_account_id, req.currentUserId]
        );

        successCount++;
      } catch (error) {
        errors.push(`第${rowNum}行：${error.message}`);
      }
    }

    res.json({
      success: true,
      message: `导入完成：成功${successCount}条，跳过${skipCount}条，错误${errors.length}条`,
      data: {
        successCount,
        skipCount,
        errorCount: errors.length,
        errors: errors.slice(0, 10) // 最多返回10个错误
      }
    });
  } catch (error) {
    console.error('批量导入失败：', error);
    res.status(500).json({ success: false, message: '导入失败：' + error.message });
  }
});

// 下载导入模板（所有用户都可以下载）
router.get('/download-template', checkAuth, (req, res) => {
  try {
    // 创建模板数据
    const templateData = [
      {
        '公众号名称': '示例公众号',
        '账号ID': 'example_account'
      },
      {
        '公众号名称': '测试公众号',
        '账号ID': 'test_account'
      }
    ];

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 20 }, // 公众号名称
      { wch: 20 }  // 账号ID
    ];

    // 设置表头样式
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let colNum = 0; colNum <= range.e.c; colNum++) {
      const headerCell = XLSX.utils.encode_cell({ r: 0, c: colNum });
      if (ws[headerCell]) {
        ws[headerCell].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4472C4" } },
          alignment: { horizontal: "center", vertical: "center" }
        };
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, '公众号导入模板');

    // 生成Excel文件
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'%E5%85%AC%E4%BC%97%E5%8F%B7%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx');
    
    res.send(buffer);
  } catch (error) {
    console.error('下载模板失败：', error);
    res.status(500).json({ success: false, message: '下载失败：' + error.message });
  }
});

// 获取额外公众号变更日志（用户只能查看自己创建的，管理员可以查看所有）
router.get('/:id/logs', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查记录是否存在并验证权限
    const existing = await db.query(
      'SELECT creator_user_id FROM additional_wechat_accounts WHERE id = ? AND delete_mark = 0',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    
    // 权限检查：普通用户只能查看自己创建的
    if (req.currentUserRole !== 'admin' && existing[0].creator_user_id !== req.currentUserId) {
      return res.status(403).json({ success: false, message: '无权查看此记录的日志' });
    }
    
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'additional_wechat_accounts' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取额外公众号日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

module.exports = router;
