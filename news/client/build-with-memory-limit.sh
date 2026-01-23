#!/bin/bash

# 带内存限制的前端构建脚本
# 使用方法: ./build-with-memory-limit.sh [内存大小MB，默认4096]

set -e

MEMORY_LIMIT=${1:-4096}

echo "=========================================="
echo "前端构建（内存限制: ${MEMORY_LIMIT}MB）"
echo "=========================================="
echo ""

# 检查是否在 client 目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在 client 目录执行此脚本"
    exit 1
fi

# 设置 Node.js 内存限制
export NODE_OPTIONS="--max-old-space-size=${MEMORY_LIMIT}"

echo "Node.js 内存限制: ${MEMORY_LIMIT}MB"
echo "开始构建..."
echo ""

# 执行构建
npm run build

echo ""
echo "=========================================="
echo "构建完成！"
echo "=========================================="
