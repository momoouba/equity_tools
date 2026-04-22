# 外部数据库连接及数据同步功能说明

## 功能概述

本系统提供了外部数据库连接和数据同步功能，允许用户连接外部MySQL数据库，并通过SQL查询语句定时或手动同步数据到被投企业表中。

## 一、外部数据库连接配置

### 1.1 功能位置

在系统配置页面中，新增了"数据库连接"Tab页，用于管理外部数据库连接配置。

### 1.2 功能特性

- **数据库类型支持**：当前仅支持MySQL数据库
- **连接配置**：支持配置多个外部数据库连接
- **连接测试**：提供连接测试功能，验证配置是否正确
- **启用/禁用**：支持启用或禁用数据库连接配置
- **列表管理**：以列表形式展示所有数据库配置，支持分页

### 1.3 配置字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| 配置名称 | 文本 | 是 | 为数据库连接起一个便于识别的名称 |
| 数据库类型 | 下拉 | 是 | 当前仅支持MySQL |
| 主机地址 | 文本 | 是 | 数据库服务器地址，如：localhost 或 192.168.1.100 |
| 端口 | 数字 | 是 | 数据库端口，MySQL默认3306 |
| 数据库名 | 文本 | 是 | 要连接的数据库名称 |
| 用户名 | 文本 | 是 | 数据库用户名 |
| 密码 | 密码 | 是 | 数据库密码（编辑时留空则不更新） |
| 启用状态 | 复选框 | 否 | 是否启用此配置，默认启用 |

### 1.4 操作说明

#### 新增配置
1. 点击"新增配置"按钮
2. 填写数据库连接信息
3. 点击"测试连接"验证配置是否正确
4. 点击"创建"保存配置

#### 编辑配置
1. 在列表中点击"编辑"按钮
2. 修改配置信息（配置名称和数据库类型不可修改）
3. 如需更新密码，输入新密码；否则留空
4. 点击"测试连接"验证配置
5. 点击"更新"保存修改

#### 测试连接
- 在新增或编辑配置时，可以点击"测试连接"按钮验证数据库连接是否正常
- 测试成功会显示"数据库连接测试成功"
- 测试失败会显示具体错误信息

#### 删除配置
1. 在列表中点击"删除"按钮
2. 确认删除操作
3. 配置将被软删除（is_deleted=1）

### 1.5 API接口

#### 获取配置列表
```
GET /api/system/database-configs?page=1&pageSize=10
```

#### 获取单个配置
```
GET /api/system/database-config/:id
```

#### 创建配置
```
POST /api/system/database-config
Body: {
  name: string,
  db_type: 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
  is_active: boolean
}
```

#### 更新配置
```
PUT /api/system/database-config/:id
Body: {
  name?: string,
  host?: string,
  port?: number,
  user?: string,
  password?: string,
  database?: string,
  is_active?: boolean
}
```

#### 删除配置
```
DELETE /api/system/database-config/:id
```

#### 测试连接（表单数据）
```
POST /api/system/database-config/test
Body: {
  db_type: 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string
}
```

#### 测试连接（已保存配置）
```
POST /api/system/database-config/:id/test
```

## 二、被投企业数据定时同步

### 2.1 功能位置

在被投企业管理页面，新增了"定时更新"按钮，点击后弹出配置窗口。

### 2.2 功能特性

- **数据库选择**：从已配置的外部数据库中选择一个
- **SQL查询**：输入SELECT查询语句，查询结果将同步到被投企业表
- **定时执行**：设置每天执行的时间，系统将按Cron表达式自动执行
- **手动执行**：支持手动触发数据同步，无需等待定时任务
- **数据映射**：自动将查询结果映射到被投企业表的字段

### 2.3 配置字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| 选择数据库 | 下拉 | 是 | 从已配置的外部数据库中选择 |
| SQL查询语句 | 文本域 | 是 | 必须是SELECT查询语句 |
| 定时更新时间 | 时间选择 | 是 | 设置每天执行的时间，格式：HH:mm |
| 任务描述 | 文本 | 否 | 任务的描述信息 |

### 2.4 数据字段映射

SQL查询结果需要包含以下字段（支持不同的字段名格式）：

