---
name: smart-git-push
description: 所有已提交变更推送到 equity_tools；仅当本次待推送范围内存在「新闻域」相关文件时，再推送到 equity_news（origin）。支持按路径/关键词识别，避免误推或漏推。
---

# 智能 Git 分仓推送 (Smart Git Push)

## When to Use

- 用户说「分仓推送 Git」「按新闻分仓推送」「smart-git-push」等，需要按远程分流推送时
- **必须遵守的口径（与用户对齐）**
  1. **全部**：当前分支上需要同步的提交，**一律**先推送到 **`equity_tools`**（`git push equity_tools HEAD`）。
  2. **新闻域**：仅当「本次要推送的那一批提交」里，**存在任一文件**命中下方 **§新闻域识别规则** 时，**再**推送到 **`origin`（equity_news）**（`git push origin HEAD`）。
  3. 若本批提交**无任何**新闻域文件：**不得**执行 `git push origin HEAD`，并在摘要中写明「已跳过 equity_news」。

## Workflow（执行顺序固定）

0. **先提交工作区改动（必须）**：执行 `git status`；若存在未暂存/未提交的本地修改，**必须先完成 commit**，再进入后续推送步骤。不得在有工作区改动时直接推送并报告「已是最新」。用户未指定 commit message 时，根据 `git diff` 拟定符合仓库风格的说明；用户要求「一并提交」时，将当前工作区相关改动全部纳入本次 commit。
1. **确认待推送范围**：通常为 `HEAD` 相对于 `equity_tools/<当前分支>` 多出的提交。
2. **枚举本批提交涉及的所有文件路径**：例如  
   `git log equity_tools/<branch>..HEAD --name-only --pretty=format: | sort -u`  
   若本地未跟踪 `equity_tools` 分支，可用 `git log -1 --name-only` 仅判断最近一次提交，或与用户确认范围。
3. **新闻域判定**：任一路径命中 §规则 → `need_equity_news=true`。
4. **推送**（顺序建议：先 tools，再按需 news）  
   - **总是**：`git push equity_tools HEAD`  
   - **仅当** `need_equity_news`：`git push origin HEAD`  
5. **输出摘要**：列出推送到各远程的结果；若跳过 `origin`，写明原因（本批无新闻域文件）。

## 新闻域识别规则（命中任一即需推 equity_news）

### A. 本仓库约定（与 equity_news 上线包同源）

以下 **路径前缀** 视为新闻域（`news` 应用前后端及同仓内新闻侧文档）：

- `news/client/`
- `news/server/`
- `news/文档/`、`news/舆情`、`news/企查查新闻`、`news/新闻舆情`

### B. 历史清单（舆情核心模块，与 A 重叠的仍算一条）

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

### C. 关键词（路径或文件名中包含即视为新闻域，不分大小写）

- 新闻、舆情、企查查、同花顺订阅、微信公众号、额外公众号
- 企业管理、企业监控、舆情监控对象、舆情信息、新闻接口、新闻详情、新闻分享
- scheduledNewsSync、newsAnalysis、additionalAccounts、externalDb

### D. 不因此推 equity_news（仅 tools / 工具侧）

以下通常 **只** 需要 `equity_tools`，**不**因单独修改而要求 `origin`：

- `.cursor/`（含 skills、rules 等编辑器侧配置）
- `docs/agents/`（Agent 配置文档）
- `news-backup-*/` 及分支 **`backup`** 上的归档提交
- 明确仅属于另一产品、且不在 `news/` 下的目录（若仓库中有）

> 若单次 commit **同时** 含 `news/` 下文件与 `.cursor/` 仅工具文件，仍应 **`need_equity_news=true`**（因有新闻域变更）。

## 推送命令

```bash
# 1) 总是：全量同步到 equity_tools
git push equity_tools HEAD

# 2) 条件：仅当本批提交含新闻域文件时
git push origin HEAD
```

## 执行步骤（给 Agent）

1. `git status`：**若有未提交改动，先 `git add` + `git commit` 全部纳入本次推送**（用户未给 message 则根据 diff 自拟；勿跳过此步）。
2. 用 `git log equity_tools/<branch>..HEAD` + `--name-only` 列出待推送提交涉及的路径，按 §规则计算 `need_equity_news`。
3. 执行 `git push equity_tools HEAD`。
4. 若 `need_equity_news`：执行 `git push origin HEAD`；否则打印「跳过 origin（equity_news）：本批无新闻域文件」。
5. 若推送失败（认证、冲突、分支不存在），说明原因并停止；**不要** `push --force` 到 `main/master`，除非用户明确要求。

## 输出示例

**含 news 目录改动的提交：**

```
✓ 待推送提交涉及文件中含 news 域 → 将推送 equity_news
→ git push equity_tools HEAD  … ok
→ git push origin HEAD        … ok
```

**仅 .cursor 或仓库根文档、无 news/：**

```
✓ 本批无 news 域路径 → 跳过 equity_news（origin）
→ git push equity_tools HEAD  … ok
```

## 常见场景

- **场景 1**：只改 `news/server/...` → **两个远程都推**
- **场景 2**：只改 `.cursor/skills/...` → **只推 equity_tools**
- **场景 3**：混合 `news/` + 需求文档根目录 → 若需求文档路径命中关键词或 `docs/*新闻*` 等 → **两个都推**；否则仅 **news 部分**已足以 `need_equity_news=true` 若同 commit 含 `news/`

- **场景 4**：分支 **`backup`** 或仅 `news-backup-*/` → **只推 equity_tools**（见 `docs/agents/backup-branch.md`）

## 注意事项

- `origin` → `equity_news`，`equity_tools` → `equity_tools`；推送的是**当前分支 HEAD**，不是按文件拆 commit。
- 两个远程的同一分支名应对应同一套提交历史；**漏推 origin** 会导致 news 环境缺 commit，**误推无关 commit 到 origin** 一般可接受但应尽量少用 skill 外手工强推。
- 如遇到冲突，先本地解决再推送。
