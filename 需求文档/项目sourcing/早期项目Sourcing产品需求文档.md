# 早期项目 Sourcing 产品需求文档（第一步落地版）

> **修订记录**  
> - **2026-5-11**：增补融资标准表 **AI 增强（阶段 A）** 字段与流程；提示词与模型均走 **系统管理 → AI模型配置**。（§ 与章号以 **2026-5-16** 修订为准。）  
> - **2026-5-12**：已定稿联网方式（**模型原生联网**，如通义 **qwen-max**）、输入降级（信用代码为空时用名称/简称）、语言口径（外文名 + 中文描述）、**复用应用类型「项目挖掘分析」**；增补默认提示词（今 §12.10）；原「待澄清」条目后迁入 §12.11。后续开发以两版修订为准。  
> - **2026-5-13**：前端以列名后缀 **（AI）** 作合规提示；**产品简介(AI)** 与标签输出改为「具体产品类型 + 行业/场景检索向」，提示词排除工商、融资史、股东与上市类信息；标签明确为 **自有中文词组**（与内部赛道枚举无强制映射）。  
> - **2026-5-14**：融资事件列表增加 **「手动AI取数」** 按钮，支持选中 **单条** 记录触发 AI 增强并写回 `ai_*` 字段；补充 §12.8、§9.3、权限与接口约定。  
> - **2026-5-15**：融资信息 AI 增强补充 **触发与执行落库日志**（§12.12）；与手动/自动触发、§9.3 接口联动；验收与任务表同步更新。  
> - **2026-5-16**：**一级章节编号顺连续**（原「四」后跳「七」已消除：旧七～十一顺延为五～九；原「十二验收 / 十二点二 / 十二点三」顺延为十～十二；原十三～十四仍为十三～十四）。文内 **§ 引用** 已同步：原 `§12.3.x` → **`§12.x`**（例：§12.3.10 → §12.10）；原 `§11.3`（手动 AI 接口）→ **`§9.3`**；原 `§9.4`（AI 模型配置小节）→ **`§7.4`**；原「§十二点五-A」→ **`§10.1-A`**（第十章补充约定 A 节）。

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

- `admin`：可配置接口、配置模型、手动同步、**手动 AI 取数（融资事件单条）**、查看全量分析日志、**查看融资信息 AI 增强触发/执行日志（建议与管理员设置中日志入口一致）**、编辑任务。

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
| `ai_product_intro` | text | 入库后由大模型基于联网检索写入，**不覆盖**接口原文 `project_desc`；侧重**具体产品/产品线类型**（非工商沿革）。**前端列名**：`产品简介(AI)`（**2026-5-11 更新**，**2026-5-13 修订**） |
| `ai_company_tags_display` | varchar(2000) | **列表/前端列名**：`企业标签(AI)`；**自有中文词组**以顿号「、」拼接，偏行业/产品/场景检索与竞品对标，**不含**股东背景、上市进程等（**2026-5-11 更新**，**2026-5-13 修订**） |
| `ai_company_tags_json` | json | 与展示列同源的结构化词组，供「同类型产品公司 / 竞争对手」检索与阶段 B 匹配；键含义与输出约束见 **§12.10**（**2026-5-11 更新**，**2026-5-13 修订**） |
| `ai_enrich_status` | varchar(20) | AI 增强任务状态：`pending`/`running`/`success`/`failed`/`skipped`（**2026-5-11 更新**） |
| `ai_enrich_at` | datetime | 最近一次 AI 增强完成时间（Asia/Shanghai）（**2026-5-11 更新**） |
| `ai_enrich_model` | varchar(100) | 实际调用模型标识快照（便于审计，与配置可读名或 provider 模型 id 对齐）（**2026-5-11 更新**） |
| `ai_enrich_version` | varchar(50) | 提示词模板版本 / 管线版本号，支持按版本重算（**2026-5-11 更新**） |
| `ai_enrich_error` | varchar(500) | 最近一次失败摘要（可空，避免刷屏可截断）（**2026-5-11 更新**） |
- 索引建议：

  - `idx_event_date(event_date)`

  - `idx_track(track_primary, track_secondary)`

  - `idx_company(company_name)`

  - `idx_ai_enrich_status(ai_enrich_status, id)`（供异步任务扫描 pending 队列）（**2026-5-11 更新**）

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

## 五、接口入库需求（步骤 1：必须先落地）

### 5.1 数据同步流程

1. 调用“国际集团投融资查询接口”获取数据。  

2. 将 `Data.deal_info_w_infer` 写入 `sourcing_financing_event_w_infer`。  

3. 按字段映射规则从 `sourcing_financing_event_w_infer` 提取并汇总转写 `sourcing_financing_event`（统一标准口径）。  

4. 基于业务唯一键进行幂等更新（建议：`funding_id + company + funding_dt` 标准化后）。  

5. 写入同步执行日志：**当前实现**为 `news_sync_execution_log`（挂载 `news_interface_config`，与定时任务「新闻同步」日志同源）；文档其他处提到的 `listing_sync_execution_log` 为上市进展侧共用方案，投融资排查请以 **`news_sync_execution_log`** 为准（详见 §10.1-A）。