| 目标字段 | 支持的源字段名 |
|---------|---------------|
| project_number | project_number, projectNumber |
| project_abbreviation | project_abbreviation, projectAbbreviation, project_abbr |
| enterprise_full_name | enterprise_full_name, enterpriseFullName, enterprise_name, enterpriseName |
| unified_credit_code | unified_credit_code, unifiedCreditCode, credit_code |
| wechat_official_account_id | wechat_official_account_id, wechatOfficialAccountId, wechat_account_id |
| official_website | official_website, officialWebsite, website |
| exit_status | exit_status, exitStatus | 支持值：未退出、部分退出、完全退出、继续观察、不再观察、已上市。注意：状态为"已上市"、"完全退出"或"不再观察"的企业不会被企查查接口抓取新闻数据 |

**注意**：
- `enterprise_full_name`（被投企业全称）是必填字段，缺少此字段的数据将被跳过
- `project_number`（项目编号）不需要在SQL中提供，系统会根据规则自动生成
- `unified_credit_code`（统一社会信用代码）用于判断数据是否已存在：
  - 如果统一信用代码一致，只更新项目简称和企业全称
  - 如果统一信用代码不一致或不存在，新增数据
- 其他字段可以为空

### 2.5 操作说明

#### 保存定时任务
1. 选择外部数据库
   - **如果该数据库配置已有保存的任务，系统会自动加载已保存的SQL、时间和描述**
2. 输入SQL查询语句（必须以SELECT或WITH开头，支持WITH语句的复杂查询）
   - 如果已有保存的任务，SQL会自动填充，可以修改
3. 设置定时更新时间
   - 如果已有保存的任务，时间会自动填充，可以修改
4. 可选：填写任务描述
5. 点击"保存"按钮
6. 系统将保存任务配置（**SQL查询语句会保存到数据库中**），并在指定时间自动执行

**注意**：
- 每个数据库配置只能有一个定时任务，如果已存在任务，保存操作将更新现有任务
- SQL查询语句会保存到`enterprise_sync_task`表的`sql_query`字段中
- 定时任务执行时会自动使用数据库中保存的SQL

#### 手动执行
1. 选择外部数据库
   - **如果该数据库配置已有保存的任务，系统会自动加载已保存的SQL**
2. （可选）输入SQL查询语句
   - 如果SQL输入框为空，系统会使用已保存的SQL执行
   - 如果输入了新的SQL，则使用新输入的SQL执行
3. 点击"手动执行"按钮
4. 系统立即执行数据同步
5. 执行完成后显示结果（同步条数、新增条数、更新条数）

**注意**：
- 如果数据库配置已有保存的任务，选择数据库后会自动加载已保存的SQL
- 手动执行时，如果SQL输入框为空，系统会从数据库读取已保存的SQL执行
- 如果SQL输入框有内容，则优先使用输入框中的SQL

#### 取消
点击"取消"按钮关闭配置窗口，不保存任何更改。

### 2.6 数据同步逻辑

1. **查询外部数据库**：使用配置的SQL语句查询外部数据库
2. **数据映射**：将查询结果映射到被投企业表的字段
3. **去重判断**：根据`unified_credit_code`（统一社会信用代码）判断数据是否已存在
4. **更新或插入**：
   - **如果统一社会信用代码一致**（且不为空）：
     - 更新现有记录的以下字段：
       - `project_abbreviation`（项目简称）
       - `enterprise_full_name`（被投企业全称）
       - `wechat_official_account_id`（企业公众号ID）
       - `official_website`（企业官网）
       - `exit_status`（退出状态）
     - 其他字段保持不变（如项目编号、创建人等）
   - **如果统一社会信用代码不一致或不存在**：
     - 新增数据到`invested_enterprises`表
     - 系统自动根据规则生成项目编号（格式：P+年月日+5位序列号）
     - 插入所有字段数据
5. **记录执行结果**：更新任务的执行时间、执行状态和执行结果

**重要说明**：
- 同步逻辑基于统一社会信用代码进行匹配
- 如果外部数据中的统一社会信用代码为空，系统会将其作为新数据插入
- 更新操作会更新项目简称、企业全称、企业公众号ID、企业官网和退出状态
- 新增数据会自动生成项目编号，无需在SQL查询中包含项目编号字段

### 2.7 Cron表达式说明

