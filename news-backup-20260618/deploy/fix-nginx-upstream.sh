#!/bin/bash

# 修复Nginx upstream配置问题脚本
# 使用方法: ./deploy/fix-nginx-upstream.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}修复Nginx upstream配置问题${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 进入项目目录
cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
    echo -e "${RED}错误: 无法找到项目目录${NC}"
    exit 1
}

echo "项目目录: $(pwd)"
echo ""

# 1. 检查Nginx配置错误
echo -e "${CYAN}=== 1. 检查Nginx配置错误 ===${NC}"
NGINX_ERROR=$(sudo docker compose logs nginx 2>&1 | grep -i "host not found in upstream" | tail -1 || echo "")
if [ -z "$NGINX_ERROR" ]; then
    echo -e "${GREEN}✓ 未发现Nginx upstream错误${NC}"
    echo ""
    echo -e "${CYAN}测试Nginx代理...${NC}"
    NGINX_TEST=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
    if echo "$NGINX_TEST" | grep -q '"status":"ok"'; then
        echo -e "${GREEN}✓ Nginx代理正常工作${NC}"
        echo "服务应该正常，无需修复"
        exit 0
    fi
else
    echo -e "${YELLOW}检测到错误:${NC}"
    echo "  $NGINX_ERROR"
fi
echo ""

# 2. 检查应用容器状态
echo -e "${CYAN}=== 2. 检查应用容器状态 ===${NC}"
APP_HEALTH=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
echo "应用容器健康状态: $APP_HEALTH"

if [ "$APP_HEALTH" != "healthy" ]; then
    echo -e "${YELLOW}⚠️  应用容器未完全就绪，等待启动...${NC}"
    echo "等待应用容器完全启动（最多60秒）..."
    for i in {1..12}; do
        sleep 5
        APP_HEALTH_CHECK=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
        if [ "$APP_HEALTH_CHECK" == "healthy" ]; then
            echo -e "${GREEN}✓ 应用容器已就绪（等待了 $((i*5)) 秒）${NC}"
            break
        fi
        echo "  等待中... ($((i*5))/60 秒)"
    done
fi
echo ""

# 3. 测试容器间连接
echo -e "${CYAN}=== 3. 测试容器间连接 ===${NC}"
if sudo docker exec newsapp-nginx wget -q -O - http://app:3001/api/health 2>/dev/null | grep -q "ok"; then
    echo -e "${GREEN}✓ Nginx容器可以访问应用容器${NC}"
else
    echo -e "${RED}✗ Nginx容器无法访问应用容器${NC}"
    echo ""
    echo -e "${CYAN}检查容器网络...${NC}"
    APP_NETWORK=$(sudo docker inspect newsapp --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
    NGINX_NETWORK=$(sudo docker inspect newsapp-nginx --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
    echo "App网络: $APP_NETWORK"
    echo "Nginx网络: $NGINX_NETWORK"
    
    if [ "$APP_NETWORK" != "$NGINX_NETWORK" ]; then
        echo -e "${RED}✗ 容器不在同一网络，需要重新创建${NC}"
        echo ""
        echo -e "${CYAN}重新创建容器...${NC}"
        sudo docker compose down
        sleep 2
        sudo docker compose up -d
        sleep 15
        echo -e "${GREEN}✓ 容器已重新创建${NC}"
    fi
fi
echo ""

# 4. 重新加载Nginx配置
echo -e "${CYAN}=== 4. 重新加载Nginx配置 ===${NC}"
echo "测试Nginx配置语法..."
if sudo docker exec newsapp-nginx nginx -t 2>&1 | grep -q "successful"; then
    echo -e "${GREEN}✓ Nginx配置语法正确${NC}"
    echo ""
    echo "重新加载Nginx配置..."
    if sudo docker exec newsapp-nginx nginx -s reload 2>&1; then
        echo -e "${GREEN}✓ Nginx配置已重新加载${NC}"
    else
        echo -e "${YELLOW}重新加载失败，重启Nginx容器...${NC}"
        sudo docker compose restart nginx
        sleep 5
    fi
else
    echo -e "${RED}✗ Nginx配置语法有误${NC}"
    sudo docker exec newsapp-nginx nginx -t 2>&1 | head -10
    echo ""
    echo -e "${YELLOW}请检查配置文件: deploy/nginx-site.conf${NC}"
    exit 1
fi
echo ""

# 5. 验证修复
echo -e "${CYAN}=== 5. 验证修复 ===${NC}"
sleep 3

# 测试应用直接访问
APP_TEST=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$APP_TEST" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 应用直接访问正常${NC}"
else
    echo -e "${RED}✗ 应用直接访问失败${NC}"
    echo "  响应: $APP_TEST"
fi

# 测试Nginx代理
NGINX_TEST=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
if echo "$NGINX_TEST" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ Nginx代理访问正常${NC}"
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}修复完成！服务现在应该正常工作${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo -e "${RED}✗ Nginx代理访问失败${NC}"
    echo "  响应: $NGINX_TEST"
    echo ""
    echo -e "${YELLOW}如果应用直接访问正常但Nginx代理失败，请检查:${NC}"
    echo "  1. Nginx配置文件: deploy/nginx-site.conf"
    echo "  2. 查看Nginx日志: sudo docker compose logs nginx --tail 50"
fi
echo ""

