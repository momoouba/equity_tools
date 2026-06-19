#!/bin/bash

# Git 配置脚本
# 使用方法: ./deploy/setup-git.sh
# 功能：一键配置 Git 仓库和远程仓库
# 默认仓库: https://github.com/momoouba/equity_news

set -e

echo "=========================================="
echo "  Git 配置脚本"
echo "=========================================="
echo ""

# 进入项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR" || exit

echo "项目目录: $PROJECT_DIR"
echo ""

# 1. 检查 Git 是否安装
echo "步骤 1: 检查 Git..."
if ! command -v git &> /dev/null; then
    echo "Git 未安装，正在安装..."
    sudo apt update
    sudo apt install git -y
    echo "✓ Git 安装完成"
else
    echo "✓ Git 已安装: $(git --version)"
fi
echo ""

# 2. 初始化 Git 仓库
echo "步骤 2: 检查 Git 仓库..."
if [ ! -d .git ]; then
    echo "初始化 Git 仓库..."
    git init
    echo "✓ Git 仓库初始化完成"
    
    # 配置 Git 用户信息
    read -p "请输入 Git 用户名（默认: Server User）: " git_user
    git_user=${git_user:-Server User}
    git config user.name "$git_user"
    
    read -p "请输入 Git 邮箱（默认: server@example.com）: " git_email
    git_email=${git_email:-server@example.com}
    git config user.email "$git_email"
    
    echo "✓ Git 用户信息已配置: $git_user <$git_email>"
else
    echo "✓ Git 仓库已存在"
    echo "当前用户信息:"
    git config user.name || echo "  用户名: 未设置"
    git config user.email || echo "  邮箱: 未设置"
fi
echo ""

# 3. 配置远程仓库
echo "步骤 3: 配置远程仓库..."
DEFAULT_REPO_URL="https://github.com/momoouba/equity_news.git"
if git remote | grep -q origin; then
    echo "当前远程仓库配置:"
    git remote -v
    echo ""
    read -p "是否要更新远程仓库地址？(y/n，默认n): " update_remote
    if [ "$update_remote" = "y" ] || [ "$update_remote" = "Y" ]; then
        read -p "请输入新的 Git 仓库地址（默认: $DEFAULT_REPO_URL）: " repo_url
        repo_url=${repo_url:-$DEFAULT_REPO_URL}
        # 确保地址以 .git 结尾（如果不是 SSH 格式）
        if [[ ! "$repo_url" =~ ^git@ ]] && [[ ! "$repo_url" =~ \.git$ ]]; then
            repo_url="${repo_url}.git"
        fi
        if [ -n "$repo_url" ]; then
            git remote set-url origin "$repo_url"
            echo "✓ 已更新远程仓库地址: $repo_url"
        fi
    fi
else
    read -p "请输入 Git 仓库地址（默认: $DEFAULT_REPO_URL）: " repo_url
    repo_url=${repo_url:-$DEFAULT_REPO_URL}
    if [ -n "$repo_url" ]; then
        git remote add origin "$repo_url"
        echo "✓ 已添加远程仓库: $repo_url"
    else
        echo "⚠️  未输入仓库地址，跳过远程仓库配置"
    fi
fi

if git remote | grep -q origin; then
    echo ""
    echo "远程仓库配置:"
    git remote -v
fi
echo ""

# 4. 配置 Git 认证方式
echo "步骤 4: 配置 Git 认证..."
echo "请选择认证方式："
echo "1) HTTPS + 个人访问令牌（推荐，简单）"
echo "2) SSH 密钥（更安全）"
read -p "请选择 (1/2，默认1): " auth_method
auth_method=${auth_method:-1}

if [ "$auth_method" = "1" ]; then
    # HTTPS 方式
    git config --global credential.helper store
    echo "✓ 已配置 HTTPS 凭据存储"
    echo ""
    echo "提示：首次拉取代码时会提示输入："
    echo "  - 用户名：你的 GitHub/GitLab 用户名"
    echo "  - 密码：输入个人访问令牌（不是账户密码）"
    echo ""
    echo "如何创建个人访问令牌："
    echo "  - GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)"
    echo "  - GitLab: User Settings → Access Tokens"
    echo "  权限需要：repo（读取仓库）"
