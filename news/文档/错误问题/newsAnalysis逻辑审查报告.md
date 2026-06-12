## newsAnalysis.js 逻辑审查报告

审查日期：2026-06-12  
审查范围：`server/utils/newsAnalysis.js` 全文（~450KB）  
问题分类：**[新引入]** = 本次修复引入的问题，**[原有]** = 原代码已存在的问题

---

### 一、高严重度问题（建议优先修复）

#### 1. [新引入] shouldValidate=true 路径下弱提及检测被双重执行，且使用不同数据源

**位置**：`processNewsWithEnterprise` 第 6346-6397 行

当 `shouldValidate = true` 时（企查查、上海国际集团接口），调用链如下：
1. 第 6349 行：`ensureNewsContent` 获取完整内容 → 传入 `validateExistingAssociation`
2. `validateExistingAssociation` 内部（第 5629-5663 行）已有提及权重分析，使用 `validationContent`
3. 如果上一步通过，第 6372 行：新增的 `detectWeakMention` 使用 `newsItem.content`（原始内容）再次检测

**问题**：
- 两次检测使用不同的内容源。`validationContent` 可能经过 `ensureNewsContent` 重新抓取，比 `newsItem.content` 更完整
- 两次检测的 `coreKeyword` 计算逻辑不同。`validateExistingAssociation` 能从 DB 查询中获取 `project_abbreviation`，而 `detectWeakMention` 只能使用传入的参数
- 可能导致：第一步通过 → 第二步推翻，行为不可预测

**修复建议**：弱提及检测块只在 `shouldValidate = false` 时执行：
```javascript
if (!shouldValidate && shouldKeepAssociation && finalEnterpriseName) {
    // 弱提及检测...
}
```

---

#### 2. [新引入] 弱提及检测使用 newsItem.content 而非 ensureNewsContent 结果

**位置**：`processNewsWithEnterprise` 第 6372 行

```javascript
const weakMentionContent = newsItem.content || '';
```

新榜免检通道（`shouldValidate = false`）下，`ensureNewsContent` 从未被调用。如果 `newsItem.content` 为空（原始数据未包含正文），`detectWeakMention` 在空内容中搜索企业关键词：
- `mentionCount` 为 0
- 方法返回 `true`（判定为弱提及）
- 关联被错误解除

**修复建议**：在弱提及检测前先确保内容可用：
```javascript
let weakMentionContent = newsItem.content || '';
if (!weakMentionContent && newsItem.source_url) {
    const fetchedContent = await this.ensureNewsContent(newsItem);
    weakMentionContent = fetchedContent || '';
}
```

---

#### 3. [新引入] 解除关联时未清除 enterpriseAbbreviation 和 entityTypeFromEnterpriseCheck

**位置**：`processNewsWithEnterprise` 第 6391-6395 行

当弱提及检测解除关联时：
```javascript
shouldKeepAssociation = false;
finalEnterpriseName = null;
// 但 enterpriseAbbreviation 和 entityTypeFromEnterpriseCheck 仍为非 null
```

后续数据库写入时（第 6621-6637 行），可能出现：
- `enterprise_full_name = NULL`
- `enterprise_abbreviation = '某简称'`（非 null）
- `entity_type = '某类型'`（非 null）

产生不一致记录。

**修复建议**：
```javascript
if (isWeakMention) {
    shouldKeepAssociation = false;
    finalEnterpriseName = null;
    enterpriseAbbreviation = null;
    entityTypeFromEnterpriseCheck = null;
}
```

---

#### 4. [原有] AI 只看到前 3000 字符，但二次验证使用全文

**位置**：`analyzeEnterpriseRelevance` 第 5167-5226 行 vs 第 5375 行

AI prompt 中 content 被截断为 3000 字符，但二次验证（`fullContent = title + content`）使用全文。这导致两类矛盾：
- **假阴性**：企业名只在 3000 字符之后出现，AI 看不到 → 低分 → 被过滤，但二次验证能在全文中找到名字
- **假阳性**：AI 基于前 3000 字符给出高分，二次验证在全文中找到名字不降分，但相关上下文在 3000 字符之后

**修复建议**：增大截断限制（如 5000 字符），或让二次验证也使用截断后的内容。

---

#### 5. [原有] `_caseInsensitiveMatch` 双向子串匹配导致误关联

**位置**：第 5070-5085 行

```javascript
return s1 === s2 || s1.includes(s2) || s2.includes(s1);
```

短名称或通用名称容易误匹配：
- "华科" 匹配 "华科芯" 也匹配 "东华科技"
- "博瑞" 匹配 "博瑞科技" 也匹配 "博瑞医药"

后续的 filter（第 5282-5318 行）又叠加了更多 `.includes()` 检查，使匹配更加宽松。

**修复建议**：增加最小长度阈值（如较短字符串需 ≥ 3 字符），或优先精确匹配。

---

#### 6. [原有] `formatEnterpriseName` 嵌套格式 bug

**位置**：第 59-67 行

当 `enterpriseFullName` 已经是 "简称【全称】" 格式时：
```javascript
const fullName = enterpriseFullName || existingFullName;  // BUG
```
`enterpriseFullName` 是原始传入值（如 "ABC【XYZ公司】"），总是 truthy，导致 `fullName` 被赋为 "ABC【XYZ公司】"。最终返回 `"ABC【ABC【XYZ公司】】"`。

