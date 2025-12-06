#!/bin/bash

# 实时查看服务器运行日志脚本
# 支持多种日志查看方式

# 不使用 set -e，允许脚本继续执行即使某些检查失败

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 配置变量
APP_NAME="newsapp"
LOG_DIR="/var/log/newsapp"
PM2_LOG_DIR="$HOME/.pm2/logs"

# 显示帮助信息
show_help() {
    echo -e "${CYAN}实时查看服务器运行日志工具${NC}"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --pm2, -p          使用PM2查看日志（实时跟踪）"
    echo "  --pm2-out, -o      查看PM2标准输出日志"
    echo "  --pm2-err, -e      查看PM2错误日志"
    echo "  --combined, -c     查看合并日志文件（默认）"
    echo "  --out, -O          查看标准输出日志文件"
    echo "  --error, -E        查看错误日志文件"
    echo "  --all, -a          查看所有日志（合并显示）"
    echo "  --lines, -n NUM    显示最后N行（默认100行）"
    echo "  --follow, -f       实时跟踪日志（默认开启）"
    echo "  --no-follow        不跟踪，只显示当前内容"
    echo "  --grep, -g PATTERN 过滤包含指定内容的日志"
    echo "  --help, -h         显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0                      # 实时查看合并日志"
    echo "  $0 --pm2                # 使用PM2实时查看日志"
    echo "  $0 --error -n 200       # 查看最后200行错误日志"
    echo "  $0 --grep ERROR         # 只显示包含ERROR的日志"
    echo "  $0 --all --no-follow    # 查看所有日志（不跟踪）"
    echo ""
}

# 检查PM2是否安装
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        echo -e "${RED}错误: PM2未安装${NC}"
        echo ""
        echo -e "${CYAN}安装PM2：${NC}"
        echo ""
        echo "1. 首先安装 Node.js 和 npm（如果未安装）："
        echo "   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
        echo "   sudo apt-get install -y nodejs"
        echo ""
        echo "2. 然后安装 PM2："
        echo "   npm install -g pm2"
        echo ""
        echo -e "${CYAN}或者查看直接运行的node进程：${NC}"
        echo "   ps aux | grep 'node.*index.js'"
        echo ""
        echo -e "${CYAN}详细安装指南请查看：${NC}"
        echo "   cat deploy/安装Node和PM2指南.md"
        echo ""
        return 1
    fi
    return 0
}

# 检查日志文件是否存在
check_log_file() {
    local file=$1
    if [[ ! -f "$file" ]]; then
        echo -e "${YELLOW}警告: 日志文件不存在: $file${NC}"
        echo ""
        echo -e "${CYAN}可能的原因：${NC}"
        echo "1. 应用尚未启动"
        echo "2. 应用未使用PM2运行（日志文件只在PM2运行时创建）"
        echo "3. 日志目录权限问题"
        echo ""
        echo -e "${CYAN}解决方案：${NC}"
        echo "1. 如果使用PM2，请先启动应用："
        echo "   pm2 start ecosystem.config.js"
        echo "   或"
        echo "   pm2 start server/index.js --name newsapp"
        echo ""
        echo "2. 如果直接运行node，日志会输出到终端，可以："
        echo "   查看进程输出，或使用PM2管理应用"
        echo ""
        echo "3. 检查应用是否在运行："
        echo "   ps aux | grep 'node.*index.js'"
        echo "   或"
        echo "   pm2 list"
        echo ""
        return 1
    fi
    return 0
}

