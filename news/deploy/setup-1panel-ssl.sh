#!/bin/bash

# 1Panel SSL证书配置脚本
# 用于将1Panel安装的SSL证书配置到Docker Nginx容器中

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 域名配置
DOMAIN="${1:-news.gf-dsai.com}"

# 1Panel可能的证书路径
PANEL_PATHS=(
    "/opt/1panel/certs/${DOMAIN}"
    "/opt/1panel/volumes/ssl/${DOMAIN}"
    "/opt/1panel/certs"
    "/root/1panel/certs/${DOMAIN}"
)

# 本地SSL目录
SSL_DIR="$(dirname "$0")/ssl"
PROJECT_ROOT="$(dirname "$(dirname "$0")")"

# 函数：打印信息
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 函数：查找证书文件
find_cert_files() {
    local cert_path="$1"
    
    # 可能的文件名组合
    local cert_file=""
    local key_file=""
    
    # 查找证书文件
    if [ -f "${cert_path}/fullchain.pem" ]; then
        cert_file="${cert_path}/fullchain.pem"
    elif [ -f "${cert_path}/cert.pem" ]; then
        cert_file="${cert_path}/cert.pem"
    elif [ -f "${cert_path}/${DOMAIN}.crt" ]; then
        cert_file="${cert_path}/${DOMAIN}.crt"
    fi
    
    # 查找私钥文件
    if [ -f "${cert_path}/privkey.pem" ]; then
        key_file="${cert_path}/privkey.pem"
    elif [ -f "${cert_path}/key.pem" ]; then
        key_file="${cert_path}/key.pem"
    elif [ -f "${cert_path}/${DOMAIN}.key" ]; then
        key_file="${cert_path}/${DOMAIN}.key"
    fi
    
    if [ -n "$cert_file" ] && [ -n "$key_file" ]; then
        echo "${cert_file}:${key_file}"
        return 0
    fi
    
    return 1
}

# 函数：查找1Panel证书路径
find_panel_cert_path() {
    info "正在查找1Panel证书路径..."
    
    for path in "${PANEL_PATHS[@]}"; do
        if [ -d "$path" ]; then
            result=$(find_cert_files "$path")
            if [ $? -eq 0 ]; then
                echo "$result:$path"
                return 0
            fi
        fi
    done
    
    # 尝试使用find命令查找
    info "尝试使用find命令查找证书文件..."
    for path in "/opt/1panel" "/root/1panel"; do
        if [ -d "$path" ]; then
            cert_file=$(find "$path" -name "fullchain.pem" -o -name "cert.pem" -o -name "${DOMAIN}.crt" 2>/dev/null | head -1)
            if [ -n "$cert_file" ]; then
                cert_dir=$(dirname "$cert_file")
                result=$(find_cert_files "$cert_dir")
                if [ $? -eq 0 ]; then
                    echo "$result:$cert_dir"
                    return 0
                fi
            fi
        fi
    done
    
    return 1
}

