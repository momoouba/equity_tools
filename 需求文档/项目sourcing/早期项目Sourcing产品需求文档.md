# 早期项目 Sourcing 产品需求文档（第一步落地版）

> **修订记录**  
> - **2026-5-13（被投企业 · AI 与导出）**：项目挖掘 **「被投企业」** 页与 **融资事件列表** 能力对齐：列表增加 **产品介绍（AI）**、**行业标签（AI）**、**AI状态**；`invested_enterprises` 落库对应 AI 字段；新增执行日志表 **`invested_enterprise_ai_enrich_log`**；工具栏提供 **导出当前页 / 导出全部**（XLSX）、**手动同步**（与融资页相同的投融资 `queryByDate`）、**手动 AI 取数 / AI 执行日志 / 批量 AI 取数 / 重试失败 AI**（管理员；单条操作须 **radio 选中一行**）；大模型 **与融资事件同一套 `project_sourcing_financing_web_enrich` 提示词与模型配置**，调用时以 **被投企业全称** 为主填入模板（并带入统一信用代码、项目简称等占位符）。详见 **§3.2**、**§3.3**、**§4.1.5**、**§8.4**、**§9.3**、**§12.8**、**§12.9**、**§12.12**。  
> - **2026-5-12（晚）**：项目挖掘应用内新增菜单 **「被投企业」**；列表、筛选与操作按钮与新闻舆情「舆情监控对象」中被投企业 Tab 对齐；**复用表 `invested_enterprises`**，新增字段 **`data_app_name`**（`新闻舆情` / `项目挖掘`）区分应用归属；列表与 `/api/enterprises` 系列接口按 `data_app_name` 过滤；新闻入库、分析、邮件、分享等链路中涉及 `invested_enterprises` 的查询仅匹配 **`data_app_name` 为新闻舆情**（含兼容 `COALESCE`）的记录，避免项目挖掘侧数据误入舆情逻辑。详见正文 **§3.3**、**§4.1.5**。  
> - **2026-5-11**：增补融资标准表 **AI 增强（阶段 A）** 字段与流程；提示词与模型均走 **系统管理 → AI模型配置**。（§ 与章号以 **2026-5-16** 修订为准。）  
> - **2026-5-12**：已定稿联网方式（**模型原生联网**，如通义 **qwen-max**）、输入降级（信用代码为空时用名称/简称）、语言口径（外文名 + 中文描述）、**复用应用类型「项目挖掘分析」**；增补默认提示词（今 §12.10）；原「待澄清」条目后迁入 §12.11。后续开发以两版修订为准。  
> - **2026-5-13**：前端以列名后缀 **（AI）** 作合规提示；**产品简介(AI)** 与标签输出改为「具体产品类型 + 行业/场景检索向」，提示词排除工商、融资史、股东与上市类信息；标签明确为 **自有中文词组**（与内部赛道枚举无强制映射）。  
> - **2026-5-14**：融资事件列表增加 **「手动AI取数」** 按钮，支持选中 **单条** 记录触发 AI 增强并写回 `ai_*` 字段；补充 §12.8、§9.3、权限与接口约定。  
> - **2026-5-15**：融资信息 AI 增强补充 **触发与执行落库日志**（§12.12）；与手动/自动触发、§9.3 接口联动；验收与任务表同步更新。  
> - **2026-5-16**：**一级章节编号顺连续**（原「四」后跳「七」已消除：旧七～十一顺延为五～九；原「十二验收 / 十二点二 / 十二点三」顺延为十～十二；原十三～十四仍为十三～十四）。文内 **§ 引用** 已同步：原 `§12.3.x` → **`§12.x`**（例：§12.3.10 → §12.10）；原 `§11.3`（手动 AI 接口）→ **`§9.3`**；原 `§9.4`（AI 模型配置小节）→ **`§7.4`**；原「§十二点五-A」→ **`§10.1-A`**（第十章补充约定 A 节）。
> - **2026-5-14（竞品补录与企查查口径修订）**：竞品匹配前 **须清洗企查查企业介绍**（剔除与经营范围雷同等无效工商模版），**不得以非空即满足**；**以「产品介绍(AI)+有效业务信息+企业标签」** 判定信息是否不足；不足时弹窗支持 **业务标签** 与 **自由文本**，且 **自由文本须先经 AI 抽标签** 再进入竞品主流程（§3.5.3、§3.7.1）。
> - **2026-5-14（底层项目 · 项目挖掘）**：在「项目挖掘」下新增 **「底层项目」** 列表（路由示例：`/dashboard/project-sourcing-ipo-projects`），数据仍存 **`ipo_project`**，与「上市进展」菜单解耦：**专用接口** `GET/POST /api/project-sourcing/ipo-projects/...`，路由校验 **项目挖掘权限**。列表 **仅 `data_app_id` = `applications` 中「项目挖掘」的 id**；**非 admin** 仅 `F_CreatorUserId` = 当前用户；**admin** 可选 **筛选用户（创建人）**。业务金额/基金等 **只读**；工具栏对齐被投企业：**导出（含 `data_app_id` 列，列表不展示）**、**手动/批量 AI、重试失败、企查查、AI 日志**（与融资/被投企业 **同一套提示词与模型**）。**应用隔离**：`ipo_project.data_app_id` 存 **`applications.id`**（与 `invested_enterprises.data_app_id` 一致）；上市进展侧写入 `ipo_project` 的路径均写入 **「上市进展」应用 id**；历史行回填 **上市进展 id**，**禁止 NULL**。**`project_no` 全局唯一**（`PP`+`YYYYMMDD`+5 位序号）；同一主体两应用两行须 **不同 `project_no`**。**AI 日志**：复用 **`invested_enterprise_ai_enrich_log`**，列 **`ipo_project_f_id`**，**`invested_enterprise_id` 可空**；`trigger_type` 前缀 **`invested_enterprises:`** / **`ipo_project:`**，无前缀旧数据按被投企业解读。详见 **§3.4**。
> - **2026-5-14（竞品分析 Tab1 / 投前项目 Tab2 · 规划）**：项目挖掘新增 **竞品分析**（Tab1：被投企业 × 竞品列表）与 **投前项目**（Tab2）；相关性 **LLM 0–100 JSON、&lt;90 不落库**；多数据源 **Badge**；列表默认排序与 **被投企业列表多选批量竞品分析**（不支持对全表一次跑、重跑确认）等，见 **§3.5～§3.7**。**路由名**见 **§8.5、§8.6**；**企查查介绍清洗（剔除营业范围类无效信息）**、**以产品介绍(AI)+业务标签为主信号**、**信息不足时弹窗补标签或补自由文本并由 AI 抽标签后再匹配**、**无统一信用代码时用项目简称去重后参与匹配**，见 **§3.5.3、§3.5.4**。

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

