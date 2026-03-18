---
name: smart-git-push
description: 自动化将新闻相关推送到equity_news，所有更新推送到equity_tools。支持智能识别新闻相关文件、自动分仓推送、避免遗漏或重复推送。
---

# 智能 Git 分仓推送 (Smart Git Push)

## When to Use

- 在执行 `git commit` 之后，需要按文件路径自动分流推送到不同远程仓库
- 新闻舆情相关改动 → 推送到 `origin` (equity_news)
- 其他所有改动（业绩看板、系统配置、数据库迁移、通用工具等） → 推送到 `equity_tools`
- 后续每次推送都会自动执行相同规则，无需手动指定目标仓库

## Workflow

1. **检测变更文件**：识别本次提交涉及的文件路径
2. **识别新闻相关文件**：基于路径前缀/文件名/内容关键词判定是否属于新闻舆情域
3. **自动分仓推送**：
   - 只要包含任何新闻相关文件的提交 → 同时推送到 `origin` (equity_news)
   - 不论是否包含新闻相关文件的提交 → 推送到 `equity_tools`
4. **输出日志**：清晰展示推送到每个远程的文件列表，便于审计

## 新闻舆情相关识别规则

以下路径（前缀）视为「新闻舆情」相关：

- `news/client/src/pages/NewsInfo.jsx`
- `news/client/src/pages/EnterpriseManagement.jsx`
- `news/client/src/pages/NewsConfig.jsx`
- `news/server/routes/news.js`
- `news/server/routes/newsShare.js`
- `news/server/routes/newsDetail.js`
- `news/server/routes/newsAnalysis.js`
- `news/server/utils/newsAnalysis.js`
- `news/server/utils/scheduledNewsSyncTasks.js`
- `news/server/routes/additionalAccounts.js`
- `news/server/routes/externalDb.js`
- `news/企查查新闻*`
- `news/新闻舆情*`
- `news/舆情*`
- `docs/*新闻*.md`
- `docs/*舆情*.md`

包含以下关键词的文件也视为「新闻舆情」相关（不分路径）：

- 新闻、舆情、企查查、同花顺订阅、微信公众号、额外公众号
- 企业管理、企业监控、舆情监控对象、舆情信息、新闻接口、新闻详情、新闻分享
- scheduledNewsSync、newsAnalysis、additionalAccounts、externalDb

## 推送命令

假设当前分支为 `sync-issue-5849a`：

```bash
# 推送到 equity_news（仅当存在新闻相关改动）
git push origin HEAD

# 推送到 equity_tools（总是推送）
git push equity_tools HEAD
```

## 执行步骤

每次需要推送时，执行以下操作：

1. 在 Cursor 中调用本 skill（输入："按新闻相关文件分仓推送"）
2. 该 skill 将：
   - 扫描 `git status` 和 `git diff --cached`
   - 识别新闻相关文件
   - 自动执行 `git push origin HEAD` 和 `git push equity_tools HEAD`
   - 输出推送结果摘要

## 输出示例

```
✓ 检测到 5 个文件变更
✓ 识别到 3 个新闻相关文件：
  - news/server/routes/news.js
  - news/server/utils/scheduledEmailTasks.js
  - news/企查查新闻特殊网站正文提取说明.md

✓ 执行分仓推送：
  → equity_news: 推送到 origin/sync-issue-58-head (3 个新闻相关文件)
  → equity_tools: 推送到 equity_tools/sync-issue-5849a (5 个文件)

推送完成！
```

## 常见场景

- **场景 1**：仅修改新闻相关文件 → 推送到 equity_news 和 equity_tools
- **场景 2**：仅修改业绩看板/系统配置 → 仅推送到 equity_tools
- **场景 3**：混合修改（新闻 + 业绩看板 + 系统配置） → 推送到 equity_news 和 equity_tools

## 注意事项

- 确保远程仓库已正确配置（`origin` → equity_news，`equity_tools` → equity_tools）
- 确保当前分支在两个远程仓库中都存在
- 如遇到冲突，需要先解决冲突后再推送
- 推送前建议先执行 `git status` 确认预期变更