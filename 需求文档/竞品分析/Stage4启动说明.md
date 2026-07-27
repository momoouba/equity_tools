# Stage 4 启动说明

> 生成时间：2026-07-14  
> 状态：**召回骨架 + 策略接线已落地；主开关默认关闭（可回滚）**

## 已完成

| 项 | 说明 |
|----|------|
| `recallFromListedNewShare` | 与 `mapIpoRow` 同构；`source=ipo_new_share` |
| `mergeRecalledCandidates` | §8.1.1：new_share 行业优先 + richness 富者覆盖；不丢 `is_listed` |
| 配置开关 | `use_new_share_listed_recall`（默认 0）、`enable_recall_ab_compare`、`new_share_gray_categories` |
| Runner | `buildInternalRecallPool`；S1 step_log 可写 `ab_compare` |
| 策略插件 | `industry-strategies/`（ai / bio / semi_mfg / other）；`attachStrategyToTarget` |
| 策略接线 | S0 解析 `category_4`；S2 `adjustRuleScore`；S3/S5 Prompt 附录；POC 同路径 |
| POC | `npm run poc:stage4-recall-compare` → [Stage4召回对比POC报告.md](./Stage4召回对比POC报告.md) |

## POC 快照

| 来源 | 候选数 |
|------|--------|
| ipo_project（1.0） | **899** |
| ipo_new_share | **5541**（约 **6.2×**） |
| 双源合并 | **6440** |

上市召回量相对 1.0 显著提升，符合 §9.3 方向。

## 当前开关状态（2026-07-14）

| 开关 | 值 |
|------|-----|
| `enable_recall_ab_compare` | **1（已开）** |
| `use_new_share_listed_recall` | **0（主路径仍为 ipo_project）** |
| `new_share_gray_categories` | 空 |

投前跑竞品后，看 S1 `step_log.detail.ab_compare`（primary vs alt 数量与 overlap）。关闭 A/B：系统配置页或 `PUT` 将该字段置 `false`。

## 默认行为（安全）

- **`use_new_share_listed_recall = 0`**：线上仍走 1.0 `ipo_project` 主召回
- 关开关即可回滚；**无需回滚画像数据**

## 建议灰度步骤

1. ~~开 A/B（不切主路径）~~ → **已开**
2. 单赛道灰度：`use_new_share_listed_recall=1` + `new_share_gray_categories=ai`（目标须带赛道 hint）
3. 确认无异常后清空 `new_share_gray_categories` 全量开主开关

管理员 API / 前端：

- `GET/PUT /api/system/competitor-recall-source-config`
- 系统配置页：竞品三源召回（含 A/B、new_share 主路径开关）

## 策略接线

- **解析**：显式字段 → 行业映射表 → 融资池信用代码 → 启发式 → `other`
- **Prompt / 规则加分压分**：仅抽象维度（形态、服务对象、交付层）；**禁止细分赛道定向词表**；形态分=目标自身产品线/标签对候选的软匹配
- **竞争透镜**：单条发起前「确认对标焦点」（勾选 + **可编辑描述** + 自定义关键词）；确认后版本落库；重跑默认带回上次；批量用上次/默认焦点
- **LLM 池**：形态对齐高的融资池未上市可保送；上市≥3 配额保留
- S0/S2 step_log 写入 `strategy_id` / `industry_category_4` / `sub_track` / `competition_lens.version`

## 尚未做（后续迭代）

- 金标准案例测评（仍按 D11 暂缓）；建议用「未来不远」在**确认家庭/C端透镜**后重跑验证
- 灰度确认后切主召回（见上步骤 2～3）
- 创始人图谱 / 月更早期具身池（进一步追平金标所需）
