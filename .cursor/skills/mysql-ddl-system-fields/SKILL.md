---
name: mysql-ddl-system-fields
description: >-
  Defines mandatory MySQL DDL field names and types for new tables and db.js migrations in this repo (audit timestamps, logical delete trio delete_mark/delete_time/delete_user_id, optional created_by/updated_by). Use when adding CREATE TABLE, altering schemas, writing db.initializeTables fragments, migrations, or when the user mentions 建表、新增表、表结构、字段设计、逻辑删除、软删除、系统字段.
---

# MySQL 建表：系统管理与逻辑删除字段标准

在本仓库（equity_news / news）中新增或修改 **业务表、配置表、需在后台删除且保留数据的表** 时，除需求文档列出的业务字段外，**必须**按下列类型与命名实现系统字段。**后续不管文档有没有写这些字段，都要求强制加上，并按照标准执行。**

## 何时必须应用本标准

- 新建 `CREATE TABLE`（含 `news/server/db.js` 内 `initializeTables`、迁移脚本、手工 SQL）。
- 为现有表补充「可逻辑删除」能力。
- 评审他人 DDL：若缺字段或沿用旧列名，须指出并按本标准补齐。

**例外（可不加强制三连删除字段）：** 纯关联表若采用物理级联删除且无单独「删除一行配置」语义；或明确的纯日志追加表仅 INSERT、永不 UPDATE 删标。若存在用户可见列表且存在「删除」按钮，**不适用例外**，必须三连字段。

## 1. 主键（默认）

- **`id VARCHAR(19) PRIMARY KEY`**，注释建议标明与项目 ID 生成规则一致（`generateId`）。
- 若沿用数据库自增 `BIGINT` 等既有表结构，不在此强制改为 VARCHAR，但**新建表**优先 VARCHAR(19)。

## 2. 时间戳（强制）

所有新建业务表默认包含：

```sql
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
```

类型固定为 **`TIMESTAMP`**，默认值与 `ON UPDATE` 行为与上保持一致（与现有 `news_interface_config`、`external_db_config` 等对齐）。

## 3. 逻辑删除三件套（强制，命名与类型固定）

凡表支持「删除后列表不可见、数据仍保留」：

```sql
delete_mark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除',
delete_time DATETIME NULL COMMENT '删除时间',
delete_user_id VARCHAR(19) NULL COMMENT '删除人用户ID',
CONSTRAINT fk_<表名简写>_delete_user FOREIGN KEY (delete_user_id) REFERENCES users(id) ON DELETE SET NULL
```

要求：

- **`delete_mark`**：仅 `0` / `1`，**禁止**再使用 `is_deleted`。
- **`delete_time`**：**禁止**再使用 `deleted_at`。
- **`delete_user_id`**：**禁止**再使用 `deleted_by`。
- 外键指向 **`users(id)`**，`ON DELETE SET NULL`。
- 列表与统计查询默认 **`WHERE delete_mark = 0`**（或 `AND delete_mark = 0`）；软删除操作为 **`UPDATE`** 置 `delete_mark = 1`、`delete_time = NOW()`、`delete_user_id = ?`，**禁止**对该类配置行物理 `DELETE`（除非明确要求清理测试数据且已知后果）。

建议在常用筛选上增加索引，例如：`KEY idx_delete_mark (delete_mark)` 或与高频组合条件共建复合索引。

## 4. 操作人审计（配置类表推荐）

与 `external_db_config` 一致，需要记录创建人/修改人时：

```sql
created_by VARCHAR(19) NULL COMMENT '创建人ID',
updated_by VARCHAR(19) NULL COMMENT '修改人ID',
FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
```

类型一律 **`VARCHAR(19)`**，与 `users.id` 一致。

## 5. 旧库迁移

若发现 **`is_deleted` / `deleted_at` / `deleted_by`**：

- 在 `db.js` 中沿用既有 **`migrateSoftDeleteToDeleteMarkConvention`** 模式迁移至三连字段；或对该表编写等价迁移。
- 应用层 SQL、路由全部改为 **`delete_mark` / `delete_time` / `delete_user_id`**。

## 6. 实施检查清单（Agent 自检）

1. DDL 是否包含 **`created_at` / `updated_at`**（类型与默认值符合上文）。
2. 是否需要逻辑删除：若是，是否包含 **`delete_mark` / `delete_time` / `delete_user_id`** 及 **`delete_user_id` → users** 外键。
3. `db.js` 创建顺序是否依赖 `users` 表已存在（外键）。
4. 对应 **Express 路由**：列表/详情是否过滤 **`delete_mark = 0`**；删除是否为 **UPDATE 三连字段**。
5. 前端变更日志等若展示字段名，是否兼容 **`delete_mark` / `delete_time` / `delete_user_id`**（历史日志中的旧字段名可保留映射）。

## 7. 参考实现位置

在仓库中查阅对齐示例（勿照搬无关业务列，仅对照系统字段写法）：

- `news/server/db.js`：`news_interface_config`、`external_db_config`、`recipient_management`（迁移后）等。
- 路由：`news/server/routes/system.js`、`news/server/routes/externalDb.js` 中的软删除与列表过滤。
