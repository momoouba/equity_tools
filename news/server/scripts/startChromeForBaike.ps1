# 启动带 CDP 调试端口的 Chrome，供百科 PoC（Playwright connect_over_cdp）使用。
# 用法（在 news 目录）：
#   powershell -ExecutionPolicy Bypass -File server/scripts/startChromeForBaike.ps1

$ErrorActionPreference = "Stop"

$port = if ($env:BAIKE_CDP_PORT) { $env:BAIKE_CDP_PORT } else { "9222" }
$profile = if ($env:BAIKE_CHROME_PROFILE) { $env:BAIKE_CHROME_PROFILE } else { "$env:LOCALAPPDATA\chrome-baike-poc" }

$candidates = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chrome = $null
foreach ($c in $candidates) {
  if ($c -and (Test-Path $c)) {
    $chrome = $c
    break
  }
}

if (-not $chrome) {
  Write-Error "未找到 Chrome，请安装 Google Chrome 或设置 BAIKE_CHROME_PATH 环境变量"
  exit 1
}

if ($env:BAIKE_CHROME_PATH -and (Test-Path $env:BAIKE_CHROME_PATH)) {
  $chrome = $env:BAIKE_CHROME_PATH
}

New-Item -ItemType Directory -Force -Path $profile | Out-Null

Write-Host "[startChromeForBaike] Chrome: $chrome"
Write-Host "[startChromeForBaike] Profile: $profile"
Write-Host "[startChromeForBaike] CDP port: $port"
Write-Host "[startChromeForBaike] 启动后请在浏览器打开 https://baike.baidu.com 并完成一次安全验证（如出现）"

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=$port",
  "--remote-allow-origins=*",
  "--user-data-dir=$profile",
  "--no-first-run",
  "--no-default-browser-check",
  "https://baike.baidu.com/"
)

Write-Host '[startChromeForBaike] Started. Example:'
Write-Host '  npm run poc:baike:browser -- --month=2026-06 --per-category=30'