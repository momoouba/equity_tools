---
name: mysql-ddl-system-fields
description: >-
  Mandatory MySQL DDL system-field standard for this repo (F_Id, F_CreatorTime, F_LastModifyTime, F_DeleteMark/F_DeleteTime/F_DeleteUserId, F_CreatorUserId/F_LastModifyUserId). Agent MUST read and apply before any CREATE TABLE, ALTER TABLE migration, db.js initializeTables change, schema design, or route SQL involving new tables. Use when user mentions 建表、新增表、表结构、字段设计、逻辑删除、软删除、系统字段、DDL、迁移表、database table, or any requirement that needs a new database table—even if the user does not name this skill.
---

# MySQL 建表：F_* 系统字段标准

在本仓库（equity_news / news）中新增或修改 **业务表、配置表、需在后台删除且保留数据的表** 时，除需求文档列出的业务字段外，**必须**按下列 **F_* PascalCase** 命名与类型实现系统字段。**后续不管需求文档有没有写这些字段，都要求强制加上，并按照本标准执行。**

**Agent 默认行为**：只要任务涉及新建表、改表结构、在 `db.js` 写迁移、或为新模块设计 DDL，**必须先读取并遵循本 skill**，无需用户手动 `@` 或 `/` 触发。

## 命名体系说明

| 类别 | 命名风格 | 示例 |
|------|---------|------|
| **系统/审计/逻辑删除字段** | **`F_` + PascalCase** | `F_Id`, `F_CreatorTime`, `F_DeleteMark` |
| **业务字段** | snake_case | `project_name`, `app_id`, `is_active` |
| **外键引用列（指向他表主键）** | snake_case + 表名/语义 | `app_id`, `ipo_project_f_id`（指向 `ipo_project.F_Id`） |

**禁止**在新表中使用已废弃命名：`f_id`、`id`（作系统主键时）、`is_deleted`、`deleted_at`、`deleted_by`、`delete_mark`、`created_at`、`updated_at`、`created_by`、`updated_by`（作系统审计字段时）。

## 何时必须应用本标准

- 新建 `CREATE TABLE`（含 `news/server/db.js` 内 `initializeTables`、迁移脚本、手工 SQL）。
- 为现有表补充「可逻辑删除」能力。
- 评审他人 DDL：若缺字段或沿用旧列名，须指出并按本标准补齐。
- 新需求/PRD 中出现「需要一张表」但未列系统字段时，**仍须补齐**。

**例外（可不加强制删除三连）：** 纯关联表若采用物理级联删除且无单独「删除一行配置」语义；或明确的纯日志追加表仅 INSERT、永不 UPDATE 删标。若存在用户可见列表且存在「删除」按钮，**不适用例外**，必须 `F_DeleteMark` / `F_DeleteTime` / `F_DeleteUserId` 三连。

## 1. 主键（默认）

```sql
F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列'
```

- 与项目 `generateId` 规则一致；外键引用 **`users(F_Id)`** 及其他配置表主键时类型为 **`VARCHAR(19)`**。
- **例外**：与交易所/外部 bigint 主键对齐的专用表（如 `ipo_progress`、`ipo_project`）可沿用 **`F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY`**；新建表若无此类约束，**优先 `VARCHAR(19)`**。
- 业绩看板 `b_*` 业务表主键同样为 **`F_Id`**（见 `news/server/routes/业绩看板应用/version.js`）。

## 2. 时间戳（强制）

所有新建业务表默认包含：

```sql
F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
```

- 类型固定 **`TIMESTAMP`**，默认值与 `ON UPDATE` 行为与上保持一致（与 `news_interface_config`、`external_db_config`、`users` 等对齐）。
- 部分历史表用 **`DATETIME`** 表示创建时间（如 `ipo_project.F_CreatorTime`）；**新建表优先 TIMESTAMP**。

## 3. 逻辑删除三件套（强制，命名与类型固定）

凡表支持「删除后列表不可见、数据仍保留」：

```sql
F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
F_DeleteTime DATETIME NULL COMMENT '删除时间',
F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID',
FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
```

要求：

