# AI模型配置说明

## 修复内容总结

已修复以下问题：
1. ✅ **彻底清理正文无效信息**：移除无关话题（奶茶妹妹、房地产调控等）、推荐模块、重复内容
2. ✅ **控制Prompt长度与Token数**：内容截断到3000字符，Token预校验（目标≤6000 token）
3. ✅ **校验请求参数格式**：确保符合OpenAI兼容模式要求，清理特殊字符
4. ✅ **优化错误重试逻辑**：3次重试，第3次自动切换到qwen-plus备用模型
5. ✅ **补全分析结果字段**：失败时基于内容智能推断情绪、关键词和摘要

## 需要配置的部分

### 1. 配置qwen-plus备用模型

在数据库的 `ai_model_config` 表中，需要添加一个 `qwen-plus` 模型的配置记录，作为备用模型。

**SQL配置示例：**

```sql
INSERT INTO ai_model_config (
  application_type,
  provider,
  model_name,
  api_key,
  api_endpoint,
  temperature,
  max_tokens,
  top_p,
  is_active,
  delete_mark,
  created_at,
  updated_at
) VALUES (
  'news_analysis',
  'alibaba',
  'qwen-plus',
  'sk-40529967d9c54942a1cea374c4d800a6',  -- 使用与主模型相同的API Key
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  0.7,
  2000,
  0.9,
  1,
  0,
  NOW(),
  NOW()
);
```

**配置说明：**
- `model_name`: 必须为 `qwen-plus`（代码中会按此名称查找）
- `api_key`: 使用与主模型相同的API Key
- `api_endpoint`: OpenAI兼容格式的端点
- `temperature`: 0.7（与主模型保持一致）
- `max_tokens`: 2000（qwen-plus的输出token限制）
- `is_active`: 1（激活状态）
- `delete_mark`: 0（未删除）

### 2. 验证主模型配置

确保主模型（qwen-max-longcontext）的配置正确：

```sql
SELECT * FROM ai_model_config 
WHERE model_name = 'qwen-max-longcontext' 
AND is_active = 1 
AND delete_mark = 0;
```

**检查项：**
- `api_key`: 确保有效
- `api_endpoint`: 应为 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- `max_tokens`: 建议设置为 2000-3000（输出限制，不是输入限制）
- `temperature`: 0.7

### 3. 配置验证

配置完成后，可以通过以下方式验证：

1. **检查模型配置是否存在：**
   ```sql
   SELECT model_name, is_active, api_endpoint 
   FROM ai_model_config 
   WHERE model_name IN ('qwen-max-longcontext', 'qwen-plus')
   AND is_active = 1 
   AND delete_mark = 0;
   ```

2. **查看日志：**
   - 如果主模型调用失败，日志中会显示：`[analyzeNewsSentimentAndType] 前两次重试均失败，切换到备用模型 qwen-plus`
   - 如果切换成功，会显示：`[analyzeNewsSentimentAndType] ✓ 已切换到备用模型: qwen-plus`

## 代码改进点

### 1. 内容清理增强
- 移除无关话题（奶茶妹妹、房地产调控、美国两房崩盘等）
- 移除推荐新闻模块（热文排行榜、今日推荐等）
- 移除重复的Prompt文本（情绪分类标准、类型标签说明等）
- 智能识别尾部推荐内容（基于短句比例和标题特征）

### 2. Token控制
- 内容自动截断到3000字符
- Token预校验：总token数≤6000（预留模型响应空间）
- 如果超限，自动截断内容到合理长度

### 3. 重试机制
- **第1次重试**：进一步清理内容 + 截断到2000字符
- **第2次重试**：继续清理 + 精简Prompt
- **第3次重试**：自动切换到qwen-plus备用模型

### 4. 失败降级处理
- 基于内容关键词智能推断情绪（负面/正面/中性）
- 智能推断关键词（财务数据、经营风险、融资消息等）
- 自动生成摘要（基于标题和内容）

### 5. 请求参数验证
- 清理特殊字符（未转义的引号、换行符）
- 验证模型名称、消息内容不为空
- 记录详细的请求参数日志

## 使用建议

1. **监控日志**：关注以下日志信息
   - `[analyzeNewsSentimentAndType] Token估算` - 查看token使用情况
   - `[analyzeNewsSentimentAndType] ⚠️ AI调用失败` - 查看失败原因
   - `[analyzeNewsSentimentAndType] ✓ 已切换到备用模型` - 确认备用模型切换

2. **调整参数**：如果仍然遇到问题，可以调整：
   - `MAX_INPUT_TOKENS`（当前6000）- 在代码中搜索此常量
   - 内容截断长度（当前3000字符）- 在 `truncateContentToLength` 调用处

3. **数据库配置**：确保 `ai_model_config` 表中的配置正确，特别是：
   - API Key有效
   - 模型名称拼写正确（区分大小写）
   - `is_active = 1` 且 `delete_mark = 0`
