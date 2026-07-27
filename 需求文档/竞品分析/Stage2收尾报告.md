# Stage 2 收尾报告

> 生成时间：2026-07-02  
> 范围：融资池画像、已上市识别、投前 pipeline、烯牛→category_4  
> 关联需求：`优化改进2.0需求.md` §6

## 1. 收尾动作执行清单

| 动作 | 命令 | 状态 | 说明 |
|------|------|------|------|
| 已上市画像同步（matched） | `sync:listed-financing-stage2` | ✅ 已完成（2026-07-01） | 5340 企业 / 19605 事件行 `listed_sync` |
| listing 状态补标 | `sync:listed-financing-stage2 -- --marks-only --mark-unknown --mark-no-match` | ✅ 本次完成 | 避免与百科批跑争锁；`no_match` 事件行 +16518 |
| 烯牛→category_4 | `backfill:financing-category4-stage2` | ✅ 已就绪 | 非 listed_sync 行此前已回填；本次待处理 0 |
| JOIN 摸底 | `report:listed-join` | ✅ 已更新 | 见 `listed_JOIN摸底报告.md` |
| L1 映射覆盖 | `report:industry-l1-coverage` | ✅ 已更新 | 见 `库内行业映射覆盖率报告.md` |
| 融资百科查词（近 3 年） | `backfill:financing-baike-lookup --mode=browser` | 🔄 后台进行中 | 全量 ~42001 企业，见 §4 |
| 投前画像 | BP 主源 + 兜底 LLM | ✅ 已完成 | 近 3 年 10/10 有画像 |

## 2. 已上市同步（核心指标）

| 指标 | 值 |
|------|-----|
| IPO 类去重企业 | 13,755 |
| matched（可 listed_sync） | **5,340**（38.82%） |
| unknown（待复核） | 12 企业 / 17 事件行 |
| no_match | 8,403 企业；事件行含本次补标后 **27,642** |
| 融资事件总行数 | 428,072 |
| `profile_source=listed_sync` | 19,605 行 |
| `industry_category_4` 非空 | 427,861 / 428,072（**99.95%**） |

详细报告：`Stage2已上市同步报告.md`、`listed_JOIN摸底报告.md`

### 验收说明（§9.2）

- **matched 占比 38.82%** 是「融资 IPO 类企业 → new_share 池」口径，**不是** new_share 池内覆盖率（后者约 **96%**）。
- unknown 队列（~145 家 fuzzy/多候选）需人工或规则二次匹配，不自动写画像。

## 3. 投前 pipeline

| 项 | 状态 |
|----|------|
| 数据源优先级 | **BP 为主**（最全最准）；百科/donor/LLM 仅兜底 |
| 近 3 年项目画像覆盖 | **10 / 10** |
| 无 BP 缺口 | 清昴智能 — 已 LLM 补全 |
| 批处理 enrich | 有 BP 的项自动跳过，无需全量跑 |

报告：`Stage2b投前画像Pipeline报告.md`

## 4. 融资百科查词（Stage 2b，并行）

| 项 | 值 |
|----|-----|
| 近 3 年去重企业 | 42,044 |
| 本次待跑 | 42,001（断点续跑跳过已查词） |
| 模式 | browser + CDP |
| 进度 | 见 `Stage2b融资百科查词运行.log` |

百科结果 fan-out 至该企业**全部历史融资行**；`listed_sync` 行只写百科元数据，不覆盖上市主档画像。

## 5. 行业映射

**优先赛道为三大类**（`category_4`）：`ai` 数字智能 · `bio` 生物医药 · `semi_mfg` 半导体&先进制造（半导体与先进制造**合并为一类**）。其余烯牛 L1 归入 `other`，不算优先赛道第四类。

| 指标 | 值 |
|------|-----|
| 事件命中优先赛道（ai/bio/semi_mfg） | **61.88%** |
| 信用代码事件级填充 | **100%** |

报告：`库内行业映射覆盖率报告.md`

## 6. Stage 2 出口判断

| 子项 | 是否达标 | 备注 |
|------|----------|------|
| 已上市 listed_sync | ✅ | 主路径 5340 企业已同步 |
| listing_status 标记 | ✅ | matched / unknown / no_match 已落库 |
| category_4 | ✅ | 99.95% 行有值 |
| 投前 readiness | ✅ | 当前样本全量有画像 |
| 融资百科全量 | ⏳ | 挂机批跑，不阻塞 Stage 3 设计 |

## 7. 下一步（Stage 3）

1. ~~定 **优先行业批**（**三大类** × 近 3 年融资去重企业：`ai` / `bio` / `semi_mfg`）~~ → 见 `Stage3优先行业批摸底报告.md`（**31,426** 企业）
2. ~~冻结 `structured_schema_v1` 值域~~ → `structuredSchemaV1.js`
3. 百科/画像补全后跑融资 structured（当前仅 **17.4%** 有产品简介，可先跑有简介子集）
4. 投前 structured：**8/8 已完成**（三大类内）

## 8. 运维备注

- 百科 browser 批跑与融资表写入并发时，listed 全量 sync 可能死锁；补标请用 `--marks-only`。
- 补标脚本已加死锁重试与小批量 chunk（80）。