系统将时间选择器（HH:mm格式）转换为Cron表达式：
- 格式：`分钟 小时 * * *`
- 示例：`00:00` → `0 0 * * *`（每天凌晨执行）
- 示例：`14:30` → `30 14 * * *`（每天下午2:30执行）

### 2.8 API接口

#### 创建/更新定时任务
```
POST /api/enterprises/sync-task
Body: {
  db_config_id: string,
  sql_query: string,
  cron_expression: string,
  description?: string
}
```

**说明**：
- 如果该数据库配置已存在任务，则更新现有任务
- 如果不存在，则创建新任务

#### 手动执行同步
```
POST /api/enterprises/sync-task/execute
Body: {
  db_config_id: string,
  sql_query?: string  // 可选，如果未提供则从数据库读取已保存的SQL
}
```

**说明**：
- `sql_query`字段为可选，如果未提供或为空，系统会从`enterprise_sync_task`表中读取该数据库配置已保存的SQL
- 如果该数据库配置没有已保存的任务，则必须提供`sql_query`

#### 根据数据库配置ID获取已保存的任务
```
GET /api/enterprises/sync-task/by-db/:db_config_id
```

**响应示例**：
```json
{
  "success": true,
  "data": {
    "id": "20240101120000001",
    "db_config_id": "20240101120000002",
    "sql_query": "SELECT ...",
    "cron_expression": "0 0 * * *",
    "description": "每天凌晨同步被投企业数据",
    "is_active": 1,
    "last_execution_time": "2024-01-15 00:00:00",
    "last_execution_status": "success",
    "execution_count": 15
  }
}
```

**响应示例**：
```json
{
  "success": true,
  "message": "同步完成：共处理 10 条数据，新增 5 条，更新 5 条",
  "synced": 10,
  "updated": 5,
  "inserted": 5
}
```

### 2.9 定时任务调度

- **自动启动**：服务器启动时，系统会自动加载所有启用的定时任务
- **时区设置**：所有定时任务使用`Asia/Shanghai`时区
- **任务状态**：系统会记录每次执行的时间、状态和结果
- **任务管理**：任务保存在`enterprise_sync_task`表中

### 2.10 数据库表结构

#### enterprise_sync_task 表

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | VARCHAR(19) | 任务ID |
| db_config_id | VARCHAR(19) | 外部数据库配置ID |
| sql_query | TEXT | SQL查询语句 |
| cron_expression | VARCHAR(100) | Cron表达式 |
| description | VARCHAR(500) | 任务描述 |
| is_active | TINYINT(1) | 是否启用 |
| last_execution_time | DATETIME | 最后执行时间 |
| last_execution_status | VARCHAR(20) | 最后执行状态：success/failed/pending |
| last_execution_message | TEXT | 最后执行结果消息 |
| execution_count | INT | 执行次数 |
| created_by | VARCHAR(19) | 创建人ID |
| created_at | TIMESTAMP | 创建时间 |
| updated_by | VARCHAR(19) | 修改人ID |
| updated_at | TIMESTAMP | 更新时间 |

## 三、使用示例

### 3.1 配置外部数据库连接

1. 进入"系统配置" → "数据库连接"
2. 点击"新增配置"
3. 填写信息：
   - 配置名称：生产数据库
   - 数据库类型：MySQL
   - 主机地址：192.168.1.100
   - 端口：3306
   - 数据库名：enterprise_db
   - 用户名：sync_user
   - 密码：******
4. 点击"测试连接"验证
5. 点击"创建"保存

### 3.2 配置定时同步任务

1. 进入"被投企业管理"
2. 点击"定时更新"按钮
3. 选择数据库：生产数据库
4. 输入SQL：
   ```sql
   SELECT 
     project_abbreviation,
     enterprise_full_name,
     unified_credit_code,
     wechat_official_account_id,
     official_website,
     exit_status
   FROM enterprises
   WHERE status = 'active'
   ```
   
   **支持WITH语句的复杂查询示例**：
   ```sql
   WITH active_enterprises AS (
     SELECT 
       project_abbreviation,
       enterprise_full_name,
       unified_credit_code,
       wechat_official_account_id,
       official_website,
       exit_status
     FROM enterprises
     WHERE status = 'active'
   ),
   filtered_enterprises AS (
     SELECT *
     FROM active_enterprises
     WHERE exit_status NOT IN ('完全退出', '已上市')
   )
   SELECT * FROM filtered_enterprises
   ```
   
   **注意**：
   - SQL查询中不需要包含`project_number`字段，系统会自动生成项目编号
   - 支持WITH语句（CTE，公共表表达式）的复杂查询
   - SQL语句必须以SELECT或WITH开头