- **`F_DeleteMark`**：仅 `0` / `1`。**禁止** `is_deleted`、`delete_mark`。
- **`F_DeleteTime`**：**禁止** `deleted_at`、`delete_time`（snake_case 旧名）。
- **`F_DeleteUserId`**：**禁止** `deleted_by`、`delete_user_id`（snake_case 旧名）。
- 外键指向 **`users(F_Id)`**，`ON DELETE SET NULL`。
- 列表与统计查询默认 **`WHERE F_DeleteMark = 0`**；软删除为 **`UPDATE`** 置 `F_DeleteMark = 1`、`F_DeleteTime = NOW()`、`F_DeleteUserId = ?`，**禁止**对该类配置行物理 `DELETE`（除非明确要求清理测试数据且已知后果）。

建议索引：`KEY idx_<表名简写>_delete (F_DeleteMark)` 或与高频组合条件共建复合索引。

## 4. 操作人审计（配置类/可编辑业务表推荐）

与 `external_db_config`、`invested_enterprises` 一致：

```sql
F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人ID',
F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改人ID',
FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL
```

类型一律 **`VARCHAR(19)`**，与 **`users.F_Id`** 一致。**禁止** `created_by`、`updated_by` 作为系统审计字段名。

## 5. 完整模板（可逻辑删除的配置/业务表）

```sql
CREATE TABLE IF NOT EXISTS example_config (
  F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
  -- 业务字段（snake_case）...
  is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
  F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
  F_DeleteTime DATETIME NULL COMMENT '删除时间',
  F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID',
  F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人ID',
  F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改人ID',
  F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  KEY idx_example_config_delete (F_DeleteMark),
  FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
  FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
  FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='示例配置表';
```

`db.js` 中 **`users` 表必须先于** 带上述外键的表创建。

## 6. 旧库迁移

若发现下列旧命名，须迁移至 F_* 标准（参考 `db.js` 中 `ipo_project` / `ipo_project_progress` 的 `f_id → F_Id` 迁移，及 **`migrateSoftDeleteToDeleteMarkConvention`** 的等价逻辑，目标字段名为 **`F_DeleteMark` 等**）：

| 旧名 | 新名 |
|------|------|
| `f_id` / `id`（系统主键） | `F_Id` |
| `f_create_date` / `created_at` | `F_CreatorTime` |
| `f_update_time` / `updated_at` | `F_LastModifyTime`（或业务专用的 `F_UpdateTime` / `biz_update_time`，勿与系统更新时间混用） |
| `is_deleted` / `delete_mark` | `F_DeleteMark` |
| `deleted_at` / `delete_time` | `F_DeleteTime` |
| `deleted_by` / `delete_user_id` | `F_DeleteUserId` |
| `created_by` | `F_CreatorUserId` |
| `updated_by` | `F_LastModifyUserId` |

迁移后，应用层 SQL、路由全部改为 **F_* 字段名**。

## 7. 路由层约定

与 `news/server/routes/externalDb.js` 对齐：

- 列表：`WHERE F_DeleteMark = 0`
- 详情：同上
- 软删：`UPDATE ... SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ? WHERE F_Id = ?`
- API 返回可将 `F_Id AS id` 映射给前端，但 **DDL 与 SQL 层使用 `F_Id`**

## 8. 实施检查清单（Agent 自检）

1. DDL 是否包含 **`F_CreatorTime` / `F_LastModifyTime`**（类型与默认值符合上文）。
2. 主键是否为 **`F_Id`**（类型符合 §1）。
3. 是否需要逻辑删除：若是，是否包含 **`F_DeleteMark` / `F_DeleteTime` / `F_DeleteUserId`** 及 **`F_DeleteUserId → users(F_Id)`** 外键。
4. 配置/可编辑表是否包含 **`F_CreatorUserId` / `F_LastModifyUserId`** 及外键。
5. `db.js` 创建顺序：`users` 是否已存在。
6. Express 路由：列表/详情是否 **`F_DeleteMark = 0`**；删除是否为 **UPDATE 三连**。
7. 前端变更日志等若展示字段名，新字段用 **F_***；历史日志中的旧字段名可保留映射。

## 9. 参考实现位置

勿照搬无关业务列，仅对照系统字段写法：

- `news/server/db.js`：`users`、`applications`、`news_interface_config`、`external_db_config`、`invested_enterprises`、`ipo_project` 等。
- 路由：`news/server/routes/externalDb.js`、`news/server/routes/system.js`。
- 业绩看板：`news/server/routes/业绩看板应用/version.js`（`F_Id` 生成与注入 `F_CreatorUserId` / `F_CreatorTime`）。
