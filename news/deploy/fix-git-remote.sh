#!/bin/bash

# 修复 Git 远程仓库地址脚本
# 使用方法: ./deploy/fix-git-remote.sh

set -e

echo "=========================================="
echo "  修复 Git 远程仓库地址"
echo "=========================================="
echo ""

# 进入项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR" || exit

echo "项目目录: $PROJECT_DIR"
echo ""

# 检查是否在 Git 仓库中
if [ ! -d .git ]; then
    echo "❌ 错误：当前目录不是 Git 仓库"
    exit 1
fi

# 显示当前配置
echo "当前远程仓库配置:"
git remote -v
echo ""

# 正确的仓库地址
CORRECT_REPO_URL="https://github.com/momoouba/equity_news.git"

echo "正确的仓库地址应该是: $CORRECT_REPO_URL"
echo ""

# 修复远程仓库地址
if git remote | grep -q origin; then
    echo "正在修复远程仓库地址..."
    git remote set-url origin "$CORRECT_REPO_URL"
    echo "✓ 已更新远程仓库地址"
    echo ""
    echo "更新后的配置:"
    git remote -v
    echo ""
    
    # 测试连接
    echo "测试远程仓库连接..."
    echo ""
    
    # 先检查是否有 HTTP2 错误，如果有则自动修复
    if git fetch origin 2>&1 | grep -q "HTTP2 framing layer"; then
        echo "检测到 HTTP2 错误，正在自动修复..."
        git config --global http.version HTTP/1.1
        git config --global http.postBuffer 524288000
        echo "✓ 已禁用 HTTP2 并增加缓冲区大小"
        echo ""
        echo "重新测试连接..."
    fi
    
    if git fetch origin 2>&1 | head -5; then
        echo ""
        echo "✓ 远程仓库连接正常"
    else
        echo ""
        echo "⚠️  连接测试失败，可能的原因："
        echo "  1. 需要认证（HTTPS 需要访问令牌，SSH 需要密钥）"
        echo "  2. 网络连接问题"
        echo "  3. 仓库不存在或无权访问"
        echo ""
        echo "建议尝试："
        echo "  1. 禁用 HTTP2: git config --global http.version HTTP/1.1"
        echo "  2. 增加缓冲区: git config --global http.postBuffer 524288000"
        echo "  3. 或使用 SSH: git remote set-url origin git@github.com:momoouba/equity_news.git"
    fi
else
    echo "未找到 origin 远程仓库，正在添加..."
    git remote add origin "$CORRECT_REPO_URL"
    echo "✓ 已添加远程仓库"
    echo ""
    echo "当前配置:"
    git remote -v
fi

echo ""
echo "=========================================="
echo "  修复完成！"
echo "=========================================="
echo ""
echo "现在可以使用以下命令拉取代码："
echo "  git pull origin main"
echo ""
echo "或使用更新脚本："
echo "  ./deploy/update-from-git.sh"
echo ""

