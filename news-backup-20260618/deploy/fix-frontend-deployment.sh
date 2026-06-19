#!/bin/bash

# 修复前端部署问题：重新构建前端并更新Docker容器
# 使用方法: ./deploy/fix-frontend-deployment.sh

set -e

echo "=========================================="
echo "修复前端部署问题"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 重新构建前端"
echo "----------------------------------------"
cd client
echo "正在安装依赖..."
npm install
echo "正在构建前端..."
npm run build
cd ..
echo "✓ 前端构建完成"

echo ""
echo "步骤 2: 停止并删除旧容器和volume"
echo "----------------------------------------"
echo "停止容器..."
sudo docker compose down

echo "删除前端volume（如果存在）..."
sudo docker volume rm news_app_frontend 2>/dev/null || echo "volume不存在，跳过"

echo ""
echo "步骤 3: 重新构建Docker镜像（包含新的前端文件）"
echo "----------------------------------------"
echo "正在构建镜像..."
sudo docker compose build app

echo ""
echo "步骤 4: 启动容器"
echo "----------------------------------------"
sudo docker compose up -d

echo ""
echo "步骤 5: 等待应用启动"
echo "----------------------------------------"
echo "等待15秒让应用启动..."
sleep 15

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
echo "步骤 6: 验证前端文件"
echo "----------------------------------------"
echo "检查前端文件是否存在:"
sudo docker compose exec app ls -la /app/client/dist/ 2>/dev/null | head -10 || echo "无法访问容器，请检查容器状态"

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo ""
echo "后续操作:"
echo "1. 清除浏览器缓存并刷新页面"
echo "2. 查看应用日志: sudo docker compose logs -f app"
echo "3. 如果还有问题，检查前端文件: sudo docker compose exec app ls -la /app/client/dist/"
echo ""

