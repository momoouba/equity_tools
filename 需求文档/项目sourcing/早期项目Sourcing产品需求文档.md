# 早期项目 Sourcing 产品需求文档（第一步落地版）

## 一、背景与目标

本阶段目标是基于“国际集团投融资数据接口”构建项目挖掘最小可用闭环，先完成数据入库与分析输出，再支撑页面展示。

- 业务目标：

  - 抓取最新市场融资信息，形成统一结构化数据资产。

  - 基于融资数据持续识别热门赛道、重点投资主体偏好及市场趋势。

  - 形成日报、周报、月报的自动化分析与投递能力。

  - 通过这些信息找到不同赛道的潜在标的公司，给投资经理增加项目拓展渠道

- 本次范围（第一步）：

  - 接口取数与入库。

  - 定时分析（日/周/月）。

  - 大模型配置与系统现有 AI 配置一致化。

  - onepage 前端页面信息架构设计。

---

## 二、范围边界（第一步）

### 2.1 In Scope

1. 对接 `国际集团投融资接口.MD` 定义的接口并完成本地入库。  

2. 设计“原始层 + 标准层 + 分析层”三层数据结构。  

3. 建立三类定时分析任务：

   - 每日：新融资简报。

   - 每周一：上周市场行情分析。

   - 每月最后一天：当月市场动向总结。

4. 新增“项目挖掘”应用能力，模型调用与“系统配置 > AI模型配置管理”中对应的应用配置的模型一致。

5. 设计 onepage 页面内容、筛选、卡片、榜单、明细与导出能力。

### 2.2 Out of Scope（后续阶段）

- 多数据源并行融合（除国际集团接口外）。

- 复杂研报生成、PPT 自动化输出。

- 投资决策自动推荐引擎。

---

## 三、应用与权限（新增应用：项目挖掘）

### 3.1 应用注册

- 新增应用名称：`项目挖掘`

- 建议固定 `app_id`：`2026050600000000001`（19 位）

- 用途：隔离“项目挖掘”收件配置、模型配置、分析任务与日志。

### 3.2 权限与角色

- `admin`：可配置接口、配置模型、手动同步、查看全量分析日志、编辑任务。

- 普通用户：可查看 onepage 与分析结果，不可修改系统配置。

---

## 四、数据架构与表单拆分设计

> 原则：配置层复用系统已有配置表（不新建 `sourcing_data_source_config`）；表 1-1（接口类型）复用 `news_interface_config`，表 1-2（爬虫类型）复用 `listing_data_config`；表 2-1 先落接口明细；表 2 再做标准化汇总；表 3/4 承接分析与任务留痕。

### 4.1 配置层（管理员配置）

在“系统配置 > 融资信息源配置”Tab 维护，任务执行时动态读取。该 Tab 区分两种类型的数据源：
- **接口类型**（如国际集团投融资接口，复用 `news_interface_config` 的配置逻辑）
- **爬虫类型**（未来扩展，复用 `listing_data_config` 的配置逻辑）

两种数据源共用同一套同步执行日志表 `listing_sync_execution_log`，无需新建。

---

#### 4.1.1 接口类型 → 复用 `news_interface_config` 表

- **表名：**`news_interface_config`（系统已有，仅扩展 `interface_type` 枚举值）
- **新增枚举值：**`shanghai_international_financing`（上海国际集团-投融资接口）
- **作用：**存储接口地址、鉴权凭证、Content-Type、定时表达式、最后同步时间等
- **凭证配置（X-App-Id / APIkey 等）：**走已存在的 `shanghai_international_group_config` 表（按应用 ID 关联），与新闻侧上海国际集团配置共用。
- **使用方法：**在“系统配置 > 融资信息源配置”中新增一条配置，`interface_type` 选 `shanghai_international_financing`，填写 `request_url`、`api_key` 等字段，系统执行任务时动态读取。
- **已有字段结构（复用，不需新增）：**`id`（VARCHAR(19) PK）、`app_id`、`interface_type`、`request_url`、`content_type`、`api_key`、`cron_expression`、`skip_holiday`、`last_sync_time`、`last_sync_date`、`is_active`、`is_deleted`、`created_at`、`updated_at`