- `admin`：可配置接口、配置模型、**投融资手动同步（queryByDate）**、**融资事件列表 — 手动 AI 取数 / AI 执行日志 / 批量 AI 取数 / 重试失败 AI**、**项目挖掘「被投企业」页 — 同上组 AI 能力与 AI 日志（见 §3.3、§8.4、§9.3）**、**项目挖掘「被投企业」列表 — 竞品分析（多选/单行触发，见 §3.5.9；与手动 AI 权限模型一致，具体以权限表配置为准）**、查看全量分析日志、**查看融资信息 AI 增强触发/执行日志（建议与管理员设置中日志入口一致）**、编辑任务。

- 普通用户：可查看 onepage 与分析结果，不可修改系统配置。

### 3.3 被投企业（项目挖掘）与表 `invested_enterprises` 应用隔离

- **菜单**：在「项目挖掘」应用下增加 **「被投企业」**，路由示例：`/dashboard/project-sourcing-invested-enterprises`；需具备与「项目挖掘」一致的应用权限（含 `membership_level_id` 的授权逻辑与现有子菜单一致）。
- **交互（基础）**：页面与新闻舆情 **「舆情监控对象」→「被投企业」** Tab 对齐（表格主体列、筛选条件、刷新、**定时更新**（外部库 SQL 同步）、批量导入、新增、变更日志等）。**「定时更新」** 在两应用入口均展示；**外部库同步 SQL 在 `enterprise_sync_task` 中按 `data_app_name` 分应用存储**，执行时写入对应 `data_app_name` 的 `invested_enterprises` 行。
- **交互（与融资事件列表对齐，2026-5-13）**：本页在 **`data_app_name=项目挖掘` 且仅展示被投企业** 的独立入口上，工具栏在「刷新 / 批量导入 / 定时更新 / 新增」之外，增加与融资事件页 **同一套投融资能力** 与 **同一套 AI 交互范式**：
  - **导出当前页 / 导出全部**：客户端生成 **XLSX**，列集合与 **`GET /api/enterprises/export`** 在项目挖掘口径下一致（含金额列、**产品介绍(AI)**、**行业标签(AI)**、**AI状态**、创建/更新时间）；导出全部按当前 **关键词、筛选用户** 分页拉取 `/api/enterprises` 后合并。
  - **手动同步**：与 **融资事件列表** 相同 — 选择「融资信息源」`news_interface_config` 一条配置 + **融资日期** 区间，调用 **`POST /api/project-sourcing/sync`**（`queryByDate`）；用于拉取投融资标准数据，**不替代**「定时更新」的外部库 SQL。
  - **手动 AI 取数 / AI 执行日志 / 批量 AI 取数 / 重试失败 AI**：仅 **`admin`**；表格增加 **单选列（radio）**；须 **先选中一行** 再点「手动 AI 取数」「AI 执行日志」（与融资事件列表一致）。大模型 **与融资事件共用** `project_sourcing_financing_web_enrich` 的提示词与模型配置；服务端将 **`enterprise_full_name`** 映射为模板中的企业名称，**`unified_credit_code` → 信用代码占位**、**`project_abbreviation` → 项目简称占位**（与 §12.3 信用代码可为空仍执行的口径一致）。解析结果写入 **`invested_enterprises` 的 `ai_product_intro`、`ai_industry_tags_display`、`ai_industry_tags_json` 及 `ai_enrich_*`**（列展示名：**产品介绍（AI）**、**行业标签（AI）**）。**批量 / 重试失败** 按行的 **`DATE(created_at)`** 落在区间内筛选；批量对 **企业全称（规范化去空白）去重** 后排队，避免同主体短时间重复调用（细则见 §9.3.2）。
- **数据**：表 `invested_enterprises` 增加 **`data_app_name` VARCHAR(64) NOT NULL DEFAULT '新闻舆情'**，取值与权限中的应用名一致：`新闻舆情`、`项目挖掘`。存量数据默认 **新闻舆情**。同一统一社会信用代码在不同应用下可各维护一条（去重校验按 **`unified_credit_code` + `data_app_name`**）。**AI 增强字段与日志**：见 **§4.1.5**（字段表）、**§12.12**（`invested_enterprise_ai_enrich_log`）。
- **接口**：`/api/enterprises` 列表、导出、新增、编辑、删除、批量导入等均须携带或解析 **`data_app_name`**（列表/导出走 Query；写入可走 Body）；服务端校验当前用户对该应用的访问权限后再过滤/写入。项目挖掘下列表/导出关键词检索须覆盖 **AI 文本列**（与列表可见列一致）。**被投企业 AI 专用接口** 前缀 **`/api/project-sourcing/invested-enterprises/...`**，见 **§9.3**。
- **舆情链路**：凡根据 `invested_enterprises` 匹配公众号、企业全称、基金/子基金等用于 **新闻舆情** 的逻辑，SQL 中须限制 **`data_app_name` 为新闻舆情**（实现上可用 `COALESCE(data_app_name,'新闻舆情')='新闻舆情'` 兼容历史），确保项目挖掘侧录入企业不参与舆情抓取与匹配。

**需求评估（简要）**

| 维度 | 说明 |
|------|------|
| 必要性 | 避免两套物理表重复维护；与现有「应用 + 权限」模型一致，扩展成本低于新建表 + 全量同步。 |
| 风险 | 须全面梳理 `invested_enterprises` 读路径，遗漏会导致项目挖掘数据被舆情误用；已通过服务端批量追加条件与 `enterprises` 路由参数化降低风险。 |
| 验收 | 新闻舆情页仅见 `data_app_name=新闻舆情`；项目挖掘「被投企业」仅见 `项目挖掘`；两应用各自 CRUD/导入/导出互不串数据；管理员筛选用户仍按 `creator_user_id` 与 `data_app_name` 组合生效。**被投企业页**：管理员可完成导出当前页/全部、手动同步、手动 AI、日志查看、批量与失败重试；AI 列与 `ai_enrich_status` 与接口返回一致；普通用户无 AI 工具栏与行选。 |

### 3.4 底层项目（项目挖掘 · `ipo_project`）

