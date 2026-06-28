---
name: smart-git-push
description: 所有已提交变更推送到 equity_tools；仅当本次待推送范围内存在「新闻域」相关文件时，再推送到 equity_news（origin）。备份走 backup 分支且只推 equity_tools。按当前分支角色（release/clean、sync-issue-*、main、backup）选择推送目标与上游。
---

# 智能 Git 分仓推送 (Smart Git Push)

## When to Use

- 用户说「分仓推送 Git」「按新闻分仓推送」「smart-git-push」等
- 用户说「推送备份」「备份分仓推送」等，且涉及 `news-backup-*/` 或 **`backup`** 分支
- 用户在 **`release/clean`**、**`sync-issue-5849a`** 等功能分支上完成提交后需要推送

## 远程与仓库

| 远程 | 仓库 | 用途 |
|------|------|------|
| `equity_tools` | `momoouba/equity_tools` | **全部分支、全部提交**均先推此处（含工具侧、`.cursor/`、需求文档、备份） |
| `origin` | `momoouba/equity_news` | **仅新闻域运行时**部署包；按 commit 内是否含 `news/` 等路径决定是否推送 |

## 分支结构（2026-06 起）

执行推送前 **必须先识别当前分支角色**：

| 分支 | 角色 | 典型内容 | 推 `equity_tools` | 推 `origin` |
|------|------|----------|-------------------|-------------|
| **`release/clean`** | **干净生产线**（自 `main` 切出，仅 `news/` + `leadingpage/` 运行时与部署资产；无 `.cursor/`、无 POC/备份代码） | 文档归档、打新日历等生产改动 | **总是** | **本批含新闻域则推**；推荐作为 **equity_news 部署跟踪分支** |
| **`sync-issue-5849a`** | **全量功能开发**（业绩看板、竞品分析、`.cursor/`、`需求文档/` 等） | 日常功能迭代 | **总是** | **本批含新闻域则推** |
| **`sync-issue-5849a-no-performance`** | 实验变体（无业绩看板） | 试验性裁剪 | **总是** | **本批含新闻域则推** |
| **`main`** | 历史基线 | 旧主线；与 `origin/main` 可能大幅分叉 | 按需 | **谨慎**；非默认部署分支，除非用户明确要求推 main |
| **`backup`** | 快照归档 | `news-backup-YYYYMMDD/` 整包 | **仅** `equity_tools backup` | **禁止** |

### 分支关系（Agent 需知晓）

```
main (d8aabb7 基线)
 ├── release/clean     ← 生产干净线（2+ commits：同步生产目录、文档归档…）
 └── sync-issue-5849a  ← 全量开发（main 之上 ~140 commits，含业绩看板等）

backup                ← 独立历史，仅 equity_tools，含 news-backup-20260618/
```

- **`release/clean` 与 `sync-issue-5849a` 历史分叉**：不要用 `git merge sync-issue-5849a` 把实验/工具文件合进 clean；应 **`git checkout sync-issue-5849a -- news/ leadingpage/`** 或 cherry-pick **仅生产相关** commit。
- **`release/clean` 首次推送**需建立上游：`git push -u equity_tools release/clean`；若本批含新闻域，再 `git push -u origin release/clean`。

## 必须遵守的口径

1. **全部**：当前分支待推送提交 **一律** 先推 **`equity_tools`**（`git push equity_tools HEAD` 或 `git push equity_tools <分支名>`）。
2. **新闻域**：仅当「本批待推送 commit 涉及文件」中 **任一** 命中 **§新闻域识别规则** 时，**再** 推 **`origin`**（`git push origin HEAD`）。
3. 本批 **无** 新闻域文件：**不得** `git push origin HEAD`；摘要写明「已跳过 equity_news（origin）」。
4. **备份**：仅在 **`backup`** 分支提交 `news-backup-*/` → **只** `git push equity_tools backup`，**永不** `origin`。
5. **仅改 `.cursor/` / 根目录 `需求文档/`**（无 `news/`）：**只** `equity_tools`，不推 `origin`（`release/clean` 上通常不会出现 `.cursor/` 提交）。

## Workflow（执行顺序固定）