**字段使用说明：**
- `frequency_type`/`frequency_value`：**已废弃**，融资接口同步统一使用 `cron_expression` 控制定时任务
- `send_frequency`/`send_time`：用于定时任务触发时刻配置，融资接口建议 `send_frequency='daily'`，`send_time='08:00:00'`
- `weekday`/`month_day`：**融资场景不使用**，可为空
- `entity_type`：**融资场景不需要**，可为空

> 详细字段结构参见系统已有 DDL：`news_interface_config`。与新闻接口配置完全同构，仅通过 `interface_type` 区分。

⚠️ 变更要求：在 `interface_news_type_enabled` 表中为 `shanghai_international_financing` 接口类型预置 `news_type` 行（如 `'融资信息'`，`is_enabled=1`），确保前端下拉选项可正常加载。

---

**DDL 变更清单（建表后执行）：**

```sql
-- 1. 为融资信息接口类型预置 news_type 行
INSERT INTO interface_news_type_enabled (id, interface_type, news_type, is_enabled)
SELECT
  CONCAT(DATE_FORMAT(NOW(), '%Y%m%d%H%i%s'), '00001'),
  'shanghai_international_financing',
  '融资信息',
  1
FROM dual
WHERE NOT EXISTS (
  SELECT 1 FROM interface_news_type_enabled
  WHERE interface_type = 'shanghai_international_financing' AND news_type = '融资信息'
);

-- 2. 为爬虫类型预置（第二步启用时执行）
-- INSERT INTO interface_news_type_enabled ... interface_type='sourcing_crawler' ...
```

执行时机：建表完成后、首次加载配置页前。

---
#### 4.1.2 爬虫类型 → 复用 `listing_data_config` 表

- **表名：**`listing_data_config`（系统已有，扩展 `news_interface_type` 子类型枚举值）
- **作用：**存储爬虫类型数据源的配置，包括名称、子类型、请求地址、Cron 表达式、最早同步日期、节假日跳过、执行状态等
- **使用方式：**在“系统配置 > 融资信息源配置”中新增一条爬虫类型配置，直接沿用 `listing_data_config` 的现有字段，不新增表结构。
- **当前阶段（第一步）不启用爬虫类型，**仅预留下拉选项（子类型如 `sourcing_crawler`），为后续多数据源融合做准备。

> 详细字段结构参见系统已有 DDL：`listing_data_config`（VARCHAR(19) PK、`name`、`interface_type`('crawler'|'api')、`request_url`、`min_sync_date`、`cron_expression`、`skip_holiday`、`ifind_*`（融资场景一般不启用）、`status`、`is_active`、`news_interface_type`、`created_at`、`updated_at` 等）。

---

#### 4.1.3 同步执行日志 → 复用 `listing_sync_execution_log` 表

- **表名：**`listing_sync_execution_log`（系统已有，DDL 中可扩展表注释为“上市进展&项目挖掘同步执行日志”）
- **作用：**记录每次手动/定时同步的执行记录，含窗口区间、去重命中、新增/更新/跳过数量、执行状态、滚动过程日志、错误摘要
- **与上市数据配置共用，无需新建。**

---

#### 4.1.4 凭证配置 → 复用 `shanghai_international_group_config` 表

- **表名：**`shanghai_international_group_config`（系统已有）
- **作用：**存储上海国际集团接口的 X-App-Id、APIkey、每日查询限制等鉴权凭据。
- **按应用 ID（`app_id`）关联 `applications` 表，“项目挖掘”应用共用同一套凭证。**
- **若后续新增其他接口类型的数据源（非上海国际集团），**可参照 `qichacha_config` 模式新增对应的凭证配置表。当前第一步不涉及。

### 4.2 标准层（DWD）

**表 2：`sourcing_financing_event`（融资事件标准表）**

