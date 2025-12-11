#!/bin/bash

# 手动更新前端文件（适用于volume路径找不到的情况）
# 使用方法: ./deploy/manual-update-frontend.sh

set -e

echo "=========================================="
echo "手动更新前端文件"
echo "=========================================="

cd "$(dirname "$0")/.." || exit

# 1. 重新构建前端
echo ""
echo "步骤 1: 重新构建前端"
echo "----------------------------------------"
cd client
npm run build
cd ..
echo "✓ 前端构建完成"

# 2. 查找volume
echo ""
echo "步骤 2: 查找volume"
echo "----------------------------------------"
echo "正在查找所有可能的volume..."

# 列出所有volumes
echo "所有volumes:"
sudo docker volume ls | grep -E "frontend|app" || echo "未找到相关volume"

# 尝试查找volume路径
for vol_name in "newsapp_app_frontend" "news_app_frontend" "app_frontend"; do
  echo ""
  echo "尝试volume: $vol_name"
  VOLUME_PATH=$(sudo docker volume inspect "$vol_name" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
  if [ -n "$VOLUME_PATH" ]; then
    echo "✓ 找到volume路径: $VOLUME_PATH"
    echo "正在复制文件..."
    sudo rm -rf "$VOLUME_PATH"/*
    sudo cp -r client/dist/* "$VOLUME_PATH/"
    echo "✓ 文件已复制"
    sudo docker compose restart nginx
    echo "✓ 更新完成！"
    exit 0
  fi
done

# 3. 如果找不到volume，使用app容器
echo ""
echo "步骤 3: 使用app容器复制文件"
echo "----------------------------------------"
if sudo docker ps | grep -q "newsapp"; then
  echo "使用app容器复制文件..."
  sudo docker cp client/dist/. newsapp:/app/client/dist/
  echo "✓ 文件已复制到app容器"
  sudo docker compose restart nginx
  echo "✓ 更新完成！"
else
  echo "❌ 错误: app容器未运行"
  echo "请先启动容器: sudo docker compose up -d"
  exit 1
fi