5. 设置时间：00:00（每天凌晨执行）
6. 任务描述：每天凌晨同步活跃企业数据
7. 点击"保存"

### 3.3 手动执行同步

1. 在定时更新配置窗口中
2. 选择数据库并输入SQL
3. 点击"手动执行"
4. 等待执行完成，查看结果

## 四、注意事项

1. **SQL安全**：系统只允许执行SELECT查询语句，不允许执行INSERT、UPDATE、DELETE等修改操作
2. **数据验证**：缺少必填字段（enterprise_full_name）的数据将被跳过
3. **去重逻辑**：系统根据企业全称和统一信用代码判断数据是否重复
4. **任务唯一性**：每个数据库配置只能有一个定时任务
5. **连接池管理**：系统会自动管理外部数据库连接池，无需手动维护
6. **错误处理**：如果同步过程中出现错误，系统会记录错误信息，但不会中断其他数据的处理
7. **性能考虑**：建议SQL查询语句添加适当的WHERE条件，避免查询过多数据

## 五、故障排除

### 5.1 数据库连接失败

**问题**：测试连接时提示连接失败

**解决方案**：
1. 检查数据库服务器是否运行
2. 检查主机地址、端口是否正确
3. 检查用户名、密码是否正确
4. 检查数据库名是否存在
5. 检查网络连接是否正常
6. 检查防火墙设置

### 5.2 SQL查询失败

**问题**：执行同步时提示SQL查询失败

**解决方案**：
1. 检查SQL语句语法是否正确
2. 检查SQL中引用的表和字段是否存在
3. 检查数据库用户是否有查询权限
4. 检查SQL是否以SELECT开头

### 5.3 数据同步失败

**问题**：部分数据同步失败

**解决方案**：
1. 检查数据是否包含必填字段（enterprise_full_name）
2. 检查字段映射是否正确
3. 查看系统日志获取详细错误信息
4. 检查目标表结构是否正常

### 5.4 定时任务未执行

**问题**：定时任务到了时间没有执行

**解决方案**：
1. 检查任务是否启用（is_active=1）
2. 检查数据库配置是否启用
3. 检查Cron表达式是否正确
4. 查看服务器日志确认任务是否已加载
5. 重启服务器重新加载任务

## 六、技术实现

### 6.1 技术栈

- **前端**：React + Vite
- **后端**：Node.js + Express
- **数据库**：MySQL 8.0+
- **定时任务**：node-cron
- **数据库驱动**：mysql2

### 6.2 核心文件

- **前端组件**：
  - `client/src/pages/DatabaseConfig.jsx` - 数据库连接配置组件
  - `client/src/pages/EnterpriseSyncModal.jsx` - 定时更新配置弹窗
  - `client/src/pages/EnterpriseManagement.jsx` - 被投企业管理页面

- **后端路由**：
  - `server/routes/system.js` - 数据库连接配置API
  - `server/routes/enterprises.js` - 数据同步任务API

- **工具类**：
  - `server/utils/externalDb.js` - 外部数据库连接管理
  - `server/utils/enterpriseSyncTasks.js` - 定时任务调度管理

- **数据库表**：
  - `external_db_config` - 外部数据库配置表
  - `enterprise_sync_task` - 企业同步任务表

### 6.3 定时任务调度流程

1. 服务器启动时，调用`initializeEnterpriseSyncTasks()`
2. 从数据库加载所有启用的任务
3. 为每个任务创建Cron定时任务
4. 定时任务触发时，执行`executeEnterpriseSyncTask()`
5. 执行SQL查询，获取外部数据
6. 映射数据并同步到被投企业表
7. 更新任务执行记录

## 七、更新日志

### v1.0.0 (2024-01-XX)

- 新增外部数据库连接配置功能
- 新增被投企业数据定时同步功能
- 支持MySQL数据库连接
- 支持定时任务和手动执行
- 支持数据自动映射和去重

---

**文档版本**：v1.0.0  
**最后更新**：2024-01-XX  
**维护人员**：系统开发团队

