#!/bin/bash

# 配置SSL证书快速步骤脚本
# 适用于已找到证书路径或已上传证书文件的情况

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SSL_DIR="$SCRIPT_DIR/ssl"

info "SSL证书配置脚本"
info "项目目录: $PROJECT_ROOT"
info "SSL目录: $SSL_DIR"
echo ""

# 进入项目目录
cd "$PROJECT_ROOT"

# 创建ssl目录
info "创建SSL目录..."
mkdir -p "$SSL_DIR"

# 检查是否已经存在证书文件
if [ -f "$SSL_DIR/fullchain.pem" ] && [ -f "$SSL_DIR/privkey.pem" ]; then
    info "检测到已存在的证书文件"
    ls -lh "$SSL_DIR"
    echo ""
    read -p "是否使用现有证书文件？(y/n): " use_existing
    if [ "$use_existing" != "y" ] && [ "$use_existing" != "Y" ]; then
        info "请将证书文件放置到 $SSL_DIR 目录"
        info "需要的文件："
        info "  - fullchain.pem (或 cert.pem, *.crt)"
        info "  - privkey.pem (或 key.pem, *.key)"
        exit 0
    fi
else
    info "未找到证书文件"
    info "请将证书文件放置到 $SSL_DIR 目录"
    info ""
    info "方法1：从1Panel下载证书后上传"
    info "方法2：如果已知证书路径，可以运行："
    info "  sudo cp /path/to/cert/fullchain.pem $SSL_DIR/"
    info "  sudo cp /path/to/cert/privkey.pem $SSL_DIR/"
    echo ""
    read -p "是否已知证书路径？(y/n): " has_path
    if [ "$has_path" = "y" ] || [ "$has_path" = "Y" ]; then
        read -p "请输入证书目录路径: " cert_path
        if [ -d "$cert_path" ]; then
            info "从 $cert_path 复制证书文件..."
            
            # 复制证书文件
            if [ -f "$cert_path/fullchain.pem" ]; then
                sudo cp "$cert_path/fullchain.pem" "$SSL_DIR/"
            elif [ -f "$cert_path/cert.pem" ]; then
                sudo cp "$cert_path/cert.pem" "$SSL_DIR/fullchain.pem"
            elif [ -f "$cert_path"/*.crt ]; then
                sudo cp "$cert_path"/*.crt "$SSL_DIR/fullchain.pem"
            else
                error "未找到证书文件，请手动复制"
                exit 1
            fi
            
            # 复制私钥文件
            if [ -f "$cert_path/privkey.pem" ]; then
                sudo cp "$cert_path/privkey.pem" "$SSL_DIR/"
            elif [ -f "$cert_path/key.pem" ]; then
                sudo cp "$cert_path/key.pem" "$SSL_DIR/privkey.pem"
            elif [ -f "$cert_path"/*.key ]; then
                sudo cp "$cert_path"/*.key "$SSL_DIR/privkey.pem"
            else
                error "未找到私钥文件，请手动复制"
                exit 1
            fi
            
            info "证书文件复制完成"
        else
            error "路径不存在: $cert_path"
            exit 1
        fi
    else
        info "请手动将证书文件上传到 $SSL_DIR 目录后重新运行此脚本"
        exit 0
    fi
fi

# 检查证书文件
if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
    error "证书文件不存在！"
    error "请确保 $SSL_DIR 目录下有："
    error "  - fullchain.pem"
    error "  - privkey.pem"
    exit 1
fi

# 设置文件权限
info "设置文件权限..."
sudo chmod 644 "$SSL_DIR/fullchain.pem"
sudo chmod 600 "$SSL_DIR/privkey.pem"

# 如果使用非root用户，调整所有者
if [ "$(id -u)" != "0" ]; then
    sudo chown "$(whoami):$(whoami)" "$SSL_DIR"/*.pem 2>/dev/null || true
fi

# 验证证书文件
info "验证证书文件格式..."
if openssl x509 -in "$SSL_DIR/fullchain.pem" -text -noout > /dev/null 2>&1; then
    info "✓ 证书文件格式正确"
else
    error "证书文件格式错误"
    exit 1
fi

# 验证私钥文件（支持RSA和EC格式）
info "验证私钥文件格式..."
if openssl rsa -in "$SSL_DIR/privkey.pem" -check -noout > /dev/null 2>&1; then
    info "✓ 私钥文件格式正确（RSA格式）"
elif openssl ec -in "$SSL_DIR/privkey.pem" -check -noout > /dev/null 2>&1; then
    info "✓ 私钥文件格式正确（EC格式）"
else
    error "私钥文件格式错误（既不是RSA也不是EC格式）"
    error "请检查私钥文件内容是否正确"
    exit 1
fi

echo ""
info "证书文件配置完成！"
ls -lh "$SSL_DIR"
echo ""

# 检查Docker
if ! command -v docker > /dev/null 2>&1; then
    warn "未检测到docker命令，请手动重启nginx容器"
    exit 0
fi

# 检查docker-compose
if ! command -v docker-compose > /dev/null 2>&1; then
    warn "未检测到docker-compose命令，请手动重启nginx容器"
    exit 0
fi

# 检查nginx容器
if ! docker ps | grep -q newsapp-nginx; then
    warn "nginx容器未运行"
    read -p "是否启动nginx容器？(y/n): " start_nginx
    if [ "$start_nginx" = "y" ] || [ "$start_nginx" = "Y" ]; then
        info "启动nginx容器..."
        docker-compose up -d nginx
        sleep 3
    else
        info "请手动启动nginx容器：docker-compose up -d nginx"
        exit 0
    fi
fi

# 重启nginx容器
info "重启nginx容器..."
docker-compose restart nginx

# 等待容器启动
sleep 3

# 测试nginx配置
info "测试nginx配置..."
if docker exec newsapp-nginx nginx -t 2>&1 | grep -q "successful"; then
    info "✓ Nginx配置测试通过"
else
    error "Nginx配置测试失败，请查看详细错误："
    docker exec newsapp-nginx nginx -t
    exit 1
fi

# 查看容器状态
info "查看nginx容器状态..."
docker ps | grep nginx

echo ""
info "配置完成！"
info ""
info "请访问 https://news.gf-dsai.com 测试"
info ""
info "如果遇到问题，可以查看日志："
info "  docker logs newsapp-nginx"
info "  docker logs newsapp-nginx --tail 50"

