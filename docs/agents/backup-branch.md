# Backup Branch

Local snapshots and rollback copies **do not** belong on feature branches. Commit them only on the dedicated **`backup`** branch.

## Branch

| Item | Value |
|------|-------|
| Branch name | `backup` |
| Remote | `equity_tools/backup` only (not `origin` / equity_news) |
| Directory pattern | `news-backup-YYYYMMDD/` at repo root |

## When to use

Before large refactors, path renames, or risky migrations — copy `news/` to `news-backup-YYYYMMDD/`, then commit on `backup`.

## Workflow

```bash
# 1) Create snapshot (example)
cp -r news news-backup-YYYYMMDD   # or robocopy / xcopy on Windows

# 2) Commit on backup branch only
git checkout backup
git pull equity_tools backup
git add news-backup-YYYYMMDD/
git commit -m "backup: <short reason> (<date>)"
git push equity_tools backup

# 3) Return to your work branch
git checkout <your-feature-branch>
```

## Rules

1. **Never** commit `news-backup-*/` on `sync-issue-*`, `main`, or other feature branches.
2. Root `.gitignore` ignores `news-backup-*/` on non-backup branches so snapshots stay untracked locally until you switch to `backup`.
3. One folder per snapshot; name with date (`news-backup-20260618`).
4. Push **`backup`** only to **`equity_tools`** — archives must not go to the equity_news deployment remote.
5. Remove Windows `nul` artifacts before `git add` if a redirect created them under route folders.

## Existing snapshots

| Folder | Commit message | Notes |
|--------|----------------|-------|
| `news-backup-20260618/` | `backup: news snapshot 2026-06-18 before English path rename` | Pre–ASCII path rename tree (Chinese module paths) |

## Restore (read-only reference)

```bash
git checkout backup -- news-backup-20260618/
# Compare or copy files manually; do not merge backup branch into feature branches wholesale.
```
