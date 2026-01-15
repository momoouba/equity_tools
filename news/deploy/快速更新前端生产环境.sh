#!/bin/bash

# 快速更新前端生产环境
# 使用方法: ./deploy/快速更新前端生产环境.sh

set -e

echo "=========================================="
echo "快速更新前端生产环境"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo "步骤 1: 停止容器"
echo "----------------------------------------"
docker compose down
echo "✓ 容器已停止"
echo ""

echo "步骤 2: 删除旧的前端 volume（确保使用新文件）"
echo "----------------------------------------"
docker volume rm news_app_frontend 2>/dev/null || echo "Volume 不存在或已删除"
echo "✓ Volume 已清理"
echo ""

echo "步骤 3: 重新构建 Docker 镜像"
echo "----------------------------------------"
echo "正在构建镜像（这可能需要几分钟）..."
docker compose build --no-cache app
echo "✓ 镜像构建完成"
echo ""

echo "步骤 4: 启动容器"
echo "----------------------------------------"
docker compose up -d
echo "✓ 容器已启动"
echo ""

echo "步骤 5: 等待服务启动"
echo "----------------------------------------"
sleep 10

echo ""
echo "步骤 6: 检查服务状态"
echo "----------------------------------------"
docker compose ps

echo ""
echo "步骤 7: 查看应用日志"
echo "----------------------------------------"
docker compose logs app --tail 50

echo ""
echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "请执行以下操作："
echo "1. 清除浏览器缓存（Ctrl + Shift + Delete）"
echo "2. 硬刷新页面（Ctrl + Shift + R）"
echo "3. 访问分享页面验证更新"
echo ""
echo "验证方法："
echo "- 打开浏览器开发者工具（F12）"
echo "- 查看控制台，应该看到："
echo "  [ShareNewsPage] 版本: 2.0.0-simplified"
echo "- 不应该看到 MutationObserver 相关的循环日志"
echo ""
