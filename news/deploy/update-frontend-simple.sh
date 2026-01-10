#!/bin/bash

# 简化版前端更新脚本 - 直接使用运行中的nginx容器
# 无需拉取Docker镜像，直接复制文件到nginx容器

set -e

echo "=========================================="
echo "简化版前端更新"
echo "=========================================="

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "项目根目录: $PROJECT_ROOT"
echo ""

# 检查dist目录
if [ ! -d "client/dist" ]; then
    echo "❌ 错误: client/dist 目录不存在"
    echo "请先解压上传的文件: unzip dist.zip"
    exit 1
fi

echo "✓ 找到dist目录: client/dist"
echo ""

# 查找volume路径或使用app容器
echo "查找Docker Volume或app容器..."

# 方法1: 尝试查找volume路径
VOLUME_NAMES=(
    "$(basename $(pwd))_app_frontend"
    "newsapp_app_frontend"
    "news_app_frontend"
    "app_frontend"
)

VOLUME_PATH=""
VOLUME_NAME=""
USE_APP_CONTAINER=false
APP_CONTAINER=""

for vol_name in "${VOLUME_NAMES[@]}"; do
    VOLUME_INFO=$(sudo docker volume inspect "$vol_name" 2>/dev/null || echo "")
    if [ -n "$VOLUME_INFO" ]; then
        VOLUME_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
        if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
            VOLUME_NAME="$vol_name"
            echo "✓ 找到volume: $VOLUME_NAME"
            echo "  Volume路径: $VOLUME_PATH"
            break
        fi
    fi
done

# 方法2: 如果找不到volume路径，使用app容器（可写挂载）
if [ -z "$VOLUME_PATH" ]; then
    APP_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "newsapp$|^app$" | head -1)
    if [ -n "$APP_CONTAINER" ]; then
        echo "⚠  无法直接找到volume路径，使用app容器更新"
        echo "✓ 找到app容器: $APP_CONTAINER"
        USE_APP_CONTAINER=true
    else
        echo "❌ 错误: 无法找到volume路径，且没有运行中的app容器"
        echo ""
        echo "请手动执行以下命令查找volume路径："
        echo "  sudo docker volume ls | grep frontend"
        echo "  sudo docker volume inspect <volume名称> | grep Mountpoint"
        exit 1
    fi
fi

echo ""

# 更新文件
echo "=========================================="
echo "更新前端文件（清空旧文件并复制新文件）"
echo "=========================================="

if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
    # 方式1: 直接操作volume路径（最快最可靠）
    echo "方式: 直接操作volume路径"
    echo "正在清空旧文件..."
    sudo rm -rf "$VOLUME_PATH"/*
    sudo rm -rf "$VOLUME_PATH"/.[!.]* 2>/dev/null || true
    
    echo "正在复制新文件..."
    sudo cp -r "$PROJECT_ROOT/client/dist"/* "$VOLUME_PATH/"
    
    # 确保权限正确
    sudo chown -R root:root "$VOLUME_PATH" || true
    sudo chmod -R 755 "$VOLUME_PATH" || true
    
    echo "✓ 前端文件已更新"
elif [ "$USE_APP_CONTAINER" = true ] && [ -n "$APP_CONTAINER" ]; then
    # 方式2: 使用app容器（可写挂载）
    echo "方式: 使用app容器（可写挂载）"
    echo "正在清空app容器中的旧文件..."
    sudo docker exec "$APP_CONTAINER" sh -c "rm -rf /app/client/dist/* /app/client/dist/.[!.]* 2>/dev/null || true"
    
    echo "正在复制新文件到app容器..."
    sudo docker cp "$PROJECT_ROOT/client/dist/." "$APP_CONTAINER:/app/client/dist/"
    
    echo "✓ 前端文件已更新"
else
    echo "❌ 错误: 无法更新文件"
    exit 1
fi
echo ""

# 验证
echo "=========================================="
echo "验证更新"
echo "=========================================="

sleep 2

# 检查文件数量
if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
    FILE_COUNT=$(sudo ls -1 "$VOLUME_PATH" | wc -l)
    if [ "$FILE_COUNT" -gt 0 ]; then
        echo "✓ Volume中有 $FILE_COUNT 个文件/目录"
        if sudo test -f "$VOLUME_PATH/index.html"; then
            echo "✓ index.html 文件存在"
        else
            echo "⚠  警告: index.html 文件不存在"
        fi
    else
        echo "⚠  警告: Volume中似乎没有文件"
    fi
elif [ "$USE_APP_CONTAINER" = true ] && [ -n "$APP_CONTAINER" ]; then
    FILE_COUNT=$(sudo docker exec "$APP_CONTAINER" sh -c "ls -1 /app/client/dist 2>/dev/null | wc -l" || echo "0")
    if [ "$FILE_COUNT" -gt 0 ]; then
        echo "✓ App容器中有 $FILE_COUNT 个文件/目录"
        if sudo docker exec "$APP_CONTAINER" test -f /app/client/dist/index.html; then
            echo "✓ index.html 文件存在"
        else
            echo "⚠  警告: index.html 文件不存在"
        fi
    else
        echo "⚠  警告: App容器中似乎没有文件"
    fi
fi

# 检查nginx容器（用于验证）
NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
if [ -n "$NGINX_CONTAINER" ]; then
    if sudo docker exec "$NGINX_CONTAINER" test -f /usr/share/nginx/html/index.html 2>/dev/null; then
        echo "✓ Nginx容器可以访问到index.html"
    fi
fi

echo ""
echo "=========================================="
echo "✅ 更新完成！"
echo "=========================================="
echo ""

# 是否需要重启
if [ -n "$VOLUME_PATH" ]; then
    echo "注意: 文件已直接更新到volume，nginx会自动读取最新文件。"
    echo "      通常不需要重启nginx容器。"
elif [ "$USE_APP_CONTAINER" = true ]; then
    echo "注意: 文件已更新到app容器的volume，nginx会自动读取最新文件。"
    echo "      通常不需要重启nginx容器。"
fi

echo ""
echo "后续操作："
echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "  2. 强制刷新页面（Ctrl+F5）"
echo ""
echo "如果页面没有更新，可以重启nginx:"
NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
if [ -n "$NGINX_CONTAINER" ]; then
    echo "  sudo docker restart $NGINX_CONTAINER"
fi
echo ""
echo "查看nginx日志:"
if [ -n "$NGINX_CONTAINER" ]; then
    echo "  sudo docker logs $NGINX_CONTAINER --tail 50"
fi
echo ""