# 使用PM2查看日志
view_pm2_logs() {
    local log_type=$1
    local follow=${2:-true}
    local lines=${3:-100}
    
    if ! check_pm2; then
        return 1
    fi
    
    # 检查应用是否在运行
    if ! pm2 list 2>/dev/null | grep -q "$APP_NAME"; then
        echo -e "${YELLOW}警告: 应用 $APP_NAME 未在PM2中运行${NC}"
        echo ""
        echo -e "${CYAN}当前PM2进程列表：${NC}"
        pm2 list 2>/dev/null || echo "PM2未运行或未安装"
        echo ""
        echo -e "${CYAN}解决方案：${NC}"
        echo "1. 启动应用："
        echo "   pm2 start deploy/ecosystem.config.js"
        echo "   或"
        echo "   pm2 start server/index.js --name newsapp"
        echo ""
        echo "2. 如果应用直接运行（非PM2），可以："
        echo "   查看运行node的终端窗口"
        echo "   或使用PM2管理应用"
        echo ""
        echo "3. 检查应用是否在其他方式运行："
        echo "   ps aux | grep 'node.*index.js'"
        echo ""
        return 1
    fi
    
    echo -e "${GREEN}正在使用PM2查看日志...${NC}"
    echo -e "${CYAN}应用名称: $APP_NAME${NC}"
    echo -e "${CYAN}日志类型: $log_type${NC}"
    echo ""
    
    if [[ "$follow" == "true" ]]; then
        case $log_type in
            "out")
                pm2 logs "$APP_NAME" --lines "$lines" --nostream | tail -n "$lines"
                pm2 logs "$APP_NAME" --lines 0
                ;;
            "err")
                pm2 logs "$APP_NAME" --err --lines "$lines" --nostream | tail -n "$lines"
                pm2 logs "$APP_NAME" --err --lines 0
                ;;
            *)
                pm2 logs "$APP_NAME" --lines "$lines" --nostream | tail -n "$lines"
                pm2 logs "$APP_NAME" --lines 0
                ;;
        esac
    else
        case $log_type in
            "out")
                pm2 logs "$APP_NAME" --out --lines "$lines" --nostream
                ;;
            "err")
                pm2 logs "$APP_NAME" --err --lines "$lines" --nostream
                ;;
            *)
                pm2 logs "$APP_NAME" --lines "$lines" --nostream
                ;;
        esac
    fi
}

# 检查应用运行状态
check_app_status() {
    local has_pm2=false
    local has_node=false
    
    # 检查PM2
    if command -v pm2 &> /dev/null; then
        if pm2 list 2>/dev/null | grep -q "$APP_NAME"; then
            has_pm2=true
        fi
    fi
    
    # 检查直接运行的node进程
    if ps aux | grep -v grep | grep -q "node.*index.js"; then
        has_node=true
    fi
    
    if [[ "$has_pm2" == "true" ]]; then
        echo -e "${GREEN}✓ 应用正在PM2中运行${NC}"
        return 0
    elif [[ "$has_node" == "true" ]]; then
        echo -e "${YELLOW}⚠ 应用正在直接运行（非PM2），日志输出到终端${NC}"
        echo -e "${CYAN}建议：使用PM2管理应用以获得更好的日志管理${NC}"
        return 1
    else
        echo -e "${RED}✗ 应用未运行${NC}"
        return 2
    fi
}

# 查看日志文件
view_log_file() {
    local file=$1
    local follow=${2:-true}
    local lines=${3:-100}
    local grep_pattern=$4
    
    if ! check_log_file "$file"; then
        echo ""
        echo -e "${CYAN}尝试其他方式查看日志...${NC}"
        echo ""
        
        # 检查应用状态
        local app_status=$(check_app_status)
        local status_code=$?
        
        if [[ $status_code -eq 0 ]]; then
            # PM2运行中，尝试查看PM2日志
            echo -e "${GREEN}检测到PM2运行，尝试查看PM2日志...${NC}"
            echo ""
            if command -v pm2 &> /dev/null; then
                if pm2 list | grep -q "$APP_NAME"; then
                    echo -e "${CYAN}使用命令查看PM2日志：${NC}"
                    echo "pm2 logs $APP_NAME"
                    echo ""
                    echo -e "${CYAN}或使用本脚本：${NC}"
                    echo "$0 --pm2"
                    echo ""
                    # 自动切换到PM2日志查看
                    read -p "是否现在查看PM2日志？(y/n) " -n 1 -r
                    echo ""
                    if [[ $REPLY =~ ^[Yy]$ ]]; then
                        view_pm2_logs "all" "$follow" "$lines"
                        return 0
                    fi
                fi
            fi
        elif [[ $status_code -eq 1 ]]; then
            # 直接运行的node进程
            echo -e "${CYAN}查看node进程输出：${NC}"
            echo "ps aux | grep 'node.*index.js'"
            echo ""
            echo -e "${CYAN}建议使用PM2管理应用：${NC}"
            echo "pm2 start server/index.js --name newsapp"
            echo "pm2 logs newsapp"
        else
            # 应用未运行
            echo -e "${CYAN}启动应用：${NC}"
            echo "使用PM2: pm2 start ecosystem.config.js"
            echo "或直接运行: node server/index.js"
        fi
        
        return 1
    fi
    
    echo -e "${GREEN}正在查看日志文件: $file${NC}"
    echo ""
    
    if [[ -n "$grep_pattern" ]]; then
        if [[ "$follow" == "true" ]]; then
            tail -n "$lines" "$file" | grep --color=always "$grep_pattern" || true
            tail -f "$file" | grep --color=always "$grep_pattern"
        else
            tail -n "$lines" "$file" | grep --color=always "$grep_pattern" || true
        fi
    else
        if [[ "$follow" == "true" ]]; then
            tail -n "$lines" "$file"
            tail -f "$file"
        else
            tail -n "$lines" "$file"
        fi
    fi
}

