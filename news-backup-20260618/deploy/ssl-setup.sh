#!/bin/bash

# SSL证书自动配置脚本
# 使用Let's Encrypt免费SSL证书

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# 检查参数
if [[ $# -lt 1 ]]; then
    log_error "用法: $0 <域名> [邮箱]"
    log_info "示例: $0 example.com admin@example.com"
    exit 1
fi

DOMAIN="$1"
EMAIL="${2:-admin@${DOMAIN}}"

log_info "开始为域名 $DOMAIN 配置SSL证书..."
log_info "联系邮箱: $EMAIL"

# 检查域名解析
check_domain_resolution() {
    log_info "检查域名解析..."
    
    if ! nslookup "$DOMAIN" > /dev/null 2>&1; then
        log_error "域名 $DOMAIN 无法解析，请检查DNS配置"
        exit 1
    fi
    
    # 获取域名解析的IP
    DOMAIN_IP=$(nslookup "$DOMAIN" | grep -A1 "Name:" | tail -1 | awk '{print $2}')
    SERVER_IP=$(curl -s ifconfig.me)
    
    if [[ "$DOMAIN_IP" != "$SERVER_IP" ]]; then
        log_warning "域名解析IP ($DOMAIN_IP) 与服务器IP ($SERVER_IP) 不匹配"
        log_warning "请确保域名已正确解析到此服务器"
        read -p "是否继续? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        log_success "域名解析检查通过"
    fi
}

# 安装Certbot
install_certbot() {
    log_info "安装Certbot..."
    
    if command -v certbot &> /dev/null; then
        log_info "Certbot已安装"
        return 0
    fi
    
    # 更新包列表
    sudo apt update
    
    # 安装snapd (如果未安装)
    if ! command -v snap &> /dev/null; then
        sudo apt install -y snapd
        sudo systemctl enable --now snapd.socket
        # 等待snapd启动
        sleep 5
    fi
    
    # 安装certbot
    sudo snap install --classic certbot
    
    # 创建符号链接
    sudo ln -sf /snap/bin/certbot /usr/bin/certbot
    
    log_success "Certbot安装完成"
}

# 备份Nginx配置
backup_nginx_config() {
    log_info "备份Nginx配置..."
    
    local backup_dir="/opt/backups/nginx/$(date +%Y%m%d_%H%M%S)"
    sudo mkdir -p "$backup_dir"
    
    # 备份站点配置
    if [[ -f "/etc/nginx/sites-available/newsapp" ]]; then
        sudo cp "/etc/nginx/sites-available/newsapp" "$backup_dir/"
    fi
    
    # 备份主配置
    sudo cp "/etc/nginx/nginx.conf" "$backup_dir/"
    
    log_success "Nginx配置已备份到: $backup_dir"
}

# 更新Nginx配置以支持SSL
update_nginx_config() {
    log_info "更新Nginx配置以支持SSL..."
    
    # 创建临时配置文件
    local temp_config="/tmp/newsapp_ssl.conf"
    
    cat > "$temp_config" <<EOF
# HTTP服务器 - 重定向到HTTPS
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    # Let's Encrypt验证
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # 重定向到HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS服务器
server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;
    
    # SSL证书配置
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # SSL安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # 安全头设置
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # 日志配置
    access_log /var/log/nginx/newsapp_access.log;
    error_log /var/log/nginx/newsapp_error.log;
    
    # 客户端上传限制
    client_max_body_size 50M;
    
    # 静态文件服务
    location / {
        root /opt/newsapp/client/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
        
        # 静态资源缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
        
        # HTML文件不缓存
        location ~* \.html$ {
            expires -1;
            add_header Cache-Control "no-cache, no-store, must-revalidate";
        }
    }
    
    # API代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
    
    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3001/api/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        access_log off;
    }
    
    # 禁止访问敏感文件
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # Gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;
}
EOF

    # 复制配置文件
    sudo cp "$temp_config" "/etc/nginx/sites-available/newsapp"
    rm "$temp_config"
    
    log_success "Nginx配置已更新"
}

