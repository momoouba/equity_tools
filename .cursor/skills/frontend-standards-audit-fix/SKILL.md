---
name: frontend-standards-audit-fix
description: Audits frontend pages after implementation to ensure project UI standards were actually applied, then fixes gaps immediately. Use when user asks to 验收前端规范执行, 检查是否按skills开发, 对照标准复查页面, or asks to auto-fix missing list/tab/layout/date/border rules.
---

# Frontend Standards Audit and Fix

Use this skill after frontend changes are completed.

## Goal

Verify that implemented pages truly match frontend standards (not only claimed), and fix any mismatch in the same pass.

## Inputs

- Target page file paths (for example `news/client/src/pages/上市进展/ListingProjectProgressPage.jsx`)
- Related style files (`.css`)
- Standard reference: `.cursor/skills/frontend-list-standards/SKILL.md`

## Audit Workflow

1. Read target page JSX and related CSS.
2. Compare implementation against `frontend-list-standards` checklist.
3. Mark each item as:
   - `pass`: implemented and visible
   - `fail`: missing or ineffective
4. Apply code/style fixes for every `fail` item.
5. Run lints on changed files.
6. Return concise result with:
   - fixed items
   - remaining risks (if any)

## Mandatory Checks

- **Spacing**: when page is tab/list type, top area keeps `10px` from menu bottom.
- **Tabs**: `type="line"` and compact spacing.
- **Table grid**: each column has visible separator lines; if default table border is not obvious, enforce via page-scope CSS.
- **Scroll behavior**: top controls fixed, table body scrollable via `scroll.y`.
- **ListingProjectProgressPage scroll baseline**: verify `tableScrollY` uses `Math.max(320, window.innerHeight - 280)`.
- **Action buttons**: color hierarchy follows standard. Operation column fixed right with width calculated by button count (10px padding on both sides).
- **Date fields**: DB datetime fields (e.g. `f_update_time`) display raw backend value by default; no frontend slicing/timezone conversion.
- **Pagination**: supports page-size change, total, jumper.

## Fix Rules

- Prefer page-scoped class selectors to avoid global side effects.
- Avoid negative margins for layout alignment.
- Prefer deterministic UI styles over theme-dependent defaults.
- If backend returns Date objects causing timezone drift in JSON, update API query to return formatted datetime string.

## Output Format

```markdown
## 前端规范复查结果：<page>
- pass: ...
- fail -> fixed: ...
- residual risk: ...
```