- **菜单与路由**：「项目挖掘」下新增 **「底层项目」**，示例：`/dashboard/project-sourcing-ipo-projects`；权限与「项目挖掘」子菜单一致（`membership_level_id` 等）。
- **数据表**：复用 **`ipo_project`**。新增/对齐字段（与 `invested_enterprises` 同类能力一致，便于 AI/企查查写回）：**`data_app_id`**（`applications.id`，NOT NULL）、**`unified_credit_code`**、**`ai_product_intro`、`ai_industry_tags_*`、`ai_enrich_*`、`qcc_*`** 等。
- **应用写入**：**上市进展**侧所有写入 `ipo_project` 的入口（业务库 SQL 同步、批量导入、手工创建等）落 **`data_app_id` = 「上市进展」应用 id**；**项目挖掘**侧若新增底层项目行则落 **`data_app_id` = 「项目挖掘」应用 id**。**列表不展示 `data_app_id`**；**导出须含 `data_app_id` 列**。
- **列表接口**：`GET /api/project-sourcing/ipo-projects`（及导出）**仅返回 `data_app_id` = 项目挖掘** 的行；**非 admin**：`F_CreatorUserId` = 当前用户；**admin**：支持 **筛选用户（创建人）**。
- **只读**：本页 **不可编辑** 投资金额、基金、子基金等业务库字段；仅 **AI / 企查查 / 导出 / 日志** 等增强类操作。
- **编号**：**`project_no` 全局唯一**（生成规则：`PP` + `YYYYMMDD` + 5 位当日序号，见服务端 `generateIpoProjectNo`）。同一主体若「上市进展」「项目挖掘」各维护一行，**须使用不同 `project_no`**。
- **AI 与日志**：与「被投企业」共用 **`invested_enterprise_ai_enrich_log`**；新增 **`ipo_project_f_id`**，**`invested_enterprise_id` 可空**；`trigger_type` 使用 **`ipo_project:`** / **`invested_enterprises:`** 前缀区分；无前缀历史行按 **被投企业** 解读。企查查写 **`ipo_project.qcc_*`**。
- **不在范围**：「底层项目上市进展」**匹配结果页**（`ipo_project_progress`）上的按钮不在本需求内扩展。

### 3.5 竞品分析 — Tab1「被投企业 × 竞品」（新菜单 / 新列表页）

> **状态**：规划需求；落库表名、接口路径由研发在详细设计中拍板，本文约定业务规则与验收口径。

#### 3.5.1 范围与入口

- **菜单**：在「项目挖掘」下新增 **「竞品分析」**（名称可研发展示为「被投企业 × 竞品」），**独立列表页**（Tab1）；与现有「被投企业」「底层项目」列表并列。
- **前端路由（与 Dashboard 子路由对齐）**：**`/dashboard/project-sourcing-competitor-analysis`**（实现时注册为 `path="/project-sourcing-competitor-analysis"` 挂在 Dashboard 下，全路径即上式）。权限：**项目挖掘** 应用可见性 + 与 §3.2 竞品操作角色一致。
- **对象**：仅遍历 **`invested_enterprises`** 且 **`data_app_name=项目挖掘`**、**退出状态为未退出**（与列表字段 `exit_status` 口径一致）的被投企业，作为「主行」展开竞品。

#### 3.5.2 相关性判定（写库门槛）

- **打分方式**：**仅 LLM** 输出 **0～100** 的整数（或约定精度），且 **单次响应须为可解析 JSON**（字段名、结构在提示词与研发接口契约中固定）。
- **落库规则**：**得分 &lt; 90 的记录不写库**（不落竞品关系表、不落竞品主表快照）；仅 **≥90** 进入持久化与 Tab1 展示。
- **说明**：日志层可记录 &lt;90 的抽样摘要（可选，默认关闭或仅 debug）便于调参，**不作为产品列表数据源**。

#### 3.5.3 数据源一：融资事件 + 底层项目（结构化池）

- **融资事件**：仅取 **用户匹配时可配置的时间窗**（默认 **近 2 年**，起止日期闭区间；**上限**如 5 年由服务端校验防滥用）。仅纳入 **同时具有「产品简介(AI)」与「企业标签(AI)」**（或等价非空字段）的行；**无则过滤**，不参与候选。
- **底层项目**：与融资池 **各自先去重再参与匹配**；去重键优先 **`unified_credit_code`**（合法长度约定与现有项目挖掘一致），无代码则用规范化 **企业全称** 等规则（与 §3.5.4 一致）。
- **匹配流程**：**先预处理（阻塞 / 召回 Top-K）→ 再 LLM 打分**，禁止「被投 × 全量融资/底层」逐对直连 LLM；具体 K 值、召回策略由研发设计，验收以 **可配置、可限流、有单企业耗时上限** 为准。
- **融资金额**：从融资事件取到的 **融资金额**（字段以标准表为准）写入竞品侧展示/明细；底层项目或 AI 侧若也有可映射金额字段则 **可空写入**。
- **企查查「企业介绍」— 有效性与清洗（强制）**：从企查查写入的 **企业介绍** 不得 **无条件** 当作匹配上下文。服务端（可辅以规则 + 轻量模型）须 **识别并剔除无效内容**，典型包括：与 **经营范围** 高度雷同、纯工商登记模版、无 **产品 / 业务 / 场景** 语义的官样段落。**被判定为无效** 的文本 **不参与** 召回与竞品 LLM 正文拼装，**不得** 仅因「字段非空」即视为已具备可用的「企业侧业务介绍」。
- **匹配信号口径（产品）**：竞品匹配以 **「产品介绍(AI)」** 与 **「业务语义信息」** 为主轴。**业务语义信息** 的可用来源优先级为：（1）经上述清洗后 **仍有效的企查查介绍**；（2）已有 **`ai_industry_tags` / 行业标签(AI)**（及等价展示字段）；（3）用户在 **§3.5.3 补录弹窗** 中提交的内容经处理后的信号（见下条）。**企业标签** 对召回与打分的权重 **高于** 长篇工商类介绍；**无效企查查长文不可替代** 产品介绍与标签。
- **发起匹配 / 竞品分析任务前的「信息不足」判定与补录弹窗（强制）**：在 **被投列表批量、单行、Tab1 内重跑、投前 Tab2 竞品按钮** 等入口，系统在完成 **企查查介绍清洗** 与字段汇总后，若 **被投侧或候选侧** 仍 **不足以支撑可靠匹配**（判定规则：**缺少「产品介绍(AI)」**，且 **无有效企查查业务介绍**，且 **无可用企业标签信号**——「无可用」指标签为空或经产品配置的 **最少标签数/置信** 未达标，阈值由研发在详细设计中量化并 **可配置**），须 **阻断** 并弹出 **「竞品匹配—补充业务信息」** 对话框。用户 **至少完成以下一种**（可同时）：
  1. **录入多个业务标签**（Tag 输入；示例：人工智能、具身智能、K12、跨境电商等 **贴近业务与赛道** 的短语，**非** 纯地名、泛词或与经营范围同质的碎片；**上限如 20 个**，单标签长度上限如 32 字，由表单校验落实）。
  2. **粘贴一段「企业业务 / 产品介绍」自由文本**（多行，长度上限如 2000 字）：系统须 **先** 调用 **AI 从该段文本抽取结构化标签**（及可选一句短摘要，字段与提示词在详细设计中固定），**抽取成功并落库后**，**再** 进入竞品召回与 §3.5.2 打分主流程；**禁止** 在「有自由文本但未完成抽标签」时直接进入主流程。
  - **落库与审计**：建议 **`competitor_match_supplement` 子表** 或等价结构，区分 **`user_tags_json`**、**`user_narrative_raw`**、**`ai_extracted_tags_json`**（及 `ai_extract_version`、时间、操作人、关联 `invested_enterprise_id` / 候选主键等）；**当次及同批次重算** 的提示词须 **显式拼接** 上述字段（规则写死、可回归）。
  - **取消**：用户取消则 **不发起** 本次竞品任务。与 §3.6.4 其他弱提示并存时，**优先合并为单次弹窗**（同一屏内：标签区 + 自由文本区 +「将先由 AI 提取标签」说明），避免连续多弹。