elif [ "$auth_method" = "2" ]; then
    # SSH 方式
    if [ ! -f ~/.ssh/id_rsa ]; then
        echo "生成 SSH 密钥..."
        read -p "请输入邮箱（用于 SSH 密钥）: " ssh_email
        ssh_email=${ssh_email:-server@example.com}
        ssh-keygen -t rsa -b 4096 -C "$ssh_email" -f ~/.ssh/id_rsa -N ""
        echo "✓ SSH 密钥已生成"
    else
        echo "✓ SSH 密钥已存在"
    fi
    
    echo ""
    echo "请将以下公钥添加到 GitHub/GitLab："
    echo "----------------------------------------"
    cat ~/.ssh/id_rsa.pub
    echo "----------------------------------------"
    echo ""
    echo "添加位置："
    echo "  - GitHub: Settings → SSH and GPG keys → New SSH key"
    echo "  - GitLab: User Settings → SSH Keys"
    echo ""
    read -p "添加完成后，按 Enter 继续..."
    
    # 测试 SSH 连接
    if [[ "$repo_url" == git@* ]]; then
        echo "测试 SSH 连接..."
        if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
            echo "✓ SSH 连接测试成功"
        elif ssh -T git@gitlab.com 2>&1 | grep -q "successfully authenticated"; then
            echo "✓ SSH 连接测试成功"
        else
            echo "⚠️  SSH 连接测试失败，请检查密钥是否已添加到平台"
        fi
    fi
fi
echo ""

# 5. 首次拉取代码
echo "步骤 5: 首次拉取代码..."
if git remote | grep -q origin; then
    read -p "请输入分支名称（默认 main）: " branch
    branch=${branch:-main}
    echo "拉取分支: $branch"
    echo ""
    
    # 先尝试 fetch 来测试连接
    echo "测试远程仓库连接..."
    if git fetch origin 2>&1 | head -5; then
        echo ""
        echo "正在拉取代码..."
        if git pull origin "$branch" 2>&1; then
            echo "✓ 代码拉取成功"
        else
            echo "⚠️  代码拉取失败，可能的原因："
            echo "  1. 远程仓库是空的（需要先推送代码）"
            echo "  2. 认证信息不正确（需要输入用户名和访问令牌）"
            echo "  3. 网络连接问题"
            echo "  4. 分支名称不正确（当前分支: $branch）"
            echo ""
            echo "如果远程仓库是空的，可以执行："
            echo "  git add ."
            echo "  git commit -m 'Initial commit'"
            echo "  git push -u origin $branch"
            echo ""
            echo "如果需要重新拉取，可以执行："
            echo "  git pull origin $branch"
        fi
    else
        echo "⚠️  无法连接到远程仓库，请检查："
        echo "  1. 网络连接是否正常"
        echo "  2. 仓库地址是否正确: $(git remote get-url origin)"
        echo "  3. 认证信息是否正确（HTTPS 需要访问令牌，SSH 需要密钥）"
    fi
else
    echo "⚠️  未配置远程仓库，跳过代码拉取"
fi
echo ""

# 6. 设置更新脚本权限
echo "步骤 6: 设置脚本权限..."
if [ -f deploy/update-from-git.sh ]; then
    chmod +x deploy/update-from-git.sh
    echo "✓ 已设置 update-from-git.sh 执行权限"
else
    echo "⚠️  未找到 update-from-git.sh 文件"
fi
echo ""

# 7. 显示配置摘要
echo "=========================================="
echo "  配置摘要"
echo "=========================================="
echo ""
echo "Git 版本: $(git --version)"
echo ""
echo "Git 用户信息:"
echo "  用户名: $(git config user.name)"
echo "  邮箱: $(git config user.email)"
echo ""
if git remote | grep -q origin; then
    echo "远程仓库:"
    git remote -v | sed 's/^/  /'
    echo ""
    echo "当前分支: $(git branch --show-current 2>/dev/null || echo '未设置')"
    echo "最新提交: $(git log -1 --oneline 2>/dev/null || echo '无提交记录')"
else
    echo "远程仓库: 未配置"
fi
echo ""

# 8. 完成提示
echo "=========================================="
echo "  配置完成！"
echo "=========================================="
echo ""
if git remote | grep -q origin; then
    echo "Git 仓库地址: $(git remote get-url origin)"
    echo ""
fi
echo "后续更新代码，执行："
echo "  cd $PROJECT_DIR"
echo "  ./deploy/update-from-git.sh"
echo ""
echo "或指定分支："
echo "  ./deploy/update-from-git.sh main"
echo "  ./deploy/update-from-git.sh master"
echo "  ./deploy/update-from-git.sh develop"
echo ""
echo "提示：如果首次拉取失败，请确保："
echo "  1. 已在 GitHub 创建个人访问令牌（Settings → Developer settings → Personal access tokens）"
echo "  2. 拉取时输入用户名和访问令牌（不是密码）"
echo "  3. 或者配置 SSH 密钥（更安全）"
echo ""