- 作用：由 `sourcing_financing_event_w_infer` 提取、清洗、标准化后形成统一分析主表（一条融资事件一行）。

- 字段设计（必须包含字段注释）：

| 字段名 | 类型 | 字段注释 |
|---|---|---|
| `id` | bigint PK | 主键ID |
| `source_record_id` | bigint | 来源明细ID，关联 `sourcing_financing_event_w_infer.id` |
| `event_id` | varchar(64) | 融资事件ID（funding_id） |
| `event_date` | date | 融资日期（Asia/Shanghai） |
| `company_name` | varchar(255) | 被投机构名称 |
| `company_credit_code` | varchar(64) | 被投机构唯一识别码 |
| `project_name` | varchar(255) | 项目名称 |
| `project_desc` | text | 项目简介 |
| `latest_round` | varchar(100) | 项目最新融资轮次（cp_round） |
| `round` | varchar(100) | 融资轮次（w_infer推测口径） |
| `funding_amt_raw` | varchar(100) | 原始融资金额字符串 |
| `estimated_amt_raw` | varchar(100) | 原始预估融资金额字符串 |
| `post_valuation_raw` | varchar(100) | 原始投后估值字符串 |
| `amount` | decimal(20,2) | 解析后的金额数值（原币种） |
| `amount_currency` | varchar(20) | 金额币种 |
| `amount_cny` | decimal(20,2) | 折算人民币金额 |
| `amount_parse_status` | varchar(20) | 金额解析状态：parsed/estimated/unparsed |
| `amount_parse_confidence` | decimal(5,2) | 金额解析置信度（0-1） |
| `industry_source_lv1` | varchar(100) | 来源一级行业标签（接口原始：xn_ic_lv1） |
| `industry_source_lv2` | varchar(100) | 来源二级行业标签（接口原始：xn_ic_lv2） |
| `industry_std_lv1` | varchar(100) | 标准一级行业（内部行业字典映射后） |
| `industry_std_lv2` | varchar(100) | 标准二级行业（内部行业字典映射后） |
| `track_primary` | varchar(100) | 主赛道（业务分析口径） |
| `track_secondary` | varchar(100) | 子赛道（业务分析口径） |
| `track_keywords` | varchar(500) | 赛道关键词（逗号分隔） |
| `business_tags` | varchar(500) | 业务标签（如AI、机器人、半导体等） |
| `scenario_tags` | varchar(500) | 应用场景标签（如金融、医疗、制造等） |
| `competition_bucket` | varchar(100) | 竞争分层（头部/腰部/长尾/新进入） |
| `competitor_companies` | text | 主要竞争对手企业列表（JSON字符串） |
| `competitor_count` | int | 识别出的竞争对手数量 |
| `market_heat_score` | decimal(10,4) | 赛道热度评分（0-100） |
| `industry_match_confidence` | decimal(5,2) | 行业赛道分类置信度（0-1） |
| `classification_version` | varchar(50) | 分类规则/模型版本号 |
| `classification_source` | varchar(20) | 分类来源：rule/llm/hybrid |
| `classification_status` | varchar(20) | 分类状态：pending/filling/checking/verified/failed |
| `classification_retry_count` | int | 分类重试次数（最大3次） |
| `investor_names` | text | 投资主体列表（JSON字符串） |
| `lead_investor` | varchar(255) | 领投方（可空） |
| `region_country` | varchar(100) | 国家/地区（reg_rgn） |
| `region_province` | varchar(100) | 省（reg_prov） |
| `region_city` | varchar(100) | 市（reg_city） |
| `region_county` | varchar(100) | 区县（reg_cnty） |
| `funding_status` | varchar(100) | 融资状态 |
| `source_create_time` | datetime | 源端创建时间（Asia/Shanghai） |
| `source_update_time` | datetime | 源端更新时间（Asia/Shanghai） |
| `is_deleted` | tinyint | 逻辑删除标记：0未删除，1已删除 |
| `created_at` | datetime | 创建时间（Asia/Shanghai） |
| `updated_at` | datetime | 更新时间（Asia/Shanghai） |
- 索引建议：

  - `idx_event_date(event_date)`

  - `idx_track(track_primary, track_secondary)`

  - `idx_company(company_name)`