### 5.2 字段映射模板（按国际集团接口）

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

### 5.3 同步策略

- 定时增量：默认抓“前一日 + 当日补偿”窗口。

- 手动同步：支持选择时间区间。

- 幂等要求：重复同步不产生重复事件。

- 失败重试：指数退避最多 5 次，超限写失败日志并告警。

- 分类补齐链路 SLA：从明细入库到分类终态（`verified/failed`）的时延要求为 **`P99 <= 30分钟`**。

---

## 六、定时分析需求（日/周/月）

### 6.1 每日分析（日报）

- 触发时点：每天 08:30（`Asia/Shanghai`）。

- 时间窗口：昨日 00:00:00 - 23:59:59。

- 输出内容：

  - 新增融资事件数、总金额、平均单笔金额。

  - TOP 热门赛道（按事件数 + 金额双维度）。

  - 重点投资主体昨日动向。

  - 当日异常点（大额/跨境/密集赛道）。

### 6.2 每周分析（周报）

- 触发时点：每周一 09:00。

- 时间窗口：上周一 - 上周日。

- 输出内容：

  - 市场行情概览（数量、金额、轮次结构）。

  - 热门赛道变化（较前一周环比）。

  - 投资主体赛道偏好图谱（机构维度）。

  - 代表案例（可追溯到明细事件）。

### 6.3 每月分析（月报）

- 触发时点：每月最后一天 18:00。

- 时间窗口：当月 1 日 - 当月最后一天。

- 输出内容：

  - 月度市场动向总结（结构化 + 文本总结）。

  - 热门赛道趋势（与上月对比）。

  - 机构活跃度榜单。

  - 融资概览与风险提示。

---

## 七、大模型调用规范（必须与系统配置一致）

### 7.1 配置来源

- 统一读取“系统配置 > AI模型配置管理”生效配置。

- 不允许在“项目挖掘”模块硬编码模型、API Key、Endpoint。

### 7.2 应用类型扩展

- 在 `ai_model_config` 的 `application_type` 中新增：

  - `project_sourcing_analysis`（项目挖掘分析）

  - `listing_progress_analysis`（上市进展分析，供后续复用）

### 7.3 提示词与模型绑定

- 提示词配置走“模型提示词设置”。

- 任务执行时记录：

  - `llm_model_config_id`

  - `prompt_type`

  - `prompt_version`

- 失败降级：若主模型失败，可按系统规则切换备用模型，并在日志中留痕。

### 7.4 融资信息 AI 增强（阶段 A）— 配置与模型（**2026-5-11 更新**，**2026-5-12 修订**）

- **配置入口（强制）**：`系统管理` → `AI模型配置` → **模型提示词设置** 中新增/维护本任务专用提示词模板；**禁止**在业务代码中硬编码提示词正文。系统初始化时，应将 **§12.10** 默认提示词写入数据库（或与 `initPrompts` 等机制对齐），便于开箱与回归。

- **模型选择（强制）**：本任务调用的 Endpoint、模型名、API Key 等一律从 **`AI模型配置管理`**（`ai_model_config`）读取，与 §7.1 一致；**禁止**硬编码模型供应商或模型 ID。须选用支持 **模型原生联网搜索** 的型号（产品侧验证：**通义 qwen-max** 等；具体以采购与控制台可用能力为准）。

- **`application_type`（已定稿）**：**不复用新枚举**，与现有「AI模型配置管理」界面一致，本任务归属 **`project_sourcing_analysis`（项目挖掘分析）**（见 §7.2，界面文案「项目挖掘分析」）。同一应用类型下可配置多条模型记录时，通过 **主备/优先级** 或单独一条专用于「融资联网增强」的配置区分（实现细节由研发定，文档要求：**可读、可切换、可审计**）。

- **`prompt_type`（须新增）**：在「模型提示词设置」中新增独立类型，建议编码 **`project_sourcing_financing_web_enrich`**（与「项目挖掘分析」日报/聚合类 `prompt_type` 区分）；与一行提示词配置一一对应；任务执行时写入标准表 `ai_enrich_version`（可与 DB 提示词版本号或配置主键拼接规则一致）。

- **执行留痕**：任务完成后除更新 `sourcing_financing_event.ai_enrich_*` 外，建议将当次 `llm_model_config_id`、`prompt_type`、`prompt_version` 写入任务日志或标准表快照字段（与 §7.3 字段体系对齐），满足审计与重算需求。

---

## 八、onepage 页面设计（项目挖掘）

### 8.1 页面目标

在一个页面内让用户快速看到“最新市场融资 + 热门赛道 + 投资主体偏好 + 周月总结”。

### 8.2 页面模块

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

### 8.3 onepage 数据可见性口径（强制）

- onepage 页面仅展示 `classification_status in ('verified','failed')` 且 `is_deleted=0` 的记录。

- `pending/filling/checking` 状态记录不展示、不参与页面聚合统计。

- 页面不展示中间状态标签，用户看到的是系统最终落库结果。

