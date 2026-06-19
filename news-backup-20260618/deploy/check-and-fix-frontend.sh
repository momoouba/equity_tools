#!/bin/bash

# 检查并修复前端显示问题
# 问题：Docker volume可能包含旧的前端文件，覆盖了新构建的文件

set -e

echo "=========================================="
echo "检查并修复前端显示问题"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 检查容器状态"
echo "----------------------------------------"
sudo docker compose ps

echo ""
echo "步骤 2: 检查容器内的前端文件"
echo "----------------------------------------"
echo "检查 /app/client/dist/index.html 是否存在:"
if sudo docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 文件存在"
    echo ""
    echo "文件列表（前10个）:"
    sudo docker compose exec app ls -la /app/client/dist/ 2>/dev/null | head -10 || echo "无法列出文件"
    echo ""
    echo "检查 index.html 内容（前20行）:"
    sudo docker compose exec app head -20 /app/client/dist/index.html 2>/dev/null || echo "无法读取文件"
else
    echo "❌ 文件不存在！"
fi

echo ""
echo "步骤 3: 检查本地构建的前端文件"
echo "----------------------------------------"
if [ -d "client/dist" ]; then
    echo "✓ 本地dist目录存在"
    echo "文件数量: $(find client/dist -type f 2>/dev/null | wc -l)"
    if [ -f "client/dist/index.html" ]; then
        echo "✓ index.html 存在"
        echo "文件大小: $(du -sh client/dist 2>/dev/null | awk '{print $1}')"
    else
        echo "❌ index.html 不存在"
    fi
else
    echo "⚠ 本地dist目录不存在"
    echo "需要重新构建前端"
fi

echo ""
echo "步骤 4: 检查Docker volume"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")
echo "Volume名称: $VOLUME_NAME"

if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$VOLUME_PATH" ]; then
        echo "Volume路径: $VOLUME_PATH"
        echo "Volume中的文件数量: $(sudo ls -1 "$VOLUME_PATH" 2>/dev/null | wc -l)"
        if [ -f "$VOLUME_PATH/index.html" ]; then
            echo "✓ volume中有index.html"
            echo "文件修改时间:"
            sudo stat "$VOLUME_PATH/index.html" 2>/dev/null | grep Modify || echo "无法获取文件信息"
        else
            echo "⚠ volume中没有index.html"
        fi
    fi
else
    echo "⚠ volume不存在"
fi

echo ""
echo "步骤 5: 比较文件时间"
echo "----------------------------------------"
if [ -f "client/dist/index.html" ] && [ -f "$VOLUME_PATH/index.html" ]; then
    LOCAL_TIME=$(stat -c %Y client/dist/index.html 2>/dev/null || stat -f %m client/dist/index.html 2>/dev/null || echo "0")
    VOLUME_TIME=$(sudo stat -c %Y "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
    
    if [ "$LOCAL_TIME" -gt "$VOLUME_TIME" ]; then
        echo "⚠ 本地文件比volume中的文件新，需要更新volume"
        NEED_UPDATE=true
    else
        echo "✓ volume中的文件是最新的"
        NEED_UPDATE=false
    fi
else
    NEED_UPDATE=true
fi

echo ""
echo "=========================================="
echo "诊断结果"
echo "=========================================="

if [ "$NEED_UPDATE" = true ]; then
    echo ""
    echo "需要更新前端文件。请选择操作："
    echo ""
    echo "选项 1: 重新构建并更新（推荐）"
    echo "  ./deploy/fix-docker-frontend-issue.sh"
    echo ""
    echo "选项 2: 仅更新volume（如果本地已构建）"
    echo "  ./deploy/update-frontend-only.sh"
    echo ""
    echo "选项 3: 删除volume并重新构建镜像"
    echo "  sudo docker compose down"
    echo "  sudo docker volume rm $VOLUME_NAME"
    echo "  sudo docker compose build --no-cache app"
    echo "  sudo docker compose up -d"
else
    echo ""
    echo "✓ 前端文件看起来是最新的"
    echo ""
    echo "如果页面仍然空白，可能是以下原因："
    echo "1. 浏览器缓存 - 请清除缓存并硬刷新（Ctrl + F5）"
    echo "2. 代码问题 - 检查浏览器控制台是否有错误"
    echo "3. Nginx配置 - 检查Nginx是否正确配置"
fi

echo ""
