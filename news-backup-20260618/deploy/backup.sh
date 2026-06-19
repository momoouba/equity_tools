#!/bin/bash

# 新闻管理系统数据备份脚本
# 用于定期备份MySQL数据库和应用文件

set -e

# 配置变量
BACKUP_DIR="/opt/backups/newsapp"
DB_NAME="investment_tools"
DB_USER="newsapp"
DB_PASSWORD="NewsApp@2024"
APP_DIR="/opt/newsapp"
RETENTION_DAYS=7

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# 创建备份目录
create_backup_dir() {
    local date_dir="$BACKUP_DIR/$(date +%Y-%m-%d)"
    
    if [[ ! -d "$date_dir" ]]; then
        mkdir -p "$date_dir"
        log_info "创建备份目录: $date_dir"
    fi
    
    echo "$date_dir"
}

# 备份数据库
backup_database() {
    local backup_dir="$1"
    local timestamp=$(date +%H%M%S)
    local backup_file="$backup_dir/database_${timestamp}.sql"
    
    log_info "开始备份数据库..."
    
    if mysqldump -u "$DB_USER" -p"$DB_PASSWORD" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        --hex-blob \
        "$DB_NAME" > "$backup_file"; then
        
        # 压缩备份文件
        gzip "$backup_file"
        log_success "数据库备份完成: ${backup_file}.gz"
        
        # 验证备份文件
        if [[ -f "${backup_file}.gz" ]] && [[ $(stat -c%s "${backup_file}.gz") -gt 0 ]]; then
            log_success "备份文件验证通过"
        else
            log_error "备份文件验证失败"
            return 1
        fi
    else
        log_error "数据库备份失败"
        return 1
    fi
}

# 备份应用文件
backup_application() {
    local backup_dir="$1"
    local timestamp=$(date +%H%M%S)
    local backup_file="$backup_dir/application_${timestamp}.tar.gz"
    
    log_info "开始备份应用文件..."
    
    # 排除不需要备份的目录和文件
    local exclude_patterns=(
        "--exclude=node_modules"
        "--exclude=*.log"
        "--exclude=.git"
        "--exclude=.env"
        "--exclude=uploads/temp"
    )
    
    if tar -czf "$backup_file" \
        "${exclude_patterns[@]}" \
        -C "$(dirname "$APP_DIR")" \
        "$(basename "$APP_DIR")"; then
        
        log_success "应用文件备份完成: $backup_file"
        
        # 验证备份文件
        if [[ -f "$backup_file" ]] && [[ $(stat -c%s "$backup_file") -gt 0 ]]; then
            log_success "应用备份文件验证通过"
        else
            log_error "应用备份文件验证失败"
            return 1
        fi
    else
        log_error "应用文件备份失败"
        return 1
    fi
}

# 备份配置文件
backup_configs() {
    local backup_dir="$1"
    local timestamp=$(date +%H%M%S)
    local config_backup_dir="$backup_dir/configs_${timestamp}"
    
    log_info "开始备份配置文件..."
    
    mkdir -p "$config_backup_dir"
    
    # 备份Nginx配置
    if [[ -f "/etc/nginx/sites-available/newsapp" ]]; then
        cp "/etc/nginx/sites-available/newsapp" "$config_backup_dir/nginx.conf"
    fi
    
    # 备份PM2配置
    if [[ -f "$APP_DIR/deploy/ecosystem.config.js" ]]; then
        cp "$APP_DIR/deploy/ecosystem.config.js" "$config_backup_dir/"
    fi
    
    # 备份环境配置（不包含敏感信息）
    if [[ -f "$APP_DIR/.env" ]]; then
        # 过滤敏感信息
        grep -v -E "(PASSWORD|SECRET|KEY)" "$APP_DIR/.env" > "$config_backup_dir/env.template" || true
    fi
    
    # 压缩配置文件
    tar -czf "$config_backup_dir.tar.gz" -C "$backup_dir" "$(basename "$config_backup_dir")"
    rm -rf "$config_backup_dir"
    
    log_success "配置文件备份完成: $config_backup_dir.tar.gz"
}

# 清理旧备份
cleanup_old_backups() {
    log_info "清理 $RETENTION_DAYS 天前的备份..."
    
    if [[ -d "$BACKUP_DIR" ]]; then
        find "$BACKUP_DIR" -type d -name "20*" -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true
        
        local remaining_backups=$(find "$BACKUP_DIR" -type d -name "20*" | wc -l)
        log_success "清理完成，剩余 $remaining_backups 个备份目录"
    fi
}

# 发送备份报告（可选）
send_backup_report() {
    local backup_dir="$1"
    local status="$2"
    
    # 计算备份大小
    local backup_size=$(du -sh "$backup_dir" 2>/dev/null | cut -f1 || echo "未知")
    
    # 生成报告
    local report="备份报告 - $(date '+%Y-%m-%d %H:%M:%S')
状态: $status
备份目录: $backup_dir
备份大小: $backup_size
服务器: $(hostname)
"
    
    # 这里可以添加邮件发送或其他通知方式
    log_info "备份报告已生成"
    echo "$report" > "$backup_dir/backup_report.txt"
}

# 主函数
main() {
    log_info "开始执行备份任务..."
    
    # 检查必要的工具
    for cmd in mysqldump tar gzip; do
        if ! command -v "$cmd" &> /dev/null; then
            log_error "缺少必要工具: $cmd"
            exit 1
        fi
    done
    
    # 创建备份目录
    local backup_dir
    backup_dir=$(create_backup_dir)
    
    local backup_success=true
    
    # 执行备份
    if ! backup_database "$backup_dir"; then
        backup_success=false
    fi
    
    if ! backup_application "$backup_dir"; then
        backup_success=false
    fi
    
    if ! backup_configs "$backup_dir"; then
        backup_success=false
    fi
    
    # 清理旧备份
    cleanup_old_backups
    
    # 生成报告
    if $backup_success; then
        send_backup_report "$backup_dir" "成功"
        log_success "备份任务完成"
    else
        send_backup_report "$backup_dir" "部分失败"
        log_warning "备份任务部分失败，请检查日志"
        exit 1
    fi
}

# 错误处理
trap 'log_error "备份过程中发生错误"; exit 1' ERR

# 执行主函数
main "$@"
