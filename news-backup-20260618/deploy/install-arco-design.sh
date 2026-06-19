#!/bin/bash

# 手动安装 @arco-design/web-react 包
# 使用方法: ./deploy/install-arco-design.sh

set -e

echo "=========================================="
echo "手动安装 @arco-design/web-react"
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

# 配置npm
echo "配置npm..."
npm config set registry https://registry.npmmirror.com
npm config set fetch-timeout 300000
npm config set fetch-retries 5
echo "✓ npm配置完成"
echo ""

# 检查当前node_modules
echo "检查当前node_modules..."
if [ -d "node_modules" ]; then
    echo "  node_modules 目录存在"
    echo "  已安装的包数量: $(ls -1 node_modules 2>/dev/null | wc -l)"
else
    echo "  node_modules 目录不存在"
fi

echo ""

# 尝试单独安装 @arco-design/web-react
echo "正在安装 @arco-design/web-react..."
npm install @arco-design/web-react@^2.66.8 --save

if [ $? -ne 0 ]; then
    echo "❌ 安装失败，尝试使用官方源..."
    npm config set registry https://registry.npmjs.org
    npm install @arco-design/web-react@^2.66.8 --save
fi

echo ""

# 验证安装
echo "验证安装..."
if [ -d "node_modules/@arco-design/web-react" ]; then
    echo "✓ @arco-design/web-react 已成功安装"
    echo "  路径: node_modules/@arco-design/web-react"
    ls -la node_modules/@arco-design/web-react | head -5
else
    echo "❌ @arco-design/web-react 仍未安装"
    echo ""
    echo "检查node_modules目录内容:"
    ls -la node_modules/ | head -20
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ 安装完成！"
echo "=========================================="
echo ""
echo "现在可以执行构建命令："
echo "  npm run build"
echo ""

