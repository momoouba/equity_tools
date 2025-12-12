#!/bin/bash

# 详细诊断503错误脚本
# 使用方法: ./deploy/diagnose-503-detailed.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}503错误详细诊断工具${NC}"
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

# 2. 检查应用容器健康状态
echo -e "${CYAN}=== 2. 检查应用容器健康状态 ===${NC}"
APP_HEALTH=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
echo "应用容器健康状态: $APP_HEALTH"
echo ""

# 3. 检查服务器初始化状态
echo -e "${CYAN}=== 3. 检查服务器初始化状态 ===${NC}"
echo "查找服务器就绪标志..."
SERVER_READY=$(sudo docker compose logs app 2>&1 | grep -i "服务器核心功能已就绪\|server.*ready" | tail -1 || echo "")
if [ -n "$SERVER_READY" ]; then
    echo -e "${GREEN}✓ 服务器已就绪${NC}"
    echo "  $SERVER_READY"
else
    echo -e "${YELLOW}⚠️  未找到服务器就绪标志${NC}"
    echo ""
    echo "检查初始化进度..."
    INIT_LOG=$(sudo docker compose logs app 2>&1 | tail -50 | grep -i "初始化\|initializ\|启动\|start\|ready" | tail -10 || echo "")
    if [ -n "$INIT_LOG" ]; then
        echo "$INIT_LOG" | sed 's/^/  /'
    fi
fi
echo ""

# 4. 检查初始化错误
echo -e "${CYAN}=== 4. 检查初始化错误 ===${NC}"
INIT_ERRORS=$(sudo docker compose logs app 2>&1 | grep -i "error\|fail\|exception\|语法错误\|syntax" | tail -20 || echo "")
if [ -n "$INIT_ERRORS" ]; then
    echo -e "${RED}检测到错误:${NC}"
    echo "$INIT_ERRORS" | sed 's/^/  /'
else
    echo -e "${GREEN}✓ 未发现明显错误${NC}"
fi
echo ""

# 5. 测试应用健康检查
echo -e "${CYAN}=== 5. 测试应用健康检查 ===${NC}"
echo "从宿主机测试..."
APP_HEALTH_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
echo "响应: $APP_HEALTH_RESPONSE"
echo ""

if echo "$APP_HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 应用健康检查正常${NC}"
elif echo "$APP_HEALTH_RESPONSE" | grep -q '"status":"starting"'; then
    echo -e "${YELLOW}⚠️  服务器正在启动中（返回503是正常的）${NC}"
    echo ""
    echo "等待服务器完成初始化..."
    for i in {1..12}; do
        sleep 5
        CHECK_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
        if echo "$CHECK_RESPONSE" | grep -q '"status":"ok"'; then
            echo -e "${GREEN}✓ 服务器已就绪（等待了 $((i*5)) 秒）${NC}"
            break
        fi
        echo "  等待中... ($((i*5))/60 秒)"
    done
else
    echo -e "${RED}✗ 应用健康检查失败${NC}"
fi
echo ""

# 6. 测试Nginx代理
echo -e "${CYAN}=== 6. 测试Nginx代理 ===${NC}"
echo "从Nginx测试..."
NGINX_PROXY_RESPONSE=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
echo "响应: $NGINX_PROXY_RESPONSE"
echo ""

if echo "$NGINX_PROXY_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ Nginx代理正常${NC}"
elif echo "$NGINX_PROXY_RESPONSE" | grep -q '"status":"starting"'; then
    echo -e "${YELLOW}⚠️  服务器正在启动中（通过Nginx）${NC}"
