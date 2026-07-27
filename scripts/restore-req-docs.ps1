# Restore root 需求文档/ from sync-issue-5849a into the working tree without staging.
# Used on release/clean so docs stay local while remaining gitignored.
# Run from repo root (do not rely on path encoding of 桌面).
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath ".git")) {
  throw "Run this script from the git repo root."
}

$src = "sync-issue-5849a"
git rev-parse --verify $src | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Missing local branch $src" }

git checkout $src -- "需求文档/"
if ($LASTEXITCODE -ne 0) { throw "Failed to checkout 需求文档 from $src" }

git rm -r --cached "需求文档/" 2>$null | Out-Null
Write-Host "Restored 需求文档/ from $src (worktree only, not staged)."
