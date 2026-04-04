#!/usr/bin/env pwsh
# 同花顺 iFinD SDK 自动下载安装脚本 (Windows)
# 使用方式: .\install-ifind-sdk.ps1

param(
    [string]$InstallPath = "$PSScriptRoot\..\..\THSDataInterface_Windows",
    [string]$DownloadUrl = ""  # 如果有直接下载链接，可以在这里指定
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "同花顺 iFinD SDK 安装脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否已安装
if (Test-Path $InstallPath) {
    Write-Host "检测到 SDK 已存在于: $InstallPath" -ForegroundColor Yellow
    $response = Read-Host "是否重新安装? (y/N)"
    if ($response -ne 'y' -and $response -ne 'Y') {
        Write-Host "跳过安装" -ForegroundColor Green
        exit 0
    }
    Remove-Item -Recurse -Force $InstallPath
}

Write-Host "由于同花顺 iFinD SDK 需要官网授权下载，请按以下步骤操作：" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. 访问同花顺官网下载 iFinD 数据接口 SDK:" -ForegroundColor White
Write-Host "   https://www.51ifind.com/" -ForegroundColor Blue
Write-Host ""
Write-Host "2. 登录您的 iFinD 账号" -ForegroundColor White
Write-Host ""
Write-Host "3. 下载 Windows 版 iFinD 数据接口 SDK" -ForegroundColor White
Write-Host ""
Write-Host "4. 将下载的压缩包解压到以下路径：" -ForegroundColor White
Write-Host "   $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "5. 解压后运行安装脚本：" -ForegroundColor White
Write-Host "   cd $InstallPath" -ForegroundColor Green
Write-Host "   python installiFinDPy.py" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查目录是否已存在（用户手动放置）
if (Test-Path $InstallPath) {
    Write-Host "检测到 SDK 目录已存在，验证安装..." -ForegroundColor Green

    # 验证 Python 模块
    try {
        $pythonCode = @"
import sys
sys.path.insert(0, '$InstallPath/bin64')
import iFinDPy
print('iFinDPy 模块加载成功')
print(f'版本: {getattr(iFinDPy, "__version__", "unknown")}')
"@
        $result = python -c $pythonCode 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SDK 验证成功!" -ForegroundColor Green
            Write-Host $result
        } else {
            Write-Host "SDK 验证失败，请运行安装脚本:" -ForegroundColor Red
            Write-Host "  cd $InstallPath" -ForegroundColor Yellow
            Write-Host "  python installiFinDPy.py" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "验证失败: $_" -ForegroundColor Red
    }
} else {
    # 创建目录
    New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
    Write-Host "已创建目录: $InstallPath" -ForegroundColor Green
    Write-Host "请将下载的 SDK 文件解压到此目录" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "获取 refresh_token 步骤：" -ForegroundColor Cyan
Write-Host "1. 打开同花顺 iFinD 金融数据终端" -ForegroundColor White
Write-Host "2. 登录您的账号" -ForegroundColor White
Write-Host "3. 进入「超级命令」→「工具」→「refresh_token 查询」" -ForegroundColor White
Write-Host "4. 复制 refresh_token 到系统配置页面" -ForegroundColor White
Write-Host ""