- **无统一社会信用代码时的去重与入模（强制）**：对 **`unified_credit_code` 为空或长度未达有效规则** 的被投企业或候选行，**不得以信用代码做主键归并**；须先对 **`project_abbreviation`（项目简称）** 做规范化（去空白、全半角、大小写策略一致）后去重，将 **「规范化后的项目简称」** 作为 **匹配输入键 / 阻塞键** 写入任务上下文，并与 **企业全称** 组合参与召回（弱键）。**同一规范化简称多行**时须 **合并为一条代表行**（规则：如取 `updated_at` 最新或人工指定，由研发定）。**落库竞品关系时**：若仍无信用代码，**关系表竞品主键列可空**，以 **`competitor_weak_key`（如 `norm_abbreviation` + `norm_full_name` 哈希）** 占位，待后续企查查补全信用代码后再迁移归并（详细设计必选其一：**禁止无码落库** vs **允许弱键落库**，本文推荐 **允许弱键落库 + 后续补全迁移**，并在 UI Badge 标「待补码」）。

#### 3.5.4 数据源二：同一主体展示与 Badge

- **同一竞品主体**：在 Tab1 中 **展示为一条**（以 **`unified_credit_code` 为主键** 归并；**无有效信用代码时** 不得以代码为主键，须按 **§3.5.3** 弱键（**规范化项目简称 + 企业全称** 等）归并与展示，并在 UI 上 **Badge 或角标** 提示 **「待补信用代码」**）。
- **多数据源同时命中**：在 UI 上以 **Badge** 区分来源类型，例如：**融资事件**、**底层项目**、**AI 搜索**（见下条）。Badge 可多枚并存。
- **竞品列表字段**（折叠内明细）：**项目简称**、**被投企业全称**（竞品侧名称）、**统一社会信用代码**、**数据源**（Badge 集合语义）、**相关性系数**（0～100）、**产品简介**、**企业标签**、**企业介绍**；**增加「相关子基金」**：自 **底层项目** 来源命中时，若有 **归属子基金/SPV** 等字段须写入；融资事件来源按标准表可映射则填，否则空。

#### 3.5.5 数据源三：AI 搜索（不覆盖正文）

- 将 **被投企业侧** 的 **项目简称、企业名称、统一社会信用代码** 发给 AI，按独立提示词生成 **竞品候选列表**（结构化 JSON）；**数据源标记为「AI 搜索」**。
- **归并与冲突**：若 AI 给出的主体与 **数据源一** 中已有主体 **统一社会信用代码一致**，则 **Badge 中须包含「AI 搜索」**，但 **简介/标签/企查查等正文仍以数据源一已落库信息为准**，**不以 AI 搜索正文覆盖**。

#### 3.5.6 主行折叠区（被投侧摘要列）

- 每一被投企业主行展示（折叠标题区）：**项目简称、关联基金、被投企业全称、退出状态、投资成本、剩余成本、剩余价值**（与 `invested_enterprises` 可映射字段一致）。
- **展开**：展示该被投下 **竞品明细列表**（见 §3.5.4 字段）。

#### 3.5.7 数据模型（原则）

- **新建「竞品关系」类表**：存储 **被投侧关联键**（建议 **`invested_unified_credit_code`** 或 **`invested_enterprise_id`** + 冗余信用代码）、**竞品 `unified_credit_code`（有码时主键归并）**、**无码时 `competitor_weak_key`（§3.5.3）**、**relevance_score**、**data_sources**（JSON 数组或位图 + 扩展字段）、**related_sub_fund**、**financing_amount**、溯源 id（融资事件 id、`ipo_project.f_id` 等可空）。
- **竞品主数据复用一张表**：**有 `unified_credit_code` 时** 以之为业务主键存竞品企业维度信息（名称、简介、标签、企查查介绍等快照），多被投引用同一竞品时 **不重复存全文**（关系表引用主表）；**无码竞品** 可先以 **弱键 + 快照行** 落库，补全信用代码后 **迁移归并**（§3.5.3）。

#### 3.5.8 列表排序（默认与可选）

- **默认排序**：**被投企业名称**（升序，拼音/汉字规则与现有列表一致）。
- **可选排序**（列表控件切换）：**最近竞品分析更新时间**（降序）；**当前被投下竞品相关性最大值**（降序）。

#### 3.5.9 批量触发入口（不在 Tab1）

- **Tab1「竞品分析」列表不提供「对全表跑一次」的批量按钮**。
- **批量入口**：在 **「被投企业」列表** 增加 **「竞品分析」**（多选 **checkbox**）；仅对 **选中行** 发起任务，**不支持**「未勾选即对全部数据执行」。
- **重跑**：若所选被投 **已存在竞品分析结果**（关系表或状态字段可判定），须 **二次确认**：「已有结果，是否重新分析？」——**否**则 **直接结束**；**是**则 **删除或作废旧关系后重新执行全流程**（实现策略：软删除 + 新批次号 / 硬删除，由研发定，验收以 **数据不串批、可追溯** 为准）。
- **单行快捷**：被投列表可提供 **单行「竞品分析」**（等同 Tab1 单次逻辑），结果写入 **与 Tab1 相同存储**，便于从列表直达数据。

---

### 3.6 投前项目 — Tab2（新表 · 规划）

#### 3.6.1 表与字段边界

