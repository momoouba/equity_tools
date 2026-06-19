#!/bin/bash

# 完整修复Docker前端问题
# 解决React error #130和页面空白问题

set -e

echo "=========================================="
echo "完整修复Docker前端问题"
echo "=========================================="

cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 停止所有容器"
echo "----------------------------------------"
sudo docker compose down

echo ""
echo "步骤 2: 清理旧的构建产物和volume"
echo "----------------------------------------"
# 删除前端volume
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")
echo "删除volume: $VOLUME_NAME"
sudo docker volume rm "$VOLUME_NAME" 2>/dev/null || echo "volume不存在，跳过"

# 清理本地dist目录（如果存在）
if [ -d "client/dist" ]; then
    echo "清理本地dist目录..."
    rm -rf client/dist
fi

# 清理Docker构建缓存
echo "清理Docker构建缓存..."
sudo docker builder prune -f >/dev/null 2>&1 || true

echo ""
echo "步骤 3: 在服务器上重新构建前端"
echo "----------------------------------------"
cd client

# 清理node_modules和重新安装（确保依赖正确）
if [ -d "node_modules" ]; then
    echo "清理旧的node_modules..."
    rm -rf node_modules
fi

echo "安装前端依赖..."
npm install --silent

echo "正在构建前端（生产环境）..."
NODE_ENV=production npm run build

# 验证构建结果
if [ ! -d "dist" ] || [ -z "$(ls -A dist)" ]; then
    echo "❌ 错误: 前端构建失败，dist目录为空"
    exit 1
fi

if [ ! -f "dist/index.html" ]; then
    echo "❌ 错误: 构建失败，index.html不存在"
    exit 1
fi

echo "✓ 前端构建完成"
echo "构建文件数量: $(find dist -type f | wc -l)"
echo "index.html大小: $(du -sh dist/index.html | awk '{print $1}')"

# 检查index.html内容
if ! grep -q "root" dist/index.html; then
    echo "⚠ 警告: index.html中可能缺少root元素"
fi

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
echo "步骤 6: 等待应用完全启动"
echo "----------------------------------------"
echo "等待30秒让应用完全启动..."
sleep 30

echo ""
echo "步骤 7: 验证部署"
echo "----------------------------------------"
echo "检查容器状态:"
sudo docker compose ps

echo ""
echo "检查前端文件:"
if sudo docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 容器内前端文件存在"
    FILE_SIZE=$(sudo docker compose exec app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -gt 1000 ]; then
        echo "✓ 文件大小正常: ${FILE_SIZE} 字节"
    else
        echo "⚠ 警告: 文件大小异常: ${FILE_SIZE} 字节"
    fi
else
    echo "❌ 容器内前端文件不存在！"
fi

echo ""
echo "检查assets目录:"
ASSET_COUNT=$(sudo docker compose exec app find /app/client/dist/assets -type f 2>/dev/null | wc -l || echo "0")
if [ "$ASSET_COUNT" -gt 0 ]; then
    echo "✓ assets文件数量: $ASSET_COUNT"
else
    echo "❌ assets目录为空或不存在！"
fi

echo ""
echo "检查应用健康状态:"
if sudo docker compose exec -T app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" 2>/dev/null; then
    echo "✓ 应用健康检查通过"
else
    echo "⚠ 应用可能还在启动中"
fi

echo ""
echo "检查Nginx前端文件:"
if sudo docker compose exec -T nginx test -f /usr/share/nginx/html/index.html 2>/dev/null; then
    echo "✓ Nginx前端文件存在"
else
    echo "❌ Nginx前端文件不存在！"
fi

echo ""
echo "步骤 8: 查看应用日志（最后30行）"
echo "----------------------------------------"
sudo docker compose logs --tail=30 app

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo ""
echo "请执行以下操作："
echo "1. 清除浏览器缓存（Ctrl + Shift + Delete）"
echo "2. 硬刷新页面（Ctrl + F5）"
echo "3. 如果使用无痕模式，关闭并重新打开"
echo "4. 检查浏览器控制台是否还有错误"
echo ""
echo "如果问题仍然存在，请运行诊断脚本："
echo "  ./deploy/debug-docker-frontend.sh"
echo ""