# 主函数
main() {
    info "1Panel SSL证书配置脚本"
    info "域名: $DOMAIN"
    echo ""
    
    # 查找证书路径
    cert_info=$(find_panel_cert_path)
    if [ $? -ne 0 ]; then
        error "未找到1Panel证书文件"
        echo ""
        echo "请手动指定证书路径，或检查以下可能的路径："
        for path in "${PANEL_PATHS[@]}"; do
            echo "  - $path"
        done
        echo ""
        echo "使用方法："
        echo "  $0 <domain> <cert_path>"
        echo ""
        echo "或手动复制证书文件："
        echo "  mkdir -p $SSL_DIR"
        echo "  cp <1panel_cert_path>/fullchain.pem $SSL_DIR/"
        echo "  cp <1panel_cert_path>/privkey.pem $SSL_DIR/"
        exit 1
    fi
    
    # 解析证书信息
    IFS=':' read -r cert_file key_file cert_dir <<< "$cert_info"
    
    info "找到证书文件："
    info "  证书: $cert_file"
    info "  私钥: $key_file"
    info "  目录: $cert_dir"
    echo ""
    
    # 创建SSL目录
    info "创建SSL目录: $SSL_DIR"
    mkdir -p "$SSL_DIR"
    
    # 复制证书文件
    info "复制证书文件..."
    
    # 复制证书文件（统一命名为fullchain.pem）
    if [ "$(basename "$cert_file")" != "fullchain.pem" ]; then
        info "  复制 $cert_file -> $SSL_DIR/fullchain.pem"
        sudo cp "$cert_file" "$SSL_DIR/fullchain.pem"
    else
        sudo cp "$cert_file" "$SSL_DIR/fullchain.pem"
    fi
    
    # 复制私钥文件（统一命名为privkey.pem）
    if [ "$(basename "$key_file")" != "privkey.pem" ]; then
        info "  复制 $key_file -> $SSL_DIR/privkey.pem"
        sudo cp "$key_file" "$SSL_DIR/privkey.pem"
    else
        sudo cp "$key_file" "$SSL_DIR/privkey.pem"
    fi
    
    # 设置权限
    info "设置文件权限..."
    sudo chmod 644 "$SSL_DIR/fullchain.pem"
    sudo chmod 600 "$SSL_DIR/privkey.pem"
    
    # 如果使用非root用户运行，调整所有者
    if [ "$(id -u)" != "0" ]; then
        sudo chown "$(whoami):$(whoami)" "$SSL_DIR"/*.pem
    fi
    
    # 验证证书文件
    info "验证证书文件..."
    if openssl x509 -in "$SSL_DIR/fullchain.pem" -text -noout > /dev/null 2>&1; then
        info "✓ 证书文件格式正确"
    else
        error "证书文件格式错误"
        exit 1
    fi
    
    if openssl rsa -in "$SSL_DIR/privkey.pem" -check -noout > /dev/null 2>&1; then
        info "✓ 私钥文件格式正确"
    else
        error "私钥文件格式错误"
        exit 1
    fi
    
    echo ""
    info "证书文件配置完成！"
    echo ""
    
    # 检查Docker容器
    if command -v docker > /dev/null 2>&1; then
        info "检查Docker容器状态..."
        cd "$PROJECT_ROOT" || exit 1
        
        if docker ps | grep -q newsapp-nginx; then
            info "重启nginx容器..."
            docker-compose restart nginx
            
            # 测试nginx配置
            info "测试nginx配置..."
            if docker exec newsapp-nginx nginx -t 2>&1 | grep -q "successful"; then
                info "✓ Nginx配置测试通过"
            else
                warn "Nginx配置测试失败，请检查日志："
                docker exec newsapp-nginx nginx -t
            fi
            
            echo ""
            info "配置完成！请访问 https://$DOMAIN 测试"
        else
            warn "nginx容器未运行，请手动启动："
            echo "  cd $PROJECT_ROOT"
            echo "  docker-compose up -d nginx"
        fi
    else
        warn "未检测到docker命令，请手动重启nginx容器"
    fi
    
    echo ""
    info "证书文件位置: $SSL_DIR"
    info "如果1Panel更新了证书，请重新运行此脚本"
}

# 如果提供了第二个参数，使用指定的路径
if [ -n "$2" ]; then
    if [ -d "$2" ]; then
        result=$(find_cert_files "$2")
        if [ $? -eq 0 ]; then
            IFS=':' read -r cert_file key_file <<< "$result"
            cert_info="${cert_file}:${key_file}:$2"
            SSL_DIR="$(dirname "$0")/ssl"
            PROJECT_ROOT="$(dirname "$(dirname "$0")")"
            mkdir -p "$SSL_DIR"
            sudo cp "$cert_file" "$SSL_DIR/fullchain.pem"
            sudo cp "$key_file" "$SSL_DIR/privkey.pem"
            sudo chmod 644 "$SSL_DIR/fullchain.pem"
            sudo chmod 600 "$SSL_DIR/privkey.pem"
            if [ "$(id -u)" != "0" ]; then
                sudo chown "$(whoami):$(whoami)" "$SSL_DIR"/*.pem
            fi
            info "证书文件已复制到 $SSL_DIR"
            info "请重启nginx容器: docker-compose restart nginx"
            exit 0
        else
            error "在指定路径中未找到证书文件: $2"
            exit 1
        fi
    else
        error "指定路径不存在: $2"
        exit 1
    fi
fi

# 运行主函数
main