- 表注释（必须）：`项目挖掘-融资事件标准表（统一分析口径）`

#### 行业/赛道/竞争对手分类规则（强制）

1. **分类字段必须在表2沉淀**

   - 表2作为后续分析唯一主表，必须提前沉淀行业、赛道、竞品、标签与置信度字段，禁止只在查询时临时计算。

2. **分类生成优先级**

   - 一级：接口原始标签（`xn_ic_lv1/xn_ic_lv2`）直接映射到 `industry_source_lv1/2`。

   - 二级：通过内部行业字典映射生成 `industry_std_lv1/2`。

   - 三级：规则引擎 + 大模型补齐生成 `track_primary/track_secondary/competitor_*`。

   - 若规则与模型冲突，按“规则优先，模型补充”，并记录 `classification_source='hybrid'`。

3. **竞品识别最小要求**

   - 至少输出 `competitor_companies`（JSON数组）和 `competitor_count`。

   - 无法识别时允许为空，但必须保留 `industry_match_confidence` 与 `classification_version`。

4. **可追溯要求**

   - 每次分类产出必须记录 `classification_version`、`classification_source`，支持后续重算与回溯。

5. **状态机与重试（强制）**

   - 分类任务状态机固定为：`pending -> filling -> checking -> verified/failed`。

   - 同一记录最多循环 3 次（`classification_retry_count <= 3`）。

   - 超过3次仍不准确，置为 `failed`，保留最后一次结果与完整日志，不再自动重试。

#### 金额与估值文本标准化规则（强制）

为处理 `funding_amt_raw` / `estimated_amt_raw` / `post_valuation_raw` 中的文本金额（如“6000万左右”“6000万美元”“未披露”），统一采用以下算法口径：

1. **原文保留**

   - 原始文本必须完整保留在 `*_raw` 字段，不覆盖原文。

2. **文本清洗**

   - 去除空格、逗号、中文顿号等分隔符。

   - 识别模糊词：`约`、`左右`、`超`、`近`、`逾`、`+`。

3. **数值与单位识别**

   - 支持单位：`元/万元/亿/美元/万美元/亿美元` 等。

   - 示例：

     - `6000万左右` -> 数值 `6000`，单位 `万人民币`（默认人民币）

     - `6000万美元` -> 数值 `6000`，单位 `万美元`

4. **币种推断**

   - 文本包含“美元/USD/US$” -> `amount_currency='USD'`。

   - 文本包含“人民币/CNY/元/万/亿（无美元语义）” -> `amount_currency='CNY'`。

   - 无法判断时 -> `amount_currency='UNKNOWN'`，并标记为 `unparsed` 或 `estimated`。

5. **数值换算**

   - `amount` 存“原币种绝对值”，如 `6000万美元` -> `60000000.00`（USD）。

   - `amount_cny` 按任务执行日汇率折算（若汇率不可用可降级为最近可用汇率并记日志）。

**汇率数据配置：**
- **来源：**系统每日外汇牌价接口或汇率配置表
- **获取时机：**每日定时任务执行前从缓存读取当日汇率，缓存失效则实时拉取
- **降级策略：**若当日汇率不可用，降级使用最近 7 日内可用汇率，并在日志中记录降级事件
- **配置方式：**后续可在"系统配置"中新增汇率数据源配置（当前第一步暂用固定汇率或手动配置）

6. **模糊金额处理**

   - 含“约/左右/近/超”等模糊词，`amount_parse_status='estimated'`，并写入 `amount_parse_confidence`（建议 0.6~0.85）。

   - 明确数值且单位完整，`amount_parse_status='parsed'`（建议置信度 >=0.9）。

   - “未披露/保密/—/N/A”等不可解析，`amount`、`amount_cny` 置空，`amount_parse_status='unparsed'`，置信度=0。

