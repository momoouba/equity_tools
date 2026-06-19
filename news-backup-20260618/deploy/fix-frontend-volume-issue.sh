#!/bin/bash

# 修复Docker前端显示问题 - 专门处理volume覆盖问题
# 问题：Docker volume包含旧文件，覆盖了镜像中的新文件

set -e

echo "=========================================="
echo "修复Docker前端Volume问题"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 停止容器"
echo "----------------------------------------"
sudo docker compose down

echo ""
echo "步骤 2: 删除旧的前端volume"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")
echo "Volume名称: $VOLUME_NAME"

if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "删除volume: $VOLUME_NAME"
    sudo docker volume rm "$VOLUME_NAME" || {
        echo "⚠ volume删除失败，尝试强制删除..."
        # 如果volume被使用，先停止所有相关容器
        sudo docker ps -a | grep -E "newsapp|newsapp-nginx" | awk '{print $1}' | xargs -r sudo docker rm -f 2>/dev/null || true
        sudo docker volume rm "$VOLUME_NAME" || echo "⚠ volume仍在使用，将在启动时重新创建"
    }
    echo "✓ volume已删除"
else
    echo "✓ volume不存在，跳过删除"
fi

echo ""
echo "步骤 3: 重新构建前端（在服务器上）"
echo "----------------------------------------"
cd client

# 检查node_modules是否存在
if [ ! -d "node_modules" ]; then
    echo "安装前端依赖..."
    npm install --silent
fi

echo "正在构建前端..."
npm run build

if [ ! -d "dist" ] || [ -z "$(ls -A dist)" ]; then
    echo "❌ 错误: 前端构建失败，dist目录为空"
    exit 1
fi

echo "✓ 前端构建完成"
echo "构建文件数量: $(find dist -type f | wc -l)"
cd ..

echo ""
echo "步骤 4: 重新构建Docker镜像（不使用缓存）"
echo "----------------------------------------"
echo "正在构建镜像（这可能需要几分钟）..."
sudo docker compose build --no-cache app

echo ""
echo "步骤 5: 启动容器"
echo "----------------------------------------"
sudo docker compose up -d

echo ""
echo "步骤 6: 等待应用启动"
echo "----------------------------------------"
echo "等待20秒让应用完全启动..."
sleep 20

echo ""
echo "步骤 7: 验证部署"
echo "----------------------------------------"
echo "检查容器状态:"
sudo docker compose ps

echo ""
echo "检查前端文件是否存在:"
if sudo docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 前端文件存在"
    echo ""
    echo "前端文件列表（前10个）:"
    sudo docker compose exec app ls -la /app/client/dist/ 2>/dev/null | head -10 || echo "无法列出文件"
    echo ""
    echo "检查index.html的前几行:"
    sudo docker compose exec app head -5 /app/client/dist/index.html 2>/dev/null || echo "无法读取文件"
else
    echo "❌ 警告: 前端文件不存在，请检查构建过程"
fi

echo ""
echo "检查应用健康状态:"
if sudo docker compose exec -T app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" 2>/dev/null; then
    echo "✓ 应用健康检查通过"
else
    echo "⚠ 应用可能还在启动中，请稍后检查日志"
fi

echo ""
echo "检查Nginx状态:"
if sudo docker compose exec -T nginx test -f /usr/share/nginx/html/index.html 2>/dev/null; then
    echo "✓ Nginx前端文件存在"
else
    echo "⚠ Nginx前端文件不存在"
fi

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo ""
echo "请执行以下操作验证修复："
echo "1. 清除浏览器缓存（Ctrl + Shift + Delete）"
echo "2. 硬刷新页面（Ctrl + F5）"
echo "3. 检查浏览器控制台是否有错误"
echo ""
echo "如果问题仍然存在，请查看详细日志："
echo "  sudo docker compose logs -f app"
echo "  sudo docker compose logs -f nginx"
echo ""
