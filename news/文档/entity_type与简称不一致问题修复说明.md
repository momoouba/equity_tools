# entity_type 为空但被投企业简称不为空 — 修复说明

## 现象

在新闻舆情页面选择新闻、点击「重新分析」时，出现过 **entity_type 为空、被投企业简称（enterprise_abbreviation）不为空** 的情况。  
典型场景：新榜接口、来自企业公众号的新闻。

## 根因（Bug，非偶发）

1. **重新分析路由（`/api/news-analysis/analyze/:id`）**
   - 先按 `wechat_account` / `account_name` 查 `invested_enterprises`，拿到 `enterprise_full_name`、`project_abbreviation`，并写入 `enterprise_abbreviation`。
   - 再**第二次**按 `enterprise_full_name` 查同表取 `entity_type`、`fund`、`sub_fund`。
   - 若第二次查询失败（异常或 0 行），`entity_type` 仍为 `null`，但 `enterprise_abbreviation` 已由第一次查询写入 → **不一致**。

2. **`processNewsWithEnterprise`（新榜有企业关联）**
   - `enterpriseCheck` 按企业名/简称匹配，命中时设置 `enterpriseAbbreviation`。
   - 后续 `enterpriseInfo` 按 `enterprise_full_name` 再查一次取 `entity_type`。
   - 若 `enterpriseInfo` 未命中或抛错，`entity_type` 保持 `null`，但 `enterpriseAbbreviation` 已设 → **不一致**。

## 修复内容

### 1. 重新分析路由（`server/routes/newsAnalysis.js`）

- **wechat_account 匹配**：一次查询即拉取 `enterprise_full_name`、`project_abbreviation`、`entity_type`、`fund`、`sub_fund`，不再做第二次按 `enterprise_full_name` 的查询。
- **account_name 匹配**：同样改为一次查询包含上述字段。
- 更新 `news_detail` 时，企业全称、简称、`entity_type`、`fund`、`sub_fund` 全部来自同一次查询结果，避免二次查询失败导致不一致。

### 2. `processNewsWithEnterprise`（`server/utils/newsAnalysis.js`）

- 所有 `enterpriseCheck` 查询增加 `entity_type` 字段。
- 匹配命中时，同时写入 `enterpriseAbbreviation` 和 `entityTypeFromEnterpriseCheck`。
- 后续 `enterpriseInfo` 查询：
  - 若命中：仍用 `enterpriseInfo` 的 `entity_type`、`project_abbreviation` 覆盖。
  - 若未命中或异常：用 `entityTypeFromEnterpriseCheck` 兜底，避免出现「有简称、无 entity_type」的情况。

## 修复后效果

- 新榜、企业公众号来源的新闻，在重新分析后，只要能匹配到企业并得到简称，`entity_type` 会与 `enterprise_abbreviation` 同源，不再出现「简称有值、entity_type 为空」的不一致。

## 已存在脏数据的修复（可选）

若库中已有「entity_type 为空且 enterprise_abbreviation 不为空」的记录，可按下面步骤修复：

1. **查出现有异常数据**（示例）：

```sql
SELECT id, title, enterprise_full_name, enterprise_abbreviation, entity_type
FROM news_detail
WHERE delete_mark = 0
  AND (enterprise_abbreviation IS NOT NULL AND enterprise_abbreviation != '')
  AND (entity_type IS NULL OR entity_type = '');
```

2. **按企业全称回填 entity_type**（请根据实际表结构、字段名调整）：

```sql
UPDATE news_detail n
INNER JOIN invested_enterprises e
  ON e.enterprise_full_name = n.enterprise_full_name
  AND e.delete_mark = 0
SET n.entity_type = e.entity_type
WHERE n.delete_mark = 0
  AND (n.enterprise_abbreviation IS NOT NULL AND n.enterprise_abbreviation != '')
  AND (n.entity_type IS NULL OR n.entity_type = '');
```

执行前建议先 `SELECT` 确认影响行数，并在测试环境验证。

## 修改文件清单

- `news/server/routes/newsAnalysis.js`：重新分析接口的 wechat_account / account_name 匹配逻辑。
- `news/server/utils/newsAnalysis.js`：`processNewsWithEnterprise` 中 `enterpriseCheck` 与 `enterpriseInfo` 的配合及 `entity_type` 兜底逻辑。
