# Stage 2 已上市同步报告

> 生成时间：2026-07-25 13:11:51  
> 脚本：`syncListedFinancingFromNewShare.js`  
> 版本：`listed_sync_v1`  
> 模式：**写入** | 企业范围：融资全量去重 | force：false

## 1. 同步结果（企业维度）

| 指标 | 值 |
|------|-----|
| 去重企业数 | 217357 |
| matched（可同步） | 5531（2.54%） |
| unknown（待复核） | 14（0.01%） |
| no_match | 211812（97.45%） |
| **关联成功率（matched/企业）** | **2.54%** |

## 2. 事件行写入

| 指标 | 值 |
|------|-----|
| 融资事件总行数 | 428198 |
| IPO 类事件行数 | 36054 |
| 画像同步/将同步事件行 | 19839 |
| 跳过画像覆盖（受保护 profile_source） | 0 |
| 标记 unknown 事件行 | 0 |
| 标记 no_match 事件行 | 0 |

## 3. matched 命中方式

| match_method | 企业数 | 占比 |
| --- | --- | --- |
| no_match | 211812 | 97.45% |
| credit_code | 5320 | 2.45% |
| name_exact | 186 | 0.09% |
| stock_code | 25 | 0.01% |
| stock_code_ambiguous | 6 | 0.00% |
| credit_code_ambiguous | 6 | 0.00% |
| name_exact_ambiguous | 2 | 0.00% |

## 4. 同步后融资表快照

| listing_status | 事件行数 |
| --- | --- |
| (null) | 380671 |
| no_match | 27635 |
| matched | 19875 |
| unknown | 17 |

| 画像字段 | 填充行数 / 总行数 |
|----------|-------------------|
| profile_source=listed_sync | 19819 / 428198 |
| ai_product_intro 非空 | 65122 / 428198 |
| industry_category_4 非空 | 427860 / 428198 |

## 5. 验收对照（§9.2）

| 指标 | 目标 | 本次 |
|------|------|------|
| listed 同步成功率（可关联子集） | ≥ 85% | matched 企业占比 2.54%（IPO 去重口径） |
| profile_source 可追溯（listed_sync） | 100% matched 子集 | 见上表 |

## 6. 说明

- **上市真值**：`ipo_new_share` 沪深北主档（5624 行）
- **同步字段**：listing_status、listed_stock_code、listed_exchange、new_share_row_id、profile_source=listed_sync、company_intro、ai_product_intro、tags、industry_category_4；ai_enrich_status=skipped
- **unknown 队列**：名称 fuzzy / 多候选，不自动写画像；需人工或规则二次匹配
- 烯牛行业 → category_4：另跑 `npm run backfill:financing-category4-stage2`