- **新建独立表**（名称研发定，如 `pre_investment_project`）：**不包含** 投资成本、剩余成本、剩余价值等 **被投企业金额类字段**。
- **状态字段**：须区分 **已建档 / 企查查已回填 / AI 简介与标签已完成 / 失败** 等，支持用户 **手动再次触发「取数」** 类操作。

#### 3.6.2 录入与企查查（唯一一条）

- **前端路由**：**`/dashboard/project-sourcing-pre-investment`**（实现时 `path="/project-sourcing-pre-investment"` 挂在 Dashboard 下）。详见 **§8.6**。
- 用户输入 **企业简称** → 调 **企查查搜索**（与新闻舆情「舆情监控对象—新增企业」**同一能力**：用户 **选定唯一一条** 结果）→ 写入 **企业全称、统一社会信用代码** 等。

#### 3.6.3 保存链（用户视角一步完成）

1. **先入库**（投前表插入）。  
2. **再拉企查查简介**（更新同表或可关联扩展字段）；**须走与 §3.5.3 一致的「企业介绍」清洗**，剔除营业范围类无效段落后再供展示与后续 AI 入参（无效段可保留原文存档字段仅供审计，**不得** 进入匹配/联网增强主模板）。  
3. **再调用与「手动 AI 取数」等价的接口逻辑**（一次串联）：将 **产品简介(AI)、企业标签(AI)** 写回；**任一步失败** 须落 **状态 + 错误摘要**，用户可 **手动点选重试**。

#### 3.6.4 竞品分析（与 Tab1 同逻辑）

- 提供按钮 **「竞品分析」**：执行 **与 Tab1 相同的竞品抓取与写库逻辑**。
- **执行前校验**：与 **§3.5.3** 完全一致——**企查查介绍先清洗**；再以 **「产品介绍(AI) + 有效业务信息 + 企业标签」** 判断是否 **信息不足**；不足则 **阻断** 并走 **「竞品匹配—补充业务信息」** 弹窗（**业务标签** 与 **自由文本 → AI 抽标签** 两条路径，见 §3.5.3）。**不得** 因企查查字段非空但内容无效而跳过补录。**不再** 使用「缺产品介绍或缺企查查介绍任一即弹窗」的旧口径。
- **弱 AI 场景（可选产品细化）**：若已有 **产品介绍(AI)** 但 **行业标签(AI) 偏弱**（如为空或过少），可 **非阻断** 弹轻提示建议用户补充标签；若与 §3.5.3 阻断条件同时满足，**只弹一次** 合并表单。

#### 3.6.5 UI 与重复校验

- **UI**：与 Tab1 **组件复用**；投前无金额列 → **列配置可空** 或 **两套 column 定义**（同一套表格壳）。
- **重复投前**：与 **被投企业（项目挖掘）**、**竞品主数据/关系** 判重；若已存在则 **不入库** 并 **明确提示** 去向（例：「已在被投企业，请到被投企业查看」或「已在竞品分析」）。

---

### 3.7 竞品与投前 — 需求评审纪要（2026-5-14）

#### 3.7.1 已闭合的产品决策

| 项 | 结论 |
|----|------|
| 低分不落库 | **&lt;90 不写库**，列表与导出均不出现该候选。 |
| 多源命中展示 | **Badge** 多枚；正文以非 AI 搜索源为准，AI 搜索仅补 **来源标签** 与 **去重主键对齐**。 |
| 默认排序 | **被投企业名称升序**；支持切换 **最近竞品更新时间**、**竞品相关性最大值**。 |
| 企查查介绍噪声 | **营业范围式无效长文** 须剔除后再判「是否有有效介绍」；不得以非空即满足（§3.5.3）。 |
| 补录形态 | **业务标签** 与 **自由文本** 二选一或组合；自由文本 **必须先 AI 抽标签** 再进竞品主流程（§3.5.3）。 |
| 批量范围 | **仅被投列表多选**；**禁止全表无勾选批量**；**Tab1 不提供全表跑批**。 |
| 重跑 | **有则确认**；取消则结束；确认则 **整批重算**（旧数据策略研发定）。 |
| 投前金额 | **无金额列**；竞品侧 **融资金额** 仍可从融资事件 / AI 映射 **可空**。 |

#### 3.7.2 残留风险与实现依赖（须在详细设计中落实）

| 风险 | 说明与建议 |
|------|------------|
| LLM JSON 稳定性 | 已有 **输出截断导致 JSON 解析失败** 先例；竞品打分与 AI 搜索须 **足够 `max_tokens`、失败重试、结构化校验**，失败写入 **任务状态** 而非半条关系。 |
| 无信用代码归并 | 已约定 **规范化项目简称 + 企业全称** 弱键（§3.5.3）；仍易 **简称碰撞**；需 **人工复核队列** 或 **置信度二级字段**（可选阶段二）。 |
| 任务互斥 | **同一 `invested_enterprise_id`** 并发「列表批量」与「Tab1 重跑」建议 **队列串行**，避免写库竞态。 |
| 权限 | **已在 §3.2**：竞品分析（被投列表多选/单行）与 **手动 AI** 权限模型 **一致**（若后续需对普通用户开放，再单列角色）。 |
| 用户补充标签滥用 | 须 **条数/长度上限**、**审计**、可选 **敏感词本地校验**；**自由文本** 须 **先抽标签** 再入匹配；仅写入「竞品匹配」上下文，**不自动写回** `ai_industry_tags_display` 除非产品另定。 |
| 弱键简称碰撞 | 不同主体 **简称相同** 时归并错误；须 **全称二次确认** 或 **人工拆分队列**（阶段二）。 |
| 弹窗与 §3.6.4 双弹 | **合并为单次「补充业务信息」弹窗**（§3.5.3）；弱 AI 仅轻提示时不应再叠一层阻断框。 |
| 企查查清洗误杀 | 规则/模型将有效介绍判空时，用户仍可通过 **自由文本 + AI 抽标签** 恢复信号；须 **可配置开关与抽样审计**。 |
| 自由文本抽标签失败 | 须 **明确错误文案**、允许用户 **改文本或改填标签** 后重试；**不得** 静默空跑竞品主任务。 |

#### 3.7.3 文档与后续动作

- 表 DDL、API 清单、与 `invested_enterprise_ai_enrich_log` 是否共用任务日志，在 **详细设计 / db.js** 中展开；本文 **§3.5～§3.6** 为产品真源。
- 开发完成后：在 **§十验收** 增加「竞品分析 / 投前项目」用例行，并与 **§8.5、§8.6** 子节交叉引用。

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

