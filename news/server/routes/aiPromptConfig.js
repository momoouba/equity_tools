const express = require('express');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');

const router = express.Router();

// 权限检查中间件
const checkAdminPermission = (req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'user';
  const userId = req.headers['x-user-id'] || null;

  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  if (userRole !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }

  req.currentUserId = userId;
  next();
};

// 记录提示词变更日志
async function logPromptChange(promptConfigId, changeType, oldValue, newValue, userId, changeReason = '') {
  try {
    const logId = await generateId('ai_prompt_change_log');
    await db.execute(
      `INSERT INTO ai_prompt_change_log 
       (id, prompt_config_id, change_type, old_value, new_value, change_user_id, change_reason) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        promptConfigId,
        changeType,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        userId,
        changeReason
      ]
    );
  } catch (error) {
    console.error('记录提示词变更日志失败:', error);
  }
}

// 获取提示词配置列表
router.get('/', checkAdminPermission, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, interface_type, prompt_type, is_active } = req.query;
    const offset = (page - 1) * pageSize;

    let condition = 'WHERE p.delete_mark = 0';
    const params = [];

    if (interface_type) {
      condition += ' AND p.interface_type = ?';
      params.push(interface_type);
    }

    if (prompt_type) {
      condition += ' AND p.prompt_type = ?';
      params.push(prompt_type);
    }

    if (is_active !== undefined) {
      condition += ' AND p.is_active = ?';
      params.push(parseInt(is_active));
    }

    // 查询数据
    // 使用 LEFT JOIN 关联AI模型配置，确保即使没有关联也能正常查询
    const data = await db.query(
      `SELECT 
        p.id, p.prompt_name, p.interface_type, p.prompt_type, 
        LEFT(p.prompt_content, 100) as prompt_content_preview,
        p.ai_model_config_id, p.is_active, p.creator_user_id, p.created_at, p.updated_at,
        m.config_name as ai_model_config_name, m.provider, m.model_name
       FROM ai_prompt_config p
       LEFT JOIN ai_model_config m ON p.ai_model_config_id = m.id AND m.delete_mark = 0
       ${condition} 
       ORDER BY p.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );

    // 查询总数
    const totalRows = await db.query(
      `SELECT COUNT(*) as total FROM ai_prompt_config p ${condition}`,
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
    console.error('查询提示词配置列表失败：', error);
    console.error('错误堆栈：', error.stack);
    res.status(500).json({ 
      success: false, 
      message: error.message || '查询失败',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 获取单个提示词配置（用于编辑）
router.get('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    
    const data = await db.query(
      'SELECT * FROM ai_prompt_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (data.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    res.json({
      success: true,
      data: data[0]
    });
  } catch (error) {
    console.error('查询提示词配置详情失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 新增提示词配置
router.post('/', checkAdminPermission, async (req, res) => {
  try {
    const {
      prompt_name,
      interface_type,
      prompt_type,
      prompt_content,
      ai_model_config_id,
      is_active = 1
    } = req.body;

    // 验证必填字段
    if (!prompt_name || !interface_type || !prompt_type || !prompt_content) {
      return res.status(400).json({ 
        success: false, 
        message: '提示词名称、接口类型、提示词类型和提示词内容不能为空' 
      });
    }

    // 验证接口类型（支持：新榜、企查查、上海国际集团）
    const validInterfaceTypes = ['新榜', '企查查', '上海国际集团'];
    if (!validInterfaceTypes.includes(interface_type)) {
      return res.status(400).json({ 
        success: false, 
        message: '接口类型必须是\"新榜\"、\"企查查\"或\"上海国际集团\"' 
      });
    }

    // 验证提示词类型
    const validPromptTypes = ['sentiment_analysis', 'enterprise_relevance', 'validation'];
    if (!validPromptTypes.includes(prompt_type)) {
      return res.status(400).json({ 
        success: false, 
        message: '提示词类型必须是：sentiment_analysis、enterprise_relevance 或 validation' 
      });
    }

    const configId = await generateId('ai_prompt_config');
    await db.execute(
      `INSERT INTO ai_prompt_config 
       (id, prompt_name, interface_type, prompt_type, prompt_content, ai_model_config_id, is_active, creator_user_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId, prompt_name, interface_type, prompt_type, prompt_content, ai_model_config_id || null, is_active, req.currentUserId
      ]
    );

    // 记录创建日志
    const newValue = {
      prompt_name,
      interface_type,
      prompt_type,
      prompt_content,
      is_active
    };
    await logPromptChange(configId, 'create', null, newValue, req.currentUserId, '创建提示词配置');

    res.json({
      success: true,
      message: '添加成功',
      data: { id: configId }
    });
  } catch (error) {
    console.error('新增提示词配置失败：', error);
    res.status(500).json({ success: false, message: '添加失败：' + error.message });
  }
});

// 更新提示词配置
router.put('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      prompt_name,
      interface_type,
      prompt_type,
      prompt_content,
      ai_model_config_id,
      is_active
    } = req.body;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT * FROM ai_prompt_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    // 保存旧值用于日志
    const oldValue = {
      prompt_name: existing[0].prompt_name,
      interface_type: existing[0].interface_type,
      prompt_type: existing[0].prompt_type,
      prompt_content: existing[0].prompt_content,
      ai_model_config_id: existing[0].ai_model_config_id,
      is_active: existing[0].is_active
    };

    // 验证接口类型（支持：新榜、企查查、上海国际集团）
    const validInterfaceTypes = ['新榜', '企查查', '上海国际集团'];
    if (interface_type && !validInterfaceTypes.includes(interface_type)) {
      return res.status(400).json({ 
        success: false, 
        message: '接口类型必须是\"新榜\"、\"企查查\"或\"上海国际集团\"' 
      });
    }

    // 验证提示词类型
    if (prompt_type) {
      const validPromptTypes = ['sentiment_analysis', 'enterprise_relevance', 'validation'];
      if (!validPromptTypes.includes(prompt_type)) {
        return res.status(400).json({ 
          success: false, 
          message: '提示词类型必须是：sentiment_analysis、enterprise_relevance 或 validation' 
        });
      }
    }

    await db.execute(
      `UPDATE ai_prompt_config 
       SET prompt_name = ?, interface_type = ?, prompt_type = ?, 
           prompt_content = ?, ai_model_config_id = ?, is_active = ?, updater_user_id = ?
       WHERE id = ?`,
      [
        prompt_name || existing[0].prompt_name,
        interface_type || existing[0].interface_type,
        prompt_type || existing[0].prompt_type,
        prompt_content || existing[0].prompt_content,
        ai_model_config_id !== undefined ? (ai_model_config_id || null) : existing[0].ai_model_config_id,
        is_active !== undefined ? is_active : existing[0].is_active,
        req.currentUserId,
        id
      ]
    );

    // 获取更新后的值
    const updated = await db.query(
      'SELECT * FROM ai_prompt_config WHERE id = ?',
      [id]
    );

    const newValue = {
      prompt_name: updated[0].prompt_name,
      interface_type: updated[0].interface_type,
      prompt_type: updated[0].prompt_type,
      prompt_content: updated[0].prompt_content,
      ai_model_config_id: updated[0].ai_model_config_id,
      is_active: updated[0].is_active
    };

    // 记录更新日志
    await logPromptChange(id, 'update', oldValue, newValue, req.currentUserId, '更新提示词配置');

    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新提示词配置失败：', error);
    res.status(500).json({ success: false, message: '更新失败：' + error.message });
  }
});

// 删除提示词配置（软删除）
router.delete('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT * FROM ai_prompt_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    // 保存旧值用于日志
    const oldValue = {
      prompt_name: existing[0].prompt_name,
      interface_type: existing[0].interface_type,
      prompt_type: existing[0].prompt_type,
      prompt_content: existing[0].prompt_content,
      is_active: existing[0].is_active
    };

    await db.execute(
      `UPDATE ai_prompt_config 
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
       WHERE id = ?`,
      [req.currentUserId, id]
    );

    // 记录删除日志
    await logPromptChange(id, 'delete', oldValue, null, req.currentUserId, '删除提示词配置');

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除提示词配置失败：', error);
    res.status(500).json({ success: false, message: '删除失败：' + error.message });
  }
});

// 启用/禁用提示词配置
router.patch('/:id/toggle-active', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT * FROM ai_prompt_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const oldIsActive = existing[0].is_active;
    const newIsActive = oldIsActive === 1 ? 0 : 1;

    await db.execute(
      `UPDATE ai_prompt_config 
       SET is_active = ?, updater_user_id = ?
       WHERE id = ?`,
      [newIsActive, req.currentUserId, id]
    );

    // 记录变更日志
    const oldValue = { ...existing[0], is_active: oldIsActive };
    const newValue = { ...existing[0], is_active: newIsActive };
    await logPromptChange(
      id, 
      newIsActive === 1 ? 'activate' : 'deactivate', 
      oldValue, 
      newValue, 
      req.currentUserId, 
      newIsActive === 1 ? '启用提示词配置' : '禁用提示词配置'
    );

    res.json({
      success: true,
      message: newIsActive === 1 ? '启用成功' : '禁用成功',
      data: { is_active: newIsActive }
    });
  } catch (error) {
    console.error('切换提示词配置状态失败：', error);
    res.status(500).json({ success: false, message: '操作失败：' + error.message });
  }
});

// 获取提示词修改历史
router.get('/:id/logs', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;

    // 检查配置是否存在
    const existing = await db.query(
      'SELECT id FROM ai_prompt_config WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    // 查询日志
    const logs = await db.query(
      `SELECT 
        l.id, l.change_type, l.old_value, l.new_value, 
        l.change_time, l.change_reason,
        u.account as change_user_name
       FROM ai_prompt_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.prompt_config_id = ?
       ORDER BY l.change_time DESC
       LIMIT ? OFFSET ?`,
      [id, parseInt(pageSize), offset]
    );

    // 查询总数
    const totalRows = await db.query(
      'SELECT COUNT(*) as total FROM ai_prompt_change_log WHERE prompt_config_id = ?',
      [id]
    );

    res.json({
      success: true,
      data: logs,
      total: totalRows[0].total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('查询提示词修改历史失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 获取启用的提示词（供AI分析使用）
router.get('/active/:interface_type/:prompt_type', async (req, res) => {
  try {
    const { interface_type, prompt_type } = req.params;

    const data = await db.query(
      `SELECT * FROM ai_prompt_config 
       WHERE interface_type = ? 
       AND prompt_type = ? 
       AND is_active = 1 
       AND delete_mark = 0 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [interface_type, prompt_type]
    );

    if (data.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: `未找到启用的提示词配置：${interface_type} - ${prompt_type}` 
      });
    }

    res.json({
      success: true,
      data: data[0]
    });
  } catch (error) {
    console.error('获取启用的提示词失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;

