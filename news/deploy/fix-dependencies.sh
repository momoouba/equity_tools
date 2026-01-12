#!/bin/bash

# 修复依赖安装问题脚本
# 使用方法: ./deploy/fix-dependencies.sh

set -e

echo "=========================================="
echo "修复前端依赖安装问题"
echo "=========================================="
echo ""

# 进入项目目录
cd "$(dirname "$0")/.." || exit
PROJECT_ROOT=$(pwd)

echo "项目根目录: $PROJECT_ROOT"
echo ""

# 进入client目录
cd "$PROJECT_ROOT/client"

echo "当前目录: $(pwd)"
echo ""

# 检查package.json
if [ ! -f "package.json" ]; then
    echo "❌ 错误: package.json 不存在"
    exit 1
fi

echo "✓ package.json 存在"
echo ""

# 配置npm使用国内镜像源
echo "配置npm镜像源..."
npm config set registry https://registry.npmmirror.com
npm config set fetch-timeout 300000
npm config set fetch-retries 5
echo "✓ npm镜像源配置完成"
echo ""

# 删除node_modules和package-lock.json（如果存在）
echo "清理旧的依赖..."
if [ -d "node_modules" ]; then
    echo "  删除 node_modules..."
    rm -rf node_modules
fi

if [ -f "package-lock.json" ]; then
    echo "  删除 package-lock.json..."
    rm -f package-lock.json
fi

echo "✓ 清理完成"
echo ""

# 清除npm缓存
echo "清除npm缓存..."
npm cache clean --force || true
echo "✓ 缓存清除完成"
echo ""

# 重新安装依赖
echo "正在安装依赖..."
echo "这可能需要几分钟时间，请耐心等待..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 错误: npm install 失败"
    exit 1
fi

echo "✓ 依赖安装完成"
echo ""

# 验证关键依赖是否安装
echo "验证关键依赖..."
if [ -d "node_modules/@arco-design/web-react" ]; then
    echo "✓ @arco-design/web-react 已安装"
else
    echo "❌ @arco-design/web-react 未安装"
    exit 1
fi

if [ -d "node_modules/react" ]; then
    echo "✓ react 已安装"
else
    echo "❌ react 未安装"
    exit 1
fi

if [ -d "node_modules/vite" ]; then
    echo "✓ vite 已安装"
else
    echo "❌ vite 未安装"
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ 依赖修复完成！"
echo "=========================================="
echo ""
echo "现在可以执行构建命令："
echo "  npm run build"
echo ""

