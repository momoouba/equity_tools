#!/bin/bash

# 完成前端更新
# 根据实际情况，volume名称是 news_app_frontend

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "完成前端文件更新"
echo "=========================================="

# 使用正确的volume名称
VOLUME_NAME="news_app_frontend"
VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

if [ -z "$VOLUME_PATH" ] || [ ! -d "$VOLUME_PATH" ]; then
    echo "❌ 错误: 无法找到volume路径"
    echo "尝试查找所有volumes:"
    sudo docker volume ls | grep frontend
    exit 1
fi

echo "✓ Volume名称: $VOLUME_NAME"
echo "✓ Volume路径: $VOLUME_PATH"
echo ""

# 检查dist目录
if [ ! -d "client/dist" ]; then
    echo "❌ 错误: client/dist 目录不存在"
    echo "请先确保已解压dist.zip到client/dist目录"
    exit 1
fi

echo "✓ 找到dist目录: client/dist"
echo ""

# 清空旧文件
echo "正在清空旧文件..."
sudo rm -rf "$VOLUME_PATH"/*
sudo rm -rf "$VOLUME_PATH"/.[!.]* 2>/dev/null || true
echo "✓ 旧文件已清空"
echo ""

# 复制新文件
echo "正在复制新文件..."
sudo cp -r client/dist/* "$VOLUME_PATH/"
echo "✓ 新文件已复制"
echo ""

# 设置权限
echo "正在设置权限..."
sudo chown -R root:root "$VOLUME_PATH"
sudo chmod -R 755 "$VOLUME_PATH"
echo "✓ 权限已设置"
echo ""

# 验证
echo "=========================================="
echo "验证更新"
echo "=========================================="

FILE_COUNT=$(sudo ls -1 "$VOLUME_PATH" | wc -l)
if [ "$FILE_COUNT" -gt 0 ]; then
    echo "✓ Volume中有 $FILE_COUNT 个文件/目录"
else
    echo "⚠ 警告: Volume中似乎没有文件"
fi

if sudo test -f "$VOLUME_PATH/index.html"; then
    FILE_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || sudo stat -f%z "$VOLUME_PATH/index.html" 2>/dev/null || echo "unknown")
    echo "✓ index.html 存在（大小: $FILE_SIZE 字节）"
    
    # 显示index.html的前几行
    echo ""
    echo "index.html 前10行："
    sudo head -10 "$VOLUME_PATH/index.html"
else
    echo "❌ 错误: index.html 文件不存在"
    exit 1
fi

# 通过nginx容器验证
echo ""
echo "通过nginx容器验证..."
NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
if [ -n "$NGINX_CONTAINER" ]; then
    if sudo docker exec "$NGINX_CONTAINER" test -f /usr/share/nginx/html/index.html 2>/dev/null; then
        echo "✓ Nginx容器可以访问到index.html"
    else
        echo "⚠ 警告: Nginx容器无法访问index.html"
    fi
fi

echo ""
echo "=========================================="
echo "✅ 更新完成！"
echo "=========================================="
echo ""
echo "后续操作："
echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete 或 Cmd+Shift+Delete）"
echo "  2. 强制刷新页面（Ctrl+F5 或 Cmd+Shift+R）"
echo "  3. 检查浏览器控制台（F12）是否有错误"
echo ""
echo "如果页面没有更新，可以重启nginx（通常不需要）："
if [ -n "$NGINX_CONTAINER" ]; then
    echo "  sudo docker restart $NGINX_CONTAINER"
fi
echo ""
echo "查看nginx日志："
if [ -n "$NGINX_CONTAINER" ]; then
    echo "  sudo docker logs $NGINX_CONTAINER --tail 50"
fi
echo ""