---

## 九、接口与任务清单（第一步）

### 9.1 后端接口建议

- `POST /api/sourcing/sync`：手动同步接口数据（支持时间区间）

- `GET /api/sourcing/events`：融资事件分页查询

- `POST /api/sourcing/analyze/daily`：触发日报分析

- `POST /api/sourcing/analyze/weekly`：触发周报分析

- `POST /api/sourcing/analyze/monthly`：触发月报分析

- `GET /api/sourcing/onepage`：onepage 聚合查询

> 统一口径要求：上述查询与分析接口在统计层统一过滤 `classification_status in ('verified','failed') AND is_deleted=0`。

### 9.2 定时任务

- `sourcing_sync_daily`：接口数据同步

- `sourcing_analysis_daily`：日报分析

- `sourcing_analysis_weekly`：周报分析（周一）

- `sourcing_analysis_monthly`：月报分析（月末）

### 9.3 阶段 A 补充接口（融资信息 AI 增强，**2026-5-14**）

> 与当前代码路由前缀对齐时，使用 **`/api/project-sourcing/...`**（若历史文档写 `/api/sourcing/...`，以实际部署为准）。

- **`POST /api/project-sourcing/events/:id/ai-enrich`（建议路径）**  
  - **作用**：对单条 `sourcing_financing_event`（路径参数 `id` 为标准表主键）触发 **产品简介(AI) / 企业标签(AI)** 生成任务，成功后更新 `ai_product_intro`、`ai_company_tags_json`、`ai_company_tags_display` 及 `ai_enrich_*` 治理字段。  
  - **语义**：与 §12.7 自动入队 **同一套模型、提示词与解析规则**（§12.10）；区别仅为 **触发源** 为人工、且 **粒度为单条**。  
  - **响应**：**推荐 202 Accepted / 同步受理 JSON**（立即返回 `ai_enrich_status=running` 或队列 job_id），由前端刷新列表或短轮询；**不推荐** HTTP 长连接阻塞至模型结束（易超时）。  
  - **权限**：默认与「手动同步」一致，仅 **`admin`**（见 §3.2）；若产品放宽，须新增权限键并回写本文档。  
  - **幂等**：同一 `id` 在 `running` 期间重复点击可返回「处理中」而不重复排队，或按产品选择允许覆盖排队（实现二选一，文档推荐 **去重/拒绝重复提交**）。
  - **日志（强制）**：接口 **一经合法受理**（含幂等拒绝重复排队时的受理响应），即按 §12.12 写入或更新 **触发日志**；不得在「无日志」情况下返回 200。

---

## 十、验收标准（第一步）

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

### 10.1 补充约定（数据加工层 / 与实现对齐）

以下条目补全前文未写清或与当前代码落地存在差异的口径，作为第二步开发与验收依据。

#### A. 同步执行日志落库位置

- **事实实现**：投融资同步任务绑定 `news_interface_config.id`，执行过程写入 **`news_sync_execution_log`**（与「管理员设置 → 定时任务 → 新闻同步 → 日志」同源，`execution_details.progress_lines` 承载抓取过程）。
- **文档中曾写** `listing_sync_execution_log`：与上市进展配置共用该表的设计保留作后续统一审计方案；**当前查询投融资同步明细请以 `news_sync_execution_log` 为准**。
- **后续**：若产品要求统一到 `listing_sync_execution_log`，再做单次迁移与双写策略（不在本步范围）。

#### B. 标准表 `sourcing_financing_event` 写入阶段划分

| 阶段 | 内容 | `classification_status`（建议） |
|------|------|----------------------------------|
| A | 接口字段映射入标准表（原文保留在 `*_raw`） | `pending`（若尚未跑规则层） |
| B | 规则层：金额文本解析 + 烯牛→内部行业字典映射 | `filling`→完成后 **`verified`**，`classification_source='rule'` |
| C | 赛道/竞品/标签等大模型或高级规则 | `checking`→**`verified`/`failed`**，`rule`/`llm`/`hybrid` |

- **本步开发**：在入库管线内**同步执行阶段 B**（与阶段 A 同一事务写入），使新入库记录直达 **`verified` + `rule`**（版本号见实现常量）；阶段 C 仍为后续迭代。
- **历史数据**：已以 `ingest_v1` 写入的可通过「批量回填任务」重跑阶段 B（脚本或管理接口，可选）。

#### C. 金额解析首期降级

- **汇率**：在尚未接入「系统配置 → 汇率」前，使用环境变量 **`FINANCING_USD_CNY_RATE`**（默认 `7.2`）将 USD 折算为 `amount_cny`；接入配置表后替换实现并保留降级日志。
- **主字段**：优先解析 **`funding_amt_raw`**；若为 `unparsed`，再尝试 **`estimated_amt_raw`**（与业务确认一致：展示「获投金额」优先，预估为辅）。
- **投后估值**：仍只存 `post_valuation_raw`；结构化数值列待 DDL 扩展后再解析（见 §4.2 字段说明）。

#### D. 行业映射首期策略

