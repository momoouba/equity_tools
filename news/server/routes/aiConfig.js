const express = require('express');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');
const axios = require('axios');

const router = express.Router();

const {
  loadAiModelMetaFromDictionary,
  loadAiModelOptionsFromDictionary,
  assertProviderAllowed,
  assertModelNameAllowedForProvider,
  assertApplicationTypeAllowed,
  assertUsageTypeAllowed,
} = require('../utils/aiModelDictionary');

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

    let condition = 'WHERE F_DeleteMark = 0';
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
        F_Id AS id, config_name, provider, model_name, api_type, 
        CONCAT(LEFT(api_key, 8), '****') as api_key_masked,
        api_endpoint, temperature, max_tokens, top_p, enable_thinking,
        is_active, application_type, usage_type, F_CreatorUserId, F_CreatorTime, F_LastModifyTime
       FROM ai_model_config 
       ${condition} 
       ORDER BY F_CreatorTime DESC 
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

// 获取启用的AI模型配置列表（用于下拉选择）
router.get('/active', checkAdminPermission, async (req, res) => {
  try {
    const data = await db.query(
      `SELECT 
        F_Id AS id, config_name, provider, model_name, api_type, 
        application_type, usage_type
       FROM ai_model_config 
       WHERE F_DeleteMark = 0 AND is_active = 1
       ORDER BY F_CreatorTime DESC`
    );

    res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('查询启用的AI模型配置失败：', error);
    console.error('错误堆栈：', error.stack);
    res.status(500).json({ 
      success: false, 
      message: error.message || '查询失败',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 获取可用的模型列表（用于前端选择；来源为数据字典 item_code / item_name）
router.get('/models/available', checkAdminPermission, async (req, res) => {
  try {
    const data = await loadAiModelOptionsFromDictionary();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取可用模型字典失败：', error);
    res.status(500).json({ success: false, message: error.message || '获取失败' });
  }
});

// 应用类型 / 使用类型 / 提供商下拉（数据字典 ai_model_*）
router.get('/meta/options', checkAdminPermission, async (req, res) => {
  try {
    const data = await loadAiModelMetaFromDictionary();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取 AI 模型元数据字典失败：', error);
    res.status(500).json({ success: false, message: error.message || '获取失败' });
  }
});

// 获取单个AI模型配置（用于编辑）
router.get('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    
    const data = await db.query(
      'SELECT *, F_Id AS id FROM ai_model_config WHERE F_Id = ? AND F_DeleteMark = 0',
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
      application_type = 'news_analysis',
      usage_type = 'content_analysis',
      enable_thinking,
    } = req.body;

    const effEnableThinking =
      enable_thinking === undefined || enable_thinking === null || enable_thinking === ''
        ? null
        : Number(enable_thinking) === 1
          ? 1
          : 0;

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

    try {
      await assertProviderAllowed(provider);
      await assertUsageTypeAllowed(usage_type);
      await assertApplicationTypeAllowed(application_type);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ success: false, message: e.message });
    }

    await assertModelNameAllowedForProvider(provider, model_name);

    const configId = await generateId('ai_model_config');
    await db.execute(
      `INSERT INTO ai_model_config 
       (F_Id, config_name, provider, model_name, api_type, api_key, api_endpoint, 
        temperature, max_tokens, top_p, enable_thinking, application_type, usage_type, F_CreatorUserId) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId, config_name, provider, model_name, api_type, api_key, 
        api_endpoint, temperature, max_tokens, top_p, effEnableThinking,
        application_type, usage_type, req.currentUserId
      ]
    );

    res.json({
      success: true,
      message: '添加成功',
      data: { id: configId }
    });
  } catch (error) {
    console.error('新增AI模型配置失败：', error);
    const code = error.statusCode === 400 ? 400 : 500;
    res.status(code).json({ success: false, message: '添加失败：' + error.message });
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
      usage_type,
      is_active,
      enable_thinking,
    } = req.body;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT F_Id FROM ai_model_config WHERE F_Id = ? AND F_DeleteMark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    const effEnableThinking =
      enable_thinking === undefined
        ? undefined
        : enable_thinking === null || enable_thinking === ''
          ? null
          : Number(enable_thinking) === 1
            ? 1
            : 0;

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

    try {
      if (provider !== undefined) await assertProviderAllowed(provider);
      if (usage_type !== undefined) await assertUsageTypeAllowed(usage_type);
      if (application_type !== undefined) await assertApplicationTypeAllowed(application_type);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ success: false, message: e.message });
    }

    const rowFull = await db.query(
      'SELECT * FROM ai_model_config WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1',
      [id]
    );
    if (!rowFull.length) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    const prev = rowFull[0];
    const effProvider = provider !== undefined ? provider : prev.provider;
    const effModel = model_name !== undefined ? model_name : prev.model_name;
    await assertModelNameAllowedForProvider(effProvider, effModel);

    const incomingKey = api_key !== undefined && api_key !== null ? String(api_key).trim() : '';
    const effApiKey =
      incomingKey && !incomingKey.includes('****') ? incomingKey : prev.api_key;

    await db.execute(
      `UPDATE ai_model_config 
       SET config_name = ?, provider = ?, model_name = ?, api_type = ?, 
           api_key = ?, api_endpoint = ?, temperature = ?, max_tokens = ?, 
           top_p = ?, enable_thinking = ?, application_type = ?, usage_type = ?, is_active = ?, F_LastModifyUserId = ?
       WHERE F_Id = ?`,
      [
        config_name !== undefined ? config_name : prev.config_name,
        provider !== undefined ? provider : prev.provider,
        model_name !== undefined ? model_name : prev.model_name,
        api_type !== undefined ? api_type : prev.api_type,
        effApiKey,
        api_endpoint !== undefined ? api_endpoint : prev.api_endpoint,
        temperature !== undefined ? temperature : prev.temperature,
        max_tokens !== undefined ? max_tokens : prev.max_tokens,
        top_p !== undefined ? top_p : prev.top_p,
        effEnableThinking !== undefined ? effEnableThinking : prev.enable_thinking,
        application_type !== undefined ? application_type : prev.application_type,
        usage_type !== undefined ? usage_type : prev.usage_type,
        is_active !== undefined ? is_active : prev.is_active,
        req.currentUserId,
        id,
      ]
    );

    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新AI模型配置失败：', error);
    const code = error.statusCode === 400 ? 400 : 500;
    res.status(code).json({ success: false, message: '更新失败：' + error.message });
  }
});

// 删除AI模型配置（软删除）
router.delete('/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查记录是否存在
    const existing = await db.query(
      'SELECT F_Id FROM ai_model_config WHERE F_Id = ? AND F_DeleteMark = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }

    await db.execute(
      `UPDATE ai_model_config 
       SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
       WHERE F_Id = ?`,
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
      'SELECT * FROM ai_model_config WHERE F_Id = ? AND F_DeleteMark = 0',
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
    } else if (
      config.provider === 'openai' ||
      config.provider === 'volcengine' ||
      config.api_type === 'chat_completion'
    ) {
      testResult = await testOpenAIModel(config);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: `暂不支持测试 ${config.provider} 提供商的模型（可尝试 API 类型选 Chat Completion API）` 
      });
    }

    res.json({
      success: true,
      message: '模型测试成功',
      data: testResult
    });

  } catch (error) {
    console.error('测试AI模型失败：', error);
    
    // 获取更详细的错误信息
    let errorMessage = error.message;
    if (error.response) {
      // 如果有响应，获取详细的错误信息
      const statusCode = error.response.status;
      const errorData = error.response.data;
      
      if (errorData) {
        if (errorData.message) {
          errorMessage = `HTTP ${statusCode}: ${errorData.message}`;
        } else if (errorData.error) {
          errorMessage = `HTTP ${statusCode}: ${errorData.error.message || errorData.error}`;
        } else if (errorData.code) {
          errorMessage = `HTTP ${statusCode}: ${errorData.code} - ${errorData.message || '未知错误'}`;
        } else {
          errorMessage = `HTTP ${statusCode}: ${JSON.stringify(errorData)}`;
        }
      } else {
        errorMessage = `HTTP ${statusCode}: ${error.message}`;
      }
    }
    
    res.status(500).json({ 
      success: false, 
      message: '测试失败：' + errorMessage 
    });
  }
});

// 测试阿里云千问模型
async function testAlibabaModel(config) {
  const testMessage = "你好，请回复'测试成功'";
  
  // 检查是否是视觉模型（VL模型）
  const isVisionModel = config.model_name && (
    config.model_name.toLowerCase().includes('vl') || 
    config.model_name.toLowerCase().includes('vision') ||
    config.usage_type === 'image_recognition'
  );
  
  // 对于视觉模型，验证API端点是否正确
  if (isVisionModel) {
    const endpoint = config.api_endpoint || '';
    // 视觉模型应该使用兼容模式端点或multimodal端点
    const isValidVisionEndpoint = 
      endpoint.includes('/compatible-mode/v1/chat/completions') ||
      endpoint.includes('/multimodal-generation/generation') ||
      endpoint.includes('/chat/completions');
    
    if (!isValidVisionEndpoint) {
      throw new Error(
        '视觉模型需要使用正确的API端点。\n' +
        '推荐使用：https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions\n' +
        '或：https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
      );
    }
  }
  
  let requestData;
  
  // 确保参数类型正确（转换为数字类型），并做安全兜底
  const temperature = typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature;
  const maxTokensRaw = typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const maxTokens = Number.isFinite(maxTokensRaw) ? maxTokensRaw : 2000;
  const topP = typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p;
  
  // 根据API类型选择不同的请求格式
  if (config.api_type === 'chat_completion') {
    // Chat Completion API（兼容OpenAI格式）
    requestData = {
      model: config.model_name,
      messages: [
        {
          role: "user",
          content: testMessage
        }
      ],
      temperature: temperature,
      max_tokens: Math.min(maxTokens, 100), // 测试时限制token数
      top_p: topP
    };
  } else {
    // Chat API（阿里云原生格式）
    requestData = {
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
        temperature: temperature,
        max_tokens: Math.min(maxTokens, 100), // 测试时限制token数
        top_p: topP
      }
    };
  }

  // 添加调试日志
  console.log(`[测试AI模型] 模型: ${config.model_name}, API类型: ${config.api_type}, 端点: ${config.api_endpoint}`);
  console.log(`[测试AI模型] 请求数据:`, JSON.stringify(requestData, null, 2));
  
  let response;
  try {
    response = await axios.post(config.api_endpoint, requestData, {
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    console.log(`[测试AI模型] 响应成功:`, JSON.stringify(response.data, null, 2));
  } catch (error) {
    // 捕获并抛出更详细的错误信息
    console.error(`[测试AI模型] 请求失败:`, error.response?.data || error.message);
    
    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      let detailedError = `API请求失败 (HTTP ${statusCode})`;
      
      if (errorData) {
        if (errorData.message) {
          detailedError += `: ${errorData.message}`;
        } else if (errorData.error) {
          detailedError += `: ${errorData.error.message || errorData.error}`;
        } else if (errorData.code) {
          detailedError += `: ${errorData.code} - ${errorData.message || '未知错误'}`;
        }
        
        // 如果是模型不存在错误，提供更详细的提示
        if (errorData.code === 'InvalidParameter' && errorData.message && errorData.message.includes('Model not exist')) {
          detailedError += '\n\n可能的原因：\n';
          detailedError += '1. 模型名称不正确，请确认模型名称完全匹配（qwen3-vl-plus）\n';
          detailedError += '2. API端点不正确，视觉模型应使用兼容模式端点\n';
          detailedError += '3. 账户可能没有权限使用该模型\n';
          detailedError += '\n推荐配置：\n';
          detailedError += '- API端点：https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions\n';
          detailedError += '- API类型：Chat Completion API\n';
          detailedError += '- 模型名称：qwen3-vl-plus（注意大小写）';
        }
      }
      
      throw new Error(detailedError);
    }
    throw error;
  }

  // 根据API类型解析响应
  let modelResponse;
  if (config.api_type === 'chat_completion') {
    // Chat Completion API响应格式（兼容OpenAI）
    modelResponse = response.data.choices?.[0]?.message?.content || '模型响应格式未知';
  } else {
    // Chat API响应格式（阿里云原生）
    modelResponse = response.data.output?.text || response.data.output?.choices?.[0]?.message?.content || '模型响应格式未知';
  }

  return {
    status: 'success',
    response_time: new Date().toISOString(),
    model_response: modelResponse,
    token_usage: response.data.usage || null
  };
}

// 测试OpenAI模型
async function testOpenAIModel(config) {
  const testMessage = "Hello, please reply 'Test successful'";
  
  const maxTokensRaw = typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const safeMaxTokens = Number.isFinite(maxTokensRaw) ? maxTokensRaw : 2000;

  const requestData = {
    model: config.model_name,
    messages: [
      {
        role: "user",
        content: testMessage
      }
    ],
    temperature: typeof config.temperature === 'string' ? parseFloat(config.temperature) : (config.temperature ?? 0.7),
    max_tokens: Math.min(safeMaxTokens, 100),
    top_p: typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p
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

module.exports = router;