**修复建议**：改为 `const fullName = existingFullName;`

---

#### 7. [原有] AI 调用异常直接解除关联，无重试

**位置**：`validateExistingAssociation` 第 5777-5813 行

网络超时、限流等瞬时故障会导致 AI 校验直接异常，代码中 catch 块直接 `return false`（解除关联），无重试机制。

**修复建议**：对瞬时错误增加 1 次重试。

---

### 二、中严重度问题

#### 8. [原有] `validateExistingAssociation` 中 "简称【全称】" 格式的简称未传递到文本匹配阶段

**位置**：第 5458 行 vs 第 5605 行

从 "简称【全称】" 格式解析出的简称存储在 `abbreviation`，但文本匹配阶段只用 `projectAbbreviation`（来自 "全称(简称)" 格式解析）。如果企业使用 "简称【全称】" 格式，简称不会被主动加入关键词列表。

---

#### 9. [原有] "全称(简称)" 格式只匹配半角括号

**位置**：第 5463 行

正则 `/\(([^)]+)\)$/` 只匹配半角 `()`，全角 `（）` 无法解析。

---

#### 10. [原有] `detectWeakMention` 与 `validateExistingAssociation` 的 coreKeyword 优先级不一致

**位置**：`detectWeakMention` 第 5104 行 vs `validateExistingAssociation` 第 5635 行

| 优先级 | `detectWeakMention` | `validateExistingAssociation` |
|--------|--------------------|------------------------------|
| 1 | projectAbbreviation | projectAbbreviation |
| 2 | enterpriseName.split()[0] | DB 的 project_abbreviation |
| 3 | enterpriseFullName.split()[0] | enterpriseName.split()[0] |
| 4 | enterpriseName | enterpriseName |

同一企业在不同路径下可能得到不同的弱提及判定结果。

---

#### 11. [原有] 企查查路径不查询 invested_enterprises

**位置**：`processNewsWithEnterprise` 第 6190-6192 行

企查查路径只设置 `shouldValidate = true`，不查询 `invested_enterprises` 表。导致 `enterpriseAbbreviation` 和 `entityTypeFromEnterpriseCheck` 永远为 null。

---

#### 12. [原有] 短文章的弱提及检测盲区（contentLength <= 1500）

**位置**：`detectWeakMention` 第 5134 行

文章 ≤ 1500 字时，企业名只出现 1 次、不在标题和开头，不会被判定为弱提及。但语义上仍可能是顺带提及。

---

#### 13. [原有] AI 响应为空/undefined 未做校验

**位置**：`callAIModel` 相关方法

底层调用返回 `undefined`（API 响应 choices 为空），上层 `.match()` 会抛 TypeError。

---

#### 14. [原有] 二次验证条件分支不互斥

**位置**：`analyzeEnterpriseRelevance` 第 5398-5410 行

第三个分支（`!fullName && !abbreviation && !name && score > 40`）没有显式检查 `hasKeywordInContent`，注释说"只有关键词匹配"但条件不强制。

---

### 三、低严重度问题

#### 15. [原有] JSON 解析前全局移除反引号可能破坏有效数据

第 4488-4489 行 `.replace(/\`/g, '')` 会移除 JSON 值中的反引号。

#### 16. [原有] JSON 提取使用贪婪匹配

第 4480 行 `/\{[\s\S]*\}/` 可能跨多个 JSON 对象匹配。

#### 17. [原有] 所有 SQL 查询用 LIMIT 1 无排序

五种企业匹配方式的查询无 ORDER BY，可能返回非最佳匹配。

#### 18. [原有] 正面关键词列表有重复项

`positiveKeywords` 数组中 '增长'、'提升'、'利好' 各出现两次。

#### 19. [原有] 默认提示词模板与 replacePromptVariables 双重截断

`analyzeEnterpriseRelevance` 的默认模板在模板字面量中硬编码 `.substring(0, 3000)`，后续 `replacePromptVariables` 又做一次截断。

#### 20. [原有] 弱提及检测解除关联时日志未标注

第 6654 行的完成日志条件 `shouldValidate && !shouldKeepAssociation` 遗漏了弱提及检测在免检通道下解除关联的场景。

---

### 四、问题 1 的具体修复方案

问题 1-3 是本次修复引入的，需要立即处理。最小改动方案：

```javascript
// 将弱提及检测限制在 shouldValidate=false 的路径
if (!shouldValidate && shouldKeepAssociation && finalEnterpriseName) {
    // ... 现有弱提及检测代码 ...
    
    if (isWeakMention) {
        // ... 解除关联 ...
        enterpriseAbbreviation = null;           // 新增
        entityTypeFromEnterpriseCheck = null;    // 新增
    }
}
```

对于内容可能为空的问题，在弱提及检测前增加：
```javascript
let weakMentionContent = newsItem.content || '';
if (weakMentionContent.trim().length < 50 && newsItem.source_url) {
    const fetchedContent = await this.ensureNewsContent(newsItem);
    weakMentionContent = fetchedContent || weakMentionContent;
}
```
