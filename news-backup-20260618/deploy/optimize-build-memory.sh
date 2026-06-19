#!/bin/bash

# 优化前端构建内存使用脚本
# 使用方法: ./deploy/optimize-build-memory.sh

set -e

echo "=========================================="
echo "优化前端构建内存使用"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录（news目录）执行此脚本"
    exit 1
fi

echo "步骤 1: 清理系统临时文件和缓存"
echo "----------------------------------------"

# 清理Docker构建缓存
echo "清理Docker构建缓存..."
docker builder prune -f || echo "⚠️  清理Docker缓存失败，继续..."

# 清理系统临时文件
echo "清理系统临时文件..."
sudo rm -rf /tmp/* 2>/dev/null || echo "⚠️  清理临时文件失败，继续..."
sudo rm -rf /var/tmp/* 2>/dev/null || echo "⚠️  清理临时文件失败，继续..."

# 清理npm缓存
echo "清理npm缓存..."
if command -v npm &> /dev/null; then
    npm cache clean --force 2>/dev/null || echo "⚠️  清理npm缓存失败，继续..."
fi

echo "✓ 清理完成"
echo ""

echo "步骤 2: 检查系统资源"
echo "----------------------------------------"
echo "当前内存使用情况:"
free -h

echo ""
echo "当前CPU负载:"
uptime

echo ""
echo "临时文件系统使用情况:"
df -h /tmp /dev/shm /run 2>/dev/null || echo "无法获取临时文件系统信息"

echo ""
read -p "是否继续构建？(y/n，默认y): " continue_build
if [ "$continue_build" = "n" ] || [ "$continue_build" = "N" ]; then
    echo "已取消构建"
    exit 0
fi

echo ""
echo "步骤 3: 使用优化的内存限制构建"
echo "----------------------------------------"
echo "正在构建（使用4GB内存限制）..."

# 设置Node.js内存限制并构建
export NODE_OPTIONS="--max-old-space-size=4096"

# 在Docker构建时传递环境变量
docker compose build --build-arg NODE_OPTIONS="--max-old-space-size=4096" app

echo ""
echo "✓ 构建完成"
echo ""
echo "提示: 如果构建仍然失败，可以尝试："
echo "  1. 增加内存限制: NODE_OPTIONS=\"--max-old-space-size=6144\""
echo "  2. 在服务器空闲时构建（避免与其他服务竞争资源）"
echo "  3. 考虑增加服务器内存或使用更大内存的构建服务器"
echo ""
