#!/bin/bash

# 安全的前端构建脚本（带资源检查和清理）
# 使用方法: ./deploy/build-frontend-safe.sh
# 说明: 此脚本会检查系统资源，清理旧进程，然后安全地构建前端

set -e

echo "=========================================="
echo "安全前端构建（带资源管理）"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录（news目录）执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo "步骤 1: 检查系统资源"
echo "----------------------------------------"
# 检查当前内存使用情况
TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
AVAIL_MEM=$(free -m | awk '/^Mem:/{print $7}')
USED_MEM=$(free -m | awk '/^Mem:/{print $3}')
MEM_PERCENT=$((USED_MEM * 100 / TOTAL_MEM))

echo "系统内存: ${TOTAL_MEM}MB 总计, ${AVAIL_MEM}MB 可用, ${USED_MEM}MB 已用 (${MEM_PERCENT}%)"

# 如果内存使用超过85%，建议清理
if [ $MEM_PERCENT -gt 85 ]; then
    echo "⚠️  警告: 系统内存使用率很高 (${MEM_PERCENT}%)"
    echo "建议清理系统缓存和停止不必要的服务"
    read -p "是否继续构建？(y/n，默认n): " continue_build
    if [ "$continue_build" != "y" ] && [ "$continue_build" != "Y" ]; then
        echo "构建已取消"
        exit 1
    fi
fi

echo ""
echo "步骤 2: 清理旧的构建进程"
echo "----------------------------------------"
# 查找并终止旧的构建进程
OLD_BUILD_PIDS=$(ps aux | grep -E "vite build|npm run build" | grep -v grep | awk '{print $2}' || echo "")
if [ -n "$OLD_BUILD_PIDS" ]; then
    echo "发现旧的构建进程，正在终止..."
    echo "$OLD_BUILD_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 2
    echo "✓ 旧进程已清理"
else
    echo "✓ 没有发现旧的构建进程"
fi

# 清理僵尸 node 进程（占用大量 CPU 的）
HIGH_CPU_NODES=$(ps aux | awk '$1!="USER" && $3>50 && $11~/node/ {print $2}' || echo "")
if [ -n "$HIGH_CPU_NODES" ]; then
    echo "发现高 CPU 占用的 node 进程，正在检查..."
    for pid in $HIGH_CPU_NODES; do
        # 检查进程是否真的是构建进程
        if ps -p $pid -o cmd= | grep -qE "vite|build"; then
            echo "终止构建进程 PID: $pid"
            kill -9 $pid 2>/dev/null || true
        fi
    done
    sleep 2
fi

echo ""
echo "步骤 3: 清理构建缓存"
echo "----------------------------------------"
cd client

# 清理旧的构建文件
if [ -d "dist" ]; then
    echo "清理旧的构建文件..."
    rm -rf dist
fi

# 清理 Vite 缓存
if [ -d "node_modules/.vite" ]; then
    echo "清理 Vite 缓存..."
    rm -rf node_modules/.vite
fi

# 清理 npm 缓存（可选，如果内存真的很紧张）
if [ $AVAIL_MEM -lt 1024 ]; then
    echo "内存紧张，清理 npm 缓存..."
    npm cache clean --force 2>/dev/null || true
fi

cd ..

echo ""
echo "步骤 4: 构建前端"
echo "----------------------------------------"
cd client

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules 不存在，正在安装依赖..."
    npm install
fi

# 根据可用内存动态调整内存限制和构建命令
if [ $AVAIL_MEM -lt 1536 ]; then
    MEMORY_LIMIT=1024
    BUILD_CMD="npm run build:minimal"
    echo "⚠️  可用内存严重不足 (${AVAIL_MEM}MB)，使用最小内存构建模式 (${MEMORY_LIMIT}MB)"
elif [ $AVAIL_MEM -lt 2048 ]; then
    MEMORY_LIMIT=1536
    BUILD_CMD="npm run build:low-memory"
    echo "⚠️  可用内存不足 (${AVAIL_MEM}MB)，使用低内存构建模式 (${MEMORY_LIMIT}MB)"
elif [ $AVAIL_MEM -lt 3072 ]; then
    MEMORY_LIMIT=2048
    BUILD_CMD="npm run build"
    echo "使用标准构建模式 (${MEMORY_LIMIT}MB)"
else
    MEMORY_LIMIT=2048
    BUILD_CMD="npm run build"
    echo "使用标准构建模式 (${MEMORY_LIMIT}MB)"
fi

echo "开始构建前端..."
echo "内存限制: ${MEMORY_LIMIT}MB"
echo "构建命令: ${BUILD_CMD}"
echo ""

# 设置 Node.js 内存限制
export NODE_OPTIONS="--max-old-space-size=${MEMORY_LIMIT}"

# 使用 nice 降低进程优先级，减少对系统的影响
# 使用 timeout 防止构建无限期运行（最多30分钟）
timeout 1800 nice -n 10 $BUILD_CMD

BUILD_EXIT_CODE=$?

if [ $BUILD_EXIT_CODE -ne 0 ]; then
    if [ $BUILD_EXIT_CODE -eq 124 ]; then
        echo "❌ 构建超时（超过30分钟）"
    else
        echo "❌ 前端构建失败，退出码: $BUILD_EXIT_CODE"
    fi
    echo ""
    echo "故障排除建议:"
    echo "  1. 检查系统内存: free -h"
    echo "  2. 检查是否有其他进程占用资源: top"
    echo "  3. 尝试使用最小内存模式: npm run build:minimal"
    echo "  4. 清理系统缓存: sync && echo 3 | sudo tee /proc/sys/vm/drop_caches"
    exit 1
fi

cd ..
echo "✓ 前端构建完成"

echo ""
echo "=========================================="
echo "构建成功！"
echo "=========================================="
echo ""
echo "构建文件位置: client/dist/"
echo "下一步: 使用 ./deploy/update-sharepage-frontend.sh 更新 Docker 环境"
echo ""