0. **先提交工作区改动（必须）**：`git status`；有未提交改动则先 `commit`，再推送。不得在工作区脏时直接推送并报告「已是最新」。
1. **判定推送类型**：
   - 当前分支为 **`backup`**，或意图为备份 → **§备份分支推送**，结束。
   - 当前分支为 **`release/clean`** → **§干净生产线推送**（仍走新闻域判定，但默认建议推 `origin` 以更新部署仓）。
   - 否则 → **§常规分仓推送**（步骤 2–6）。
2. **确认待推送范围**：`git log equity_tools/<当前分支>..HEAD`；若远程无该分支，用 `git log -1 --name-only` 或 `git log origin/<分支>..HEAD`（若已设 upstream）。
3. **枚举本批文件路径**：
   ```bash
   git log equity_tools/<branch>..HEAD --name-only --pretty=format: | sort -u
   ```
4. **新闻域判定** → `need_equity_news`（规则见下；`news-backup-*/` **不计入**）。
5. **推送**（先 tools，再按需 news）：
   ```bash
   git push equity_tools HEAD
   # 若远程尚无该分支：
   # git push -u equity_tools HEAD

   # 仅当 need_equity_news：
   git push origin HEAD
   # 若远程尚无该分支（如 release/clean 首次）：
   # git push -u origin HEAD
   ```
6. **输出摘要**：各远程结果；跳过 `origin` 时写明原因；注明当前分支角色（clean / 全量开发 / backup）。

## §干净生产线推送（`release/clean`）

在常规分仓流程之上，额外遵守：

1. **默认意图**：推送到 `origin` 即更新 **equity_news 生产部署** 所用干净分支；只要本批含 `news/` 变更，**应推 `origin`**（与全量开发分支规则相同，不是「可选」）。
2. **本批仅 `news/文档/` 移动/归档**：仍算新闻域（路径前缀 `news/文档/`）→ **推 `origin`**。
3. **本批仅 `leadingpage/`**：**不**触发 `origin`（非新闻应用包）→ 只推 `equity_tools`。
4. **勿将** `需求文档/`、`.cursor/`、`scripts/competitor-embedding-poc/` 等提交到 `release/clean`；若误提交且仅含这些路径 → 只推 `equity_tools`。
5. **与 `sync-issue-5849a` 同步生产代码**（用户要求时，Agent 可执行，非每次推送必做）：
   ```bash
   git checkout release/clean
   git checkout sync-issue-5849a -- news leadingpage .gitignore
   # 再按 release/clean 规范删除 POC/备份/SSL 等，commit 后 smart-git-push
   ```

## §备份分支推送（`backup` 专用）

约定见 `docs/agents/backup-branch.md`（全量开发分支上；`release/clean` 不含该文件亦可读 skill 本节）。

### 何时走备份流程

- 用户要求「提交/推送备份」
- 工作区存在新的 `news-backup-YYYYMMDD/`
- 当前在 **`backup`** 分支且有待推送 commit

### 步骤

1. 确认快照目录 `news-backup-YYYYMMDD/`；**不要**在 `release/clean`、`sync-issue-*` 上 track 该目录（`.gitignore` 已忽略，仅 `backup` 分支 track）。
2. 清理 Windows `**/nul` artifact（若存在）。
3. `git checkout backup` && `git pull equity_tools backup`
4. `git add news-backup-YYYYMMDD/` && commit（若有改动）
5. **仅** `git push equity_tools backup` — **禁止** `origin`
6. 切回原工作分支

新建快照（Windows）：`robocopy news news-backup-YYYYMMDD /E /XD node_modules .git`

## 新闻域识别规则（命中任一 → `need_equity_news=true`）

### A. 路径前缀（与 equity_news 上线包同源）

- `news/client/`
- `news/server/`
- `news/文档/`、`news/舆情`、`news/企查查新闻`、`news/新闻舆情`

### B. 历史清单（与 A 重叠仍有效）

- `news/client/src/pages/NewsInfo.jsx`、`EnterpriseManagement.jsx`、`NewsConfig.jsx`
- `news/server/routes/news.js`、`newsShare.js`、`newsDetail.js`、`newsAnalysis.js`
- `news/server/utils/newsAnalysis.js`、`scheduledNewsSyncTasks.js`
- `news/server/routes/additionalAccounts.js`、`externalDb.js`