#### 4.1.5 `invested_enterprises` 应用字段（与新闻舆情共用表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `data_app_name` | VARCHAR(64) NOT NULL，默认 `'新闻舆情'` | 标识该行监控对象所属应用：`新闻舆情`、`项目挖掘`。接口层与 `users.app_permissions[].app_name` 对齐。 |
| `ai_product_intro` | TEXT，可空 | **产品介绍（AI）**：与融资事件 **产品简介(AI)** 同源管线输出之 `product_intro` 落库；**不覆盖**业务人员维护的非 AI 业务字段。 |
| `ai_industry_tags_display` | VARCHAR(2000)，可空 | **行业标签（AI）**：与融资侧 **`ai_company_tags_display` / `company_tags_display`** 同源解析与展示规则（顿号拼接自有中文词组）。 |
| `ai_industry_tags_json` | JSON，可空 | 与展示列同源的结构化标签，键体系与 §12.10 的 `company_tags` 一致，便于后续检索/阶段 B。 |
| `ai_enrich_status` | VARCHAR(20)，可空 | `pending` / `running` / `success` / `failed` / `skipped`（与融资标准表语义对齐）。 |
| `ai_enrich_at` | DATETIME，可空 | 最近一次 AI 增强完成时间（Asia/Shanghai）。 |
| `ai_enrich_model` | VARCHAR(100)，可空 | 实际调用模型标识快照。 |
| `ai_enrich_version` | VARCHAR(50)，可空 | 管线/提示词版本号（实现常量可与融资侧区分前缀）。 |
| `ai_enrich_error` | VARCHAR(500)，可空 | 最近一次失败摘要（可截断）。 |

**`invested_enterprise_ai_enrich_log`（被投企业 AI 触发与执行日志，追加型）**

- **目的**：与 **`sourcing_financing_ai_enrich_log`** 对称，审计对 **`invested_enterprises`** 发起的每一次 AI 增强（手动、批量、失败重试等）。标准表行上 `ai_enrich_*` 表示**当前最新结果**，日志表保留**历史每次**触发与结果快照（至少含 `result_product_intro`、`result_industry_tags_display`、错误摘要等，字段细则与实现 `db.js` 对齐）。
- **查询入口（首期）**：前端 **「AI 执行日志」** 弹窗按 **`invested_enterprise_id`** 拉取列表；接口 **`GET /api/project-sourcing/invested-enterprises/ai-enrich-logs`**（见 §9.3）。

- 新闻舆情相关定时任务、外部库 **「定时更新」** 同步写入 `invested_enterprises` 时，目标行的 **`data_app_name` 与对应 `enterprise_sync_task.data_app_name` 一致**（新闻舆情任务写新闻舆情域；项目挖掘任务写项目挖掘域）。
- 项目挖掘「被投企业」页面手工新增/导入的记录一律为 **`项目挖掘`**。

**`enterprise_sync_task`（定时更新 SQL 存储）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `data_app_name` | VARCHAR(64) NOT NULL，默认 `'新闻舆情'` | 与上述应用名一致；**同一 `db_config_id` + `created_by` 下按应用各存一条** SQL / Cron，接口通过 `data_app_name` 读写，避免两应用共用一条配置。 |

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

### 8.4 子页面：被投企业（项目挖掘，**2026-5-13**）

- **入口**：见 §3.3 路由；与 **融资事件列表** 同属「项目挖掘」应用下子菜单，权限模型一致。
- **列表列**：在 §3.3「基础」列之外，末尾展示 **产品介绍（AI）**、**行业标签（AI）**、**AI状态**；长文本列交互与融资事件列表一致（省略 + 点击展开可选中复制）。
- **工具栏**：**刷新、批量导入、定时更新、新增** 全员可见（与舆情监控对象对齐部分）；**导出当前页、导出全部** 全员可见；**手动同步、手动 AI 取数、AI 执行日志、批量 AI 取数、重试失败 AI** 仅 **`admin`**（§3.2）。单条 AI 与日志须 **radio 选中一行** 后操作（§12.8）。
- **与融资侧差异（须写清）**：批量/重试的日期维度为 **`invested_enterprises.created_at` 的日历日**（非融资事件的 `event_date`）；去重主键为 **企业全称**（规范化后），而非融资侧的信用代码优先策略。

### 8.5 子页面：竞品分析（Tab1，**2026-5-14**）

- **路由（全路径）**：**`/dashboard/project-sourcing-competitor-analysis`**（React Router 子路径 **`/project-sourcing-competitor-analysis`**，挂在 Dashboard 布局下）。
- **入口**：「项目挖掘」应用菜单 → **「竞品分析」**；权限与 **§3.2**、**§3.5.1** 一致。
- **页面形态**：主表为 **被投企业 × 竞品** 折叠列表；批量竞品入口在 **被投企业列表**（§3.5.9），本页不提供全表跑批。
- **业务真源**：交互与数据规则以 **§3.5、§3.7** 为准。

### 8.6 子页面：投前项目（Tab2，**2026-5-14**）

- **路由（全路径）**：**`/dashboard/project-sourcing-pre-investment`**（子路径 **`/project-sourcing-pre-investment`**）。
- **入口**：「项目挖掘」应用菜单 → **「投前项目」**（菜单文案以产品最终稿为准）。
- **页面形态**：独立列表 + 录入/企查查/AI/竞品按钮；列与 Tab1 **组件复用**（§3.6.5）。
- **业务真源**：以 **§3.6** 为准；竞品前须按 **§3.5.3** 完成 **企查查介绍清洗** 与 **信息不足判定**；不足时 **「竞品匹配—补充业务信息」**（标签与/或自由文本经 **AI 抽标签**）。

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

### 9.3 阶段 A 补充接口（融资信息 AI 增强，**2026-5-14**；被投企业 AI，**2026-5-13**）

> 与当前代码路由前缀对齐时，使用 **`/api/project-sourcing/...`**（若历史文档写 `/api/sourcing/...`，以实际部署为准）。

#### 9.3.1 融资事件 — 单条 AI 增强

