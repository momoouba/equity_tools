# 公众号匹配逻辑说明

## 1. 公众号匹配逻辑

### 匹配流程

在新闻同步过程中，对于每篇从新榜接口获取的文章，系统会执行以下匹配逻辑：

**代码位置：** `server/routes/news.js` 第427-462行

### 匹配步骤

1. **获取公众号ID**
   ```javascript
   const wechatAccountId = article.account || account;
   ```
   - 从文章数据中获取公众号ID（`article.account` 或 `account`）

2. **查询invested_enterprises表**
   ```sql
   SELECT enterprise_full_name 
   FROM invested_enterprises 
   WHERE (wechat_official_account_id = ? 
     OR wechat_official_account_id LIKE ?
     OR wechat_official_account_id LIKE ?
     OR wechat_official_account_id LIKE ?)
   AND exit_status NOT IN ('完全退出', '已上市')
   AND delete_mark = 0 
   LIMIT 1
   ```

3. **匹配规则**

   系统支持**逗号分隔的多个公众号ID**，匹配规则包括：

   - **完全匹配**：`wechat_official_account_id = 'yikongenomics'`
   - **开头匹配**：`wechat_official_account_id LIKE 'yikongenomics,%'`
     - 例如：`wechat_official_account_id = 'yikongenomics,other_account'`
   - **中间匹配**：`wechat_official_account_id LIKE '%,yikongenomics,%'`
     - 例如：`wechat_official_account_id = 'account1,yikongenomics,account2'`
   - **结尾匹配**：`wechat_official_account_id LIKE '%,yikongenomics'`
     - 例如：`wechat_official_account_id = 'other_account,yikongenomics'`

4. **过滤条件**

   - ✅ 只查询 `exit_status` 不为 `'完全退出'` 和 `'已上市'` 的企业
   - ✅ 只查询 `delete_mark = 0`（未删除）的记录
   - ✅ 如果匹配到多条，只取第一条（`LIMIT 1`）

5. **设置企业全称**

   - 如果匹配成功：设置 `enterprise_fullName = 匹配到的企业全称`
   - 如果匹配失败：`enterprise_fullName = null`

### 示例：亿康医学（yikongenomics）

**情况：**
- 公众号ID：`yikongenomics`
- 公众号名称：`亿康医学`

**匹配过程：**

1. 系统查询 `invested_enterprises` 表，查找包含 `yikongenomics` 的记录
2. 查询条件：
   ```sql
   WHERE (wechat_official_account_id = 'yikongenomics'
     OR wechat_official_account_id LIKE 'yikongenomics,%'
     OR wechat_official_account_id LIKE '%,yikongenomics,%'
     OR wechat_official_account_id LIKE '%,yikongenomics')
   AND exit_status NOT IN ('完全退出', '已上市')
   AND delete_mark = 0
   ```

3. **如果匹配失败**（日志显示 `×`）：
   - 说明 `invested_enterprises` 表中没有包含 `yikongenomics` 的记录
   - 或者该企业的 `exit_status` 是 `'完全退出'` 或 `'已上市'`
   - 或者该记录已被删除（`delete_mark = 1`）

4. **结果：**
   - `enterprise_fullName = null`
   - 文章会被保存，但不会关联到被投企业
   - 后续可以通过AI分析来判断是否与企业相关

## 2. 为什么"最新IPO"会检查多次？

### 原因分析

**代码位置：** `server/routes/news.js` 第365-401行

### 处理流程

1. **遍历公众号列表**
   ```javascript
   for (const account of uniqueAccounts) {
     // 对每个公众号调用接口获取数据
   }
   ```

2. **分页获取文章**
   ```javascript
   while (hasMore) {
     // 调用接口，每页最多20条
     // 如果返回数据为空，停止分页
   }
   ```

3. **处理每篇文章**
   ```javascript
   for (const article of articles) {
     // 检查是否已存在（根据source_url去重）
     if (existing.length === 0) {
       // 检查公众号是否为企业公众号 ← 这里会执行检查
       console.log(`[入库] 检查公众号是否为企业公众号 - wechat_account_id: "${wechatAccountId}"`);
     }
   }
   ```

### 为什么会出现多次检查？

**原因：** 每篇文章都会执行一次检查

如果"最新IPO"这个公众号在时间范围内发布了**多篇文章**，那么：

1. 系统会获取该公众号的所有文章（可能分多页）
2. 对于**每篇新文章**（未在数据库中存在的），都会执行一次检查
3. 如果该公众号发布了3篇文章，就会检查3次

**示例：**

假设"最新IPO"在2025-12-03发布了3篇文章：
- 文章1：`source_url = 'https://example.com/article1'` → 检查1次
- 文章2：`source_url = 'https://example.com/article2'` → 检查1次
- 文章3：`source_url = 'https://example.com/article3'` → 检查1次

**结果：** 日志中会显示3次检查记录

### 优化建议

如果需要减少重复检查，可以考虑：

1. **缓存匹配结果**
   ```javascript
   const accountMatchCache = new Map();
   
   // 在循环外检查
   if (!accountMatchCache.has(wechatAccountId)) {
     // 执行数据库查询
     const result = await db.query(...);
     accountMatchCache.set(wechatAccountId, result);
   }
   ```

2. **批量查询**
   - 先收集所有需要检查的公众号ID
   - 一次性查询所有匹配结果
   - 在插入时使用缓存的结果

## 3. 日志输出说明

### 成功匹配
```
[入库] 检查公众号是否为企业公众号 - wechat_account_id: "MGItech", account_name:"华大智造MGI"
[入库] ✓ 匹配到企业公众号，设置企业全称:深圳华大智造科技股份有限公司
```

### 匹配失败
```
[入库] 检查公众号是否为企业公众号 - wechat_account_id: "yikongenomics", account_name:"亿康医学"
[入库] ✗ 公众号 "yikongenomics" 不是invested_enterprises表中的企业公众号
```

### 可能的原因

1. **企业不在invested_enterprises表中**
   - 该公众号对应的企业未被添加到被投企业列表

2. **企业状态为"完全退出"或"已上市"**
   - 系统会自动过滤这些状态的企业

3. **企业记录已被删除**
   - `delete_mark = 1` 的记录不会被查询

4. **公众号ID格式不匹配**
   - 如果数据库中的公众号ID是 `'account1,yikongenomics'`，应该能匹配
   - 但如果数据库中是 `'yikongenomics '`（有空格），可能无法匹配

## 4. 总结

- ✅ **匹配逻辑**：支持逗号分隔的多个公众号ID，使用4种匹配模式
- ✅ **过滤条件**：只匹配状态不为"完全退出"和"已上市"的企业
- ✅ **重复检查**：每篇新文章都会检查一次，这是正常行为
- ✅ **日志输出**：成功显示 `✓`，失败显示 `✗`

如果需要减少重复检查，可以考虑添加缓存机制。

