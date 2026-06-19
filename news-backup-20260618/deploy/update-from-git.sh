#!/bin/bash

# Docker 环境 Git 更新脚本
# 使用方法: ./deploy/update-from-git.sh [branch-name]
# 示例: ./deploy/update-from-git.sh main

set -e

echo "=========================================="
echo "  从 Git 拉取代码并更新 Docker 容器"
echo "=========================================="
echo ""

# 进入项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR" || exit

# 检查是否在 Git 仓库中
if [ ! -d .git ]; then
    echo "❌ 错误：当前目录不是 Git 仓库"
    echo "   请先初始化 Git 仓库："
    echo "   git init"
    echo "   git remote add origin <your-repo-url>"
    exit 1
fi

# 检查远程仓库配置
if ! git remote | grep -q origin; then
    echo "❌ 错误：未配置远程仓库"
    echo "   请先配置远程仓库："
    echo "   git remote add origin <your-repo-url>"
    exit 1
fi

# 获取分支名称（默认为 main）
BRANCH=${1:-main}
echo "目标分支: $BRANCH"
echo ""

# 1. 备份当前代码（可选）
echo "步骤 1: 备份当前代码..."
BACKUP_DIR="backups/backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -d server ]; then
    cp -r server "$BACKUP_DIR/" 2>/dev/null || true
    echo "✓ 备份完成: $BACKUP_DIR"
else
    echo "⚠️  server 目录不存在，跳过备份"
fi
echo ""

# 2. 检查本地修改
echo "步骤 2: 检查本地修改..."
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  警告：检测到未提交的本地修改"
    echo ""
    git status --short
    echo ""
    read -p "是否继续？(y/n，默认n): " continue_update
    if [ "$continue_update" != "y" ] && [ "$continue_update" != "Y" ]; then
        echo "已取消更新"
        exit 0
    fi
    echo ""
fi

# 3. 拉取最新代码
echo "步骤 3: 从 Git 拉取最新代码..."
if git pull origin "$BRANCH"; then
    echo "✓ 代码拉取成功"
else
    echo "✗ 代码拉取失败，请检查："
    echo "  1. Git 远程仓库配置是否正确: git remote -v"
    echo "  2. 网络连接是否正常"
    echo "  3. 认证信息是否正确"
    echo "  4. 分支名称是否正确: $BRANCH"
    exit 1
fi
echo ""

# 4. 检查是否有冲突
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  警告：拉取后仍有未提交的修改（可能有冲突）"
    git status
    echo ""
    read -p "是否继续？(y/n，默认n): " continue_after_conflict
    if [ "$continue_after_conflict" != "y" ] && [ "$continue_after_conflict" != "Y" ]; then
        echo "已取消更新，请手动解决冲突"
        exit 1
    fi
fi
echo ""

# 5. 检查是否需要安装新的依赖
echo "步骤 4: 检查依赖..."
if [ -f package.json ]; then
    # 检查 package.json 或 package-lock.json 是否有变化
    if git diff HEAD@{1} HEAD -- package.json package-lock.json 2>/dev/null | grep -q "^+"; then
        echo "检测到依赖文件有变化"
        read -p "是否在宿主机安装依赖？(y/n，默认n): " install_deps
        if [ "$install_deps" = "y" ] || [ "$install_deps" = "Y" ]; then
            echo "正在安装依赖..."
            if npm install --production; then
                echo "✓ 依赖安装完成"
            else
                echo "⚠️  依赖安装失败，但继续更新"
            fi
        fi
    else
        echo "✓ 依赖文件无变化"
    fi
else
    echo "⚠️  未找到 package.json，跳过依赖检查"
fi
echo ""

# 6. 检查是否需要重新构建前端
echo "步骤 5: 检查前端代码..."
if [ -d client ]; then
    # 检查 client 目录是否有变化
    if git diff HEAD@{1} HEAD -- client/ 2>/dev/null | grep -q "^+"; then
        echo "检测到前端代码有变化"
        read -p "是否重新构建前端？(y/n，默认y): " rebuild_frontend
        if [ "$rebuild_frontend" != "n" ] && [ "$rebuild_frontend" != "N" ]; then
            echo "正在重新构建前端..."
            cd client
            if npm install && npm run build; then
                echo "✓ 前端构建完成"
                cd ..
                
                # 更新前端文件到 Docker volume
                echo "正在更新前端文件到 Docker volume..."
                if [ -f deploy/clear-cache-and-update.sh ]; then
                    chmod +x deploy/clear-cache-and-update.sh
                    if ./deploy/clear-cache-and-update.sh; then
                        echo "✓ 前端文件已更新到 Docker volume"
                    else
                        echo "⚠️  前端文件更新失败，请手动更新"
                    fi
                else
                    echo "⚠️  未找到前端更新脚本，请手动更新前端文件"
                fi
            else
                echo "⚠️  前端构建失败，但继续更新后端"
                cd ..
            fi
        else
            echo "跳过前端构建"
        fi
    else
        echo "✓ 前端代码无变化"
    fi
else
    echo "⚠️  未找到 client 目录，跳过前端检查"
fi
echo ""

# 7. 重启 Docker 容器
echo "步骤 6: 重启 Docker 容器..."
if command -v docker &> /dev/null && [ -f docker-compose.yml ]; then
    if docker compose ps 2>/dev/null | grep -q "newsapp.*Up"; then
        echo "正在重启应用容器..."
        if docker compose restart app; then
            echo "✓ 容器已重启"
        else
            echo "⚠️  容器重启失败，尝试启动容器..."
            docker compose up -d app
        fi
    else
        echo "容器未运行，正在启动..."
        docker compose up -d app
        echo "✓ 容器已启动"
    fi
else
    echo "⚠️  未找到 Docker 或 docker-compose.yml，跳过容器重启"
    echo "   请手动重启容器: docker compose restart app"
fi
echo ""

# 8. 等待服务启动
echo "步骤 7: 等待服务启动..."
sleep 5

# 9. 检查服务状态
echo "步骤 8: 检查服务状态..."
if command -v docker &> /dev/null && [ -f docker-compose.yml ]; then
    docker compose ps
    echo ""
    
    echo "步骤 9: 查看应用日志（最近50行）..."
    docker compose logs app --tail 50
else
    echo "⚠️  未找到 Docker，无法检查服务状态"
fi

echo ""
echo "=========================================="
echo "  更新完成！"
echo "=========================================="
echo ""
echo "后续操作:"
if command -v docker &> /dev/null; then
    echo "1. 查看完整日志: docker compose logs -f app"
    echo "2. 检查服务状态: docker compose ps"
    echo "3. 测试健康检查: curl http://localhost:3001/api/health"
fi
echo "4. 查看备份目录: $BACKUP_DIR"
echo ""

