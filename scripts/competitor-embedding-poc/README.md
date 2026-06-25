# Step 4 Embedding 离线 POC

量化 S2 bigram 规则 vs 向量语义召回，对照黄金集 IM 标注，输出 recall@K 报告。

关联文档：`需求文档/竞品分析/竞品分析优化-20260622.md` Step 4；`smoke-test-golden-set.md` §13.7。

## 1. 导出候选池（需 MySQL + news/.env）

在 `news` 目录：

```bash
node server/scripts/runEmbeddingPoc.js export
```

可选：

```bash
# 只跑部分主体
node server/scripts/runEmbeddingPoc.js export --subjects 2026062414483000001,2026061614420000001

# 环境变量
set COMPETITOR_POC_USER_ID=你的用户F_Id   # 融资池召回权限
set COMPETITOR_POC_OUT=..\..\scripts\competitor-embedding-poc\data\pool.json
```

输出：`data/pool.json`（S1 全池 + S2 分数 + LLM 池标记 + IM 关键词）。

## 2. 跑 Embedding 评测

**推荐（BGE-M3，Node + HF 镜像）** — 在 `news` 目录：

```powershell
$env:HF_ENDPOINT="https://hf-mirror.com"
node server/scripts/runEmbeddingPocBge.mjs
```

**Python 基线**（无 torch 时用 bigram；Python 3.14 下 torch/onnx DLL 可能失败）：

```bash
python scripts/competitor-embedding-poc/run_embedding_poc.py --backend bigram
python scripts/competitor-embedding-poc/run_embedding_poc.py --backend bge-m3  # 需 sentence-transformers
```

输出：

- `data/report.json` — 机器可读
- `data/report.md` — 人读报告

## 3. 指标说明

| 方法 | 含义 |
|------|------|
| **规则 Top-20** | `internal_score` 排序前 20（S2 主通道） |
| **LLM 池** | `buildLlmScoringPool` 并集（规则 Top + 标签/赛道补充） |
| **Embedding Top-20** | 主体/候选 `product_intro+tags` 向量 cosine Top-20 |

正样本：黄金集 `direct` + `same_track` 关键词（见 `golden-set.json`）。

**Step 4b 准入**（与优化文档一致）：宏平均 recall 提升 ≥15%，或 Embedding 补救漏召 ≥3 项。

## 5. S1.5 小步 POC（Step 4b）

将 BGE-M3 **Top-30** 与当前 LLM 池做 **并集**，测 recall 是否高于基线 5/30：

```powershell
$env:HF_ENDPOINT="https://hf-mirror.com"
node server/scripts/runEmbeddingPocS15.mjs
# 可选：node server/scripts/runEmbeddingPocS15.mjs --embed-top 30
```

输出：`data/report-s15.json`、`data/report-s15.md`

**S1.5 结论（2026-06-25）**：recall 5/30→5/30，池 20→~47，**不建议生产集成**。

## 6. 文件

| 文件 | 说明 |
|------|------|
| `golden-set.json` | 5 个 smoke 主体 + IM 关键词 |
| `data/pool.json` | Node 导出（gitignore 建议） |
| `data/report-bge-m3.*` | BGE-M3 Step 4 报告 |
| `data/report-s15.*` | S1.5 并集 POC 报告 |
