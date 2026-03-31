---
name: new-app-delivery-planning
description: Plans and executes adding a new application module in this repo end-to-end. Use when user asks to 新增应用, 新模块立项, 规划开发路径, 设计开发逻辑, or asks how to add app_id/app_name with backend, frontend, permissions, and scheduled tasks.
---

# New App Delivery Planning

Use this skill when the user wants to add a new application in this project and needs a practical build path.

## Quick Start

When triggered, produce and follow this sequence:

1. Create requirement folder and spec file under `news/`.
2. Clarify app scope and naming.
3. Define canonical app metadata and migration impact.
4. Plan backend changes (DB, routes, utils, permissions).
5. Plan frontend changes (page, menu, API client, settings).
6. Plan task scheduling/email/report side effects.
7. Provide verification checklist and rollout order.

Do not stop at architecture notes only; give concrete file-level implementation path.

## Phase 1: Scope Definition

Before technical design, create requirement docs in repo:

- Directory: `news/<app_name>/`
- Main spec file: `news/<app_name>/<app_name>需求.md`
- Optional files: `news/<app_name>/接口清单.md`, `news/<app_name>/测试用例.md`

The technical plan must reference these paths first.

Then collect or infer:

- App Chinese name (`app_name`) and stable canonical `app_id` (19-digit string).
- Core business objects and lifecycle (create/update/query/delete/sync).
- Roles and permission boundaries (admin/operator/viewer).
- Whether app needs scheduled sync, email digest, external crawler/API.
- Whether it is isolated or reuses existing shared tables.

If key info is missing, ask only the minimum required questions.

## Phase 2: Canonical App Registration

Always plan canonical app registration first to avoid FK drift:

- Add app constants in DB init canonical map (same pattern as existing apps).
- Ensure migration handles:
  - `byId exists` (name fix path)
  - `byName exists but id differs` (safe remap path)
  - fresh insert path
- Remap all `app_id` relations before deleting old rows.

Default related tables to check:

- `membership_levels`
- `email_config`
- `qichacha_config`
- `news_interface_config`
- `recipient_management`

## Phase 3: Backend Implementation Path

Plan backend in this order:

1. **Schema and init**
   - Update `news/server/db.js` table creation/migration/seed logic.
   - Add indexes/unique constraints needed for new app data.
2. **Domain utilities**
   - Add utility files under `news/server/utils/` for normalize/match/sync/date/id logic.
3. **Routes**
   - Add/extend route module under `news/server/routes/`.
   - Keep response format consistent with existing APIs (`success`, `message`, `data`).
4. **Permission checks**
   - Update permission mapping utilities (for app-level and action-level checks).
5. **Scheduler integration**
   - Wire cron/task entry in scheduled task utility and startup bootstrap.

## Phase 4: Frontend Implementation Path

Plan frontend in this order:

1. Add API wrapper in `news/client/src/api/` (or existing module).
2. Create/extend page under `news/client/src/pages/`.
3. Add navigation/tab entry in system config or dashboard入口.
4. Bind app-specific permissions to button visibility and page access.
5. Apply repo list/table standards for all list pages.

If page is table-heavy, also load and follow `frontend-list-standards`.

## Phase 5: Data and Migration Safety

Before release, include explicit migration safety items:

- Existing rows with legacy app names are migrated, not silently dropped.
- FK-dependent tables are remapped before delete.
- Seed scripts are idempotent (`INSERT ... ON DUPLICATE` or safe guards).
- Startup init can be rerun without duplicate/conflict errors.

## Output Template

Use this format for user-facing plan:

```markdown
## 新应用开发规划：<app_name>

### 1) 范围与目标
- 业务目标：
- 核心实体：
- 权限角色：

### 2) 技术路径（按顺序）
- Step 1: 需求文档落盘（`news/<app_name>/<app_name>需求.md`）
- Step 2: 数据与初始化（files...）
- Step 3: 后端接口与服务（files...）
- Step 4: 前端页面与交互（files...）
- Step 5: 权限与配置（files...）
- Step 6: 定时任务与通知（files...）

### 3) 验收与回归
- 功能验收：
- 数据一致性：
- 权限回归：
- 任务调度验证：

### 4) 上线顺序与回滚
- 上线顺序：
- 回滚方案：
```

## Done Criteria

A plan is complete only if it includes all of:

- File-level change list (not only module names)
- API contract summary (inputs/outputs/errors)
- Permission matrix (at least admin vs non-admin)
- Data migration/seed strategy
- Test checklist (manual + script/endpoint verification)
- Rollout and rollback steps
