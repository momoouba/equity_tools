## Agent skills

### Issue tracker

Issues live in GitHub (`momoouba/equity_news`). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles with default label names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at repo root + `docs/adr/`. See `docs/agents/domain.md`.

### Database DDL (mandatory)

Any task that creates or alters MySQL tables (including `news/server/db.js` migrations) **must** read and apply `.cursor/skills/mysql-ddl-system-fields/SKILL.md` before writing DDL or route SQL. System fields use **`F_*` PascalCase** (`F_Id`, `F_CreatorTime`, `F_DeleteMark`, etc.); business columns use snake_case. Do not wait for the user to `@` this skill.
