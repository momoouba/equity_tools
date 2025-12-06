# PowerShell脚本：实时查看服务器运行日志
# 适用于Windows系统，通过SSH连接到Linux服务器查看日志

param(
    [Parameter(Mandatory=$false)]
    [string]$Server = "",
    
    [Parameter(Mandatory=$false)]
    [string]$User = "",
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("pm2", "combined", "out", "error", "all")]
    [string]$LogType = "combined",
    
    [Parameter(Mandatory=$false)]
    [int]$Lines = 100,
    
    [Parameter(Mandatory=$false)]
    [switch]$NoFollow,
    
    [Parameter(Mandatory=$false)]
    [string]$Grep = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$Help
)

# 显示帮助信息
function Show-Help {
    Write-Host "实时查看服务器运行日志工具 (Windows PowerShell版本)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "用法: .\view-logs.ps1 [参数]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "参数:"
    Write-Host "  -Server SERVER    服务器地址（SSH连接）"
    Write-Host "  -User USER        用户名（SSH连接）"
    Write-Host "  -LogType TYPE     日志类型: pm2, combined, out, error, all"
    Write-Host "  -Lines NUM        显示最后N行（默认100行）"
    Write-Host "  -NoFollow         不跟踪，只显示当前内容"
    Write-Host "  -Grep PATTERN     过滤包含指定内容的日志"
    Write-Host "  -Help             显示此帮助信息"
    Write-Host ""
    Write-Host "示例:"
    Write-Host "  .\view-logs.ps1 -Server 192.168.1.100 -User root"
    Write-Host "  .\view-logs.ps1 -Server 192.168.1.100 -User root -LogType error -Lines 200"
    Write-Host "  .\view-logs.ps1 -Server 192.168.1.100 -User root -Grep ERROR"
    Write-Host ""
    Write-Host "注意: 需要安装OpenSSH客户端或使用PuTTY等SSH工具"
    Write-Host ""
}

# 检查SSH是否可用
function Test-SSH {
    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
        Write-Host "错误: 未找到SSH客户端" -ForegroundColor Red
        Write-Host "请安装OpenSSH客户端或使用PuTTY" -ForegroundColor Yellow
        return $false
    }
    return $true
}

# 通过SSH查看日志
function View-LogsViaSSH {
    param(
        [string]$Server,
        [string]$User,
        [string]$LogType,
        [int]$Lines,
        [bool]$Follow,
        [string]$Grep
    )
    
    if (-not (Test-SSH)) {
        return
    }
    
    $APP_NAME = "newsapp"
    $LOG_DIR = "/var/log/newsapp"
    
    # 构建SSH命令
    $sshCmd = ""
    
    if ($Follow) {
        $followFlag = "-f"
    } else {
        $followFlag = ""
    }
    
    switch ($LogType) {
        "pm2" {
            $sshCmd = "ssh ${User}@${Server} 'pm2 logs $APP_NAME --lines $Lines $followFlag'"
        }
        "combined" {
            if ($Grep) {
                $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/combined.log | grep `"$Grep`"; if [ `$? -eq 0 ]; then tail -f $LOG_DIR/combined.log | grep `"$Grep`"; fi'"
            } else {
                $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/combined.log; tail -f $LOG_DIR/combined.log'"
            }
        }
        "out" {
            if ($Grep) {
                $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/out.log | grep `"$Grep`"; if [ `$? -eq 0 ]; then tail -f $LOG_DIR/out.log | grep `"$Grep`"; fi'"
            } else {
                $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/out.log; tail -f $LOG_DIR/out.log'"
            }
        }
        "error" {
            if ($Grep) {
                $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/error.log | grep `"$Grep`"; if [ `$? -eq 0 ]; then tail -f $LOG_DIR/error.log | grep `"$Grep`"; fi'"
            } else {
                $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/error.log; tail -f $LOG_DIR/error.log'"
            }
        }
        "all" {
            $sshCmd = "ssh ${User}@${Server} 'tail -n $Lines $LOG_DIR/*.log; tail -f $LOG_DIR/*.log'"
        }
    }
    
    Write-Host "正在连接到服务器: ${User}@${Server}" -ForegroundColor Green
    Write-Host "日志类型: $LogType" -ForegroundColor Cyan
    Write-Host ""
    
    Invoke-Expression $sshCmd
}

# 主函数
if ($Help) {
    Show-Help
    exit 0
}

if ([string]::IsNullOrEmpty($Server) -or [string]::IsNullOrEmpty($User)) {
    Write-Host "错误: 必须提供服务器地址和用户名" -ForegroundColor Red
    Write-Host ""
    Show-Help
    exit 1
}

$Follow = -not $NoFollow

View-LogsViaSSH -Server $Server -User $User -LogType $LogType -Lines $Lines -Follow $Follow -Grep $Grep

