#!/bin/bash

# 更新代码并重启应用脚本
# 使用方法: ./deploy/update-code.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}更新代码并重启应用${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 进入项目目录
cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
    echo -e "${RED}错误: 无法找到项目目录${NC}"
    exit 1
}

echo "项目目录: $(pwd)"
echo ""

# 检查需要更新的文件
echo -e "${CYAN}=== 检查需要更新的文件 ===${NC}"
FILES_TO_UPDATE=(
    "server/routes/news.js"
    "server/utils/newsAnalysis.js"
)

for file in "${FILES_TO_UPDATE[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ 找到文件: $file${NC}"
    else
        echo -e "${RED}✗ 文件不存在: $file${NC}"
        echo -e "${YELLOW}请确保文件已上传到服务器${NC}"
    fi
done
echo ""

# 确认操作
read -p "是否继续更新并重启应用? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}操作已取消${NC}"
    exit 0
fi

# 备份当前代码（可选）
echo -e "${CYAN}=== 备份当前代码 ===${NC}"
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
for file in "${FILES_TO_UPDATE[@]}"; do
    if [ -f "$file" ]; then
        mkdir -p "$BACKUP_DIR/$(dirname "$file")"
        cp "$file" "$BACKUP_DIR/$file"
        echo -e "${GREEN}✓ 已备份: $file${NC}"
    fi
done
echo "备份目录: $BACKUP_DIR"
echo ""

# 检查容器状态
echo -e "${CYAN}=== 检查容器状态 ===${NC}"
if sudo docker ps | grep -q newsapp; then
    echo -e "${GREEN}✓ 应用容器正在运行${NC}"
else
    echo -e "${YELLOW}⚠️  应用容器未运行，将启动容器${NC}"
fi
echo ""

# 重启应用容器
echo -e "${CYAN}=== 重启应用容器 ===${NC}"
echo "正在重启应用容器以加载新代码..."
sudo docker compose restart app

echo ""
echo -e "${CYAN}等待应用启动（30秒）...${NC}"
for i in {1..6}; do
    sleep 5
    echo "  等待中... ($((i*5))/30 秒)"
done
echo ""

# 检查容器状态
echo -e "${CYAN}=== 检查容器状态 ===${NC}"
sudo docker compose ps app
echo ""

# 检查应用健康状态
echo -e "${CYAN}=== 检查应用健康状态 ===${NC}"
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

# 测试应用健康检查
echo -e "${CYAN}=== 测试应用健康检查 ===${NC}"
APP_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$APP_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 应用健康检查正常${NC}"
    echo "  响应: $APP_RESPONSE"
else
    echo -e "${YELLOW}⚠️  应用可能还在启动中${NC}"
    echo "  响应: $APP_RESPONSE"
    echo ""
    echo -e "${CYAN}查看应用日志（最后30行）...${NC}"
    sudo docker compose logs app --tail 30
fi
echo ""

# 完成
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}代码更新完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}后续操作:${NC}"
echo "  1. 查看应用日志: sudo docker compose logs app --tail 100"
echo "  2. 查看应用日志（实时）: sudo docker compose logs app -f"
echo "  3. 测试功能是否正常"
echo ""


