### C. 关键词（路径或文件名，不分大小写）

- 新闻、舆情、企查查、同花顺订阅、微信公众号、额外公众号
- 企业管理、企业监控、舆情监控对象、舆情信息、新闻接口、新闻详情、新闻分享
- scheduledNewsSync、newsAnalysis、additionalAccounts、externalDb

### D. 不因此推 `origin`（仅 `equity_tools`）

- `.cursor/`（skills、rules）
- `docs/agents/`（若存在于当前分支）
- 仓库根 `需求文档/`（全量开发分支）
- `news-backup-*/` 及 **`backup`** 分支全部提交
- `scripts/competitor-embedding-poc/` 等 POC（**不应**出现在 `release/clean`）
- `leadingpage/`（落地页配置，非 news 应用包）
- 明确属于其他产品且不在 `news/` 下的目录

> 单次 commit **同时**含 `news/` 与 `.cursor/` → 仍 **`need_equity_news=true`**。

## 推送命令速查

```bash
# 常规 / release/clean / sync-issue-*
git push equity_tools HEAD
# 仅当 need_equity_news：
git push origin HEAD

# 首次建立上游（以 release/clean 为例）
git push -u equity_tools release/clean
git push -u origin release/clean   # 仅当 need_equity_news

# 备份（仅此一条，永不 origin）
git push equity_tools backup
```

## 执行步骤（Agent — 常规 / clean 分支）

1. `git status` → 有改动则先 commit。
2. 识别当前分支 → `backup` / `release/clean` / 其他。
3. `git fetch equity_tools`（可选）；计算 `equity_tools/<branch>..HEAD` 文件列表 → `need_equity_news`。
4. `git push equity_tools HEAD`（无 upstream 则 `-u`）。
5. 若 `need_equity_news`：`git push origin HEAD`（无 upstream 则 `-u`）；否则打印跳过原因。
6. 推送失败则说明原因并停止；**不要**对 `main`/`master` `push --force`，除非用户明确要求。

## 输出示例

**`release/clean` 含 `news/server/` 改动：**

```
✓ 分支 release/clean（干净生产线）→ 本批含 news 域
→ git push equity_tools HEAD              … ok
→ git push origin HEAD                    … ok（更新 equity_news 部署跟踪分支）
```

**`sync-issue-5849a` 仅改 `.cursor/skills/`：**

```
✓ 分支 sync-issue-5849a（全量开发）→ 本批无 news 域
→ git push equity_tools HEAD              … ok
→ 已跳过 origin（equity_news）：本批无新闻域文件
```

**`release/clean` 仅改 `leadingpage/`：**

```
✓ 分支 release/clean → leadingpage 非新闻域
→ git push equity_tools HEAD              … ok
→ 已跳过 origin
```

**`backup` 分支：**

```
✓ 备份归档 → 仅 equity_tools/backup，跳过 origin
→ git push equity_tools backup            … ok
→ 已切回 release/clean
```

## 常见场景

| 场景 | 分支 | equity_tools | origin |
|------|------|--------------|--------|
| 生产修复/文档归档上线 | `release/clean` | ✓ | ✓（含 `news/`） |
| 业绩看板 + 新闻同 commit | `sync-issue-5849a` | ✓ | ✓（含 `news/`） |
| 仅竞品 POC / `.cursor` | `sync-issue-5849a` | ✓ | ✗ |
| 整包快照 | `backup` | ✓ backup | ✗ |
| 落地页 nginx/ssl 模板 | `release/clean` | ✓ | ✗ |

## 注意事项

- 推送的是 **当前分支 HEAD** 的 commit 集合，不是按路径拆 push。
- **`release/clean` 与 `sync-issue-5849a` 可同名不同 commit**；部署 equity_news 时以 **`release/clean`** 为准（用户已明确要干净分支时）。
- **漏推 origin** 会导致 news 服务器缺 commit；**误推** 非 news 专用 commit 到 origin 应尽量避免，故保留新闻域判定。
- **不要** `git merge backup` 进功能分支或 `release/clean`。
- 冲突先本地解决再推送。
