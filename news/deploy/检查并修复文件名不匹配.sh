#!/bin/bash
# 检查并修复文件名不匹配问题
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/检查并修复文件名不匹配.sh

cd /opt/newsapp/news

echo "=========================================="
echo "检查并修复文件名不匹配"
echo "=========================================="

echo ""
echo "步骤1: 检查构建后的 index.html 内容..."
echo "----------------------------------------"
cat client/dist/index.html

echo ""
echo "步骤2: 检查 assets 目录中的文件..."
echo "----------------------------------------"
ls -lh client/dist/assets/

echo ""
echo "步骤3: 检查 volume 中的文件..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"
sudo ls -lh "$VOLUME_PATH/assets/" | head -10

echo ""
echo "步骤4: 检查 nginx 中的文件..."
echo "----------------------------------------"
docker compose exec nginx ls -lh /usr/share/nginx/html/assets/ | head -10

echo ""
echo "=========================================="
echo "分析"
echo "=========================================="
echo "如果 index.html 引用的文件名与 assets 目录中的文件名不匹配，"
echo "需要确保："
echo "1. index.html 中引用的文件名与 assets 目录中的文件名一致"
echo "2. 删除旧的 assets 文件，只保留新构建的文件"
echo ""
echo "如果文件名匹配，但浏览器仍然 404，可能是缓存问题"
