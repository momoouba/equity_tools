#!/bin/bash

# 修复Docker环境前端显示问题
# 问题：本地环境正常，Docker环境空白
# 原因：Docker volume可能包含旧的前端文件，覆盖了新构建的文件

set -e

echo "=========================================="
echo "修复Docker环境前端显示问题"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目根目录
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 检查当前状态"
echo "----------------------------------------"
echo "检查容器状态..."
sudo docker compose ps

echo ""
echo "步骤 2: 重新构建前端（确保代码是最新的）"
echo "----------------------------------------"
cd client
echo "正在安装依赖（如果需要）..."
npm install --silent 2>/dev/null || npm install

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
echo "步骤 3: 停止容器"
echo "----------------------------------------"
sudo docker compose down

echo ""
echo "步骤 4: 删除旧的前端volume（确保使用新文件）"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")

echo "Volume名称: $VOLUME_NAME"
if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "删除旧的volume..."
    sudo docker volume rm "$VOLUME_NAME" || echo "⚠ volume删除失败，继续执行"
else
    echo "✓ volume不存在，跳过删除"
fi

echo ""
echo "步骤 5: 清理Docker构建缓存（可选，确保使用最新代码）"
echo "----------------------------------------"
echo "清理构建缓存..."
sudo docker builder prune -f >/dev/null 2>&1 || true

echo ""
echo "步骤 6: 重新构建Docker镜像（包含新的前端文件）"
echo "----------------------------------------"
echo "正在构建镜像（这可能需要几分钟）..."
sudo docker compose build --no-cache app

echo ""
echo "步骤 7: 启动容器"
echo "----------------------------------------"
sudo docker compose up -d

echo ""
echo "步骤 8: 等待应用启动"
echo "----------------------------------------"
echo "等待20秒让应用完全启动..."
sleep 20

echo ""
echo "步骤 9: 验证部署"
echo "----------------------------------------"
echo "检查容器状态:"
sudo docker compose ps

echo ""
echo "检查前端文件是否存在:"
if sudo docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 前端文件存在"
    echo "前端文件列表（前10个）:"
    sudo docker compose exec app ls -la /app/client/dist/ 2>/dev/null | head -10 || echo "无法列出文件"
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
echo "步骤 10: 查看应用日志（最后20行）"
echo "----------------------------------------"
sudo docker compose logs --tail=20 app

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
echo ""