7. **估值字段同规则**

   - `post_valuation_raw` 使用同一套解析算法，后续如需结构化可扩展 `post_valuation` / `post_valuation_cny` 字段。

8. **样本库与准确率阈值（验收口径）**

   - 首周上线后自动沉淀金额解析样本，并由业务/产品人工标注形成固定样本库，样本量不少于 200 条。

   - 第二周起按固定样本库执行回归验收，阈值如下：

     - 币种识别准确率 >= 95%

     - 可解析金额命中率 >= 90%

     - 金额单位换算正确率 >= 90%

   - 连续两次低于阈值时，触发降级策略：暂停自动分类补齐写入，仅保留原始字段与日志，待规则修复后恢复。

### 4.3 明细层（接口取数落表）

**表 2-1：`sourcing_financing_event_w_infer`（含烯牛推测轮次）**

- 作用：存储接口 `Data.deal_info_w_infer` 明细，作为表 2 的直接来源。

- 字段设计（必须包含字段注释）：

| 字段名 | 类型 | 字段注释 |
|---|---|---|
| `id` | bigint PK | 主键ID |
| `request_id` | varchar(64) | 本次接口请求流水号（RequestId） |
| `query_type` | varchar(32) | 查询方式：queryByCode/queryByDate/fuzzyQuery |
| `proj_cd_xn` | varchar(100) | 项目烯牛编码 |
| `proj_id_xn` | bigint | 项目烯牛ID |
| `instn_id_xn` | bigint | 被投机构烯牛ID |
| `instn_idtfn_cd` | varchar(64) | 被投机构唯一识别码 |
| `instn_nm` | varchar(255) | 被投机构名称 |
| `reg_rgn` | varchar(100) | 被投机构所在国家或地区 |
| `reg_prov` | varchar(100) | 被投机构所在省 |
| `reg_city` | varchar(100) | 被投机构所在市 |
| `reg_cnty` | varchar(100) | 被投机构所在区 |
| `proj_nm` | varchar(255) | 项目名称 |
| `proj_desc` | text | 项目简介 |
| `cp_round` | varchar(100) | 项目最新融资轮次 |
| `xn_ic_lv1` | varchar(100) | 一级行业标签（烯牛） |
| `xn_ic_lv2` | varchar(100) | 二级行业标签（烯牛） |
| `funding_id` | varchar(64) | 融资事件ID |
| `funding_dt` | datetime | 融资日期时间（Asia/Shanghai） |
| `round` | varchar(100) | 融资轮次（烯牛推测） |
| `funding_amt` | varchar(100) | 获投金额（原始文本） |
| `estmt_funding_amt` | varchar(100) | 预估融资金额（原始文本） |
| `post_valuation` | varchar(100) | 投后估值（原始文本） |
| `funding_sts` | varchar(100) | 事件状态 |
| `inv_info_json` | longtext | 投资方信息JSON数组（inv_info） |
| `create_time` | datetime | 源端创建时间（Asia/Shanghai） |
| `update_time` | datetime | 源端更新时间（Asia/Shanghai） |
| `ingested_at` | datetime | 本地入库时间（Asia/Shanghai） |
| `record_hash` | varchar(64) | 明细记录哈希（幂等去重） |
- 表注释（必须）：`项目挖掘-融资事件明细（含推测轮次）`

### 4.4 分析层（DWS/ADS）

**表 3：`sourcing_analysis_snapshot`（分析快照）**

- 作用：按日/周/月保存分析结论，支持页面与邮件复用。

- 字段设计（必须包含字段注释）：

