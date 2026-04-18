# AI企业关联分析优化说明

## 问题描述

在AI分析过程中发现，系统错误地将一些不相关的新闻与被投企业关联。例如：
- 英伟达财报相关新闻被错误关联到浙江太美医疗、深圳华大智造
- 仅因为都属于"科技"、"AI"等大类而被过度关联

## 优化措施

### 1. **严格化评估标准**

**原标准**（过于宽泛）：
- 涉及企业所在行业或业务领域：50-79%
- 间接相关（如供应链、竞争对手等）：30-49%

**新标准**（更加严格）：
- 90-100%：直接提及企业名称、产品名称、高管姓名或具体业务
- 70-89%：涉及企业的具体项目、合作伙伴关系或直接影响企业的事件
- 50-69%：涉及企业所在的细分行业领域，且对该企业有明确影响
- 30-49%：涉及相关行业趋势，但必须与企业业务有明确关联
- 0-29%：基本无关或仅有模糊的行业关联

### 2. **增强提示词严格性**

**新增要求**：
- 仅仅因为都属于"科技"、"医疗"、"AI"等大类行业不足以构成关联
- 必须有具体的业务关联、竞争关系或直接影响
- 宁可保守，不要过度关联
- 如果不确定，请给出较低的相关度分数

### 3. **二次验证机制**

**技术验证**：
```javascript
// 检查企业名称是否在新闻内容中出现
const nameInContent = fullContent.includes(enterpriseName);

// 如果企业名称不在内容中，但相关度超过50%，则降低相关度
if (!nameInContent && enterprise.relevance_score > 50) {
  enterprise.relevance_score = Math.max(enterprise.relevance_score - 30, 0);
}
```

### 4. **新增管理功能**

#### 4.1 强制重新分析
- API: `POST /api/news-analysis/analyze/:id`
- 参数: `{ "forceReanalyze": true }`
- 功能: 清空现有分析结果，重新进行企业关联分析

#### 4.2 批量清理错误关联
- API: `POST /api/news-analysis/clean-associations`
- 参数: `{ "keyword": "英伟达", "dryRun": true }`
- 功能: 查找并清理错误的企业关联

## 使用方法

### 1. **重新分析特定新闻**

```bash
# 对特定新闻进行重新分析
curl -X POST http://localhost:3001/api/news-analysis/analyze/新闻ID \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -H "x-user-id: admin123" \
  -d '{"forceReanalyze": true}'
```

### 2. **清理错误关联（预览模式）**

```bash
# 查找包含"英伟达"的新闻中可能错误的企业关联
curl -X POST http://localhost:3001/api/news-analysis/clean-associations \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -H "x-user-id: admin123" \
  -d '{"keyword": "英伟达", "dryRun": true}'
```

### 3. **执行清理操作**

```bash
# 实际清理错误关联
curl -X POST http://localhost:3001/api/news-analysis/clean-associations \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -H "x-user-id: admin123" \
  -d '{"keyword": "英伟达", "dryRun": false}'
```

## 验证效果

### 1. **检查现有错误关联**
- 搜索包含"英伟达"、"财报"等关键词的新闻
- 查看是否还有不相关的企业关联

### 2. **测试新的分析逻辑**
- 对新同步的新闻进行分析
- 验证企业关联的准确性

### 3. **监控分析质量**
- 定期检查分析结果
- 收集用户反馈
- 持续优化算法

## 预期效果

### 1. **减少误判**
- 显著降低不相关企业的错误关联
- 提高企业关联的准确性

### 2. **提升质量**
- 更精准的新闻分类
- 更可靠的投资决策支持

### 3. **便于管理**
- 提供工具清理历史错误数据
- 支持手动干预和调整

## 注意事项

1. **保守原则**：宁可漏掉一些边缘关联，也不要产生错误关联
2. **持续监控**：定期检查分析质量，及时调整算法
3. **人工复核**：对重要新闻建议进行人工复核
4. **反馈机制**：建立用户反馈机制，持续改进

## 后续计划

1. **机器学习优化**：基于历史数据训练更精准的关联模型
2. **实体识别**：集成NER技术，更准确识别企业实体
3. **行业知识库**：建立行业关系图谱，提升关联准确性
4. **用户反馈**：允许用户标记错误关联，用于模型优化

通过这些优化措施，AI企业关联分析将更加准确和可靠。