# 查看所有日志
view_all_logs() {
    local follow=${1:-true}
    local lines=${2:-50}
    local grep_pattern=$3
    
    echo -e "${GREEN}正在查看所有日志...${NC}"
    echo ""
    
    local files=(
        "$LOG_DIR/combined.log"
        "$LOG_DIR/out.log"
        "$LOG_DIR/error.log"
    )
    
    for file in "${files[@]}"; do
        if [[ -f "$file" ]]; then
            echo -e "${CYAN}========== $(basename "$file") ==========${NC}"
            if [[ -n "$grep_pattern" ]]; then
                tail -n "$lines" "$file" | grep --color=always "$grep_pattern" || true
            else
                tail -n "$lines" "$file"
            fi
            echo ""
        fi
    done
    
    if [[ "$follow" == "true" ]]; then
        echo -e "${YELLOW}按 Ctrl+C 退出实时跟踪${NC}"
        echo ""
        # 使用multitail或tail -f合并多个文件
        if command -v multitail &> /dev/null; then
            multitail -s 2 "${files[@]}"
        else
            # 如果没有multitail，使用tail -f合并
            tail -f "${files[@]}"
        fi
    fi
}

# 主函数
main() {
    local mode="combined"
    local log_type="all"
    local follow=true
    local lines=100
    local grep_pattern=""
    
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --pm2|-p)
                mode="pm2"
                log_type="all"
                shift
                ;;
            --pm2-out|-o)
                mode="pm2"
                log_type="out"
                shift
                ;;
            --pm2-err|-e)
                mode="pm2"
                log_type="err"
                shift
                ;;
            --combined|-c)
                mode="file"
                log_type="combined"
                shift
                ;;
            --out|-O)
                mode="file"
                log_type="out"
                shift
                ;;
            --error|-E)
                mode="file"
                log_type="error"
                shift
                ;;
            --all|-a)
                mode="all"
                shift
                ;;
            --lines|-n)
                lines="$2"
                shift 2
                ;;
            --follow|-f)
                follow=true
                shift
                ;;
            --no-follow)
                follow=false
                shift
                ;;
            --grep|-g)
                grep_pattern="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                echo -e "${RED}未知选项: $1${NC}"
                show_help
                exit 1
                ;;
        esac
    done
    
    # 创建日志目录（如果不存在）
    if [[ ! -d "$LOG_DIR" ]]; then
        echo -e "${YELLOW}创建日志目录: $LOG_DIR${NC}"
        sudo mkdir -p "$LOG_DIR"
        sudo chown $USER:$USER "$LOG_DIR" 2>/dev/null || true
    fi
    
    # 根据模式执行
    case $mode in
        pm2)
            view_pm2_logs "$log_type" "$follow" "$lines"
            ;;
        file)
            local log_file=""
            case $log_type in
                combined)
                    log_file="$LOG_DIR/combined.log"
                    ;;
                out)
                    log_file="$LOG_DIR/out.log"
                    ;;
                error)
                    log_file="$LOG_DIR/error.log"
                    ;;
            esac
            view_log_file "$log_file" "$follow" "$lines" "$grep_pattern"
            ;;
        all)
            view_all_logs "$follow" "$lines" "$grep_pattern"
            ;;
        *)
            # 默认查看合并日志，如果不存在则尝试PM2
            if [[ ! -f "$LOG_DIR/combined.log" ]]; then
                # 检查是否有PM2日志可用
                if command -v pm2 &> /dev/null && pm2 list 2>/dev/null | grep -q "$APP_NAME"; then
                    echo -e "${CYAN}日志文件不存在，检测到PM2运行，切换到PM2日志查看...${NC}"
                    echo ""
                    view_pm2_logs "all" "$follow" "$lines"
                else
                    view_log_file "$LOG_DIR/combined.log" "$follow" "$lines" "$grep_pattern"
                fi
            else
                view_log_file "$LOG_DIR/combined.log" "$follow" "$lines" "$grep_pattern"
            fi
            ;;
    esac
}

# 运行主函数
main "$@"

