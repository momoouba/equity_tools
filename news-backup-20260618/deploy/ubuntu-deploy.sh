#!/bin/bash

# Ubuntu Linux 新闻管理系统部署脚本
# 适用于 Ubuntu 20.04/22.04 LTS
# 作者: 系统管理员
# 版本: 1.0

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为root用户
check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "请不要使用root用户运行此脚本！"
        log_info "建议创建普通用户: sudo adduser newsapp"
        exit 1
    fi
}

# 检查系统版本
check_system() {
    log_info "检查系统版本..."
    
    if [[ ! -f /etc/os-release ]]; then
        log_error "无法检测系统版本"
        exit 1
    fi
    
    source /etc/os-release
    
    if [[ "$ID" != "ubuntu" ]]; then
        log_error "此脚本仅支持Ubuntu系统"
        exit 1
    fi
    
    case "$VERSION_ID" in
        "20.04"|"22.04")
            log_success "系统版本检查通过: Ubuntu $VERSION_ID"
            ;;
        *)
            log_warning "未测试的Ubuntu版本: $VERSION_ID，可能存在兼容性问题"
            ;;
    esac
}

# 更新系统
update_system() {
    log_info "更新系统包..."
    sudo apt update
    sudo apt upgrade -y
    sudo apt install -y curl wget git unzip software-properties-common
    log_success "系统更新完成"
}

# 安装Node.js
install_nodejs() {
    log_info "安装Node.js 18.x..."
    
    # 检查是否已安装
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        log_info "检测到已安装Node.js: $NODE_VERSION"
        
        # 检查版本是否满足要求
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [[ $MAJOR_VERSION -ge 18 ]]; then
            log_success "Node.js版本满足要求"
            return 0
        else
            log_warning "Node.js版本过低，需要升级"
        fi
    fi
    
    # 安装Node.js 18.x
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    # 验证安装
    if command -v node &> /dev/null && command -v npm &> /dev/null; then
        log_success "Node.js安装成功: $(node --version)"
        log_success "npm版本: $(npm --version)"
    else
        log_error "Node.js安装失败"
        exit 1
    fi
}

# 安装MySQL
install_mysql() {
    log_info "安装MySQL 8.0..."
    
    # 检查是否已安装
    if command -v mysql &> /dev/null; then
        log_info "检测到已安装MySQL"
        return 0
    fi
    
    # 设置MySQL root密码（避免交互式安装）
    sudo debconf-set-selections <<< 'mysql-server mysql-server/root_password password NewsApp@2024'
    sudo debconf-set-selections <<< 'mysql-server mysql-server/root_password_again password NewsApp@2024'
    
    # 安装MySQL
    sudo apt install -y mysql-server
    
    # 启动MySQL服务
    sudo systemctl start mysql
    sudo systemctl enable mysql
    
    # 验证安装
    if systemctl is-active --quiet mysql; then
        log_success "MySQL安装并启动成功"
    else
        log_error "MySQL启动失败"
        exit 1
    fi
    
    # 创建应用数据库和用户
    log_info "配置MySQL数据库..."
    mysql -u root -pNewsApp@2024 <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY 'NewsApp@2024';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
EOF
    
    log_success "MySQL数据库配置完成"
}

# 安装Nginx
install_nginx() {
    log_info "安装Nginx..."
    
    if command -v nginx &> /dev/null; then
        log_info "检测到已安装Nginx"
        return 0
    fi
    
    sudo apt install -y nginx
    
    # 启动Nginx服务
    sudo systemctl start nginx
    sudo systemctl enable nginx
    
    if systemctl is-active --quiet nginx; then
        log_success "Nginx安装并启动成功"
    else
        log_error "Nginx启动失败"
        exit 1
    fi
}

# 安装PM2
install_pm2() {
    log_info "安装PM2进程管理器..."
    
    if command -v pm2 &> /dev/null; then
        log_info "检测到已安装PM2"
        return 0
    fi
    
    sudo npm install -g pm2
    
    # 设置PM2开机启动
    pm2 startup
    log_success "PM2安装完成"
}

# 配置防火墙
configure_firewall() {
    log_info "配置防火墙..."
    
    # 启用UFW
    sudo ufw --force enable
    
    # 允许SSH
    sudo ufw allow ssh
    
    # 允许HTTP和HTTPS
    sudo ufw allow 80
    sudo ufw allow 443
    
    # 允许应用端口（仅本地访问）
    sudo ufw allow from 127.0.0.1 to any port 3001
    
    log_success "防火墙配置完成"
}

