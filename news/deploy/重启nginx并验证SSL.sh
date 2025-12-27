#!/bin/bash

# 重启nginx容器并验证SSL配置

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

info "重启nginx容器并验证SSL配置..."
echo ""

# 进入项目目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 检查docker命令
if ! command -v docker > /dev/null 2>&1; then
    error "未找到docker命令"
    exit 1
fi

# 检查docker-compose或docker compose
DOCKER_COMPOSE_CMD=""
if command -v docker-compose > /dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
    info "使用 docker-compose 命令"
elif docker compose version > /dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
    info "使用 docker compose 命令"
else
    error "未找到 docker-compose 或 docker compose 命令"
    exit 1
fi

# 检查nginx容器是否存在
if ! docker ps -a | grep -q newsapp-nginx; then
    error "nginx容器不存在"
    info "请先启动容器：$DOCKER_COMPOSE_CMD up -d nginx"
    exit 1
fi

# 重启nginx容器
info "重启nginx容器..."
$DOCKER_COMPOSE_CMD restart nginx

# 等待容器启动
info "等待容器启动..."
sleep 3

# 检查容器状态
if docker ps | grep -q newsapp-nginx; then
    info "✓ nginx容器正在运行"
else
    error "nginx容器未运行"
    docker ps -a | grep nginx
    exit 1
fi

# 测试nginx配置
info "测试nginx配置..."
if docker exec newsapp-nginx nginx -t 2>&1 | grep -q "successful"; then
    info "✓ Nginx配置测试通过"
else
    error "Nginx配置测试失败："
    docker exec newsapp-nginx nginx -t
    exit 1
fi

# 检查SSL证书文件是否在容器中
info "检查容器中的SSL证书文件..."
if docker exec newsapp-nginx test -f /etc/nginx/ssl/fullchain.pem && \
   docker exec newsapp-nginx test -f /etc/nginx/ssl/privkey.pem; then
    info "✓ SSL证书文件存在于容器中"
    docker exec newsapp-nginx ls -lh /etc/nginx/ssl/
else
    error "SSL证书文件在容器中不存在"
    error "请检查docker-compose.yml中的挂载配置"
    exit 1
fi

# 查看nginx日志（最后20行）
info "查看nginx日志（最后20行）..."
docker logs newsapp-nginx --tail 20

echo ""
info "配置完成！"
info ""
info "请访问 https://news.gf-dsai.com 测试"
info ""
info "如果无法访问，可以查看详细日志："
info "  docker logs newsapp-nginx"
info "  docker logs newsapp-nginx --tail 50"