- 维护 **烯牛 `(xn_ic_lv1, xn_ic_lv2)` → `(industry_std_lv1, industry_std_lv2)`** 映射表（首期可为代码内种子 + 可扩展配置文件/DB 表）。
- **未命中映射**：`industry_std_*` 置空，`industry_match_confidence=0`，不伪造标准行业；后续由产品补字典。
- **禁止**：仅在查询时临时计算标准行业而不回写表 2（与 §4.2.1 强制条款一致）。

#### E. 投资方 JSON 与展示

- `investor_names` **长期保留接口原始 JSON**（与 §5.2 一致）。
- 列表/卡片如需可读字符串：**前端拼接**或查询视图拼接均可；**不强制**新增物理列（若后续报表强依赖再增加 `investor_names_display`）。

#### F. 接口字段别名

- 若线上响应键名与 `国际集团投融资接口.MD` 不一致，在 **`financingIngestService` 入口做统一别名归一**（登记在接口变更说明中），避免标准表长期为空。

---

## 十一、第二步任务拆解（数据加工 — 执行清单）

| 序号 | 任务 | 产出 | 状态 |
|------|------|------|------|
| T1 | 金额文本解析模块 | `parseFinancingMoneyText` + 环境变量汇率；覆盖万/亿/美元/未披露/模糊词 | **已完成** |
| T2 | 行业字典映射模块 | `mapIndustryToStd` + 种子映射（可扩展） | **已完成** |
| T3 | 入库管线接入规则层 | `ingestOneDeal` 写入 amount_*、industry_std_*、classification_* | **已完成** |
| T4 | （可选）历史回填脚本 | `npm run backfill:financing-enrich`（见 `news/server/scripts/backfillFinancingRuleEnrich.js`）；默认仅 `ingest_v1`/NULL 版本，`--force` 重算 rule 链路（跳过 llm/hybrid） | **已完成** |
| T5 | 文档修正 | §5.1 增加「当前使用 news_sync_execution_log」脚注或替换表述 | **已完成** |
| T6 | 样本库与回归 | 沉淀 ≥200 条标注样本后接 §4.2 阈值验收 | 后续 |
| T7 | 融资信息 AI 增强 DDL | `sourcing_financing_event` 增加 §4.2 / §12.2 所列 `ai_*` 列与索引 | **待开发**（**2026-5-11**） |
| T8 | AI 增强异步 Worker | 队列、限流、状态机、JSON 校验与 `ai_company_tags_display` 顿号拼接 | **待开发**（**2026-5-11**） |
| T9 | 配置与提示词接入 | `ai_model_config`（`application_type=project_sourcing_analysis`）+ 模型提示词设置新增 `prompt_type=project_sourcing_financing_web_enrich`；默认文案见 §12.10 | **待开发**（**2026-5-11**，**2026-5-12** 修订口径） |
| T10 | 前端与 API | 融资事件列表/详情/导出展示 AI 列；**列表页「手动AI取数」单条触发**（§12.8）；接口见 §9.3；管理端批量重算（建议）；**日志查询入口（建议）** | **待开发**（**2026-5-11**，**2026-5-14** 增补，**2026-5-15** 增补） |
| T11 | AI 增强日志表 + 埋点 | 新建 `sourcing_financing_ai_enrich_log`（或等价名），触发即写、结束更新；见 §12.12 | **待开发**（**2026-5-15**） |

---

## 十二、融资信息 AI 增强（阶段 A）— 需求定稿（**2026-5-11 更新**，**2026-5-12 修订**，**2026-5-13 修订**，**2026-5-14 增补**，**2026-5-15 增补**，**2026-5-16 章号调整**）

> **范围**：仅落地 **阶段 A**——在标准表 `sourcing_financing_event` 上增加 AI 生成字段与异步增强管线。**「匹配已投企业 / 同类型企业是否有融资」** 为后续阶段 B，不在本条；阶段 B 将优先消费本条中的 `ai_company_tags_json` 等结构化字段。  
> **后续开发**：以本节与 §4.2 增补字段、§7.4、§9.3、§12.8、§12.10、§12.12 为准实现与验收。

### 12.1 业务目标

- 在接口数据已入库标准表后，通过**可配置的大模型**（具备**联网检索与归纳**能力）补全，服务于 **「同类型产品公司 / 竞争对手」** 检索与后续匹配：
  - **产品简介（AI）**（库字段 `ai_product_intro`，界面列名 **`产品简介(AI)`**）：独立长文本，**不覆盖** `project_desc`；只写**具体做什么类型的产品/服务**（如智能轮椅、大模型基础平台、工业视觉检测系统等），**不写**工商档案、发展沿革、融资历史。
  - **企业标签（AI）**（界面列名 **`企业标签(AI)`**）：**自有中文词组**，侧重行业与产品谱系、细分赛道、产业链位置、典型应用场景等，**不写**股东背景、上市状态、融资事件名等难以用于「找同类产品」的标签。

### 12.2 数据模型（标准表字段）

字段名、类型与注释以 §4.2 表格增补为准，核心约定如下：

