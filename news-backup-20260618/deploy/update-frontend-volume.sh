#!/bin/bash
# 将 client/dist 复制到 Nginx 使用的前端 volume（app_frontend）
# 在项目根目录执行: bash deploy/update-frontend-volume.sh 或 cd news && bash deploy/update-frontend-volume.sh

set -e
cd "$(dirname "$0")/.." || exit

if [ ! -d "client/dist" ] || [ ! -f "client/dist/index.html" ]; then
    echo "❌ 请先构建前端: cd client && npm run build"
    exit 1
fi

# 查找名为 *app_frontend 的 volume（docker compose 会生成 项目名_app_frontend）
VOLUME_NAME=$(sudo docker volume ls -q | grep app_frontend | head -1)
if [ -z "$VOLUME_NAME" ]; then
    echo "❌ 未找到 app_frontend volume，请先启动一次: sudo docker compose up -d"
    exit 1
fi

VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
if [ -z "$VOLUME_PATH" ] || [ ! -d "$VOLUME_PATH" ]; then
    echo "❌ 无法获取 volume 路径"
    exit 1
fi

echo "Volume: $VOLUME_NAME"
echo "路径:   $VOLUME_PATH"
echo "清空并复制 client/dist -> volume..."
sudo rm -rf "${VOLUME_PATH:?}"/*
sudo cp -r client/dist/* "$VOLUME_PATH/"
echo "✓ 完成。可执行: sudo docker compose exec nginx nginx -s reload"
exit 0