- **`POST /api/project-sourcing/events/:id/ai-enrich`（建议路径）**  
  - **作用**：对单条 `sourcing_financing_event`（路径参数 `id` 为标准表主键）触发 **产品简介(AI) / 企业标签(AI)** 生成任务，成功后更新 `ai_product_intro`、`ai_company_tags_json`、`ai_company_tags_display` 及 `ai_enrich_*` 治理字段。  
  - **语义**：与 §12.7 自动入队 **同一套模型、提示词与解析规则**（§12.10）；区别仅为 **触发源** 为人工、且 **粒度为单条**。  
  - **响应**：**推荐 202 Accepted / 同步受理 JSON**（立即返回 `ai_enrich_status=running` 或队列 job_id），由前端刷新列表或短轮询；**不推荐** HTTP 长连接阻塞至模型结束（易超时）。  
  - **权限**：默认与「手动同步」一致，仅 **`admin`**（见 §3.2）；若产品放宽，须新增权限键并回写本文档。  
  - **幂等**：同一 `id` 在 `running` 期间重复点击可返回「处理中」而不重复排队，或按产品选择允许覆盖排队（实现二选一，文档推荐 **去重/拒绝重复提交**）。
  - **日志（强制）**：接口 **一经合法受理**（含幂等拒绝重复排队时的受理响应），即按 §12.12 写入或更新 **触发日志**；不得在「无日志」情况下返回 200。

#### 9.3.2 被投企业（`invested_enterprises`，`data_app_name=项目挖掘`）— AI 与日志

- **`POST /api/project-sourcing/invested-enterprises/:id/ai-enrich`**  
  - **作用**：对单条被投企业（路径参数 `id` 为 `invested_enterprises.id`）触发与 §9.3.1 **同一套** 联网大模型调用与 JSON 解析，结果写入 **`ai_product_intro`、`ai_industry_tags_json`、`ai_industry_tags_display`、`ai_enrich_*`**。模板入参：**`enterprise_full_name` → 企业名称**，**`unified_credit_code`、`project_abbreviation` → 占位符**（空则按 §12.3 口径仍执行）。  
  - **响应 / 权限 / 幂等 / 日志**：同 §9.3.1 原则；日志落 **`invested_enterprise_ai_enrich_log`**（§4.1.5、§12.12.6）。

- **`POST /api/project-sourcing/invested-enterprises/batch-ai-enrich`**（Body：`start_date`、`end_date` 必填；`only_failed` 可选布尔，为 `true` 时仅 **`ai_enrich_status=failed`**）  
  - **作用**：按 **`DATE(created_at)`** 落在区间内筛选 `data_app_name=项目挖掘` 且未删除的行；对 **规范化后的企业全称** 去重后逐条排队执行 AI（实现可为服务端并发波次 + 间隔，与融资侧环境变量如并发度、间隔对齐）。**HTTP 202** 表示已受理。仅 **`admin`**。

- **`GET /api/project-sourcing/invested-enterprises/ai-enrich-logs`**（Query：`invested_enterprise_id` 必填，`page`、`pageSize` 可选）  
  - **作用**：分页返回该被投企业的 AI 执行日志列表，供前端「AI 执行日志」弹窗展示。仅 **`admin`**。

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

13. **（竞品 / 投前规划）**「竞品分析」「投前项目」子菜单可打开对应页面，**路由**分别为 **`/dashboard/project-sourcing-competitor-analysis`**、**`/dashboard/project-sourcing-pre-investment`**（与 **§8.5、§8.6** 一致）；无权限用户不可见入口且受路由守卫拦截。  

14. **（竞品 / 投前规划）**发起竞品任务前：**企查查企业介绍** 须经 **§3.5.3** 清洗，**无效内容不得计入**「已有介绍」；在 **产品介绍(AI)、有效企查查业务介绍、企业标签** 汇总后仍 **信息不足** 的，须 **阻断** 并弹出 **「竞品匹配—补充业务信息」**（**多业务标签** 与 **自由文本 → AI 抽标签后再匹配**，流程见 **§3.5.3**）；取消不发起；补录与抽取结果 **落库** 并写入当次匹配/LLM 上下文。  

15. **（竞品 / 投前规划）**无有效 **统一社会信用代码** 时，**不得以代码主键归并**；须按 **§3.5.3** 对 **`project_abbreviation`** 规范化去重后作为弱键参与匹配与（推荐策略下）落库，UI 对弱键数据有 **「待补码」** 类提示。  

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
| T10 | 前端与 API | 融资事件列表/详情/导出展示 AI 列；**列表页「手动AI取数」单条触发**（§12.8）；接口见 **§9.3.1**；**被投企业页** 导出当前页/全部、手动同步、AI 与日志（§8.4、§9.3.2）；管理端批量重算（建议）；**日志查询入口（建议）** | **待开发**（**2026-5-11**，**2026-5-14** 增补，**2026-5-15** 增补，**2026-5-13** 被投企业页增补） |
| T11 | AI 增强日志表 + 埋点 | 新建 `sourcing_financing_ai_enrich_log`（或等价名），触发即写、结束更新；见 §12.12 | **待开发**（**2026-5-15**） |

---

## 十二、融资信息 AI 增强（阶段 A）— 需求定稿（**2026-5-11 更新**，**2026-5-12 修订**，**2026-5-13 修订**，**2026-5-14 增补**，**2026-5-15 增补**，**2026-5-16 章号调整**）

> **范围**：仅落地 **阶段 A**——在标准表 `sourcing_financing_event` 上增加 AI 生成字段与异步增强管线。**「匹配已投企业 / 同类型企业是否有融资」** 为后续阶段 B，不在本条；阶段 B 将优先消费本条中的 `ai_company_tags_json` 等结构化字段。  
> **后续开发**：以本节与 §4.2 增补字段、§7.4、§9.3、§12.8、§12.10、§12.12 为准实现与验收；**被投企业（`invested_enterprises`）AI** 与 **§4.1.5**、**§9.3.2**、**§12.12.6** 对齐。

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
- **日志（强制）**：所有进入本管线的任务（自动入队、**§9.3.1 / §9.3.2 手动接口**、批量重算）均须按 **§12.12** 落库；**触发时刻**即产生可追溯记录，执行结束后再补齐结果字段。

### 12.8 API 与前端（阶段 A，**2026-5-13 修订**，**2026-5-14 增补**）