| 字段名 | 类型 | 字段注释 |
|---|---|---|
| `id` | bigint PK | 主键ID |
| `analysis_type` | varchar(20) | 分析类型：daily/weekly/monthly |
| `period_start` | date | 分析窗口开始日期（Asia/Shanghai） |
| `period_end` | date | 分析窗口结束日期（Asia/Shanghai） |
| `snapshot_date` | date | 快照生成日期（Asia/Shanghai） |
| `summary_text` | longtext | 市场分析摘要文本 |
| `hot_tracks_json` | longtext | 热门赛道分析结果（JSON） |
| `investor_track_json` | longtext | 投资主体赛道偏好结果（JSON） |
| `financing_overview_json` | longtext | 融资概览结果（JSON） |
| `llm_model_config_id` | varchar(50) | 使用的大模型配置ID |
| `llm_prompt_version` | varchar(50) | 使用的提示词版本 |
| `status` | varchar(20) | 快照状态：success/failed/partial |
| `created_at` | datetime | 创建时间（Asia/Shanghai） |
- 表注释（必须）：`项目挖掘-日周月分析快照表`

**表 4：`sourcing_analysis_task_log`（任务执行日志）**

- 作用：任务追踪、失败排查、重试管理。

- 字段设计（必须包含字段注释）：

| 字段名 | 类型 | 字段注释 |
|---|---|---|
| `id` | bigint PK | 主键ID |
| `task_type` | varchar(20) | 任务类型：sync/daily/weekly/monthly |
| `trigger_mode` | varchar(20) | 触发方式：cron/manual |
| `window_start` | datetime | 任务处理窗口开始时间（Asia/Shanghai） |
| `window_end` | datetime | 任务处理窗口结束时间（Asia/Shanghai） |
| `input_count` | int | 输入记录数 |
| `insert_count` | int | 新增记录数 |
| `update_count` | int | 更新记录数 |
| `skip_count` | int | 跳过记录数 |
| `status` | varchar(20) | 执行状态：success/failed/running |
| `error_message` | text | 错误信息摘要 |
| `started_at` | datetime | 开始执行时间（Asia/Shanghai） |
| `finished_at` | datetime | 结束执行时间（Asia/Shanghai） |
| `classification_duration_ms` | int | 分类补齐耗时（毫秒），从入库到 verified/failed 的时长 |
- 表注释（必须）：`项目挖掘-接口同步与分析任务执行日志`

**SLA 监控方案：**
- 每日定时统计 `classification_duration_ms` 的 P99 值
- 若连续 2 日 P99 > 30分钟（1800000ms），触发告警并通知运维人员
- 监控报表可在"系统配置 > 任务监控"中查看

### 4.5 建表注释规范（强制）

1. 所有新增表必须包含 `COMMENT`（中文业务含义）。  

2. 所有字段必须包含列级 `COMMENT`（不可为空）。  

3. 索引需按功能命名并补充注释说明（在设计文档中标注索引用途）。  

4. 与时间相关字段必须在注释中写明时区口径：`Asia/Shanghai`。  

5. JSON/Text 字段必须在注释中注明结构来源（例如：`来自国际集团接口 Data.deal_info_w_infer`）。  

---

## 七、接口入库需求（步骤 1：必须先落地）

### 7.1 数据同步流程

1. 调用“国际集团投融资查询接口”获取数据。  

2. 将 `Data.deal_info_w_infer` 写入 `sourcing_financing_event_w_infer`。  

3. 按字段映射规则从 `sourcing_financing_event_w_infer` 提取并汇总转写 `sourcing_financing_event`（统一标准口径）。  

4. 基于业务唯一键进行幂等更新（建议：`funding_id + company + funding_dt` 标准化后）。  

5. 写入同步执行日志 `listing_sync_execution_log`（复用系统已有表，与上市数据配置共用）。  

### 7.2 字段映射模板（按国际集团接口）