# 创建应用目录
setup_app_directory() {
    log_info "设置应用目录..."
    
    APP_DIR="/opt/newsapp"
    
    # 创建应用目录
    sudo mkdir -p $APP_DIR
    sudo chown $USER:$USER $APP_DIR
    
    # 创建日志目录
    sudo mkdir -p /var/log/newsapp
    sudo chown $USER:$USER /var/log/newsapp
    
    log_success "应用目录创建完成: $APP_DIR"
}

# 部署应用代码
deploy_application() {
    log_info "部署应用代码..."
    
    APP_DIR="/opt/newsapp"
    CURRENT_DIR=$(pwd)
    
    # 复制应用文件
    log_info "复制应用文件到 $APP_DIR..."
    
    # 复制后端代码
    cp -r "$CURRENT_DIR/server" "$APP_DIR/"
    cp -r "$CURRENT_DIR/package.json" "$APP_DIR/"
    cp -r "$CURRENT_DIR/package-lock.json" "$APP_DIR/"
    
    # 复制前端代码
    cp -r "$CURRENT_DIR/client" "$APP_DIR/"
    
    # 复制部署配置
    if [[ -d "$CURRENT_DIR/deploy" ]]; then
        cp -r "$CURRENT_DIR/deploy" "$APP_DIR/"
    fi
    
    cd $APP_DIR
    
    # 安装后端依赖
    log_info "安装后端依赖..."
    npm install --production
    
    # 构建前端
    log_info "构建前端应用..."
    cd client
    npm install
    npm run build
    
    cd $APP_DIR
    
    log_success "应用代码部署完成"
}

# 配置环境变量
setup_environment() {
    log_info "配置环境变量..."
    
    APP_DIR="/opt/newsapp"
    
    # 创建生产环境配置
    cat > "$APP_DIR/.env" <<EOF
# 生产环境配置
NODE_ENV=production
PORT=3001

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=newsapp
DB_PASSWORD=NewsApp@2024
DB_NAME=investment_tools

# 应用配置
APP_SECRET=your-secret-key-change-this-in-production
JWT_SECRET=your-jwt-secret-change-this-in-production

# 日志配置
LOG_LEVEL=info
LOG_DIR=/var/log/newsapp
EOF
    
    log_success "环境变量配置完成"
}

# 配置Nginx
setup_nginx() {
    log_info "配置Nginx..."
    
    # 备份默认配置
    sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup
    
    # 创建应用配置
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/newsapp
    
    # 启用站点
    sudo ln -sf /etc/nginx/sites-available/newsapp /etc/nginx/sites-enabled/
    
    # 禁用默认站点
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # 测试配置
    sudo nginx -t
    
    # 重载Nginx
    sudo systemctl reload nginx
    
    log_success "Nginx配置完成"
}

# 启动应用
start_application() {
    log_info "启动应用..."
    
    APP_DIR="/opt/newsapp"
    cd $APP_DIR
    
    # 使用PM2启动应用
    pm2 start deploy/ecosystem.config.js
    
    # 保存PM2配置
    pm2 save
    
    log_success "应用启动完成"
}

# 显示部署信息
show_deployment_info() {
    log_success "=========================================="
    log_success "         部署完成！"
    log_success "=========================================="
    echo ""
    log_info "应用信息:"
    log_info "  - 应用目录: /opt/newsapp"
    log_info "  - 前端访问: http://$(hostname -I | awk '{print $1}')"
    log_info "  - API地址: http://$(hostname -I | awk '{print $1}'):3001"
    echo ""
    log_info "数据库信息:"
    log_info "  - 数据库: investment_tools"
    log_info "  - 用户: newsapp"
    log_info "  - 密码: NewsApp@2024"
    echo ""
    log_info "管理命令:"
    log_info "  - 查看应用状态: pm2 status"
    log_info "  - 查看应用日志: pm2 logs newsapp"
    log_info "  - 重启应用: pm2 restart newsapp"
    log_info "  - 停止应用: pm2 stop newsapp"
    echo ""
    log_info "默认管理员账号:"
    log_info "  - 用户名: admin"
    log_info "  - 密码: wenchao"
    echo ""
    log_warning "安全提醒:"
    log_warning "  1. 请及时修改数据库密码"
    log_warning "  2. 请修改.env文件中的密钥"
    log_warning "  3. 建议配置SSL证书"
    log_warning "  4. 定期备份数据库"
}

# 主函数
main() {
    log_info "开始Ubuntu Linux部署..."
    echo ""
    
    check_root
    check_system
    update_system
    install_nodejs
    install_mysql
    install_nginx
    install_pm2
    configure_firewall
    setup_app_directory
    deploy_application
    setup_environment
    setup_nginx
    start_application
    
    echo ""
    show_deployment_info
}

# 错误处理
trap 'log_error "部署过程中发生错误，请检查日志"; exit 1' ERR

# 执行主函数
main "$@"