| 维度 | 字段 | 说明 |
|------|------|------|
| 展示 + 审计 | `ai_product_intro` | **产品简介(AI)**，TEXT；内容口径见 §12.1、§12.10 |
| 前端列表/导出展示 | `ai_company_tags_display` | **企业标签(AI)**；自有词组、顿号「、」分隔；写入前服务端去重、截断至列长度上限 |
| 程序匹配 / 分析 | `ai_company_tags_json` | **JSON**；键含 `product_category`、`track`、`sub_track`、`industry`、`scenario`（各为**字符串数组**），词组均为**自有中文**，与 §12.10 一致，供竞品/同类检索 |
| 任务治理 | `ai_enrich_status`、`ai_enrich_at`、`ai_enrich_model`、`ai_enrich_version`、`ai_enrich_error` | 异步任务状态、完成时间、模型快照、版本、失败摘要 |

**与现有列关系**：不删除、不覆盖 `business_tags`、`scenario_tags`、`track_*`、`classification_*`；AI 增强为**并行信息层**。若后续产品要求与规则层合并展示，再在 UI 层约定拼接规则。

### 12.3 大模型输入上下文（强制，**2026-5-12 修订**）

- **主路径（境内常见）**：向模型提供 **企业名称**（`company_name`，登记名称或常用简称以库中为准）+ **统一社会信用代码**（`company_credit_code`），二者一并作为检索与消歧依据。
- **信用代码为空（已定稿）**：仍执行本任务；仅向模型提供 **企业名称或简称**（同一字段优先用 `company_name`；境外主体可能仅有英文简称，亦照实传入）。**不因代码为空而 `skipped`**（除非名称为空等无可检索主体，见 §12.7）。
- **不要求**将接口侧的 `project_desc`、行业、轮次等作为模型输入；由模型通过 **原生联网** 检索公开信息后归纳（降低与接口脏数据耦合）。
- **输出要求**：在联网总结基础上生成 §12.2 所列 **产品简介（AI）** 与 **企业标签（AI）**；须遵守 **§12.10** 的 JSON 结构，便于服务端校验与落库。若 **企业名称为空或无可检索主体**，任务置为 `skipped` 并记录原因（见 §12.7）。

### 12.4 联网检索与总结（能力约束，**2026-5-12 已定稿**）

- **产品语义**：须使用 **大模型原生联网搜索**（非自建搜索 API 拼接为默认方案），基于公开网页归纳后再生成输出。
- **模型选型（产品验证口径）**：例如阿里云通义 **qwen-max**（需在控制台开启/选用具备联网能力的对话形态，与 DashScope 文档一致）；**具体模型名以 `AI模型配置管理` 中配置为准**，文档不绑定单一 SKU 版本号。
- **部署说明**：在上线手册中记录「所用模型须开通联网」「单条耗时与 QPS 上限」及费用评估。

### 12.5 语言与展示口径（**2026-5-12 新增**）

- **企业名称**：若主体为境外企业且库中仅有 **英文名称或英文简称**，检索与理解时 **保留英文名称**（不在介绍中强行翻译公司法定英文名，除非公开资料普遍使用中文译名且可核验）。
- **产品简介（`ai_product_intro`）**：**全文中文**（专业术语、产品型号、国际通用缩写可保留英文）；**禁止**以工商信息、成立迁址、融资轮次、上市进程、管理层履历等为主轴（口径与 §12.10 负面清单一致）。
- **企业标签**：`ai_company_tags_json` 与 `ai_company_tags_display` 均为 **自有中文词组**（顿号「、」分隔）；**禁止**输出以股东背景、上市、融资事件、估值、实控人等为主的标签；品牌名等专有名词可保留英文缩写。

### 12.6 配置与提示词（强制，**2026-5-12 修订**）

- **提示词**：维护于 **系统管理 → AI模型配置 → 模型提示词设置**；默认正文见 **§12.10**（可复制到配置页先做联调）。须含：联网检索要求、不确定性表述、**仅输出 JSON**、字段含义、中文标签规则（与 §12.5 一致）。
- **模型**：在 **`application_type = project_sourcing_analysis`** 下选用具备 **原生联网** 的模型配置（如 qwen-max）；与 §7.4 一致。
- **版本与重算**：`ai_enrich_version` 与配置侧提示词版本联动；配置变更后可按版本批量重算历史行（策略：全量 / 按时间窗 / 按筛选，由管理端与任务队列控制）。

### 12.7 异步任务与触发（强制）

- **不得**在单笔接口入库同步 HTTP 请求内阻塞调用大模型（避免超时、拖垮同步任务）。
- **推荐流程**：标准表行写入且事务提交成功后 → 将 `id` 写入待处理队列（DB 轮询表或现有任务框架）→ Worker 限流（并发、QPS、日预算可配置）→ 调用模型 → 校验 JSON → 更新 `ai_*` 与 `ai_enrich_status`。  
  - **手动 AI 取数（§12.8）** 与自动入队 **共用同一 Worker 与限流策略**（便于成本与稳定性控制）；可选：为人工触发任务设置 **略高优先级**，避免被大批量自动任务长时间阻塞（实现非强制）。
