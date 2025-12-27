#!/bin/bash

# SSL证书文件检查脚本

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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSL_DIR="$SCRIPT_DIR/ssl"

info "检查SSL证书文件..."
echo ""

# 检查文件是否存在
if [ ! -f "$SSL_DIR/fullchain.pem" ]; then
    error "证书文件不存在: $SSL_DIR/fullchain.pem"
    exit 1
fi

if [ ! -f "$SSL_DIR/privkey.pem" ]; then
    error "私钥文件不存在: $SSL_DIR/privkey.pem"
    exit 1
fi

info "文件存在性检查通过"
echo ""

# 检查证书文件
info "检查证书文件..."
if openssl x509 -in "$SSL_DIR/fullchain.pem" -text -noout > /dev/null 2>&1; then
    info "✓ 证书文件格式正确"
    CERT_INFO=$(openssl x509 -in "$SSL_DIR/fullchain.pem" -noout -subject -issuer -dates 2>/dev/null)
    echo "$CERT_INFO" | sed 's/^/  /'
else
    error "证书文件格式错误"
    echo "证书文件前10行："
    head -10 "$SSL_DIR/fullchain.pem"
    exit 1
fi

echo ""

# 检查私钥文件
info "检查私钥文件..."

# 检查文件开头
KEY_HEAD=$(head -1 "$SSL_DIR/privkey.pem")
KEY_TAIL=$(tail -1 "$SSL_DIR/privkey.pem")

echo "  文件开头: $KEY_HEAD"
echo "  文件结尾: $KEY_TAIL"
echo ""

# 检查是否是RSA格式
if openssl rsa -in "$SSL_DIR/privkey.pem" -check -noout > /dev/null 2>&1; then
    info "✓ 私钥格式：RSA"
    RSA_INFO=$(openssl rsa -in "$SSL_DIR/privkey.pem" -text -noout 2>/dev/null | head -5)
    echo "$RSA_INFO" | sed 's/^/  /'
elif openssl ec -in "$SSL_DIR/privkey.pem" -check -noout > /dev/null 2>&1; then
    info "✓ 私钥格式：EC（椭圆曲线）"
    EC_INFO=$(openssl ec -in "$SSL_DIR/privkey.pem" -text -noout 2>/dev/null | head -5)
    echo "$EC_INFO" | sed 's/^/  /'
else
    error "私钥格式错误（既不是RSA也不是EC）"
    echo ""
    warn "私钥文件前5行："
    head -5 "$SSL_DIR/privkey.pem" | sed 's/^/  /'
    echo ""
    warn "私钥文件后5行："
    tail -5 "$SSL_DIR/privkey.pem" | sed 's/^/  /'
    echo ""
    error "可能的问题："
    error "  1. 文件内容不完整"
    error "  2. 文件编码问题"
    error "  3. 文件中有多余的空格或换行"
    error "  4. 从1Panel复制时格式丢失"
    echo ""
    info "建议："
    info "  1. 在1Panel中重新复制私钥内容"
    info "  2. 确保复制时包含完整的 BEGIN 和 END 标记"
    info "  3. 保存为纯文本文件，不要有多余的空格"
    exit 1
fi

echo ""

# 检查证书和私钥是否匹配
info "检查证书和私钥是否匹配..."
CERT_MODULUS=$(openssl x509 -noout -modulus -in "$SSL_DIR/fullchain.pem" 2>/dev/null | openssl md5)
if openssl rsa -noout -modulus -in "$SSL_DIR/privkey.pem" 2>/dev/null | openssl md5 | grep -q "$CERT_MODULUS"; then
    info "✓ 证书和私钥匹配（RSA）"
elif openssl ec -noout -pubout -in "$SSL_DIR/privkey.pem" 2>/dev/null > /tmp/pubkey.pem && \
     openssl x509 -noout -pubkey -in "$SSL_DIR/fullchain.pem" 2>/dev/null | diff -q /tmp/pubkey.pem - > /dev/null 2>&1; then
    info "✓ 证书和私钥匹配（EC）"
    rm -f /tmp/pubkey.pem
else
    warn "⚠ 无法验证证书和私钥是否匹配（这可能是正常的，如果证书链包含多个证书）"
    rm -f /tmp/pubkey.pem
fi

echo ""
info "检查完成！"

