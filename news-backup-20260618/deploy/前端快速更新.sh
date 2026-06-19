#!/bin/bash

# 快速更新前端脚本（简化版）
# 适用于已经构建好前端，只需要更新文件的场景

set -e

echo "=========================================="
echo "快速更新前端"
echo "=========================================="

# 检查dist目录是否存在
if [ ! -d "client/dist" ]; then
    echo "❌ 错误: client/dist 目录不存在"
    echo "请先执行: cd client && npm run build"
    exit 1
fi

# 查找volume并更新
VOLUME_NAMES=(
    "$(basename $(pwd))_app_frontend"
    "newsapp_app_frontend"
    "news_app_frontend"
    "app_frontend"
)

for vol_name in "${VOLUME_NAMES[@]}"; do
    VOLUME_PATH=$(sudo docker volume inspect "$vol_name" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
        echo "找到volume: $vol_name"
        echo "清空旧文件..."
        sudo rm -rf "$VOLUME_PATH"/*
        echo "复制新文件..."
        sudo cp -r client/dist/* "$VOLUME_PATH/"
        echo "重启nginx..."
        sudo docker compose restart nginx || sudo docker restart newsapp-nginx
        echo "✅ 更新完成！"
        exit 0
    fi
done

# 如果找不到volume，使用临时容器
echo "使用临时容器更新..."
TEMP_CONTAINER="temp-frontend-$(date +%s)"
sudo docker run -d --name "$TEMP_CONTAINER" -v newsapp_app_frontend:/target alpine sleep 3600 2>/dev/null || \
sudo docker run -d --name "$TEMP_CONTAINER" -v "$(basename $(pwd))_app_frontend":/target alpine sleep 3600

sudo docker exec "$TEMP_CONTAINER" sh -c "rm -rf /target/*"
sudo docker cp client/dist/. "$TEMP_CONTAINER:/target/"
sudo docker rm -f "$TEMP_CONTAINER"
sudo docker compose restart nginx || sudo docker restart newsapp-nginx

echo "✅ 更新完成！"

