const express = require('express');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const axios = require('axios');

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

// 获取AI模型配置列表
router.get('/', checkAdminPermission, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, provider, application_type } = req.query;
    const offset = (page - 1) * pageSize;

    let condition = 'WHERE delete_mark = 0';
    const params = [];

    if (provider) {
      condition += ' AND provider = ?';
      params.push(provider);
    }

    if (application_type) {
      condition += ' AND application_type = ?';
      params.push(application_type);
    }

    // 查询数据（隐藏API密钥）
    const data = await db.query(
      `SELECT 
        id, config_name, provider, model_name, api_type, 
        CONCAT(LEFT(api_key, 8), '****') as api_key_masked,
        api_endpoint, temperature, max_tokens, top_p, 
        is_active, application_type, creator_user_id, created_at, updated_at
       FROM ai_model_config 
       ${condition} 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );

    // 查询总数
    const totalRows = await db.query(
      `SELECT COUNT(*) as total FROM ai_model_config ${condition}`,
      params
    );

    res.json({
      success: true,
      data: data,
      total: totalRows[0].total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('查询AI模型配置失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 获取单个AI模型配置（用于编辑）
router.get('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    
    const data = await db.query(
      'SELECT * FROM ai_model_config WHERE id = ? AND delete_mark = 0',
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
    console.error('查询AI模型配置详情失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 新增AI模型配置
router.post('/', checkAdminPermission, async (req, res) => {
  try {
    const {
      config_name,
      provider,
      model_name,
      api_type,
      api_key,
      api_endpoint,
      temperature = 0.7,
      max_tokens = 2000,
      top_p = 1.0,
      application_type = 'news_analysis'
    } = req.body;

    // 验证必填字段
    if (!config_name || !provider || !model_name || !api_type || !api_key || !api_endpoint) {
      return res.status(400).json({ 
        success: false, 
        message: '配置名称、提供商、模型名称、API类型、API密钥和API端点不能为空' 
      });
    }

    // 验证参数范围
    if (temperature < 0 || temperature > 2) {
      return res.status(400).json({ success: false, message: '温度参数必须在0-2之间' });
    }

    if (top_p < 0 || top_p > 1) {
      return res.status(400).json({ success: false, message: 'Top P参数必须在0-1之间' });
    }

    if (max_tokens < 1 || max_tokens > 32000) {
      return res.status(400).json({ success: false, message: '最大Token数必须在1-32000之间' });
    }

    const configId = await generateId('ai_model_config');
    await db.execute(
      `INSERT INTO ai_model_config 
       (id, config_name, provider, model_name, api_type, api_key, api_endpoint, 
        temperature, max_tokens, top_p, application_type, creator_user_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId, config_name, provider, model_name, api_type, api_key, 
        api_endpoint, temperature, max_tokens, top_p, application_type, req.currentUserId
      ]
    );

    res.json({
      success: true,
      message: '添加成功',
      data: { id: configId }
    });
  } catch (error) {
    console.error('新增AI模型配置失败：', error);
    res.status(500).json({ success: false, message: '添加失败：' + error.message });
  }
});

// 更新AI模型配置
router.put('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      config_name,
      provider,
      model_name,
      api_type,
      api_key,
      api_endpoint,
      temperature,
      max_tokens,
      top_p,
      application_type,
      is_active
    } = req.body;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT id FROM ai_model_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    // 验证参数范围
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
      return res.status(400).json({ success: false, message: '温度参数必须在0-2之间' });
    }

    if (top_p !== undefined && (top_p < 0 || top_p > 1)) {
      return res.status(400).json({ success: false, message: 'Top P参数必须在0-1之间' });
    }

    if (max_tokens !== undefined && (max_tokens < 1 || max_tokens > 32000)) {
      return res.status(400).json({ success: false, message: '最大Token数必须在1-32000之间' });
    }

    await db.execute(
      `UPDATE ai_model_config 
       SET config_name = ?, provider = ?, model_name = ?, api_type = ?, 
           api_key = ?, api_endpoint = ?, temperature = ?, max_tokens = ?, 
           top_p = ?, application_type = ?, is_active = ?, updater_user_id = ?
       WHERE id = ?`,
      [
        config_name, provider, model_name, api_type, api_key, api_endpoint,
        temperature, max_tokens, top_p, application_type, is_active, req.currentUserId, id
      ]
    );

    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新AI模型配置失败：', error);
    res.status(500).json({ success: false, message: '更新失败：' + error.message });
  }
});

// 删除AI模型配置（软删除）
router.delete('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT id FROM ai_model_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    await db.execute(
      `UPDATE ai_model_config 
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
       WHERE id = ?`,
      [req.currentUserId, id]
    );

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除AI模型配置失败：', error);
    res.status(500).json({ success: false, message: '删除失败：' + error.message });
  }
});

// 测试AI模型配置
router.post('/:id/test', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取配置信息
    const configs = await db.query(
      'SELECT * FROM ai_model_config WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const config = configs[0];
    
    // 根据提供商构建测试请求
    let testResult;
    
    if (config.provider === 'alibaba') {
      testResult = await testAlibabaModel(config);
    } else if (config.provider === 'openai') {
      testResult = await testOpenAIModel(config);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: `暂不支持测试 ${config.provider} 提供商的模型` 
      });
    }

    res.json({
      success: true,
      message: '模型测试成功',
      data: testResult
    });

  } catch (error) {
    console.error('测试AI模型失败：', error);
    res.status(500).json({ 
      success: false, 
      message: '测试失败：' + error.message 
    });
  }
});

// 测试阿里云千问模型
async function testAlibabaModel(config) {
  const testMessage = "你好，请回复'测试成功'";
  
  const requestData = {
    model: config.model_name,
    input: {
      messages: [
        {
          role: "user",
          content: testMessage
        }
      ]
    },
    parameters: {
      temperature: config.temperature,
      max_tokens: Math.min(config.max_tokens, 100), // 测试时限制token数
      top_p: config.top_p
    }
  };

  const response = await axios.post(config.api_endpoint, requestData, {
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  return {
    status: 'success',
    response_time: new Date().toISOString(),
    model_response: response.data.output?.text || response.data.output?.choices?.[0]?.message?.content || '模型响应格式未知',
    token_usage: response.data.usage || null
  };
}

// 测试OpenAI模型
async function testOpenAIModel(config) {
  const testMessage = "Hello, please reply 'Test successful'";
  
  const requestData = {
    model: config.model_name,
    messages: [
      {
        role: "user",
        content: testMessage
      }
    ],
    temperature: config.temperature,
    max_tokens: Math.min(config.max_tokens, 100),
    top_p: config.top_p
  };

  const response = await axios.post(config.api_endpoint, requestData, {
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  return {
    status: 'success',
    response_time: new Date().toISOString(),
    model_response: response.data.choices?.[0]?.message?.content || '模型响应格式未知',
    token_usage: response.data.usage || null
  };
}

// 获取可用的模型列表（用于前端选择）
router.get('/models/available', checkAdminPermission, (req, res) => {
  const availableModels = {
    alibaba: [
      'qwen-turbo',
      'qwen-plus',
      'qwen-max',
      'qwen-max-longcontext'
    ],
    openai: [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o'
    ],
    baidu: [
      'ernie-bot',
      'ernie-bot-turbo',
      'ernie-bot-4'
    ],
    tencent: [
      'hunyuan-lite',
      'hunyuan-standard',
      'hunyuan-pro'
    ]
  };

  res.json({
    success: true,
    data: availableModels
  });
});

module.exports = router;