- **状态机建议**：`pending` → `running` → `success` | `failed`；`skipped` 仅用于 **无可检索主体**（例如 `company_name` 为空或经规则判定为无效占位符），**不因**统一社会信用代码为空而跳过（与 §12.3 一致）。
- **重试**：失败自动重试次数上限（建议 ≤3）与退避策略写死入实现常量；超过上限写 `failed` 并填 `ai_enrich_error`。
- **日志（强制）**：所有进入本管线的任务（自动入队、**§9.3 手动接口**、批量重算）均须按 **§12.12** 落库；**触发时刻**即产生可追溯记录，执行结束后再补齐结果字段。

### 12.8 API 与前端（阶段 A，**2026-5-13 修订**，**2026-5-14 增补**）

- **前端合规（已定稿）**：**不强制**单独横幅或法务长文案；在表头/列名用后缀 **（AI）** 标示机器生成字段即可，例如 **`产品简介(AI)`**、**`企业标签(AI)`**（与库字段 `ai_product_intro`、`ai_company_tags_display` 对应）。可选：详情页脚注一行「由大模型基于公开信息生成」。
- **列表/详情**：在 `ai_enrich_status=success` 时返回上述字段；`ai_company_tags_json` 可默认仅在详情或「分析/匹配」接口返回（**列表不返回 JSON，仅详情返回**）。
- **导出**：导出列名与界面一致，使用「产品简介(AI)」「企业标签(AI)」；JSON 可单独「全量导出」选项。
- **融资事件列表 — 手动 AI 取数（已定稿，2026-5-14）**  
  - **入口**：在 **融资事件列表** 页筛选区操作栏，于「手动同步」**同一行、靠右** 增加 **`手动AI取数`** 按钮（与产品截图标注位置一致；具体像素级布局服从现有 UI 规范）。  
  - **选择**：用户须 **选中恰好一条** 记录后再点击。实现建议：表格增加 **单选列（radio）**；未选、多选时按钮 **禁用**，或点击后全局提示「请选择一条融资事件」。  
  - **动作**：点击后调用 **§9.3** 单条触发接口；将选中行的标准表 **`id`** 提交给后端，进入与 §12.7 **相同** 的 AI 增强管线（模型与提示词仍来自系统配置）。**后端在请求被受理的瞬间**须写入 §12.12 日志（含操作人、触发类型 `manual`）。  
  - **体验**：请求 **异步受理**（推荐）：接口快速返回后，该行展示「生成中」或 `ai_enrich_status=running`，完成后用户 **刷新** 或前端 **短轮询** 拉取最新 `ai_*`；失败时展示 `ai_enrich_error` 可读摘要。  
  - **可选二次确认**：为防止误触，可在点击后弹出轻量确认框（文案如「确认为当前企业重新拉取 AI 简介与标签？」）。  
  - **权限**：默认 **仅 `admin`**，与「手动同步」一致（§3.2）；若后续对投资经理开放，须增加显式权限点并更新本文档。  
- **管理端（建议）**：按筛选条件「批量重算 AI 增强」、单条重试；仅 `admin` 或项目挖掘配置权限角色可操作。

### 12.9 验收标准（阶段 A）

1. DDL 与注释与 §4.2 增补字段一致，迁移可重复执行。  
2. 新入库记录在规则层完成后自动进入 AI 增强队列；不阻塞原同步接口 SLA。  
3. 提示词与模型均可仅通过 **系统管理-AI 配置** 调整，代码无硬编码密钥与提示词正文。  
4. 成功样例：`ai_product_intro` 非空，且以**具体产品/产品线类型**为主，无明显工商/融资史堆砌；`ai_company_tags_display` 为顿号分隔的**自有中文词组**，无股东/上市类噪音；`ai_company_tags_json` 通过 Schema 校验且与 **§12.10** 负面清单一致。  
5. 失败样例有 `ai_enrich_error` 与任务日志可查；重试耗尽后为 `failed` 且不无限重跑。  
6. 列表在数据未就绪时展示占位（如「-」或「生成中」），不报错。  
7. **手动 AI 取数**：`admin` 在选中单条后可成功提交；处理完成后该行 **产品简介(AI)**、**企业标签(AI)** 更新且与 §12.10 口径一致；`running` 期间重复提交行为符合 §9.3 幂等约定。  
8. **日志**：任意一次触发（手动接口、自动入队、批量重算）在 §12.12 表中 **可查**；至少能按 `financing_event_id`、时间窗、`trigger_type`、操作人筛选；失败记录含错误摘要。

### 12.10 默认提示词（测试稿，**2026-5-12** 首版，**2026-5-13 修订**）

> **用途**：复制到「模型提示词设置」中 `prompt_type = project_sourcing_financing_web_enrich` 对应记录，在 **启用原生联网** 的模型（如 **qwen-max**）上先做人工联调；联调通过后再固化版本号入库。  
> **占位符**：由应用在调用前替换——`{{COMPANY_NAME}}`、`{{CREDIT_CODE}}`（无则传空字符串或字面量「无」）。  
> **产出目标**：支撑 **「检索同类型产品公司 / 潜在竞争对手」**；宁可少写企业花边信息，也要把 **产品形态 + 行业/场景坐标** 写清楚。

