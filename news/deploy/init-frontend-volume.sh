#!/bin/bash

# 初始化前端 volume 脚本
# 如果 volume 为空，从镜像中复制前端文件到 volume

set -e

echo "=========================================="
echo "初始化前端 Volume"
echo "=========================================="

VOLUME_NAME="news_app_frontend"
CONTAINER_NAME="newsapp"

# 检查容器是否运行
if ! sudo docker ps | grep -q "$CONTAINER_NAME"; then
    echo "⚠ 容器 $CONTAINER_NAME 未运行，跳过初始化"
    exit 0
fi

# 检查 volume 中是否有文件
VOLUME_PATH=$(sudo docker volume inspect $VOLUME_NAME 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -z "$VOLUME_PATH" ]; then
    echo "⚠ 无法找到 volume 路径"
    exit 1
fi

echo "Volume 路径: $VOLUME_PATH"

# 检查 volume 是否为空
FILE_COUNT=$(sudo ls -A "$VOLUME_PATH" 2>/dev/null | wc -l)

if [ "$FILE_COUNT" -eq 0 ]; then
    echo ""
    echo "检测到 volume 为空，正在从容器复制前端文件..."
    
    # 检查容器中是否有前端文件
    if sudo docker exec "$CONTAINER_NAME" test -d /app/client/dist; then
        echo "正在复制文件..."
        sudo docker cp "$CONTAINER_NAME:/app/client/dist/." "$VOLUME_PATH/"
        echo "✓ 前端文件已复制到 volume"
    else
        echo "⚠ 容器中未找到前端文件，请重新构建镜像"
        exit 1
    fi
else
    echo "✓ Volume 中已有文件 ($FILE_COUNT 个文件/目录)"
fi

echo ""
echo "=========================================="
echo "初始化完成"
echo "=========================================="

