#!/bin/bash

# 新闻同步日志功能更新部署脚本
# 使用方法: ./deploy/update-deployment.sh

set -e

echo "=========================================="
echo "开始更新部署..."
echo "=========================================="

# 1. 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 2. 进入项目目录（如果不在）
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 重新构建前端（如果前端代码有更改）"
echo "----------------------------------------"
read -p "前端代码是否有更改？(y/n，默认n): " rebuild_frontend

if [ "$rebuild_frontend" = "y" ] || [ "$rebuild_frontend" = "Y" ]; then
    echo "正在重新构建前端..."
    cd client
    npm run build
    cd ..
    echo "✓ 前端构建完成"
    
    echo ""
    echo "⚠️  重要提示：由于docker-compose.yml中使用了volume挂载前端文件，"
    echo "   需要重新构建Docker镜像或使用以下方法更新前端："
    echo ""
    echo "   方法1（推荐）：重新构建镜像"
    echo "   sudo docker compose build app"
    echo "   sudo docker compose up -d"
    echo ""
    echo "   方法2：使用快速更新脚本"
    echo "   ./deploy/update-frontend-only.sh"
    echo ""
    read -p "是否现在重新构建镜像？(y/n，默认y): " rebuild_image
    
    if [ "$rebuild_image" != "n" ] && [ "$rebuild_image" != "N" ]; then
        echo "正在重新构建镜像..."
        sudo docker compose build app
        echo "✓ 镜像构建完成"
        REBUILD_IMAGE=true
    else
        REBUILD_IMAGE=false
    fi
else
    echo "跳过前端构建"
    REBUILD_IMAGE=false
fi

echo ""
echo "步骤 2: 重启应用容器以应用更改"
echo "----------------------------------------"
echo "注意: server目录已挂载为volume，代码更改会自动同步"

if [ "$REBUILD_IMAGE" = true ]; then
    echo "正在启动新构建的容器..."
    sudo docker compose up -d app
else
    echo "正在重启应用容器..."
    sudo docker compose restart app
fi

echo "✓ 应用容器已重启"

echo ""
echo "步骤 3: 等待应用启动并检查状态"
echo "----------------------------------------"
echo "等待10秒让应用启动..."
sleep 10

# 检查容器状态
echo ""
echo "检查容器状态:"
sudo docker compose ps

# 检查应用健康状态
echo ""
echo "检查应用健康状态:"
if sudo docker compose exec -T app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" 2>/dev/null; then
    echo "✓ 应用健康检查通过"
else
    echo "⚠ 应用可能还在启动中，请稍后检查日志"
fi

echo ""
echo "步骤 4: 查看应用日志（最近50行）"
echo "----------------------------------------"
echo "应用日志:"
sudo docker compose logs app --tail 50

echo ""
echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "后续操作:"
echo "1. 查看完整日志: sudo docker compose logs -f app"
echo "2. 检查数据库表是否已创建:"
echo "   sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e 'SHOW TABLES LIKE \"news_sync_execution_log\";'"
echo "3. 测试日志功能: 在定时任务管理页面点击'日志'按钮"
echo ""

