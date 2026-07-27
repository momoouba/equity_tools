# Stage 3 优先行业批摸底报告

> 生成时间：2026-07-07 04:30:37  
> schema：`structured_schema_v1`  
> 范围：**自 2025-01-01** 融资事件 · **三大类** `ai` / `bio` / `semi_mfg`（半导体与先进制造合并）

## 1. 融资池（去重企业）

| category_4 | 企业数 | 待 structured | 有产品简介 | 已有 structured |
|------------|--------|---------------|------------|-----------------|
| ai | 4526 | 3173 | — | — |
| bio | 3289 | 2374 | — | — |
| semi_mfg | 7982 | 5253 | — | — |
| **合计** | **15797** | **10800** | **9070**（57.51%） | **4971** |

### semi_mfg 子轨（待处理）

| sub_track | 企业数 |
|-----------|--------|
| semi | 0 |
| advanced_mfg | 5253 |

## 2. 投前项目（三大类内）

| 指标 | 值 |
|------|-----|
| 三大类内项目 | 6 |
| 待 structured | 0 |
| 有简介/BP 上下文 | 6 |

## 3. 推荐执行顺序

```bash
cd news
npm run report:priority-batch-scope
npm run backfill:financing-structured -- --dry-run --limit=20
npm run backfill:financing-structured -- --category=ai,bio,semi_mfg --limit=100
npm run backfill:pre-investment-structured -- --limit=20
```

## 4. 说明

- **三大类** = 优先赛道；`other` 不在 Stage 3 批处理范围。
- `semi_mfg` 映射层合并；L3 层用 `sub_track` 区分半导体 / 先进制造。
- 时间窗默认 `2025-01-01`；仅处理窗口内有事件的企业，画像/百科结果 **fan-out 反向填充** 至该企业全部历史行。
- structured 抽取需要 `ai_product_intro` / BP 等上下文 ≥ 40 字；无简介企业需先完成画像 enrich 或百科。
