#!/bin/bash

# 直接修复空白页面 - 使用volume路径直接复制文件
# 在服务器上执行: cd /opt/newsapp/news && sudo bash deploy/fix-blank-page-direct.sh

set -e

echo "修复空白页面问题..."

# 检查容器
if ! docker compose ps | grep -q "newsapp.*Up"; then
    echo "错误: 应用容器未运行"
    exit 1
fi

# 查找volume路径
VOLUME_NAME="news_app_frontend"
echo "正在查找volume路径..."
VOLUME_PATH=$(docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -z "$VOLUME_PATH" ]; then
    echo "错误: 无法找到volume: $VOLUME_NAME"
    exit 1
fi

echo "找到volume路径: $VOLUME_PATH"

# 方法：使用docker cp导出，然后解压到volume路径
echo "正在从应用容器复制文件..."

# 创建临时目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# 从容器复制文件到临时目录
docker cp newsapp:/app/client/dist/. "$TEMP_DIR/"

# 复制到volume路径（需要root权限）
echo "正在复制文件到volume..."
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r "$TEMP_DIR"/* "$VOLUME_PATH/"

# 验证
if [ -f "$VOLUME_PATH/index.html" ]; then
    FILE_SIZE=$(stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
    echo "✓ 文件复制成功，index.html大小: $FILE_SIZE 字节"
else
    echo "✗ 错误: 文件复制失败"
    exit 1
fi

# 重启nginx
echo "重启nginx..."
docker compose restart nginx

echo "完成！请清除浏览器缓存并刷新页面"
