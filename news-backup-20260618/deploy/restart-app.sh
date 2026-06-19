#!/bin/bash

# 重启应用容器脚本
# 使用方法: ./deploy/restart-app.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}重启应用容器${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 进入项目目录
cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
    echo -e "${RED}错误: 无法找到项目目录${NC}"
    exit 1
}

echo "项目目录: $(pwd)"
echo ""

# 1. 停止应用容器
echo -e "${CYAN}=== 1. 停止应用容器 ===${NC}"
sudo docker compose stop app
echo -e "${GREEN}✓ 应用容器已停止${NC}"
echo ""

# 2. 等待2秒
echo -e "${CYAN}=== 2. 等待清理 ===${NC}"
sleep 2
echo ""

# 3. 启动应用容器
echo -e "${CYAN}=== 3. 启动应用容器 ===${NC}"
sudo docker compose up -d app
echo -e "${GREEN}✓ 应用容器已启动${NC}"
echo ""

# 4. 等待应用启动
echo -e "${CYAN}=== 4. 等待应用启动（30秒） ===${NC}"
echo "正在等待应用容器完全启动..."
for i in {1..6}; do
    sleep 5
    echo "  等待中... ($((i*5))/30 秒)"
done
echo ""

# 5. 检查容器状态
echo -e "${CYAN}=== 5. 检查容器状态 ===${NC}"
sudo docker compose ps app
echo ""

# 6. 检查应用健康状态
echo -e "${CYAN}=== 6. 检查应用健康状态 ===${NC}"
APP_HEALTH=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
echo "应用容器健康状态: $APP_HEALTH"

if [ "$APP_HEALTH" == "healthy" ]; then
    echo -e "${GREEN}✓ 应用容器健康${NC}"
else
    echo -e "${YELLOW}⚠️  应用容器可能还在启动中，继续等待...${NC}"
    echo "等待应用容器完全就绪（最多60秒）..."
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

# 7. 测试应用健康检查
echo -e "${CYAN}=== 7. 测试应用健康检查 ===${NC}"
APP_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$APP_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 应用健康检查正常${NC}"
    echo "  响应: $APP_RESPONSE"
elif echo "$APP_RESPONSE" | grep -q '"status":"starting"'; then
    echo -e "${YELLOW}⚠️  应用正在启动中（这是正常的）${NC}"
    echo "  响应: $APP_RESPONSE"
    echo ""
    echo "继续等待应用完成初始化..."
    sleep 15
    APP_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
    if echo "$APP_RESPONSE" | grep -q '"status":"ok"'; then
        echo -e "${GREEN}✓ 应用现在已就绪${NC}"
    else
        echo -e "${YELLOW}⚠️  应用可能还在初始化中${NC}"
        echo "  响应: $APP_RESPONSE"
    fi
else
    echo -e "${RED}✗ 应用健康检查失败${NC}"
    echo "  响应: $APP_RESPONSE"
    echo ""
    echo -e "${CYAN}查看应用日志（最后20行）...${NC}"
    sudo docker compose logs app --tail 20
fi
echo ""

# 8. 测试Nginx代理
echo -e "${CYAN}=== 8. 测试Nginx代理 ===${NC}"
NGINX_RESPONSE=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
if echo "$NGINX_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ Nginx代理正常${NC}"
    echo "  响应: $NGINX_RESPONSE"
else
    echo -e "${YELLOW}⚠️  Nginx代理可能还在等待应用就绪${NC}"
    echo "  响应: $NGINX_RESPONSE"
    echo ""
    echo -e "${CYAN}重新加载Nginx配置...${NC}"
    sudo docker exec newsapp-nginx nginx -s reload 2>&1 || sudo docker compose restart nginx
    sleep 3
    NGINX_RESPONSE=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
    if echo "$NGINX_RESPONSE" | grep -q '"status":"ok"'; then
        echo -e "${GREEN}✓ Nginx代理现在正常${NC}"
    fi
fi
echo ""

# 9. 完成
# 10. 测试关键API端点
echo -e "${CYAN}=== 10. 测试关键API端点 ===${NC}"
echo "测试 /api/ai-prompt-config..."
PROMPT_API=$(curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3001/api/ai-prompt-config?page=1&pageSize=10 2>/dev/null || echo "")
HTTP_CODE=$(echo "$PROMPT_API" | grep "HTTP_CODE" | cut -d: -f2)
RESPONSE_BODY=$(echo "$PROMPT_API" | grep -v "HTTP_CODE")
if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ /api/ai-prompt-config 正常 (HTTP $HTTP_CODE)${NC}"
elif [ "$HTTP_CODE" == "503" ]; then
    echo -e "${RED}✗ /api/ai-prompt-config 返回503${NC}"
    echo "  响应: $RESPONSE_BODY"
    echo ""
    echo -e "${CYAN}应用可能还在启动中，等待30秒后重试...${NC}"
    sleep 30
    PROMPT_API_RETRY=$(curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3001/api/ai-prompt-config?page=1&pageSize=10 2>/dev/null || echo "")
    HTTP_CODE_RETRY=$(echo "$PROMPT_API_RETRY" | grep "HTTP_CODE" | cut -d: -f2)
    if [ "$HTTP_CODE_RETRY" == "200" ]; then
        echo -e "${GREEN}✓ 重试后正常 (HTTP $HTTP_CODE_RETRY)${NC}"
    else
        echo -e "${RED}✗ 重试后仍失败 (HTTP $HTTP_CODE_RETRY)${NC}"
        echo -e "${CYAN}查看应用日志...${NC}"
        sudo docker compose logs app --tail 50 | grep -i "error\|fail" | head -10
    fi
else
    echo -e "${YELLOW}⚠️  /api/ai-prompt-config 返回 HTTP $HTTP_CODE${NC}"
    echo "  响应: $RESPONSE_BODY" | head -200
fi
echo ""

# 11. 完成
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}应用重启完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}后续操作:${NC}"
echo "  1. 刷新浏览器页面（Ctrl+F5强制刷新）"
echo "  2. 如果仍有503错误，运行诊断脚本: ./deploy/check-app-status.sh"
echo "  3. 查看应用日志: sudo docker compose logs app --tail 100"
echo "  4. 查看Nginx日志: sudo docker compose logs nginx --tail 50"
echo ""