- **前端合规（已定稿）**：**不强制**单独横幅或法务长文案；在表头/列名用后缀 **（AI）** 标示机器生成字段即可，例如 **`产品简介(AI)`**、**`企业标签(AI)`**（与库字段 `ai_product_intro`、`ai_company_tags_display` 对应）。可选：详情页脚注一行「由大模型基于公开信息生成」。
- **列表/详情**：在 `ai_enrich_status=success` 时返回上述字段；`ai_company_tags_json` 可默认仅在详情或「分析/匹配」接口返回（**列表不返回 JSON，仅详情返回**）。
- **导出**：导出列名与界面一致，使用「产品简介(AI)」「企业标签(AI)」；JSON 可单独「全量导出」选项。
- **融资事件列表 — 手动 AI 取数（已定稿，2026-5-14）**  
  - **入口**：在 **融资事件列表** 页筛选区操作栏，于「手动同步」**同一行、靠右** 增加 **`手动AI取数`** 按钮（与产品截图标注位置一致；具体像素级布局服从现有 UI 规范）。  
  - **选择**：用户须 **选中恰好一条** 记录后再点击。实现建议：表格增加 **单选列（radio）**；未选、多选时按钮 **禁用**，或点击后全局提示「请选择一条融资事件」。  
  - **动作**：点击后调用 **§9.3.1** 单条触发接口；将选中行的标准表 **`id`** 提交给后端，进入与 §12.7 **相同** 的 AI 增强管线（模型与提示词仍来自系统配置）。**后端在请求被受理的瞬间**须写入 §12.12 日志（含操作人、触发类型 `manual`）。  
  - **体验**：请求 **异步受理**（推荐）：接口快速返回后，该行展示「生成中」或 `ai_enrich_status=running`，完成后用户 **刷新** 或前端 **短轮询** 拉取最新 `ai_*`；失败时展示 `ai_enrich_error` 可读摘要。  
  - **可选二次确认**：为防止误触，可在点击后弹出轻量确认框（文案如「确认为当前企业重新拉取 AI 简介与标签？」）。  
  - **权限**：默认 **仅 `admin`**，与「手动同步」一致（§3.2）；若后续对投资经理开放，须增加显式权限点并更新本文档。  
- **项目挖掘 — 被投企业列表（2026-5-13）**  
  - **入口**：「项目挖掘」→「被投企业」独立页（非舆情 Tab）。  
  - **导出**：**导出当前页 / 导出全部**（XLSX），列与 **`GET /api/enterprises/export`** 在项目挖掘口径下一致；全部导出按筛选条件分页请求 **`GET /api/enterprises`** 后合并。  
  - **手动同步**：与融资事件页相同，调用 **`POST /api/project-sourcing/sync`**（配置 + 融资日期区间），见 §3.3。  
  - **手动 AI / 日志 / 批量 / 重试失败**：交互与融资事件列表 **同一范式**（radio 选一行、`admin`、异步 **202**）；接口见 **§9.3.2**；日志表见 **§12.12.6**。批量日期口径为 **`created_at`**，见 §8.4。  
  - **权限**：默认 **仅 `admin`**（§3.2）。  
- **管理端（建议）**：按筛选条件「批量重算 AI 增强」、单条重试；仅 `admin` 或项目挖掘配置权限角色可操作。

### 12.9 验收标准（阶段 A）

1. DDL 与注释与 §4.2 增补字段一致，迁移可重复执行。  
2. 新入库记录在规则层完成后自动进入 AI 增强队列；不阻塞原同步接口 SLA。  
3. 提示词与模型均可仅通过 **系统管理-AI 配置** 调整，代码无硬编码密钥与提示词正文。  
4. 成功样例：`ai_product_intro` 非空，且以**具体产品/产品线类型**为主，无明显工商/融资史堆砌；`ai_company_tags_display` 为顿号分隔的**自有中文词组**，无股东/上市类噪音；`ai_company_tags_json` 通过 Schema 校验且与 **§12.10** 负面清单一致。  
5. 失败样例有 `ai_enrich_error` 与任务日志可查；重试耗尽后为 `failed` 且不无限重跑。  
6. 列表在数据未就绪时展示占位（如「-」或「生成中」），不报错。  
7. **手动 AI 取数**：`admin` 在选中单条后可成功提交；处理完成后该行 **产品简介(AI)**、**企业标签(AI)** 更新且与 §12.10 口径一致；`running` 期间重复提交行为符合 §9.3.1 幂等约定。  
8. **日志**：任意一次触发（手动接口、自动入队、批量重算）在 §12.12 表中 **可查**；至少能按 `financing_event_id`、时间窗、`trigger_type`、操作人筛选；失败记录含错误摘要。  
9. **被投企业（项目挖掘）**：`admin` 在「被投企业」页可完成 §8.4 所列导出与 AI 操作；非管理员无行选与 AI 工具栏。手动 AI 成功后 **`产品介绍（AI）`**、**`行业标签（AI）`** 与 `ai_enrich_status` 更新；**`GET .../invested-enterprises/ai-enrich-logs`** 可拉取对应 `invested_enterprise_id` 的日志行；批量/重试失败行为与 §9.3.2 一致。

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

**被投企业（`invested_enterprises`，`data_app_name=项目挖掘`）**：同一套模型 JSON 落库时，`product_intro` → **`ai_product_intro`**（列表列名 **产品介绍（AI）**）；`company_tags` / `company_tags_display` → **`ai_industry_tags_json`** / **`ai_industry_tags_display`**（列表列名 **行业标签（AI）**），与融资侧字段名区分仅为表结构历史命名。

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

> **目的**：审计「谁在何时、因何种触发方式、对哪一条 **融资标准表** 或 **被投企业** 记录」发起了 AI 增强；支撑排障、幂等争议与成本复盘。与 **`sourcing_financing_event.ai_enrich_*`** / **`invested_enterprises.ai_enrich_*`** 字段互补：**行上字段**表示当前最新结果，**日志表**保留历史每一次触发与执行过程（融资侧见 **`sourcing_financing_ai_enrich_log`**，被投企业侧见 **`invested_enterprise_ai_enrich_log`**，§12.12.6）。

#### 12.12.1 何时写日志

- **触发瞬间（强制）**：以下任一入口 **成功受理** 即写入一条日志（或插入主键后再更新）：  
  - **手动（融资）**：§9.3.1 `POST .../events/:id/ai-enrich`；  
  - **手动（被投企业）**：§9.3.2 `POST .../invested-enterprises/:id/ai-enrich` → **`invested_enterprise_ai_enrich_log`**（见 §12.12.6）；  
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

#### 12.12.6 被投企业侧日志表 `invested_enterprise_ai_enrich_log`（**2026-5-13**）

- **关联**：`invested_enterprise_id` → `invested_enterprises.id`（`data_app_name=项目挖掘`）。  
- **触发类型建议**：与实现对齐，如 `manual_api`、`batch_date_range`、`batch_retry_failed` 等。  
- **结果快照**：成功任务建议写入 **`result_product_intro`、`result_industry_tags_display`**（与当次写入标准表字段一致，便于审计历史）。  
- **索引建议**：`(invested_enterprise_id, triggered_at DESC)`。  
- **查询**：首期由前端弹窗调用 **§9.3.2** `GET .../ai-enrich-logs`；与 §12.12.4 管理端统一日志 UI 的建议一致，可二期合并筛选维度。

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

