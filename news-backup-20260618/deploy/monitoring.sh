#!/bin/bash

# 系统监控脚本
# 用于监控新闻管理系统的运行状态

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置变量
APP_NAME="newsapp"
APP_PORT=3001
DB_NAME="investment_tools"
DB_USER="newsapp"
ALERT_EMAIL=""  # 设置告警邮箱
LOG_FILE="/var/log/newsapp/monitoring.log"

# 日志函数
log_info() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $1"
    echo -e "${BLUE}$message${NC}"
    echo "$message" >> "$LOG_FILE"
}

log_success() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS] $1"
    echo -e "${GREEN}$message${NC}"
    echo "$message" >> "$LOG_FILE"
}

log_warning() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] [WARNING] $1"
    echo -e "${YELLOW}$message${NC}"
    echo "$message" >> "$LOG_FILE"
}

log_error() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $1"
    echo -e "${RED}$message${NC}"
    echo "$message" >> "$LOG_FILE"
}

# 发送告警邮件
send_alert() {
    local subject="$1"
    local message="$2"
    
    if [[ -n "$ALERT_EMAIL" ]] && command -v mail &> /dev/null; then
        echo "$message" | mail -s "$subject" "$ALERT_EMAIL"
        log_info "告警邮件已发送到: $ALERT_EMAIL"
    fi
}

# 检查系统资源
check_system_resources() {
    log_info "检查系统资源..."
    
    # 检查CPU使用率
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
    cpu_usage=${cpu_usage%.*}  # 去除小数部分
    
    if [[ $cpu_usage -gt 80 ]]; then
        log_error "CPU使用率过高: ${cpu_usage}%"
        send_alert "CPU告警" "服务器CPU使用率达到 ${cpu_usage}%"
    elif [[ $cpu_usage -gt 60 ]]; then
        log_warning "CPU使用率较高: ${cpu_usage}%"
    else
        log_success "CPU使用率正常: ${cpu_usage}%"
    fi
    
    # 检查内存使用率
    local memory_info=$(free | grep Mem)
    local total_mem=$(echo $memory_info | awk '{print $2}')
    local used_mem=$(echo $memory_info | awk '{print $3}')
    local memory_usage=$((used_mem * 100 / total_mem))
    
    if [[ $memory_usage -gt 85 ]]; then
        log_error "内存使用率过高: ${memory_usage}%"
        send_alert "内存告警" "服务器内存使用率达到 ${memory_usage}%"
    elif [[ $memory_usage -gt 70 ]]; then
        log_warning "内存使用率较高: ${memory_usage}%"
    else
        log_success "内存使用率正常: ${memory_usage}%"
    fi
    
    # 检查磁盘使用率
    local disk_usage=$(df -h / | awk 'NR==2 {print $5}' | cut -d'%' -f1)
    
    if [[ $disk_usage -gt 90 ]]; then
        log_error "磁盘使用率过高: ${disk_usage}%"
        send_alert "磁盘告警" "服务器磁盘使用率达到 ${disk_usage}%"
    elif [[ $disk_usage -gt 80 ]]; then
        log_warning "磁盘使用率较高: ${disk_usage}%"
    else
        log_success "磁盘使用率正常: ${disk_usage}%"
    fi
}