# 获取SSL证书
obtain_ssl_certificate() {
    log_info "获取SSL证书..."
    
    # 创建webroot目录
    sudo mkdir -p /var/www/html
    
    # 临时启用HTTP配置以通过验证
    local temp_http_config="/tmp/newsapp_http_temp.conf"
    
    cat > "$temp_http_config" <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    
    # 应用临时配置
    sudo cp "$temp_http_config" "/etc/nginx/sites-available/newsapp"
    sudo nginx -t && sudo systemctl reload nginx
    
    # 获取证书
    if sudo certbot certonly \
        --webroot \
        --webroot-path=/var/www/html \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --domains "$DOMAIN,www.$DOMAIN"; then
        
        log_success "SSL证书获取成功"
        rm "$temp_http_config"
        return 0
    else
        log_error "SSL证书获取失败"
        rm "$temp_http_config"
        return 1
    fi
}

# 配置自动续期
setup_auto_renewal() {
    log_info "配置SSL证书自动续期..."
    
    # 创建续期脚本
    local renewal_script="/opt/newsapp/deploy/ssl-renewal.sh"
    
    cat > "$renewal_script" <<EOF
#!/bin/bash
# SSL证书自动续期脚本

# 续期证书
/usr/bin/certbot renew --quiet

# 重载Nginx
if /usr/bin/certbot renew --dry-run; then
    /bin/systemctl reload nginx
fi
EOF
    
    chmod +x "$renewal_script"
    
    # 添加到crontab
    (crontab -l 2>/dev/null; echo "0 12 * * * $renewal_script") | crontab -
    
    log_success "SSL证书自动续期已配置 (每天12:00检查)"
}

# 测试SSL配置
test_ssl_configuration() {
    log_info "测试SSL配置..."
    
    # 测试Nginx配置
    if sudo nginx -t; then
        log_success "Nginx配置测试通过"
    else
        log_error "Nginx配置测试失败"
        return 1
    fi
    
    # 重载Nginx
    sudo systemctl reload nginx
    
    # 等待服务启动
    sleep 3
    
    # 测试HTTPS访问
    if curl -s -I "https://$DOMAIN" | grep -q "200 OK"; then
        log_success "HTTPS访问测试通过"
    else
        log_warning "HTTPS访问测试失败，请检查防火墙和域名解析"
    fi
    
    # 测试HTTP重定向
    if curl -s -I "http://$DOMAIN" | grep -q "301"; then
        log_success "HTTP重定向测试通过"
    else
        log_warning "HTTP重定向测试失败"
    fi
}

# 显示SSL信息
show_ssl_info() {
    log_success "=========================================="
    log_success "         SSL配置完成！"
    log_success "=========================================="
    echo ""
    log_info "SSL证书信息:"
    log_info "  - 域名: $DOMAIN, www.$DOMAIN"
    log_info "  - 证书路径: /etc/letsencrypt/live/$DOMAIN/"
    log_info "  - 有效期: 90天"
    log_info "  - 自动续期: 已配置"
    echo ""
    log_info "访问地址:"
    log_info "  - HTTPS: https://$DOMAIN"
    log_info "  - HTTP自动重定向到HTTPS"
    echo ""
    log_info "管理命令:"
    log_info "  - 查看证书状态: sudo certbot certificates"
    log_info "  - 手动续期: sudo certbot renew"
    log_info "  - 测试续期: sudo certbot renew --dry-run"
    echo ""
    log_warning "注意事项:"
    log_warning "  1. 证书有效期为90天，已配置自动续期"
    log_warning "  2. 请确保防火墙已开放443端口"
    log_warning "  3. 定期检查证书状态和续期日志"
}

# 主函数
main() {
    log_info "开始SSL证书配置..."
    echo ""
    
    check_domain_resolution
    install_certbot
    backup_nginx_config
    obtain_ssl_certificate
    update_nginx_config
    setup_auto_renewal
    test_ssl_configuration
    
    echo ""
    show_ssl_info
}

# 错误处理
trap 'log_error "SSL配置过程中发生错误"; exit 1' ERR

# 执行主函数
main "$@"
