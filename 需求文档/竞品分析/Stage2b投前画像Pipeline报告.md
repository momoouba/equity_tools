# Stage 2b 投前画像 Pipeline 报告

> 生成时间：2026-07-25 13:52:24  
> 版本：`pre_investment_project_web_enrich_v1`  
> 近 **3** 年投前项目 | dry-run：true | LLM：false

| 指标 | 值 |
|------|-----|
| 待 enrich 项目 | 0 |
| 已有画像跳过 | 12 |
| donor 命中项目 | 0 |
| donor fan-out 行 | 0 |
| 无 donor | 0 |
| LLM 成功 | 0 |
| LLM 失败 | 0 |

## 推荐执行顺序

1. `npm run backfill:pre-investment-baike-lookup`（或 `--mode=browser`）
2. `npm run backfill:pre-investment-profile-enrich`
3. 仍有缺口时：`npm run backfill:pre-investment-profile-enrich -- --with-llm`
