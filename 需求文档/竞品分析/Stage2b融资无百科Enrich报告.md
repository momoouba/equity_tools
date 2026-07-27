# Stage 2b 融资无百科 Enrich 报告

> 生成时间：2026-07-25 13:31:06  
> 版本：`financing_web_enrich_v1` · 触发：`batch_no_baike_enrich`  
> 范围：**自 2025-01-01** · 三大类 · `baike_lemma_status=not_found`  
> dry-run：true · mode：dashscope_batch · LLM：false · model=qwen3.6-flash · batch=200 in-flight=2

## 1. 候选规模

| 指标 | 值 |
|------|-----|
| 全池无词条且无简介 | 0 |
| 本次处理 | 0 |
| ai / bio / semi_mfg（全池） | 0 / 0 / 0 |
| ai / bio / semi_mfg（本次） | 0 / 0 / 0 |

## 2. 执行结果

| 指标 | 值 |
|------|-----|
| 跨表 donor 命中 | 0（fan-out 行 0） |
| 融资池 AI donor 复用 | 0 |
| DashScope Batch 批次数 | — |
| Batch 提交 LLM 条数 | 0 |
| LLM 成功（简介≥20字） | 0（0.0%） |
| LLM 空结果 | 0 |
| LLM 失败 | 0 |
| 达 Structured 门槛（≥40字） | 0 |
| 未执行 LLM（dry/无 --with-llm） | 0 |

## 3. 抽检样本（≥5%）

| 企业 | 赛道 | 简介字数 | profile_source | 状态 |
|------|------|----------|----------------|------|
| — | — | — | — | — |

## 4. 说明

- Batch 模式**不含联网搜索**（DashScope Batch 限制）；试点 chat+search 质量更高，Batch 适合全量补齐。
- `profile_source=llm_web` 表示低置信联网生成（§6.6）。

## 5. 下一步

```bash
cd news
npm run backfill:financing-profile-enrich -- --with-llm --mode=dashscope_batch --since=2025-01-01
npm run backfill:financing-structured -- --mode=dashscope_batch --model=qwen3.6-flash --batch-size=100 --since=2025-01-01 --category=ai,bio,semi_mfg --in-flight=1
```