| 接口字段（国际集团） | 标准字段（本系统） | 说明 |
|---|---|---|
| `funding_id` | `event_id` | 事件唯一标识，主键去重核心字段 |
| `funding_dt` | `event_date` | 日期统一 `Asia/Shanghai` |
| `instn_nm` | `company_name` | 被投机构名称 |
| `instn_idtfn_cd` | `company_credit_code` | 被投机构唯一识别码 |
| `proj_nm` | `project_name` | 项目名称 |
| `proj_desc` | `project_desc` | 项目简介 |
| `cp_round` | `latest_round` | 项目最新融资轮次 |
| `round` | `round` | 融资轮次（仅采用 `deal_info_w_infer` 推测口径） |
| `xn_ic_lv1` | `industry_source_lv1` | 来源一级行业标签（接口原始） |
| `xn_ic_lv2` | `industry_source_lv2` | 来源二级行业标签（接口原始） |
| `funding_amt` | `funding_amt_raw` | 原始金额字符串 |
| `estmt_funding_amt` | `estimated_amt_raw` | 预估金额字符串 |
| `post_valuation` | `post_valuation_raw` | 投后估值字符串 |
| `funding_sts` | `funding_status` | 事件状态 |
| `inv_info[].inv_nm` | `investor_names` | 投资主体列表（JSON） |
| `reg_rgn/reg_prov/reg_city/reg_cnty` | `region_*` | 区域结构化字段 |
| `create_time` | `source_create_time` | 源端创建时间 |
| `update_time` | `source_update_time` | 源端更新时间 |
> **说明：**`track_primary`/`track_secondary` 不直接从接口字段映射，由分类规则引擎或大模型从 `industry_source_lv1/lv2` 推断生成，并记录 `classification_source` 与 `classification_version`。

> 说明：以上字段来自 `国际集团投融资接口.MD`，后续若集团接口新增字段，需在“融资信息源配置 + 字段映射”同步变更。

### 7.3 同步策略

- 定时增量：默认抓“前一日 + 当日补偿”窗口。

- 手动同步：支持选择时间区间。

- 幂等要求：重复同步不产生重复事件。

- 失败重试：指数退避最多 5 次，超限写失败日志并告警。

- 分类补齐链路 SLA：从明细入库到分类终态（`verified/failed`）的时延要求为 **`P99 <= 30分钟`**。

---

## 八、定时分析需求（日/周/月）

### 8.1 每日分析（日报）

- 触发时点：每天 08:30（`Asia/Shanghai`）。

- 时间窗口：昨日 00:00:00 - 23:59:59。

- 输出内容：

  - 新增融资事件数、总金额、平均单笔金额。

  - TOP 热门赛道（按事件数 + 金额双维度）。

  - 重点投资主体昨日动向。

  - 当日异常点（大额/跨境/密集赛道）。

### 8.2 每周分析（周报）

- 触发时点：每周一 09:00。

- 时间窗口：上周一 - 上周日。

- 输出内容：

  - 市场行情概览（数量、金额、轮次结构）。

  - 热门赛道变化（较前一周环比）。

  - 投资主体赛道偏好图谱（机构维度）。

  - 代表案例（可追溯到明细事件）。

### 8.3 每月分析（月报）

- 触发时点：每月最后一天 18:00。

- 时间窗口：当月 1 日 - 当月最后一天。

- 输出内容：

  - 月度市场动向总结（结构化 + 文本总结）。

  - 热门赛道趋势（与上月对比）。

  - 机构活跃度榜单。

  - 融资概览与风险提示。

---

## 九、大模型调用规范（必须与系统配置一致）

### 9.1 配置来源

- 统一读取“系统配置 > AI模型配置管理”生效配置。

- 不允许在“项目挖掘”模块硬编码模型、API Key、Endpoint。

### 9.2 应用类型扩展

- 在 `ai_model_config` 的 `application_type` 中新增：

  - `project_sourcing_analysis`（项目挖掘分析）

  - `listing_progress_analysis`（上市进展分析，供后续复用）

### 9.3 提示词与模型绑定

- 提示词配置走“模型提示词设置”。

- 任务执行时记录：

  - `llm_model_config_id`

  - `prompt_type`

  - `prompt_version`

- 失败降级：若主模型失败，可按系统规则切换备用模型，并在日志中留痕。

---

## 十、onepage 页面设计（项目挖掘）

### 10.1 页面目标

在一个页面内让用户快速看到“最新市场融资 + 热门赛道 + 投资主体偏好 + 周月总结”。

### 10.2 页面模块

1. **顶部筛选区**

   - 时间范围（日/周/月/自定义）

   - 赛道筛选

   - 投资主体筛选

   - 数据来源筛选