#### （1）System 提示词（建议整段作为「系统 / 角色」侧内容）

```text
你是行业与竞品研究助理。你必须使用模型自带的联网搜索能力，根据「企业名称 / 统一社会信用代码」检索公开资料（官网、产品页、行业媒体、技术文档、展会介绍等），归纳后只输出一个 JSON。

【任务目标】
输出用于「找同类产品公司、对标竞品」的检索素材：产品类型要具体到可类比的粒度（例如：智能电动轮椅、大模型推理加速软件、工业 AOI 视觉检测设备），而不是企业百科摘要。

【product_intro 写什么（必须遵守）】
- 用简体中文写 200～500 字为宜（信息极少时可更短）。
- 主体只写：公司**具体生产或提供什么类型的产品/系统/平台/服务**；可包含：核心技术路线（如多模态大模型、SLAM、碳化硅功率模块）、典型规格档位（若公开）、主要下游场景（如养老院室内代步、金融风控建模、锂电池产线质检）。
- 若公开信息不足：明确写「公开可核验信息有限」，不要猜测未披露细节。

【product_intro 禁止写（出现即视为不合格）】
- 工商注册信息堆砌：注册资本、法定代表人、迁址、分支机构列表等。
- 企业发展史年表、管理层履历长篇。
- 融资历史：轮次、金额、投资方名单、估值、上市辅导等。
- 大段复述新闻通稿口号而无具体产品信息。

【company_tags 五个数组写什么】
均为「自有中文词组」，每维 2～8 条，短词组（2～12 字为主），去重，不要整句：
- product_category：具体产品或产品线类型（可与 product_intro 呼应，更短更标签化）。
- track：大赛道/大行业门类（如医疗器械、基础软件、半导体材料）。
- sub_track：细分赛道或技术品类（如康复辅具、AI Infra、湿电子化学品）。
- industry：产业链位置或行业分类向词组（如上游材料、中游模组、下游 SaaS），可与国标/行研常用分类对齐用词，但不必输出编号。
- scenario：下游应用场景或客户类型（如养老机构、三甲医院、主机厂 Tier1、证券资管 IT）。

【company_tags 禁止出现（勿作为标签主体）】
- 股东、实控人、国资背景、外资比例、创始人关系等。
- 上市状态、IPO、辅导备案、壳资源、概念股等。
- 融资事件名、轮次标签（如「B 轮」「独角兽」）、投资机构简称作为主标签。
- 空洞形容词堆砌（如「著名」「领先」「一站式」单独成 tag 且无行业主语）。

【company_tags_display】
将五个数组合并去重后的全部词组，用中文顿号「、」拼成一行；顺序：product_category → track → sub_track → industry → scenario。

【语言】
若企业名为英文（境外常见）：检索时保留英文名理解；但 product_intro 与全部标签词组仍为中文（品牌、型号、API 名可保留英文）。

【输出格式】
仅输出一个合法 JSON 对象；禁止 Markdown 代码围栏；禁止 JSON 外任何文字。

【重名】
若无统一社会信用代码：仅用企业名称检索；若可能重名，在 product_intro 首句用一句话说明「公开信息下已择优对应主体」，无法确认则明确写不确定。
```

#### （2）User 提示词（每次请求拼接）

```text
请按系统说明联网检索后，仅输出 JSON，字段严格如下（各数组内为中文词组；请尽力从公开资料提取，避免五维全空；某维确实无依据时可为空数组）：
{
  "product_intro": "",
  "company_tags": {
    "product_category": [],
    "track": [],
    "sub_track": [],
    "industry": [],
    "scenario": []
  },
  "company_tags_display": ""
}

待检索企业：
- 企业名称：{{COMPANY_NAME}}
- 统一社会信用代码：{{CREDIT_CODE}}

若代码为空、填「无」或空白：仅用企业名称检索并注意重名消歧。
```

#### （3）落库映射（研发实现时对齐）

| 模型 JSON 字段 | 标准表字段 |
|----------------|------------|
| `product_intro` | `ai_product_intro`（界面列名：产品简介(AI)） |
| `company_tags`（对象） | `ai_company_tags_json` |
| `company_tags_display` | `ai_company_tags_display`（界面列名：企业标签(AI)；服务端可校验与 JSON 派生一致性，不一致时以 JSON 重拼顿号串并记日志） |

#### （4）联调检查清单（产品自测）

- `product_intro` 以具体产品/系统类型为主，**无明显**工商/融资/上市段落。  
- `company_tags_display` 为中文顿号词组，**无**股东、上市、融资轮次类标签。  
- 境外英文名：检索理解可英文，正文与标签仍为中文为主。  
- 代码为空：可短句提示重名风险；仍仅输出 JSON，无 Markdown 围栏。