else
    echo -e "${RED}✗ Nginx代理失败${NC}"
    echo ""
    echo "检查Nginx容器内能否访问应用..."
    NGINX_TO_APP=$(sudo docker exec newsapp-nginx wget -q -O - http://app:3001/api/health 2>/dev/null || echo "")
    if [ -n "$NGINX_TO_APP" ]; then
        echo "Nginx容器访问应用响应: $NGINX_TO_APP"
        if echo "$NGINX_TO_APP" | grep -q "ok"; then
            echo -e "${GREEN}✓ Nginx容器可以访问应用${NC}"
            echo -e "${YELLOW}⚠️  问题可能是Nginx配置或路由${NC}"
        else
            echo -e "${RED}✗ Nginx容器无法正常访问应用${NC}"
        fi
    else
        echo -e "${RED}✗ Nginx容器无法访问应用容器${NC}"
    fi
fi
echo ""

# 7. 检查Nginx配置
echo -e "${CYAN}=== 7. 检查Nginx配置 ===${NC}"
NGINX_CONFIG_ERROR=$(sudo docker compose logs nginx 2>&1 | grep -i "host not found in upstream\|upstream.*not found\|emerg\|error" | tail -5 || echo "")
if [ -n "$NGINX_CONFIG_ERROR" ]; then
    echo -e "${RED}检测到Nginx配置错误:${NC}"
    echo "$NGINX_CONFIG_ERROR" | sed 's/^/  /'
else
    echo -e "${GREEN}✓ 未发现Nginx配置错误${NC}"
fi
echo ""

# 8. 检查容器网络
echo -e "${CYAN}=== 8. 检查容器网络 ===${NC}"
APP_NETWORK=$(sudo docker inspect newsapp --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
NGINX_NETWORK=$(sudo docker inspect newsapp-nginx --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
echo "App容器网络: $APP_NETWORK"
echo "Nginx容器网络: $NGINX_NETWORK"
if [ "$APP_NETWORK" == "$NGINX_NETWORK" ] && [ -n "$APP_NETWORK" ]; then
    echo -e "${GREEN}✓ 容器在同一网络${NC}"
else
    echo -e "${RED}✗ 容器不在同一网络${NC}"
fi
echo ""

# 9. 测试容器间连接
echo -e "${CYAN}=== 9. 测试容器间连接 ===${NC}"
echo "从Nginx容器ping应用容器..."
sudo docker exec newsapp-nginx ping -c 2 app 2>&1 | head -5 || echo "  ping失败"
echo ""

# 10. 查看最新日志
echo -e "${CYAN}=== 10. 查看最新应用日志（最后30行） ===${NC}"
sudo docker compose logs app --tail 30
echo ""

# 11. 查看最新Nginx日志
echo -e "${CYAN}=== 11. 查看最新Nginx日志（最后20行） ===${NC}"
sudo docker compose logs nginx --tail 20
echo ""

# 12. 总结和建议
echo -e "${CYAN}=== 诊断总结 ===${NC}"
echo ""

# 判断问题类型
if echo "$APP_HEALTH_RESPONSE" | grep -q '"status":"starting"'; then
    echo -e "${YELLOW}问题类型: 服务器正在初始化中${NC}"
    echo ""
    echo "建议操作:"
    echo "  1. 等待服务器完成初始化（通常需要30-60秒）"
    echo "  2. 检查初始化日志: sudo docker compose logs app | grep -i '初始化\|ready'"
    echo "  3. 如果长时间未完成，检查是否有初始化错误"
elif echo "$APP_HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    if ! echo "$NGINX_PROXY_RESPONSE" | grep -q '"status":"ok"'; then
        echo -e "${YELLOW}问题类型: Nginx代理问题${NC}"
        echo ""
        echo "应用直接访问正常，但Nginx代理失败"
        echo ""
        echo "建议操作:"
        echo "  1. 检查Nginx配置: deploy/nginx-site.conf"
        echo "  2. 重启Nginx容器: sudo docker compose restart nginx"
        echo "  3. 检查容器网络连接"
    else
        echo -e "${GREEN}✓ 所有检查通过，服务应该正常${NC}"
    fi
else
    echo -e "${RED}问题类型: 应用无法正常启动${NC}"
    echo ""
    echo "建议操作:"
    echo "  1. 检查应用日志: sudo docker compose logs app --tail 100"
    echo "  2. 检查代码语法错误（特别是 initPrompts.js）"
    echo "  3. 检查数据库连接"
    echo "  4. 重启应用容器: sudo docker compose restart app"
fi

echo ""
echo -e "${CYAN}=== 诊断完成 ===${NC}"
echo ""
echo "如需自动修复，执行: ./deploy/fix-503-error.sh"
echo ""