2. **核心概览卡片**

   - 融资事件数

   - 融资总金额

   - 活跃赛道数

   - 活跃投资主体数

3. **热门赛道榜**

   - 按融资事件数排行

   - 按融资金额排行

   - 支持环比箭头（较上周期）

4. **投资主体赛道分析**

   - 选中投资主体后展示其 TOP 赛道分布

   - 最近投资事件明细

5. **融资概览明细表**

   - 企业、赛道、轮次、金额、投资主体、时间

   - 支持导出

6. **AI 分析结论区**

   - 日报/周报/月报摘要

   - 关键结论标签（趋势、机会、风险）

### 10.3 onepage 数据可见性口径（强制）

- onepage 页面仅展示 `classification_status in ('verified','failed')` 且 `is_deleted=0` 的记录。

- `pending/filling/checking` 状态记录不展示、不参与页面聚合统计。

- 页面不展示中间状态标签，用户看到的是系统最终落库结果。

---

## 十一、接口与任务清单（第一步）

### 11.1 后端接口建议

- `POST /api/sourcing/sync`：手动同步接口数据（支持时间区间）

- `GET /api/sourcing/events`：融资事件分页查询

- `POST /api/sourcing/analyze/daily`：触发日报分析

- `POST /api/sourcing/analyze/weekly`：触发周报分析

- `POST /api/sourcing/analyze/monthly`：触发月报分析

- `GET /api/sourcing/onepage`：onepage 聚合查询

> 统一口径要求：上述查询与分析接口在统计层统一过滤 `classification_status in ('verified','failed') AND is_deleted=0`。

### 11.2 定时任务

- `sourcing_sync_daily`：接口数据同步

- `sourcing_analysis_daily`：日报分析

- `sourcing_analysis_weekly`：周报分析（周一）

- `sourcing_analysis_monthly`：月报分析（月末）

---

## 十二、验收标准（第一步）

1. 可以从国际集团投融资接口拉取并入库，重复执行无重复脏数据。  

2. 配置层、明细层、标准层、分析层表结构完整，字段可追溯。  

3. 日报、周报、月报按时生成，失败有日志可查。  

4. 模型调用严格走系统 AI 配置，配置变更后无需改代码即可生效。  

5. onepage 可展示“最新融资、热门赛道、投资主体赛道分析、融资概览、分析摘要”。  

6. 所有新增表与字段均有中文注释（DDL 可审计）。  

7. 管理员可在“融资信息源配置”Tab 中查看接口凭证状态、Cron 表达式与最近同步时间。  

8. 所有时间口径统一 `Asia/Shanghai`。  

9. 分类任务状态机、重试上限与失败留存生效：`pending -> filling -> checking -> verified/failed`，最多3次。  

10. 分类补齐时效满足 **`P99 <= 30分钟`**。  

11. onepage、API、日报/周报/月报使用统一过滤口径：`classification_status in ('verified','failed') AND is_deleted=0`。  

12. 金额解析样本库不少于 200 条，并满足阈值：币种识别准确率 >=95%、可解析金额命中率 >=90%、单位换算正确率 >=90%。  

---

## 十三、上线顺序与回滚

### 13.1 上线顺序

1. 建表与索引。  

2. 接口同步与入库。  

3. 分析任务与日志。  

4. onepage 页面接入。  

5. 定时任务启用。  

### 13.2 回滚方案

- 关闭定时任务开关。  

- 页面降级为“仅明细查询”。  

- 保留原始数据，不做物理删除。  

- 回滚到上一个稳定版本的接口与分析逻辑。  

---

## 十四、待确认项（需产品补齐）

1. `投融资查询接口.docx` 的完整字段字典（字段名、类型、是否必填、示例值）。  

2. “赛道”口径是否采用固定字典（一级/二级）还是动态归类。  

3. 投资主体别名归并规则（同机构不同写法如何合并）。  

4. 日/周/月报告投递对象与模板格式。  

5. onepage 是否需要“分享链接”与“导出权限”控制。  