# 检查应用状态
check_application_status() {
    log_info "检查应用状态..."
    
    # 检查PM2进程
    if pm2 list | grep -q "$APP_NAME"; then
        local app_status=$(pm2 jlist | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.status")
        
        if [[ "$app_status" == "online" ]]; then
            log_success "应用进程状态正常"
        else
            log_error "应用进程状态异常: $app_status"
            send_alert "应用告警" "应用 $APP_NAME 状态异常: $app_status"
            
            # 尝试重启应用
            log_info "尝试重启应用..."
            pm2 restart "$APP_NAME"
            sleep 5
            
            # 再次检查状态
            app_status=$(pm2 jlist | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.status")
            if [[ "$app_status" == "online" ]]; then
                log_success "应用重启成功"
                send_alert "应用恢复" "应用 $APP_NAME 已成功重启"
            else
                log_error "应用重启失败"
                send_alert "应用故障" "应用 $APP_NAME 重启失败，需要人工介入"
            fi
        fi
    else
        log_error "应用进程不存在"
        send_alert "应用告警" "应用 $APP_NAME 进程不存在"
    fi
    
    # 检查应用端口
    if netstat -tulpn | grep -q ":$APP_PORT "; then
        log_success "应用端口 $APP_PORT 正常监听"
    else
        log_error "应用端口 $APP_PORT 未监听"
        send_alert "端口告警" "应用端口 $APP_PORT 未正常监听"
    fi
}

# 检查数据库状态
check_database_status() {
    log_info "检查数据库状态..."
    
    # 检查MySQL服务
    if systemctl is-active --quiet mysql; then
        log_success "MySQL服务运行正常"
    else
        log_error "MySQL服务未运行"
        send_alert "数据库告警" "MySQL服务未运行"
        
        # 尝试启动MySQL
        log_info "尝试启动MySQL服务..."
        sudo systemctl start mysql
        sleep 5
        
        if systemctl is-active --quiet mysql; then
            log_success "MySQL服务启动成功"
            send_alert "数据库恢复" "MySQL服务已成功启动"
        else
            log_error "MySQL服务启动失败"
            send_alert "数据库故障" "MySQL服务启动失败，需要人工介入"
        fi
    fi
    
    # 检查数据库连接
    if mysql -u "$DB_USER" -pNewsApp@2024 -e "USE $DB_NAME; SELECT 1;" &>/dev/null; then
        log_success "数据库连接正常"
    else
        log_error "数据库连接失败"
        send_alert "数据库告警" "无法连接到数据库 $DB_NAME"
    fi
    
    # 检查数据库大小
    local db_size=$(mysql -u "$DB_USER" -pNewsApp@2024 -e "
        SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'DB Size in MB' 
        FROM information_schema.tables 
        WHERE table_schema='$DB_NAME';" | tail -1)
    
    log_info "数据库大小: ${db_size}MB"
    
    if (( $(echo "$db_size > 1000" | bc -l) )); then
        log_warning "数据库大小较大: ${db_size}MB，建议进行数据清理"
    fi
}

# 检查Web服务
check_web_service() {
    log_info "检查Web服务..."
    
    # 检查Nginx服务
    if systemctl is-active --quiet nginx; then
        log_success "Nginx服务运行正常"
    else
        log_error "Nginx服务未运行"
        send_alert "Web服务告警" "Nginx服务未运行"
        
        # 尝试启动Nginx
        log_info "尝试启动Nginx服务..."
        sudo systemctl start nginx
        sleep 3
        
        if systemctl is-active --quiet nginx; then
            log_success "Nginx服务启动成功"
            send_alert "Web服务恢复" "Nginx服务已成功启动"
        else
            log_error "Nginx服务启动失败"
            send_alert "Web服务故障" "Nginx服务启动失败，需要人工介入"
        fi
    fi
    
    # 检查HTTP响应
    local http_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/ || echo "000")
    
    if [[ "$http_status" == "200" ]] || [[ "$http_status" == "301" ]] || [[ "$http_status" == "302" ]]; then
        log_success "HTTP服务响应正常: $http_status"
    else
        log_error "HTTP服务响应异常: $http_status"
        send_alert "HTTP告警" "HTTP服务响应状态码: $http_status"
    fi
    
    # 检查API健康状态
    local api_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health || echo "000")
    
    if [[ "$api_status" == "200" ]]; then
        log_success "API健康检查通过"
    else
        log_error "API健康检查失败: $api_status"
        send_alert "API告警" "API健康检查失败，状态码: $api_status"
    fi
}

# 检查日志文件
check_log_files() {
    log_info "检查日志文件..."
    
    local log_dir="/var/log/newsapp"
    
    # 检查日志目录大小
    if [[ -d "$log_dir" ]]; then
        local log_size=$(du -sh "$log_dir" | cut -f1)
        log_info "日志目录大小: $log_size"
        
        # 检查是否有错误日志
        local error_count=$(find "$log_dir" -name "*.log" -mtime -1 -exec grep -c "ERROR\|FATAL" {} + 2>/dev/null | awk '{sum+=$1} END {print sum+0}')
        
        if [[ $error_count -gt 0 ]]; then
            log_warning "最近24小时内发现 $error_count 个错误日志"
            
            if [[ $error_count -gt 50 ]]; then
                send_alert "日志告警" "最近24小时内发现大量错误日志: $error_count 个"
            fi
        else
            log_success "未发现错误日志"
        fi
    fi
    
    # 检查Nginx日志
    local nginx_error_count=$(sudo grep -c "error\|crit\|alert\|emerg" /var/log/nginx/error.log 2>/dev/null || echo "0")
    
    if [[ $nginx_error_count -gt 0 ]]; then
        log_warning "Nginx错误日志数量: $nginx_error_count"
    else
        log_success "Nginx运行正常，无错误日志"
    fi
}

# 检查网络连接
check_network_connectivity() {
    log_info "检查网络连接..."
    
    # 检查外网连接
    if ping -c 1 8.8.8.8 &>/dev/null; then
        log_success "外网连接正常"
    else
        log_error "外网连接失败"
        send_alert "网络告警" "服务器无法连接外网"
    fi
    
    # 检查DNS解析
    if nslookup google.com &>/dev/null; then
        log_success "DNS解析正常"
    else
        log_error "DNS解析失败"
        send_alert "DNS告警" "服务器DNS解析失败"
    fi
}

# 生成监控报告
generate_report() {
    local report_file="/tmp/monitoring_report_$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$report_file" <<EOF
新闻管理系统监控报告
生成时间: $(date '+%Y-%m-%d %H:%M:%S')
服务器: $(hostname)

系统信息:
- 操作系统: $(lsb_release -d | cut -f2)
- 内核版本: $(uname -r)
- 运行时间: $(uptime -p)

资源使用情况:
- CPU使用率: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
- 内存使用率: $(free | grep Mem | awk '{printf "%.1f%%", $3/$2 * 100.0}')
- 磁盘使用率: $(df -h / | awk 'NR==2 {print $5}')

服务状态:
- 应用状态: $(pm2 jlist | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.status" 2>/dev/null || echo "未知")
- MySQL状态: $(systemctl is-active mysql)
- Nginx状态: $(systemctl is-active nginx)

网络状态:
- HTTP响应: $(curl -s -o /dev/null -w "%{http_code}" http://localhost/ || echo "无响应")
- API健康: $(curl -s -o /dev/null -w "%{http_code}" http://localhost/health || echo "无响应")

最近错误日志:
$(tail -10 /var/log/newsapp/error.log 2>/dev/null || echo "无错误日志")

EOF

    log_info "监控报告已生成: $report_file"
    
    # 如果配置了邮箱，发送报告
    if [[ -n "$ALERT_EMAIL" ]] && command -v mail &> /dev/null; then
        mail -s "系统监控报告 - $(date '+%Y-%m-%d %H:%M:%S')" "$ALERT_EMAIL" < "$report_file"
        log_info "监控报告已发送到: $ALERT_EMAIL"
    fi
}

# 主函数
main() {
    # 创建日志目录
    sudo mkdir -p "$(dirname "$LOG_FILE")"
    sudo chown $USER:$USER "$(dirname "$LOG_FILE")"
    
    log_info "开始系统监控检查..."
    echo ""
    
    check_system_resources
    echo ""
    
    check_application_status
    echo ""
    
    check_database_status
    echo ""
    
    check_web_service
    echo ""
    
    check_log_files
    echo ""
    
    check_network_connectivity
    echo ""
    
    # 如果是详细模式，生成报告
    if [[ "$1" == "--report" ]]; then
        generate_report
    fi
    
    log_success "监控检查完成"
}

# 显示帮助信息
show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --report    生成详细监控报告"
    echo "  --help      显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0              # 执行基本监控检查"
    echo "  $0 --report     # 执行监控检查并生成报告"
    echo ""
    echo "配置告警邮箱:"
    echo "  编辑脚本中的 ALERT_EMAIL 变量"
}

# 参数处理
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    --report|-r)
        main --report
        ;;
    "")
        main
        ;;
    *)
        echo "未知选项: $1"
        show_help
        exit 1
        ;;
esac