### 12.11 余留待澄清（**2026-5-12** 首版，**2026-5-13 修订**）

以下项仍需研发与厂商文档对齐：

1. **DashScope 联网开关**：控制台 / API 参数（如是否需 `enable_search` 等）以阿里云当时文档为准，研发在对接说明中登记实际键名，文档不替代厂商手册。

**已定稿（2026-5-13，自 §12.11 移除）**：

- ~~前端合规~~：列名 **（AI）** 标示即可，见 §12.8。  
- ~~标签与赛道配置表~~：**自有中文词组**，与内部「赛道配置」枚举 **无强制映射**；阶段 B 若需对齐，另做映射表或后处理，不在本提示词中限制词表。

### 12.12 触发与执行日志（强制，**2026-5-15**）

> **目的**：审计「谁在何时、因何种触发方式、对哪一条融资事件」发起了 AI 增强；支撑排障、幂等争议与成本复盘。与 `sourcing_financing_event.ai_enrich_*` 字段互补：**行上字段**表示当前最新结果，**日志表**保留历史每一次触发与执行过程。

#### 12.12.1 何时写日志

- **触发瞬间（强制）**：以下任一入口 **成功受理** 即写入一条日志（或插入主键后再更新）：  
  - **手动**：§9.3 `POST .../events/:id/ai-enrich`；  
  - **自动**：标准表入库后 Worker 将任务入队时；  
  - **批量重算**：管理端批量任务对每条子任务受理时。  
- **受理失败**（如参数非法、无权限）：可写一条 `execution_status=failed` 且 `error_message` 说明原因，**或**写应用级错误日志；**推荐仍落库**便于运营统计失败原因。  
- **幂等拒绝**（如 `running` 期重复点击）：须有一条可追溯记录（可与首次任务共用 `job_trace_id` 或在 `error_message` 中注明 `duplicate_trigger`），避免「静默无记录」。

#### 12.12.2 建议物理表

- **表名（建议）**：`sourcing_financing_ai_enrich_log`（实现时若改名，须在本文档与 `db.js` 注释同步）。  
- **性质**：**追加型执行日志**，仅 `INSERT` / 对同一行的 **`started_at`/`finished_at`/状态类 `UPDATE`**；无列表「删除」语义时，可按仓库 MySQL 规范 **省略** `delete_mark`/`delete_time`/`delete_user_id` 三件套（纯日志表例外）；须含 **`created_at`、`updated_at`**（`TIMESTAMP`，与仓库 DDL 习惯一致）。

#### 12.12.3 字段（最小集，可扩展）

| 字段名 | 说明 |
|--------|------|
| `id` | 主键，建议 `BIGINT` 自增或 VARCHAR(19) 与项目 ID 规则一致 |
| `financing_event_id` | 标准表 `sourcing_financing_event.id` |
| `event_id` | 快照：融资事件业务键 `event_id`（便于脱离 join 排查） |
| `company_name` | 快照：触发时 `company_name`（可空） |
| `trigger_type` | 枚举建议：`manual_api` / `auto_enqueue` / `batch_replay` / `system_retry` |
| `triggered_by_user_id` | 手动时为登录 `admin` 的 `users.id`；系统自动为 `NULL` 或系统用户占位 |
| `triggered_at` | 触发受理时间（Asia/Shanghai） |
| `client_ip` | 可选，HTTP 客户端 IP |
| `job_trace_id` | 可选，UUID，关联分布式链路或队列消息 |
| `execution_status` | 与任务生命周期对齐：`pending` / `running` / `success` / `failed` / `skipped` |
| `started_at` / `finished_at` | Worker 实际开始调用模型 / 落库完成时间 |
| `duration_ms` | 可选，执行耗时 |
| `llm_model_config_id` | 可选，当次 `ai_model_config` 主键或可读标识快照 |
| `prompt_type` / `prompt_version` | 与 §7.3 一致 |
| `ai_enrich_version` | 与标准表写入的版本一致（便于对账） |
| `error_message` | 失败摘要，建议 `VARCHAR(500)` 截断 |
| `retry_index` | 可选，第几次重试（0 起） |

#### 12.12.4 索引与查询

- 建议索引：`(financing_event_id, triggered_at DESC)`、`(trigger_type, triggered_at DESC)`、`(execution_status, triggered_at DESC)`。  
- **管理端（建议）**：在「管理员设置」或「项目挖掘」下提供 **按时间 / 企业 / 触发类型 / 状态** 筛选的日志列表（与 §3.2 `admin` 能力一致）；首期可仅 **DB 查询 + 导出**，二期再做 UI。

#### 12.12.5 与标准表字段的关系

- Worker **开始**调用大模型前：可将标准表 `ai_enrich_status` 更新为 `running`（若采用），并与日志行 `execution_status` 对齐。  
- Worker **结束**：同时更新标准表 `ai_*`、`ai_enrich_status`、`ai_enrich_at` 等与 **对应日志行** 的 `execution_status`、`finished_at`、`error_message` 等，保证 **同一 `job_trace_id` 或日志 `id` 可关联**。

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

