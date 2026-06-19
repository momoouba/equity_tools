#!/bin/bash

# 检查应用状态和诊断503错误脚本
# 使用方法: ./deploy/check-app-status.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}检查应用状态和诊断503错误${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 进入项目目录
cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
    echo -e "${RED}错误: 无法找到项目目录${NC}"
    exit 1
}

echo "项目目录: $(pwd)"
echo ""

# 1. 检查容器状态
echo -e "${CYAN}=== 1. 检查容器状态 ===${NC}"
sudo docker compose ps
echo ""

# 2. 检查应用容器是否在运行
echo -e "${CYAN}=== 2. 检查应用容器是否在运行 ===${NC}"
APP_RUNNING=$(sudo docker ps --filter "name=newsapp" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
if [ -z "$APP_RUNNING" ]; then
    echo -e "${RED}✗ 应用容器未运行！${NC}"
    echo ""
    echo -e "${CYAN}检查容器状态...${NC}"
    APP_STATUS=$(sudo docker ps -a --filter "name=newsapp" --format "{{.Status}}" 2>/dev/null || echo "")
    echo "容器状态: $APP_STATUS"
    echo ""
    echo -e "${CYAN}查看容器日志（最后30行）...${NC}"
    sudo docker compose logs app --tail 30
    echo ""
    echo -e "${YELLOW}建议: 启动应用容器${NC}"
    echo "  sudo docker compose up -d app"
    exit 1
else
    echo -e "${GREEN}✓ 应用容器正在运行${NC}"
fi
echo ""

# 3. 检查应用健康状态
echo -e "${CYAN}=== 3. 检查应用健康状态 ===${NC}"
APP_HEALTH=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
echo "应用容器健康状态: $APP_HEALTH"

if [ "$APP_HEALTH" != "healthy" ]; then
    echo -e "${YELLOW}⚠️  应用容器可能还在启动中或有问题${NC}"
    echo ""
    echo -e "${CYAN}查看应用日志（最后50行）...${NC}"
    sudo docker compose logs app --tail 50
    echo ""
fi
echo ""

# 4. 检查应用进程
echo -e "${CYAN}=== 4. 检查应用进程 ===${NC}"
APP_PROCESS=$(sudo docker exec newsapp ps aux 2>/dev/null | grep -E "node|npm" | grep -v grep || echo "")
if [ -z "$APP_PROCESS" ]; then
    echo -e "${RED}✗ 应用进程未运行！${NC}"
    echo ""
    echo -e "${CYAN}查看应用日志...${NC}"
    sudo docker compose logs app --tail 50
    exit 1
else
    echo -e "${GREEN}✓ 应用进程正在运行${NC}"
    echo "$APP_PROCESS" | head -3 | sed 's/^/   /'
fi
echo ""

# 5. 检查端口监听
echo -e "${CYAN}=== 5. 检查端口监听 ===${NC}"
PORT_3001=$(sudo docker exec newsapp netstat -tuln 2>/dev/null | grep ":3001" || echo "")
if [ -z "$PORT_3001" ]; then
    echo -e "${RED}✗ 端口3001未监听！${NC}"
    echo ""
    echo -e "${CYAN}查看应用日志...${NC}"
    sudo docker compose logs app --tail 50
    exit 1
else
    echo -e "${GREEN}✓ 端口3001正在监听${NC}"
    echo "$PORT_3001" | sed 's/^/   /'
fi
echo ""

# 6. 测试应用健康检查
echo -e "${CYAN}=== 6. 测试应用健康检查 ===${NC}"
echo "从容器内部测试..."
CONTAINER_HEALTH=$(sudo docker exec newsapp wget -q -O - http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$CONTAINER_HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 容器内部健康检查正常${NC}"
    echo "  响应: $CONTAINER_HEALTH"
elif echo "$CONTAINER_HEALTH" | grep -q '"status":"starting"'; then
    echo -e "${YELLOW}⚠️  应用正在启动中${NC}"
    echo "  响应: $CONTAINER_HEALTH"
else
    echo -e "${RED}✗ 容器内部健康检查失败${NC}"
    echo "  响应: $CONTAINER_HEALTH"
    echo ""
    echo -e "${CYAN}查看应用日志...${NC}"
    sudo docker compose logs app --tail 50
    exit 1
fi
echo ""

# 7. 测试从宿主机访问
echo -e "${CYAN}=== 7. 测试从宿主机访问 ===${NC}"
HOST_HEALTH=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$HOST_HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 宿主机访问正常${NC}"
    echo "  响应: $HOST_HEALTH"
elif echo "$HOST_HEALTH" | grep -q '"status":"starting"'; then
    echo -e "${YELLOW}⚠️  应用正在启动中（从宿主机）${NC}"
    echo "  响应: $HOST_HEALTH"
else
    echo -e "${RED}✗ 宿主机访问失败${NC}"
    echo "  响应: $HOST_HEALTH"
fi
echo ""

# 8. 测试Nginx代理
echo -e "${CYAN}=== 8. 测试Nginx代理 ===${NC}"
NGINX_HEALTH=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
if echo "$NGINX_HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ Nginx代理正常${NC}"
    echo "  响应: $NGINX_HEALTH"
else
    echo -e "${RED}✗ Nginx代理失败${NC}"
    echo "  响应: $NGINX_HEALTH"
    echo ""
    echo -e "${CYAN}检查Nginx容器...${NC}"
    NGINX_RUNNING=$(sudo docker ps --filter "name=newsapp-nginx" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
    if [ -z "$NGINX_RUNNING" ]; then
        echo -e "${RED}✗ Nginx容器未运行${NC}"
    else
        echo -e "${GREEN}✓ Nginx容器正在运行${NC}"
        echo ""
        echo -e "${CYAN}测试Nginx容器能否访问应用容器...${NC}"
        NGINX_TO_APP=$(sudo docker exec newsapp-nginx wget -q -O - http://app:3001/api/health 2>/dev/null || echo "")
        if echo "$NGINX_TO_APP" | grep -q "ok"; then
            echo -e "${GREEN}✓ Nginx可以访问应用${NC}"
            echo ""
            echo -e "${CYAN}重新加载Nginx配置...${NC}"
            sudo docker exec newsapp-nginx nginx -s reload 2>&1 || sudo docker compose restart nginx
        else
            echo -e "${RED}✗ Nginx无法访问应用${NC}"
            echo "  响应: $NGINX_TO_APP"
        fi
    fi
fi
echo ""

# 9. 检查应用日志中的错误
echo -e "${CYAN}=== 9. 检查应用日志中的错误 ===${NC}"
APP_ERRORS=$(sudo docker compose logs app 2>&1 | grep -i "error\|fail\|exception\|crash" | tail -20 || echo "")
if [ -n "$APP_ERRORS" ]; then
    echo -e "${YELLOW}检测到错误:${NC}"
    echo "$APP_ERRORS" | sed 's/^/   /'
    echo ""
    echo -e "${CYAN}查看完整错误上下文...${NC}"
    sudo docker compose logs app --tail 100 | grep -i "error\|fail\|exception" -A 3 -B 3 | head -30 || echo "  无更多错误信息"
else
    echo -e "${GREEN}✓ 未发现明显错误${NC}"
fi
echo ""

# 10. 检查数据库连接
echo -e "${CYAN}=== 10. 检查数据库连接 ===${NC}"
DB_ERRORS=$(sudo docker compose logs app 2>&1 | grep -i "database\|mysql\|connection.*fail\|ECONNREFUSED.*3306" | tail -10 || echo "")
if [ -n "$DB_ERRORS" ]; then
    echo -e "${YELLOW}检测到数据库连接问题:${NC}"
    echo "$DB_ERRORS" | sed 's/^/   /'
    echo ""
    echo -e "${CYAN}检查MySQL容器状态...${NC}"
    MYSQL_RUNNING=$(sudo docker ps --filter "name=newsapp-mysql" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-mysql$" || echo "")
    if [ -z "$MYSQL_RUNNING" ]; then
        echo -e "${RED}✗ MySQL容器未运行${NC}"
        echo "  启动MySQL容器: sudo docker compose up -d mysql"
    else
        echo -e "${GREEN}✓ MySQL容器正在运行${NC}"
    fi
else
    echo -e "${GREEN}✓ 未发现数据库连接问题${NC}"
fi
echo ""

# 11. 测试关键API端点
echo -e "${CYAN}=== 11. 测试关键API端点 ===${NC}"
echo "测试 /api/ai-prompt-config..."
PROMPT_API=$(curl -s http://localhost:3001/api/ai-prompt-config?page=1&pageSize=10 2>/dev/null || echo "")
if echo "$PROMPT_API" | grep -q "success\|data\|list"; then
    echo -e "${GREEN}✓ /api/ai-prompt-config 正常${NC}"
    echo "  响应长度: $(echo "$PROMPT_API" | wc -c) 字节"
elif echo "$PROMPT_API" | grep -q "error\|fail"; then
    echo -e "${RED}✗ /api/ai-prompt-config 返回错误${NC}"
    echo "  响应: $PROMPT_API" | head -200
else
    echo -e "${YELLOW}⚠️  /api/ai-prompt-config 响应异常${NC}"
    echo "  响应: $PROMPT_API" | head -200
fi
echo ""

echo "测试 /api/system/applications..."
APPLICATIONS_API=$(curl -s http://localhost:3001/api/system/applications 2>/dev/null || echo "")
if echo "$APPLICATIONS_API" | grep -q "success\|data\|list"; then
    echo -e "${GREEN}✓ /api/system/applications 正常${NC}"
elif echo "$APPLICATIONS_API" | grep -q "error\|fail"; then
    echo -e "${RED}✗ /api/system/applications 返回错误${NC}"
    echo "  响应: $APPLICATIONS_API" | head -200
else
    echo -e "${YELLOW}⚠️  /api/system/applications 响应异常${NC}"
    echo "  响应: $APPLICATIONS_API" | head -200
fi
echo ""

# 12. 总结和建议
echo -e "${CYAN}=== 诊断总结 ===${NC}"
echo ""

if echo "$HOST_HEALTH" | grep -q '"status":"ok"'; then
    if echo "$NGINX_HEALTH" | grep -q '"status":"ok"'; then
        echo -e "${GREEN}✓ 应用和Nginx都正常工作${NC}"
        echo ""
        echo -e "${CYAN}如果浏览器仍有503错误，请尝试:${NC}"
        echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete）"
        echo "  2. 强制刷新页面（Ctrl+F5）"
        echo "  3. 检查浏览器控制台的具体错误信息"
        echo "  4. 查看Nginx访问日志: sudo docker compose logs nginx --tail 50"
    else
        echo -e "${YELLOW}⚠️  应用正常，但Nginx代理有问题${NC}"
        echo ""
        echo -e "${CYAN}建议操作:${NC}"
        echo "  1. 重启Nginx: sudo docker compose restart nginx"
        echo "  2. 检查Nginx配置: sudo docker exec newsapp-nginx nginx -t"
    fi
else
    echo -e "${RED}✗ 应用无法正常响应${NC}"
    echo ""
    echo -e "${CYAN}建议操作:${NC}"
    echo "  1. 查看应用日志: sudo docker compose logs app --tail 100"
    echo "  2. 重启应用: sudo docker compose restart app"
    echo "  3. 如果重启无效，查看是否有代码错误: sudo docker compose logs app | grep -i error"
fi
echo ""

